/**
 * Teste de Verificação — Alerta no Aparelho (js/haptics.js)
 *
 * Cobre a regressão relatada em campo: "o botão SOS não faz o celular vibrar".
 * Executa o módulo em DOM real (jsdom) simulando Android/Chrome, iPhone
 * (iOS 18 e iOS 26.5) e navegadores sem suporte algum, verificando:
 *   - vibração realmente disparada quando há Vibration API + interação;
 *   - motivo (reason) informado em cada cenário de bloqueio, sem exceções;
 *   - `prefers-reduced-motion` NÃO desliga mais o alerta tátil;
 *   - pulsos de emergência, parada e preferências persistidas;
 *   - haptics do iOS (overlay de toque no botão SOS) sem acionar duas vezes.
 *
 * Executar: node tests/test_haptics.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const HAPTICS_SRC = read('js/haptics.js');
const PANIC_SRC = read('js/panic-realtime.js');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_265_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const FIREFOX_UA = 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0';

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM; // devDependency do projeto
} catch (e) {
  JSDOM = null;
}

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
 * Monta um DOM isolado com o módulo carregado, simulando um aparelho.
 * @param {Object} options { userAgent, secure, vibrate, hidden, reducedMotion }
 */
function mount(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="panicButton" type="button">SOS</button></body></html>', {
    url: 'https://nexusport.example/dashboard.html',
    runScripts: 'outside-only', // permite window.eval do módulo analisado
    pretendToBeVisual: true,
    userAgent: options.userAgent || ANDROID_UA
  });
  const { window } = dom;
  const vibrateCalls = [];

  // O jsdom 30 ignora a opção `userAgent` do construtor — fixamos manualmente.
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    get: () => options.userAgent || ANDROID_UA
  });
  window.isSecureContext = options.secure !== false;
  if (options.vibrate) {
    window.navigator.vibrate = function (pattern) {
      vibrateCalls.push(pattern);
      return options.vibrateReturn === undefined ? true : options.vibrateReturn;
    };
  }
  // Sem opção `vibrate`, o jsdom não implementa a Vibration API — equivale ao
  // Safari do iPhone / Firefox 129+ / http:// (contexto inseguro).

  Object.defineProperty(window.document, 'hidden', {
    configurable: true,
    get: () => Boolean(options.hidden)
  });

  window.matchMedia = function (query) {
    return {
      matches: Boolean(options.reducedMotion) && /prefers-reduced-motion/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    };
  };

  window.eval(HAPTICS_SRC);
  return { dom, window, vibrateCalls };
}

/** Simula a interação do usuário (sticky user activation). */
function activate(window) {
  window.document.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  window.NexusHaptics.unlock();
}

