/**
 * Test — Browser network debug console (js/net-debug.js)
 *
 * Covers: pass-through of requests and responses, redaction of secrets, error
 * hints, the kill switch, verbose mode, caller attribution, slow and stalled
 * requests, Realtime (WebSocket + phoenix logger + heartbeat), key-type
 * warnings, supabase-client.js wiring and the script tag on every page.
 *
 * No jsdom: the module runs inside a vm context with a fake `window`, while
 * fetch/Response/Headers are Node 22's real implementations talking to a local
 * HTTP server.
 *
 * Run: node tests/test_net_debug.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const NET_DEBUG_FILE = path.join(ROOT, 'js', 'net-debug.js');
const SUPABASE_CLIENT_FILE = path.join(ROOT, 'js', 'supabase-client.js');
const NET_DEBUG_SRC = fs.readFileSync(NET_DEBUG_FILE, 'utf-8');
const SUPABASE_CLIENT_SRC = fs.readFileSync(SUPABASE_CLIENT_FILE, 'utf-8');

const API_KEY = 'sb_publishable_TEST_KEY_1234567890';
const PERSONAL_CODE = 'NX-SECRET-7788';
const ACCESS_TOKEN = 'eyJSECRET.ACCESS.TOKEN';

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    failed++;
    console.error(`  ❌ [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// Renders printf-style console arguments the way DevTools shows them:
// %c is dropped, %s is replaced by the next argument, the rest is appended.
function renderArgs(args) {
  if (args.length === 0) return '';
  let rest = args.slice(1);
  let text;
  if (typeof args[0] === 'string' && /%[cs]/.test(args[0])) {
    let i = 0;
    text = args[0].replace(/%[cs]/g, (m) => {
      const value = rest[i++];
      return m === '%c' ? '' : String(value);
    });
    rest = rest.slice(i);
  } else {
    text = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
  }
  const tail = rest.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  return [text].concat(tail).filter((s) => s !== undefined && s !== '').join(' ');
}

// A fake browser window that is also the vm global object.
function createWindow(options) {
  const opts = options || {};
  const logs = [];
  const timers = [];
  const storage = new Map();
  const listeners = {};
  const state = { clock: 1000, depth: 0 };
  const record = (level, args) => {
    logs.push({ level, depth: state.depth, text: renderArgs(args) });
  };
  const win = {
    console: {
      log: (...a) => record('log', a),
      info: (...a) => record('info', a),
      warn: (...a) => record('warn', a),
      error: (...a) => record('error', a),
      debug: (...a) => record('debug', a),
      groupCollapsed: (...a) => {
        record('group', a);
        state.depth++;
      },
      groupEnd: () => {
        state.depth = Math.max(0, state.depth - 1);
      },
      table: (...a) => record('table', a)
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    performance: { now: () => state.clock },
    navigator: { onLine: true },
    document: { visibilityState: 'visible', addEventListener: () => {} },
    location: { href: 'http://localhost:8080/dashboard.html', search: '' },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.cancelled = true;
    },
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    fetch: opts.fetch,
    WebSocket: opts.WebSocket,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    URL,
    URLSearchParams,
    Headers,
    Response,
    Blob,
    TextEncoder,
    TextDecoder
  };
  win.window = win;
  win.self = win;
  return {
    win,
    logs,
    timers,
    storage,
    listeners,
    advance: (ms) => {
      state.clock += ms;
    }
  };
}

function loadNetDebug(env) {
  vm.createContext(env.win);
  vm.runInContext(NET_DEBUG_SRC, env.win, { filename: NET_DEBUG_FILE });
  return env.win.NexusNetDebug;
}

// Response logs are written once the module has read its clone of the body; give that a moment.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const find = (logs, pattern) => logs.filter((l) => pattern.test(l.text));
const allText = (logs) => logs.map((l) => l.text).join('\n');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// ------------------------------------------------------------------ fake WebSocket
class FakeWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.sent = [];
    this.listeners = {};
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  dispatch(type, event) {
    (this.listeners[type] || []).forEach((fn) => fn(event || {}));
  }
  send(data) {
    this.sent.push(data);
  }
}
FakeWebSocket.instances = [];

// ------------------------------------------------------------------ local HTTP server
function startServer() {
  const seen = { last: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.last = { method: req.method, url: req.url, headers: req.headers, body };
      route(req, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }));
  });
}

function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const json = (status, body, headers) => {
    res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}));
    res.end(JSON.stringify(body));
  };
  if (p === '/rest/v1/cargas') {
    return json(200, [{ id: 1, codigo: 'C-001' }, { id: 2, codigo: 'C-002' }], { 'content-range': '0-1/2' });
  }
  if (p === '/rest/v1/funcionarios') {
    return json(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
  }
  if (p === '/rest/v1/dup') {
    return json(409, { code: '23505', details: 'Key (id)=(1) already exists.', hint: null, message: 'duplicate key value violates unique constraint' });
  }
  if (p === '/rest/v1/rls') {
    return json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy' });
  }
  if (p === '/rest/v1/emergencias') {
    return json(404, { code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.emergencias' in the schema cache" });
  }
  if (p === '/rest/v1/boom') {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('boom!');
  }
  if (p === '/rest/v1/empty') {
    res.writeHead(204);
    return res.end();
  }
  if (p === '/rest/v1/huge') {
    // Chunked (no content-length), 3 MB of text: the preview must stop early, the caller must get it all.
    res.writeHead(200, { 'content-type': 'text/plain' });
    const chunk = 'x'.repeat(64 * 1024);
    for (let i = 0; i < 48; i++) res.write(chunk);
    return res.end();
  }
  if (p === '/storage/v1/object/file.bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 1024 });
    return res.end(Buffer.alloc(1024, 1));
  }
  if (p === '/functions/v1/panic-alert') {
    return json(401, { error: 'Acesso negado: papel não autorizado' });
  }
  if (p === '/functions/v1/ok') {
    return json(200, { ok: true });
  }
  return json(404, { message: 'no route ' + p });
}

// ------------------------------------------------------------------ test sections
async function testInstallAndOptions() {
  console.log('\n1. Installation and client options');
  const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')), WebSocket: FakeWebSocket });
  const nd = loadNetDebug(env);
  check('module installs window.NexusNetDebug', typeof nd === 'object' && env.win.NexusNetDebug === nd);
  check('startup note says debug is ON', find(env.logs, /Network debug ON/).length === 1);
  const opts = nd.clientOptions();
  check('clientOptions().global.fetch is a function', typeof opts.global.fetch === 'function');
  check('clientOptions().realtime.logger / heartbeatCallback are functions',
    typeof opts.realtime.logger === 'function' && typeof opts.realtime.heartbeatCallback === 'function');
  check('clientOptions().realtime.transport is a WebSocket subclass', typeof opts.realtime.transport === 'function' && opts.realtime.transport.prototype instanceof FakeWebSocket);
  check('clientOptions().auth.debug is a function', typeof opts.auth.debug === 'function');
  check('module never adds custom request headers (CORS preflight safe)', !/\.set\(\s*['"]x-/i.test(NET_DEBUG_SRC) && !/['"]x-nexus/i.test(NET_DEBUG_SRC));
  check('module never adds realtime log_level (it would change the WebSocket URL)', !/log_level/.test(NET_DEBUG_SRC));

  const env2 = createWindow({ fetch: () => Promise.resolve(new Response('[]')) });
  const nd2 = loadNetDebug(env2);
  check('without WebSocket the transport is omitted (no crash)', nd2.clientOptions().realtime.transport === undefined);

  const before = env.win.NexusNetDebug;
  vm.runInContext(NET_DEBUG_SRC, env.win, { filename: NET_DEBUG_FILE });
  check('loading the module twice keeps the first instance (idempotent)', env.win.NexusNetDebug === before);
  check('no innerHTML / document.write sinks in the module',
    !/innerHTML|insertAdjacentHTML|document\.write/.test(NET_DEBUG_SRC));
}

async function testPassThroughAndRedaction() {
  console.log('\n2. Pass-through over real HTTP, redaction and error hints');
  const { server, port, seen } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  try {
    const env = createWindow({ fetch: (input, init) => fetch(input, init) });
    const nd = loadNetDebug(env);
    const headers = { apikey: API_KEY, authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' };
    const archived = [];
    const reset = () => {
      archived.push(allText(env.logs));
      env.logs.length = 0;
    };

    // Success: same Response object, body intact for the caller, no extra headers sent.
    const init = { headers: Object.assign({}, headers), method: 'GET' };
    const initBefore = JSON.stringify(init.headers);
    const res = await nd.fetch(`${base}/rest/v1/cargas?select=*`, init);
    const rows = await res.json();
    check('success: caller still reads the full JSON body', Array.isArray(rows) && rows.length === 2);
    check('success: init.headers object is not mutated', JSON.stringify(init.headers) === initBefore);
    check('success: server receives the headers the app sent (apikey, authorization)',
      seen.last.headers.apikey === API_KEY && seen.last.headers.authorization === `Bearer ${API_KEY}`);
    check('success: no debug headers were added on the wire',
      !Object.keys(seen.last.headers).some((h) => /debug|nexus/i.test(h)));
    check('success: start and finish lines logged', find(env.logs, /▶ REST GET cargas/).length === 1 && find(env.logs, /◀ 200 OK/).length === 1);
    await settle();
  check('success: row count and content-range reported',
      find(env.logs, /2 rows · range 0-1\/2/).length === 1, find(env.logs, /◀ 200/)[0] && find(env.logs, /◀ 200/)[0].text);
    check('success: anon-role note on Authorization that equals the apikey',
      find(env.logs, /same as apikey: the request runs as the anon role/).length >= 1);
    await settle();
  check('success: JSON body preview printed', find(env.logs, /"codigo": "C-001"/).length === 1);

    // Login-style lookup with a personal access code: masked in URL and body.
    reset();
    const loginRes = await nd.fetch(`${base}/rest/v1/funcionarios?select=*&codigo_individual=eq.${PERSONAL_CODE}`, {
      headers: Object.assign({}, headers, { accept: 'application/vnd.pgrst.object+json' })
    });
    const loginBody = await loginRes.json();
    await settle();
    check('406 PGRST116: caller receives the error body unchanged', loginRes.status === 406 && loginBody.code === 'PGRST116');
    await settle();
  check('406: URL shows codigo_individual=eq.[redacted]', find(env.logs, /codigo_individual=eq\.\[redacted\]/).length >= 1);
    check('406: hint explains .single() semantics', find(env.logs, /single-row query/).length === 1);
    check('406: summary is a warning (4xx), never an error', env.logs.some((l) => l.level === 'warn' && /PGRST116/.test(l.text)) && !env.logs.some((l) => l.level === 'error'));
    check('406: personal access code never printed', !allText(env.logs).includes(PERSONAL_CODE));

    reset();
    const dupRes = await nd.fetch(`${base}/rest/v1/dup`, { method: 'POST', headers, body: JSON.stringify({ id: 1, token: ACCESS_TOKEN }) });
    check('409: status and body unchanged for the caller', dupRes.status === 409 && (await dupRes.json()).code === '23505');
    await settle();
    check('409: request body is printed with the token redacted', find(env.logs, /"token": "\[redacted\]"/).length === 1);
    check('409: unique-constraint hint', find(env.logs, /Unique constraint violated/).length === 1);
    check('409: token value never printed', !allText(env.logs).includes(ACCESS_TOKEN));

    reset();
    const rlsRes = await nd.fetch(`${base}/rest/v1/rls`, { headers });
    check('403 RLS: status unchanged', rlsRes.status === 403);
    await settle();
    check('403 RLS: row-level-security hint', find(env.logs, /Row-level security blocked/).length === 1);

    reset();
    const boomRes = await nd.fetch(`${base}/rest/v1/boom`, { headers });
    check('500: caller reads the text body', (await boomRes.text()) === 'boom!');
    await settle();
    check('500: logged with the server-side hint', find(env.logs, /Server-side error/).length === 1);
    check('500: summary line is at error level', env.logs.some((l) => l.level === 'error' && /◀ 500/.test(l.text)));

    reset();
    const emergRes = await nd.fetch(`${base}/rest/v1/emergencias?select=*`, { headers });
    check('404 PGRST205: status unchanged', emergRes.status === 404);
    await settle();
    check('404 PGRST205: schema-cache hint names the migration problem',
      find(env.logs, /The table is missing from the PostgREST schema cache/).length === 1);

    reset();
    const fnRes = await nd.fetch(`${base}/functions/v1/panic-alert`, { method: 'POST', headers, body: '{"ping":true}' });
    check('function 401: status and error body unchanged', fnRes.status === 401 && (await fnRes.json()).error.includes('Acesso negado'));
    await settle();
    check('function 401: deploy hint with --no-verify-jwt',
      find(env.logs, /supabase functions deploy panic-alert --no-verify-jwt/).length === 1);
    check('function 401: logged with FUNCTION kind', find(env.logs, /▶ FUNCTION POST panic-alert/).length === 1);

    reset();
    const binRes = await nd.fetch(`${base}/storage/v1/object/file.bin`, { headers });
    const binBytes = (await binRes.arrayBuffer()).byteLength;
    check('binary body: caller still gets every byte', binBytes === 1024, String(binBytes));
    await settle();
    check('binary body: not previewed', find(env.logs, /binary body, not previewed/).length === 1);

    reset();
    const hugeRes = await nd.fetch(`${base}/rest/v1/huge`, { headers });
    const hugeText = await hugeRes.text();
    check('large chunked body: caller receives all 3 MB', hugeText.length === 3 * 1024 * 1024, String(hugeText.length));
    await settle();
    check('large chunked body: preview stops at the cap', find(env.logs, /preview stopped after 2\.00 MB/).length === 1);

    reset();
    const emptyRes = await nd.fetch(`${base}/rest/v1/empty`, { headers });
    check('204 empty body: status unchanged', emptyRes.status === 204);
    await settle();
    check('204 empty body: printed as (empty)', find(env.logs, /body: \(empty\)|\(empty\)/).length >= 1);

    // Secrets never leave the module in any output.
    archived.push(allText(env.logs));
    const everything = archived.join('\n');
    check('no apikey or Authorization value appears anywhere in this section output', !everything.includes(API_KEY));
    check('no personal access code appears anywhere in this section output', !everything.includes(PERSONAL_CODE));
    check('no access token appears anywhere in this section output', !everything.includes(ACCESS_TOKEN));

    // Identity: the caller receives the very Response the browser produced, body still unread.
  const producedResponse = new Response('[]', { headers: { 'content-type': 'application/json' } });
  const envI = createWindow({ fetch: () => Promise.resolve(producedResponse) });
  const ndI = loadNetDebug(envI);
  const received = await ndI.fetch('https://demo.supabase.co/rest/v1/cargas');
  check('fetch resolves with the very same Response object (identity)', received === producedResponse);
  check('the caller\'s body is still unread when the Response is handed back', received.bodyUsed === false);

  // Summary and history.
    const summary = nd.summary();
    check('summary() counts requests and HTTP errors', summary.requests >= 8 && summary.httpErrors >= 6 && summary.inFlight === 0, JSON.stringify(summary));
    const hist = nd.history();
    check('history() keeps finished entries with status and caller', hist.length >= 8 && hist[0].status === 200 && typeof hist[0].caller === 'string');
    check('pending() is empty after all requests finished', nd.pending().length === 0);
  } finally {
    server.close();
  }
}

async function testNetworkErrorsAndAborts() {
  console.log('\n3. Network errors, aborts and page unload');
  const netErr = new TypeError('Failed to fetch');
  const env = createWindow({ fetch: () => Promise.reject(netErr) });
  const nd = loadNetDebug(env);
  let caught = null;
  try {
    await nd.fetch('https://demo.supabase.co/rest/v1/cargas?select=*', { headers: { apikey: API_KEY } });
  } catch (err) {
    caught = err;
  }
  check('network error: the original error object is rethrown', caught === netErr);
  // Falha de transporte (sem resposta do servidor) é aviso: o problema é de rede/ambiente e não
  // defeito da aplicação. Erros com resposta do servidor (4xx/5xx) continuam em nível de erro.
  check('network error: logged at warn level with NETWORK ERROR', env.logs.some((l) => l.level === 'warn' && /NETWORK ERROR/.test(l.text)));
  check('network error: CORS / DNS / ad-blocker hint present', find(env.logs, /CORS .*ad-blockers/).length === 1);
  check('network error: summary counts it', nd.summary().networkErrors === 1);

  const abortErr = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  const env2 = createWindow({ fetch: () => Promise.reject(abortErr) });
  const nd2 = loadNetDebug(env2);
  let caught2 = null;
  try {
    await nd2.fetch('https://demo.supabase.co/rest/v1/slow');
  } catch (err) {
    caught2 = err;
  }
  check('abort: the original AbortError is rethrown', caught2 === abortErr);
  check('abort: logged as ABORTED at warn level, not as a network error',
    env2.logs.some((l) => l.level === 'warn' && /ABORTED/.test(l.text)) && !/NETWORK ERROR/.test(allText(env2.logs)));

  // Page unload while a request is in flight: browser-cancelled, not a server error.
  let rejectLater;
  const env3 = createWindow({ fetch: () => new Promise((_, reject) => { rejectLater = reject; }) });
  const nd3 = loadNetDebug(env3);
  const pendingCall = nd3.fetch('https://demo.supabase.co/rest/v1/cargas').catch((e) => e);
  env3.listeners.pagehide.forEach((fn) => fn());
  rejectLater(new TypeError('Failed to fetch'));
  await pendingCall;
  check('pagehide with a request in flight is announced', find(env3.logs, /page is unloading with 1 request/).length === 1);
  check('a request cancelled by unload is hinted as navigation, not server error',
    find(env3.logs, /navigating away or closing/).length === 1);

  // Stalled request: the watchdog warns after 10 s (fake timers).
  const env4 = createWindow({ fetch: () => new Promise(() => {}) });
  const nd4 = loadNetDebug(env4);
  nd4.fetch('https://demo.supabase.co/rest/v1/never');
  const watchdog = env4.timers.find((t) => t.ms === 10000 && !t.cancelled);
  check('a 10 s watchdog is armed for each request', Boolean(watchdog));
  if (watchdog) watchdog.fn();
  check('stalled request: warning after 10 s', find(env4.logs, /still pending after 10 s/).length === 1);
  check('pending() reports the request with its age', nd4.pending().length === 1 && nd4.pending()[0].kind === 'REST');

  // Slow request: finished after the SLOW threshold (fake clock).
  const env5 = createWindow({ fetch: (input) => { env5.advance(2000); return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } })); } });
  const nd5 = loadNetDebug(env5);
  await nd5.fetch('https://demo.supabase.co/rest/v1/cargas');
  await settle();
  check('slow request (> 1.5 s) is flagged SLOW', find(env5.logs, /SLOW/).length >= 1 && env5.logs.some((l) => l.level === 'warn' && /SLOW/.test(l.text)));

  // Logger failures never break a request.
  const env6 = createWindow({ fetch: () => Promise.resolve(new Response('ok')) });
  env6.win.console.groupCollapsed = () => { throw new Error('console is broken'); };
  const nd6 = loadNetDebug(env6);
  const ok = await nd6.fetch('https://demo.supabase.co/rest/v1/x');
  check('a failing logger does not break the request', ok.status === 200 && (await ok.text()) === 'ok');
}

async function testKillSwitchAndVerbose() {
  console.log('\n4. Kill switch, runtime toggles and verbose mode');
  const env = createWindow({ fetch: () => Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } })) });
  const nd = loadNetDebug(env);
  const before = env.logs.length;
  await nd.fetch('https://demo.supabase.co/rest/v1/cargas');
  check('enabled by default: request logged', env.logs.length > before && find(env.logs, /REST GET cargas/).length === 1);

  env.logs.length = 0;
  nd.disable();
  check('disable() prints a final note before turning off', find(env.logs, /DISABLED/).length === 1);
  check('disable() persists nexus_debug_net=off', env.storage.get('nexus_debug_net') === 'off' && nd.isEnabled() === false);
  env.logs.length = 0;
  const res = await nd.fetch('https://demo.supabase.co/rest/v1/cargas');
  check('disabled: no logs at all, response still returned', env.logs.length === 0 && res.status === 200);
  check('disabled: the caller still gets a Response', res instanceof Response);

  env.logs.length = 0;
  nd.enable();
  check('enable() removes the off flag and logs ENABLED', !env.storage.has('nexus_debug_net') && find(env.logs, /ENABLED/).length === 1);
  await nd.fetch('https://demo.supabase.co/rest/v1/cargas');
  check('re-enabled: requests are logged again', find(env.logs, /REST GET cargas/).length === 1);

  // Storage event from another tab.
  env.logs.length = 0;
  env.storage.set('nexus_debug_net', 'off');
  env.listeners.storage.forEach((fn) => fn({ key: 'nexus_debug_net', newValue: 'off' }));
  await nd.fetch('https://demo.supabase.co/rest/v1/cargas');
  check('storage event from another tab turns logging off at runtime', env.logs.length === 0);
  env.listeners.storage.forEach((fn) => fn({ key: 'nexus_debug_net', newValue: null }));

  // Started disabled: no startup note at all.
  const envOff = createWindow({ fetch: () => Promise.resolve(new Response('[]')) });
  envOff.storage.set('nexus_debug_net', 'off');
  loadNetDebug(envOff);
  check('started with nexus_debug_net=off: silent on load', envOff.logs.length === 0);

  // Verbose: auth internals and raw frames only when enabled.
  const envV = createWindow({ fetch: () => Promise.resolve(new Response('[]')), WebSocket: FakeWebSocket });
  const ndV = loadNetDebug(envV);
  const opts = ndV.clientOptions();
  opts.auth.debug('GoTrueClient@sb:0 (2.117.3) 2026-10-08T00:00:00Z #_useSession begin', { access_token: ACCESS_TOKEN });
  check('verbose off: GoTrue internals are silent', find(envV.logs, /NexusNet AUTH/).length === 0);
  const ws = new opts.realtime.transport('wss://demo.supabase.co/realtime/v1/websocket?apikey=' + API_KEY + '&vsn=2.0.0');
  ws.send('["1","1","realtime:x","phx_join",{}]');
  check('verbose off: outgoing raw frame is silent', find(envV.logs, /→ frame/).length === 0);
  ndV.verbose(true);
  check('verbose(true) persists nexus_debug_net_verbose=on', envV.storage.get('nexus_debug_net_verbose') === 'on' && ndV.summary().verbose === true);
  opts.auth.debug('GoTrueClient@sb:0 (2.117.3) 2026-10-08T00:00:00Z #_useSession begin', { access_token: ACCESS_TOKEN });
  check('verbose on: GoTrue internal logged once', find(envV.logs, /\[NexusNet AUTH\].*#_useSession begin/).length === 1);
  check('verbose on: GoTrue token value redacted', !allText(envV.logs).includes(ACCESS_TOKEN));
  ws.send('["1","2","realtime:x","phx_join",{"access_token":"' + ACCESS_TOKEN + '"}]');
  check('verbose on: outgoing raw frame logged', find(envV.logs, /→ frame/).length === 1);
  check('verbose on: access_token inside the raw frame is redacted', !allText(envV.logs).includes(ACCESS_TOKEN) && find(envV.logs, /\[redacted\]/).length >= 1);
  check('the raw frame still reaches the socket unchanged', ws.sent[1] === '["1","2","realtime:x","phx_join",{"access_token":"' + ACCESS_TOKEN + '"}]');
  ndV.verbose(false);
  check('verbose(false) removes the flag', !envV.storage.has('nexus_debug_net_verbose'));
}

async function testCallerAttribution() {
  console.log('\n5. Caller attribution');
  const env = createWindow({ fetch: () => Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } })) });
  const nd = loadNetDebug(env);
  // Defined with a js/*.js filename, the way the browser names app scripts.
  vm.runInContext([
    'async function listarCargas(nd) {',
    '  return nd.fetch("https://demo.supabase.co/rest/v1/cargas?select=*");',
    '}',
    'async function pedirPanico(nd) {',
    '  return listarCargas(nd);',
    '}'
  ].join('\n'), env.win, { filename: path.join(ROOT, 'js', 'cargas.js') });
  await env.win.pedirPanico(nd);
  check('caller shows the app file and line', find(env.logs, /caller: cargas\.js:2/).length === 1, find(env.logs, /caller:/)[0] && find(env.logs, /caller:/)[0].text);
  check('caller chain includes the calling function frame', find(env.logs, /cargas\.js:2 ← cargas\.js:5/).length === 1, find(env.logs, /caller:/)[0] && find(env.logs, /caller:/)[0].text);
  check('net-debug.js frames are excluded from the caller chain', !find(env.logs, /caller:.*net-debug/).length);
}

async function testRealtime() {
  console.log('\n6. Realtime WebSocket, phoenix logger and heartbeat');
  FakeWebSocket.instances.length = 0;
  const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')), WebSocket: FakeWebSocket });
  const nd = loadNetDebug(env);
  const opts = nd.clientOptions();
  const url = 'wss://demo.supabase.co/realtime/v1/websocket?apikey=' + API_KEY + '&vsn=2.0.0';
  const Transport = opts.realtime.transport;
  const sock = new Transport(url);
  check('socket is an instance of the native (fake) WebSocket', sock instanceof FakeWebSocket && FakeWebSocket.instances.length === 1);
  check('connect line shows the endpoint with apikey redacted',
    find(env.logs, /#1 ▶ connecting → wss:\/\/demo\.supabase\.co\/realtime\/v1\/websocket\?apikey=\[redacted\]&vsn=2\.0\.0/).length === 1);
  check('the socket still gets the original URL', sock.url === url);
  check('the apikey is never printed', !allText(env.logs).includes(API_KEY));

  sock.dispatch('open', {});
  check('open line includes handshake time', find(env.logs, /#1 ✔ open · handshake/).length === 1);

  env.logs.length = 0;
  sock.dispatch('close', { code: 1006, reason: '', wasClean: false });
  check('abnormal close (1006) is a warning with its meaning', env.logs.some((l) => l.level === 'warn' && /code 1006 \(abnormal closure/.test(l.text) && /NOT clean/.test(l.text)));
  check('close line reports lifetime of the connection', find(env.logs, /lived /).length === 1);

  env.logs.length = 0;
  const sock2 = new Transport(url + '&x=1');
  sock2.dispatch('close', { code: 1008, reason: 'policy', wasClean: true });
  check('close before open reports never opened and the reason', find(env.logs, /never opened/).length === 1 && find(env.logs, /reason "policy"/).length === 1);
  check('policy-violation close code has its meaning', find(env.logs, /policy violation/).length === 1);

  // phoenix logger
  env.logs.length = 0;
  const logger = opts.realtime.logger;
  logger('push', 'phoenix heartbeat (null, 3)', {});
  logger('receive', 'ok phoenix phx_reply (3)', { status: 'ok', response: {} });
  check('heartbeat push/receive lines are hidden outside verbose mode', env.logs.length === 0);
  logger('push', 'realtime:nexus-emergency phx_join (1, 1)', { config: { broadcast: { self: true } }, access_token: ACCESS_TOKEN });
  check('phx_join push is logged', find(env.logs, /push · realtime:nexus-emergency phx_join \(1, 1\)/).length === 1);
  check('access_token inside the push payload is redacted', !allText(env.logs).includes(ACCESS_TOKEN) && find(env.logs, /"access_token":"\[redacted\]"/).length === 1);
  logger('receive', 'ok realtime:nexus-emergency phx_reply (1)', { status: 'ok', response: { postgres_changes: [] } });
  check('receive line is logged', find(env.logs, /receive · ok realtime:nexus-emergency phx_reply/).length === 1);
  logger('channel', 'timeout realtime:nexus-emergency', { reason: 'join timed out' });
  check('channel timeout is a warning', env.logs.some((l) => l.level === 'warn' && /channel · timeout/.test(l.text)));
  logger('error', 'callback error', { message: 'boom' });
  check('phoenix error kind is an error', env.logs.some((l) => l.level === 'error' && /error · callback error/.test(l.text)));
  env.logs.length = 0;
  logger('transport', 'close', { code: 1000, reason: '', wasClean: true });
  check('transport close duplicates are suppressed (the socket wrapper prints them)', env.logs.length === 0);

  // heartbeat callback
  env.logs.length = 0;
  const hb = opts.realtime.heartbeatCallback;
  hb('ok', 42.3);
  check('heartbeat ok shows latency', find(env.logs, /heartbeat ok · latency 42 ms/).length === 1);
  hb('timeout', undefined);
  check('heartbeat timeout is a warning', env.logs.some((l) => l.level === 'warn' && /heartbeat TIMEOUT/.test(l.text)));
  hb('sent', undefined);
  check('heartbeat sent is silent outside verbose mode', find(env.logs, /heartbeat sent/).length === 0);

  // outgoing frames of the same socket keep the original payload
  sock.send('["1","9","realtime:nexus-emergency","broadcast",{}]');
  check('send() passes the frame to the native socket unchanged', sock.sent[0] === '["1","9","realtime:nexus-emergency","broadcast",{}]');

  // binary frames are reported by size, never decoded
  env.logs.length = 0;
  nd.verbose(true);
  sock.send(Buffer.from([3, 1, 1, 1, 1, 0, 0]));
  check('binary frame printed as size only', find(env.logs, /→ frame 7 B \[binary frame, 7 B, not decoded\]/).length === 1);
  nd.verbose(false);
}

async function testClientCreatedKeysAndNotes() {
  console.log('\n7. Client summary, key types and notes');
  const jwt = (role) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role })}.signature`;
  const cases = [
    { label: 'publishable key: no warning', key: API_KEY, expectWarn: null },
    { label: 'SECRET key: strong warning', key: 'sb_secret_ABCDEFGHIJKLMNOP', expectWarn: /SECRET key is shipped to the browser/ },
    { label: 'service_role JWT: strong warning', key: jwt('service_role'), expectWarn: /service_role JWT is shipped/ },
    { label: 'anon JWT: no warning', key: jwt('anon'), expectWarn: null }
  ];
  for (const c of cases) {
    const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')) });
    const nd = loadNetDebug(env);
    env.logs.length = 0;
    nd.clientCreated({ url: 'https://demo.supabase.co/', key: c.key, urlSource: 'js/config.js (window.NEXUS_CONFIG)' });
    const warnings = env.logs.filter((l) => l.level === 'warn');
    if (c.expectWarn) check(c.label, warnings.some((l) => c.expectWarn.test(l.text)), allText(env.logs).slice(0, 200));
    else check(c.label, warnings.length === 0);
    check(`${c.label}: key value itself is never printed`, !allText(env.logs).includes(c.key));
  }
  const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')) });
  const nd = loadNetDebug(env);
  env.logs.length = 0;
  nd.clientCreated({ url: 'https://demo.supabase.co/', key: API_KEY, urlSource: 'js/config.js (window.NEXUS_CONFIG)' });
  check('summary group names the host and the realtime endpoint',
    find(env.logs, /Supabase client ready → demo\.supabase\.co/).length === 1 &&
    find(env.logs, /Realtime WebSocket: wss:\/\/demo\.supabase\.co\/realtime\/v1\/websocket/).length === 1);
  check('summary shows where the URL came from', find(env.logs, /URL came from: js\/config\.js/).length === 1);

  env.logs.length = 0;
  nd.note('warn', 'custom warning', { password: 'hunter2', nested: { access_token: ACCESS_TOKEN }, ok: 1 });
  check('note() prints at warn level', env.logs.some((l) => l.level === 'warn' && /custom warning/.test(l.text)));
  check('note() details are redacted', !allText(env.logs).includes('hunter2') && !allText(env.logs).includes(ACCESS_TOKEN));

  env.logs.length = 0;
  nd.help();
  check('help() lists the controls', find(env.logs, /NexusNetDebug\.disable\(\)/).length === 1 && find(env.logs, /NexusNetDebug\.verbose/).length === 1);

  const bare = createWindow({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
  delete bare.win.navigator;
  delete bare.win.document;
  delete bare.win.location;
  const ndBare = loadNetDebug(bare);
  let bareErr = null;
  try {
    await ndBare.fetch('https://demo.supabase.co/rest/v1/cargas');
  } catch (err) {
    bareErr = err;
  }
  check('module tolerates missing navigator/document/location (still rethrows the error)', bareErr instanceof TypeError);
  ndBare.clientCreated({ url: 'https://demo.supabase.co', key: API_KEY });
  check('missing globals: summary still reports the failure', ndBare.summary().networkErrors === 1);
}

async function testSupabaseClientWiring() {
  console.log('\n8. js/supabase-client.js wiring');
  function loadClient(withDebug, config) {
    const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')), WebSocket: FakeWebSocket });
    env.win.NEXUS_CONFIG = config === undefined ? { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: API_KEY } : config;
    const created = [];
    env.win.supabase = {
      createClient: (url, key, options) => {
        created.push({ url, key, options });
        return { __fake: true, from() {}, functions: {} };
      }
    };
    vm.createContext(env.win);
    if (withDebug) vm.runInContext(NET_DEBUG_SRC, env.win, { filename: NET_DEBUG_FILE });
    vm.runInContext(SUPABASE_CLIENT_SRC, env.win, { filename: SUPABASE_CLIENT_FILE });
    return { env, created };
  }

  const withDebug = loadClient(true);
  const opts = withDebug.created[0] && withDebug.created[0].options;
  check('with net-debug: createClient receives a global.fetch wrapper', opts && typeof opts.global.fetch === 'function');
  check('with net-debug: realtime transport, logger and heartbeat are passed', opts && typeof opts.realtime.transport === 'function' && typeof opts.realtime.logger === 'function' && typeof opts.realtime.heartbeatCallback === 'function');
  check('with net-debug: auth.debug is passed and session options kept',
    opts && typeof opts.auth.debug === 'function' && opts.auth.persistSession === true && opts.auth.autoRefreshToken === true);
  check('window.nexusSupabase still points at the created client', withDebug.env.win.nexusSupabase && withDebug.env.win.nexusSupabase.__fake === true);
  check('window.NexusSupabaseUtils is still exposed', typeof withDebug.env.win.NexusSupabaseUtils === 'object');
  check('original success message is kept', find(withDebug.env.logs, /\[NexusPort\] Cliente Supabase inicializado com sucesso\./).length === 1);
  check('summary group names the URL source', find(withDebug.env.logs, /URL came from: js\/config\.js \(window\.NEXUS_CONFIG\)/).length === 1);
  check('the anon key is never printed by the wiring', !allText(withDebug.env.logs).includes(API_KEY));

  const legacy = loadClient(false);
  const legacyOpts = legacy.created[0].options;
  // Desde o single-flight (tests/test_single_flight.js), o cliente sempre recebe um fetch
  // próprio em `global`. Sem net-debug, esse é o ÚNICO acréscimo: nada de depuração e
  // nenhum override de realtime, e as opções de auth continuam as originais.
  check('without net-debug: auth options are exactly the legacy ones',
    JSON.stringify(legacyOpts.auth) === JSON.stringify({ persistSession: true, autoRefreshToken: true }));
  check('without net-debug: no realtime override is added', legacyOpts.realtime === undefined);
  check('without net-debug: the only global option is the single-flight fetch (no debug fetch)',
    legacyOpts.global === undefined || (Object.keys(legacyOpts.global).join() === 'fetch' && legacyOpts.global.fetch.name === 'fetchSingleFlight'));
  check('without net-debug: legacy success message is kept', legacy.env.logs.some((l) => /inicializado com sucesso/.test(l.text)));

  const noCreds = loadClient(true, {});
  check('missing credentials: original waiting message is kept', noCreds.env.logs.some((l) => /Aguardando credenciais do Supabase/.test(l.text)));
  check('missing credentials: debug note names the missing URL', find(noCreds.env.logs, /Supabase URL missing/).length === 1);
  check('missing credentials: no client is created', noCreds.created.length === 0);

  const noLib = (() => {
    const env = createWindow({ fetch: () => Promise.resolve(new Response('[]')) });
    env.win.NEXUS_CONFIG = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: API_KEY };
    vm.createContext(env.win);
    vm.runInContext(NET_DEBUG_SRC, env.win, { filename: NET_DEBUG_FILE });
    vm.runInContext(SUPABASE_CLIENT_SRC, env.win, { filename: SUPABASE_CLIENT_FILE });
    return env;
  })();
  check('supabase-js missing from the page: named clearly in the debug note', find(noLib.logs, /supabase-js library not loaded/).length === 1);
}

function testPagesLoadTheModule() {
  console.log('\n9. Script tag on every page that talks to Supabase');
  const tag = '<script src="js/net-debug.js"></script>';
  const clientTag = '<script src="js/supabase-client.js"></script>';
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
  let withClient = 0;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf-8');
    if (!html.includes(clientTag)) continue;
    withClient++;
    const count = html.split(tag).length - 1;
    const iDebug = html.indexOf(tag);
    const iClient = html.indexOf(clientTag);
    check(`${page}: loads net-debug.js exactly once, right before supabase-client.js`, count === 1 && iDebug !== -1 && iDebug < iClient);
  }
  check('at least 11 pages were checked', withClient >= 11, String(withClient));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  check('package.json exposes the test as npm run test:net-debug', pkg.scripts && pkg.scripts['test:net-debug'] === 'node tests/test_net_debug.js');
}

async function main() {
  console.log('================================================================');
  console.log('TESTE — DEPURAÇÃO DE REDE NO CONSOLE (js/net-debug.js)');
  console.log('================================================================');
  await testInstallAndOptions();
  await testPassThroughAndRedaction();
  await testNetworkErrorsAndAborts();
  await testKillSwitchAndVerbose();
  await testCallerAttribution();
  await testRealtime();
  await testClientCreatedKeysAndNotes();
  await testSupabaseClientWiring();
  testPagesLoadTheModule();
  console.log('\n================================================================');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('✨ TODOS OS TESTES DE DEPURAÇÃO DE REDE PASSARAM! ✨');
    process.exit(0);
  }
  console.log('❌ Há falhas: revise os itens marcados acima.');
  process.exit(1);
}

main().catch((err) => {
  console.error('❌ [FAIL] Erro inesperado durante os testes:', err);
  process.exit(1);
});
