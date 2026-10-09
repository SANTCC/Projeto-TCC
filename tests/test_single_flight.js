/**
 * Testes de regressão — single-flight das leituras do cliente Supabase
 *
 * Cobre, com o arquivo real js/supabase-client.js carregado em jsdom:
 *   1. GETs idênticos em voo viram UMA requisição; cada chamador recebe a sua resposta.
 *   2. URLs ou cabeçalhos diferentes não são agrupados.
 *   3. Depois de concluída, uma nova leitura volta à rede (não há cache).
 *   4. Uma mudança (evento nexus_data_changed ou escrita POST/PATCH) abre nova geração:
 *      a leitura seguinte não reaproveita resposta anterior à mudança.
 *   5. Erro de rede chega a todos os chamadores e não deixa entrada presa.
 *   6. Requisições com AbortSignal passam direto (não são agrupadas).
 *   7. Relatórios: atualização periódica a cada 30 s (antes 5 s).
 *
 * Executar: node tests/test_single_flight.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

/** Resposta falsa com clone(), como a Response do navegador. */
function criarResposta(corpo) {
  return {
    corpo,
    clone() {
      return criarResposta(corpo);
    }
  };
}

/** fetch falso: conta as requisições que realmente chegariam à rede. */
function criarFetchFalso({ atraso = 15, falha = null } = {}) {
  const chamadas = [];
  const fetchFalso = (input, init) => {
    chamadas.push({ input: String(input), method: (init && init.method) || 'GET' });
    const n = chamadas.length;
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (falha) reject(falha);
        else resolve(criarResposta(`resposta-${n}`));
      }, atraso);
    });
  };
  return { fetchFalso, chamadas };
}

/** Carrega js/supabase-client.js num documento vazio e devolve a janela. */
function carregarSupabaseClient() {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  // Sem a biblioteca supabase-js o módulo não cria cliente; a fábrica fica disponível.
  dom.window.eval(read('js/supabase-client.js'));
  return dom.window;
}

const URL_CARGAS = 'https://exemplo.supabase.co/rest/v1/cargas?select=*';
const URL_NAVIOS = 'https://exemplo.supabase.co/rest/v1/navios?select=*';
const CABECALHOS = { apikey: 'chave-anon', Authorization: 'Bearer token-1' };

/* ------------------------------------------------------------------ *
 * 1. Requisições idênticas em voo
 * ------------------------------------------------------------------ */
async function testarDeduplicacao() {
  console.log('\n1. Leituras idênticas em voo viram uma requisição');
  const window = carregarSupabaseClient();
  const { fetchFalso, chamadas } = criarFetchFalso();
  const sf = window.NexusSingleFlight.criar(fetchFalso).fetch;

  const respostas = await Promise.all(
    Array.from({ length: 9 }, () => sf(URL_CARGAS, { method: 'GET', headers: CABECALHOS }))
  );

  check('9 GETs idênticos em voo geram 1 requisição de rede', chamadas.length === 1, `chamadas=${chamadas.length}`);
  check('cada chamador recebe a sua própria resposta', new Set(respostas).size === 9);
  check('todos recebem o mesmo corpo', respostas.every((r) => r.corpo === respostas[0].corpo));

  const { fetchFalso: fetch2, chamadas: chamadas2 } = criarFetchFalso();
  const sf2 = window.NexusSingleFlight.criar(fetch2).fetch;
  await Promise.all([
    sf2(URL_CARGAS, { headers: CABECALHOS }),
    sf2(URL_NAVIOS, { headers: CABECALHOS }),
    sf2(URL_CARGAS, { headers: { ...CABECALHOS, 'x-extra': '1' } }),
    sf2(URL_CARGAS, { headers: { ...CABECALHOS, Authorization: 'Bearer token-2' } })
  ]);
  check('URLs e cabeçalhos diferentes não são agrupados', chamadas2.length === 4, `chamadas=${chamadas2.length}`);

  await sf2(URL_CARGAS, { headers: CABECALHOS });
  await sf2(URL_CARGAS, { headers: CABECALHOS });
  check('leitura concluída não fica em cache: a seguinte vai à rede', chamadas2.length === 6, `chamadas=${chamadas2.length}`);
  window.close();
}

/* ------------------------------------------------------------------ *
 * 2. Geração: mudança de dados não reaproveita leitura anterior
 * ------------------------------------------------------------------ */
