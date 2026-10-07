/**
 * Motor de Alerta Tátil (vibração) e Sonoro do Aparelho — NexusPort (js/haptics.js)
 *
 * POR QUE ESTE MÓDULO EXISTE
 * --------------------------
 * O Botão de Pânico Global (js/panic-realtime.js) precisa alertar o operador
 * NO PRÓPRIO APARELHO, e não apenas na tela. A API prevista para isso é
 * `navigator.vibrate()` (Vibration API), mas ela falha silenciosamente em
 * vários cenários reais — todos eles já observados em campo:
 *
 *   1. iOS/iPadOS: a Apple NUNCA implementou a Vibration API. Como todos os
 *      navegadores do iPhone usam WebKit (Safari, Chrome, Firefox, Edge), a
 *      chamada simplesmente não existe → o iPhone não vibra;
 *   2. CONTEXTO INSEGURO: `navigator.vibrate` é `[SecureContext]`, ou seja,
 *      só existe em https:// ou localhost. Servindo o sistema por http:// em
 *      um IP da rede local (ex.: `npm start` + celular no Wi-Fi), a função é
 *      `undefined` e nada acontece;
 *   3. USER ACTIVATION (sticky): Chrome só vibra depois que o usuário tocou
 *      na página ao menos uma vez — quem RECEBE o alerta por WebSocket sem
 *      nunca ter tocado na tela não sente nada;
 *   4. PÁGINA OCULTA: com a aba em segundo plano / tela apagada o navegador
 *      recusa a vibração (retorna `false`);
 *   5. Firefox 129+ removeu a API; no desktop a chamada retorna `true` mas
 *      nenhum motor vibra (não existe hardware).
 *
 * COMO ESTE MÓDULO RESOLVE
 * ------------------------
 *   - Android / Chrome / Edge / Samsung Internet / Opera → `navigator.vibrate()`
 *     com padrões de emergência (SOS + pulsos periódicos).
 *   - iOS 17.4+ → haptics nativos via `<input type="checkbox" switch>` (o
 *     switch nativo do Safari aciona o Taptic Engine):
 *       (a) OVERLAY DE TOQUE sobre o botão SOS — como o toque acontece
 *           diretamente no switch, o iPhone vibra até no iOS 26.5+, versão em
 *           que a Apple bloqueou o acionamento programático;
 *       (b) acionamento PROGRAMÁTICO (toggle do switch por script) enquanto o
 *           iOS permitir (17.4 – 26.4), usado pelos pulsos do alerta global.
 *   - Sem retorno tátil possível (iPhone 26.5+, desktop, http://, Firefox 129+)
 *     → ALERTA SONORO via WebAudio (bipe curto e intermitente), para que a
 *     emergência não passe em branco.
 *   - Sempre expõe DIAGNÓSTICO legível (`status()` / `describe()`) para a
 *     interface explicar, em português, POR QUE o aparelho não vibrou — em vez
 *     de falhar em silêncio como fazia `navigator.vibrate()`.
 *
 * Acessibilidade: a preferência `prefers-reduced-motion` controla apenas as
 * ANIMAÇÕES de tela (ver js/panic-realtime.js). Alerta tátil e sonoro de
 * emergência são governados por uma preferência explícita do usuário
 * (painel "Alerta no Aparelho" em manutencao.html), nunca desligados em
 * silêncio por uma configuração de sistema que fala de movimento.
 *
 * API pública: window.NexusHaptics
 */
