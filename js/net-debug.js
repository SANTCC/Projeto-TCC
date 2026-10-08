/**
 * Network debug console - NexusPort (js/net-debug.js)
 *
 * Verbose, console-only tracing of every client -> server connection the app
 * makes through @supabase/supabase-js. Loaded before js/supabase-client.js,
 * which passes these hooks to createClient():
 *
 *  HTTP      REST (PostgREST queries and RPC), Auth, Edge Functions and Storage
 *            all share one fetch, injected as `global.fetch`. Each request is
 *            logged with method, decoded URL and filters, headers, body, the
 *            calling js/*.js:line, timing, status, response headers, a body
 *            preview, the row count and hints for common errors.
 *  WS        The Realtime WebSocket, injected as `realtime.transport`: connect,
 *            open, close (with the meaning of the close code), errors,
 *            heartbeats with latency, and every phoenix push / receive / channel
 *            event. Verbose mode also prints the raw frames.
 *  Browser   online / offline, tab visibility and page unload with requests
 *            still in flight.
 *
 * Controls (browser DevTools console; NexusNetDebug.help() lists them all):
 *   NexusNetDebug.disable() / enable()    kill switch, saved in localStorage
 *   NexusNetDebug.verbose(true|false)     raw WebSocket frames, GoTrue internals
 *   NexusNetDebug.summary() / pending() / table() / history()
 *
 * Secrets are never printed: apikey and Authorization headers, token, password,
 * secret and service_role values, and the individual access code
 * (codigo_individual) are replaced by "[redacted]". Business payloads are
 * logged as they are, so turn the console logging off on shared machines.
 *
 * This module is a pass-through: it never changes a request or a response, it
 * rethrows the original errors, and every logging step is isolated so a bug in
 * the logger cannot break a request.
 */
