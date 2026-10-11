/**
 * Teste — Painel Geral: trilha de auditoria com entidade escolhida em listas.
 *
 * Carrega o painel real (dashboard.html + js/pages/dashboard.js) em jsdom com um dublê
 * de Supabase que mantém estado em memória. Verifica: tipos compatíveis por decisão,
 * registros vindos do banco (sem referências fictícias), gravação com a referência real,
 * recusa de combinações incompatíveis, falha de gravação sem registro local e chamadas
 * legadas (decisao, tabela, id, motivo) sem perder o id.
 *
 * Executar: node tests/test_trail_auditoria.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const BASE = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js'];

/** Dublê de Supabase: select (com eq), insert que devolve a linha gravada e falhas simuladas. */
function bancoFalso(tabelas, opcoes) {
  const o = opcoes || {};
  return {
    from(tabela) {
      const estado = { op: 'select', filtros: [], payload: null };
      function executar() {
        if (estado.op === 'insert') {
          if (tabela !== 'trail_decisoes') return { data: null, error: null };
          if (o.falharInsert) return { data: null, error: { message: 'falha simulada na gravação' } };
          const linha = Object.assign({ id: '6f1d2c3b-0000-4000-8000-00000000abcd' }, estado.payload);
          tabelas.trail_decisoes = tabelas.trail_decisoes || [];
          tabelas.trail_decisoes.push(linha);
          return { data: Object.assign({}, linha), error: null };
        }
        const linhas = (tabelas[tabela] || []).filter((r) => estado.filtros.every(([c, v]) => String(r[c]) === String(v)));
        return { data: linhas.map((r) => Object.assign({}, r)), error: null };
      }
      const b = {
        select() { return b; },
        order() { return b; },
        maybeSingle() { return b; },
        eq(c, v) { estado.filtros.push([c, v]); return b; },
        insert(p) { estado.op = 'insert'; estado.payload = p; return b; },
        then(res, rej) { return Promise.resolve(executar()).then(res, rej); }
      };
      return b;
    },
    channel() { return { on() { return this; }, subscribe() { return {}; } }; }
  };
}

function dadosBase() {
  return {
    cargas: [{ id: 'c-1', qr_code_url: 'QR-CRG-2026-303', natureza: 'Geral', status_fluxo: 'ENTREGUE' }],
    navios: [{ id: 'n-1', nome: 'Jaguar', numero_imo: 'IMO-1234567' }],
    containers: [{ id: 'k-1', numero_identificacao: 'MSCU-1234567' }],
    guindastes: [{ id: 'g-1', numero_identificacao: 'ABC-123-DEF' }],
    manutencoes: [],
    funcionarios: [{ id: 'f-1', nome: 'Ana Titular', matricula: 'MAT-2001', ativo: true }],
    trail_decisoes: []
  };
}

async function abrirPainel(tabelas, opcoes) {
  const o = opcoes || {};
  const storage = { nexus_ghost_clean_v1: 'true', nexus_trail_decisoes: [] };
  const janela = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE'),
    storage,
    scripts: BASE.concat([
      (w) => { if (o.semSupabase !== true) w.nexusSupabase = bancoFalso(tabelas, o); },
      'js/pages/dashboard.js'
    ])
  });
  await prontoDom(janela.w);
  await aguardar(60);
  return janela.w;
}

const opcoesDoSelect = (sel) => Array.from(sel.options).map((op) => ({ value: op.value, label: op.textContent }));

