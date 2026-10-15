/** Tarefa 7: agendamento não permite movimentação, sem afetar QR/recebimento/cancelamento. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const DESTINO = 'Pátio Principal (Setor A)';
const GND = 'ABC-123-DEF';
const base = {id:'CRG-TESTE-7', tipo:'Carga Geral', status:'AGENDAMENTO', portoDescarga:'Pátio STS-01 (Setor B)', qrCode:'QR-CRG-TESTE-7'};
async function abrir(cargo = 'SUPERVISOR_GERENTE_OPERACOES', status = 'AGENDAMENTO') {
  let dados = [{...base, status}];
  const j = H.criarJanela({url:'https://nexusport.test/cargas.html', html:H.htmlDaPagina('cargas.html'), session:H.sessao(cargo),
    storage:{nexus_cargas_fluxo:dados, nexus_guindastes_list:[{identificacao:GND,estado:'OPERANTE'}], nexus_guindaste_tarefas:[]},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',w => {
      w.currentUserSession=w.NexusAuth.getSession();
      w.NexusRepository={getCargas:async () => dados.map(c => ({...c}))};
    },'js/pages/cargas.js']});
  await H.prontoDom(j.w); await H.aguardar(50);
  const w=j.w;
  let logs=0;
  const avisos=[];
  w.registrarLogAlteracao=async () => {logs++;};
  w.mostrarFeedback=(tipo,titulo,msg) => avisos.push({tipo,titulo,msg});
  return {w,j,logs:() => logs,avisos,agendarNovamente:() => {
    dados=[{...base}];
    w.dispatchEvent(new w.CustomEvent('nexus_data_changed',{detail:{entity:'cargas'}}));
  }};
}
const tarefas = w => JSON.parse(w.localStorage.getItem('nexus_guindaste_tarefas'));
const cargas = w => JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
const modalAberto = w => !w.document.getElementById('movimentarModal').classList.contains('hidden');
const botaoMovimentar = w => Array.from(w.document.querySelectorAll('#cargasTableBody button')).find(b => b.textContent.includes('Movimentar'));

(async () => {
  for (const cargo of ['ESTIVADOR','INSPETOR','SUPERVISOR_GERENTE_OPERACOES','DIRETOR_OPERACOES_LOGISTICA']) {
    const {w,j,logs}=await abrir(cargo);
    try {
      assert.equal(botaoMovimentar(w).disabled,true,cargo);
      assert.equal(botaoMovimentar(w).getAttribute('aria-disabled'),'true');
      assert.equal(w.document.querySelector('[aria-label="Exibir QR Code"]').disabled,false);
      w.exibirEtiquetaQr(base);
      assert.equal(w.document.getElementById('qrModal').classList.contains('hidden'),false);
      assert.equal(w.document.getElementById('qrModalEntityId').textContent,base.id);
      await w.executarAcaoCarga(base.id,'MOVIMENTAR');
      assert.equal(modalAberto(w),false);
      w.abrirModalMovimentacao(base.id);
      assert.equal(modalAberto(w),false);
      await w.executarAcaoCarga(base.id,'MOVIMENTAR',{setorDestino:DESTINO,guindasteIdentificacao:GND});
      assert.equal(tarefas(w).length,0);
      assert.equal(logs(),0);
      assert.equal(cargas(w)[0].status,'AGENDAMENTO');
      assert.equal(cargas(w)[0].portoDescarga,base.portoDescarga);
      assert.equal(cargas(w)[0].guindasteDesignado,undefined);
      assert.deepEqual(j.erros,[]);
    } finally {w.close();}
  }
  // Receber continua funcionando e desbloqueia a movimentação na mesma tela.
  {
    const {w,j}=await abrir();
    try {
      assert.ok(w.document.querySelector('[aria-label="Receber carga"]'));
      assert.ok(w.document.querySelector('[aria-label="Cancelar carga"]'));
      await w.executarAcaoCarga(base.id,'RECEBER');
      assert.equal(cargas(w)[0].status,'RECEBIMENTO_INSPECAO');
      assert.equal(botaoMovimentar(w).disabled,false);
      await w.executarAcaoCarga(base.id,'MOVIMENTAR',{setorDestino:DESTINO,guindasteIdentificacao:GND});
      assert.equal(tarefas(w).length,1);
      assert.equal(tarefas(w)[0].destino,DESTINO);
      assert.equal(cargas(w)[0].status,'RECEBIMENTO_INSPECAO');
      assert.equal(cargas(w)[0].portoDescarga,base.portoDescarga,'Setor muda somente na conclusão da tarefa');
      assert.deepEqual(j.erros,[]);
    } finally {w.close();}
  }
  // Cancelar agendamento permanece funcional para quem já tinha permissão.
  {
    const {w}=await abrir();
    try {
      await w.executarAcaoCarga(base.id,'CANCELAR',{motivo:'Agendamento cancelado pelo cliente'});
      assert.equal(cargas(w)[0].status,'CANCELADA');
      assert.equal(cargas(w)[0].motivoCancelamento,'Agendamento cancelado pelo cliente');
      assert.equal(tarefas(w).length,0);
    } finally {w.close();}
  }
  // Modal aberto com carga recebida não pode criar tarefa após atualização para agendamento.
  {
    const {w,j,logs,agendarNovamente}=await abrir('ESTIVADOR','RECEBIMENTO_INSPECAO');
    try {
      w.abrirModalMovimentacao(base.id); await H.aguardar(20);
      assert.equal(modalAberto(w),true);
      agendarNovamente(); await H.aguardar(180);
      w.document.getElementById('movimentarSetorSelect').value=DESTINO;
      w.document.getElementById('movimentarGuindasteSelect').value=GND;
      w.document.getElementById('confirmMovimentarModalBtn').click(); await H.aguardar(30);
      assert.equal(tarefas(w).length,0);
      assert.equal(logs(),0);
      assert.deepEqual(j.erros,[]);
    } finally {w.close();}
  }
  // WebMCP bloqueia antes de consultar guindastes ou pedir confirmação.
  {
    const {w}=await abrir('ESTIVADOR');
    try {
      let ferramentas;
      w.NexusWebMCP={registrarPagina:p => {ferramentas=p.ferramentas;}};
      w.NexusWebMCPDados={GRUPOS:{todos:['ESTIVADOR']}, cargasDoOperador:async () => cargas(w), quandoPronto:f => f()};
      w.eval(H.read('js/webmcp/webmcp-cargas.js'));
      const mover=ferramentas.find(f => f.nome === 'movimentar_carga');
      assert.equal((await mover.precondicao({id:base.id,guindaste:GND,setor:DESTINO})).codigo,'RECEBIMENTO_OBRIGATORIO');
    } finally {w.close();}
  }
  console.log('✅ Tarefa 7: agendamento bloqueado em botão/modal/ação/WebMCP; QR, Receber e Cancelar preservados.');
})().catch(e => {console.error(e);process.exit(1);});
