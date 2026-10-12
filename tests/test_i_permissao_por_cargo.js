#!/usr/bin/env node
/**
 * Regressão (tarefa I — Backlog NexusPort): PERMISSÕES E VISUAL POR CARGO.
 *
 * Confere, para cada cargo (foco nos cinco operacionais: Estivador, Conferente
 * de Carga, Arrumador/Consertador, Planejador de Pátio e Navios e Técnico em
 * Portos), as DUAS pontas do controle de acesso do RF 1:
 *
 *   1. MENU LATERAL — o que a sidebar oferece (js/layout.js);
 *   2. URL DIRETA — o que o guard libera quando a página é digitada/colada
 *      (js/auth-guard.js → PAGE_PERMISSIONS e requireAuth).
 *
 * O menu passou a ser derivado da matriz do guard (fonte única): qualquer item
 * visível tem de estar liberado, e nenhuma tela liberada pode ficar escondida.
 *
 * Também verifica o VISUAL de cada cargo nas telas que ele abre:
 *   - cargas.html: só os botões da atribuição (Movimentar/P-Contêiner do
 *     Estivador; Receber do Conferente; Pronta do Arrumador; nada para o
 *     Planejador, que registra dados em Embarcações & GPS);
 *   - scanner.html: o atalho "Ir para Checklist" só existe para quem pode abrir
 *     inspecao.html e o "Ir para Tela de Ação do Cargo" nunca aponta para uma
 *     página negada (o Técnico em Portos volta ao Painel Geral);
 *   - embarcacoes.html: o Planejador não vê cadastro de navio/contêiner/guindaste,
 *     nem exclusão de embarcações, nem o formulário de rota marítima
 *     (CADASTRAR_ROTA é do Supervisor);
 *   - tecnico_portos.html: exclusivo do Técnico em Portos e da Direção —
 *     documentação de funcionários e visitantes negadas a operacionais, Inspetor
 *     e Supervisor (RF 1.2);
 *   - relatorios.html: a produtividade é restrita à Direção e ao Inspetor; os
 *     demais cargos (Arrumador e Consertador inclusive) veem só a própria linha.
 *
 * Executar: node tests/test_i_permissao_por_cargo.js
 */
const H = require('./webmcp-harness');
const { read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONT_ID = UUID(50);
const NAV_ID = UUID(60);

// Páginas internas do sistema (as públicas — index/confirm-role/teste-vibracao —
// ficam fora da matriz por definição).
const PAGINAS = [
  'dashboard.html', 'cargas.html', 'inspecao.html', 'scanner.html', 'embarcacoes.html',
  'manutencao.html', 'delegacao.html', 'tecnico_portos.html', 'seguranca.html', 'relatorios.html'
];

const DIRETORIA = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'];
const TODOS = ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS',
  'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR'].concat(DIRETORIA);

/**
 * Telas esperadas por cargo — leitura do Spec.md RF 1 (e da matriz vigente):
 * operacional de carga vê Painel, Cargas, Scanner e Relatórios; o Planejador
 * soma Embarcações & GPS; o Técnico em Portos troca Cargas por Gestão de Pessoas;
 * Inspetor soma Inspeção e Manutenção; Supervisor soma Delegação e Auditoria.
 */
const ESPERADO = {
  ESTIVADOR: ['dashboard.html', 'cargas.html', 'scanner.html', 'relatorios.html'],
  CONFERENTE_CARGA: ['dashboard.html', 'cargas.html', 'scanner.html', 'relatorios.html'],
  ARRUMADOR_CONSERTADOR: ['dashboard.html', 'cargas.html', 'scanner.html', 'relatorios.html'],
  PLANEJADOR_PATIO_NAVIOS: ['dashboard.html', 'cargas.html', 'scanner.html', 'embarcacoes.html', 'relatorios.html'],
  TECNICO_PORTOS: ['dashboard.html', 'scanner.html', 'tecnico_portos.html', 'relatorios.html'],
  INSPETOR: ['dashboard.html', 'cargas.html', 'inspecao.html', 'scanner.html', 'embarcacoes.html', 'manutencao.html', 'relatorios.html'],
  SUPERVISOR_GERENTE_OPERACOES: ['dashboard.html', 'cargas.html', 'inspecao.html', 'scanner.html', 'embarcacoes.html', 'manutencao.html', 'delegacao.html', 'seguranca.html', 'relatorios.html'],
  DIRETOR_OPERACOES_LOGISTICA: PAGINAS.slice(),
  DIRETOR_PRESIDENTE_SUPERINTENDENTE: PAGINAS.slice(),
  CONSELHO_ADMINISTRACAO: PAGINAS.slice()
};

const CARGOS_OPERACIONAIS = ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS'];

