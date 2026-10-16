#!/usr/bin/env node
/**
 * Regressão — Tarefa 2 (Correções): liberação de saída do navio exige TODAS as
 * cargas vinculadas em PRONTA_PARA_ENTREGA.
 *
 * Verifica:
 *  1. Liberação com tudo pronto: navio FORA_DO_PORTO; cargas PRONTA_PARA_ENTREGA
 *     vinculadas diretamente e via contêiner vão para EM_TRANSITO (banco e cache);
 *     carga finalizada (ENTREGUE, histórico) e carga de outro navio/contêiner livre
 *     não são tocadas.
 *  2. Carga não pronta vinculada via contêiner (banco) BLOQUEIA a saída e a
 *     mensagem lista id público + status atual.
 *  3. Múltiplas pendências (direta + via contêiner) são listadas; cache local
 *     desatualizado (PRONTA) não mascara o estado real do banco.
 *  4. Modo degradado: cargas conhecidas apenas pelo cache local também bloqueiam
 *     (vínculo direto por nome e vínculo por identificação de contêiner), e carga
 *     não pronta de contêiner LIVRE (outro navio) não bloqueia.
 *  5. WebMCP liberar_saida_navio: recusa com código CARGAS_NAO_PRONTAS antes da
 *     confirmação (nenhum pedido de confirmação) e libera quando tudo está pronto.
 *  6. Cargas & Pátio (transições automáticas): navio FORA_DO_PORTO só leva
 *     PRONTA_PARA_ENTREGA → EM_TRANSITO; ARMAZENAGEM/AGENDAMENTO não pulam etapa.
 *
 * Executar: node tests/test_liberacao_navio_cargas_prontas.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO = UUID(201);
const CONT_NAVIO = UUID(202);
const CONT_LIVRE = UUID(203);
const G1 = UUID(211);
const G2 = UUID(212);
const G3 = UUID(213);
const G4 = UUID(214);
const IMO = 'IMO-2000001';
const NOME_NAVIO = 'MV Prontinho';

/**
 * Banco base: navio atracado Santos → Roterdã (rota cadastrada, RN 9), um
 * contêiner vinculado ao navio e um contêiner livre; cargas:
 *  G1 PRONTA direta (navio_id)             → deve ir para EM_TRANSITO na saída
 *  G2 PRONTA via contêiner do navio        → deve ir para EM_TRANSITO na saída
 *  G3 ENTREGUE direta (histórico)          → nunca bloqueia nem muda
 *  G4 ARMAZENAGEM em contêiner LIVRE       → não pertence ao navio: não bloqueia
 * `opts.g1`/`opts.g2` permitem semear pendências.
 */
