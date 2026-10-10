/**
 * RECURSOS VENDORIZADOS PARA AS CAPTURAS — NexusPort.
 *
 * As páginas carregam Tailwind, fontes, bibliotecas e o widget VLibras por CDN.
 * O ambiente de captura (sandbox/CI sem internet aberta) não alcança esses hosts,
 * então este módulo monta substitutos locais, instalados por npm:
 *
 *   cdn.tailwindcss.com        → CSS do Tailwind 3 compilado a partir das páginas (aqui)
 *   fonts.googleapis.com       → @fontsource/inter, @fontsource/montserrat,
 *                                @fontsource/jetbrains-mono e material-symbols
 *   cdn.jsdelivr.net (supabase) → @supabase/supabase-js (dist UMD)
 *   cdn.jsdelivr.net (chart.js) → chart.js (dist UMD)
 *   cdn.jsdelivr.net (qrcode)   → qrcode
 *   cdnjs.cloudflare.com (jspdf)→ jspdf (dist UMD)
 *   unpkg.com (html5-qrcode)    → html5-qrcode
 *   vlibras.gov.br              → stub vazio (widget indisponível offline)
 *   googletagmanager.com        → stub vazio (GA4 não é medido nas capturas)
 *
 * O CSS do Tailwind é compilado com a mesma configuração declarada em linha nas
 * páginas (darkMode 'class', cores nexus-*, fontes Inter/Montserrat/JetBrains Mono).
 * Como todas as classes do app são literais em HTML/JS (nenhuma classe montada por
 * template string), um build estático cobre as telas.
 *
 * Instalação das dependências:  npm install --prefix tools/screenshots
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..', '..');

/** Diretório com node_modules das dependências de captura. */
const DIR_VENDOR = process.env.NEXUS_SCREENSHOT_VENDOR || path.join(__dirname, 'node_modules');

/** Configuração do Tailwind — cópia da declarada em linha em todas as páginas. */
const TEMA_TAILWIND = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'nexus-900': '#1E293B',
        'nexus-500': '#445987',
        'nexus-bg': '#F5F7FA',
        'nexus-text': '#222222',
        'nexus-border': '#E1E5ED',
        'nexus-dark-bg': '#0F172A',
        'nexus-dark-card': '#1E293B',
        'nexus-dark-border': '#334155',
        success: '#2E7D32',
        warning: '#D97706',
        danger: '#C62828'
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Montserrat', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  }
};

function exigirVendor() {
  if (!fs.existsSync(path.join(DIR_VENDOR, 'tailwindcss'))) {
    throw new Error(
      `Dependências de captura ausentes em ${DIR_VENDOR}.\n` +
      'Instale com:  npm install --prefix tools/screenshots'
    );
  }
}

/**
 * Compila o Tailwind CSS das páginas do projeto (cacheado em tmp).
 * @returns {string} caminho do CSS gerado
 */
