#!/usr/bin/env node
/**
 * Regressão — Tarefa 10 (Correções): travas de vinculação Contêiner → Navio
 * (Embarcações & GPS).
 *
 * Regras implementadas:
 *  A) O contêiner NÃO pode ser re-vinculado enquanto o navio atual dele
 *     estiver FORA_DO_PORTO — o botão "Vincular" fica DESATIVADO com o motivo
 *     no title/aria-label, e chamadas diretas (automação/WebMCP) são recusadas.
 *  B) Contêiner que já tem navio E cargas ATIVAS tem o vínculo travado: não
 *     pode desfazer e se vincular a outro navio (evita falhas de destino
 *     final). Cargas em status terminal (ENTREGUE/CANCELADA/RECUSADA) são
 *     histórico e não travam — o contêiner pode ser re-vinculado.
 *  C) Primeira vinculação (contêiner sem navio) continua funcionando.
 *  D) Ferramenta WebMCP vincular_container_navio retorna códigos específicos
 *     (CONTAINER_NAVIO_FORA_DO_PORTO / CONTAINER_VINCULO_TRAVADO) sem pedir
 *     confirmação ao operador em casos bloqueados.
 *
 * Executar: node tests/test_vinculo_container_navio_travas.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, criarJanela, prontoDom, aguardar, sessao, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const NAV_FORA = '11111111-1111-4111-8111-111111111111';
const NAV_DENTRO = '22222222-2222-4222-8222-222222222222';
const NAV_DENTRO2 = '33333333-3333-4333-8333-333333333333';
const CONT_FORA = 'MSCU0000001';
const CONT_TRAVADO = 'MSCU0000002';
const CONT_HISTORICO = 'MSCU0000003';
const CONT_LIVRE = 'MSCU0000004';
const IMO_FORA = 'IMO1000001';
const IMO_DENTRO = 'IMO1000002';
const IMO_DENTRO2 = 'IMO1000003';

const naviosCache = () => [
  { id: NAV_FORA, nome: 'Navio Fora', imo: IMO_FORA, localizacao: 'FORA_DO_PORTO', destino: 'Porto de Roterdã' },
  { id: NAV_DENTRO, nome: 'Navio Docked', imo: IMO_DENTRO, localizacao: 'DENTRO_DO_PORTO', destino: 'Porto de Roterdã' },
  { id: NAV_DENTRO2, nome: 'Navio Docked 2', imo: IMO_DENTRO2, localizacao: 'DENTRO_DO_PORTO', destino: 'Porto de Roterdã' }
];

const containersCache = () => [
  { id: CONT_FORA, rawDbId: CONT_FORA, identificacao: CONT_FORA, tipo: 'Dry 40', estado: 'OPERANTE', navio: 'Navio Fora', navio_id: NAV_FORA },
  { id: CONT_TRAVADO, rawDbId: CONT_TRAVADO, identificacao: CONT_TRAVADO, tipo: 'Dry 40', estado: 'OPERANTE', navio: 'Navio Docked', navio_id: NAV_DENTRO },
  { id: CONT_HISTORICO, rawDbId: CONT_HISTORICO, identificacao: CONT_HISTORICO, tipo: 'Dry 40', estado: 'OPERANTE', navio: 'Navio Docked', navio_id: NAV_DENTRO },
  { id: CONT_LIVRE, rawDbId: CONT_LIVRE, identificacao: CONT_LIVRE, tipo: 'Dry 40', estado: 'OPERANTE', navio: '', navio_id: null }
];

const cargasCache = () => [
  { id: 'CRG-ATIVA', status: 'ARMAZENAGEM', container: CONT_TRAVADO, container_id: CONT_TRAVADO, destino: 'Porto de Roterdã', peso: '10 t', navio: '' },
  // Histórico: terminal não ocupa mais o contêiner (Tarefas 3/7).
  { id: 'CRG-HIST', status: 'ENTREGUE', container: CONT_HISTORICO, container_id: CONT_HISTORICO, destino: 'Porto de Roterdã', peso: '5 t', navio: '' }
];

function bancoBase() {
  return criarBancoFalso({
    navios: naviosCache().map((n) => ({ id: n.id, nome: n.nome, numero_imo: n.imo, localizacao: n.localizacao, porto_destino: n.destino })),
    containers: containersCache().map((c) => ({ id: c.id, numero_identificacao: c.identificacao, estado: c.estado, navio_id: c.navio_id })),
    cargas: cargasCache().map((c) => ({ id: c.id, status_fluxo: c.status, container_id: c.container, destino: c.destino })),
    bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

const SETUP = (banco) => (win) => {
  win.currentUserSession = win.NexusAuth.getSession();
  win.nexusSupabase = banco;
  win.__feedbacks = [];
  win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks.push({ tipo, titulo, msg }); };
  win.nexusConfirm = async () => true;
};

async function carregar(banco, opts = {}) {
  const scripts = [
    'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
    SETUP(banco), 'js/vision-layer.js', 'js/layout.js', 'js/padronizacao-codigos.js',
    'js/pages/embarcacoes.js'
  ];
  if (opts.webmcp) {
    scripts.push(
      'js/webmcp/webmcp-core.js',
      (win) => {
        win.__pedidos = [];
        win.__resposta = true;
        win.NexusWebMCP.iniciar({ confirmar: async (pedido) => { win.__pedidos.push(pedido); return win.__resposta; } });
      },
      'js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js', 'js/webmcp/webmcp-embarcacoes.js'
    );
  }
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: naviosCache(), nexus_containers_list: containersCache(), nexus_cargas_fluxo: cargasCache() },
    scripts
  });
  await prontoDom(janela.w);
  await aguardar(350);
  // A página substitui window.mostrarFeedback no boot; reinstala o capturador
  // depois do carregamento (mesmo padrão de outros testes deste repo).
  if (!opts.webmcp) {
    janela.w.__feedbacks = [];
    janela.w.mostrarFeedback = (tipo, titulo, msg) => { janela.w.__feedbacks.push({ tipo, titulo, msg }); };
  }
  return janela;
}

const containerCache = (w, ident) => JSON.parse(w.localStorage.getItem('nexus_containers_list') || '[]').find((c) => c.identificacao === ident) || {};
const containerBanco = (banco, ident) => banco.tabelas.containers.find((c) => c.numero_identificacao === ident) || {};
const botaoVincular = (w, ident) => w.document.getElementById(`btnVincularContainer-${ident}`);
const feedbackCom = (w, titulo) => (w.__feedbacks || []).find((f) => f.titulo === titulo) || {};

async function main() {
  log('\n[Tarefa 10] Travas de vinculação contêiner → navio (Embarcações & GPS)\n');

  // ---------------------------------------------------------------------
  log('1. Regra A — navio atual FORA_DO_PORTO: botão desativado e vínculo bloqueado');
  {
    const banco = bancoBase();
    const { w, erros } = await carregar(banco);
    try {
      const btn = botaoVincular(w, CONT_FORA);
      check('1: botão "Vincular" do contêiner com navio fora do porto está DESATIVADO',
        Boolean(btn) && btn.disabled === true && btn.getAttribute('data-vinculo-bloqueado') === 'true',
        btn ? `disabled=${btn.disabled} data=${btn.getAttribute('data-vinculo-bloqueado')}` : 'botão ausente');
      check('1: motivo acessível (title/aria-label) cita que o navio está fora do porto',
        /fora do porto/i.test(btn.getAttribute('title') || '') && (btn.getAttribute('aria-label') || '') === btn.getAttribute('title'),
        btn.getAttribute('title'));
      check('1: contêiner livre no mesmo painel continua com botão ATIVO (sem falso positivo)',
        Boolean(botaoVincular(w, CONT_LIVRE)) && botaoVincular(w, CONT_LIVRE).disabled === false);

      await w.vincularContainerANavio(CONT_FORA, { navioImo: IMO_DENTRO2, confirmado: true });
      await aguardar(120);
      check('1: chamada direta NÃO troca o navio do contêiner (permanece no navio fora do porto)',
        containerCache(w, CONT_FORA).navio_id === NAV_FORA, JSON.stringify(containerCache(w, CONT_FORA)));
      check('1: banco permanece intacto', containerBanco(banco, CONT_FORA).navio_id === NAV_FORA, String(containerBanco(banco, CONT_FORA).navio_id));
      check('1: feedback "Vínculo Bloqueado" com o motivo',
        /fora do porto/i.test((feedbackCom(w, 'Vínculo Bloqueado') || {}).msg || ''), JSON.stringify(feedbackCom(w, 'Vínculo Bloqueado')));
      check('1: sem erros de runtime', erros.length === 0, JSON.stringify(erros).slice(0, 200));
    } finally { w.close(); }
  }

  // ---------------------------------------------------------------------
  log('\n2. Regra B — contêiner com navio e carga ATIVA: vínculo travado');
  {
    const banco = bancoBase();
    const { w, erros } = await carregar(banco);
    try {
      const btn = botaoVincular(w, CONT_TRAVADO);
      check('2: botão "Vincular" do contêiner com carga ativa está DESATIVADO',
        Boolean(btn) && btn.disabled === true && btn.getAttribute('data-vinculo-bloqueado') === 'true',
        btn ? `disabled=${btn.disabled}` : 'botão ausente');
      check('2: motivo cita a(s) carga(s) ativa(s) e o risco de destino final',
        /carga\(s\) ativa\(s\)/i.test(btn.getAttribute('title') || '') && /CRG-ATIVA/.test(btn.getAttribute('title') || ''),
        btn.getAttribute('title'));

      await w.vincularContainerANavio(CONT_TRAVADO, { navioImo: IMO_DENTRO2, confirmado: true });
      await aguardar(120);
      check('2: chamada direta NÃO desfaz o vínculo atual',
        containerCache(w, CONT_TRAVADO).navio_id === NAV_DENTRO,
        JSON.stringify(containerCache(w, CONT_TRAVADO)));
      check('2: banco permanece intacto', containerBanco(banco, CONT_TRAVADO).navio_id === NAV_DENTRO);
      check('2: feedback "Vínculo Travado" orienta liberar as cargas',
        /destino final/i.test((feedbackCom(w, 'Vínculo Travado') || {}).msg || ''), JSON.stringify(feedbackCom(w, 'Vínculo Travado')));
      check('2: sem erros de runtime', erros.length === 0, JSON.stringify(erros).slice(0, 200));
    } finally { w.close(); }
  }

  // ---------------------------------------------------------------------
  log('\n3. Histórico (cargas terminais) não trava: troca de navio continua possível');
  {
    const banco = bancoBase();
    const { w, erros } = await carregar(banco);
    try {
      check('3: botão do contêiner com apenas carga ENTREGUE está ATIVO',
        Boolean(botaoVincular(w, CONT_HISTORICO)) && botaoVincular(w, CONT_HISTORICO).disabled === false &&
        botaoVincular(w, CONT_HISTORICO).getAttribute('data-vinculo-bloqueado') === 'false');
      await w.vincularContainerANavio(CONT_HISTORICO, { navioImo: IMO_DENTRO2, confirmado: true });
      await aguardar(160);
      check('3: contêiner foi re-vinculado ao novo navio no cache',
        containerCache(w, CONT_HISTORICO).navio === 'Navio Docked 2' && containerCache(w, CONT_HISTORICO).navio_id === NAV_DENTRO2,
        JSON.stringify(containerCache(w, CONT_HISTORICO)));
      check('3: banco registrou a troca (update em containers)',
        containerBanco(banco, CONT_HISTORICO).navio_id === NAV_DENTRO2, String(containerBanco(banco, CONT_HISTORICO).navio_id));
      check('3: carga ENTREGUE (histórico) segue ENTREGUE', JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')).find((c) => c.id === 'CRG-HIST').status === 'ENTREGUE');
      check('3: sem erros de runtime', erros.length === 0, JSON.stringify(erros).slice(0, 200));
    } finally { w.close(); }
  }

  // ---------------------------------------------------------------------
  log('\n4. Regressão — primeira vinculação (contêiner sem navio) continua funcionando');
  {
    const banco = bancoBase();
    const { w, erros } = await carregar(banco);
    try {
      check('4: botão ativo para contêiner sem navio', botaoVincular(w, CONT_LIVRE).disabled === false);
      await w.vincularContainerANavio(CONT_LIVRE, { navioImo: IMO_DENTRO, confirmado: true });
      await aguardar(160);
      check('4: contêiner vinculado ao navio escolhido (cache + banco)',
        containerCache(w, CONT_LIVRE).navio === 'Navio Docked' && containerBanco(banco, CONT_LIVRE).navio_id === NAV_DENTRO,
        JSON.stringify(containerCache(w, CONT_LIVRE)));
      check('4: feedback de sucesso', /vinculado com sucesso/i.test((w.__feedbacks.slice(-1)[0] || {}).msg || ''), JSON.stringify((w.__feedbacks || []).slice(-1)[0]));
      check('4: sem erros de runtime', erros.length === 0, JSON.stringify(erros).slice(0, 200));
    } finally { w.close(); }
  }

  // ---------------------------------------------------------------------
  log('\n5. Ferramenta WebMCP vincular_container_navio: códigos específicos sem confirmação');
  {
    const banco = bancoBase();
    const { w, erros } = await carregar(banco, { webmcp: true });
    try {
      let r = await w.NexusWebMCP.executar('vincular_container_navio', { identificacao: CONT_FORA, imo: 'IMO1000003' });
      check('5a: navio atual fora do porto → recusa com CONTAINER_NAVIO_FORA_DO_PORTO',
        r.ok === false && r.codigo === 'CONTAINER_NAVIO_FORA_DO_PORTO', JSON.stringify(r).slice(0, 220));
      check('5a: nenhuma confirmação chegou ao operador', w.__pedidos.length === 0, `${w.__pedidos.length} pedido(s)`);
      check('5a: contêiner intacto', containerCache(w, CONT_FORA).navio_id === NAV_FORA);

      r = await w.NexusWebMCP.executar('vincular_container_navio', { identificacao: CONT_TRAVADO, imo: 'IMO1000003' });
      check('5b: contêiner com carga ativa → recusa com CONTAINER_VINCULO_TRAVADO',
        r.ok === false && r.codigo === 'CONTAINER_VINCULO_TRAVADO' && /CRG-ATIVA|carga\(s\) ativa\(s\)/i.test(r.mensagem || ''), JSON.stringify(r).slice(0, 220));
      check('5b: nenhuma confirmação chegou ao operador', w.__pedidos.length === 0, `${w.__pedidos.length} pedido(s)`);
      check('5b: contêiner intacto', containerCache(w, CONT_TRAVADO).navio_id === NAV_DENTRO);

      r = await w.NexusWebMCP.executar('vincular_container_navio', { identificacao: CONT_LIVRE, imo: IMO_DENTRO });
      await aguardar(160);
      check('5c: contêiner sem navio → executado com confirmação (1 pedido)',
        r.ok === true && w.__pedidos.length === 1, JSON.stringify(r).slice(0, 220));
      check('5c: vínculo efetivado no cache', containerCache(w, CONT_LIVRE).navio === 'Navio Docked', JSON.stringify(containerCache(w, CONT_LIVRE)));
      check('5: sem erros de runtime', erros.length === 0, JSON.stringify(erros).slice(0, 200));
    } finally { w.close(); }
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 10 (travas de vinculação contêiner → navio) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
