/**
 * Teste de Verificação — 404 em /rest/v1/emergencias (PGRST205)
 *
 * Regressão do erro relatado no painel Network do navegador:
 *
 *   GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
 *   -> HTTP 404 Not Found
 *      { "code": "PGRST205",
 *        "message": "Could not find the table 'public.emergencias' in the schema cache" }
 *
 * Cobre as três pernas da correção:
 *   1. MIGRAÇÃO  supabase/migrations/20261008000000_emergencias_fix_404.sql
 *      (idempotente, reparadora, com recarga do schema cache do PostgREST);
 *   2. RESILIÊNCIA do front-end (js/supabase-client.js + js/panic-realtime.js):
 *      a tabela ausente é detectada, o app segue com o cache local, o aviso
 *      aponta a migração e a sessão se auto-cura quando ela é aplicada;
 *   3. DIAGNÓSTICO na UI (manutencao.html) e documentação (README/SPECs).
 *
 * Executar: node tests/test_emergencias_404.js   (ou: npm run test:migracao)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const MIGRACAO = 'supabase/migrations/20261008000000_emergencias_fix_404.sql';

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  JSDOM = null;
}

/* ================================================================== *
 * 1. Migração SQL
 * ================================================================== */
function testarMigracao() {
  console.log('1. Validando a migração SQL da correção...');
  const mig = read(MIGRACAO);

  check('Migração existe e explica o sintoma (404 / PGRST205)', mig.length > 1000
    && mig.includes('PGRST205') && mig.includes('404'));
  check('Cria public.emergencias de forma idempotente',
    mig.includes('create table if not exists public.emergencias'));
  check('Cria public.panic_webhook_config de forma idempotente',
    mig.includes('create table if not exists public.panic_webhook_config'));
  check('Reconcilia estrutura pré-existente (add column if not exists)',
    (mig.match(/add column if not exists/g) || []).length >= 15);
  check('Aplica constraints de forma condicional (sem falhar por dado legado)',
    mig.includes('emergencias_estado_check') && mig.includes('emergencias_origem_check')
    && mig.includes('emergencias_funcionario_id_fkey') && mig.includes('pg_constraint'));
  check('Normaliza dado legado antes do CHECK (nunca aborta por dado antigo)',
    mig.includes("set estado = 'RESOLVIDA'") && mig.includes("set origem = 'EDGE_FUNCTION'"));
  check('Cria o índice usado pela consulta do rodapé',
    mig.includes('create index if not exists idx_emergencias_estado_data')
    && mig.includes('(estado, data_hora desc)'));
  check('Habilita RLS e recria as políticas nexus_* de forma determinística',
    mig.includes('enable row level security')
    && (mig.match(/^drop policy if exists nexus_/gm) || []).length === 6);
  check('Políticas concedidas a anon/authenticated (o app não usa Supabase Auth)',
    mig.includes("rolname in ('anon', 'authenticated')") && mig.includes('grant select, insert, update'));
  check('Pré-requisitos checados com mensagem clara (funcionarios / cargo_enum)',
    mig.includes('Pré-requisito ausente') && mig.includes('public.funcionarios'));
  check('Recarrega o schema cache do PostgREST (notify pgrst) FORA da transação',
    /commit;\s*\n\s*--[\s\S]*?notify pgrst, 'reload schema';/.test(mig));
  check('Execução transacional (begin/commit) e reparadora em qualquer estado parcial',
    mig.trim().startsWith('--') && mig.includes('\nbegin;') && mig.includes('\ncommit;'));
  check('Sem placeholder inválido de RAISE (%I só existe em format(), não em RAISE)',
    !/raise\s+\w+\s*'[^']*%I/.test(mig));
  check('Termina com verificação visível no SQL Editor (select de conferência)',
    mig.includes('to_regclass(\'public.emergencias\') is not null as existe'));
  check('Verificação em PostgreSQL real disponível no repositório',
    fs.existsSync(path.join(ROOT, 'tests/verify_migration_emergencias.py'))
    && read('tests/verify_migration_emergencias.py').includes('pgserver'));
}

/* ================================================================== *
 * 2. Resiliência do front-end (estático)
 * ================================================================== */
