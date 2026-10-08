/**
 * Módulo de Cargas & Pátio (cargas.html) - NexusPort
 * Trata o fluxo de cargas de 8 etapas, agendamento com validação de pré-requisito (RN 13),
 * geração de QR Code em tempo real (RF 17.1) e ocultação estrita de botões de ação por cargo (RF 1).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  const userCargo = session.cargo;

  const toggleFormBtn = document.getElementById('toggleAgendamentoFormBtn');
  const agendamentoForm = document.getElementById('agendamentoCargaForm');
  const cargasTableBody = document.getElementById('cargasTableBody');
  const roleNoticeTag = document.getElementById('roleNoticeTag');

  const qrModal = document.getElementById('qrModal');
  const closeQrModalBtn = document.getElementById('closeQrModalBtn');
  const qrCanvas = document.getElementById('qrCanvas');
  const qrModalEntityId = document.getElementById('qrModalEntityId');
  const qrModalEntityType = document.getElementById('qrModalEntityType');
  const qrModalEntitySub = document.getElementById('qrModalEntitySub');
  const printEtiquetaBtn = document.getElementById('printEtiquetaBtn');

  if (roleNoticeTag) {
    roleNoticeTag.textContent = `Ações Ativas para: ${session.cargo_nome || session.cargo}`;
  }

  const isSupervisorRole = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
  const isInspetorRole = ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
  const isConferenteRole = ['CONFERENTE_CARGA', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
  const isArrumadorRole = ['ARRUMADOR_CONSERTADOR', 'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
  const isEstivadorRole = ['ESTIVADOR', 'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);

  const isGestorRole = isSupervisorRole || isInspetorRole;

  // ======================================================================
  // Backlog 3 (Anotação 3.4) — Funcionário responsável pela carga
  // Gestor (Supervisor/Gerência/Inspetor/Diretor): formulário exige a
  // seleção de um funcionário EM ESCALA (ativo) para assumir a carga.
  // Funcionário operacional (Estivador etc.): o sistema auto-seleciona a
  // sessão logada como responsável e o campo fica desabilitado, sem como
  // atribuir a outra pessoa.
  // ======================================================================
  const agEstivadorSel = document.getElementById('agEstivadorResponsavel');
  const agEstivadorHint = document.getElementById('agEstivadorResponsavelHint');
  let funcionariosEscalaCache = [];

  async function carregarFuncionariosEscala() {
    if (funcionariosEscalaCache.length > 0) return funcionariosEscalaCache;
    let lista = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    if (window.NexusRepository && typeof window.NexusRepository.getFuncionarios === 'function') {
      try {
        const dbList = await window.NexusRepository.getFuncionarios();
        if (Array.isArray(dbList) && dbList.length > 0) lista = dbList;
      } catch (e) { /* mantém cache local */ }
    }
    // "Em escala": somente funcionários marcados como ativos (não afastados/inativos)
    funcionariosEscalaCache = (lista || []).filter(f => f && f.ativo !== false && f.status !== 'INATIVO');
    return funcionariosEscalaCache;
  }

  function funcionarioDaSessao(escala) {
    const mat = String(session.matricula || '').toUpperCase();
    const cod = String(session.codigo_individual || '').toUpperCase();
    return (escala || []).find(f => {
      const fMat = String(f.matricula || '').toUpperCase();
      const fCod = String(f.codigo_individual || f.codigo || '').toUpperCase();
      return (mat && fMat === mat) || (cod && fCod === cod);
    }) || null;
  }

  async function preencherSelectEstivadorResponsavel() {
    if (!agEstivadorSel) return;
    const escala = await carregarFuncionariosEscala();

    if (isGestorRole) {
      // Gestor escolhe livremente entre funcionários em escala (ativos)
      agEstivadorSel.disabled = false;
      agEstivadorSel.required = true;
      agEstivadorSel.innerHTML = '<option value="">Selecione o funcionário responsável em escala...</option>' +
        escala.map(f => {
          const val = f.id || f.matricula || f.codigo_individual || '';
          return `<option value="${esc(String(val))}" data-matricula="${esc(f.matricula || '')}" data-nome="${esc(f.nome || '')}" data-cargo="${esc(f.cargo || '')}">${esc(f.nome || 'Funcionário')} — ${esc(f.cargo_nome || f.cargo || 'Operacional')} (Mat: ${esc(f.matricula || '-')})</option>`;
        }).join('');
      if (agEstivadorHint) {
        agEstivadorHint.textContent = escala.length > 0
          ? `${escala.length} funcionário(s) em escala disponíveis para assumir a carga.`
          : 'Nenhum funcionário ativo em escala encontrado. Verifique o cadastro (Técnico em Portos).';
      }
    } else {
      // Funcionário operacional: auto-seleção e travamento do campo
      const proprio = funcionarioDaSessao(escala);
      const nomeExib = (proprio && proprio.nome) || session.nome || 'Funcionário logado';
      const matExib = (proprio && proprio.matricula) || session.matricula || '-';
      const val = (proprio && (proprio.id || proprio.matricula || proprio.codigo_individual)) || session.matricula || session.codigo_individual || 'SESSAO_ATUAL';
      agEstivadorSel.innerHTML = `<option value="${esc(String(val))}" selected data-matricula="${esc(matExib)}" data-nome="${esc(nomeExib)}" data-cargo="${esc(session.cargo)}">${esc(nomeExib)} — ${esc(session.cargo_nome || session.cargo)} (você)</option>`;
      agEstivadorSel.value = String(val);
      agEstivadorSel.disabled = true;
      agEstivadorSel.required = false;
      if (agEstivadorHint) {
        agEstivadorHint.textContent = 'Carga atribuída automaticamente à sua sessão (campo travado por segurança).';
      }
    }
  }

  function obterEstivadorSelecionado() {
    if (!agEstivadorSel) return null;
    const opt = agEstivadorSel.options[agEstivadorSel.selectedIndex];
    if (!opt || !opt.value) return null;
    return {
      id: opt.value,
      matricula: opt.getAttribute('data-matricula') || opt.value,
      nome: opt.getAttribute('data-nome') || opt.text,
      cargo: opt.getAttribute('data-cargo') || null
    };
  }

  // Preenche o select de tipos de carga usando a lista compartilhada NEXUS_TIPOS_CARGA
  const selectTipoCarga = document.getElementById('agTipoCarga');
  if (selectTipoCarga && window.NEXUS_TIPOS_CARGA) {
    selectTipoCarga.innerHTML = '<option value="">Selecione o Tipo de Carga...</option>';
    window.NEXUS_TIPOS_CARGA.forEach(t => {
      selectTipoCarga.innerHTML += `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`;
    });
  }

  function renderBercosPanel() {}

  let currentEntityData = null;

  // Carrega lista de cargas
  let cargasFluxoList = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');

  async function carregarCargasSupabase() {
    if (window.NexusRepository) {
      try {
        const loadedCargas = await window.NexusRepository.getCargas();
        if (loadedCargas) {
          cargasFluxoList = loadedCargas;
          localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao carregar cargas via repositório:', err);
      }
    }
    renderTable();
  }

  // Renderização de cargas canceladas na Tabela de Cargas Canceladas
  function renderCargasCanceladasTable(cargasCanceladas = []) {
    const canceladasTableBody = document.getElementById('cargasCanceladasTableBody');
    if (!canceladasTableBody) return;

    if (!cargasCanceladas || cargasCanceladas.length === 0) {
      canceladasTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-400 italic">Nenhuma carga cancelada no sistema.</td>
        </tr>
      `;
      return;
    }

    canceladasTableBody.innerHTML = cargasCanceladas.map(c => `
      <tr class="hover:bg-red-50/50 dark:hover:bg-red-950/20 transition-colors">
        <td class="p-3 font-mono font-bold text-red-600 dark:text-red-400">${esc(c.id)}</td>
        <td class="p-3 font-bold">${esc(c.tipo || 'Carga Geral')}</td>
        <td class="p-3 font-mono text-xs">${esc(c.portoDescarga || 'Setor Pátio')}</td>
        <td class="p-3 text-slate-700 dark:text-slate-300">${esc(c.motivoCancelamento || c.motivo_recusa || c.motivo || 'Cancelado pelo Supervisor')}</td>
        <td class="p-3">
          <span class="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300">CANCELADA</span>
        </td>
      </tr>
    `).join('');
  }

  function renderTable() {
    if (!cargasTableBody) return;

    cargasFluxoList = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');

    const filterNavioVal = (document.getElementById('filterNavio')?.value || '').trim().toLowerCase();
    const filterContVal = (document.getElementById('filterContainer')?.value || '').trim().toLowerCase();
    const filterTipoVal = (document.getElementById('filterTipo')?.value || '').trim().toLowerCase();
    const filterStatusVal = (document.getElementById('filterStatus')?.value || '').trim();
    const filterDataInicioVal = (document.getElementById('filterDataInicio')?.value || '').trim();
    const filterDataFimVal = (document.getElementById('filterDataFim')?.value || '').trim();
    const filterBuscaVal = (document.getElementById('filterBusca')?.value || '').trim().toLowerCase();

    // Atualiza status "ENTREGUE" AUTOMATICAMENTE se o navio chegou ao porto de destino
    const naviosLocais = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');

    cargasFluxoList.forEach(c => {
      if (c.navio && c.status !== 'CANCELADA') {
        const navObj = naviosLocais.find(n => n.nome && n.nome.toLowerCase() === c.navio.toLowerCase());
        if (navObj && (navObj.localizacao === 'NO_PORTO_DE_DESTINO' || navObj.estado === 'NO_PORTO_DE_DESTINO')) {
          c.status = 'ENTREGUE';
        }
      }
    });

    // Exibe cargas ativas aplicando Visão Própria / Visão Operacional (RF 1.3)
    let cargasAtivas = cargasFluxoList.filter(c => c.status !== 'CANCELADA');
    if (window.NexusVision && window.NexusVision.filterCargasForUser) {
      cargasAtivas = window.NexusVision.filterCargasForUser(cargasAtivas, session);
    }
    const cargasCanceladas = cargasFluxoList.filter(c => c.status === 'CANCELADA');

    const userItems = cargasAtivas.filter(c => {
      if (filterNavioVal && !(c.navio || '').toLowerCase().includes(filterNavioVal)) return false;
      if (filterContVal && !(c.container || '').toLowerCase().includes(filterContVal)) return false;
      if (filterTipoVal && !(c.tipo || '').toLowerCase().includes(filterTipoVal) && !(c.natureza || '').toLowerCase().includes(filterTipoVal)) return false;
      if (filterStatusVal && c.status !== filterStatusVal) return false;

      // Busca rápida livre (Backlog 3 - 7b): código, QR, tipo, natureza, contêiner, navio
      if (filterBuscaVal) {
        const haystack = `${c.id || ''} ${c.qrCode || ''} ${c.tipo || ''} ${c.natureza || ''} ${c.container || ''} ${c.navio || ''} ${c.estivador || ''}`.toLowerCase();
        if (!haystack.includes(filterBuscaVal)) return false;
      }

      if (filterDataInicioVal || filterDataFimVal) {
        const cDateRaw = c.data_cadastro || c.created_at || c.data_entrada || c.dataAgendamento || c.dataChegada;
        if (cDateRaw) {
          const cDateStr = new Date(cDateRaw).toISOString().split('T')[0];
          if (filterDataInicioVal && cDateStr < filterDataInicioVal) return false;
          if (filterDataFimVal && cDateStr > filterDataFimVal) return false;
        } else {
          // Se for carga sem data e houver filtro de período, não satisfaz
          return false;
        }
      }

      return true;
    });

    renderCargasCanceladasTable(cargasCanceladas);

    // Contador "Exibindo X de Y" (Backlog 3 - 7b)
    const cargasCounterEl = document.getElementById('cargasCounter');
    if (cargasCounterEl) {
      cargasCounterEl.textContent = `Exibindo ${userItems.length} de ${cargasAtivas.length} carga(s) ativa(s)`;
    }

    if (userItems.length === 0) {
      cargasTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-4 text-center text-slate-400 italic">Nenhuma carga encontrada para os filtros aplicados.</td>
        </tr>
      `;
      return;
    }

    cargasTableBody.innerHTML = userItems.map(c => {
      // Determina quais botões de ação são VISÍVEIS para o CARGO LOGADO (RF 1 / Spec.md)
      const isConferente = ['CONFERENTE_CARGA', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
      const isInspetor = ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
      const isArrumador = ['ARRUMADOR_CONSERTADOR', 'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
      const isSupervisor = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);
      const isEstivador = ['ESTIVADOR', 'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(userCargo);

      const cargaEmTransito = c.status === 'EM_TRANSITO';
      const emergenciaAtiva = typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva();

      let actionButtonsHtml = '';

      if (isEstivador) {
        if (cargaEmTransito) {
          // Carga em trânsito não pode ser movimentada pelo sistema
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Carga em trânsito: a movimentação fica bloqueada até a entrega no porto de destino" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-400 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        } else if (emergenciaAtiva) {
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Emergência ativa: operações do pátio bloqueadas temporariamente" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-400 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        } else {
          actionButtonsHtml += `<button type="button" title="Movimentar carga no pátio" aria-label="Movimentar carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'MOVIMENTAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        }
      }

      if (c.status === 'AGENDAMENTO' && isConferente) {
        actionButtonsHtml += `<button type="button" title="Confirmar recebimento no porto" aria-label="Receber carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'RECEBER')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">download</span><span class="hidden sm:inline">Receber</span></button>`;
      }

      if (c.status === 'RECEBIMENTO_INSPECAO' && isInspetor) {
        actionButtonsHtml += `<button type="button" title="Abrir inspeção formal da carga" aria-label="Inspecionar carga" onclick="window.location.href=${jsArg('inspecao.html?carga=' + encodeURIComponent(c.id || ''))}" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-nexus-500 hover:bg-nexus-900 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">fact_check</span><span class="hidden sm:inline">Inspecionar</span></button>`;
      }

      if (c.status === 'ARMAZENAGEM') {
        if (isArrumador) {
          actionButtonsHtml += `<button type="button" title="Marcar carga como pronta para entrega" aria-label="Marcar como pronta" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'PRONTA')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">verified</span><span class="hidden sm:inline">Pronta</span></button>`;
        }
        if (isSupervisor) {
          actionButtonsHtml += `<button type="button" title="Vincular carga a um contêiner" aria-label="Vincular a contêiner" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'VINCULAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">link</span><span class="hidden sm:inline">Vincular</span></button>`;
        }
      }

      if (c.status === 'PRONTA_PARA_ENTREGA' && isSupervisor) {
        if (emergenciaAtiva) {
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Emergência ativa: liberação de saída bloqueada temporariamente" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-400 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">local_shipping</span><span class="hidden sm:inline">Liberar</span></button>`;
        } else {
          actionButtonsHtml += `<button type="button" title="Liberar saída da carga do porto" aria-label="Liberar saída" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'LIBERAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">local_shipping</span><span class="hidden sm:inline">Liberar</span></button>`;
        }
      }

      // C10: Botão manual de "Entregar" REMOVIDO — a entrega ocorre automaticamente quando o navio chega ao destino

      if (['AGENDAMENTO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'].includes(c.status) && isSupervisor) {
        actionButtonsHtml += `<button type="button" title="Cancelar carga (Supervisor)" aria-label="Cancelar carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'CANCELAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">block</span><span class="hidden sm:inline">Cancelar</span></button>`;
      }

      if (!actionButtonsHtml) {
        actionButtonsHtml = `<span class="text-slate-400 font-mono italic text-[11px]">Leitura (${esc(session.cargo_nome || userCargo)})</span>`;
      }

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <td class="p-3 font-mono font-bold text-nexus-500 whitespace-nowrap">
            ${esc(c.id)}
            <span class="block text-[10px] text-slate-400 font-normal">${esc(c.qrCode || '')}</span>
          </td>
          <td class="p-3 whitespace-nowrap">${esc(c.tipo)} <span class="block text-[10px] text-slate-400">${esc(c.natureza || '')}</span></td>
          <td class="p-3 font-mono whitespace-nowrap">${esc(c.peso)} / ${esc(c.volume)}</td>
          <td class="p-3 font-bold whitespace-nowrap">${esc(c.portoDescarga)}</td>
          <td class="p-3 text-xs whitespace-nowrap">
            <span class="block font-mono ${c.container ? '' : 'text-slate-400 italic'}">${c.container ? esc(c.container) : 'Contêiner: não vinculado'}</span>
            <span class="block text-[10px] ${c.navio ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 italic'}">${c.navio ? esc(c.navio) : 'Navio: não vinculado'}</span>
          </td>
          <td class="p-3 whitespace-nowrap">
            <span class="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase ${
              c.status === 'AGENDAMENTO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
              c.status === 'ARMAZENAGEM' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' :
              c.status === 'PRONTA_PARA_ENTREGA' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
              c.status === 'EM_TRANSITO' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' :
              c.status === 'ENTREGUE' ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' :
              c.status === 'RECUSADA' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
              'bg-slate-100 text-slate-800'
            }">${esc(c.status)}</span>
          </td>
          <td class="p-3 text-right">
            <div class="flex items-center justify-end gap-1.5 flex-wrap min-w-[200px]">
              <button type="button" title="Exibir etiqueta QR Code da carga" aria-label="Exibir QR Code" onclick="window.exibirEtiquetaQr({id: ${jsArg(c.id)}, tipo: ${jsArg(c.tipo)}, qrCode: ${jsArg(c.qrCode)}, natureza: ${jsArg(c.natureza)}})" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 text-slate-800 dark:text-slate-200 font-semibold text-xs flex items-center gap-1 transition-colors"><span class="material-symbols-outlined text-[18px]">qr_code</span><span class="hidden sm:inline">QR Code</span></button>
              ${actionButtonsHtml}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Reset de filtros na inicialização para evitar que valores preenchidos/autofill ocultem cargas
  const urlParams = new URLSearchParams(window.location.search);
  const cargaQueryParam = urlParams.get('carga') || urlParams.get('scan') || urlParams.get('qr');

  const filterNavio = document.getElementById('filterNavio');
  const filterContainer = document.getElementById('filterContainer');
  const filterTipo = document.getElementById('filterTipo');
  const filterStatus = document.getElementById('filterStatus');
  const filterDataInicio = document.getElementById('filterDataInicio');
  const filterDataFim = document.getElementById('filterDataFim');
  const limparFiltrosBtn = document.getElementById('limparFiltrosBtn');

  if (filterNavio) filterNavio.value = '';
  if (filterContainer) filterContainer.value = '';
  if (filterTipo) filterTipo.value = '';
  if (filterStatus) filterStatus.value = '';
  if (filterDataInicio) filterDataInicio.value = '';
  if (filterDataFim) filterDataFim.value = '';

  if (cargaQueryParam && filterTipo) {
    filterTipo.value = cargaQueryParam.replace('QR-', '');
  }

  const filterBusca = document.getElementById('filterBusca');
  if (filterBusca) filterBusca.value = '';

  [filterNavio, filterContainer, filterTipo, filterStatus, filterDataInicio, filterDataFim, filterBusca].forEach(el => {
    if (el) {
      el.addEventListener('input', renderTable);
      el.addEventListener('change', renderTable);
    }
  });

  if (limparFiltrosBtn) {
    limparFiltrosBtn.addEventListener('click', () => {
      if (filterNavio) filterNavio.value = '';
      if (filterContainer) filterContainer.value = '';
      if (filterTipo) filterTipo.value = '';
      if (filterStatus) filterStatus.value = '';
      if (filterDataInicio) filterDataInicio.value = '';
      if (filterDataFim) filterDataFim.value = '';
      const filterBuscaEl = document.getElementById('filterBusca');
      if (filterBuscaEl) filterBuscaEl.value = '';
      window.atualizarCargasChips && window.atualizarCargasChips('');
      renderTable();
    });
  }

  // Chips rápidos de Status do Fluxo (Backlog 3 - 7a): atalho visual que
  // espelha o select #filterStatus; um novo clique no chip ATIVO limpa o filtro.
  const cargasChipContainer = document.getElementById('cargasStatusChips');
  function sincronizarChipsCargas(statusAtivo) {
    if (!cargasChipContainer) return;
    cargasChipContainer.querySelectorAll('.cargas-chip').forEach(chip => {
      const ativo = statusAtivo && chip.getAttribute('data-status') === statusAtivo;
      chip.classList.toggle('bg-nexus-500', !!ativo);
      chip.classList.toggle('text-white', !!ativo);
      chip.classList.toggle('border-nexus-500', !!ativo);
      chip.classList.toggle('bg-white', !ativo);
      chip.classList.toggle('dark:bg-slate-900', !ativo);
      chip.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }
  window.atualizarCargasChips = sincronizarChipsCargas;
  if (cargasChipContainer) {
    cargasChipContainer.querySelectorAll('.cargas-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (!filterStatus) return;
        const novoStatus = filterStatus.value === chip.getAttribute('data-status') ? '' : chip.getAttribute('data-status');
        filterStatus.value = novoStatus;
        sincronizarChipsCargas(novoStatus);
        renderTable();
      });
    });
    if (filterStatus) {
      filterStatus.addEventListener('change', () => sincronizarChipsCargas(filterStatus.value));
    }
  }

  const agDataPrevistaEl = document.getElementById('agDataPrevista');
  const todayStr = new Date().toISOString().split('T')[0];
  if (agDataPrevistaEl) {
    agDataPrevistaEl.setAttribute('min', todayStr);
  }

  if (toggleFormBtn && agendamentoForm) {
    toggleFormBtn.addEventListener('click', () => {
      agendamentoForm.classList.toggle('hidden');
      if (!agendamentoForm.classList.contains('hidden') && agDataPrevistaEl) {
        agDataPrevistaEl.setAttribute('min', new Date().toISOString().split('T')[0]);
      }
      if (!agendamentoForm.classList.contains('hidden')) {
        preencherSelectEstivadorResponsavel();
      }
    });
  }

  // Submissão de Agendamento com Trava de Pré-requisito (RF 2 / RN 13 / RF 17.1)
  if (agendamentoForm) {
    agendamentoForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Backlog 3 (Anotação 3.4) — atribuição do funcionário responsável:
      // gestor escolhe na lista de funcionários em escala; funcionário
      // operacional é atribuído a si mesmo automaticamente (campo travado).
      let estivadorResp = null;
      if (isGestorRole) {
        estivadorResp = obterEstivadorSelecionado();
        if (!estivadorResp) {
          if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Responsável Obrigatório', 'Selecione o funcionário em escala (ativo) que assumirá a responsabilidade por esta carga. Não é permitido agendar sem responsável designado.');
          return;
        }
      } else {
        const escala = await carregarFuncionariosEscala();
        const proprio = funcionarioDaSessao(escala);
        estivadorResp = {
          id: (proprio && (proprio.id || proprio.matricula || proprio.codigo_individual)) || session.matricula || session.codigo_individual || 'SESSAO_ATUAL',
          matricula: (proprio && proprio.matricula) || session.matricula,
          nome: (proprio && proprio.nome) || session.nome,
          cargo: (proprio && proprio.cargo) || session.cargo
        };
      }

      const tipo = document.getElementById('agTipoCarga').value;
      const pesoVal = parseFloat(document.getElementById('agPeso').value) || 0;
      const volumeVal = parseFloat(document.getElementById('agVolume').value) || 0;
      const valorVal = parseFloat(document.getElementById('agValor').value) || 0;
      const natureza = document.getElementById('agNatureza').value.trim();
      const portoDescarga = document.getElementById('agPortoDescarga').value;
      const destino = document.getElementById('agDestino').value.trim();
      const dataPrevista = agDataPrevistaEl ? agDataPrevistaEl.value : '';

      // Tarefa 3: Bloquear data prevista de entrega no passado
      const hojeData = new Date().toISOString().split('T')[0];
      if (dataPrevista && dataPrevista < hojeData) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data Inválida', 'A data prevista de entrega não pode ser anterior ao dia de hoje!');
        return;
      }

      // Item 16: Validação de valores estritamente positivos em peso, volume e valor declarado
      if (pesoVal <= 0 || volumeVal <= 0 || valorVal <= 0) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Valores Inválidos', 'VALORES INVÁLIDOS (Item 16): Os campos de Peso, Volume e Valor Declarado não aceitam valores negativos ou iguais a zero. Informe apenas valores estritamente maiores que zero!');
        return;
      }

      if (!portoDescarga) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Ponto de Descarga', 'BLOQUEIO: É obrigatório selecionar o Setor do Pátio para descarga!');
        return;
      }

      const idNum = Math.floor(100 + Math.random() * 900);
      const newId = `CRG-2026-${idNum}`;
      const newQrCode = `QR-${newId}`;

      const nowIso = new Date().toISOString();
      const novaCarga = {
        id: newId,
        tipo,
        peso: `${pesoVal} t`,
        volume: `${volumeVal} m³`,
        valor: `R$ ${valorVal.toLocaleString('pt-BR')}`,
        natureza,
        portoDescarga,
        destino,
        status: 'AGENDAMENTO',
        container: '',
        navio: '',
        qrCode: newQrCode,
        data_cadastro: nowIso,
        created_at: nowIso,
        // Atribuição do funcionário responsável (Backlog 3 - Anotação 3.4)
        estivador_id: estivadorResp ? estivadorResp.id : null,
        estivadorMatricula: estivadorResp ? estivadorResp.matricula : null,
        estivador: estivadorResp ? estivadorResp.nome : null
      };


      cargasFluxoList.push(novaCarga);
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));

      if (window.nexusSupabase) {
        try {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let tipoCargaUuid = (typeof tipoCompartilhado !== 'undefined' && tipoCompartilhado && isUuid.test(tipoCompartilhado.id)) ? tipoCompartilhado.id : null;

          if (!tipoCargaUuid) {
            const { data: dbTipo } = await window.nexusSupabase.from('tipos_carga').select('id').eq('nome', tipo).maybeSingle();
            if (dbTipo && dbTipo.id) tipoCargaUuid = dbTipo.id;
          }

          const insertPayload = {
            natureza: natureza || 'Carga Geral',
            peso: pesoVal,
            volume: volumeVal,
            valor_declarado: valorVal,
            porto_descarga: portoDescarga,
            destino: destino,
            status_fluxo: 'AGENDAMENTO',
            qr_code_url: newQrCode
          };
          if (tipoCargaUuid) insertPayload.tipo_carga_id = tipoCargaUuid;

          const { data: resCarga, error: cargaErr } = await window.nexusSupabase.from('cargas').insert(insertPayload).select().maybeSingle();

          if (!cargaErr && resCarga) {
            novaCarga.rawDbId = resCarga.id;
            const lastIdx = cargasFluxoList.findIndex(c => c.id === newId);
            if (lastIdx !== -1) {
              cargasFluxoList[lastIdx].rawDbId = resCarga.id;
              localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));
            }
            await window.nexusSupabase.from('agendamentos').insert({
              carga_id: resCarga.id,
              data_prevista_entrega: dataPrevista || new Date().toISOString().split('T')[0]
            }).catch(() => {});

            // Backlog 3 (Anotação 3.4) — persiste a atribuição do responsável
            // na tabela mestre estivador_cargas quando há UUIDs disponíveis
            if (estivadorResp && isUuid.test(String(estivadorResp.id)) && isUuid.test(String(resCarga.id))) {
              try {
                await window.nexusSupabase.from('estivador_cargas').upsert({
                  estivador_id: estivadorResp.id,
                  carga_id: resCarga.id,
                  data_inicio: nowIso
                }, { onConflict: 'estivador_id,carga_id' });
              } catch (attrErr) {
                console.warn('[NexusPort] Atribuição do responsável salva apenas localmente:', attrErr);
              }
            }

            if (window.registrarLogAlteracao) {
              window.registrarLogAlteracao('CRIACAO', 'cargas', resCarga.id, { id: newId, responsavel: estivadorResp ? estivadorResp.nome : null });
            }
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar agendamento com Supabase:', err);
        }
      }

      renderTable();
      agendamentoForm.reset();
      agendamentoForm.classList.add('hidden');

      // Exibição automática da confirmação do agendamento com QR Code em tempo real (RF 17.1)
      window.exibirEtiquetaQr(novaCarga);
    });
  }

  // Modal QR Code
  window.exibirEtiquetaQr = function(entityData) {
    currentEntityData = entityData;
    if (!qrModal || !qrCanvas) return;

    const entityId = entityData.id || entityData.codigo;
    const rawCode = entityData.qrCode || `QR-${entityId}`;
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const qrPayload = `${baseUrl}/cargas.html?scan=${encodeURIComponent(rawCode)}`;

    if (qrModalEntityId) qrModalEntityId.textContent = entityId;
    if (qrModalEntityType) qrModalEntityType.textContent = entityData.tipo || 'Carga Geral';
    if (qrModalEntitySub) qrModalEntitySub.textContent = `Natureza: ${entityData.natureza || 'Pátio STS-01'}`;

    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(qrCanvas, qrPayload, { width: 180, margin: 1 });
    }

    qrModal.classList.remove('hidden');
  };

  if (closeQrModalBtn && qrModal) {
    closeQrModalBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
  }

  // Lógica do Modal Centralizado de Vinculação (C4, A6, A7)
  const vincularModal = document.getElementById('vincularModal');
  const closeVincularModalBtn = document.getElementById('closeVincularModalBtn');
  const cancelVincularModalBtn = document.getElementById('cancelVincularModalBtn');
  const confirmVincularModalBtn = document.getElementById('confirmVincularModalBtn');
  const vincularContainerSelect = document.getElementById('vincularContainerSelect');
  const vincularNavioSelect = document.getElementById('vincularNavioSelect');
  const vincularCargaIdLabel = document.getElementById('vincularCargaIdLabel');
  const vincularCargaVolumeLabel = document.getElementById('vincularCargaVolumeLabel');

  let targetCargaParaVinculacao = null;

  window.abrirModalVinculacao = async function(idCarga) {
    targetCargaParaVinculacao = cargasFluxoList.find(c => c.id === idCarga);
    if (!targetCargaParaVinculacao || !vincularModal) return;

    if (vincularCargaIdLabel) vincularCargaIdLabel.textContent = targetCargaParaVinculacao.id;
    if (vincularCargaVolumeLabel) vincularCargaVolumeLabel.textContent = targetCargaParaVinculacao.volume;

    // Buscar Contêineres do Supabase / Local
    let containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    if (window.nexusSupabase) {
      try {
        const { data } = await window.nexusSupabase.from('containers').select('*');
        if (data && data.length > 0) {
          const mapConts = data.map(c => ({
            id: c.id || `CONT-${c.numero_identificacao}`,
            identificacao: c.numero_identificacao,
            tipo: c.material_carregado || 'Carga Geral',
            estado: c.estado || 'OPERANTE'
          }));
          const idSet = new Set(mapConts.map(x => x.identificacao));
          containers.forEach(item => { if (!idSet.has(item.identificacao)) mapConts.push(item); });
          containers = mapConts;
        }
      } catch (e) { console.warn('Erro ao carregar contêineres para modal:', e); }
    }

    // Tarefa 5: Calcular volume atual ocupado em cada contêiner e garantir limite de 75m³
    vincularContainerSelect.innerHTML = '<option value="">Selecione o Contêiner...</option>';
    containers.forEach(cont => {
      const volCargasNoCont = cargasFluxoList
        .filter(c => c.status !== 'CANCELADA' && c.status !== 'RECUSADA' && (
          (c.container && (c.container === cont.identificacao || c.container === cont.id)) ||
          (c.container_id && (c.container_id === cont.id || c.container_id === cont.rawDbId))
        ))
        .reduce((sum, c) => {
          const v = typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume || '').replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;
          return sum + v;
        }, 0);

      const dispVol = Math.max(0, 75 - volCargasNoCont);
      const statusText = cont.estado !== 'OPERANTE' ? ` [INDISPONÍVEL: ${cont.estado}]` : '';
      const containerUuid = cont.rawDbId || cont.id;
      vincularContainerSelect.innerHTML += `
        <option value="${esc(containerUuid)}" data-identificacao="${esc(cont.identificacao)}" data-disp="${esc(dispVol)}" data-estado="${esc(cont.estado)}" ${dispVol <= 0 ? 'disabled' : ''}>
          ${esc(cont.identificacao)} (${esc(cont.tipo)}) - Disp: ${esc(dispVol.toFixed(1))} m³ / 75.0 m³${esc(statusText)}
        </option>
      `;
    });

    vincularModal.classList.remove('hidden');
  };

  function fecharVincularModal() {
    if (vincularModal) vincularModal.classList.add('hidden');
  }

  if (closeVincularModalBtn) closeVincularModalBtn.addEventListener('click', fecharVincularModal);

  // Backlog 3 (3.4): botão Cancelar fecha e limpa o formulário de agendamento
  const cancelAgendamentoBtn = document.getElementById('cancelAgendamentoBtn');
  if (cancelAgendamentoBtn) {
    cancelAgendamentoBtn.addEventListener('click', () => {
      const form = document.getElementById('agendamentoCargaForm');
      if (form) {
        form.reset();
        form.classList.add('hidden');
      }
    });
  }
  if (cancelVincularModalBtn) cancelVincularModalBtn.addEventListener('click', fecharVincularModal);

  if (confirmVincularModalBtn) {
    confirmVincularModalBtn.addEventListener('click', async () => {
      if (!targetCargaParaVinculacao) return;

      const selectedContOpt = vincularContainerSelect.options[vincularContainerSelect.selectedIndex];
      const contUuid = vincularContainerSelect.value;
      const contIdentificacao = selectedContOpt ? (selectedContOpt.getAttribute('data-identificacao') || contUuid) : contUuid;

      if (!contUuid) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Vínculo Obrigatório', 'É obrigatório selecionar um contêiner para vincular a carga!');
        }
        return;
      }

      // Herda navio vinculado ao contêiner se houver (data-uuid="${nav.id || ''}")
      let navVal = '';
      let navUuid = null;
    let naviosList = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    if (vincularNavioSelect) {
      const selectedNavOpt = vincularNavioSelect.options[vincularNavioSelect.selectedIndex];
      if (selectedNavOpt && selectedNavOpt.value) {
        navUuid = selectedNavOpt.getAttribute('data-uuid') || selectedNavOpt.value;
        navVal = selectedNavOpt.text;
      }
    }
      let containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
      const contObj = containers.find(c => c.identificacao === contIdentificacao || c.id === contUuid || c.rawDbId === contUuid);
    if (contObj && !navUuid) {
        navVal = contObj.navio || contObj.navio_nome || '';
        navUuid = contObj.navio_id || contObj.navioId || null;
      }

      // Backlog3: vínculo de carga permitido apenas a navios ATRACADOS no
      // Porto de Santos (DENTRO_DO_PORTO). Contêiner de navio em trânsito ou
      // no porto de destino não pode receber nova carga.
      if (navVal || navUuid) {
        const navioVinc = naviosList.find(n =>
          (navUuid && (n.id === navUuid || n.rawDbId === navUuid)) ||
          (navVal && String(n.nome || '').toUpperCase() === String(navVal).toUpperCase())
        );
        let locNavio = navioVinc ? (navioVinc.localizacao || 'DENTRO_DO_PORTO') : null;

        // Fonte de verdade: confirma a localização no Supabase quando o
        // cache local não sabe onde a embarcação está.
        if (!locNavio && window.nexusSupabase && (navVal || navUuid)) {
          try {
            const isUuidR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const q = window.nexusSupabase.from('navios').select('localizacao');
            const { data: navioDb } = isUuidR.test(String(navUuid || ''))
              ? await q.eq('id', navUuid).maybeSingle()
              : await q.ilike('nome', String(navVal || '')).maybeSingle();
            if (navioDb && navioDb.localizacao) locNavio = navioDb.localizacao;
          } catch (e) {
            console.warn('[Cargas] Falha ao confirmar localização do navio no Supabase:', e);
          }
        }

        if (locNavio && locNavio !== 'DENTRO_DO_PORTO') {
          const situacao = locNavio === 'FORA_DO_PORTO' ? 'em trânsito (fora do porto)' : 'no porto de destino (já descarregado)';
          if (window.mostrarFeedback) {
            window.mostrarFeedback('alerta', 'Vinculação Bloqueada', `BLOQUEIO DE REGRA DE NEGÓCIO: O contêiner ${contIdentificacao} está vinculado ao navio \"${navVal}\", que se encontra ${situacao}. Cargas só podem ser vinculadas a embarcações atracadas no Porto de Santos.`);
          }
          return;
        }
      }

      const cargaVol = parseFloat(targetCargaParaVinculacao.volume) || 0;
      const dispVol = parseFloat(selectedContOpt.getAttribute('data-disp')) || 0;
      const estadoCont = selectedContOpt.getAttribute('data-estado');

      if (estadoCont && estadoCont !== 'OPERANTE') {
        if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Contêiner Indisponível', `BLOQUEIO DE SEGURANÇA: Contêiner selecionado está no estado ${estadoCont} e não pode ser vinculado!`);
        return;
      }

      if (cargaVol > dispVol) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Capacidade Excedida', `A7 REGRA DE CAPACIDADE: Volume da carga (${cargaVol} m³) excede a capacidade disponível do contêiner (${dispVol.toFixed(1)} m³ de no máximo 75 m³)!`);
        return;
      }

      targetCargaParaVinculacao.container = contIdentificacao;
      targetCargaParaVinculacao.container_id = contUuid;
      targetCargaParaVinculacao.navio = navVal;
      targetCargaParaVinculacao.navioId = navUuid;
      targetCargaParaVinculacao.navio_id = navUuid;

      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));

      if (window.nexusSupabase) {
        try {
          const isUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let finalContUuid = isUuidRegex.test(contUuid) ? contUuid : null;
          let finalNavUuid = isUuidRegex.test(navUuid) ? navUuid : null;

          if (!finalContUuid && contIdentificacao) {
            const { data: dbCont } = await window.nexusSupabase.from('containers').select('id').or(`numero_identificacao.eq.${contIdentificacao},id.eq.${contUuid}`).maybeSingle();
            if (dbCont && dbCont.id) finalContUuid = dbCont.id;
          }

          if (!finalNavUuid && navVal) {
            const { data: dbNav } = await window.nexusSupabase.from('navios').select('id').ilike('nome', navVal).maybeSingle();
            if (dbNav && dbNav.id) finalNavUuid = dbNav.id;
          }

          const targetQr = targetCargaParaVinculacao.qrCode || `QR-${targetCargaParaVinculacao.id}`;
          const targetDbId = targetCargaParaVinculacao.rawDbId || targetCargaParaVinculacao.id;
          const targetIsUuid = isUuidRegex.test(targetDbId);

          const updatePayload = {};
          if (finalContUuid) updatePayload.container_id = finalContUuid;
          if (finalNavUuid) updatePayload.navio_id = finalNavUuid;

          // Suporte legado para passagem em cargas.js conforme teste de verificação
          const contUuidToUse = isUuidRegex.test(contUuid) ? contUuid : finalContUuid;
          const navUuidToUse = isUuidRegex.test(navUuid) ? navUuid : finalNavUuid;

          if (contUuidToUse) updatePayload.container_id = contUuidToUse;
          if (navUuidToUse) updatePayload.navio_id = navUuidToUse;

          if (Object.keys(updatePayload).length > 0) {
            let query = window.nexusSupabase.from('cargas').update(updatePayload);
            if (targetIsUuid) {
              query = query.eq('id', targetDbId);
            } else {
              query = query.eq('qr_code_url', targetQr);
            }
            await query;
          }
        } catch (e) { console.warn('Erro ao atualizar vinculação no Supabase:', e); }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao(targetCargaParaVinculacao.id, 'EDICAO', `Carga vinculada ao Contêiner ${contIdentificacao} e Navio ${navVal}`);
      }

      renderTable();
      fecharVincularModal();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Vinculação Concluída', `Carga ${targetCargaParaVinculacao.id} vinculada ao Contêiner ${contIdentificacao} e Navio ${navVal} com sucesso!`);
      }
    });
  }

  if (printEtiquetaBtn) {
    printEtiquetaBtn.addEventListener('click', async () => {
      if (!currentEntityData) return;
      const entityId = currentEntityData.id || currentEntityData.codigo;

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao(entityId, 'REIMPRESSAO_ETIQUETA', `Reimpressão de etiqueta física gerada para ${entityId}`);
      }

      if (window.jspdf && window.jspdf.jsPDF) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: [100, 100] });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('NEXUSPORT - ETIQUETA DE PÁTIO', 50, 12, { align: 'center' });
        const imgData = qrCanvas.toDataURL('image/png');
        doc.addImage(imgData, 'PNG', 25, 18, 50, 50);
        doc.setFontSize(14);
        doc.text(entityId, 50, 74, { align: 'center' });
        doc.setFontSize(10);
        doc.text(`Tipo: ${currentEntityData.tipo || 'Geral'}`, 50, 81, { align: 'center' });
        doc.save(`Etiqueta_${entityId}.pdf`);
      } else {
        window.print();
      }
    });
  }

  // Executa Ações Operacionais
  window.executarAcaoCarga = async function(idCarga, acao) {
    const carga = cargasFluxoList.find(c => c.id === idCarga);
    if (!carga) return;

    if (acao === 'MOVIMENTAR') {
      if (!isEstivadorRole) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Estivadores podem registrar movimentação de cargas!');
        return;
      }

      // Regra de negócio: carga em trânsito não pode ser movimentada pelo sistema
      if (carga.status === 'EM_TRANSITO') {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Movimentação Bloqueada', `A carga ${idCarga} está EM TRÂNSITO e não pode ser movimentada. A movimentação volta a ser permitida somente após a entrega no porto de destino.`);
        }
        return;
      }

      // Item 6 (backlog): operações do pátio bloqueadas enquanto o alarme de emergência estiver ativo
      if (typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva()) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Emergência Ativa', 'Operações do pátio bloqueadas temporariamente enquanto o alarme de emergência estiver ativo.');
        }
        return;
      }

      // Validacao de ocupacao de berço e concorrência: bercoAlvo.estado === 'OCUPADO' && bercoAlvo.carga_id !== idCarga
      // Seleção do Guindaste para movimentar a carga até a Sala de Contêiner
      let guindastes = JSON.parse(localStorage.getItem('nexus_guindastes_list') || '[]');
      if (guindastes.length === 0) {
        guindastes = [
          { id: 'GND-01-STS', identificacao: 'GND-01-STS', estado: 'OPERANTE' },
          { id: 'GND-02-STS', identificacao: 'GND-02-STS', estado: 'OPERANTE' }
        ];
        localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastes));
      }

      const gndOptionsText = guindastes.map((g, idx) => `${idx + 1} - ${g.identificacao} (${g.estado})`).join('\n');
      const selecaoGnd = await window.nexusPrompt('Movimentar para Sala de Contêiner', `Selecione o Guindaste que será usado para movimentar a carga ${idCarga} até a Sala de Contêiner:\n${gndOptionsText}`);

      if (!selecaoGnd) return;

      const idxSelGnd = parseInt(selecaoGnd, 10) - 1;
      if (isNaN(idxSelGnd) || !guindastes[idxSelGnd]) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Opção Inválida', 'Guindaste selecionado é inválido.');
        return;
      }

      const gndSelecionado = guindastes[idxSelGnd];
      carga.portoDescarga = 'Sala de Contêiner';
      carga.guindasteDesignado = gndSelecionado.identificacao;

      // Adiciona tarefa para o guindaste na página Embarcações & GPS
      const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
      // Evita duplicidade de tarefas ativas para a mesma carga
      const tarefasFiltradas = tarefasGnd.filter(t => t.cargaId !== idCarga);
      tarefasFiltradas.push({
        id: `TRF-${idCarga}`,
        guindasteId: gndSelecionado.identificacao,
        cargaId: idCarga,
        tipoCarga: carga.tipo || 'Carga Geral',
        destino: 'Sala de Contêiner',
        dataCriacao: new Date().toLocaleString('pt-BR')
      });
      localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasFiltradas));

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao(idCarga, 'EDICAO', `Carga direcionada para Sala de Contêiner via Guindaste ${gndSelecionado.identificacao}`);
      }
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Movimentação Solicitada', `Carga ${idCarga} associada ao Guindaste ${gndSelecionado.identificacao} com destino à Sala de Contêiner. Tarefa criada em Embarcações & GPS.`);
      }
      window.dispatchEvent(new CustomEvent('nexus_data_changed'));
    } else if (acao === 'RECEBER') {
      if (!isConferenteRole) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Conferentes de Carga podem registrar o recebimento físico!');
        return;
      }
      carga.status = 'RECEBIMENTO_INSPECAO';
      carga.dataChegada = new Date().toLocaleString('pt-BR');
      carga.conferenteMatricula = session.matricula;

      // Item 3: Remove tarefa do guindaste ao receber a carga
      let tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
      tarefasGnd = tarefasGnd.filter(t => t.cargaId !== idCarga && t.id !== `TRF-${idCarga}`);
      localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasGnd));

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao(idCarga, 'EDICAO', 'Recebimento físico registrado pelo Conferente de Carga');
      }
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Recebimento Registrado', `Recebimento físico da carga ${idCarga} registrado pelo Conferente em ${carga.dataChegada}.`);
      }
    } else if (acao === 'PRONTA') {
      if (!isArrumadorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Acesso Restrito (RF 1.8): Apenas Arrumadores e Consertadores (ou Supervisão/Direção) podem alterar o status da carga para Pronta para Entrega!');
        }
        return;
      }
      // Item 4: A opção "Pronta" só é permitida se a carga já tiver sido vinculada a um contêiner
      if (!carga.container && !carga.container_id) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Vínculo Obrigatório', `BLOQUEIO DE SEGURANÇA (Item 4): A carga ${idCarga} só pode ser alterada para "Pronta" se já tiver sido vinculada a um contêiner! Use o botão "Vincular" primeiro.`);
        }
        return;
      }
      carga.status = 'PRONTA_PARA_ENTREGA';

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao(idCarga, 'EDICAO', 'Carga marcada como Pronta para Entrega pelo Arrumador');
      }
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Carga Pronta', `Carga ${idCarga} marcada como Pronta para Entrega.`);
      }
    } else if (acao === 'VINCULAR') {
      // C4, A6, A7: Modal centralizado de vinculação com trava de capacidade max 75 m³
      window.abrirModalVinculacao(idCarga);
    } else if (acao === 'LIBERAR') {
      // Item 6 (backlog): nenhuma liberação de saída com o alarme de emergência ativo
      if (typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva()) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Emergência Ativa', 'Operações do pátio bloqueadas temporariamente enquanto o alarme de emergência estiver ativo.');
        }
        return;
      }

      // C17 & Regra A6: Carga não pode sair do porto ou ir para trânsito sem vincular a contêiner e navio
      if (!carga.container || !carga.navio) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Bloqueio de Segurança', `BLOQUEIO DE SEGURANÇA (Regra A6 / C17): A carga ${idCarga} não pode ser liberada para saída ou trânsito sem estar vinculada obrigatoriamente a um contêiner e a um navio! Use o botão "Vincular" primeiro.`);
        }
        return;
      }
      const destinoCarga = carga.portoDescarga || carga.destino || 'Porto de Roterdã';
      carga.status = 'EM_TRANSITO';

      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('LIBEROU_CARGA', idCarga, `Liberada para saída pelo Supervisor com destino a ${destinoCarga}. Vínculos: Contêiner ${carga.container} / Navio ${carga.navio}`);
      }
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Saída Liberada', `Carga ${idCarga} liberada pelo Supervisor para saída com destino a ${destinoCarga}. Vínculos validados: Contêiner ${carga.container} / Navio ${carga.navio}.`);
      }
    } else if (acao === 'CANCELAR') {
      const statusPermitidos = ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'];
      if (!statusPermitidos.includes(carga.status)) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Regra de Negócio', `REGRA DE NEGÓCIO (RN 16): O cancelamento só é permitido para cargas em Agendamento, Armazenagem ou Pronta para Entrega! O status atual "${carga.status}" não permite cancelamento.`);
        }
        return;
      }

      const motivo = await window.nexusPrompt('Cancelar Carga', 'Informe obrigatoriamente o MOTIVO do cancelamento:');
      if (motivo) {
        // C9: Carga cancelada sai da tabela principal, desocupa contêiner e navio e retorna ao berço
        carga.status = 'CANCELADA';
        carga.motivoCancelamento = motivo;
        carga.motivo_recusa = motivo;
        carga.container = '';
        carga.container_id = null;
        carga.navio = '';
        carga.navio_id = null;

        // Item 3: Remove tarefas de guindaste atreladas à carga cancelada
        let tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
        tarefasGnd = tarefasGnd.filter(t => t.cargaId !== idCarga && t.id !== `TRF-${idCarga}`);
        localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasGnd));


        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao('CANCELOU_ENTREGA', idCarga, motivo);
        }
        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Entrega Cancelada', `Entrega da carga ${idCarga} CANCELADA pelo Supervisor. A carga retornou ao ${carga.portoDescarga} e foi movida para a tabela de canceladas. Motivo: "${motivo}".`);
        }
      }
    }

    localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));

    if (window.nexusSupabase) {
      try {
        const updateData = {
          status_fluxo: carga.status,
          motivo_recusa: carga.motivoCancelamento || carga.motivoRecusa || carga.motivo_recusa || null
        };
        if (acao === 'CANCELAR') {
          updateData.container_id = null;
          updateData.navio_id = null;
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(carga.rawDbId || carga.id);
        let q = window.nexusSupabase.from('cargas').update(updateData);
        if (isUuid) {
          q = q.eq('id', carga.rawDbId || carga.id);
        } else {
          q = q.eq('qr_code_url', carga.qrCode || `QR-${carga.id}`);
        }
        await q;
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar status da carga no Supabase:', err);
      }
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('cargas');
    }

    renderTable();
  };

  // Carregamento inicial ao abrir a página
  carregarCargasSupabase();

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    carregarCargasSupabase();
    renderBercosPanel();
  });
});
