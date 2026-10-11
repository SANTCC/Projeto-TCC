// test_backlog3_pendentes.js
// Backlog 3 — itens que ainda estavam pendentes e foram implementados nesta rodada.
// Cada seção cobre um item do SPECs/backlog3.md:
//   K  Remover gráficos duplicados do Painel Geral
//   M  Rotas marítimas no cadastro de navios (sem rotas estáticas)
//   L  Impedir vinculação de carga a navio fora do porto
//   I  Reorganizar arquivos .JS (js/, js/pages/, js/webmcp/)
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
const H = require('./webmcp-harness.js');
const criarJanelaTeste = (opcoes) => H.criarJanela(opcoes);

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
// M. Rotas marítimas no cadastro de navios (sem rotas estáticas)
// ─────────────────────────────────────────────────────────────────────────────
function testarRotasMaritimas() {
  console.log('\nM. Rotas marítimas no cadastro de navios');

  const emb = read('js/pages/embarcacoes.js');
  const cargas = read('js/pages/cargas.js');
  const html = read('embarcacoes.html');
  const webmcpEmb = read('js/webmcp/webmcp-embarcacoes.js');

  check('embarcacoes.js não tem mais lista estática de rotas (rotasMaritimasList = [ ... ])',
    !/rotasMaritimasList\s*=\s*\[\s*\{/.test(emb));
  check('embarcacoes.js não cita rotas fixas (Roterdã, Xangai, Hamburgo)',
    !/Roterdã|Xangai|Hamburgo/.test(emb));
  check('embarcacoes.js não usa distância padrão de 10200 km (ETA e progresso vêm da rota)',
    !/10200/.test(emb));
  check('cargas.js não usa destino padrão fictício na liberação de saída',
    !/Porto de Roterdã/.test(cargas) && /destino não informado no cadastro da carga/.test(cargas));
  check('carregamento de rotas lê somente rotas_maritimas do Supabase',
    /from\('rotas_maritimas'\)\.select\('\*'\)/.test(emb));
  check('mensagem explícita quando não há rotas (vazio e indisponível)',
    /Nenhuma rota cadastrada/.test(emb) && /Não foi possível carregar as rotas do Supabase/.test(emb));
  check('ETA sem distância cadastrada é informado, não calculado com número inventado',
    /ETA indisponível: rota sem distância cadastrada/.test(emb));
  check('cadastro de rota só informa sucesso depois de gravar no Supabase (insert com verificação de erro)',
    /from\('rotas_maritimas'\)\.insert\(\{ origem, destino, distancia_km \}\);\s*if \(error\) throw error;/.test(emb));
  check('placeholders do cadastro de rota não trazem rota real como exemplo',
    !/Roterdã|10200/.test(html.slice(html.indexOf('id="rotaForm"'), html.indexOf('id="rotaForm"') + 2000)));
  check('WebMCP cadastrar_navio não aceita distância manual (required sem distancia_km)',
    /required: \['nome', 'imo', 'origem', 'destino', 'localizacao'\]/.test(webmcpEmb));
  check('WebMCP cadastrar_navio não tem mais coordenadas GPS (Correções Adicionais 2.5)',
    !/navioGps|gps: \{ type/.test(webmcpEmb));

  if (!JSDOM) {
    console.log('  ⏭️  [SKIP] jsdom não instalado — verificação de DOM real pulada.');
    return;
  }
  // DOM real: navio fora do porto sem rota cadastrada → ETA informado como indisponível
  const { JSDOM: JSDOM_ } = { JSDOM };
  const sessao = { id: undefined, nome: 'Teste Inspetor', matricula: 'MAT-9001', codigo_individual: 'NX-9001-SP', cargo: 'INSPETOR', cargo_nome: 'Inspetor' };
  const navios = [{ id: 'n1', nome: 'MV Sem Rota', imo: 'DEF7654321', localizacao: 'FORA_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Tóquio', gps: '-23.9700, -46.3100', dataSaida: new Date(Date.now() - 3600 * 1000).toISOString() }];
  const scripts = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js', 'js/pages/embarcacoes.js'];
  const janela = criarJanelaTeste({
    url: 'https://nexusport.test/embarcacoes.html',
    html: read('embarcacoes.html'),
    session: sessao,
    storage: { nexus_navios_list: navios, nexus_bercos_list: [], nexus_containers_list: [], nexus_cargas_fluxo: [] },
    scripts
  });
  const w = janela.w;
  return new Promise((resolve) => {
    setTimeout(() => {
      const corpo = w.document.body.textContent || '';
      check('DOM real: navio sem rota cadastrada mostra "ETA indisponível" (sem valor padrão)',
        /ETA indisponível: rota sem distância cadastrada/.test(corpo) && !/10\.200/.test(corpo) && !/10200/.test(corpo));
      check('DOM real: destino sem rota cadastrada aparece como informado (Porto de Tóquio)', /Porto de Tóquio/.test(corpo));
      check('DOM real: nenhuma rota estática aparece na página', !/Roterdã|Xangai|Hamburgo/.test(corpo));
      w.close();
      resolve();
    }, 60);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// L. Impedir vinculação de carga a navio fora do porto
// ─────────────────────────────────────────────────────────────────────────────
function testarVinculacaoNavioNoPorto() {
  console.log('\nL. Impedir vinculação de carga a navio fora do porto');
  const html = read('cargas.html');
  const js = read('js/pages/cargas.js');
  check('cargas.html tem o seletor de navio do modal de vinculação (#vincularNavioSelect)', /id="vincularNavioSelect"/.test(html));
  check('cargas.html tem o aviso de ausência de navio apto (#vincularNavioAviso)', /id="vincularNavioAviso"/.test(html));
  check('cargas.js filtra navios por DENTRO_DO_PORTO e estado OPERANTE (motivoNavioInaptoVinculo)',
    /motivoNavioInaptoVinculo/.test(js) && /loc === 'DENTRO_DO_PORTO'|loc !== 'DENTRO_DO_PORTO'/.test(js) && /estado !== 'OPERANTE'/.test(js));
  check('seletor de navio lista somente navios aptos (naviosAptosModal)',
    /naviosAptosModal = naviosModal\.filter\(n => !motivoNavioInaptoVinculo\(n\)\)/.test(js));
  check('confirmação recusa contêiner marcado como indisponível (selectedContOpt.disabled)',
    /selectedContOpt && selectedContOpt\.disabled/.test(js));
  check('confirmação revalida o navio com dados frescos (carregarNaviosParaVinculo na confirmação)',
    /const naviosAtuais = await carregarNaviosParaVinculo\(\);/.test(js));
  check('bloqueio informa "Vinculação Bloqueada" com a situação do navio',
    /'Vinculação Bloqueada', `BLOQUEIO DE REGRA DE NEGÓCIO: O navio/.test(js));
}

// ─────────────────────────────────────────────────────────────────────────────
// I. Reorganizar arquivos .JS (js/ raiz, js/pages/ e js/webmcp/)
// ─────────────────────────────────────────────────────────────────────────────
function testarReorganizacaoJs() {
  const fs = require('fs');
  const referencias = [];
  fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).forEach((arq) => {
    for (const m of read(arq).matchAll(/<script[^>]+src="([^"]+)"/g)) {
      if (!/^(https?:)?\/\//.test(m[1])) referencias.push({ arq, src: m[1] });
    }
  });
  const faltando = referencias.filter((r) => !fs.existsSync(path.join(ROOT, r.src)));
  check(`toda referência local <script src> aponta para um arquivo existente (${referencias.length} referências)`,
    referencias.length > 0 && faltando.length === 0,
    faltando.slice(0, 3).map((r) => `${r.arq} → ${r.src}`).join(', '));

  const modulosDePagina = ['charts', 'cargas', 'confirm-role', 'dashboard', 'delegacao', 'embarcacoes', 'inspecao',
    'login', 'manutencao', 'relatorios', 'scanner', 'tecnico_portos', 'tipos-carga'];
  const raiz = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
  const naRaiz = raiz.filter((f) => /^webmcp-/.test(f) || modulosDePagina.includes(f.replace(/\.js$/, '')));
  check('js/ raiz não tem mais módulos de página nem webmcp-*.js', naRaiz.length === 0, naRaiz.join(', '));

  const webmcp = fs.readdirSync(path.join(ROOT, 'js', 'webmcp')).filter((f) => /^webmcp-.*\.js$/.test(f));
  check(`js/webmcp/ contém os 14 módulos WebMCP (encontrados: ${webmcp.length})`, webmcp.length === 14);
  const paginas = fs.readdirSync(path.join(ROOT, 'js', 'pages')).filter((f) => f.endsWith('.js'));
  check(`js/pages/ contém os 13 módulos de página (encontrados: ${paginas.length})`, paginas.length === 13);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────
(async function main() {
  console.log('\n=== Backlog 3 — itens pendentes ===');
  testarRemocaoGraficosDashboard();
  await testarRotasMaritimas();
  testarVinculacaoNavioNoPorto();
  testarReorganizacaoJs();

  console.log(`\nResultado: ${passou} aprovado(s), ${falhou} falha(s).`);
  if (falhou > 0) process.exit(1);
})();
