/** Regressão da tarefa 2: páginas reais e ações do Arrumador, sem rede. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
async function abrir(pagina, storage = {}, cargo = 'ARRUMADOR_CONSERTADOR') {
  const j = H.criarJanela({url: `https://nexusport.test/${pagina}.html`, html: H.htmlDaPagina(`${pagina}.html`), session: H.sessao(cargo), storage,
    scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/padronizacao-codigos.js', w => {
      w.currentUserSession = w.NexusAuth.getSession();
      w.nexusConfirm = async () => true;
    }, `js/pages/${pagina}.js`]});
  await H.prontoDom(j.w); await H.aguardar(80);
  assert.deepEqual(j.erros, [], `Erros na página ${pagina}`);
  return j.w;
}
(async () => {
  const d = await abrir('dashboard');
  for (const p of ['dashboard', 'cargas', 'manutencao']) assert.equal(d.NexusAuth.canAccessPage(`${p}.html`), true);
  for (const p of ['scanner', 'embarcacoes', 'inspecao', 'relatorios', 'delegacao', 'tecnico_portos', 'seguranca', 'teste-vibracao', 'desconhecida']) assert.equal(d.NexusAuth.canAccessPage(`${p}.html`), false, p);
  assert.equal(d.NexusAuth.hasPermission('SOLICITAR_MANUTENCAO'), false);
  assert.equal(d.NexusAuth.hasPermission('APROVAR_MANUTENCAO'), true);
  assert.ok(d.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'));
  d.document.getElementById('toggleRegistrarTrailBtn').click();
  assert.ok(d.document.getElementById('registrarTrailModal').classList.contains('hidden'));
  d.document.getElementById('registrarTrailForm').dispatchEvent(new d.Event('submit', {cancelable:true}));
  assert.equal(d.localStorage.getItem('nexus_trail_decisoes'), null);
  d.close();

  const ordens = [{id:'OS-1', equipamento:'Guindaste ABC-123-DEF', status:'PENDENTE_APROVACAO'}, {id:'OS-2', equipamento:'Contêiner CONT-1', status:'PENDENTE_APROVACAO'}];
  const m = await abrir('manutencao', {nexus_os_list:ordens, nexus_guindastes_list:[{identificacao:'ABC-123-DEF', estado:'OPERANTE'}]});
  const ler = () => JSON.parse(m.localStorage.getItem('nexus_os_list'));
  assert.equal(m.document.getElementById('navioManutForm'), null);
  assert.equal(m.document.getElementById('osForm'), null);
  assert.ok(m.document.getElementById('toggleOsFormBtn').classList.contains('hidden'));
  await m.solicitarManutencaoGuindaste('ABC-123-DEF', {descricao:'Pedido indevido'});
  assert.equal(ler().length, 2);
  await m.executarAcaoOS('OS-1', 'CONCLUIR');
  assert.equal(ler()[0].status, 'PENDENTE_APROVACAO');
  m.nexusConfirm = async () => false;
  await m.executarAcaoOS('OS-1', 'APROVAR');
  assert.equal(ler()[0].status, 'PENDENTE_APROVACAO');
  m.nexusConfirm = async () => true;
  await m.executarAcaoOS('OS-1', 'APROVAR');
  assert.equal(ler()[0].status, 'EM_MANUTENCAO');
  await m.executarAcaoOS('OS-1', 'REPROVAR');
  assert.equal(ler()[0].status, 'EM_MANUTENCAO');
  await m.executarAcaoOS('OS-1', 'CONCLUIR');
  assert.equal(ler()[0].status, 'CONCLUIDA');
  await m.executarAcaoOS('OS-2', 'REPROVAR');
  assert.equal(ler()[1].status, 'REPROVADA');
  await m.executarAcaoOS('OS-2', 'APROVAR');
  assert.equal(ler()[1].status, 'REPROVADA');
  assert.equal(ler().length, 2);
  m.close();

  // Backlog Parte 2 — Tarefa 9: "pronta" também exige a movimentação física
  // concluída até o contêiner (portoDescarga = "Contêiner CONT-1").
  const base = {id:'CRG-1', status:'ARMAZENAGEM', container:'CONT-1', portoDescarga:'Contêiner CONT-1', navio:'Navio Teste', resultadoInspecao:'APROVADA'};
  for (const mudanca of [{status:'AGENDAMENTO'}, {status:'RECEBIMENTO_INSPECAO'}, {status:'RECUSADA'}, {status:'EM_TRANSITO'}, {container:''}, {navio:''}, {movimentacaoPendente:{destino:'Setor B'}}, {resultadoInspecao:'RECUSADA'}, {}]) {
    const c = {...base, ...mudanca};
    const w = await abrir('cargas', {nexus_cargas_fluxo:[c]});
    const permitido = Object.keys(mudanca).length === 0;
    const btn = w.document.querySelector('#cargasTableBody [aria-label="Marcar como pronta"]');
    assert.equal(Boolean(btn), permitido, JSON.stringify(mudanca));
    await w.executarAcaoCarga(c.id, 'PRONTA');
    assert.equal(JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'))[0].status, permitido ? 'PRONTA_PARA_ENTREGA' : c.status);
    w.close();
  }
  const t = await abrir('cargas', {nexus_cargas_fluxo:[base], nexus_guindaste_tarefas:[{id:'TRF-1', cargaId:base.id}]});
  assert.equal(t.document.querySelector('#cargasTableBody [aria-label="Marcar como pronta"]'), null);
  await t.executarAcaoCarga(base.id, 'PRONTA');
  assert.equal(JSON.parse(t.localStorage.getItem('nexus_cargas_fluxo'))[0].status, 'ARMAZENAGEM');
  t.close();
  console.log('✅ Tarefa 2: rotas exclusivas, decisões manuais, ciclo de OS, confirmação e pré-requisitos de Pronta.');
})().catch(e => {console.error(e); process.exit(1);});
