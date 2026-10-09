/**
 * Testes de regressão de XSS (DOM-based) - NexusPort
 *
 * Executa as páginas reais em um DOM (jsdom), injeta payloads de ataque em
 * todas as fontes de dados não confiáveis (localStorage / sessão / QR Code) e
 * verifica que:
 *   1. nenhum script ou manipulador inline é executado;
 *   2. nenhum elemento HTML injetado é criado no DOM;
 *   3. o conteúdo malicioso aparece como TEXTO (devidamente codificado).
 *
 * Uso: npm run test:xss   (ou: node tests/xss.test.js)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const xssScan = require('../tools/xss-scan.js');

/* ------------------------------------------------------------------ *
 * Payloads de ataque
 * ------------------------------------------------------------------ */
const PAYLOADS = {
  htmlEvent: `<img src=x onerror="window.__xss=(window.__xss||0)+1">`,
  svgEvent: `<svg/onload=window.__xss=(window.__xss||0)+1>`,
  tagBreak: `</button><script>window.__xss=(window.__xss||0)+1<\/script>`,
  attrBreak: `" onmouseover="window.__xss=(window.__xss||0)+1`,
  jsBreakParen: `');window.__xss=(window.__xss||0)+1;('`,
  jsBreakConcat: `'+window.__xss+='`,
  jsBreakTemplate: '`+window.__xss+`',
  entityTrick: `&#60;img src=x onerror=window.__xss=1&#62;`,
  backslash: `\\');window.__xss=(window.__xss||0)+1;//`,
  handlerExec: `x'),window.__xss=(window.__xss||0)+1,('`
};

const PAYLOAD_LIST = Object.values(PAYLOADS);

/** Erros esperados no ambiente de teste (CDNs e navegação não disponíveis no jsdom). */
const EXPECTED_ERROR_PATTERNS = [
  /tailwind is not defined/,
  /NexusAuth is not defined/,
  /NexusRepository is not defined/,
  /Not implemented: navigation/,
  /Could not parse CSS/,
  /^Error: Not implemented/
];

