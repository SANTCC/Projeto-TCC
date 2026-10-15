/** Tarefa 12: layout compartilhado, acessibilidade e fluxo de logout preservados. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const H=require('./webmcp-harness');
(async () => {
  const paginas=fs.readdirSync(path.join(__dirname,'..')).filter(f=>f.endsWith('.html') && H.read(f).includes('src="js/layout.js"'));
  assert.ok(paginas.length>=10,'O teste deve cobrir todas as páginas com layout compartilhado');
  for(const pagina of paginas) {
    assert.ok(H.read(pagina).includes('css/nexus.css'),`${pagina}: CSS compartilhado local`);
    let saidas=0;const confirmacoes=[];const analytics=[];
    const j=H.criarJanela({url:`https://nexusport.test/${pagina}`,html:H.htmlDaPagina(pagina),session:H.sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE'),scripts:[
      'js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
        w.currentUserSession=w.NexusAuth.getSession();
        w.NexusAuth.logout=()=>{saidas++;};
        w.NexusAnalytics={track:evento=>analytics.push(evento)};
      },'js/layout.js']});
    try {
      await H.prontoDom(j.w);await H.aguardar(10);
      const d=j.w.document;
      const btn=d.getElementById('logoutBtn');
      assert.ok(btn,`${pagina}: Sair disponível no cabeçalho`);
      assert.equal(btn.getAttribute('aria-label'),'Sair da sessão');
      assert.equal(btn.querySelector('span:last-child').textContent,'Sair');
      assert.equal(btn.querySelector('span:last-child').classList.contains('hidden'),false);
      assert.ok(d.getElementById('headerActions'));assert.ok(d.getElementById('headerBrand'));
      const rodape=d.querySelector('#sidebarFooter a');
      assert.equal(rodape.getAttribute('aria-label'),'Sair da sessão');
      assert.equal(rodape.querySelector('span:last-child').textContent,'Sair');
      assert.ok(d.getElementById('sidebarScrollArea').classList.contains('overflow-y-auto'));
      // Menu continua abrindo/fechando; o rodapé não foi removido para "caber".
      d.getElementById('mobileMenuToggle').click();
      assert.equal(d.getElementById('appSidebar').classList.contains('-translate-x-full'),false);
      d.getElementById('closeMobileSidebarBtn').click();
      assert.equal(d.getElementById('appSidebar').classList.contains('-translate-x-full'),true);
      j.w.nexusConfirm=async(titulo,msg)=>{confirmacoes.push({titulo,msg});return false;};
      btn.click();await H.aguardar(0);
      assert.equal(saidas,0,`${pagina}: cancelar preserva a sessão`);
      assert.equal(confirmacoes[0].titulo,'Encerrar Sessão');
      j.w.nexusConfirm=async()=>true;
      btn.click();await H.aguardar(0);
      assert.equal(saidas,1,`${pagina}: confirmar usa o logout existente`);
      assert.equal(analytics.filter(x=>x==='logout').length,1);
      assert.deepEqual(j.erros,[],pagina);
    } finally {j.w.close();}
  }
  const css=await require('../tools/assets').compilarTailwind();
  assert.equal(H.read('css/nexus.css'),css,'CSS servido deve corresponder à origem, incluindo classes novas');
  console.log(`✅ Tarefa 12: ${paginas.length} páginas, rótulos de saída, menu, confirmação/cancelamento e CSS compilado atualizado.`);
})().catch(e=>{console.error(e);process.exit(1);});
