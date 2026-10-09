/**
 * Auxiliares compartilhados pelos testes WebMCP (tests/test_webmcp*.js).
 * Carrega as páginas reais do projeto em jsdom, com scripts locais, sem rede.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let JSDOM = null;
let VirtualConsole = null;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom')); // devDependency do projeto
} catch (e) {
  JSDOM = null;
}

let total = 0;
let falhas = 0;

/** Saída do próprio teste (não passa pelo console, que os módulos silenciam nas validações negativas). */
function log(texto) {
  process.stdout.write(`${texto}\n`);
}

function check(label, cond, extra) {
  total += 1;
  if (cond) {
    log(`  ✅ [PASS] ${label}`);
  } else {
    falhas += 1;
    process.stdout.write(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}\n`);
  }
}

/** HTML real de uma página, sem scripts (os módulos são carregados explicitamente). */
function htmlDaPagina(pagina) {
  return read(pagina).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '');
}

function resumo() {
  return { total, falhas };
}

const aguardar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sessão de teste (mesmo formato de nexus_session; sem dados reais). */
function sessao(cargo, extra) {
  const nomes = {
    ESTIVADOR: 'Estivador', CONFERENTE_CARGA: 'Conferente de Carga', ARRUMADOR_CONSERTADOR: 'Arrumador',
    PLANEJADOR_PATIO_NAVIOS: 'Planejador', TECNICO_PORTOS: 'Técnico em Portos', INSPETOR: 'Inspetor',
    SUPERVISOR_GERENTE_OPERACOES: 'Supervisor de Operações', DIRETOR_OPERACOES_LOGISTICA: 'Diretor de Operações',
    DIRETOR_PRESIDENTE_SUPERINTENDENTE: 'Diretor Presidente', CONSELHO_ADMINISTRACAO: 'Conselho'
  };
  return Object.assign({
    id: undefined,
    nome: `Operador de teste (${nomes[cargo] || cargo})`,
    matricula: 'MAT-9001',
    codigo_individual: 'NX-9001-SP',
    cargo,
    cargo_nome: nomes[cargo] || cargo
  }, extra || {});
}

/**
 * Cria uma janela jsdom limpa. `opcoes`:
 *   url, html, session, storage (objeto chave -> valor), native (fn(window) antes dos scripts),
 *   secure (boolean ou undefined), scripts (lista de caminhos ou funções fn(window)).
 */
function criarJanela(opcoes) {
  if (!JSDOM) throw new Error('jsdom não instalado (rode npm install).');
  const o = opcoes || {};
  // Erros não capturados nas páginas (listeners, scripts assíncronos) são guardados para a verificação.
  const erros = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (erro) => erros.push(erro && erro.message ? erro.message : String(erro)));
  const dom = new JSDOM(o.html || '<!doctype html><html><head></head><body></body></html>', {
    url: o.url || 'https://nexusport.test/dashboard.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const w = dom.window;
  if (o.secure === false) {
    Object.defineProperty(w, 'isSecureContext', { value: false, configurable: true });
  }
  if (o.native) o.native(w);
  // A limpeza one-shot de dados fantasmas (auth-guard.js) não deve apagar os dados de teste.
  w.localStorage.setItem('nexus_ghost_clean_v1', 'true');
  if (o.session) {
    w.document.cookie = 'nexus_session=' + encodeURIComponent(JSON.stringify(o.session)) + '; path=/';
  }
  Object.keys(o.storage || {}).forEach((k) => {
    const v = o.storage[k];
    w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  });
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  w.scrollTo = () => {};
  (o.scripts || []).forEach((s) => {
    if (typeof s === 'function') {
      s(w);
      return;
    }
    try {
      w.eval(read(s));
    } catch (erro) {
      process.stdout.write(`  ⚠️ erro ao carregar ${s}: ${erro && erro.message}\n`);
    }
  });
  return { dom, w, erros };
}

/** Espera o DOMContentLoaded (jsdom dispara após o parse). */
function prontoDom(w) {
  return new Promise((resolve) => {
    if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', () => resolve());
    else resolve();
  });
}

module.exports = { ROOT, read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina };
