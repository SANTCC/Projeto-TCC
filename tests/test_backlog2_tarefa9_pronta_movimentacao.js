#!/usr/bin/env node
/**
 * Regressão — Tarefa 9 (Backlog Parte 2): "Pronta pra entrega" exige a
 * movimentação física concluída até o contêiner.
 *
 * O vínculo administrativo (modal Vincular) não basta: a carga precisa ter uma
 * movimentação de guindaste com destino "Contêiner <id>" CONCLUÍDA em
 * Embarcações & GPS, que grava portoDescarga = "Contêiner <id>". Sem isso, o
 * botão some (Arrumador/Inspetor), a ação é recusada com alerta específico e
 * o WebMCP responde MOVIMENTACAO_PENDENTE — para qualquer cargo.
 *
 * Executar: node tests/test_backlog2_tarefa9_pronta_movimentacao.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONT_ID = UUID(201);
const janelas = [];

function registrar(janela) {
  janelas.push(janela);
  return janela;
}

/** Cliente Supabase genérico em memória (cadeias resolvidas, inserts registrados). */
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

const BASE_CARGA = {
  id: 'CRG-T9', tipo: 'Carga Geral', natureza: 'Geral', volume: '10 m³',
  status: 'ARMAZENAGEM', container: 'CONT-1', navio: 'Navio Teste', resultadoInspecao: 'APROVADA'
};

async function abrirCargas(cargo, carga, extras) {
  const avisos = [];
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao(cargo),
    storage: Object.assign({ nexus_cargas_fluxo: [carga] }, extras || {}),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/padronizacao-codigos.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.console.warn = () => {};
      },
      'js/pages/cargas.js'
    ]
  }));
  const w = janela.w;
  await prontoDom(w);
  await aguardar(150);
  w.mostrarFeedback = (tipo, titulo, msg) => avisos.push({ tipo, titulo, msg });
  return { janela, w, avisos };
}

const statusSalvo = (w, id) => (JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]')
  .find((c) => c.id === id) || {}).status;
const temBotaoPronta = (w) => !!w.document.querySelector('#cargasTableBody [aria-label="Marcar como pronta"]');

async function testarTelaEAcao() {
  log('\n1. Tela/ação (Arrumador): só libera com a movimentação concluída');
  const casos = [
    {
      nome: 'vinculada mas nunca movimentada', permitido: false,
      carga: { ...BASE_CARGA, portoDescarga: 'Pátio STS-01 (Setor B)' },
      aviso: 'Movimentação até o Contêiner Pendente'
    },
    {
      nome: 'movimentação criada e ainda pendente', permitido: false,
      carga: { ...BASE_CARGA, portoDescarga: 'Pátio STS-01 (Setor B)', movimentacaoPendente: 'Contêiner CONT-1' },
      extras: { nexus_guindaste_tarefas: [{ id: 'TRF-T9', cargaId: 'CRG-T9', destino: 'Contêiner CONT-1' }] },
      aviso: 'Movimentação até o Contêiner Pendente'
    },
    {
      nome: 'movimentada para OUTRO contêiner', permitido: false,
      carga: { ...BASE_CARGA, portoDescarga: 'Contêiner CONT-OUTRO' },
      aviso: 'Movimentação até o Contêiner Pendente'
    },
    {
      nome: 'sem vínculo com contêiner', permitido: false,
      carga: { ...BASE_CARGA, container: '', navio: '', portoDescarga: 'Pátio STS-01 (Setor B)' },
      aviso: 'Vínculo Obrigatório'
    },
    {
      nome: 'movimentação concluída até o contêiner vinculado', permitido: true,
      carga: { ...BASE_CARGA, portoDescarga: 'Contêiner CONT-1' }
    }
  ];

  for (const caso of casos) {
    const { janela, w, avisos } = await abrirCargas('ARRUMADOR_CONSERTADOR', caso.carga, caso.extras);
    check(`Arrumador [${caso.nome}]: botão "Pronta" ${caso.permitido ? 'visível' : 'oculto'}`,
      temBotaoPronta(w) === caso.permitido);
    await w.executarAcaoCarga('CRG-T9', 'PRONTA');
    await aguardar(30);
    check(`Arrumador [${caso.nome}]: status ${caso.permitido ? 'vira PRONTA_PARA_ENTREGA' : 'permanece ARMAZENAGEM'}`,
      statusSalvo(w, 'CRG-T9') === (caso.permitido ? 'PRONTA_PARA_ENTREGA' : 'ARMAZENAGEM'),
      statusSalvo(w, 'CRG-T9'));
    if (!caso.permitido) {
      check(`Arrumador [${caso.nome}]: alerta "${caso.aviso}" exibido`,
        avisos.some((a) => a.titulo === caso.aviso), JSON.stringify(avisos));
    }
    check(`Arrumador [${caso.nome}]: sem erros de script`, janela.erros.length === 0, janela.erros.join(' | '));
  }

  log('\n2. Supervisão não pula a etapa física');
  const supBloqueado = await abrirCargas('SUPERVISOR_GERENTE_OPERACOES',
    { ...BASE_CARGA, portoDescarga: 'Pátio STS-01 (Setor B)' });
  await supBloqueado.w.executarAcaoCarga('CRG-T9', 'PRONTA');
  await aguardar(30);
  check('Supervisor: vinculada sem movimentação também é bloqueado',
    statusSalvo(supBloqueado.w, 'CRG-T9') === 'ARMAZENAGEM'
    && supBloqueado.avisos.some((a) => a.titulo === 'Movimentação até o Contêiner Pendente'),
    JSON.stringify(supBloqueado.avisos));

  const supLiberado = await abrirCargas('SUPERVISOR_GERENTE_OPERACOES',
    { ...BASE_CARGA, portoDescarga: 'Contêiner CONT-1' });
  await supLiberado.w.executarAcaoCarga('CRG-T9', 'PRONTA');
  await aguardar(30);
  check('Supervisor: com a movimentação concluída, marca pronta normalmente',
    statusSalvo(supLiberado.w, 'CRG-T9') === 'PRONTA_PARA_ENTREGA', statusSalvo(supLiberado.w, 'CRG-T9'));
}

