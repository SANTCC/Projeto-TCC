/** T22: selecionar titular pelo nome, com vínculo inequívoco e sem fallback para a sessão. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const funcionarios=[
  {id:uuid(1),nome:'José Ávila',matricula:'MAT-1111',cargo:'SUPERVISOR_GERENTE_OPERACOES',ativo:true},
  {id:uuid(2),nome:'Jose Avila',matricula:'MAT-2222',cargo:'INSPETOR',ativo:true},
  {id:uuid(3),nome:'Inativo',matricula:'MAT-3333',cargo:'INSPETOR',ativo:false},
  {id:uuid(4),nome:'<img src=x onerror=alert(1)> Nome',matricula:'MAT-4444',cargo:'SUPERVISOR_GERENTE_OPERACOES',ativo:true}
];
function banco(){
  const tabelas={funcionarios:funcionarios.map(f=>({...f})),delegacoes_supervisor:[],logs_alteracoes:[],trail_decisoes:[]};
  const b={tabelas,escritas:[],falharConfirmacao:false,adiarLista:null,from(t){
    let unico=false,op='select',payload;const filtros=[];
    const q={select(){return q;},order(){return q;},limit(){return q;},range(){return q;},
      eq(c,v){filtros.push(r=>r[c]===v);return q;},in(c,vs){filtros.push(r=>vs.includes(r[c]));return q;},
      or(s){filtros.push(r=>s.split(',').some(f=>{const[c,oper,...v]=f.split('.');return oper==='eq'?String(r[c])===v.join('.'):String(r[c]||'').includes(v.join('.').replaceAll('%',''));}));return q;},
      maybeSingle(){unico=true;return q;},single(){unico=true;return q;},insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},
      then(res,rej){const rows=tabelas[t]||(tabelas[t]=[]);let data=rows.filter(r=>filtros.every(f=>f(r)));
        if(t==='funcionarios'&&unico&&b.falharConfirmacao)return Promise.resolve({data:null,error:{message:'sem rede'}}).then(res,rej);
        if(op==='insert'){const row={id:uuid(100+b.escritas.length),...payload};rows.push(row);data=[row];b.escritas.push({t,payload});}
        if(op==='update'){data.forEach(r=>Object.assign(r,payload));b.escritas.push({t,payload});}
        const resultado={data:unico?(data[0]?{...data[0]}:null):data.map(r=>({...r})),error:null};
        if(t==='funcionarios'&&!unico&&b.adiarLista){const promessa=b.adiarLista;b.adiarLista=null;return promessa.then(()=>resultado).then(res,rej);}
        return Promise.resolve(resultado).then(res,rej);
      }};return q;
  }};return b;
}
async function abrir(remoto=true,lista=funcionarios){
  const db=banco(),feedback=[];
  const j=H.criarJanela({url:'https://nexusport.test/delegacao.html',html:H.htmlDaPagina('delegacao.html'),session:H.sessao('SUPERVISOR_GERENTE_OPERACOES',{id:uuid(99),nome:'Ator da sessão',matricula:'MAT-9999'}),
    storage:{nexus_func_list:lista,nexus_active_delegation:null},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=remoto?db:null;
      w.NexusRepository={notifyChange(){},lerTodasAsLinhas:async factory=>{const r=await factory();if(r.error)throw r.error;return r.data;}};
      w.mostrarFeedback=(tipo,titulo,msg)=>feedback.push({tipo,titulo,msg});
    },'js/auditoria.js','js/pages/delegacao.js','js/webmcp/webmcp-core.js','js/webmcp/webmcp-dados.js','js/webmcp/webmcp-delegacao.js']});
  await H.prontoDom(j.w);await H.aguardar(35);assert.deepEqual(j.erros,[]);return {...j,db,feedback};
}
const select=w=>w.document.getElementById('delegSubstituidoNome');
const salvar=async w=>{w.document.getElementById('delegacaoForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await H.aguardar(35);};
function preencher(w,id){
  select(w).value=id;
  for(const [campo,valor]of Object.entries({delegSubstitutoNome:'Substituto Externo',delegSubstitutoCpf:'12345678901',delegSubstitutoDataNasc:'1990-01-01',delegDataInicio:'2026-10-20T08:00',delegDataFim:'2099-10-21T18:00'}))w.document.getElementById(campo).value=valor;
}
const atualizar=async w=>{w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'funcionarios'}}));await H.aguardar(30);};
(async()=>{
  for(const remoto of[true,false]){
    const j=await abrir(remoto),w=j.w;
    try{
      assert.equal(w.document.getElementById('delegSubstituidoMatricula'),null);
      assert.ok(w.document.querySelector('label[for="delegSubstituidoNome"]').textContent.includes('Nome'));
      const opcoes=Array.from(select(w).options);assert.equal(opcoes.length,4);assert.ok(!select(w).outerHTML.includes('MAT-'));
      const homonimos=opcoes.filter(o=>o.value===uuid(1)||o.value===uuid(2));assert.ok(homonimos.every(o=>o.textContent.includes('Referência')));assert.notEqual(homonimos[0].textContent,homonimos[1].textContent);
      assert.equal(select(w).querySelector('img'),null,'Nome não injeta HTML');
      preencher(w,'Nome inventado');await salvar(w);assert.equal(JSON.parse(w.localStorage.getItem('nexus_active_delegation')),null);assert.equal(j.db.escritas.length,0);
      preencher(w,uuid(2));
      if(remoto)j.db.tabelas.funcionarios[1].nome='Nome atualizado no servidor';
      await salvar(w);const ativo=JSON.parse(w.localStorage.getItem('nexus_active_delegation'));
      assert.equal(ativo.substituidoNome,remoto?'Nome atualizado no servidor':'Jose Avila');assert.equal(ativo.substituidoMatricula,'MAT-2222');assert.equal(ativo.referenciaFuncionario.id,uuid(2));
      assert.notEqual(ativo.referenciaFuncionario.id,uuid(99),'Titular não é o usuário logado');
      assert.ok(!w.document.getElementById('substitutoVigencia').textContent.includes('MAT-'));
      assert.ok(w.document.getElementById('substitutoNome').textContent.includes(ativo.substituidoNome));
      if(remoto){assert.equal(j.db.tabelas.delegacoes_supervisor[0].supervisor_titular_id,uuid(2));assert.equal(j.db.tabelas.trail_decisoes[0].detalhes.referencia_id,uuid(2));}
      assert.ok(!JSON.stringify(j.feedback).includes('MAT-2222'));
      const qtd=j.db.tabelas.delegacoes_supervisor.length;preencher(w,uuid(1));await salvar(w);assert.equal(j.db.tabelas.delegacoes_supervisor.length,qtd,'Limite de delegação ativa continua aplicado');
      const leitura=await w.NexusWebMCP.executar('obter_delegacao_ativa',{});assert.equal(leitura.ok,true);assert.ok(!JSON.stringify(leitura).includes('MAT-'));
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  for(const motivo of['inativo','removido','rede']){
    const j=await abrir();try{
      preencher(j.w,uuid(2));if(motivo==='inativo')j.db.tabelas.funcionarios[1].ativo=false;
      if(motivo==='removido')j.db.tabelas.funcionarios.splice(1,1);
      if(motivo==='rede')j.db.falharConfirmacao=true;
      await salvar(j.w);assert.equal(j.db.escritas.length,0,`Titular não confirmado (${motivo}) não delega para a sessão`);assert.equal(JSON.parse(j.w.localStorage.getItem('nexus_active_delegation')),null);
      assert.ok(j.feedback.some(f=>f.titulo==='Funcionário Não Confirmado'));
    }finally{j.w.close();}
  }
  {const j=await abrir(false,[]);try{assert.equal(select(j.w).disabled,true);preencher(j.w,'');await salvar(j.w);assert.equal(JSON.parse(j.w.localStorage.getItem('nexus_active_delegation')),null);}finally{j.w.close();}}
  {
    const locais=funcionarios.slice(0,2).map(({id,...f})=>f);const j=await abrir(false,locais);
    try{
      const s=select(j.w);s.value=Array.from(s.options).find(o=>o.textContent.includes('Jose Avila')).value;const chave=s.value;
      j.w.localStorage.setItem('nexus_func_list',JSON.stringify(locais.slice().reverse()));await atualizar(j.w);assert.equal(s.value,chave,'Chave local estável após reordenação do cache');
      preencher(j.w,chave);await salvar(j.w);const a=JSON.parse(j.w.localStorage.getItem('nexus_active_delegation'));assert.equal(a.substituidoMatricula,'MAT-2222');assert.equal(a.referenciaFuncionario.id,null,'Registro legado não herda ID da sessão');
    }finally{j.w.close();}
  }
  {
    const j=await abrir();try{
      select(j.w).value=uuid(2);await atualizar(j.w);assert.equal(select(j.w).value,uuid(2));
      let liberar;j.db.adiarLista=new Promise(r=>liberar=r);const antigo=atualizar(j.w);
      j.db.tabelas.funcionarios[1].nome='Titular mais recente';await atualizar(j.w);liberar();await antigo;await H.aguardar(15);
      assert.match(select(j.w).textContent,/Titular mais recente/);assert.equal(select(j.w).value,uuid(2));
      let envios=0;j.w.document.getElementById('delegacaoForm').addEventListener('submit',()=>envios++);
      const r=await j.w.NexusWebMCP.executar('preparar_designacao_substituto',{delegSubstituidoNome:uuid(2),delegSubstitutoNome:'Substituto',delegDataInicio:'2026-10-20T08:00',delegDataFim:'2026-10-21T18:00'});
      assert.equal(r.ok,true);assert.equal(select(j.w).value,uuid(2));assert.equal(envios,0,'WebMCP só prepara, não envia');
      assert.equal(j.w.document.getElementById('delegSubstitutoCpf').value,'');assert.equal(j.w.document.getElementById('delegSubstitutoDataNasc').value,'');
      assert.deepEqual(j.erros,[]);
    }finally{j.w.close();}
  }
  console.log('✅ Tarefa 22: nomes e homônimos, referência correta, servidor/cache legado, rejeição de titular inválido/inativo, concorrência de leitura, privacidade, XSS e preparação WebMCP.');
})().catch(e=>{console.error(e);process.exit(1);});
