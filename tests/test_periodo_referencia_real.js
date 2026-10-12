#!/usr/bin/env node
/**
 * REGRESSÃO (E1 — Backlog 001, item C15): o período de referência segue a DATA REAL.
 *
 * Antes desta correção:
 *   - o HTML trazia rótulos com data FIXA ("3º Trimestre de 2026", "Ano Atual (2026)"),
 *     que deixavam de valer a cada virada de trimestre/ano (em outubro/2026 a tela ainda
 *     dizia "3º Trimestre de 2026");
 *   - a tabela de produtividade (js/pages/relatorios.js) e os gráficos (js/pages/charts.js)
 *     calculavam o MESMO período com contas diferentes: o "trimestre" da tabela começava
 *     3 meses antes e o dos gráficos 2 meses antes — a mesma seleção recortava janelas
 *     distintas em cada painel;
 *   - o operador não via em lugar nenhum as datas reais do recorte.
 *
 * Agora js/periodo-referencia.js é a fonte única: janela, rótulo e intervalo saem do relógio
 * real (o módulo aceita um "agora" para o teste) e a tabela e os gráficos usam a mesma conta.
 *
 * Executar: node tests/test_periodo_referencia_real.js   (ou: npm run test:periodo-referencia)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const H = require('./webmcp-harness');
const { criarJanela, prontoDom, aguardar, htmlDaPagina, sessao } = H;
let criarBancoFalso = null;
try {
  ({ criarBancoFalso } = require('./fake-supabase-db'));
} catch (e) {
  criarBancoFalso = null;
}
let total = 0;
let falhas = 0;
function check(label, cond, extra) {
  total += 1;
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    falhas += 1;
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
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

/** Carrega js/periodo-referencia.js isolado (mesmo padrão dos testes de página). */
function carregarPeriodo() {
  const win = { localStorage: criarStorage(), console, Date, Intl };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/periodo-referencia.js'), 'utf-8'), ctx);
  return win.NexusPeriodo;
}