const SESSION = {
  id: '11111111-1111-1111-1111-111111111111',
  matricula: '888001',
  codigo_individual: 'SUP-2001',
  nome: 'Supervisor de Testes',
  cargo: 'SUPERVISOR_GERENTE_OPERACOES',
  cargo_nome: 'Supervisor de Operações',
  nivel: 'Nível Tático/Gestão',
  camada_visao: 'Visão Operacional'
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function firstPayload(p) {
  return p || PAYLOADS.htmlEvent;
}

/**
 * Carrega uma página real do sistema em jsdom, executa os módulos JS locais
 * (na mesma ordem dos <script> do HTML) e devolve o contexto carregado.
 */
async function loadApp(pageFile, { scripts, seed, session = SESSION }) {
  const html = readFile(pageFile);
  const virtualConsole = new VirtualConsole();
  // Erros das tags inline (ex.: Tailwind CDN ausente no ambiente de teste) são esperados.
  const runtimeErrors = [];
  const EXPECTED = /tailwind is not defined|NexusAuth is not defined|Not implemented: navigation|Could not parse CSS|^Error: Not implemented/;
  virtualConsole.on('jsdomError', (err) => {
    const msg = String((err && err.message) || err);
    if (!EXPECTED.test(msg)) runtimeErrors.push(msg);
  });
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  const dom = new JSDOM(html, {
    url: `http://localhost:3000/${pageFile}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  // Sessão ativa (mesma estrutura gravada por js/pages/confirm-role.js)
  window.localStorage.setItem('nexus_session', JSON.stringify(session));
  window.sessionStorage.setItem('nexus_session', JSON.stringify(session));
  window.localStorage.setItem('nexus_ghost_clean_v1', 'true');

  // Semente de dados controlada pelo atacante
  Object.entries(seed || {}).forEach(([key, value]) => {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  });

  // Carrega os módulos locais como <script> dinâmico (executa no contexto da página)
  const files = ['js/security.js', 'js/auth-guard.js', ...scripts];
  window.eval(readFile('js/security.js'));
  window.eval(readFile('js/auth-guard.js'));
  window.currentUserSession = window.NexusAuth.getSession();
  for (const file of files.slice(2)) {
    window.eval(readFile(file));
  }

  // Dispara o ciclo de vida dos módulos de página
  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  dom.__runtimeErrors = runtimeErrors;
  return dom;
}

/** Falha se os módulos da página lançaram exceções inesperadas durante o render. */
function assertNoRuntimeErrors(collected, label, dom) {
  const real = (dom.__runtimeErrors || []).filter(m => !EXPECTED_ERROR_PATTERNS.some(re => re.test(m)));
  if (real.length > 0) {
    fail(collected, label, `erros de execução no render: ${real.slice(0, 2).join(' | ')}`);
  }
}

function fail(list, label, detail) {
  list.push(`${label}: ${detail}`);
}

function assertNoXss(collected, label, window, document, containers = []) {
  if (window.__xss !== undefined && window.__xss !== 0) {
    fail(collected, label, `payload executado (window.__xss=${window.__xss})`);
  }
  // Marcadores dos payloads só existem no DOM se o HTML foi interpretado.
  // `onmouseover` cobre o vetor de quebra de atributo (PAYLOADS.attrBreak) e não
  // é usado legitimamente em nenhum ponto da aplicação.
  const injected = document.querySelectorAll('img[src="x"], [onmouseover]');
  if (injected.length > 0) {
    const tags = Array.from(injected).map(e => e.tagName.toLowerCase()).join(',');
    fail(collected, label, `elementos/atributos injetados no DOM: ${tags}`);
  }
  // Nenhum <script> pode ter sido criado dentro das áreas renderizadas.
  containers.filter(Boolean).forEach(c => {
    const bad = c.querySelectorAll('script, img[src="x"], [onerror], [onload], [onmouseover], [href^="javascript:"]');
    if (bad.length > 0) {
      fail(collected, label,
        `conteúdo injetado em área renderizada: ${Array.from(bad).map(e => e.tagName.toLowerCase()).join(',')}`);
    }
  });
}

function assertRenderedAsText(collected, label, container, needle) {
  if (!container) {
    fail(collected, label, 'contêiner de renderização não encontrado');
    return;
  }
  if (!container.textContent.includes(needle)) {
    fail(collected, label,
      `conteúdo não foi renderizado como texto (esperado literal "${needle.slice(0, 24)}…")`);
  }
}

/* ------------------------------------------------------------------ *
 * Cenários
 * ------------------------------------------------------------------ */
async function scenarioCargas(collected) {
  const label = 'cargas.html';
  const carga = {
    id: PAYLOADS.jsBreakParen,
    tipo: PAYLOADS.htmlEvent,
    natureza: PAYLOADS.svgEvent,
    peso: '10 t',
    volume: '20 m³',
    valor: 'R$ 1.000',
    portoDescarga: PAYLOADS.attrBreak,
    destino: PAYLOADS.tagBreak,
    status: 'ARMAZENAGEM',
    container: PAYLOADS.entityTrick,
    navio: PAYLOADS.backslash,
    qrCode: PAYLOADS.jsBreakConcat,
    data_cadastro: new Date().toISOString()
  };
  const dom = await loadApp('cargas.html', {
    scripts: ['js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/pages/cargas.js'],
    seed: { nexus_cargas_fluxo: [carga], nexus_containers_list: [] }
  });
  const { window } = dom;
  const document = window.document;
  const tbody = document.getElementById('cargasTableBody');

  assertNoXss(collected, label, window, document, [tbody]);
  assertRenderedAsText(collected, label, tbody, '<img src=x');

  // O argumento do manipulador inline deve sobreviver como dado, sem quebrar a string JS
  const qrButton = Array.from(tbody.querySelectorAll('button'))
    .find(b => (b.getAttribute('onclick') || '').includes('exibirEtiquetaQr'));
  if (!qrButton) {
    fail(collected, label, 'botão de QR Code não renderizado');
  } else {
    const onclick = qrButton.getAttribute('onclick');
    if (/onclick=/i.test(onclick) || /<script/i.test(onclick)) {
      fail(collected, label, 'manipulador inline contém marcação injetada');
    }
    let executou = false;
    window.exibirEtiquetaQr = () => { executou = true; };
    qrButton.click();
    if (window.__xss) {
      fail(collected, label, `manipulador inline executou payload (__xss=${window.__xss})`);
    }
    if (!executou) {
      fail(collected, label, 'manipulador inline não invocou a função esperada (quebra funcional)');
    }
  }

  dom.window.close();
}

/**
 * Vetor de quebra de ATRIBUTO: o identificador do contêiner é renderizado
 * dentro de `data-identificacao="..."` e no texto da <option>. Um valor com
 * `"` fecharia o atributo e criaria um manipulador de evento (onmouseover)
 * caso não fosse codificado.
 */
async function scenarioModalVinculacao(collected) {
  const label = 'cargas.html (modal de vinculação)';
  const carga = {
    id: 'CRG-2026-500',
    tipo: 'Carga Geral',
    natureza: 'Geral',
    peso: '10 t',
    volume: '20 m³',
    valor: 'R$ 1',
    portoDescarga: 'Pátio STS-01',
    destino: 'Destino',
    status: 'ARMAZENAGEM',
    container: '',
    navio: '',
    qrCode: 'QR-CRG-2026-500',
    data_cadastro: new Date().toISOString()
  };
  const containerMalicioso = {
    id: 'CONT-MAL',
    identificacao: PAYLOADS.attrBreak,
    tipo: PAYLOADS.svgEvent,
    estado: 'OPERANTE'
  };

  const dom = await loadApp('cargas.html', {
    scripts: ['js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/pages/cargas.js'],
    seed: {
      nexus_cargas_fluxo: [carga],
      nexus_containers_list: [containerMalicioso]
    }
  });
  const { window } = dom;
  const document = window.document;
  const select = document.getElementById('vincularContainerSelect');

  if (!select || typeof window.abrirModalVinculacao !== 'function') {
    fail(collected, label, 'modal de vinculação indisponível na página');
    dom.window.close();
    return;
  }

  await window.abrirModalVinculacao(carga.id);

  assertNoXss(collected, label, window, document, [select, document.getElementById('vincularModal')]);
  assertRenderedAsText(collected, label, select, 'onmouseover');

  // Integridade funcional: a codificação deve ser reversível pelo parser,
  // preservando o valor original no atributo data-identificacao.
  const opcao = Array.from(select.options).find(o => o.getAttribute('data-identificacao') === PAYLOADS.attrBreak);
  if (!opcao) {
    fail(collected, label, 'data-identificacao não preservou o valor original (codificação destrutiva)');
  }
  assertNoRuntimeErrors(collected, label, dom);
  dom.window.close();
}

/**
 * Vetor mais grave: injeção em atributo de evento inline. Aqui o payload fecha
 * a string JavaScript e injeta código sintaticamente válido — se a codificação
 * estiver ausente, o clique executa o código do atacante.
 */
async function scenarioInlineHandlerExecution(collected) {
  const label = 'cargas.html (onclick)';
  const carga = {
    id: PAYLOADS.handlerExec,
    tipo: 'Carga Geral',
    natureza: 'Geral',
    peso: '10 t',
    volume: '20 m³',
    valor: 'R$ 1',
    portoDescarga: 'Pátio',
    destino: 'Destino',
    status: 'ARMAZENAGEM',
    container: '',
    navio: '',
    qrCode: 'QR-TESTE',
    data_cadastro: new Date().toISOString()
  };
  const dom = await loadApp('cargas.html', {
    scripts: ['js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/pages/cargas.js'],
    seed: { nexus_cargas_fluxo: [carga], nexus_containers_list: [] },
    session: { ...SESSION, cargo: 'ESTIVADOR', cargo_nome: 'Estivador' }
  });
  const { window } = dom;
  const document = window.document;
  const btn = Array.from(document.querySelectorAll('#cargasTableBody button'))
    .find(b => /Movimentar/.test(b.textContent));

  if (!btn) {
    fail(collected, label, 'botão com manipulador inline não renderizado');
    dom.window.close();
    return;
  }

  let chamadoCom = null;
  window.executarAcaoCarga = (id, acao) => { chamadoCom = { id, acao }; };
  btn.click();

  if (window.__xss !== undefined && window.__xss !== 0) {
    fail(collected, label, `payload executado ao clicar no botão (window.__xss=${window.__xss})`);
  }
  if (!chamadoCom) {
    fail(collected, label, 'manipulador inline não foi executado (quebra funcional)');
  } else if (chamadoCom.id !== carga.id) {
    fail(collected, label, `argumento corrompido: recebido "${String(chamadoCom.id).slice(0, 40)}"`);
  }
  assertNoXss(collected, label, window, document, [document.getElementById('cargasTableBody')]);
  dom.window.close();
}

async function scenarioDashboard(collected) {
  const label = 'dashboard.html';
  const log = {
    data_hora: new Date().toISOString(),
    nome_funcionario: PAYLOADS.htmlEvent,
    cargo: PAYLOADS.svgEvent,
    codigo_usuario: PAYLOADS.jsBreakParen,
    entidade: PAYLOADS.tagBreak,
    tipo_alteracao: PAYLOADS.attrBreak
  };
  const trail = {
    id: PAYLOADS.jsBreakConcat,
    dbId: PAYLOADS.jsBreakParen,
    data_hora: new Date().toISOString(),
    responsavel: PAYLOADS.htmlEvent,
    decisao: PAYLOADS.svgEvent,
    entidade: PAYLOADS.entityTrick,
    motivo: PAYLOADS.backslash,
    retificacao: PAYLOADS.tagBreak
  };
  const dom = await loadApp('dashboard.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/pages/dashboard.js'],
    seed: {
      nexus_audit_logs: [log],
      nexus_trail_decisoes: [trail],
      nexus_cargas_fluxo: [],
      nexus_navios_list: [],
      nexus_containers_list: [],
      nexus_os_list: []
    },
    session: { ...SESSION, nome: PAYLOADS.htmlEvent, cargo_nome: PAYLOADS.svgEvent }
  });
  const { window } = dom;
  const document = window.document;

  const auditBody = document.getElementById('auditLogTableBody');
  const trailBox = document.getElementById('trailDecisoesContainer');
  assertNoXss(collected, label, window, document, [auditBody, trailBox]);
  // Sessão envenenada não pode injetar marcação no topbar (layout.js)
  const topbar = document.getElementById('appTopbar');
  if (topbar && topbar.querySelector('img[src="x"], [onerror], [onload], script, [href^="javascript:"]')) {
    fail(collected, label + ' (layout)', 'sessão envenenada injetou marcação no topbar/sidebar');
  }
  assertRenderedAsText(collected, label, auditBody, '<img src=x');
  assertRenderedAsText(collected, label, trailBox, 'onerror');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

async function scenarioEmbarcacoes(collected) {
  const label = 'embarcacoes.html';
  const navio = {
    id: '22222222-2222-2222-2222-222222222222',
    nome: PAYLOADS.htmlEvent,
    imo: PAYLOADS.jsBreakParen,
    gps: PAYLOADS.svgEvent,
    localizacao: 'DENTRO_DO_PORTO',
    origem: PAYLOADS.tagBreak,
    destino: PAYLOADS.attrBreak,
    distancia: 100
  };
  const dom = await loadApp('embarcacoes.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/pages/embarcacoes.js'],
    seed: {
      nexus_navios_list: [navio],
      nexus_bercos_list: [{ id: 'B1', nome: PAYLOADS.htmlEvent, estado: 'OCUPADO', navio_nome: PAYLOADS.svgEvent }],
      nexus_containers_list: [{ id: 'C1', identificacao: PAYLOADS.jsBreakParen, tipo: PAYLOADS.htmlEvent, estado: 'OPERANTE', navio: PAYLOADS.entityTrick }],
      nexus_guindastes_list: [{ id: 'G1', identificacao: PAYLOADS.jsBreakConcat, estado: 'OPERANTE', dataManut: PAYLOADS.attrBreak }],
      nexus_cargas_fluxo: []
    }
  });
  const { window } = dom;
  const document = window.document;
  const gpsBody = document.getElementById('embarcacoesGpsTableBody');
  const bercosGrid = document.getElementById('bercosGrid');
  const contBody = document.getElementById('containersTableBody');
  const gndBody = document.getElementById('guindastesTableBody');
  assertNoXss(collected, label, window, document, [gpsBody, bercosGrid, contBody, gndBody]);
  assertRenderedAsText(collected, label, gpsBody, '<img src=x');
  assertRenderedAsText(collected, label, contBody, '<img src=x');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

async function scenarioManutencao(collected) {
  const label = 'manutencao.html';
  const os = {
    id: PAYLOADS.jsBreakParen,
    equipamento: PAYLOADS.htmlEvent,
    prioridade: 'ALTA',
    descricao: PAYLOADS.svgEvent,
    data: PAYLOADS.attrBreak,
    status: 'PENDENTE_APROVACAO'
  };
  const dom = await loadApp('manutencao.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/pages/manutencao.js'],
    seed: {
      nexus_os_list: [os],
      nexus_guindastes_list: [{ identificacao: PAYLOADS.jsBreakConcat, dataManut: '' }],
      nexus_containers_list: [],
      nexus_navios_list: []
    }
  });
  const { window } = dom;
  const document = window.document;
  const osBody = document.getElementById('osTableBody');
  assertNoXss(collected, label, window, document, [osBody]);
  assertRenderedAsText(collected, label, osBody, '<img src=x');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

async function scenarioTecnicoPortos(collected) {
  const label = 'tecnico_portos.html';
  const dom = await loadApp('tecnico_portos.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/pages/tecnico_portos.js'],
    seed: {
      nexus_func_list: [{
        matricula: PAYLOADS.jsBreakParen,
        nome: PAYLOADS.htmlEvent,
        cargo: PAYLOADS.svgEvent,
        codigo: PAYLOADS.backslash,
        doc: PAYLOADS.tagBreak,
        ativo: true
      }],
      nexus_vis_list: [{
        id: PAYLOADS.jsBreakConcat,
        nome: PAYLOADS.htmlEvent,
        documento: PAYLOADS.entityTrick,
        motivo: PAYLOADS.attrBreak,
        status: 'EM_VISITA',
        data: PAYLOADS.svgEvent,
        por: PAYLOADS.tagBreak
      }]
    }
  });
  const { window } = dom;
  const document = window.document;
  const funcBody = document.getElementById('funcCrudTableBody');
  const visBody = document.getElementById('visCrudTableBody');
  assertNoXss(collected, label, window, document, [funcBody, visBody]);
  assertRenderedAsText(collected, label, funcBody, '<img src=x');
  assertRenderedAsText(collected, label, visBody, '<img src=x');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

