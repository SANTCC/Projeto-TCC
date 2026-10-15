/** Tarefa 17: canceladas saem somente do valor movimentado, sem apagar seu histórico. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const agora=new Date();
const mes=deslocamento=>new Date(agora.getFullYear(),agora.getMonth()+deslocamento,15,12).toISOString();
const cargas=[
  {id:'A',status_fluxo:'ARMAZENAGEM',valor_declarado:100,created_at:mes(0)},
  {id:'B',status_fluxo:'ENTREGUE',valor_declarado:200,created_at:mes(-1)},
  {id:'C',status_fluxo:'CANCELADA',valor_declarado:9000000,created_at:mes(0)},
  {id:'D',status:'cancelada',valor:'R$ 8.000.000,00',dataEntrada:mes(-1)},
  {id:'E',status_fluxo:'RECUSADA',valor_declarado:50,created_at:mes(0)},
  {id:'F',status_fluxo:'ARMAZENAGEM',valor_declarado:999999,created_at:mes(-8)},
  {id:'G',status_fluxo:'ARMAZENAGEM',valor_declarado:0,created_at:mes(0)}
];
const soma=spec=>spec?spec.datasets[0].data.reduce((a,b)=>a+b,0):0;
(async()=>{
  let escrita=0,servidor=true;
  const tabela=cargas.map(c=>({...c}));
  const j=H.criarJanela({url:'https://nexusport.test/relatorios.html',html:H.htmlDaPagina('relatorios.html'),
    session:H.sessao('DIRETOR_OPERACOES_LOGISTICA'),storage:{nexus_cargas_fluxo:cargas},scripts:[
      'js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
        w.nexusSupabase={from:t=>{
          const b={select(){return b;},order(){return b;},limit(){return b;},range(){return b;},in(){return b;},eq(){return b;},insert(){escrita++;return b;},update(){escrita++;return b;},delete(){escrita++;return b;},then(res,rej){return Promise.resolve({data:servidor?(t==='cargas'?tabela.map(c=>({...c})):[]):null,error:servidor?null:{message:'offline simulado'}}).then(res,rej);}};return b;
        }};
      },'js/pages/charts.js']});
  await H.prontoDom(j.w);const w=j.w,h=w.NexusCharts;
  const original=JSON.stringify(cargas),cacheOriginal=w.localStorage.getItem('nexus_cargas_fluxo');
  try{
    const spec=h.construir('valor_declarado_mes',{cargas});
    assert.equal(soma(spec),350,'Somar ativas/entregues e manter regra existente dos demais estados');
    assert.equal(spec.datasets[0].data.at(-1),150);assert.equal(spec.datasets[0].data.at(-2),200);
    assert.equal(spec.formatoMoeda,true);assert.match(spec.resumo,/excluindo cargas canceladas/);
    assert.equal(h.construir('valor_declarado_mes',{cargas:cargas.filter(c=>['C','D'].includes(c.id))}),null,'Somente canceladas não geram valor movimentado');
    assert.equal(h.construir('valor_declarado_mes',{cargas:[]}),null);
    assert.equal(h.construir('valor_declarado_mes',{cargas:[cargas[5],cargas[6]]}),null,'Datas fora da janela e valores zerados mantêm comportamento anterior');
    const fluxos=h.construir('cargas_fluxo',{cargas});
    assert.ok(fluxos.labels.includes('Cancelada'),'Canceladas permanecem nos gráficos de fluxo/status');
    assert.equal(JSON.stringify(cargas),original,'Construtor não modifica dados da carga');
    await h.definirFiltros({periodo:'TODOS',status:'CANCELADA'});
    const recorte=h.filtrarDados({cargas:cargas.map(h.utils.normalizarCarga)});
    assert.equal(recorte.cargas.length,2,'Filtro específico de canceladas continua disponível');
    assert.equal(h.construir('valor_declarado_mes',recorte),null,'Selecionar canceladas não as reintroduz no gráfico financeiro');
    await h.definirFiltros({periodo:'30D',status:'GERAL'});
    // Servidor e fallback local usam o mesmo construtor, preservando o valor bruto.
    for(const online of [true,false]){
      servidor=online;h.invalidarCache();
      const dados=await h.carregarDados(H.sessao('DIRETOR_OPERACOES_LOGISTICA'),['cargas'],{forcar:true});
      assert.equal(h.ultimaAtualizacao().porFonte.cargas,online?'supabase':'local');
      assert.equal(dados.cargas.length,cargas.length);
      assert.equal(dados.cargas.find(c=>c.id==='C').valor,9000000);
      assert.equal(soma(h.construir('valor_declarado_mes',dados)),350);
      assert.equal(w.localStorage.getItem('nexus_cargas_fluxo'),cacheOriginal);
    }
    // Cancelamento posterior deixa de contar no próximo carregamento; valor salvo não é zerado.
    servidor=true;tabela[0].status_fluxo='CANCELADA';
    const atualizados=await h.carregarDados(H.sessao('DIRETOR_OPERACOES_LOGISTICA'),['cargas'],{forcar:true});
    assert.equal(soma(h.construir('valor_declarado_mes',atualizados)),250);
    assert.equal(tabela[0].valor_declarado,100);assert.equal(tabela[2].valor_declarado,9000000);
    assert.equal(escrita,0,'Exibir/recarregar gráficos não grava no banco');
    for(const cargo of ['ESTIVADOR','INSPETOR','SUPERVISOR_GERENTE_OPERACOES','TECNICO_PORTOS'])assert.equal(h.painelDoCargo(cargo).includes('valor_declarado_mes'),false,'Não ampliar acesso financeiro');
    for(const cargo of ['DIRETOR_OPERACOES_LOGISTICA','DIRETOR_PRESIDENTE_SUPERINTENDENTE','CONSELHO_ADMINISTRACAO'])assert.equal(h.painelDoCargo(cargo).includes('valor_declarado_mes'),true);
    assert.deepEqual(j.erros,[]);
  }finally{w.close();}
  console.log('✅ Tarefa 17: canceladas excluídas do valor, totais mensais corretos, servidor/fallback e cancelamento posterior; histórico, outros gráficos e acesso preservados.');
})().catch(e=>{console.error(e);process.exit(1);});
