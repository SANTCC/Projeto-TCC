/** Tarefa 21, ocultação parcial autorizada: não representa controle de acesso no servidor. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const uid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const funcionarios=[{id:uid(1),matricula:'MAT-1234',nome:'Pessoa Um',cargo:'ESTIVADOR',codigo_individual:'NX-1234-5555',cpf:'12345678901',data_nascimento:'1990-01-01',ativo:true},
  {id:uid(2),matricula:'MAT-5678',nome:'Pessoa Dois',cargo:'INSPETOR',codigo_individual:'NX-5678-7777',cpf:'98765432109',data_nascimento:'1985-02-03',ativo:true}];
function banco(){
  const tabelas={funcionarios:funcionarios.map(f=>({...f})),visitantes:[]};const gravacoes=[];let n=20;
  return {tabelas,gravacoes,from(t){
    let op='select',payload,unico=false;const filtros=[];
    const b={select(){return b;},order(){return b;},limit(){return b;},range(){return b;},
      eq(c,v){filtros.push(r=>r[c]===v);return b;},in(c,v){filtros.push(r=>v.includes(r[c]));return b;},
      or(s){const clausulas=s.split(',').map(x=>x.split('.'));filtros.push(r=>clausulas.some(([c,oper,...valor])=>oper==='eq'?String(r[c])===valor.join('.'):String(r[c]||'').includes(valor.join('.').replaceAll('%',''))));return b;},
      maybeSingle(){unico=true;return b;},single(){unico=true;return b;},
      insert(p){op='insert';payload=p;return b;},update(p){op='update';payload=p;return b;},
      then(res,rej){const rows=tabelas[t]||(tabelas[t]=[]);let data=rows.filter(r=>filtros.every(f=>f(r)));
        if(op==='insert'){const row={id:uid(++n),...payload};rows.push(row);data=[row];gravacoes.push({t,payload});}
        if(op==='update'){data.forEach(r=>Object.assign(r,payload));gravacoes.push({t,payload});}
        return Promise.resolve({data:unico?(data[0]||null):data.map(r=>({...r})),error:null}).then(res,rej);
      }};return b;
  }};
}
async function abrir(remoto,cargo='DIRETOR_PRESIDENTE_SUPERINTENDENTE'){
  const db=banco();const feedback=[],confirmacoes=[],exclusoes=[],pedidos=[];const controle={recusar:false};
  const j=H.criarJanela({url:'https://nexusport.test/tecnico_portos.html',html:H.htmlDaPagina('tecnico_portos.html'),
    session:H.sessao(cargo,{id:uid(9),nome:'Titular Atual',matricula:'MAT-9100'}),
    storage:{nexus_func_list:funcionarios.map(f=>({...f,codigo:f.codigo_individual})),nexus_vis_list:[{id:'VIS-1',nome:'Visitante',motivo:'Visita',por:'MAT-1234',status:'EM_VISITA'},{id:'VIS-2',nome:'Antigo',por:'MAT-5678',status:'CONCLUIDO'},{id:'VIS-3',nome:'Sem cadastro',por:'9998887',status:'CONCLUIDO'}]},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=remoto?db:null;
      w.mostrarFeedback=(tipo,titulo,msg)=>feedback.push({tipo,titulo,msg});w.nexusConfirm=async(t,msg)=>{confirmacoes.push({t,msg});return true;};
      w.NexusRepository={notifyChange(){},deleteFuncionario:async mat=>{
        exclusoes.push(mat);if(controle.recusar)return {ok:false,erro:`Vínculo impede excluir ${mat}`};
        db.tabelas.funcionarios=db.tabelas.funcionarios.filter(f=>f.matricula!==mat);
        w.localStorage.setItem('nexus_func_list',JSON.stringify(JSON.parse(w.localStorage.getItem('nexus_func_list')).filter(f=>f.matricula!==mat)));
        return {ok:true,removido:true};
      }};
    },'js/auditoria.js','js/pages/tecnico_portos.js','js/webmcp/webmcp-core.js','js/webmcp/webmcp-dados.js','js/webmcp/webmcp-tecnico.js']});
  await H.prontoDom(j.w);await H.aguardar(40);assert.deepEqual(j.erros,[]);
  j.w.NexusWebMCP.iniciar({confirmar:async p=>{pedidos.push(p);return true;}});
  return {...j,db,feedback,confirmacoes,exclusoes,pedidos,controle};
}
const semMat=s=>{for(const mat of['MAT-1234','MAT-5678','MAT-9100','9998887'])assert.ok(!s.includes(mat),`Matrícula exposta: ${mat}`);};
(async()=>{
  for(const remoto of[true,false])for(const cargo of['DIRETOR_PRESIDENTE_SUPERINTENDENTE','DIRETOR_OPERACOES_LOGISTICA','CONSELHO_ADMINISTRACAO','TECNICO_PORTOS']){
    const j=await abrir(remoto,cargo),w=j.w,d=w.document;
    try{
      const antes=w.localStorage.getItem('nexus_func_list');const bancoAntes=JSON.stringify(j.db.tabelas.funcionarios);
      const tabela=d.getElementById('funcCrudTableBody');semMat(tabela.outerHTML);
      assert.equal(tabela.rows.length,2);assert.ok(Array.from(tabela.rows).every(r=>r.cells.length===5));
      assert.ok(!/NX-1234|NX-5678/.test(tabela.outerHTML),'Código derivado da matrícula também sai da listagem');
      assert.ok(d.getElementById('funcMatricula').required,'Matrícula permanece no cadastro');
      assert.equal(d.getElementById('funcMatricula').value,'');
      assert.equal(w.localStorage.getItem('nexus_func_list'),antes);assert.equal(JSON.stringify(j.db.tabelas.funcionarios),bancoAntes);
      const input=d.getElementById('empMatriculaSearch');input.value='Pessoa';input.dispatchEvent(new w.Event('input'));await H.aguardar(150);
      const sugestoes=d.getElementById('empSearchSuggest');semMat(sugestoes.outerHTML);assert.equal(sugestoes.querySelectorAll('button').length,2);
      const opcao=Array.from(sugestoes.querySelectorAll('button')).find(b=>b.textContent.includes('Pessoa Dois'));opcao.click();await H.aguardar(30);
      assert.equal(input.value,'Pessoa Dois');assert.equal(d.getElementById('resEmpNome').textContent,'Pessoa Dois');semMat(d.getElementById('empSearchResultBox').outerHTML);
      assert.equal(d.getElementById('resEmpCodigo').textContent,'Protegido');
      for(const tool of['listar_funcionarios','pesquisar_funcionario']){
        const r=await w.NexusWebMCP.executar(tool,tool==='pesquisar_funcionario'?{matricula:'1234'}:{});assert.equal(r.ok,true);semMat(JSON.stringify(r));assert.ok(!JSON.stringify(r.dados).includes('matricula'));
      }
      const nf=await w.NexusWebMCP.executar('pesquisar_funcionario',{matricula:'MAT-1234X'});assert.equal(nf.ok,false);assert.ok(!JSON.stringify(nf).includes('MAT-1234X'));
      assert.equal(j.db.gravacoes.length,0,'Ocultação/pesquisa não grava o banco');
      if(!remoto){semMat(d.getElementById('visCrudTableBody').outerHTML);semMat(d.getElementById('visHistoricoTableBody').outerHTML);}
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  for(const remoto of[true,false]){
    const j=await abrir(remoto),w=j.w,d=w.document;
    try{
      // Cadastro mantém matrícula e validações; a nova linha não a publica.
      const campos={funcMatricula:'MAT-4321',funcNome:'Pessoa Nova',funcCargo:'ESTIVADOR',funcCpf:'11122233344',funcDataNasc:'2000-01-01'};
      for(const [id,value]of Object.entries(campos))d.getElementById(id).value=value;
      d.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await H.aguardar(40);
      const novo=JSON.parse(w.localStorage.getItem('nexus_func_list')).find(f=>f.nome==='Pessoa Nova');assert.equal(novo.matricula,'MAT-4321');
      if(remoto)assert.equal(j.db.gravacoes.find(g=>g.t==='funcionarios').payload.matricula,'MAT-4321');
      assert.ok(!d.getElementById('funcCrudTableBody').outerHTML.includes('MAT-4321'));
      // Exclusão por índice usa a matrícula certa internamente, sem colocá-la em confirmação/feedback.
      const linha=Array.from(d.getElementById('funcCrudTableBody').rows).find(r=>r.textContent.includes('Pessoa Dois'));
      const onclick=linha.querySelector('button').getAttribute('onclick');assert.ok(!onclick.includes('MAT-'));const indice=onclick.match(/\('([^']+)'\)/)[1];
      j.controle.recusar=true;await w.excluirFuncionarioPorIndice(indice);semMat(JSON.stringify(j.confirmacoes));semMat(JSON.stringify(j.feedback.filter(f=>f.titulo==='Exclusão Não Realizada')));
      assert.equal(j.exclusoes.at(-1),'MAT-5678');
      j.controle.recusar=false;await w.excluirFuncionarioPorIndice(indice);assert.ok(!d.getElementById('funcCrudTableBody').textContent.includes('Pessoa Dois'));semMat(JSON.stringify(j.confirmacoes));
      // Reemissão autorizada permanece explícita: novo código só na tela, nunca no resultado do agente.
      const r=await w.NexusWebMCP.executar('reemitir_codigo_funcionario',{matricula:'MAT-1234'});assert.equal(r.ok,true);semMat(JSON.stringify(r));semMat(JSON.stringify(j.pedidos));
      const overrides=JSON.parse(w.localStorage.getItem('nexus_code_overrides'));assert.equal(overrides['MAT-1234'].old_codigo,'NX-1234-5555');
      assert.equal(d.getElementById('newGeneratedCode').textContent,overrides['MAT-1234'].codigo);
      const desativado=await w.NexusWebMCP.executar('desativar_funcionario',{matricula:'MAT-1234'});assert.equal(desativado.ok,true);semMat(JSON.stringify(desativado));semMat(JSON.stringify(j.pedidos));
      assert.ok(!JSON.parse(w.localStorage.getItem('nexus_func_list')).some(f=>f.matricula==='MAT-1234'));
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  console.log('✅ Tarefa 21 (ocultação parcial): banco/cache, quatro cargos, lista, sugestões, seleção, cadastro, confirmação/exclusão, autoria e WebMCP; reemissão explícita preservada. Exclusividade no servidor permanece pendente.');
})().catch(e=>{console.error(e);process.exit(1);});
