#!/usr/bin/env node
/**
 * BUILD DE PRODUÇÃO — minificação de JS e CSS antes do deploy (Backlog 3, item G).
 *
 * Gera `dist/` a partir da raiz do projeto:
 *   - JS (js/**\/*.js e <script> inline das páginas): Terser, sem alterar nomes globais.
 *   - CSS (*.css e <style> inline das páginas): clean-css, nível 1 (sem reescrever regras).
 *   - HTML, imagens e demais estáticos: copiados. Os caminhos não mudam (js/xxx.js continua válido).
 *   - Fora da saída: testes, ferramentas, SPECs, supabase, THEME (protótipos), documentação, o
 *     site Docusaurus (`website/`, cuja saída é `docs/`) e manifestos.
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

const RAIZ = path.join(__dirname, '..');
const SAIDA_PADRAO = path.join(RAIZ, 'dist');

// Diretórios que nunca vão para produção (em qualquer nível).
// `docs` é a saída do site Docusaurus (website/) e `website` é a fonte desse site: nenhum dos
// dois faz parte do app publicado em dist/.
const DIRETORIOS_EXCLUIDOS = new Set([
  'node_modules', '.git', '.github', '.vercel', 'dist', 'tests', 'tools', 'SPECs', 'supabase', 'THEME',
  'lighthouse', 'lighthouse-report', 'docs', 'website'
]);
// Arquivos da raiz que não são servidos. Documentação (.md) e Python (.py) são excluídos em qualquer pasta.
const ARQUIVOS_EXCLUIDOS = new Set([
  'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.vercelignore'
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
    resultado.push(rel);
  });
  return resultado.sort();
}

const bytes = (texto) => Buffer.byteLength(texto, 'utf-8');

/** Minifica o conteúdo de cada <script> inline (sem src e de tipo JavaScript). */
async function minificarScriptsInline(html, registro, nome) {
  const padrao = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let saida = '';
  let ultimo = 0;
  let m;
  while ((m = padrao.exec(html)) !== null) {
    const atributos = m[1] || '';
    const tipo = (atributos.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    const ehJs = !tipo || tipo === 'text/javascript' || tipo === 'module';
    if (/\bsrc\s*=/i.test(atributos) || !ehJs || m[2].trim() === '') continue;
    let codigo;
    try {
      codigo = (await minificarJs(m[2], OPCOES_TERSER)).code;
    } catch (erro) {
      throw new Error(`${nome}: erro de sintaxe em <script> inline — ${erro.message}`);
    }
    registro.js.push({ arquivo: `${nome} (inline)`, antes: bytes(m[2]), depois: bytes(codigo) });
    saida += html.slice(ultimo, m.index) + `<script${atributos}>${codigo}</script>`;
    ultimo = m.index + m[0].length;
  }
  return saida + html.slice(ultimo);
}

/** Minifica o conteúdo de cada <style> inline. */
function minificarEstilosInline(html, registro, nome) {
  return html.replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi, (todo, atributos = '', css) => {
    const r = new CleanCSS({ level: 1 }).minify(css);
    if (r.errors.length) throw new Error(`${nome}: erro de CSS inline — ${r.errors.join('; ')}`);
    registro.css.push({ arquivo: `${nome} (inline)`, antes: bytes(css), depois: bytes(r.styles) });
    return `<style${atributos}>${r.styles}</style>`;
  });
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
      const comScriptsMinificados = await minificarScriptsInline(html, registro, rel);
      const comEstilosMinificados = minificarEstilosInline(comScriptsMinificados, registro, rel);
      registro.html.push({ arquivo: rel, antes: bytes(html), depois: bytes(comEstilosMinificados) });
      fs.writeFileSync(destino, comEstilosMinificados, 'utf-8');
    } else {
      fs.copyFileSync(origem, destino);
      registro.copiados.push(rel);
    }
  }
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

module.exports = { build, listarArquivos, SAIDA_PADRAO, RAIZ };

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
