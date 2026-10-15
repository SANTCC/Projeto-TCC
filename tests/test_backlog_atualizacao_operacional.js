/** Tarefa 16: atualiza log/produtividade sem emergência; Realtime, abas e respostas obsoletas. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const uid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
function criarAmbiente(){
  const tabelas={funcionarios:[{id:uid(1),nome:'Ana Operadora',matricula:'MAT-2011',codigo_individual:'NX-2011-SP',cargo:'INSPETOR',ativo:true}],
    cargas:[{id:uid(2),qr_code_url:'QR-CRG-16',status_fluxo:'ARMAZENAGEM',natureza:'Geral',created_at:new Date().toISOString()}],navios:[],containers:[],logs_alteracoes:[],trail_decisoes:[]};
  const canais=[],bc=[];let seq=10;
  class CanalAbas{
    constructor(nome){this.nome=nome;bc.push(this);}
    postMessage(data){bc.filter(b=>b!==this&&!b.fechado&&b.nome===this.nome).forEach(b=>b.onmessage&&b.onmessage({data}));}
    close(){this.fechado=true;}
  }
  function cliente(){
    const controle={espera:null,pendente:null};
    const c={controle,from(tabela){
      let op='select',payload,unico=false,inicio=0,fim=Infinity;const filtros=[];
      const b={select(){return b;},order(){return b;},limit(){return b;},eq(k,v){filtros.push(r=>r[k]===v);return b;},in(k,vs){filtros.push(r=>vs.includes(r[k]));return b;},range(a,z){inicio=a;fim=z;return b;},maybeSingle(){unico=true;return b;},single(){unico=true;return b;},insert(p){op='insert';payload=p;return b;},then(res,rej){
        let rows=tabelas[tabela]||(tabelas[tabela]=[]);
        if(op==='insert'){const row={id:uid(++seq),...payload};rows.push(row);rows=[row];}
        const data=rows.filter(r=>filtros.every(f=>f(r))).slice(inicio,fim+1).map(r=>JSON.parse(JSON.stringify(r)));
        const resultado={data:unico?(data[0]||null):data,error:null};
        if(controle.espera===tabela){controle.espera=null;return new Promise(resolve=>{controle.pendente=()=>resolve(resultado);}).then(res,rej);}
        return Promise.resolve(resultado).then(res,rej);
      }};return b;
    },channel(){const canal={ativo:true,callbacks:{},on(tipo,filtro,fn){this.callbacks[filtro.table]=fn;return this;},subscribe(fn){this.status=fn;return this;}};canais.push(canal);return canal;},removeChannel(canal){canal.ativo=false;}};
    return c;
  }
  function emitir(tabela){canais.filter(c=>c.ativo).forEach(c=>c.callbacks[tabela]&&c.callbacks[tabela]({eventType:'UPDATE'}));}
  return {tabelas,cliente,emitir,canais,CanalAbas};
}
async function abrir(ambiente,pagina){
  const client=ambiente.cliente();
  const j=H.criarJanela({url:`https://nexusport.test/${pagina||'dashboard'}.html`,html:pagina?H.htmlDaPagina(`${pagina}.html`):'<html><body></body></html>',
    session:H.sessao('DIRETOR_OPERACOES_LOGISTICA',{id:uid(1),nome:'Ana Operadora',matricula:'MAT-2011',codigo_individual:'NX-2011-SP'}),
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/supabase-client.js',w=>{w.nexusSupabase=client;w.currentUserSession=w.NexusAuth.getSession();w.BroadcastChannel=ambiente.CanalAbas;},'js/data-repository.js','js/auditoria.js',...(pagina?[`js/pages/${pagina}.js`]:[])]});
  await H.prontoDom(j.w);await H.aguardar(50);assert.deepEqual(j.erros,[]);
  return {...j,client};
}
const atualizar=async w=>{w.NexusRepository.notifyChange('logs_alteracoes');await H.aguardar(25);};
const linhas=w=>w.document.getElementById('auditLogTableBody').querySelectorAll('tr').length;
const volume=w=>w.document.getElementById('produtividadeTableBody').textContent;
const adicionarLog=(a,id)=>a.tabelas.logs_alteracoes.push({id:uid(id),data_hora:new Date().toISOString(),codigo_individual:'NX-2011-SP',funcionario_id:uid(1),cargo:'INSPETOR',entidade_tipo:'CARGA',entidade_id:`CRG-${id}`,tipo_alteracao:'EDICAO'});
(async()=>{
  const a=criarAmbiente();const fonte=await abrir(a);const painel=await abrir(a,'dashboard');const rel=await abrir(a,'relatorios');
  try{
    assert.match(volume(rel.w),/0 Operação/);
    const select=rel.w.document.getElementById('relatorioCargaSelect');select.value='CRG-16';
    const busca=painel.w.document.getElementById('buscarAuditLogInput');busca.value='CRG';
    // Mesma sequência usada pelos handlers: gravar auditoria e notificar a entidade alterada.
    const eventos=[['cargas','Recebimento'],['cargas','Aprovação'],['navios','Liberação'],['containers','Vínculo da carga'],['bercos','Vínculo ao berço']];
    for(const [i,[tabela,acao]]of eventos.entries()){
      await fonte.w.registrarLogAlteracao(`CRG-${20+i}`,'EDICAO',acao);
      fonte.w.NexusRepository.notifyChange(tabela);await H.aguardar(40);
      assert.equal(linhas(painel.w),i+1,`${acao}: log atualizado por BroadcastChannel, sem pânico`);
      assert.match(volume(rel.w),new RegExp(`${i+1} Operação`),`${acao}: produtividade atualizada`);
      assert.equal(select.value,'CRG-16');assert.equal(busca.value,'CRG');
    }
    const revisao=painel.w.NexusRepository._cargasRevision;const lotes=[];
    painel.w.addEventListener('nexus_data_changed',e=>{if(e.detail.origem==='realtime')lotes.push(e.detail);});
    // Outro dispositivo: banco muda e publica carga seguida de logs. Não há BroadcastChannel.
    adicionarLog(a,30);a.tabelas.cargas.push({id:uid(3),qr_code_url:'QR-CRG-17',status_fluxo:'ARMAZENAGEM'});
    a.emitir('cargas');a.emitir('navios');a.emitir('logs_alteracoes');await H.aguardar(490);
    assert.equal(lotes.length,1);assert.deepEqual(Array.from(lotes[0].entities).sort(),['cargas','logs_alteracoes','navios']);
    assert.equal(lotes[0].entity,null,'Lote misto não é apresentado como apenas a última tabela');
    assert.ok(painel.w.NexusRepository._cargasRevision>revisao,'Carga continua invalidada mesmo quando auditoria chega por último');
    assert.equal(linhas(painel.w),6);assert.match(volume(rel.w),/6 Operação/);
    assert.equal(painel.w.__nexusIndicadoresExecutivos.find(i=>i.categoria.startsWith('Cargas')).volume,2);
    // Reconexão do canal e recuperação da rede também atualizam, sem botão SOS.
    adicionarLog(a,31);a.canais.find(c=>c.ativo).status('SUBSCRIBED');await H.aguardar(40);
    assert.equal(linhas(painel.w),7);assert.match(volume(rel.w),/7 Operação/);
    adicionarLog(a,32);painel.w.dispatchEvent(new painel.w.Event('online'));await H.aguardar(40);
    assert.equal(linhas(painel.w),8);
    // Interromper o canal cancela notificações pendentes, sem eco em outras abas.
    const antes=lotes.length;a.emitir('cargas');painel.w.NexusRepository.pararSincronizacaoRealtime();await H.aguardar(480);
    assert.equal(lotes.length,antes);
    assert.equal((a.tabelas.emergencias||[]).length,0,'Nenhuma emergência foi criada para atualizar os dados');
    for(const j of[fonte,painel,rel])assert.deepEqual(j.erros,[]);
  }finally{for(const j of[fonte,painel,rel])j.w.close();}
  // Uma leitura lenta anterior não pode sobrescrever uma nova nem misturar listas de produtividade.
  for(const pagina of['dashboard','relatorios']){
    const b=criarAmbiente();adicionarLog(b,40);const j=await abrir(b,pagina);
    try{
      j.client.controle.espera='logs_alteracoes';j.w.NexusRepository.notifyChange('logs_alteracoes');await H.aguardar(10);
      assert.ok(j.client.controle.pendente);
      adicionarLog(b,41);await atualizar(j.w);
      if(pagina==='dashboard')assert.equal(linhas(j.w),2);else assert.match(volume(j.w),/2 Operação/);
      j.client.controle.pendente();await H.aguardar(30);
      if(pagina==='dashboard')assert.equal(linhas(j.w),2);else assert.match(volume(j.w),/2 Operação/);
      assert.deepEqual(j.erros,[]);
    }finally{j.w.close();}
  }
  {
    const b=criarAmbiente();const j=await abrir(b);
    try{
      let eventos=0;j.w.addEventListener('nexus_data_changed',e=>{if(e.detail.origem==='realtime')eventos++;});
      b.emitir('cargas');await H.aguardar(250);b.emitir('logs_alteracoes');await H.aguardar(210);
      assert.equal(eventos,1,'Uma rajada contínua não adia a atualização além da janela de 400ms');
      j.w.NexusRepository.pararSincronizacaoRealtime();
    }finally{j.w.close();}
  }
  {
    const b=criarAmbiente();const j=await abrir(b,'dashboard');
    try{
      j.w.NexusRepository.buscarIndicadoresOperacionais=async()=>null;
      j.client.controle.espera='cargas';j.w.NexusRepository.notifyChange('cargas');await H.aguardar(10);
      assert.ok(j.client.controle.pendente);
      b.tabelas.cargas.push({id:uid(99),status_fluxo:'ARMAZENAGEM'});
      j.w.NexusRepository.notifyChange('cargas');await H.aguardar(25);
      const total=()=>j.w.__nexusIndicadoresExecutivos.find(i=>i.categoria.startsWith('Cargas')).volume;
      assert.equal(total(),2);j.client.controle.pendente();await H.aguardar(25);assert.equal(total(),2,'Planilha antiga não sobrescreve a atualização operacional');
    }finally{j.w.close();}
  }
  console.log('✅ Tarefa 16: log/produtividade por operações sem emergência, abas, Realtime multitabela, invalidação, reconexão, filtros, seleção e proteção contra respostas obsoletas.');
})().catch(e=>{console.error(e);process.exit(1);});
