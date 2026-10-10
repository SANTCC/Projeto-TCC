/**
 * Nº de usuários on-line no momento (Backlog 3, item E).
 *
 * Usa o Supabase Realtime Presence no canal `nexus-online`. Cada aba entra no canal com a chave
 * `codigo_individual`, então um mesmo código conta uma única vez, mesmo com várias abas ou aparelhos.
 * O payload não leva nome nem matrícula: só o instante de entrada.
 *
 * Regras:
 * - O número é lido na primeira sincronização do canal e depois atualizado a cada 30 s.
 * - Sem Supabase configurado, sem código de sessão ou sem canal sincronizado, mostra "—".
 *   Nunca exibe um número estimado ou fictício.
 *
 * Expõe `window.NexusOnlinePresence`. O layout (js/layout.js) cria o indicador `#headerOnlineCount`
 * no cabeçalho e chama `iniciar` com o código da sessão.
 */
(function (window) {
  'use strict';

  const CANAL = 'nexus-online';
  const INTERVALO_MS = 30 * 1000;
  const SEM_CONTAGEM = '—';
  const ESTADOS_SEM_CANAL = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'];

  const estado = {
    canal: null,
    cliente: null,
    timer: null,
    cancelarTimer: null,
    sincronizado: false,
    primeiraLeitura: false
  };

  /** Conta chaves distintas (um código de funcionário = um usuário on-line). */
  function contarUsuarios(presenceState) {
    if (!presenceState || typeof presenceState !== 'object') return 0;
    return Object.keys(presenceState).filter((chave) => {
      const metas = presenceState[chave];
      return Array.isArray(metas) ? metas.length > 0 : Boolean(metas);
    }).length;
  }

  function elementos() {
    const doc = window.document;
    return {
      valor: doc && doc.getElementById('headerOnlineCount'),
      caixa: doc && doc.getElementById('headerOnline')
    };
  }

  function renderizar(texto, descricao) {
    const el = elementos();
    if (el.valor) el.valor.textContent = texto;
    if (el.caixa) {
      el.caixa.setAttribute('title', descricao);
      el.caixa.setAttribute('data-estado', texto === SEM_CONTAGEM ? 'indisponivel' : 'sincronizado');
    }
  }

  function atualizar() {
    if (!estado.canal || !estado.sincronizado) {
      renderizar(SEM_CONTAGEM, 'Contagem de usuários on-line indisponível (sem conexão em tempo real).');
      return;
    }
    const total = contarUsuarios(estado.canal.presenceState());
    renderizar(String(total), `${total} usuário(s) on-line. Atualizado a cada 30 s.`);
  }

  function pararTimer() {
    if (estado.timer !== null && estado.cancelarTimer) estado.cancelarTimer(estado.timer);
    estado.timer = null;
  }

  /**
   * Inicia a presença do usuário. Retorna true quando o canal foi criado.
   * Opções (para testes): cliente, agendar(fn, ms), cancelar(id).
   */
  function iniciar(opcoes) {
    const o = opcoes || {};
    if (estado.canal) parar();
    const codigo = typeof o.codigo === 'string' ? o.codigo.trim() : '';
    const cliente = o.cliente !== undefined ? o.cliente : window.nexusSupabase;
    estado.cliente = cliente || null;

    if (!codigo || !cliente || typeof cliente.channel !== 'function') {
      renderizar(SEM_CONTAGEM, 'Contagem indisponível: sem conexão com o Supabase.');
      return false;
    }

    const agendar = o.agendar || ((fn, ms) => window.setInterval(fn, ms));
    const cancelar = o.cancelar || ((id) => window.clearInterval(id));
    estado.cancelarTimer = cancelar;

    const canal = cliente.channel(CANAL, { config: { presence: { key: codigo } } });
    estado.canal = canal;
    estado.sincronizado = false;
    estado.primeiraLeitura = false;

    canal.on('presence', { event: 'sync' }, () => {
      estado.sincronizado = true;
      // Primeira leitura imediata; depois, só no intervalo de 30 s.
      if (!estado.primeiraLeitura) {
        estado.primeiraLeitura = true;
        atualizar();
      }
    });

    canal.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        canal.track({ online_at: new Date().toISOString() });
      } else if (ESTADOS_SEM_CANAL.indexOf(status) !== -1) {
        estado.sincronizado = false;
        estado.primeiraLeitura = false;
        atualizar();
      }
    });

    estado.timer = agendar(atualizar, o.intervaloMs || INTERVALO_MS);

    // Ao sair da página, o canal é encerrado (a presença some na hora, não só por timeout).
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', parar, { once: true });
    }
    return true;
  }

  /** Sai do canal e interrompe a atualização (troca de página ou logout). */
  function parar() {
    pararTimer();
    const canal = estado.canal;
    estado.canal = null;
    estado.sincronizado = false;
    estado.primeiraLeitura = false;
    if (canal) {
      try {
        if (typeof canal.untrack === 'function') canal.untrack();
      } catch (e) { /* canal já encerrado */ }
      if (estado.cliente && typeof estado.cliente.removeChannel === 'function') {
        try {
          estado.cliente.removeChannel(canal);
        } catch (e) { /* canal já encerrado */ }
      }
    }
  }

  window.NexusOnlinePresence = {
    CANAL,
    INTERVALO_MS,
    SEM_CONTAGEM,
    iniciar,
    parar,
    atualizar,
    contarUsuarios
  };
})(window);