// Cargas de apoio: um status por linha útil da tela.
const CARGAS = [
  { id: 'CRG-I-1', qr_code_url: 'QR-CRG-I-1', status_fluxo: 'AGENDAMENTO', natureza: 'Carga Geral', peso: 10, volume: 20, porto_descarga: 'Pátio STS-01 (Setor A)', container_id: null, navio_id: null },
  { id: 'CRG-I-2', qr_code_url: 'QR-CRG-I-2', status_fluxo: 'RECEBIMENTO_INSPECAO', natureza: 'Granel Sólido', peso: 30, volume: 45, porto_descarga: 'Pátio STS-01 (Setor C)', container_id: null, navio_id: null },
  { id: 'CRG-I-3', qr_code_url: 'QR-CRG-I-3', status_fluxo: 'ARMAZENAGEM', natureza: 'Carga Geral', peso: 8, volume: 15, porto_descarga: 'Pátio STS-01 (Setor B)', container_id: CONT_ID, navio_id: null },
  { id: 'CRG-I-4', qr_code_url: 'QR-CRG-I-4', status_fluxo: 'ARMAZENAGEM', natureza: 'Reefer (Contêiner Refrigerado)', peso: 6, volume: 12, porto_descarga: 'Pátio STS-01 (Setor D)', container_id: null, navio_id: null },
  { id: 'CRG-I-5', qr_code_url: 'QR-CRG-I-5', status_fluxo: 'PRONTA_PARA_ENTREGA', natureza: 'Carga Geral', peso: 4, volume: 9, porto_descarga: 'Pátio STS-01 (Setor B)', container_id: CONT_ID, navio_id: null }
];

function bancoBase(extra) {
  return criarBancoFalso(Object.assign({
    cargas: CARGAS.map((c) => Object.assign({}, c)),
    containers: [{ id: CONT_ID, numero_identificacao: 'MSCU1234567', estado: 'OPERANTE', navio_id: null }],
    navios: [{ id: NAV_ID, nome: 'Navio de Teste', numero_imo: 'IMO7000001', estado_operacional: 'DENTRO_DO_PORTO', localizacao: 'DENTRO_DO_PORTO' }],
    bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: [], rotas_maritimas: [],
    funcionarios: [
      { id: UUID(71), matricula: 'MAT-7001', nome: 'Colega Operacional', cargo: 'ESTIVADOR', codigo_individual: 'NX-7001', ativo: true },
      { id: UUID(72), matricula: 'MAT-7002', nome: 'Colega Inspetora', cargo: 'INSPETOR', codigo_individual: 'NX-7002', ativo: true }
    ],
    visitantes: [{ id: UUID(73), nome: 'Visitante Registrado', documento: '111.222.333-44', motivo: 'Vistoria', data_hora: new Date().toISOString() }],
    logs_alteracoes: [
      { data_hora: new Date().toISOString(), nome_funcionario: 'Colega Operacional', cargo: 'ESTIVADOR', codigo_usuario: 'NX-7001', entidade: 'cargas', tipo_alteracao: 'MOVIMENTACAO' },
      { data_hora: new Date().toISOString(), nome_funcionario: 'Colega Inspetora', cargo: 'INSPETOR', codigo_usuario: 'NX-7002', entidade: 'cargas', tipo_alteracao: 'INSPECAO' }
    ],
    trail_decisoes: [], inspecoes: [], tipos_carga: [], agendamentos: [], leituras_qr_code: [], emergencias: []
  }, extra || {}));
}

const STORAGE = {
  nexus_cargas_fluxo: [],
  nexus_containers_list: [{ id: CONT_ID, identificacao: 'MSCU1234567', estado: 'OPERANTE' }],
  nexus_navios_list: [],
  nexus_guindastes_list: [{ identificacao: 'GND-01-STS', estado: 'OPERANTE' }],
  nexus_guindaste_tarefas: [],
  nexus_func_list: [],
  nexus_vis_list: [],
  nexus_audit_logs: [],
  nexus_trail_decisoes: []
};

const janelas = [];

/**
 * Abre uma página real do projeto com a sessão do cargo. O `<script>` inline do
 * guard é removido pelo harness (htmlDaPagina), então a chamada de
 * requireAuth() é feita pelo teste — a mesma que a página faz na URL direta.
 */
async function abrir(pagina, cargo, opcoes) {
  const o = opcoes || {};
  const banco = o.banco || bancoBase();
  let w = null;
  const janela = criarJanela({
    url: `https://nexusport.test/${pagina}`,
    html: htmlDaPagina(pagina),
    session: sessao(cargo, o.extraSessao),
    storage: Object.assign({}, STORAGE, o.storage || {}),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
      (win) => { w = win; win.nexusSupabase = banco; },
      'js/vision-layer.js', 'js/layout.js',
      (win) => { win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); }; },
      'js/padronizacao-codigos.js', 'js/periodo-referencia.js', 'js/data-repository.js',
      'js/pages/charts.js',
      `js/pages/${pagina.replace('.html', '.js')}`
    ].concat(o.scriptsExtras || [])
  });
  janelas.push(janela.dom.window);
  await prontoDom(w);
  await aguardar(o.espera === undefined ? 250 : o.espera);
  janela.w = w;
  janela.banco = banco;
  return janela;
}

