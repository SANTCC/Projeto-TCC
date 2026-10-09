/**
 * Teste de Verificação — 22P02 na auditoria do botão de pânico
 *
 * Regressão do erro capturado nos logs do Supabase (Logs Explorer >
 * service_name "postgres_logs", sql_state_code "22P02"):
 *
 *   WITH pgrst_source AS (INSERT INTO "public"."logs_alteracoes"
 *     ("cargo", ..., "entidade_tipo", ...) ...
 *   -> ERROR  invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
 *
 * Cobre as três pernas da correção:
 *   1. MIGRAÇÃO  supabase/migrations/20261008010000_enum_emergencia_auditoria.sql
 *      (idempotente, segura no SQL Editor — não USA o valor novo do enum na
 *      mesma transação, que é o que dispara o erro 55P04);
 *   2. RESILIÊNCIA do front-end: o insert da auditoria não descarta mais o
 *      `error` do PostgREST/cliente; o 22P02 é classificado, avisado uma única
 *      vez e o operador recebe o nome do arquivo .sql que corrige;
 *   3. DIAGNÓSTICO na UI: o botão "Verificar" do painel de manutenção passa a
 *      sondar também o VALOR do enum (select com limit(0), sem escrever nada).
 *
 * Executar: node tests/test_enum_emergencia.js   (ou: npm run test:enum)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const MIGRACAO = 'supabase/migrations/20261008010000_enum_emergencia_auditoria.sql';
const MIGRACAO_404 = 'supabase/migrations/20261008000000_emergencias_fix_404.sql';
const MENSAGEM_22P02 = 'invalid input value for enum tipo_entidade_enum: "EMERGENCIA"';

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

/** Remove comentários SQL (-- e barra-asterisco) para inspecionar só o código. */
function semComentarios(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
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
  console.log('1. Validando a migração do enum EMERGENCIA...');
  const mig = read(MIGRACAO);
  const codigo = semComentarios(mig);

  check('Migração existe e explica o sintoma (22P02 + a mensagem exata do log)',
    mig.length > 1000 && mig.includes('22P02') && mig.includes(MENSAGEM_22P02));

  check('Adiciona o valor de forma idempotente (add value if not exists)',
    /alter type\s+public\.tipo_entidade_enum\s+add value if not exists\s+'EMERGENCIA'/i.test(codigo));

  check('NÃO usa o valor do enum no mesmo script (evita 55P04 no SQL Editor)',
    !/entidade_tipo\s*=\s*'EMERGENCIA'/i.test(codigo)
    && !/'EMERGENCIA'\s*::\s*(public\.)?tipo_entidade_enum/i.test(codigo)
    && !/::\s*(public\.)?tipo_entidade_enum/i.test(codigo));

  check('NÃO está envolvida em begin/commit explícito (o SQL Editor já manda 1 transação)',
    !/^\s*(begin|commit)\s*;/im.test(codigo));

  check('Confere o resultado apenas pelo catálogo (pg_enum), sem converter o valor',
    codigo.includes('pg_enum') && codigo.includes('enumlabel'));

  check('Valida também a coluna logs_alteracoes.entidade_tipo',
    codigo.includes('logs_alteracoes') && codigo.includes('format_type'));

  check('Recarrega o schema cache do PostgREST no fim (notify pgrst)',
    /notify\s+pgrst\s*,\s*'reload schema'/i.test(codigo));

  check('Documenta a armadilha 55P04 (e por isso o teste do valor é um passo à parte)',
    mig.includes('55P04') && mig.includes('unsafe use of new value'));

  check('A migração do 404 também garante o valor (defesa em profundidade)',
    read(MIGRACAO_404).includes("add value if not exists 'EMERGENCIA'"));

  check('A migração nova está listada em SPECs/migrations/README.md',
    read('SPECs/migrations/README.md').includes('20261008010000_enum_emergencia_auditoria.sql'));

  check('Há diagnóstico dedicado em SPECs/diagnostico (22P02)',
    fs.existsSync(path.join(ROOT, 'SPECs/diagnostico/22P02-enum-emergencia.md'))
    && read('SPECs/diagnostico/22P02-enum-emergencia.md').includes('22P02'));
}

