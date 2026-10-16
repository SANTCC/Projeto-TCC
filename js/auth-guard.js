/**
 * Guard e Middleware de Autenticação (T1.3) - NexusPort
 * Valida sessão ativa e código individual do operador antes do carregamento das páginas protegidas.
 */

(function (window) {
  'use strict';

  // Aplicação imediata do tema noturno salvo antes do render da página
  try {
    const savedTheme = localStorage.getItem('nexus_theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (savedTheme === 'light') {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}

  // Higienização obrigatória de dados fantasmas (Regra 0.1 do Backlog)
  try {
    if (localStorage.getItem('nexus_ghost_clean_v1') !== 'true') {
      const keysToRemove = [
        'nexus_navios_list',
        'nexus_containers_list',
        'nexus_cargas_fluxo',
        'nexus_vis_list',
        'nexus_func_list',
        'nexus_os_list',
        'nexus_bercos_list',
        'nexus_audit_logs',
        'nexus_trail_decisoes',
        'nexus_guindastes_list'
      ];
      keysToRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('nexus_ghost_clean_v1', 'true');
      localStorage.setItem('nexus_audit_clean_v2', 'true');
    }
    // Tarefa 1: Higienização dedicada de logs_alteracoes e trail_decisoes no localStorage
    // para navegadores que já possuíam nexus_ghost_clean_v1 ativo.
    if (localStorage.getItem('nexus_audit_clean_v2') !== 'true') {
      localStorage.removeItem('nexus_audit_logs');
      localStorage.removeItem('nexus_trail_decisoes');
      localStorage.setItem('nexus_audit_clean_v2', 'true');
    }
  } catch (e) {}

  // Sessão em COOKIES (backlog 3). A gravação/leitura fica em js/session-cookies.js,
  // carregado antes deste arquivo em todas as telas que usam o guard.
  const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // turno operacional de 12h (Backlog 3)

  function sessionCookies() {
    if (!window.NexusSessionCookies) {
      throw new Error('js/session-cookies.js deve ser carregado antes de js/auth-guard.js');
    }
    return window.NexusSessionCookies;
  }

  // Matriz de Ações x Cargos com base no Spec.md RF 1
  const ACTION_PERMISSIONS = {
    // Estivador
    'MOVIMENTAR_CARGA': ['ESTIVADOR', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Conferente de Carga
    'REGISTRAR_RECEBIMENTO': ['CONFERENTE_CARGA', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Arrumador e Consertador
    'ALTERAR_PRONTA_ENTREGA': ['ARRUMADOR_CONSERTADOR', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Planejador de Pátio e Navios
    'ATUALIZAR_DADOS_NAVIO_CONTAINER': ['PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Técnico em Portos
    'CADASTRAR_VISITANTE': ['TECNICO_PORTOS', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_DOCUMENTO_FUNCIONARIO': ['TECNICO_PORTOS', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Inspetor
    'CADASTRAR_NAVIO': ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_CONTAINER': ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_GUINDASTE': ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'INSPECIONAR_CARGA': ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Cadastro de cargas (agendamento em Cargas & Pátio): todos os cargos com
    // acesso à página, EXCETO Arrumador e Consertador — a atribuição desse
    // cargo é apenas marcar a carga como "pronta para entrega" (Spec RF 1;
    // Backlog Parte 2 — Tarefa 6).
    'CADASTRAR_CARGA': ['ESTIVADOR', 'CONFERENTE_CARGA', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    // Emergência pode ser acionada por QUALQUER funcionário autenticado,
    // independente do cargo (botão na sidebar, visível em todas as telas).
    'ACIONAR_EMERGENCIA': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'SUPERVISOR_SUBSTITUTO', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Supervisor / Gerente de Operações
    'LIBERAR_NAVIO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'LIBERAR_CARGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CANCELAR_ENTREGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'SOLICITAR_MANUTENCAO': ['PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'APROVAR_MANUTENCAO': ['ARRUMADOR_CONSERTADOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'DESIGNAR_SUBSTITUTO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'REVOGAR_DELEGACAO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_ROTA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_TIPO_CARGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Diretor (Visão Estratégica)
    'EXPORTAR_HISTORICO': ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'VER_DASHBOARD_ESTRATEGICO': ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO']
  };

  // Matriz de Acesso por Rota/Página (Spec.md RF 1)
  const PAGE_PERMISSIONS = {
    'dashboard.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'cargas.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'inspecao.html': ['CONFERENTE_CARGA', 'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'scanner.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'embarcacoes.html': ['ESTIVADOR', 'PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'manutencao.html': ['ESTIVADOR', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'delegacao.html': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'tecnico_portos.html': ['TECNICO_PORTOS', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'seguranca.html': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'relatorios.html': ['CONFERENTE_CARGA', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO']
  };

  // A elevação operacional não deve apagar a condição de substituto.
  function delegacaoDoSubstituto(session) {
    if (!session) return null;
    try {
      const d = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
      if (!d || d.ativo === false || d.data_revogacao) return null;
      const agora = Date.now();
      const inicio = d.inicio || d.data_inicio;
      const fim = d.fim || d.data_fim_previsto || d.data_fim;
      if ((inicio && !(agora >= Date.parse(inicio))) || (fim && !(agora <= Date.parse(fim)))) return null;
      const subId = d.substitutoId || d.substituto_id;
      const titularId = d.substituidoId || d.supervisor_titular_id || d.referenciaFuncionario?.id;
      if (subId && session.id) return subId !== titularId && subId === session.id ? d : null;
      const matricula = v => String(v || '').trim().toUpperCase().replace(/^MAT-/, '');
      const subMat = matricula(d.substitutoMatricula);
      const titularMat = matricula(d.substituidoMatricula);
      // Registros antigos copiavam a matrícula do titular para o substituto.
      // Essa cópia nunca pode transformar o próprio titular em substituto.
      if (!subMat || subMat === titularMat) return null;
      return subMat === matricula(session.matricula) ? d : null;
    } catch (e) { return null; }
  }

  function perfilSubstituto(session) {
    return !!session && (session.cargo === 'SUPERVISOR_SUBSTITUTO'
      || session.supervisor_substituto === true || session.delegacao_ativa === true
      || /\bsupervisor\s+substitut[oa]\b/i.test(String(session.cargo_nome || ''))
      || !!delegacaoDoSubstituto(session));
  }

  // Tarefa 15: Perfil de Apresentação Somente-Leitura (Espectador / MAT-1111)
  function ehPerfilEspectador(dados) {
    if (!dados || typeof dados !== 'object') return false;
    if (dados.somente_leitura === true || dados.perfil_espectador === true) return true;
    const cargo = String(dados.cargo || '').trim().toUpperCase();
    const cargoNome = String(dados.cargo_nome || '').trim().toUpperCase();
    if (cargo === 'ESPECTADOR' || cargoNome.includes('ESPECTADOR')) return true;
    const nome = String(dados.nome || '').trim().toUpperCase();
    const mat = String(dados.matricula || '').trim().toUpperCase();
    const cod = String(dados.codigo_individual || dados.codigo || '').trim().toUpperCase();
    if (nome === 'ESPECTADOR') return true;
    if ((mat === 'MAT-1111' || cod === 'MAT-1111') && (!nome || nome === 'ESPECTADOR')) return true;
    return false;
  }

  const NexusAuth = {
    /**
     * Obtém a sessão ativa, lida do cookie `nexus_session`. Não há mais leitura de
     * sessionStorage/localStorage: sessões gravadas por versões antigas exigem novo login.
     */
    getSession: function () {
      try {
        const raw = sessionCookies().lerSessao();
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || !session.codigo_individual) {
          sessionCookies().limparSessao();
          return null;
        }

        // Perfil de Apresentação Espectador (MAT-1111): enxerga todo o sistema em camada estratégica,
        // porém com flag estrita somente-leitura para bloquear qualquer mutação.
        if (ehPerfilEspectador(session)) {
          session.somente_leitura = true;
          session.perfil_espectador = true;
          if (!session.cargo || session.cargo === 'ESPECTADOR') {
            session.cargo = 'CONSELHO_ADMINISTRACAO';
          }
          session.cargo_nome = 'Espectador (Somente Leitura)';
          session.nivel = session.nivel || 'Nível Estratégico';
          session.camada_visao = session.camada_visao || 'Visão Estratégica';
          return session;
        }

        // Preserva o perfil derivado, sem alterar o cookie/cargo original.
        if (delegacaoDoSubstituto(session)) {
          session.cargo = 'SUPERVISOR_GERENTE_OPERACOES';
          session.cargo_nome = 'Supervisor Substituto (Delegação Ativa)';
          session.supervisor_substituto = true;
        }

        return session;
      } catch (err) {
        try { sessionCookies().limparSessao(); } catch (e) { /* ignora falha de limpeza */ }
        console.warn('[NexusAuth] Cookie de sessão inválido ou corrompido removido automaticamente:', err);
        return null;
      }
    },

    /**
     * Retorna os dados do usuário logado
     */
    getUser: function () {
      const session = this.getSession();
      return session ? session : null;
    },

    /**
     * Exige autenticação prévia. Se não autenticado, redireciona para a tela de login.
     * @param {Array<string>} [allowedRoles] - Lista opcional de cargos autorizados para a rota.
     */
    requireAuth: function (allowedRoles) {
      const session = this.getSession();

      if (!session) {
        console.warn('[NexusAuth] Acesso negado: Sessão não encontrada ou expirada.');
        window.location.href = 'index.html';
        return null;
      }

      if (ehPerfilEspectador(session)) {
        return session;
      }

      const pageName = window.location.pathname.split('/').pop() || 'dashboard.html';
      if (pageName === 'delegacao.html' && perfilSubstituto(session)) {
        window.location.href = 'dashboard.html';
        return null;
      }
      if (['ESTIVADOR', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS'].includes(session.cargo) && !this.canAccessPage(pageName)) {
        window.location.href = 'dashboard.html';
        return null;
      }
      const effectiveAllowed = allowedRoles || PAGE_PERMISSIONS[pageName];

      // Se cargos específicos foram informados ou mapeados para a rota, valida se o cargo do usuário possui permissão
      if (effectiveAllowed && Array.isArray(effectiveAllowed) && effectiveAllowed.length > 0) {
        if (!effectiveAllowed.includes(session.cargo)) {
          console.warn(`[NexusAuth] Acesso restrito: Cargo ${session.cargo} não autorizado para a rota ${pageName}.`);
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Acesso Restrito', `Seu cargo (${session.cargo_nome || session.cargo}) não tem permissão para acessar esta página (${pageName}).`);
          }
          window.location.href = 'dashboard.html';
          return null;
        }
      }

      return session;
    },

    /**
     * Informa, sem redirecionar, se o cargo da sessão pode abrir a página (mesma regra de requireAuth).
     * Usado pelas ferramentas WebMCP (js/webmcp/webmcp-core.js) para o mesmo controle de acesso das páginas.
     * @param {string} pageName - Nome do arquivo HTML (ex.: 'cargas.html')
     * @returns {boolean}
     */
    canAccessPage: function (pageName) {
      const session = this.getSession();
      if (!session || !session.cargo) return false;
      if (ehPerfilEspectador(session)) return true;
      if (pageName === 'delegacao.html' && perfilSubstituto(session)) return false;
      if (session.cargo === 'ESTIVADOR') {
        return ['dashboard.html', 'embarcacoes.html', 'manutencao.html', 'cargas.html', 'scanner.html'].includes(pageName);
      }
      if (session.cargo === 'ARRUMADOR_CONSERTADOR') {
        return ['dashboard.html', 'cargas.html', 'manutencao.html'].includes(pageName);
      }
      if (session.cargo === 'PLANEJADOR_PATIO_NAVIOS') {
        return ['dashboard.html', 'embarcacoes.html', 'manutencao.html'].includes(pageName);
      }
      const allowed = PAGE_PERMISSIONS[pageName];
      if (!allowed || !Array.isArray(allowed) || allowed.length === 0) return true;
      return allowed.includes(session.cargo);
    },

    /** Identifica o perfil explícito ou derivado, mesmo com cargo operacional elevado. */
    isSupervisorSubstituto: function (session) {
      return perfilSubstituto(session || this.getSession());
    },

    /** Identifica se a sessão pertence ao perfil somente-leitura de apresentação (Espectador / MAT-1111). */
    isReadOnly: function (session) {
      return ehPerfilEspectador(session || this.getSession());
    },

    isEspectador: function (session) {
      return ehPerfilEspectador(session || this.getSession());
    },

    /** Verifica a ação RBAC, incluindo a negativa de administrar delegações e o bloqueio de escrita para Espectador. */
    hasPermission: function (actionKey) {
      const session = this.getSession();
      if (!session || !session.cargo) return false;

      if (ehPerfilEspectador(session)) {
        return actionKey === 'VER_DASHBOARD_ESTRATEGICO';
      }

      if (['DESIGNAR_SUBSTITUTO', 'REVOGAR_DELEGACAO'].includes(actionKey) && perfilSubstituto(session)) return false;
      const allowedRoles = ACTION_PERMISSIONS[actionKey];
      if (!allowedRoles) {
        console.warn(`[NexusAuth] Ação não mapeada na matriz RBAC: ${actionKey}`);
        return false;
      }

      // Validação direta do cargo
      if (allowedRoles.includes(session.cargo)) return true;

      const temDelegacaoAtiva = !!delegacaoDoSubstituto(session);

      if (temDelegacaoAtiva) {
        if (allowedRoles.includes('SUPERVISOR_SUBSTITUTO') || allowedRoles.includes('SUPERVISOR_GERENTE_OPERACOES')) {
          return true;
        }
      }

      return false;
    },

    /**
     * Estabelece a sessão ativa após a confirmação do cargo (T1.2/T1.3).
     * Grava somente em cookie (js/session-cookies.js) e apaga cópias legadas.
     */
    establishSession: function (sessionData) {
      sessionCookies().gravarSessao(sessionData);
    },

    /**
     * Encerra a sessão ativa do usuário e redireciona para o login
     */
    logout: function () {
      if (window.NexusOnlinePresence) window.NexusOnlinePresence.parar();
      sessionCookies().limparSessao();
      window.location.href = 'index.html';
    }
  };

  window.NexusAuth = NexusAuth;

  /**
   * Vigia de expiração da sessão (Backlog 3): se o cookie expirar enquanto
   * o usuário navega — ou se o carimbo `login_at` ultrapassar o turno de
   * 12h — a sessão é invalidada e o operador é redirecionado para o login.
   * A verificação periódica é necessária porque páginas já abertas não
   * recarregam o cookie sozinhas.
   */
  function sessionExpired(session) {
    if (!session) return true;
    if (session.login_at) {
      const loginTs = Date.parse(session.login_at);
      if (!Number.isNaN(loginTs) && Date.now() - loginTs > SESSION_COOKIE_MAX_AGE_SECONDS * 1000) {
        return true;
      }
    }
    return false;
  }

  setInterval(() => {
    try {
      const session = NexusAuth.getSession();
      if (!sessionExpired(session)) return;
      const pageName = (window.location && window.location.pathname.split('/').pop()) || '';
      if (pageName && pageName !== 'index.html' && pageName !== '' && pageName !== 'confirm-role.html') {
        console.warn('[NexusAuth] Sessão expirada em uso. Redirecionando para login.');
        NexusAuth.logout();
      }
    } catch (e) {}
  }, 60000);
})(window);
