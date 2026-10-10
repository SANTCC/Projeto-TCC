#!/usr/bin/env node
/**
 * TESTE — Nº DE USUÁRIOS ON-LINE (Backlog 3, item E)
 * ------------------------------------------------------------
 * Cobre o indicador do cabeçalho em páginas reais (jsdom) e no módulo js/online-presence.js:
 *   1. Sem Supabase, sem código de sessão ou sem canal sincronizado: mostra "—" (nunca um número).
 *   2. Canal `nexus-online` com chave codigo_individual: um código conta uma única vez.
 *   3. Primeira leitura ao sincronizar; depois, atualização só a cada 30 s.
 *   4. Erro de canal volta a "—"; sair da página encerra o canal e o temporizador.
 *   5. Payload da presença só leva o instante de entrada (sem nome nem matrícula).
 *   6. Páginas reais: o indicador #headerOnlineCount aparece no cabeçalho e recebe a contagem.
 *   7. Configuração: toda página com layout carrega o módulo após supabase-client.js.
 *
 * Uso: node tests/test_presenca_online.js
 */
const fs = require('fs');
const path = require('path');
const {
  ROOT, read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina
} = require('./webmcp-harness');

const janelasAbertas = [];

/** Cliente falso do Supabase: só o necessário para a presença (canal, track, presenceState, removeChannel). */
function criarClienteFalso() {
  const canais = [];
  const removidos = [];
  return {
    canais,
    removidos,
    channel(nome, opcoes) {
      const canal = {
        nome,
        opcoes,
        handlers: {},
        subscribeCb: null,
        tracked: [],
        untrackedCount: 0,
        estado: {},
        on(tipo, filtro, fn) {
          this.handlers[`${tipo}:${filtro.event}`] = fn;
          return this;
        },
        subscribe(cb) {
          this.subscribeCb = cb;
          return this;
        },
        track(payload) {
          this.tracked.push(payload);
          return Promise.resolve('ok');
        },
        untrack() {
          this.untrackedCount += 1;
          return Promise.resolve('ok');
        },
        presenceState() {
          return this.estado;
        }
      };
      canais.push(canal);
      return canal;
    },
    removeChannel(canal) {
      removidos.push(canal);
      return Promise.resolve('ok');
    }
  };
}

const HTML_MINIMO = '<!doctype html><html><head></head><body>'
  + '<div id="headerOnline" data-estado="indisponivel"><span id="headerOnlineCount">—</span></div>'
  + '</body></html>';

function janelaComModulo() {
  const { w, dom } = criarJanela({ html: HTML_MINIMO, scripts: ['js/online-presence.js'] });
  janelasAbertas.push(dom.window);
  return w;
}

const textoContagem = (w) => w.document.getElementById('headerOnlineCount').textContent;

