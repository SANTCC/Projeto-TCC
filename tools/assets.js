#!/usr/bin/env node
/**
 * RECURSOS LOCAIS DO FRONT-END — NexusPort.
 *
 * As páginas carregavam Tailwind, fontes, ícones e bibliotecas por CDN (4 origens externas). Aqui
 * esses recursos são compilados/copiados para dentro do projeto, o que remove os terceiros do
 * caminho crítico, permite cache de longo prazo e faz o sistema funcionar sem internet:
 *
 *   css/nexus.css   CSS do Tailwind 3 compilado a partir das classes de todas as páginas
 *                   (substitui https://cdn.tailwindcss.com, ~400 KiB de JavaScript de compilação).
 *   css/fonts.css   @font-face das fontes locais (substitui fonts.googleapis.com).
 *   fonts/*.woff2   Inter, Montserrat, JetBrains Mono (subconjunto latino) e Material Symbols
 *                   reduzido aos ícones usados (3,7 MB → ~120 KiB, ver tools/subset-material-symbols.py).
 *   vendor/*.js     Bibliotecas de terceiros instaladas por npm e minificadas (substituem
 *                   cdn.jsdelivr.net, unpkg.com e cdnjs.cloudflare.com).
 *
 * Uso: npm run assets            (regenera os recursos e mostra o tamanho de cada um)
 *      npm run assets -- --check (não escreve: falha se os arquivos versionados estiverem desatualizados)
 *
 * O build de produção (`tools/build.js`) chama a geração antes de copiar a saída, então o dist/
 * sempre sai com o CSS e as bibliotecas atuais.
 */
const fs = require('fs');
const path = require('path');
const { minify: minificarJs } = require('terser');

const RAIZ = path.join(__dirname, '..');
const PASTA_CSS = path.join(RAIZ, 'css');
const PASTA_FONTES = path.join(RAIZ, 'fonts');
const PASTA_VENDOR = path.join(RAIZ, 'vendor');
const CONFIG_TAILWIND = path.join(RAIZ, 'tailwind.config.js');

/** Tamanho mínimo aceitável do CSS compilado (as telas do sistema passam de 50 KiB). */
const MINIMO_CSS = 20000;

const CSS_TAILWIND = path.join(PASTA_CSS, 'nexus.css');
/** CSS escrito à mão (diretivas do Tailwind + regras globais do app). */
const CSS_ORIGEM = path.join(PASTA_CSS, 'nexus.source.css');
const CSS_FONTES = path.join(PASTA_CSS, 'fonts.css');

/** Pesos e subconjuntos usados pelas páginas (as URLs do Google Fonts pediam exatamente estes). */
const FONTES = [
  { pacote: '@fontsource/inter', familia: 'inter', subconjunto: 'latin', pesos: [400, 500, 600, 700] },
  { pacote: '@fontsource/montserrat', familia: 'montserrat', subconjunto: 'latin', pesos: [600, 700] },
  { pacote: '@fontsource/jetbrains-mono', familia: 'jetbrains-mono', subconjunto: 'latin', pesos: [500, 600] }
];

/** Famílias usadas nas regras @font-face, na ordem declarada nos CSS originais. */
const FAMILIAS = new Map([
  ['inter', 'Inter'],
  ['montserrat', 'Montserrat'],
  ['jetbrains-mono', 'JetBrains Mono']
]);

/** Fonte local com versão no nome para invalidar caches imutáveis após ampliar o subconjunto. */
const FONTE_ICONES = 'material-symbols-outlined-v3.woff2';
/** Nome original da fonte completa publicada pelo pacote npm material-symbols. */
const FONTE_ICONES_COMPLETA = 'material-symbols-outlined.woff2';
const PACOTE_ICONES = 'material-symbols';
const PACOTE_FONTAWESOME = '@fortawesome/fontawesome-free';
const FONTES_FONTAWESOME = ['fa-solid-900.woff2', 'fa-regular-400.woff2'];