async function testarGeracao() {
  console.log('\n2. Mudança de dados abre nova geração');
  const window = carregarSupabaseClient();

  const { fetchFalso, chamadas } = criarFetchFalso();
  const sf = window.NexusSingleFlight.criar(fetchFalso).fetch;
  const antes = sf(URL_CARGAS, { headers: CABECALHOS });
  window.dispatchEvent(new window.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  const depois = sf(URL_CARGAS, { headers: CABECALHOS });
  await Promise.all([antes, depois]);
  check('leitura iniciada antes de um evento de mudança não é reaproveitada depois dele', chamadas.length === 2, `chamadas=${chamadas.length}`);

  const { fetchFalso: fetch2, chamadas: chamadas2 } = criarFetchFalso();
  const sf2 = window.NexusSingleFlight.criar(fetch2).fetch;
  const leitura1 = sf2(URL_CARGAS, { method: 'GET', headers: CABECALHOS });
  const escrita = sf2(URL_CARGAS, { method: 'PATCH', headers: CABECALHOS, body: '{}' });
  const leitura2 = sf2(URL_CARGAS, { method: 'GET', headers: CABECALHOS });
  await Promise.all([leitura1, escrita, leitura2]);
  check(
    'escrita entre duas leituras idênticas separa as duas (3 requisições, a escrita passa direto)',
    chamadas2.length === 3 && chamadas2[1].method === 'PATCH',
    JSON.stringify(chamadas2)
  );
  window.close();
}

/* ------------------------------------------------------------------ *
 * 3. Erros e sinais de cancelamento
 * ------------------------------------------------------------------ */
async function testarErrosESinais() {
  console.log('\n3. Erro de rede e AbortSignal');
  const window = carregarSupabaseClient();

  const falha = new Error('rede indisponível');
  const { fetchFalso, chamadas } = criarFetchFalso({ falha });
  const sf = window.NexusSingleFlight.criar(fetchFalso).fetch;
  const resultados = await Promise.allSettled([sf(URL_CARGAS), sf(URL_CARGAS), sf(URL_CARGAS)]);
  check(
    'erro de rede chega a todos os chamadores',
    resultados.every((r) => r.status === 'rejected' && r.reason === falha)
  );
  check('mesmo com erro, foi uma única requisição', chamadas.length === 1, `chamadas=${chamadas.length}`);
  await sf(URL_CARGAS).catch(() => {});
  check('após o erro, a entrada não fica presa: a leitura seguinte vai à rede', chamadas.length === 2, `chamadas=${chamadas.length}`);

  const { fetchFalso: fetch2, chamadas: chamadas2 } = criarFetchFalso();
  const sf2 = window.NexusSingleFlight.criar(fetch2).fetch;
  const controle = new AbortController();
  await Promise.all([
    sf2(URL_CARGAS, { signal: controle.signal }),
    sf2(URL_CARGAS, { signal: controle.signal })
  ]);
  check('requisições com AbortSignal não são agrupadas', chamadas2.length === 2, `chamadas=${chamadas2.length}`);
  window.close();
}

/* ------------------------------------------------------------------ *
 * 4. Fiação e relatórios
 * ------------------------------------------------------------------ */
function testarFiacaoERelatorios() {
  console.log('\n4. Fiação no cliente e intervalo dos relatórios');
  const client = read('js/supabase-client.js');
  check(
    'o cliente Supabase usa o single-flight por cima do fetch de depuração/nativo',
    client.includes('fetch: criarFetchSingleFlight(fetchBase).fetch')
  );
  const relatorios = read('js/pages/relatorios.js');
  check('relatórios atualizam a cada 30 s', relatorios.includes('}, 30000);'));
  check('relatórios não mantêm mais o intervalo de 5 s', !relatorios.includes('}, 5000);'));
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log('================================================================');
  console.log('🧪 TESTES — SINGLE-FLIGHT DAS LEITURAS DO SUPABASE');
  console.log('================================================================');

  await testarDeduplicacao();
  await testarGeracao();
  await testarErrosESinais();
  testarFiacaoERelatorios();

  console.log('\n================================================================');
  if (passed) {
    console.log('🎉 SINGLE-FLIGHT E INTERVALO DE RELATÓRIOS VALIDADOS! 🎉');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 FALHA EM UMA OU MAIS VERIFICAÇÕES.');
    console.log('================================================================');
    process.exit(1);
  }
})();
