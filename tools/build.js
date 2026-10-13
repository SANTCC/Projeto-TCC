#!/usr/bin/env node
/**
 * BUILD DE PRODUÇÃO — minificação de JS e CSS antes do deploy (Backlog 3, item G).
 *
 * Gera `dist/` a partir da raiz do projeto:
 *   - JS (js/**\/*.js e <script> inline das páginas): Terser, sem alterar nomes globais.
 *   - CSS (*.css e <style> inline das páginas): clean-css, nível 1 (sem reescrever regras).
 *   - Os blocos inline e os pontos de injeção (</head>, </body>, class de <html>) são localizados com
 *     o parse5, o parser do WHATWG — regex confunde "<script>" de comentário ou de atributo com tag
 *     real. Só os deslocamentos são usados: o HTML nunca é re-serializado (ver analisarHtml).
 *   - HTML, imagens e demais estáticos: copiados. Os caminhos não mudam (js/xxx.js continua válido).
 *   - Fora da saída: testes, ferramentas, SPECs, supabase, THEME (protótipos), documentação e manifestos.
 *
 * O Tailwind é carregado do CDN em tempo de execução (sem etapa de build) e os CDNs externos não são
 * alterados. `dist/` é gerado a cada build e está no .gitignore.
 *
 * Uso: npm run build            (gera dist/ e mostra o tamanho antes/depois)
 */
const fs = require('fs');
const path = require('path');
const { minify: minificarJs } = require('terser');
const CleanCSS = require('clean-css');
const parse5 = require('parse5');

const RAIZ = path.join(__dirname, '..');
const SAIDA_PADRAO = path.join(RAIZ, 'dist');

// Diretórios que nunca vão para produção (em qualquer nível).
const DIRETORIOS_EXCLUIDOS = new Set([
  'node_modules', '.git', '.github', '.vercel', 'dist', 'tests', 'tools', 'SPECs', 'supabase', 'THEME',
  'lighthouse', 'lighthouse-report'
]);
// Arquivos da raiz que não são servidos. Documentação (.md) e Python (.py) são excluídos em qualquer pasta.
const ARQUIVOS_EXCLUIDOS = new Set([
  'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.vercelignore',
  'tailwind.config.js', 'nexus_cli.py'
]);

// keep_fnames: nomes de função são preservados (stack traces legíveis).
// Diferença conhecida: o `.name` de uma função anônima atribuída a uma variável pode mudar, porque o
// compressor pode embutir a função no lugar do uso. Não é contrato de execução do app; os testes de
// comportamento rodam no código-fonte.
const OPCOES_TERSER = {
  compress: { passes: 2 },
  mangle: { keep_fnames: true },
  keep_fnames: true,
  format: { comments: false }
};

/** Lista os arquivos que vão para produção (caminhos relativos à raiz, com /). */
function listarArquivos(dir = RAIZ, base = '') {
  const resultado = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entrada) => {
    const rel = base ? `${base}/${entrada.name}` : entrada.name;
    if (entrada.isDirectory()) {
      if (DIRETORIOS_EXCLUIDOS.has(entrada.name)) return;
      resultado.push(...listarArquivos(path.join(dir, entrada.name), rel));
      return;
    }
    if (!entrada.isFile()) return;
    if (!base && ARQUIVOS_EXCLUIDOS.has(entrada.name)) return;
    // Documentação (.md) e ferramentas Python (CLI e testes da API) não vão para produção.
    if (['.md', '.py'].includes(path.extname(entrada.name).toLowerCase())) return;
    // CSS de origem do Tailwind (css/nexus.source.css): a saída é o compilado css/nexus.css.
    if (/\.source\.css$/.test(entrada.name)) return;
    resultado.push(rel);
  });
  return resultado.sort();
}

const bytes = (texto) => Buffer.byteLength(texto, 'utf-8');


/** Tipos de <script> inline que são JavaScript e podem passar pelo compressor. */
const TIPOS_JS = new Set([
  'text/javascript', 'text/ecmascript', 'application/javascript',
  'application/ecmascript', 'application/x-javascript', 'module'
]);

/**
 * Localiza no HTML os pontos que o build altera — o conteúdo dos blocos
 * <script>/<style> inline, o atributo `class` de <html> e as tags </head> e
 * </body> — usando o parse5, o parser do WHATWG que o jsdom e o Angular usam.
 *
 * Expressão regular não entende HTML: confunde um "<script>" escrito dentro de
 * comentário ou dentro do valor de um atributo com uma tag real, e corta o
 * bloco no primeiro "</script>" que aparecer numa string. O parse5 segue a
 * especificação em vez de adivinhar, e por isso enxerga o documento do mesmo
 * jeito que o navegador vai enxergar.
 *
 * Só os deslocamentos (offsets) calculados pelo parser são usados: o arquivo
 * continua sendo reescrito por recorte, sem re-serializar o HTML, então nada
 * além do trecho alterado muda um byte.
 */
