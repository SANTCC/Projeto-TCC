/** Tarefa 18: ordem alfabética de apresentação, independente do banco/estado/localização. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const {criarBancoFalso}=require('./fake-supabase-db');
const uid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const imo=n=>`IMO-${String(n).padStart(7,'0')}`;
const navios=[
  {id:uid(1),nome:'Zulu',numero_imo:imo(1),localizacao:'FORA_DO_PORTO'},
  {id:uid(2),nome:'bravo',numero_imo:imo(2),localizacao:'DENTRO_DO_PORTO'},
  {id:uid(4),nome:'Álfa',numero_imo:imo(4),localizacao:'NO_PORTO_DE_DESTINO'},
  {id:uid(3),nome:'alfa',numero_imo:imo(3),localizacao:'FORA_DO_PORTO'},
  {id:uid(5),nome:'Cedro',numero_imo:imo(5),localizacao:'DENTRO_DO_PORTO'},
  {id:uid(6),nome:'Águia',numero_imo:imo(6),localizacao:'NO_PORTO_DE_DESTINO'}
].map(n=>({...n,porto_origem:'Porto de Santos',porto_destino:'Roterdã',estado_operacional:'OPERANTE'}));
const esperado=[6,3,4,2,5,1].map(imo);
async function abrir(remoto=true,lista=navios){
  const banco=criarBancoFalso({navios:lista.map(n=>({...n})),bercos:Array.from({length:15},(_,i)=>({id:`BERCO-${i+1}`,nome:`Berço ${String(i+1).padStart(2,'0')}`,estado:'LIVRE'})),
    rotas_maritimas:[{id:uid(10),origem:'Porto de Santos',destino:'Roterdã',distancia_km:10000}],containers:[],guindastes:[],cargas:[]});
  const from=banco.from;banco.from=t=>{
    const b=from(t);const single=()=>b.then(r=>({...r,data:Array.isArray(r.data)?(r.data[0]||null):r.data}));
    b.maybeSingle=single;b.single=single;return b;
  };
  let relogio;
  const j=H.criarJanela({url:'https://nexusport.test/embarcacoes.html',html:H.htmlDaPagina('embarcacoes.html'),session:H.sessao('INSPETOR'),
    storage:{nexus_navios_list:lista.map(n=>({...n,imo:n.numero_imo,origem:n.porto_origem,destino:n.porto_destino})),nexus_cargas_fluxo:[]},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=remoto?banco:null;
      w.setInterval=(fn,ms)=>{if(ms===1000)relogio=fn;return 1;};w.mostrarFeedback=()=>{};
    },'js/pages/embarcacoes.js']});
  await H.prontoDom(j.w);await H.aguardar(60);assert.deepEqual(j.erros,[]);banco.log.length=0;
  return {...j,banco,relogio:()=>relogio()};
}
const ordem=w=>Array.from(w.document.querySelectorAll('#embarcacoesGpsTableBody tr td:first-child:not([colspan]) span')).map(s=>s.textContent);
const buscar=(w,termo)=>{const input=w.document.getElementById('buscarNavioInput');input.value=termo;input.dispatchEvent(new w.Event('input'));};
const atualizar=async w=>{w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'navios'}}));await H.aguardar(60);};
(async()=>{
  for(const remoto of[true,false]){
    const j=await abrir(remoto);const w=j.w;
    try{
      assert.deepEqual(ordem(w),esperado,`Alfabética pt-BR, acentos/caixa e desempate por IMO (${remoto?'banco':'cache'})`);
      const cache=w.localStorage.getItem('nexus_navios_list');
      buscar(w,'alfa');assert.deepEqual(ordem(w),[imo(3)]); // Busca mantém a regra anterior (sem normalizar acentos).
      buscar(w,'Roterdã');assert.deepEqual(ordem(w),esperado);
      buscar(w,'sem resultado');assert.equal(ordem(w).length,0);
      assert.match(w.document.getElementById('embarcacoesCounter').textContent,/Exibindo 0 de 6/);
      buscar(w,'');assert.deepEqual(ordem(w),esperado);
      j.relogio();assert.deepEqual(ordem(w),esperado);
      assert.equal(w.localStorage.getItem('nexus_navios_list'),cache,'Ordenar/filtrar/relógio não regrava o cadastro');
      assert.equal(j.banco.log.length,0,'Ordenar não grava no banco');
      // Fonte passa a devolver outra ordem e novas localizações/estados.
      const alterados=navios.slice().reverse().map((n,i)=>({...n,localizacao:['DENTRO_DO_PORTO','NO_PORTO_DE_DESTINO','FORA_DO_PORTO'][i%3],estado_operacional:i%2?'EM_MANUTENCAO':'OPERANTE'}));
      if(remoto)j.banco.tabelas.navios=alterados;
      else w.localStorage.setItem('nexus_navios_list',JSON.stringify(alterados.map(n=>({...n,imo:n.numero_imo,origem:n.porto_origem,destino:n.porto_destino}))));
      await atualizar(w);assert.deepEqual(ordem(w),esperado,'Atualização de trânsito/porto/estado não muda a ordem visual');
      assert.deepEqual(JSON.parse(w.localStorage.getItem('nexus_navios_list')).map(n=>n.imo),alterados.map(n=>n.numero_imo),'Lista de origem não é ordenada in-place');
      j.relogio();assert.deepEqual(ordem(w),esperado);
      assert.equal(j.banco.log.length,0);
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  {
    const j=await abrir(true);const w=j.w;
    try{
      w.document.getElementById('navioNome').value='Beta';w.document.getElementById('navioImo').value=imo(99);
      w.document.getElementById('navioLocalizacao').value='FORA_DO_PORTO';w.document.getElementById('navioRotaSelect').value='0';
      w.document.getElementById('navioForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await H.aguardar(60);
      assert.deepEqual(ordem(w),[6,3,4,99,2,5,1].map(imo),'Navio novo entra na posição alfabética, não no início');
      assert.equal(j.banco.tabelas.navios.find(n=>n.numero_imo===imo(99)).nome,'Beta');
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  for(const lista of[[],[navios[0]]]){
    const j=await abrir(false,lista);
    try{assert.deepEqual(ordem(j.w),lista.length?[imo(1)]:[]);assert.deepEqual(j.erros,[]);}finally{j.w.close();}
  }
  console.log('✅ Tarefa 18: ordem alfabética pt-BR fixa, desempate por IMO, banco/cache, mudanças de estado/localização, busca, relógio e cadastro; sem reordenar a fonte.');
})().catch(e=>{console.error(e);process.exit(1);});
