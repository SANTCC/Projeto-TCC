#!/usr/bin/env node
/**
 * GATE LIGHTHOUSE PARA PULL REQUESTS (Backlog 3, item H).
 *
 * Fluxo:
 *   1. Gera o build de produção (dist/, mesmo código que vai para o deploy).
 *   2. Serve dist/ em uma porta local livre.
 *   3. Abre o Chrome (CHROME_PATH ou o instalado no sistema) e prepara a sessão de cada página:
 *      sessão de teste (páginas internas), pendência de confirmação (confirm-role.html) ou nenhuma (login).
 *   4. Roda o Lighthouse (desktop) em cada página de lighthouse/limiares.json.
 *   5. Reprova (exit 1) se houver categoria abaixo do mínimo, auditoria crítica reprovada fora das exceções
 *      ou página sem pontuação. Relatórios JSON completos ficam em lighthouse-report/ (fora do git).
 *
 * Os dados de sessão são sintéticos. O Supabase é bloqueado na rede do Lighthouse: a medição não lê nem
 * escreve dados reais e não aparece na contagem de usuários on-line.
 *
 * Uso: npm run lighthouse                      (todas as páginas do limiares.json)
 *      npm run lighthouse -- dashboard.html    (só as páginas indicadas)
 * Requisito: Google Chrome ou Chromium instalado; CHROME_PATH aponta o executável se não estiver no PATH.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { build, RAIZ } = require('./build');

const LIMIARES_PADRAO = path.join(RAIZ, 'lighthouse', 'limiares.json');
const PASTA_RELATORIOS = path.join(RAIZ, 'lighthouse-report');
const CATEGORIAS_PERMITIDAS = ['performance', 'accessibility', 'best-practices', 'seo'];
const TIPOS_SESSAO = ['publica', 'sessao', 'pendencia'];

const SESSAO_VERIFICACAO = {
  nome: 'Operador de verificação (Lighthouse)',
  matricula: 'MAT-LH-0001',
  codigo_individual: 'NX-LH-0001',
  cargo: 'DIRETOR_OPERACOES_LOGISTICA',
  cargo_nome: 'Diretor de Operações'
};

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const fmt = (valor) => (typeof valor === 'number' ? valor.toFixed(2) : String(valor));

/** Lê e valida a configuração. Lança erro com a lista de problemas. */
function carregarLimiares(arquivo = LIMIARES_PADRAO) {
  const limiares = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  const problemas = validarLimiares(limiares);
  if (problemas.length) throw new Error(`limiares.json inválido:\n - ${problemas.join('\n - ')}`);
  return limiares;
}

/** Problemas da configuração (lista vazia quando está válida). */
function validarLimiares(limiares) {
  const problemas = [];
  const cats = limiares && limiares.categorias;
  if (!cats || typeof cats !== 'object') problemas.push('categorias ausentes');
  else {
    Object.keys(cats).forEach((id) => {
      if (!CATEGORIAS_PERMITIDAS.includes(id)) problemas.push(`categoria desconhecida: ${id}`);
      if (typeof cats[id] !== 'number' || cats[id] < 0 || cats[id] > 1) problemas.push(`mínimo de ${id} deve estar entre 0 e 1`);
    });
  }
  const paginas = (limiares && limiares.paginas) || [];
  if (!Array.isArray(paginas) || paginas.length === 0) problemas.push('nenhuma página configurada');
  const arquivos = new Set();
  paginas.forEach((p) => {
    if (!p || typeof p.arquivo !== 'string' || !p.arquivo.endsWith('.html')) problemas.push(`página inválida: ${JSON.stringify(p)}`);
    else if (arquivos.has(p.arquivo)) problemas.push(`página repetida: ${p.arquivo}`);
    else if (!fs.existsSync(path.join(RAIZ, p.arquivo))) problemas.push(`página inexistente: ${p.arquivo}`);
    if (p && !TIPOS_SESSAO.includes(p.sessao)) problemas.push(`${p.arquivo}: sessao deve ser ${TIPOS_SESSAO.join(', ')}`);
    if (p) arquivos.add(p.arquivo);
  });
  if (limiares && limiares.rodadas !== undefined && !(Number.isInteger(limiares.rodadas) && limiares.rodadas >= 1 && limiares.rodadas <= 5)) {
    problemas.push('rodadas deve ser um inteiro entre 1 e 5');
  }
  const criticas = (limiares && limiares.auditoriasCriticas) || [];
  if (!Array.isArray(criticas) || criticas.some((id) => typeof id !== 'string')) problemas.push('auditoriasCriticas deve ser uma lista de textos');
  const excecoes = (limiares && limiares.excecoes) || {};
  Object.keys(excecoes).forEach((id) => {
    const e = excecoes[id];
    if (!criticas.includes(id)) problemas.push(`exceção de ${id} que não está em auditoriasCriticas`);
    if (!e || !Array.isArray(e.paginas) || !e.motivo) problemas.push(`exceção de ${id} precisa de paginas e motivo`);
    else e.paginas.forEach((p) => { if (!arquivos.has(p)) problemas.push(`exceção de ${id} aponta para página fora da lista: ${p}`); });
  });
  return problemas;
}

