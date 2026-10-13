/**
 * Scanner heurístico de sinks XSS para o front-end NexusPort.
 * Uso: node tools/xss-scan.js [arquivos...]
 *
 * Percorre template literals que contenham marcação HTML e reporta toda
 * interpolação `${...}` que não esteja envolvida por um codificador seguro
 * (nexusEsc / esc / nexusJsArg / jsArg / nexusSafeUrl / toLocaleString / etc.).
 *
 * As expressões são analisadas com o AST do `acorn` (o mesmo parser usado por
 * webpack/rollup/acorn-jsx). Antes deste módulo fazia lexing próprio por
 * índices e expressões regulares: um lexer caseiro não reconhece literais de
 * expressão regular, comentários, aspas dentro de strings nem operadores como
 * `??` e `?.`, e portanto tanto deixava escapar interpolações como acusava
 * falsos positivos. O parser real elimina essa classe inteira de erros.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

/** Opções do parser: sintaxe moderna, scripts clássicos (os módulos são IIFEs). */
const OPCOES_PARSER = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowHashBang: true,
  locations: true
};

/**
 * Analisa o arquivo inteiro. Devolve o AST ou null se o arquivo não for
 * JavaScript válido (o build falharia antes disso, então só é avisado).
 */
function parseProgram(src) {
  try {
    return acorn.parse(src, OPCOES_PARSER);
  } catch (_erro) {
    try {
      return acorn.parse(src, { ...OPCOES_PARSER, sourceType: 'module' });
    } catch (_erro2) {
      return null;
    }
  }
}

/**
 * Analisa um trecho como UMA expressão completa. `parseExpressionAt` aceita
 * sobra de texto, por isso exigimos que o nó consuma a expressão inteira.
 */
function parseExpression(expr) {
  try {
    const node = acorn.parseExpressionAt(expr, 0, OPCOES_PARSER);
    return node.end === expr.length ? node : null;
  } catch (_erro) {
    return null;
  }
}

