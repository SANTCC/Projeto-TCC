/**
 * Testes de regressão — erros de gravação vistos no console em produção
 *
 * Cobre, executando as páginas reais em jsdom com um cliente Supabase simulado:
 *   1. Login por matrícula: a busca por codigo_individual não pode usar
 *      .single(), que responde 406 (PGRST116) quando não há nenhuma linha.
 *   2. Inspeção com histórico (política C): reinspecionar uma carga marca a
 *      inspeção ativa anterior como histórico e grava a nova como ativa.
 *   3. Inspeção: quando o banco recusa uma gravação (corrida que viola o índice
 *      de inspeção ativa, falha ao desativar a anterior, itens recusados, carga
 *      ausente ou falha de rede), a tela não mostra "concluída", não redireciona
 *      e avisa o operador. A função retorna false, e é isso que o WebMCP usa
 *      para não dizer "APROVADA".
 *
 * Executar: node tests/test_gravacao_inspecao_login.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SESSION = {
  matricula: '888001',
  codigo_individual: 'SUP-2001',
  nome: 'Supervisor de Testes',
  cargo: 'SUPERVISOR_GERENTE_OPERACOES',
  cargo_nome: 'Supervisor de Operações',
  camada_visao: 'Visão Operacional'
};

const CARGA = {
  id: 'CRG-TESTE-1',
  rawDbId: '3a9c6ecc-09fd-4fde-b99d-b0fae7173217',
  tipo: 'Carga Geral',
  qrCode: 'QR-CRG-TESTE-1',
  portoDescarga: 'Santos',
  status: 'RECEBIMENTO_INSPECAO'
};

// Corrida: outra gravação ativa da mesma carga entrou antes (índice uq_inspecoes_carga_ativa).
const ERRO_INSPECAO_ATIVA_DUPLICADA = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "uq_inspecoes_carga_ativa"',
  details: 'Key (carga_id)=(3a9c6ecc-09fd-4fde-b99d-b0fae7173217) already exists.'
};
const ERRO_RLS = {
  code: '42501',
  message: 'new row violates row-level security policy for table "inspecao_itens"'
};
const OK = { data: null, error: null };

// Itens do checklist já cadastrados no banco (a tela associa por ordem: 1..5).
const CHECKLIST_DB = [1, 2, 3, 4, 5].map((ordem) => ({
  id: `c0000000-0000-4000-8000-00000000000${ordem}`,
  ordem
}));

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

/**
 * Cliente Supabase falso: encadeia from/select/eq/insert/update e registra cada
 * consulta (tabela, operação, filtros, payload, terminal e status).
 * `tratar(q)` devolve { data, error, status }.
 */
function criarSupabaseFalso(tratar, registro) {
  return {
    from(tabela) {
      const q = { tabela, op: 'select', payload: null, filtros: [], terminal: null };
      const executar = () => {
        const resultado = tratar(q);
        registro.push({
          tabela,
          op: q.op,
          payload: q.payload,
          filtros: q.filtros.slice(),
          terminal: q.terminal,
          status: resultado.status || null
        });
        return resultado;
      };
      const builder = {
        select() { return builder; },
        insert(payload) { q.op = 'insert'; q.payload = payload; return builder; },
        update(payload) { q.op = 'update'; q.payload = payload; return builder; },
        eq(coluna, valor) { q.filtros.push([coluna, valor]); return builder; },
        order() { return builder; },
        maybeSingle() { q.terminal = 'maybeSingle'; return builder; },
        single() { q.terminal = 'single'; return builder; },
        then(ok, falha) { return Promise.resolve().then(executar).then(ok, falha); },
        catch(falha) { return Promise.resolve().then(executar).catch(falha); }
      };
      return builder;
    }
  };
}