/** Mediana de números (ignora valores ausentes). Lista vazia → null. */
function mediana(valores) {
  const v = valores.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/**
 * Consolida as rodadas de uma página (o CI compartilhado é ruidoso): pontuação de cada categoria
 * pela mediana; uma auditoria crítica só conta como reprovada se falhar na maioria das rodadas.
 */
function consolidarRodadas(lhrs, auditoriasCriticas) {
  const categorias = {};
  Object.keys((lhrs[0] && lhrs[0].categories) || {}).forEach((id) => {
    categorias[id] = {
      id,
      score: mediana(lhrs.map((l) => (l.categories && l.categories[id] ? l.categories[id].score : null)))
    };
  });
  const audits = {};
  auditoriasCriticas.forEach((id) => {
    const scores = lhrs.map((l) => (l.audits && l.audits[id] ? l.audits[id].score : undefined));
    if (scores.every((x) => x === undefined)) return;
    const reprovadas = scores.filter((x) => typeof x === 'number' && x < 1).length;
    audits[id] = { id, score: reprovadas > lhrs.length / 2 ? 0 : 1 };
  });
  return { categories: categorias, audits };
}

function excecaoPara(limiares, auditoria, arquivo) {
  const e = limiares.excecoes && limiares.excecoes[auditoria];
  return e && e.paginas.includes(arquivo) ? e : null;
}

/**
 * Avalia o resultado do Lighthouse de uma página. Função pura (testada sem navegador).
 * Retorna { arquivo, ok, categorias, falhas[], avisos[], excecoesAplicadas[] }.
 */
function avaliarLhr(lhr, limiares, arquivo) {
  const falhas = [];
  const avisos = [];
  const excecoesAplicadas = [];
  const categorias = {};

  Object.keys(limiares.categorias).forEach((id) => {
    const minimo = limiares.categorias[id];
    const cat = lhr && lhr.categories && lhr.categories[id];
    const score = cat && typeof cat.score === 'number' ? cat.score : null;
    categorias[id] = score;
    if (score === null) falhas.push(`categoria ${id} sem pontuação`);
    else if (score < minimo) falhas.push(`categoria ${id}: ${fmt(score)} abaixo do mínimo ${fmt(minimo)}`);
  });

  limiares.auditoriasCriticas.forEach((id) => {
    const audit = lhr && lhr.audits && lhr.audits[id];
    if (!audit) {
      avisos.push(`auditoria ${id} ausente do relatório`);
      return;
    }
    const reprovada = typeof audit.score === 'number' && audit.score < 1;
    const excecao = excecaoPara(limiares, id, arquivo);
    if (reprovada && excecao) excecoesAplicadas.push(`${id} (dívida conhecida: ${excecao.motivo})`);
    else if (reprovada) falhas.push(`auditoria crítica reprovada: ${id}`);
    else if (excecao) avisos.push(`exceção obsoleta: ${id} já passa aqui; remova de limiares.json`);
  });

  return { arquivo, ok: falhas.length === 0, categorias, falhas, avisos, excecoesAplicadas };
}

/**
 * Resolve um caminho de URL para um arquivo dentro de `pasta`. Retorna null se o caminho sair da pasta
 * (path traversal) ou se o arquivo não existir.
 */
function resolverArquivoDist(pasta, caminhoUrl) {
  let relativo;
  try {
    relativo = decodeURIComponent(String(caminhoUrl || '/').split('?')[0]);
  } catch (e) {
    return null;
  }
  if (relativo.endsWith('/')) relativo += 'index.html';
  const base = path.resolve(pasta);
  // A normalização ancora o caminho na raiz (sem `..` acima dela). A checagem abaixo é defesa em
  // profundidade: em outras plataformas, barras invertidas podem escapar da pasta.
  let arquivo = path.resolve(base, `.${path.posix.normalize(`/${relativo}`)}`);
  if (arquivo !== base && !arquivo.startsWith(base + path.sep)) return null;
  if (!fs.existsSync(arquivo) && fs.existsSync(`${arquivo}.html`)) arquivo = `${arquivo}.html`;
  if (!fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) return null;
  return arquivo;
}

/**
 * Regras de cabeçalho do arquivo `_headers` do build (formato do Netlify/Cloudflare Pages):
 * linha de caminho (glob) e, indentado, `Nome: valor`. Serve para o servidor local do gate medir
 * exatamente a política de cache que vai para produção.
 */
function carregarHeaders(pasta) {
  const arquivo = path.join(pasta, '_headers');
  if (!fs.existsSync(arquivo)) return [];
  const regras = [];
  let atual = null;
  fs.readFileSync(arquivo, 'utf-8').split('\n').forEach((linha) => {
    if (/^\s*#/.test(linha) || linha.trim() === '') return;
    const cabecalho = linha.match(/^\s+([A-Za-z0-9-]+)\s*:\s*(.+)$/);
    if (cabecalho && atual) {
      atual.cabecalhos.push([cabecalho[1], cabecalho[2]]);
      return;
    }
    if (!/^\s/.test(linha)) {
      atual = { padrao: linha.trim(), cabecalhos: [] };
      regras.push(atual);
    }
  });
  return regras;
}

/** Um caminho de URL casa com o glob do `_headers`? (* = qualquer coisa; /$ = diretório) */
function caminhoCasa(padrao, caminho) {
  const escapado = padrao.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escapado}$`).test(caminho);
}

/** Cabeçalhos que se aplicam a um caminho (a última regra que casa vence, como no Netlify). */
function headersPara(regras, caminho) {
  const resultado = new Map();
  regras.forEach((regra) => {
    if (caminhoCasa(regra.padrao, caminho)) {
      regra.cabecalhos.forEach(([nome, valor]) => resultado.set(nome, valor));
    }
  });
  return resultado;
}

/** Servidor estático local para dist/. Porta livre, só em 127.0.0.1. */
function iniciarServidor(pasta) {
  const regras = carregarHeaders(pasta);
  const servidor = http.createServer((req, res) => {
    const arquivo = resolverArquivoDist(pasta, req.url);
    if (!arquivo) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }
    const caminho = decodeURIComponent(String(req.url || '/').split('?')[0]);
    const cabecalhos = { 'Content-Type': TIPOS_MIME[path.extname(arquivo)] || 'application/octet-stream' };
    headersPara(regras, caminho).forEach((valor, nome) => { cabecalhos[nome] = valor; });
    res.writeHead(200, cabecalhos);
    fs.createReadStream(arquivo).pipe(res);
  });
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, origem: `http://127.0.0.1:${servidor.address().port}` }));
  });
}

