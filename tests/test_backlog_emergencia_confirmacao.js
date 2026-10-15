/** Tarefa 9: sidebar confirma o alerta sem relatório; preserva módulo global e auditoria. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const {criarBancoFalso} = require('./fake-supabase-db');
async function abrir(cargo='ESTIVADOR', real=false) {
  const chamadas=[]; const avisos=[];
  const banco=criarBancoFalso({emergencias:[],logs_alteracoes:[]});
  const j=H.criarJanela({url:'https://nexusport.test/dashboard.html',html:H.htmlDaPagina('dashboard.html'),session:H.sessao(cargo),
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js',w => {
      w.currentUserSession=w.NexusAuth.getSession();
      if (real) {
        const canal={on(){return this;},subscribe(){return this;},send:async () => ({status:'ok'})};
        // maybeSingle de uma consulta vazia devolve null, não um array vazio.
        const consultaEmergencia={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},maybeSingle:async () => ({data:null,error:null})};
        w.nexusSupabase={from:tabela => tabela === 'emergencias' ? consultaEmergencia : banco.from(tabela),channel:() => canal,functions:{invoke:async (nome,opcoes) => {
          chamadas.push({nome,opcoes});
          return {data:{ok:true,emergencia:{id:'11111111-1111-4111-8111-111111111111'},broadcast:{ok:true}},error:null};
        }}};
      } else {
        w.nexusEmergenciaAtiva=() => false;
        w.NexusPanic={triggerPanic:async opcoes => {chamadas.push(opcoes);return {ok:true};}};
      }
    },'js/layout.js',...(real ? ['js/panic-realtime.js'] : [])]});
  await H.prontoDom(j.w); await H.aguardar(50);
  const w=j.w;
  w.mostrarFeedback=(tipo,titulo,msg) => avisos.push({tipo,titulo,msg});
  assert.deepEqual(j.erros,[]);
  const modal=w.document.getElementById('nexusEmergencyModal');
  return {w,j,chamadas,avisos,banco,modal,
    abrir:() => {const b=w.document.getElementById('sidebarEmergencyBtn');b.focus();b.click();},
    confirmar:w.document.getElementById('nexusEmergencyConfirmBtn'),cancelar:w.document.getElementById('nexusEmergencyCancelBtn')};
}
const fechado=m => m.classList.contains('hidden');
(async () => {
  for (const cargo of ['ESTIVADOR','ARRUMADOR_CONSERTADOR','PLANEJADOR_PATIO_NAVIOS','TECNICO_PORTOS','INSPETOR','SUPERVISOR_GERENTE_OPERACOES']) {
    const t=await abrir(cargo);
    try {
      assert.equal(t.w.document.querySelectorAll('#nexusEmergencyModal').length,1);
      assert.equal(t.modal.querySelectorAll('input,select,textarea,form').length,0,'Sem formulário/relato');
      assert.equal(t.modal.getAttribute('role'),'alertdialog');
      t.confirmar.click(); assert.equal(t.chamadas.length,0,'Não acionar confirmação escondida');
      t.abrir(); assert.equal(fechado(t.modal),false);assert.equal(t.chamadas.length,0);
      assert.equal(t.w.document.activeElement,t.cancelar);
      t.cancelar.click(); assert.equal(fechado(t.modal),true);assert.equal(t.chamadas.length,0);
      assert.equal(t.w.document.activeElement,t.w.document.getElementById('sidebarEmergencyBtn'));
      t.abrir();t.modal.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert.equal(fechado(t.modal),true);assert.equal(t.chamadas.length,0);
      t.abrir();t.modal.click();assert.equal(fechado(t.modal),true);assert.equal(t.chamadas.length,0);
      t.abrir();t.confirmar.click();await H.aguardar(20);
      assert.equal(t.chamadas.length,1);assert.equal(t.chamadas[0].confirmar,false);
      assert.equal(Object.keys(t.chamadas[0]).length,1,'Não enviar relato estruturado');
      assert.equal(fechado(t.modal),true);assert.deepEqual(t.j.erros,[]);
    } finally {t.w.close();}
  }
  // Uma única requisição em andamento, com foco e estado acessível controlados.
  {
    const t=await abrir();
    try {
      let resolver;
      t.w.NexusPanic.triggerPanic=opcoes => {t.chamadas.push(opcoes);return new Promise(r => {resolver=r;});};
      t.abrir();
      t.cancelar.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
      assert.equal(t.w.document.activeElement,t.confirmar);
      t.confirmar.dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      assert.equal(t.w.document.activeElement,t.cancelar);
      t.confirmar.click();t.confirmar.dispatchEvent(new t.w.Event('click'));
      assert.equal(t.chamadas.length,1);
      assert.equal(t.confirmar.disabled,true);assert.equal(t.cancelar.disabled,true);
      assert.equal(t.modal.getAttribute('aria-busy'),'true');
      resolver({ok:true});await H.aguardar(20);assert.equal(fechado(t.modal),true);
    } finally {t.w.close();}
  }
  // Módulo ausente, falha retornada e exceção: não simular sucesso, permitir nova tentativa.
  for (const falha of ['ausente','retorno','excecao']) {
    const t=await abrir();
    try {
      if (falha === 'ausente') t.w.NexusPanic=null;
      else t.w.NexusPanic.triggerPanic=async () => {if(falha === 'excecao') throw new Error('Falha simulada');return {ok:false};};
      t.abrir();t.confirmar.click();await H.aguardar(20);
      assert.equal(fechado(t.modal),false);
      assert.equal(t.confirmar.disabled,false);assert.equal(t.cancelar.disabled,false);
      assert.ok(t.avisos.some(a => a.tipo === 'erro'));
      t.w.NexusPanic={triggerPanic:async () => ({ok:true})};
      t.confirmar.click();await H.aguardar(20);assert.equal(fechado(t.modal),true);
    } finally {t.w.close();}
  }
  // Emergência ativada por outro cliente antes ou durante a confirmação não é reenviada.
  {
    const t=await abrir();
    try {
      t.w.nexusEmergenciaAtiva=() => true;t.abrir();assert.equal(fechado(t.modal),true);
      t.w.nexusEmergenciaAtiva=() => false;t.abrir();
      t.w.nexusEmergenciaAtiva=() => true;t.confirmar.click();await H.aguardar(20);
      assert.equal(t.chamadas.length,0);assert.equal(fechado(t.modal),true);
    } finally {t.w.close();}
  }
  // Integração com NexusPanic real: a confirmação aciona a função e mantém a auditoria.
  {
    const t=await abrir('ESTIVADOR',true);
    try {
      t.w.NexusAssets={carregar:() => {throw new Error('Não deve carregar gerador de relatório');}};
      t.abrir();assert.equal(t.chamadas.length,0);
      t.confirmar.click();await H.aguardar(80);
      assert.equal(t.chamadas.length,1);assert.equal(t.chamadas[0].nome,'panic-alert');
      assert.equal(t.chamadas[0].opcoes.body.motivo,null);
      assert.equal(t.w.localStorage.getItem('nexus_emergency_active'),'true');
      assert.equal(t.banco.tabelas.logs_alteracoes.length,1);
      assert.equal(t.banco.tabelas.logs_alteracoes[0].entidade_tipo,'EMERGENCIA');
      assert.equal(fechado(t.modal),true);assert.deepEqual(t.j.erros,[]);
    } finally {t.w.close();}
  }
  console.log('✅ Tarefa 9: confirmação/cancelamento, teclado, falhas, clique duplo e integração real com NexusPanic e auditoria.');
})().catch(e => {console.error(e);process.exit(1);});