(function (window) {
  'use strict';

  if (window.NexusNetDebug) return; // already installed on this page

  var VERSION = '1.0.0';
  var STORAGE_KEY = 'nexus_debug_net';          // 'off' disables it (default: on)
  var VERBOSE_KEY = 'nexus_debug_net_verbose';  // 'on' adds raw frames and GoTrue internals
  var HISTORY_LIMIT = 200;
  var SLOW_MS = 1500;                  // finished slower than this => warning
  var STALL_MS = 10000;                // still pending after this => warning
  var PREVIEW_CHARS = 1500;            // body preview size (x4 in verbose mode)
  var MAX_BODY_BYTES = 2 * 1024 * 1024; // larger bodies are not read for the preview
  var MAX_PARSE_CHARS = 300000;        // larger JSON bodies are shown as raw text

  // Names whose values are never printed (matched case-insensitively).
  var SENSITIVE_KEY = /apikey|api_key|authorization|token|secret|password|senha|service_role|codigo_individual/i;
  // PostgREST operators, kept visible when a filter value is redacted (eq.[redacted]).
  var PG_OPERATOR = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|sl|sr|nxl|nxr|adj|fts|plfts|phfts|wfts)\./i;
  // Raw JSON text: "password": "..." and similar pairs.
  var RAW_SECRET = /("[^"]*(?:apikey|api_key|authorization|token|secret|password|senha|service_role|codigo_individual)[^"]*"\s*:\s*)"[^"]*"/gi;
  // Query-style secrets inside any text: apikey=..., access_token=...
  var QUERY_SECRET = /((?:apikey|api_key|access_token|refresh_token|token|secret)=)[^&\s]+/gi;
  // PostgREST or=(codigo_individual.eq.X,...) filters.
  var OR_SECRET = /(codigo_individual\.(?:not\.)?[a-z]+\.)[^,&)]*/gi;
  var APP_FRAME = /\/js\/([A-Za-z0-9_.\-]+\.js):(\d+)/;
  var HEARTBEAT_MSG = /^phoenix heartbeat |^(ok|error|timeout) phoenix phx_reply/;
  var KIND_BY_PATH = { rest: 'REST', auth: 'AUTH', functions: 'FUNCTION', storage: 'STORAGE', realtime: 'REALTIME' };
  var CLOSE_CODES = {
    1000: 'normal closure',
    1001: 'endpoint going away (page hidden or unloaded)',
    1002: 'protocol error',
    1003: 'unsupported data',
    1005: 'no status code',
    1006: 'abnormal closure: connection lost without a close frame',
    1008: 'policy violation (key or auth rejected?)',
    1011: 'server error',
    1012: 'service restart',
    1013: 'try again later'
  };
  var COLOR = {
    ok: '#15803d',
    info: '#1d4ed8',
    warn: '#b45309',
    error: '#b91c1c',
    ws: '#7c3aed',
    quiet: '#64748b'
  };
  var PLAIN = 'color:inherit;font-weight:normal';

  var nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  var NativeWebSocket = typeof window.WebSocket === 'function' ? window.WebSocket : null;
  var TransportClass = null;

  function readStorage(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStorage(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable: the setting only lasts for this page */ }
  }

  var flags = {
    enabled: readStorage(STORAGE_KEY) !== 'off',
    verbose: readStorage(VERBOSE_KEY) === 'on'
  };
  var seq = 0;
  var wsSeq = 0;
  var inFlight = {};
  var inFlightCount = 0;
  var finished = [];
  var totals = { requests: 0, ok: 0, httpErrors: 0, networkErrors: 0, aborted: 0, durationSum: 0 };
  var pageUnloading = false;

  // ------------------------------------------------------------------ time / format
  function clockMs() {
    return window.performance && typeof window.performance.now === 'function' ? window.performance.now() : Date.now();
  }
  function pad(n, width) {
    var s = String(n);
    while (s.length < (width || 2)) s = '0' + s;
    return s;
  }
  function clock() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }
  function fmtMs(v) {
    if (v === null || v === undefined || isNaN(v)) return '?';
    if (v >= 1000) return (v / 1000).toFixed(2) + ' s';
    return (v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ms';
  }
  function fmtBytes(n) {
    if (n === null || n === undefined) return '? B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function previewLimit() {
    return flags.verbose ? PREVIEW_CHARS * 4 : PREVIEW_CHARS;
  }
  function visibility() {
    return (window.document && window.document.visibilityState) || 'unknown';
  }
  function clip(text, max) {
    var s = String(text);
    return s.length <= max ? s : s.slice(0, max) + '\n… [' + (s.length - max) + ' more chars]';
  }
  function asText(value) {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  function noop() {}

  // ------------------------------------------------------------------ console output
  function badge(color) {
    return 'background:' + color + ';color:#fff;border-radius:3px;padding:0 4px;font-weight:600';
  }
  // Dynamic text is always passed as %s arguments, never inside the format
  // string, so URLs containing % sequences are printed exactly as they are.
  function say(level, tag, color, text, extras) {
    if (!flags.enabled) return;
    var args = ['%c' + tag + '%c %s', badge(color), PLAIN, text];
    if (extras) args = args.concat(extras);
    (console[level] || console.log).apply(console, args);
  }
  function group(tag, color, text, sections) {
    if (!flags.enabled) return;
    console.groupCollapsed('%c' + tag + '%c %s', badge(color), PLAIN, text);
    try {
      for (var i = 0; i < sections.length; i++) {
        var value = sections[i][1];
        if (value === undefined || value === null || value === '') continue;
        console.log(sections[i][0] + ':', value);
      }
    } finally {
      console.groupEnd();
    }
  }
  function safe(fn) {
    try {
      fn();
    } catch (e) {
      try { console.warn('[NexusNet] internal logging error (requests are not affected):', e); } catch (ignored) { /* no console */ }
    }
  }

  // ------------------------------------------------------------------ redaction
  function scrub(text) {
    return String(text)
      .replace(RAW_SECRET, '$1"[redacted]"')
      .replace(QUERY_SECRET, '$1[redacted]')
      .replace(OR_SECRET, '$1[redacted]');
  }
  function maskParam(key, value) {
    if (!SENSITIVE_KEY.test(key)) return value;
    var m = PG_OPERATOR.exec(value);
    return (m ? m[0] : '') + '[redacted]';
  }
  // Deep copy with secret-looking keys replaced. Depth-limited, so cycles are safe.
  function maskDeep(value, depth) {
    depth = depth || 0;
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return value.length > 4000 ? value.slice(0, 4000) + '… [' + (value.length - 4000) + ' more chars]' : value;
    }
    if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    if (typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message };
    if (depth >= 8) return '[nested]';
    if (Array.isArray(value)) {
      return value.map(function (item) { return maskDeep(item, depth + 1); });
    }
    var out = {};
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      out[key] = SENSITIVE_KEY.test(key) && item !== null && item !== undefined && item !== ''
        ? '[redacted]'
        : maskDeep(item, depth + 1);
    });
    return out;
  }
  function sanitizeForLog(value) {
    if (typeof value === 'string') return scrub(value);
    if (typeof Event !== 'undefined' && value instanceof Event) {
      return { type: value.type, code: value.code, reason: value.reason, wasClean: value.wasClean };
    }
    return maskDeep(value);
  }
  function maskHeaders(raw) {
    var out = {};
    var apikey = raw.apikey;
    Object.keys(raw).forEach(function (name) {
      var value = raw[name];
      if (name === 'authorization') {
        var m = /^(\S+)\s+([\s\S]*)$/.exec(value);
        if (!m) {
          out[name] = '[redacted]';
        } else {
          var same = apikey && m[2] === apikey ? ' (same as apikey: the request runs as the anon role)' : '';
          out[name] = m[1] + ' [redacted, length ' + m[2].length + ']' + same;
        }
      } else if (SENSITIVE_KEY.test(name)) {
        out[name] = '[redacted, length ' + String(value).length + ']';
      } else {
        out[name] = value;
      }
    });
    return out;
  }
  function headersToObject(source) {
    var out = {};
    if (!source) return out;
    try {
      new Headers(source).forEach(function (value, name) { out[name] = value; });
    } catch (e) {
      Object.keys(source).forEach(function (name) { out[name] = String(source[name]); });
    }
    return out;
  }
  function redactUrl(text) {
    var s = String(text);
    try {
      var u = new URL(s);
      var pairs = [];
      u.searchParams.forEach(function (value, key) { pairs.push(key + '=' + maskParam(key, value)); });
      return u.protocol + '//' + u.host + u.pathname + (pairs.length ? '?' + pairs.join('&') : '');
    } catch (e) {
      return scrub(s);
    }
  }

  // ------------------------------------------------------------------ bodies
  function tryParse(text) {
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PARSE_CHARS) return undefined;
    if (!/^\s*[\[{]/.test(text)) return undefined;
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }
  // `parsed` is the already-parsed JSON value when the caller has one (avoids a second parse).
  function formatBody(text, parsed) {
    if (text === '') return '(empty)';
    var value = parsed !== undefined ? parsed : tryParse(text);
    var rendered = value !== undefined ? JSON.stringify(maskDeep(value), null, 2) : scrub(text);
    return clip(rendered, previewLimit());
  }
  function describeBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return formatBody(body, undefined);
    if (typeof FormData !== 'undefined' && body instanceof FormData) return '[FormData]';
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return '[Blob ' + fmtBytes(body.size) + (body.type ? ', ' + body.type : '') + ']';
    }
    if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
      return '[binary ' + fmtBytes(body.byteLength) + ']';
    }
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return scrub(body.toString());
    return '[' + typeof body + ']';
  }
  function planBody(response) {
    var headers = response.headers;
    var contentType = (headers && headers.get('content-type')) || '';
    var lengthText = headers ? headers.get('content-length') : null;
    var bytes = lengthText !== null && lengthText !== '' && !isNaN(Number(lengthText)) ? Number(lengthText) : null;
    if (bytes !== null && bytes > MAX_BODY_BYTES) {
      return { readable: false, bytes: bytes, contentType: contentType, note: 'too large to preview' };
    }
    if (contentType && !/json|text|xml|csv|javascript|urlencoded/i.test(contentType)) {
      return { readable: false, bytes: bytes, contentType: contentType, note: 'binary body, not previewed' };
    }
    return { readable: true, bytes: bytes, contentType: contentType, note: null };
  }
  function byteLength(text) {
    return typeof Blob !== 'undefined' ? new Blob([text]).size : text.length;
  }
  function cancelStream(stream) {
    try {
      var cancelled = stream && stream.cancel ? stream.cancel() : null;
      if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(noop);
    } catch (e) { /* ignore */ }
  }
  // Reads the cloned body in chunks and stops at MAX_BODY_BYTES, so a large
  // download is never buffered in full just to produce a preview.
  function readPreview(probe) {
    var stream = probe.body;
    if (!stream || typeof stream.getReader !== 'function' || typeof TextDecoder === 'undefined') {
      return probe.text().then(function (text) {
        return { text: text, bytes: byteLength(text), truncated: false };
      });
    }
    var reader = stream.getReader();
    var decoder = new TextDecoder();
    var seen = 0;
    var text = '';
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return { text: text + decoder.decode(), bytes: seen, truncated: false };
        seen += chunk.value.byteLength;
        text += decoder.decode(chunk.value, { stream: true });
        if (seen > MAX_BODY_BYTES) {
          cancelStream(stream);
          return { text: text, bytes: seen, truncated: true };
        }
        return pump();
      });
    }
    return pump();
  }
  // Reads a clone of the response, so the app still receives an untouched body.
  function readBody(probe, plan) {
    if (!probe) {
      return Promise.resolve({ text: null, bytes: plan.bytes, contentType: plan.contentType, note: 'body unavailable' });
    }
    if (!plan.readable) {
      cancelStream(probe.body);
      return Promise.resolve({ text: null, bytes: plan.bytes, contentType: plan.contentType, note: plan.note });
    }
    return readPreview(probe).then(function (result) {
      return {
        text: result.text,
        bytes: plan.bytes !== null ? plan.bytes : result.bytes,
        contentType: plan.contentType,
        note: result.truncated ? 'preview stopped after ' + fmtBytes(MAX_BODY_BYTES) : null
      };
    });
  }

  // ------------------------------------------------------------------ request metadata
  function safeDecode(text) {
    try { return decodeURIComponent(text); } catch (e) { return text; }
  }
  function classify(url) {
    var path = url ? url.pathname : '';
    var m = /\/(rest|auth|functions|storage|realtime)\/v1\/(.*)$/.exec(path);
    if (!m) return { kind: 'HTTP', target: path || '?' };
    return { kind: KIND_BY_PATH[m[1]], target: safeDecode(m[2]) };
  }
  function describeRequest(input, init) {
    var raw = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string' ? input.url : String(input));
    var url = null;
    try {
      url = new URL(raw, window.location ? window.location.href : undefined);
    } catch (e) {
      url = null;
    }
    var meta = classify(url);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var pairs = [];
    var params = {};
    if (url) {
      url.searchParams.forEach(function (value, key) {
        var shown = maskParam(key, value);
        pairs.push(key + '=' + shown);
        params[key] = shown;
      });
    }
    var query = pairs.length ? '?' + pairs.join('&') : '';
    var headerSource = (init && init.headers) || (input && input.headers) || null;
    var signal = init && init.signal;
    return {
      method: method,
      kind: meta.kind,
      target: meta.target,
      display: scrub(meta.target + query),
      fullUrl: scrub((url ? url.origin + url.pathname : raw) + query),
      params: params,
      headers: maskHeaders(headersToObject(headerSource)),
      body: describeBody(init ? init.body : undefined),
      signal: signal ? 'attached (aborted=' + Boolean(signal.aborted) + ')' : null
    };
  }
  // The first js/*.js frames of the call stack: the app code that triggered the request.
  function callerChain() {
    var stack = '';
    var previous = Error.stackTraceLimit;
    try {
      Error.stackTraceLimit = 40;
      stack = new Error().stack || '';
    } catch (e) {
      stack = '';
    } finally {
      try { Error.stackTraceLimit = previous; } catch (ignored) { /* not supported */ }
    }
    var frames = [];
    String(stack).split('\n').forEach(function (line) {
      var m = APP_FRAME.exec(line);
      if (!m || m[1] === 'net-debug.js') return;
      var where = m[1] + ':' + m[2];
      if (frames.indexOf(where) === -1) frames.push(where);
    });
    return frames.length ? frames.slice(0, 4).join(' ← ') : '(supabase-js internals)';
  }

  // ------------------------------------------------------------------ errors and hints
  function errorFields(parsed, text) {
    var o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    var code = o.code || o.error_code || null;
    var message = o.message || o.msg || o.error_description || o.error || (typeof text === 'string' && text ? clip(scrub(text), 160) : '');
    return {
      code: code ? String(code) : null,
      message: message ? clip(asText(message), 200) : '',
      details: o.details || null,
      hint: o.hint || null
    };
  }
  function httpHint(kind, status, code, message) {
    var m = String(message || '');
    if (code === 'PGRST205' || /could not find the table/i.test(m)) {
      return 'The table is missing from the PostgREST schema cache. Apply the pending SQL migration in the Supabase SQL Editor, then retry.';
    }
    if (code === 'PGRST116') {
      return 'A single-row query (.single / .maybeSingle) matched zero or several rows. Expected for lookups such as login.';
    }
    if (code === '42501' || /row-level security/i.test(m)) {
      return 'Row-level security blocked this operation for the current role (anon). Check the RLS policies.';
    }
    if (code === '23505') return 'Unique constraint violated (duplicate key).';
    if (code === '23503') return 'Foreign key violated: the referenced row does not exist.';
    if (code === '23514') return 'CHECK constraint violated: the row does not satisfy a table constraint (see the constraint name).';
    if (code === '22P02') return 'Invalid input for the column type (for example, non-UUID text sent to a uuid column).';
    if (kind === 'FUNCTION' && (status === 401 || status === 403)) {
      return 'The Edge Function rejected the call (JWT verification or RBAC). Deploy it with: supabase functions deploy panic-alert --no-verify-jwt';
    }
    if (kind === 'FUNCTION' && status === 404) return 'Edge Function not found: it is not deployed under this name.';
    if (status === 401) return 'Unauthorized: the API key was rejected. Check SUPABASE_ANON_KEY in js/config.js.';
    if (status === 403) return 'Forbidden: blocked by RLS or grants for this role.';
    if (status === 404) return 'Not found: wrong table or route name, or the row does not exist.';
    if (status === 409) return 'Conflict with existing data (duplicate or constraint).';
    if (status === 429) return 'Rate limited by the API. Back off and retry.';
    if (status >= 500) return 'Server-side error: check the Supabase project logs.';
    return null;
  }
  function networkHints() {
    var hints = [];
    if (pageUnloading) {
      hints.push('The page is navigating away or closing, so the browser cancelled this request. This is not a server error.');
    }
    if (window.navigator && window.navigator.onLine === false) {
      hints.push('The browser reports no network connection (navigator.onLine is false).');
    }
    hints.push('No HTTP response was received. Check CORS (the page origin must be allowed in Supabase), DNS / TLS / proxy problems, ' +
      'ad-blockers or privacy extensions blocking the host, or the server being unreachable. The DevTools Network tab shows the blocked request.');
    return hints;
  }

  // ------------------------------------------------------------------ HTTP lifecycle
  function logStart(ctx, req) {
    group('[NexusNet]', COLOR.info, ctx.at + ' #' + ctx.id + ' ▶ ' + ctx.kind + ' ' + ctx.method + ' ' + clip(ctx.display, 160) +
      ' · in-flight ' + inFlightCount, [
      ['request', ctx.method + ' ' + ctx.fullUrl],
      ['target', ctx.target],
      ['params', Object.keys(req.params).length ? req.params : null],
      ['headers', req.headers],
      ['body', req.body],
      ['abort signal', req.signal],
      ['caller', ctx.caller]
    ]);
  }
  function beginTrace(input, init) {
    var req = describeRequest(input, init);
    var ctx = {
      id: ++seq,
      at: clock(),
      t0: clockMs(),
      method: req.method,
      kind: req.kind,
      target: req.target,
      display: req.display,
      fullUrl: req.fullUrl,
      caller: callerChain(),
      headersMs: null,
      timer: null
    };
    inFlight[ctx.id] = ctx;
    inFlightCount++;
    totals.requests++;
    safe(function () { logStart(ctx, req); });
    ctx.timer = setTimeout(function () {
      if (!inFlight[ctx.id]) return;
      safe(function () {
        say('warn', '[NexusNet]', COLOR.warn, clock() + ' #' + ctx.id + ' ⏳ still pending after ' + (STALL_MS / 1000) +
          ' s · ' + ctx.kind + ' ' + ctx.method + ' ' + clip(ctx.display, 120) + ' (blocked, hanging, or slow server?)');
      });
    }, STALL_MS);
    if (ctx.timer && ctx.timer.unref) ctx.timer.unref();
    return ctx;
  }
  function settle(ctx) {
    if (inFlight[ctx.id]) {
      delete inFlight[ctx.id];
      inFlightCount--;
    }
    if (ctx.timer) clearTimeout(ctx.timer);
    ctx.timer = null;
  }
  function remember(entry) {
    finished.push(entry);
    if (finished.length > HISTORY_LIMIT) finished.shift();
  }
  function onHeaders(ctx, response) {
    ctx.headersMs = clockMs() - ctx.t0;
    settle(ctx);
    var plan = planBody(response);
    var probe = null;
    try { probe = response.clone(); } catch (e) { probe = null; }
    readBody(probe, plan).then(function (body) {
      safe(function () { finishResponse(ctx, response, body, clockMs() - ctx.t0); });
    }, function (error) {
      safe(function () {
        finishResponse(ctx, response, {
          text: null,
          bytes: plan.bytes,
          contentType: plan.contentType,
          note: 'body read failed: ' + (error && error.message ? error.message : String(error))
        }, clockMs() - ctx.t0);
      });
    });
  }
  function finishResponse(ctx, response, body, totalMs) {
    var status = response.status;
    var stamp = clock();
    var parsed = tryParse(body.text);
    var rows = Array.isArray(parsed) ? parsed.length : null;
    var range = response.headers ? response.headers.get('content-range') : null;
    var err = status >= 400 ? errorFields(parsed, body.text) : null;
    var slow = totalMs > SLOW_MS;
    var statusLabel = status + (response.statusText ? ' ' + response.statusText : '');
    var summaryText = '#' + ctx.id + ' ◀ ' + statusLabel + ' · ' + fmtMs(totalMs) + ' · ' + fmtBytes(body.bytes) +
      (rows !== null ? ' · ' + rows + ' row' + (rows === 1 ? '' : 's') : '') +
      (range ? ' · range ' + range : '') +
      (slow ? ' · SLOW' : '');
    var color = status < 300 ? COLOR.ok : status < 400 ? COLOR.info : status < 500 ? COLOR.warn : COLOR.error;
    var hint = status >= 400 ? httpHint(ctx.kind, status, err.code, err.message) : null;

    totals.durationSum += totalMs;
    if (status >= 400) totals.httpErrors++;
    else totals.ok++;
    remember({
      id: ctx.id,
      time: ctx.at,
      kind: ctx.kind,
      method: ctx.method,
      target: clip(ctx.target, 120),
      status: status,
      ms: Math.round(totalMs),
      bytes: body.bytes,
      rows: rows,
      error: err ? (err.code || err.message || 'error') : null,
      caller: ctx.caller
    });

    if (status >= 400) {
      say(status >= 500 ? 'error' : 'warn', '[NexusNet]', color, stamp + ' ' + summaryText +
        (err.code ? ' · ' + err.code : '') + (err.message ? ' · ' + clip(err.message, 160) : ''));
    } else if (slow) {
      say('warn', '[NexusNet]', COLOR.warn, stamp + ' ' + summaryText);
    }
    group('[NexusNet]', color, stamp + ' ' + summaryText, [
      ['request', ctx.method + ' ' + ctx.fullUrl],
      ['status', statusLabel + ' · ok=' + response.ok + ' · type=' + response.type +
        (response.redirected ? ' · redirected to ' + redactUrl(response.url) : '')],
      ['timing', 'headers after ' + fmtMs(ctx.headersMs) + ' · body read ' +
        fmtMs(Math.max(0, totalMs - ctx.headersMs)) + ' · total ' + fmtMs(totalMs)],
      ['size', fmtBytes(body.bytes) + (body.contentType ? ' · ' + body.contentType : '') + (body.note ? ' · ' + body.note : '')],
      ['response headers', maskHeaders(headersToObject(response.headers))],
      ['body', body.text === null ? null : formatBody(body.text, parsed)],
      ['error', err ? { code: err.code, message: err.message, details: err.details, hint: err.hint } : null],
      ['hint', hint],
      ['caller', ctx.caller]
    ]);
  }
  function onFailure(ctx, error) {
    settle(ctx);
    var stamp = clock();
    var total = clockMs() - ctx.t0;
    var name = error && error.name ? String(error.name) : 'Error';
    var message = error && error.message ? String(error.message) : String(error);
    var aborted = name === 'AbortError' || name === 'TimeoutError';
    var hints;
    totals.durationSum += total;
    if (aborted) {
      totals.aborted++;
      hints = ['Cancelled on the client (AbortController or timeout). Check the timeout set by the caller.'];
      say('warn', '[NexusNet]', COLOR.warn, stamp + ' #' + ctx.id + ' ⊘ ABORTED after ' + fmtMs(total) + ' · ' + name + ' · ' +
        clip(ctx.display, 100));
    } else {
      totals.networkErrors++;
      hints = networkHints();
      say('error', '[NexusNet]', COLOR.error, stamp + ' #' + ctx.id + ' ✖ NETWORK ERROR after ' + fmtMs(total) + ' · ' + name +
        ': ' + message + ' · ' + clip(ctx.display, 100));
    }
    remember({
      id: ctx.id,
      time: ctx.at,
      kind: ctx.kind,
      method: ctx.method,
      target: clip(ctx.target, 120),
      status: aborted ? 'ABORTED' : 'NETWORK',
      ms: Math.round(total),
      bytes: null,
      rows: null,
      error: name,
      caller: ctx.caller
    });
    group('[NexusNet]', aborted ? COLOR.warn : COLOR.error, stamp + ' #' + ctx.id + ' ' + ctx.kind + ' ' + ctx.method + ' ' +
      clip(ctx.display, 120) + (aborted ? ' aborted' : ' failed'), [
      ['request', ctx.method + ' ' + ctx.fullUrl],
      ['elapsed', fmtMs(total)],
      ['error', name + ': ' + message],
      ['browser online', window.navigator ? window.navigator.onLine : undefined],
      ['page unloading', pageUnloading ? 'yes' : null],
      ['hints', hints],
      ['caller', ctx.caller]
    ]);
  }

  /**
   * fetch replacement injected as `global.fetch`. Returns the original response
   * or rethrows the original error; the logs are side effects only.
   */
  function debugFetch(input, init) {
    if (!nativeFetch) return Promise.reject(new TypeError('fetch is not available in this environment'));
    var ctx = null;
    if (flags.enabled) {
      try {
        ctx = beginTrace(input, init);
      } catch (e) {
        ctx = null;
        try { console.warn('[NexusNet] internal error while starting the trace:', e); } catch (ignored) { /* no console */ }
      }
    }
    var pending;
    try {
      pending = nativeFetch(input, init);
    } catch (err) {
      pending = Promise.reject(err);
    }
    if (!ctx) return pending;
    return pending.then(function (response) {
      safe(function () { onHeaders(ctx, response); });
      return response;
    }, function (error) {
      safe(function () { onFailure(ctx, error); });
      throw error;
    });
  }

  // ------------------------------------------------------------------ Realtime
  function frameSize(data) {
    if (typeof data === 'string') return data.length + ' chars';
    if (data && typeof data.byteLength === 'number') return fmtBytes(data.byteLength);
    if (data && typeof data.size === 'number') return fmtBytes(data.size);
    return 'unknown size';
  }
  function framePreview(data) {
    // Binary frames (Realtime v2 user broadcasts) are not decoded, so nothing inside them is printed.
    if (typeof data === 'string') return clip(scrub(data), previewLimit());
    return '[binary frame, ' + frameSize(data) + ', not decoded]';
  }
  // WebSocket subclass passed as `realtime.transport`: it sees the socket lifecycle directly.
  function getTransport() {
    if (TransportClass || !NativeWebSocket) return TransportClass;
    TransportClass = class NexusDebugWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        var id = ++wsSeq;
        var created = clockMs();
        var opened = null;
        this.__nexusWsId = id;
        safe(function () {
          say('log', '[NexusNet WS]', COLOR.ws, '#' + id + ' ▶ connecting → ' + redactUrl(url));
        });
        this.addEventListener('open', function () {
          safe(function () {
            opened = clockMs();
            say('log', '[NexusNet WS]', COLOR.ws, '#' + id + ' ✔ open · handshake ' + fmtMs(opened - created) +
              ' · page ' + visibility());
          });
        });
        this.addEventListener('message', function (ev) {
          safe(function () {
            if (flags.verbose) {
              say('log', '[NexusNet WS]', COLOR.quiet, '#' + id + ' ← frame ' + frameSize(ev.data), [framePreview(ev.data)]);
            }
          });
        });
        this.addEventListener('error', function () {
          safe(function () {
            say('error', '[NexusNet WS]', COLOR.error, '#' + id +
              ' ✖ socket error (browsers hide the details; the close event that follows has the code)');
          });
        });
        this.addEventListener('close', function (ev) {
          safe(function () {
            var code = ev.code;
            var meaning = CLOSE_CODES[code] || (code >= 4000 && code < 5000 ? 'application-defined' : 'see RFC 6455');
            var lived = opened !== null ? fmtMs(clockMs() - opened) : null;
            var level = code === 1000 || code === 1001 ? 'log' : 'warn';
            say(level, '[NexusNet WS]', COLOR.ws, '#' + id + ' ■ closed · code ' + code + ' (' + meaning + ') · ' +
              (ev.wasClean ? 'clean' : 'NOT clean') + (ev.reason ? ' · reason "' + ev.reason + '"' : '') +
              (lived ? ' · lived ' + lived : ' · never opened') + ' · page ' + visibility());
          });
        });
      }
      send(data) {
        var id = this.__nexusWsId;
        safe(function () {
          if (flags.verbose) {
            say('log', '[NexusNet WS]', COLOR.quiet, '#' + id + ' → frame ' + frameSize(data), [framePreview(data)]);
          }
        });
        return super.send(data);
      }
    };
    return TransportClass;
  }
  // phoenix logger (realtime.logger): push, receive, channel, transport and error events.
  function realtimeLogger(kind, msg, data) {
    if (!flags.enabled) return;
    safe(function () {
      var text = String(msg);
      if (!flags.verbose && (kind === 'push' || kind === 'receive') && HEARTBEAT_MSG.test(text)) return;
      if (kind === 'transport' && (text === 'close' || text === 'error')) return; // printed by the socket wrapper
      var level = kind === 'error' ? 'error' : /timeout|error|discard|overflow|dropping/i.test(text) ? 'warn' : 'log';
      say(level, '[NexusNet WS]', COLOR.ws, scrub(kind + ' · ' + text), data === undefined ? undefined : [sanitizeForLog(data)]);
    });
  }
  // Heartbeat status with latency (realtime.heartbeatCallback).
  function heartbeat(status, latency) {
    safe(function () {
      if (status === 'ok') {
        say('log', '[NexusNet WS]', COLOR.ws, '♥ heartbeat ok · latency ' + fmtMs(latency));
      } else if (status === 'sent') {
        if (flags.verbose) say('log', '[NexusNet WS]', COLOR.quiet, '♥ heartbeat sent');
      } else if (status === 'timeout') {
        say('warn', '[NexusNet WS]', COLOR.warn, '✖ heartbeat TIMEOUT: the server did not answer; the socket will be recycled');
      } else if (status === 'disconnected') {
        say('warn', '[NexusNet WS]', COLOR.warn, '♥ heartbeat skipped: the socket is disconnected');
      } else if (status === 'error') {
        say('error', '[NexusNet WS]', COLOR.error, '✖ heartbeat error' + (latency !== undefined ? ' · ' + fmtMs(latency) : ''));
      } else {
        say('log', '[NexusNet WS]', COLOR.quiet, '♥ heartbeat ' + status);
      }
    });
  }

  // ------------------------------------------------------------------ GoTrue (auth)
  function authDebug() {
    if (!flags.verbose) return;
    var args = Array.prototype.slice.call(arguments);
    safe(function () {
      var head = typeof args[0] === 'string' ? args[0] : '';
      var rest = typeof args[0] === 'string' ? args.slice(1) : args;
      say('log', '[NexusNet AUTH]', COLOR.quiet, scrub(head), rest.map(function (item) { return sanitizeForLog(item); }));
    });
  }

  // ------------------------------------------------------------------ setup helpers
  function describeKey(key) {
    var k = String(key || '');
    if (!k) return { label: '(missing)', warning: 'No API key configured: every request will be rejected.' };
    if (k.indexOf('sb_secret_') === 0) {
      return {
        label: 'SECRET key (sb_secret_...), length ' + k.length,
        warning: 'A SECRET key is shipped to the browser, which bypasses RLS. Rotate it and use the publishable key in js/config.js.'
      };
    }
    if (k.indexOf('sb_publishable_') === 0) {
      return { label: 'publishable (sb_publishable_...), length ' + k.length, warning: null };
    }
    var parts = k.split('.');
    if (parts.length === 3) {
      var role = null;
      try {
        role = JSON.parse(b64urlDecode(parts[1])).role || null;
      } catch (e) {
        role = null;
      }
      if (role === 'service_role') {
        return {
          label: 'JWT role=service_role',
          warning: 'A service_role JWT is shipped to the browser, which bypasses RLS. Rotate it immediately.'
        };
      }
      return { label: 'legacy JWT role=' + (role || '?') + ', length ' + k.length, warning: null };
    }
    return {
      label: 'unrecognized format, length ' + k.length,
      warning: 'Unrecognized API key format: check SUPABASE_ANON_KEY in js/config.js.'
    };
  }
  function b64urlDecode(segment) {
    var s = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return window.atob(s);
  }
  // Options merged into createClient() by js/supabase-client.js.
  function clientOptions() {
    var realtime = { logger: realtimeLogger, heartbeatCallback: heartbeat };
    var transport = getTransport();
    if (transport) realtime.transport = transport;
    return {
      global: { fetch: debugFetch },
      realtime: realtime,
      auth: { debug: authDebug }
    };
  }
  // Called once after createClient(): where the connection goes and which key type is used.
  function clientCreated(info) {
    safe(function () {
      var opts = info || {};
      var url = String(opts.url || '').replace(/\/+$/, '');
      var key = describeKey(opts.key);
      var host = url;
      try { host = new URL(url).host; } catch (e) { host = url || '(no URL)'; }
      group('[NexusNet]', COLOR.ok, 'Supabase client ready → ' + host, [
        ['project URL', url],
        ['URL came from', opts.urlSource || 'unknown'],
        ['API key', key.label],
        ['REST / Auth / Functions', url + ' (all HTTP goes through the debug fetch)'],
        ['Realtime WebSocket', redactUrl(url.replace(/^http/i, 'ws') + '/realtime/v1/websocket')],
        ['debug', 'logging ON · verbose ' + (flags.verbose ? 'ON' : 'off') + ' · NexusNetDebug.help() lists the controls']
      ]);
      if (key.warning) say('warn', '[NexusNet]', COLOR.warn, key.warning);
    });
  }
  function note(level, text, details) {
    safe(function () {
      var color = level === 'error' ? COLOR.error : level === 'warn' ? COLOR.warn : COLOR.info;
      say(level === 'error' || level === 'warn' ? level : 'log', '[NexusNet]', color, text,
        details === undefined ? undefined : [sanitizeForLog(details)]);
    });
  }

  // ------------------------------------------------------------------ public controls
  function summary() {
    var done = totals.ok + totals.httpErrors + totals.networkErrors + totals.aborted;
    return {
      version: VERSION,
      enabled: flags.enabled,
      verbose: flags.verbose,
      requests: totals.requests,
      inFlight: inFlightCount,
      ok: totals.ok,
      httpErrors: totals.httpErrors,
      networkErrors: totals.networkErrors,
      aborted: totals.aborted,
      avgMs: done ? Math.round(totals.durationSum / done) : null
    };
  }
  function pendingList() {
    var now = clockMs();
    return Object.keys(inFlight).map(function (id) {
      var c = inFlight[id];
      return { id: c.id, kind: c.kind, method: c.method, target: c.target, ageMs: Math.round(now - c.t0), caller: c.caller };
    });
  }
  function table() {
    console.table(finished);
  }
  function help() {
    console.log('%s', [
      'NexusNetDebug.help()                 this list',
      'NexusNetDebug.disable() / enable()   turn network logging off / on (saved in localStorage)',
      'NexusNetDebug.verbose(true|false)    also log raw WebSocket frames and GoTrue internals',
      'NexusNetDebug.summary()              counters: requests, errors, average duration, in-flight',
      'NexusNetDebug.pending()              requests still in flight, with their age and caller',
      'NexusNetDebug.table()                the last 200 finished requests as a table',
      'NexusNetDebug.history()              the same entries as an array',
      'Filter the console with "[NexusNet" to show only this output.'
    ].join('\n'));
  }

  // Page-level events that explain failures.
  function listen(target, type, fn) {
    try {
      if (target && typeof target.addEventListener === 'function') target.addEventListener(type, fn);
    } catch (e) { /* ignore */ }
  }
  listen(window, 'online', function () {
    note('log', 'browser is ONLINE again');
  });
  listen(window, 'offline', function () {
    note('warn', 'browser went OFFLINE: HTTP requests and the Realtime socket will fail until it is back');
  });
  listen(window, 'pagehide', function () {
    pageUnloading = true;
    if (inFlightCount) {
      note('warn', 'page is unloading with ' + inFlightCount + ' request(s) in flight; the browser will cancel them');
    }
  });
  listen(window, 'storage', function (ev) {
    if (ev.key === STORAGE_KEY) flags.enabled = ev.newValue !== 'off';
    if (ev.key === VERBOSE_KEY) flags.verbose = ev.newValue === 'on';
  });
  listen(window.document, 'visibilitychange', function () {
    note('log', 'page visibility changed to ' + visibility());
  });

  window.NexusNetDebug = {
    version: VERSION,
    fetch: debugFetch,
    clientOptions: clientOptions,
    clientCreated: clientCreated,
    note: note,
    isEnabled: function () { return flags.enabled; },
    enable: function () {
      writeStorage(STORAGE_KEY, null);
      flags.enabled = true;
      note('log', 'debug logging ENABLED');
      return true;
    },
    disable: function () {
      note('log', 'debug logging DISABLED (NexusNetDebug.enable() turns it back on)');
      flags.enabled = false;
      writeStorage(STORAGE_KEY, 'off');
      return false;
    },
    verbose: function (on) {
      flags.verbose = Boolean(on);
      writeStorage(VERBOSE_KEY, flags.verbose ? 'on' : null);
      note('log', 'verbose mode ' + (flags.verbose ? 'ON (raw WebSocket frames, GoTrue internals, larger previews)' : 'OFF'));
      return flags.verbose;
    },
    summary: summary,
    pending: pendingList,
    history: function () { return finished.slice(); },
    table: table,
    help: help
  };

  note('log', 'Network debug ON (v' + VERSION + '): logging every Supabase request, response and Realtime event. ' +
    'NexusNetDebug.help() lists the controls.');
})(window);