function imprimirTabela(resultados) {
  const linhas = ['Página'.padEnd(24) + 'Desempenho  Acessib.  Boas práticas  SEO  Situação'];
  resultados.forEach((r) => {
    const c = r.categorias;
    const v = (x) => (x === null || x === undefined ? '  —  ' : x.toFixed(2).padStart(5));
    linhas.push(`${r.arquivo.padEnd(24)}${v(c.performance).padEnd(12)}${v(c.accessibility).padEnd(10)}${v(c['best-practices']).padEnd(16)}${v(c.seo).padEnd(6)}${r.ok ? 'OK' : 'REPROVADA'}`);
    r.falhas.forEach((f) => linhas.push(`    ✗ ${f}`));
    r.excecoesAplicadas.forEach((e) => linhas.push(`    · ${e}`));
    r.avisos.forEach((a) => linhas.push(`    ! ${a}`));
  });
  return linhas.join('\n');
}

/** Prepara a sessão do navegador para a página (apaga cookies anteriores antes). */
async function prepararSessao(navegador, origem, pagina) {
  const pag = await navegador.newPage();
  try {
    const cdp = await pag.createCDPSession();
    await cdp.send('Network.clearBrowserCookies');
    if (pagina.sessao === 'publica') return;
    await pag.goto(`${origem}/index.html`, { waitUntil: 'load' });
    if (pagina.sessao === 'sessao') {
      await pag.evaluate((s) => window.NexusSessionCookies.gravarSessao(s), SESSAO_VERIFICACAO);
    } else {
      await pag.evaluate((s) => window.NexusSessionCookies.gravarPendencia(s), SESSAO_VERIFICACAO);
    }
  } finally {
    await pag.close();
  }
}

