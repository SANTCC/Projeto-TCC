#!/usr/bin/env node
/**
 * Regressão — Tarefa 5 (Backlog Parte 2): histórico da entrega sem vínculo ativo.
 *
 * Ao virar ENTREGUE, a carga deve:
 *   - liberar navio_id/container_id ativos (local e no banco);
 *   - preservar navio/contêiner em navio_nome_historico /
 *     container_identificacao_historico;
 *   - continuar visível com esse histórico na tabela de entregues e no gráfico
 *     de embarcações utilizadas;
 *   - não ocupar mais o volume do contêiner.
 * Cargas entregues legadas ainda vinculadas são saneadas pelo mesmo caminho.
 *
 * Executar: node tests/test_backlog2_tarefa5_historico_entrega.js
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const H = require('./webmcp-harness');
const { read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');
const { criarTabelas } = require('../tools/screenshots/demo-data');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_ID = UUID(101);
const NAVIO_OUTRO_ID = UUID(102);
const CONTAINER_ID = UUID(201);
const janelas = [];

function registrar(janela) {
  janelas.push(janela);
  return janela;
}

function testarMigracaoESchema() {
  log('\n1. Migração e schema: snapshots, backfill e trigger de entrega');
  const migracao = read('supabase/migrations/20261012000000_cargas_historico_entrega.sql');
  const schema = read('SPECs/schema.sql');
  check('migração adiciona os dois snapshots em cargas',
    /add column if not exists navio_nome_historico text/i.test(migracao)
    && /add column if not exists container_identificacao_historico text/i.test(migracao));
  check('migração preenche o histórico das cargas já ENTREGUE antes de desvincular',
    /update public\.cargas c[\s\S]*?status_fluxo = 'ENTREGUE'[\s\S]*?update public\.cargas\s+set navio_id = null,\s+container_id = null/i.test(migracao));
  check('migração não libera vínculos de outros status',
    /where status_fluxo = 'ENTREGUE'\s+and \(navio_id is not null or container_id is not null\)/i.test(migracao));
  check('trigger do banco grava snapshot e libera vínculos ao entregar',
    /create or replace function public\.fn_propagar_status_navio\(\)[\s\S]*?navio_nome_historico = coalesce[\s\S]*?container_identificacao_historico = coalesce[\s\S]*?navio_id = null,\s+container_id = null/i.test(migracao));
  check('schema.sql acompanha as colunas e o trigger',
    /navio_nome_historico text,\s+container_identificacao_historico text/i.test(schema)
    && /update cargas c\s+set status_fluxo = 'ENTREGUE',[\s\S]*?navio_id = null,\s+container_id = null/i.test(schema));

  const tabelas = criarTabelas();
  const entregue = tabelas.cargas.find((c) => c.status_fluxo === 'ENTREGUE');
  check('dados de demonstração já nascem no novo formato',
    entregue && entregue.navio_id === null && entregue.container_id === null
    && entregue.navio_nome_historico === 'Navio Costa Leste'
    && entregue.container_identificacao_historico === 'DEMO0000005',
    JSON.stringify(entregue));
}

async function testarRepositorio() {
  log('\n2. Repositório: leitura e gravação preservam histórico sem vínculo ativo');
  const banco = criarBancoFalso({
    cargas: [
      {
        id: UUID(1), qr_code_url: 'QR-CRG-HIST-1', natureza: 'Geral', peso: 10, volume: 20,
        valor_declarado: 100, porto_descarga: 'Pátio STS-01', destino: 'Hamburgo',
        status_fluxo: 'ENTREGUE', container_id: CONTAINER_ID, navio_id: NAVIO_ID,
        navio_nome_historico: 'MV Histórico', container_identificacao_historico: 'MSCU1234567',
        navios: { id: NAVIO_ID, nome: 'MV Histórico' }, estivador_cargas: []
      },
      {
        id: UUID(2), qr_code_url: 'QR-CRG-ATIVA-1', natureza: 'Geral', peso: 5, volume: 10,
        valor_declarado: 50, porto_descarga: 'Pátio STS-01', destino: 'Hamburgo',
        status_fluxo: 'ARMAZENAGEM', container_id: CONTAINER_ID, navio_id: NAVIO_ID,
        navios: { id: NAVIO_ID, nome: 'MV Histórico' }, estivador_cargas: []
      },
      {
        id: UUID(9), qr_code_url: 'QR-CRG-SAVE-1', natureza: 'Geral', peso: 1, volume: 2,
        valor_declarado: 3, porto_descarga: 'Pátio STS-01', destino: 'Hamburgo',
        status_fluxo: 'EM_TRANSITO', container_id: CONTAINER_ID, navio_id: NAVIO_ID,
        navios: { id: NAVIO_ID, nome: 'MV Histórico' }, estivador_cargas: []
      }
    ]
  });
  const { w } = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    native(win) {
      win.nexusSupabase = banco;
      win.console.warn = () => {};
    },
    scripts: ['js/data-repository.js']
  }));

  const cargas = await w.NexusRepository.getCargas();
  const entregue = cargas.find((c) => c.id === 'CRG-HIST-1');
  const ativa = cargas.find((c) => c.id === 'CRG-ATIVA-1');
  check('ENTREGUE lida do banco não expõe vínculo ativo',
    entregue && entregue.navio === '' && entregue.navioId === null && entregue.navio_id === null
    && entregue.container === '' && entregue.container_id === null,
    JSON.stringify(entregue));
  check('ENTREGUE lida do banco expõe os snapshots históricos',
    entregue && entregue.navioNomeHistorico === 'MV Histórico'
    && entregue.navio_nome_historico === 'MV Histórico'
    && entregue.containerIdentificacaoHistorico === 'MSCU1234567'
    && entregue.container_identificacao_historico === 'MSCU1234567',
    JSON.stringify(entregue));
  check('carga ativa continua com os vínculos operacionais',
    ativa && ativa.navio === 'MV Histórico' && ativa.navioId === NAVIO_ID && ativa.container_id === CONTAINER_ID,
    JSON.stringify(ativa));

  await w.NexusRepository.saveCarga({
    id: 'CRG-SAVE-1', rawDbId: UUID(9), tipo: 'Geral', natureza: 'Geral', peso: '1 t',
    volume: '2 m³', valor: 'R$ 3,00', portoDescarga: 'Pátio STS-01', destino: 'Hamburgo',
    status: 'ENTREGUE', qrCode: 'QR-CRG-SAVE-1', navio: 'MV Save', container: 'MSCU-SAVE-1'
  });
  const salvaBanco = banco.tabelas.cargas.find((c) => c.id === UUID(9));
  check('saveCarga de ENTREGUE grava snapshot e libera vínculos no banco',
    salvaBanco && salvaBanco.status_fluxo === 'ENTREGUE' && salvaBanco.navio_id === null
    && salvaBanco.container_id === null && salvaBanco.navio_nome_historico === 'MV Save'
    && salvaBanco.container_identificacao_historico === 'MSCU-SAVE-1',
    JSON.stringify(salvaBanco));
  const salvaLocal = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]')
    .find((c) => c.id === 'CRG-SAVE-1');
  check('saveCarga normaliza também o cache local da entregue',
    salvaLocal && salvaLocal.navio === '' && salvaLocal.container === ''
    && salvaLocal.navioNomeHistorico === 'MV Save'
    && salvaLocal.containerIdentificacaoHistorico === 'MSCU-SAVE-1',
    JSON.stringify(salvaLocal));
}

async function carregarEmbarcacoes(banco, cargasLocais, containersLocais) {
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: containersLocais,
      nexus_guindastes_list: [], nexus_cargas_fluxo: cargasLocais
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
      },
      'js/vision-layer.js', 'js/layout.js',
      (win) => {
        win.mostrarFeedback = () => {};
        win.nexusConfirm = async () => true;
      },
      'js/padronizacao-codigos.js', 'js/pages/embarcacoes.js'
    ]
  }));
  await prontoDom(janela.w);
  await aguardar(500);
  return janela.w;
}

async function testarEmbarcacoes() {
  log('\n3. Embarcações & GPS: entrega nova e saneamento de entregue legada');
  const banco = criarBancoFalso({
    navios: [
      { id: NAVIO_ID, nome: 'Jaguar', numero_imo: 'IMO-1000001', localizacao: 'NO_PORTO_DE_DESTINO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Hamburgo' },
      { id: NAVIO_OUTRO_ID, nome: 'Outro Navio', numero_imo: 'IMO-1000002', localizacao: 'FORA_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Roterdã' }
    ],
    cargas: [
      { id: UUID(1), qr_code_url: 'QR-CRG-NOVA-1', status_fluxo: 'EM_TRANSITO', natureza: 'Geral', navio_id: NAVIO_ID, container_id: CONTAINER_ID },
      { id: UUID(2), qr_code_url: 'QR-CRG-LEGADA-1', status_fluxo: 'ENTREGUE', natureza: 'Geral', navio_id: NAVIO_ID, container_id: CONTAINER_ID },
      { id: UUID(3), qr_code_url: 'QR-CRG-OUTRA-1', status_fluxo: 'EM_TRANSITO', natureza: 'Geral', navio_id: NAVIO_OUTRO_ID, container_id: null }
    ],
    bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
  const containersLocais = [{
    id: CONTAINER_ID, rawDbId: CONTAINER_ID, identificacao: 'MSCU1234567',
    tipo: 'Carga Geral', estado: 'OPERANTE', navio_id: NAVIO_ID, navio: 'Jaguar'
  }];
  const w = await carregarEmbarcacoes(banco, [
    { id: 'CRG-NOVA-1', rawDbId: UUID(1), navio: 'Jaguar', navioId: NAVIO_ID, container: CONTAINER_ID, container_id: CONTAINER_ID, status: 'EM_TRANSITO' },
    { id: 'CRG-LEGADA-1', rawDbId: UUID(2), navio: 'Jaguar', navioId: NAVIO_ID, container: 'MSCU1234567', status: 'ENTREGUE' },
    { id: 'CRG-OUTRA-1', rawDbId: UUID(3), navio: 'Outro Navio', navioId: NAVIO_OUTRO_ID, container: '', status: 'EM_TRANSITO' }
  ], containersLocais);

  const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  const nova = locais.find((c) => c.id === 'CRG-NOVA-1') || {};
  const legada = locais.find((c) => c.id === 'CRG-LEGADA-1') || {};
  const outra = locais.find((c) => c.id === 'CRG-OUTRA-1') || {};
  check('nova entrega: status ENTREGUE sem navio/contêiner ativos',
    nova.status === 'ENTREGUE' && nova.navio === '' && nova.navioId === null && nova.navio_id === null
    && nova.container === '' && nova.container_id === null,
    JSON.stringify(nova));
  check('nova entrega: snapshots de navio e contêiner preservados',
    nova.navioNomeHistorico === 'Jaguar' && nova.navio_nome_historico === 'Jaguar'
    && nova.containerIdentificacaoHistorico === 'MSCU1234567'
    && nova.container_identificacao_historico === 'MSCU1234567',
    JSON.stringify(nova));
  check('entregue legada vinculada é saneada pelo mesmo caminho',
    legada.status === 'ENTREGUE' && legada.navio === '' && legada.navioId === null
    && legada.container === '' && legada.container_id === null
    && legada.navioNomeHistorico === 'Jaguar'
    && legada.containerIdentificacaoHistorico === 'MSCU1234567',
    JSON.stringify(legada));
  check('carga de outro navio não é entregue nem desvinculada',
    outra.status === 'EM_TRANSITO' && outra.navio === 'Outro Navio' && outra.navioId === NAVIO_OUTRO_ID,
    JSON.stringify(outra));

  const dbNova = banco.tabelas.cargas.find((c) => c.id === UUID(1)) || {};
  const dbLegada = banco.tabelas.cargas.find((c) => c.id === UUID(2)) || {};
  const dbOutra = banco.tabelas.cargas.find((c) => c.id === UUID(3)) || {};
  check('banco: nova entrega grava status, snapshots e vínculos nulos',
    dbNova.status_fluxo === 'ENTREGUE' && dbNova.navio_id === null && dbNova.container_id === null
    && dbNova.navio_nome_historico === 'Jaguar'
    && dbNova.container_identificacao_historico === 'MSCU1234567',
    JSON.stringify(dbNova));
  check('banco: entregue legada grava snapshots e vínculos nulos',
    dbLegada.status_fluxo === 'ENTREGUE' && dbLegada.navio_id === null && dbLegada.container_id === null
    && dbLegada.navio_nome_historico === 'Jaguar'
    && dbLegada.container_identificacao_historico === 'MSCU1234567',
    JSON.stringify(dbLegada));
  check('banco: carga de outro navio permanece intacta',
    dbOutra.status_fluxo === 'EM_TRANSITO' && dbOutra.navio_id === NAVIO_OUTRO_ID,
    JSON.stringify(dbOutra));
  const updates = banco.log.filter((l) => l.tabela === 'cargas' && l.op === 'update');
  check('updates remotos são por id e carregam o payload histórico',
    updates.length >= 2 && updates.every((u) => (u.filtros || []).some(([coluna]) => coluna === 'id'))
    && updates.some((u) => u.payload && u.payload.navio_nome_historico === 'Jaguar'
      && u.payload.container_identificacao_historico === 'MSCU1234567'
      && u.payload.navio_id === null && u.payload.container_id === null),
    JSON.stringify(updates));
}

async function testarCargas() {
  log('\n4. Cargas & Pátio: transição automática, tabela de entregues e volume liberado');
  const cargasIniciais = [
    {
      id: 'CRG-ENT-1', rawDbId: UUID(11), tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t',
      volume: '20 m³', status: 'EM_TRANSITO', container: 'CONT-TESTE-1', container_id: CONTAINER_ID,
      navio: '', navioId: null, herdarNavioDoContainer: true, destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
    },
    {
      id: 'CRG-ENT-LEGADA', rawDbId: UUID(12), tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t',
      volume: '60 m³', status: 'ENTREGUE', container: 'CONT-TESTE-1', navio: 'MV Legado',
      destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
    },
    {
      id: 'CRG-OCUPANTE', rawDbId: UUID(13), tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t',
      volume: '50 m³', status: 'ARMAZENAGEM', container: 'CONT-TESTE-1', navio: 'MV Local',
      destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
    },
    {
      id: 'CRG-ALVO', rawDbId: UUID(14), tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t',
      volume: '10 m³', status: 'ARMAZENAGEM', container: '', navio: '',
      destino: 'Hamburgo', portoDescarga: 'Pátio STS-01'
    }
  ];
  const atualizacoes = [];
  const repository = {
    async getCargas() { return cargasIniciais; },
    async getFuncionarios() { return []; },
    async getNavios() {
      return [
        { id: NAVIO_ID, nome: 'MV Teste', localizacao: 'NO_PORTO_DE_DESTINO', destino: 'Hamburgo', estado_operacional: 'OPERANTE' },
        { id: UUID(103), nome: 'MV Local', localizacao: 'DENTRO_DO_PORTO', destino: 'Hamburgo', estado_operacional: 'OPERANTE' }
      ];
    },
    invalidarLeiturasCargas() {},
    notifyChange() {}
  };
  const client = {
    from(tabela) {
      if (tabela === 'rotas_maritimas') return { select: () => Promise.resolve({ data: [], error: null }) };
      if (tabela === 'containers') {
        return {
          select: () => Promise.resolve({
            data: [{ id: CONTAINER_ID, numero_identificacao: 'CONT-TESTE-1', material_carregado: 'Carga Geral', estado: 'OPERANTE', navio_id: NAVIO_ID }],
            error: null
          })
        };
      }
      if (tabela === 'cargas') {
        return {
          update(payload) {
            atualizacoes.push(payload);
            return {
              in(coluna, ids) {
                return {
                  eq() { return this; },
                  select: async () => ({ data: (ids || []).map((id) => ({ id })), error: null })
                };
              }
            };
          }
        };
      }
      throw new Error(`Tabela inesperada: ${tabela}`);
    }
  };

  let w;
  const janela = registrar(criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: cargasIniciais,
      nexus_navios_list: [
        { id: NAVIO_ID, nome: 'MV Teste', localizacao: 'NO_PORTO_DE_DESTINO', destino: 'Hamburgo' },
        { id: UUID(103), nome: 'MV Local', localizacao: 'DENTRO_DO_PORTO', destino: 'Hamburgo' }
      ],
      nexus_containers_list: [{ id: CONTAINER_ID, rawDbId: CONTAINER_ID, identificacao: 'CONT-TESTE-1', navio_id: NAVIO_ID, navio: 'MV Teste', estado: 'OPERANTE' }],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.NexusRepository = repository;
        win.nexusSupabase = client;
        win.console.warn = () => {};
      },
      'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/padronizacao-codigos.js',
      'js/pages/cargas.js'
    ]
  }));
  w = janela.w;
  await prontoDom(w);
  await aguardar(350);

  const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  const entregue = locais.find((c) => c.id === 'CRG-ENT-1') || {};
  check('transição automática em Cargas preserva snapshots e libera vínculos',
    entregue.status === 'ENTREGUE' && entregue.navio === '' && entregue.navioId === null
    && entregue.container === '' && entregue.container_id === null
    && entregue.navioNomeHistorico === 'MV Teste'
    && entregue.containerIdentificacaoHistorico === 'CONT-TESTE-1',
    JSON.stringify(entregue));
  check('update remoto da transição carrega snapshots e vínculos nulos',
    atualizacoes.some((p) => p.status_fluxo === 'ENTREGUE' && p.navio_id === null && p.container_id === null
      && p.navio_nome_historico === 'MV Teste' && p.container_identificacao_historico === 'CONT-TESTE-1'),
    JSON.stringify(atualizacoes));

  const tabelaEntregues = w.document.getElementById('cargasEntreguesTableBody').textContent || '';
  check('tabela de entregues exibe contêiner/navio históricos',
    tabelaEntregues.includes('CONT-TESTE-1') && tabelaEntregues.includes('MV Teste'),
    tabelaEntregues.slice(0, 240));
  check('tabela de entregues não volta a mostrar "Desvinculado/Sem contêiner" para quem tem histórico',
    !tabelaEntregues.includes('Desvinculado') && !tabelaEntregues.includes('Sem contêiner'),
    tabelaEntregues.slice(0, 240));

  await w.abrirModalVinculacao('CRG-ALVO');
  await aguardar(80);
  const opcao = Array.from(w.document.querySelectorAll('#vincularContainerSelect option'))
    .find((o) => o.textContent.includes('CONT-TESTE-1'));
  check('volume de cargas ENTREGUE não ocupa mais o contêiner (50 m³ ativos de 75 m³)',
    !!opcao && opcao.textContent.includes('Disp: 25.0 m³'),
    opcao ? opcao.textContent : 'opção não encontrada');
}

async function testarGraficosEPdf() {
  log('\n5. Gráficos e PDF: histórico continua contando sem vínculo ativo');
  const { w } = registrar(criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    scripts: ['js/pages/charts.js']
  }));
  const spec = w.NexusCharts.construir('embarcacoes_utilizadas', {
    cargas: [{
      id: 'CRG-HIST-1', status: 'ENTREGUE', navio: '', navioId: null,
      navioNomeHistorico: 'MV Histórico', containerIdentificacaoHistorico: 'MSCU1234567'
    }],
    navios: [{ id: NAVIO_ID, nome: 'MV Histórico', operacoes: 0 }],
    containers: [], manutencoes: [], bercos: [], funcionarios: [], visitantes: [], logs: [], trail: []
  }, {});
  check('gráfico de embarcações utilizadas conta a entregue pelo navio histórico',
    spec && spec.labels[0] === 'MV Histórico' && spec.datasets[0].data[0] === 1,
    JSON.stringify(spec));
  const normalizada = w.NexusCharts.utils.normalizarCarga({
    id: 'CRG-HIST-2', status_fluxo: 'ENTREGUE', navio_id: null, container_id: null,
    navio_nome_historico: 'MV Banco', container_identificacao_historico: 'MSCU7654321'
  });
  check('normalização dos gráficos expõe histórico e nenhum vínculo ativo',
    normalizada.navioId === null && normalizada.navioNome === 'MV Banco'
    && normalizada.containerId === 'MSCU7654321'
    && normalizada.navioNomeHistorico === 'MV Banco'
    && normalizada.containerIdentificacaoHistorico === 'MSCU7654321',
    JSON.stringify(normalizada));

  const relatorio = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/relatorio-pdf/relatorio.js')).href);
  const modelo = relatorio.montarModelo({
    id: UUID(31), natureza: 'Geral', material: 'Madeira', quantidade: 1, peso: 10, volume: 20,
    valor_declarado: 100, destino: 'Hamburgo', porto_descarga: 'Hamburgo (DEHAM)',
    status_fluxo: 'ENTREGUE', resultado_inspecao: 'APROVADA', motivo_recusa: null,
    data_entrada: null, data_saida: null, containers: null, navios: null,
    navio_nome_historico: 'MV Histórico', container_identificacao_historico: 'MSCU1234567'
  });
  const textoSecoes = JSON.stringify(relatorio.secoesDoRelatorio(modelo));
  check('PDF usa snapshots quando os vínculos ativos já foram liberados',
    modelo.navio && modelo.navio.nome === 'MV Histórico'
    && modelo.container && modelo.container.numero_identificacao === 'MSCU1234567'
    && textoSecoes.includes('MV Histórico') && textoSecoes.includes('MSCU1234567')
    && !textoSecoes.includes('Carga sem navio vinculado por contêiner')
    && !textoSecoes.includes('Carga sem contêiner alocado'),
    JSON.stringify(modelo));
}

async function main() {
  try {
    testarMigracaoESchema();
    await testarRepositorio();
    await testarEmbarcacoes();
    await testarCargas();
    await testarGraficosEPdf();
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
