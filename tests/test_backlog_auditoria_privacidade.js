/** Tarefa 20: matrícula/credencial não deve sair pelo Log, Trail, pesquisa ou WebMCP. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
const {criarBancoFalso}=require('./fake-supabase-db');
const uuid=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const session=H.sessao('SUPERVISOR_GERENTE_OPERACOES',{id:uuid(1),nome:'Gestora Atual',matricula:'MAT-9100',codigo_individual:'SUP-LOGIN-20'});
const funcionarios=[{id:uuid(2),nome:'Titular',cargo:'INSPETOR',matricula:'7654321',codigo_individual:'ACESSO.X+20',ativo:true}];
const motivo='Designação de MAT-8123; matrícula: 998877; titular 7654321; carga CRG-20, navio IMO-1234567.';
const retificacao='[Retificação por SUP-LOGIN-20]: ACESSO.X+20, MAT-8123. Mantida a justificativa.';
const logs=[{data_hora:'2026-10-15T14:00:00Z',nome_funcionario:'Gestora Atual',cargo:'SUPERVISOR_GERENTE_OPERACOES',codigo_usuario:'SUP-LOGIN-20',entidade:'FUNCIONARIO MAT-8123',entidade_tipo:'FUNCIONARIO',tipo_alteracao:'EDICAO'},
  {data_hora:'2026-10-15T13:00:00Z',cargo:'INSPETOR',codigo_usuario:'MAT-5555',entidade:'CARGA CRG-20',tipo_alteracao:'CRIACAO'},
  {data_hora:'2026-10-15T12:00:00Z',nome_funcionario:'<img src=x onerror=alert(1)> Nome',cargo:'INSPETOR',codigo_usuario:'ACESSO.X+20',entidade:'NAVIO IMO-1234567',tipo_alteracao:'EDICAO'}];
const trail=Array.from({length:3},(_,i)=>({id:`TRL-LEGADO-${i}`,data_hora:`2026-10-15T${14-i}:00:00Z`,responsavel:'Nome - Composto (Inspetor) - MAT-4444',decisao:'DESIGNOU_SUBSTITUTO',entidade:i===2?'CARGA CRG-20':'FUNCIONARIO 7654321',motivo,retificacao}));
async function abrir(remoto,cargo=session.cargo){
  const config={};
  const tabelas={funcionarios:[...funcionarios,{id:uuid(1),nome:session.nome,cargo:session.cargo,matricula:session.matricula,codigo_individual:session.codigo_individual}],
    logs_alteracoes:logs.map((l,i)=>({id:uuid(10+i),...l,nome_funcionario:undefined,codigo_individual:l.codigo_usuario,funcionario_id:i===0?uuid(1):null,entidade_tipo:i===0?'FUNCIONARIO':i===1?'CARGA':'NAVIO',entidade_id:i===0?'MAT-8123':i===1?'CRG-20':'IMO-1234567'})),
    trail_decisoes:trail.map((t,i)=>({id:uuid(20+i),data_hora:t.data_hora,tipo_decisao:t.decisao,codigo_individual:session.codigo_individual,funcionarios:{nome:'Nome - Composto',cargo:'INSPETOR'},entidade_tipo:i===2?'CARGA':'FUNCIONARIO',entidade_id:i===2?'CRG-20':'7654321',motivo,retificacoes_trail:[{retificacao}]}))};
  const db=criarBancoFalso(tabelas,config);
  const j=H.criarJanela({url:'https://nexusport.test/dashboard.html',html:H.htmlDaPagina('dashboard.html'),session:{...session,cargo},storage:{nexus_func_list:funcionarios,nexus_audit_logs:logs,nexus_trail_decisoes:trail},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();w.nexusSupabase=remoto?db:null;
      w.NexusRepository={getCargas:async()=>[],getNavios:async()=>[],lerTodasAsLinhas:async factory=>{const r=await factory();if(r.error)throw r.error;return r.data;}};
      w.mostrarFeedback=()=>{};
    },'js/auditoria.js','js/pages/dashboard.js','js/webmcp/webmcp-core.js','js/webmcp/webmcp-dados.js','js/webmcp/webmcp-dashboard.js']});
  await H.prontoDom(j.w);await H.aguardar(50);assert.deepEqual(j.erros,[]);
  return {...j,db,tabelas,config};
}
const identificadores=['MAT-9100','SUP-LOGIN-20','MAT-8123','MAT-4444','MAT-5555','7654321','998877','ACESSO.X+20'];
function semIdentificadores(saida){for(const id of identificadores)assert.ok(!saida.includes(id),`Identificador não pode ser exibido: ${id}`);}
const expandir=w=>{const b=w.document.getElementById('mostrarMaisTrailBtn');while(!b.disabled)b.click();};
const htmlPrivado=w=>['auditLogPanel','trailDecisoesPanel','registrarTrailModal'].map(id=>w.document.getElementById(id).outerHTML).join('\n');
(async()=>{
  for(const remoto of[false,true]){
    const j=await abrir(remoto);const w=j.w;
    try{
      const cacheAntes=['nexus_audit_logs','nexus_trail_decisoes','nexus_func_list'].map(k=>w.localStorage.getItem(k));
      const bancoAntes=JSON.stringify(j.tabelas);expandir(w);
      semIdentificadores(htmlPrivado(w));
      const d=w.document;
      assert.equal(d.querySelectorAll('#auditLogPanel thead th').length,5);
      assert.ok(Array.from(d.querySelectorAll('#auditLogTableBody tr')).every(r=>r.cells.length===5));
      assert.match(d.getElementById('trailDecisoesContainer').textContent,/Nome - Composto \(Inspetor\)|Nome - Composto \(INSPETOR\)/,'Nome composto e cargo mantidos');
      assert.match(htmlPrivado(w),/CRG-20/);assert.match(htmlPrivado(w),/IMO-1234567/);
      assert.equal(d.querySelector('#auditLogPanel img'),null,'Escaping XSS permanece ativo');
      const buscar=d.getElementById('buscarAuditLogInput');
      for(const termo of['MAT-8123','SUP-LOGIN-20','MAT-5555']){
        buscar.value=termo;buscar.dispatchEvent(new w.Event('input'));await H.aguardar(20);
        assert.equal(d.querySelector('#auditLogTableBody td').getAttribute('colspan'),'5','Pesquisa não permite inferir o identificador oculto');
        assert.match(d.getElementById('auditLogCounter').textContent,/Exibindo 0 de/);
      }
      buscar.value='CRG-20';buscar.dispatchEvent(new w.Event('input'));await H.aguardar(20);
      assert.match(d.getElementById('auditLogTableBody').textContent,/CRG-20/);
      for(const ferramenta of['listar_auditoria','listar_trilha_decisoes']){
        const r=await w.NexusWebMCP.executar(ferramenta,{limite:20});assert.equal(r.ok,true);semIdentificadores(JSON.stringify(r));
        const filtrado=await w.NexusWebMCP.executar(ferramenta,{entidade:'MAT-8123'});assert.equal(filtrado.dados.total,0);
      }
      // O formulário lista nomes + UUID, nunca matrícula; o vínculo gravado não é alterado.
      if(remoto){
        const dec=d.getElementById('trailTipoDecisao');dec.value='DESIGNOU_SUBSTITUTO';dec.dispatchEvent(new w.Event('change'));await H.aguardar(20);
        semIdentificadores(d.getElementById('trailEntidadeRegistro').outerHTML);
        assert.ok(Array.from(d.getElementById('trailEntidadeRegistro').options).some(o=>o.value===uuid(2)&&o.textContent.includes('Titular')));
      }
      assert.equal(JSON.stringify(j.tabelas),bancoAntes,'Exibir não reescreve a auditoria do banco');
      assert.deepEqual(['nexus_audit_logs','nexus_trail_decisoes','nexus_func_list'].map(k=>w.localStorage.getItem(k)),cacheAntes,'Exibir/pesquisar/WebMCP não modifica histórico/cache');
      assert.equal(j.db.log.length,0,'Nenhuma gravação para ocultar identificadores');
      if(remoto){j.config.falhar=['logs_alteracoes','trail_decisoes'];w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'trail_decisoes'}}));await H.aguardar(30);expandir(w);semIdentificadores(htmlPrivado(w));}
      // Nova retificação usa autoria nominal, preservando os campos originais do registro.
      w.nexusPrompt=async()=> 'Conferência concluída';await w.anexarRetificacaoTrail('TRL-LEGADO-0','');
      const r=JSON.parse(w.localStorage.getItem('nexus_trail_decisoes'))[0];
      assert.equal(r.motivo,motivo);assert.equal(r.entidade,trail[0].entidade);assert.match(r.retificacao,/Gestora Atual/);assert.ok(!r.retificacao.includes(session.codigo_individual));
      semIdentificadores(htmlPrivado(w));assert.deepEqual(j.erros,[]);
    }finally{w.close();}
  }
  // Regex com metacaracteres, credencial numérica legada e sem substituir trechos de códigos operacionais.
  const j=await abrir(false,'ESTIVADOR');
  try{
    const p=j.w.NexusSecurity.privacidadeAuditoria(funcionarios);
    assert.ok(!p.texto('ACESSO.X+20 / 7654321').includes('ACESSO.X+20'));assert.ok(!p.texto('ACESSO.X+20 / 7654321').includes('7654321'));
    assert.equal(p.texto('CRG-76543210 CRG-7654321 IMO-1234567'), 'CRG-76543210 CRG-7654321 IMO-1234567');
    assert.equal(j.w.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'),true,'Permissão de registrar decisões não é ampliada');
  }finally{j.w.close();}
  console.log('✅ Tarefa 20: Log/Trail, banco/cache/fallback, expansão, busca, seleção, retificações e WebMCP sem matrícula/credencial; histórico, operações e XSS preservados.');
})().catch(e=>{console.error(e);process.exit(1);});