async function executar(opcoes) {
  const o = opcoes || {};
  const limiares = carregarLimiares(o.limiares || LIMIARES_PADRAO);
  const paginas = limiares.paginas.filter((p) => !o.filtro || o.filtro.includes(p.arquivo));
  if (paginas.length === 0) throw new Error('nenhuma página selecionada pelo filtro');

  const { default: lighthouse, desktopConfig, defaultConfig } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  const puppeteer = await import('puppeteer-core');

  // A auditoria "sem erros no console" roda com os padrões declarados em limiares.rede: o host do
  // backend é bloqueado de propósito pelo gate e o ambiente de CI não alcança a internet, então as
  // falhas de rede dessas requisições são do ambiente de medição e não da aplicação. O resto do
  // console continua sendo auditado normalmente.
  // A configuração parte do preset de desktop e acrescenta as opções da auditoria de console.
  const configuracao = {
    ...desktopConfig,
    audits: [
      ...defaultConfig.audits,
      {
        path: 'errors-in-console',
        options: { ignoredPatterns: (limiares.rede.ignorarErrosDeConsole || []).map((d) => new RegExp(d)) }
      }
    ]
  };

  process.stdout.write('Gerando build de produção (dist/)...\n');
  await build();
  const { servidor, origem } = await iniciarServidor(path.join(RAIZ, 'dist'));

  let chrome = null;
  let navegador = null;
  const resultados = [];
  try {
    try {
      chrome = await chromeLauncher.launch({
        chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
      });
    } catch (erro) {
      throw new Error(`Chrome não encontrado ou não iniciou (${erro.message}). Instale o Google Chrome ou defina CHROME_PATH.`);
    }
    navegador = await puppeteer.default.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });

    fs.mkdirSync(PASTA_RELATORIOS, { recursive: true });
    for (const pagina of paginas) {
      process.stdout.write(`Medindo ${pagina.arquivo}...\n`);
      await prepararSessao(navegador, origem, pagina);
      const rodadas = limiares.rodadas || 3;
      const lhrs = [];
      for (let i = 1; i <= rodadas; i += 1) {
        const resultado = await lighthouse(`${origem}/${pagina.arquivo}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: CATEGORIAS_PERMITIDAS,
          disableStorageReset: true,
          blockedUrlPatterns: limiares.rede.bloquearHosts
        }, configuracao);
        lhrs.push(resultado.lhr);
        const base = pagina.arquivo.replace(/\.html$/, '');
        fs.writeFileSync(path.join(PASTA_RELATORIOS, `${base}-rodada-${i}.json`), JSON.stringify(resultado.lhr, null, 2));
      }
      resultados.push(avaliarLhr(consolidarRodadas(lhrs, limiares.auditoriasCriticas), limiares, pagina.arquivo));
    }
  } finally {
    if (navegador) await navegador.disconnect();
    if (chrome) await chrome.kill();
    servidor.close();
  }

  const reprovadas = resultados.filter((r) => !r.ok);
  process.stdout.write(`\n${imprimirTabela(resultados)}\n\n`);
  process.stdout.write(`Relatórios completos: ${path.relative(RAIZ, PASTA_RELATORIOS)}/\n`);
  return { ok: reprovadas.length === 0, resultados };
}

module.exports = {
  executar,
  avaliarLhr,
  carregarHeaders,
  headersPara,
  caminhoCasa,
  consolidarRodadas,
  mediana,
  carregarLimiares,
  validarLimiares,
  resolverArquivoDist,
  iniciarServidor,
  LIMIARES_PADRAO,
  PASTA_RELATORIOS,
  SESSAO_VERIFICACAO
};

if (require.main === module) {
  const filtro = process.argv.slice(2).filter((a) => a.endsWith('.html'));
  executar({ filtro: filtro.length ? filtro : null })
    .then(({ ok }) => {
      if (ok) process.stdout.write('✅ Gate Lighthouse aprovado.\n');
      else {
        process.stdout.write('❌ Gate Lighthouse reprovado: corrija as falhas acima.\n');
        process.exit(1);
      }
    })
    .catch((erro) => {
      process.stderr.write(`❌ Erro no gate Lighthouse: ${erro.message}\n`);
      process.exit(1);
    });
}
