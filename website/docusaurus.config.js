// @ts-check
/**
 * Configuração do site de documentação do NexusPort (Docusaurus 3).
 * ----------------------------------------------------------------------------
 * Este site é a documentação técnica completa do sistema. Ele vive separado do app
 * (que é HTML puro + Tailwind CDN, sem bundler) e é a única parte do repositório que
 * usa Node/React no build.
 *
 * Saída: `docusaurus build --out-dir ../docs` publica o site em `docs/` na raiz do
 * repositório, exatamente no caminho `/docs/` usado pelos links (é o que configura o
 * `baseUrl` padrão abaixo). O workflow `.github/workflows/docs.yml` publica a mesma
 * pasta no GitHub Pages.
 *
 * Variáveis de ambiente (todas opcionais, para reaproveitar o build em outros domínios):
 *   DOCS_URL        URL absoluta do site            (padrão: https://santcc.github.io)
 *   DOCS_BASE_URL   caminho do site dentro do host  (padrão: /docs/)
 *   DOCS_EDIT_URL   URL base do "edite esta página" (padrão: GitHub do repositório)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { criarTemasPrism } = require('./src/theme/prism-nexus');

const URL_SITE = process.env.DOCS_URL || 'https://santcc.github.io';
const BASE_URL = process.env.DOCS_BASE_URL || '/docs/';
const REPO_EDIT = 'https://github.com/SANTCC/Projeto-TCC/edit/main/';

/** Copia o logotipo oficial para static/img (fonte única: design/logo_porto.png). */
function garantirLogotipo() {
  const origem = path.resolve(__dirname, '..', 'design', 'logo_porto.png');
  const destino = path.resolve(__dirname, 'static', 'img', 'logo_porto.png');
  if (!fs.existsSync(origem) || fs.existsSync(destino)) return;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
}

