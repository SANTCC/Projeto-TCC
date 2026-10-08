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
    }
  } catch (e) {}

  const SESSION_KEY = 'nexus_session';

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
    'ACIONAR_EMERGENCIA': ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Supervisor / Gerente de Operações
    'LIBERAR_NAVIO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'LIBERAR_CARGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CANCELAR_ENTREGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'SOLICITAR_MANUTENCAO': ['SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'APROVAR_MANUTENCAO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'DESIGNAR_SUBSTITUTO': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_ROTA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'CADASTRAR_TIPO_CARGA': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],

    // Diretor (Visão Estratégica)
    'EXPORTAR_HISTORICO': ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'VER_DASHBOARD_ESTRATEGICO': ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO']
  };

  // Matriz de Acesso por Rota/Página (Spec.md RF 1)
  const PAGE_PERMISSIONS = {
    'dashboard.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'cargas.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'inspecao.html': ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'scanner.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'embarcacoes.html': ['PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'manutencao.html': ['SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'delegacao.html': ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'tecnico_portos.html': ['TECNICO_PORTOS', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    'relatorios.html': ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO']
  };

  const NexusAuth = {
    /**
     * Obtém a sessão ativa armazenada no sessionStorage ou localStorage
     */
    getSession: function () {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || !session.codigo_individual) return null;

        // A8 & SPEC 14: Elevação temporária do cargo para Supervisor em caso de delegação ativa
        const activeDelegRaw = localStorage.getItem('nexus_active_delegation');
        if (activeDelegRaw) {
          try {
            const activeDeleg = JSON.parse(activeDelegRaw);
            if (activeDeleg && activeDeleg.substitutoMatricula) {
              const subMat = String(activeDeleg.substitutoMatricula).toUpperCase();
              const userMat = String(session.matricula || '').toUpperCase();
              if (subMat === userMat || subMat === `MAT-${userMat}`) {
                session.cargo = 'SUPERVISOR_GERENTE_OPERACOES';
                session.cargo_nome = 'Supervisor Substituto (Delegação Ativa)';
              }
            }
          } catch (e) {}
        }

        return session;
      } catch (err) {
        console.error('[NexusAuth] Erro ao ler sessão:', err);
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

      const pageName = window.location.pathname.split('/').pop() || 'dashboard.html';
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
     * Usado pelas ferramentas WebMCP (js/webmcp-core.js) para o mesmo controle de acesso das páginas.
     * @param {string} pageName - Nome do arquivo HTML (ex.: 'cargas.html')
     * @returns {boolean}
     */
    canAccessPage: function (pageName) {
      const session = this.getSession();
      if (!session || !session.cargo) return false;
      const allowed = PAGE_PERMISSIONS[pageName];
      if (!allowed || !Array.isArray(allowed) || allowed.length === 0) return true;
      return allowed.includes(session.cargo);
    },

    /**
     * Verifica se o usuário autenticado possui permissão para executar determinada ação (RBAC T1.7)
     * @param {string} actionKey - Identificador da ação (ex: 'LIBERAR_NAVIO')
     * @returns {boolean}
     */
    hasPermission: function (actionKey) {
      const session = this.getSession();
      if (!session || !session.cargo) return false;

      const allowedRoles = ACTION_PERMISSIONS[actionKey];
      if (!allowedRoles) {
        console.warn(`[NexusAuth] Ação não mapeada na matriz RBAC: ${actionKey}`);
        return false;
      }

      return allowedRoles.includes(session.cargo);
    },

    /**
     * Encerra a sessão ativa do usuário e redireciona para o login
     */
    logout: function () {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem('nexus_pending_auth');
      window.location.href = 'index.html';
    }
  };

  window.NexusAuth = NexusAuth;
})(window);