async function scenarioRelatorios(collected) {
  const label = 'relatorios.html';
  const dom = await loadApp('relatorios.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/pages/relatorios.js'],
    seed: {
      nexus_cargas_fluxo: [{
        id: PAYLOADS.jsBreakParen,
        tipo: PAYLOADS.htmlEvent,
        status: 'ARMAZENAGEM',
        peso: '1 t',
        volume: '1 m³',
        portoDescarga: PAYLOADS.svgEvent
      }],
      nexus_audit_logs: [{
        data_hora: new Date().toISOString(),
        nome: PAYLOADS.htmlEvent,
        cargo: PAYLOADS.svgEvent,
        codigo_usuario: 'SP-1',
        entidade: 'CARGA',
        tipo_alteracao: 'EDICAO'
      }],
      nexus_func_list: [{
        matricula: PAYLOADS.jsBreakConcat,
        nome: PAYLOADS.htmlEvent,
        cargo: PAYLOADS.svgEvent
      }]
    },
    session: {
      ...SESSION,
      matricula: 'DIR-0001',
      codigo_individual: 'DIR-0001',
      cargo: 'DIRETOR_OPERACOES_LOGISTICA',
      cargo_nome: 'Diretor de Operações'
    }
  });
  const { window } = dom;
  const document = window.document;
  const prodBody = document.getElementById('produtividadeTableBody');
  assertNoXss(collected, label, window, document, [prodBody]);
  assertRenderedAsText(collected, label, prodBody, '<img src=x');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

