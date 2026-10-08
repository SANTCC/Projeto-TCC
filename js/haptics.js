/**
 * Motor de alertas táteis e sonoros do NexusPort.
 *
 * A vibração usa somente a Vibration API (`navigator.vibrate`). A API tem
 * disponibilidade limitada: em geral requer HTTPS/localhost, a página visível
 * e uma interação prévia do usuário (sticky activation). Ela não está
 * disponível em navegadores que não a implementam, incluindo Safari/WebKit no iOS/iPadOS.
 * Nenhum controle HTML ou chamada programática consegue contornar essa
 * limitação; nesses aparelhos usamos o alerta sonoro e o banner visual.
 *
 * Os padrões são validados conforme a Vibration API: no máximo 10 entradas,
 * cada duração limitada a 10.000 ms. A aceitação pela API não garante que o
 * aparelho tenha motor de vibração nem que as preferências do sistema estejam
 * habilitadas.
 *
 * API pública: window.NexusHaptics
 */
(function (window, document) {
  'use strict';

  const VERSION = '1.1.0';
  const PREFS_KEY = 'nexus_haptics_prefs';
  const MAX_PATTERN_LENGTH = 10;
  const MAX_DURATION_MS = 10000;

  const PATTERNS = {
    tap: [30],
    double: [60, 80, 60],
    alert: [300, 120, 300, 120, 300],
    sos: [300, 120, 300, 120, 300, 350, 700, 350, 700]
  };

  let prefs = loadPrefs();
  let userActivated = false;
  let armed = false;
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
    return /iPad|iPhone|iPod/i.test(nav.userAgent || '')
      || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  }

  function isMobile() {
    const nav = window.navigator || {};
    return /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua())
      || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
  }

  function hasVibrationApi() {
    return Boolean(window.navigator && typeof window.navigator.vibrate === 'function');
  }

  function isSecureContext() {
    // `navigator.vibrate` é SecureContext. Navegadores antigos podem não
    // expor `window.isSecureContext`; nesse caso, a própria disponibilidade da
    // API continua sendo a fonte de verdade.
    return window.isSecureContext !== false;
  }

  /** Sticky activation nativa, com fallback para navegadores sem userActivation. */
  function hasUserActivation() {
    const activation = window.navigator && window.navigator.userActivation;
    if (activation && activation.hasBeenActive === true) return true;
    return userActivated;
  }

  /** A página está dentro de um iframe? Usado apenas para o diagnóstico. */
  function isEmbedded() {
    try {
      return window.self !== window.top;
    } catch (e) {
      return true;
    }
  }

  // ------------------------------------------------------------------
  // Diagnóstico (usado pela interface e pelos testes)
  // ------------------------------------------------------------------
  function status() {
    const vibrationApi = hasVibrationApi();
    const enabled = prefs.enabled !== false;
    const visible = !document.hidden;
    const secureContext = isSecureContext();
    const activated = hasUserActivation();
    const ios = isIOS();
    const mobile = isMobile();
    const backend = vibrationApi ? 'vibration_api' : 'none';
    const reasons = [];

    if (!enabled) reasons.push('disabled');
    if (!secureContext) reasons.push('insecure_context');
    if (!visible) reasons.push('hidden');
    if (backend === 'none') reasons.push('unsupported');
    if (backend !== 'none' && !activated) reasons.push('no_activation');

    return {
      version: VERSION,
      platform: ios ? 'ios' : (mobile ? 'mobile' : 'desktop'),
      ios: ios,
      mobile: mobile,
      embedded: isEmbedded(),
      secureContext: secureContext,
      vibrationApi: vibrationApi,
      backend: backend,
      enabled: enabled,
      visible: visible,
      userActivated: activated,
      soundEnabled: isSoundEnabled(),
      canHaptic: enabled && secureContext && visible && activated && vibrationApi,
      reasons: reasons,
      lastReason: lastReason
    };
  }

  /** Existe suporte à Vibration API neste navegador? */
  function hasBackend() {
    return hasVibrationApi();
  }

  const SHORT_HINTS = {
    disabled: 'Vibração desativada neste aparelho.',
    unsupported: 'Vibração não disponível neste navegador — use o alerta sonoro.',
    insecure_context: 'Vibração exige https:// ou localhost.',
    no_activation: 'Toque na página para liberar a vibração.',
    hidden: 'Aba em segundo plano: vibração pausada.',
    blocked: 'O navegador recusou a vibração.',
    invalid_pattern: 'Padrão de vibração inválido.',
    error: 'Falha ao acionar a vibração.'
  };

  /** Texto explicando o motivo atual de o aparelho (não) estar vibrando. */
  function hint(reason, short) {
    const key = reason || (status().reasons[0] || null);
    if (short && SHORT_HINTS[key]) return SHORT_HINTS[key];

    switch (key) {
      case 'disabled':
        return 'Vibração desativada neste aparelho — reative no painel "Alerta no Aparelho".';
      case 'unsupported':
        return isIOS()
          ? 'Este navegador no iPhone/iPad não expõe a Vibration API. A página não consegue acionar a vibração; ative o alerta sonoro.'
          : 'Este navegador não expõe a Vibration API (por exemplo, Firefox 129+). Ative o alerta sonoro.';
      case 'insecure_context':
        return 'A Vibration API exige https:// ou localhost. Abra o sistema por uma conexão segura.';
      case 'no_activation':
        return 'Interaja uma vez com a página (toque, clique ou tecla) para liberar a vibração no navegador.';
      case 'hidden':
        return 'Aba em segundo plano: o navegador interrompe a vibração. Mantenha o NexusPort visível.';
      case 'blocked':
        return 'O navegador recusou a vibração. Verifique a interação, a visibilidade da página e as configurações do aparelho.';
      case 'invalid_pattern':
        return 'O padrão precisa conter durações numéricas não negativas.';
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
      parts.push(st.mobile
        ? 'Vibração: API disponível (motor/configuração do aparelho não confirmados)'
        : 'Vibração: API presente, mas este aparelho provavelmente não tem motor (desktop)');
    } else if (st.ios) {
      parts.push('Vibração: INDISPONÍVEL no navegador deste iPhone/iPad');
    } else {
      parts.push('Vibração: INDISPONÍVEL neste navegador');
    }

    parts.push(`contexto seguro: ${st.secureContext ? 'sim' : 'não'}`);
    if (st.embedded) parts.push('página em iframe');
    if (st.backend !== 'none') parts.push(`interação do usuário: ${st.userActivated ? 'sim' : 'não'}`);
    parts.push(`página visível: ${st.visible ? 'sim' : 'não'}`);
    parts.push(`vibração ${st.enabled ? 'ativada' : 'desativada'}`);
    parts.push(`som ${st.soundEnabled ? 'ativado' : 'desativado'}`);

    return `${parts.join(' · ')}\n→ ${hint(st.reasons[0] || st.lastReason)}`;
  }

  // ------------------------------------------------------------------
  // Backend sonoro (WebAudio) — alternativa quando não há vibração
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
    // Automático: desligado em celulares que expõem a Vibration API;
    // ligado onde ela não existe e em desktop, como alternativa perceptível.
    return !(hasVibrationApi() && isMobile());
  }

  function resumeAudioFromUserGesture() {
    if (!isSoundEnabled()) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const resumePromise = ctx.resume();
        if (resumePromise && typeof resumePromise.catch === 'function') resumePromise.catch(function () {});
      }
    } catch (e) { /* o navegador pode bloquear até uma interação real */ }
  }

  function beep(count) {
    if (!isSoundEnabled()) return false;
    const ctx = ensureAudio();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const resumePromise = ctx.resume();
        if (resumePromise && typeof resumePromise.catch === 'function') resumePromise.catch(function () {});
      }
      const total = Math.max(1, Math.min(3, Math.floor(count || 1)));
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
  // Validação/normalização e chamadas da Vibration API
  // ------------------------------------------------------------------
  function resolvePattern(patternOrName) {
    if (typeof patternOrName === 'string') {
      return Object.prototype.hasOwnProperty.call(PATTERNS, patternOrName)
        ? PATTERNS[patternOrName]
        : null;
    }
    if (Array.isArray(patternOrName) || typeof patternOrName === 'number') return patternOrName;
    return null;
  }

  /**
   * Replica a normalização da especificação: um número vira uma lista; a lista
   * é limitada a 10 itens e cada valor a 10.000 ms. Entradas inválidas falham
   * claramente, sem repassar um padrão estranho ao navegador.
   */
  function normalizePattern(pattern) {
    const list = typeof pattern === 'number'
      ? [pattern]
      : (Array.isArray(pattern) ? pattern.slice(0, MAX_PATTERN_LENGTH) : null);
    if (!list) return null;

    const normalized = [];
    for (const duration of list) {
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
      normalized.push(Math.min(MAX_DURATION_MS, Math.trunc(duration)));
    }
    return normalized;
  }

  function isCancelPattern(pattern) {
    return pattern.length === 0 || (pattern.length === 1 && pattern[0] === 0);
  }

  /** Dispara um padrão; retorna true somente se o navegador não o recusou. */
  function vibrate(patternOrName) {
    const rawPattern = resolvePattern(patternOrName);
    const pattern = normalizePattern(rawPattern);
    if (!pattern) {
      lastReason = 'invalid_pattern';
      return false;
    }

    const cancel = isCancelPattern(pattern);
    const st = status();
    if (!st.enabled && !cancel) { lastReason = 'disabled'; return false; }
    if (!st.secureContext) { lastReason = 'insecure_context'; return false; }
    if (!st.visible) { lastReason = 'hidden'; return false; }
    if (!st.vibrationApi) { lastReason = 'unsupported'; return false; }
    if (!st.userActivated) { lastReason = 'no_activation'; return false; }

    try {
      // Empty list and [0] both cancel any currently running pattern.
      const accepted = window.navigator.vibrate(cancel ? 0 : pattern);
      lastReason = accepted === false ? 'blocked' : null;
      return accepted !== false;
    } catch (e) {
      lastReason = 'error';
      return false;
    }
  }

  /** Cancela uma vibração já iniciada, sem produzir chamadas antes da ativação. */
  function stop() {
    try {
      if (hasVibrationApi() && isSecureContext() && !document.hidden && hasUserActivation()) {
        window.navigator.vibrate(0);
      }
    } catch (e) { /* vibração indisponível neste navegador */ }
  }

  /** Um ciclo de alerta do aparelho = vibração + som quando habilitado. */
  function alert() {
    const fired = vibrate('alert');
    const sounded = beep(1);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status() };
  }

  /** Padrão completo de SOS, usado no acionamento do botão de pânico. */
  function sos() {
    const fired = vibrate('sos');
    const sounded = beep(3);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status() };
  }

  /** Teste explícito do painel: tenta vibração e som. */
  function test() {
    if (prefs.enabled === false) setEnabled(true);
    const fired = vibrate('alert');
    const sounded = beep(2);
    return { fired: fired, sounded: sounded, reason: lastReason, status: status(), description: describe() };
  }

  // ------------------------------------------------------------------
  // Sticky activation / desbloqueio de áudio
  // ------------------------------------------------------------------
  function unlock() {
    const activation = window.navigator && window.navigator.userActivation;
    if (activation && activation.hasBeenActive === true) userActivated = true;
    if (hasUserActivation()) resumeAudioFromUserGesture();
    return hasUserActivation();
  }

  function onUserInteraction(event) {
    // A flag local só é necessária em navegadores sem navigator.userActivation,
    // e apenas eventos genuínos podem concedê-la. Eventos sintéticos não
    // desbloqueiam a Vibration API nem o áudio.
    if (event && event.isTrusted === true) userActivated = true;
    unlock();
  }

  function arm() {
    if (armed || !document.addEventListener) return;
    armed = true;
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(function (evt) {
      document.addEventListener(evt, onUserInteraction, { passive: true, capture: true });
    });
  }

  // ------------------------------------------------------------------
  // Preferências (API pública)
  // ------------------------------------------------------------------
  function isEnabled() { return prefs.enabled !== false; }

  function setEnabled(value) {
    prefs.enabled = Boolean(value);
    savePrefs();
    if (!prefs.enabled) stop();
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
  }
  // O próprio navegador também aborta a sequência ao ocultar o documento;
  // este cancelamento cobre implementações que ainda deixam o padrão ativo.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
  });

  window.NexusHaptics = {
    VERSION: VERSION,
    PATTERNS: PATTERNS,
    MAX_PATTERN_LENGTH: MAX_PATTERN_LENGTH,
    MAX_DURATION_MS: MAX_DURATION_MS,
    status: status,
    describe: describe,
    hint: hint,
    hasBackend: hasBackend,
    normalizePattern: normalizePattern,
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
    bindUI: bindUI,
    isIOS: isIOS,
    isMobile: isMobile
  };
})(window, document);
