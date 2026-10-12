#!/usr/bin/env node
/**
 * Regressão (H1 — Backlog NexusPort): páginas interligadas — VISIBILIDADE de tela,
 * PERMISSÃO de ação e ESCOPO de indicadores são três coisas diferentes.
 *
 * Antes desta correção existiam três regras para "o que este cargo enxerga":
 *   • js/pages/cargas.js filtrava a tabela pela Visão Própria;
 *   • o Painel e Embarcações mostravam tudo (nenhum filtro);
 *   • o agente (webmcp-dados) filtrava de novo, pelo mesmo function.
 * E a carga registrada pela Direção — que fica atribuída ao próprio gestor, o padrão do
 * formulário — não aparecia para o Estivador que precisa trabalhar nela.
 *
 * Decisão de produto (H1), confirmada com o usuário:
 *   • a carga EM FLUXO é visível para todos os cargos (a do Diretor aparece para o Estivador);
 *   • quem restringe é a PERMISSÃO da ação (botões/ferramentas) e o ESCOPO dos indicadores
 *     ("meus indicadores"), nunca a visibilidade da tela;
 *   • o histórico (ENTREGUE) segue a Visão Própria do RF 1.3 — a entregue de outro operador
 *     não aparece para quem não participou.
 *
 * Executar: node tests/test_h1_visao_cargas.js   (ou: npm run test:h1-visao-cargas)
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID_DIRETOR = UUID(99);
const NOME_DIRETOR = 'Diretor Presidente';
const agora = new Date().toISOString();

/** Carga como o banco guarda (linha crua do PostgREST). */
function cargaBanco(n, status, extra) {
  const codigo = `CRG-2026-${n}`;
  return Object.assign({
    id: UUID(n),
    qr_code_url: `QR-${codigo}`,
    status_fluxo: status,
    natureza: 'Carga Geral',
    peso: 10,
    volume: 20,
    porto_descarga: 'Pátio STS-01 (Setor B)',
    container_id: null,
    navio_id: null,
    // A carga registrada pela Direção fica atribuída a ela (padrão do formulário).
    estivador_id: ID_DIRETOR,
    created_at: agora
  }, extra || {});
}

function bancoBase() {
  return criarBancoFalso({
    cargas: [
      // Registrada pela Direção e ainda sem ninguém no pátio: era a carga invisível.
      cargaBanco(500, 'AGENDAMENTO'),
      // Recebida para inspeção (fila do Estivador/Conferente), também da Direção.
      cargaBanco(501, 'RECEBIMENTO_INSPECAO'),
      // No pátio, atribuída à Direção: o Estivador trabalha nela mesmo assim.
      cargaBanco(502, 'ARMAZENAGEM'),
      // Já no contêiner (C2).
      cargaBanco(503, 'PRONTA_PARA_ENTREGA', { container_id: UUID(50) }),
      // Histórico — de OUTRO estivador.
      cargaBanco(504, 'ENTREGUE', { estivador_id: UUID(77), estivadorMatricula: 'MAT-7777' }),
      // Histórico — do próprio estivador da sessão do harness (MAT-9001).
      cargaBanco(505, 'ENTREGUE', { estivador_id: UUID(78), estivadorMatricula: 'MAT-9001' }),
      // Recusada (fica na tabela própria, visível a todos).
      cargaBanco(506, 'RECUSADA', { motivo_recusa: 'Avaria' })
    ],
    navios: [], containers: [], bercos: [], manutencoes: [], funcionarios: [], tipos_carga: [], rotas_maritimas: []
  });
}

const STORAGE = { nexus_cargas_fluxo: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_guindaste_tarefas: [], nexus_func_list: [] };
const janelas = [];

async function carregarPagina(banco, cargo, extras) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao(cargo),
    storage: Object.assign({}, STORAGE),
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
      'js/pages/cargas.js'
    ].concat((extras && extras.scripts) || [])
  });
  janelas.push(janela);
  await prontoDom(w);
  await aguardar(350);
  return w;
}

