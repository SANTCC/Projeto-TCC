/** Tarefa 4: Técnico consulta o painel, mas não insere decisões críticas manualmente. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');

async function abrir(cargo) {
  const j = H.criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: H.htmlDaPagina('dashboard.html'),
    session: H.sessao(cargo),
    storage: {nexus_trail_decisoes: [], nexus_audit_logs: []},
    scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', w => {
      w.currentUserSession = w.NexusAuth.getSession();
    }, 'js/auditoria.js', 'js/pages/dashboard.js']
  });
  await H.prontoDom(j.w); await H.aguardar(60);
  assert.deepEqual(j.erros, [], 'Painel sem erros de execução');
  return j;
}

(async () => {
  const j = await abrir('TECNICO_PORTOS');
  const w = j.w;
  try {
    assert.equal(w.NexusAuth.canAccessPage('dashboard.html'), true);
    assert.equal(w.NexusAuth.canAccessPage('tecnico_portos.html'), true);
    assert.equal(w.NexusAuth.hasPermission('CADASTRAR_VISITANTE'), true);
    assert.equal(w.NexusAuth.hasPermission('CADASTRAR_DOCUMENTO_FUNCIONARIO'), true);
    const botao = w.document.getElementById('toggleRegistrarTrailBtn');
    const modal = w.document.getElementById('registrarTrailModal');
    assert.ok(botao.classList.contains('hidden'), 'Botão oculto para o Técnico');
    // Remover a classe visual não deve permitir a abertura do modal.
    botao.classList.remove('hidden'); botao.click();
    assert.ok(modal.classList.contains('hidden'), 'Manipular o botão não libera o modal');

    const registrarOriginal = w.registrarTrailDecisao;
    let chamadas = 0;
    w.registrarTrailDecisao = async () => { chamadas++; return {ok:true}; };
    w.document.getElementById('trailTipoDecisao').value = 'LIBEROU_NAVIO';
    w.document.getElementById('trailMotivoInput').value = 'Tentativa sem autorização';
    // O bloqueio deve ocorrer antes de ler/validar os campos ou chamar o gravador.
    modal.classList.remove('hidden');
    const evento = new w.Event('submit', {bubbles:true, cancelable:true});
    w.document.getElementById('registrarTrailForm').dispatchEvent(evento);
    await H.aguardar(20);
    assert.equal(evento.defaultPrevented, true);
    assert.equal(chamadas, 0, 'Envio forçado não chega ao gravador');
    assert.equal(JSON.parse(w.localStorage.getItem('nexus_trail_decisoes')).length, 0);
    w.registrarTrailDecisao = registrarOriginal;

    // O helper compartilhado de auditoria não é bloqueado pela regra do formulário.
    const gravacoes = [];
    w.nexusSupabase = {from: tabela => ({insert: async payload => {
      gravacoes.push({tabela, payload}); return {error:null};
    }})};
    await w.registrarLogAlteracao('VIS-TESTE', 'CRIACAO', 'Cadastro autorizado de visitante');
    assert.equal(gravacoes.length, 1);
    assert.equal(gravacoes[0].tabela, 'logs_alteracoes');
    assert.equal(gravacoes[0].payload.cargo, 'TECNICO_PORTOS');
    assert.equal(JSON.parse(w.localStorage.getItem('nexus_audit_logs')).length, 1);

    let ferramentas;
    w.NexusWebMCP = {registrarPagina: p => { ferramentas = p.ferramentas; }};
    w.NexusWebMCPDados = {GRUPOS:{todos:['TECNICO_PORTOS']}, quandoPronto:f => f()};
    w.eval(H.read('js/webmcp/webmcp-dashboard.js'));
    assert.equal(ferramentas.length, 5);
    assert.ok(ferramentas.every(f => f.anotacoes.readOnlyHint === true));
    assert.deepEqual(j.erros, [], 'Sem erros após os testes negativos');
  } finally { w.close(); }

  const controle = await abrir('DIRETOR_PRESIDENTE_SUPERINTENDENTE');
  try {
    const v = controle.w;
    assert.equal(v.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'), false);
    v.document.getElementById('toggleRegistrarTrailBtn').click();
    assert.equal(v.document.getElementById('registrarTrailModal').classList.contains('hidden'), false);
  } finally { controle.w.close(); }
  console.log('✅ Tarefa 4: registro manual bloqueado para Técnico, acessos e auditoria preservados, WebMCP somente leitura.');
})().catch(e => {console.error(e); process.exit(1);});