/** Mapeamento canônico de todos os ícones do sistema para Font Awesome. */
const MAPA_ICONES_FA = {
  account_tree: 'fa-sitemap',
  add: 'fa-plus',
  add_circle: 'fa-circle-plus',
  alt_route: 'fa-route',
  anchor: 'fa-anchor',
  apps: 'fa-grip',
  assessment: 'fa-chart-column',
  assignment: 'fa-clipboard-list',
  assignment_ind: 'fa-id-badge',
  autorenew: 'fa-arrows-rotate',
  badge: 'fa-id-card-clip',
  bar_chart: 'fa-chart-column',
  block: 'fa-ban',
  build: 'fa-wrench',
  build_circle: 'fa-screwdriver-wrench',
  camera_alt: 'fa-camera',
  campaign: 'fa-bullhorn',
  cancel: 'fa-circle-xmark',
  category: 'fa-shapes',
  check: 'fa-check',
  check_circle: 'fa-circle-check',
  close: 'fa-xmark',
  cloud_off: 'fa-cloud-bolt',
  contact_support: 'fa-headset',
  conveyor_belt: 'fa-dolly',
  dark_mode: 'fa-moon',
  dashboard: 'fa-gauge-high',
  delete: 'fa-trash-can',
  deployed_code: 'fa-cube',
  directions_boat: 'fa-ship',
  dock: 'fa-anchor-circle-check',
  download: 'fa-download',
  draw: 'fa-pen-nib',
  e911_emergency: 'fa-triangle-exclamation',
  edit: 'fa-pen-to-square',
  edit_note: 'fa-file-pen',
  engineering: 'fa-helmet-safety',
  error: 'fa-circle-exclamation',
  event_available: 'fa-calendar-check',
  explore: 'fa-compass',
  fact_check: 'fa-clipboard-check',
  filter_alt: 'fa-filter',
  filter_alt_off: 'fa-filter-circle-xmark',
  fingerprint: 'fa-fingerprint',
  forklift: 'fa-truck-ramp-box',
  functions: 'fa-calculator',
  gavel: 'fa-gavel',
  grid_view: 'fa-table-cells-large',
  group: 'fa-user-group',
  groups: 'fa-users',
  help: 'fa-circle-question',
  help_outline: 'fa-circle-question',
  history: 'fa-clock-rotate-left',
  history_edu: 'fa-file-signature',
  hourglass_empty: 'fa-hourglass-half',
  how_to_reg: 'fa-user-check',
  id_card: 'fa-id-card',
  info: 'fa-circle-info',
  insights: 'fa-chart-line',
  inventory_2: 'fa-boxes-stacked',
  key_off: 'fa-key',
  lan: 'fa-network-wired',
  light_mode: 'fa-sun',
  link: 'fa-link',
  link_off: 'fa-link-slash',
  lock: 'fa-lock',
  login: 'fa-right-to-bracket',
  logout: 'fa-right-from-bracket',
  menu: 'fa-bars',
  monitoring: 'fa-chart-line',
  notifications_off: 'fa-bell-slash',
  payments: 'fa-money-bill-wave',
  photo_camera: 'fa-camera',
  picture_as_pdf: 'fa-file-pdf',
  pie_chart: 'fa-chart-pie',
  precision_manufacturing: 'fa-gears',
  print: 'fa-print',
  progress_activity: 'fa-spinner',
  qr_code: 'fa-qrcode',
  qr_code_2: 'fa-qrcode',
  qr_code_scanner: 'fa-qrcode',
  refresh: 'fa-arrows-rotate',
  route: 'fa-route',
  rule: 'fa-list-check',
  sailing: 'fa-sailboat',
  save: 'fa-floppy-disk',
  schedule: 'fa-clock',
  search: 'fa-magnifying-glass',
  search_off: 'fa-magnifying-glass-minus',
  sensors: 'fa-tower-broadcast',
  settings: 'fa-gear',
  shield: 'fa-shield',
  shield_lock: 'fa-shield-halved',
  shield_person: 'fa-user-shield',
  smart_toy: 'fa-robot',
  smartphone: 'fa-mobile-screen-button',
  speed: 'fa-gauge',
  storage: 'fa-database',
  swipe: 'fa-arrows-left-right',
  sync: 'fa-rotate',
  table_chart: 'fa-table',
  table_rows: 'fa-table-list',
  task: 'fa-file-circle-check',
  task_alt: 'fa-circle-check',
  timeline: 'fa-timeline',
  travel_explore: 'fa-globe',
  verified: 'fa-certificate',
  verified_user: 'fa-shield-halved',
  vibration: 'fa-mobile-screen',
  visibility: 'fa-eye',
  visibility_off: 'fa-eye-slash',
  volume_up: 'fa-volume-high',
  warehouse: 'fa-warehouse',
  warning: 'fa-triangle-exclamation',
  web: 'fa-window-maximize',
  workspace_premium: 'fa-award'
};