async function scenarioInspecao(collected) {
  const label = 'inspecao.html';
  const dom = await loadApp('inspecao.html', {
    scripts: ['js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/pages/inspecao.js'],
    seed: {
      nexus_cargas_fluxo: [{
        id: 'CRG-2026-777',
        tipo: PAYLOADS.htmlEvent,
        status: 'RECEBIMENTO_INSPECAO',
        peso: '1 t',
        volume: '1 m³',
        portoDescarga: PAYLOADS.svgEvent
      }]
    },
    session: { ...SESSION, nome: PAYLOADS.htmlEvent, codigo_individual: PAYLOADS.jsBreakParen }
  });
  const { window } = dom;
  const document = window.document;
  const select = document.getElementById('inspecaoCargaSelect');
  assertNoXss(collected, label, window, document, [select]);
  assertRenderedAsText(collected, label, select, '<img src=x');
  assertNoRuntimeErrors(collected, label, dom);

  dom.window.close();
}

/* ------------------------------------------------------------------ *
 * Verificações unitárias (helpers de segurança e heurísticas do scanner)
 * ------------------------------------------------------------------ */
async function runUnitChecks(collected) {
  // --- js/security.js :: safeUrl (allowlist de esquema) ---
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://host/dir/page.html',
    runScripts: 'dangerously'
  });
  dom.window.eval(readFile('js/security.js'));
  const safeUrl = dom.window.NexusSecurity && dom.window.NexusSecurity.safeUrl;
  if (typeof safeUrl !== 'function') {
    fail(collected, 'safeUrl', 'js/security.js não expõe NexusSecurity.safeUrl');
  }

  const bloqueados = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)',
    'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>',
    'blob:https://evil/x', 'file:///etc/passwd',
    'ms-msdt:/id', 'intent://x', 'jar:http://evil/x.zip!/y', 'view-source:https://x',
    'anexo:1', 'a:b', 'x.html:8080/y'
  ];
  const permitidos = [
    'https://ok.example/a', 'http://ok.example', 'mailto:a@b.com', 'tel:+5511',
    'cargas.html?carga=1', './rel.html', '../x.html', '/abs/path', '#anchor', '?q=1',
    '//host/x', 'foo/bar:baz'
  ];

  for (const valor of bloqueados) {
    const out = typeof safeUrl === 'function' ? safeUrl(valor) : valor;
    if (out !== '#') fail(collected, 'safeUrl', `esquema não allowlistado aceito: ${JSON.stringify(valor)} => ${JSON.stringify(out)}`);
  }
  for (const valor of permitidos) {
    const out = typeof safeUrl === 'function' ? safeUrl(valor) : '';
    if (out === '#') fail(collected, 'safeUrl', `referência válida recusada: ${JSON.stringify(valor)}`);
  }
  // Round-trip pelo parser HTML: o valor efetivo não pode resultar em esquema perigoso.
  for (const valor of bloqueados) {
    if (typeof safeUrl !== 'function') break;
    const probe = new JSDOM(`<a id="l" href="${safeUrl(valor)}">x</a>`, { url: 'https://host/dir/page.html' });
    const href = probe.window.document.getElementById('l').getAttribute('href');
    let proto = null;
    try { proto = new probe.window.URL(href, 'https://host/dir/page.html').protocol; } catch (e) { proto = 'INVALID'; }
    if (proto && !['http:', 'https:', 'mailto:', 'tel:'].includes(proto)) {
      fail(collected, 'safeUrl', `esquema efetivo fora do allowlist após parsing: ${JSON.stringify(valor)} => ${proto}`);
    }
  }
  dom.window.close();

  // --- tools/xss-scan.js :: heurísticas (sem prefixo nem match parcial) ---
  const seguras = [
    'esc(a)', "esc(cond ? a : 'x')",
    'cond ? esc(a) : esc(b)', "a ? b ? 'x' : 'y' : 'z'",
    "cond ? `x ${esc(raw)}` : ''", 'index + 1', 'items.length',
    "new Date(x).toLocaleString('pt-BR')", 'Number(x)', 'key', 'actionButtonsHtml'
  ];
  const inseguras = [
    'esc(a) + rawUser', 'rawUser + esc(a)', "cond ? rawUser : 'static'",
    "cond ? 'static' : rawUser", "cond ? `x ${rawUser}` : ''", 'index + rawUser',
    'items.length + rawUser', 'new Date(x) + rawUser',
    "new Date(x).toLocaleString('pt-BR') + rawUser", 'Number(x) + rawUser',
    "x.toLocaleString('pt-BR')", 'rawUser', "a ? 'x' : b ? rawUser : 'z'"
  ];
  for (const expr of seguras) {
    if (!xssScan.isSafeExpression(expr)) {
      fail(collected, 'xss-scan', `expressão segura reprovada (falso positivo): ${JSON.stringify(expr)}`);
    }
  }
  for (const expr of inseguras) {
    if (xssScan.isSafeExpression(expr)) {
      fail(collected, 'xss-scan', `expressão insegura aprovada (falso negativo): ${JSON.stringify(expr)}`);
    }
  }

  // --- gate: nenhuma interpolação não codificada no código atual ---
  // Varredura RECURSIVA: js/pages/ e js/webmcp/ também entram no gate.
  const jsDir = path.join(ROOT, 'js');
  const alvos = xssScan.listarArquivosJs(jsDir)
    .filter(f => path.basename(f) !== 'security.js');
  const achados = alvos.flatMap(f => xssScan.scan(f).map(x => `${path.relative(jsDir, f)}:${x.line}`));
  if (achados.length > 0) {
    fail(collected, 'xss-scan', `interpolações não codificadas: ${achados.slice(0, 3).join(', ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * Execução
 * ------------------------------------------------------------------ */
async function main() {
  const collected = [];
  const scenarios = [
    ['cargas.html', scenarioCargas],
    ['cargas.html (onclick)', scenarioInlineHandlerExecution],
    ['cargas.html (modal vinculação)', scenarioModalVinculacao],
    ['dashboard.html', scenarioDashboard],
    ['embarcacoes.html', scenarioEmbarcacoes],
    ['manutencao.html', scenarioManutencao],
    ['tecnico_portos.html', scenarioTecnicoPortos],
    ['relatorios.html', scenarioRelatorios],
    ['inspecao.html', scenarioInspecao]
  ];

  console.log('Executando testes de regressão XSS (jsdom)\n');
  console.log(`Payloads testados: ${PAYLOAD_LIST.length}\n`);

  const falhasAntes = collected.length;
  await runUnitChecks(collected);
  console.log(`  ${collected.length === falhasAntes ? '✓' : '✗'} verificações unitárias (safeUrl + heurísticas do scanner)\n`);

  for (const [name, fn] of scenarios) {
    const antes = collected.length;
    try {
      await fn(collected);
      const ok = collected.length === antes;
      console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    } catch (err) {
      fail(collected, name, `exceção durante a execução: ${err && err.message}`);
      console.log(`  ✗ ${name} (exceção)`);
    }
  }

  console.log('');
  if (collected.length > 0) {
    console.log('❌ Falhas encontradas:');
    collected.forEach(f => console.log(`   - ${f}`));
    process.exit(1);
  }
  console.log('✅ Nenhum XSS explorável detectado. Todos os payloads foram renderizados como texto.');
  process.exit(0);
}

main().catch(err => {
  console.error('Erro inesperado na suíte de testes:', err);
  process.exit(1);
});
