#!/usr/bin/env node
/**
 * Regressão — Tarefa 7 (Backlog Parte 2): volume do contêiner liberado após a entrega.
 *
 * Ciclo coberto:
 *   1. carga ativa de 50 m³ deixa 25 m³ livres (de 75 m³) e bloqueia uma nova
 *      alocação de 30 m³ no modal de vinculação;
 *   2. depois que a carga vira ENTREGUE (vínculo liberado na Tarefa 5), os
 *      mesmos 75 m³ voltam a ficar disponíveis e a nova carga é vinculada;
 *   3. a tabela de contêineres (Embarcações & GPS) não lista carga entregue —
 *      nem mesmo uma entregue legada que ainda traga a referência no cache;
 *   4. a disponibilidade calculada para o WebMCP segue a mesma regra.
 *
 * Executar: node tests/test_backlog2_tarefa7_volume_container_entrega.js
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

async function testarEmbarcacoes() {
  log('\n1. Embarcações & GPS: contêiner não lista carga entregue/cancelada');
  const banco = criarBancoFalso({
    navios: [], cargas: [], bercos: [],
    // O contêiner precisa existir no banco: a página só exibe o que está
    // persistido (o cache local deixou de ser fonte de registros).
    containers: [{
      id: CONT_ID, numero_identificacao: 'CONT-VOL-1', tipo_carga_id: null,
      material_carregado: 'Carga Geral', estado: 'OPERANTE', navio_id: null,
      qr_code_url: 'QR-CONT-VOL-1'
    }],
    guindastes: [], manutencoes: [], historico_manutencoes: []
  });
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_navios_list: [], nexus_bercos_list: [],
      nexus_containers_list: [{
        id: CONT_ID, rawDbId: CONT_ID, identificacao: 'CONT-VOL-1',
        tipo: 'Carga Geral', estado: 'OPERANTE', navio_id: null, navio: ''
      }],
      nexus_guindastes_list: [],
      nexus_cargas_fluxo: [
        { id: 'CRG-ATIVA-1', status: 'ARMAZENAGEM', container: 'CONT-VOL-1', volume: '50 m³', navio: '' },
        // Entregue legada: cache antigo ainda referencia o contêiner.
        { id: 'CRG-ENTREGUE-LEGADA', status: 'ENTREGUE', container: 'CONT-VOL-1', volume: '60 m³', navio: 'MV Antigo' },
        { id: 'CRG-CANCELADA-LEGADA', status: 'CANCELADA', container: 'CONT-VOL-1', volume: '10 m³', navio: '' }
      ]
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
  await aguardar(400);

  const tabela = w.document.getElementById('containersTableBody').textContent || '';
  check('carga ativa continua listada dentro do contêiner', tabela.includes('CRG-ATIVA-1'), tabela.slice(0, 240));
  check('carga ENTREGUE legada não aparece mais dentro do contêiner',
    !tabela.includes('CRG-ENTREGUE-LEGADA'), tabela.slice(0, 240));
  check('carga CANCELADA legada não aparece mais dentro do contêiner',
    !tabela.includes('CRG-CANCELADA-LEGADA'), tabela.slice(0, 240));
  check('página de embarcações sem erros de script', janela.erros.length === 0, janela.erros.join(' | '));
}

async function testarCicloCargas() {
  log('\n2. Cargas & Pátio: 50 m³ ocupados → entrega → 75 m³ livres e nova alocação');
  const cargaA = {
    id: 'CRG-VOL-A', rawDbId: UUID(21), tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t',
    volume: '50 m³', status: 'ARMAZENAGEM', container: 'CONT-VOL-1', container_id: CONT_ID,
    navio: 'MV Local', destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
  };
  const cargaB = {
    id: 'CRG-VOL-B', rawDbId: UUID(22), tipo: 'Carga Geral', natureza: 'Geral', peso: '8 t',
    volume: '30 m³', status: 'ARMAZENAGEM', container: '', navio: '',
    destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
  };
  let faseAtual = [cargaA, cargaB];
  const avisos = [];
  const banco = criarBancoFalso({
    containers: [{ id: CONT_ID, numero_identificacao: 'CONT-VOL-1', material_carregado: 'Carga Geral', estado: 'OPERANTE', navio_id: null }],
    cargas: [
      { id: UUID(21), qr_code_url: 'QR-CRG-VOL-A', status_fluxo: 'ARMAZENAGEM', container_id: CONT_ID },
      { id: UUID(22), qr_code_url: 'QR-CRG-VOL-B', status_fluxo: 'ARMAZENAGEM', container_id: null }
    ],
    navios: [], tipos_carga: [], rotas_maritimas: []
  });

  let w;
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: faseAtual, nexus_navios_list: [], nexus_containers_list: [], nexus_func_list: []
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getCargas: async () => faseAtual.map((c) => ({ ...c })),
          getFuncionarios: async () => [], getNavios: async () => [],
          invalidarLeiturasCargas() {}, notifyChange() {}
        };
        win.console.warn = () => {};
      },
      'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/padronizacao-codigos.js',
      'js/pages/cargas.js'
    ]
  }));
  w = janela.w;
  await prontoDom(w);
  await aguardar(300);
  w.mostrarFeedback = (tipo, titulo, msg) => avisos.push({ tipo, titulo, msg });

  const opcaoContainer = () => Array.from(w.document.querySelectorAll('#vincularContainerSelect option'))
    .find((o) => o.textContent.includes('CONT-VOL-1'));
  const locais = () => JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');

  // Fase 1: 50 m³ ocupados → 25 livres; 30 m³ não cabe.
  await w.abrirModalVinculacao('CRG-VOL-B');
  await aguardar(80);
  let opcao = opcaoContainer();
  check('antes da entrega: contêiner mostra 25,0 m³ livres de 75 m³',
    !!opcao && opcao.textContent.includes('Disp: 25.0 m³'), opcao ? opcao.textContent : 'opção ausente');
  w.document.getElementById('vincularContainerSelect').value = opcao.value;
  w.document.getElementById('confirmVincularModalBtn').click();
  await aguardar(120);
  check('antes da entrega: alocação de 30 m³ é bloqueada por capacidade',
    avisos.some((a) => a.titulo === 'Capacidade Excedida'), JSON.stringify(avisos));
  check('antes da entrega: carga nova continua sem contêiner',
    (locais().find((c) => c.id === 'CRG-VOL-B') || {}).container === '');

  // Entrega da carga A (estado que o repositório passa a devolver após a T5:
  // ENTREGUE, vínculos ativos liberados e histórico preservado).
  faseAtual = [
    {
      ...cargaA, status: 'ENTREGUE', container: '', container_id: null, navio: '', navioId: null,
      navioNomeHistorico: 'MV Local', containerIdentificacaoHistorico: 'CONT-VOL-1'
    },
    cargaB
  ];
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  await aguardar(400);

  // Fase 2: volume liberado → 75 livres; a mesma alocação agora é aceita.
  await w.abrirModalVinculacao('CRG-VOL-B');
  await aguardar(80);
  opcao = opcaoContainer();
  check('depois da entrega: contêiner volta a mostrar 75,0 m³ livres',
    !!opcao && opcao.textContent.includes('Disp: 75.0 m³'), opcao ? opcao.textContent : 'opção ausente');
  w.document.getElementById('vincularContainerSelect').value = opcao.value;
  w.document.getElementById('confirmVincularModalBtn').click();
  await aguardar(150);
  const bLocal = locais().find((c) => c.id === 'CRG-VOL-B') || {};
  check('depois da entrega: nova carga é vinculada ao contêiner liberado',
    bLocal.container === 'CONT-VOL-1' && bLocal.container_id === CONT_ID, JSON.stringify(bLocal));
  const bBanco = banco.tabelas.cargas.find((c) => c.id === UUID(22)) || {};
  check('depois da entrega: vínculo da nova carga persistido no banco',
    bBanco.container_id === CONT_ID, JSON.stringify(bBanco));
  check('página de cargas sem erros de script', janela.erros.length === 0, janela.erros.join(' | '));
}

function testarWebMcpDisponibilidade() {
  log('\n3. WebMCP: disponibilidade do contêiner ignora cargas entregues');
  const { w } = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/webmcp/webmcp-dados.js']
  }));
  const D = w.NexusWebMCPDados;
  const base = [
    { id: 'CRG-1', status: 'ARMAZENAGEM', container: 'CONT-VOL-1', volume: '50 m³' },
    { id: 'CRG-2', status: 'ENTREGUE', container: 'CONT-VOL-1', volume: '60 m³' },
    { id: 'CRG-3', status: 'CANCELADA', container: 'CONT-VOL-1', volume: '10 m³' }
  ];
  check('só a carga ativa ocupa: 75 − 50 = 25 m³ disponíveis',
    D.disponibilidadeContainer('CONT-VOL-1', base) === 25,
    String(D.disponibilidadeContainer('CONT-VOL-1', base)));
  const aposEntrega = base.map((c) => (c.id === 'CRG-1' ? { ...c, status: 'ENTREGUE' } : c));
  check('após entregar a última ativa: 75 m³ totalmente livres',
    D.disponibilidadeContainer('CONT-VOL-1', aposEntrega) === 75,
    String(D.disponibilidadeContainer('CONT-VOL-1', aposEntrega)));
}

async function main() {
  try {
    await testarEmbarcacoes();
    await testarCicloCargas();
    testarWebMcpDisponibilidade();
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
