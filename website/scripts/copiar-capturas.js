#!/usr/bin/env node
/**
 * Copia as capturas de tela do about.html para o site da documentação.
 * ----------------------------------------------------------------------------
 * Fonte única das capturas: `about/screenshots/` na raiz do repositório (geradas por
 * `npm run screenshots` e publicadas pelo `about.html`). O Docusaurus só serve arquivos
 * estáticos que estejam em `website/static/`, então este script espelha os PNGs e o
 * `manifest.json` em `website/static/img/capturas/` antes de cada `start`/`build`.
 *
 * A pasta de destino é ignorada pelo git (ver website/.gitignore): as imagens que
 * aparecem no site publicado são as cópias dentro da saída `docs/`.
 *
 * Uso: node scripts/copiar-capturas.js   (roda automaticamente em prestart/prebuild)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const ORIGEM = path.join(RAIZ, 'about', 'screenshots');
const DESTINO = path.resolve(__dirname, '..', 'static', 'img', 'capturas');

/** Logotipo oficial (design/logo_porto.png) e favicon do app, se ainda não copiados. */
const ESTATICOS_EXTRAS = [
  { origem: path.join(RAIZ, 'design', 'logo_porto.png'), destino: path.join(RAIZ, 'website', 'static', 'img', 'logo_porto.png') },
  { origem: path.join(RAIZ, 'favicon.ico'), destino: path.join(RAIZ, 'website', 'static', 'img', 'favicon.ico') }
];

function copiarExtras() {
  ESTATICOS_EXTRAS.forEach(({ origem, destino }) => {
    if (!fs.existsSync(origem)) return;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(origem, destino);
    console.log(`· ${path.relative(RAIZ, origem)} → ${path.relative(RAIZ, destino)}`);
  });
}

function copiarCapturas() {
  if (!fs.existsSync(ORIGEM)) {
    console.warn(`[capturas] ${path.relative(RAIZ, ORIGEM)} não existe — nada a copiar.`);
    return 0;
  }
  fs.mkdirSync(DESTINO, { recursive: true });
  let total = 0;
  fs.readdirSync(ORIGEM, { withFileTypes: true }).forEach((entrada) => {
    if (!entrada.isFile()) return;
    if (!/\.(png|json)$/i.test(entrada.name)) return;
    fs.copyFileSync(path.join(ORIGEM, entrada.name), path.join(DESTINO, entrada.name));
    total += 1;
  });
  return total;
}

function main() {
  copiarExtras();
  const total = copiarCapturas();
  console.log(`[capturas] ${total} arquivo(s) em static/img/capturas (origem: about/screenshots/).`);
}

main();
