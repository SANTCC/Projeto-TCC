#!/usr/bin/env node
/**
 * Regressão (G1 — Backlog NexusPort): a ocupação do pátio é UM número só.
 *
 * Antes desta correção existiam dois números para o mesmo pátio:
 *   • o card "Ocupação do Pátio" do painel contava apenas status_fluxo === 'ARMAZENAGEM';
 *   • o bloqueio de capacidade do agendamento (Regra 2.9) contava AGENDAMENTO +
 *     RECEBIMENTO_INSPECAO + ARMAZENAGEM + PRONTA_PARA_ENTREGA.
 * Resultado: a carga movimentada para o contêiner (C2) liberava o painel mas continuava
 * segurando vaga no bloqueio, e o detalhamento do card não mostrava de onde vinha o número.
 *
 * Agora NexusRepository.calcularOcupacaoPatio é a fonte única, usada por:
 *   (1) o card e o detalhamento do painel (dashboard.html);
 *   (2) o agente (webmcp-dashboard: obter_resumo_operacional / detalhar_indicador);
 *   (3) o bloqueio de capacidade do agendamento (cargas.html, Regra 2.9) e a mensagem do C2.
 * Ocupam posição as cargas em RECEBIMENTO_INSPECAO e ARMAZENAGEM; PRONTA_PARA_ENTREGA já
 * liberou a posição (C2) e AGENDAMENTO ainda não chegou.
 *
 * Executar: node tests/test_g1_ocupacao_patio.js   (ou: npm run test:g1-ocupacao-patio)
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAPACIDADE = 100;

const OCUPANDO = {
  ARMAZENAGEM: 3,
  RECEBIMENTO_INSPECAO: 2,
  PRONTA_PARA_ENTREGA: 4,
  AGENDAMENTO: 2,
  EM_TRANSITO: 1,
  ENTREGUE: 1,
  CANCELADA: 1,
  RECUSADA: 1
};

/** Carga do banco (linha crua, como o PostgREST devolve). */
function cargaBanco(indice, status, setor) {
  const id = UUID(indice);
  const codigo = `CRG-2026-${String(indice).padStart(3, '0')}`;
  return {
    id,
    qr_code_url: `QR-${codigo}`,
    status_fluxo: status,
    natureza: 'Carga Geral',
    peso: 10,
    volume: 20,
    porto_descarga: setor || 'Pátio STS-01 (Setor B)',
    container_id: (status === 'PRONTA_PARA_ENTREGA' || status === 'ARMAZENAGEM') ? UUID(900) : null,
    navio_id: null,
    created_at: new Date().toISOString()
  };
}

/** Banco com as cargas do cenário base (5 ocupando, 7 fora do pátio). */
function bancoBase() {
  const cargas = [];
  let i = 1;
  Object.entries(OCUPANDO).forEach(([status, quantidade]) => {
    for (let n = 0; n < quantidade; n++) {
      const setor = n % 2 === 0 ? 'Pátio STS-01 (Setor B)' : 'Pátio STS-01 (Setor C)';
      cargas.push(cargaBanco(i++, status, setor));
    }
  });
  return criarBancoFalso({
    cargas,
    navios: [],
    manutencoes: [],
    containers: [{ id: UUID(900), numero_identificacao: 'MSCU1234567', estado: 'OPERANTE', navio_id: null }],
    rotas_maritimas: [{ id: UUID(800), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }],
    funcionarios: []
  });
}

/** Ocupação esperada do cenário base. */
const OCUPADOS_BASE = OCUPANDO.ARMAZENAGEM + OCUPANDO.RECEBIMENTO_INSPECAO; // 5