async function main() {
  log('\n[1] Tipos compatíveis por decisão');
  {
    const w = await abrirPainel(dadosBase());
    const c = w.TRAIL_TIPOS_COMPATIVEIS || {};
    check('LIBEROU_NAVIO aceita somente NAVIO', JSON.stringify(c.LIBEROU_NAVIO) === '["NAVIO"]', JSON.stringify(c.LIBEROU_NAVIO));
    check('APROVOU_CARGA aceita somente CARGA', JSON.stringify(c.APROVOU_CARGA) === '["CARGA"]');
    check('DESIGNOU_SUBSTITUTO aceita somente FUNCIONARIO', JSON.stringify(c.DESIGNOU_SUBSTITUTO) === '["FUNCIONARIO"]');
    w.close();
  }

  log('\n[2] Formulário: tipo e registro vêm do banco');
  {
    const tabelas = dadosBase();
    const w = await abrirPainel(tabelas);
    const dec = w.document.getElementById('trailTipoDecisao');
    const tipo = w.document.getElementById('trailEntidadeTipo');
    const reg = w.document.getElementById('trailEntidadeRegistro');
    dec.value = 'LIBEROU_NAVIO';
    dec.dispatchEvent(new w.Event('change'));
    await aguardar(60);
    check('tipo de entidade mostra só NAVIO para LIBEROU_NAVIO',
      JSON.stringify(opcoesDoSelect(tipo).map((o) => o.value)) === '["","NAVIO"]', JSON.stringify(opcoesDoSelect(tipo)));
    check('com um único tipo compatível, ele é selecionado', tipo.value === 'NAVIO', tipo.value);
    const opsReg = opcoesDoSelect(reg).filter((o) => o.value);
    check('registro lista somente navios cadastrados no banco',
      opsReg.length === 1 && opsReg[0].label.indexOf('Jaguar') >= 0 && opsReg[0].label.indexOf('IMO-1234567') >= 0, JSON.stringify(opsReg));
    check('registro não está bloqueado quando há cadastros', reg.disabled === false);

    dec.value = 'DESIGNOU_SUBSTITUTO';
    dec.dispatchEvent(new w.Event('change'));
    await aguardar(60);
    const opsSub = opcoesDoSelect(reg).filter((o) => o.value);
    check('DESIGNOU_SUBSTITUTO lista funcionários ativos (matrícula)',
      tipo.value === 'FUNCIONARIO' && opsSub.length === 1 && /MAT-2001/.test(opsSub[0].label), JSON.stringify(opsSub));

    log('\n[3] Sem cadastros ou sem conexão: aviso e nada a registrar');
    tabelas.funcionarios.length = 0;
    dec.value = 'DESIGNOU_SUBSTITUTO';
    dec.dispatchEvent(new w.Event('change'));
    await aguardar(60);
    const av = w.document.getElementById('trailEntidadeAviso');
    check('sem funcionário cadastrado: informa e mantém registro desabilitado',
      reg.disabled === true && !av.classList.contains('hidden') && /funcion/i.test(av.textContent), av.textContent);
    w.close();

    const semBanco = await abrirPainel(dadosBase(), { semSupabase: true });
    const decSB = semBanco.document.getElementById('trailTipoDecisao');
    decSB.value = 'LIBEROU_NAVIO';
    decSB.dispatchEvent(new semBanco.Event('change'));
    await aguardar(40);
    const avSB = semBanco.document.getElementById('trailEntidadeAviso');
    check('sem conexão com o banco: aviso e registro desabilitado',
      semBanco.document.getElementById('trailEntidadeRegistro').disabled === true && /conex/i.test(avSB.textContent), avSB.textContent);
    semBanco.close();
  }

  log('\n[4] Envio do formulário grava a referência real');
  {
    const tabelas = dadosBase();
    const w = await abrirPainel(tabelas);
    const dec = w.document.getElementById('trailTipoDecisao');
    dec.value = 'LIBEROU_NAVIO';
    dec.dispatchEvent(new w.Event('change'));
    await aguardar(60);
    w.document.getElementById('trailEntidadeRegistro').value = 'n-1';
    w.document.getElementById('trailMotivoInput').value = 'Liberação autorizada pelo supervisor';
    w.document.getElementById('registrarTrailForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await aguardar(120);
    const linha = (tabelas.trail_decisoes || [])[0];
    check('gravou uma decisão no banco', !!linha, JSON.stringify(tabelas.trail_decisoes));
    check('entidade_tipo = NAVIO e entidade_id = código real (IMO)',
      linha && linha.entidade_tipo === 'NAVIO' && linha.entidade_id === 'IMO-1234567', JSON.stringify(linha));
    check('detalhes guardam o id do registro', linha && linha.detalhes && linha.detalhes.referencia_id === 'n-1', JSON.stringify(linha && linha.detalhes));
    check('motivo gravado conforme digitado', linha && linha.motivo === 'Liberação autorizada pelo supervisor');
    const local = JSON.parse(w.localStorage.getItem('nexus_trail_decisoes') || '[]');
    check('registro local só existe após a confirmação do banco', local.length === 1 && local[0].dbId === linha.id, JSON.stringify(local));
    check('formulário do painel é fechado após gravar', w.document.getElementById('registrarTrailModal').classList.contains('hidden'));
    w.close();
  }

  log('\n[5] Recusas: incompatível, sem registro válido, falha do banco');
  {
    const tabelas = dadosBase();
    const w = await abrirPainel(tabelas);
    let r = await w.registrarTrailDecisao('LIBEROU_NAVIO', 'CRG-2026-303', 'Teste', { tipo: 'CARGA', id: 'c-1', codigo: 'CRG-2026-303', rotulo: 'x' });
    check('LIBEROU_NAVIO com CARGA é recusado', r.ok === false && /CARGA/.test(r.mensagem), JSON.stringify(r));
    r = await w.registrarTrailDecisao('LIBEROU_NAVIO', '', 'Teste', { tipo: 'NAVIO', id: 'n-1', codigo: '', rotulo: 'x' });
    check('registro sem código é recusado', r.ok === false, JSON.stringify(r));
    check('nenhuma linha foi gravada nas recusas', (tabelas.trail_decisoes || []).length === 0);
    w.close();

    const tabelas2 = dadosBase();
    const w2 = await abrirPainel(tabelas2, { falharInsert: true });
    r = await w2.registrarTrailDecisao('LIBEROU_NAVIO', 'IMO-1234567', 'Teste', { tipo: 'NAVIO', id: 'n-1', codigo: 'IMO-1234567', rotulo: 'x' });
    check('falha do banco: decisão não é registrada', r.ok === false && /banco/i.test(r.mensagem), JSON.stringify(r));
    check('falha do banco: nada fica no registro local', JSON.parse(w2.localStorage.getItem('nexus_trail_decisoes') || '[]').length === 0);
    w2.close();
  }

  log('\n[6] Chamadas legadas (decisao, tabela, id, motivo) preservam o id');
  {
    const tabelas = dadosBase();
    const w = await abrirPainel(tabelas);
    const r = await w.registrarTrailDecisao('SOLICITOU_MANUTENCAO_NAVIO', 'navios', 'n-1', 'Manutenção de casco');
    const linha = (tabelas.trail_decisoes || [])[0];
    check('legado: entidade NAVIO, id no lugar certo e motivo correto',
      r.ok === true && linha && linha.entidade_tipo === 'NAVIO' && linha.entidade_id === 'n-1' && linha.motivo === 'Manutenção de casco', JSON.stringify(linha));
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações de trilha de auditoria passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
