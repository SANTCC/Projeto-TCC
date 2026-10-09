/**
 * TESTE DE REGRESSÃO — BOTÃO "ATUALIZAR" DOS GRÁFICOS (js/pages/charts.js)
 *
 * Sintoma relatado:
 *   "Clicar no botão Atualizar dos gráficos não traz dado novo do servidor —
 *    apenas redesenha o mesmo gráfico."
 *
 * Causas cobertas por este teste:
 *   1. js/supabase-client.js precisa CARREGAR sem erro de sintaxe; se ele falha,
 *      `window.nexusSupabase` nunca é definido e TODA leitura de gráfico cai no
 *      cache local (nada de novo vem do servidor, em nenhum clique).
 *   2. O botão "Atualizar" precisa IGNORAR o cache em memória (TTL de 4s) e
 *      reconsultar o Supabase, refletindo os dados novos que chegaram lá.
 *   3. Com o servidor fora do ar, os gráficos continuam sendo exibidos a partir
 *      do cache local e o painel informa a origem dos dados (fallback honesto).
 *
 * Executar: node tests/test_charts_refresh.js   (ou: npm run test:refresh)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
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
 * 1. js/supabase-client.js carrega e expõe o cliente (o "servidor")
 * ================================================================== */
function testarClienteSupabase() {
  console.log('\n1. Validando o carregamento de js/supabase-client.js...');

  const codigo = read('js/supabase-client.js');
  // Credenciais mínimas: é o que a página real carrega de js/config.js.
  const credenciais = {
    SUPABASE_URL: 'https://exemplo.supabase.co',
    SUPABASE_ANON_KEY: 'chave-publica-de-teste'
  };
  const storage = {
    getItem: (chave) => (chave in credenciais ? credenciais[chave] : null),
    setItem: () => {},
    removeItem: () => {}
  };

  const win = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: storage,
    location: { search: '' },
    addEventListener() {}
  };
  win.window = win;

  // A CDN do supabase-js entra na página antes deste módulo.
  const contexto = vm.createContext({
    window: win,
    console: win.console,
    localStorage: storage,
    URLSearchParams,
    supabase: { createClient: () => ({ from: () => ({}) }) }
  });

  let erroDeSintaxe = null;
  try {
    vm.runInContext(codigo, contexto);
  } catch (e) {
    erroDeSintaxe = e;
  }

  check(
    'js/supabase-client.js carrega sem quebrar a página (sem SyntaxError)',
    !erroDeSintaxe,
    erroDeSintaxe && `${erroDeSintaxe.constructor.name}: ${erroDeSintaxe.message}`
  );
  check(
    'window.nexusSupabase é definido — os gráficos conseguem consultar o servidor',
    !erroDeSintaxe && !!win.nexusSupabase
  );
  check(
    'window.NexusSupabaseUtils é definido (clientePara/registrarErroTabela/tabelasIndisponiveis)',
    !erroDeSintaxe && !!win.NexusSupabaseUtils
      && typeof win.NexusSupabaseUtils.clientePara === 'function'
      && typeof win.NexusSupabaseUtils.registrarErroTabela === 'function'
      && typeof win.NexusSupabaseUtils.tabelasIndisponiveis === 'function'
  );
  check(
    'normalizarBerco continua exposto (a correção de sintaxe não removeu a função)',
    !erroDeSintaxe && !!win.NexusSupabaseUtils
      && typeof win.NexusSupabaseUtils.normalizarBerco === 'function'
      && win.NexusSupabaseUtils.normalizarBerco({ nome: 'Berço 3', estado: 'LIVRE' }).payload.id === 'BERCO-03'
  );
}

/* ================================================================== *
 * 2. Cliente Supabase falso — os dados "do servidor" mudam entre cliques
 * ================================================================== */