function compilarTailwind() {
  exigirVendor();
  const cache = path.join(os.tmpdir(), 'nexus-screenshots');
  fs.mkdirSync(cache, { recursive: true });
  const arquivoConfig = path.join(cache, 'tailwind.config.js');
  const entrada = path.join(cache, 'tailwind.entrada.css');
  const saida = path.join(cache, 'tailwind.css');

  fs.writeFileSync(arquivoConfig, `module.exports = ${JSON.stringify(TEMA_TAILWIND, null, 2)};\n`);
  fs.writeFileSync(entrada, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

  const binario = path.join(DIR_VENDOR, '.bin', 'tailwindcss');
  execFileSync(binario, [
    '--config', arquivoConfig,
    '--input', entrada,
    '--output', saida,
    '--content', `${RAIZ}/*.html,${RAIZ}/js/**/*.js`,
    '--minify'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  return saida;
}

/** Procura um arquivo dentro de um pacote instalado. */
function arquivoDe(pacote, ...caminhos) {
  const base = path.join(DIR_VENDOR, pacote);
  for (const relativo of caminhos) {
    const candidato = path.join(base, relativo);
    if (fs.existsSync(candidato)) return candidato;
  }
  throw new Error(`Arquivo não encontrado em ${pacote}: ${caminhos.join(' | ')}`);
}

/** CSS de fontes: Inter, Montserrat, JetBrains Mono e Material Symbols. */
function cssDeFontes(basePublica) {
  const faces = [
    ['Inter', 400, arquivoDe('@fontsource/inter', 'files/inter-latin-400-normal.woff2')],
    ['Inter', 500, arquivoDe('@fontsource/inter', 'files/inter-latin-500-normal.woff2')],
    ['Inter', 600, arquivoDe('@fontsource/inter', 'files/inter-latin-600-normal.woff2')],
    ['Inter', 700, arquivoDe('@fontsource/inter', 'files/inter-latin-700-normal.woff2')],
    ['Montserrat', 600, arquivoDe('@fontsource/montserrat', 'files/montserrat-latin-600-normal.woff2')],
    ['Montserrat', 700, arquivoDe('@fontsource/montserrat', 'files/montserrat-latin-700-normal.woff2')],
    ['JetBrains Mono', 500, arquivoDe('@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-500-normal.woff2')],
    ['JetBrains Mono', 600, arquivoDe('@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-600-normal.woff2')]
  ];

  const regras = faces.map(([familia, peso, arquivo]) => {
    const destino = `${basePublica}/__vendor/${path.basename(arquivo)}`;
    return `@font-face{font-family:"${familia}";font-style:normal;font-weight:${peso};font-display:swap;src:url("${destino}") format("woff2");}`;
  });

  // Ícones: Material Symbols Outlined (fonte variável com eixo FILL, usada pelas telas).
  const icones = arquivoDe('material-symbols', 'material-symbols-outlined.woff2');
  regras.push(
    `@font-face{font-family:"Material Symbols Outlined";font-style:normal;font-weight:100 700;font-display:block;src:url("${basePublica}/__vendor/${path.basename(icones)}") format("woff2");}`
  );
  regras.push(
    '.material-symbols-outlined{font-family:"Material Symbols Outlined";font-weight:normal;font-style:normal;'
    + 'font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;'
    + 'word-wrap:normal;direction:ltr;-webkit-font-smoothing:antialiased;font-feature-settings:"liga";}'
  );

  return { css: regras.join('\n'), arquivos: faces.map(([, , arquivo]) => arquivo).concat(icones) };
}

/** Arquivos extras servidos em /__vendor/<nome>. */
function arquivosEstaticos() {
  return [
    arquivoDe('material-symbols', 'material-symbols-outlined.woff2'),
    arquivoDe('@fontsource/inter', 'files/inter-latin-400-normal.woff2'),
    arquivoDe('@fontsource/inter', 'files/inter-latin-500-normal.woff2'),
    arquivoDe('@fontsource/inter', 'files/inter-latin-600-normal.woff2'),
    arquivoDe('@fontsource/inter', 'files/inter-latin-700-normal.woff2'),
    arquivoDe('@fontsource/montserrat', 'files/montserrat-latin-600-normal.woff2'),
    arquivoDe('@fontsource/montserrat', 'files/montserrat-latin-700-normal.woff2'),
    arquivoDe('@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-500-normal.woff2'),
    arquivoDe('@fontsource/jetbrains-mono', 'files/jetbrains-mono-latin-600-normal.woff2')
  ];
}

/** Script que substitui o widget VLibras (indisponível offline). */
const STUB_VLIBRAS = `/* Stub das capturas: o widget VLibras (vlibras.gov.br) não é carregado offline. */
window.VLibras = window.VLibras || { Widget: function Widget() { this.init = function () {}; } };
`;

/**
 * Monta a lista de substituições de CDN.
 * @param {{basePublica: string}} opcoes
 * @returns {Array<{host: string, caminho: RegExp, tipo: string, corpo: Function|string}>}
 */
function substituicoes({ basePublica }) {
  exigirVendor();
  const cssTailwind = fs.readFileSync(compilarTailwind(), 'utf-8');
  const fontes = cssDeFontes(basePublica);

  const ler = (...caminhos) => fs.readFileSync(arquivoDe(...caminhos), 'utf-8');

  // A ordem importa: cdn.jsdelivr.net serve mais de uma biblioteca, então as entradas
  // com `casarCaminho` (mais específicas) vêm antes da entrada genérica do host.
  return [
    {
      host: 'cdn.tailwindcss.com',
      corpo: `/* Tailwind 3 compilado localmente para as capturas (equivalente ao CDN). */
window.tailwind = window.tailwind || { config: {} };
(function () {
  var estilo = document.createElement('style');
  estilo.setAttribute('data-nexus-screenshots', 'tailwind');
  estilo.textContent = ${JSON.stringify(cssTailwind)};
  document.head.appendChild(estilo);
})();
`
    },
    {
      host: 'fonts.googleapis.com',
      tipo: 'text/css; charset=utf-8',
      corpo: fontes.css
    },
    {
      host: 'fonts.gstatic.com',
      tipo: 'font/woff2',
      arquivo: fontes.arquivos[0]
    },
    {
      host: 'cdn.jsdelivr.net',
      casarCaminho: /supabase-js|supabase\.co/,
      corpo: ler('@supabase/supabase-js', 'dist/umd/supabase.js')
    },
    {
      host: 'cdn.jsdelivr.net',
      casarCaminho: /chart\.js/,
      corpo: ler('chart.js', 'dist/chart.umd.js')
    },
    {
      host: 'cdn.jsdelivr.net',
      casarCaminho: /qrcode(?!.*html5)/,
      corpo: ler('qrcode', 'build/qrcode.js')
    },
    {
      host: 'cdnjs.cloudflare.com',
      corpo: ler('jspdf', 'dist/jspdf.umd.min.js')
    },
    {
      host: 'unpkg.com',
      corpo: ler('html5-qrcode', 'html5-qrcode.min.js')
    },
    {
      host: 'vlibras.gov.br',
      corpo: STUB_VLIBRAS
    },
    {
      host: 'googletagmanager.com',
      corpo: '/* GA4 não é medido nas capturas de tela. */'
    }
  ];
}

module.exports = {
  DIR_VENDOR,
  substituicoes,
  arquivosEstaticos,
  compilarTailwind,
  cssDeFontes,
  TEMA_TAILWIND
};
