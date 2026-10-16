#!/usr/bin/env node
/**
 * Regressão — Tarefa 6 (Backlog Parte 2): Arrumador e Consertador NÃO cadastra cargas.
 *
 * A atribuição do cargo é apenas marcar a carga como "pronta para entrega"
 * (Spec RF 1). O bloqueio vale nos três canais:
 *   1. matriz RBAC: ação CADASTRAR_CARGA sem ARRUMADOR_CONSERTADOR;
 *   2. tela (cargas.html): botão "Agendar Nova Carga" oculto, formulário nunca
 *      abre e o submit é recusado sem gravar nada (nem via envio programático);
 *   3. WebMCP: agendar_carga negado antes de qualquer confirmação.
 * O acesso de leitura à página e a ação "pronta para entrega" são preservados.
 *
 * Executar: node tests/test_backlog2_tarefa6_cadastro_cargas_cargo.js
 */
const H = require('./webmcp-harness');
const { read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const janelas = [];
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function registrar(janela) {
  janelas.push(janela);
  return janela;
}

/** Cliente Supabase genérico em memória: registra inserts e responde cadeias. */
function clienteGenerico(inserts, rotas) {
  function construir(tabela) {
    const estado = { insert: null };
    const resolver = () => {
      if (tabela === 'rotas_maritimas') return { data: rotas || [], error: null };
      if (estado.insert) {
        return { data: Object.assign({ id: UUID(900), created_at: new Date().toISOString() }, estado.insert), error: null };
      }
      return { data: [], error: null };
    };
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res) => Promise.resolve(resolver()).then(res);
        if (prop === 'catch') return (rej) => Promise.resolve(resolver()).catch(rej);
        if (typeof prop !== 'string') return undefined;
        return (...args) => {
          if (prop === 'insert') {
            estado.insert = args[0];
            inserts.push({ tabela, payload: args[0] });
          }
          return proxy;
        };
      }
    });
    return proxy;
  }
  return { from: (tabela) => construir(tabela) };
}

function testarMatrizRbac() {
  log('\n1. Matriz RBAC: CADASTRAR_CARGA sem Arrumador e Consertador');
  const esperado = {
    ESTIVADOR: true,
    CONFERENTE_CARGA: true,
    ARRUMADOR_CONSERTADOR: false,
    SUPERVISOR_GERENTE_OPERACOES: true,
    INSPETOR: true,
    DIRETOR_OPERACOES_LOGISTICA: true,
    DIRETOR_PRESIDENTE_SUPERINTENDENTE: true,
    CONSELHO_ADMINISTRACAO: true
  };
  for (const [cargo, pode] of Object.entries(esperado)) {
    const { w } = registrar(criarJanela({
      url: 'https://nexusport.test/cargas.html',
      session: sessao(cargo),
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
    }));
    check(`hasPermission('CADASTRAR_CARGA') = ${pode} para ${cargo}`,
      w.NexusAuth.hasPermission('CADASTRAR_CARGA') === pode);
  }

  const { w } = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    session: sessao('ARRUMADOR_CONSERTADOR'),
    scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
  }));
  check('Arrumador continua com acesso de leitura à página de cargas',
    w.NexusAuth.canAccessPage('cargas.html') === true);
  check('Arrumador continua com a sua ação própria (pronta para entrega)',
    w.NexusAuth.hasPermission('ALTERAR_PRONTA_ENTREGA') === true);
}

function abrirCargasUi(cargo, cargas) {
  const inserts = [];
  const avisos = [];
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao(cargo),
    storage: {
      nexus_cargas_fluxo: cargas, nexus_func_list: [], nexus_navios_list: [], nexus_containers_list: []
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = clienteGenerico(inserts, [{ origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }]);
        win.NexusRepository = {
          getCargas: async () => cargas.map((c) => ({ ...c })),
          getFuncionarios: async () => [], getNavios: async () => [],
          invalidarLeiturasCargas() {}, notifyChange() {}
        };
        win.mostrarFeedback = (tipo, titulo, msg) => avisos.push({ tipo, titulo, msg });
        win.console.warn = () => {};
      },
      'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/padronizacao-codigos.js',
      'js/pages/cargas.js'
    ]
  }));
  return { janela, w: janela.w, inserts, avisos };
}