/** Carrega js/pages/charts.js com um dublê mínimo de DOM (sem o módulo do período). */
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
  const ctx = vm.createContext({ window: win, document: doc, localStorage: win.localStorage, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pages/charts.js'), 'utf-8'), ctx);
  return win.NexusCharts;
}

const dia = (a, m, d, hh, mm) => new Date(a, m - 1, d, hh || 12, mm || 0, 0, 0);
const mesmoDia = (data, a, m, d) => data instanceof Date
  && data.getFullYear() === a && data.getMonth() === m - 1 && data.getDate() === d;

const P = carregarPeriodo();
const NC = carregarCharts();

// ---------------------------------------------------------------------------
console.log('\n1. A janela sai do relógio real (e não de uma data escrita no código)');
{
  const agora = dia(2026, 10, 11, 15, 30);
  check('HOJE começa hoje às 00:00', mesmoDia(P.inicioDoPeriodo('HOJE', agora), 2026, 10, 11)
    && P.inicioDoPeriodo('HOJE', agora).getHours() === 0, String(P.inicioDoPeriodo('HOJE', agora)));
  check('7D começa 7 dias antes', mesmoDia(P.inicioDoPeriodo('7D', agora), 2026, 10, 4));
  check('30D começa 30 dias antes', mesmoDia(P.inicioDoPeriodo('30D', agora), 2026, 9, 11));
  check('MENSAL começa no dia 1º do mês real', mesmoDia(P.inicioDoPeriodo('MENSAL', agora), 2026, 10, 1));
  check('TRIMESTRAL começa no 1º dia do trimestre CIVIL real (out = 4º trimestre)',
    mesmoDia(P.inicioDoPeriodo('TRIMESTRAL', agora), 2026, 10, 1), String(P.inicioDoPeriodo('TRIMESTRAL', agora)));
  check('ANUAL começa em 1º de janeiro do ano real', mesmoDia(P.inicioDoPeriodo('ANUAL', agora), 2026, 1, 1));
  check('trimestre civil: jan = 1º, abr = 2º, jul = 3º, out = 4º',
    P.trimestreDoMes(0) === 1 && P.trimestreDoMes(3) === 2 && P.trimestreDoMes(6) === 3 && P.trimestreDoMes(9) === 4);
  check('valor desconhecido não inventa janela (sem recorte)', P.inicioDoPeriodo('QUALQUER', agora) === null);
}

// ---------------------------------------------------------------------------
console.log('\n2. Viradas de mês, trimestre e ano no relógio real');
{
  const julho = dia(2026, 7, 15);
  check('15/07/2026 → trimestre começa em 01/07/2026', mesmoDia(P.inicioDoPeriodo('TRIMESTRAL', julho), 2026, 7, 1));
  check('31/12/2026 → trimestre começa em 01/10/2026', mesmoDia(P.inicioDoPeriodo('TRIMESTRAL', dia(2026, 12, 31, 23, 59)), 2026, 10, 1));
  check('01/01/2026 → trimestre começa em 01/01/2026', mesmoDia(P.inicioDoPeriodo('TRIMESTRAL', dia(2026, 1, 1, 0, 5)), 2026, 1, 1));

  const em2027 = dia(2027, 2, 10);
  check('ano seguinte: ANUAL passa a 2027', mesmoDia(P.inicioDoPeriodo('ANUAL', em2027), 2027, 1, 1));
  check('ano seguinte: MENSAL passa a fevereiro/2027', mesmoDia(P.inicioDoPeriodo('MENSAL', em2027), 2027, 2, 1));
  check('ano seguinte: 7D atravessa o mês (03/02/2027)', mesmoDia(P.inicioDoPeriodo('7D', em2027), 2027, 2, 3));
  check('ano seguinte: 30D atravessa o ano (11/01/2027)', mesmoDia(P.inicioDoPeriodo('30D', em2027), 2027, 1, 11));
  check('virada do dia: HOJE de 01/01 às 00:05 é o próprio 01/01', mesmoDia(P.inicioDoPeriodo('HOJE', dia(2027, 1, 1, 0, 5)), 2027, 1, 1));
}

// ---------------------------------------------------------------------------
console.log('\n3. Rótulos com a data real (nada de "3º Trimestre de 2026" fixo)');
{
  const outubro2026 = dia(2026, 10, 11);
  check('trimestre atual aparece como 4º trimestre de 2026',
    P.rotuloPeriodo('TRIMESTRAL', outubro2026) === '4º trimestre de 2026', P.rotuloPeriodo('TRIMESTRAL', outubro2026));
  check('março/2026 aparece como 1º trimestre de 2026',
    P.rotuloPeriodo('TRIMESTRAL', dia(2026, 3, 20)) === '1º trimestre de 2026', P.rotuloPeriodo('TRIMESTRAL', dia(2026, 3, 20)));
  check('ano atual traz o ano real dos dois relógios',
    P.rotuloPeriodo('ANUAL', outubro2026) === 'Ano atual (2026)' && P.rotuloPeriodo('ANUAL', dia(2027, 5, 2)) === 'Ano atual (2027)',
    `${P.rotuloPeriodo('ANUAL', outubro2026)} / ${P.rotuloPeriodo('ANUAL', dia(2027, 5, 2))}`);
  check('mês atual traz o mês real por extenso',
    P.rotuloPeriodo('MENSAL', outubro2026) === 'Este mês (outubro de 2026)', P.rotuloPeriodo('MENSAL', outubro2026));
  check('rótulos fixos não existem em nenhum relógio',
    !/Trimestre de 20\d\d|Ano Atual \(20\d\d\)/.test(P.rotuloPeriodo('TRIMESTRAL', outubro2026) + P.rotuloPeriodo('ANUAL', outubro2026)));

  const select = { options: [{ value: 'HOJE', textContent: 'Hoje' }, { value: 'TRIMESTRAL', textContent: 'Trimestre atual' }, { value: 'ANUAL', textContent: 'Ano atual' }, { value: 'OUTRO', textContent: 'Não mexer' }] };
  P.aplicarRotulosAoSelect(select, outubro2026);
  check('aplicarRotulosAoSelect escreve o trimestre/ano reais',
    select.options[1].textContent === '4º trimestre de 2026' && select.options[2].textContent === 'Ano atual (2026)',
    JSON.stringify(select.options.map((o) => o.textContent)));
  check('valor fora da lista de períodos é preservado', select.options[3].textContent === 'Não mexer');
}

// ---------------------------------------------------------------------------
console.log('\n4. Intervalo real exibido ao operador (pt-BR)');
{
  const agora = dia(2026, 10, 11);
  check('30D: 11/09/2026 até 11/10/2026', P.intervaloPeriodo('30D', agora).texto === '11/09/2026 até 11/10/2026',
    P.intervaloPeriodo('30D', agora).texto);
  check('MENSAL: 01/10/2026 até 11/10/2026', P.intervaloPeriodo('MENSAL', agora).texto === '01/10/2026 até 11/10/2026',
    P.intervaloPeriodo('MENSAL', agora).texto);
  check('TRIMESTRAL: 01/10/2026 até 11/10/2026 (trimestre civil em curso)',
    P.intervaloPeriodo('TRIMESTRAL', agora).texto === '01/10/2026 até 11/10/2026', P.intervaloPeriodo('TRIMESTRAL', agora).texto);
  check('HOJE: só o dia corrente', P.intervaloPeriodo('HOJE', agora).texto === '11/10/2026', P.intervaloPeriodo('HOJE', agora).texto);
  check('ANUAL: 01/01/2026 até 11/10/2026', P.intervaloPeriodo('ANUAL', agora).texto === '01/01/2026 até 11/10/2026',
    P.intervaloPeriodo('ANUAL', agora).texto);
  check('o fim do intervalo é o dia real de hoje, não o fim do mês/ano',
    mesmoDia(P.intervaloPeriodo('ANUAL', agora).fim, 2026, 10, 11));
  check('sem período válido, informa todo o histórico até hoje',
    /^todo o histórico até \d{2}\/\d{2}\/\d{4}$/.test(P.intervaloPeriodo('TODOS', agora).texto), P.intervaloPeriodo('TODOS', agora).texto);
}

// ---------------------------------------------------------------------------
console.log('\n5. Tabela e gráficos usam a MESMA janela do mesmo período');
{
  const agora = new Date();
  const DIA = 24 * 60 * 60 * 1000;
  const ha = (dias) => new Date(agora.getTime() - dias * DIA).toISOString();
  const inicioTrimestre = P.inicioDoPeriodo('TRIMESTRAL', agora);
  const diasNoTrimestre = Math.floor((agora.getTime() - inicioTrimestre.getTime()) / DIA);

  const dentro = { id: 'CRG-DENTRO', status_fluxo: 'ARMAZENAGEM', created_at: ha(Math.max(0, diasNoTrimestre - 1)) };
  const fora = { id: 'CRG-FORA', status_fluxo: 'ARMAZENAGEM', created_at: ha(diasNoTrimestre + 15) };
  NC.definirFiltros({ periodo: 'TRIMESTRAL' });
  const ids = NC.filtrarDados({ cargas: [dentro, fora].map(NC.utils.normalizarCarga) }).cargas.map((c) => c.id);
  check('gráficos: carga do trimestre civil entra e a de fora sai',
    ids.indexOf('CRG-DENTRO') >= 0 && ids.indexOf('CRG-FORA') < 0, JSON.stringify(ids));
  check('gráficos e tabela apontam para o mesmo início de janela (módulo compartilhado)',
    inicioTrimestre.getTime() === P.inicioDoPeriodo('TRIMESTRAL', agora).getTime());
  check('rotina de reserva dos gráficos (sem o módulo) usa a mesma regra do trimestre civil',
    /Math\.floor\(agora\.getMonth\(\) \/ 3\) \* 3/.test(fs.readFileSync(path.join(ROOT, 'js/pages/charts.js'), 'utf-8')));
}

// ---------------------------------------------------------------------------
console.log('\n6. Sem data fixa no HTML e sem contas duplicadas nos módulos');
{
  const html = fs.readFileSync(path.join(ROOT, 'relatorios.html'), 'utf-8');
  const bloco = html.slice(html.indexOf('id="relatorioPeriodoSelect"'), html.indexOf('id="relatorioPeriodoChips"'));
  check('opções do seletor de período não têm ano/trimestre fixo', !/20\d\d/.test(bloco),
    (bloco.match(/20\d\d/g) || []).join(', '));
  check('HTML carrega a fonte única do período', /src="js\/periodo-referencia\.js"/.test(html));
  check('HTML mostra o intervalo real do período', /id="relatorioPeriodoIntervalo"/.test(html));

  const relatoriosJs = fs.readFileSync(path.join(ROOT, 'js/pages/relatorios.js'), 'utf-8');
  check('relatorios.js usa a fonte única do período', /NexusPeriodo\.inicioDoPeriodo/.test(relatoriosJs)
    || /periodoRef\.inicioDoPeriodo/.test(relatoriosJs));
  check('relatorios.js não tem mais a conta própria do trimestre (getMonth() - 3)',
    !/getMonth\(\) - 3/.test(relatoriosJs));
  const chartsJs = fs.readFileSync(path.join(ROOT, 'js/pages/charts.js'), 'utf-8');
  check('charts.js usa a fonte única do período', /NexusPeriodo\.inicioDoPeriodo/.test(chartsJs));
  check('charts.js não tem mais a conta própria do trimestre (getMonth() - 2)',
    !/getMonth\(\) - 2/.test(chartsJs));
  check('nenhum módulo de página guarda data fixa de relógio',
    !/20\d\d-\d\d-\d\d/.test(relatoriosJs + chartsJs));
}

// ---------------------------------------------------------------------------
console.log('\n7. Página real: rótulos do dia, intervalo visível e recorte da produtividade');
async function testarPagina() {
  if (!criarBancoFalso) {
    check('dublê de banco disponível para o teste da página', false, 'tests/fake-supabase-db.js não carregou');
    return;
  }
  const agora = Date.now();
  const DIA = 24 * 60 * 60 * 1000;
  const iso = (dias) => new Date(agora - dias * DIA).toISOString();
  const FUNC_ID = '11110000-0000-4000-8000-000000000001';
  const banco = criarBancoFalso({
    funcionarios: [{ id: FUNC_ID, nome: 'Operador de teste', cargo: 'ESTIVADOR', matricula: 'MAT-9001', codigo_individual: 'NX-9001-SP', ativo: true }],
    logs_alteracoes: [
      { id: 'log-recente-1', funcionario_id: FUNC_ID, acao: 'CRIACAO', entidade: 'cargas', created_at: iso(1) },
      { id: 'log-recente-2', funcionario_id: FUNC_ID, acao: 'EDICAO', entidade: 'cargas', created_at: iso(5) },
      // Dentro do ano civil real, fora dos últimos 30 dias.
      { id: 'log-do-ano', funcionario_id: FUNC_ID, acao: 'CRIACAO', entidade: 'cargas', created_at: iso(120) },
      // Antes do ano civil real: nem o recorte anual pode trazer.
      { id: 'log-fora-do-ano', funcionario_id: FUNC_ID, acao: 'CRIACAO', entidade: 'cargas', created_at: iso(400) }
    ],
    cargas: [], navios: [], containers: [], bercos: [], manutencoes: [], visitantes: [], trail_decisoes: []
  });
  const janela = criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    html: htmlDaPagina('relatorios.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-9001-SP' }),
    storage: { nexus_func_list: [], nexus_cargas_fluxo: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { win.currentUserSession = win.NexusAuth.getSession(); win.nexusSupabase = banco; win.NEXUS_CONFIG = {}; },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => { win.mostrarFeedback = () => {}; },
      'js/periodo-referencia.js',
      'js/data-repository.js',
      'js/pages/relatorios.js'
    ]
  });
  const w = janela.w;
  await prontoDom(w);
  await aguardar(250);

  const rotuloEsperado = w.NexusPeriodo.rotuloPeriodo('TRIMESTRAL');
  const select = w.document.getElementById('relatorioPeriodoSelect');
  const opcao = Array.prototype.find.call(select.options, (o) => o.value === 'TRIMESTRAL');
  check('o seletor mostra o trimestre REAL do dia', opcao && opcao.textContent === rotuloEsperado,
    opcao && opcao.textContent);
  check('nenhuma opção do seletor repete "Trimestre de 2026" fixo',
    !Array.prototype.some.call(select.options, (o) => /Trimestre de 20\d\d|Ano Atual \(20\d\d\)/.test(o.textContent)),
    JSON.stringify(Array.prototype.map.call(select.options, (o) => o.textContent)));

  const intervalo = w.document.getElementById('relatorioPeriodoIntervalo').textContent;
  const intervaloEsperado = w.NexusPeriodo.intervaloPeriodo(select.value).texto;
  check('a página mostra o intervalo real do período em vigor',
    intervalo === `Período aplicado: ${intervaloEsperado}`, intervalo);

  const tabela = w.document.getElementById('produtividadeTableBody').textContent;
  check('30 dias (padrão): só os registros dos últimos 30 dias contam',
    tabela.includes('2 Operação(ões) Registrada(s)') && !tabela.includes('3 Operação(ões)'), tabela.slice(0, 160));

  select.value = 'ANUAL';
  select.dispatchEvent(new w.Event('change'));
  await aguardar(250);
  const tabelaAnual = w.document.getElementById('produtividadeTableBody').textContent;
  check('ano atual: entram os registros do ANO real (inclusive fora dos 30 dias)',
    tabelaAnual.includes('3 Operação(ões) Registrada(s)'), tabelaAnual.slice(0, 160));
  check('ano atual: o registro anterior ao ano real continua fora', !tabelaAnual.includes('4 Operação(ões)'));
  check('o intervalo visível acompanha a troca de período',
    w.document.getElementById('relatorioPeriodoIntervalo').textContent === `Período aplicado: ${w.NexusPeriodo.intervaloPeriodo('ANUAL').texto}`,
    w.document.getElementById('relatorioPeriodoIntervalo').textContent);

  select.value = 'HOJE';
  select.dispatchEvent(new w.Event('change'));
  await aguardar(250);
  const tabelaHoje = w.document.getElementById('produtividadeTableBody').textContent;
  check('hoje: nenhum dos registros antigos conta', tabelaHoje.includes('0 Operação(ões) Registrada(s)'), tabelaHoje.slice(0, 160));

  w.close();
}

testarPagina().then(() => {
  console.log(falhas === 0
    ? `\n✅ Período de referência real: ${total} verificações aprovadas.`
    : `\n❌ Período de referência real: ${falhas} falha(s) em ${total} verificações.`);
  process.exit(falhas === 0 ? 0 : 1);
});
