/**
 * Componente Layout Persistente (Sidebar e Topbar) - NexusPort
 * Injeta dinamicamente a barra lateral e o cabeçalho superior padronizados
 * em todas as páginas internas da aplicação.
 */

(function (window) {
  'use strict';

  // Utilitários Anti-XSS (js/security.js) — os dados de sessão (nome, cargo,
  // código, matrícula) vêm do localStorage/sessionStorage e são controláveis,
  // portanto jamais devem ser interpolados crus em innerHTML.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);

  function initLayout() {
    const session = window.currentUserSession || (window.NexusAuth ? NexusAuth.getSession() : null);

    // Se estiver em páginas públicas (index.html ou confirm-role.html), ignora a injeção do layout interno
    const currentPath = window.location.pathname;
    if (currentPath.endsWith('index.html') || currentPath.endsWith('confirm-role.html') || currentPath === '/' || currentPath === '') {
      return;
    }

    if (!session) {
      if (window.NexusAuth) window.NexusAuth.requireAuth();
      return;
    }

    // Identificação do Usuário
    const userName = session.nome || 'Operador Porto';
    const userRoleName = session.cargo_nome || session.cargo || 'Operador';
    const userCode = session.codigo_individual || session.codigo || '--';
    const userMatricula = session.matricula || '--';

    const isDiretor = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    const isOperacionalSupervisor = ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].includes(session.cargo);
    const isTecnico = session.cargo === 'TECNICO_PORTOS';
    const isSupervisor = session.cargo === 'SUPERVISOR_GERENTE_OPERACOES';
    const isInspetor = session.cargo === 'INSPETOR';
    const isPlanejador = session.cargo === 'PLANEJADOR_PATIO_NAVIOS';
    const isOperacionalCarga = ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR'].includes(session.cargo);

    const visionLayer = session.camada_visao || (isDiretor ? 'Visão Estratégica' : isOperacionalSupervisor ? 'Visão Operacional' : 'Visão Própria');

    const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';

    // Determina link ativo baseado na URL
    const activePage = currentPath.split('/').pop() || 'dashboard.html';

    const menuItems = [
      { id: 'dashboard.html', label: 'Painel Geral', icon: 'dashboard', href: 'dashboard.html', visible: true },
      { id: 'cargas.html', label: 'Cargas & Pátio', icon: 'inventory_2', href: 'cargas.html', visible: isDiretor || isSupervisor || isInspetor || isPlanejador || isOperacionalCarga },
      { id: 'inspecao.html', label: 'Inspeção & Checklist', icon: 'fact_check', href: 'inspecao.html', visible: isDiretor || isSupervisor || isInspetor },
      { id: 'scanner.html', label: 'Scanner QR Code', icon: 'qr_code_scanner', href: 'scanner.html', visible: true },
      { id: 'embarcacoes.html', label: 'Embarcações & GPS', icon: 'directions_boat', href: 'embarcacoes.html', visible: isDiretor || isSupervisor || isInspetor || isPlanejador },
      { id: 'manutencao.html', label: 'Manutenção & OS', icon: 'build', href: 'manutencao.html', visible: isDiretor || isSupervisor || isInspetor },
      { id: 'delegacao.html', label: 'Delegação Supervisor', icon: 'how_to_reg', href: 'delegacao.html', visible: isDiretor || isSupervisor },
      { id: 'tecnico_portos.html', label: 'Gestão de Pessoas', icon: 'badge', href: 'tecnico_portos.html', visible: isTecnico || isDiretor },
      { id: 'relatorios.html', label: 'Relatórios & PDF', icon: 'assessment', href: 'relatorios.html', visible: true }
    ];

    // Montagem prévia dos itens de menu (cada interpolação é codificada aqui)
    const navItemsHtml = menuItems.filter(item => item.visible).map(item => {
      const isActive = activePage === item.id;
      return `
        <a href="${esc(item.href)}" class="sidebar-nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg ${isActive ? 'bg-nexus-500 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'} text-sm font-medium transition-colors">
          <span class="material-symbols-outlined text-[20px]">${esc(item.icon)}</span>
          <span>${esc(item.label)}</span>
        </a>
      `;
    }).join('');

    // Injeta Topbar com Posicionamento Fixo e Z-Index Elevado (Item 7)
    const topbarElem = document.getElementById('appTopbar') || document.querySelector('header');
    if (topbarElem) {
      topbarElem.className = 'w-full h-16 px-4 sm:px-6 flex items-center justify-between border-b border-nexus-border dark:border-nexus-dark-border bg-white dark:bg-slate-900 fixed top-0 left-0 right-0 z-40 shadow-sm';
      topbarElem.innerHTML = `
        <div class="flex items-center gap-3">
          <button id="mobileMenuToggle" type="button" class="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <span class="material-symbols-outlined text-[24px]">menu</span>
          </button>
          <img src="design/logo_porto.png" alt="NexusPort Logo" class="h-9 w-auto object-contain rounded-lg" />
          <div class="flex flex-col min-w-0">
            <span class="font-display font-bold text-base text-nexus-900 dark:text-white leading-tight truncate">NexusPort</span>
            <span class="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">Terminal STS-01</span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div id="headerAvatar" class="w-7 h-7 rounded-lg bg-nexus-500 text-white flex items-center justify-center font-mono text-xs font-bold">
              ${esc(initials)}
            </div>
            <div class="hidden sm:flex flex-col min-w-0">
              <span id="headerUserName" class="text-xs font-bold text-nexus-900 dark:text-white truncate">${esc(userName)}</span>
              <div class="flex items-center gap-1.5">
                <span id="headerUserRole" class="text-[10px] text-slate-500 dark:text-slate-400 truncate">${esc(userRoleName)}</span>
                <span class="text-[10px] text-slate-300 dark:text-slate-600">•</span>
                <span id="headerUserCode" class="font-mono text-[10px] font-semibold text-nexus-500 dark:text-indigo-400">${esc(userCode)}</span>
              </div>
            </div>
          </div>

          <button id="themeToggle" type="button" aria-label="Alternar tema escuro" class="p-2 rounded-lg border border-nexus-border dark:border-nexus-dark-border bg-nexus-bg dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <span class="material-symbols-outlined text-[18px]" id="themeToggleIcon">dark_mode</span>
          </button>

          <button id="logoutBtn" type="button" aria-label="Encerrar Sessão" class="p-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/60 transition-colors flex items-center gap-1 text-xs font-semibold">
            <span class="material-symbols-outlined text-[18px]">logout</span>
            <span class="hidden md:inline">Sair</span>
          </button>
        </div>
      `;
    }

    // Cria Overlay Escuro para Mobile se não existir
    let mobileOverlay = document.getElementById('sidebarMobileOverlay');
    if (!mobileOverlay) {
      mobileOverlay = document.createElement('div');
      mobileOverlay.id = 'sidebarMobileOverlay';
      mobileOverlay.className = 'fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 hidden md:hidden transition-opacity duration-300';
      document.body.appendChild(mobileOverlay);
    }

    // Injeta Sidebar se contêiner existir
    const sidebarElem = document.getElementById('appSidebar') || document.querySelector('aside');
    if (sidebarElem) {
      sidebarElem.className = 'w-64 bg-nexus-900 text-white flex-col justify-between fixed md:static inset-y-0 left-0 z-50 transform -translate-x-full md:translate-x-0 transition-transform duration-300 ease-in-out flex border-r border-slate-800 shrink-0';
      sidebarElem.innerHTML = `
        <div class="p-4 flex flex-col gap-6 overflow-y-auto h-full justify-between">
          <div class="flex flex-col gap-6">

            <!-- Cabeçalho Mobile com Fechamento -->
            <div class="flex md:hidden items-center justify-between pb-3 border-b border-slate-800">
              <div class="flex items-center gap-2">
                <img src="design/logo_porto.png" alt="Logo" class="h-7 w-auto object-contain rounded" />
                <span class="font-display font-bold text-sm text-white">NexusPort</span>
              </div>
              <button id="closeMobileSidebarBtn" type="button" class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
                <span class="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <!-- User Header in Sidebar -->
            <div class="flex flex-col gap-2 p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-nexus-500 text-white flex items-center justify-center font-display font-bold text-sm shadow-sm flex-shrink-0">
                  ${esc(initials)}
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="font-display font-bold text-xs text-white truncate">${esc(userName)}</span>
                  <span class="text-[11px] text-slate-400 truncate">${esc(userRoleName)}</span>
                </div>
              </div>
              <div class="flex items-center justify-between pt-2 border-t border-slate-700/60 font-mono text-[10px]">
                <span class="text-slate-400">Código/Mat:</span>
                <span class="font-bold text-indigo-400">${esc(userCode)} / ${esc(userMatricula)}</span>
              </div>
              <div class="mt-1 px-2 py-1 rounded bg-indigo-950/80 border border-indigo-800 text-indigo-300 font-mono text-[10px] font-bold text-center">
                ${esc(visionLayer)} (RLS)
              </div>
            </div>

            <!-- Navigation Links -->
            <div class="flex flex-col gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-slate-400 font-bold px-3">Menu Operacional</span>
              <nav class="flex flex-col gap-1 mt-1">
                ${navItemsHtml}
              </nav>
            </div>

          </div>

          <div class="pt-4 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Porto de Santos • STS-01</span>
            <a href="index.html" onclick="if(window.NexusAuth) NexusAuth.logout();" class="text-slate-400 hover:text-white flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px]">logout</span>
            </a>
          </div>
        </div>
      `;

      // Handlers de Abertura/Fechamento Mobile
      function abrirSidebarMobile() {
        sidebarElem.classList.remove('-translate-x-full');
        mobileOverlay.classList.remove('hidden');
      }

      function fecharSidebarMobile() {
        sidebarElem.classList.add('-translate-x-full');
        mobileOverlay.classList.add('hidden');
      }

      const mobileToggleBtn = document.getElementById('mobileMenuToggle');
      if (mobileToggleBtn) {
        mobileToggleBtn.addEventListener('click', abrirSidebarMobile);
      }

      const closeMobileBtn = document.getElementById('closeMobileSidebarBtn');
      if (closeMobileBtn) {
        closeMobileBtn.addEventListener('click', fecharSidebarMobile);
      }

      if (mobileOverlay) {
        mobileOverlay.addEventListener('click', fecharSidebarMobile);
      }

      const navLinks = sidebarElem.querySelectorAll('.sidebar-nav-item');
      navLinks.forEach(link => link.addEventListener('click', fecharSidebarMobile));
    }

    // Configura estado inicial do ícone e eventos de Dark Mode e Logout no topbar
    const themeBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeToggleIcon');
    const savedTheme = localStorage.getItem('nexus_theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      if (themeIcon) themeIcon.textContent = 'light_mode';
    } else {
      if (themeIcon) themeIcon.textContent = 'dark_mode';
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('nexus_theme', isDark ? 'dark' : 'light');
        if (themeIcon) themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
      });
    }

    const logoutBtnElem = document.getElementById('logoutBtn');
    if (logoutBtnElem) {
      logoutBtnElem.addEventListener('click', async () => {
        if (await window.nexusConfirm('Encerrar Sessão', 'Deseja encerrar sua sessão operacional no terminal STS-01?')) {
          if (window.NexusAuth) window.NexusAuth.logout();
          else window.location.href = 'index.html';
        }
      });
    }

    // Backlog 3 (8.2): sinal de rolagem horizontal nas tabelas grandes em telas móveis
    function aplicarHintDeRolagemTabelas() {
      document.querySelectorAll('.overflow-x-auto').forEach(box => {
        if (box.dataset.scrollHintApplied === '1') return;
        box.dataset.scrollHintApplied = '1';
        box.classList.add('relative');
        const needsScroll = () => box.scrollWidth > box.clientWidth + 8;
        const hint = document.createElement('div');
        hint.className = 'sticky left-full float-right pointer-events-none select-none text-[10px] font-bold text-nexus-500 bg-indigo-50/90 dark:bg-slate-800/90 border border-nexus-border dark:border-slate-700 rounded-full px-2 py-1 m-2 shadow-sm items-center gap-1 sm:hidden';
        hint.style.display = 'none';
        hint.innerHTML = '<span class="material-symbols-outlined text-[14px] align-middle">swipe</span> <span class="align-middle">Deslize</span>';
        box.appendChild(hint);
        const atualizar = () => {
          hint.style.display = (needsScroll() && box.scrollLeft <= 4) ? 'inline-flex' : 'none';
        };
        box.addEventListener('scroll', () => {
          if (box.scrollLeft > 4) hint.style.display = 'none';
        }, { passive: true });
        window.addEventListener('resize', atualizar);
        // avalia após o primeiro render das tabelas
        setTimeout(atualizar, 0);
      });
    }
    aplicarHintDeRolagemTabelas();
    // tabelas renderizadas depois (Realtime / filtros) também recebem a dica
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => { if (!document.__nexusScrollHintBusy) { document.__nexusScrollHintBusy = true; setTimeout(() => { aplicarHintDeRolagemTabelas(); document.__nexusScrollHintBusy = false; }, 120); } });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // Injeta Estrutura de Modal / Toast de Feedback Global (Tarefa 7)
    let feedbackModal = document.getElementById('globalFeedbackModal');
    if (!feedbackModal) {
      feedbackModal = document.createElement('div');
      feedbackModal.id = 'globalFeedbackModal';
      feedbackModal.className = 'fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-nexus-900/60 backdrop-blur-sm transition-all duration-200';
      feedbackModal.setAttribute('role', 'alertdialog');
      feedbackModal.setAttribute('aria-modal', 'true');
      feedbackModal.setAttribute('aria-live', 'polite');
      feedbackModal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-nexus-border dark:border-slate-800 p-5 flex flex-col items-center text-center gap-3 transform transition-all scale-100">
          <div id="globalFeedbackIconBox" class="w-12 h-12 rounded-2xl flex items-center justify-center bg-indigo-100 dark:bg-indigo-950/60 text-nexus-500 shrink-0">
            <span id="globalFeedbackIcon" class="material-symbols-outlined text-[28px]">info</span>
          </div>
          <div class="flex flex-col gap-1">
            <h4 id="globalFeedbackTitle" class="font-display font-bold text-base text-nexus-900 dark:text-white">Mensagem do Sistema</h4>
            <p id="globalFeedbackMsg" class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">--</p>
          </div>
          <button type="button" id="globalFeedbackBtn" aria-label="Fechar mensagem de feedback" class="w-full mt-2 py-2 rounded-xl bg-nexus-500 hover:bg-nexus-900 text-white font-bold text-xs transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexus-500">
            OK
          </button>
        </div>
      `;
      document.body.appendChild(feedbackModal);

      const closeBtn = feedbackModal.querySelector('#globalFeedbackBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => feedbackModal.classList.add('hidden'));
      }
      feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) feedbackModal.classList.add('hidden');
      });
    }

    // Injeta Modais Customizados para Substituir Confirm e Prompt Nativos (Item 6)
    let confirmModal = document.getElementById('nexusConfirmModal');
    if (!confirmModal) {
      confirmModal = document.createElement('div');
      confirmModal.id = 'nexusConfirmModal';
      confirmModal.className = 'fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-nexus-900/60 backdrop-blur-sm transition-all duration-200';
      confirmModal.setAttribute('role', 'dialog');
      confirmModal.setAttribute('aria-modal', 'true');
      confirmModal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-nexus-border dark:border-slate-800 p-6 flex flex-col gap-4 transform transition-all scale-100">
          <div class="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div class="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[24px]">help_outline</span>
            </div>
            <div>
              <h4 id="nexusConfirmTitle" class="font-display font-bold text-base text-nexus-900 dark:text-white">Confirmação Operacional</h4>
              <span class="text-[11px] font-mono text-slate-400">Terminal STS-01</span>
            </div>
          </div>
          <p id="nexusConfirmMsg" class="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">Deseja confirmar esta ação?</p>
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" id="nexusConfirmCancelBtn" aria-label="Cancelar ação" class="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexus-500">
              Cancelar
            </button>
            <button type="button" id="nexusConfirmOkBtn" aria-label="Confirmar ação" class="px-4 py-2 rounded-xl bg-nexus-500 hover:bg-nexus-900 text-white font-bold text-xs transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexus-500">
              Confirmar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
    }

    let promptModal = document.getElementById('nexusPromptModal');
    if (!promptModal) {
      promptModal = document.createElement('div');
      promptModal.id = 'nexusPromptModal';
      promptModal.className = 'fixed inset-0 z-50 hidden flex items-center justify-center p-4 bg-nexus-900/60 backdrop-blur-sm transition-all duration-200';
      promptModal.innerHTML = `
        <div class="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-nexus-border dark:border-slate-800 p-6 flex flex-col gap-4 transform transition-all scale-100">
          <div class="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-nexus-500 flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-[24px]">edit_note</span>
            </div>
            <div>
              <h4 id="nexusPromptTitle" class="font-display font-bold text-base text-nexus-900 dark:text-white">Solicitação de Informação</h4>
              <span class="text-[11px] font-mono text-slate-400">Terminal STS-01</span>
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <p id="nexusPromptMsg" class="text-xs text-slate-700 dark:text-slate-300 font-medium">Informe os detalhes:</p>
            <textarea id="nexusPromptInput" rows="3" class="w-full px-3 py-2 rounded-xl border border-nexus-border dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-nexus-500 focus:outline-none"></textarea>
          </div>
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" id="nexusPromptCancelBtn" class="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors">
              Cancelar
            </button>
            <button type="button" id="nexusPromptOkBtn" class="px-4 py-2 rounded-xl bg-nexus-500 hover:bg-nexus-900 text-white font-bold text-xs transition-colors shadow-sm">
              Confirmar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(promptModal);
    }

    // Ajusta o contêiner principal para considerar a navbar fixa (Item 7).
    // A altura é limitada à viewport no desktop (md+) para que apenas o <main>
    // role: assim a barra lateral permanece fixa na tela durante a rolagem do
    // conteúdo (antes o documento inteiro rolava e o menu "subia" com a página).
    const mainWrapper = document.querySelector('.flex-1.flex');
    if (mainWrapper) {
      mainWrapper.classList.add('pt-16', 'md:h-[calc(100vh-4rem)]', 'md:overflow-hidden');
    }
  }

  // Modais de Confirmação e Prompt Globais (Item 6)
  window.nexusConfirm = function(titleOrMsg, msg) {
    return new Promise((resolve) => {
      const modal = document.getElementById('nexusConfirmModal');
      if (!modal) {
        resolve(window.confirm(msg || titleOrMsg));
        return;
      }
      const titleEl = modal.querySelector('#nexusConfirmTitle');
      const msgEl = modal.querySelector('#nexusConfirmMsg');
      const okBtn = modal.querySelector('#nexusConfirmOkBtn');
      const cancelBtn = modal.querySelector('#nexusConfirmCancelBtn');

      if (titleEl) titleEl.textContent = msg ? titleOrMsg : 'Confirmação Operacional';
      if (msgEl) msgEl.textContent = msg || titleOrMsg;

      modal.classList.remove('hidden');

      function cleanup() {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);

      // Suporte a testes automatizados headless (auto-confirma modal customizado se executado em teste headless)
      if (navigator.userAgent && (navigator.userAgent.includes('Headless') || navigator.userAgent.includes('Playwright'))) {
        setTimeout(() => {
          if (!modal.classList.contains('hidden')) {
            onOk();
          }
        }, 50);
      }
    });
  };

  window.nexusPrompt = function(titleOrMsg, msg, defaultValue = '') {
    return new Promise((resolve) => {
      const modal = document.getElementById('nexusPromptModal');
      if (!modal) {
        resolve(window.prompt(msg || titleOrMsg, defaultValue));
        return;
      }
      const titleEl = modal.querySelector('#nexusPromptTitle');
      const msgEl = modal.querySelector('#nexusPromptMsg');
      const inputEl = modal.querySelector('#nexusPromptInput');
      const okBtn = modal.querySelector('#nexusPromptOkBtn');
      const cancelBtn = modal.querySelector('#nexusPromptCancelBtn');

      if (titleEl) titleEl.textContent = msg ? titleOrMsg : 'Solicitação de Informação';
      if (msgEl) msgEl.textContent = msg || titleOrMsg;
      if (inputEl) inputEl.value = defaultValue || '';

      modal.classList.remove('hidden');
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }

      function cleanup() {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
      }
      function onOk() { cleanup(); resolve(inputEl ? inputEl.value.trim() : ''); }
      function onCancel() { cleanup(); resolve(null); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  };

  // Função Global de Feedback Visual Padronizada (Tarefa 7)
  window.mostrarFeedback = function(tipo = 'info', titulo = 'Notificação', mensagem = '') {
    const modal = document.getElementById('globalFeedbackModal');
    if (!modal) {
      alert(`${titulo}: ${mensagem}`);
      return;
    }

    const iconBox = modal.querySelector('#globalFeedbackIconBox');
    const icon = modal.querySelector('#globalFeedbackIcon');
    const titleElem = modal.querySelector('#globalFeedbackTitle');
    const msgElem = modal.querySelector('#globalFeedbackMsg');

    if (titleElem) titleElem.textContent = titulo;
    if (msgElem) msgElem.textContent = mensagem;

    if (tipo === 'sucesso' || tipo === 'success') {
      if (iconBox) iconBox.className = 'w-12 h-12 rounded-2xl flex items-center justify-center bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0';
      if (icon) icon.textContent = 'check_circle';
    } else if (tipo === 'erro' || tipo === 'error' || tipo === 'danger') {
      if (iconBox) iconBox.className = 'w-12 h-12 rounded-2xl flex items-center justify-center bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 shrink-0';
      if (icon) icon.textContent = 'error';
    } else if (tipo === 'alerta' || tipo === 'warning') {
      if (iconBox) iconBox.className = 'w-12 h-12 rounded-2xl flex items-center justify-center bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 shrink-0';
      if (icon) icon.textContent = 'warning';
    } else {
      if (iconBox) iconBox.className = 'w-12 h-12 rounded-2xl flex items-center justify-center bg-indigo-100 dark:bg-indigo-950/60 text-nexus-500 shrink-0';
      if (icon) icon.textContent = 'info';
    }

    modal.classList.remove('hidden');

    // Backlog 3 (8.7): feedbacks de sucesso/info se fecham sozinhos em 5 segundos —
    // o usuário não precisa do clique de confirmação. Erros e alertas exigem clique.
    if (window.__nexusFeedbackTimer) {
      clearTimeout(window.__nexusFeedbackTimer);
      window.__nexusFeedbackTimer = null;
    }
    if (tipo === 'sucesso' || tipo === 'success' || tipo === 'info') {
      window.__nexusFeedbackTimer = setTimeout(() => {
        modal.classList.add('hidden');
        window.__nexusFeedbackTimer = null;
      }, 5000);
    }
  };

  /**
   * Estado GLOBAL de emergência (botão de pânico). Enquanto o alarme estiver
   * ativo, as operações críticas do pátio (movimentar carga, liberar saída de
   * navio, autorizar retorno) ficam bloqueadas — o alerta é exibido no rodapé
   * de todas as telas por js/panic-realtime.js.
   */
  window.nexusEmergenciaAtiva = function () {
    try {
      if (window.NexusPanic && typeof window.NexusPanic.isActive === 'function' && window.NexusPanic.isActive()) {
        return true;
      }
      return localStorage.getItem('nexus_emergency_active') === 'true';
    } catch (e) {
      return false;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLayout);
  } else {
    initLayout();
  }

  window.initNexusLayout = initLayout;
})(window);