async function testarInterface() {
  log('\n2. Tela de cargas: botão oculto, formulário fechado e submit recusado');
  // Backlog Parte 2 — Tarefa 9: a carga de exemplo está de fato pronta
  // (movimentação concluída até o contêiner: portoDescarga = "Contêiner CONT-1").
  const cargaPronta = [{
    id: 'CRG-PRONTA-1', tipo: 'Carga Geral', natureza: 'Geral', peso: '5 t', volume: '10 m³',
    status: 'ARMAZENAGEM', container: 'CONT-1', navio: 'Navio Teste', resultadoInspecao: 'APROVADA',
    destino: 'Hamburgo', portoDescarga: 'Contêiner CONT-1'
  }];

  const ar = abrirCargasUi('ARRUMADOR_CONSERTADOR', cargaPronta);
  await prontoDom(ar.w);
  await aguardar(250);
  // layout.js define o feedback real após os scripts nativos; o stub de
  // captura precisa ser (re)instalado depois da carga da página.
  ar.w.mostrarFeedback = (tipo, titulo, msg) => ar.avisos.push({ tipo, titulo, msg });
  const btnAr = ar.w.document.getElementById('toggleAgendamentoFormBtn');
  const formAr = ar.w.document.getElementById('agendamentoCargaForm');
  check('Arrumador: tela expõe a decisão de bloqueio (nexusPodeCadastrarCarga = false)',
    ar.w.nexusPodeCadastrarCarga() === false);
  check('Arrumador: botão "Agendar Nova Carga" fica oculto', btnAr.classList.contains('hidden'));
  btnAr.click();
  await aguardar(20);
  check('Arrumador: clique programático no botão não abre o formulário',
    formAr.classList.contains('hidden'));
  formAr.classList.remove('hidden');
  formAr.dispatchEvent(new ar.w.Event('submit', { bubbles: true, cancelable: true }));
  await aguardar(60);
  check('Arrumador: submit é recusado com "Acesso Negado"',
    ar.avisos.some((a) => a.titulo === 'Acesso Negado'), JSON.stringify(ar.avisos));
  check('Arrumador: nenhum insert em cargas/agendamentos partiu do submit',
    ar.inserts.filter((i) => i.tabela === 'cargas' || i.tabela === 'agendamentos').length === 0,
    JSON.stringify(ar.inserts.filter((i) => i.tabela === 'cargas' || i.tabela === 'agendamentos')));
  check('Arrumador: nenhuma carga nova entrou na lista local',
    JSON.parse(ar.w.localStorage.getItem('nexus_cargas_fluxo') || '[]').length === 1);
  check('Arrumador: ação própria "Marcar como pronta" continua disponível',
    !!ar.w.document.querySelector('#cargasTableBody [aria-label="Marcar como pronta"]'));
  check('Arrumador: página sem erros de script', ar.janela.erros.length === 0, ar.janela.erros.join(' | '));

  const sup = abrirCargasUi('SUPERVISOR_GERENTE_OPERACOES', cargaPronta);
  await prontoDom(sup.w);
  await aguardar(250);
  const btnSup = sup.w.document.getElementById('toggleAgendamentoFormBtn');
  const formSup = sup.w.document.getElementById('agendamentoCargaForm');
  check('Supervisor: tela expõe permissão de cadastro (nexusPodeCadastrarCarga = true)',
    sup.w.nexusPodeCadastrarCarga() === true);
  check('Supervisor: botão "Agendar Nova Carga" visível', !btnSup.classList.contains('hidden'));
  btnSup.click();
  await aguardar(20);
  check('Supervisor: clique abre o formulário de agendamento', !formSup.classList.contains('hidden'));
  check('Supervisor: página sem erros de script', sup.janela.erros.length === 0, sup.janela.erros.join(' | '));
}

async function testarWebMcp() {
  log('\n3. WebMCP: agendar_carga negado ao Arrumador, leitura preservada');
  const inserts = [];
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('ARRUMADOR_CONSERTADOR'),
    storage: {
      nexus_cargas_fluxo: [{
        id: 'CRG-LEITURA-1', tipo: 'Carga Geral', natureza: 'Geral', peso: '5 t', volume: '10 m³',
        valor: 'R$ 100,00', status: 'ARMAZENAGEM', container: 'CONT-1', navio: 'Navio Teste',
        qrCode: 'QR-CRG-LEITURA-1'
      }],
      nexus_containers_list: [], nexus_guindastes_list: [], nexus_guindaste_tarefas: []
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js',
      'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js',
      (win) => {
        win.nexusSupabase = clienteGenerico(inserts, [{ origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }]);
      },
      'js/webmcp/webmcp-core.js',
      (win) => {
        win.__pedidos = [];
        win.__resposta = true;
        win.NexusWebMCP.iniciar({
          confirmar: async (pedido) => { win.__pedidos.push(pedido); return true; }
        });
      },
      'js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js',
      'js/padronizacao-codigos.js', 'js/pages/cargas.js', 'js/webmcp/webmcp-cargas.js'
    ]
  }));
  const w = janela.w;
  await prontoDom(w);
  await aguardar(80);

  let r = await w.NexusWebMCP.executar('agendar_carga', {
    tipo: 'Carga Geral', peso: 1, volume: 1, valor: 1, natureza: 'Geral',
    porto_descarga: 'Pátio STS-01 (Setor B)', destino: 'Porto de Roterdã'
  });
  check('WebMCP agendar_carga: PERMISSAO_NEGADA para Arrumador e Consertador',
    r && r.ok === false && r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r).slice(0, 200));
  check('WebMCP agendar_carga: bloqueio ocorre antes de pedir confirmação',
    w.__pedidos.length === 0, JSON.stringify(w.__pedidos.length));
  check('WebMCP agendar_carga: nada foi inserido',
    inserts.filter((i) => i.tabela === 'cargas' || i.tabela === 'agendamentos').length === 0,
    JSON.stringify(inserts.filter((i) => i.tabela === 'cargas' || i.tabela === 'agendamentos')));

  r = await w.NexusWebMCP.executar('listar_cargas', {});
  check('WebMCP listar_cargas: leitura continua disponível ao Arrumador',
    r && r.ok === true, JSON.stringify(r).slice(0, 200));
  check('WebMCP: página sem erros de script', janela.erros.length === 0, janela.erros.join(' | '));
}

async function main() {
  try {
    testarMatrizRbac();
    await testarInterface();
    await testarWebMcp();
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach((j) => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
}

main();
