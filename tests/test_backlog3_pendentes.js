// test_backlog3_pendentes.js
// Backlog 3 — itens que ainda estavam pendentes e foram implementados nesta rodada.
// Cada seção cobre um item do SPECs/backlog3.md:
//   K  Remover gráficos duplicados do Painel Geral
//   (demais seções são acrescentadas à medida que os itens são entregues)
//
// Execução: node tests/test_backlog3_pendentes.js

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf-8'); }

let passou = 0;
let falhou = 0;
function check(label, ok, detalhe) {
  if (ok) {
    passou++;
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    falhou++;
    console.log(`  ❌ [FAIL] ${label}${detalhe ? ' — ' + detalhe : ''}`);
  }
}

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* validação em DOM real é pulada sem jsdom */ }

// ─────────────────────────────────────────────────────────────────────────────
// K. Remover gráficos duplicados do Painel Geral
// ─────────────────────────────────────────────────────────────────────────────
function testarRemocaoGraficosDashboard() {
  console.log('\nK. Remover gráficos duplicados do Painel Geral');

  const htmlDashboard = read('dashboard.html');
  const htmlRelatorios = read('relatorios.html');
  const srcDashboard = read('js/pages/dashboard.js');
  const srcCharts = read('js/pages/charts.js');
  const srcWebmcpDash = read('js/webmcp/webmcp-dashboard.js');
  const srcWebmcpRel = read('js/webmcp/webmcp-relatorios.js');

  check('dashboard.html não tem o painel #chartsRolePanel', !htmlDashboard.includes('id="chartsRolePanel"'));
  check('dashboard.html não tem a grade #chartsRoleGrid nem o botão #chartsRefreshBtn',
    !htmlDashboard.includes('id="chartsRoleGrid"') && !htmlDashboard.includes('id="chartsRefreshBtn"'));
  check('dashboard.html não carrega a biblioteca Chart.js (CDN)', !htmlDashboard.includes('cdn.jsdelivr.net/npm/chart.js'));
  check('dashboard.html não carrega js/pages/charts.js', !htmlDashboard.includes('js/pages/charts.js'));
  check('dashboard.js não chama NexusCharts (sem gráficos no Painel Geral)', !srcDashboard.includes('NexusCharts'));
  check('charts.js não expõe mais initDashboard', !/initDashboard\s*:/.test(srcCharts));
  check('charts.js usa relatoriosChartsGrid como container padrão',
    srcCharts.includes("containerId: 'relatoriosChartsGrid'") && !srcCharts.includes("'chartsRoleGrid'"));
  check('ferramenta atualizar_graficos saiu do adaptador do Painel Geral',
    !srcWebmcpDash.includes('atualizar_graficos') && !srcWebmcpDash.includes('chartsRefreshBtn'));
  check('ferramenta atualizar_graficos foi para o adaptador de Relatórios',
    srcWebmcpRel.includes("nome: 'atualizar_graficos'") && srcWebmcpRel.includes("ferramentas: [gerarPdf, exportarCsv, atualizarGraficos]"));
  check('Relatórios mantém os gráficos (grade e botão Atualizar)',
    htmlRelatorios.includes('id="relatoriosChartsGrid"') && htmlRelatorios.includes('id="chartsRefreshBtn"') && htmlRelatorios.includes('js/pages/charts.js'));

  if (!JSDOM) {
    console.log('  ⏭️  [SKIP] jsdom não instalado — verificação de DOM real pulada.');
    return;
  }
  const dom = new JSDOM(htmlDashboard, { url: 'http://localhost:3000/dashboard.html' });
  const doc = dom.window.document;
  check('DOM real do Painel Geral: nenhum elemento canvas', doc.querySelectorAll('canvas').length === 0);
  check('DOM real do Painel Geral: nenhum cartão de gráfico (data-chart-card)', doc.querySelectorAll('[data-chart-card]').length === 0);
  check('DOM real do Painel Geral: nenhum script do Chart.js',
    Array.from(doc.querySelectorAll('script[src]')).every((s) => !/chart\.js/i.test(s.getAttribute('src'))));
  check('DOM real do Painel Geral: cards de indicadores operacionais continuam (cardPreventivaVal)',
    !!doc.getElementById('cardPreventivaVal'));
  dom.window.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────
(function main() {
  console.log('\n=== Backlog 3 — itens pendentes ===');
  testarRemocaoGraficosDashboard();

  console.log(`\nResultado: ${passou} aprovado(s), ${falhou} falha(s).`);
  if (falhou > 0) process.exit(1);
})();