function criarClienteFake(estado) {
  const chamadas = [];

  function montarBuilder(tabela) {
    const builder = {
      select() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      eq() { return builder; },
      in() { return builder; },
      insert() { return Promise.resolve({ data: null, error: null }); },
      update() { return Promise.resolve({ data: null, error: null }); },
      delete() { return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) {
        if (estado.indisponivel) {
          return Promise.resolve(resolve({
            data: null,
            error: { code: 'PGRST205', message: "Could not find the table 'public." + tabela + "' in the schema cache", status: 404 }
          }));
        }
        return Promise.resolve(resolve({
          data: JSON.parse(JSON.stringify(estado.tabelas[tabela] || [])),
          error: null,
          count: (estado.tabelas[tabela] || []).length
        }));
      }
    };
    return builder;
  }

  return {
    chamadas: chamadas,
    from(tabela) {
      chamadas.push(tabela);
      return montarBuilder(tabela);
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    }
  };
}

function contarLeituras(cliente, tabela) {
  return cliente.chamadas.filter((t) => t === tabela).length;
}

/* ================================================================== *
 * 3. Painel real (jsdom): o clique precisa trazer o dado novo
 * ================================================================== */
async function testarAtualizacaoDoPainel() {
  console.log('\n2. Validando o botão "Atualizar" no painel real (jsdom)...');

  if (!JSDOM) {
    console.log('  ⏭️  [SKIP] jsdom não instalado (execute `npm install` para a validação em DOM real).');
    return;
  }

  // Backlog 3: a análise gráfica saiu do Dashboard e foi consolidada na
  // página dedicada de Relatórios (central única de gráficos do sistema).
  const htmlRelatorios = read('relatorios.html');
  // Mesma ordem de scripts de relatorios.html (basta o que o painel de gráficos usa).
  const fontes = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/supabase-client.js', 'js/pages/charts.js', 'js/pages/relatorios.js']
    .map((f) => ({ arquivo: f, codigo: read(f) }));

  const CARGAS_INICIAIS = [
    { id: 'CRG-1', status_fluxo: 'ARMAZENAGEM', natureza: 'Grãos', peso: 20, created_at: new Date(Date.now() - 86400000).toISOString() },
    { id: 'CRG-2', status_fluxo: 'ARMAZENAGEM', natureza: 'Grãos', peso: 30, created_at: new Date(Date.now() - 86400000).toISOString() }
  ];
  // O que o porto registrou enquanto o painel estava aberto (2 novas cargas
  // dentro do escopo visível do Estivador: armazenagem/recebimento).
  const CARGAS_NOVAS = CARGAS_INICIAIS.concat([
    { id: 'CRG-3', status_fluxo: 'ARMAZENAGEM', natureza: 'Contêiner', peso: 12, created_at: new Date().toISOString() },
    { id: 'CRG-4', status_fluxo: 'RECEBIMENTO_INSPECAO', natureza: 'Contêiner', peso: 15, created_at: new Date().toISOString() }
  ]);

  const estadoServidor = {
    indisponivel: false,
    tabelas: {
      cargas: CARGAS_INICIAIS,
      logs_alteracoes: [
        { data_hora: new Date(Date.now() - 3600000).toISOString(), cargo: 'ESTIVADOR', codigo_individual: 'COD-1', entidade_tipo: 'CARGA', entidade_id: 'CRG-1', tipo_alteracao: 'EDICAO' }
      ],
      navios: [],
      containers: [],
      manutencoes: [],
      bercos: [],
      funcionarios: [],
      visitantes: [],
      trail_decisoes: []
    }
  };

  const dom = new JSDOM(htmlRelatorios, { url: 'http://localhost:3000/relatorios.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const configsPorCanvas = {};

  win.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  win.Chart = class ChartFake {
    constructor(ctx, config) {
      const id = (ctx && ctx.canvas && ctx.canvas.id) || 'desconhecido';
      configsPorCanvas[id] = config;
    }
    destroy() {}
  };
  win.Chart.defaults = { font: {}, color: '' };

  // O cliente é criado pelo PRÓPRIO js/supabase-client.js (como na página real):
  // se aquele módulo falhar, window.nexusSupabase fica indefinido e o painel cai
  // no cache local — exatamente o sintoma relatado.
  const cliente = criarClienteFake(estadoServidor);
  win.supabase = { createClient: () => cliente };
  win.localStorage.setItem('SUPABASE_URL', 'https://exemplo.supabase.co');
  win.localStorage.setItem('SUPABASE_ANON_KEY', 'chave-publica-de-teste');

  // Cache local com dado ANTIGO: se o refresh ignorar o servidor, é isto que aparece.
  win.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([
    { id: 'CRG-ANTIGA', status: 'ARMAZENAGEM', tipo: 'Grãos', peso: '10 t', estivadorMatricula: 'MAT-1040' }
  ]));
  win.localStorage.setItem('nexus_audit_logs', JSON.stringify([
    { data_hora: new Date(Date.now() - 86400000).toISOString(), cargo: 'ESTIVADOR', codigo_individual: 'COD-1', entidade: 'CARGA CRG-ANTIGA', tipo_alteracao: 'EDICAO' }
  ]));
  win.document.cookie = 'nexus_session=' + encodeURIComponent(JSON.stringify({
    cargo: 'ESTIVADOR', nome: 'Operador Teste', codigo_individual: 'COD-1', matricula: 'MAT-1040'
  })) + '; path=/';

  fontes.forEach((f) => win.eval(f.codigo));
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  await espera(200);

  check(
    'O painel usa o cliente criado por js/supabase-client.js (window.nexusSupabase)',
    win.nexusSupabase === cliente
  );

  const configCargas = () => configsPorCanvas['nexusChart_minhas_cargas_status_1'];
  const totalCargas = () => {
    const cfg = configCargas();
    return cfg ? cfg.data.datasets[0].data.reduce((a, b) => a + b, 0) : null;
  };

  check(
    'A carga inicial já lê do servidor (não do cache local antigo)',
    totalCargas() === 2,
    `total plotado = ${totalCargas()} (esperado 2, o cache local tem 1 carga antiga)`
  );

  const leiturasCargasAntes = contarLeituras(cliente, 'cargas');

  // ---- Clique no botão "Atualizar" (sem recarregar a página) ----
  estadoServidor.tabelas.cargas = CARGAS_NOVAS;
  const botao = win.document.getElementById('chartsRefreshBtn');
  check('O botão #chartsRefreshBtn existe no painel', !!botao);

  botao.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await espera(250);

  const totalDepois = totalCargas();
  check(
    'Clique em "Atualizar" reflete o dado NOVO vindo do servidor (2 cargas → 4 cargas)',
    totalDepois === 4,
    `total plotado = ${totalDepois} (esperado 4)`
  );
  check(
    'O clique reconsulta o Supabase (a leitura não veio do cache em memória de 4s)',
    contarLeituras(cliente, 'cargas') > leiturasCargasAntes,
    `leituras de cargas: ${leiturasCargasAntes} → ${contarLeituras(cliente, 'cargas')}`
  );

  // Dois cliques seguidos: o cache de 4s não pode "engolir" a segunda atualização.
  estadoServidor.tabelas.cargas = CARGAS_INICIAIS;
  const leiturasAntesDoSegundoClique = contarLeituras(cliente, 'cargas');
  botao.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await espera(250);
  check(
    'Cliques seguidos (dentro do TTL de 4s) continuam indo ao servidor',
    contarLeituras(cliente, 'cargas') > leiturasAntesDoSegundoClique && totalCargas() === 2,
    `leituras: ${leiturasAntesDoSegundoClique} → ${contarLeituras(cliente, 'cargas')}, total plotado = ${totalCargas()}`
  );

  // ---- Servidor fora do ar: mantém o cache local e avisa a origem ----
  estadoServidor.indisponivel = true;
  botao.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await espera(300);

  check(
    'Servidor indisponível: o painel continua renderizado com o cache local',
    !!configCargas() && totalCargas() > 0,
    `total plotado = ${totalCargas()}`
  );
  const rodape = win.document.getElementById('chartsRoleFooter').textContent || '';
  check(
    'O rodapé informa a origem dos dados (servidor × cache local)',
    /cache local|servidor/i.test(rodape) && /atualizad/i.test(rodape),
    `rodapé = "${rodape}"`
  );
  const status = win.document.getElementById('chartsSyncStatus');
  check(
    'O painel dá feedback textual do resultado da atualização',
    !!status && String(status.textContent || '').length > 0,
    `status = "${status && status.textContent}"`
  );
  check(
    'O botão volta a ficar habilitado após a atualização (não trava em "carregando")',
    !!botao && botao.disabled === false
  );

  // ---- Servidor volta: a recarga manual reabre a tabela marcada como ausente ----
  estadoServidor.indisponivel = false;
  estadoServidor.tabelas.cargas = CARGAS_NOVAS;
  botao.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await espera(300);

  check(
    'Servidor de volta: o refresh manual reabre a tabela e volta a trazer dado do servidor',
    totalCargas() === 4,
    `total plotado = ${totalCargas()} (esperado 4 cargas do servidor)`
  );
  check(
    'O rodapé volta a indicar dados do servidor após a reconexão',
    /servidor/i.test(win.document.getElementById('chartsRoleFooter').textContent || ''),
    `rodapé = "${win.document.getElementById('chartsRoleFooter').textContent}"`
  );

  dom.window.close();
}

/* ================================================================== *
 * 4. Estático: o botão está ligado e o módulo expõe o relatório
 * ================================================================== */
function testarLigacaoEstatica() {
  console.log('\n3. Validando a ligação botão → módulo (código)...');
  const charts = read('js/pages/charts.js');
  const relatorios = read('js/pages/relatorios.js');
  const htmlRelatorio = read('relatorios.html');
  const htmlDashboard = read('dashboard.html');
  const dashboard = read('js/pages/dashboard.js');

  check(
    'relatorios.html tem o botão e o indicador de sincronia (central única de gráficos)',
    htmlRelatorio.includes('chartsRefreshBtn') && htmlRelatorio.includes('chartsSyncStatus')
  );
  check(
    'O módulo expõe uma recarga que ignora o cache (força leitura do servidor)',
    /atualizar:\s*function/.test(charts) && /forcar/.test(charts)
  );
  check(
    'NexusCharts.atualizar() devolve o resultado (origem dos dados + horário)',
    charts.includes('origem:') && /atualizadoEm/.test(charts)
  );
  check(
    'O clique é tratado de forma assíncrona, com feedback e reentrância bloqueada',
    relatorios.includes('chartsSyncStatus') && /await\s+window\.NexusCharts\.atualizar\(\)/.test(relatorios)
  );
  // Backlog 3 — remoção de gráficos duplicados: o Painel Geral NÃO renderiza mais
  // gráficos; a análise gráfica mora exclusivamente em Relatórios & PDF.
  check(
    'dashboard.html não tem mais o painel de gráficos nem o botão de atualização dos gráficos',
    !htmlDashboard.includes('chartsRolePanel') && !htmlDashboard.includes('chartsRoleGrid') && !htmlDashboard.includes('chartsRefreshBtn')
  );
  check(
    'dashboard.html não carrega mais a biblioteca Chart.js nem js/pages/charts.js',
    !htmlDashboard.includes('cdn.jsdelivr.net/npm/chart.js') && !htmlDashboard.includes('js/pages/charts.js')
  );
  check(
    'dashboard.js não inicializa mais gráficos (sem NexusCharts)',
    !dashboard.includes('NexusCharts')
  );
  check(
    'relatorios.html continua carregando os gráficos e o painel consolidado (central única)',
    htmlRelatorio.includes('js/pages/charts.js') && htmlRelatorio.includes('relatoriosChartsGrid')
  );
}

(async function main() {
  console.log('\n=== Gráficos: botão "Atualizar" traz dados novos do servidor? ===');
  testarClienteSupabase();
  await testarAtualizacaoDoPainel();
  testarLigacaoEstatica();

  console.log('\n' + '='.repeat(64));
  if (passed) {
    console.log('🎉 BOTÃO "ATUALIZAR" DOS GRÁFICOS VALIDADO COM SUCESSO! 🎉');
    console.log('='.repeat(64));
  } else {
    console.error('⚠️  FALHAS ENCONTRADAS — o refresh dos gráficos não está confiável.');
    console.error('='.repeat(64));
    process.exit(1);
  }
})();
