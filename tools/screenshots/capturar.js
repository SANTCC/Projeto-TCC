#!/usr/bin/env node
/**
 * CAPTURA DE TELAS DE TODAS AS PÁGINAS — NexusPort (material do about.html).
 *
 * Para cada conta de demonstração, o script faz o fluxo real de acesso — login em
 * index.html com a matrícula (MAT-0000 / MAT-2011 / MAT-9999), confirmação de cargo
 * e navegação pelas telas que aquele cargo pode abrir (matriz de js/auth-guard.js) —
 * e salva um PNG de página inteira por tela, além de um manifest.json com os metadados.
 *
 * Como o ambiente de captura não alcança o Supabase nem os CDNs, o script:
 *   1. serve o repositório por HTTP local, substituindo js/config.js pelo endereço
 *      do PostgREST simulado (tools/screenshots/mock-postgrest.js, dados de
 *      tools/screenshots/demo-data.js);
 *   2. responde os CDNs (Tailwind, fontes, supabase-js, Chart.js, QRCode, jsPDF,
 *      html5-qrcode, VLibras) com os arquivos vendorizados (tools/screenshots/vendor.js).
 * Nenhum arquivo do repositório é alterado.
 *
 * Uso:
 *   CHROME_PATH=/caminho/para/chromium node tools/screenshots/capturar.js
 *   ... --saida docs/screenshots --largura 1440 --tema claro --contas MAT-0000,MAT-9999
 *
 * Requisitos: Chromium/Chrome (CHROME_PATH) e `npm install --prefix tools/screenshots`.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer-core');

const { iniciarPostgrestDemo } = require('./mock-postgrest');
const { CONTAS, CARGO_META } = require('./demo-data');
const { substituicoes, arquivosEstaticos, DIR_VENDOR } = require('./vendor');
const { PAGINAS, paginasParaCargo } = require('./paginas');

const RAIZ = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
function analisarArgumentos(argv) {
  const opcoes = {
    saida: path.join(RAIZ, 'docs', 'screenshots'),
    largura: 1440,
    altura: 900,
    tema: 'claro',
    contas: CONTAS.map((c) => c.matricula),
    publicas: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--saida') opcoes.saida = path.resolve(argv[++i]);
    else if (arg === '--largura') opcoes.largura = Number(argv[++i]);
    else if (arg === '--altura') opcoes.altura = Number(argv[++i]);
    else if (arg === '--tema') opcoes.tema = argv[++i];
    else if (arg === '--contas') opcoes.contas = String(argv[++i]).split(',').map((s) => s.trim());
    else if (arg === '--sem-publicas') opcoes.publicas = false;
    else if (arg === '--ajuda') opcoes.ajuda = true;
  }
  return opcoes;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

// ---------------------------------------------------------------------------
// 1. Servidor estático do repositório
// ---------------------------------------------------------------------------
function iniciarServidorEstatico({ configuracaoSupabase }) {
  const estaticos = new Map(
    arquivosEstaticos().map((arquivo) => [path.basename(arquivo), arquivo])
  );

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let caminho = decodeURIComponent(url.pathname);

    // Recursos vendorizados (fontes dos screenshots).
    if (caminho.startsWith('/__vendor/')) {
      const arquivo = estaticos.get(path.basename(caminho));
      if (!arquivo) {
        res.writeHead(404).end('não encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream' });
      fs.createReadStream(arquivo).pipe(res);
      return;
    }

    if (caminho === '/' || caminho === '') caminho = '/index.html';

    // js/config.js é substituído pelo PostgREST simulado (o arquivo real é do Supabase).
    if (caminho === '/js/config.js') {
      const corpo = `window.NEXUS_CONFIG = ${JSON.stringify(configuracaoSupabase, null, 2)};\n`;
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      res.end(corpo);
      return;
    }

    const destino = path.join(RAIZ, caminho);
    if (!destino.startsWith(RAIZ) || !fs.existsSync(destino) || fs.statSync(destino).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('não encontrado');
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[path.extname(destino)] || 'application/octet-stream' });
    fs.createReadStream(destino).pipe(res);
  });

  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${servidor.address().port}`,
        fechar: () => new Promise((ok) => servidor.close(ok))
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Navegador
// ---------------------------------------------------------------------------
function acharChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    '/tmp/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean);
  return candidatos.find((c) => {
    try {
      return fs.existsSync(c) && fs.statSync(c).isFile();
    } catch (e) {
      return false;
    }
  });
}

async function abrirNavegador(opcoes) {
  const executablePath = acharChrome();
  if (!executablePath) {
    throw new Error(
      'Chromium não encontrado. Defina CHROME_PATH apontando para o executável '
      + '(ex.: CHROME_PATH=/usr/bin/chromium node tools/screenshots/capturar.js).'
    );
  }
  return puppeteer.launch({
    executablePath,
    headless: 'shell',
    // Sem --single-process: os contextos de navegador (uma sessão limpa por conta)
    // exigem processos separados. O sandbox precisa de --no-sandbox.
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--font-render-hinting=none', '--force-device-scale-factor=1',
      '--hide-scrollbars', '--lang=pt-BR'
    ],
    env: { ...process.env, TZ: 'America/Sao_Paulo' },
    defaultViewport: { width: opcoes.largura, height: opcoes.altura, deviceScaleFactor: 1 }
  });
}

/** Desativa animações/transições para as capturas ficarem estáveis. */
const CSS_CAPTURA = `
  *, *::before, *::after { animation: none !important; transition: none !important; }
  html { scroll-behavior: auto !important; }
`;

