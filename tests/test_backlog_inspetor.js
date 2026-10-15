/** Tarefa 5: mesma validação de Pronta na interface, ação e pré-condição WebMCP. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const base = {id:'CRG-TESTE-5', status:'ARMAZENAGEM', container:'CONT-1', navio:'Navio Teste', resultadoInspecao:'APROVADA'};

async function abrir(carga, extras = {}, cargo = 'INSPETOR') {
  const j = H.criarJanela({
    url:'https://nexusport.test/cargas.html', html:H.htmlDaPagina('cargas.html'),
    session:H.sessao(cargo), storage:{nexus_cargas_fluxo:[carga], ...extras},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',
      w => {w.currentUserSession = w.NexusAuth.getSession();}, 'js/pages/cargas.js']
  });
  await H.prontoDom(j.w); await H.aguardar(50);
  assert.deepEqual(j.erros, [], 'Página sem erros de execução');
  const w = j.w;
  let ferramentas;
  const lista = chave => JSON.parse(w.localStorage.getItem(chave) || '[]');
  w.NexusWebMCP = {registrarPagina:p => {ferramentas = p.ferramentas;}};
  w.NexusWebMCPDados = {
    GRUPOS:{todos:[cargo]}, quandoPronto:f => f(),
    cargasDoOperador:async () => lista('nexus_cargas_fluxo'), lerLista:lista
  };
  w.eval(H.read('js/webmcp/webmcp-cargas.js'));
  const gravacoes = [];
  let logs = 0;
  w.registrarLogAlteracao = async () => {logs++;};
  w.nexusSupabase = {from:tabela => ({update:payload => ({eq:async () => {
    gravacoes.push({tabela,payload}); return {error:null};
  }})})};
  return {w, j, ferramenta:ferramentas.find(f => f.nome === 'marcar_pronta_entrega'), gravacoes, logs:() => logs};
}

(async () => {
  const casos = [
    ...['AGENDAMENTO','RECEBIMENTO_INSPECAO','RECUSADA','CANCELADA','EM_TRANSITO','ENTREGUE','PRONTA_PARA_ENTREGA'].map(status => ({nome:status, mudanca:{status}})),
    {nome:'sem contêiner', mudanca:{container:''}},
    {nome:'sem navio', mudanca:{navio:''}},
    {nome:'movimentação pendente na carga', mudanca:{movimentacaoPendente:{destino:'Setor B'}}},
    {nome:'tarefa de guindaste pendente', extras:{nexus_guindaste_tarefas:[{id:'TRF-5', cargaId:base.id}]}},
    {nome:'inspeção recusada', mudanca:{resultadoInspecao:'RECUSADA'}},
    {nome:'inspeção pendente', mudanca:{resultadoInspecao:'PENDENTE'}},
    {nome:'inspeção recusada no formato do banco', mudanca:{resultadoInspecao:undefined, resultado_inspecao:'RECUSADA'}},
    {nome:'etapas concluídas', permitido:true},
    {nome:'vínculos por IDs', mudanca:{container:'', navio:'', container_id:'cont-id', navio_id:'nav-id'}, permitido:true},
    {nome:'navioId no modelo do repositório', mudanca:{navio:'', navioId:'nav-id'}, permitido:true},
    {nome:'ARMAZENAGEM legada sem campo de resultado', mudanca:{resultadoInspecao:undefined}, permitido:true},
    {nome:'tarefa de outra carga não bloqueia', extras:{nexus_guindaste_tarefas:[{id:'TRF-OUTRA', cargaId:'CRG-OUTRA'}]}, permitido:true}
  ];
  for (const caso of casos) {
    const carga = {...base, ...caso.mudanca};
    const {w,j,ferramenta,gravacoes,logs} = await abrir(carga, caso.extras);
    try {
      const permitido = Boolean(caso.permitido);
      assert.equal(Boolean(w.document.querySelector('#cargasTableBody [aria-label="Marcar como pronta"]')), permitido, caso.nome);
      const motivo = await ferramenta.precondicao({id:carga.id});
      assert.equal(motivo === null, permitido, `WebMCP: ${caso.nome}`);
      await w.executarAcaoCarga(carga.id,'PRONTA');
      const salva = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'))[0];
      assert.equal(salva.status, permitido ? 'PRONTA_PARA_ENTREGA' : carga.status, `Ação: ${caso.nome}`);
      assert.equal(gravacoes.length, permitido ? 1 : 0, `Gravação: ${caso.nome}`);
      assert.equal(logs(), permitido ? 1 : 0, `Auditoria: ${caso.nome}`);
      if (permitido) assert.equal(gravacoes[0].payload.status_fluxo,'PRONTA_PARA_ENTREGA');
      assert.deepEqual(j.erros, [], caso.nome);
    } finally {w.close();}
  }
  console.log(`✅ Tarefa 5: ${casos.length} cenários de interface, ação direta, WebMCP, gravação e auditoria aprovados.`);
})().catch(e => {console.error(e); process.exit(1);});