async function testarCadeiaEmbarcacoes() {
  log('\n3. Cadeia real: concluir a movimentação em Embarcações destrava a Pronta');
  const banco = criarBancoFalso({
    navios: [], cargas: [], bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_navios_list: [], nexus_bercos_list: [],
      nexus_containers_list: [{
        id: CONT_ID, rawDbId: CONT_ID, identificacao: 'CONT-1',
        tipo: 'Carga Geral', estado: 'OPERANTE', navio_id: null, navio: ''
      }],
      nexus_guindastes_list: [{ id: 'GND-01', identificacao: 'GND-01', estado: 'OPERANTE' }],
      nexus_cargas_fluxo: [{
        ...BASE_CARGA, portoDescarga: 'Pátio STS-01 (Setor B)',
        movimentacaoPendente: 'Contêiner CONT-1', guindasteDesignado: 'GND-01'
      }],
      nexus_guindaste_tarefas: [{
        id: 'TRF-T9', cargaId: 'CRG-T9', guindasteId: 'GND-01',
        destino: 'Contêiner CONT-1', status: 'PENDENTE'
      }]
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => banco, notifyChange() {}, invalidarLeiturasCargas() {}
        };
        win.nexusConfirm = async () => true;
        win.console.warn = () => {};
      },
      'js/vision-layer.js', 'js/layout.js',
      (win) => { win.mostrarFeedback = () => {}; win.nexusConfirm = async () => true; },
      'js/padronizacao-codigos.js', 'js/pages/embarcacoes.js'
    ]
  }));
  const w = janela.w;
  await prontoDom(w);
  await aguardar(300);
  await w.concluirTarefaGuindaste('TRF-T9');
  await aguardar(60);
  const salva = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]')[0] || {};
  check('conclusão grava a evidência física (portoDescarga = "Contêiner CONT-1")',
    salva.portoDescarga === 'Contêiner CONT-1' && !salva.movimentacaoPendente,
    JSON.stringify({ portoDescarga: salva.portoDescarga, movimentacaoPendente: salva.movimentacaoPendente }));
  check('tarefa de guindaste é removida após a conclusão',
    JSON.parse(w.localStorage.getItem('nexus_guindaste_tarefas') || '[]').length === 0);

  // Com esse estado (o mesmo que a conclusão produziu), a Pronta destrava.
  const depois = await abrirCargas('ARRUMADOR_CONSERTADOR', salva);
  check('após a conclusão: botão "Pronta" aparece para o Arrumador', temBotaoPronta(depois.w) === true);
  await depois.w.executarAcaoCarga('CRG-T9', 'PRONTA');
  await aguardar(30);
  check('após a conclusão: carga vira PRONTA_PARA_ENTREGA',
    statusSalvo(depois.w, 'CRG-T9') === 'PRONTA_PARA_ENTREGA', statusSalvo(depois.w, 'CRG-T9'));
}

