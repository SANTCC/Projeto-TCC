/**
 * Módulo de Pânico GLOBAL em Tempo Real - NexusPort (js/panic-realtime.js)
 *
 * Implementa o Botão de Pânico global (SPECs/backlog3.md):
 *  1. O botão existente (manutencao.html) dispara um EVENTO DE SERVIDOR na
 *     Edge Function "panic-alert" (supabase/functions/panic-alert/index.ts);
 *  2. A função faz um BROADCAST via WebSocket (Supabase Realtime, canal
 *     "nexus-emergency") para TODOS os clientes conectados;
 *  3. Um WEBHOOK OPCIONAL — DESATIVADO POR PADRÃO — é disparado pela
 *     função quando `panic_webhook_config.enabled = true` + URL válida
 *     (configurável no painel em manutencao.html);
 *  4. Todos os clientes exibem uma mensagem fixa no RODAPÉ da tela
 *     informando que está ocorrendo uma emergência.
 *
 * Resiliência: se a Edge Function não estiver implantada (ou o Supabase
 * não estiver configurado), o módulo faz o broadcast diretamente pelo
 * canal Realtime (cliente → clientes) e persiste o estado localmente,
 * mantendo o alerta global funcionando. Nesse fallback o webhook NÃO
 * é disparado (somente o servidor possui a integração).
 */