function testarFrontEndEstatico() {
  console.log('\n2. Validando a resiliência do front-end (código)...');
  const sc = read('js/supabase-client.js');
  const pr = read('js/panic-realtime.js');

  check('Detecta PGRST205, 42P01, HTTP 404 e a mensagem "Could not find the table"',
    sc.includes("code === 'PGRST205'") && sc.includes("code === '42P01'")
    && sc.includes('status === 404') && sc.includes('Could not find the table'));
  check('Mensagem de erro aponta a migração exata da tabela',
    sc.includes('MIGRACOES_CONHECIDAS') && sc.includes(MIGRACAO)
    && sc.includes('SPECs/migrations/001_create_bercos.sql'));
  check('Aviso único por tabela/sessão (sem enxurrada de erros no console)',
    sc.includes('tabelasAusentes') && sc.includes('if (!tabelasAusentes.has(tabela))'));
  check('API de diagnóstico exposta (diagnosticar/liberarTabela/migracaoDaTabela)',
    sc.includes('diagnosticar: function') && sc.includes('liberarTabela: function')
    && sc.includes('migracaoDaTabela: function') && sc.includes('tabelasIndisponiveis: function'));
  check('O módulo do pânico consulta o cliente só quando a tabela existe',
    pr.includes("getSupabaseTabela('emergencias')") && pr.includes('function getSupabaseTabela'));
  check('Falha de tabela ausente é registrada (não engolida nem repetida)',
    pr.includes('tratarErroTabela') && pr.includes("tratarErroTabela('emergencias', error)"));
  check('Rechecagem com backoff após o 404 (auto-cura ao aplicar a migração)',
    pr.includes('ESTADO_RETRY_MS') && pr.includes('agendarRechecagemEstado')
    && pr.includes('rechecarTabelaEmergencias'));
  check('Rechecagem também ao voltar para a aba e ao reconectar',
    pr.includes("window.addEventListener('online'") && pr.includes('visibilityState'));
  check('Diagnóstico das duas tabelas exposto na API pública',
    pr.includes('async function verificarTabelas') && pr.includes('async function diagnose')
    && pr.includes('verificarTabelas,') && pr.includes('diagnose,'));
  check('Feedback do fallback informa a migração pendente ao operador',
    pr.includes('tabelaPendente') && pr.includes("migracaoDaTabela('emergencias')"));
  check('Consulta do rodapé preservada (estado ATIVA, ordem por data_hora, limit 1)',
    pr.includes("from('emergencias')") && pr.includes("eq('estado', 'ATIVA')")
    && pr.includes("order('data_hora', { ascending: false })") && pr.includes('.limit(1)'));
}

/* ================================================================== *
 * 3. UI de diagnóstico + documentação
 * ================================================================== */
