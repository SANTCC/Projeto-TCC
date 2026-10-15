/** Tarefa 3: permissões do Planejador nas páginas reais, sem rede. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
async function abrir(pagina, storage = {}, extras = []) {
  const j = H.criarJanela({url:`https://nexusport.test/${pagina}.html`, html:H.htmlDaPagina(`${pagina}.html`), session:H.sessao('PLANEJADOR_PATIO_NAVIOS'), storage,
    scripts:['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/padronizacao-codigos.js', w => {
      w.currentUserSession = w.NexusAuth.getSession();
      w.NexusRepository = {getNavios:async () => [{id:'nav-1', nome:'Navio Teste', localizacao:'DENTRO_DO_PORTO'}]};
    }, `js/pages/${pagina}.js`, ...extras]});
  await H.prontoDom(j.w); await H.aguardar(100);
  assert.deepEqual(j.erros, [], pagina);
  return j.w;
}
(async () => {
  const d = await abrir('dashboard');
  for (const p of ['dashboard','embarcacoes','manutencao']) assert.equal(d.NexusAuth.canAccessPage(`${p}.html`),true,p);
  for (const p of ['cargas','scanner','inspecao','delegacao','tecnico_portos','relatorios','seguranca','teste-vibracao','desconhecida']) assert.equal(d.NexusAuth.canAccessPage(`${p}.html`),false,p);
  assert.equal(d.NexusAuth.hasPermission('SOLICITAR_MANUTENCAO'),true);
  assert.equal(d.NexusAuth.hasPermission('APROVAR_MANUTENCAO'),false);
  assert.ok(d.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'));
  d.document.getElementById('toggleRegistrarTrailBtn').click();
  assert.ok(d.document.getElementById('registrarTrailModal').classList.contains('hidden'));
  d.document.getElementById('registrarTrailForm').dispatchEvent(new d.Event('submit',{cancelable:true}));
  assert.equal(d.localStorage.getItem('nexus_trail_decisoes'),null);
  d.close();

  const storage = {nexus_guindastes_list:[{identificacao:'ABC-123-DEF',estado:'OPERANTE'}], nexus_guindaste_tarefas:[{id:'TRF-1',guindasteId:'ABC-123-DEF',cargaId:'CRG-1',destino:'Setor B'}]};
  const e = await abrir('embarcacoes', storage);
  assert.ok(e.document.getElementById('embarcacoesGpsTableBody'));
  assert.ok(e.document.getElementById('containersTableBody'));
  assert.equal(e.document.getElementById('guindastesTableBody'),null);
  assert.equal(e.document.getElementById('guindasteForm'),null);
  assert.equal(e.document.getElementById('tarefasGuindasteModal'),null);
  await e.excluirGuindaste('ABC-123-DEF',{confirmado:true});
  await e.exibirTarefasGuindaste('ABC-123-DEF');
  await e.concluirTarefaGuindaste('TRF-1',{confirmado:true});
  assert.equal(JSON.parse(e.localStorage.getItem('nexus_guindastes_list')).length,1);
  assert.equal(JSON.parse(e.localStorage.getItem('nexus_guindaste_tarefas')).length,1);
  // As ferramentas de leitura também não devem expor guindastes ao Planejador.
  let definicoes;
  e.NexusWebMCP = {registrarPagina:p => {definicoes=p.ferramentas;}};
  e.NexusWebMCPDados = {GRUPOS:{gestaoOperacional:[], supervisao:[], inspecao:[], direcao:[]}, quandoPronto:f => f()};
  e.eval(H.read('js/webmcp/webmcp-embarcacoes.js'));
  for (const nome of ['listar_guindastes','listar_tarefas_guindaste']) assert.ok(!definicoes.find(f => f.nome === nome).cargos.includes('PLANEJADOR_PATIO_NAVIOS'));
  e.close();

  const m = await abrir('manutencao', {...storage, nexus_containers_list:[{identificacao:'CONT-1'}], nexus_os_list:[{id:'OS-EXISTENTE',equipamento:'Contêiner CONT-2',status:'PENDENTE_APROVACAO'}]});
  const ler = () => JSON.parse(m.localStorage.getItem('nexus_os_list'));
  assert.ok(m.document.getElementById('navioManutForm'));
  assert.ok(m.document.querySelector('#osEquipamento option[value="Contêiner CONT-1"]'));
  assert.equal(m.document.querySelector('#osEquipamento optgroup[label="Guindastes & Pórticos"]'),null);
  assert.equal(m.document.querySelector('[onclick*="executarAcaoOS"]'),null);
  await m.solicitarManutencaoGuindaste('ABC-123-DEF',{descricao:'Indevido'});
  await m.concluirManutencaoGuindaste('ABC-123-DEF',{confirmado:true});
  for (const acao of ['APROVAR','REPROVAR','CONCLUIR']) await m.executarAcaoOS('OS-EXISTENTE',acao);
  assert.equal(ler().length,1);
  assert.equal(ler()[0].status,'PENDENTE_APROVACAO');
  const select=m.document.getElementById('osEquipamento');
  const opt=m.document.createElement('option'); opt.value='Guindaste ABC-123-DEF'; select.append(opt); select.value=opt.value;
  m.document.getElementById('osDescricao').value='Tentativa de guindaste';
  m.document.getElementById('osForm').dispatchEvent(new m.Event('submit',{cancelable:true}));
  assert.equal(ler().length,1,'opção forçada não pode criar OS de guindaste');
  select.value='Contêiner CONT-1';
  m.document.getElementById('osForm').dispatchEvent(new m.Event('submit',{cancelable:true}));
  assert.equal(ler().length,2);
  assert.equal(ler()[1].equipamento,'Contêiner CONT-1');
  assert.equal(ler()[1].status,'PENDENTE_APROVACAO');
  m.document.getElementById('navioManutSelect').value='Navio Teste';
  m.document.getElementById('navioTipoManutSelect').value='CORRETIVA';
  m.document.getElementById('navioDescManut').value='Reparo de casco';
  m.document.getElementById('navioManutForm').dispatchEvent(new m.Event('submit',{cancelable:true}));
  assert.equal(ler().length,3);
  assert.equal(ler()[0].equipamento,'Navio Navio Teste');
  assert.equal(ler()[0].status,'PENDENTE_APROVACAO');
  m.close();
  console.log('✅ Tarefa 3: rotas, bloqueio de guindastes, decisões manuais e pedidos apenas de navios/contêineres.');
})().catch(e => {console.error(e);process.exit(1);});