// ---------------------------------------------------------------------------
// 1 a 5. Módulo isolado
// ---------------------------------------------------------------------------
function testarModulo() {
  log('\n[1] Sem Supabase: indicador mostra "—", nunca um número');
  {
    const w = janelaComModulo();
    const iniciou = w.NexusOnlinePresence.iniciar({ codigo: 'NX-1', cliente: null });
    check('sem cliente: iniciar retorna false', iniciou === false);
    check('sem cliente: texto é "—"', textoContagem(w) === '—', textoContagem(w));
    check('sem cliente: nenhum dígito no indicador', !/\d/.test(textoContagem(w)));
    check('sem cliente: estado data-estado = indisponivel',
      w.document.getElementById('headerOnline').getAttribute('data-estado') === 'indisponivel');
  }
  {
    const w = janelaComModulo();
    const cliente = criarClienteFalso();
    const iniciou = w.NexusOnlinePresence.iniciar({ codigo: '   ', cliente });
    check('código vazio: não cria canal', iniciou === false && cliente.canais.length === 0);
    check('código vazio: texto é "—"', textoContagem(w) === '—');
  }

  log('\n[2] Canal nexus-online com chave codigo_individual');
  const w = janelaComModulo();
  const cliente = criarClienteFalso();
  const agendados = [];
  const cancelados = [];
  const iniciou = w.NexusOnlinePresence.iniciar({
    codigo: 'NX-1',
    cliente,
    agendar: (fn, ms) => { agendados.push({ fn, ms, id: agendados.length + 1 }); return agendados.length; },
    cancelar: (id) => { cancelados.push(id); }
  });
  const canal = cliente.canais[0];
  check('iniciar retorna true com cliente e código', iniciou === true);
  check('canal criado com o nome nexus-online', canal && canal.nome === 'nexus-online', canal && canal.nome);
  check('chave de presença é o codigo_individual',
    canal && canal.opcoes && canal.opcoes.config.presence.key === 'NX-1');
  check('antes da primeira sincronização: "—"', textoContagem(w) === '—', textoContagem(w));

  log('\n[3] Primeira leitura ao sincronizar; depois só a cada 30 s');
  check('temporizador agendado a cada 30 s', agendados.length === 1 && agendados[0].ms === 30000,
    JSON.stringify(agendados.map((a) => a.ms)));
  canal.subscribeCb('SUBSCRIBED');
  check('ao entrar no canal: track com instante de entrada', canal.tracked.length === 1);
  canal.estado = { 'NX-1': [{}], 'NX-2': [{}, {}], 'NX-3': [] };
  canal.handlers['presence:sync']();
  check('um código com duas abas conta uma vez e chave vazia não conta: 2 usuários',
    textoContagem(w) === '2', textoContagem(w));
  canal.estado = { 'NX-1': [{}], 'NX-2': [{}, {}], 'NX-3': [{}], 'NX-4': [{}] };
  canal.handlers['presence:sync']();
  check('sincronização nova não altera o número antes do intervalo de 30 s',
    textoContagem(w) === '2', textoContagem(w));
  agendados[0].fn();
  check('no intervalo de 30 s o número é atualizado: 4 usuários', textoContagem(w) === '4', textoContagem(w));

  log('\n[4] Erro de canal volta a "—"; sair da página encerra canal e temporizador');
  canal.subscribeCb('CHANNEL_ERROR');
  check('CHANNEL_ERROR: volta para "—"', textoContagem(w) === '—', textoContagem(w));
  canal.subscribeCb('SUBSCRIBED');
  check('nova sincronização após reconexão: track de novo', canal.tracked.length === 2);
  w.NexusOnlinePresence.parar();
  check('parar: cancela o temporizador', cancelados.length === 1 && cancelados[0] === 1);
  check('parar: remove o canal do cliente', cliente.removidos.length === 1 && cliente.removidos[0] === canal);
  check('parar: desfaz a presença (untrack)', canal.untrackedCount === 1);

  log('\n[5] Payload sem dados pessoais');
  const payloadsOk = canal.tracked.every((p) => Object.keys(p).every((k) => k === 'online_at'));
  check('track envia só online_at (sem nome nem matrícula)', payloadsOk,
    JSON.stringify(canal.tracked));
  check('online_at é uma data ISO válida', !Number.isNaN(Date.parse(canal.tracked[0].online_at)));

  const ctr = w.NexusOnlinePresence;
  check('contarUsuarios: chaves distintas com metas (2)', ctr.contarUsuarios({ a: [{}], b: [], c: [{}, {}] }) === 2);
  check('contarUsuarios: estado ausente vale 0', ctr.contarUsuarios(null) === 0);
  check('intervalo exportado é 30 s', ctr.INTERVALO_MS === 30000);
}

