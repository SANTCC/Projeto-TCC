/**
 * TESTE DE REGRESSÃO — CADÊNCIA DO AUTO REFRESH DOS GRÁFICOS (js/pages/charts.js)
 *
 * Sintoma relatado:
 *   "Os gráficos se recarregam sozinhos a cada 10 segundos."
 *
 * Causa raiz:
 *   O repositório emite um heartbeat de sincronização (`periodic_sync`) a cada
 *   10 s (js/data-repository.js) e, junto com o evento de foco da janela
 *   (`window_focus`), ele dispara `nexus_data_changed`. O ouvinte de gráficos
 *   redesenhava TODO o painel a cada evento — daí o "auto reload" de 10 em
 *   10 segundos, sem nenhum dado novo.
 *
 * Comportamento esperado (coberto aqui):
 *   1. A renovação automática do painel é de 1 MINUTO (60000 ms).
 *   2. Heartbeat `periodic_sync` e foco da janela NÃO redesenham os gráficos.
 *   3. Alteração REAL de dados (ex.: `cargas`) continua refletindo na hora.
 *   4. O botão "Atualizar" continua forçando leitura do servidor.
 *
 * Executar: node tests/test_charts_autorefresh.js   (ou: npm run test:autorefresh)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM; // devDependency do projeto
} catch (e) {
  JSDOM = null;
}

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================================================================== *
 * 1. Estático: a cadência é de 1 minuto e o heartbeat é filtrado
 * ================================================================== */
function testarCodigo() {
  console.log('\n1. Validando a cadência no código de js/pages/charts.js...');
  const charts = read('js/pages/charts.js');

  check(
    'A renovação automática usa 60000 ms (1 minuto)',
    /INTERVALO_AUTO_REFRESH_MS\s*=\s*60000/.test(charts),
    'constante INTERVALO_AUTO_REFRESH_MS ausente ou diferente de 60000'
  );
  check(
    'O módulo de gráficos não registra mais nenhum timer de 10000 ms',
    !/setInterval\([\s\S]{0,600}?,\s*10000\s*\)/.test(charts)
  );
  check(
    'O setInterval de renovação usa a constante de 1 minuto',
    /setInterval\([\s\S]{0,600}?,\s*INTERVALO_AUTO_REFRESH_MS\s*\)/.test(charts)
  );
  check(
    'periodic_sync e window_focus estão listados como sincronização de fundo',
    /ENTIDADES_SYNC_FUNDO\s*=\s*\[[^\]]*'periodic_sync'[^\]]*'window_focus'[^\]]*\]/.test(charts)
  );
  check(
    'O ouvinte de nexus_data_changed descarta eventos de fundo',
    /addEventListener\('nexus_data_changed',\s*function\s*\(evento\)[\s\S]{0,900}?ENTIDADES_SYNC_FUNDO/.test(charts)
  );
  check(
    'A cadência é auditável em runtime (NexusCharts.INTERVALO_AUTO_REFRESH_MS)',
    charts.includes('INTERVALO_AUTO_REFRESH_MS: INTERVALO_AUTO_REFRESH_MS')
  );
}

/* ================================================================== *
 * 2. DOM real (jsdom): 30 s de operação não redesenham por heartbeat
 * ================================================================== */