/**
 * Bibliotecas de terceiros. `origem` é o arquivo publicado no npm (mesma versão que os CDNs
 * serviam) e `nome` é o arquivo estável usado pelas páginas em vendor/.
 */
const BIBLIOTECAS = [
  { nome: 'supabase-js.min.js', pacote: '@supabase/supabase-js', origem: 'dist/umd/supabase.js', minificar: true },
  { nome: 'chart-js.min.js', pacote: 'chart.js', origem: 'dist/chart.umd.min.js', minificar: false },
  { nome: 'qrcode.min.js', pacote: 'qrcode', origem: 'build/qrcode.js', minificar: true },
  { nome: 'html5-qrcode.min.js', pacote: 'html5-qrcode', origem: 'html5-qrcode.min.js', minificar: false },
  { nome: 'jspdf.min.js', pacote: 'jspdf', origem: 'dist/jspdf.umd.min.js', minificar: false }
];

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

function exigir(caminho, mensagem) {
  if (!fs.existsSync(caminho)) throw new Error(`${mensagem} (faltando: ${path.relative(RAIZ, caminho)})`);
}

/** Versão instalada de um pacote npm do projeto. */
function versaoDoPacote(pacote) {
  const arquivo = path.join(RAIZ, 'node_modules', pacote, 'package.json');
  exigir(arquivo, `Dependência ausente: ${pacote}. Rode "npm ci"`);
  return JSON.parse(fs.readFileSync(arquivo, 'utf-8')).version;
}

/** CSS do Tailwind compilado a partir das classes de todas as páginas e módulos. */
async function compilarTailwind() {
  const postcss = require('postcss');
  const tailwindcss = require('tailwindcss');
  const config = require(CONFIG_TAILWIND);
  exigir(CSS_ORIGEM, 'CSS de origem ausente (css/nexus.source.css)');
  const entrada = fs.readFileSync(CSS_ORIGEM, 'utf-8');
  const resultado = await postcss([tailwindcss(config)]).process(entrada, { from: undefined });
  const avisos = resultado.warnings();
  if (avisos.length) {
    throw new Error(`Tailwind emitiu avisos: ${avisos.map((a) => a.text).join('; ')}`);
  }
  const css = `/* GERADO POR tools/assets.js (npm run assets) — não editar à mão. */\n${resultado.css}\n`;
  // Trava de segurança: se a varredura de classes não encontrar as telas (caminho errado, CWD
  // diferente), o Tailwind devolve só o preflight (~10 KiB) e as páginas sairiam sem estilo.
  if (Buffer.byteLength(css) < MINIMO_CSS) {
    throw new Error(
      `CSS do Tailwind com ${Buffer.byteLength(css)} bytes (mínimo ${MINIMO_CSS}): a varredura de classes ` +
      'não encontrou as páginas. Confira o "content" de tailwind.config.js.'
    );
  }
  return css;
}