// ---------------------------------------------------------------------------
async function main() {
console.log('\n=== G1 — ocupação do pátio: um cálculo, três telas ===');

// ---------------------------------------------------------------------------
log('\n1. Módulo: a regra de ocupação (NexusRepository.calcularOcupacaoPatio)');
{
  const banco = bancoBase();
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = banco; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/data-repository.js'
    ]
  });
  await prontoDom(w);
  await aguardar(150);

  const repo = w.NexusRepository;
  check('existe o cálculo único de ocupação', repo && typeof repo.calcularOcupacaoPatio === 'function');
  check('a capacidade regulamentar é 100 posições (Regra 2.9)',
    repo.CAPACIDADE_PATIO === 100 && repo.calcularOcupacaoPatio([]).capacidade === 100, repo.CAPACIDADE_PATIO);
  check('a regra lista os status que ocupam posição do pátio (recebimento/inspeção + armazenagem)',
    JSON.stringify(repo.STATUS_OCUPA_PATIO) === JSON.stringify(['RECEBIMENTO_INSPECAO', 'ARMAZENAGEM']),
    JSON.stringify(repo.STATUS_OCUPA_PATIO));

  const ocupa = (status) => repo.statusOcupaPatio(status);
  check('ARMAZENAGEM ocupa', ocupa('ARMAZENAGEM') === true);
  check('RECEBIMENTO_INSPECAO ocupa (carga já no pátio, aguardando inspeção)', ocupa('RECEBIMENTO_INSPECAO') === true);
  check('PRONTA_PARA_ENTREGA NÃO ocupa (C2: já foi para o contêiner e liberou a posição)', ocupa('PRONTA_PARA_ENTREGA') === false);
  check('AGENDAMENTO NÃO ocupa (a carga ainda não chegou)', ocupa('AGENDAMENTO') === false);
  check('status fora do pátio não ocupam (saída, trânsito, entregue, cancelada, recusada)',
    ['SAIDA', 'EM_TRANSITO', 'ENTREGUE', 'CANCELADA', 'RECUSADA'].every((s) => ocupa(s) === false));
  check('a regra aceita a linha do banco (status_fluxo) e a da página (status)',
    repo.statusOcupaPatio({ status_fluxo: 'ARMAZENAGEM' }) === true && repo.statusOcupaPatio({ status: 'ARMAZENAGEM' }) === true);
  check('status desconhecido/vazio não ocupa', ocupa('') === false && ocupa(undefined) === false && ocupa('INVENTADO') === false);

  const doBanco = await repo.getCargas();
  const patio = repo.calcularOcupacaoPatio(doBanco);
  check(`conta as ${OCUPADOS_BASE} cargas que ocupam o pátio (de ${Object.values(OCUPANDO).reduce((a, b) => a + b, 0)} no banco)`,
    patio.ocupados === OCUPADOS_BASE, JSON.stringify({ ocupados: patio.ocupados, capacidade: patio.capacidade }));
  check('informa as posições livres', patio.livres === CAPACIDADE - OCUPADOS_BASE, patio.livres);
  check('taxa em % arredondada sobre a capacidade', patio.taxa === Math.round((OCUPADOS_BASE / CAPACIDADE) * 100), patio.taxa);
  check('agrupa a ocupação por setor do pátio', patio.porSetor['Pátio STS-01 (Setor B)'] === 3 && patio.porSetor['Pátio STS-01 (Setor C)'] === 2,
    JSON.stringify(patio.porSetor));
  check('a lista do detalhamento traz exatamente as cargas que ocupam', patio.lista.length === OCUPADOS_BASE
    && patio.lista.every((c) => repo.statusOcupaPatio(c)), patio.lista.map((c) => c.id).slice(0, 3));

  const indicadores = await repo.buscarIndicadoresOperacionais();
  const resumoDe = (p) => JSON.stringify({ c: p.capacidade, o: p.ocupados, l: p.livres, t: p.taxa, s: p.porSetor });
  check('os indicadores usam o MESMO cálculo (card, agente e bloqueio não podem divergir)',
    resumoDe(indicadores.ocupacaoPatio) === resumoDe(patio), resumoDe(indicadores.ocupacaoPatio));
  check('o detalhamento usado pelos indicadores é o mesmo conjunto de cargas ocupantes',
    (indicadores.ocupacaoPatio.lista || []).map((c) => c.codigo).join(',')
      === patio.lista.map((c) => c.codigo).join(','),
    (indicadores.ocupacaoPatio.lista || []).map((c) => c.codigo).join(','));

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
log('\n2. Painel: card e detalhamento mostram a ocupação do banco');
{
  const banco = bancoBase();
  let w;
  // A reserva local diz outra coisa (3 cargas): se o painel usasse o cache do navegador,
  // o card mostraria 3% — a ocupação precisa vir dos dados compartilhados.
  const janela = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: [
        { id: 'CRG-LOCAL-1', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)' },
        { id: 'CRG-LOCAL-2', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)' },
        { id: 'CRG-LOCAL-3', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)' }
      ]
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = banco; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/vision-layer.js',
      'js/layout.js',
      'js/data-repository.js',
      'js/pages/dashboard.js'
    ]
  });
  await prontoDom(w);
  await aguardar(400);

  const card = w.document.getElementById('cardOcupacaoPatioVal');
  check('o card mostra ocupados/capacidade e a taxa do banco (não do cache local)',
    card && card.textContent === `${Math.round((OCUPADOS_BASE / CAPACIDADE) * 100)}% (${OCUPADOS_BASE}/${CAPACIDADE})`,
    card && card.textContent);

  await w.detalharCardOperacional('OCUPACAO_PATIO');
  await aguardar(250);
  const modal = w.document.getElementById('cardDetailModal');
  const titulo = w.document.getElementById('modalCardTitle').textContent;
  const detalhe = w.document.getElementById('modalCardDetailContent').textContent;

  check('o detalhamento abre com o título do pátio', !modal.classList.contains('hidden') && /Ocupação do Pátio/.test(titulo), titulo);
  check('o detalhamento informa capacidade, ocupadas e livres',
    detalhe.includes(`${CAPACIDADE} posições`) && detalhe.includes(`Posições ocupadas: ${OCUPADOS_BASE}`) && detalhe.includes(`Posições livres: ${CAPACIDADE - OCUPADOS_BASE}`),
    detalhe.split('\n').slice(0, 3));
  check('o detalhamento mostra a ocupação por setor',
    detalhe.includes('Pátio STS-01 (Setor B): 3 carga(s)') && detalhe.includes('Pátio STS-01 (Setor C): 2 carga(s)'));
  check('o detalhamento lista as cargas que ocupam o pátio (com status e setor)',
    detalhe.includes('CRG-2026-001: ARMAZENAGEM — Pátio STS-01 (Setor B)'), detalhe.split('\n').find((l) => /CRG-2026-001/.test(l)));
  check('carga PRONTA_PARA_ENTREGA NÃO aparece como ocupante do pátio', !/PRONTA_PARA_ENTREGA/.test(detalhe.split('A posição é liberada')[0]));
  check('o detalhamento explica quando a posição é liberada',
    /movimentada para o contêiner vinculado/.test(detalhe));

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
log('\n3. Regra 2.9 no agendamento: o MESMO número decide o bloqueio');
{
  // Banco LOTADO (100 posições ocupadas) e cache local vazio: se o bloqueio olhasse só o
  // cache, o agendamento passaria com o pátio cheio.
  const cargas = [];
  for (let i = 1; i <= CAPACIDADE; i++) cargas.push(cargaBanco(i, i % 2 ? 'ARMAZENAGEM' : 'RECEBIMENTO_INSPECAO'));
  for (let i = 1; i <= 4; i++) cargas.push(cargaBanco(200 + i, 'PRONTA_PARA_ENTREGA'));
  const bancoCheio = criarBancoFalso({
    cargas,
    navios: [],
    manutencoes: [],
    rotas_maritimas: [{ id: UUID(800), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }],
    funcionarios: []
  });

  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_cargas_fluxo: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_guindaste_tarefas: [], nexus_func_list: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = bancoCheio; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => { win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); }; },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/cargas.js'
    ]
  });
  await prontoDom(w);
  await aguardar(400);

  async function agendar(w) {
    const doc = w.document;
    const form = doc.getElementById('agendamentoCargaForm');
    form.classList.remove('hidden');
    doc.getElementById('agTipoCarga').value = "Contêiner 20' Dry";
    doc.getElementById('agPeso').value = '12.5';
    doc.getElementById('agVolume').value = '40';
    doc.getElementById('agValor').value = '150000';
    doc.getElementById('agNatureza').value = 'Agrícola';
    doc.getElementById('agPortoDescarga').value = 'Pátio STS-01 (Setor B)';
    const agDestino = doc.getElementById('agDestino');
    await aguardar(200);
    agDestino.value = Array.from(agDestino.options).filter((o) => o.value !== '')[0].value;
    form.dispatchEvent(new w.Event('submit'));
    await aguardar(300);
    return (w.__feedbacks || []).slice(-1)[0] || {};
  }

  const fbCheio = await agendar(w);
  check('pátio cheio (100 ocupadas no banco, cache local vazio) bloqueia o agendamento',
    fbCheio.titulo === 'Capacidade Máxima do Pátio Excedida', fbCheio.titulo);
  check('a mensagem do bloqueio usa o número do cálculo único (100 posições ativas)',
    /100 posições ativas/.test(fbCheio.msg || ''), fbCheio.msg);
  const espelhoCheio = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  check('nada foi agendado com o pátio cheio (nenhuma carga nova, nenhum AGENDAMENTO)',
    espelhoCheio.filter((c) => c.status === 'AGENDAMENTO').length === 0 && bancoCheio.tabelas.cargas.length === cargas.length,
    JSON.stringify({ espelho: espelhoCheio.length, banco: bancoCheio.tabelas.cargas.length }));
  janela.dom.window.close();

  // Banco com folga: 37 ocupadas e 60 PRONTA_PARA_ENTREGA (que NÃO seguram posição).
  const cargasFolga = [];
  for (let i = 1; i <= 37; i++) cargasFolga.push(cargaBanco(i, 'ARMAZENAGEM'));
  for (let i = 1; i <= 60; i++) cargasFolga.push(cargaBanco(300 + i, 'PRONTA_PARA_ENTREGA'));
  const bancoFolga = criarBancoFalso({
    cargas: cargasFolga,
    navios: [],
    manutencoes: [],
    rotas_maritimas: [{ id: UUID(800), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }],
    funcionarios: []
  });

  let w2;
  const janela2 = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_cargas_fluxo: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_guindaste_tarefas: [], nexus_func_list: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { w2 = win; win.nexusSupabase = bancoFolga; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => { win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); }; },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/cargas.js'
    ]
  });
  await prontoDom(w2);
  await aguardar(400);

  const fbFolga = await agendar(w2);
  const listaLocal = JSON.parse(w2.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  const agendadas = listaLocal.filter((c) => c.status === 'AGENDAMENTO');
  check('com 37 posições ocupadas e 60 cargas PRONTA_PARA_ENTREGA (já nos contêineres) o agendamento passa',
    fbFolga.titulo !== 'Capacidade Máxima do Pátio Excedida', fbFolga.titulo);
  check('a carga agendada entra com status AGENDAMENTO', agendadas.length === 1 && /^CRG-2026-\d{3}$/.test(agendadas[0].id),
    JSON.stringify(agendadas.map((c) => c.id)));
  // O dublê guarda a MESMA referência da lista: comparar comprimentos não diz nada depois
  // do insert. O que importa é a carga nova existir no banco compartilhado.
  const noBancoFolga = bancoFolga.tabelas.cargas.filter((c) => c.status_fluxo === 'AGENDAMENTO');
  check('o agendamento foi gravado no banco compartilhado', noBancoFolga.length === 1,
    JSON.stringify({ total: bancoFolga.tabelas.cargas.length, agendadas: noBancoFolga.length }));
  check('a ocupação do pátio informada pelo cálculo segue 37 (a nova carga ainda não chegou)',
    (await w2.NexusRepository.buscarIndicadoresOperacionais()).ocupacaoPatio.ocupados === 37);
  janela2.dom.window.close();
}