(function (window, document) {
  'use strict';

  const VERSION = '1.0.0';
  const PREFS_KEY = 'nexus_haptics_prefs';

  /**
   * Padrões de vibração em milissegundos (mesmo formato da Vibration API:
   * ligado, desligado, ligado, desligado...). A especificação limita o vetor
   * a 10 posições — os padrões abaixo respeitam esse limite.
   */
  const PATTERNS = {
    tap: [16],
    double: [40, 60, 40],
    alert: [220, 90, 220, 90, 220],
    sos: [200, 100, 200, 100, 200, 300, 600, 300, 600]
  };

  const IOS_SWITCH_MIN = { major: 17, minor: 4 };      // switch nativo disponível
  const IOS_PROGRAMMATIC_MAX = { major: 26, minor: 5 }; // Apple bloqueou o toggle por script

  let prefs = loadPrefs();
  let userActivated = false;
  let armed = false;
  let switchEl = null;
  let iosBurstTimer = null;
  let lastReason = null;
  let audioCtx = null;

  // ------------------------------------------------------------------
  // Preferências do usuário (persistidas por aparelho/navegador)
  // ------------------------------------------------------------------
  function loadPrefs() {
    const base = { enabled: true, sound: null }; // som null = automático
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.enabled === 'boolean') base.enabled = parsed.enabled;
          if (typeof parsed.sound === 'boolean') base.sound = parsed.sound;
        }
      }
    } catch (e) { /* localStorage indisponível (modo privado/iframe) */ }
    return base;
  }

  function savePrefs() {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ enabled: prefs.enabled, sound: prefs.sound }));
    } catch (e) { /* storage indisponível */ }
  }

  // ------------------------------------------------------------------
  // Detecção do aparelho / do navegador
  // ------------------------------------------------------------------
  function ua() {
    return (window.navigator && window.navigator.userAgent) || '';
  }

  function isIOS() {
    const nav = window.navigator || {};
    return /iPad|iPhone|iPod/.test(nav.userAgent || '')
      || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  }

  function isMobile() {
    return /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua());
  }

  /** Versão do iOS extraída do User-Agent ({major, minor} ou null). */
  function iosVersion() {
    const m = /(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/.exec(ua());
    if (!m) return null;
    return { major: Number(m[1]), minor: Number(m[2]) };
  }

  function versionAtLeast(version, min) {
    if (!version) return true; // versão desconhecida: não bloqueia o recurso
    if (version.major !== min.major) return version.major > min.major;
    return version.minor >= min.minor;
  }

  function versionBefore(version, max) {
    if (!version) return true; // versão desconhecida: mantém a tentativa
    if (version.major !== max.major) return version.major < max.major;
    return version.minor < max.minor;
  }

  function hasVibrationApi() {
    return typeof window.navigator.vibrate === 'function';
  }

  /** `true` quando o switch nativo do Safari existe (iOS 17.4+). */
  function hasIOSSwitch() {
    return isIOS() && versionAtLeast(iosVersion(), IOS_SWITCH_MIN);
  }

  /** `true` quando o toggle programático do switch ainda aciona o Taptic Engine. */
  function hasIOSProgrammatic() {
    return hasIOSSwitch() && versionBefore(iosVersion(), IOS_PROGRAMMATIC_MAX);
  }

  /**
   * Sticky user activation: vale o que o navegador informa
   * (`navigator.userActivation.hasBeenActive`) ou a interação já registrada
   * pelo módulo. Sem isso o Chrome recusa a vibração e polui o console com
   * "[Intervention] Blocked call to navigator.vibrate".
   */
  function hasUserActivation() {
    const ua2 = window.navigator && window.navigator.userActivation;
    if (ua2 && typeof ua2.hasBeenActive === 'boolean' && ua2.hasBeenActive) return true;
    return userActivated;
  }

  // ------------------------------------------------------------------
  // Diagnóstico (usado pela interface e pelos testes)
  // ------------------------------------------------------------------
  function status() {
    const vibrationApi = hasVibrationApi();
    const iosSwitch = hasIOSSwitch();
    const iosProgrammatic = hasIOSProgrammatic();
    const enabled = prefs.enabled !== false;
    const visible = !document.hidden;
    const secureContext = window.isSecureContext !== false;
    const activated = hasUserActivation();
    const ios = isIOS();
    const mobile = isMobile();

    const backend = vibrationApi ? 'vibration_api' : (iosSwitch ? 'ios_switch' : 'none');
    const reasons = [];
    if (!enabled) reasons.push('disabled');
    if (backend === 'none') reasons.push('unsupported');
    if (!secureContext && backend !== 'ios_switch') reasons.push('insecure_context');
    if (!activated && backend !== 'none') reasons.push('no_activation');
    if (!visible) reasons.push('hidden');
    if (backend === 'ios_switch' && !iosProgrammatic) reasons.push('ios_programmatic_blocked');

    return {
      version: VERSION,
      platform: ios ? 'ios' : (mobile ? 'mobile' : 'desktop'),
      ios: ios,
      mobile: mobile,
      secureContext: secureContext,
      vibrationApi: vibrationApi,
      iosSwitch: iosSwitch,
      iosProgrammatic: iosProgrammatic,
      backend: backend,
      enabled: enabled,
      visible: visible,
      userActivated: activated,
      soundEnabled: isSoundEnabled(),
      // A vibração só é aceita com a página visível, a preferência ligada e
      // (pela Vibration API ou pelo switch do iOS) com interação do usuário.
      canHaptic: enabled && visible && activated && (vibrationApi || iosProgrammatic),
      // Só a vibração contínua do alerta exige o modo programático; o toque
      // direto no switch (overlay do botão SOS) funciona em qualquer versão.
      reasons: reasons,
      lastReason: lastReason
    };
  }

  /** Existe QUALQUER forma de dar retorno no aparelho (tátil ou sonoro)? */
  function hasBackend() {
    return hasVibrationApi() || hasIOSSwitch();
  }

  /** Versões compactas das dicas, para o rodapé fixo do alerta global. */
  const SHORT_HINTS = {
    disabled: 'Vibração desativada neste aparelho.',
    unsupported: 'Sem vibração neste navegador (iPhone/iPad) — ative o alerta sonoro.',
    insecure_context: 'Vibração exige https:// — abra o sistema por https.',
    no_activation: 'Toque na tela para liberar a vibração.',
    hidden: 'Aba em segundo plano: vibração pausada.',
    ios_programmatic_blocked: 'iOS 26.5+ bloqueia vibração por script — o toque no SOS vibra.',
    blocked: 'O navegador recusou a vibração.',
    error: 'Falha ao acionar a vibração.'
  };

  /**
   * Texto curto explicando o motivo atual de o aparelho (não) estar vibrando.
   * Sempre em português e sempre acionável pelo operador.
   */
  function hint(reason, short) {
    const key = reason || (status().reasons[0] || null);
    if (short && SHORT_HINTS[key]) return SHORT_HINTS[key];
    switch (key) {
      case 'disabled':
        return 'Vibração desativada neste aparelho — reative no painel "Alerta no Aparelho".';
      case 'unsupported':
        return 'Este navegador não vibra (iPhone/iPad e Firefox 129+ não expõem a vibração para páginas web). Ative o alerta sonoro.';
      case 'insecure_context':
        return 'A vibração só funciona em https:// ou localhost. Abra o sistema por https (a página atual está em http://).';
      case 'no_activation':
        return 'Toque uma vez na tela para o navegador liberar a vibração.';
      case 'hidden':
        return 'Aba em segundo plano: o navegador pausa a vibração. Mantenha o NexusPort em primeiro plano.';
      case 'ios_programmatic_blocked':
        return 'No iOS 26.5+ a Apple bloqueou a vibração acionada por script: o toque no botão SOS ainda vibra; o alerta contínuo usa som + banner.';
      case 'blocked':
        return 'O navegador recusou a vibração (interaja com a página e mantenha a aba visível).';
      case 'error':
        return 'Falha ao acionar a vibração neste navegador.';
      default:
        return 'Vibração operante neste aparelho.';
    }
  }

  /** Diagnóstico completo em uma linha (usado pelo painel em manutencao.html). */
  function describe() {
    const st = status();
    const parts = [];
    if (st.backend === 'vibration_api') {
      // Desktop também expõe a API (retorna true), mas não tem motor de vibração.
      parts.push(st.mobile
        ? 'Vibração: SUPORTADA (Vibration API)'
        : 'Vibração: API presente, mas este aparelho provavelmente não tem motor (desktop) — use o alerta sonoro');
    } else if (st.backend === 'ios_switch') {
      parts.push('Vibração: haptics do iOS (switch nativo)');
    } else {
      parts.push('Vibração: INDISPONÍVEL neste navegador');
    }

    parts.push(`contexto seguro: ${st.secureContext ? 'sim' : 'não'}`);
    if (st.backend !== 'none') parts.push(`interação do usuário: ${st.userActivated ? 'sim' : 'não'}`);
    parts.push(`página visível: ${st.visible ? 'sim' : 'não'}`);
    parts.push(`vibração ${st.enabled ? 'ativada' : 'desativada'}`);
    parts.push(`som ${st.soundEnabled ? 'ativado' : 'desativado'}`);
    if (st.ios) parts.push(`iOS${iosVersion() ? ` ${iosVersion().major}.${iosVersion().minor}` : ''}`);

    return `${parts.join(' · ')}\n→ ${hint(st.reasons[0])}`;
  }

  // ------------------------------------------------------------------
  // Backend iOS: switch nativo do Safari (Taptic Engine)
  // ------------------------------------------------------------------
  function ensureSwitch() {
    if (switchEl && switchEl.isConnected !== false) return switchEl;
    switchEl = document.createElement('input');
    switchEl.type = 'checkbox';
    switchEl.setAttribute('switch', '');
    switchEl.setAttribute('aria-hidden', 'true');
    switchEl.tabIndex = -1;
    switchEl.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1;';
    switchEl.addEventListener('click', function (event) { event.stopPropagation(); });
    (document.body || document.documentElement).appendChild(switchEl);
    return switchEl;
  }

  /** Um "toque" no switch nativo (uma vibração curta) — iOS 17.4–26.4. */
  function toggleSwitchOnce() {
    const el = ensureSwitch();
    if (!el) return false;
    try {
      el.checked = !el.checked;
      // O clique programático é o que aciona o haptic no Safari.
      el.click();
      return true;
    } catch (e) {
      lastReason = 'error';
      return false;
    }
  }

  function iosBurst(times) {
    const total = Math.max(1, times || 1);
    if (iosBurstTimer !== null) {
      window.clearTimeout(iosBurstTimer);
      iosBurstTimer = null;
    }
    let done = 0;
    const step = function () {
      iosBurstTimer = null;
      if (done >= total) return;
      done += 1;
      toggleSwitchOnce();
      if (done < total) iosBurstTimer = window.setTimeout(step, 180);
    };
    step();
    return true;
  }

  /**
   * Overlay de toque: cobre o elemento com um <label> ligado a um switch
   * escondido. O toque real do dedo chega ao switch (haptic nativo) e o clique
   * continua subindo normalmente para o botão, mantendo o handler do SOS.
   */
  function attachTapHaptic(element) {
    if (!element || !hasIOSSwitch()) return false;
    if (element.getAttribute && element.getAttribute('data-haptic-attached') === 'true') return false;

    const label = document.createElement('label');
    label.setAttribute('data-haptic-trigger', '');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:absolute;inset:0;touch-action:manipulation;cursor:pointer;'
      + '-webkit-tap-highlight-color:transparent;';

    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.setAttribute('switch', '');
    sw.tabIndex = -1;
    sw.style.cssText = 'position:absolute;width:1px;height:1px;margin:0;visibility:hidden;';
    // A cópia redirecionada pelo <label> não pode acionar o botão duas vezes.
    sw.addEventListener('click', function (event) { event.stopPropagation(); });
    label.appendChild(sw);

    // Garante que o overlay se posicione sobre o elemento.
    const position = window.getComputedStyle ? window.getComputedStyle(element).position : 'static';
    if (position === 'static') element.style.position = 'relative';
    element.appendChild(label);

    // Rede de segurança: se o navegador não propagar o clique do <label> até o
    // botão (comportamento varia entre versões do WebKit), o handler do SOS é
    // disparado programaticamente — sem NUNCA duplicar o acionamento.
    let clickSeen = false;
    element.addEventListener('click', function () { clickSeen = true; }, false);
    label.addEventListener('click', function () {
      clickSeen = false;
      window.setTimeout(function () {
        if (clickSeen) return;
        try { element.click(); } catch (e) { /* ignora */ }
      }, 0);
    });

    if (element.getAttribute) element.setAttribute('data-haptic-attached', 'true');
    return true;
  }

  // ------------------------------------------------------------------
  // Backend sonoro (WebAudio) — usado quando não há retorno tátil possível
  // ------------------------------------------------------------------
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function isSoundEnabled() {
    if (typeof prefs.sound === 'boolean') return prefs.sound;
    // Automático: desligado no celular que comprovadamente tem motor de
    // vibração; ligado no desktop e no iPhone/iPad (onde a vibração web é
    // impossível), garantindo que o alerta seja percebido em algum canal.
    return !(hasVibrationApi() && isMobile());
  }

  function beep(count) {
    if (!isSoundEnabled()) return false;
    const ctx = ensureAudio();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    } catch (e) { /* contexto bloqueado até a próxima interação */ }
    try {
      const total = Math.max(1, count || 1);
      const start = ctx.currentTime + 0.01;
      for (let i = 0; i < total; i++) {
        const at = start + i * 0.22;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.09, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.2);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Núcleo: vibração / pulso / parada
  // ------------------------------------------------------------------
  function resolvePattern(patternOrName) {
    if (typeof patternOrName === 'string') return PATTERNS[patternOrName] || PATTERNS.alert;
    if (Array.isArray(patternOrName)) return patternOrName;
    if (typeof patternOrName === 'number') return patternOrName === 0 ? 0 : [patternOrName];
    return PATTERNS.alert;
  }

  /**
   * Dispara UM retorno tátil (um padrão de vibração).
   * @param {string|number[]|number} patternOrName nome ('sos', 'alert', ...), vetor ou duração
   * @returns {boolean} true quando o navegador aceitou o pedido
   */
  function vibrate(patternOrName) {    const pattern = resolvePattern(patternOrName);
    if (pattern === 0) { stop(); return true; }

    const st = status();
    if (!st.enabled) { lastReason = 'disabled'; return false; }
    if (!st.visible) { lastReason = 'hidden'; return false; }

    if (st.backend === 'vibration_api') {
      if (!st.userActivated) {
        // Sem interação prévia o Chrome ignora e registra intervention;
        // retorna false sem sujar o console.
        lastReason = 'no_activation';
        return false;
      }
      try {
        const ok = window.navigator.vibrate(pattern);
        lastReason = ok === false ? 'blocked' : null;
        return ok !== false;
      } catch (e) {
        lastReason = 'error';
        return false;
      }
    }

    if (st.backend === 'ios_switch') {
      if (!st.iosProgrammatic) {
        lastReason = 'ios_programmatic_blocked';
        return false;
      }
      if (!st.userActivated) { lastReason = 'no_activation'; return false; }
      lastReason = null;
      return iosBurst(Array.isArray(pattern) ? Math.min(3, Math.ceil(pattern.length / 2)) : 1);
    }

    lastReason = 'unsupported';
    return false;
  }

  /** Interrompe qualquer vibração em andamento. */
  function stop() {
    if (iosBurstTimer !== null) {
      window.clearTimeout(iosBurstTimer);
      iosBurstTimer = null;
    }
    try {
      if (typeof window.navigator.vibrate === 'function') window.navigator.vibrate(0);
    } catch (e) { /* vibração indisponível neste navegador */ }
  }

  /**
   * Um ciclo de alerta do aparelho = vibração (+ som quando habilitado).
   * É o que o loop do Botão de Pânico chama a cada HAPTIC_INTERVAL_MS.
   */
  function alert() {
    const fired = vibrate('alert');
    const sounded = beep(1);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status() };
  }

  /** Padrão completo de SOS (usado no acionamento do botão de pânico). */
  function sos() {
    const fired = vibrate('sos');
    const sounded = beep(3);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status() };
  }

  /** Teste explícito (botão "Testar vibração"): tenta tátil + sonoro. */
  function test() {
    if (prefs.enabled === false) setEnabled(true);
    const fired = vibrate('alert');
    const sounded = beep(2);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status(), description: describe() };
  }

  /**
   * Marca a página como "já interagida" e prepara o áudio dentro do gesto
   * (exigência dos navegadores para WebAudio). Chamado automaticamente no
   * primeiro toque/tecla e também pelo módulo de pânico.
   */
  function unlock() {
    userActivated = true;
    if (isSoundEnabled()) {
      const ctx = ensureAudio();
      // WebAudio só sai de "suspended" a partir de um gesto do usuário.
      try {
        if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      } catch (e) { /* contexto bloqueado */ }
    }
    return true;
  }

  function arm() {
    if (armed || !document.addEventListener) return;
    armed = true;
    const handler = function () { unlock(); };
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
      document.addEventListener(evt, handler, { passive: true, capture: true });
    });
  }

  // ------------------------------------------------------------------
  // Preferências (API pública)
  // ------------------------------------------------------------------
  function isEnabled() { return prefs.enabled !== false; }
  function setEnabled(value) {
    prefs.enabled = Boolean(value);
    savePrefs();
    if (prefs.enabled === false) stop();
    else unlock();
    return prefs.enabled;
  }
  function setSoundEnabled(value) {
    prefs.sound = Boolean(value);
    savePrefs();
    if (prefs.sound) unlock();
    return prefs.sound;
  }

  // ------------------------------------------------------------------
  // Painel "Alerta no Aparelho" (presente em manutencao.html)
  // ------------------------------------------------------------------
  function bindUI(ids) {
    const cfg = ids || {};
    const byId = function (id) { return id ? document.getElementById(id) : null; };
    const statusEl = byId(cfg.statusId || 'hapticsStatus');
    const toggle = byId(cfg.toggleId || 'hapticsEnabledToggle');
    const soundToggle = byId(cfg.soundId || 'hapticsSoundToggle');
    const testBtn = byId(cfg.testId || 'hapticsTestBtn');
    const refreshBtn = byId(cfg.refreshId || 'hapticsRefreshBtn');
    const feedbackEl = byId(cfg.feedbackId || 'hapticsFeedback');

    function refresh(message) {
      if (toggle) toggle.checked = isEnabled();
      if (soundToggle) soundToggle.checked = isSoundEnabled();
      if (statusEl) statusEl.textContent = describe();
      if (feedbackEl && message) feedbackEl.textContent = message;
    }

    if (toggle) {
      toggle.addEventListener('change', function () {
        const on = setEnabled(toggle.checked);
        refresh(on ? 'Vibração ativada neste aparelho.' : 'Vibração desativada neste aparelho.');
      });
    }
    if (soundToggle) {
      soundToggle.addEventListener('change', function () {
        const on = setSoundEnabled(soundToggle.checked);
        refresh(on ? 'Alerta sonoro ativado neste aparelho.' : 'Alerta sonoro desativado neste aparelho.');
        if (on) beep(1);
      });
    }
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        const result = test();
        refresh(result.fired
          ? 'Teste enviado: você deve ter sentido a vibração (e o som, se ativado).'
          : `Teste concluído sem vibração — ${hint(result.reason)}`);
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () { refresh('Diagnóstico atualizado.'); });
    }

    refresh();
    return { refresh: refresh };
  }

  // ------------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------------
  arm();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm);
  } else {
    arm();
  }

  window.NexusHaptics = {
    VERSION: VERSION,
    PATTERNS: PATTERNS,
    status: status,
    describe: describe,
    hint: hint,
    hasBackend: hasBackend,
    vibrate: vibrate,
    alert: alert,
    sos: sos,
    stop: stop,
    test: test,
    beep: beep,
    unlock: unlock,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    isSoundEnabled: isSoundEnabled,
    setSoundEnabled: setSoundEnabled,
    attachTapHaptic: attachTapHaptic,
    bindUI: bindUI,
    isIOS: isIOS,
    isMobile: isMobile
  };
})(window, document);