/** Matriz PAGE_PERMISSIONS lida do próprio guard (fonte única do acesso). */
function matrizDePaginas() {
  const fonte = read('js/auth-guard.js');
  const inicio = fonte.indexOf('const PAGE_PERMISSIONS = {');
  const fim = fonte.indexOf('};', inicio);
  return new Function(`return ${fonte.slice(inicio + 'const PAGE_PERMISSIONS = '.length, fim + 1)};`)();
}
const MATRIZ = matrizDePaginas();

const podeAbrir = (w, pagina) => w.NexusAuth.canAccessPage(pagina);
const menuDaSessao = (w) => Array.from(w.document.querySelectorAll('.sidebar-nav-item'))
  .map((a) => (a.getAttribute('href') || '').trim());
const escondido = (el) => {
  let n = el;
  while (n && n.classList) {
    if (n.classList.contains('hidden')) return true;
    n = n.parentElement;
  }
  return false;
};
const linhaDa = (w, id) => Array.from((w.document.getElementById('cargasTableBody') || { querySelectorAll: () => [] }).querySelectorAll('tr'))
  .find((tr) => tr.textContent.includes(id)) || null;
// Rótulo do botão sem o nome do ícone (Material Symbols) que precede o texto:
// "forkliftMovimentar" → "Movimentar"; "deployed_codeP/ Contêiner" → "P/ Contêiner".
const rotuloDoBotao = (b) => (b.textContent || '').trim().replace(/^[a-z_]+/, '');
const botoesDa = (linha) => (linha ? Array.from(linha.querySelectorAll('button')).map(rotuloDoBotao) : []);
const feedbacks = (w) => w.__feedbacks || [];
const ultimoFeedback = (w) => feedbacks(w).slice(-1)[0] || {};
const linhasDaTabela = (w, id) => Array.from((w.document.getElementById(id) || { querySelectorAll: () => [] }).querySelectorAll('tr'));

function diferenca(a, b) {
  return a.filter((x) => !b.includes(x));
}

// ---------------------------------------------------------------------------
// 1. Matriz de páginas × cargo (o que o guard libera em URL direta)
// ---------------------------------------------------------------------------
function secaoMatriz() {
  log('\n1. Matriz PAGE_PERMISSIONS × cargo (js/auth-guard.js)');
  for (const cargo of TODOS) {
    const janelaSessao = { NexusAuth: { canAccessPage: (pagina) => (MATRIZ[pagina] || []).includes(cargo) } };
    const liberadas = PAGINAS.filter((p) => janelaSessao.NexusAuth.canAccessPage(p));
    const esperadas = ESPERADO[cargo].slice().sort();
    check(`${cargo}: matriz libera exatamente as ${esperadas.length} telas esperadas`,
      liberadas.slice().sort().join(',') === esperadas.join(','),
      `liberadas=[${liberadas.join(',')}] esperadas=[${esperadas.join(',')}]`);
  }

  const semEntrada = PAGINAS.filter((p) => !Array.isArray(MATRIZ[p]) || MATRIZ[p].length === 0);
  check('toda tela interna tem lista de cargos na matriz', semEntrada.length === 0, semEntrada.join(', '));

  const publicas = ['index.html', 'confirm-role.html', 'teste-vibracao.html'];
  check('telas públicas não entram na matriz de páginas protegidas',
    publicas.every((p) => !MATRIZ[p]));
}