/** Declarações @font-face das fontes locais (mesmos pesos que as URLs do Google Fonts pediam). */
function cssDeFontes() {
  const linhas = ['/* GERADO POR tools/assets.js (npm run assets) — não editar à mão. */'];
  FONTES.forEach(({ familia, subconjunto, pesos }) => {
    pesos.forEach((peso) => {
      linhas.push(
        '@font-face {',
        `  font-family: '${FAMILIAS.get(familia)}';`,
        '  font-style: normal;',
        `  font-weight: ${peso};`,
        '  font-display: swap;',
        `  src: url('../fonts/${familia}-${subconjunto}-${peso}-normal.woff2') format('woff2');`,
        '}'
      );
    });
  });

  const faCssPath = path.join(RAIZ, 'node_modules', PACOTE_FONTAWESOME, 'css', 'fontawesome.css');
  exigir(faCssPath, `CSS do Font Awesome ausente em ${PACOTE_FONTAWESOME}`);
  const faCssOrig = fs.readFileSync(faCssPath, 'utf-8');
  const glifosFa = new Map();
  const reFa = /\.(fa-[a-z0-9-]+)\s*\{\s*--fa:\s*("[^"]+");\s*\}/g;
  let mFa;
  while ((mFa = reFa.exec(faCssOrig)) !== null) {
    glifosFa.set(mFa[1], mFa[2]);
  }

  linhas.push(
    '/* Font Awesome Free — biblioteca oficial de ícones do sistema (Tarefa 3). */',
    '@font-face {',
    "  font-family: 'Font Awesome 6 Free';",
    '  font-style: normal;',
    '  font-weight: 900;',
    '  font-display: block;',
    "  src: url('../fonts/fa-solid-900.woff2') format('woff2');",
    '}',
    '@font-face {',
    "  font-family: 'Font Awesome 6 Free';",
    '  font-style: normal;',
    '  font-weight: 400;',
    '  font-display: block;',
    "  src: url('../fonts/fa-regular-400.woff2') format('woff2');",
    '}',
    '/* Material Symbols Outlined — subconjunto com os ícones usados pelas telas. */',
    '@font-face {',
    `  font-family: 'Material Symbols Outlined';`,
    '  font-style: normal;',
    '  font-weight: 100 700;',
    '  font-display: block;',
    `  src: url('../fonts/${FONTE_ICONES}') format('woff2');`,
    '}',
    '.fa-solid, .fas, .fa-regular, .far, .fa, .material-symbols-outlined {',
    "  font-family: 'Font Awesome 6 Free' !important;",
    '  font-weight: 900;',
    '  font-style: normal;',
    '  line-height: 1;',
    '  letter-spacing: normal;',
    '  text-transform: none;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  white-space: nowrap;',
    '  word-wrap: normal;',
    '  direction: ltr;',
    '  -webkit-font-smoothing: antialiased;',
    '  -moz-osx-font-smoothing: grayscale;',
    '  font-variation-settings: normal !important;',
    '  -webkit-font-feature-settings: normal !important;',
    '  font-feature-settings: normal !important;',
    '  pointer-events: none;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '  speak: never;',
    '}',
    '.fa-regular, .far {',
    '  font-weight: 400;',
    '}',
    '.fa-solid::before, .fas::before, .fa-regular::before, .far::before, .fa::before, .material-symbols-outlined::before {',
    '  content: var(--fa);',
    '  content: var(--fa) / "";',
    "  font-family: 'Font Awesome 6 Free' !important;",
    '  font-weight: inherit;',
    '  line-height: 1;',
    '  speak: never;',
    '}'
  );

  const classesFaUsadas = new Set([
    ...Object.values(MAPA_ICONES_FA),
    'fa-eye', 'fa-eye-slash', 'fa-gear', 'fa-cog', 'fa-file-excel', 'fa-file-csv',
    'fa-chevron-down', 'fa-chevron-up', 'fa-chevron-left', 'fa-chevron-right',
    'fa-circle-user', 'fa-user', 'fa-bell', 'fa-unlock'
  ]);
  Array.from(classesFaUsadas).sort().forEach((cls) => {
    const glifo = glifosFa.get(cls);
    if (glifo) {
      linhas.push(`.${cls} { --fa: ${glifo}; }`);
    }
  });
  Object.keys(MAPA_ICONES_FA).sort().forEach((chave) => {
    const cls = MAPA_ICONES_FA[chave];
    const glifo = glifosFa.get(cls);
    if (glifo) {
      linhas.push(`[data-icon="${chave}"] { --fa: ${glifo}; }`);
    }
  });

  return `${linhas.join('\n')}\n`;
}

/**
 * Gera os recursos em memória (sem escrever no disco). Retorna um mapa caminho absoluto → conteúdo
 * (string para textos, Buffer para binários), usado tanto para gravar quanto para conferir.
 */
async function gerarRecursos() {
  const recursos = new Map();

  recursos.set(CSS_TAILWIND, await compilarTailwind());
  recursos.set(CSS_FONTES, cssDeFontes());

  FONTES.forEach(({ pacote, familia, subconjunto, pesos }) => {
    pesos.forEach((peso) => {
      const nome = `${familia}-${subconjunto}-${peso}-normal.woff2`;
      const origem = path.join(RAIZ, 'node_modules', pacote, 'files', nome);
      exigir(origem, `Fonte ausente em ${pacote}`);
      recursos.set(path.join(PASTA_FONTES, nome), fs.readFileSync(origem));
    });
  });

  FONTES_FONTAWESOME.forEach((nome) => {
    const origem = path.join(RAIZ, 'node_modules', PACOTE_FONTAWESOME, 'webfonts', nome);
    exigir(origem, `Fonte Font Awesome ausente em ${PACOTE_FONTAWESOME}`);
    recursos.set(path.join(PASTA_FONTES, nome), fs.readFileSync(origem));
  });

  // O pacote npm traz a fonte completa (3,7 MB); o subconjunto com os ícones usados é gerado uma vez
  // por tools/subset-material-symbols.py e versionado em fonts/, fora do node_modules.
  exigir(path.join(RAIZ, 'node_modules', PACOTE_ICONES, FONTE_ICONES_COMPLETA),
    `Pacote ${PACOTE_ICONES} ausente. Rode "npm ci" antes de gerar o subconjunto dos ícones`);
  exigir(path.join(PASTA_FONTES, FONTE_ICONES),
    'Subconjunto de ícones ausente: rode python3 tools/subset-material-symbols.py');

  for (const lib of BIBLIOTECAS) {
    const versao = versaoDoPacote(lib.pacote);
    const origem = path.join(RAIZ, 'node_modules', lib.pacote, lib.origem);
    exigir(origem, `Biblioteca ausente em ${lib.pacote}`);
    const codigo = fs.readFileSync(origem, 'utf-8');
    const conteudo = lib.minificar
      ? `/* ${lib.pacote}@${versao} — minificado por tools/assets.js */\n${(await minificarJs(codigo, { compress: true, mangle: true, format: { comments: false } })).code}\n`
      : `/* ${lib.pacote}@${versao} (build oficial minificado do pacote) */\n${codigo}`;
    recursos.set(path.join(PASTA_VENDOR, lib.nome), conteudo);
  }

  return recursos;
}

const mesmoConteudo = (a, b) => (Buffer.isBuffer(a) ? a.equals(b) : a === b);

/**
 * Confere, sem escrever nada, se os recursos versionados correspondem às dependências instaladas.
 * @returns {{ faltando: string[], divergentes: string[], extras: string[] }}
 */
async function conferirRecursos(recursos) {
  const esperados = recursos || (await gerarRecursos());
  const faltando = [];
  const divergentes = [];
  esperados.forEach((conteudo, arquivo) => {
    if (!fs.existsSync(arquivo)) {
      faltando.push(path.relative(RAIZ, arquivo));
      return;
    }
    const atual = fs.readFileSync(arquivo);
    const esperado = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf-8');
    if (!atual.equals(esperado)) divergentes.push(path.relative(RAIZ, arquivo));
  });
  const esperadosNoVendor = new Set([...esperados.keys()].filter((f) => f.startsWith(PASTA_VENDOR)));
  const extras = fs.existsSync(PASTA_VENDOR)
    ? fs.readdirSync(PASTA_VENDOR).map((n) => path.join(PASTA_VENDOR, n)).filter((f) => !esperadosNoVendor.has(f))
    : [];
  return { faltando, divergentes, extras: extras.map((f) => path.relative(RAIZ, f)) };
}

/** Escreve os recursos e devolve o resumo por grupo. `destinoRaiz` permite gravar em dist/. */
async function gerarRecursosNoDisco(destinoRaiz) {
  const raizDestino = destinoRaiz || RAIZ;
  const recursos = await gerarRecursos();
  [PASTA_CSS, PASTA_FONTES, PASTA_VENDOR].forEach((p) => fs.mkdirSync(p, { recursive: true }));
  const resumo = { css: [], fontes: [], vendor: [] };
  recursos.forEach((conteudo, arquivo) => {
    const destino = raizDestino === RAIZ ? arquivo : path.join(raizDestino, path.relative(RAIZ, arquivo));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    if (Buffer.isBuffer(conteudo)) fs.writeFileSync(destino, conteudo);
    else fs.writeFileSync(destino, conteudo, 'utf-8');
    const tamanho = Buffer.byteLength(conteudo);
    const relativo = path.relative(RAIZ, arquivo);
    const linha = `${relativo.padEnd(46)} ${kb(tamanho).padStart(10)}`;
    if (destino.startsWith(PASTA_CSS)) resumo.css.push(linha);
    else if (destino.startsWith(PASTA_FONTES)) resumo.fontes.push(linha);
    else resumo.vendor.push(linha);
  });
  // Arquivos vendor/ que não são mais gerados (troca de versão ou de biblioteca).
  if (raizDestino === RAIZ) {
    const conferencia = await conferirRecursos(recursos);
    conferencia.extras.forEach((relativo) => {
      fs.rmSync(path.join(RAIZ, relativo), { force: true });
      resumo.vendor.push(`${relativo.padEnd(46)} ${'removido'.padStart(10)}`);
    });
  }
  return resumo;
}

async function principal(argv) {
  const conferir = argv.includes('--check');
  if (conferir) {
    const conferencia = await conferirRecursos();
    const problemas = [...conferencia.faltando, ...conferencia.divergentes, ...conferencia.extras];
    if (problemas.length === 0) {
      process.stdout.write('✅ Recursos locais (css/, fonts/, vendor/) atualizados.\n');
      return 0;
    }
    process.stdout.write(
      `❌ Recursos desatualizados em relação às dependências instaladas:\n - ${problemas.join('\n - ')}\n` +
      'Rode: npm run assets\n'
    );
    return 1;
  }
  const resumo = await gerarRecursosNoDisco();
  process.stdout.write(
    `Recursos locais gerados:\n\nCSS\n${resumo.css.join('\n')}\n\n` +
    `FONTES (${resumo.fontes.length})\n${resumo.fontes.join('\n')}\n\n` +
    `VENDOR (${resumo.vendor.length})\n${resumo.vendor.join('\n')}\n`
  );
  return 0;
}

module.exports = {
  gerarRecursos,
  gerarRecursosNoDisco,
  conferirRecursos,
  cssDeFontes,
  compilarTailwind,
  MAPA_ICONES_FA,
  RAIZ,
  CSS_TAILWIND,
  CSS_FONTES
};

if (require.main === module) {
  principal(process.argv.slice(2))
    .then((codigo) => process.exit(codigo))
    .catch((erro) => {
      process.stderr.write(`❌ Falha ao gerar os recursos locais: ${erro.message}\n`);
      process.exit(1);
    });
}