/** Responde como o PostgREST: .single() exige exatamente 1 linha (0 linhas → 406 PGRST116). */
function respostaPostgrest(q, linhas) {
  const encontradas = linhas.filter((linha) =>
    q.filtros.every(([coluna, valor]) => String(linha[coluna]) === String(valor))
  );
  if (q.terminal === 'single') {
    if (encontradas.length === 1) return { data: encontradas[0], error: null, status: 200 };
    return {
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      status: 406
    };
  }
  return { data: encontradas[0] || null, error: null, status: 200 };
}

/**
 * Carrega uma página real em jsdom. `setup(window)` roda depois de js/security.js
 * e js/auth-guard.js e antes dos scripts da página, então é o lugar de injetar
 * o cliente falso e os espiões.
 */
async function loadPage(pageFile, { scripts = [], seed = {}, session = SESSION, setup = () => {} } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  const dom = new JSDOM(read(pageFile), {
    url: `http://localhost:3000/${pageFile}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;

  // jsdom não implementa window.matchMedia (usado pelo tema claro/escuro do login)
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    });
  }

  if (session) {
    window.localStorage.setItem('nexus_session', JSON.stringify(session));
    window.sessionStorage.setItem('nexus_session', JSON.stringify(session));
  }
  window.localStorage.setItem('nexus_ghost_clean_v1', 'true');

  Object.entries(seed).forEach(([key, value]) => {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  });

  window.eval(read('js/security.js'));
  window.eval(read('js/auth-guard.js'));
  window.currentUserSession = window.NexusAuth.getSession();
  setup(window);
  for (const file of scripts) {
    window.eval(read(file));
  }

  // O jsdom dispara o DOMContentLoaded nativo depois que os scripts foram avaliados.
  // Disparar outro manualmente registraria os handlers da página duas vezes.
  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  await sleep(150);
  return dom;
}

/* ------------------------------------------------------------------ *
 * 1. Login — matrícula não pode gerar 406 na busca por código
 * ------------------------------------------------------------------ */
async function testarLoginPorMatricula() {
  console.log('\n1. Login — matrícula digitada no campo de código (sem 406)');

  // Ignora comentários: o texto explicativo no próprio código cita ".single()".
  const codigoLogin = read('js/login.js').replace(/^\s*\/\/.*$/gm, '');
  check('js/login.js não usa .single() nas consultas de funcionários', !codigoLogin.includes('.single()'));

  const registro = [];
  const funcionarios = [
    { id: 'func-1', matricula: '777001', codigo_individual: 'NX-7770', nome: 'Operador de Teste', cargo: 'OPERADOR', ativo: true }
  ];
  const dom = await loadPage('index.html', {
    scripts: ['js/login.js'],
    session: null,
    setup(window) {
      window.nexusSupabase = criarSupabaseFalso((q) => respostaPostgrest(q, funcionarios), registro);
    }
  });
  const { window } = dom;
  window.document.getElementById('operatorCode').value = '777001';
  window.document
    .getElementById('loginForm')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(100);

  const pendente = window.sessionStorage.getItem('nexus_pending_auth');
  check('matrícula 777001 é reconhecida no login', Boolean(pendente) && JSON.parse(pendente).matricula === '777001', pendente);
  check('nenhuma consulta de funcionário recebe 406 (PGRST116)', !registro.some((r) => r.status === 406), JSON.stringify(registro));
  check(
    'busca por código e depois por matrícula, ambas com .maybeSingle()',
    registro.length === 2 && registro.every((r) => r.terminal === 'maybeSingle'),
    JSON.stringify(registro.map((r) => r.terminal))
  );
  window.close();
}

/* ------------------------------------------------------------------ *
 * 2 a 9. Inspeção — gravação com histórico e falhas
 * ------------------------------------------------------------------ */
async function prepararInspecao({
  cargaSelect = () => ({ data: { id: CARGA.rawDbId }, error: null }),
  inspecaoUpdate = () => OK,
  inspecaoInsert = () => ({ data: { id: 'insp-1' }, error: null }),
  itensInsert = () => OK,
  cargaUpdate = () => OK
} = {}) {
  const registro = [];
  const feedbacks = [];
  const redirecionamentos = [];

  const tratar = (q) => {
    if (q.tabela === 'cargas' && q.op === 'update') return cargaUpdate(q);
    if (q.tabela === 'cargas') return cargaSelect(q);
    if (q.tabela === 'inspecoes' && q.op === 'update') return inspecaoUpdate(q);
    if (q.tabela === 'inspecoes') return inspecaoInsert(q);
    if (q.tabela === 'inspecao_itens') return itensInsert(q);
    if (q.tabela === 'checklist_itens') return { data: CHECKLIST_DB, error: null };
    return OK;
  };

  const dom = await loadPage('inspecao.html', {
    scripts: ['js/inspecao.js'],
    seed: { nexus_cargas_fluxo: [CARGA] },
    setup(window) {
      window.nexusSupabase = criarSupabaseFalso(tratar, registro);
      window.mostrarFeedback = (tipo, titulo, mensagem) => feedbacks.push({ tipo, titulo, mensagem });
      const setTimeoutOriginal = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => {
        if (String(fn).includes('cargas.html')) redirecionamentos.push(ms);
        return setTimeoutOriginal(fn, ms, ...args);
      };
    }
  });

  const { window } = dom;
  const doc = window.document;
  doc.getElementById('inspecaoCargaSelect').value = CARGA.id;
  doc.getElementById('carregarChecklistBtn').click();
  // Marca todos os itens como CONFORME pelos mesmos controles de rádio que o operador usa
  doc.querySelectorAll('input[type="radio"][value="CONFORME"]').forEach((radio) => radio.click());
  await sleep(10);

  return { window, doc, registro, feedbacks, redirecionamentos };
}

/** Índice da primeira gravação na tabela inspecoes que casa com o predicado. */
function indiceInspecao(registro, op, predicado = () => true) {
  return registro.findIndex((r) => r.tabela === 'inspecoes' && r.op === op && predicado(r));
}

async function testarReinspecaoComHistorico() {
  console.log('\n2. Inspeção — reinspeção: a ativa anterior vira histórico e a nova fica ativa');

  const { window, doc, registro, feedbacks, redirecionamentos } = await prepararInspecao();
  check('checklist completo libera o botão de aprovação', !doc.getElementById('aprovarCargaBtn').disabled);
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  const iUpdate = indiceInspecao(registro, 'update', (r) => r.payload && r.payload.ativa === false);
  const iInsert = indiceInspecao(registro, 'insert');
  check(
    'a anterior é marcada como histórico (ativa = false) só para a carga e só se estava ativa',
    iUpdate !== -1 &&
      registro[iUpdate].filtros.some(([c, v]) => c === 'carga_id' && v === CARGA.rawDbId) &&
      registro[iUpdate].filtros.some(([c, v]) => c === 'ativa' && v === true),
    JSON.stringify(registro[iUpdate])
  );
  check('a desativação acontece antes da gravação da nova inspeção', iUpdate !== -1 && iInsert > iUpdate);
  check(
    'a nova inspeção é gravada como ativa, APROVADA e na carga correta',
    iInsert !== -1 &&
      registro[iInsert].payload.ativa === true &&
      registro[iInsert].payload.resultado === 'APROVADA' &&
      registro[iInsert].payload.carga_id === CARGA.rawDbId,
    JSON.stringify(registro[iInsert] && registro[iInsert].payload)
  );
  check('sucesso "Inspeção Concluída" é exibido', feedbacks.some((f) => f.tipo === 'sucesso' && f.titulo === 'Inspeção Concluída'), JSON.stringify(feedbacks));
  check('nenhum alerta de gravação incompleta', !feedbacks.some((f) => f.titulo === 'Gravação Incompleta'));
  check('redirecionamento para cargas.html é agendado', redirecionamentos.length === 1, String(redirecionamentos));
  check('itens do checklist gravados em inspecao_itens', registro.some((r) => r.tabela === 'inspecao_itens' && r.op === 'insert'));
  window.close();
}

async function testarCorridaInspecaoAtiva() {
  console.log('\n3. Inspeção — corrida: outra inspeção ativa foi gravada ao mesmo tempo (23505)');

  const { window, doc, feedbacks, redirecionamentos } = await prepararInspecao({
    inspecaoInsert: () => ({ data: null, error: ERRO_INSPECAO_ATIVA_DUPLICADA })
  });
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  const alerta = feedbacks.find((f) => f.titulo === 'Gravação Incompleta');
  check('a corrida mostra alerta "Gravação Incompleta"', Boolean(alerta) && alerta.tipo === 'alerta', JSON.stringify(feedbacks));
  check(
    'o alerta pede para atualizar a tela antes de tentar de novo',
    Boolean(alerta) && alerta.mensagem.includes('já tem uma inspeção ativa') && alerta.mensagem.includes('Atualize a tela'),
    alerta && alerta.mensagem
  );
  check('nenhuma mensagem de "Inspeção Concluída" é exibida', !feedbacks.some((f) => f.tipo === 'sucesso'));
  check('a tela não redireciona para cargas.html', redirecionamentos.length === 0, String(redirecionamentos));

  const gravou = await window.nexusInspecaoAprovar();
  check('nexusInspecaoAprovar retorna false (usado pelo WebMCP)', gravou === false, String(gravou));
  window.close();
}

async function testarFalhaAoDesativarAnterior() {
  console.log('\n4. Inspeção — falha ao marcar a inspeção anterior como histórico');

  const { window, doc, feedbacks, redirecionamentos } = await prepararInspecao({
    inspecaoUpdate: () => ({ data: null, error: { code: '42501', message: 'permission denied for table inspecoes' } })
  });
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  const alerta = feedbacks.find((f) => f.titulo === 'Gravação Incompleta');
  check(
    'alerta cita a inspeção anterior que não pôde virar histórico',
    Boolean(alerta) && alerta.mensagem.includes('não pôde ser marcada como histórico'),
    alerta && alerta.mensagem
  );
  check('sem sucesso e sem redirecionamento', !feedbacks.some((f) => f.tipo === 'sucesso') && redirecionamentos.length === 0);
  window.close();
}

async function testarRecusaComHistorico() {
  console.log('\n5. Inspeção — recusa de carga já inspecionada');

  const { window, registro, feedbacks, redirecionamentos } = await prepararInspecao();
  const gravou = await window.nexusInspecaoRecusar({ motivo: 'Lacre rompido na chegada' });

  const iUpdate = indiceInspecao(registro, 'update', (r) => r.payload && r.payload.ativa === false);
  const iInsert = indiceInspecao(registro, 'insert');
  check('a inspeção ativa anterior vira histórico antes da recusa', iUpdate !== -1 && iInsert > iUpdate);
  check(
    'a recusa é gravada como ativa com o motivo',
    iInsert !== -1 && registro[iInsert].payload.ativa === true && registro[iInsert].payload.observacoes === 'Lacre rompido na chegada',
    JSON.stringify(registro[iInsert] && registro[iInsert].payload)
  );
  check('mostra "Inspeção Registrada" como sucesso', feedbacks.some((f) => f.tipo === 'sucesso' && f.titulo === 'Inspeção Registrada'), JSON.stringify(feedbacks));
  check('recusa redireciona normalmente', redirecionamentos.length === 1);
  check('nexusInspecaoRecusar retorna true', gravou === true, String(gravou));
  window.close();
}

async function testarCorridaNaRecusa() {
  console.log('\n6. Inspeção — recusa com corrida (23505)');

  const { window, feedbacks, redirecionamentos } = await prepararInspecao({
    inspecaoInsert: () => ({ data: null, error: ERRO_INSPECAO_ATIVA_DUPLICADA })
  });
  const gravou = await window.nexusInspecaoRecusar({ motivo: 'Lacre rompido na chegada' });

  const alerta = feedbacks.find((f) => f.titulo === 'Gravação Incompleta');
  check(
    'alerta da recusa cita a recusa e a inspeção ativa existente',
    Boolean(alerta) && alerta.mensagem.includes('desta recusa') && alerta.mensagem.includes('já tem uma inspeção ativa'),
    alerta && alerta.mensagem
  );
  check('recusa não mostra "Inspeção Registrada" como sucesso', !feedbacks.some((f) => f.tipo === 'sucesso'));
  check('recusa não redireciona', redirecionamentos.length === 0, String(redirecionamentos));
  check('nexusInspecaoRecusar retorna false', gravou === false, String(gravou));
  window.close();
}

async function testarItensNaoGravados() {
  console.log('\n7. Inspeção — itens do checklist recusados pelo banco (RLS)');

  const { window, doc, feedbacks, redirecionamentos } = await prepararInspecao({
    itensInsert: () => ({ data: null, error: ERRO_RLS })
  });
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  const alerta = feedbacks.find((f) => f.titulo === 'Gravação Incompleta');
  check('falha nos itens mostra alerta', Boolean(alerta), JSON.stringify(feedbacks));
  check(
    'alerta cita os itens do checklist',
    Boolean(alerta) && alerta.mensagem.includes('Os itens do checklist não foram gravados'),
    alerta && alerta.mensagem
  );
  check('sem sucesso e sem redirecionamento', !feedbacks.some((f) => f.tipo === 'sucesso') && redirecionamentos.length === 0);
  window.close();
}

async function testarCargaAusenteNoBanco() {
  console.log('\n8. Inspeção — carga que não existe no banco');

  const { window, doc, registro, feedbacks, redirecionamentos } = await prepararInspecao({
    cargaSelect: () => ({ data: null, error: null })
  });
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  check(
    'carga ausente gera alerta explicando a ausência',
    feedbacks.some((f) => f.titulo === 'Gravação Incompleta' && f.mensagem.includes('não foi localizada no banco')),
    JSON.stringify(feedbacks)
  );
  check('nenhuma inspeção é alterada ou inserida sem carga no banco', !registro.some((r) => r.tabela === 'inspecoes'));
  check('sem sucesso e sem redirecionamento', !feedbacks.some((f) => f.tipo === 'sucesso') && redirecionamentos.length === 0);
  window.close();
}

async function testarFalhaDeRede() {
  console.log('\n9. Inspeção — falha de rede ao atualizar a carga');

  const { window, doc, registro, feedbacks, redirecionamentos } = await prepararInspecao({
    cargaUpdate: () => {
      throw new Error('rede indisponível');
    }
  });
  doc.getElementById('aprovarCargaBtn').click();
  await sleep(80);

  check(
    'falha de rede gera alerta de comunicação',
    feedbacks.some((f) => f.titulo === 'Gravação Incompleta' && f.mensagem.includes('Falha de comunicação com o banco (rede indisponível)')),
    JSON.stringify(feedbacks)
  );
  check('a inspeção não é gravada depois da falha', !registro.some((r) => r.tabela === 'inspecoes' && r.op === 'insert'));
  check('sem sucesso e sem redirecionamento', !feedbacks.some((f) => f.tipo === 'sucesso') && redirecionamentos.length === 0);
  window.close();
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log('================================================================');
  console.log('🧪 TESTES — ERROS DE GRAVAÇÃO (LOGIN POR MATRÍCULA E INSPEÇÃO)');
  console.log('================================================================');

  await testarLoginPorMatricula();
  await testarReinspecaoComHistorico();
  await testarCorridaInspecaoAtiva();
  await testarFalhaAoDesativarAnterior();
  await testarRecusaComHistorico();
  await testarCorridaNaRecusa();
  await testarItensNaoGravados();
  await testarCargaAusenteNoBanco();
  await testarFalhaDeRede();

  console.log('\n================================================================');
  if (passed) {
    console.log('🎉 GRAVAÇÕES DE LOGIN E INSPEÇÃO VALIDADAS COM SUCESSO! 🎉');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 FALHA EM UMA OU MAIS VERIFICAÇÕES.');
    console.log('================================================================');
    process.exit(1);
  }
})();
