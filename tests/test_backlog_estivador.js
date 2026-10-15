/** Tarefa 1 do backlog: restrições do Estivador nas páginas reais, sem rede. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
async function abrir(pagina, storage = {}) {
  const j = H.criarJanela({url: `https://nexusport.test/${pagina}.html`, html: H.htmlDaPagina(`${pagina}.html`), session: H.sessao('ESTIVADOR'), storage,
    scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', w => {w.currentUserSession = w.NexusAuth.getSession();}, `js/pages/${pagina}.js`]});
  await H.prontoDom(j.w); await H.aguardar(100);
  assert.deepEqual(j.erros, [], `Erros na página ${pagina}`);
  return j;
}
(async () => {
  const j = await abrir('embarcacoes'); const w = j.window || j.w;
  for (const pagina of ['dashboard', 'cargas', 'scanner', 'embarcacoes', 'manutencao']) assert.equal(w.NexusAuth.canAccessPage(`${pagina}.html`), true, pagina);
  for (const pagina of ['relatorios', 'delegacao', 'inspecao', 'tecnico_portos', 'seguranca', 'teste-vibracao', 'desconhecida']) assert.equal(w.NexusAuth.canAccessPage(`${pagina}.html`), false, pagina);
  assert.ok(w.document.getElementById('guindastesTableBody'));
  assert.equal(w.document.getElementById('containersTableBody'), null);
  assert.equal(w.document.getElementById('embarcacoesGpsTableBody'), null);
  await w.excluirGuindaste('GND-01');
  w.close();
  const m = await abrir('manutencao', {nexus_guindastes_list: [{identificacao:'GND-01', estado:'OPERANTE'}], nexus_containers_list:[{identificacao:'CONT-01'}]});
  const v = m.window || m.w;
  assert.equal(v.document.getElementById('navioManutForm'), null);
  assert.ok(v.document.querySelector('#osEquipamento option[value="Guindaste GND-01"]'));
  assert.equal(v.document.querySelector('#osEquipamento option[value="Contêiner CONT-01"]'), null);
  v.document.getElementById('osEquipamento').value = 'Guindaste GND-01';
  v.document.getElementById('osDescricao').value = 'Revisão dos cabos';
  v.document.getElementById('osForm').dispatchEvent(new v.Event('submit', {cancelable:true}));
  await H.aguardar(30);
  const ordens = JSON.parse(v.localStorage.getItem('nexus_os_list'));
  assert.equal(ordens.length, 1);
  assert.equal(ordens[0].status, 'PENDENTE_APROVACAO');
  assert.equal(v.document.querySelector('[onclick*="executarAcaoOS"]'), null);
  await v.executarAcaoOS(ordens[0].id, 'APROVAR');
  assert.equal(JSON.parse(v.localStorage.getItem('nexus_os_list'))[0].status, 'PENDENTE_APROVACAO');
  v.close();
  const d = await abrir('dashboard'); const x = d.window || d.w;
  assert.ok(x.document.getElementById('toggleRegistrarTrailBtn').classList.contains('hidden'));
  x.document.getElementById('toggleRegistrarTrailBtn').click();
  assert.ok(x.document.getElementById('registrarTrailModal').classList.contains('hidden'));
  x.close();
  console.log('✅ Tarefa 1: rotas, seções, solicitação de guindaste e bloqueios aprovados.');
})().catch(e => {console.error(e); process.exit(1);});