/** Percorre o AST em profundidade, chamando `visitar` para cada nó. */
function percorrer(no, visitar) {
  if (!no || typeof no.type !== 'string') return;
  visitar(no);
  for (const chave of Object.keys(no)) {
    if (chave === 'type' || chave === 'start' || chave === 'end' || chave === 'loc') continue;
    const valor = no[chave];
    if (Array.isArray(valor)) {
      valor.forEach((item) => {
        if (item && typeof item.type === 'string') percorrer(item, visitar);
      });
    } else if (valor && typeof valor.type === 'string') {
      percorrer(valor, visitar);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Heurísticas de segurança
 * ------------------------------------------------------------------ */

// Funções cujo retorno é considerado codificado/seguro (devem ser chamadas
// completas: `esc(x)` e nunca `esc(x) + y`).
const SAFE_FUNCTIONS = new Set([
  'esc', 'nexusEsc', 'escapeHtml', 'escAttr', 'nexusEscAttr',
  'jsArg', 'nexusJsArg', 'jsString', 'nexusJsString',
  'safeUrl', 'nexusSafeUrl', 'safeId', 'setText', 'sanitizeText',
  'Number', 'parseInt', 'parseFloat', 'String'
]);

// Métodos de formatação aceitos APENAS sobre `new Date(...)`
// (um `x.toLocaleString()` genérico não é considerado seguro).
const DATE_METHODS = new Set([
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString'
]);

// Exceções: identificadores numéricos/contadores usados nus na interpolação.
const BARE_SAFE_IDENTIFIERS = new Set(['key', 'idx']);
const HTML_VAR_RE = /Html$/;

/** Nome completo de uma chamada: `esc` ou `NexusSecurity.escapeHtml`. */
function nomeDoCallee(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

/** `new Date(...)`, com ou sem argumentos. */
function ehNewDate(no) {
  return no.type === 'NewExpression' && no.callee.type === 'Identifier' && no.callee.name === 'Date';
}

/**
 * Chamada completa e isolada de uma função codificadora, ou
 * `new Date(x).toLocaleString(...)` / `new Date(x)`.
 */
function isSafeCallChain(node) {
  if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return false;

  if (node.type === 'NewExpression') {
    // `new Date(...)` sozinho é seguro; qualquer outro construtor, não.
    return ehNewDate(node);
  }

  // new Date(x).toLocaleString('pt-BR')
  if (node.callee.type === 'MemberExpression' && !node.callee.computed && ehNewDate(node.callee.object)) {
    return DATE_METHODS.has(node.callee.property.name);
  }

  return SAFE_FUNCTIONS.has(nomeDoCallee(node.callee) || '');
}

/** `x + 1` / `1 + x`: soma com o literal 1 (índices e paginação). */
function ehSomaDeIndice(node) {
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return false;
  const { left, right } = node;
  const literalUm = (no) => no.type === 'Literal' && no.value === 1;
  return (literalUm(left) && right.type === 'Identifier') || (literalUm(right) && left.type === 'Identifier');
}

/** Literal de string estático: 'a', "b" ou template sem interpolação dinâmica. */
function isStaticStringLiteral(node) {
  if (!node) return false;
  if (node.type === 'Literal') return typeof node.value === 'string' || typeof node.value === 'number';
  if (node.type === 'TemplateLiteral') {
    return node.expressions.every(isSafeExpressionNode);
  }
  return false;
}

/**
 * Ternário só é aceito quando CADA ramo completo é um literal de string
 * estático ou uma expressão integralmente segura (verificação recursiva).
 */
function isStaticTernary(node) {
  if (node.type !== 'ConditionalExpression') return false;
  return isSafeExpressionNode(node.consequent) && isSafeExpressionNode(node.alternate);
}

/**
 * Heurística de segurança de um nó de expressão:
 *  - literal de string estático (ou template cujas interpolações são seguras);
 *  - chamada completa de uma função codificadora (esc/jsArg/...);
 *  - variável "…Html" construída e codificada previamente (verificada no
 *    próprio local de montagem, que também é escaneado);
 *  - exceções numéricas na forma completa (`.length`, `x + 1`, `key`, `idx`);
 *  - ternário com ambos os ramos estáticos/seguros.
 * Casos como `esc(a) + raw`, `raw + esc(a)` ou `cond ? raw : 'x'` são
 * deliberadamente REPROVADOS.
 */
function isSafeExpressionNode(node) {
  if (!node) return false;

  switch (node.type) {
    case 'Literal':
    case 'TemplateLiteral':
      return isStaticStringLiteral(node);
    case 'CallExpression':
    case 'NewExpression':
      return isSafeCallChain(node);
    case 'MemberExpression':
      return !node.computed && node.property.type === 'Identifier' && node.property.name === 'length';
    case 'Identifier':
      return BARE_SAFE_IDENTIFIERS.has(node.name) || HTML_VAR_RE.test(node.name);
    case 'BinaryExpression':
      return ehSomaDeIndice(node);
    case 'ConditionalExpression':
      return isStaticTernary(node);
    case 'ChainExpression':
      return isSafeExpressionNode(node.expression);
    case 'ParenthesizedExpression':
      return isSafeExpressionNode(node.expression);
    case 'SequenceExpression':
      return node.expressions.every(isSafeExpressionNode);
    default:
      return false;
  }
}

/**
 * Heurística de segurança de uma expressão interpolada (em texto).
 * Expressões que não são JavaScript válido nunca são consideradas seguras.
 */
function isSafeExpression(expr) {
  if (typeof expr !== 'string') return false;
  const e = expr.trim();
  if (!e) return false;
  const node = parseExpression(e);
  return node ? isSafeExpressionNode(node) : false;
}

/**
 * Todos os template literals do arquivo, na ordem em que aparecem.
 * Cada item traz o texto cru (com as crases) e as expressões interpoladas.
 */
function findTemplateLiterals(src) {
  const ast = parseProgram(src);
  if (!ast) return [];
  const out = [];
  percorrer(ast, (no) => {
    if (no.type !== 'TemplateLiteral') return;
    out.push({
      start: no.start,
      end: no.end,
      raw: src.slice(no.start, no.end),
      exprs: no.expressions.map((e) => ({ start: e.start, end: e.end, text: src.slice(e.start, e.end) }))
    });
  });
  return out;
}

const looksLikeHtml = (raw) => /<[a-zA-Z/!]/.test(raw);

/**
 * Varre um arquivo e devolve as interpolações não codificadas.
 * Um arquivo que não parseia entra como achado: sem AST não há como garantir
 * que as interpolações estão codificadas.
 */
function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (parseProgram(src) === null) {
    return [{ line: 1, expr: `arquivo não parseável pelo acorn (${path.basename(file)})` }];
  }
  const findings = [];
  for (const tpl of findTemplateLiterals(src)) {
    if (!looksLikeHtml(tpl.raw)) continue;
    for (const e of tpl.exprs) {
      const expr = e.text.trim();
      if (isSafeExpression(expr)) continue;
      const line = src.slice(0, e.start).split('\n').length;
      findings.push({ line, expr });
    }
  }
  return findings;
}

/**
 * Lista todos os .js de um diretório, em profundidade (js/pages/, js/webmcp/ ...).
 * Antes da reorganização do backlog 3 o scanner lia só o nível raiz de js/;
 * sem recursão, os módulos movidos sairiam da verificação em silêncio.
 */
function listarArquivosJs(dir) {
  const achados = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) achados.push(...listarArquivosJs(caminho));
    else if (entrada.name.endsWith('.js')) achados.push(caminho);
  }
  return achados.sort();
}

function run(argv) {
  const root = path.resolve(__dirname, '..');
  let targets = argv.slice(2);
  if (targets.length === 0) {
    targets = listarArquivosJs(path.join(root, 'js'))
      .filter(f => path.basename(f) !== 'security.js');
  }

  let total = 0;
  for (const t of targets) {
    const file = path.isAbsolute(t) ? t : path.join(root, t);
    if (!fs.existsSync(file)) continue;
    const findings = scan(file);
    if (findings.length === 0) continue;
    total += findings.length;
    console.log(`\n${path.relative(root, file)}`);
    for (const f of findings) {
      console.log(`  L${f.line}: \${${f.expr.length > 110 ? f.expr.slice(0, 110) + '…' : f.expr}}`);
    }
  }
  console.log(`\nTotal de interpolações não codificadas: ${total}`);
  return total;
}

// Exportado para testes unitários das heurísticas (tests/xss.test.js)
module.exports = {
  listarArquivosJs,
  isSafeExpression,
  isStaticTernary: (expr) => {
    const node = typeof expr === 'string' ? parseExpression(expr.trim()) : expr;
    return node ? isStaticTernary(node) : false;
  },
  isStaticStringLiteral: (expr) => {
    const node = typeof expr === 'string' ? parseExpression(expr.trim()) : expr;
    return node ? isStaticStringLiteral(node) : false;
  },
  isSafeCallChain: (expr) => {
    const node = typeof expr === 'string' ? parseExpression(expr.trim()) : expr;
    return node ? isSafeCallChain(node) : false;
  },
  findTemplateLiterals,
  scan
};

if (require.main === module) {
  process.exit(run(process.argv) === 0 ? 0 : 1);
}
