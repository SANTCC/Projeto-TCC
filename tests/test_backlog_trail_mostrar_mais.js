/** Tarefa 15: dois registros por página visual, sem truncar cache ou alterar o Trail. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const registro=n=>({id:`TRL-TESTE-${n}`,data_hora:`2026-10-${String(n+1).padStart(2,'0')}T12:00:00Z`,decisao:'DESIGNOU_SUBSTITUTO',entidade:`FUNCIONARIO MAT-${2000+n}`,responsavel:'Responsável de teste',motivo:`Motivo ${n}`,retificacao:n===2?'Retificação anterior':null});
const dbRow=n=>({id:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,data_hora:registro(n).data_hora,tipo_decisao:'DESIGNOU_SUBSTITUTO',entidade_tipo:'FUNCIONARIO',entidade_id:`MAT-${2000+n}`,motivo:`Motivo ${n}`,funcionarios:{nome:'Responsável de teste',cargo:'INSPETOR'},retificacoes_trail:[]});
async function abrir(lista,{banco=false,cargo='INSPETOR'}={}){
  const estado={rows:[],leituras:0,escritas:0,pendente:null,falhar:false};
  const j=H.criarJanela({url:'https://nexusport.test/dashboard.html',html:H.htmlDaPagina('dashboard.html'),session:H.sessao(cargo),storage:{nexus_trail_decisoes:lista},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();
      w.NexusRepository={getCargas:async()=>[],getNavios:async()=>[],lerTodasAsLinhas:async factory=>(await factory()).data||[]};
      if(banco)w.nexusSupabase={from:t=>{
        const b={select(){return b;},order(){return b;},in(){return b;},eq(){return b;},insert(){estado.escritas++;return b;},then(res,rej){
          if(t!=='trail_decisoes')return Promise.resolve({data:[],error:null}).then(res,rej);
          estado.leituras++;
          const dados={data:estado.rows.map(r=>({...r})),error:estado.falhar?{message:'falha simulada'}:null};
          if(estado.pendente){const adiar=estado.pendente;estado.pendente=null;return adiar.then(()=>dados).then(res,rej);}
          return Promise.resolve(dados).then(res,rej);
        }};return b;
      }};
    },'js/auditoria.js','js/pages/dashboard.js']});
  await H.prontoDom(j.w);await H.aguardar(25);assert.deepEqual(j.erros,[]);
  return {...j,estado};
}
const cartoes=w=>Array.from(w.document.getElementById('trailDecisoesContainer').children).filter(n=>n.querySelector('button'));
const botao=w=>w.document.getElementById('mostrarMaisTrailBtn');
const contador=w=>w.document.getElementById('trailDecisoesContador').textContent;
const atualizar=async w=>{w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'trail_decisoes'}}));await H.aguardar(20);};
(async()=>{
  for(const quantidade of [0,1,2,3,5,7]){
    const lista=Array.from({length:quantidade},(_,i)=>registro(i)).reverse();
    if(quantidade>2)[lista[0],lista[2]]=[lista[2],lista[0]]; // Entrada fora de ordem.
    const j=await abrir(lista);const w=j.w;
    try{
      assert.equal(cartoes(w).length,Math.min(2,quantidade));
      assert.equal(contador(w),`Exibindo ${Math.min(2,quantidade)} de ${quantidade} registros`);
      assert.equal(botao(w).classList.contains('hidden'),quantidade<=2);
      assert.equal(botao(w).getAttribute('aria-controls'),'trailDecisoesContainer');
      assert.equal(w.document.getElementById('trailDecisoesContador').getAttribute('aria-live'),'polite');
      let limite=2;
      while(!botao(w).disabled){botao(w).click();limite+=2;assert.equal(cartoes(w).length,Math.min(limite,quantidade));}
      assert.equal(botao(w).classList.contains('hidden'),true);
      const antes=cartoes(w).length;botao(w).click();assert.equal(cartoes(w).length,antes);
      const ids=cartoes(w).map(c=>c.querySelector('span').textContent);
      assert.deepEqual(ids,Array.from({length:quantidade},(_,i)=>registro(quantidade-1-i).id));
      assert.equal(new Set(ids).size,quantidade,'Sem repetição entre páginas visuais');
      assert.deepEqual(JSON.parse(w.localStorage.getItem('nexus_trail_decisoes')),lista,'Histórico inteiro permanece intacto e disponível');
      if(quantidade>2)assert.ok(w.document.getElementById('trailDecisoesContainer').textContent.includes('Retificação anterior'));
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  {
    const lista=[0,1,2,3,4].map(registro);const j=await abrir(lista);const w=j.w;
    try{
      botao(w).click();assert.equal(cartoes(w).length,4);
      w.localStorage.setItem('nexus_trail_decisoes',JSON.stringify([...lista,registro(5)]));await atualizar(w);
      assert.equal(cartoes(w).length,4,'Atualização mantém limite escolhido pelo operador');
      assert.ok(cartoes(w)[0].textContent.includes('TRL-TESTE-5'),'Novo registro entra no topo');
      assert.equal(contador(w),'Exibindo 4 de 6 registros');
      botao(w).click();assert.equal(cartoes(w).length,6);
      w.nexusPrompt=async()=>'<img src=x onerror=alert(1)> Retificação de teste';
      await w.anexarRetificacaoTrail('TRL-TESTE-0','');
      assert.equal(cartoes(w).length,6,'Retificar item expandido não recolhe a lista');
      assert.equal(w.document.querySelector('#trailDecisoesContainer img'),null);
      const alterado=JSON.parse(w.localStorage.getItem('nexus_trail_decisoes')).find(r=>r.id==='TRL-TESTE-0');
      assert.equal(alterado.motivo,registro(0).motivo);assert.match(alterado.retificacao,/Retificação de teste/);
    }finally{w.close();}
  }
  {
    const j=await abrir([],{banco:true});const w=j.w;
    try{
      j.estado.rows=[4,1,3,0,2].map(dbRow);await atualizar(w);
      assert.equal(cartoes(w).length,2);const leituras=j.estado.leituras;
      botao(w).click();botao(w).click();
      assert.equal(cartoes(w).length,5);assert.equal(j.estado.leituras,leituras,'Mostrar mais não repete consultas nem grava auditoria');
      assert.equal(j.estado.escritas,0);
      let liberar;j.estado.pendente=new Promise(resolve=>{liberar=resolve;});
      const antiga=atualizar(w);
      j.estado.rows=[dbRow(6)];await atualizar(w);liberar();await antiga;await H.aguardar(10);
      assert.equal(cartoes(w).length,1);assert.ok(cartoes(w)[0].textContent.includes('TRL-00000006') && cartoes(w)[0].textContent.includes('Motivo 6'),'Resposta antiga não sobrescreve a mais recente (identificada pelo ID do Trail e motivo, sem matrícula)');
      j.estado.falhar=true;w.localStorage.setItem('nexus_trail_decisoes',JSON.stringify([registro(0)]));await atualizar(w);
      assert.equal(cartoes(w).length,1);assert.ok(cartoes(w)[0].textContent.includes('TRL-TESTE-0'),'Falha de leitura mantém fallback local existente');
      assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  {
    const j=await abrir([0,1,2].map(registro),{cargo:'TECNICO_PORTOS'});
    try{
      assert.equal(cartoes(j.w).length,2);botao(j.w).click();assert.equal(cartoes(j.w).length,3);
      assert.ok(j.w.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'),'Consultar mais não concede registro manual');
    }finally{j.w.close();}
  }
  console.log('✅ Tarefa 15: últimos dois, expansão de dois em dois, ordenação, limites, atualização sem recolher, retificações, segurança, cache e leitura remota preservados.');
})().catch(e=>{console.error(e);process.exit(1);});
