/**
 * Scanner heurístico de sinks XSS para o front-end NexusPort.
 * Uso: node tools/xss-scan.js [arquivos...]
 *
 * Percorre template literals que contenham marcação HTML e reporta toda
 * interpolação `${...}` que não esteja envolvida por um codificador seguro
 * (nexusEsc / esc / nexusJsArg / jsArg / nexusSafeUrl / toLocaleString / etc.).
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * Parsing mínimo de expressões JavaScript
 * (necessário para só aceitar uma expressão como "segura" quando a
 *  forma COMPLETA corresponde ao permitido, e não apenas um prefixo)
 * ------------------------------------------------------------------ */

/** `i` aponta para ' ou " ou `; retorna o índice após o fechamento (-1 se inválido). */
function skipQuoted(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (quote === '`' && ch === '$' && src[j + 1] === '{') {
      const end = skipBalanced(src, j + 1, '{', '}');
      if (end === -1) return -1;
      j = end + 1;
      continue;
    }
    if (ch === quote) return j + 1;
    j++;
  }
  return -1;
}

/** `i` aponta para `open`; retorna o índice de `close` correspondente (-1 se inválido). */
function skipBalanced(src, i, open, close) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipQuoted(src, j);
      if (end === -1) return -1;
      j = end - 1;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Separa o primeiro ternário de nível zero da expressão.
 * Retorna { cond, then, elseB } ou null. Ignora `??`, `?.` e ternários aninhados.
 */
function splitTernary(expr) {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipQuoted(expr, i);
      if (end === -1) return null;
      i = end - 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth !== 0 || ch !== '?') continue;
    if (expr[i + 1] === '?' || expr[i + 1] === '.') { i++; continue; } // ?? / ?.
    q = i;
    break;
  }
  if (q === -1) return null;

  let nest = 0;
  for (let i = q + 1; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipQuoted(expr, i);
      if (end === -1) return null;
      i = end - 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') { nest++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { nest--; continue; }
    if (nest !== 0) continue;
    if (ch === '?') {
      if (expr[i + 1] === '?' || expr[i + 1] === '.') { i++; continue; }
      // ternário aninhado: pula até o seu `:` correspondente
      const inner = splitTernary(expr.slice(i));
      if (!inner) return null;
      i += inner.end;
      continue;
    }
    // `end` = índice do ':' correspondente (usado para pular ternários aninhados)
    if (ch === ':') return { cond: expr.slice(0, q), then: expr.slice(q + 1, i), elseB: expr.slice(i + 1), end: i };
  }
  return null;
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
  'NexusSecurity.escapeHtml', 'NexusSecurity.escapeAttr',
  'NexusSecurity.jsString', 'NexusSecurity.jsArg',
  'NexusSecurity.safeUrl', 'NexusSecurity.safeId', 'NexusSecurity.setText',
  'Number', 'parseInt', 'parseFloat', 'String'
]);

// Cadeia permitida apenas para datas: new Date(x).toLocaleString('pt-BR')
const DATE_METHODS = new Set([
  'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString'
]);

// Exceções numéricas/contadores, sempre na forma completa.
const BARE_SAFE_IDENTIFIERS = new Set(['key', 'idx']);
const MEMBER_LENGTH_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.length$/;
const PLUS_ONE_RE = /^[A-Za-z_$][\w$]*\s*\+\s*1$/;
const HTML_VAR_RE = /^[A-Za-z_$][\w$]*Html$/;

/** Literal de string estático: 'a', "b" ou template sem interpolação dinâmica. */
function isStaticStringLiteral(expr) {
  if (typeof expr !== 'string' || expr.length < 2) return false;
  const quote = expr[0];
  if (quote === "'" || quote === '"') return skipQuoted(expr, 0) === expr.length;
  if (quote !== '`') return false;

  let i = 1;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$' && expr[i + 1] === '{') {
      const end = skipBalanced(expr, i + 1, '{', '}');
      if (end === -1) return false;
      // Uma interpolação dentro do template é aceita apenas se também for segura.
      if (!isSafeExpression(expr.slice(i + 2, end))) return false;
      i = end + 1;
      continue;
    }
    if (ch === '`') return i === expr.length - 1;
    i++;
  }
  return false;
}

