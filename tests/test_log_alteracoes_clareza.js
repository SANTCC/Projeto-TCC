#!/usr/bin/env node
/**
 * Regressão — Tarefa 9 (Correções): log geral de alterações do Painel Geral
 * (dashboard.html) sem duplicidades e com frases claras do que foi feito.
 *
 * Causas raiz corrigidas:
 *  1. DUPLICIDADE: a deduplicação local×banco comparava as strings cruas de
 *     data_hora — o banco (timestamptz/PostgREST) devolve o instante em
 *     formato diferente do ISO local ("...+00:00" × "...Z"), então o MESMO
 *     evento aparecia duas vezes. A chave agora compara o instante (epoch) +
 *     código do usuário + entidade (tipo/id normalizado) + tipo de alteração.
 *  2. VAGUEZA: a tabela mostrava só "entidade + tipo" (ex.: "CARGA CRG-2026-303
 *     / EDICAO"). Agora cada log carrega uma frase (descricao) — os detalhes em
 *     texto têm precedência ("Marcou o recebimento da carga...") e, sem eles, a
 *     frase é sintetizada (verbo + entidade + código legível: "Criou a carga
 *     CRG-2026-303"), gravada em detalhes.descricao no banco e exibida na
 *     célula da entidade (com a mesma projeção de privacidade).
 *
 * Cenários:
 *  S1. auditoria.js: frase gravada no log local E no banco (string explícita,
 *      síntese com código legível dos detalhes, síntese pela entidade).
 *  S2. Painel: mesmo evento (local + banco, formatos de data diferentes) →
 *      UMA única linha, com a frase exibida.
 *  S3. Eventos distintos continuam separados (banco + local complementares).
 *  S4. Log legado no banco (sem detalhes) → frase sintetizada na exibição.
 *  S5. Busca alcança a frase ("recebimento") sem quebrar a busca por código.
 *  S6. Contrato visual preservado: 5 colunas (teste de privacidade existente).
 *  S7. Sem erros de runtime.
 *
 * Executar: node tests/test_log_alteracoes_clareza.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ---------- S1: lado da gravação (auditoria.js) ------------------------------
async function abrirAuditoria(banco) {
  const j = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_audit_logs: [], nexus_func_list: [] },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (w) => { w.currentUserSession = w.NexusAuth.getSession(); w.nexusSupabase = banco; },
      'js/auditoria.js'
    ]
  });
  await prontoDom(j.w);
  await aguardar(60);
  return j;
}

// ---------- Painel (dashboard.js) -------------------------------------------
async function abrirPainel({ dbLogs, localLogs }) {
  const banco = criarBancoFalso({ logs_alteracoes: dbLogs });
  const j = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA'),
    storage: { nexus_audit_logs: localLogs, nexus_func_list: [], nexus_trail_decisoes: [] },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js',
      (w) => { w.currentUserSession = w.NexusAuth.getSession(); w.nexusSupabase = banco; },
      'js/data-repository.js', 'js/auditoria.js', 'js/pages/dashboard.js'
    ]
  });
  await prontoDom(j.w);
  await aguardar(500);
  return { j, banco };
}

const linhasDoLog = (w) => Array.from(w.document.getElementById('auditLogTableBody').querySelectorAll('tr'));
const textoDoLog = (w) => w.document.getElementById('auditLogTableBody').textContent;

async function main() {
  log('\n[Tarefa 9] Log geral de alterações: sem duplicidade e com frases claras\n');

  // ---------- S1 ------------------------------------------------------------
  log('S1. auditoria.js: frase gravada no log local e no banco');
  let banco = criarBancoFalso({ logs_alteracoes: [] });
  let j = await abrirAuditoria(banco);
  let w = j.w;
  const localLogs = () => JSON.parse(w.localStorage.getItem('nexus_audit_logs') || '[]');

  await w.registrarLogAlteracao('CRG-2026-303', 'EDICAO', 'Marcou o recebimento da carga CRG-2026-303');
  check('S1: frase explícita gravada no log local (descricao)',
    localLogs()[0].descricao === 'Marcou o recebimento da carga CRG-2026-303', JSON.stringify(localLogs()[0]).slice(0, 200));
  // Obs.: o banco falso faz merge de inserts sem id (upsert pela chave 'id'),
  // então a linha reflete sempre o ÚLTIMO payload gravado — suficiente para
  // validar o que auditoria.js envia ao banco em cada chamada.
  check('S1: frase explícita gravada no banco (detalhes.descricao)',
    banco.tabelas.logs_alteracoes.length === 1 &&
    banco.tabelas.logs_alteracoes[0].detalhes.descricao === 'Marcou o recebimento da carga CRG-2026-303',
    JSON.stringify(banco.tabelas.logs_alteracoes[0] && banco.tabelas.logs_alteracoes[0].detalhes).slice(0, 200));

  await w.registrarLogAlteracao('CRIACAO', 'cargas', UUID(901), { id: 'CRG-2026-304', responsavel: 'Ana' });
  check('S1: síntese com código legível dos detalhes ("Criou a carga CRG-2026-304", nunca UUID cru)',
    localLogs()[0].descricao === 'Criou a carga CRG-2026-304' &&
    banco.tabelas.logs_alteracoes[0].detalhes.descricao === 'Criou a carga CRG-2026-304',
    localLogs()[0].descricao);

  await w.registrarLogAlteracao('EDICAO', 'navios', 'IMO1000001', { localizacao: 'FORA_DO_PORTO' });
  check('S1: síntese pela entidade ("Editou o navio IMO1000001") quando detalhes é objeto sem frase',
    localLogs()[0].descricao === 'Editou o navio IMO1000001' &&
    banco.tabelas.logs_alteracoes[0].detalhes.descricao === 'Editou o navio IMO1000001',
    localLogs()[0].descricao);

  await w.registrarLogAlteracao('EDICAO', 'navios', UUID(902), { descricao: 'Liberou a saída do navio MSC Aurora com destino a Rotterdam (agora Fora do Porto)' });
  check('S1: descricao fornecida pelo autor da ação tem precedência sobre a síntese',
    localLogs()[0].descricao === 'Liberou a saída do navio MSC Aurora com destino a Rotterdam (agora Fora do Porto)',
    localLogs()[0].descricao);
  check('S7: S1 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S2: deduplicação local × banco ---------------------------------
  log('\nS2. Mesmo evento gravado localmente e no banco → UMA linha (sem duplicidade)');
  const evento = {
    codigo: 'NX-9001-SP',
    frase: 'Marcou o recebimento da carga CRG-2026-303'
  };
  const dbRow = {
    id: UUID(701),
    data_hora: '2026-10-16T12:00:00.500+00:00', // formato devolvido pelo PostgREST
    codigo_individual: evento.codigo,
    cargo: 'CONFERENTE_CARGA',
    entidade_tipo: 'CARGA',
    entidade_id: 'CRG-2026-303',
    tipo_alteracao: 'EDICAO',
    detalhes: { descricao: evento.frase, referencia_id: null }
  };
  const localRow = {
    data_hora: '2026-10-16T12:00:00.500Z', // ISO local (mesmo instante, formato diferente)
    nome_funcionario: 'Carlos Conferente',
    cargo: 'Conferente de Carga',
    codigo_usuario: evento.codigo,
    entidade: 'CARGA CRG-2026-303',
    entidade_tipo: 'CARGA',
    entidade_id: 'CRG-2026-303',
    tipo_alteracao: 'EDICAO',
    descricao: evento.frase,
    detalhes: evento.frase
  };
  let painel = await abrirPainel({ dbLogs: [dbRow], localLogs: [localRow] });
  w = painel.j.w;
  check('S2: exatamente UMA linha para o mesmo evento (dedup por instante + código + entidade + tipo)',
    linhasDoLog(w).length === 1, `linhas=${linhasDoLog(w).length}`);
  check('S2: frase clara exibida na linha', textoDoLog(w).includes(evento.frase), textoDoLog(w).slice(0, 200));
  check('S7: S2 sem erros de runtime', painel.j.erros.length === 0, JSON.stringify(painel.j.erros).slice(0, 200));
  painel.j.dom.window.close();

  // ---------- S3: eventos distintos não se fundem ----------------------------
  log('\nS3. Eventos distintos continuam separados (banco + local complementares)');
  painel = await abrirPainel({
    dbLogs: [
      dbRow,
      Object.assign({}, dbRow, { id: UUID(702), data_hora: '2026-10-16T13:00:00.000+00:00', entidade_id: 'CRG-2026-304', detalhes: { descricao: 'Criou a carga CRG-2026-304' } })
    ],
    localLogs: [
      localRow, // mesmo evento da linha 1 do banco → não entra
      {
        data_hora: '2026-10-16T14:30:00.000Z', nome_funcionario: 'Diretora', cargo: 'Direção',
        codigo_usuario: 'NX-7001-DIR', entidade: 'NAVIO IMO1000002', entidade_tipo: 'NAVIO',
        entidade_id: 'IMO1000002', tipo_alteracao: 'EDICAO',
        descricao: 'Liberou a saída do navio Atlantic Star (agora Fora do Porto)', detalhes: 'x'
      }
    ]
  });
  w = painel.j.w;
  check('S3: 3 linhas — 2 do banco + 1 local complementar (duplicada descartada)',
    linhasDoLog(w).length === 3, `linhas=${linhasDoLog(w).length}`);
  check('S3: contador reflete o total sem duplicidade',
    (w.document.getElementById('auditLogCounter').textContent || '').includes('3 de 3'),
    w.document.getElementById('auditLogCounter').textContent);
  check('S7: S3 sem erros de runtime', painel.j.erros.length === 0, JSON.stringify(painel.j.erros).slice(0, 200));
  painel.j.dom.window.close();

  // ---------- S4: log legado sem detalhes → frase sintetizada -----------------
  log('\nS4. Linha legada do banco (sem detalhes) ganha frase sintetizada');
  painel = await abrirPainel({
    dbLogs: [{
      id: UUID(703), data_hora: '2026-10-15T09:00:00.000+00:00', codigo_individual: 'NX-9001-SP',
      cargo: 'ESTIVADOR', entidade_tipo: 'CARGA', entidade_id: 'CRG-9', tipo_alteracao: 'EDICAO'
      // sem detalhes: linha anterior à Tarefa 9
    }],
    localLogs: []
  });
  w = painel.j.w;
  check('S4: frase sintetizada "Editou a carga CRG-9" exibida para log legado',
    linhasDoLog(w).length === 1 && textoDoLog(w).includes('Editou a carga CRG-9'), textoDoLog(w).slice(0, 200));
  check('S7: S4 sem erros de runtime', painel.j.erros.length === 0, JSON.stringify(painel.j.erros).slice(0, 200));
  painel.j.dom.window.close();

  // ---------- S5: busca alcança a frase ---------------------------------------
  log('\nS5. Busca do log alcança a frase (e segue funcionando por código)');
  painel = await abrirPainel({ dbLogs: [dbRow], localLogs: [localRow] });
  w = painel.j.w;
  const busca = w.document.getElementById('buscarAuditLogInput');
  busca.value = 'recebimento';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S5: termo da frase ("recebimento") encontra a linha', linhasDoLog(w).length === 1, `linhas=${linhasDoLog(w).length}`);
  busca.value = 'CRG-2026-303';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S5: busca por código continua funcionando', linhasDoLog(w).length === 1);
  busca.value = 'zzz-inexistente';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S5: estado vazio da busca mantém colspan 5',
    w.document.querySelector('#auditLogTableBody td').getAttribute('colspan') === '5');

  // ---------- S6: contrato visual (5 colunas) preservado ----------------------
  busca.value = '';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S6: tabela continua com 5 colunas (contrato do teste de privacidade)',
    w.document.querySelectorAll('#auditLogPanel thead th').length === 5 &&
    linhasDoLog(w).every((tr) => tr.cells.length === 5));
  check('S7: S5/S6 sem erros de runtime', painel.j.erros.length === 0, JSON.stringify(painel.j.erros).slice(0, 200));
  painel.j.dom.window.close();

  // ---------- S8: Navio sem UUID, sem duplicata de liberação e GERACAO_PDF ----
  log('\nS8. Entidade NAVIO exibe nome (não UUID), liberação não duplica e PDF exibe GERACAO_PDF');
  const uuidNavio = UUID(888);
  painel = await abrirPainel({
    dbLogs: [
      {
        id: UUID(710),
        data_hora: '2026-10-16T15:00:00.100Z',
        codigo_individual: 'NX-7001-DIR',
        cargo: 'DIRETOR_OPERACOES_LOGISTICA',
        entidade_tipo: 'NAVIO',
        entidade_id: uuidNavio,
        tipo_alteracao: 'EDICAO',
        detalhes: { descricao: 'Navio MSC Aurora (IMO-9876543) liberado para saída com destino a Rotterdam' }
      },
      {
        id: UUID(711),
        data_hora: '2026-10-16T15:00:00.400Z',
        codigo_individual: 'NX-7001-DIR',
        cargo: 'DIRETOR_OPERACOES_LOGISTICA',
        entidade_tipo: 'NAVIO',
        entidade_id: uuidNavio,
        tipo_alteracao: 'EDICAO',
        detalhes: { nome: 'MSC Aurora', descricao: 'Liberou a saída do navio MSC Aurora com destino a Rotterdam (agora Fora do Porto)' }
      },
      {
        id: UUID(712),
        data_hora: '2026-10-16T16:00:00.000Z',
        codigo_individual: 'NX-7001-DIR',
        cargo: 'DIRETOR_OPERACOES_LOGISTICA',
        entidade_tipo: 'CARGA',
        entidade_id: 'CRG-2026-500',
        tipo_alteracao: 'EXPORTACAO',
        detalhes: { tipo_exportacao: 'PDF_A4' }
      }
    ],
    localLogs: []
  });
  w = painel.j.w;
  check('S8: liberação de navio no mesmo horário não aparece duplicada (2 linhas totais: 1 navio + 1 PDF)',
    linhasDoLog(w).length === 2, `linhas=${linhasDoLog(w).length}`);
  check('S8: entidade NAVIO exibe o nome do navio ("NAVIO MSC Aurora") e não o UUID',
    textoDoLog(w).includes('NAVIO MSC Aurora') && !textoDoLog(w).includes(uuidNavio),
    textoDoLog(w).slice(0, 300));
  check('S8: geração de PDF exibe GERACAO_PDF em vez de EXPORTACAO',
    textoDoLog(w).includes('GERACAO_PDF') && !/\bEXPORTACAO\b/.test(textoDoLog(w)),
    textoDoLog(w).slice(0, 300));
  painel.j.dom.window.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 9 (log geral sem duplicidade e com frases claras) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
