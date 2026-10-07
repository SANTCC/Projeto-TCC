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

const SAFE_WRAPPERS = [
  /^esc\(/, /^nexusEsc\(/, /^NexusSecurity\.escapeHtml\(/, /^escapeHtml\(/,
  /^escAttr\(/, /^nexusEscAttr\(/,
  /^jsArg\(/, /^nexusJsArg\(/, /^NexusSecurity\.jsString\(/, /^jsString\(/,
  /^nexusSafeUrl\(/, /^safeUrl\(/,
  /^Number\(/, /^parseInt\(/, /^parseFloat\(/,
  /toLocaleString\(/, /toISOString\(/, /toLocaleDateString\(/, /toLocaleTimeString\(/,
  /^new Date\(/, /^index\s*\+/, /^\w+\s*\+\s*1$/, /^key$/, /^idx$/,
];

/** Um ternário cujos dois ramos são literais de string estáticos é seguro. */
function isStaticTernary(expr) {
  const m = expr.match(/\?([\s\S]*):([\s\S]*)$/);
  if (!m) return false;
  const stripQuotes = (t) => t.trim().replace(/^['"][\s\S]*['"]$/, '');
  const branchHasDynamic = (t) => /\$\{/.test(t);
  return !branchHasDynamic(m[1]) && !branchHasDynamic(m[2]);
}

/**
 * Heurística de segurança de uma expressão interpolada:
 *  - já codificada em qualquer nível (esc/jsArg/...);
 *  - variável "…Html" construída e codificada previamente;
 *  - valor numérico/derivado (`.length`, contadores);
 *  - ternário apenas com classes/strings estáticas.
 */
function isSafeExpression(expr) {
  if (SAFE_WRAPPERS.some(re => re.test(expr))) return true;
  if (/\besc\(|\bjsArg\(|\bnexusEsc\(|\bnexusJsArg\(|\bNexusSecurity\./.test(expr)) return true;
  if (/^[A-Za-z_$][\w$]*Html$/.test(expr)) return true;
  if (/\.length$/.test(expr)) return true;
  if (isStaticTernary(expr)) return true;
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

const root = path.resolve(__dirname, '..');
let targets = process.argv.slice(2);
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
process.exit(total === 0 ? 0 : 1);