// ---------------------------------------------------------------------------
// 3. Contexto de página com CDNs substituídos
// ---------------------------------------------------------------------------
function prepararPagina(page, opcoes, mapas) {
  const { substituicoesCdn, urlEstatica, urlMock } = mapas;

  return Promise.all([
    page.setRequestInterception(true),
    page.evaluateOnNewDocument((temaPadrao) => {
      try {
        // `?tema=escuro` força uma variante de tema só para aquela captura.
        const forcado = new URLSearchParams(location.search).get('tema');
        localStorage.setItem('nexus_theme', forcado === 'escuro' ? 'dark' : (forcado === 'claro' ? 'light' : temaPadrao));
      } catch (e) {}
      window.__nexusCaptura = true;

      // Realtime (WebSocket) não existe no ambiente de captura. Sem este stub o
      // Supabase Realtime tentaria reconectar a cada poucos segundos e as telas
      // ficariam piscando/sincronizando durante o screenshot. O app já prevê o
      // funcionamento sem Realtime (sincronização por polling de 60 s).
      const NaoConecta = function NaoConecta(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING (nunca abre)
        this.bufferedAmount = 0;
        this.protocol = '';
        this.extensions = '';
        this.binaryType = 'blob';
        this.onopen = null; this.onclose = null; this.onerror = null; this.onmessage = null;
        this.addEventListener = function () {};
        this.removeEventListener = function () {};
        this.send = function () {};
        this.close = function () {};
      };
      NaoConecta.CONNECTING = 0; NaoConecta.OPEN = 1; NaoConecta.CLOSING = 2; NaoConecta.CLOSED = 3;
      window.WebSocket = NaoConecta;
    }, opcoes.tema)
  ]).then(() => {
    page.on('request', (req) => {
      const url = req.url();

      if (url.startsWith(urlEstatica) || url.startsWith(urlMock) || url.startsWith('data:') || url.startsWith('about:')) {
        req.continue();
        return;
      }

      let host = '';
      try {
        host = new URL(url).host;
      } catch (e) {
        req.continue();
        return;
      }

      const substituicao = substituicoesCdn.find((s) => {
        const mesmoHost = host === s.host || host.endsWith(`.${s.host}`);
        if (!mesmoHost) return false;
        if (!s.casarCaminho) return true;
        return s.casarCaminho.test(new URL(url).pathname);
      });
      if (substituicao) {
        const corpo = substituicao.corpo;
        req.respond({
          status: 200,
          contentType: substituicao.tipo || 'text/javascript; charset=utf-8',
          body: typeof corpo === 'function' ? corpo(url) : corpo
        });
        return;
      }

      // Qualquer outro host externo (bloqueado na rede) responde vazio na hora.
      const tipo = req.resourceType();
      req.respond({
        status: 204,
        contentType: tipo === 'font' ? 'font/woff2' : (tipo === 'stylesheet' ? 'text/css' : 'application/javascript'),
        body: ''
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 4. Espera de renderização
// ---------------------------------------------------------------------------
async function aguardarRender(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 12000 }).catch(() => {});
  // Gráficos (Chart.js) são desenhados após o primeiro paint; aguarda até que
  // todo canvas da página tenha conteúdo, com limite de tempo.
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    if (!canvases.length) return true;
    return canvases.every((c) => {
      try {
        return c.width > 0 && c.height > 0 && c.toDataURL().length > 2000;
      } catch (e) {
        return true;
      }
    });
  }, { timeout: 8000, polling: 200 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
}

async function fotografar(page, destino, metadados) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  await page.addStyleTag({ content: CSS_CAPTURA }).catch(() => {});
  await page.screenshot({ path: destino, fullPage: true });
  const { size } = fs.statSync(destino);
  console.log(`  ✓ ${path.relative(RAIZ, destino)} (${(size / 1024).toFixed(0)} kB)${metadados ? ` — ${metadados}` : ''}`);
  return size;
}

// ---------------------------------------------------------------------------
// 4b. Estados adicionais (extras) de algumas telas
// ---------------------------------------------------------------------------
/**
 * Cada extra gera uma captura a mais da mesma tela, depois da captura padrão.
 * `contas` limita a quais contas o extra se aplica; `tema` força claro/escuro.
 */
const EXTRAS = {
  inspecao: [
    {
      sufixo: 'checklist-carregado',
      contas: ['MAT-2011'],
      descricao: 'Checklist de uma carga carregado: itens críticos e ações de aprovação/recusa.',
      preparar: async (page) => {
        await page.select('#inspecaoCargaSelect', 'DEMO-CRG-003');
        await page.click('#carregarChecklistBtn');
        await page.waitForSelector('#checklistItemsList input', { timeout: 8000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  ],
  dashboard: [
    {
      sufixo: 'tema-escuro',
      contas: ['MAT-0000'],
      tema: 'escuro',
      descricao: 'O mesmo painel no tema escuro (preferência salva por operador).',
      preparar: async () => {}
    }
  ]
};

// ---------------------------------------------------------------------------
// 5. Fluxo de captura
// ---------------------------------------------------------------------------
async function capturarConta(navegador, conta, opcoes, infra) {
  const cargo = CARGO_META[conta.cargo];
  const paginas = paginasParaCargo(conta.cargo);
  const contexto = await navegador.createBrowserContext();
  const page = await contexto.newPage();
  await prepararPagina(page, { tema: opcoes.tema }, infra);

  const capturas = [];
  const registrar = async (pagina, arquivo, descricao, sufixo) => {
    const nomeArquivo = path.basename(arquivo);
    const destino = path.join(opcoes.saida, nomeArquivo);
    const bytes = await fotografar(page, destino, `${conta.matricula} · ${pagina.titulo}`);
    capturas.push({
      pagina: pagina.chave,
      arquivoHtml: pagina.arquivo,
      titulo: pagina.titulo,
      subtitulo: pagina.subtitulo,
      resumo: pagina.resumo,
      destaques: pagina.destaques,
      imagem: nomeArquivo,
      bytes,
      descricao,
      sufixo: sufixo || null
    });
  };

  console.log(`\n▶ ${conta.matricula} — ${conta.nome} (${cargo.nome})`);

  // 5.1 Login real pelo formulário
  await page.goto(`${infra.urlEstatica}/index.html`, { waitUntil: 'domcontentloaded' });
  await aguardarRender(page);
  await page.type('#operatorCode', conta.matricula, { delay: 12 });
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(() => window.location.pathname.endsWith('confirm-role.html'), { timeout: 15000 });
  await aguardarRender(page);

  // 5.2 Confirmação de cargo
  const paginaConfirmacao = PAGINAS.find((p) => p.chave === 'confirmacao-cargo');
  await registrar(paginaConfirmacao, `${conta.matricula}-confirmacao-cargo.png`, `Identificação reconhecida como ${cargo.nome}.`);
  await page.click('#confirmRoleBtn');
  await page.waitForFunction(() => window.location.pathname.endsWith('dashboard.html'), { timeout: 15000 });
  await aguardarRender(page);

  // 5.3 Demais telas do cargo
  for (const pagina of paginas) {
    if (pagina.chave === 'confirmacao-cargo') continue;
    await page.goto(`${infra.urlEstatica}/${pagina.arquivo}`, { waitUntil: 'domcontentloaded' });
    await aguardarRender(page);
    const caminhoAtual = await page.evaluate(() => window.location.pathname);
    if (!caminhoAtual.endsWith(pagina.arquivo)) {
      console.warn(`  ! ${pagina.arquivo} redirecionou para ${path.basename(caminhoAtual)} (sem permissão para o cargo)`);
      continue;
    }
    await registrar(pagina, `${conta.matricula.toLowerCase()}-${pagina.chave}.png`, `Acesso liberado para ${cargo.nome} (${cargo.camada}).`);

    // Estados adicionais da tela (ex.: checklist carregado, tema escuro).
    const extras = (EXTRAS[pagina.chave] || []).filter((e) => !e.contas || e.contas.includes(conta.matricula));
    for (const extra of extras) {
      const consulta = extra.tema === 'escuro' ? '?tema=escuro' : '';
      await page.goto(`${infra.urlEstatica}/${pagina.arquivo}${consulta}`, { waitUntil: 'domcontentloaded' });
      await aguardarRender(page);
      await extra.preparar(page);
      await registrar(pagina, `${conta.matricula.toLowerCase()}-${pagina.chave}-${extra.sufixo}.png`, extra.descricao, extra.sufixo);
    }
  }

  await contexto.close();
  return {
    matricula: conta.matricula,
    codigo: conta.codigo,
    nome: conta.nome,
    descricao: conta.descricao || '',
    cargo: conta.cargo,
    cargoNome: cargo.nome,
    nivel: cargo.nivel,
    camada: cargo.camada,
    paginas: capturas
  };
}

async function capturarPublicas(navegador, opcoes, infra) {
  const contexto = await navegador.createBrowserContext();
  const page = await contexto.newPage();
  await prepararPagina(page, { tema: opcoes.tema }, infra);
  const capturas = [];

  const paginaLogin = PAGINAS.find((p) => p.chave === 'login');
  console.log('\n▶ Páginas públicas');

  await page.goto(`${infra.urlEstatica}/index.html`, { waitUntil: 'domcontentloaded' });
  await aguardarRender(page);
  capturas.push(await salvar(page, `${opcoes.saida}/publico-login.png`, paginaLogin, 'Tela de autenticação de funcionário.'));

  // Modal de contingência (RN 15)
  await page.click('#openRecoveryModal');
  await new Promise((r) => setTimeout(r, 400));
  capturas.push(await salvar(page, `${opcoes.saida}/publico-login-reemissao.png`, paginaLogin, 'Contingência RN 15: pedido de reemissão do código individual.'));
  await page.click('#dismissRecoveryModal');
  await new Promise((r) => setTimeout(r, 300));

  // Credencial reconhecida (feedback de sucesso antes do redirecionamento)
  await page.type('#operatorCode', 'MAT-0000', { delay: 12 });
  await page.click('#loginSubmitBtn');
  await page.waitForFunction(() => !document.getElementById('authNotice').classList.contains('hidden'), { timeout: 15000 }).catch(() => {});
  capturas.push(await salvar(page, `${opcoes.saida}/publico-login-reconhecida.png`, paginaLogin, 'Credencial reconhecida: o sistema confirma o vínculo antes da confirmação de cargo.'));

  // Página de diagnóstico de vibração (sem sessão)
  const paginaVibracao = PAGINAS.find((p) => p.chave === 'teste-vibracao');
  await page.goto(`${infra.urlEstatica}/teste-vibracao.html`, { waitUntil: 'domcontentloaded' });
  await aguardarRender(page);
  capturas.push(await salvar(page, `${opcoes.saida}/publico-teste-vibracao.png`, paginaVibracao, 'Diagnóstico do alerta tátil do botão de pânico.'));

  await contexto.close();
  return capturas;

  async function salvar(paginaAtual, destino, pagina, descricao) {
    const bytes = await fotografar(paginaAtual, destino, pagina.titulo);
    return {
      pagina: pagina.chave,
      arquivoHtml: pagina.arquivo,
      titulo: pagina.titulo,
      subtitulo: pagina.subtitulo,
      resumo: pagina.resumo,
      destaques: pagina.destaques,
      imagem: path.basename(destino),
      bytes,
      descricao
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Principal
// ---------------------------------------------------------------------------
async function principal() {
  const opcoes = analisarArgumentos(process.argv.slice(2));
  if (opcoes.ajuda) {
    console.log(fs.readFileSync(__filename, 'utf-8').split('\n').slice(2, 30).join('\n'));
    return;
  }

  if (!fs.existsSync(DIR_VENDOR)) {
    throw new Error(`Dependências de captura ausentes (${DIR_VENDOR}). Rode: npm install --prefix tools/screenshots`);
  }

  const mock = await iniciarPostgrestDemo();
  const estatico = await iniciarServidorEstatico({
    configuracaoSupabase: { SUPABASE_URL: mock.url, SUPABASE_ANON_KEY: 'chave-anon-de-demonstracao' }
  });
  const substituicoesCdn = substituicoes({ basePublica: estatico.url });

  const infra = {
    urlEstatica: estatico.url,
    urlMock: mock.url,
    substituicoesCdn
  };

  const navegador = await abrirNavegador(opcoes);
  const manifest = {
    geradoEm: new Date().toISOString(),
    descricao: 'Capturas de tela do NexusPort por conta de demonstração (ambiente local com PostgREST simulado e dados fictícios).',
    ambiente: {
      servidor: 'HTTP local (raiz do repositório) + PostgREST simulado (tools/screenshots/mock-postgrest.js)',
      supabase: 'nenhuma conexão com o Supabase; js/config.js é substituído em memória pelo endereço do servidor simulado',
      recursos: 'Tailwind, fontes e bibliotecas vendorizados (tools/screenshots/vendor.js); o widget VLibras e o Realtime não são carregados',
      dados: 'fictícios, derivados do seed de demonstração (tools/screenshots/demo-data.js)'
    },
    tamanho: { largura: opcoes.largura, altura: opcoes.altura, tema: opcoes.tema },
    publicas: [],
    contas: []
  };

  try {
    if (opcoes.publicas) manifest.publicas = await capturarPublicas(navegador, opcoes, infra);
    for (const matricula of opcoes.contas) {
      const conta = CONTAS.find((c) => c.matricula === matricula);
      if (!conta) {
        console.warn(`Conta ${matricula} não encontrada em demo-data.js`);
        continue;
      }
      manifest.contas.push(await capturarConta(navegador, conta, opcoes, infra));
    }
  } finally {
    await navegador.close();
    await estatico.fechar();
    await mock.fechar();
  }

  fs.mkdirSync(opcoes.saida, { recursive: true });
  const arquivoManifest = path.join(opcoes.saida, 'manifest.json');
  fs.writeFileSync(arquivoManifest, `${JSON.stringify(manifest, null, 2)}\n`);

  const total = manifest.publicas.length + manifest.contas.reduce((acc, c) => acc + c.paginas.length, 0);
  const peso = [...manifest.publicas, ...manifest.contas.flatMap((c) => c.paginas)].reduce((acc, p) => acc + p.bytes, 0);
  console.log(`\n${total} capturas em ${path.relative(RAIZ, opcoes.saida)} (${(peso / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Manifesto: ${path.relative(RAIZ, arquivoManifest)}`);
}

if (require.main === module) {
  principal().catch((erro) => {
    console.error(`\nFalha na captura: ${erro.message}`);
    process.exit(1);
  });
}

module.exports = { principal, iniciarServidorEstatico, prepararPagina, aguardarRender, CSS_CAPTURA };