async function testarComportamentoNoPainel() {
  console.log('\n2. Validando o comportamento no painel real (jsdom)...');

  if (!JSDOM) {
    console.log('  ⏭️  [SKIP] jsdom não instalado (execute `npm install` para a validação em DOM real).');
    return;
  }

  const htmlDashboard = read('dashboard.html');
  const fontes = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/supabase-client.js', 'js/data-repository.js', 'js/pages/charts.js', 'js/pages/dashboard.js']
    .map((f) => ({ arquivo: f, codigo: read(f) }));

  const tabelas = {
    cargas: [{ id: 'CRG-1', status_fluxo: 'ARMAZENAGEM', natureza: 'Grãos', peso: 20, created_at: new Date().toISOString() }],
    logs_alteracoes: [], navios: [], containers: [], manutencoes: [], bercos: [], funcionarios: [], visitantes: [], trail_decisoes: []
  };

  const cliente = {
    from(tabela) {
      const builder = {
        select() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        single() { return Promise.resolve({ data: null, error: null }); },
        insert() { return Promise.resolve({ data: null, error: null }); },
        update() { return Promise.resolve({ data: null, error: null }); },
        delete() { return Promise.resolve({ data: null, error: null }); },
        then(resolve) {
          return Promise.resolve(resolve({
            data: JSON.parse(JSON.stringify(tabelas[tabela] || [])),
            error: null,
            count: (tabelas[tabela] || []).length
          }));
        }
      };
      return builder;
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };

  const dom = new JSDOM(htmlDashboard, { url: 'http://localhost:3000/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;

  let renderizacoes = 0;
  win.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  win.Chart = class ChartFake {
    constructor() { renderizacoes++; }
    destroy() {}
  };
  win.Chart.defaults = { font: {}, color: '' };
  win.supabase = { createClient: () => cliente };
  win.localStorage.setItem('SUPABASE_URL', 'https://exemplo.supabase.co');
  win.localStorage.setItem('SUPABASE_ANON_KEY', 'chave-publica-de-teste');
  win.document.cookie = 'nexus_session=' + encodeURIComponent(JSON.stringify({
    cargo: 'ESTIVADOR', nome: 'Operador Teste', codigo_individual: 'COD-1', matricula: 'MAT-1040'
  })) + '; path=/';

  fontes.forEach((f) => win.eval(f.codigo));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  await espera(400);

  const inicial = renderizacoes;
  check('A carga inicial renderiza os gráficos do painel', inicial > 0, `renderizações = ${inicial}`);

  // 30 segundos de operação: 3 heartbeats de 10 s + 1 foco de janela.
  for (let i = 0; i < 3; i++) {
    win.dispatchEvent(new win.CustomEvent('nexus_data_changed', { detail: { entity: 'periodic_sync' } }));
    await espera(500); // acima do debounce de 400 ms
  }
  win.dispatchEvent(new win.CustomEvent('nexus_data_changed', { detail: { entity: 'window_focus' } }));
  await espera(600);

  check(
    'O heartbeat de 10 s (periodic_sync) não redesenha os gráficos',
    renderizacoes === inicial,
    `renderizações = ${renderizacoes} (esperado ${inicial}, sem nenhum redesenho)`
  );
  check(
    'O foco da janela (window_focus) não redesenha os gráficos',
    renderizacoes === inicial,
    `renderizações = ${renderizacoes} (esperado ${inicial})`
  );

  // Alteração real de dados: precisa refletir imediatamente.
  win.dispatchEvent(new win.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  await espera(700);
  check(
    'Alteração real de dados (entity: cargas) ainda redesenha na hora',
    renderizacoes > inicial,
    `renderizações = ${renderizacoes} (esperado > ${inicial})`
  );

  const intervalo = win.NexusCharts && win.NexusCharts.INTERVALO_AUTO_REFRESH_MS;
  check('O painel publica a cadência de 1 minuto', intervalo === 60000, `valor = ${intervalo}`);

  // O botão "Atualizar" continua funcionando (recarga manual independente da cadência).
  const botao = win.document.getElementById('chartsRefreshBtn');
  check('O botão #chartsRefreshBtn continua no painel', !!botao);
  if (botao) {
    const antesDoClique = renderizacoes;
    botao.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await espera(400);
    check(
      'O clique em "Atualizar" continua redesenhando (recarga manual)',
      renderizacoes > antesDoClique,
      `renderizações = ${renderizacoes} (esperado > ${antesDoClique})`
    );
  }

  dom.window.close();
}

(async function main() {
  console.log('\n=== Gráficos: o auto refresh é de 1 minuto (e não de 10 segundos)? ===');
  testarCodigo();
  await testarComportamentoNoPainel();

  console.log('\n' + '='.repeat(64));
  if (passed) {
    console.log('🎉 AUTO REFRESH DOS GRÁFICOS VALIDADO: 1 MINUTO, SEM RELOAD DE 10 SEGUNDOS! 🎉');
    console.log('='.repeat(64));
  } else {
    console.error('⚠️  FALHAS ENCONTRADAS — a cadência dos gráficos voltou a se comportar como antes.');
    console.error('='.repeat(64));
    process.exit(1);
  }
})();
