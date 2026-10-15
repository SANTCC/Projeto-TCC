/** Tarefa 8: destinos compatíveis antes de vincular carga/navio, inclusive via contêiner. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const {criarBancoFalso} = require('./fake-supabase-db');
const ID_CARGA='11111111-1111-4111-8111-111111111111';
const ID_NAVIO='22222222-2222-4222-8222-222222222222';
const ID_OUTRO='33333333-3333-4333-8333-333333333333';
const ID_CONT='44444444-4444-4444-8444-444444444444';
const IDENT='MSCU-1234567';
async function abrir({pagina='cargas', destinoCarga='Porto de Roterdã', destinoNavio='Porto de Roterdã', herdado=false}={}) {
  const carga={id:'CRG-TESTE-8',rawDbId:ID_CARGA,status:'ARMAZENAGEM',tipo:'Carga Geral',volume:'10 m³',destino:destinoCarga,container:pagina === 'embarcacoes' ? IDENT : '',navio:''};
  const banco=criarBancoFalso({
    cargas:[{id:ID_CARGA,destino:destinoCarga,status_fluxo:'ARMAZENAGEM',container_id:null,navio_id:null}],
    navios:[{id:ID_NAVIO,nome:'Navio Teste',numero_imo:'IMO-1234567',localizacao:'DENTRO_DO_PORTO',estado_operacional:'OPERANTE',porto_destino:destinoNavio},
      {id:ID_OUTRO,nome:'Outro Navio',numero_imo:'IMO-7654321',localizacao:'DENTRO_DO_PORTO',estado_operacional:'OPERANTE',porto_destino:'Porto de Hamburgo'}],
    containers:[{id:ID_CONT,numero_identificacao:IDENT,estado:'OPERANTE',material_carregado:'Carga Geral',navio_id:herdado ? ID_NAVIO : null}],bercos:[]
  });
  const navios=() => banco.tabelas.navios.map(n => ({...n,imo:n.numero_imo,destino:n.porto_destino}));
  const conts=[{id:ID_CONT,identificacao:IDENT,tipo:'Carga Geral',estado:'OPERANTE',navio_id:herdado ? ID_NAVIO : null}];
  const avisos=[]; let logs=0;
  const j=H.criarJanela({url:`https://nexusport.test/${pagina}.html`,html:H.htmlDaPagina(`${pagina}.html`),session:H.sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage:{nexus_cargas_fluxo:[carga],nexus_navios_list:navios(),nexus_containers_list:conts},
    scripts:['js/security.js','js/session-cookies.js','js/supabase-client.js','js/auth-guard.js','js/padronizacao-codigos.js','js/pages/tipos-carga.js',w => {
      w.currentUserSession=w.NexusAuth.getSession(); w.nexusSupabase=banco;
      w.NexusRepository={getNavios:async () => navios(),getCargas:async () => [{...carga,destino:banco.tabelas.cargas[0].destino}],notifyChange(){}};
      w.registrarLogAlteracao=async () => {logs++;};
      w.mostrarFeedback=(tipo,titulo,msg) => avisos.push({tipo,titulo,msg});
    },`js/pages/${pagina}.js`]});
  await H.prontoDom(j.w); await H.aguardar(80);
  assert.deepEqual(j.erros,[]);
  banco.log.length=0;
  return {w:j.w,j,banco,avisos,logs:() => logs};
}
async function selecionar(w,herdado) {
  await w.abrirModalVinculacao('CRG-TESTE-8');
  const navio=w.document.getElementById('vincularNavioSelect');
  navio.value=herdado ? '' : '0'; navio.dispatchEvent(new w.Event('change'));
  w.document.getElementById('vincularContainerSelect').value=ID_CONT;
}
async function confirmar(w) {w.document.getElementById('confirmVincularModalBtn').click();await H.aguardar(70);}
(async () => {
  for (const herdado of [false,true]) {
    for (const caso of [
      {destinoCarga:'Porto de Santos',ok:false},
      {destinoCarga:'Porto de Roterdã',ok:true},
      {destinoCarga:'  PORTO  DE ROTERDA  ',ok:true},
      {destinoCarga:'Roterdã',ok:false}, // Não inventar equivalências entre cadastros distintos.
      {destinoCarga:'',ok:false},
      {destinoNavio:'',ok:false}
    ]) {
      const {w,banco,avisos,logs}=await abrir({...caso,herdado});
      try {
        await selecionar(w,herdado); await confirmar(w);
        const carga=JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'))[0];
        assert.equal(Boolean(carga.container),caso.ok,JSON.stringify({herdado,...caso}));
        assert.equal(logs(),caso.ok ? 1 : 0);
        if (caso.ok) {
          assert.equal(banco.tabelas.cargas[0].navio_id,ID_NAVIO);
          assert.equal(banco.tabelas.cargas[0].container_id,ID_CONT);
        } else {
          assert.equal(banco.log.length,0,'Divergência não grava carga ou contêiner');
          assert.equal(banco.tabelas.containers[0].navio_id,herdado ? ID_NAVIO : null);
          assert.ok(avisos.some(a => a.titulo === 'Destinos Incompatíveis'));
        }
      } finally {w.close();}
    }
  }
  // Destino do navio alterado depois de abrir a seleção.
  {
    const {w,banco}=await abrir();
    try {
      await selecionar(w,false);
      banco.tabelas.navios[0].porto_destino='Porto de Hamburgo';
      await confirmar(w); assert.equal(banco.log.length,0);
    } finally {w.close();}
  }
  // O contêiner passou a pertencer a outro navio: não usar o vínculo antigo do modal.
  {
    const {w,banco}=await abrir({herdado:true});
    try {
      await selecionar(w,true);
      banco.tabelas.containers[0].navio_id=ID_OUTRO;
      await confirmar(w); assert.equal(banco.log.length,0);
    } finally {w.close();}
  }
  // Destino da carga atualizado enquanto o modal estava aberto.
  {
    const {w,banco}=await abrir();
    try {
      await selecionar(w,false);
      banco.tabelas.cargas[0].destino='Porto de Hamburgo';
      w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'cargas'}}));
      await H.aguardar(170); await confirmar(w); assert.equal(banco.log.length,0);
    } finally {w.close();}
  }
  // Contêiner sem navio continua podendo receber carga: ainda não há vínculo marítimo.
  {
    const {w,banco}=await abrir();
    try {
      await selecionar(w,true); await confirmar(w);
      assert.equal(banco.tabelas.cargas[0].container_id,ID_CONT);
      assert.equal(banco.tabelas.cargas[0].navio_id,null);
    } finally {w.close();}
  }
  // Caminho inverso: um contêiner com carga não pode ser atribuído a destino divergente.
  for (const destinoCarga of ['Porto de Santos','PORTO DE ROTERDA']) {
    const {w,banco,avisos}=await abrir({pagina:'embarcacoes',destinoCarga});
    try {
      await w.vincularContainerANavio(IDENT,{navioImo:'IMO-1234567',confirmado:true});
      const ok=destinoCarga === 'PORTO DE ROTERDA';
      assert.equal(banco.tabelas.containers[0].navio_id,ok ? ID_NAVIO : null);
      if (!ok) {assert.equal(banco.log.length,0);assert.ok(avisos.some(a => a.titulo === 'Destinos Incompatíveis'));}
    } finally {w.close();}
  }
  // WebMCP recusa destino herdado incompatível antes de solicitar confirmação.
  {
    const {w}=await abrir({herdado:true,destinoCarga:'Porto de Santos'});
    try {
      let ferramentas;
      w.NexusWebMCP={registrarPagina:p => {ferramentas=p.ferramentas;}};
      w.NexusWebMCPDados={GRUPOS:{todos:[],supervisao:[]},quandoPronto:f => f(),
        cargasDoOperador:async () => JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')),
        containers:() => JSON.parse(w.localStorage.getItem('nexus_containers_list')),navios:() => w.NexusRepository.getNavios()};
      w.eval(H.read('js/webmcp/webmcp-cargas.js'));
      const f=ferramentas.find(t => t.nome === 'vincular_carga_container');
      assert.equal((await f.precondicao({id:'CRG-TESTE-8',container:IDENT})).codigo,'DESTINOS_INCOMPATIVEIS');
    } finally {w.close();}
  }
  console.log('✅ Tarefa 8: destinos explícitos/herdados, normalização, dados alterados após abertura, WebMCP e vínculo inverso.');
})().catch(e => {console.error(e);process.exit(1);});
