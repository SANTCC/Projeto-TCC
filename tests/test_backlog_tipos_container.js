/** Tarefa 10: catálogo compartilhado, cadastro controlado e compatibilidade antes do vínculo. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const {criarBancoFalso} = require('./fake-supabase-db');
const T_VIVA='11111111-1111-4111-8111-111111111111';
const T_GERAL='22222222-2222-4222-8222-222222222222';
const C_VIVA='33333333-3333-4333-8333-333333333333';
const C_GERAL='44444444-4444-4444-8444-444444444444';
const C_DESCONHECIDO='55555555-5555-4555-8555-555555555555';
async function abrir(pagina) {
  const carga={id:'CRG-TESTE-10',rawDbId:'66666666-6666-4666-8666-666666666666',status:'ARMAZENAGEM',tipo:'Texto descritivo que não é o tipo',tipo_carga_id:T_VIVA,volume:'10 m³',container:'',navio:''};
  const banco=criarBancoFalso({
    tipos_carga:[{id:T_VIVA,nome:'Carga Viva'},{id:T_GERAL,nome:'Carga Geral'}],
    containers:[{id:C_VIVA,numero_identificacao:'VIVA-1234567',tipo_carga_id:T_VIVA,material_carregado:'Carga Viva',estado:'OPERANTE',navio_id:null},
      {id:C_GERAL,numero_identificacao:'GERA-1234567',tipo_carga_id:T_GERAL,material_carregado:'Carga Geral',estado:'OPERANTE',navio_id:null},
      {id:C_DESCONHECIDO,numero_identificacao:'VAZI-1234567',material_carregado:null,estado:'OPERANTE',navio_id:null}],
    cargas:[{id:carga.rawDbId,tipo_carga_id:T_VIVA,natureza:'Animais vivos',status_fluxo:'ARMAZENAGEM',qr_code_url:'QR-CRG-TESTE-10'}],navios:[],bercos:[]
  });
  const avisos=[];
  const j=H.criarJanela({url:`https://nexusport.test/${pagina}.html`,html:H.htmlDaPagina(`${pagina}.html`),session:H.sessao(pagina === 'embarcacoes' ? 'INSPETOR' : 'SUPERVISOR_GERENTE_OPERACOES'),
    storage:{nexus_cargas_fluxo:[carga]},
    scripts:['js/security.js','js/session-cookies.js','js/supabase-client.js','js/auth-guard.js','js/padronizacao-codigos.js','js/pages/tipos-carga.js',w => {
      w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=banco;
      w.NexusRepository={getNavios:async () => [],getCargas:async () => [{...carga}],notifyChange(){}};
      w.mostrarFeedback=(tipo,titulo,msg) => avisos.push({tipo,titulo,msg});
    },`js/pages/${pagina}.js`]});
  await H.prontoDom(j.w);await H.aguardar(90);
  assert.deepEqual(j.erros,[]);banco.log.length=0;
  return {w:j.w,j,banco,carga,avisos};
}
const opcoes=s => Array.from(s.options).map(o => o.value);
async function selecionar(w,id) {await w.abrirModalVinculacao('CRG-TESTE-10');w.document.getElementById('vincularContainerSelect').value=id;}
async function confirmar(w) {w.document.getElementById('confirmVincularModalBtn').click();await H.aguardar(70);}
(async () => {
  const c=await abrir('cargas');const e=await abrir('embarcacoes');
  try {
    const listaCarga=c.w.document.getElementById('agTipoCarga');
    const listaCont=e.w.document.getElementById('contTipo');
    assert.equal(listaCont.tagName,'SELECT');assert.equal(listaCont.required,true);
    assert.deepEqual(opcoes(listaCont),opcoes(listaCarga),'Catálogo do banco é igual nos dois cadastros');
    assert.deepEqual(opcoes(listaCont),['','Carga Viva','Carga Geral'],'Tipos carregados assincronamente substituem a lista inicial');
    listaCont.value='Carga Viva';
    e.w.dispatchEvent(new e.w.CustomEvent('nexus_tipos_carga_changed'));
    assert.equal(listaCont.value,'Carga Viva','Atualização preserva seleção ainda válida');
    // Cadastro legítimo salva nome e UUID existentes no schema, sem migração.
    e.w.document.getElementById('contIdentificacao').value='NOVO-1234567';
    e.w.document.getElementById('contFabricacao').value='2020-01-01';
    e.w.document.getElementById('containerForm').dispatchEvent(new e.w.Event('submit',{cancelable:true}));
    await H.aguardar(50);
    const novo=e.banco.tabelas.containers.find(x => x.numero_identificacao === 'NOVO-1234567');
    assert.equal(novo.material_carregado,'Carga Viva');assert.equal(novo.tipo_carga_id,T_VIVA);
    const cache=JSON.parse(e.w.localStorage.getItem('nexus_containers_list')).find(x => x.identificacao === 'NOVO-1234567');
    assert.equal(cache.tipo_carga_id,T_VIVA);assert.equal(cache.estado,'OPERANTE');
    // Opção forçada no DOM não permite cadastrar texto livre.
    const forjada=e.w.document.createElement('option');forjada.value='Tipo inventado';forjada.textContent=forjada.value;
    listaCont.append(forjada);listaCont.value=forjada.value;
    e.w.document.getElementById('contIdentificacao').value='FALS-1234567';
    e.w.document.getElementById('containerForm').dispatchEvent(new e.w.Event('submit',{cancelable:true}));
    await H.aguardar(20);
    assert.ok(!e.banco.tabelas.containers.some(x => x.numero_identificacao === 'FALS-1234567'));
    assert.ok(e.avisos.some(a => a.titulo === 'Tipo de Carga Inválido'));

    await selecionar(c.w,C_VIVA);
    assert.deepEqual(opcoes(c.w.document.getElementById('vincularContainerSelect')),['',C_VIVA],'Carga viva só lista contêiner do tipo vivo');
    // Mesmo quando a escolha não passou pelo filtro, a confirmação deve rejeitar.
    const sel=c.w.document.getElementById('vincularContainerSelect');
    const indevida=c.w.document.createElement('option');indevida.value=C_GERAL;
    indevida.dataset.identificacao='GERA-1234567';indevida.dataset.estado='OPERANTE';indevida.dataset.disp='75';
    sel.append(indevida);sel.value=C_GERAL;
    await confirmar(c.w);
    assert.equal(c.banco.log.length,0);assert.ok(c.avisos.some(a => a.titulo === 'Tipos de Carga Incompatíveis'));
    await selecionar(c.w,C_VIVA);await confirmar(c.w);
    assert.equal(c.banco.tabelas.cargas[0].container_id,C_VIVA,'Controle positivo mantém vínculo do mesmo tipo');

    const comp=c.w.nexusTiposCargaCompativeis;
    assert.equal(comp({tipo:'Carga Viva'},{tipo:'Carga Geral'}),false);
    assert.equal(comp({tipo:'Carga Viva'},{tipo:'  CARGA VIVA '}),true);
    assert.equal(comp({tipo_carga_id:T_VIVA},{tipo:'Carga Viva'}),true);
    assert.equal(comp({tipo_carga_id:T_VIVA},{tipo_carga_id:T_GERAL,tipo:'Carga Viva'}),false,'UUID prevalece sobre rótulo incorreto');
    assert.equal(comp({tipo:'Carga Geral'},{}),false,'Não inferir tipo genérico quando ausente');
    assert.equal(comp({tipo_carga_id:C_DESCONHECIDO,tipo:'Carga Geral'},{tipo:'Carga Geral'}),false,'UUID desconhecido não herda natureza genérica');
  } finally {c.w.close();e.w.close();}

  // O tipo do contêiner muda depois de abrir o modal.
  {
    const t=await abrir('cargas');
    try {
      await selecionar(t.w,C_VIVA);t.banco.tabelas.containers[0].tipo_carga_id=T_GERAL;
      t.banco.tabelas.containers[0].material_carregado='Carga Geral';
      await confirmar(t.w);assert.equal(t.banco.log.length,0);
    } finally {t.w.close();}
  }
  // WebMCP valida tanto o cadastro quanto a vinculação.
  {
    const t=await abrir('cargas');
    try {
      let ferramentas;
      t.w.NexusWebMCP={registrarPagina:p => {ferramentas=p.ferramentas;}};
      t.w.NexusWebMCPDados={GRUPOS:{todos:[],supervisao:[]},quandoPronto:f => f(),
        cargasDoOperador:async () => [t.carga],containers:() => [{identificacao:'GERA-1234567',tipo:'Carga Geral',estado:'OPERANTE'}]};
      t.w.eval(H.read('js/webmcp/webmcp-cargas.js'));
      const vinculo=ferramentas.find(f => f.nome === 'vincular_carga_container');
      assert.equal((await vinculo.precondicao({id:t.carga.id,container:'GERA-1234567'})).codigo,'TIPOS_INCOMPATIVEIS');
      t.w.NexusWebMCPDados.GRUPOS={todos:[],gestaoOperacional:[],supervisao:[],inspecao:[],direcao:[]};
      t.w.eval(H.read('js/webmcp/webmcp-embarcacoes.js'));
      const cadastro=ferramentas.find(f => f.nome === 'cadastrar_container');
      // A pré-condição é assíncrona: consulta o catálogo do banco antes de validar.
      assert.equal((await cadastro.precondicao({tipo:'Tipo inventado'})).codigo,'TIPO_INVALIDO');
    } finally {t.w.close();}
  }
  // Recarregar não pode substituir o tipo real pela natureza descritiva.
  {
    const t=await abrir('cargas');
    try {
      t.w.eval(H.read('js/data-repository.js'));
      const recarregadas=await t.w.NexusRepository.getCargas();
      assert.equal(recarregadas[0].tipo_carga_id,T_VIVA);
      assert.equal(recarregadas[0].tipo,'Carga Viva');
      assert.equal(recarregadas[0].natureza,'Animais vivos');
      t.banco.tabelas.cargas[0].tipo_carga_id=null;
      t.banco.tabelas.cargas[0].natureza=null;
      t.w.NexusRepository.invalidarLeiturasCargas();
      const semTipo=await t.w.NexusRepository.getCargas();
      assert.equal(t.w.nexusTiposCargaCompativeis(semTipo[0],{tipo:'Carga Geral'}),false,
        'Reload também não transforma informação ausente em Carga Geral');
    } finally {t.w.close();}
  }
  console.log('✅ Tarefa 10: lista compartilhada, cadastro sem texto livre, UUID preservado, filtro e confirmação de compatibilidade e WebMCP.');
})().catch(e => {console.error(e);process.exit(1);});