function analisarHtml(html) {
  const documento = parse5.parse(html, { sourceCodeLocationInfo: true });
  const raiz = documento.childNodes.find((no) => no.tagName === 'html');
  if (!raiz || !raiz.sourceCodeLocation || !raiz.sourceCodeLocation.startTag) return null;

  const cabeca = raiz.childNodes.find((no) => no.tagName === 'head');
  const corpo = raiz.childNodes.find((no) => no.tagName === 'body');
  const fimDe = (no) => no && no.sourceCodeLocation && no.sourceCodeLocation.endTag;
  if (!fimDe(cabeca) || !fimDe(corpo)) return null;

  const blocos = [];
  const percorrer = (no) => {
    if (no.tagName === 'script' || no.tagName === 'style') {
      const texto = (no.childNodes || []).find((filho) => filho.nodeName === '#text');
      if (texto && texto.sourceCodeLocation && /\S/.test(texto.value)) {
        blocos.push({
          tag: no.tagName,
          atributos: no.attrs || [],
          conteudo: texto.value,
          inicio: texto.sourceCodeLocation.startOffset,
          fim: texto.sourceCodeLocation.endOffset
        });
      }
    }
    (no.childNodes || []).forEach(percorrer);
  };
  percorrer(documento);

  const local = raiz.sourceCodeLocation;
  return {
    blocos,
    classe: (local.attrs && local.attrs.class) || null,
    valorClasse: (raiz.attrs.find((atributo) => atributo.name === 'class') || {}).value || '',
    fimTagHtml: local.startTag.endOffset,
    fimCabeca: cabeca.sourceCodeLocation.endTag.startOffset,
    fimCorpo: corpo.sourceCodeLocation.endTag.startOffset
  };
}

/** Aplica recortes ao HTML do fim para o começo, para os offsets continuarem válidos. */
function aplicarTrechos(html, trechos) {
  let saida = html;
  trechos.slice().sort((a, b) => b.inicio - a.inicio).forEach(({ inicio, fim, texto }) => {
    saida = saida.slice(0, inicio) + texto + saida.slice(fim);
  });
  return saida;
}

/** Minifica o conteúdo de cada <script> inline (sem src e de tipo JavaScript). */
async function minificarScriptsInline(html, registro, nome) {
  const analise = analisarHtml(html);
  if (!analise) return html;
  const trechos = [];
  for (const bloco of analise.blocos.filter((b) => b.tag === 'script')) {
    const atributo = (chave) => (bloco.atributos.find((a) => a.name === chave) || {}).value;
    if (atributo('src')) continue;
    const tipo = String(atributo('type') || 'text/javascript').trim().toLowerCase();
    if (!TIPOS_JS.has(tipo)) continue;
    let codigo;
    try {
      codigo = (await minificarJs(bloco.conteudo, OPCOES_TERSER)).code;
    } catch (erro) {
      throw new Error(`${nome}: erro de sintaxe em <script> inline — ${erro.message}`);
    }
    registro.js.push({ arquivo: `${nome} (inline)`, antes: bytes(bloco.conteudo), depois: bytes(codigo) });
    trechos.push({ inicio: bloco.inicio, fim: bloco.fim, texto: codigo });
  }
  return aplicarTrechos(html, trechos);
}

/** Minifica o conteúdo de cada <style> inline. */
function minificarEstilosInline(html, registro, nome) {
  const analise = analisarHtml(html);
  if (!analise) return html;
  const trechos = [];
  for (const bloco of analise.blocos.filter((b) => b.tag === 'style')) {
    const r = new CleanCSS({ level: 1 }).minify(bloco.conteudo);
    if (r.errors.length) throw new Error(`${nome}: erro de CSS inline — ${r.errors.join('; ')}`);
    registro.css.push({ arquivo: `${nome} (inline)`, antes: bytes(bloco.conteudo), depois: bytes(r.styles) });
    trechos.push({ inicio: bloco.inicio, fim: bloco.fim, texto: r.styles });
  }
  return aplicarTrechos(html, trechos);
}

async function minificarJsArquivo(origem, destino, registro, rel) {
  const codigo = fs.readFileSync(origem, 'utf-8');
  let minificado;
  try {
    minificado = (await minificarJs(codigo, OPCOES_TERSER)).code;
  } catch (erro) {
    throw new Error(`${rel}: erro de sintaxe — ${erro.message}`);
  }
  registro.js.push({ arquivo: rel, antes: bytes(codigo), depois: bytes(minificado) });
  fs.writeFileSync(destino, minificado, 'utf-8');
}

