#!/usr/bin/env node
/**
 * TESTE — EDGE FUNCTION log-acesso (log de IP e user agent de usuários autenticados)
 * ------------------------------------------------------------
 *  1. Sem identidade (codigo_individual ausente) → 401, nada gravado.
 *  2. Código inexistente ou funcionário inativo → 401, nada gravado.
 *  3. Usuário ativo → 200 e insert com IP (cf-connecting-ip > x-real-ip > x-forwarded-for),
 *     user agent e página.
 *  4. IP inválido é descartado (null); user agent é truncado em 512 caracteres.
 *  5. Método GET → 405; OPTIONS → 204 (CORS).
 *  6. Falha de banco na validação ou na gravação → 500.
 *  7. Migração cria a tabela com RLS ativo e sem policies.
 *  8. config.toml: verify_jwt = false para log-acesso.
 *
 * Uso: node tests/test_log_acesso.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let total = 0;
let falhas = 0;

function check(desc, ok, detalhe) {
  total++;
  if (ok) console.log(`  ✅ [PASS] ${desc}`);
  else {
    falhas++;
    console.log(`  ❌ [FAIL] ${desc}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
}

function headers(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k) => (m.has(k.toLowerCase()) ? m.get(k.toLowerCase()) : null) };
}

function criarClienteFalso({ funcionarios = [], erroBusca = null, erroInsert = null } = {}) {
  const inserts = [];
  return {
    inserts,
    criarCliente() {
      return {
        from(tabela) {
          const estado = { filtros: {} };
          const api = {
            select() { return api; },
            eq(col, val) { estado.filtros[col] = val; return api; },
            maybeSingle() {
              if (erroBusca) return Promise.resolve({ data: null, error: erroBusca });
              const achado = funcionarios.find((f) => f.codigo_individual === estado.filtros.codigo_individual) || null;
              return Promise.resolve({ data: achado, error: null });
            },
            insert(linha) {
              inserts.push({ tabela, linha });
              return Promise.resolve({ error: erroInsert });
            },
          };
          return api;
        },
      };
    },
  };
}

function req(method, body, hdrs = {}) {
  return {
    method,
    headers: headers(hdrs),
    text: async () => (body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))),
  };
}

const ENV = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'chave-teste' };
const env = (n) => ENV[n] ?? '';
const FUNCIONARIOS = [
  { id: 'f-ativo', codigo_individual: 'EST-8001', ativo: true },
  { id: 'f-inativo', codigo_individual: 'EST-9999', ativo: false },
];

async function main() {
  console.log('\n=== TESTE: EDGE FUNCTION log-acesso ===\n');

  const mod = await import(path.join(ROOT, 'supabase/functions/log-acesso/handler.js'));
  const { criarHandler, normalizarIp, extrairIp, extrairUserAgent } = mod;

  console.log('1. Autenticação obrigatória');
  {
    const f = criarClienteFalso({ funcionarios: FUNCIONARIOS });
    const handler = criarHandler({ criarCliente: f.criarCliente, env });
    const r = await handler(req('POST', { pagina: 'dashboard' }, { 'user-agent': 'UA' }));
    check('Sem codigo_individual → 401', r.status === 401, `status=${r.status}`);
    check('Sem codigo_individual → nada gravado', f.inserts.length === 0);

    const r2 = await handler(req('POST', { codigo_individual: 'XXX-0000' }));
    check('Código inexistente → 401', r2.status === 401, `status=${r2.status}`);
    check('Código inexistente → nada gravado', f.inserts.length === 0);

    const r3 = await handler(req('POST', { codigo_individual: 'EST-9999' }));
    check('Funcionário inativo → 401', r3.status === 401, `status=${r3.status}`);
    check('Funcionário inativo → nada gravado', f.inserts.length === 0);

    const r4 = await handler(req('POST', '{json inválido'));
    check('Corpo inválido → 400', r4.status === 400, `status=${r4.status}`);
  }

  console.log('\n2. Registro de usuário autenticado');
  {
    const f = criarClienteFalso({ funcionarios: FUNCIONARIOS });
    const handler = criarHandler({ criarCliente: f.criarCliente, env });
    const r = await handler(req('POST', { codigo_individual: 'EST-8001', pagina: 'cargas' }, {
      'cf-connecting-ip': '189.10.20.30',
      'x-real-ip': '10.0.0.1',
      'x-forwarded-for': '1.1.1.1, 10.0.0.2',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    }));
    const corpo = await r.json();
    check('Usuário ativo → 200', r.status === 200, `status=${r.status}`);
    check('Resposta ok:true', corpo.ok === true);
    check('Insert feito na tabela log_acessos_usuarios', f.inserts.length === 1 && f.inserts[0].tabela === 'log_acessos_usuarios');
    const linha = f.inserts[0]?.linha || {};
    check('funcionario_id correto', linha.funcionario_id === 'f-ativo');
    check('IP vem de cf-connecting-ip (prioridade máxima)', linha.ip === '189.10.20.30', `ip=${linha.ip}`);
    check('User agent gravado', linha.user_agent === 'Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    check('Página gravada', linha.pagina === 'cargas');
    check('Linha não grava codigo_individual/nome', !('codigo_individual' in linha) && !('nome' in linha));
  }

  console.log('\n3. Prioridade e validação de IP');
  check('x-real-ip usado sem cf-connecting-ip', extrairIp(headers({ 'x-real-ip': '10.1.2.3' })) === '10.1.2.3');
  check('x-forwarded-for usa o primeiro item', extrairIp(headers({ 'x-forwarded-for': '8.8.8.8, 10.0.0.1' })) === '8.8.8.8');
  check('IP inválido vira null', extrairIp(headers({ 'cf-connecting-ip': 'lixo<script>' })) === null);
  check('Octeto > 255 é rejeitado', normalizarIp('999.1.1.1') === null);
  check('IPv6 válido é aceito', normalizarIp('2001:db8::1') === '2001:db8::1');
  check('Sem cabeçalhos → null', extrairIp(headers({})) === null);
  check('IP enviado no corpo é ignorado', (() => {
    const f = criarClienteFalso({ funcionarios: FUNCIONARIOS });
    const handler = criarHandler({ criarCliente: f.criarCliente, env });
    return handler(req('POST', { codigo_individual: 'EST-8001', ip: '6.6.6.6' }, {})).then(() =>
      f.inserts[0].linha.ip === null);
  })());

  console.log('\n4. User agent');
  check('User agent truncado em 512 caracteres', extrairUserAgent(headers({ 'user-agent': 'a'.repeat(2000) })).length === 512);
  check('User agent ausente → null', extrairUserAgent(headers({})) === null);

  console.log('\n5. Método e CORS');
  {
    const handler = criarHandler({ criarCliente: criarClienteFalso().criarCliente, env });
    check('GET → 405', (await handler(req('GET'))).status === 405);
    const opt = await handler(req('OPTIONS'));
    check('OPTIONS → 204 com CORS', opt.status === 204 && opt.headers.get('Access-Control-Allow-Origin') === '*');
  }

  console.log('\n6. Falhas de banco');
  {
    const h1 = criarHandler({ criarCliente: criarClienteFalso({ erroBusca: { message: 'x' } }).criarCliente, env });
    check('Erro na busca do funcionário → 500', (await h1(req('POST', { codigo_individual: 'EST-8001' }))).status === 500);
    const h2 = criarHandler({ criarCliente: criarClienteFalso({ funcionarios: FUNCIONARIOS, erroInsert: { message: 'x' } }).criarCliente, env });
    check('Erro no insert → 500', (await h2(req('POST', { codigo_individual: 'EST-8001' }))).status === 500);
    const h3 = criarHandler({ criarCliente: criarClienteFalso().criarCliente, env: () => '' });
    check('Sem variáveis de ambiente → 500', (await h3(req('POST', { codigo_individual: 'EST-8001' }))).status === 500);
  }

  console.log('\n7. Migração e configuração');
  {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261010010000_log_acessos_usuarios.sql'), 'utf8');
    check('Tabela log_acessos_usuarios criada', /create table if not exists public\.log_acessos_usuarios/i.test(sql));
    check('RLS ativado na tabela', /alter table public\.log_acessos_usuarios enable row level security/i.test(sql));
    check('Nenhuma policy criada (somente service role)', !/create policy/i.test(sql));
    const toml = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
    check('config.toml: log-acesso com verify_jwt = false', /\[functions\.log-acesso\]\s*verify_jwt = false/.test(toml));
    check('index.ts da função existe', fs.existsSync(path.join(ROOT, 'supabase/functions/log-acesso/index.ts')));
  }

  console.log(`\nResultado: ${total - falhas}/${total} verificações passaram.`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