function bancoLiberacao(opts = {}) {
  return criarBancoFalso({
    navios: [
      { id: NAVIO, nome: NOME_NAVIO, numero_imo: IMO, localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã', data_saida: null }
    ],
    rotas_maritimas: [
      { id: UUID(1), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }
    ],
    containers: [
      { id: CONT_NAVIO, numero_identificacao: 'MSCU0000001', navio_id: NAVIO, estado: 'OPERANTE' },
      { id: CONT_LIVRE, numero_identificacao: 'MSCU0000002', navio_id: null, estado: 'OPERANTE' }
    ],
    cargas: [
      { id: G1, qr_code_url: 'QR-CRG-G1', status_fluxo: opts.g1 || 'PRONTA_PARA_ENTREGA', navio_id: NAVIO, container_id: null },
      { id: G2, qr_code_url: 'QR-CRG-G2', status_fluxo: opts.g2 || 'PRONTA_PARA_ENTREGA', navio_id: null, container_id: CONT_NAVIO },
      { id: G3, qr_code_url: 'QR-CRG-G3', status_fluxo: 'ENTREGUE', navio_id: NAVIO, container_id: null },
      { id: G4, qr_code_url: 'QR-CRG-G4', status_fluxo: 'ARMAZENAGEM', navio_id: null, container_id: CONT_LIVRE }
    ],
    bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

function storageBase(cargasCache) {
  return {
    nexus_navios_list: [],
    nexus_bercos_list: [],
    nexus_containers_list: [
      { id: CONT_NAVIO, rawDbId: CONT_NAVIO, identificacao: 'MSCU0000001', tipo: "Contêiner 20' Dry", estado: 'OPERANTE', navio: NOME_NAVIO, navio_id: NAVIO }
    ],
    nexus_guindastes_list: [],
    nexus_cargas_fluxo: cargasCache
  };
}

function cargasCachePadrao() {
  return [
    { id: 'CRG-G1', status: 'PRONTA_PARA_ENTREGA', navio: NOME_NAVIO, navio_id: NAVIO, rawDbId: G1, container: '', destino: 'Porto de Roterdã', peso: '10 t' },
    { id: 'CRG-G2', status: 'PRONTA_PARA_ENTREGA', navio: '', container: 'MSCU0000001', rawDbId: G2, destino: 'Porto de Roterdã', peso: '8 t' },
    // ENTREGUE legado ainda com vínculo ativo: histórico — não bloqueia a saída.
    { id: 'CRG-G3', status: 'ENTREGUE', navio: NOME_NAVIO, navio_id: NAVIO, container: '' }
  ];
}

const SETUP_NAVIOS = (banco) => (win) => {
  win.currentUserSession = win.NexusAuth.getSession();
  win.nexusSupabase = banco;
};

const FEEDBACKS = (win) => {
  win.__feedbacks = [];
  win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks.push({ tipo, titulo, msg }); };
  win.nexusConfirm = async () => true;
};

async function carregarEmbarcacoes(banco, cargasCache, opts = {}) {
  const scripts = [
    'js/security.js',
    'js/session-cookies.js',
    'js/supabase-client.js',
    'js/auth-guard.js',
    SETUP_NAVIOS(banco),
    'js/vision-layer.js',
    'js/layout.js',
    FEEDBACKS,
    'js/padronizacao-codigos.js',
    'js/pages/embarcacoes.js'
  ];
  if (opts.webmcp) {
    scripts.push(
      'js/webmcp/webmcp-core.js',
      (win) => {
        win.__pedidos = [];
        win.__resposta = true;
        win.NexusWebMCP.iniciar({
          confirmar: async (pedido) => { win.__pedidos.push(pedido); return win.__resposta; }
        });
      },
      'js/webmcp/webmcp-ui.js',
      'js/webmcp/webmcp-dados.js',
      'js/webmcp/webmcp-global.js',
      'js/webmcp/webmcp-embarcacoes.js'
    );
  }
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: storageBase(cargasCache),
    scripts
  });
  await prontoDom(janela.w);
  await aguardar(400);
  return janela.w;
}

const navioBanco = (banco) => banco.tabelas.navios.find((n) => n.numero_imo === IMO) || {};
const cargaBanco = (banco, id) => banco.tabelas.cargas.find((c) => c.id === id) || {};
const navioCache = (w) => (JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]').find((n) => n.imo === IMO) || {});
const cargaCache = (w, id) => (JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]').find((c) => c.id === id) || {});
const ultimoFeedback = (w) => (w.__feedbacks || []).slice(-1)[0] || {};
const feedbackCom = (w, titulo) => (w.__feedbacks || []).find((f) => f.titulo === titulo);

async function main() {
  // ------------------------------------------------------------------
  log('\n1. Saída com TODAS as cargas PRONTA_PARA_ENTREGA é liberada');
  {
    const banco = bancoLiberacao();
    const w = await carregarEmbarcacoes(banco, cargasCachePadrao());
    await w.liberarNavioPeloDiretor(IMO, { confirmado: true });
    await aguardar(200);

    check('navio FORA_DO_PORTO no banco com data_saida registrada',
      navioBanco(banco).localizacao === 'FORA_DO_PORTO' && Boolean(navioBanco(banco).data_saida),
      JSON.stringify(navioBanco(banco)));
    check('cache local reflete FORA_DO_PORTO', navioCache(w).localizacao === 'FORA_DO_PORTO', navioCache(w).localizacao);
    check('cargas prontas (direta G1 e via contêiner G2) foram para EM_TRANSITO no banco',
      cargaBanco(banco, G1).status_fluxo === 'EM_TRANSITO' && cargaBanco(banco, G2).status_fluxo === 'EM_TRANSITO',
      `G1=${cargaBanco(banco, G1).status_fluxo} G2=${cargaBanco(banco, G2).status_fluxo}`);
    check('carga ENTREGUE (histórico) e carga de contêiner livre não foram tocadas no banco',
      cargaBanco(banco, G3).status_fluxo === 'ENTREGUE' && cargaBanco(banco, G4).status_fluxo === 'ARMAZENAGEM',
      `G3=${cargaBanco(banco, G3).status_fluxo} G4=${cargaBanco(banco, G4).status_fluxo}`);
    check('cache: CRG-G1 e CRG-G2 (via contêiner) em EM_TRANSITO',
      cargaCache(w, 'CRG-G1').status === 'EM_TRANSITO' && cargaCache(w, 'CRG-G2').status === 'EM_TRANSITO',
      `CRG-G1=${cargaCache(w, 'CRG-G1').status} CRG-G2=${cargaCache(w, 'CRG-G2').status}`);
    check('cache: CRG-G3 (ENTREGUE, histórico) permanece ENTREGUE',
      cargaCache(w, 'CRG-G3').status === 'ENTREGUE', cargaCache(w, 'CRG-G3').status);
    check('feedback de sucesso e nenhum bloqueio',
      Boolean(feedbackCom(w, 'Navio Liberado')) && !feedbackCom(w, 'Liberação Bloqueada: Cargas Não Prontas'),
      JSON.stringify(ultimoFeedback(w)).slice(0, 160));
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n2. Carga não pronta vinculada VIA CONTÊINER bloqueia a saída (banco)');
  {
    const banco = bancoLiberacao({ g2: 'ARMAZENAGEM' });
    const cache = cargasCachePadrao();
    cache[1].status = 'ARMAZENAGEM';
    const w = await carregarEmbarcacoes(banco, cache);
    await w.liberarNavioPeloDiretor(IMO, { confirmado: true });
    await aguardar(150);

    const bloqueio = feedbackCom(w, 'Liberação Bloqueada: Cargas Não Prontas');
    check('saída bloqueada com mensagem clara', Boolean(bloqueio), JSON.stringify(ultimoFeedback(w)).slice(0, 160));
    check('mensagem lista a carga pendente (id público + status)',
      Boolean(bloqueio) && bloqueio.msg.includes('CRG-G2') && bloqueio.msg.includes('ARMAZENAGEM'),
      bloqueio ? bloqueio.msg : 'sem mensagem');
    check('navio continua DENTRO_DO_PORTO no banco (sem data_saida)',
      navioBanco(banco).localizacao === 'DENTRO_DO_PORTO' && !navioBanco(banco).data_saida,
      JSON.stringify(navioBanco(banco)));
    check('cache do navio não foi alterado', navioCache(w).localizacao === 'DENTRO_DO_PORTO', navioCache(w).localizacao);
    check('nenhuma carga foi movida: G1 segue PRONTA_PARA_ENTREGA no banco',
      cargaBanco(banco, G1).status_fluxo === 'PRONTA_PARA_ENTREGA', cargaBanco(banco, G1).status_fluxo);
    const pendentes = await w.nexusEmbarcacoesCargasPendentesLiberacao(IMO);
    check('interface pública lista exatamente a pendência CRG-G2 (ARMAZENAGEM)',
      Array.isArray(pendentes) && pendentes.length === 1 && pendentes[0].id === 'CRG-G2' && pendentes[0].status === 'ARMAZENAGEM',
      JSON.stringify(pendentes));
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n3. Múltiplas pendências são listadas; cache desatualizado não mascara o banco');
  {
    // Banco: G1 RECEBIMENTO_INSPECAO (direta) e G2 ARMAZENAGEM (via contêiner).
    // Cache local desatualizado diz que CRG-G1 está PRONTA — o banco prevalece.
    const banco = bancoLiberacao({ g1: 'RECEBIMENTO_INSPECAO', g2: 'ARMAZENAGEM' });
    const cache = cargasCachePadrao(); // CRG-G1 "PRONTA" (stale) no cache
    const w = await carregarEmbarcacoes(banco, cache);
    await w.liberarNavioPeloDiretor(IMO, { confirmado: true });
    await aguardar(150);

    const bloqueio = feedbackCom(w, 'Liberação Bloqueada: Cargas Não Prontas');
    check('bloqueio lista as duas pendências com id + status',
      Boolean(bloqueio) && bloqueio.msg.includes('2 carga(s)') &&
      bloqueio.msg.includes('CRG-G1') && bloqueio.msg.includes('RECEBIMENTO_INSPECAO') &&
      bloqueio.msg.includes('CRG-G2') && bloqueio.msg.includes('ARMAZENAGEM'),
      bloqueio ? bloqueio.msg : JSON.stringify(ultimoFeedback(w)).slice(0, 160));
    const pendentes = await w.nexusEmbarcacoesCargasPendentesLiberacao(IMO);
    check('interface pública devolve as 2 pendências com o estado do banco',
      Array.isArray(pendentes) && pendentes.length === 2 &&
      pendentes.some((p) => p.id === 'CRG-G1' && p.status === 'RECEBIMENTO_INSPECAO') &&
      pendentes.some((p) => p.id === 'CRG-G2' && p.status === 'ARMAZENAGEM'),
      JSON.stringify(pendentes));
    check('navio segue DENTRO_DO_PORTO e G1 não foi movida',
      navioBanco(banco).localizacao === 'DENTRO_DO_PORTO' && cargaBanco(banco, G1).status_fluxo === 'RECEBIMENTO_INSPECAO',
      `${navioBanco(banco).localizacao}/${cargaBanco(banco, G1).status_fluxo}`);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n4. Modo degradado: pendências só no cache local também bloqueiam');
  {
    // Banco todo pronto; o cache local tem duas cargas que o banco não conhece:
    // CRG-L9 (AGENDAMENTO, vínculo direto por nome) e CRG-L8 (RECEBIMENTO_INSPECAO,
    // vínculo pelo contêiner MSCU0000001 do navio).
    const banco = bancoLiberacao();
    const cache = cargasCachePadrao().concat([
      { id: 'CRG-L9', status: 'AGENDAMENTO', navio: NOME_NAVIO, container: '' },
      { id: 'CRG-L8', status: 'RECEBIMENTO_INSPECAO', navio: '', container: 'MSCU0000001' }
    ]);
    const w = await carregarEmbarcacoes(banco, cache);
    await w.liberarNavioPeloDiretor(IMO, { confirmado: true });
    await aguardar(150);

    const bloqueio = feedbackCom(w, 'Liberação Bloqueada: Cargas Não Prontas');
    check('bloqueio lista as cargas pendentes do cache (direta e via contêiner)',
      Boolean(bloqueio) && bloqueio.msg.includes('CRG-L9') && bloqueio.msg.includes('AGENDAMENTO') &&
      bloqueio.msg.includes('CRG-L8') && bloqueio.msg.includes('RECEBIMENTO_INSPECAO'),
      bloqueio ? bloqueio.msg : JSON.stringify(ultimoFeedback(w)).slice(0, 160));
    check('carga não pronta de contêiner LIVRE (CRG-G4, outro navio) NÃO entra na lista',
      Boolean(bloqueio) && !bloqueio.msg.includes('CRG-G4'), bloqueio ? bloqueio.msg : 'sem mensagem');
    const pendentes = await w.nexusEmbarcacoesCargasPendentesLiberacao(IMO);
    check('interface pública devolve as 2 pendências do cache',
      Array.isArray(pendentes) && pendentes.length === 2 &&
      pendentes.some((p) => p.id === 'CRG-L9') && pendentes.some((p) => p.id === 'CRG-L8'),
      JSON.stringify(pendentes));
    check('navio segue DENTRO_DO_PORTO no banco',
      navioBanco(banco).localizacao === 'DENTRO_DO_PORTO', navioBanco(banco).localizacao);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n5. WebMCP liberar_saida_navio: CARGAS_NAO_PRONTAS antes da confirmação');
  {
    const banco = bancoLiberacao({ g2: 'ARMAZENAGEM' });
    const w = await carregarEmbarcacoes(banco, cargasCachePadrao(), { webmcp: true });

    let r = await w.NexusWebMCP.executar('liberar_saida_navio', { imo: IMO });
    check('recusa com código CARGAS_NAO_PRONTAS citando a pendência',
      r.codigo === 'CARGAS_NAO_PRONTAS' && /CRG-G2/.test(r.mensagem || ''), JSON.stringify(r).slice(0, 220));
    check('nenhuma confirmação chega ao operador quando há pendência',
      w.__pedidos.length === 0, `${w.__pedidos.length} pedido(s)`);
    check('navio permanece DENTRO_DO_PORTO (banco e cache)',
      navioBanco(banco).localizacao === 'DENTRO_DO_PORTO' && navioCache(w).localizacao === 'DENTRO_DO_PORTO',
      `${navioBanco(banco).localizacao}/${navioCache(w).localizacao}`);

    // Coloca a carga pendente em PRONTA_PARA_ENTREGA: a liberação passa a valer.
    cargaBanco(banco, G2).status_fluxo = 'PRONTA_PARA_ENTREGA';
    r = await w.NexusWebMCP.executar('liberar_saida_navio', { imo: IMO });
    await aguardar(150);
    check('com tudo pronto: saída liberada (ok + FORA_DO_PORTO + 1 confirmação)',
      r.ok === true && navioBanco(banco).localizacao === 'FORA_DO_PORTO' &&
      navioCache(w).localizacao === 'FORA_DO_PORTO' && w.__pedidos.length === 1,
      JSON.stringify(r).slice(0, 220));
    check('cargas prontas (direta e via contêiner) foram para EM_TRANSITO no banco',
      cargaBanco(banco, G1).status_fluxo === 'EM_TRANSITO' && cargaBanco(banco, G2).status_fluxo === 'EM_TRANSITO',
      `G1=${cargaBanco(banco, G1).status_fluxo} G2=${cargaBanco(banco, G2).status_fluxo}`);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n6. Cargas & Pátio: navio FORA_DO_PORTO só leva PRONTA_PARA_ENTREGA → EM_TRANSITO');
  {
    const NAVIO_VIAJANTE = UUID(301);
    const cargasRepo = () => ([
      { id: 'CRG-L1', status: 'PRONTA_PARA_ENTREGA', navio: 'MV Viajante', container: '', peso: '10 t', destino: 'Porto de Roterdã' },
      { id: 'CRG-L2', status: 'ARMAZENAGEM', navio: 'MV Viajante', container: '', peso: '12 t', destino: 'Porto de Roterdã' },
      { id: 'CRG-L3', status: 'EM_TRANSITO', navio: 'MV Viajante', container: '', peso: '9 t', destino: 'Porto de Roterdã' },
      { id: 'CRG-L4', status: 'AGENDAMENTO', navio: 'MV Viajante', container: '', peso: '7 t', destino: 'Porto de Roterdã' }
    ]);
    const janela = criarJanela({
      url: 'https://nexusport.test/cargas.html',
      html: htmlDaPagina('cargas.html'),
      session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
      storage: {
        nexus_navios_list: [
          { id: NAVIO_VIAJANTE, nome: 'MV Viajante', imo: 'IMO-3000001', localizacao: 'FORA_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia: 10200, dataSaida: new Date().toISOString() }
        ],
        nexus_bercos_list: [],
        nexus_containers_list: [],
        nexus_guindastes_list: [],
        nexus_cargas_fluxo: []
      },
      scripts: [
        'js/security.js',
        'js/session-cookies.js',
        'js/auth-guard.js',
        'js/pages/tipos-carga.js',
        'js/vision-layer.js',
        'js/layout.js',
        (win) => {
          win.currentUserSession = win.NexusAuth.getSession();
          win.NexusRepository = {
            getCargas: async () => cargasRepo(),
            getNavios: async () => [],
            getFuncionarios: async () => [],
            getSupabase: () => null,
            notifyChange() {},
            invalidarLeiturasCargas() {}
          };
        },
        'js/padronizacao-codigos.js',
        'js/pages/cargas.js'
      ]
    });
    const w = janela.w;
    await prontoDom(w);
    await aguardar(500);

    const pos = (id) => cargaCache(w, id).status;
    check('PRONTA_PARA_ENTREGA vinculada ao navio fora do porto vai para EM_TRANSITO',
      pos('CRG-L1') === 'EM_TRANSITO', pos('CRG-L1'));
    check('ARMAZENAGEM NÃO pula para EM_TRANSITO (nenhuma via automática)',
      pos('CRG-L2') === 'ARMAZENAGEM', pos('CRG-L2'));
    check('EM_TRANSITO permanece EM_TRANSITO', pos('CRG-L3') === 'EM_TRANSITO', pos('CRG-L3'));
    check('AGENDAMENTO permanece AGENDAMENTO', pos('CRG-L4') === 'AGENDAMENTO', pos('CRG-L4'));
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 2 (liberação só com cargas prontas) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