// ---------------------------------------------------------------------------
// 2. Menu lateral × URL direta (fonte única em js/layout.js)
// ---------------------------------------------------------------------------
async function secaoMenu() {
  log('\n2. Menu lateral × acesso por URL (mesma matriz do guard)');
  for (const cargo of TODOS) {
    const { w } = await abrir('dashboard.html', cargo);
    const menu = menuDaSessao(w);
    const liberadas = PAGINAS.filter((p) => podeAbrir(w, p));
    const mortos = menu.filter((href) => !podeAbrir(w, href));
    const escondidas = diferenca(liberadas, menu);
    check(`${cargo}: menu = telas liberadas (${liberadas.length} itens), sem link morto e sem tela escondida`,
      menu.length === liberadas.length && mortos.length === 0 && escondidas.length === 0,
      `menu=[${menu.join(',')}] liberadas=[${liberadas.join(',')}] mortos=[${mortos.join(',')}] escondidas=[${escondidas.join(',')}]`);
  }

  log('\n2b. Telas internas chamam o guard na URL (requireAuth)');
  const internasSemGuarda = PAGINAS.filter((p) => !read(p).includes('NexusAuth.requireAuth('));
  check('todas as telas internas exigem a sessão na carga da página (URL direta)',
    internasSemGuarda.length === 0, internasSemGuarda.join(', '));

  const tecnicoHtml = read('tecnico_portos.html');
  const segurancaHtml = read('seguranca.html');
  const listaDoHtml = (html) => {
    const trecho = html.slice(html.indexOf('requireAuth('), html.indexOf(']);', html.indexOf('requireAuth(')) + 3);
    return (trecho.match(/'[A-Z_]+'/g) || []).map((s) => s.replace(/'/g, ''));
  };
  check('tecnico_portos.html repete a matriz sem divergir (Técnico + Direção)',
    listaDoHtml(tecnicoHtml).slice().sort().join(',') === MATRIZ['tecnico_portos.html'].slice().sort().join(','),
    `html=[${listaDoHtml(tecnicoHtml).join(',')}] matriz=[${MATRIZ['tecnico_portos.html'].join(',')}]`);
  check('seguranca.html repete a matriz sem divergir (Supervisor + Direção)',
    listaDoHtml(segurancaHtml).slice().sort().join(',') === MATRIZ['seguranca.html'].slice().sort().join(','),
    `html=[${listaDoHtml(segurancaHtml).join(',')}] matriz=[${MATRIZ['seguranca.html'].join(',')}]`);
}

// ---------------------------------------------------------------------------
// 3. URL direta: o guard barra o cargo e devolve ao painel
// ---------------------------------------------------------------------------
async function secaoUrlDireta() {
  log('\n3. URL direta: requireAuth() recusa e devolve ao Painel Geral');
  for (const cargo of CARGOS_OPERACIONAIS) {
    const negadas = PAGINAS.filter((p) => !ESPERADO[cargo].includes(p));
    const recusas = [];
    for (const pagina of negadas) {
      const { w } = await abrir(pagina, cargo, { espera: 30 });
      const sessaoRetornada = w.NexusAuth.requireAuth();
      const fb = ultimoFeedback(w);
      const ok = sessaoRetornada === null
        && podeAbrir(w, pagina) === false
        && fb.tipo === 'erro' && fb.titulo === 'Acesso Restrito'
        && (fb.msg || '').includes(sessao(cargo).cargo_nome);
      if (!ok) recusas.push(`${pagina}(retorno=${sessaoRetornada === null ? 'null' : 'sessão'} aviso=${fb.titulo || 'nenhum'})`);
    }
    check(`${cargo}: as ${negadas.length} telas negadas respondem "Acesso Restrito" e voltam ao painel`,
      recusas.length === 0, recusas.join(' | '));

    const liberadas = [];
    for (const pagina of ESPERADO[cargo]) {
      const { w } = await abrir(pagina, cargo, { espera: 30 });
      const s = w.NexusAuth.requireAuth();
      if (!s || s.cargo !== cargo) liberadas.push(pagina);
    }
    check(`${cargo}: as ${ESPERADO[cargo].length} telas liberadas devolvem a sessão do próprio cargo`,
      liberadas.length === 0, liberadas.join(', '));
  }

  const semSessao = await abrir('cargas.html', 'ESTIVADOR', { espera: 30, extraSessao: {} });
  const w = semSessao.w;
  w.document.cookie = 'nexus_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  check('sem sessão válida o guard não devolve cargo (requireAuth → null) e a página não abre',
    w.NexusAuth.getSession() === null && w.NexusAuth.requireAuth() === null);
}

// ---------------------------------------------------------------------------
// 4. I1 — Estivador
// ---------------------------------------------------------------------------
async function secaoEstivador() {
  log('\n4. I1 — Estivador: movimentar cargas e liberar o pátio pelo contêiner');
  const { w } = await abrir('cargas.html', 'ESTIVADOR');

  const linhaArmazenagem = linhaDa(w, 'CRG-I-3');
  const linhaSemVinculo = linhaDa(w, 'CRG-I-4');
  const linhaAgendamento = linhaDa(w, 'CRG-I-1');
  check('Estivador vê a carga em armazenagem com o botão Movimentar',
    Boolean(linhaArmazenagem) && botoesDa(linhaArmazenagem).includes('Movimentar'),
    JSON.stringify(botoesDa(linhaArmazenagem)));
  check('Estivador com carga vinculada vê "P/ Contêiner" (ação MOVIMENTAR_CONTAINER)',
    Boolean(linhaArmazenagem) && /MOVIMENTAR_CONTAINER/.test(linhaArmazenagem.innerHTML));
  check('Estivador NÃO vê o botão "P/ Contêiner" em carga sem contêiner',
    Boolean(linhaSemVinculo) && !botoesDa(linhaSemVinculo).includes('P/ Contêiner'));
  check('Estivador NÃO recebe as ações de Conferente (Receber) nem de Arrumador (Pronta)',
    linhaAgendamento !== null
      && !botoesDa(linhaAgendamento).includes('Receber')
      && !botoesDa(linhaArmazenagem).includes('Pronta'),
    JSON.stringify(botoesDa(linhaAgendamento)));
  check('Estivador NÃO vê ação de gestão (Cancelar/Inspecionar/Vincular)',
    [linhaArmazenagem, linhaSemVinculo, linhaAgendamento].filter(Boolean)
      .every((tr) => botoesDa(tr).filter((b) => ['Cancelar', 'Inspecionar', 'Vincular'].includes(b)).length === 0));
  check('aviso de ações ativas identifica o cargo da sessão',
    /Ações Ativas para: Estivador/.test((w.document.getElementById('roleNoticeTag') || {}).textContent || ''),
    (w.document.getElementById('roleNoticeTag') || {}).textContent);

  const scanner = (await abrir('scanner.html', 'ESTIVADOR')).w;
  const r = await scanner.nexusScannerProcessar('CRG-I-3');
  check('Estivador cai na Ficha de Movimentação (cargas.html) ao processar o QR',
    r.destino_acao === 'cargas.html?carga=CRG-I-3', r.destino_acao);
  check('Estivador não recebe o atalho de checklist (inspecao.html é do Inspetor)',
    r.checklist_disponivel === false
      && scanner.document.getElementById('irChecklistBtn').classList.contains('hidden'));
  check('o destino prometido ao Estivador é uma página que o cargo pode abrir',
    scanner.NexusAuth.canAccessPage(r.destino_acao.split('?')[0]) === true);
}

// ---------------------------------------------------------------------------
// 5. I2 — Conferente de Carga
// ---------------------------------------------------------------------------
async function secaoConferente() {
  log('\n5. I2 — Conferente: receber a carga agendada no porto');
  const { w } = await abrir('cargas.html', 'CONFERENTE_CARGA');

  const agendada = linhaDa(w, 'CRG-I-1');
  const emArmazenagem = linhaDa(w, 'CRG-I-3');
  check('Conferente vê "Receber" na carga em AGENDAMENTO',
    Boolean(agendada) && botoesDa(agendada).includes('Receber'), JSON.stringify(botoesDa(agendada)));
  check('Conferente NÃO vê "Receber" fora de AGENDAMENTO',
    Boolean(emArmazenagem) && !botoesDa(emArmazenagem).includes('Receber'));
  check('Conferente NÃO recebe as ações do Estivador (Movimentar/P-Contêiner) nem do Arrumador (Pronta)',
    [agendada, emArmazenagem].filter(Boolean).every((tr) =>
      botoesDa(tr).filter((b) => ['Movimentar', 'P/ Contêiner', 'Pronta'].includes(b)).length === 0));

  const scanner = (await abrir('scanner.html', 'CONFERENTE_CARGA')).w;
  const r = await scanner.nexusScannerProcessar('CRG-I-1');
  check('Conferente é levado ao recebimento físico (cargas.html)',
    r.destino_acao === 'cargas.html?carga=CRG-I-1' && /Recebimento Físico/.test(r.acao_sugerida), `${r.destino_acao} | ${r.acao_sugerida}`);
  check('Conferente não recebe o atalho de checklist', r.checklist_disponivel === false);
}

// ---------------------------------------------------------------------------
// 6. I3 — Arrumador e Consertador (cargo único no sistema)
// ---------------------------------------------------------------------------
async function secaoArrumador() {
  log('\n6. I3 — Arrumador e Consertador: liberar a carga para entrega');
  const { w } = await abrir('cargas.html', 'ARRUMADOR_CONSERTADOR');

  const emArmazenagem = linhaDa(w, 'CRG-I-3');
  const agendada = linhaDa(w, 'CRG-I-1');
  check('Arrumador vê "Pronta" na carga em ARMAZENAGEM',
    Boolean(emArmazenagem) && botoesDa(emArmazenagem).includes('Pronta'), JSON.stringify(botoesDa(emArmazenagem)));
  check('Arrumador NÃO vê "Pronta" em carga agendada',
    Boolean(agendada) && !botoesDa(agendada).includes('Pronta'));
  check('Arrumador NÃO recebe Movimentar/P-Contêiner (Estivador) nem Receber (Conferente)',
    [emArmazenagem, agendada].filter(Boolean).every((tr) =>
      botoesDa(tr).filter((b) => ['Movimentar', 'P/ Contêiner', 'Receber'].includes(b)).length === 0));

  const scanner = (await abrir('scanner.html', 'ARRUMADOR_CONSERTADOR')).w;
  const r = await scanner.nexusScannerProcessar('CRG-I-3');
  check('Arrumador é levado à alteração de status "Pronta para Entrega"',
    r.destino_acao === 'cargas.html?carga=CRG-I-3' && /Pronta para Entrega/.test(r.acao_sugerida), `${r.destino_acao} | ${r.acao_sugerida}`);
  check('Arrumador não recebe o atalho de checklist', r.checklist_disponivel === false);

  // Restrição de Relatórios: vale para o cargo (Arrumador e Consertador são o
  // mesmo cargo no sistema) — produtividade só da própria linha.
  const rel = (await abrir('relatorios.html', 'ARRUMADOR_CONSERTADOR')).w;
  const corpo = (rel.document.getElementById('produtividadeTableBody') || {}).textContent || '';
  check('Relatórios do Arrumador/Consertador mostram só a própria produtividade',
    corpo.includes('MAT-9001') && !corpo.includes('MAT-7002') && !corpo.includes('Colega Inspetora'), corpo.slice(0, 200));

  const relDiretor = (await abrir('relatorios.html', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE')).w;
  const corpoDiretor = (relDiretor.document.getElementById('produtividadeTableBody') || {}).textContent || '';
  check('a Direção continua vendo a produtividade de toda a equipe',
    corpoDiretor.includes('MAT-7001') && corpoDiretor.includes('MAT-7002'), corpoDiretor.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 7. I4 — Planejador de Pátio e Navios
// ---------------------------------------------------------------------------
async function secaoPlanejador() {
  log('\n7. I4 — Planejador: registrar dados operacionais (sem cadastro/exclusão)');
  const { w } = await abrir('embarcacoes.html', 'PLANEJADOR_PATIO_NAVIOS');

  const oculto = (id) => {
    const el = w.document.getElementById(id);
    return Boolean(el) && el.classList.contains('hidden');
  };
  check('Planejador não vê o cadastro de navio (CADASTRAR_NAVIO é do Inspetor)', oculto('toggleNavioFormBtn'));
  check('Planejador não vê o cadastro de contêiner (CADASTRAR_CONTAINER é do Inspetor)', oculto('toggleContainerFormBtn'));
  check('Planejador não vê o cadastro de guindaste (CADASTRAR_GUINDASTE é do Inspetor)', oculto('toggleGuindasteFormBtn'));
  check('Planejador não vê o cadastro de rota marítima (CADASTRAR_ROTA é do Supervisor)', oculto('toggleRotaFormBtn'));

  const botoesVisiveis = Array.from(w.document.querySelectorAll('button')).filter((b) => !escondido(b));
  check('Planejador não vê nenhum botão de exclusão de embarcação',
    botoesVisiveis.filter((b) => /excluir(Navio|Container|Guindaste)/.test(b.getAttribute('onclick') || '')).length === 0);
  check('Planejador não vê "Liberar Saída" (LIBERAR_NAVIO é do Supervisor)',
    botoesVisiveis.filter((b) => (b.textContent || '').includes('Liberar Saída')).length === 0);

  // A trava também vale para a chamada direta (defesa em profundidade).
  await w.excluirNavio('IMO7000001', { confirmado: true });
  await aguardar(80);
  const recusa = ultimoFeedback(w);
  check('chamar a exclusão direto na página é recusado com "Acesso Restrito"',
    recusa.titulo === 'Acesso Restrito', JSON.stringify(recusa));
  check('nenhum navio foi excluído do banco pela tentativa sem permissão',
    (w.nexusSupabase.tabelas.navios || []).length === 1, JSON.stringify((w.nexusSupabase.tabelas.navios || []).map((n) => n.numero_imo)));

  // Envio direto do formulário de rota (defesa em profundidade): recusado e sem gravação.
  w.document.getElementById('rotaForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await aguardar(60);
  const recusaRota = ultimoFeedback(w);
  check('enviar o formulário de rota sem permissão é recusado com "Acesso Restrito"',
    recusaRota.titulo === 'Acesso Restrito', JSON.stringify(recusaRota));
  check('nenhuma rota marítima foi criada pelo Planejador',
    (w.nexusSupabase.tabelas.rotas_maritimas || []).length === 0);

  // O que É do Planejador continua na tela: registrar a rota da próxima viagem
  // do navio (ATUALIZAR_DADOS_NAVIO_CONTAINER) e vincular/atualizar dados.
  const botaoRotaNavio = Array.from(w.document.querySelectorAll('#embarcacoesGpsTableBody button'))
    .find((b) => /definirRotaNavio/.test(b.getAttribute('onclick') || ''));
  check('Planejador mantém o botão de registrar a rota da próxima viagem do navio',
    Boolean(botaoRotaNavio) && !botaoRotaNavio.disabled, botaoRotaNavio && botaoRotaNavio.outerHTML.slice(0, 120));

  const supervisorEmb = (await abrir('embarcacoes.html', 'SUPERVISOR_GERENTE_OPERACOES')).w;
  check('Supervisor continua com o cadastro de rota marítima (CADASTRAR_ROTA)',
    !supervisorEmb.document.getElementById('toggleRotaFormBtn').classList.contains('hidden'));
  const inspetorEmb = (await abrir('embarcacoes.html', 'INSPETOR')).w;
  check('Inspetor não recebe o cadastro de rota marítima (ação do Supervisor)',
    inspetorEmb.document.getElementById('toggleRotaFormBtn').classList.contains('hidden'));
  check('Inspetor mantém os cadastros de navio, contêiner e guindaste que lhe pertencem',
    !inspetorEmb.document.getElementById('toggleNavioFormBtn').classList.contains('hidden')
      && !inspetorEmb.document.getElementById('toggleContainerFormBtn').classList.contains('hidden')
      && !inspetorEmb.document.getElementById('toggleGuindasteFormBtn').classList.contains('hidden'));

  const cargas = (await abrir('cargas.html', 'PLANEJADOR_PATIO_NAVIOS')).w;
  const linha = linhaDa(cargas, 'CRG-I-3');
  check('Planejador abre Cargas & Pátio em leitura (sem botões de operação de carga)',
    Boolean(linha) && !['Movimentar', 'P/ Contêiner', 'Receber', 'Pronta', 'Vincular', 'Cancelar']
      .some((b) => botoesDa(linha).includes(b)), JSON.stringify(botoesDa(linha)));

  const scanner = (await abrir('scanner.html', 'PLANEJADOR_PATIO_NAVIOS')).w;
  const r = await scanner.nexusScannerProcessar('CRG-I-3');
  check('Planejador é levado ao Painel Geral de Cargas (página que ele pode abrir)',
    r.destino_acao === 'cargas.html?carga=CRG-I-3' && r.checklist_disponivel === false, `${r.destino_acao} | ${r.checklist_disponivel}`);
}

// ---------------------------------------------------------------------------
// 8. I5 — Técnico em Portos (acesso parcial: pessoas, sem cargas)
// ---------------------------------------------------------------------------
async function secaoTecnico() {
  log('\n8. I5 — Técnico em Portos: documentação de funcionários e visitantes');
  const { w } = await abrir('tecnico_portos.html', 'TECNICO_PORTOS');

  const tem = (id) => Boolean(w.document.getElementById(id));
  check('Gestão de Pessoas abre para o Técnico com a busca de funcionário', tem('empMatriculaSearch') && tem('searchEmpBtn'));
  check('Técnico tem a reemissão/invalidação de código individual (RN 15)', tem('regenCodeBtn'));
  check('Técnico tem o CRUD de funcionários (documentação interna)', tem('toggleFuncFormBtn') && tem('funcCrudTableBody'));
  check('Técnico tem o registro de visitantes', tem('toggleVisFormBtn') && tem('visCrudTableBody'));
  check('Técnico NÃO recebe nenhuma tela de operação de carga/pátio',
    ['cargas.html', 'inspecao.html', 'embarcacoes.html', 'manutencao.html', 'delegacao.html', 'seguranca.html']
      .every((p) => podeAbrir(w, p) === false));

  const scanner = (await abrir('scanner.html', 'TECNICO_PORTOS')).w;
  const r = await scanner.nexusScannerProcessar('CRG-I-3');
  check('Técnico não é mandado para Cargas & Pátio (tela negada ao cargo)',
    r.destino_acao === 'dashboard.html', r.destino_acao);
  check('o destino do Técnico no scanner é uma página que ele pode abrir',
    scanner.NexusAuth.canAccessPage(r.destino_acao) === true);
  check('Técnico não recebe o atalho de checklist', r.checklist_disponivel === false);

  const rel = (await abrir('relatorios.html', 'TECNICO_PORTOS')).w;
  const corpo = (rel.document.getElementById('produtividadeTableBody') || {}).textContent || '';
  check('Relatórios do Técnico mostram só a produtividade dele',
    corpo.includes('MAT-9001') && !corpo.includes('MAT-7002'), corpo.slice(0, 200));

  log('\n8b. Dados de pessoas: exclusivos do Técnico em Portos e da Direção (RF 1.2)');
  const V = w.NexusVision;
  const pessoas = (cargo) => {
    const s = sessao(cargo);
    return V.hasAccessToModule('visitantes', s) && V.hasAccessToModule('documentacao_funcionarios', s);
  };
  check('Técnico em Portos acessa os módulos de visitantes e documentação',
    pessoas('TECNICO_PORTOS') === true);
  check('Direção acessa os módulos de visitantes e documentação',
    DIRETORIA.every((c) => pessoas(c) === true));
  check('Inspetor e Supervisor NÃO acessam documentação de funcionários nem visitantes',
    ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].every((c) => V.hasAccessToModule('documentacao_funcionarios', sessao(c)) === false
      && V.hasAccessToModule('visitantes', sessao(c)) === false));
  check('cargos operacionais NÃO acessam documentação de funcionários nem visitantes',
    ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS']
      .every((c) => V.hasAccessToModule('documentacao_funcionarios', sessao(c)) === false
        && V.hasAccessToModule('visitantes', sessao(c)) === false));

  const inspetor = (await abrir('tecnico_portos.html', 'INSPETOR', { espera: 40 })).w;
  check('Inspetor que digita Gestão de Pessoas é recusado com "Acesso Restrito"',
    inspetor.NexusAuth.requireAuth() === null && ultimoFeedback(inspetor).titulo === 'Acesso Restrito',
    JSON.stringify(ultimoFeedback(inspetor)));

  log('\n8c. Scanner × cargos que não operam carga');
  const inspetorScan = (await abrir('scanner.html', 'INSPETOR')).w;
  const rInspetor = await inspetorScan.nexusScannerProcessar('CRG-I-2');
  check('Inspetor continua indo para o checklist técnico de inspeção',
    rInspetor.destino_acao === 'inspecao.html?carga=CRG-I-2' && rInspetor.checklist_disponivel === true, `${rInspetor.destino_acao}`);
  check('o atalho de checklist fica visível para o Inspetor',
    !inspetorScan.document.getElementById('irChecklistBtn').classList.contains('hidden'));
}

// ---------------------------------------------------------------------------
// 9. Painel Geral: Visão Própria nos registros de auditoria (RF 1.1/1.2)
// ---------------------------------------------------------------------------
async function secaoPainelAuditoria() {
  log('\n9. Painel Geral: log de alterações e trail de decisões por camada de visão');

  const CODIGO_SESSAO = sessao('ESTIVADOR').codigo_individual; // NX-9001-SP (harness)
  const banco = bancoBase();
  banco.tabelas.logs_alteracoes.push({
    data_hora: new Date().toISOString(), codigo_individual: CODIGO_SESSAO, cargo: 'ESTIVADOR',
    entidade_tipo: 'cargas', entidade_id: 'CRG-I-3', tipo_alteracao: 'MOVIMENTACAO', funcionario_id: null
  });
  banco.tabelas.trail_decisoes.push({
    id: UUID(90), data_hora: new Date().toISOString(), tipo_decisao: 'LIBEROU_NAVIO',
    entidade_tipo: 'NAVIO', entidade_id: 'IMO7000001', codigo_individual: CODIGO_SESSAO,
    motivo: 'Decisão da própria sessão', funcionarios: null, retificacoes_trail: []
  });
  banco.tabelas.trail_decisoes.push({
    id: UUID(91), data_hora: new Date().toISOString(), tipo_decisao: 'CANCELOU_ENTREGA',
    entidade_tipo: 'CARGA', entidade_id: 'CRG-I-1', codigo_individual: 'NX-7002-GT',
    motivo: 'Decisão de outro cargo', funcionarios: { nome: 'Colega Inspetora', cargo: 'INSPETOR' },
    retificacoes_trail: []
  });

  const abrirPainel = (cargo) => abrir('dashboard.html', cargo, { banco });
  const linhasDoLog = (w) => linhasDaTabela(w, 'auditLogTableBody');
  const textoDoTrail = (w) => ((w.document.getElementById('trailDecisoesContainer') || {}).textContent || '');

  for (const cargo of ['ESTIVADOR', 'TECNICO_PORTOS']) {
    const { w } = await abrirPainel(cargo);
    const linhas = linhasDoLog(w);
    const contador = (w.document.getElementById('auditLogCounter') || {}).textContent || '';
    check(`${cargo}: o log de alterações mostra só os próprios registros (1 de 1)`,
      linhas.length === 1 && /Exibindo 1 de 1/.test(contador), `${linhas.length} linha(s) | ${contador}`);
    check(`${cargo}: o contador declara o escopo de Visão Própria`,
      /Visão Própria/.test(contador), contador);
    check(`${cargo}: nome de outro funcionário não aparece no log`,
      !/Colega/.test(linhas.map((tr) => tr.textContent).join(' ')));
    check(`${cargo}: o trail de decisões mostra só a própria decisão`,
      /Decisão da própria sessão/.test(textoDoTrail(w)) && !/Decisão de outro cargo/.test(textoDoTrail(w)));
    check(`${cargo}: o trail explica o recorte de Visão Própria`,
      /Visão Própria/.test((w.document.getElementById('trailDecisoesSubtitulo') || {}).textContent || ''));
  }

  for (const cargo of ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE']) {
    const { w } = await abrirPainel(cargo);
    const linhas = linhasDoLog(w);
    const contador = (w.document.getElementById('auditLogCounter') || {}).textContent || '';
    check(`${cargo}: lê o log operacional completo (3 de 3) sem marca de Visão Própria`,
      linhas.length === 3 && /Exibindo 3 de 3/.test(contador) && !/Visão Própria/.test(contador), `${linhas.length} | ${contador}`);
    check(`${cargo}: o trail de decisões traz também a decisão de outro cargo`,
      /Decisão da própria sessão/.test(textoDoTrail(w)) && /Decisão de outro cargo/.test(textoDoTrail(w)));
  }

  const { w } = await abrirPainel('ESTIVADOR');
  const V = w.NexusVision;
  check('a Vision Layer expõe a regra única do recorte de auditoria',
    typeof V.filtrarRegistrosDeVisaoPropria === 'function' && typeof V.CARGOS_OPERACIONAIS !== 'undefined');
  const registros = [
    { codigo_usuario: CODIGO_SESSAO, motivo: 'próprio' },
    { codigo_individual: 'NX-0000-XX', motivo: 'de outro' },
    { funcionario_id: 'f-de-outro', motivo: 'de outro id' },
    { responsavel: 'Outro Nome (Inspetor) - NX-0000-XX', motivo: 'de outro responsável' }
  ];
  const filtrados = V.filtrarRegistrosDeVisaoPropria(registros, sessao('ESTIVADOR'));
  check('o filtro casa por código do usuário, por funcionario_id e pelo código do responsável no trail',
    filtrados.length === 1 && filtrados[0].motivo === 'próprio', JSON.stringify(filtrados));
  check('para Inspetor/Supervisor/Direção o filtro devolve a lista intacta',
    ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE']
      .every((c) => V.filtrarRegistrosDeVisaoPropria(registros, sessao(c)).length === registros.length));
}

(async function principal() {
  console.log('\n=== Tarefa I — permissões e visual por cargo (menu lateral × URL direta) ===');
  secaoMatriz();
  await secaoMenu();
  await secaoUrlDireta();
  await secaoEstivador();
  await secaoConferente();
  await secaoArrumador();
  await secaoPlanejador();
  await secaoTecnico();
  await secaoPainelAuditoria();

  janelas.forEach((w) => { try { w.close(); } catch (e) {} });
  const { total, falhas } = resumo();
  process.stdout.write(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).\n`);
  process.exit(falhas === 0 ? 0 : 1);
})();
