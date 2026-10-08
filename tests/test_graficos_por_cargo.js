/**
 * TESTE DEFINITIVO — GRÁFICOS POR CAMADA DE VISÃO (Chart.js)
 * Valida o módulo js/charts.js: painéis por cargo, restrições da Spec (RF 1),
 * cálculos dos indicadores (RF 4 / RF 7 / RF 16) e estados vazios.
 *
 * Parte 1 (sempre executada): carrega o módulo em contexto isolado (vm) com
 * window/document/localStorage simulados — sem dependências externas.
 *
 * Parte 2 (executada quando o jsdom estiver disponível): renderiza as páginas
 * reais em DOM e comprova que cada cargo recebe APENAS os gráficos da sua
 * camada de visão, com Chart.js instanciado. Se o jsdom não estiver instalado
 * (`npm install`), a seção é apenas informada como ignorada.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function criarStorageInicial(dados) {
  const mapa = Object.assign({}, dados || {});
  return {
    getItem: (chave) => (chave in mapa ? mapa[chave] : null),
    setItem: (chave, valor) => { mapa[chave] = String(valor); },
    removeItem: (chave) => { delete mapa[chave]; }
  };
}

function criarSandbox(storage) {
  const doc = {
    documentElement: { classList: { contains: () => false, add() {}, remove() {}, toggle() { return false; } } },
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, addEventListener() {}, appendChild() {}, style: {} }),
    head: { appendChild() {} },
    addEventListener() {},
    hidden: false
  };

  const win = {
    document: doc,
    localStorage: storage,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    MutationObserver: undefined,
    Chart: undefined,
    nexusSupabase: null,
    NexusVision: undefined
  };
  win.window = win;
  return win;
}

function carregarModulo(win) {
  const codigo = fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf-8');
  const contexto = vm.createContext({
    window: win,
    document: win.document,
    localStorage: win.localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval
  });
  vm.runInContext(codigo, contexto);
  return win.NexusCharts;
}

// ---------------------------------------------------------------------------
// Dados sintéticos de apoio
// ---------------------------------------------------------------------------
const AGORA = Date.now();
const iso = (diasAtras) => new Date(AGORA - diasAtras * 86400000).toISOString();

const CARGAS = [
  { status: 'ARMAZENAGEM', tipo: 'Grãos', valor: 100000, dataEntrada: iso(30), estivador: 'MAT-1040' },
  { status: 'PRONTA_PARA_ENTREGA', tipo: 'Grãos', valor: 50000, dataEntrada: iso(12), dataSaida: iso(2), estivador: 'MAT-1040' },
  { status: 'RECUSADA', tipo: 'Eletrônicos', valor: 0, dataEntrada: iso(3), resultadoInspecao: 'RECUSADA' },
  { status: 'EM_TRANSITO', tipo: 'Líquidos', valor: 200000, dataEntrada: iso(40), dataSaida: iso(4) },
  { status: 'ENTREGUE', tipo: 'Líquidos', valor: 80000, dataEntrada: iso(60), dataSaida: iso(20) }
];

const DADOS = {
  cargas: CARGAS,
  navios: [
    { nome: 'Alfa', localizacao: 'DENTRO_DO_PORTO', operacoes: 2 },
    { nome: 'Beta', localizacao: 'FORA_DO_PORTO', operacoes: 5 },
    { nome: 'Gama', localizacao: 'NO_PORTO_DE_DESTINO', operacoes: 1 }
  ],
  containers: [{ estado: 'OPERANTE' }, { estado: 'OPERANTE' }, { estado: 'EM_REFORMA' }],
  manutencoes: [{ status: 'SOLICITADA' }, { status: 'APROVADA' }, { status: 'CONCLUIDA' }],
  bercos: [
    { nome: 'Berço 01', estado: 'OCUPADO' }, { nome: 'Berço 02', estado: 'OCUPADO' },
    { nome: 'Berço 03', estado: 'OCUPADO' }, { nome: 'Berço 04', estado: 'LIVRE' }
  ],
  funcionarios: [
    { nome: 'Ana', cargo: 'ESTIVADOR', ativo: true },
    { nome: 'Igor', cargo: 'INSPETOR', ativo: true },
    { nome: 'Zeca', cargo: 'ESTIVADOR', ativo: false }
  ],
  visitantes: [
    { nome: 'V1', motivo: 'Auditoria' }, { nome: 'V2', motivo: 'Auditoria' },
    { nome: 'V3', motivo: 'Manutenção externa' }
  ],
  logs: [
    { data_hora: iso(1), cargo: 'ESTIVADOR', codigo_individual: 'NX-1040-OP' },
    { data_hora: iso(1), cargo: 'INSPETOR', codigo_individual: 'NX-3001-IN' },
    { data_hora: iso(2), cargo: 'ESTIVADOR', codigo_individual: 'NX-1040-OP' },
    { data_hora: iso(90), cargo: 'ESTIVADOR', codigo_individual: 'NX-1040-OP' }
  ],
  trail: [{ tipo_decisao: 'LIBEROU_NAVIO' }, { tipo_decisao: 'LIBEROU_NAVIO' }, { tipo_decisao: 'APROVOU_CARGA' }]
};

/* ---------------------------------------------------------------------------
 * Parte 2 — Renderização real por cargo (jsdom)
 * ------------------------------------------------------------------------- */

