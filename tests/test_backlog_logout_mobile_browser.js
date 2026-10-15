/** Geometria real em Chromium. Uso: CHROME_PATH=/caminho/chromium npm run test:backlog-logout-mobile:browser */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'..');
(async () => {
  assert.ok(process.env.CHROME_PATH,'Defina CHROME_PATH para executar o teste visual em navegador real.');
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  try {
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',async req => {
      const url=new URL(req.url());const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(url.origin!=='https://nexusport.test' || !file.startsWith(root+path.sep) || !fs.existsSync(file))return req.abort();
      const ext=path.extname(file);let body=fs.readFileSync(file);
      if(ext==='.html')body=body.toString().replace(/<script[\s\S]*?<\/script>/gi,'');
      await req.respond({status:200,contentType:({'.html':'text/html','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'})[ext]||'application/octet-stream',body});
    });
    for(const pagina of ['dashboard','cargas','embarcacoes','manutencao']) {
      for(const [width,height] of [[280,568],[320,568],[360,640],[390,844],[480,320],[640,360],[767,360],[768,1024],[1024,768],[1440,900]]) {
        await page.setViewport({width,height});
        await page.goto(`https://nexusport.test/${pagina}.html`,{waitUntil:'load'});
        await page.evaluate(() => {
          window.currentUserSession={nome:'Operador com um nome muito extenso '.repeat(5),cargo:'DIRETOR_PRESIDENTE_SUPERINTENDENTE',cargo_nome:'Diretor Presidente Superintendente com descrição extensa',codigo_individual:'NX-CODIGO-MUITO-EXTENSO-1234567890',matricula:'12345678901234567890'};
          window.NexusAuth={getSession:() => window.currentUserSession,canAccessPage:() => true};
          window.matchMedia=window.matchMedia.bind(window);
        });
        await page.addScriptTag({path:path.join(root,'js/security.js')});
        await page.addScriptTag({path:path.join(root,'js/layout.js')});
        await page.evaluate(async () => {await document.fonts.ready;document.getElementById('headerOnlineCount').textContent='9999';});
        const metrics=await page.evaluate(() => {
          const rect=id => {const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
          return {logout:rect('logoutBtn'),theme:rect('themeToggle'),viewport:document.documentElement.clientWidth,menuVisivel:getComputedStyle(document.getElementById('mobileMenuToggle')).display!=='none',label:document.getElementById('logoutBtn').innerText};
        });
        const label=`${pagina} ${width}x${height}`;
        assert.ok(metrics.logout.left>=0 && metrics.logout.right<=metrics.viewport+1,`${label}: Sair cortado: ${JSON.stringify(metrics)}`);
        assert.ok(metrics.logout.top>=0 && metrics.logout.bottom<=height,`${label}: Sair fora da altura visível`);
        assert.ok(metrics.logout.width>=44 && metrics.logout.height>=44,`${label}: área de toque de Sair menor que 44px`);
        assert.ok(metrics.theme.right<=metrics.logout.left+1,`${label}: controles sobrepostos`);
        assert.equal(metrics.menuVisivel,width<768,`${label}: menu móvel apenas abaixo de 768px`);
        assert.ok(metrics.label.includes('Sair'),`${label}: rótulo Sair oculto`);
        if(width<768) {
          await page.click('#mobileMenuToggle');
          await page.evaluate(() => document.querySelector('#appSidebar a[href="index.html"]').scrollIntoView({block:'end'}));
          await new Promise(resolve => setTimeout(resolve,320));
          const footer=await page.evaluate(() => {
            const a=document.querySelector('#appSidebar a[href="index.html"]');const r=a.getBoundingClientRect();
            return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
          });
          assert.ok(footer.left>=0 && footer.right<=width+1 && footer.top>=0 && footer.bottom<=height+1,`${label}: saída da sidebar inacessível: ${JSON.stringify(footer)}`);
          assert.ok(footer.width>=44 && footer.height>=44,`${label}: saída da sidebar sem alvo de toque adequado`);
        }
      }
    }
    console.log('✅ Tarefa 12: Chromium, 40 combinações de página/viewport (280–1440px, retrato/paisagem), nomes longos, Sair visível e sidebar rolável.');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exit(1);});