/* ================================================================== *
 * 2. Front-end (estático)
 * ================================================================== */
function testarFrontEndEstatico() {
  console.log('\n2. Validando a resiliência do front-end...');
  const cliente = read('js/supabase-client.js');
  const panic = read('js/panic-realtime.js');
  const dashboard = read('js/pages/dashboard.js');
  const manutencao = read('js/pages/manutencao.js');

  check('supabase-client.js sabe classificar o erro de enum (isEnumDesconhecidoError)',
    cliente.includes('isEnumDesconhecidoError: function')
    && cliente.includes('invalid input value for enum')
    && cliente.includes('enumDesconhecido: function'));

  check('supabase-client.js avisa uma única vez e aponta a migração nova',
    cliente.includes('registrarEnumDesconhecido: function')
    && cliente.includes('supabase/migrations/20261008010000_enum_emergencia_auditoria.sql'));

  check('supabase-client.js expõe a sonda read-only do valor (verificarEnumAuditoria)',
    cliente.includes('verificarEnumAuditoria: function') && cliente.includes('limit(0)'));

  check('panic-realtime.js LÊ o erro do insert da auditoria (não descarta mais o resultado)',
    panic.includes('const { error } = await sb.from(\'logs_alteracoes\').insert(payload)')
    && panic.includes('if (error) return tratarErroAuditoria(error);'));

  check('panic-realtime.js informa o operador quando a auditoria não grava',
    panic.includes('Auditoria NÃO gravada') && panic.includes('auditoriaNote'));

  check('panic-realtime.js verifica o valor do enum no diagnóstico (verificarTabelas/diagnose)',
    panic.includes('verificarEnumAuditoria') && panic.includes('auditoria_enum'));

  check('dashboard.js registra auditoria de emergência com entidade_tipo EMERGENCIA',
    /entUpper\.includes\('EMERGENCIA'\)\)\s*entidadeTipo = 'EMERGENCIA'/i.test(dashboard));

  check('dashboard.js trata o erro de insert (antes era descartado)',
    dashboard.includes('registrarEnumDesconhecido(error)'));

  check('manutencao.js chama registrarLogAlteracao na ordem correta (entidade, tipo)',
    manutencao.includes("registrarLogAlteracao('emergencia', 'EDICAO'")
    && !manutencao.includes("registrarLogAlteracao('EDICAO', 'emergencia'"));
}

/* ================================================================== *
 * 3. Comportamento no navegador (jsdom + cliente falso)
 * ================================================================== */
const ERRO_ENUM = {
  code: '22P02',
  message: MENSAGEM_22P02,
  details: 'Failing row contains (..., EMERGENCIA, ...).',
  status: 400
};
const ERRO_TABELA = {
  code: 'PGRST205',
  status: 404,
  message: "Could not find the table 'public.logs_alteracoes' in the schema cache"
};

function criarClienteFalso(estado) {
  function builder(tabela) {
    const ctx = { op: null, coluna: null };
    const b = {
      select(colunas, opcoes) { ctx.op = opcoes && opcoes.head ? 'head' : 'select'; ctx.colunas = colunas; return b; },
      eq(coluna, valor) { ctx.op = 'eq'; ctx.coluna = coluna; ctx.valor = valor; return b; },
      order() { return b; },
      limit() { return b; },
      insert(payload) { ctx.op = 'insert'; ctx.payload = payload; return b; },
      update() { return b; },
      maybeSingle() { return Promise.resolve(resultado()); },
      then(resolve, reject) { return Promise.resolve(resultado()).then(resolve, reject); },
      catch(reject) { return Promise.resolve(resultado()).catch(reject); }
    };

    function resultado() {
      if (tabela === 'logs_alteracoes') {
        if (ctx.op === 'insert') {
          estado.insercoes.push(ctx.payload);
          return { data: null, error: estado.enumAusente ? ERRO_ENUM : null, status: estado.enumAusente ? 400 : 201 };
        }
        if (ctx.coluna === 'entidade_tipo') {
          // Sonda do valor do enum: select ... eq(coluna, valor).limit(0)
          estado.sondagens += 1;
          return { data: [], error: estado.enumAusente ? ERRO_ENUM : null, status: estado.enumAusente ? 400 : 200 };
        }
        return { data: [], error: null, status: 200 };
      }
      if (ctx.op === 'head') {
        return { data: null, error: estado.tabelasAusentes ? ERRO_TABELA : null, status: estado.tabelasAusentes ? 404 : 200 };
      }
      return { data: null, error: null, status: 200 };
    }

    return b;
  }

  return {
    from(tabela) { estado.tabelasConsultadas.push(tabela); return builder(tabela); },
    channel() {
      const ch = {
        on() { return ch; },
        subscribe(cb) { if (cb) cb('SUBSCRIBED'); return ch; },
        send() { return Promise.resolve('ok'); },
        unsubscribe() { return Promise.resolve('ok'); }
      };
      return ch;
    },
    functions: {
      invoke: () => Promise.resolve({ data: { ok: true, emergencia: { id: '33333333-3333-3333-3333-333333333333' } }, error: null })
    }
  };
}