async function testarWebMcp() {
  log('\n4. WebMCP: marcar_pronta_entrega segue a mesma regra');
  const inserts = [];
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('ARRUMADOR_CONSERTADOR'),
    storage: {
      nexus_cargas_fluxo: [
        { ...BASE_CARGA, id: 'CRG-T9-SEM-MOV', portoDescarga: 'Pátio STS-01 (Setor B)' },
        { ...BASE_CARGA, id: 'CRG-T9-COM-MOV', portoDescarga: 'Contêiner CONT-1' }
      ],
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

  let r = await w.NexusWebMCP.executar('marcar_pronta_entrega', { id: 'CRG-T9-SEM-MOV' });
  check('WebMCP: vinculada sem movimentação → MOVIMENTACAO_PENDENTE',
    r && r.ok === false && r.codigo === 'MOVIMENTACAO_PENDENTE', JSON.stringify(r).slice(0, 220));
  check('WebMCP: bloqueio ocorre antes da confirmação do operador', w.__pedidos.length === 0);

  r = await w.NexusWebMCP.executar('marcar_pronta_entrega', { id: 'CRG-T9-COM-MOV' });
  check('WebMCP: com a movimentação concluída, a ação é executada',
    r && r.ok === true, JSON.stringify(r).slice(0, 220));
  check('WebMCP: status salvo vira PRONTA_PARA_ENTREGA',
    statusSalvo(w, 'CRG-T9-COM-MOV') === 'PRONTA_PARA_ENTREGA', statusSalvo(w, 'CRG-T9-COM-MOV'));
  check('WebMCP: página sem erros de script', janela.erros.length === 0, janela.erros.join(' | '));
}

async function testarHelper() {
  log('\n5. Decisão de alocação (variações de referência)');
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('ARRUMADOR_CONSERTADOR'),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/padronizacao-codigos.js',
      (win) => { win.currentUserSession = win.NexusAuth.getSession(); win.console.warn = () => {}; },
      'js/pages/cargas.js'
    ]
  }));
  const w = janela.w;
  await prontoDom(w);
  await aguardar(150);
  const alocada = w.nexusCargaAlocadaNoContainer;
  check('helper exposto pela página', typeof alocada === 'function');
  const casos = [
    [{ container: 'CONT-1', portoDescarga: 'Contêiner CONT-1' }, true, 'identificação textual'],
    [{ container_id: CONT_ID, portoDescarga: `Contêiner ${CONT_ID}` }, true, 'vínculo por UUID'],
    [{ container: 'CONT-1', portoDescarga: 'conteiner cont-1' }, true, 'sem acento/caixa baixa'],
    [{ container: 'CONT-1', portoDescarga: 'Pátio STS-01 (Setor B)' }, false, 'ainda no setor do pátio'],
    [{ container: 'CONT-1', portoDescarga: 'Contêiner CONT-2' }, false, 'movida para outro contêiner'],
    [{ container: '', container_id: null, portoDescarga: 'Contêiner CONT-1' }, false, 'sem vínculo atual'],
    [{ container: 'CONT-1' }, false, 'sem registro de destino']
  ];
  for (const [carga, esperado, nome] of casos) {
    check(`alocada = ${esperado} (${nome})`, alocada(carga) === esperado, JSON.stringify(carga));
  }
}

async function main() {
  try {
    await testarTelaEAcao();
    await testarCadeiaEmbarcacoes();
    await testarWebMcp();
    await testarHelper();
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