/** Chamada completa: `fn(...)`, `new Date(...)` ou `new Date(...).toLocaleString(...)`. */
function isSafeCallChain(expr) {
  let i = 0;
  let isDate = false;

  if (expr.startsWith('new ')) {
    if (!expr.startsWith('new Date')) return false;
    i = 'new Date'.length;
    isDate = true;
  } else {
    const m = /^(?:NexusSecurity\.)?[A-Za-z_$][\w$]*/.exec(expr);
    if (!m || !SAFE_FUNCTIONS.has(m[0])) return false;
    i = m[0].length;
  }

  if (expr[i] !== '(') return false;
  const close = skipBalanced(expr, i, '(', ')');
  if (close === -1) return false;
  i = close + 1;

  if (i === expr.length) return true;          // nada sobrando após a chamada
  if (!isDate || expr[i] !== '.') return false; // cadeias de método só para datas

  const m = /^\.([A-Za-z_$][\w$]*)/.exec(expr.slice(i));
  if (!m || !DATE_METHODS.has(m[1])) return false;
  i += m[0].length;
  if (expr[i] !== '(') return false;
  const close2 = skipBalanced(expr, i, '(', ')');
  return close2 === expr.length - 1;           // consome a expressão inteira
}

/**
 * Ternário só é aceito quando CADA ramo completo é um literal de string
 * estático ou uma expressão integralmente segura (verificação recursiva).
 */
function isStaticTernary(expr) {
  const parts = splitTernary(expr);
  if (!parts) return false;
  return isSafeExpression(parts.then) && isSafeExpression(parts.elseB);
}

/**
 * Heurística de segurança de uma expressão interpolada:
 *  - literal de string estático (ou template cujas interpolações são seguras);
 *  - chamada completa de uma função codificadora (esc/jsArg/...);
 *  - variável "…Html" construída e codificada previamente (verificada no
 *    próprio local de montagem, que também é escaneado);
 *  - exceções numéricas na forma completa (`.length`, `x + 1`, `key`, `idx`);
 *  - ternário com ambos os ramos estáticos/seguros.
 * Casos como `esc(a) + raw`, `raw + esc(a)` ou `cond ? raw : 'x'` são
 * deliberadamente REPROVADOS.
 */
function isSafeExpression(expr) {
  if (typeof expr !== 'string') return false;
  const e = expr.trim();
  if (!e) return false;
  if (isStaticStringLiteral(e)) return true;
  if (isSafeCallChain(e)) return true;
  if (HTML_VAR_RE.test(e)) return true;
  if (MEMBER_LENGTH_RE.test(e)) return true;
  if (PLUS_ONE_RE.test(e)) return true;
  if (BARE_SAFE_IDENTIFIERS.has(e)) return true;
  if (isStaticTernary(e)) return true;
  return false;
}

function findTemplateLiterals(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '`') continue;
    let j = i + 1, depth = 0, exprStart = -1;
    const exprs = [];
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (depth === 0 && ch === '`') break;
      if (ch === '$' && src[j + 1] === '{') { depth === 0 && (exprStart = j + 2); depth++; j += 2; continue; }
      if (ch === '{' && depth > 0) { depth++; j++; continue; }
      if (ch === '}' && depth > 0) {
        depth--;
        if (depth === 0) exprs.push({ start: exprStart, end: j, text: src.slice(exprStart, j) });
        j++; continue;
      }
      j++;
    }
    out.push({ start: i, end: j, raw: src.slice(i, j + 1), exprs });
    i = j;
  }
  return out;
}

const looksLikeHtml = (raw) => /<[a-zA-Z/!]/.test(raw);

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
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

function run(argv) {
  const root = path.resolve(__dirname, '..');
  let targets = argv.slice(2);
  if (targets.length === 0) {
    targets = fs.readdirSync(path.join(root, 'js'))
      .filter(f => f.endsWith('.js') && f !== 'security.js')
      .map(f => path.join('js', f));
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
  isSafeExpression,
  isStaticTernary,
  isStaticStringLiteral,
  isSafeCallChain,
  findTemplateLiterals,
  scan
};

if (require.main === module) {
  process.exit(run(process.argv) === 0 ? 0 : 1);
}