// ---------------------------------------------------------------------------
// 6. Página real com o layout
// ---------------------------------------------------------------------------
async function testarPaginaReal() {
  log('\n[6] Páginas reais: indicador no cabeçalho recebe a contagem');
  const cliente = criarClienteFalso();
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-SES-1', nome: 'Sessão de teste' }),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/layout.js',
      'js/supabase-client.js', (win) => { win.nexusSupabase = cliente; },
      'js/online-presence.js'
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);
  const pronto = await esperar(() => cliente.canais.length > 0, 3000);
  check('dashboard: layout cria o canal de presença ao carregar', pronto);
  check('dashboard: cabeçalho tem a pílula #headerOnline', !!w.document.getElementById('headerOnline'));
  check('dashboard: chave de presença é o código da sessão',
    pronto && cliente.canais[0].opcoes.config.presence.key === 'NX-SES-1');
  const canal = cliente.canais[0];
  canal.subscribeCb('SUBSCRIBED');
  canal.estado = { 'NX-SES-1': [{}], 'NX-OUTRO-2': [{}] };
  canal.handlers['presence:sync']();
  check('dashboard: mostra 2 usuários on-line', textoContagem(w) === '2', textoContagem(w));
  w.NexusOnlinePresence.parar();

  const semSupabase = criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    html: htmlDaPagina('relatorios.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-SES-2' }),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/layout.js',
      'js/supabase-client.js', (win) => { win.nexusSupabase = null; },
      'js/online-presence.js'
    ]
  });
  janelasAbertas.push(semSupabase.dom.window);
  await prontoDom(semSupabase.w);
  await aguardar(150);
  check('relatórios sem Supabase: indicador mostra "—"', textoContagem(semSupabase.w) === '—',
    textoContagem(semSupabase.w));
}

// ---------------------------------------------------------------------------
// 7. Configuração estática
// ---------------------------------------------------------------------------
function testarConfiguracao() {
  log('\n[7] Configuração: módulo carregado após supabase-client.js em toda página com layout');
  const paginas = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  // Só conta como página com layout quem realmente carrega o script (about.html apenas cita o
  // caminho na documentação e não tem a interface do app).
  const comLayout = paginas.filter((f) => /<script[^>]+src="js\/layout\.js"/.test(read(f)));
  check('há páginas com layout para verificar', comLayout.length >= 9, `${comLayout.length}`);
  comLayout.forEach((arquivo) => {
    const html = read(arquivo);
    const posCliente = html.indexOf('js/supabase-client.js');
    const posPresenca = html.indexOf('js/online-presence.js');
    check(`${arquivo}: online-presence.js após supabase-client.js`,
      posPresenca > posCliente && posCliente !== -1, `cliente=${posCliente} presenca=${posPresenca}`);
  });

  const layout = read('js/layout.js');
  check('layout.js cria o indicador #headerOnlineCount', layout.includes('id="headerOnlineCount"'));
  check('layout.js: texto inicial do indicador é "—" (sem número antes da presença)',
    /id="headerOnlineCount"[^>]*>—</.test(layout));
  check('layout.js inicia a presença com o código da sessão',
    /NexusOnlinePresence\.iniciar\(\{\s*codigo:\s*session\.codigo_individual\s*\}\)/.test(layout));

  const modulo = read('js/online-presence.js');
  check('módulo não envia nome ou matrícula no track',
    !/track\(\{[^}]*(nome|matricula)/i.test(modulo));
  check('módulo não usa número fixo de fallback (sem "Math.random")', !/Math\.random/.test(modulo));
  check('índice de presença usa o canal nexus-online', modulo.includes("const CANAL = 'nexus-online'"));
}

function esperar(condicao, limite) {
  const inicio = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (condicao()) return resolve(true);
      if (Date.now() - inicio > limite) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
(async function main() {
  log('\n=== Nº de usuários on-line (Backlog 3 — E) ===');
  try {
    testarModulo();
    await testarPaginaReal();
    testarConfiguracao();
  } finally {
    janelasAbertas.forEach((janela) => { try { janela.close(); } catch (e) { /* já fechada */ } });
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch((erro) => {
  console.error('❌ Erro inesperado no teste:', erro);
  process.exit(1);
});
