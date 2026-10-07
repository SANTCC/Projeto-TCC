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
  const HAPTIC_PULSE_MS = 180;
  const HAPTIC_INTERVAL_MS = 3000;

  // ------------------------------------------------------------------
  // Utilitários
  // ------------------------------------------------------------------
  function getSession() {
    return window.currentUserSession || (window.NexusAuth ? window.NexusAuth.getSession() : null);
  }

  function getSupabase() {
    return window.nexusSupabase || null;
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

  function stopDeviceVibration() {
    if (hapticTimer !== null) {
      window.clearTimeout(hapticTimer);
      hapticTimer = null;
      try {
        if (window.navigator && typeof window.navigator.vibrate === 'function') {
          window.navigator.vibrate(0);
        }
      } catch (e) { /* vibração indisponível neste navegador */ }
    }
  }

  function syncDeviceVibration() {
    const nav = window.navigator;
    const prefersReducedMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!state.active || document.hidden || prefersReducedMotion || !nav || typeof nav.vibrate !== 'function') {
      stopDeviceVibration();
      return;
    }
    if (hapticTimer !== null) return;

    const pulse = () => {
      hapticTimer = null;
      const reducedMotion = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!state.active || document.hidden || reducedMotion) {
        stopDeviceVibration();
        return;
      }
      try {
        nav.vibrate(HAPTIC_PULSE_MS);
        hapticTimer = window.setTimeout(pulse, HAPTIC_INTERVAL_MS);
      } catch (e) {
        stopDeviceVibration();
      }
    };
    pulse();
  }

  function renderBanner() {
    const el = ensureBanner();
    if (!el) return;
    const detail = el.querySelector('#nexusPanicFooterDetail');
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

    // Every connected page gets the same animated SOS cue. On devices that
    // support the Vibration API, add a short haptic pulse while the alert is active.
    el.classList.toggle('nexus-panic-vibrating', Boolean(state.active));
    const panicButton = document.getElementById('panicButton');
    if (panicButton) panicButton.classList.toggle('nexus-panic-vibrating', Boolean(state.active));
    syncDeviceVibration();
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
  async function loadStateFromDb() {
    const sb = getSupabase();
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
      } catch (e) {
        console.warn('[NexusPanic] Falha ao ler emergencias do Supabase:', e);
      }
    }

    // Fallback sem Supabase/tabela: respeita o flag local legado
    if (localStorage.getItem(LS_KEY) === 'true') {
      setState({ active: true, origem: 'local' });
    }
  }

  // ------------------------------------------------------------------
  // Persistência local (fallback quando a Edge Function está indisponível)
  // ------------------------------------------------------------------
  async function persistEmergencyLocal(identity, motivo, dataHora) {
    const sb = getSupabase();
    if (!sb) return null;
    const session = getSession() || {};
    try {
      const { data } = await sb.from('emergencias').insert({
        estado: 'ATIVA',
        motivo: motivo || `Emergência crítica declarada no Terminal ${TERMINAL}.`,
        funcionario_id: isUuid(session.id) ? session.id : null,
        acionado_por_nome: identity.nome,
        acionado_por_cargo: CARGOS_VALIDOS.includes(identity.cargo) ? identity.cargo : null,
        acionado_por_codigo: identity.codigo_individual,
        data_hora: dataHora,
        origem: 'CLIENT_FALLBACK'
      }).select().maybeSingle();
      return data && data.id ? data.id : null;
    } catch (e) {
      console.warn('[NexusPanic] Fallback: falha ao persistir emergencia:', e);
      return null;
    }
  }

  async function resolveEmergencyLocal(identity) {
    const sb = getSupabase();
    if (!sb) return state.emergencia_id;
    try {
      const { data: ativa } = await sb
        .from('emergencias')
        .select('*')
        .eq('estado', 'ATIVA')
        .order('data_hora', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ativa && ativa.id) {
        await sb.from('emergencias').update({
          estado: 'RESOLVIDA',
          resolvido_por_nome: identity.nome,
          resolvido_por_cargo: CARGOS_VALIDOS.includes(identity.cargo) ? identity.cargo : null,
          data_resolucao: new Date().toISOString()
        }).eq('id', ativa.id);
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
  async function registrarAuditoria(estadoAudit, detalhes) {
    const sb = getSupabase();
    const session = getSession() || {};
    if (!sb) return;
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
      await sb.from('logs_alteracoes').insert(payload);
    } catch (e) {
      console.warn('[NexusPanic] Falha ao registrar auditoria do pânico:', e);
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
      registrarAuditoria(
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
      const fallbackNote = via === 'client_fallback'
        ? ' (Edge Function indisponível — broadcast direto via WebSocket; webhook não disparado)'
        : '';
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
          `Alarme global enviado a todos os clientes conectados via WebSocket. Operações do pátio ${TERMINAL} bloqueadas temporariamente.${webhookNote}${fallbackNote}`
        );
      } else {
        feedback(
          'sucesso',
          'Emergência Desativada',
          `Alarme de emergência desativado em todos os clientes conectados. Operações normalizadas.${fallbackNote}`
        );
      }

      return { ok: true, via, webhook, emergencia_id: emergenciaId };
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

    const motivo = typeof options.motivo === 'string' && options.motivo.trim() ? options.motivo.trim() : null;
    const identity = buildIdentity();
    return await executePanicAction('activate', {
      action: 'activate',
      motivo,
      acionado_por: identity,
      terminal: TERMINAL
    }, identity, motivo);
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

    // Retoma/paralisa a vibração ao alternar de aba, sem deixar pulsos presos.
    document.addEventListener('visibilitychange', syncDeviceVibration);

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
    CHANNEL_NAME,
    BROADCAST_EVENT,
    FUNCTION_SLUG
  };
})(window);