(function (window) {
  'use strict';

  const CHANNEL_NAME = 'nexus-emergency';
  const BROADCAST_EVENT = 'panic';
  const FUNCTION_SLUG = 'panic-alert';
  const LS_KEY = 'nexus_emergency_active';
  const TERMINAL = 'STS-01';

  // Cargos que podem DESATIVAR o alarme (mesma regra da página de Manutenção)
  const ROLES_DESATIVAR = [
    'INSPETOR',
    'SUPERVISOR_GERENTE_OPERACOES',
    'DIRETOR_OPERACOES_LOGISTICA',
    'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
    'CONSELHO_ADMINISTRACAO'
  ];

  const CARGOS_VALIDOS = [
    'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR',
    'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES',
    'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
    'CONSELHO_ADMINISTRACAO'
  ];

  let state = {
    active: false,
    emergencia_id: null,
    motivo: null,
    acionado_por: null,
    data_hora: null,
    origem: null
  };
  let channel = null;
  let banner = null;
  let initialized = false;
  let inFlight = false;
  let hapticTimer = null;
  let lastActivationAlertAt = 0;
  let lastInteractionHapticAt = -Infinity;
  let lastPulseBlocked = false;
  // Motores de celular (Android) levam ~50–100 ms para girar e o sistema
  // arredonda pulsos muito curtos: 300 ms é o mínimo que se sente no bolso.
  const HAPTIC_PULSE_MS = 300;
  const HAPTIC_INTERVAL_MS = 3000;
  // Padrão "SOS" reduzido (limitado a 10 posições pela especificação da
  // Vibration API): três toques curtos + dois longos, repetido pelo loop.
  const HAPTIC_PATTERN_SOS = [300, 120, 300, 120, 300, 350, 700, 350, 700];
  const HAPTIC_PATTERN_ALERT = [HAPTIC_PULSE_MS, 120, HAPTIC_PULSE_MS, 120, HAPTIC_PULSE_MS];

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function getSession() {
    return window.currentUserSession || (window.NexusAuth ? window.NexusAuth.getSession() : null);
  }

  function getSupabase() {
    return window.nexusSupabase || null;
  }

  function getUtils() {
    return window.NexusSupabaseUtils || null;
  }

  /**
   * Cliente Supabase somente quando a tabela informada já foi provisionada.
   * Se a tabela não existe no banco (404 / PGRST205), devolve null e a
   * aplicação segue pelo caminho local — sem enxurrada de erros no console.
   */
  function getSupabaseTabela(tabela) {
    const utils = getUtils();
    if (utils && typeof utils.clientePara === 'function') return utils.clientePara(tabela);
    return getSupabase();
  }

  /** Registra o erro; true quando o motivo é "tabela ausente" (falta migração). */
  function tratarErroTabela(tabela, error) {
    const utils = getUtils();
    if (utils && typeof utils.registrarErroTabela === 'function') {
      return utils.registrarErroTabela(tabela, error);
    }
    console.warn(`[NexusPanic] Erro na tabela '${tabela}':`, (error && error.message) || error);
    return false;
  }

  /** Migração SQL que cria a tabela (usada nas mensagens de diagnóstico). */
  function migracaoDaTabela(tabela) {
    const utils = getUtils();
    return (utils && typeof utils.migracaoDaTabela === 'function' && utils.migracaoDaTabela(tabela)) ||
      'supabase/migrations/20261008000000_emergencias_fix_404.sql';
  }

  function canTrigger() {
    return window.NexusAuth ? window.NexusAuth.hasPermission('ACIONAR_EMERGENCIA') : false;
  }

  function canDeactivate() {
    const session = getSession();
    return Boolean(session && ROLES_DESATIVAR.includes(session.cargo));
  }

  function isUuid(str) {
    return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  }

  function formatHora(iso) {
    try {
      return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return '--:--:--';
    }
  }

  function feedback(tipo, titulo, mensagem) {
    if (window.mostrarFeedback) window.mostrarFeedback(tipo, titulo, mensagem);
  }

  // ------------------------------------------------------------------
  // Banner GLOBAL no rodapé da tela (item "Botão de Pânico ser global")
  // ------------------------------------------------------------------
  function ensureBanner() {
    if (banner) return banner;
    banner = document.getElementById('nexusPanicFooter');
    if (banner) return banner;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes nexusPanicSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes nexusPanicVibrate {
        0%, 88%, 100% { transform: translateX(0); }
        90% { transform: translateX(-2px); }
        92% { transform: translateX(2px); }
        94% { transform: translateX(-2px); }
        96% { transform: translateX(2px); }
        98% { transform: translateX(-1px); }
      }
      #nexusPanicFooter:not(.hidden) { animation: nexusPanicSlideUp 0.35s ease-out; }
      .nexus-panic-vibrating { animation: nexusPanicVibrate 1.8s linear infinite !important; }
      #nexusPanicFooter:not(.hidden).nexus-panic-vibrating {
        animation: nexusPanicSlideUp 0.35s ease-out, nexusPanicVibrate 1.8s linear 0.35s infinite !important;
      }
      html.nexus-panic-active body { padding-bottom: 58px; }
      @media (prefers-reduced-motion: reduce) {
        .nexus-panic-vibrating { animation: none !important; }
      }
    `;
    document.head.appendChild(style);

    banner = document.createElement('div');
    banner.id = 'nexusPanicFooter';
    banner.className = 'hidden fixed bottom-0 left-0 right-0 z-40 bg-red-600 text-white shadow-[0_-4px_20px_rgba(0,0,0,0.35)] border-t-2 border-red-800';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `
      <div class="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5">
        <div class="flex items-center gap-3 min-w-0">
          <span class="relative flex h-3 w-3 shrink-0">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
            <span class="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
          </span>
          <span class="material-symbols-outlined text-[22px] shrink-0">e911_emergency</span>
          <div class="min-w-0">
            <span id="nexusPanicFooterTitle" class="font-display font-bold text-xs sm:text-sm uppercase tracking-wider block truncate">Emergência global ativa — Terminal STS-01</span>
            <span id="nexusPanicFooterDetail" class="text-[11px] text-red-100 block truncate">Uma emergência crítica está em andamento no terminal.</span>
            <span id="nexusPanicFooterHaptics" class="hidden text-[10px] text-red-100/90 block truncate"></span>
          </div>
        </div>
        <button id="nexusPanicFooterDeactivate" type="button" class="hidden sm:flex shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-red-700 hover:bg-red-50 font-bold text-[11px] uppercase tracking-wide transition-colors">
          <span class="material-symbols-outlined text-[16px]">notifications_off</span>
          <span>Desativar Alarme</span>
        </button>
      </div>
    `;
    document.body.appendChild(banner);

    const deactivateBtn = banner.querySelector('#nexusPanicFooterDeactivate');
    if (deactivateBtn) {
      deactivateBtn.addEventListener('click', () => { clearPanic({ confirmar: true }); });
    }
    return banner;
  }

  // ------------------------------------------------------------------
  // Alerta NO PRÓPRIO APARELHO (vibração + som)
  //
  // js/haptics.js aplica os requisitos da Vibration API (contexto seguro,
  // página visível e sticky user activation). Aqui fica um fallback direto
  // para o caso de o módulo extra não estar carregado.
  // ------------------------------------------------------------------
  function vibrateDevice(pattern) {
    if (window.NexusHaptics && typeof window.NexusHaptics.vibrate === 'function') {
      return window.NexusHaptics.vibrate(pattern);
    }
    const nav = window.navigator;
    if (!nav || typeof nav.vibrate !== 'function') return false;
    if (window.isSecureContext === false || document.hidden) return false;
    if (nav.userActivation && nav.userActivation.hasBeenActive === false) return false;
    try {
      return nav.vibrate(pattern) !== false;
    } catch (e) {
      return false;
    }
  }

  /** Existe alguma via de vibração no aparelho (mesmo que temporariamente bloqueada)? */
  function deviceHasHapticBackend() {
    if (window.NexusHaptics && typeof window.NexusHaptics.hasBackend === 'function') {
      return window.NexusHaptics.hasBackend();
    }
    const nav = window.navigator;
    return Boolean(nav && typeof nav.vibrate === 'function');
  }

  function deviceSoundEnabled() {
    return Boolean(window.NexusHaptics && typeof window.NexusHaptics.isSoundEnabled === 'function'
      && window.NexusHaptics.isSoundEnabled());
  }

  /**
   * Motivo (em português) pelo qual o aparelho NÃO está vibrando agora — ou
   * null quando o retorno tátil está funcionando. Exibido no banner do rodapé
   * para o operador não ficar sem saber se o alerta chegou ao celular.
   */
  function deviceAlertHint() {
    if (!window.NexusHaptics) {
      const nav = window.navigator;
      if (!nav || typeof nav.vibrate !== 'function') {
        return 'Sem Vibration API neste navegador (ex.: Safari no iPhone/iPad) — considere ativar o alerta sonoro.';
      }
      if (window.isSecureContext === false) return 'Vibração exige https:// ou localhost.';
      if (document.hidden) return 'Aba em segundo plano: vibração pausada.';
      if (nav.userActivation && nav.userActivation.hasBeenActive === false) return 'Toque na página para liberar a vibração.';
      return null;
    }
    const st = window.NexusHaptics.status();
    const motivo = st.reasons[0] || st.lastReason || null;
    if (!motivo) return null;
    return window.NexusHaptics.hint(motivo, true);
  }

  function stopDeviceVibration() {
    if (hapticTimer !== null) {
      window.clearTimeout(hapticTimer);
      hapticTimer = null;
    }
    if (window.NexusHaptics && typeof window.NexusHaptics.stop === 'function') {
      window.NexusHaptics.stop();
      return;
    }
    try {
      const nav = window.navigator;
      const activated = !nav || !nav.userActivation || nav.userActivation.hasBeenActive !== false;
      if (nav && typeof nav.vibrate === 'function' && window.isSecureContext !== false
        && !document.hidden && activated) {
        window.navigator.vibrate(0);
      }
    } catch (e) { /* vibração indisponível neste navegador */ }
  }

  /** Um pulso do alerta (tátil + sonoro quando habilitado) e reprograma o próximo. */
  function pulseDeviceAlert() {
    hapticTimer = null;
    if (!state.active || document.hidden) {
      stopDeviceVibration();
      return;
    }
    if (window.NexusHaptics && typeof window.NexusHaptics.alert === 'function') {
      const resultado = window.NexusHaptics.alert();
      lastPulseBlocked = Boolean(resultado && resultado.fired === false);
    } else {
      lastPulseBlocked = !vibrateDevice(HAPTIC_PATTERN_ALERT);
    }
    // O motivo exibido no rodapé muda (ex.: o operador tocou na tela e a
    // vibração passou a funcionar) — mantém o aviso coerente.
    refreshHapticsNote();
    // Mesmo quando o navegador recusa no momento (sem interação do usuário,
    // por exemplo), seguimos tentando: no primeiro toque a vibração volta.
    hapticTimer = window.setTimeout(pulseDeviceAlert, HAPTIC_INTERVAL_MS);
  }

  function syncDeviceVibration() {
    if (!state.active || document.hidden) {
      stopDeviceVibration();
      return;
    }
    if (hapticTimer !== null) return;
    if (!deviceHasHapticBackend() && !deviceSoundEnabled()) return;
    pulseDeviceAlert();
  }

  /** Reinicia o ciclo do alerta disparando um pulso imediatamente. */
  function kickDeviceAlert() {
    if (hapticTimer !== null) {
      window.clearTimeout(hapticTimer);
      hapticTimer = null;
    }
    if (!deviceHasHapticBackend() && !deviceSoundEnabled()) return;
    pulseDeviceAlert();
  }

  /**
   * No Chrome/Android a vibração só é liberada depois que o usuário toca na
   * página. Quem apenas RECEBE o alerta (aba aberta, ninguém tocou) fica sem
   * vibração até interagir — então, no primeiro toque durante a emergência,
   * disparamos o pulso na hora, sem esperar o próximo ciclo de 3s.
   */
  function onUserInteraction() {
    if (window.NexusHaptics && typeof window.NexusHaptics.unlock === 'function') {
      window.NexusHaptics.unlock();
    }
    if (!state.active || document.hidden || !lastPulseBlocked) return;

    // pointerdown/touchstart/click podem fazer parte do mesmo toque. Tente uma
    // única vez por gesto para não duplicar o alerta sonoro/tátil.
    const now = Date.now();
    if (now - lastInteractionHapticAt < 400) return;
    lastInteractionHapticAt = now;
    kickDeviceAlert();
  }

  /**
   * Toque/confirmação do operador: vibra o padrão SOS NA HORA, antes de
   * qualquer ida à rede. O celular precisa responder no momento do toque —
   * a chamada da Edge Function/webhook pode levar segundos.
   */
  function primeActivationAlert() {
    lastActivationAlertAt = Date.now();
    if (document.hidden) return;
    if (window.NexusHaptics && typeof window.NexusHaptics.sos === 'function') {
      window.NexusHaptics.sos();
    } else {
      vibrateDevice(HAPTIC_PATTERN_SOS);
    }
  }

  /**
   * Padrão de acionamento (SOS) disparado quando uma emergência passa a valer,
   * tanto para quem apertou o botão quanto para quem recebeu o broadcast.
   * Deve ser chamado ANTES de setState({ active: true }) para que o padrão SOS
   * seja o primeiro sinal no aparelho (e não um pulso comum do loop).
   * O debounce evita repetir o padrão no mesmo aparelho (o próprio cliente
   * também recebe o broadcast que enviou).
   */
  function fireActivationAlert() {
    const agora = Date.now();
    if (agora - lastActivationAlertAt < 2000) return;
    lastActivationAlertAt = agora;

    if (!document.hidden) {
      if (window.NexusHaptics && typeof window.NexusHaptics.sos === 'function') {
        window.NexusHaptics.sos();
      } else {
        vibrateDevice(HAPTIC_PATTERN_SOS);
      }
    }

    if (hapticTimer !== null) {
      window.clearTimeout(hapticTimer);
      hapticTimer = null;
    }
    if (deviceHasHapticBackend() || deviceSoundEnabled()) {
      hapticTimer = window.setTimeout(pulseDeviceAlert, HAPTIC_INTERVAL_MS);
    }
  }

  function renderBanner() {
    const el = ensureBanner();
    if (!el) return;
    const detail = el.querySelector('#nexusPanicFooterDetail');
    const hapticsNote = el.querySelector('#nexusPanicFooterHaptics');
    const deactivateBtn = el.querySelector('#nexusPanicFooterDeactivate');

    if (state.active) {
      const quem = state.acionado_por
        ? `${state.acionado_por.nome || 'Operador'}${state.acionado_por.cargo ? ` (${state.acionado_por.cargo})` : ''}`
        : 'fonte não identificada';
      const hora = state.data_hora ? ` às ${formatHora(state.data_hora)}` : '';
      const motivo = state.motivo ? `Motivo: ${state.motivo}. ` : '';
      if (detail) {
        detail.textContent = `${motivo}Acionado por ${quem}${hora}. Siga os protocolos de evacuação e segurança do terminal.`;
      }
      if (deactivateBtn) deactivateBtn.classList.toggle('hidden', !canDeactivate());
      el.classList.remove('hidden');
      document.documentElement.classList.add('nexus-panic-active');
    } else {
      el.classList.add('hidden');
      document.documentElement.classList.remove('nexus-panic-active');
    }

    // Toda página conectada recebe o mesmo indicador animado de SOS. Nos
    // aparelhos compatíveis, o alerta também vibra (js/haptics.js).
    el.classList.toggle('nexus-panic-vibrating', Boolean(state.active));
    const panicButton = document.getElementById('panicButton');
    if (panicButton) panicButton.classList.toggle('nexus-panic-vibrating', Boolean(state.active));

    // Deixa explícito no rodapé quando o aparelho NÃO está vibrando e por quê
    // (iOS, http://, falta de interação do usuário, aba em segundo plano...).
    if (hapticsNote) refreshHapticsNote(hapticsNote);

    syncDeviceVibration();
  }

  /** Atualiza a linha de diagnóstico do rodapé (motivo de o aparelho não vibrar). */
  function refreshHapticsNote(noteEl) {
    const note = noteEl || document.getElementById('nexusPanicFooterHaptics');
    if (!note) return;
    const motivo = state.active ? deviceAlertHint() : null;
    note.textContent = motivo || '';
    note.classList.toggle('hidden', !motivo);
  }

  // ------------------------------------------------------------------
  // Estado global + sincronização entre módulos/páginas
  // ------------------------------------------------------------------
  function setState(next) {
    state = Object.assign({}, state, next);
    try {
      if (state.active) localStorage.setItem(LS_KEY, 'true');
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* storage indisponível */ }

    renderBanner();

    try {
      window.dispatchEvent(new CustomEvent('nexus_panic_changed', { detail: Object.assign({}, state) }));
    } catch (e) { /* CustomEvent indisponível */ }
  }

  // ------------------------------------------------------------------
  // Supabase Realtime (WebSocket) — recebe broadcasts de TODOS os clientes
  // ------------------------------------------------------------------
  function ensureChannel() {
    const sb = getSupabase();
    if (!sb || typeof sb.channel !== 'function') return null;
    if (!channel) {
      channel = sb.channel(CHANNEL_NAME, { config: { broadcast: { self: true } } });
    }
    return channel;
  }

  function handleBroadcast(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.estado === 'ATIVA') {
      // Todos os aparelhos conectados também são alertados no próprio
      // dispositivo (vibração/som), não apenas visualmente no rodapé. O padrão
      // SOS vem antes do estado para ser o primeiro sinal sentido; o debounce
      // interno evita repetir para quem acabou de acionar (o emissor também
      // recebe o próprio broadcast).
      fireActivationAlert();
      setState({
        active: true,
        emergencia_id: payload.emergencia_id || null,
        motivo: payload.motivo || null,
        acionado_por: payload.acionado_por || null,
        data_hora: payload.data_hora || new Date().toISOString(),
        origem: payload.origem || 'broadcast'
      });
    } else if (payload.estado === 'RESOLVIDA') {
      setState({ active: false, emergencia_id: null, motivo: null, acionado_por: null, data_hora: null, origem: null });
    }
  }

  function subscribeRealtime() {
    const ch = ensureChannel();
    if (!ch) return;
    ch.on('broadcast', { event: '*' }, (msg) => {
      if (!msg || (msg.event && msg.event !== BROADCAST_EVENT)) return;
      handleBroadcast(msg.payload);
    }).subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[NexusPanic] WebSocket conectado ao canal de emergência "${CHANNEL_NAME}".`);
      } else if (err) {
        console.warn('[NexusPanic] Erro ao assinar o canal Realtime:', err);
      }
    });
  }

  // Estado inicial: consulta a tabela `emergencias` (clientes que conectam
  // durante uma emergência ativa também precisam ver o alerta no rodapé).
  //
  // Tabela ausente (404 / PGRST205): NÃO é falha do navegador — falta aplicar
  // a migração SQL no projeto Supabase. O módulo marca a tabela como
  // indisponível, mantém o flag local e agenda rechecagens com backoff: se a
  // migração for aplicada com a tela aberta, o estado global volta sozinho,
  // sem recarregar a página.
  const ESTADO_RETRY_MS = [5000, 15000, 45000, 120000];
  let estadoRetryTimer = null;
  let estadoRetryIndex = 0;

  function agendarRechecagemEstado() {
    if (estadoRetryTimer !== null) return;
    if (!getUtils()) return;
    if (estadoRetryIndex >= ESTADO_RETRY_MS.length) return; // desiste após ~3 min
    const espera = ESTADO_RETRY_MS[estadoRetryIndex++];
    estadoRetryTimer = setTimeout(() => {
      estadoRetryTimer = null;
      rechecarTabelaEmergencias();
    }, espera);
  }

  // Rechecagem ativa: um HEAD barato (diagnosticar) libera a tabela caso a
  // migração tenha sido aplicada depois do carregamento da página.
  async function rechecarTabelaEmergencias() {
    const utils = getUtils();
    if (!utils || typeof utils.diagnosticar !== 'function') return;
    const diag = await utils.diagnosticar('emergencias');
    if (diag && diag.disponivel) {
      estadoRetryIndex = 0;
      await loadStateFromDb();
    } else {
      agendarRechecagemEstado();
    }
  }

  async function loadStateFromDb() {
    const sb = getSupabaseTabela('emergencias');
    if (sb) {
      try {
        const { data, error } = await sb
          .from('emergencias')
          .select('*')
          .eq('estado', 'ATIVA')
          .order('data_hora', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error) {
          estadoRetryIndex = 0;
          const utils = getUtils();
          if (utils && typeof utils.liberarTabela === 'function') utils.liberarTabela('emergencias');
          if (data) {
            setState({
              active: true,
              emergencia_id: data.id || null,
              motivo: data.motivo || null,
              acionado_por: {
                nome: data.acionado_por_nome || null,
                cargo: data.acionado_por_cargo || null,
                codigo_individual: data.acionado_por_codigo || null
              },
              data_hora: data.data_hora || null,
              origem: 'database'
            });
          } else {
            setState({ active: false, emergencia_id: null, motivo: null, acionado_por: null, data_hora: null, origem: null });
          }
          return;
        }

        // Tabela fora do schema cache do PostgREST (HTTP 404 / PGRST205)?
        tratarErroTabela('emergencias', error);
      } catch (e) {
        console.warn('[NexusPanic] Falha ao ler emergencias do Supabase:', e);
      }
    }

    // Fallback sem Supabase/tabela: respeita o flag local legado
    if (localStorage.getItem(LS_KEY) === 'true') {
      setState({ active: true, origem: 'local' });
    }

    // A tabela ainda não existe? Tenta de novo em alguns segundos.
    const utils = getUtils();
    if (utils && typeof utils.tabelaIndisponivel === 'function' && utils.tabelaIndisponivel('emergencias')) {
      agendarRechecagemEstado();
    }
  }

  // ------------------------------------------------------------------
  // Persistência local (fallback quando a Edge Function está indisponível)
  // ------------------------------------------------------------------
  async function persistEmergencyLocal(identity, motivo, dataHora) {
    const sb = getSupabaseTabela('emergencias');
    if (!sb) return null;
    const session = getSession() || {};
    try {
      const { data, error } = await sb.from('emergencias').insert({
        estado: 'ATIVA',
        motivo: motivo || `Emergência crítica declarada no Terminal ${TERMINAL}.`,
        funcionario_id: isUuid(session.id) ? session.id : null,
        acionado_por_nome: identity.nome,
        acionado_por_cargo: CARGOS_VALIDOS.includes(identity.cargo) ? identity.cargo : null,
        acionado_por_codigo: identity.codigo_individual,
        data_hora: dataHora,
        origem: 'CLIENT_FALLBACK'
      }).select().maybeSingle();
      if (error) {
        tratarErroTabela('emergencias', error);
        return null;
      }
      return data && data.id ? data.id : null;
    } catch (e) {
      console.warn('[NexusPanic] Fallback: falha ao persistir emergencia:', e);
      return null;
    }
  }

  async function resolveEmergencyLocal(identity) {
    const sb = getSupabaseTabela('emergencias');
    if (!sb) return state.emergencia_id;
    try {
      const { data: ativa, error } = await sb
        .from('emergencias')
        .select('*')
        .eq('estado', 'ATIVA')
        .order('data_hora', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        tratarErroTabela('emergencias', error);
        return null;
      }
      if (ativa && ativa.id) {
        const { error: erroUpdate } = await sb.from('emergencias').update({
          estado: 'RESOLVIDA',
          resolvido_por_nome: identity.nome,
          resolvido_por_cargo: CARGOS_VALIDOS.includes(identity.cargo) ? identity.cargo : null,
          data_resolucao: new Date().toISOString()
        }).eq('id', ativa.id);
        if (erroUpdate) tratarErroTabela('emergencias', erroUpdate);
        return ativa.id;
      }
    } catch (e) {
      console.warn('[NexusPanic] Fallback: falha ao resolver emergencia:', e);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Auditoria (logs_alteracoes) — mesmo padrão dos demais módulos
  // ------------------------------------------------------------------
  /**
   * Classifica a falha do insert de auditoria e devolve uma nota curta para o
   * operador (ou null). O caso que motivou esta função veio dos logs do
   * Supabase (service_name "postgres_logs"):
   *
   *   sql_state_code: "22P02"
   *   event_message : invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
   *   parsed.query  : WITH pgrst_source AS (INSERT INTO "public"."logs_alteracoes" ...
   *
   * O banco não tinha o valor no enum (schema anterior à seção 15 do
   * SPECs/schema.sql) e o resultado do insert era DESCARTADO — a auditoria da
   * emergência se perdia em silêncio. Agora o erro é detectado, avisado uma
   * única vez e o arquivo .sql que corrige aparece na tela.
   */
  function tratarErroAuditoria(error) {
    const utils = getUtils();
    if (utils && typeof utils.registrarEnumDesconhecido === 'function') {
      const info = utils.registrarEnumDesconhecido(error);
      if (info) {
        return {
          ok: false,
          motivo: 'enum_desconhecido',
          enum_desconhecido: { tipo: info.tipo, valor: info.valor, code: info.code },
          migracao: info.migracao,
          error: error
        };
      }
    }
    console.warn('[NexusPanic] Falha ao registrar auditoria do pânico:', (error && error.message) || error);
    return { ok: false, motivo: 'erro_escrita', error: error };
  }

  async function registrarAuditoria(estadoAudit, detalhes) {
    const sb = getSupabase();
    const session = getSession() || {};
    if (!sb) return { ok: false, motivo: 'sem_cliente' };
    try {
      const cargoEnum = CARGOS_VALIDOS.includes(session.cargo) ? session.cargo : 'ESTIVADOR';
      const payload = {
        data_hora: new Date().toISOString(),
        cargo: cargoEnum,
        codigo_individual: session.codigo_individual || session.codigo || '--',
        entidade_tipo: 'EMERGENCIA',
        entidade_id: (detalhes && detalhes.emergencia_id) || 'PANICO_GLOBAL',
        tipo_alteracao: 'EDICAO',
        detalhes: Object.assign({ estado: estadoAudit, via: detalhes && detalhes.via }, detalhes)
      };
      if (isUuid(session.id)) payload.funcionario_id = session.id;
      // O supabase-js devolve o erro do PostgREST no objeto de resposta (não
      // lança): sem ler `error`, uma recusa do banco passaria invisível.
      const { error } = await sb.from('logs_alteracoes').insert(payload);
      if (error) return tratarErroAuditoria(error);
      return { ok: true };
    } catch (e) {
      console.warn('[NexusPanic] Falha ao registrar auditoria do pânico:', e);
      return { ok: false, motivo: 'excecao', error: e };
    }
  }

  // ------------------------------------------------------------------
  // Núcleo: acionar / desativar via Edge Function (com fallback)
  // ------------------------------------------------------------------
  async function executePanicAction(action, body, identity, motivo) {
    if (inFlight) {
      feedback('info', 'Aguarde', 'Já existe uma ação de emergência em andamento.');
      return { ok: false, reason: 'in_flight' };
    }
    inFlight = true;
    try {
      const ativando = action === 'activate';
      const dataHora = new Date().toISOString();
      const sb = getSupabase();

      let via = 'edge_function';
      let usouFallback = false;
      let webhook = null;
      let functionError = null;
      let emergenciaId = null;

      // 1) EVENTO DE SERVIDOR: Edge Function "panic-alert"
      if (sb && sb.functions && typeof sb.functions.invoke === 'function') {
        try {
          const { data, error } = await sb.functions.invoke(FUNCTION_SLUG, { body });
          if (error) {
            const httpStatus = (error.context && typeof error.context.status === 'number') ? error.context.status : null;
            let serverMsg = null;
            try {
              if (error.context && typeof error.context.json === 'function') {
                const ctxBody = await error.context.json();
                serverMsg = ctxBody && ctxBody.error;
              }
            } catch (e) { /* corpo não-JSON */ }
            functionError = serverMsg || error.message || 'Falha ao invocar a Edge Function panic-alert.';

            // RBAC recusado pelo servidor (401/403): NÃO usar fallback,
            // pois isso burlaria a validação de cargo feita no servidor.
            if (httpStatus === 401 || httpStatus === 403) {
              feedback('erro', 'Ação Bloqueada pelo Servidor', functionError);
              return { ok: false, forbidden: true, error: functionError };
            }
            usouFallback = true;
          } else if (data && data.ok === false) {
            feedback('erro', 'Erro no Servidor', data.error || 'A Edge Function recusou a ação.');
            return { ok: false, error: data.error || 'unknown' };
          } else {
            webhook = (data && data.webhook) || null;
            emergenciaId = data && data.emergencia ? data.emergencia.id : null;
            // O servidor processou a ação, mas o broadcast Realtime falhou?
            // Complementa com broadcast direto para não deixar clientes sem o alerta.
            if (data && data.broadcast && data.broadcast.ok === false) {
              console.warn('[NexusPanic] Broadcast do servidor falhou — complementando com broadcast direto:', data.broadcast);
              try {
                const ch = ensureChannel();
                if (ch) {
                  await ch.send({
                    type: 'broadcast',
                    event: BROADCAST_EVENT,
                    payload: ativando
                      ? { estado: 'ATIVA', emergencia_id: emergenciaId, motivo: motivo, terminal: TERMINAL, acionado_por: identity, data_hora: dataHora, origem: 'edge_function_relay' }
                      : { estado: 'RESOLVIDA', emergencia_id: emergenciaId, motivo: null, terminal: TERMINAL, resolvido_por: identity, data_hora: dataHora, origem: 'edge_function_relay' }
                  });
                }
              } catch (e) {
                console.warn('[NexusPanic] Falha no broadcast complementar:', e);
              }
            }
          }
        } catch (err) {
          functionError = err && err.message ? err.message : String(err);
          usouFallback = true;
        }
      } else {
        functionError = 'Cliente Supabase não inicializado.';
        usouFallback = true;
      }

      // 2) FALLBACK: broadcast direto via WebSocket (cliente → clientes)
      let broadcastPayload;
      if (usouFallback) {
        via = 'client_fallback';
        console.warn(`[NexusPanic] Edge Function "${FUNCTION_SLUG}" indisponível (${functionError || 'motivo desconhecido'}) — usando broadcast direto via Realtime.`);

        if (ativando) {
          emergenciaId = await persistEmergencyLocal(identity, motivo, dataHora);
        } else {
          emergenciaId = await resolveEmergencyLocal(identity);
        }

        broadcastPayload = ativando
          ? {
            estado: 'ATIVA',
            emergencia_id: emergenciaId,
            motivo: motivo || `Emergência crítica declarada no Terminal ${TERMINAL}.`,
            terminal: TERMINAL,
            acionado_por: identity,
            data_hora: dataHora,
            origem: 'client_fallback'
          }
          : {
            estado: 'RESOLVIDA',
            emergencia_id: emergenciaId,
            motivo: 'Alarme de emergência desativado. Operações normalizadas.',
            terminal: TERMINAL,
            resolvido_por: identity,
            data_hora: dataHora,
            origem: 'client_fallback'
          };

        try {
          const ch = ensureChannel();
          if (ch) await ch.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: broadcastPayload });
        } catch (e) {
          console.warn('[NexusPanic] Fallback: falha no broadcast direto:', e);
        }
      }

      // 3) Atualização otimista do estado local
      // (o broadcast com self:true também reatualiza via WebSocket)
      if (ativando) {
        // Quem aperta o botão SOS precisa SENTIR a emergência no aparelho:
        // dispara o padrão completo antes de publicar o estado (ainda dentro
        // do gesto do usuário, requisito dos navegadores para vibrar/sonorizar).
        fireActivationAlert();
        setState({
          active: true,
          emergencia_id: emergenciaId,
          motivo: motivo || (broadcastPayload && broadcastPayload.motivo) || null,
          acionado_por: identity,
          data_hora: dataHora,
          origem: via
        });
      } else {
        setState({ active: false, emergencia_id: null, motivo: null, acionado_por: null, data_hora: null, origem: null });
      }

      // 4) Auditoria imutável em logs_alteracoes
      // O resultado é lido (antes era descartado): se o banco recusar a
      // gravação — caso real do 22P02 no enum tipo_entidade_enum —, o
      // operador fica sabendo na hora, com o arquivo .sql que corrige.
      const auditoria = await registrarAuditoria(
        ativando ? 'EMERGENCIA_CRITICA_ATIVADA' : 'EMERGENCIA_DESATIVADA',
        {
          emergencia_id: emergenciaId,
          motivo: motivo || null,
          via,
          acionado_por: identity.nome,
          cargo: identity.cargo
        }
      );

      // 5) Feedback visual para quem acionou
      // Quando a origem é o fallback, o operador precisa saber o que NÃO
      // funcionou — e, se a tabela está ausente (404 / PGRST205), exatamente
      // qual migração SQL resolve.
      const utils = getUtils();
      const tabelaPendente = Boolean(utils && typeof utils.tabelaIndisponivel === 'function' && utils.tabelaIndisponivel('emergencias'));
      const fallbackNote = via === 'client_fallback'
        ? ' (Edge Function indisponível — broadcast direto via WebSocket; webhook não disparado' +
          (tabelaPendente ? `; tabela emergencias ausente no Supabase: aplique ${migracaoDaTabela('emergencias')}` : '') +
          ')'
        : '';
      // O alarme, o broadcast e o estado global já estão válidos; o que falhou
      // foi só o registro de auditoria — a nota diz o que fazer, sem alarmar
      // de novo sobre a emergência em si.
      let auditoriaNote = '';
      if (auditoria && auditoria.ok === false) {
        auditoriaNote = auditoria.motivo === 'enum_desconhecido'
          ? ` ⚠️ Auditoria NÃO gravada: o valor 'EMERGENCIA' não existe no enum do banco (22P02). Aplique ${auditoria.migracao || migracaoDaTabela('emergencias')}.`
          : ' ⚠️ Auditoria não gravada (detalhe no console).';
      }
      if (ativando) {
        let webhookNote = '';
        if (webhook && webhook.fired) {
          webhookNote = webhook.ok
            ? ' Webhook externo disparado com sucesso.'
            : ` Webhook disparado, porém respondeu com erro (${webhook.status || webhook.error || '?'}).`;
        }
        feedback(
          'erro',
          'EMERGÊNCIA CRÍTICA DECLARADA',
          `Alarme global enviado a todos os clientes conectados via WebSocket. Operações do pátio ${TERMINAL} bloqueadas temporariamente.${webhookNote}${fallbackNote}${auditoriaNote}`
        );
      } else {
        feedback(
          'sucesso',
          'Emergência Desativada',
          `Alarme de emergência desativado em todos os clientes conectados. Operações normalizadas.${fallbackNote}${auditoriaNote}`
        );
      }

      return { ok: true, via, webhook, emergencia_id: emergenciaId, auditoria };
    } finally {
      inFlight = false;
    }
  }

  function buildIdentity() {
    const session = getSession() || {};
    return {
      nome: session.nome || null,
      cargo: session.cargo || null,
      matricula: session.matricula || null,
      codigo_individual: session.codigo_individual || session.codigo || null
    };
  }

  /**
   * Aciona o botão de pânico global (Edge Function → broadcast WebSocket → webhook opcional).
   * @param {Object} options - { confirmar?: boolean (padrão true), motivo?: string }
   */
  async function triggerPanic(options = {}) {
    const session = getSession();
    if (!session) {
      feedback('erro', 'Sessão Necessária', 'Faça login para acionar o botão de pânico.');
      return { ok: false, reason: 'no_session' };
    }

    if (options.confirmar !== false) {
      const mensagem = `ATENÇÃO: Deseja acionar o BOTÃO DE PÂNICO GLOBAL e declarar EMERGÊNCIA CRÍTICA no Terminal ${TERMINAL}? O alerta será enviado a todos os clientes conectados.`;
      const confirmou = window.nexusConfirm
        ? await window.nexusConfirm('DECLARAÇÃO DE EMERGÊNCIA', mensagem)
        : window.confirm(mensagem);
      if (!confirmou) return { ok: false, cancelled: true };
    }

    if (!canTrigger()) {
      feedback('erro', 'Acesso Negado', `Seu cargo (${session.cargo_nome || session.cargo}) não possui a permissão ACIONAR_EMERGENCIA.`);
      return { ok: false, forbidden: true };
    }

    // O operador confirmou: o aparelho já avisa agora, sem esperar a rede.
    primeActivationAlert();

    const motivo = typeof options.motivo === 'string' && options.motivo.trim() ? options.motivo.trim() : null;
    const identity = buildIdentity();
    const resultadoAcionamento = await executePanicAction('activate', {
      action: 'activate',
      motivo,
      acionado_por: identity,
      terminal: TERMINAL
    }, identity, motivo);
    if (resultadoAcionamento && resultadoAcionamento.ok && window.NexusAnalytics) {
      window.NexusAnalytics.track('botao_panico_acionado');
    }
    return resultadoAcionamento;
  }

  /**
   * Desativa o alarme global de emergência.
   * @param {Object} options - { confirmar?: boolean (padrão true) }
   */
  async function clearPanic(options = {}) {
    const session = getSession();
    if (!session) return { ok: false, reason: 'no_session' };

    if (options.confirmar !== false) {
      const confirmou = window.nexusConfirm
        ? await window.nexusConfirm('Desativar Emergência', 'Confirmar desativação do alarme de emergência em todos os clientes conectados?')
        : window.confirm('Confirmar desativação do alarme de emergência?');
      if (!confirmou) return { ok: false, cancelled: true };
    }

    if (!canDeactivate()) {
      feedback('erro', 'Acesso Negado', `Seu cargo (${session.cargo_nome || session.cargo}) não pode desativar o alarme de emergência.`);
      return { ok: false, forbidden: true };
    }

    const identity = buildIdentity();
    return await executePanicAction('deactivate', {
      action: 'deactivate',
      acionado_por: identity,
      terminal: TERMINAL
    }, identity, null);
  }

  // ------------------------------------------------------------------
  // Painel de configuração do Webhook (opcional, DESLIGADO por padrão)
  // Presente em manutencao.html; bind automático se os elementos existirem.
  // ------------------------------------------------------------------
  function bindWebhookSettingsUI() {
    const enabledInput = document.getElementById('panicWebhookEnabled');
    const urlInput = document.getElementById('panicWebhookUrl');
    const saveBtn = document.getElementById('panicWebhookSaveBtn');
    const testBtn = document.getElementById('panicWebhookTestBtn');
    const statusEl = document.getElementById('panicWebhookStatus');
    if (!enabledInput || !urlInput || !saveBtn) return;

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg;
    }

    async function getConfigRow() {
      const sb = getSupabase();
      if (!sb) return null;
      try {
        const { data } = await sb
          .from('panic_webhook_config')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) return data;
        // Garante a linha única de configuração (padrão: DESLIGADO)
        const { data: created } = await sb
          .from('panic_webhook_config')
          .insert({ enabled: false, url: null })
          .select()
          .maybeSingle();
        return created || null;
      } catch (e) {
        console.warn('[NexusPanic] Falha ao ler panic_webhook_config:', e);
        return null;
      }
    }

    async function load() {
      setStatus('Carregando configuração do webhook...');
      const cfg = await getConfigRow();
      if (!cfg) {
        enabledInput.disabled = true;
        urlInput.disabled = true;
        saveBtn.disabled = true;
        setStatus('⚠️ Não foi possível ler panic_webhook_config. Aplique a migração supabase/migrations/20261007000000_panic_button_global.sql.');
        return;
      }
      enabledInput.checked = cfg.enabled === true;
      urlInput.value = cfg.url || '';
      setStatus(cfg.enabled
        ? `✔ Webhook ATIVO — o servidor disparará um POST para a URL configurada a cada evento de pânico (última atualização: ${cfg.updated_at ? formatHora(cfg.updated_at) : '--'}).`
        : 'Webhook DESATIVADO (padrão). Ative o interruptor e salve para que a Edge Function dispare o POST em cada evento de pânico.');
    }

    saveBtn.addEventListener('click', async () => {
      const sb = getSupabase();
      const cfg = await getConfigRow();
      if (!sb || !cfg) {
        feedback('erro', 'Erro ao Salvar', 'Supabase não configurado ou tabela panic_webhook_config ausente (aplique a migração SQL).');
        return;
      }
      const url = urlInput.value.trim();
      if (enabledInput.checked && !/^https?:\/\/.+/i.test(url)) {
        feedback('erro', 'URL Inválida', 'Informe uma URL http(s) válida para o webhook ou desative o interruptor.');
        return;
      }
      try {
        const { error } = await sb
          .from('panic_webhook_config')
          .update({ enabled: enabledInput.checked, url: url || null, updated_at: new Date().toISOString() })
          .eq('id', cfg.id);
        if (error) throw error;
        feedback('sucesso', 'Configuração Salva', enabledInput.checked
          ? 'Webhook de emergência ATIVADO. A Edge Function passará a disparar o POST configurado.'
          : 'Webhook de emergência DESATIVADO. Nenhum POST externo será disparado.');
        registrarAuditoria(enabledInput.checked ? 'WEBHOOK_EMERGENCIA_ATIVADO' : 'WEBHOOK_EMERGENCIA_DESATIVADO', { url_configurada: Boolean(url) });
        await load();
      } catch (e) {
        feedback('erro', 'Erro ao Salvar', e && e.message ? e.message : String(e));
      }
    });

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const sb = getSupabase();
        if (!sb || !sb.functions) {
          feedback('erro', 'Indisponível', 'Cliente Supabase não inicializado.');
          return;
        }
        setStatus('Enviando evento de teste para a Edge Function...');
        try {
          const { data, error } = await sb.functions.invoke(FUNCTION_SLUG, {
            body: { action: 'test-webhook', acionado_por: buildIdentity() }
          });
          if (error) {
            let serverMsg = null;
            try {
              if (error.context && typeof error.context.json === 'function') {
                const ctxBody = await error.context.json();
                serverMsg = ctxBody && ctxBody.error;
              }
            } catch (e) { /* ignore */ }
            throw new Error(serverMsg || error.message || 'Falha ao invocar a Edge Function.');
          }
          if (data && data.ok === false) throw new Error(data.error || 'A Edge Function recusou o teste.');
          const wh = (data && data.webhook) || {};
          feedback(
            wh.ok ? 'sucesso' : 'erro',
            wh.ok ? 'Webhook Respondeu OK' : 'Webhook Respondeu com Erro',
            `Status HTTP: ${wh.status != null ? wh.status : '?'}${wh.error ? ` — ${wh.error}` : ''}`
          );
          setStatus(wh.ok
            ? `✔ Teste realizado com sucesso (HTTP ${wh.status}).`
            : `⚠️ Teste falhou: ${wh.error || `HTTP ${wh.status}`}.`);
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          feedback('erro', 'Falha no Teste', `${msg} — verifique se a Edge Function "panic-alert" está implantada (supabase functions deploy panic-alert --no-verify-jwt).`);
          setStatus(`⚠️ Teste falhou: ${msg}`);
        }
      });
    }

    load();
  }

  // ------------------------------------------------------------------
  // Diagnóstico das tabelas do pânico (emergencias + panic_webhook_config)
  // --------------------------------------------------------------
  // Responde, em uma frase, o motivo do 404 relatado no painel Network:
  //   GET /rest/v1/emergencias?... -> 404 (PGRST205: tabela fora do cache)
  // e o que fazer: aplicar a migração SQL indicada.
  // ------------------------------------------------------------------
  async function verificarTabelas() {
    const utils = getUtils();
    if (!utils || typeof utils.diagnosticar !== 'function') {
      return {
        ok: false,
        mensagem: 'Utilitários do Supabase indisponíveis (js/supabase-client.js não carregado).',
        tabelas: {},
        auditoria: null
      };
    }

    const nomes = ['emergencias', 'panic_webhook_config'];
    const tabelas = {};
    for (const nome of nomes) {
      tabelas[nome] = await utils.diagnosticar(nome);
    }

    // Auditoria (logs_alteracoes.entidade_tipo = 'EMERGENCIA'): é a única
    // parte do protocolo que depende de um VALOR de enum do banco. Sem ele o
    // PostgreSQL recusa o insert com 22P02 (o erro relatado nos logs do
    // Supabase) e a trilha de auditoria da emergência se perde — o alarme em
    // si continua funcionando. A sonda é um select com limit(0): não escreve.
    const auditoria = typeof utils.verificarEnumAuditoria === 'function'
      ? await utils.verificarEnumAuditoria()
      : null;

    const pendentes = nomes.filter((nome) => !tabelas[nome].disponivel);
    const enumPendente = Boolean(auditoria && !auditoria.disponivel);
    const migracao = migracaoDaTabela('emergencias');

    let mensagem;
    if (pendentes.length === 0 && !enumPendente) {
      mensagem = '✔ Tabelas do botão de pânico provisionadas (emergencias + panic_webhook_config) ' +
        'e auditoria com o valor EMERGENCIA disponível.';
    } else if (pendentes.length > 0) {
      mensagem = `⚠️ Tabela(s) ausente(s) no Supabase: ${pendentes.join(', ')}. ` +
        `Aplique ${migracao} no SQL Editor do Supabase e clique em "Verificar" novamente.`;
      if (enumPendente) {
        mensagem += ` Auditoria do pânico: aplique também ${auditoria.migracao}.`;
      }
    } else {
      mensagem = `⚠️ Auditoria do pânico pendente: o valor '${auditoria.valor}' não existe no enum ` +
        `'${auditoria.tipo}' (22P02). Aplique ${auditoria.migracao} no SQL Editor do Supabase e ` +
        'clique em "Verificar" novamente.';
    }

    if (pendentes.length === 0) {
      // Voltou a existir: reativa o estado global (clientes já abertos
      // passam a ver emergências ativas sem recarregar a página).
      estadoRetryIndex = 0;
      loadStateFromDb();
    }

    return { ok: pendentes.length === 0 && !enumPendente, mensagem, tabelas, auditoria, migracao };
  }

  /**
   * Diagnóstico programático (console/testes):
   *   await NexusPanic.diagnose()
   */
  async function diagnose() {
    const utils = getUtils();
    const tabela = utils && typeof utils.diagnosticar === 'function'
      ? await utils.diagnosticar('emergencias')
      : { tabela: 'emergencias', disponivel: Boolean(getSupabase()), aviso: 'Utilitários do Supabase indisponíveis.', migracao: null };
    // Auditoria (enum 22P02): o estado global pode estar perfeito e, ainda
    // assim, a trilha de auditoria não gravar — este campo separa os dois.
    const auditoria = utils && typeof utils.verificarEnumAuditoria === 'function'
      ? await utils.verificarEnumAuditoria()
      : null;
    return {
      tabela: 'emergencias',
      disponivel: Boolean(tabela.disponivel),
      aviso: tabela.aviso || null,
      migracao: tabela.migracao || migracaoDaTabela('emergencias'),
      auditoria_enum: auditoria
        ? {
            valor: auditoria.valor,
            tipo: auditoria.tipo,
            disponivel: Boolean(auditoria.disponivel),
            migracao: auditoria.migracao,
            aviso: auditoria.aviso || null
          }
        : null,
      supabase_configurado: Boolean(getSupabase()),
      retry_agendado: estadoRetryTimer !== null,
      estado_local: Object.assign({}, state)
    };
  }

  // Botão "Verificar tabelas" do painel de manutenção (se existir na página)
  function bindDatabaseDiagnosticsUI() {
    const botao = document.getElementById('panicTablesCheckBtn');
    const status = document.getElementById('panicTablesStatus');
    if (!botao && !status) return null;

    async function executarVerificacao() {
      if (status) status.textContent = 'Verificando tabelas no Supabase...';
      const resultado = await verificarTabelas();
      if (status) status.textContent = resultado.mensagem;
      if (!resultado.ok && window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Migração Pendente', resultado.mensagem);
      }
      return resultado;
    }

    if (botao) botao.addEventListener('click', executarVerificacao);
    // Primeira verificação só para preencher o texto do painel
    if (status && status.textContent.trim() === '') executarVerificacao();
    return executarVerificacao;
  }

  // ------------------------------------------------------------------
  // Painel "Alerta no Aparelho" (vibração / som) — presente em manutencao.html
  // Depende de js/haptics.js; sem o módulo o alerta tátil continua usando o
  // caminho direto pela Vibration API.
  // ------------------------------------------------------------------
  function bindDeviceAlertUI() {
    const panel = document.getElementById('hapticsPanel');
    if (!panel || !window.NexusHaptics || typeof window.NexusHaptics.bindUI !== 'function') return null;
    try {
      return window.NexusHaptics.bindUI();
    } catch (e) {
      console.warn('[NexusPanic] Falha ao montar o painel de alerta do aparelho:', e);
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Inicialização
  // ------------------------------------------------------------------
  function init() {
    if (initialized) return;
    const session = getSession();
    if (!session) return; // páginas públicas (login/confirmação): módulo inerte
    initialized = true;

    ensureBanner();
    renderBanner();
    subscribeRealtime();
    loadStateFromDb();
    bindWebhookSettingsUI();
    bindDatabaseDiagnosticsUI();
    bindDeviceAlertUI();

    // Retoma/paralisa a vibração ao alternar de aba, sem deixar pulsos presos.
    document.addEventListener('visibilitychange', syncDeviceVibration);

    // Se a tabela estava ausente (404 / PGRST205) e a página volta ao primeiro
    // plano — ou a conexão é restabelecida —, vale a pena tentar de novo: a
    // migração pode ter sido aplicada no Supabase nesse intervalo.
    function rechecarSePendente() {
      const utils = getUtils();
      if (!utils || typeof utils.tabelaIndisponivel !== 'function') return;
      if (!utils.tabelaIndisponivel('emergencias')) return;
      estadoRetryIndex = 0;
      rechecarTabelaEmergencias();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') rechecarSePendente();
    });
    window.addEventListener('online', rechecarSePendente);

    // A primeira interação real libera a ativação persistente do navegador e,
    // se o aparelho só recebeu o SOS via rede, repete o pulso imediatamente.
    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach((eventName) => {
      document.addEventListener(eventName, onUserInteraction, { passive: true, capture: true });
    });

    // Sincronização entre abas do mesmo navegador
    window.addEventListener('storage', (e) => {
      if (e.key !== LS_KEY) return;
      if (e.newValue === 'true' && !state.active) setState({ active: true, origem: 'local' });
      else if (e.newValue === null && state.active) setState({ active: false, emergencia_id: null, motivo: null, acionado_por: null, data_hora: null, origem: null });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública do módulo
  window.NexusPanic = {
    init,
    triggerPanic,
    clearPanic,
    getState: () => Object.assign({}, state),
    isActive: () => Boolean(state.active),
    bindWebhookSettingsUI,
    bindDatabaseDiagnosticsUI,
    bindDeviceAlertUI,
    verificarTabelas,
    diagnose,
    deviceAlertHint,
    CHANNEL_NAME,
    BROADCAST_EVENT,
    FUNCTION_SLUG
  };
})(window);
