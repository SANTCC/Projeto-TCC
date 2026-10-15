/** Tarefa 11: atalho seguro por carga recusada, sem mudança de status ao abrir. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const {criarBancoFalso} = require('./fake-supabase-db');
const base = {id:'CRG-TESTE-11',tipo:'Carga Geral',status:'RECUSADA',resultadoInspecao:'RECUSADA',motivoRecusa:'Lacre irregular',portoDescarga:'Setor A'};
const autorizados = ['CONFERENTE_CARGA','INSPETOR','SUPERVISOR_GERENTE_OPERACOES','DIRETOR_OPERACOES_LOGISTICA','DIRETOR_PRESIDENTE_SUPERINTENDENTE','CONSELHO_ADMINISTRACAO'];
const restritos = ['ESTIVADOR','ARRUMADOR_CONSERTADOR','PLANEJADOR_PATIO_NAVIOS','TECNICO_PORTOS'];
async function abrir(pagina, cargas, cargo='INSPETOR', url) {
  let logs=0;
  const banco=criarBancoFalso({containers:[],navios:[],cargas:[]});
  const j=H.criarJanela({
    url:url || `https://nexusport.test/${pagina}.html`,html:H.htmlDaPagina(`${pagina}.html`),session:H.sessao(cargo),
    storage:{nexus_cargas_fluxo:cargas},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js','js/padronizacao-codigos.js',w => {
      w.currentUserSession=w.NexusAuth.getSession();
      w.nexusSupabase=banco;
      w.registrarLogAlteracao=async () => {logs++;};
    },`js/pages/${pagina}.js`]});
  await H.prontoDom(j.w);await H.aguardar(35);
  assert.deepEqual(j.erros,[]);
  return {...j,escritas:() => banco.log.length,logs:() => logs};
}
(async () => {
  const cargas=[base,{...base,id:'CRG-OUTRA-RECUSADA',motivoRecusa:'Documentação incompleta'},
    {...base,id:'CRG-CANCELADA',status:'CANCELADA'},{...base,id:'CRG-ENTREGUE',status:'ENTREGUE'},
    {...base,id:'CRG-ATIVA',status:'ARMAZENAGEM'}];
  for (const cargo of [...autorizados,...restritos]) {
    const j=await abrir('cargas',cargas,cargo);
    try {
      const tabela=j.w.document.getElementById('cargasRecusadasTableBody');
      const links=Array.from(tabela.querySelectorAll('a'));
      assert.equal(links.length,autorizados.includes(cargo) ? 2 : 0,`Permissão: ${cargo}`);
      for (const [i,link] of links.entries()) {
        const url=new URL(link.href);
        assert.equal(url.pathname,'/inspecao.html');
        assert.equal(url.searchParams.get('carga'),cargas[i].id);
        assert.equal(link.textContent.includes('Checklist'),true);
        assert.equal(link.getAttribute('aria-label'),`Abrir checklist da carga ${cargas[i].id}`);
        assert.equal(link.getAttribute('onclick'),null,'Navegação sem executar dados como JavaScript');
      }
      assert.equal(tabela.rows.length,2);
      assert.equal(tabela.rows[0].cells.length,6);
      assert.equal(j.escritas(),0);assert.equal(j.logs(),0);
      assert.deepEqual(JSON.parse(j.w.localStorage.getItem('nexus_cargas_fluxo')),cargas);
    } finally {j.w.close();}
  }
  // Seguir a URL real abre o checklist correspondente, sem desfazer a recusa.
  const origem=await abrir('cargas',cargas);
  let destino;
  try {
    const link=origem.w.document.querySelector('#cargasRecusadasTableBody a');
    destino=await abrir('inspecao',cargas,'INSPETOR',link.href);
    const w=destino.w;
    assert.equal(w.document.getElementById('inspecaoCargaSelect').value,base.id);
    assert.equal(w.document.getElementById('checklistFormContainer').classList.contains('hidden'),false);
    assert.equal(w.nexusInspecaoEstado().cargaId,base.id);
    assert.equal(w.nexusInspecaoEstado().carga_status,'RECUSADA');
    assert.equal(w.document.getElementById('aprovarCargaBtn').disabled,true,'Abrir não dispensa os itens críticos');
    const itens=w.nexusInspecaoEstado().itens;
    assert.ok(itens.some(i => i.critico));
    for (const item of itens) w.atualizarChecklistItem(item.id,true);
    assert.equal(w.document.getElementById('aprovarCargaBtn').disabled,false,'Nova avaliação conforme libera a tentativa normal de aceite');
    w.atualizarChecklistItem(itens.find(i => i.critico).id,false);
    assert.equal(w.document.getElementById('aprovarCargaBtn').disabled,true,'Não conformidade crítica continua bloqueando');
    assert.deepEqual(JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')),cargas,'Abrir/preencher preserva recusa e motivo até registrar nova decisão');
    assert.equal(destino.escritas(),0);assert.equal(destino.logs(),0);
    assert.deepEqual(destino.erros,[]);
  } finally {origem.w.close();if(destino)destino.w.close();}
  // IDs hostis continuam sendo dados de URL/texto, nunca HTML ou outro parâmetro.
  {
    const id=`CRG-\"><img src=x onerror=alert(1)>' &carga=OUTRA#fragmento`;
    const j=await abrir('cargas',[{...base,id}]);
    try {
      const tabela=j.w.document.getElementById('cargasRecusadasTableBody');
      const link=tabela.querySelector('a');const url=new URL(link.href);
      assert.equal(url.searchParams.get('carga'),id);assert.equal(Array.from(url.searchParams).length,1);
      assert.equal(url.hash,'');assert.equal(url.origin,'https://nexusport.test');
      assert.equal(tabela.querySelector('img,[onerror]'),null);
      assert.equal(link.getAttribute('aria-label'),`Abrir checklist da carga ${id}`);
    } finally {j.w.close();}
  }
  {
    const j=await abrir('cargas',[]);
    try {
      assert.equal(j.w.document.querySelector('#cargasRecusadasTableBody td').colSpan,6);
      assert.equal(j.w.document.querySelector('#cargasRecusadasTableBody a'),null);
    } finally {j.w.close();}
  }
  console.log('✅ Tarefa 11: atalho individual, permissões de 10 cargos, abertura direta da recusa, regras críticas e XSS preservados.');
})().catch(e => {console.error(e);process.exit(1);});