async function testarComportamento() {
  console.log('\n3. Simulando o navegador (jsdom): pânico, 22P02 e diagnóstico');
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
  window.console.warn = (...args) => avisos.push(args.join(' '));
  window.console.log = () => {};
  window.console.error = (...args) => avisos.push(args.join(' '));

  const feedbacks = [];
  window.mostrarFeedback = (tipo, titulo, mensagem) => feedbacks.push({ tipo, titulo, mensagem });

  const estado = {
    enumAusente: true,
    tabelasAusentes: false,
    insercoes: [],
    sondagens: 0,
    tabelasConsultadas: []
  };

  window.NEXUS_CONFIG = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_ANON_KEY: 'chave-teste' };
  window.supabase = { createClient: () => criarClienteFalso(estado) };
  window.currentUserSession = {
    id: '11111111-1111-1111-1111-111111111111',
    nome: 'Ana Souza',
    cargo: 'INSPETOR',
    codigo_individual: 'INS-001'
  };
  window.NexusAuth = {
    getSession: () => window.currentUserSession,
    hasPermission: () => true
  };

  window.eval(read('js/supabase-client.js'));
  window.eval(read('js/panic-realtime.js'));

  const esperar = () => new Promise((resolve) => setTimeout(resolve, 30));
  await esperar();

  const utils = window.NexusSupabaseUtils;
  check('jsdom: cliente e utilitários carregados', Boolean(window.nexusSupabase) && Boolean(utils));

  // --- classificação do erro -------------------------------------------------
  const erroDoLog = {
    service_name: 'postgres_logs',
    sql_state_code: '22P02',
    event_message: MENSAGEM_22P02
  };
  check('jsdom: reconhece o 22P02 do log do Supabase (event_message/sql_state_code)',
    utils.isEnumDesconhecidoError(erroDoLog) === true
    && utils.isEnumDesconhecidoError(ERRO_ENUM) === true);
  check('jsdom: NÃO confunde outros erros com valor de enum ausente',
    utils.isEnumDesconhecidoError({ code: 'PGRST205' }) === false
    && utils.isEnumDesconhecidoError({ code: '23505', message: 'duplicate key' }) === false
    && utils.isEnumDesconhecidoError(null) === false);
  const detalhe = utils.enumDesconhecido(ERRO_ENUM);
  check('jsdom: extrai tipo, valor e a migração que cria o valor',
    detalhe.tipo === 'tipo_entidade_enum'
    && detalhe.valor === 'EMERGENCIA'
    && detalhe.migracao === MIGRACAO,
    JSON.stringify(detalhe));
  check('jsdom: o aviso textual aponta o arquivo .sql exato',
    utils.avisoEnum(ERRO_ENUM).includes(MIGRACAO)
    && utils.avisoEnum(ERRO_ENUM).includes('EMERGENCIA'));

  // --- sonda do painel (read-only) ------------------------------------------
  const antesDasSondagens = estado.insercoes.length;
  const painel = await window.NexusPanic.verificarTabelas();
  check('jsdom: "Verificar" detecta o valor EMERGENCIA ausente no enum',
    painel.ok === false && painel.auditoria && painel.auditoria.disponivel === false,
    JSON.stringify(painel.auditoria));
  check('jsdom: a mensagem do painel aponta a migração do enum',
    painel.mensagem.includes(MIGRACAO), painel.mensagem);
  check('jsdom: a sonda é read-only (nenhum insert disparado pela verificação)',
    estado.insercoes.length === antesDasSondagens && estado.sondagens > 0,
    `insercoes=${estado.insercoes.length} sondagens=${estado.sondagens}`);
  check('jsdom: o painel da página recebe o texto do diagnóstico',
    window.document.getElementById('panicTablesStatus').textContent.includes(MIGRACAO));

  const diag = await window.NexusPanic.diagnose();
  check('jsdom: diagnose() separa tabela (ok) de auditoria (pendente)',
    diag.disponivel === true && diag.auditoria_enum.disponivel === false
    && diag.auditoria_enum.migracao === MIGRACAO,
    JSON.stringify(diag.auditoria_enum));

  // --- o pânico continua funcionando, mas a auditoria é reportada ------------
  const resultado = await window.NexusPanic.triggerPanic({ confirmar: false, motivo: 'Teste automatizado' });
  await esperar();
  check('jsdom: o alarme dispara normalmente mesmo com o enum pendente',
    resultado.ok === true && window.NexusPanic.getState().active === true
    && window.NexusPanic.getState().origem === 'edge_function',
    JSON.stringify(window.NexusPanic.getState()));
  check('jsdom: o resultado expõe a falha de auditoria classificada',
    resultado.auditoria && resultado.auditoria.ok === false
    && resultado.auditoria.motivo === 'enum_desconhecido'
    && resultado.auditoria.migracao === MIGRACAO,
    JSON.stringify(resultado.auditoria));
  check('jsdom: houve tentativa real de gravar a auditoria em logs_alteracoes',
    estado.insercoes.length === 1 && estado.insercoes[0].entidade_tipo === 'EMERGENCIA',
    JSON.stringify(estado.insercoes));
  const avisoOperador = feedbacks.filter((f) => /Auditoria NÃO gravada/.test(f.mensagem));
  check('jsdom: o operador é avisado com o arquivo .sql que corrige',
    avisoOperador.length === 1 && avisoOperador[0].mensagem.includes(MIGRACAO),
    JSON.stringify(avisos[avisos.length - 1] || ''));
  const avisosEnum = avisos.filter((a) => a.includes('não existe no enum') && a.includes(MIGRACAO));
  check('jsdom: o aviso no console aparece uma única vez (sem enxurrada)',
    avisosEnum.length === 1, `${avisosEnum.length} aviso(s)`);

  // --- migração aplicada no banco: tudo volta a funcionar -------------------
  estado.enumAusente = false;
  await window.NexusPanic.clearPanic({ confirmar: false });
  await esperar();

  const painelCurado = await window.NexusPanic.verificarTabelas();
  check('jsdom: após aplicar a migração, a auditoria volta a ser considerada disponível',
    painelCurado.ok === true && painelCurado.auditoria.disponivel === true
    && utils.enumIndisponivel('tipo_entidade_enum', 'EMERGENCIA') === false,
    JSON.stringify(painelCurado.auditoria));

  const resultado2 = await window.NexusPanic.triggerPanic({ confirmar: false });
  await esperar();
  check('jsdom: a auditoria grava e o resultado reporta sucesso',
    resultado2.ok === true && resultado2.auditoria.ok === true
    && estado.insercoes.filter((l) => l.entidade_tipo === 'EMERGENCIA').length >= 2,
    JSON.stringify(resultado2.auditoria));

  window.close();
}

/* ================================================================== */
(async function main() {
  console.log('================================================================');
  console.log('TESTE — 22P02 NO ENUM tipo_entidade_enum (AUDITORIA DO PÂNICO)');
  console.log('================================================================\n');

  testarMigracao();
  testarFrontEndEstatico();
  await testarComportamento();

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA CORREÇÃO DO 22P02 PASSARAM! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES FALHARAM. REVISE A CORREÇÃO!');
    console.log('================================================================');
    process.exit(1);
  }
})();