/**
 * Cabeçalhos de cache da saída — usados por `_headers` (Netlify, Cloudflare Pages) e declarados em
 * `vercel.json` para a Vercel. O gate Lighthouse lê este mesmo arquivo para medir a política de
 * cache real que vai para produção.
 *
 * Regra: tudo que é versionado por conteúdo (css/, fonts/, vendor/, imagens) fica imutável por um
 * ano; as páginas HTML revalidam sempre (`no-cache` = sempre revalidar, sem impedir o 304), porque
 * referenciam módulos que mudam sem troca de nome de arquivo.
 */
const _cacheHtml = 'public, max-age=0, must-revalidate';
const _cacheEstatico = 'public, max-age=31536000, immutable';

/**
 * Política de segurança de conteúdo (Backlog 4, item 3.1). As páginas usam scripts em linha e
 * manipuladores `onclick`, então `script-src` precisa de 'unsafe-inline' — a CSP aqui barra origem
 * externa desconhecida (scripts, estilos, frames, conexões) e é o que o Lighthouse lê no cabeçalho
 * `Content-Security-Policy`. Origens permitidas: Google Analytics (medição) e VLibras (acessibilidade).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://vlibras.gov.br",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.google-analytics.com https://region1.google-analytics.com",
  'frame-src https://vlibras.gov.br',
  'media-src https://vlibras.gov.br',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

/** Linhas do arquivo `_headers` (formato: caminho e cabeçalhos indentados). */
function linhasDeHeaders() {
  const linhas = [
    '# Cabeçalhos de cache e segurança — gerado por tools/build.js (npm run build). Não editar à mão.',
    '# As regras são globs de caminho; a última regra que casa é a que vale no Netlify, então as',
    '# exceções (HTML) vêm depois das regras abrangentes. O gate Lighthouse lê este arquivo para',
    '# medir a política que vai para produção (ver tools/lighthouse-check.js).',
    '',
    '/*',
    `  Cache-Control: ${_cacheEstatico}`,
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '',
    '/*.html',
    `  Cache-Control: ${_cacheHtml}`,
    `  Content-Security-Policy: ${CSP}`,
    '',
    '/*/',
    `  Cache-Control: ${_cacheHtml}`,
    `  Content-Security-Policy: ${CSP}`,
    ''
  ];
  return linhas;
}

/** Escreve o `_headers` da saída. */
function escreverHeaders(saida) {
  fs.writeFileSync(path.join(saida, '_headers'), `${linhasDeHeaders().join('\n')}\n`, 'utf-8');
}

/**
 * Adiciona uma espera visual de VPN a todas as páginas da saída estática.
 * A Edge Function decide se o body é revelado; a origem estática, por si só,
 * continua entregando os arquivos ao navegador (não é um firewall HTTP).
 */