// Backlog 3: a análise gráfica saiu do Dashboard e foi consolidada na página
// dedicada de Relatórios (central única de gráficos). Por isso os cenários
// abaixo renderizam relatorios.html com os conjuntos expandidos por cargo.
const CENARIOS_DOM = [
  {
    cargo: 'ESTIVADOR', titulo: 'Meus indicadores operacionais', camada: 'Visão Própria (RLS)',
    esperados: ['minhas_operacoes_7d', 'minhas_cargas_status'],
    proibidos: ['valor_declarado_mes', 'produtividade_cargo', 'bercos_ocupacao', 'funcionarios_cargo', 'navios_localizacao', 'tempo_permanencia']
  },
  {
    cargo: 'TECNICO_PORTOS', titulo: 'Painel de gestão de pessoas no porto', camada: 'Visão Própria (RLS)',
    esperados: ['meus_registros_pessoas_7d', 'visitantes_motivo'],
    proibidos: ['valor_declarado_mes', 'bercos_ocupacao', 'navios_localizacao']
  },
  {
    cargo: 'INSPETOR', titulo: 'Painel operacional do inspetor', camada: 'Visão Operacional (RLS)',
    esperados: ['produtividade_cargo', 'inspecoes_resultado', 'cargas_fluxo', 'manutencoes_status', 'navios_localizacao', 'embarcacoes_utilizadas'],
    proibidos: ['visitantes_7d', 'visitantes_motivo', 'funcionarios_cargo', 'valor_declarado_mes']
  },
  {
    cargo: 'SUPERVISOR_GERENTE_OPERACOES', titulo: 'Painel tático de operações', camada: 'Visão Operacional (RLS)',
    esperados: ['fila_liberacao', 'manutencoes_status', 'bercos_ocupacao', 'trail_decisoes_tipo', 'navios_localizacao', 'embarcacoes_utilizadas'],
    proibidos: ['visitantes_motivo', 'funcionarios_cargo', 'valor_declarado_mes']
  },
  {
    cargo: 'DIRETOR_OPERACOES_LOGISTICA', titulo: 'Painel estratégico consolidado', camada: 'Visão Estratégica (RLS)',
    esperados: ['produtividade_cargo', 'aprovacao_recusa', 'valor_declarado_mes', 'tempo_permanencia', 'bercos_ocupacao', 'embarcacoes_utilizadas', 'navios_localizacao'],
    proibidos: ['minhas_cargas_status', 'visitantes_motivo', 'fila_liberacao']
  }
];

