/**
 * CONFIGURAÇÃO DO TAILWIND (v3) — compilação estática em tempo de build.
 *
 * Antes, cada página carregava o compilador do Tailwind pelo CDN (`cdn.tailwindcss.com`, ~400 KiB de
 * JavaScript) e declarava esta mesma configuração em linha. Agora o CSS é compilado aqui, uma única
 * vez, por `tools/assets.js` (`npm run assets`), e as páginas carregam apenas `css/nexus.css`.
 *
 * Os tokens (cores nexus-*, tipografia) são os mesmos declarados antes em linha em todas as páginas.
 * As classes são literais em HTML e JavaScript (nenhuma é montada por concatenação), então a varredura
 * de `content` cobre todas as telas.
 */
const path = require('path');

// Caminhos absolutos: o CSS tem de sair igual rodando o build da raiz, de dist/ ou de qualquer
// diretório de trabalho (o gate Lighthouse gera o build a partir da pasta do próprio script).
module.exports = {
  content: [
    path.join(__dirname, '*.html'),
    path.join(__dirname, 'js', '**', '*.js')
  ],
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
