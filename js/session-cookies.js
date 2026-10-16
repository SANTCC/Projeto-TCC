/**
 * Armazenamento de sessão em COOKIES — NexusPort (backlog 3: "Salvar o login com Cookies
 * ao invés de SESSION_STORAGE").
 *
 * Único ponto de leitura/gravação dos cookies de sessão. Usado por:
 *   - js/auth-guard.js          → sessão ativa (`nexus_session`, turno de 12 h);
 *   - js/login.js               → identificação pendente até a confirmação do cargo
 *                                 (`nexus_pending_auth`, 10 min). index.html não carrega o guard,
 *                                 por isso a pendência fica aqui, no módulo comum;
 *   - js/pages/confirm-role.js  → lê a pendência e a converte na sessão.
 *
 * Nenhum dado de sessão é gravado em sessionStorage/localStorage. Atributos dos cookies:
 *   path=/ · SameSite=Lax (navegação entre as telas) · Secure quando servido por HTTPS.
 * Cookies gravados por JavaScript não podem ser HttpOnly; a proteção contra XSS é a
 * codificação de saída (js/security.js), a mesma usada para o armazenamento local anterior.
 */
(function (window) {
  'use strict';

  const CHAVE_SESSAO = 'nexus_session';
  const CHAVE_PENDENCIA = 'nexus_pending_auth';
  const TURNO_SEGUNDOS = 12 * 60 * 60;
  const PENDENCIA_SEGUNDOS = 10 * 60;
  const LIMITE_SEGURO_COOKIE_BYTES = 3800;

  // Cópias deixadas por versões anteriores (sessionStorage e localStorage). São removidas
  // ao entrar e ao sair, para que nenhuma cópia antiga continue valendo.
  const CHAVES_LEGADAS = [
    ['sessionStorage', CHAVE_SESSAO],
    ['sessionStorage', CHAVE_PENDENCIA],
    ['localStorage', CHAVE_SESSAO]
  ];

  function atributos(maxAgeSegundos) {
    const partes = ['path=/', 'SameSite=Lax', `max-age=${maxAgeSegundos}`];
    if (window.location && window.location.protocol === 'https:') partes.push('Secure');
    return partes.join('; ');
  }

  function compactarDadosSessao(dados) {
    if (!dados || typeof dados !== 'object') return {};
    const camposPermitidos = [
      'id', 'matricula', 'codigo_individual', 'codigo', 'nome',
      'cargo', 'cargo_nome', 'nivel', 'camada_visao', 'nivel_visao', 'status', 'ativo',
      'login_at', 'supervisor_substituto', 'delegacao_ativa',
      'somente_leitura', 'perfil_espectador'
    ];
    const compacto = {};
    camposPermitidos.forEach((campo) => {
      if (dados[campo] !== undefined) {
        compacto[campo] = typeof dados[campo] === 'string' && dados[campo].length > 160
          ? dados[campo].slice(0, 160)
          : dados[campo];
      }
    });
    return compacto;
  }

  function gravar(nome, valor, maxAgeSegundos) {
    try {
      const codificado = encodeURIComponent(String(valor));
      const linhaCookie = `${nome}=${codificado}; ${atributos(maxAgeSegundos)}`;
      document.cookie = linhaCookie;
      return true;
    } catch (e) {
      console.warn('[NexusSessionCookies] Não foi possível gravar o cookie', nome, e);
      return false;
    }
  }

  function ler(nome) {
    try {
      const prefixo = `${nome}=`;
      const partes = (document.cookie || '').split(';');
      for (let i = 0; i < partes.length; i++) {
        const trecho = partes[i].trim();
        if (trecho.indexOf(prefixo) === 0) {
          return decodeURIComponent(trecho.substring(prefixo.length));
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function remover(nome) {
    try {
      document.cookie = `${nome}=; ${atributos(0)}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    } catch (e) { /* ambiente sem document.cookie: nada a remover */ }
  }

  const NexusSessionCookies = {
    /** Duração de uma sessão operacional (12 h). */
    TURNO_SEGUNDOS: TURNO_SEGUNDOS,
    /** Validade da identificação aguardando a confirmação do cargo (10 min). */
    PENDENCIA_SEGUNDOS: PENDENCIA_SEGUNDOS,
    /** Limite seguro em bytes para evitar descarte silencioso do cookie (> 4 KB). */
    LIMITE_SEGURO_COOKIE_BYTES: LIMITE_SEGURO_COOKIE_BYTES,

    /** Texto bruto do cookie da sessão (JSON) ou null. */
    lerSessao: function () {
      return ler(CHAVE_SESSAO);
    },

    /** Grava a sessão ativa (objeto serializado em JSON) e limpa cópias legadas. */
    gravarSessao: function (dadosSessao) {
      if (!dadosSessao || typeof dadosSessao !== 'object') return false;
      let json = JSON.stringify(dadosSessao);
      if (encodeURIComponent(json).length > LIMITE_SEGURO_COOKIE_BYTES) {
        json = JSON.stringify(compactarDadosSessao(dadosSessao));
      }
      let ok = gravar(CHAVE_SESSAO, json, TURNO_SEGUNDOS);
      if (ok && ler(CHAVE_SESSAO) === null) {
        const jsonCompacto = JSON.stringify(compactarDadosSessao(dadosSessao));
        if (jsonCompacto !== json) {
          ok = gravar(CHAVE_SESSAO, jsonCompacto, TURNO_SEGUNDOS);
        }
      }
      remover(CHAVE_PENDENCIA);
      NexusSessionCookies.limparLegado();
      return ok;
    },

    /** Encerra a sessão: remove o cookie e as cópias legadas. */
    limparSessao: function () {
      remover(CHAVE_SESSAO);
      remover(CHAVE_PENDENCIA);
      NexusSessionCookies.limparLegado();
    },

    /**
     * Guarda a identificação até a confirmação do cargo. Minimização: só o necessário para
     * a tela de confirmação (sem e-mail, telefone ou demais campos do cadastro).
     */
    gravarPendencia: function (identificacao) {
      const minimo = {
        id: identificacao.id || null,
        matricula: identificacao.matricula || null,
        codigo_individual: identificacao.codigo_individual || identificacao.codigo || null,
        nome: identificacao.nome || null,
        cargo: identificacao.cargo || null
      };
      return gravar(CHAVE_PENDENCIA, JSON.stringify(minimo), PENDENCIA_SEGUNDOS);
    },

    /** Identificação pendente (objeto) ou null. */
    lerPendencia: function () {
      try {
        const bruto = ler(CHAVE_PENDENCIA);
        return bruto ? JSON.parse(bruto) : null;
      } catch (e) {
        remover(CHAVE_PENDENCIA);
        return null;
      }
    },

    limparPendencia: function () {
      remover(CHAVE_PENDENCIA);
    },

    /** Remove as cópias da sessão que versões anteriores gravavam no armazenamento do navegador. */
    limparLegado: function () {
      CHAVES_LEGADAS.forEach(([area, chave]) => {
        try { window[area].removeItem(chave); } catch (e) { /* armazenamento indisponível */ }
      });
    }
  };

  window.NexusSessionCookies = NexusSessionCookies;
})(window);
