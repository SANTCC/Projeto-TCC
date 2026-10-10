/**
 * Temas de realce de sintaxe (Prism) alinhados à paleta NexusPort do Design System.
 * Fonte dos tokens: SPECs/design/design.md, seção 3.
 *
 *   nexus-900  #1E293B   azul-marinho escuro (sidebar, fundos escuros)
 *   nexus-500  #445987   azul primário (ações, links)
 *   border     #E1E5ED   cinza-azulado (bordas)
 *   bg         #F5F7FA   cinza claro (fundos)
 *   text       #222222   quase-preto (texto principal)
 *   success    #2E7D32 · warning #D97706 · danger #C62828
 */
'use strict';

const { themes } = require('prism-react-renderer');

const CLARO = {
  plain: {
    color: '#222222',
    backgroundColor: '#F5F7FA'
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#5B6B7C', fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: '#445987' } },
    { types: ['namespace'], style: { opacity: 0.8 } },
    { types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: '#C62828' } },
    { types: ['boolean', 'number'], style: { color: '#B45309' } },
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: '#2E7D32' } },
    { types: ['operator', 'entity', 'url', 'variable'], style: { color: '#445987' } },
    { types: ['atrule', 'attr-value', 'function', 'class-name'], style: { color: '#1E293B', fontWeight: '600' } },
    { types: ['keyword'], style: { color: '#30405F', fontWeight: '600' } },
    { types: ['regex', 'important'], style: { color: '#D97706' } }
  ]
};

const ESCURO = {
  plain: {
    color: '#F5F7FA',
    backgroundColor: '#0F172A'
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#94A3B8', fontStyle: 'italic' } },
    { types: ['punctuation'], style: { color: '#A9B6D0' } },
    { types: ['namespace'], style: { opacity: 0.8 } },
    { types: ['property', 'tag', 'constant', 'symbol', 'deleted'], style: { color: '#F0A0A0' } },
    { types: ['boolean', 'number'], style: { color: '#F5C77E' } },
    { types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'], style: { color: '#8FD694' } },
    { types: ['operator', 'entity', 'url', 'variable'], style: { color: '#9DB2E0' } },
    { types: ['atrule', 'attr-value', 'function', 'class-name'], style: { color: '#C7D4EE', fontWeight: '600' } },
    { types: ['keyword'], style: { color: '#5B70A3', fontWeight: '600' } },
    { types: ['regex', 'important'], style: { color: '#F0C27B' } }
  ]
};

/** Tema escuro oficial do Design System para realce de código (fallback: paleta própria). */
function criarTemasPrism() {
  return {
    light: CLARO,
    dark: ESCURO,
    fallback: themes.vsDark
  };
}

module.exports = { criarTemasPrism, CLARO, ESCURO };