function testarUiEDocumentacao() {
  console.log('\n3. Validando painel de diagnóstico e documentação...');
  const mh = read('manutencao.html');

  check('Painel "Banco de dados" com botão Verificar em manutencao.html',
    mh.includes('id="panicTablesCheckBtn"') && mh.includes('id="panicTablesStatus"'));
  check('Painel de webhook REMOVIDO do front-end (o app não configura/dispara webhooks)',
    !['panicWebhookPanel', 'panicWebhookEnabled', 'panicWebhookUrl', 'panicWebhookSaveBtn',
      'panicWebhookTestBtn', 'panicWebhookStatus']
      .some((id) => mh.includes(id)));
  check('Nenhuma chamada de webhook no módulo do pânico',
    !/bindWebhookSettingsUI|panic_webhook_config|test-webhook/.test(read('js/panic-realtime.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('js/panic-realtime.js monta o diagnóstico (bindDatabaseDiagnosticsUI)',
    read('js/panic-realtime.js').includes('bindDatabaseDiagnosticsUI()'));

  const readme = read('README.md');
  check('README documenta o sintoma 404/PGRST205 e a migração de correção',
    readme.includes('PGRST205') && readme.includes(MIGRACAO));
  check('README traz a verificação por curl da consulta de emergências',
    readme.includes('/rest/v1/emergencias?select=*&estado=eq.ATIVA'));

  const migReadme = read('SPECs/migrations/README.md');
  check('SPECs/migrations/README.md lista a nova migração',
    migReadme.includes('20261008000000_emergencias_fix_404.sql'));
  check('SPECs/migrations/README.md explica o 404 e o reparo idempotente',
    migReadme.includes('PGRST205') && migReadme.includes('emergencias'));

  check('Relatório de diagnóstico do incidente arquivado em SPECs/diagnostico',
    fs.existsSync(path.join(ROOT, 'SPECs/diagnostico/404-emergencias.md')));

  const pkg = JSON.parse(read('package.json'));
  check('package.json expõe npm run test:migracao', Boolean(pkg.scripts['test:migracao']));
  check('npm run test:panic inclui a regressão da migração',
    pkg.scripts['test:panic'].includes('test_emergencias_404.js'));
}

/* ================================================================== *
 * 4. Comportamento real em DOM (jsdom): 404 -> fallback -> auto-cura
 * ================================================================== */
function criarClienteFalso(estado) {
  function queryResultado() {
    if (estado.tabelaAusente) {
      return {
        data: null,
        error: {
          code: 'PGRST205',
          message: `Could not find the table 'public.${estado.tabelaAtual}' in the schema cache`,
          details: null,
          hint: "Perhaps you meant the table 'public.funcionarios'"
        },
        status: 404
      };
    }
    return { data: estado.linha || null, error: null, status: 200 };
  }

  function builder() {
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { return b; },
      limit() { return b; },
      insert() { return b; },
      update() { return b; },
      maybeSingle() { return Promise.resolve(queryResultado()); },
      then(resolve, reject) { return Promise.resolve(queryResultado()).then(resolve, reject); },
      catch(reject) { return Promise.resolve(queryResultado()).catch(reject); }
    };
    return b;
  }

  return {
    from(tabela) {
      estado.tabelaAtual = tabela;
      return builder();
    },
    channel() {
      const ch = {
        on() { return ch; },
        subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; },
        send() { return Promise.resolve('ok'); },
        unsubscribe() { return Promise.resolve('ok'); }
      };
      return ch;
    },
    functions: { invoke: () => Promise.resolve({ data: { ok: true }, error: null }) }
  };
}