/** Aguarda o próximo tick (a rede de segurança do overlay usa setTimeout 0). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

async function testHaptics() {
  console.log('================================================================');
  console.log('TESTE — ALERTA NO APARELHO (VIBRAÇÃO / SOM) DO BOTÃO DE PÂNICO');
  console.log('================================================================\n');

  console.log('1. Validando API pública do módulo...');
  check('js/haptics.js existe', HAPTICS_SRC.length > 1000);
  check('Padrões de emergência definidos (sos/alert/tap)',
    /sos:/.test(HAPTICS_SRC) && /alert:/.test(HAPTICS_SRC) && /tap:/.test(HAPTICS_SRC));
  check('Padrões respeitam o limite de 10 posições da especificação',
    /sos: \[[^\]]*\]/.exec(HAPTICS_SRC) && /sos: \[([^\]]*)\]/.exec(HAPTICS_SRC)[1].split(',').length <= 10);
  check('Documenta explicitamente a ausência de vibração no iOS', /iOS\/iPadOS/.test(HAPTICS_SRC));

  if (!JSDOM) {
    console.log('  ⏭️  [SKIP] jsdom não instalado (execute `npm install`) — testes de DOM ignorados.');
    console.log('\n================================================================');
    console.log(passed ? '✨ TESTES ESTÁTICOS DO ALERTA NO APARELHO PASSARAM! ✨' : '💥 FALHAS ENCONTRADAS!');
    console.log('================================================================');
    process.exit(passed ? 0 : 1);
  }

  const m1 = mount({ vibrate: true });
  const api = ['status', 'describe', 'hint', 'hasBackend', 'vibrate', 'alert', 'sos', 'stop',
    'test', 'unlock', 'isEnabled', 'setEnabled', 'isSoundEnabled', 'setSoundEnabled',
    'attachTapHaptic', 'bindUI'];
  const missing = api.filter((fn) => !m1.window.NexusHaptics || typeof m1.window.NexusHaptics[fn] !== 'function');
  check('Expõe window.NexusHaptics com a API completa', Boolean(m1.window.NexusHaptics) && missing.length === 0, missing.join(', '));

  // ------------------------------------------------------------------
  console.log('\n2. Validando vibração em Android/Chrome (Vibration API)...');
  const hapt1 = m1.window.NexusHaptics;
  check('Backend detectado: vibration_api', hapt1.status().backend === 'vibration_api', hapt1.status().backend);
  check('Antes da interação o motivo é "no_activation" (comportamento correto)',
    hapt1.status().reasons.indexOf('no_activation') !== -1, JSON.stringify(hapt1.status().reasons));
  activate(m1.window);
  check('Após a interação não há mais motivos de bloqueio',
    hapt1.status().reasons.length === 0, JSON.stringify(hapt1.status().reasons));
  const res1 = hapt1.alert();
  check('alert() vibra após interação do usuário', res1.fired === true, String(res1.reason));
  check('Vibration API recebeu o padrão de 3 pulsos',
    JSON.stringify(m1.vibrateCalls[0]) === JSON.stringify(hapt1.PATTERNS.alert), JSON.stringify(m1.vibrateCalls));
  check('status().canHaptic === true (interação + aba visível)', hapt1.status().canHaptic === true);
  hapt1.stop();
  check('stop() envia navigator.vibrate(0)', m1.vibrateCalls[m1.vibrateCalls.length - 1] === 0);

  // ------------------------------------------------------------------
  console.log('\n3. Validando bloqueio por falta de interação (sticky activation)...');
  const m3 = mount({ vibrate: true });
  const hapt3 = m3.window.NexusHaptics;
  check('Motivo "no_activation" reportado antes de qualquer toque',
    hapt3.status().reasons.indexOf('no_activation') !== -1, JSON.stringify(hapt3.status().reasons));
  const res3 = hapt3.alert();
  check('Nenhuma chamada é feita sem interação (evita intervention do Chrome)',
    res3.fired === false && m3.vibrateCalls.length === 0, JSON.stringify(m3.vibrateCalls));
  check('hint() explica a exigência de toque', /[Tt]oque/.test(hapt3.hint('no_activation')));
  check('hint() compacto existe para o rodapé', hapt3.hint('no_activation', true).length < 70);

  // ------------------------------------------------------------------
  console.log('\n4. Validando que prefers-reduced-motion NÃO silencia o alerta...');
  const m4 = mount({ vibrate: true, reducedMotion: true });
  activate(m4.window);
  check('Alerta tátil continua funcionando com prefers-reduced-motion', m4.window.NexusHaptics.alert().fired === true);
  check('O motivo "reduced_motion" não existe mais no status', m4.window.NexusHaptics.status().reasons.indexOf('reduced_motion') === -1);
  check('CSS do rodapé continua respeitando a preferência de MOVIMENTO',
    PANIC_SRC.includes('prefers-reduced-motion: reduce'));

  // ------------------------------------------------------------------
  console.log('\n5. Validando página em segundo plano...');
  const m5 = mount({ vibrate: true, hidden: true });
  activate(m5.window);
  const res5 = m5.window.NexusHaptics.alert();
  check('Sem vibração com a aba oculta', res5.fired === false && res5.reason === 'hidden', String(res5.reason));
  check('Motivo "hidden" listado no status', m5.window.NexusHaptics.status().reasons.indexOf('hidden') !== -1);

  // ------------------------------------------------------------------
  console.log('\n6. Validando iPhone (iOS 18 — haptics pelo switch nativo)...');
  const m6 = mount({ userAgent: IPHONE_UA });
  const hapt6 = m6.window.NexusHaptics;
  check('Detecta iOS pelo User-Agent', hapt6.isIOS() === true && hapt6.status().platform === 'ios');
  check('Backend identificado como ios_switch', hapt6.status().backend === 'ios_switch', hapt6.status().backend);
  check('Não reporta "unsupported" no iPhone 18', hapt6.status().reasons.indexOf('unsupported') === -1, JSON.stringify(hapt6.status().reasons));
  activate(m6.window);
  check('Haptics do iOS acionados por script (iOS < 26.5)', hapt6.alert().fired === true);
  check('Switch nativo (<input switch>) criado no DOM', Boolean(m6.window.document.querySelector('input[switch]')));

  // ------------------------------------------------------------------
  console.log('\n7. Validando iPhone (iOS 26.5 — overlay de toque no botão SOS)...');
  const m7 = mount({ userAgent: IPHONE_265_UA });
  const hapt7 = m7.window.NexusHaptics;
  check('Motivo "ios_programmatic_blocked" reportado',
    hapt7.status().reasons.indexOf('ios_programmatic_blocked') !== -1, JSON.stringify(hapt7.status().reasons));
  check('hint(curto) explica a limitação do iOS 26.5+', /26\.5/.test(hapt7.hint('ios_programmatic_blocked', true)));
  const btn = m7.window.document.getElementById('panicButton');
  let cliques = 0;
  btn.addEventListener('click', () => { cliques += 1; });
  check('Overlay de toque aplicado ao botão SOS', hapt7.attachTapHaptic(btn) === true);
  check('Overlay usa <label data-haptic-trigger> + input switch',
    Boolean(btn.querySelector('label[data-haptic-trigger] input[switch]')));
  check('Não duplica o overlay em chamadas repetidas', hapt7.attachTapHaptic(btn) === false);
  btn.querySelector('label[data-haptic-trigger]').dispatchEvent(new m7.window.MouseEvent('click', { bubbles: true }));
  check('Toque no overlay aciona o botão SOS uma única vez (bubbling)', cliques === 1, `cliques=${cliques}`);
  await tick();
  check('Rede de segurança não duplica o acionamento', cliques === 1, `cliques=${cliques}`);

  // ------------------------------------------------------------------
  console.log('\n8. Validando navegador sem vibração (Firefox 129+) e http://...');
  const m8 = mount({ userAgent: FIREFOX_UA });
  const hapt8 = m8.window.NexusHaptics;
  check('Motivo "unsupported" reportado', hapt8.status().reasons.indexOf('unsupported') !== -1, JSON.stringify(hapt8.status().reasons));
  check('hasBackend() === false', hapt8.hasBackend() === false);
  check('Alerta sonoro entra como padrão nesse cenário (iOS/Firefox/desktop)',
    hapt8.isSoundEnabled() === true);
  check('describe() explica o cenário em português', /Vibração: INDISPONÍVEL/.test(hapt8.describe()));
  check('hint() orienta a ativar o alerta sonoro', /sonoro/i.test(hapt8.hint('unsupported')));
  check('test()/alert()/stop() não lançam exceção sem suporte',
    (() => { try { hapt8.test(); hapt8.alert(); hapt8.stop(); return true; } catch (e) { return false; } })());

  const m9 = mount({ vibrate: true, secure: false });
  check('Contexto inseguro (http://) é reportado quando a API não existe',
    m9.window.NexusHaptics.status().reasons.length > 0);

  // ------------------------------------------------------------------
  console.log('\n9. Validando preferências e persistência...');
  const m10 = mount({ vibrate: true });
  const hapt10 = m10.window.NexusHaptics;
  activate(m10.window);
  hapt10.setEnabled(false);
  const res10 = hapt10.alert();
  check('Vibração desativada não dispara nada', res10.fired === false && res10.reason === 'disabled', String(res10.reason));
  check('Motivo "disabled" no status', hapt10.status().reasons.indexOf('disabled') !== -1);
  check('Preferência persistida no localStorage',
    /"enabled":false/.test(m10.window.localStorage.getItem('nexus_haptics_prefs') || ''));
  hapt10.setEnabled(true);
  check('Reativação volta a vibrar', hapt10.alert().fired === true);
  check('setSoundEnabled(true) persiste a escolha',
    hapt10.setSoundEnabled(true) === true
      && /"sound":true/.test(m10.window.localStorage.getItem('nexus_haptics_prefs') || ''));

  // ------------------------------------------------------------------
  console.log('\n10. Validando o painel de diagnóstico ("Alerta no Aparelho")...');
  const panel = read('manutencao.html');
  check('manutencao.html traz o painel de alerta no aparelho',
    ['hapticsPanel', 'hapticsStatus', 'hapticsEnabledToggle', 'hapticsSoundToggle', 'hapticsTestBtn', 'hapticsRefreshBtn']
      .every((id) => panel.includes(`id="${id}"`)));
  const m11 = mount({ vibrate: true });
  const statusEl = m11.window.document.createElement('p');
  const toggleEl = m11.window.document.createElement('input');
  const testBtnEl = m11.window.document.createElement('button');
  statusEl.id = 'hapticsStatus';
  toggleEl.id = 'hapticsEnabledToggle';
  testBtnEl.id = 'hapticsTestBtn';
  m11.window.document.body.appendChild(statusEl);
  m11.window.document.body.appendChild(toggleEl);
  m11.window.document.body.appendChild(testBtnEl);
  m11.window.NexusHaptics.bindUI();
  check('bindUI() preenche o diagnóstico em texto', /Vibração: SUPORTADA/.test(statusEl.textContent));
  check('bindUI() reflete o estado do interruptor', toggleEl.checked === true);
  activate(m11.window);
  testBtnEl.dispatchEvent(new m11.window.MouseEvent('click', { bubbles: true }));
  check('Botão "Testar vibração" dispara o padrão de teste', m11.vibrateCalls.length > 0, JSON.stringify(m11.vibrateCalls));

  // ------------------------------------------------------------------
  console.log('\n11. Validando integração com o Botão de Pânico (panic-realtime)...');
  check('panic-realtime.js usa o motor de haptics', PANIC_SRC.includes('window.NexusHaptics'));
  check('Mantém o caminho direto pela Vibration API como fallback',
    PANIC_SRC.includes('navigator.vibrate') && PANIC_SRC.includes('navigator.vibrate(0)'));
  check('Loop periódico do alerta preservado (HAPTIC_INTERVAL_MS)',
    PANIC_SRC.includes('HAPTIC_INTERVAL_MS') && PANIC_SRC.includes('HAPTIC_PULSE_MS'));
  check('Padrão SOS disparado no acionamento (local e via broadcast)',
    /HAPTIC_PATTERN_SOS/.test(PANIC_SRC) && /fireActivationAlert\(\)/.test(PANIC_SRC));
  check('Rodapé informa o motivo de o aparelho não vibrar',
    PANIC_SRC.includes('nexusPanicFooterHaptics') && PANIC_SRC.includes('deviceAlertHint'));
  check('Overlay de toque do iOS aplicado ao #panicButton', PANIC_SRC.includes('attachTapHaptic'));
  const pages = ['dashboard.html', 'cargas.html', 'inspecao.html', 'scanner.html', 'embarcacoes.html',
    'manutencao.html', 'delegacao.html', 'tecnico_portos.html', 'relatorios.html'];
  check('Todas as páginas internas carregam js/haptics.js antes do módulo de pânico',
    pages.every((p) => {
      const html = read(p);
      const iHaptics = html.indexOf('js/haptics.js');
      const iPanic = html.indexOf('js/panic-realtime.js');
      return iHaptics !== -1 && iPanic !== -1 && iHaptics < iPanic;
    }));

  // ------------------------------------------------------------------
  console.log('\n12. Validando a página real (manutencao.html + módulos)...');
  const panicSrc = read('js/panic-realtime.js');
  const dom = new JSDOM(read('manutencao.html'), {
    url: 'https://nexusport.example/manutencao.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w12 = dom.window;
  w12.isSecureContext = true;
  Object.defineProperty(w12.navigator, 'userAgent', { configurable: true, get: () => IPHONE_UA });
  w12.currentUserSession = {
    id: '11111111-1111-1111-1111-111111111111',
    nome: 'Inspetor de Testes',
    cargo: 'INSPETOR',
    cargo_nome: 'Inspetor',
    codigo_individual: 'INS-1001'
  };
  w12.nexusSupabase = null;
  w12.eval(HAPTICS_SRC);
  w12.eval(panicSrc);
  // Reproduz o ciclo de vida real da página (os módulos esperam DOMContentLoaded).
  w12.document.dispatchEvent(new w12.Event('DOMContentLoaded', { bubbles: true }));
  await tick();
  const status12 = w12.document.getElementById('hapticsStatus');
  check('Página real monta o módulo de haptics', Boolean(w12.NexusHaptics));
  check('Página real monta o módulo de pânico', Boolean(w12.NexusPanic));
  check('Diagnóstico do painel preenchido na página real', /Vibração/.test(status12 ? status12.textContent : ''), status12 ? status12.textContent : 'sem elemento');
  check('Overlay de toque aplicado ao botão SOS na página real',
    Boolean(w12.document.querySelector('#panicButton label[data-haptic-trigger]')));
  check('Botão de pânico continua publicando o estado global',
    typeof w12.NexusPanic.getState === 'function' && w12.NexusPanic.isActive() === false);

  // ------------------------------------------------------------------
  console.log('\n13. Validando o fluxo completo do botão SOS (Android)...');
  const dom13 = new JSDOM(read('manutencao.html'), {
    url: 'https://nexusport.example/manutencao.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w13 = dom13.window;
  w13.isSecureContext = true;
  Object.defineProperty(w13.navigator, 'userAgent', { configurable: true, get: () => ANDROID_UA });
  const vibracoes = [];
  w13.navigator.vibrate = (pattern) => { vibracoes.push(pattern); return true; };
  w13.localStorage.setItem('nexus_session', JSON.stringify({
    id: '11111111-1111-1111-1111-111111111111',
    matricula: '777001',
    codigo_individual: 'INS-1001',
    nome: 'Inspetor de Testes',
    cargo: 'INSPETOR',
    cargo_nome: 'Inspetor',
    status: 'ATIVO'
  }));
  w13.nexusSupabase = null;
  w13.eval(read('js/auth-guard.js'));
  w13.currentUserSession = w13.NexusAuth.getSession();
  w13.eval(HAPTICS_SRC);
  w13.eval(panicSrc);
  w13.document.dispatchEvent(new w13.Event('DOMContentLoaded', { bubbles: true }));
  await tick();
  w13.NexusHaptics.unlock(); // operador já tocou na tela ao usar o sistema

  const acionamento = await w13.NexusPanic.triggerPanic({ confirmar: false });
  check('Acionamento do SOS concluído (fallback sem Supabase)', acionamento.ok === true, JSON.stringify(acionamento));
  const primeiroPadrao = vibracoes.find((p) => p !== 0);
  check('Padrão SOS é o primeiro sinal tátil do acionamento',
    JSON.stringify(primeiroPadrao) === JSON.stringify(w13.NexusHaptics.PATTERNS.sos), JSON.stringify(vibracoes));
  check('Estado global ativo após o acionamento', w13.NexusPanic.isActive() === true);
  const rodape = w13.document.getElementById('nexusPanicFooter');
  check('Rodapé de emergência exibido em todas as páginas',
    Boolean(rodape) && !rodape.classList.contains('hidden'));
  const desativacao = await w13.NexusPanic.clearPanic({ confirmar: false });
  check('Desativação liberada para o Inspetor', desativacao.ok === true, JSON.stringify(desativacao));
  check('Vibração interrompida com navigator.vibrate(0)', vibracoes[vibracoes.length - 1] === 0, JSON.stringify(vibracoes));

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DO ALERTA NO APARELHO PASSARAM! ✨');
    console.log('================================================================');
    process.exit(0);
  }
  console.error('💥 ALGUNS TESTES DO ALERTA NO APARELHO FALHARAM. REVISE js/haptics.js!');
  console.log('================================================================');
  process.exit(1);
}

testHaptics().catch((err) => {
  console.error('💥 Erro inesperado ao executar os testes de haptics:', err);
  process.exit(1);
});
