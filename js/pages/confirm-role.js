/**
 * Lógica de Confirmação de Cargo (T1.2) - NexusPort
 * Carrega automaticamente o cargo do funcionário resolvido pela autenticação,
 * exibe os detalhes para confirmação (sem permitir edição manual conforme RF 1)
 * e estabelece a sessão do usuário.
 */

/**
 * Persistência da sessão usada quando o auth-guard não está carregado nesta página.
 * Grava o mesmo cookie do guard (js/session-cookies.js) e apaga a pendência.
 */
function setSessionAndRedirectFallback(sessionData) {
  if (window.NexusSessionCookies) {
    window.NexusSessionCookies.gravarSessao(sessionData);
    window.NexusSessionCookies.limparPendencia();
  } else {
    console.warn('[ConfirmRole] js/session-cookies.js ausente: sessão não persistida.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM
  const themeToggle = document.getElementById('themeToggle');
  const themeToggleIcon = document.getElementById('themeToggleIcon');

  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userMatricula = document.getElementById('userMatricula');
  const userCodigo = document.getElementById('userCodigo');

  const roleBadgeIcon = document.getElementById('roleBadgeIcon');
  const roleTitle = document.getElementById('roleTitle');
  const roleLevelBadge = document.getElementById('roleLevelBadge');

  const visionTitle = document.getElementById('visionTitle');
  const visionDescription = document.getElementById('visionDescription');

  const confirmRoleBtn = document.getElementById('confirmRoleBtn');

  // Mapeamento dos cargos para exibição, sigla, nível de acesso e camada de visão (Spec.md RF 1)
  const roleMetadata = {
    'ESTIVADOR': {
      nome: 'Estivador',
      sigla: 'EST',
      nivel: 'Nível Operacional',
      camada: 'Visão Própria',
      descricaoVisao: 'Acesso restrito às cargas selecionadas para movimentação e histórico individual de operações no pátio.'
    },
    'CONFERENTE_CARGA': {
      nome: 'Conferente de Carga',
      sigla: 'CONF',
      nivel: 'Nível Operacional',
      camada: 'Visão Própria',
      descricaoVisao: 'Acesso aos registros de recebimento físico e estado das mercadorias na chegada e saída do porto.'
    },
    'ARRUMADOR_CONSERTADOR': {
      nome: 'Arrumador e Consertador',
      sigla: 'ARR',
      nivel: 'Nível Operacional',
      camada: 'Visão Própria',
      descricaoVisao: 'Acesso para organização, acondicionamento e atualização do status para "pronta para entrega".'
    },
    'PLANEJADOR_PATIO_NAVIOS': {
      nome: 'Planejador de Pátio e de Navios',
      sigla: 'PLAN',
      nivel: 'Nível Operacional',
      camada: 'Visão Própria',
      descricaoVisao: 'Acesso ao registro e atualização do estado e informações operacionais de contêineres e navios.'
    },
    'TECNICO_PORTOS': {
      nome: 'Técnico em Portos',
      sigla: 'TEC',
      nivel: 'Nível Operacional',
      camada: 'Visão Própria',
      descricaoVisao: 'Acesso ao cadastro de documentação interna de funcionários e registro de visitantes temporários.'
    },
    'SUPERVISOR_GERENTE_OPERACOES': {
      nome: 'Supervisor / Gerente de Operações',
      sigla: 'SUP',
      nivel: 'Nível Gestão',
      camada: 'Visão Operacional',
      descricaoVisao: 'Acesso de leitura a todos os dados operacionais, liberação de cargas/navios, aprovação de manutenções, cancelamentos e delegação.'
    },
    'INSPETOR': {
      nome: 'Inspetor',
      sigla: 'INSP',
      nivel: 'Nível Tático',
      camada: 'Visão Operacional',
      descricaoVisao: 'Acesso de leitura operacional completo, realização de inspeções formais com checklist, cadastro de navios/contêineres/guindastes e acionamento de emergências.'
    },
    'DIRETOR_OPERACOES_LOGISTICA': {
      nome: 'Diretor de Operações e Logística',
      sigla: 'DIR',
      nivel: 'Nível Estratégico',
      camada: 'Visão Estratégica',
      descricaoVisao: 'Acesso total de leitura ao sistema, dashboards executivos consolidados com gráficos e exportação de dados históricos.'
    },
    'DIRETOR_PRESIDENTE_SUPERINTENDENTE': {
      nome: 'Diretor-Presidente / Superintendente',
      sigla: 'DIR',
      nivel: 'Nível Estratégico',
      camada: 'Visão Estratégica',
      descricaoVisao: 'Acesso total de leitura ao sistema, dashboards executivos consolidados com gráficos e exportação de dados históricos.'
    },
    'CONSELHO_ADMINISTRACAO': {
      nome: 'Conselho de Administração',
      sigla: 'DIR',
      nivel: 'Nível Estratégico',
      camada: 'Visão Estratégica',
      descricaoVisao: 'Acesso total de leitura ao sistema, dashboards executivos consolidados com gráficos e exportação de dados históricos.'
    },
    'ESPECTADOR': {
      nome: 'Espectador (Somente Leitura)',
      sigla: 'ESP',
      nivel: 'Nível Estratégico',
      camada: 'Visão Estratégica',
      descricaoVisao: 'Perfil de apresentação com acesso de leitura a todas as telas, painéis e relatórios do sistema, sem permissão para realizar alterações.'
    }
  };

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

  // 1. Gestão do Tema Claro / Escuro
  function initTheme() {
    const savedTheme = localStorage.getItem('nexus_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      document.documentElement.classList.add('dark');
      if (themeToggleIcon) themeToggleIcon.textContent = 'light_mode';
    } else {
      document.documentElement.classList.remove('dark');
      if (themeToggleIcon) themeToggleIcon.textContent = 'dark_mode';
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('nexus_theme', isDark ? 'dark' : 'light');
      if (themeToggleIcon) {
        themeToggleIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
      }
    });
  }

  initTheme();

  // 2. Leitura e Validação da Autenticação Pendente
  // A identificação chega por cookie de curta duração gravado no login (backlog 3).
  const employee = window.NexusSessionCookies ? window.NexusSessionCookies.lerPendencia() : null;
  if (!employee) {
    // Se não houver login prévio (ou a pendência expirou), volta para a tela de acesso
    window.location.href = 'index.html';
    return;
  }
  const isEspectador = ehPerfilEspectador(employee);
  const metadata = isEspectador
    ? roleMetadata['ESPECTADOR']
    : (roleMetadata[employee.cargo] || {
        nome: employee.cargo,
        sigla: 'OP',
        nivel: 'Nível Operacional',
        camada: 'Visão Própria',
        descricaoVisao: 'Acesso às funcionalidades atribuídas ao seu perfil.'
      });

  // 3. Preenchimento dos Campos na Interface
  const nameParts = (employee.nome || 'Operador').split(' ');
  const initials = nameParts.length > 1
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : nameParts[0].substring(0, 2).toUpperCase();

  if (userAvatar) userAvatar.textContent = initials;
  if (userName) userName.textContent = employee.nome || 'Funcionário Porto';
  if (userMatricula) {
    userMatricula.textContent = 'Matrícula: ••••••••';
    userMatricula.setAttribute('aria-label', 'Matrícula protegida');
  }
  if (userCodigo) {
    userCodigo.textContent = 'Código: ••••••••';
    userCodigo.classList.add('hidden');
  }

  if (roleBadgeIcon) roleBadgeIcon.textContent = metadata.sigla;
  if (roleTitle) roleTitle.textContent = metadata.nome;
  if (roleLevelBadge) roleLevelBadge.textContent = `${metadata.nivel} • ${metadata.camada}`;

  if (visionTitle) visionTitle.textContent = `Camada Habilitada: ${metadata.camada}`;
  if (visionDescription) visionDescription.textContent = metadata.descricaoVisao;

  // 4. Confirmação do Cargo e Efetivação da Sessão Active (T1.2 / T1.3)
  if (confirmRoleBtn) {
    confirmRoleBtn.addEventListener('click', () => {
      confirmRoleBtn.disabled = true;
      confirmRoleBtn.innerHTML = `
        <span class="material-symbols-outlined fa-solid fa-spinner text-[20px] animate-spin" data-icon="progress_activity" aria-hidden="true"></span>
        <span>Iniciando Sessão Operacional...</span>
      `;

      // Monta objeto da sessão ativa com cargo travado e nível de permissão
      const sessionData = {
        id: employee.id || employee.matricula,
        matricula: employee.matricula,
        codigo_individual: employee.codigo || employee.codigo_individual,
        nome: employee.nome,
        cargo: isEspectador && (!employee.cargo || employee.cargo === 'ESPECTADOR') ? 'CONSELHO_ADMINISTRACAO' : employee.cargo,
        cargo_nome: metadata.nome,
        nivel: metadata.nivel,
        camada_visao: metadata.camada,
        somente_leitura: isEspectador,
        perfil_espectador: isEspectador,
        login_at: new Date().toISOString()
      };

      // Persiste a sessão somente em cookie (T1.3 / Backlog 3)
      if (window.NexusAuth && window.NexusAuth.establishSession) {
        window.NexusAuth.establishSession(sessionData);
      } else {
        setSessionAndRedirectFallback(sessionData);
      }

      if (window.NexusAnalytics) window.NexusAnalytics.track('login_confirmado', { cargo: sessionData.cargo });

      setTimeout(() => {
        // Redireciona para o portal principal ou dashboard do cargo
        window.location.href = 'dashboard.html';
      }, 500);
    });
  }
});