garantirLogotipo();

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'NexusPort — Documentação Técnica',
  tagline: 'Sistema de Gestão Operacional Portuária · Terminal STS-01 · Porto de Santos',
  favicon: 'img/favicon.ico',

  url: URL_SITE,
  baseUrl: BASE_URL,
  organizationName: 'SANTCC',
  projectName: 'Projeto-TCC',
  trailingSlash: false,
  deploymentBranch: 'main',

  future: {
    v4: false,
    faster: false
  },

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'warn',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn'
    },
    mermaid: false
  },

  i18n: {
    defaultLocale: 'pt-BR',
    locales: ['pt-BR'],
    localeConfigs: {
      'pt-BR': {
        htmlLang: 'pt-BR',
        label: 'Português (Brasil)',
        direction: 'ltr'
      }
    }
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // routeBasePath '/' -> os documentos ficam em `https://host/docs/<slug>` porque o
          // site inteiro já vive sob o baseUrl `/docs/`. A home é uma página React própria
          // (src/pages/index.js) e o índice geral dos documentos é `docs/introducao.md`.
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          breadcrumbs: true,
          showLastUpdateTime: true,
          showLastUpdateAuthor: false,
          editUrl: process.env.DOCS_EDIT_URL || REPO_EDIT,
          exclude: ['**/_*.md', '**/_*.mdx']
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css')
        },
        pages: {
          exclude: ['**/_*.js', '**/_*.jsx', '**/_*.tsx']
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
          ignorePatterns: ['/tags/**'],
          filename: 'sitemap.xml'
        }
      })
    ]
  ],

  plugins: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      /** @type {import('@easyops-cn/docusaurus-search-local').PluginOptions} */
      ({
        hashed: true,
        language: ['pt', 'en'],
        indexDocs: true,
        indexBlog: false,
        indexPages: true,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true
      })
    ]
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/nexusport-social-card.png',
      metadata: [
        { name: 'keywords', content: 'NexusPort, porto, Santos, STS-01, TCC, Supabase, RLS, WebMCP, QR Code, documentação' },
        { name: 'author', content: 'NexusPort Team — SANTCC' },
        { name: 'theme-color', content: '#1E293B' }
      ],
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: false
      },
      announcementBar: {
        id: 'nexusport_announcement',
        content:
          'Documentação do TCC <strong>NexusPort</strong> — Terminal STS-01 · Porto de Santos. ' +
          'Fonte de verdade: <code>SPECs/Spec.md</code>.',
        backgroundColor: '#1E293B',
        textColor: '#F5F7FA',
        isCloseable: true
      },
      navbar: {
        title: 'NexusPort',
        logo: {
          alt: 'Logotipo NexusPort',
          src: 'img/logo_porto.png',
          width: 32,
          height: 32
        },
        hideOnScroll: false,
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'principal',
            position: 'left',
            label: 'Documentação'
          },
          {
            to: '/design/design-system',
            position: 'left',
            label: 'Design System'
          },
          {
            to: '/arquitetura/webmcp',
            position: 'left',
            label: 'WebMCP'
          },
          {
            to: '/referencia/specs',
            position: 'left',
            label: 'Specs & Backlogs'
          },
          {
            type: 'dropdown',
            label: 'Atalhos',
            position: 'right',
            items: [
              { label: 'Primeiros passos', to: '/primeiros-passos/instalacao' },
              { label: 'Cargos e permissões', to: '/dominio/cargos-e-permissoes' },
              { label: 'Fluxo da carga', to: '/dominio/fluxo-da-carga' },
              { label: 'Banco de dados', to: '/banco-de-dados/visao-geral' },
              { label: 'Edge Functions', to: '/arquitetura/edge-functions' },
              { label: 'Testes', to: '/operacao/testes' },
              { label: 'Build e deploy', to: '/operacao/build-e-deploy' },
              { label: 'Galeria de telas', to: '/galeria' }
            ]
          },
          {
            href: 'https://github.com/SANTCC/Projeto-TCC',
            position: 'right',
            className: 'navbar__link--github',
            'aria-label': 'Repositório no GitHub',
            label: 'GitHub'
          }
        ]
      },
      footer: {
        style: 'dark',
        logo: {
          alt: 'Logotipo NexusPort',
          src: 'img/logo_porto.png',
          width: 48,
          height: 48
        },
        links: [
          {
            title: 'Documentação',
            items: [
              { label: 'Introdução', to: '/introducao' },
              { label: 'Primeiros passos', to: '/primeiros-passos/instalacao' },
              { label: 'Arquitetura', to: '/arquitetura/visao-geral' },
              { label: 'Design System', to: '/design/design-system' }
            ]
          },
          {
            title: 'Domínio',
            items: [
              { label: 'Especificação (RF 1–18)', to: '/dominio/requisitos-funcionais' },
              { label: 'Regras de negócio (RN 1–19)', to: '/dominio/regras-de-negocio' },
              { label: 'Cargos e permissões', to: '/dominio/cargos-e-permissoes' },
              { label: 'Fluxo da carga', to: '/dominio/fluxo-da-carga' }
            ]
          },
          {
            title: 'Operação',
            items: [
              { label: 'Banco de dados', to: '/banco-de-dados/visao-geral' },
              { label: 'Edge Functions', to: '/arquitetura/edge-functions' },
              { label: 'Testes', to: '/operacao/testes' },
              { label: 'Build e deploy', to: '/operacao/build-e-deploy' }
            ]
          },
          {
            title: 'Repositório',
            items: [
              { label: 'GitHub', href: 'https://github.com/SANTCC/Projeto-TCC' },
              { label: 'Galeria de telas', to: '/galeria' },
              {
                label: 'Documentação ilustrada (about.html)',
                href:
                  process.env.NEXUS_ABOUT_URL ||
                  'https://github.com/SANTCC/Projeto-TCC/blob/main/about.html'
              },
              { label: 'SPECs/Spec.md', href: 'https://github.com/SANTCC/Projeto-TCC/blob/main/SPECs/Spec.md' }
            ]
          }
        ],
        copyright: `NexusPort — Terminal STS-01, Porto de Santos · Documentação gerada com Docusaurus · ${new Date().getFullYear()}`
      },
      docs: {
        sidebar: {
          hideable: true,
          autoCollapseCategories: false
        }
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4
      },
      prism: {
        theme: criarTemasPrism().light,
        darkTheme: criarTemasPrism().dark,
        additionalLanguages: ['bash', 'json', 'sql', 'diff', 'ini', 'python', 'powershell', 'yaml', 'toml'],
        defaultLanguage: 'javascript'
      }
    }),

  headTags: [
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.googleapis.com' }
    },
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' }
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Montserrat:wght@600;700;800&display=swap'
      }
    },
    {
      tagName: 'meta',
      attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }
    }
  ]
};

module.exports = config;
