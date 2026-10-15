/**
 * Presença compartilhada em todas as páginas com cabeçalho.
 * Cada codigo_individual conta uma vez, mesmo em várias abas/aparelhos.
 * Só transmite online_at, sem nome nem matrícula. Cada sync atualiza o número
 * imediatamente; o intervalo de 30 s é apenas reconciliação/recuperação.
 * Sem conexão ou sincronização confirmada, mostra "—", nunca uma estimativa.
 */
(function (window) {
  'use strict';

  const CANAL = 'nexus-online';
  const INTERVALO_MS = 30 * 1000;
  const SEM_CONTAGEM = '—';
  const ESTADOS_SEM_CANAL = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'];
  const estado = {
    canal: null, cliente: null, timer: null, cancelarTimer: null,
    sincronizado: false, falhou: false, opcoes: null,
    offline: false, suspenso: false
  };

  function contarUsuarios(presenceState) {
    if (!presenceState || typeof presenceState !== 'object') return 0;
    return Object.keys(presenceState).filter((chave) => {
      const metas = presenceState[chave];
      return Array.isArray(metas) ? metas.length > 0 : Boolean(metas);
    }).length;
  }

  function renderizar(texto, descricao) {
    const doc = window.document;
    const valor = doc && doc.getElementById('headerOnlineCount');
    const caixa = doc && doc.getElementById('headerOnline');
    if (valor) valor.textContent = texto;
    if (caixa) {
      caixa.setAttribute('title', descricao);
      caixa.setAttribute('data-estado', texto === SEM_CONTAGEM ? 'indisponivel' : 'sincronizado');
    }
  }

  function atualizar() {
    if (!estado.canal || !estado.sincronizado || estado.offline || estado.suspenso) {
      renderizar(SEM_CONTAGEM, 'Contagem de usuários on-line indisponível (sem sincronização em tempo real).');
      return;
    }
    const total = contarUsuarios(estado.canal.presenceState());
    renderizar(String(total), `${total} usuário(s) on-line. Atualizado em tempo real.`);
  }

  // O SDK retorna promessas: erros de limpeza não podem gerar rejeições soltas.
  function limpar(acao) {
    try { Promise.resolve(acao()).catch(() => {}); } catch (e) { /* canal já encerrado */ }
  }

  function encerrarCanal() {
    if (estado.timer !== null && estado.cancelarTimer) estado.cancelarTimer(estado.timer);
    estado.timer = null;
    const canal = estado.canal;
    const cliente = estado.cliente;
    // Invalida callbacks ANTES de untrack/removeChannel (inclusive callbacks síncronos).
    estado.canal = null;
    estado.sincronizado = false;
    estado.falhou = false;
    if (canal) {
      if (typeof canal.untrack === 'function') limpar(() => canal.untrack());
      if (cliente && typeof cliente.removeChannel === 'function') limpar(() => cliente.removeChannel(canal));
    }
    atualizar();
  }

  /** Inicia uma única inscrição. Opções de temporização também permitem testes sem rede. */
  function iniciar(opcoes) {
    const o = opcoes || {};
    const codigo = typeof o.codigo === 'string' ? o.codigo.trim() : '';
    const cliente = o.cliente !== undefined ? o.cliente : window.nexusSupabase;
    if (estado.canal && estado.opcoes && estado.opcoes.codigo === codigo && estado.cliente === cliente) {
      atualizar();
      return true;
    }
    encerrarCanal();
    estado.opcoes = null;
    if (!codigo || !cliente || typeof cliente.channel !== 'function') return false;
    estado.opcoes = Object.assign({}, o, { codigo: codigo, cliente: cliente });
    estado.cliente = cliente;
    if (estado.offline || estado.suspenso || window.navigator.onLine === false) return false;

    const agendar = o.agendar || ((fn, ms) => window.setInterval(fn, ms));
    estado.cancelarTimer = o.cancelar || ((id) => window.clearInterval(id));
    try {
      const canal = cliente.channel(CANAL, { config: { presence: { key: codigo } } });
      estado.canal = canal;
      let inscrito = false;
      let tentativa = 0;
      let falhaTrack = false;
      const atual = () => estado.canal === canal && !estado.offline && !estado.suspenso;
      canal.on('presence', { event: 'sync' }, () => {
        if (!atual() || !inscrito || falhaTrack) return;
        estado.sincronizado = true;
        estado.falhou = false;
        atualizar();
      });
      canal.subscribe((status) => {
        if (!atual()) return;
        if (status === 'SUBSCRIBED') {
          inscrito = true;
          falhaTrack = false;
          estado.sincronizado = false;
          estado.falhou = false;
          const minhaTentativa = ++tentativa;
          atualizar();
          const falhar = () => {
            if (!atual() || tentativa !== minhaTentativa) return;
            falhaTrack = true;
            estado.falhou = true;
            estado.sincronizado = false;
            atualizar();
          };
          try {
            Promise.resolve(canal.track({ online_at: new Date().toISOString() }))
              .then(resultado => { if (resultado && resultado !== 'ok') falhar(); }, falhar);
          } catch (e) { falhar(); }
        } else if (ESTADOS_SEM_CANAL.indexOf(status) !== -1) {
          inscrito = false;
          tentativa++;
          estado.sincronizado = false;
          estado.falhou = true;
          atualizar();
        }
      });
      estado.timer = agendar(() => {
        if (!atual()) return;
        if (estado.falhou) recuperar();
        else atualizar();
      }, o.intervaloMs || INTERVALO_MS);
      return true;
    } catch (e) {
      encerrarCanal();
      return false;
    }
  }

  /** Parada definitiva (logout): eventos futuros não podem reativar esta sessão. */
  function parar() {
    estado.opcoes = null;
    encerrarCanal();
  }

  function recuperar() {
    if (!estado.opcoes || estado.offline || estado.suspenso) return;
    // Uma página restaurada do cache não pode anunciar uma sessão encerrada/alterada.
    if (window.NexusAuth && typeof window.NexusAuth.getSession === 'function') {
      const sessao = window.NexusAuth.getSession();
      if (!sessao || String(sessao.codigo_individual || '').trim() !== estado.opcoes.codigo) {
        parar();
        return;
      }
    }
    if (estado.canal && !estado.falhou) { atualizar(); return; }
    const opcoes = estado.opcoes;
    encerrarCanal();
    iniciar(opcoes);
  }

  // Listeners únicos, não acumulados a cada iniciar/reconectar.
  window.addEventListener('offline', () => {
    estado.offline = true;
    encerrarCanal();
  });
  window.addEventListener('online', () => { estado.offline = false; recuperar(); });
  window.addEventListener('pagehide', (event) => {
    estado.suspenso = true;
    if (event.persisted) encerrarCanal();
    else parar();
  });
  window.addEventListener('pageshow', (event) => {
    estado.suspenso = false;
    if (event.persisted) recuperar();
  });
  window.addEventListener('focus', recuperar);
  window.document.addEventListener('visibilitychange', () => {
    if (window.document.visibilityState === 'visible') recuperar();
  });

  window.NexusOnlinePresence = { CANAL, INTERVALO_MS, SEM_CONTAGEM, iniciar, parar, atualizar, contarUsuarios };
})(window);
