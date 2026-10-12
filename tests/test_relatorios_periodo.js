/**
 * TESTE DE REGRESSÃO — PERÍODO DE REFERÊNCIA DOS RELATÓRIOS (js/pages/charts.js)
 *
 * Sintoma relatado: "todas as cargas aparecem como cadastradas hoje".
 * Causa: o filtro de período usava data de entrada/chegada (data_entrada,
 * dataChegada) antes da data de cadastro real. Agora o recorte usa a data de
 * cadastro (data_cadastro / created_at). Cargas sem data de cadastro saem do
 * recorte quando há período ativo.
 *
 * Executar: node tests/test_relatorios_periodo.js   (ou: npm run test:relatorios-periodo)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

function criarStorage() {
  const mapa = {};
  return {
    getItem: (k) => (k in mapa ? mapa[k] : null),
    setItem: (k, v) => { mapa[k] = String(v); },
    removeItem: (k) => { delete mapa[k]; }
  };
}

function carregarCharts() {
  const doc = {
    documentElement: { classList: { contains: () => false, add() {}, remove() {}, toggle() { return false; } } },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, addEventListener() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    addEventListener() {},
    hidden: false
  };
  const win = {
    document: doc, localStorage: criarStorage(), console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    MutationObserver: undefined, Chart: undefined, nexusSupabase: null, NexusVision: undefined
  };
  win.window = win;
  const codigo = fs.readFileSync(path.join(ROOT, 'js/pages/charts.js'), 'utf-8');
  const ctx = vm.createContext({ window: win, document: doc, localStorage: win.localStorage, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval });
  vm.runInContext(codigo, ctx);
  return win.NexusCharts;
}

const DIA = 24 * 60 * 60 * 1000;
const agora = Date.now();
const ha = (dias) => new Date(agora - dias * DIA).toISOString();

const NC = carregarCharts();
const norm = NC.utils.normalizarCarga;

function idsDoPeriodo(periodo, linhas) {
  NC.definirFiltros({ periodo });
  return NC.filtrarDados({ cargas: linhas.map(norm) }).cargas.map((c) => c.id);
}

console.log('\n1. Período usa a data de cadastro, não a data de entrada');
{
  const cadastradaAntiga = { id: 'CRG-ANTIGA', status_fluxo: 'ARMAZENAGEM', created_at: ha(90), data_entrada: ha(1) };
  const cadastradaRecente = { id: 'CRG-RECENTE', status_fluxo: 'AGENDAMENTO', created_at: ha(2), data_entrada: null };
  const linhas = [cadastradaAntiga, cadastradaRecente];
  const ids30 = idsDoPeriodo('30D', linhas);
  check('carga cadastrada há 90 dias não aparece em 30D (mesmo com entrada recente)', ids30.indexOf('CRG-ANTIGA') < 0, JSON.stringify(ids30));
  check('carga cadastrada há 2 dias aparece em 30D', ids30.indexOf('CRG-RECENTE') >= 0, JSON.stringify(ids30));
}

console.log('\n2. Data de cadastro tem prioridade sobre data de chegada');
{
  const linha = { id: 'CRG-CHEGADA', status_fluxo: 'RECEBIMENTO_INSPECAO', data_cadastro: ha(120), created_at: ha(120), dataChegada: new Date(agora).toLocaleString('pt-BR') };
  const ids = idsDoPeriodo('30D', [linha]);
  check('chegada de hoje não torna a carga cadastrada hoje', ids.indexOf('CRG-CHEGADA') < 0, JSON.stringify(ids));
}

console.log('\n3. Carga sem data de cadastro não entra em período com recorte');
{
  const semData = { id: 'CRG-SEM-DATA', status_fluxo: 'AGENDAMENTO' };
  const ids = idsDoPeriodo('7D', [semData]);
  check('carga sem data de cadastro excluída de 7D', ids.length === 0, JSON.stringify(ids));
  const idsTodos = idsDoPeriodo('TODOS', [semData]);
  check('em "Todos" a carga sem data continua aparecendo', idsTodos.indexOf('CRG-SEM-DATA') >= 0, JSON.stringify(idsTodos));
}

console.log('\n4. Conjunto misto: só as cargas cadastradas no período');
{
  const linhas = [
    { id: 'A', status_fluxo: 'ENTREGUE', created_at: ha(3), data_entrada: ha(3) },
    { id: 'B', status_fluxo: 'ENTREGUE', created_at: ha(45), data_entrada: ha(44) },
    { id: 'C', status_fluxo: 'ARMAZENAGEM', created_at: ha(400), data_entrada: ha(0) }
  ];
  check('7D traz só A', JSON.stringify(idsDoPeriodo('7D', linhas)) === '["A"]', JSON.stringify(idsDoPeriodo('7D', linhas)));
  check('MENSAL/TRIMESTRAL não trazem C', idsDoPeriodo('TRIMESTRAL', linhas).indexOf('C') < 0);
  check('TODOS traz as três', idsDoPeriodo('TODOS', linhas).length === 3);
}

console.log(passed ? '\n✅ Todas as verificações do período passaram.' : '\n❌ Há verificações do período que falharam.');
process.exit(passed ? 0 : 1);
