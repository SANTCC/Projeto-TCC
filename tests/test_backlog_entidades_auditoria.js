/** Tarefa 14: tipos explícitos no Trail e nos registros; API compartilhada e legada. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const H=require('./webmcp-harness');
const uuid=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
function banco(tabelas) {
  let n=100;
  const db={tabelas,falharTrail:false,from(tabela){
    let payload,operacao='select',unico=false;const filtros=[];
    const b={select(){return b;},order(){return b;},limit(){return b;},range(){return b;},or(){return b;},
      eq(c,v){filtros.push(r=>r[c]===v);return b;},in(c,v){filtros.push(r=>v.includes(r[c]));return b;},
      maybeSingle(){unico=true;return b;},single(){unico=true;return b;},
      insert(p){payload=p;operacao='insert';return b;},update(p){payload=p;operacao='update';return b;},
      then(res,rej){
        const rows=tabelas[tabela]||(tabelas[tabela]=[]);
        let data;
        if(operacao==='insert'){
          if(db.falharTrail&&tabela==='trail_decisoes')return Promise.resolve({data:null,error:{message:'falha simulada'}}).then(res,rej);
          const row={id:uuid(++n),...payload};rows.push(row);data=[row];
        }else{
          data=rows.filter(r=>filtros.every(f=>f(r)));
          if(operacao==='update')data.forEach(r=>Object.assign(r,payload));
        }
        const resultado={data:unico?(data[0]||null):data.map(r=>({...r})),error:null};
        return (db.adiarNavios&&tabela==='navios' ? new Promise(resolve=>setTimeout(()=>resolve(resultado),45)) : Promise.resolve(resultado)).then(res,rej);
      }};
    return b;
  },channel(){return {on(){return this;},subscribe(){return {};}};}};
  return db;
}
const casos=[
  {tipo:'CARGA',dec:'APROVOU_CARGA',tabela:'cargas',row:{id:uuid(1),qr_code_url:'QR-CRG-TESTE-14',natureza:'Geral',status_fluxo:'ARMAZENAGEM'},codigo:'CRG-TESTE-14'},
  {tipo:'FUNCIONARIO',dec:'DESIGNOU_SUBSTITUTO',tabela:'funcionarios',row:{id:uuid(2),nome:'Titular de teste',matricula:'MAT-2011',ativo:true},codigo:'MAT-2011'},
  {tipo:'NAVIO',dec:'LIBEROU_NAVIO',tabela:'navios',row:{id:uuid(3),nome:'Navio de teste',numero_imo:'IMO-1234567'},codigo:'IMO-1234567'},
  {tipo:'CONTAINER',dec:'SOLICITOU_MANUTENCAO_CONTAINER',tabela:'containers',row:{id:uuid(4),numero_identificacao:'ABCD-1234567'},codigo:'ABCD-1234567'},
  {tipo:'GUINDASTE',dec:'SOLICITOU_MANUTENCAO_CONTAINER',tabela:'guindastes',row:{id:uuid(5),numero_identificacao:'ABC-123-DEF'},codigo:'ABC-123-DEF'}
];
async function abrir(pagina='dashboard'){
  const tabelas={};casos.forEach(c=>tabelas[c.tabela]=[{...c.row}]);const db=banco(tabelas);
  const j=H.criarJanela({url:`https://nexusport.test/${pagina}.html`,html:H.htmlDaPagina(`${pagina}.html`),session:H.sessao('SUPERVISOR_GERENTE_OPERACOES',{id:uuid(2)}),
    storage:{nexus_trail_decisoes:[],nexus_audit_logs:[]},scripts:[
      'js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',w=>{
        w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=db;
        w.NexusRepository={getCargas:async()=>[],notifyChange(){},lerTodasAsLinhas:async factory=>{const r=await factory();return r.data||[];}};
        w.mostrarFeedback=()=>{};
      },'js/auditoria.js',`js/pages/${pagina}.js`]});
  await H.prontoDom(j.w);await H.aguardar(25);assert.deepEqual(j.erros,[]);
  return {...j,db,tabelas};
}
(async()=>{
  // Dependência compartilhada carregada em todas as páginas internas, sem injetar o dashboard nelas.
  for(const file of fs.readdirSync(path.join(__dirname,'..')).filter(f=>f.endsWith('.html'))){
    const src=H.read(file);if(!src.includes('src="js/layout.js"'))continue;
    assert.ok(src.indexOf('src="js/auditoria.js"')>src.indexOf('src="js/auth-guard.js"'),file);
    assert.ok(src.indexOf('src="js/auditoria.js"')<src.indexOf('src="js/layout.js"'),file);
  }
  const t=await abrir();const w=t.w;
  try{
    for(const c of casos){
      const dec=w.document.getElementById('trailTipoDecisao');dec.value=c.dec;dec.dispatchEvent(new w.Event('change'));
      await H.aguardar(10);
      const tipo=w.document.getElementById('trailEntidadeTipo');
      assert.ok(Array.from(tipo.options).some(o=>o.value===c.tipo),`Tipo disponível: ${c.tipo}`);
      tipo.value=c.tipo;tipo.dispatchEvent(new w.Event('change'));await H.aguardar(10);
      const reg=w.document.getElementById('trailEntidadeRegistro');
      assert.ok(Array.from(reg.options).some(o=>o.value===c.row.id));reg.value=c.row.id;
      w.document.getElementById('trailMotivoInput').value='Justificativa de teste';
      w.document.getElementById('registrarTrailForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await H.aguardar(20);
      const tr=t.tabelas.trail_decisoes.at(-1),log=t.tabelas.logs_alteracoes.at(-1);
      assert.equal(tr.entidade_tipo,c.tipo);assert.equal(tr.entidade_id,c.codigo);
      assert.equal(tr.detalhes.referencia_id,c.row.id);
      assert.equal(log.entidade_tipo,c.tipo,'Log complementar preserva o tipo do Trail');
      assert.equal(log.entidade_id,c.codigo);assert.equal(log.detalhes.referencia_id,c.row.id);
      assert.equal(JSON.parse(w.localStorage.getItem('nexus_trail_decisoes'))[0].entidade,`${c.tipo} ${c.codigo}`);
      assert.equal(JSON.parse(w.localStorage.getItem('nexus_audit_logs'))[0].entidade,`${c.tipo} ${c.codigo}`);
    }
    // Tarefa 15: o registro antigo continua acessível pela expansão do Trail.
    while (!w.document.getElementById('mostrarMaisTrailBtn').disabled) w.document.getElementById('mostrarMaisTrailBtn').click();
    assert.match(w.document.getElementById('trailDecisoesContainer').textContent,/FUNCIONARIO \(identificação protegida\)/);
    assert.match(w.document.getElementById('auditLogTableBody').textContent,/FUNCIONARIO \(identificação protegida\)/);
    // A API legada dos cadastros não troca ação/tabela/id e aceita códigos sem prefixo do tipo.
    for(const c of casos){
      await w.registrarLogAlteracao('CRIACAO',c.tabela,c.row.id,{matricula:c.row.matricula});
      const row=t.tabelas.logs_alteracoes.at(-1);
      assert.equal(row.entidade_tipo,c.tipo);assert.equal(row.entidade_id,c.row.id);assert.equal(row.tipo_alteracao,'CRIACAO');
    }
    t.db.adiarNavios=true;
    const escolha=w.document.getElementById('trailTipoDecisao');
    escolha.value='LIBEROU_NAVIO';escolha.dispatchEvent(new w.Event('change'));
    escolha.value='DESIGNOU_SUBSTITUTO';escolha.dispatchEvent(new w.Event('change'));
    await H.aguardar(65);
    assert.equal(w.document.getElementById('trailEntidadeTipo').value,'FUNCIONARIO');
    assert.deepEqual(Array.from(w.document.getElementById('trailEntidadeRegistro').options).map(o=>o.value),['',uuid(2)],'Resposta tardia de navios não substitui funcionários');
    t.db.adiarNavios=false;
    await w.registrarTrailDecisao('DESIGNOU_SUBSTITUTO','MAT-2011','Designação automática');
    assert.equal(t.tabelas.trail_decisoes.at(-1).entidade_tipo,'FUNCIONARIO');
    assert.equal(t.tabelas.logs_alteracoes.at(-1).entidade_tipo,'FUNCIONARIO');
    const qtd=t.tabelas.trail_decisoes.length;
    assert.equal((await w.registrarTrailDecisao('LIBEROU_NAVIO','MAT-2011','inválido',{tipo:'FUNCIONARIO',codigo:'MAT-2011',id:uuid(2)})).ok,false);
    assert.equal(t.tabelas.trail_decisoes.length,qtd);
    t.db.falharTrail=true;
    assert.equal((await w.registrarTrailDecisao('LIBEROU_NAVIO','IMO-1234567','falha',{tipo:'NAVIO',codigo:'IMO-1234567',id:uuid(3)})).ok,false);
    assert.equal(t.tabelas.trail_decisoes.length,qtd);
    assert.deepEqual(t.erros,[]);
  }finally{w.close();}
  // Delegação real antes dependia de variáveis inexistentes e identificava o registro como carga.
  {
    const j=await abrir('delegacao');
    try{
      const d=j.w.document;
      for(const [id,value] of Object.entries({delegSubstituidoNome:uuid(2),delegSubstitutoNome:'Substituto externo',delegSubstitutoCpf:'12345678901',delegDataInicio:'2026-10-16T08:00',delegDataFim:'2026-10-20T18:00'}))d.getElementById(id).value=value;
      d.getElementById('delegacaoForm').dispatchEvent(new j.w.Event('submit',{cancelable:true}));await H.aguardar(50);
      assert.equal(j.tabelas.trail_decisoes[0].entidade_tipo,'FUNCIONARIO');
      assert.equal(j.tabelas.trail_decisoes[0].entidade_id,'MAT-2011');
      assert.equal(j.tabelas.trail_decisoes[0].detalhes.referencia_id,uuid(2));
      assert.ok(j.tabelas.logs_alteracoes.every(row=>row.entidade_tipo==='FUNCIONARIO'));
      assert.ok(!JSON.stringify(j.tabelas.logs_alteracoes).includes('12345678901'),'CPF do substituto não é necessário na auditoria da designação');
      assert.deepEqual(j.erros,[]);
    }finally{j.w.close();}
  }
  console.log('✅ Tarefa 14: cinco entidades, códigos e referências preservados no banco/cache e tipos na UI, API legada, compatibilidade, falha sem falso sucesso e delegação real.');
})().catch(e=>{console.error(e);process.exit(1);});