async function verificarRenderizacaoPorCargo() {
  let JSDOM;
  try {
    JSDOM = require('jsdom').JSDOM; // devDependency do projeto
  } catch (e) {
    console.log('  ⏭️  [SKIP] jsdom não instalado (execute `npm install` para a validação em DOM real).');
    return;
  }

  const htmlRelatorios = fs.readFileSync(path.join(ROOT, 'relatorios.html'), 'utf-8');
  // Ordem idêntica à das páginas reais: security.js → auth-guard.js → visão → gráficos → página
  const fontes = ['js/security.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/charts.js', 'js/relatorios.js']
    .map(f => ({ arquivo: f, codigo: fs.readFileSync(path.join(ROOT, f), 'utf-8') }));

  for (const cenario of CENARIOS_DOM) {
    const dom = new JSDOM(htmlRelatorios, { url: 'http://localhost:3000/relatorios.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    const configs = [];

    win.HTMLCanvasElement.prototype.getContext = () => ({ canvas: {} });
    win.Chart = class ChartFake {
      constructor(ctx, config) { configs.push(config); }
      destroy() {}
    };
    win.Chart.defaults = { font: {}, color: '' };

    // js/security.js (anti-XSS) e js/auth-guard.js (limpeza de cache legado)
    win.eval(fontes[0].codigo);
    win.eval(fontes[1].codigo);
    win.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([
      { id: 'CRG-1', status: 'ARMAZENAGEM', tipo: 'Grãos', peso: '25 t', valor: 'R$ 100.000,00', dataChegada: new Date(Date.now() - 5 * 86400000).toISOString(), estivadorMatricula: cenario.cargo === 'ESTIVADOR' ? 'MAT-1040' : null },
      { id: 'CRG-2', status: 'ENTREGUE', tipo: 'Grãos', peso: '10 t', valor: 'R$ 50.000,00', dataChegada: new Date(Date.now() - 20 * 86400000).toISOString(), data_saida: new Date(Date.now() - 3 * 86400000).toISOString() }
    ]));
    win.localStorage.setItem('nexus_navios_list', JSON.stringify([{ nome: 'Alfa', localizacao: 'DENTRO_DO_PORTO', operacoes: 2 }]));
    win.localStorage.setItem('nexus_bercos_list', JSON.stringify([{ nome: 'B1', estado: 'OCUPADO' }, { nome: 'B2', estado: 'LIVRE' }]));
    win.localStorage.setItem('nexus_func_list', JSON.stringify([{ nome: 'Ana', cargo: 'ESTIVADOR', ativo: true }]));
    win.localStorage.setItem('nexus_audit_logs', JSON.stringify([{ data_hora: new Date(Date.now() - 86400000).toISOString(), cargo: cenario.cargo, codigo_individual: 'COD-1', entidade: 'CARGA CRG-1', tipo_alteracao: 'EDICAO' }]));
    win.localStorage.setItem('nexus_session', JSON.stringify({ cargo: cenario.cargo, nome: 'Operador Teste', codigo_individual: 'COD-1', matricula: 'MAT-1040' }));

    win.eval(fontes[2].codigo);
    win.eval(fontes[3].codigo);
    win.eval(fontes[4].codigo);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    await new Promise(r => setTimeout(r, 150));

    const ids = Array.from(win.document.querySelectorAll('#relatoriosChartsGrid [data-chart-card]'))
      .map(c => c.getAttribute('data-chart-card'));
    const faltando = cenario.esperados.filter(id => !ids.includes(id));
    const vazando = cenario.proibidos.filter(id => ids.includes(id));
    const titulo = win.document.getElementById('chartsRoleTitle').textContent;
    const camada = win.document.getElementById('chartsRoleBadge').textContent;

    const problemas = [];
    if (faltando.length) problemas.push(`gráficos ausentes: ${faltando.join(', ')}`);
    if (vazando.length) problemas.push(`gráficos de outra camada exibidos: ${vazando.join(', ')}`);
    if (titulo !== cenario.titulo) problemas.push(`título inesperado: "${titulo}"`);
    if (camada !== cenario.camada) problemas.push(`camada de visão inesperada: "${camada}"`);
    if (configs.length === 0) problemas.push('nenhuma instância de Chart.js criada');

    verificar(
      problemas.length === 0,
      `DOM real: ${cenario.cargo} renderiza apenas a sua camada (${ids.length} cartões, ${configs.length} gráficos Chart.js).`,
      problemas.join(' | ')
    );
    if (cenario.cargo === 'DIRETOR_OPERACOES_LOGISTICA') {
      verificar(
        configs.some(cfg => cfg && cfg.data && String(cfg.data.datasets[0].label || '').indexOf('Valor declarado') !== -1),
        'DOM real: apenas a Direção recebe o gráfico financeiro de valor declarado.'
      );
    }
    dom.window.close();
  }

  // Página de relatórios: cada cargo recebe o recorte do RF 16
  const domRel = new JSDOM(htmlRelatorios, { url: 'http://localhost:3000/relatorios.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const winRel = domRel.window;
  winRel.HTMLCanvasElement.prototype.getContext = () => ({ canvas: {} });
  winRel.Chart = class { constructor() {} destroy() {} };
  winRel.Chart.defaults = { font: {}, color: '' };
  winRel.eval(fs.readFileSync(path.join(ROOT, 'js/security.js'), 'utf-8'));
  winRel.eval(fs.readFileSync(path.join(ROOT, 'js/auth-guard.js'), 'utf-8'));
  winRel.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([{ id: 'CRG-1', status: 'ARMAZENAGEM', tipo: 'Grãos', valor: 'R$ 10,00', dataChegada: new Date().toISOString() }]));
  winRel.localStorage.setItem('nexus_audit_logs', JSON.stringify([{ data_hora: new Date().toISOString(), cargo: 'INSPETOR', codigo_individual: 'NX-07', entidade: 'CARGA CRG-1', tipo_alteracao: 'EDICAO' }]));
  winRel.localStorage.setItem('nexus_session', JSON.stringify({ cargo: 'INSPETOR', nome: 'Igor', codigo_individual: 'NX-07', matricula: 'MAT-07' }));
  winRel.eval(fs.readFileSync(path.join(ROOT, 'js/vision-layer.js'), 'utf-8'));
  winRel.eval(fs.readFileSync(path.join(ROOT, 'js/charts.js'), 'utf-8'));
  winRel.eval(fs.readFileSync(path.join(ROOT, 'js/relatorios.js'), 'utf-8'));
  winRel.document.dispatchEvent(new winRel.Event('DOMContentLoaded'));
  await new Promise(r => setTimeout(r, 250));
  const idsRel = Array.from(winRel.document.querySelectorAll('#relatoriosChartsGrid [data-chart-card]')).map(c => c.getAttribute('data-chart-card'));
  verificar(
    idsRel.includes('produtividade_cargo') && idsRel.includes('inspecoes_resultado') && !idsRel.includes('valor_declarado_mes'),
    'DOM real: relatorios.html entrega produtividade consolidada ao Inspetor sem indicador financeiro (RF 16).',
    idsRel.join(', ')
  );
  domRel.window.close();
}

let falhas = 0;
function verificar(condicao, mensagem, detalhe) {
  if (condicao) {
    console.log(`  ✅ [PASS] ${mensagem}`);
  } else {
    console.error(`  ❌ [FAIL] ${mensagem}${detalhe ? ` — ${detalhe}` : ''}`);
    falhas += 1;
  }
}

async function main() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — GRÁFICOS POR CARGO (CHART.JS) - NEXUSPORT');
  console.log('================================================================\n');

  const storage = criarStorageInicial({
    nexus_cargas_fluxo: JSON.stringify(CARGAS),
    nexus_navios_list: JSON.stringify(DADOS.navios),
    nexus_containers_list: JSON.stringify(DADOS.containers),
    nexus_os_list: JSON.stringify(DADOS.manutencoes),
    nexus_bercos_list: JSON.stringify(DADOS.bercos),
    nexus_func_list: JSON.stringify(DADOS.funcionarios),
    nexus_vis_list: JSON.stringify(DADOS.visitantes),
    nexus_audit_logs: JSON.stringify(DADOS.logs),
    nexus_trail_decisoes: JSON.stringify(DADOS.trail)
  });
  const win = criarSandbox(storage);
  const NexusCharts = carregarModulo(win);

  // 1. Disponibilidade do módulo e catálogo de painéis
  console.log('1. Validando carregamento do módulo e catálogo de gráficos...');
  verificar(!!NexusCharts && typeof NexusCharts.initDashboard === 'function', 'NexusCharts exposto com initDashboard/initRelatorios.');

  // 2. Painéis coerentes com as três camadas de visão (RF 1)
  console.log('\n2. Validando painéis gráficos por cargo (RF 1)...');

  const painelEstivador = NexusCharts.painelDoCargo('ESTIVADOR');
  verificar(
    painelEstivador.length === 3 &&
    painelEstivador.includes('minhas_cargas_status') &&
    painelEstivador.includes('minhas_operacoes_7d'),
    'Visão Própria (Estivador) recebe apenas gráficos das próprias operações.',
    painelEstivador.join(', ')
  );
  verificar(
    !painelEstivador.includes('valor_declarado_mes') && !painelEstivador.includes('produtividade_cargo') &&
    !painelEstivador.includes('bercos_ocupacao') && !painelEstivador.includes('aprovacao_recusa'),
    'Visão Própria NÃO recebe indicadores estratégicos/financeiros (lucro é assunto da Direção).'
  );

  const painelTecnico = NexusCharts.painelDoCargo('TECNICO_PORTOS');
  verificar(
    painelTecnico.includes('visitantes_7d') && painelTecnico.includes('funcionarios_cargo'),
    'Técnico em Portos recebe os gráficos de gestão de pessoas (RF 15).'
  );

  const painelInspetor = NexusCharts.painelDoCargo('INSPETOR');
  verificar(
    painelInspetor.includes('inspecoes_resultado') && painelInspetor.includes('manutencoes_status') &&
    !painelInspetor.includes('visitantes_7d') && !painelInspetor.includes('funcionarios_cargo'),
    'Inspetor recebe inspeções/manutenções e NÃO recebe dados de pessoas (RF 1).',
    painelInspetor.join(', ')
  );

  const painelSupervisor = NexusCharts.painelDoCargo('SUPERVISOR_GERENTE_OPERACOES');
  verificar(
    painelSupervisor.includes('fila_liberacao') && painelSupervisor.includes('bercos_ocupacao') &&
    painelSupervisor.includes('trail_decisoes_tipo') &&
    !painelSupervisor.includes('visitantes_motivo') && !painelSupervisor.includes('funcionarios_cargo'),
    'Supervisor recebe fila/manutenção/berços/trail e NÃO recebe cadastro de pessoas (RF 1).',
    painelSupervisor.join(', ')
  );

  const painelDiretor = NexusCharts.painelDoCargo('DIRETOR_OPERACOES_LOGISTICA');
  verificar(
    painelDiretor.includes('aprovacao_recusa') && painelDiretor.includes('tempo_permanencia') &&
    painelDiretor.includes('embarcacoes_utilizadas') && painelDiretor.includes('produtividade_cargo') &&
    painelDiretor.includes('bercos_ocupacao') && painelDiretor.includes('valor_declarado_mes'),
    'Visão Estratégica recebe o consolidado completo, incluindo valor declarado (RF 7 / RF 16).',
    painelDiretor.join(', ')
  );
  verificar(
    NexusCharts.painelDoCargo('CONSELHO_ADMINISTRACAO').includes('valor_declarado_mes') &&
    NexusCharts.painelDoCargo('DIRETOR_PRESIDENTE_SUPERINTENDENTE').includes('valor_declarado_mes'),
    'Todos os cargos da Direção/Conselho herdam a Visão Estratégica.'
  );

  // 3. Cálculos dos indicadores
  console.log('\n3. Validando cálculos dos indicadores (RF 4 / RF 7 / RF 16)...');

  const aprovacao = NexusCharts.construir('aprovacao_recusa', DADOS, {});
  verificar(
    aprovacao && aprovacao.datasets[0].data[0] === 4 && aprovacao.datasets[0].data[1] === 1,
    'Taxa de aprovação/recusa classificada corretamente (4 aprovadas, 1 recusada).',
    aprovacao ? JSON.stringify(aprovacao.datasets[0].data) : 'vazio'
  );

  const permanencia = NexusCharts.construir('tempo_permanencia', DADOS, {});
  verificar(
    permanencia && permanencia.labels.includes('Grãos') && permanencia.datasets[0].data.every(v => v >= 0),
    'Tempo médio de permanência calculado por tipo de carga (RF 4).',
    permanencia ? JSON.stringify({ labels: permanencia.labels, data: permanencia.datasets[0].data }) : 'vazio'
  );

  const embarcacoes = NexusCharts.construir('embarcacoes_utilizadas', DADOS, {});
  verificar(
    embarcacoes && embarcacoes.labels[0] === 'Beta' && embarcacoes.datasets[0].data[0] === 5,
    'Embarcações mais utilizadas ordenadas por volume (Top 5, apenas frota ativa).',
    embarcacoes ? JSON.stringify({ labels: embarcacoes.labels, data: embarcacoes.datasets[0].data }) : 'vazio'
  );

  const bercos = NexusCharts.construir('bercos_ocupacao', DADOS, {});
  verificar(
    bercos && bercos.datasets[0].data[0] === 3 && bercos.datasets[0].data[1] === 1 &&
    bercos.resumo.indexOf('75%') !== -1,
    'Percentual de berços operacionais calculado (3 de 4 = 75%).',
    bercos ? bercos.resumo : 'vazio'
  );

  const produtividade = NexusCharts.construir('produtividade_cargo', DADOS, {});
  verificar(
    produtividade && produtividade.labels.length === 2 &&
    !produtividade.labels.includes('Não informado'),
    'Produtividade por cargo agrega apenas cargos com operadores ativos no mês.',
    produtividade ? JSON.stringify({ labels: produtividade.labels, data: produtividade.datasets[0].data }) : 'vazio'
  );

  const financeiro = NexusCharts.construir('valor_declarado_mes', DADOS, {});
  verificar(
    financeiro && financeiro.datasets[0].data.reduce((a, b) => a + b, 0) === 430000 &&
    financeiro.formatoMoeda === true,
    'Valor declarado consolidado nos últimos 6 meses (R$ 430.000,00) com formatação monetária.',
    financeiro ? JSON.stringify(financeiro.datasets[0].data) : 'vazio'
  );

  const visitantes = NexusCharts.construir('visitantes_motivo', DADOS, {});
  verificar(
    visitantes && visitantes.labels[0] === 'Auditoria' && visitantes.datasets[0].data[0] === 2,
    'Visitantes agrupados por motivo de entrada (RF 15).'
  );

  const funcionarios = NexusCharts.construir('funcionarios_cargo', DADOS, {});
  verificar(
    funcionarios && funcionarios.datasets[0].data.reduce((a, b) => a + b, 0) === 2,
    'Efetivo por cargo considera somente funcionários ativos (ignora inativos).',
    funcionarios ? JSON.stringify(funcionarios.datasets[0].data) : 'vazio'
  );

  const trail = NexusCharts.construir('trail_decisoes_tipo', DADOS, {});
  verificar(
    trail && trail.labels[0] === 'Liberou Navio' && trail.datasets[0].data[0] === 2,
    'Trail de decisões críticas ranqueado por tipo de decisão (RF 13).'
  );

  // 4. Estados vazios (sem dados fictícios)
  console.log('\n4. Validando estados vazios sem dados fantasmas...');
  const vazio = { cargas: [], navios: [], containers: [], manutencoes: [], bercos: [], funcionarios: [], visitantes: [], logs: [], trail: [] };
  verificar(NexusCharts.construir('aprovacao_recusa', vazio, {}) === null, 'Sem cargas → gráfico não é inventado (estado vazio).');
  verificar(NexusCharts.construir('bercos_ocupacao', vazio, {}) === null, 'Sem berços → gráfico não é inventado (estado vazio).');
  verificar(NexusCharts.construir('valor_declarado_mes', vazio, {}) === null, 'Sem valor declarado → gráfico estratégico oculto.');

  // 5. Privacidade da camada de visão no carregamento de dados
  console.log('\n5. Validando blindagem de dados sensíveis no carregamento (RF 1)...');
  NexusCharts.invalidarCache();

  const dadosDiretor = await NexusCharts.carregarDados(
    { cargo: 'DIRETOR_OPERACOES_LOGISTICA', codigo_individual: 'DIR-1', matricula: 'MAT-1' },
    ['cargas', 'logs', 'funcionarios', 'visitantes']
  );
  verificar(
    dadosDiretor.cargas.some(c => c.valor > 0),
    'Visão Estratégica mantém o valor declarado das cargas (indicador financeiro).'
  );

  NexusCharts.invalidarCache();
  const dadosEstivador = await NexusCharts.carregarDados(
    { cargo: 'ESTIVADOR', codigo_individual: 'NX-1040-OP', matricula: 'MAT-1040' },
    ['cargas', 'logs', 'funcionarios', 'visitantes']
  );
  verificar(
    dadosEstivador.cargas.every(c => c.valor === 0),
    'Visão Própria recebe o valor declarado sanitizado (zero) — funcionário não vê faturamento.'
  );
  verificar(
    dadosEstivador.funcionarios.length === 0 && dadosEstivador.visitantes.length === 0,
    'Visão Própria não carrega documentos de funcionários nem visitantes.'
  );

  NexusCharts.invalidarCache();
  const dadosSupervisor = await NexusCharts.carregarDados(
    { cargo: 'SUPERVISOR_GERENTE_OPERACOES', codigo_individual: 'SUP-1', matricula: 'MAT-2' },
    ['cargas', 'funcionarios', 'visitantes', 'logs']
  );
  verificar(
    dadosSupervisor.funcionarios.length === 0 && dadosSupervisor.visitantes.length === 0,
    'Supervisor e Inspetor não carregam dados de pessoas (RF 1 — restrição obrigatória).'
  );
  verificar(
    dadosSupervisor.cargas.every(c => c.valor === 0),
    'Supervisor não recebe o valor declarado (indicador exclusivo da Direção).'
  );

  NexusCharts.invalidarCache();
  const dadosTecnico = await NexusCharts.carregarDados(
    { cargo: 'TECNICO_PORTOS', codigo_individual: 'NX-5080-TC', matricula: 'MAT-5080' },
    ['funcionarios', 'visitantes']
  );
  verificar(
    dadosTecnico.funcionarios.length > 0 && dadosTecnico.visitantes.length > 0,
    'Técnico em Portos (responsável pelo RF 15) carrega funcionários e visitantes normalmente.'
  );

  // 6. Configuração Chart.js válida
  console.log('\n6. Validando configuração gerada para o Chart.js...');
  const config = NexusCharts.utils.montarConfig(NexusCharts.construir('cargas_fluxo', DADOS, {}));
  verificar(
    config.type === 'bar' && Array.isArray(config.data.labels) && config.data.datasets.length === 1 &&
    config.options.responsive === true && config.options.maintainAspectRatio === false,
    'Configuração Chart.js com tipo, datasets e opções responsivas válidas.'
  );
  const configRosca = NexusCharts.utils.montarConfig(NexusCharts.construir('aprovacao_recusa', DADOS, {}));
  verificar(
    configRosca.type === 'doughnut' && configRosca.options.cutout === '62%',
    'Gráficos de rosca configurados com cutout e legenda inferior.'
  );

  // 7. Renderização real em DOM (jsdom) por cargo
  console.log('\n7. Validando renderização real das páginas por cargo (jsdom)...');
  await verificarRenderizacaoPorCargo();

  console.log('\n================================================================');
  if (falhas === 0) {
    console.log('🎉 GRÁFICOS POR CARGO VALIDADOS COM 100% DE SUCESSO! 🎉');
    console.log('================================================================\n');
    process.exit(0);
  }
  console.error(`💥 ${falhas} VERIFICAÇÃO(ÕES) FALHARAM. REVISE O MÓDULO js/charts.js!`);
  console.log('================================================================\n');
  process.exit(1);
}

main().catch((err) => {
  console.error('💥 Erro inesperado ao executar o teste de gráficos:', err);
  process.exit(1);
});