// ---------------------------------------------------------------------------
log('\n4. Agente (dashboard): o resumo e o detalhamento operam sobre o mesmo número');
{
  const banco = bancoBase();
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = banco; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/vision-layer.js',
      'js/layout.js',
      'js/data-repository.js',
      'js/pages/dashboard.js',
      'js/webmcp/webmcp-core.js',
      (win) => { win.NexusWebMCP.iniciar({ confirmar: async () => true }); },
      'js/webmcp/webmcp-ui.js',
      'js/webmcp/webmcp-dados.js',
      'js/webmcp/webmcp-global.js',
      'js/webmcp/webmcp-dashboard.js'
    ]
  });
  await prontoDom(w);
  await aguardar(400);

  let r = await w.NexusWebMCP.executar('obter_resumo_operacional', {});
  const patio = r.dados && r.dados.ocupacao_patio;
  check('o resumo do agente traz a ocupação do pátio', r.ok === true && Boolean(patio), JSON.stringify(r).slice(0, 160));
  check('ocupados/capacidade/livres/taxa do agente batem com o painel',
    patio.ocupados === OCUPADOS_BASE && patio.capacidade === CAPACIDADE && patio.livres === CAPACIDADE - OCUPADOS_BASE
      && patio.taxa_pct === Math.round((OCUPADOS_BASE / CAPACIDADE) * 100), JSON.stringify(patio));
  check('o resumo identifica as cargas que ocupam posição (sem listar as que já saíram)',
    Array.isArray(patio.ocupa_posicao) && patio.ocupa_posicao.length === OCUPADOS_BASE,
    JSON.stringify(patio.ocupa_posicao).slice(0, 120));

  r = await w.NexusWebMCP.executar('detalhar_indicador', { indicador: 'OCUPACAO_PATIO' });
  check('o detalhamento do agente responde com o total e a distribuição por setor',
    r.ok === true && r.dados.ocupados === OCUPADOS_BASE && r.dados.capacidade === CAPACIDADE
      && Array.isArray(r.dados.por_setor) && r.dados.por_setor.length === 2, JSON.stringify(r.dados).slice(0, 220));
  check('o detalhamento lista as cargas ocupantes com status e setor',
    Array.isArray(r.dados.cargas) && r.dados.cargas.length === OCUPADOS_BASE
      && r.dados.cargas.every((c) => c.status === 'ARMAZENAGEM' || c.status === 'RECEBIMENTO_INSPECAO'), JSON.stringify(r.dados.cargas).slice(0, 200));

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
log('\n5. C2 no painel: movimentar para o contêiner libera a posição no MESMO número');
{
  const banco = bancoBase();
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('ESTIVADOR'),
    storage: {
      nexus_cargas_fluxo: [],
      nexus_containers_list: [{ id: UUID(900), identificacao: 'MSCU1234567', estado: 'OPERANTE' }],
      nexus_guindastes_list: [{ id: 'GND-01-STS', identificacao: 'GND-01-STS', estado: 'OPERANTE' }],
      nexus_guindaste_tarefas: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = banco; win.currentUserSession = win.NexusAuth.getSession(); },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => { win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); }; },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/cargas.js',
      'js/webmcp/webmcp-core.js',
      (win) => { win.NexusWebMCP.iniciar({ confirmar: async () => true }); },
      'js/webmcp/webmcp-ui.js',
      'js/webmcp/webmcp-dados.js',
      'js/webmcp/webmcp-global.js',
      'js/webmcp/webmcp-cargas.js'
    ]
  });
  await prontoDom(w);
  await aguardar(400);

  const antes = (await w.NexusRepository.buscarIndicadoresOperacionais()).ocupacaoPatio;
  check(`o painel começa com ${OCUPADOS_BASE} posições ocupadas`, antes.ocupados === OCUPADOS_BASE, JSON.stringify(antes).slice(0, 120));
  check('a carga vinculada está entre as ocupantes', antes.lista.some((c) => c.codigo === 'CRG-2026-002'), JSON.stringify(antes.lista.map((c) => c.codigo)));

  const r = await w.NexusWebMCP.executar('mover_carga_container', { id: 'CRG-2026-002' });
  check('a movimentação para o contêiner vinculado é executada', r.ok === true, JSON.stringify(r).slice(0, 200));

  const depois = (await w.NexusRepository.buscarIndicadoresOperacionais()).ocupacaoPatio;
  check('a posição é liberada no MESMO número que o painel mostra',
    depois.ocupados === OCUPADOS_BASE - 1, JSON.stringify({ antes: antes.ocupados, depois: depois.ocupados }));
  check('a carga movimentada sai da lista de ocupantes do pátio',
    !depois.lista.some((c) => c.codigo === 'CRG-2026-002'), JSON.stringify(depois.lista.map((c) => c.codigo)));
  check('o detalhamento continua listando somente quem ocupa posição',
    depois.lista.length === depois.ocupados && depois.lista.every((c) => w.NexusRepository.statusOcupaPatio(c)));

  janela.dom.window.close();
}

}

main()
  .then(() => {
    const res = resumo();
    if (res.falhas > 0) {
      process.stdout.write(`\n❌ G1: ${res.falhas} falha(s) em ${res.total} verificações.\n`);
      process.exit(1);
    }
    log(`\n✅ G1: ${res.total} verificações aprovadas (um cálculo para painel, agente e Regra 2.9).`);
    process.exit(0);
  })
  .catch((erro) => {
    check('execução sem exceções', false, erro && erro.stack ? erro.stack.split('\n').slice(0, 3).join(' | ') : String(erro));
    const res = resumo();
    process.stdout.write(`\n❌ G1: ${res.falhas} falha(s) em ${res.total} verificações.\n`);
    process.exit(1);
  });