const textoDe = (w, id) => {
  const el = w.document.getElementById(id);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
};
const linhasDe = (w, id) => Array.from(w.document.getElementById(id).querySelectorAll('tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim());

(async function main() {
  console.log('\n=== H1 — visibilidade de tela × permissão de ação × escopo de indicadores ===');

  // -------------------------------------------------------------------------
  log('\n1. A regra única (js/vision-layer.js)');
  {
    const banco = bancoBase();
    const w = await carregarPagina(banco, 'ESTIVADOR');
    const V = w.NexusVision;
    check('existe a função de visibilidade das telas', V && typeof V.visibilidadeDeCargas === 'function');

    const cargas = [
      { id: 'A', status: 'AGENDAMENTO', estivador_id: ID_DIRETOR },
      { id: 'B', status: 'ARMAZENAGEM', estivador_id: ID_DIRETOR },
      { id: 'C', status: 'ENTREGUE', estivador_id: UUID(77), estivadorMatricula: 'MAT-7777' },
      { id: 'D', status: 'ENTREGUE', estivadorMatricula: 'MAT-9001' }
    ];

    const visiveisEstivador = V.visibilidadeDeCargas(cargas, sessao('ESTIVADOR')).map((c) => c.id);
    check('o Estivador vê a carga do Diretor em fluxo (AGENDAMENTO) — a carga que "não aparecia"',
      visiveisEstivador.includes('A'), JSON.stringify(visiveisEstivador));
    check('e também a carga em armazenagem atribuída ao Diretor', visiveisEstivador.includes('B'), JSON.stringify(visiveisEstivador));
    check('o histórico de outro operador continua fora (RF 1.3)', !visiveisEstivador.includes('C'), JSON.stringify(visiveisEstivador));
    check('o próprio histórico permanece visível', visiveisEstivador.includes('D'), JSON.stringify(visiveisEstivador));

    const visiveisConferente = V.visibilidadeDeCargas(cargas, sessao('CONFERENTE_CARGA')).map((c) => c.id);
    check('o Conferente vê o mesmo fluxo ativo', visiveisConferente.includes('A') && visiveisConferente.includes('B'), JSON.stringify(visiveisConferente));
    check('e o histórico dele não inclui a entregue de outro', !visiveisConferente.includes('C'), JSON.stringify(visiveisConferente));

    const visiveisDiretor = V.visibilidadeDeCargas(cargas, sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE')).map((c) => c.id);
    check('a Direção (Visão Estratégica) vê tudo, inclusive o histórico', visiveisDiretor.length === 4, JSON.stringify(visiveisDiretor));
    const visiveisPlanejador = V.visibilidadeDeCargas(cargas, sessao('PLANEJADOR_PATIO_NAVIOS')).map((c) => c.id);
    check('o Planejador vê tudo (não é cargo operacional de execução)', visiveisPlanejador.length === 4, JSON.stringify(visiveisPlanejador));

    // O escopo dos indicadores ("meus indicadores") NÃO muda com o H1.
    const indicadorEstivador = V.filterCargasForUser(cargas, sessao('ESTIVADOR')).map((c) => c.id);
    check('o escopo de INDICADORES do Estivador continua só as operações dele (A continua fora: não é do pátio)',
      !indicadorEstivador.includes('A') && indicadorEstivador.includes('B') && indicadorEstivador.includes('D'),
      JSON.stringify(indicadorEstivador));
    check('e não inclui a entregue de outro estivador', !indicadorEstivador.includes('C'), JSON.stringify(indicadorEstivador));

    check('a carga atribuída ao usuário é reconhecida por id, matrícula ou nome',
      V.pertenceAoUsuario({ estivador_id: ID_DIRETOR }, sessao('ESTIVADOR')) === false
        && V.pertenceAoUsuario({ estivadorMatricula: 'MAT-9001' }, sessao('ESTIVADOR')) === true
        && V.pertenceAoUsuario({ estivador: sessao('ESTIVADOR').nome }, sessao('ESTIVADOR')) === true);

    // O filtro no nível da CONSULTA (usado antes de qualquer leitura no Supabase) precisa
    // concordar com a tela: nada de `.eq('estivador_id', ...)` escondendo a carga do pátio.
    const provaConsulta = { filtros: [], eq(coluna, valor) { this.filtros.push([coluna, valor]); return this; } };
    V.applyVisaoFilter(provaConsulta, 'cargas', sessao('ESTIVADOR'));
    check('o filtro no nível da consulta não esconde mais a carga do pátio',
      !provaConsulta.filtros.some(([coluna]) => /estivador_id|arrumador_id|conferente_id/.test(coluna)),
      JSON.stringify(provaConsulta.filtros));
    const provaVisitantes = { filtros: [], eq(coluna, valor) { this.filtros.push([coluna, valor]); return this; } };
    V.applyVisaoFilter(provaVisitantes, 'visitantes', sessao('SUPERVISOR_GERENTE_OPERACOES'));
    check('a restrição de dados pessoais segue valendo na consulta',
      provaVisitantes.filtros.some(([coluna, valor]) => coluna === 'id' && valor === 'ACCESSO_NEGADO'),
      JSON.stringify(provaVisitantes.filtros));
    check('os dados pessoais continuam restritos (visitantes e documentos de funcionários)',
      V.hasAccessToModule('visitantes', sessao('ESTIVADOR')) === false
        && V.hasAccessToModule('documentacao_funcionarios', sessao('ESTIVADOR')) === false
        && V.hasAccessToModule('visitantes', sessao('TECNICO_PORTOS')) === true);
  }

  // -------------------------------------------------------------------------
  log('\n2. Página Cargas: a carga do Diretor aparece para o Estivador');
  {
    const banco = bancoBase();
    const w = await carregarPagina(banco, 'ESTIVADOR');
    const texto = textoDe(w, 'cargasTableBody');
    check('a carga AGENDAMENTO registrada pela Direção aparece na tabela do Estivador',
      texto.includes('CRG-2026-500'), texto.slice(0, 160));
    check('a carga em recebimento/inspeção também', texto.includes('CRG-2026-501'));
    check('a carga em armazenagem atribuída à Direção também', texto.includes('CRG-2026-502'));
    check('a carga já no contêiner (PRONTA_PARA_ENTREGA) também', texto.includes('CRG-2026-503'));
    check('a carga recusada continua na tabela própria', textoDe(w, 'cargasRecusadasTableBody').includes('CRG-2026-506'));
    check('o contador acompanha a tabela (4 cargas ativas)', /Exibindo 4 de 4/.test(textoDe(w, 'cargasCounter')), textoDe(w, 'cargasCounter'));

    // Histórico (RF 1.3): a atribuição de quem entregou vem do vínculo estivador_cargas, que o
    // dublê de banco não resolve — então esta regra é exercitada pelo caminho do cache local,
    // o mesmo usado pelo teste do C1.
    const cargaLocal = (id, extra) => Object.assign({
      id, tipo: 'Carga Geral', natureza: 'Geral', peso: '10 t', volume: '20 m³',
      portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', status: 'ENTREGUE',
      qrCode: `QR-${id}`, data_cadastro: agora
    }, extra || {});
    let wLocal;
    const janelaLocal = criarJanela({
      url: 'https://nexusport.test/cargas.html',
      html: htmlDaPagina('cargas.html'),
      session: sessao('ESTIVADOR'),
      storage: Object.assign({}, STORAGE, {
        nexus_cargas_fluxo: [
          cargaLocal('CRG-2026-504', { estivador: 'Outro Estivador', estivadorMatricula: 'MAT-7777' }),
          cargaLocal('CRG-2026-505', { estivadorMatricula: 'MAT-9001' }),
          cargaLocal('CRG-2026-506', { status: 'AGENDAMENTO' })
        ]
      }),
      scripts: [
        'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
        (win) => { wLocal = win; win.currentUserSession = win.NexusAuth.getSession(); },
        'js/vision-layer.js', 'js/layout.js', (win) => { win.mostrarFeedback = () => {}; },
        'js/padronizacao-codigos.js', 'js/pages/cargas.js'
      ]
    });
    janelas.push(janelaLocal);
    await prontoDom(wLocal);
    await aguardar(250);
    const entreguesLocal = textoDe(wLocal, 'cargasEntreguesTableBody');
    check('o histórico de outro estivador NÃO aparece na tabela de entregues',
      !entreguesLocal.includes('CRG-2026-504'), entreguesLocal.slice(0, 160));
    check('o histórico do próprio estivador aparece', entreguesLocal.includes('CRG-2026-505'));

    // O mesmo vale para uma tela de OUTRO cargo operacional (páginas interligadas).
    const wConferente = await carregarPagina(banco, 'CONFERENTE_CARGA');
    check('o Conferente vê as mesmas cargas em fluxo do que o Estivador',
      textoDe(wConferente, 'cargasTableBody').includes('CRG-2026-500') && textoDe(wConferente, 'cargasTableBody').includes('CRG-2026-502'));
    const wArrumador = await carregarPagina(banco, 'ARRUMADOR_CONSERTADOR');
    check('o Arrumador também (mesma lista, outro cargo)',
      textoDe(wArrumador, 'cargasTableBody').includes('CRG-2026-500'));
  }

  // -------------------------------------------------------------------------
  log('\n3. Visibilidade ≠ permissão: o Estivador vê a carga do Diretor, mas não ganha as ações dos outros');
  {
    const banco = bancoBase();
    const w = await carregarPagina(banco, 'ESTIVADOR');
    const linhas = linhasDe(w, 'cargasTableBody');
    const linhaAgendamento = linhas.find((t) => t.includes('CRG-2026-500')) || '';
    const linhaArmazenagem = linhas.find((t) => t.includes('CRG-2026-502')) || '';
    check('na carga AGENDAMENTO o Estivador não recebe o botão "Receber" (ação do Conferente)',
      !/Receber/.test(linhaAgendamento), linhaAgendamento.slice(0, 200));
    check('na carga em ARMAZENAGEM o Estivador recebe a ação dele (Movimentar)',
      /Movimentar/.test(linhaArmazenagem), linhaArmazenagem.slice(0, 200));
    check('e não recebe a ação de "Pronta" (Arrumador)',
      !/>Pronta</.test(linhaArmazenagem), linhaArmazenagem.slice(0, 200));

    const wConferente = await carregarPagina(banco, 'CONFERENTE_CARGA');
    const linhaConferente = (linhasDe(wConferente, 'cargasTableBody').find((t) => t.includes('CRG-2026-500')) || '');
    check('o Conferente, na MESMA carga, recebe a ação "Receber"',
      /Receber/.test(linhaConferente), linhaConferente.slice(0, 200));
    check('e não recebe a ação "Movimentar" (Estivador)', !/Movimentar/.test(linhaConferente), linhaConferente.slice(0, 200));
  }

  // -------------------------------------------------------------------------
  log('\n4. Páginas interligadas: Painel e agente mostram o MESMO conjunto da página');
  {
    const banco = bancoBase();
    const w = await carregarPagina(banco, 'ESTIVADOR');

    // Painel do mesmo operador: os cards contam o mesmo conjunto que a tabela dele.
    let wp;
    const janelaPainel = criarJanela({
      url: 'https://nexusport.test/dashboard.html',
      html: htmlDaPagina('dashboard.html'),
      session: sessao('ESTIVADOR'),
      storage: { nexus_cargas_fluxo: [] },
      scripts: [
        'js/security.js',
        'js/session-cookies.js',
        'js/auth-guard.js',
        (win) => { wp = win; win.nexusSupabase = banco; win.currentUserSession = win.NexusAuth.getSession(); },
        'js/vision-layer.js',
        'js/layout.js',
        (win) => { win.mostrarFeedback = () => {}; },
        'js/data-repository.js',
        'js/pages/dashboard.js'
      ]
    });
    janelas.push(janelaPainel);
    await prontoDom(wp);
    await aguardar(350);

    const cardTexto = (id) => (wp.document.getElementById(id) || {}).textContent;
    const naTabela = (codigo) => textoDe(w, 'cargasTableBody').includes(codigo);
    check('o card "Cargas em Armazenagem" do Estivador conta as cargas que ele vê na página',
      cardTexto('cardCargasArmazenagemVal') === '1' && naTabela('CRG-2026-502'), cardTexto('cardCargasArmazenagemVal'));
    check('o card "Cargas Prontas" conta a carga que também aparece na tabela dele',
      cardTexto('cardCargasProntasVal') === '1' && naTabela('CRG-2026-503'), cardTexto('cardCargasProntasVal'));
    check('o card "Cargas Recusadas" conta a recusada que está na tabela própria dele',
      /1/.test(cardTexto('cardCargasRecusadasVal') || '') && textoDe(w, 'cargasRecusadasTableBody').includes('CRG-2026-506'),
      cardTexto('cardCargasRecusadasVal'));
    check('a ocupação do pátio (G1) do painel usa o mesmo conjunto visível',
      cardTexto('cardOcupacaoPatioVal') === '2% (2/100)', cardTexto('cardOcupacaoPatioVal'));
  }

  // -------------------------------------------------------------------------
  log('\n5. O agente enxerga o que a tela exibe (mesma sessão, mesmos dados)');
  {
    const banco = bancoBase();
    const w = await carregarPagina(banco, 'ESTIVADOR', {
      scripts: [
        'js/webmcp/webmcp-core.js',
        (win) => { win.NexusWebMCP.iniciar({ confirmar: async () => true }); },
        'js/webmcp/webmcp-ui.js',
        'js/webmcp/webmcp-dados.js',
        'js/webmcp/webmcp-global.js',
        'js/webmcp/webmcp-cargas.js'
      ]
    });
    const r = await w.NexusWebMCP.executar('listar_cargas', {});
    const ids = (r.dados && r.dados.itens ? r.dados.itens : []).map((c) => c.id);
    check('listar_cargas do Estivador traz a carga registrada pela Direção', r.ok === true && ids.includes('CRG-2026-500'), JSON.stringify(ids));
    // A lista do agente exclui apenas CANCELADA: equivale à tabela principal (4 cargas em
    // fluxo) + a tabela de recusadas (1) da mesma página.
    check('e cobre exatamente o que a página mostra ao Estivador (4 em fluxo + 1 recusada)',
      ids.length === 5 && ids.includes('CRG-2026-506'), JSON.stringify(ids));
    check('a carga entregue de outro estivador não aparece para ele no agente',
      !ids.includes('CRG-2026-504'), JSON.stringify(ids));
  }

  const res = resumo();
  if (res.falhas > 0) {
    process.stdout.write(`\n❌ H1: ${res.falhas} falha(s) em ${res.total} verificações.\n`);
    process.exit(1);
  }
  log(`\n✅ H1: ${res.total} verificações aprovadas (visibilidade de tela separada de permissão e de indicadores).`);
  process.exit(0);
})().catch((e) => {
  check('execução sem exceções', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  const res = resumo();
  process.stdout.write(`\n❌ H1: ${res.falhas} falha(s) em ${res.total} verificações.\n`);
  process.exit(1);
});
