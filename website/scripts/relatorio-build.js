#!/usr/bin/env node
/**
 * Relatório pós-build da documentação.
 * ----------------------------------------------------------------------------
 * Roda automaticamente em `postbuild` (depois de `docusaurus build --out-dir ../docs`)
 * e imprime um resumo do que foi gerado: número de páginas HTML, documentos markdown
 * de origem, imagens copiadas e tamanho total da pasta `docs/`.
 *
 * Não altera nada — é só verificação/visibilidade para quem roda `npm run docs:build`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const SAIDA = path.join(RAIZ, 'docs');
const FONTE_DOCS = path.resolve(__dirname, '..', 'docs');

function contar(dir, filtro) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const cheio = path.join(dir, e.name);
    if (e.isDirectory()) total += contar(cheio, filtro);
    else if (!filtro || filtro(e.name)) total += 1;
  });
  return total;
}

function tamanho(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((soma, e) => {
    const cheio = path.join(dir, e.name);
    if (e.isDirectory()) return soma + tamanho(cheio);
    return soma + fs.statSync(cheio).size;
  }, 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function main() {
  if (!fs.existsSync(SAIDA)) {
    console.error('[docs] a pasta docs/ não existe — o build falhou?');
    process.exitCode = 1;
    return;
  }
  const paginas = contar(SAIDA, (n) => n.endsWith('.html'));
  const assets = contar(path.join(SAIDA, 'assets'));
  const imagens = contar(path.join(SAIDA, 'img'), (n) => /\.(png|jpg|svg|webp|ico)$/i.test(n));
  const fontes = contar(FONTE_DOCS, (n) => n.endsWith('.md') || n.endsWith('.mdx'));
  const total = tamanho(SAIDA);

  console.log('\n[documentação] build concluído');
  console.log(`  documentos de origem : ${fontes}`);
  console.log(`  páginas HTML geradas : ${paginas}`);
  console.log(`  assets (js/css/font): ${assets}`);
  console.log(`  imagens publicadas   : ${imagens}`);
  console.log(`  tamanho de docs/     : ${mb(total)}`);
  console.log('  URL local            : http://localhost:3000/docs/  (npm start)\n');
}

main();