function aplicarVpnGate(html, nome) {
  const analise = analisarHtml(html);
  if (!analise) throw new Error(`${nome}: tag <html> não encontrada para instalar o gate VPN.`);
  const { classe, valorClasse, fimTagHtml, fimCabeca, fimCorpo } = analise;
  const trechos = [];

  // about.html e a página pública de diagnóstico não usam o cliente Supabase,
  // mas precisam da configuração no build para consultar esta mesma função.
  if (!/<script\b[^>]*\bsrc=["']js\/config\.example\.js["']/i.test(html)) {
    const configuracaoPublica = [
      '  <script src="js/config.example.js"></script>',
      '  <script src="js/config.js" onerror="this.remove()"></script>',
      ''
    ].join('\n');
    trechos.push({ inicio: fimCorpo, fim: fimCorpo, texto: configuracaoPublica });
  }

  if (!html.includes('js/vpn-gate.js')) {
    const recursos = [
      '  <link rel="stylesheet" href="css/vpn-gate.css?v=20261011" />',
      '  <script defer src="js/vpn-gate.js?v=20261011"></script>',
      ''
    ].join('\n');
    trechos.push({ inicio: fimCabeca, fim: fimCabeca, texto: recursos });
  }

  if (classe) {
    const nomes = valorClasse.trim().split(/\s+/).filter(Boolean);
    if (!nomes.includes('nexus-vpn-gate-checking')) {
      // Insere antes da aspa de fechamento, preservando a formatação original do atributo.
      const fim = classe.endOffset;
      const ponto = /["']/.test(html[fim - 1]) ? fim - 1 : fim;
      trechos.push({
        inicio: ponto,
        fim: ponto,
        texto: `${nomes.length ? ' ' : ''}nexus-vpn-gate-checking`
      });
    }
  } else {
    const ponto = fimTagHtml - 1;
    trechos.push({ inicio: ponto, fim: ponto, texto: ' class="nexus-vpn-gate-checking"' });
  }

  return aplicarTrechos(html, trechos);
}

/**
 * Gera a saída de produção. Retorna o registro de tamanhos (antes/depois) por tipo de arquivo.
 * Opções: saida (padrão: dist/). A saída é apagada e recriada.
 */
async function build(opcoes) {
  const saida = path.resolve((opcoes && opcoes.saida) || SAIDA_PADRAO);
  if (saida === RAIZ || RAIZ.startsWith(saida + path.sep)) {
    throw new Error('A saída do build não pode ser a raiz do projeto nem uma pasta acima dela.');
  }
  fs.rmSync(saida, { recursive: true, force: true });
  fs.mkdirSync(saida, { recursive: true });

  const registro = { js: [], css: [], html: [], copiados: [] };
  const arquivos = listarArquivos();

  for (const rel of arquivos) {
    const origem = path.join(RAIZ, rel);
    const destino = path.join(saida, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const ext = path.extname(rel).toLowerCase();

    if (ext === '.js') {
      await minificarJsArquivo(origem, destino, registro, rel);
    } else if (ext === '.css') {
      const css = fs.readFileSync(origem, 'utf-8');
      const r = new CleanCSS({ level: 1 }).minify(css);
      if (r.errors.length) throw new Error(`${rel}: erro de CSS — ${r.errors.join('; ')}`);
      registro.css.push({ arquivo: rel, antes: bytes(css), depois: bytes(r.styles) });
      fs.writeFileSync(destino, r.styles, 'utf-8');
    } else if (ext === '.html') {
      const html = fs.readFileSync(origem, 'utf-8');
      const htmlComGateVpn = aplicarVpnGate(html, rel);
      const comScriptsMinificados = await minificarScriptsInline(htmlComGateVpn, registro, rel);
      const comEstilosMinificados = minificarEstilosInline(comScriptsMinificados, registro, rel);
      registro.html.push({ arquivo: rel, antes: bytes(html), depois: bytes(comEstilosMinificados) });
      fs.writeFileSync(destino, comEstilosMinificados, 'utf-8');
    } else {
      fs.copyFileSync(origem, destino);
      registro.copiados.push(rel);
    }
  }

  // Recursos locais (css/, fonts/, vendor/): gerados aqui para o dist/ nunca sair com CSS ou
  // bibliotecas desatualizados em relação às dependências instaladas.
  await require('./assets').gerarRecursosNoDisco(saida);
  fs.mkdirSync(path.join(saida, 'css'), { recursive: true });
  fs.mkdirSync(path.join(saida, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(saida, 'vendor'), { recursive: true });
  for (const rel of ['css/nexus.css', 'css/fonts.css']) {
    const conteudo = fs.readFileSync(path.join(RAIZ, rel), 'utf-8');
    fs.writeFileSync(path.join(saida, rel), conteudo, 'utf-8');
    registro.copiados.push(rel);
  }
  fs.readdirSync(path.join(RAIZ, 'fonts')).forEach((nome) => {
    fs.copyFileSync(path.join(RAIZ, 'fonts', nome), path.join(saida, 'fonts', nome));
    registro.copiados.push(`fonts/${nome}`);
  });
  fs.readdirSync(path.join(RAIZ, 'vendor')).forEach((nome) => {
    fs.copyFileSync(path.join(RAIZ, 'vendor', nome), path.join(saida, 'vendor', nome));
    registro.copiados.push(`vendor/${nome}`);
  });

  escreverHeaders(saida);
  return registro;
}

function soma(lista, campo) {
  return lista.reduce((total, item) => total + item[campo], 0);
}

function resumo(registro) {
  const linhas = [];
  [['JS', registro.js], ['CSS', registro.css], ['HTML (com blocos inline)', registro.html]].forEach(([nome, lista]) => {
    const antes = soma(lista, 'antes');
    const depois = soma(lista, 'depois');
    const pct = antes ? Math.round((1 - depois / antes) * 100) : 0;
    linhas.push(`${nome.padEnd(26)} ${String(lista.length).padStart(3)} itens   ${antes} → ${depois} bytes   (−${pct}%)`);
  });
  linhas.push(`Arquivos copiados sem alteração: ${registro.copiados.length}`);
  return linhas.join('\n');
}

// `internos` existe para os testes: o build é determinístico e roda em cima de
// arquivos reais, então os ajustes de HTML são verificados isoladamente.
const internos = { analisarHtml, aplicarTrechos, minificarScriptsInline, minificarEstilosInline, aplicarVpnGate };

module.exports = { build, listarArquivos, linhasDeHeaders, SAIDA_PADRAO, RAIZ, internos };

if (require.main === module) {
  build()
    .then((registro) => {
      process.stdout.write(`Build concluído em ${path.relative(RAIZ, SAIDA_PADRAO)}/\n${resumo(registro)}\n`);
    })
    .catch((erro) => {
      process.stderr.write(`❌ Falha no build: ${erro.message}\n`);
      process.exit(1);
    });
}
