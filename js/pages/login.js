/**
 * Lógica da Tela de Login (T1.1) - NexusPort
 * Responsável pelo tratamento do código individual único vinculado à matrícula,
 * validação, controle de tema (Dark Mode) e gestão de modal de contingência.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM
  const themeToggle = document.getElementById('themeToggle');
  const themeToggleIcon = document.getElementById('themeToggleIcon');
  const operatorCodeInput = document.getElementById('operatorCode');
  const codeStatusIcon = document.getElementById('codeStatusIcon');
  const loginForm = document.getElementById('loginForm');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const authNotice = document.getElementById('authNotice');
  const authNoticeIcon = document.getElementById('authNoticeIcon');
  const authNoticeTitle = document.getElementById('authNoticeTitle');
  const authNoticeMessage = document.getElementById('authNoticeMessage');

  // Modal Elements
  const recoveryModal = document.getElementById('recoveryModal');
  const openRecoveryModal = document.getElementById('openRecoveryModal');
  const closeRecoveryModal = document.getElementById('closeRecoveryModal');
  const dismissRecoveryModal = document.getElementById('dismissRecoveryModal');

  // Removida base de dados mock fictícia (Etapa 3 - Plano de Correção)
  const mockEmployees = [];

  // 1. Gestão de Tema Claro / Escuro (Dark Mode)
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

  // 2. Exibição de Alertas de Feedback Inline
  function showAuthNotice(type, title, message) {
    if (type === 'error' && window.NexusAnalytics) window.NexusAnalytics.track('login_falha');
    if (!authNotice) return;
    authNotice.classList.remove('hidden', 'bg-red-50', 'bg-emerald-50', 'bg-amber-50', 'border-red-200', 'border-emerald-200', 'border-amber-200', 'text-red-800', 'text-emerald-800', 'text-amber-800', 'dark:bg-red-950/40', 'dark:bg-emerald-950/40', 'dark:bg-amber-950/40', 'dark:border-red-900', 'dark:border-emerald-900', 'dark:border-amber-900', 'dark:text-red-300', 'dark:text-emerald-300', 'dark:text-amber-300');

    if (type === 'error') {
      authNotice.classList.add('bg-red-50', 'border-red-200', 'text-red-800', 'dark:bg-red-950/40', 'dark:border-red-900', 'dark:text-red-300');
      if (authNoticeIcon) authNoticeIcon.textContent = 'error';
    } else if (type === 'success') {
      authNotice.classList.add('bg-emerald-50', 'border-emerald-200', 'text-emerald-800', 'dark:bg-emerald-950/40', 'dark:border-emerald-900', 'dark:text-emerald-300');
      if (authNoticeIcon) authNoticeIcon.textContent = 'check_circle';
    } else {
      authNotice.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-800', 'dark:bg-amber-950/40', 'dark:border-amber-900', 'dark:text-amber-300');
      if (authNoticeIcon) authNoticeIcon.textContent = 'warning';
    }

    if (authNoticeTitle) authNoticeTitle.textContent = title;
    if (authNoticeMessage) authNoticeMessage.textContent = message;
  }

  function hideAuthNotice() {
    if (authNotice) authNotice.classList.add('hidden');
  }

  // 3. Formatação e Indicador Visual do Campo Código Individual
  if (operatorCodeInput) {
    operatorCodeInput.addEventListener('input', (e) => {
      const valorDigitado = e.target.value;
      const cursor = typeof e.target.selectionStart === 'number' ? e.target.selectionStart : valorDigitado.length;
      const digitandoNoFim = cursor >= valorDigitado.length;

      let val = valorDigitado.toUpperCase().replace(/\s+/g, '');

      // Auto-complete de UX: ao digitar o primeiro número logo após o prefixo
      // alfabético, o separador é inserido automaticamente ("MAT" + "1" → "MAT-1",
      // "NX8821" → "NX-8821"). Códigos já separados por hífen não são alterados.
      if (digitandoNoFim) {
        const prefixoNumerico = /^([A-Z]+)(\d.*)$/.exec(val);
        if (prefixoNumerico) {
          val = `${prefixoNumerico[1]}-${prefixoNumerico[2]}`;
        }
      }

      if (val !== valorDigitado) {
        e.target.value = val;
        // Mantém o cursor no fim do texto após a normalização/auto-complete
        try { e.target.setSelectionRange(val.length, val.length); } catch (err) {}
      }
      hideAuthNotice();

      if (val.length >= 4) {
        codeStatusIcon.textContent = 'hourglass_empty';
        codeStatusIcon.className = 'material-symbols-outlined text-amber-500 text-[22px] animate-spin';
      } else {
        codeStatusIcon.textContent = 'fingerprint';
        codeStatusIcon.className = 'material-symbols-outlined text-slate-300 dark:text-slate-600 text-[22px]';
      }
    });

    operatorCodeInput.addEventListener('blur', () => {
      const val = operatorCodeInput.value.trim();
      if (val.length >= 4) {
        codeStatusIcon.textContent = 'verified';
        codeStatusIcon.className = 'material-symbols-outlined text-nexus-500 dark:text-indigo-400 text-[22px]';
      }
    });
  }

  // 4. Submissão do Formulário de Autenticação
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      // O campo formata o código com hífen durante a digitação (js/mascaras-codigo.js);
      // a comparação local ignora hífens/espaços/maiúsculas.
      const codeValue = operatorCodeInput ? operatorCodeInput.value.trim().toUpperCase() : '';
      const mesmoCodigo = (a, b) => {
        const ka = String(a || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return ka !== '' && ka === String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      };

      if (!codeValue) {
        showAuthNotice('error', 'Credencial Requerida', 'Por favor, informe seu código individual único para acessar o sistema.');
        if (operatorCodeInput) operatorCodeInput.focus();
        return;
      }

      // Estado de carregamento do botão
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.innerHTML = `
          <span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
          <span>Validando Credencial...</span>
        `;
      }

      let employeeFound = null;

      try {
        const client = window.nexusSupabase;
        if (client) {
          // Busca no Supabase pela tabela de funcionários.
          // maybeSingle(): "não encontrado" (0 linhas) é um resultado normal aqui,
          // pois o campo aceita também a matrícula. Com .single() o PostgREST responde
          // 406 (PGRST116) e o navegador registra um erro vermelho a cada login por matrícula.
          const { data, error } = await client
            .from('funcionarios')
            .select('*')
            .eq('codigo_individual', codeValue)
            .eq('ativo', true)
            .maybeSingle();

          if (!error && data) {
            employeeFound = data;
          } else {
            // Consulta também por matrícula caso o código digitado seja a matrícula
            const { data: matData, error: matErr } = await client
              .from('funcionarios')
              .select('*')
              .eq('matricula', codeValue)
              .eq('ativo', true)
              .maybeSingle();
            if (!matErr && matData) {
              employeeFound = matData;
            }
          }
        }
      } catch (err) {
        console.warn('[NexusPort Login] Falha na consulta Supabase, recorrendo aos dados locais:', err);
      }

      // 4.1 Validação de Invalidação e Reemissão de Códigos pelo Técnico em Portos (T1.8 / Spec.md RN 15)
      const storedOverrides = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');

      // Verifica se o código digitado foi INVALIDADO pelo Técnico
      const isInvalidatedCode = Object.values(storedOverrides).some(ov => ov.old_codigo === codeValue);
      if (isInvalidatedCode) {
        showAuthNotice('error', 'Código Invalidado', 'Este código de acesso foi invalidado pelo Técnico em Portos. Por favor, utilize o novo código reemitido.');
        if (codeStatusIcon) {
          codeStatusIcon.textContent = 'cancel';
          codeStatusIcon.className = 'material-symbols-outlined text-red-500 text-[22px]';
        }
        if (loginSubmitBtn) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">login</span>
            <span>Acessar Sistema Portuário</span>
          `;
        }
        return;
      }

      // Verifica se o código digitado é um novo código REEMITIDO pelo Técnico
      const reissuedEntry = Object.entries(storedOverrides).find(([mat, ov]) => mesmoCodigo(ov.codigo, codeValue));

      // Se não encontrou via Supabase ou se não há Supabase conectado, busca exclusivamente nos cadastros dinâmicos locais (nexus_func_list)
      if (!employeeFound) {
        const customFuncList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
        const allLocalEmployees = customFuncList.map(f => ({
          codigo: f.codigo,
          codigo_individual: f.codigo || f.codigo_individual,
          matricula: f.matricula,
          nome: f.nome,
          cargo: f.cargo,
          ativo: f.ativo !== false
        }));

        if (reissuedEntry) {
          const targetMatricula = reissuedEntry[0];
          const baseEmp = allLocalEmployees.find(emp => emp.matricula === targetMatricula && emp.ativo);
          if (baseEmp) {
            employeeFound = { ...baseEmp, codigo: codeValue, codigo_individual: codeValue };
          }
        } else {
          // Busca estrita apenas por código exato ou matrícula na base ativa
          employeeFound = allLocalEmployees.find(emp => (mesmoCodigo(emp.codigo, codeValue) || mesmoCodigo(emp.codigo_individual, codeValue) || mesmoCodigo(emp.matricula, codeValue)) && emp.ativo);
        }
      }

      if (employeeFound) {
        // Armazena temporariamente os dados da sessão identificada
        // Identificação pendente em cookie de curta duração (backlog 3). Só os campos
        // necessários à confirmação são gravados (sem e-mail/telefone).
        if (window.NexusSessionCookies) {
          window.NexusSessionCookies.gravarPendencia(employeeFound);
        } else {
          console.error('[NexusPort Login] js/session-cookies.js não carregado: a confirmação de cargo não terá a identificação.');
        }

        showAuthNotice('success', 'Credencial Reconhecida', `Código vinculado à matrícula ${employeeFound.matricula}. Redirecionando para confirmação...`);

        if (codeStatusIcon) {
          codeStatusIcon.textContent = 'check_circle';
          codeStatusIcon.className = 'material-symbols-outlined text-emerald-500 text-[22px]';
        }

        setTimeout(() => {
          // O fluxo avança para a confirmação de cargo e guarda de autenticação (T1.2)
          window.location.href = 'confirm-role.html';
        }, 600);
      } else {
        showAuthNotice('error', 'Credencial Inválida ou Inativa', 'O código individual fornecido não foi localizado no cadastro ativo do terminal STS-01.');
        if (codeStatusIcon) {
          codeStatusIcon.textContent = 'cancel';
          codeStatusIcon.className = 'material-symbols-outlined text-red-500 text-[22px]';
        }
        if (loginSubmitBtn) {
          loginSubmitBtn.disabled = false;
          loginSubmitBtn.innerHTML = `
            <span class="material-symbols-outlined text-[20px]">login</span>
            <span>Acessar Sistema Portuário</span>
          `;
        }
      }
    });
  }

  // 5. Gestão do Modal de Contingência (RN 15 / T1.8)
  function toggleRecoveryModal(show) {
    if (!recoveryModal) return;
    if (show) {
      recoveryModal.classList.remove('hidden');
    } else {
      recoveryModal.classList.add('hidden');
    }
  }

  if (openRecoveryModal) openRecoveryModal.addEventListener('click', () => toggleRecoveryModal(true));
  if (closeRecoveryModal) closeRecoveryModal.addEventListener('click', () => toggleRecoveryModal(false));
  if (dismissRecoveryModal) dismissRecoveryModal.addEventListener('click', () => toggleRecoveryModal(false));

  if (recoveryModal) {
    recoveryModal.addEventListener('click', (e) => {
      if (e.target === recoveryModal) toggleRecoveryModal(false);
    });
  }
});