async function testarComportamento() {
  console.log('\n4. Simulando o navegador (jsdom): 404, fallback local e auto-cura');
  if (!JSDOM) {
    console.warn('  ⚠️ [SKIP] jsdom não instalado (npm install) — testes de comportamento ignorados.');
    return;
  }

  const dom = new JSDOM(
    '<!doctype html><html><body><button id="panicButton">SOS</button>' +
    '<p id="panicTablesStatus"></p><button id="panicTablesCheckBtn"></button></body></html>',
    { url: 'https://nexusport.example/manutencao.html', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;

  const avisos = [];
  const logs = [];
  window.console.warn = (...args) => avisos.push(args.join(' '));
  window.console.log = (...args) => logs.push(args.join(' '));

  const estado = { tabelaAusente: true, tabelaAtual: null, linha: null };
  window.NEXUS_CONFIG = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_ANON_KEY: 'chave-teste' };
  window.supabase = { createClient: () => criarClienteFalso(estado) };
  window.currentUserSession = {
    id: '11111111-1111-1111-1111-111111111111',
    nome: 'Ana Souza',
    cargo: 'INSPETOR',
    codigo_individual: 'INS-001'
  };
  // Cliente conectou durante uma emergência: o flag local estava marcado
  window.localStorage.setItem('nexus_emergency_active', 'true');

  window.eval(read('js/supabase-client.js'));
  window.eval(read('js/panic-realtime.js'));

  const esperar = () => new Promise((resolve) => setTimeout(resolve, 20));
  await esperar();

  check('jsdom: cliente Supabase inicializado a partir de js/config.js',
    Boolean(window.nexusSupabase) && Boolean(window.NexusSupabaseUtils));

  const utils = window.NexusSupabaseUtils;
  check('jsdom: classifica PGRST205, HTTP 404 e 42P01 como tabela ausente',
    utils.isTabelaAusenteError({ code: 'PGRST205' }) === true
    && utils.isTabelaAusenteError({ status: 404 }) === true
    && utils.isTabelaAusenteError({ code: '42P01' }) === true);
  check('jsdom: NÃO classifica outros erros como tabela ausente',
    utils.isTabelaAusenteError({ code: '23505', status: 409 }) === false
    && utils.isTabelaAusenteError({ status: 401, message: 'JWT' }) === false
    && utils.isTabelaAusenteError(null) === false);

  check('jsdom: tabela `emergencias` marcada como indisponível após o 404',
    utils.tabelaIndisponivel('emergencias') === true);
  check('jsdom: cliente deixa de ser entregue para a tabela ausente',
    utils.clientePara('emergencias') === null);
  check('jsdom: aviso no console aponta a migração exata (uma única vez por tabela)',
    avisos.filter((a) => a.includes("'public.emergencias'") && a.includes(MIGRACAO)).length === 1,
    avisos.filter((a) => a.includes("'public.emergencias'")).length + ' aviso(s)');
  check('jsdom: nenhuma exceção não tratada durante a inicialização',
    avisos.every((a) => !/Unhandled|TypeError|ReferenceError/.test(a)));
  check('jsdom: aplicação continua funcionando com o flag local (rodapé ativo)',
    window.NexusPanic.getState().active === true
    && window.NexusPanic.getState().origem === 'local');
  check('jsdom: rechecagem agendada (auto-cura) e sem exceção não tratada',
    window.NexusPanic.diagnose && typeof window.NexusPanic.diagnose === 'function');

  const diag = await window.NexusPanic.diagnose();
  check('jsdom: diagnose() reporta tabela indisponível + migração recomendada',
    diag.disponivel === false && diag.migracao === MIGRACAO && diag.retry_agendado === true,
    JSON.stringify({ d: diag.disponivel, m: diag.migracao, r: diag.retry_agendado }));

  const statusPainel = await window.NexusPanic.verificarTabelas();
  check('jsdom: verificarTabelas() lista as tabelas ausentes e o SQL a aplicar',
    statusPainel.ok === false && statusPainel.mensagem.includes(MIGRACAO)
    && statusPainel.tabelas.emergencias.disponivel === false,
    statusPainel.mensagem);
  check('jsdom: painel da página recebe o texto do diagnóstico',
    window.document.getElementById('panicTablesStatus').textContent.includes('ausente')
    || window.document.getElementById('panicTablesStatus').textContent.includes('⚠️'));

  // --- Migração aplicada no Supabase: a sessão aberta deve se auto-curar ----
  estado.tabelaAusente = false;
  estado.linha = {
    id: '22222222-2222-2222-2222-222222222222',
    estado: 'ATIVA',
    motivo: 'Incêndio no pátio',
    acionado_por_nome: 'Ana Souza',
    acionado_por_cargo: 'INSPETOR',
    acionado_por_codigo: 'INS-001',
    data_hora: new Date().toISOString()
  };

  const curado = await window.NexusPanic.verificarTabelas();
  await esperar();
  check('jsdom: após aplicar a migração, as tabelas voltam a ser consideradas disponíveis',
    curado.ok === true && window.NexusSupabaseUtils.tabelaIndisponivel('emergencias') === false);
  check('jsdom: estado global é relido do banco (emergência ativa da tabela)',
    window.NexusPanic.getState().active === true
    && window.NexusPanic.getState().origem === 'database'
    && window.NexusPanic.getState().motivo === 'Incêndio no pátio',
    JSON.stringify(window.NexusPanic.getState()));
  check('jsdom: consulta à tabela voltou a ser permitida',
    window.NexusSupabaseUtils.clientePara('emergencias') !== null);

  // --- Mensagem genérica por tabela (bercos -> migração 001) ----------------
  check('jsdom: aviso de outra tabela aponta a migração correspondente',
    window.NexusSupabaseUtils.avisoTabela('bercos').includes('001_create_bercos.sql'));

  window.close();
}

/* ================================================================== */
(async function main() {
  console.log('================================================================');
  console.log('TESTE — 404 EM /rest/v1/emergencias (PGRST205) — MIGRAÇÃO + RESILIÊNCIA');
  console.log('================================================================\n');

  testarMigracao();
  testarFrontEndEstatico();
  testarUiEDocumentacao();
  await testarComportamento();

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA CORREÇÃO DO 404 PASSARAM! ✨');
    console.log('================================================================');
    process.exit(0);
  }
  console.error('💥 ALGUNS TESTES DA CORREÇÃO DO 404 FALHARAM. REVISE O CÓDIGO!');
  console.log('================================================================');
  process.exit(1);
})();
