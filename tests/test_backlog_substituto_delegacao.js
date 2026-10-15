/** T23: perfil derivado preservado; substituto não administra delegações. Rede simulada. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const titular={id:uuid(1),nome:'Titular',cargo:'SUPERVISOR_GERENTE_OPERACOES',matricula:'MAT-1111',codigo_individual:'SUP-1111',ativo:true};
const sub={id:uuid(2),nome:'Substituto',cargo:'ESTIVADOR',matricula:'MAT-2222',codigo_individual:'EST-2222',cpf:'12345678901',ativo:true};
const ativa={substituidoId:uuid(1),substituidoMatricula:'MAT-1111',substituidoNome:'Titular',substitutoId:uuid(2),substitutoMatricula:'MAT-2222',substitutoNome:'Substituto',inicio:'2000-01-01T00:00',fim:'2099-01-01T00:00'};
async function abrir(session,delegacao=null,{pagina='delegacao.html',remoto=false,delegacaoServidor=null}={}){
  const queries=[],writes=[],feedback=[],confirmacoes=[];
  const controle={falharRevogacao:false,adiarConfirmacaoFuncionario:null};const tabelas={funcionarios:[{...titular},{...sub}],delegacoes_supervisor:delegacaoServidor?[delegacaoServidor]:[],logs_alteracoes:[],trail_decisoes:[]};
  const cliente={from(t){let payload,op='select',unico=false;const filtros=[];
    const b={select(){return b;},order(){return b;},limit(){return b;},range(){return b;},
      eq(c,v){filtros.push(r=>r[c]===v);return b;},in(c,v){filtros.push(r=>v.includes(r[c]));return b;},maybeSingle(){unico=true;return b;},single(){unico=true;return b;},
      insert(p){op='insert';payload=p;return b;},update(p){op='update';payload=p;return b;},
      then(res,rej){queries.push({t,op});let data=(tabelas[t]||[]).filter(r=>filtros.every(f=>f(r)));
        if(op!=='select'){
          if(t==='delegacoes_supervisor'&&controle.falharRevogacao)return Promise.resolve({data:null,error:{message:'erro simulado'}}).then(res,rej);
          writes.push({t,op,payload});if(op==='insert'){const r={id:uuid(100+writes.length),...payload};(tabelas[t]||(tabelas[t]=[])).push(r);data=[r];}else data.forEach(r=>Object.assign(r,payload));
        }
        const result={data:unico?(data[0]?{...data[0]}:null):data.map(r=>({...r})),error:null};
        if(t==='funcionarios'&&unico&&controle.adiarConfirmacaoFuncionario){const p=controle.adiarConfirmacaoFuncionario;controle.adiarConfirmacaoFuncionario=null;return p.then(()=>result).then(res,rej);}
        return Promise.resolve(result).then(res,rej);
      }};return b;
  }};
  const j=H.criarJanela({url:`https://nexusport.test/${pagina}`,html:H.htmlDaPagina(pagina),session:H.sessao(session.cargo,{...session}),
    storage:{nexus_active_delegation:delegacao,nexus_func_list:[titular,sub]},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/vision-layer.js',w=>{
      // Captura intencionalmente desatualizada: a página deve consultar a sessão real.
      w.currentUserSession={...titular};w.nexusSupabase=remoto?cliente:null;
      w.NexusRepository={notifyChange(){},lerTodasAsLinhas:async factory=>(await factory()).data};
      w.mostrarFeedback=(tipo,titulo,msg)=>feedback.push({tipo,titulo,msg});w.nexusConfirm=async(t,msg)=>{confirmacoes.push({t,msg});return true;};
    },'js/auditoria.js','js/layout.js',...(pagina==='delegacao.html'?['js/pages/delegacao.js']:[]),'js/webmcp/webmcp-core.js','js/webmcp/webmcp-dados.js',...(pagina==='delegacao.html'?['js/webmcp/webmcp-delegacao.js']:[])]});
  await H.prontoDom(j.w);await H.aguardar(35);return {...j,queries,writes,feedback,confirmacoes,tabelas,controle};
}
const gravarPerfil=(w,s)=>w.NexusAuth.establishSession(H.sessao(s.cargo,{...s}));
const preencher=w=>{for(const[id,v]of Object.entries({delegSubstituidoNome:uuid(1),delegSubstitutoNome:sub.nome,delegSubstitutoCpf:sub.cpf,delegSubstitutoDataNasc:'1990-01-01',delegDataInicio:'2000-01-01T00:00',delegDataFim:'2099-01-01T00:00'}))w.document.getElementById(id).value=v;};
const enviar=w=>w.document.getElementById('delegacaoForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
(async()=>{
  const casos=[
    [{...sub,cargo:'SUPERVISOR_SUBSTITUTO'},null],
    [{...sub,cargo:'SUPERVISOR_GERENTE_OPERACOES',supervisor_substituto:true},null],
    [{...sub,cargo:'SUPERVISOR_GERENTE_OPERACOES',delegacao_ativa:true},null],
    [{...sub,cargo:'SUPERVISOR_GERENTE_OPERACOES',cargo_nome:'Supervisor Substituto (Delegação Ativa)'},null],
    [sub,ativa],
    [{...sub,id:undefined},{...ativa,substitutoId:undefined,substitutoMatricula:'2222'}]
  ];
  for(const [session,d]of casos){const j=await abrir(session,d,{remoto:true});const w=j.w;
    try{
      assert.equal(w.NexusAuth.isSupervisorSubstituto(),true);assert.equal(w.NexusAuth.canAccessPage('delegacao.html'),false);
      assert.equal(w.NexusAuth.hasPermission('DESIGNAR_SUBSTITUTO'),false);assert.equal(w.NexusAuth.hasPermission('REVOGAR_DELEGACAO'),false);
      assert.equal(w.NexusAuth.hasPermission('ACIONAR_EMERGENCIA'),true);
      assert.equal(w.document.getElementById('delegacaoForm'),null);assert.equal(w.document.getElementById('revogarDelegacaoBtn'),null);
      assert.match(w.document.querySelector('main').textContent,/Acesso restrito/);assert.equal(w.nexusRevogarDelegacao,undefined);
      assert.equal(w.document.querySelector('#appSidebar a[href="delegacao.html"]'),null);
      assert.equal(j.queries.length,0,'Página bloqueada não consulta dados');assert.equal(j.writes.length,0);
      for(const ferramenta of['obter_delegacao_ativa','revogar_delegacao','preparar_designacao_substituto']){
        const r=await w.NexusWebMCP.executar(ferramenta,{});assert.equal(r.ok,false);assert.ok(['PERMISSAO_NEGADA','FERRAMENTA_INDISPONIVEL','PAGINA_NAO_PERMITIDA'].includes(r.codigo),JSON.stringify(r));
      }
      assert.equal(j.confirmacoes.length,0);assert.equal(j.writes.length,0);
      // Nem uma lista de cargos fornecida por chamada antiga deve ultrapassar a negativa da rota.
      assert.equal(w.NexusAuth.requireAuth(['SUPERVISOR_GERENTE_OPERACOES','SUPERVISOR_SUBSTITUTO']),null);
      assert.ok(j.erros.every(e=>e.includes('Not implemented: navigation')));
      if(d)assert.equal(w.NexusAuth.hasPermission('LIBERAR_NAVIO'),true,'Poderes operacionais delegados permanecem');
    }finally{w.close();}
  }
  // A identidade de substituto também pode ser descoberta na primeira leitura do servidor.
  {
    const j=await abrir({...sub,cargo:'SUPERVISOR_GERENTE_OPERACOES'},null,{remoto:true,delegacaoServidor:{id:uuid(50),supervisor_titular_id:uuid(1),substituto_id:uuid(2),substituto_nome:sub.nome,data_inicio:ativa.inicio,data_fim_previsto:ativa.fim,ativo:true}});
    try{assert.equal(j.w.NexusAuth.isSupervisorSubstituto(),true);assert.equal(j.w.document.getElementById('delegacaoForm'),null);assert.equal(j.w.document.querySelector('#appSidebar a[href="delegacao.html"]'),null);assert.equal(j.writes.length,0);assert.deepEqual(j.erros,[]);}finally{j.w.close();}
  }
  // Titular (inclusive cache legado com matrícula copiada), direção e conselho continuam autorizados.
  for(const cargo of['SUPERVISOR_GERENTE_OPERACOES','DIRETOR_OPERACOES_LOGISTICA','DIRETOR_PRESIDENTE_SUPERINTENDENTE','CONSELHO_ADMINISTRACAO']){
    const legado={...ativa,substitutoId:null,substituidoId:null,substitutoMatricula:titular.matricula};const j=await abrir({...titular,cargo},legado);const w=j.w;
    try{assert.equal(w.NexusAuth.isSupervisorSubstituto(),false);assert.equal(w.NexusAuth.canAccessPage('delegacao.html'),true);assert.equal(w.NexusAuth.hasPermission('REVOGAR_DELEGACAO'),true);assert.ok(w.document.getElementById('delegacaoForm'));assert.ok(w.document.querySelector('#appSidebar a[href="delegacao.html"]'));assert.deepEqual(j.erros,[]);}finally{w.close();}
  }
  for(const d of[{...ativa,inicio:'2098-01-01'},{...ativa,fim:'2001-01-01'},{...ativa,ativo:false},{...ativa,inicio:'inválido'}]){
    const j=await abrir(sub,d);try{assert.equal(j.w.NexusAuth.getSession().cargo,'ESTIVADOR');assert.equal(j.w.NexusAuth.hasPermission('LIBERAR_NAVIO'),false);assert.equal(j.w.NexusAuth.canAccessPage('delegacao.html'),false);}finally{j.w.close();}
  }
  // Mudança de perfil com a página aberta e chamadas já capturadas não bypassam o guard.
  {
    const j=await abrir(titular,ativa);const w=j.w;
    try{
      const revogar=w.nexusRevogarDelegacao;const form=w.document.getElementById('delegacaoForm');
      gravarPerfil(w,{...titular,supervisor_substituto:true});
      form.dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(await revogar({confirmado:true}),false);
      w.dispatchEvent(new w.Event('focus'));assert.equal(w.document.querySelector('#appSidebar a[href="delegacao.html"]'),null);
      assert.equal(j.writes.length,0);assert.equal(JSON.parse(w.localStorage.getItem('nexus_active_delegation')).substitutoId,uuid(2));assert.equal(j.confirmacoes.length,0);
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  {
    const j=await abrir(titular,ativa);const w=j.w;
    try{
      let confirmar;w.nexusConfirm=()=>new Promise(r=>confirmar=r);const pendente=w.nexusRevogarDelegacao();
      gravarPerfil(w,{...titular,supervisor_substituto:true});confirmar(true);assert.equal(await pendente,false);
      assert.equal(j.writes.length,0);assert.ok(JSON.parse(w.localStorage.getItem('nexus_active_delegation')));
    }finally{w.close();}
  }
  // Negativa surgida durante a leitura do titular impede INSERT e auditoria.
  {
    const j=await abrir(titular,null,{remoto:true});const w=j.w;
    try{
      preencher(w);let liberar;j.controle.adiarConfirmacaoFuncionario=new Promise(r=>liberar=r);enviar(w);await H.aguardar(0);
      gravarPerfil(w,{...titular,supervisor_substituto:true});liberar();await H.aguardar(30);
      assert.equal(j.writes.length,0);assert.equal(JSON.parse(w.localStorage.getItem('nexus_active_delegation')),null);assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  // Nova delegação associa o substituto pelo cadastro/CPF, não copia a matrícula do titular.
  {
    const j=await abrir(titular,null,{remoto:true});const w=j.w;
    try{
      preencher(w);enviar(w);await H.aguardar(50);const d=JSON.parse(w.localStorage.getItem('nexus_active_delegation'));
      assert.equal(d.substitutoId,uuid(2));assert.equal(d.substitutoMatricula,'MAT-2222');assert.equal(d.substituidoId,uuid(1));assert.equal(w.NexusAuth.isSupervisorSubstituto(),false);
      gravarPerfil(w,sub);assert.equal(w.NexusAuth.getSession().cargo,'SUPERVISOR_GERENTE_OPERACOES');assert.equal(w.NexusAuth.hasPermission('LIBERAR_CARGA'),true);assert.equal(w.NexusAuth.hasPermission('DESIGNAR_SUBSTITUTO'),false);
      assert.equal(w.NexusAuth.canAccessPage('delegacao.html'),false);
    }finally{w.close();}
  }
  {
    const j=await abrir(titular,ativa);try{assert.equal(await j.w.nexusRevogarDelegacao({confirmado:true}),true);assert.equal(j.w.localStorage.getItem('nexus_active_delegation'),null);}finally{j.w.close();}
  }
  {
    const j=await abrir(titular,null,{remoto:true});try{
      j.w.localStorage.setItem('nexus_active_delegation',JSON.stringify(ativa));j.controle.falharRevogacao=true;
      await j.w.nexusRevogarDelegacao({confirmado:true});assert.ok(JSON.parse(j.w.localStorage.getItem('nexus_active_delegation')),'Falha de revogação não remove presença da delegação no cache');
    }finally{j.w.close();}
  }
  console.log('✅ Tarefa 23: perfil explícito/derivado, vigência, titular legado, rota/menu, handlers, chamadas confirmadas, mudanças assíncronas, WebMCP e poderes de liberação preservados. Bloqueio no aplicativo, não substitui autorização no servidor.');
})().catch(e=>{console.error(e);process.exit(1);});
