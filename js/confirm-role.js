/**
 * Lógica de Confirmação de Cargo (T1.2) - NexusPort
 * Carrega automaticamente o cargo do funcionário resolvido pela autenticação,
 * exibe os detalhes para confirmação (sem permitir edição manual conforme RF 1)
 * e estabelece a sessão do usuário.
 */

/**
 * Fallback de persistência de sessão usado caso o auth-guard não esteja
 * carregado nesta página (mantém cookie + espelhos locais consistentes).
 */
function setSessionAndRedirectFallback(sessionData) {
  try {
    const raw = JSON.stringify(sessionData);
    const attrs = ['path=/', 'SameSite=Lax', 'max-age=43200'];
    if (window.location && window.location.protocol === 'https:') attrs.push('Secure');
    document.cookie = `nexus_session=${encodeURIComponent(raw)}; ${attrs.join('; ')}`;
    localStorage.setItem('nexus_session', raw);
    sessionStorage.removeItem('nexus_session');
    sessionStorage.removeItem('nexus_pending_auth');
  } catch (e) {
    console.warn('[ConfirmRole] Falha ao persistir sessão de fallback:', e);
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
    }
  };

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
  const pendingAuthRaw = sessionStorage.getItem('nexus_pending_auth');
  if (!pendingAuthRaw) {
    // Se não houver login prévio, redireciona para a tela inicial de acesso
    window.location.href = 'index.html';
    return;
  }

  const employee = JSON.parse(pendingAuthRaw);
  const metadata = roleMetadata[employee.cargo] || {
    nome: employee.cargo,
    sigla: 'OP',
    nivel: 'Nível Operacional',
    camada: 'Visão Própria',
    descricaoVisao: 'Acesso às funcionalidades atribuídas ao seu perfil.'
  };

  // 3. Preenchimento dos Campos na Interface
  const nameParts = (employee.nome || 'Operador').split(' ');
  const initials = nameParts.length > 1
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : nameParts[0].substring(0, 2).toUpperCase();

  if (userAvatar) userAvatar.textContent = initials;
  if (userName) userName.textContent = employee.nome || 'Funcionário Porto';
  if (userMatricula) userMatricula.textContent = `Matrícula: ${employee.matricula || 'N/A'}`;
  if (userCodigo) userCodigo.textContent = `Código: ${employee.codigo || employee.codigo_individual || 'N/A'}`;

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
        <span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
        <span>Iniciando Sessão Operacional...</span>
      `;

      // Monta objeto da sessão ativa com cargo travado e nível de permissão
      const sessionData = {
        id: employee.id || employee.matricula,
        matricula: employee.matricula,
        codigo_individual: employee.codigo || employee.codigo_individual,
        nome: employee.nome,
        cargo: employee.cargo,
        cargo_nome: metadata.nome,
        nivel: metadata.nivel,
        camada_visao: metadata.camada,
        login_at: new Date().toISOString()
      };

      // Persiste a sessão em cookie (principal) + localStorage (espelho legado) (T1.3 / Backlog 3)
      if (window.NexusAuth && window.NexusAuth.establishSession) {
        window.NexusAuth.establishSession(sessionData);
      } else {
        setSessionAndRedirectFallback(sessionData);
      }

      setTimeout(() => {
        // Redireciona para o portal principal ou dashboard do cargo
        window.location.href = 'dashboard.html';
      }, 500);
    });
  }
});
