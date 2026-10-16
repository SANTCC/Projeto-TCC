#!/usr/bin/env node
/**
 * Regressão — Tarefa 6 (Correções): cadastro de visitante com mesmo nome e CPF
 * deve ser aceito como a MESMA pessoa (Gestão de Pessoas → técnico_portos.html).
 *
 * Regras validadas (substituem o bloqueio C14 antigo, que recusava qualquer
 * documento repetido):
 *  • CPF igual (comparado apenas pelos dígitos) + nome idêntico (ignorando
 *    caixa e espaços extras) ⇒ ACEITO sem erro de duplicidade e sem criar
 *    registro conflitante: a visita em andamento é reaproveitada; se a visita
 *    anterior estiver concluída, uma NOVA visita é aberta para a pessoa.
 *  • CPF igual + nome diferente (mesmo que minimamente) ⇒ RECUSADO com
 *    mensagem clara de que o CPF já está cadastrado com outro nome.
 *  • CPF novo ⇒ cadastro normal, sem mudanças.
 *
 * Cenários:
 *  S1. CPF novo → cadastro normal (1 registro, feedback de sucesso padrão).
 *  S2. Mesmo CPF + mesmo nome com visita EM ANDAMENTO → aceito, reaproveita o
 *      registro (sem duplicar), motivo/data atualizados.
 *  S3. Mesmo CPF + nome variando apenas caixa/espaços extras → mesma pessoa.
 *  S4. Mesmo CPF + nome diferente → recusado (mensagem cita o CPF e o outro
 *      nome), nenhum registro criado/alterado.
 *  S5. Mesmo CPF + mesmo nome com visita CONCLUÍDA → aceito abrindo nova
 *      visita (histórico preservado: 1 concluída + 1 ativa).
 *  S6. Com Supabase: (a) CPF já registrado com outro nome → recusado;
 *      (b) visita ativa só no banco (espelho local vazio) → reaproveitada por
 *      id, SEM inserir linha duplicada; (c) pessoa com visita concluída no
 *      banco → nova visita inserida normalmente.
 *  S7. Documento inválido (≠ 11 dígitos) continua recusado (validação atual).
 *  S8. Nenhum erro de runtime nas janelas.
 *
 * Executar: node tests/test_visitante_mesmo_cpf_nome.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CPF_MARIA = '123.456.789-09';   // dígitos: 12345678909
const CPF_JOAO = '987.654.321-00';    // dígitos: 98765432100
const CPF_ANA = '555.444.333-22';     // dígitos: 55544433322

function scriptsDaPagina(banco) {
  return [
    'js/security.js',
    'js/session-cookies.js',
    'js/auth-guard.js',
    (win) => {
      win.currentUserSession = win.NexusAuth.getSession();
      if (banco) win.nexusSupabase = banco;
    },
    'js/vision-layer.js',
    'js/layout.js',
    'js/pages/tecnico_portos.js'
  ];
}

async function abrirPagina({ vis = [], banco = null } = {}) {
  const j = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: htmlDaPagina('tecnico_portos.html'),
    session: sessao('TECNICO_PORTOS'),
    storage: {
      nexus_vis_list: vis,
      nexus_func_list: [],
      nexus_code_overrides: {},
      nexus_audit_logs: []
    },
    scripts: scriptsDaPagina(banco)
  });
  await prontoDom(j.w);
  await aguardar(120);
  const feedbacks = [];
  j.w.mostrarFeedback = (tipo, titulo, msg) => feedbacks.push({ tipo, titulo, msg });
  j.feedback = feedbacks;
  j.lerVis = () => JSON.parse(j.w.localStorage.getItem('nexus_vis_list') || '[]');
  return j;
}

async function submeterVisita(j, { nome, documento, motivo }) {
  const d = j.w.document;
  d.getElementById('visNome').value = nome;
  d.getElementById('visDocumento').value = documento;
  d.getElementById('visMotivo').value = motivo;
  j.feedback.length = 0;
  d.getElementById('visCrudForm').dispatchEvent(new j.w.Event('submit', { bubbles: true, cancelable: true }));
  await aguardar(180);
}

const ultimoFeedback = (j) => j.feedback[j.feedback.length - 1] || { tipo: '', titulo: '', msg: '' };

function visitaMaria(overrides) {
  return Object.assign({
    id: 'VIS-1001', nome: 'Maria Silva', documento: '12345678909',
    motivo: 'Reunião anterior', status: 'EM_VISITA', data: '01/10/2026 08:00:00',
    data_saida: null, vistoria: null, por: 'MAT-1001'
  }, overrides || {});
}

async function main() {
  log('\n[Tarefa 6] Cadastro de visitante: mesmo CPF + mesmo nome = mesma pessoa\n');

  // ---------- S1: CPF novo → cadastro normal --------------------------------
  log('S1. CPF nunca cadastrado segue o fluxo normal');
  let j = await abrirPagina();
  await submeterVisita(j, { nome: 'Maria Silva', documento: CPF_MARIA, motivo: 'Reunião técnica' });
  let vis = j.lerVis();
  check('S1: visitante novo é criado (1 registro, EM_VISITA)',
    vis.length === 1 && vis[0].nome === 'Maria Silva' && vis[0].status === 'EM_VISITA' && vis[0].data_saida === null,
    JSON.stringify(vis).slice(0, 200));
  check('S1: feedback de sucesso com mensagem padrão (sem menção a duplicidade/mesma pessoa)',
    ultimoFeedback(j).tipo === 'sucesso' && /registrada com sucesso/.test(ultimoFeedback(j).msg) &&
    !/mesma pessoa|já cadastrado/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S1: formulário é limpo e fechado após o cadastro',
    j.w.document.getElementById('visNome').value === '' &&
    j.w.document.getElementById('visCrudForm').classList.contains('hidden'));
  check('S8: S1 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S2: mesmo CPF + mesmo nome (visita ativa) → aceito -------------
  log('\nS2. Mesmo CPF + mesmo nome com visita em andamento: aceito sem duplicar');
  j = await abrirPagina({ vis: [visitaMaria()] });
  await submeterVisita(j, { nome: 'Maria Silva', documento: CPF_MARIA, motivo: 'Nova reunião' });
  vis = j.lerVis();
  check('S2: cadastro aceito (feedback de sucesso, sem erro de duplicidade)',
    ultimoFeedback(j).tipo === 'sucesso' && /mesma pessoa/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S2: NÃO cria registro conflitante (continua 1 visita, mesma id)',
    vis.length === 1 && vis[0].id === 'VIS-1001', JSON.stringify(vis).slice(0, 200));
  check('S2: visita ativa reaproveitada com motivo atualizado e status EM_VISITA',
    vis[0].motivo === 'Nova reunião' && vis[0].status === 'EM_VISITA' && vis[0].data_saida === null);
  check('S8: S2 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S3: mesmo CPF + nome com caixa/espaços diferentes --------------
  log('\nS3. Variações apenas de caixa e espaços extras no nome = mesma pessoa');
  j = await abrirPagina({ vis: [visitaMaria()] });
  await submeterVisita(j, { nome: '   maria    SILVA ', documento: CPF_MARIA, motivo: 'Retorno' });
  vis = j.lerVis();
  check('S3: aceito como mesma pessoa (1 registro, sucesso)',
    vis.length === 1 && ultimoFeedback(j).tipo === 'sucesso' && /mesma pessoa/i.test(ultimoFeedback(j).msg),
    ultimoFeedback(j).msg);
  check('S8: S3 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S4: mesmo CPF + nome diferente → recusado ----------------------
  log('\nS4. Mesmo CPF com nome diferente: recusado com mensagem clara');
  j = await abrirPagina({ vis: [visitaMaria()] });
  await submeterVisita(j, { nome: 'Maria Santos', documento: CPF_MARIA, motivo: 'Outra pessoa?' });
  vis = j.lerVis();
  check('S4: recusado com feedback de atenção (bloqueio de segurança)',
    ultimoFeedback(j).tipo === 'atencao' && /BLOQUEIO DE SEGURANÇA|C14/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S4: mensagem explica que o CPF já está cadastrado com OUTRO nome (cita o nome existente)',
    /já está cadastrado/i.test(ultimoFeedback(j).msg) && /outro visitante/i.test(ultimoFeedback(j).msg) &&
    /Maria Silva/.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S4: nenhum registro criado ou alterado (1 visita intacta)',
    vis.length === 1 && vis[0].nome === 'Maria Silva' && vis[0].motivo === 'Reunião anterior',
    JSON.stringify(vis).slice(0, 200));
  check('S8: S4 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S5: mesma pessoa, visita concluída → nova visita ---------------
  log('\nS5. Mesma pessoa com visita CONCLUÍDA: nova visita aceita (histórico preservado)');
  j = await abrirPagina({
    vis: [visitaMaria({ status: 'CONCLUIDO', data_saida: '01/10/2026 18:00:00', vistoria: 'Vistoria em Ordem - Sem Anormalidades' })]
  });
  await submeterVisita(j, { nome: 'Maria Silva', documento: CPF_MARIA, motivo: 'Segunda visita' });
  vis = j.lerVis();
  check('S5: aceito sem erro de duplicidade (sucesso, pessoa já cadastrada)',
    ultimoFeedback(j).tipo === 'sucesso' && /pessoa já cadastrada/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S5: nova visita EM_VISITA criada ao lado do histórico CONCLUIDO',
    vis.length === 2 && vis[0].status === 'CONCLUIDO' && vis[0].data_saida === '01/10/2026 18:00:00' &&
    vis[1].status === 'EM_VISITA' && vis[1].motivo === 'Segunda visita' && vis[1].data_saida === null,
    JSON.stringify(vis).slice(0, 240));
  check('S8: S5 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S6a: banco tem o CPF com outro nome → recusado -----------------
  log('\nS6. Validação também contra o banco (Supabase)');
  let banco = criarBancoFalso({
    visitantes: [{ id: UUID(601), nome: 'João Souza', documento: '98765432100', motivo: 'Vistoria', data_hora_entrada: '2026-10-14T10:00:00Z', data_hora_saida: null }]
  });
  j = await abrirPagina({ banco });
  await aguardar(120);
  await submeterVisita(j, { nome: 'Pedro Alves', documento: CPF_JOAO, motivo: 'Tentativa indevida' });
  vis = j.lerVis();
  check('S6a: mesmo CPF do banco com nome diferente é recusado',
    ultimoFeedback(j).tipo === 'atencao' && /outro visitante/i.test(ultimoFeedback(j).msg) && /João Souza/.test(ultimoFeedback(j).msg),
    ultimoFeedback(j).msg);
  check('S6a: nada é inserido no banco nem na lista local',
    banco.tabelas.visitantes.length === 1 && vis.length === 1 && vis[0].nome === 'João Souza');
  check('S8: S6a sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S6b: visita ativa SÓ no banco → reaproveitada, sem duplicar ----
  banco = criarBancoFalso({ visitantes: [] });
  j = await abrirPagina({ banco });
  await aguardar(120);
  // Linha registrada em outro dispositivo DEPOIS da carga da página (espelho
  // local desatualizado): só a consulta ao banco pode detectar a mesma pessoa.
  banco.tabelas.visitantes.push({
    id: UUID(602), nome: 'Ana Lima', documento: CPF_ANA, motivo: 'Inspeção',
    data_hora_entrada: '2026-10-15T09:00:00Z', data_hora_saida: null
  });
  banco.log.length = 0;
  await submeterVisita(j, { nome: 'ana LIMA', documento: CPF_ANA, motivo: 'Continuação da inspeção' });
  vis = j.lerVis();
  check('S6b: aceita como mesma pessoa (sucesso)',
    ultimoFeedback(j).tipo === 'sucesso' && /mesma pessoa/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S6b: NÃO insere linha duplicada no banco — atualiza a visita ativa existente',
    banco.tabelas.visitantes.length === 1 && banco.tabelas.visitantes[0].id === UUID(602) &&
    banco.tabelas.visitantes[0].motivo === 'Continuação da inspeção' &&
    banco.log.some((e) => e.tabela === 'visitantes' && e.op === 'update') &&
    !banco.log.some((e) => e.tabela === 'visitantes' && e.op === 'upsert'),
    JSON.stringify(banco.log).slice(0, 220));
  check('S6b: registro local criado a partir do banco mantém a mesma id (sem conflito)',
    vis.length === 1 && vis[0].id === UUID(602) && vis[0].status === 'EM_VISITA', JSON.stringify(vis).slice(0, 200));
  check('S8: S6b sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S6c: pessoa com visita concluída no banco → nova visita --------
  banco = criarBancoFalso({
    visitantes: [{
      id: UUID(603), nome: 'Maria Silva', documento: '12345678909', motivo: 'Visita antiga',
      data_hora_entrada: '2026-09-20T09:00:00Z', data_hora_saida: '2026-09-20T17:00:00Z'
    }]
  });
  j = await abrirPagina({ banco });
  await aguardar(120);
  banco.log.length = 0;
  await submeterVisita(j, { nome: 'MARIA SILVA', documento: CPF_MARIA, motivo: 'Nova visita ao terminal' });
  vis = j.lerVis();
  check('S6c: mesma pessoa aceita sem duplicidade (sucesso, nova visita)',
    ultimoFeedback(j).tipo === 'sucesso' && /pessoa já cadastrada/i.test(ultimoFeedback(j).msg), ultimoFeedback(j).msg);
  check('S6c: nova linha inserida no banco (visita antiga preservada)',
    banco.tabelas.visitantes.length === 2 &&
    banco.tabelas.visitantes[0].data_hora_saida === '2026-09-20T17:00:00Z' &&
    banco.log.some((e) => e.tabela === 'visitantes' && e.op === 'upsert'),
    JSON.stringify(banco.tabelas.visitantes.map((v) => v.motivo)));
  check('S6c: lista local tem histórico + nova visita ativa',
    vis.length === 2 && vis[1].status === 'EM_VISITA' && vis[1].motivo === 'Nova visita ao terminal');
  check('S8: S6c sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  // ---------- S7: documento inválido continua recusado -----------------------
  log('\nS7. Validação de documento (11 dígitos) permanece intacta');
  j = await abrirPagina({ vis: [visitaMaria()] });
  await submeterVisita(j, { nome: 'Maria Silva', documento: '123', motivo: 'CPF incompleto' });
  check('S7: documento com menos de 11 dígitos é recusado (mensagem atual)',
    ultimoFeedback(j).tipo === 'atencao' && /DOCUMENTO DO VISITANTE INVÁLIDO/i.test(ultimoFeedback(j).msg) &&
    j.lerVis().length === 1 && j.lerVis()[0].motivo === 'Reunião anterior', ultimoFeedback(j).msg);
  check('S8: S7 sem erros de runtime', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 6 (visitante com mesmo nome e CPF aceito como mesma pessoa) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
