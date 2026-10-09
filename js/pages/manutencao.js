/**
 * Lógica do Módulo de Manutenção & OS (manutencao.html) - NexusPort
 * Gerencia Ordens de Serviço (OS), aprovação do Supervisor, alarmes de emergência e preventivas (> 3 anos).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  const toggleOsBtn = document.getElementById('toggleOsFormBtn');
  const osForm = document.getElementById('osForm');
  const osTableBody = document.getElementById('osTableBody');

  const panicBtn = document.getElementById('panicButton');
  const resetEmergencyBtn = document.getElementById('resetEmergencyBtn');
  const emergencyBanner = document.getElementById('emergencyAlertBanner');

  const isInspetor = ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
  const isSupervisor = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

  let guindastesList = JSON.parse(localStorage.getItem('nexus_guindastes_list') || '[]');

  // Item 17: Módulo de Solicitação de Manutenção de Navios
  const toggleNavioManutBtn = document.getElementById('toggleNavioManutFormBtn');
  const navioManutForm = document.getElementById('navioManutForm');
  const navioManutSelect = document.getElementById('navioManutSelect');
  let naviosListLocal = [];

  async function carregarNaviosParaManutencao() {
    if (!navioManutSelect) return;
    let navs = [];
    if (window.nexusSupabase) {
      try {
        const { data } = await window.nexusSupabase.from('navios').select('*');
        if (data && Array.isArray(data)) {
          navs = data.map(n => ({
            id: n.id,
            nome: n.nome,
            imo: n.numero_imo || n.imo,
            localizacao: n.localizacao || 'DENTRO_DO_PORTO',
            data_construcao: n.data_registro_sistema || '',
            data_ultima_manutencao_geral: ''
          }));
        }
      } catch (e) {
        console.warn('Erro ao carregar navios no módulo de manutenção:', e);
      }
    }
    if (navs.length === 0 && window.NexusRepository) {
      try { navs = await window.NexusRepository.getNavios(); } catch (e) {}
    }
    naviosListLocal = navs;

    // Regra de negócio: só é possível registrar/executar manutenção para navio
    // que esteja atualmente DENTRO do Porto de Santos (RN 11 / backlog3).
    const naviosNoPorto = navs.filter(n => !n.localizacao || n.localizacao === 'DENTRO_DO_PORTO');
    const naviosBloqueados = navs.filter(n => n.localizacao && n.localizacao !== 'DENTRO_DO_PORTO');

    navioManutSelect.innerHTML = '<option value="">Selecione a Embarcação...</option>';
    if (naviosNoPorto.length === 0) {
      navioManutSelect.innerHTML = navs.length === 0
        ? '<option value="" disabled>Nenhuma embarcação cadastrada no sistema</option>'
        : '<option value="" disabled>Nenhuma embarcação no Porto de Santos no momento</option>';
    } else {
      naviosNoPorto.forEach(n => {
        navioManutSelect.innerHTML += `<option value="${esc(n.nome)}">${esc(n.nome)} (${esc(n.imo || n.id)})</option>`;
      });
    }

    if (naviosBloqueados.length > 0) {
      navioManutSelect.setAttribute('title',
        `Navios fora do Porto de Santos não podem receber manutenção: ${naviosBloqueados.map(n => n.nome).join(', ')}.`);
    }
  }

  carregarNaviosParaManutencao();

  if (toggleNavioManutBtn && navioManutForm) {
    toggleNavioManutBtn.addEventListener('click', () => navioManutForm.classList.toggle('hidden'));
  }

  if (navioManutForm) {
    navioManutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const navioNome = navioManutSelect.value;
      const tipoManut = document.getElementById('navioTipoManutSelect').value;
      const descricao = document.getElementById('navioDescManut').value.trim();

      if (!navioNome) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Selecione uma embarcação para a manutenção.');
        return;
      }

      const navio = naviosListLocal.find(n => n.nome === navioNome);

      // Regra de negócio: manutenção bloqueada para navio fora do Porto de Santos
      if (navio && navio.localizacao && navio.localizacao !== 'DENTRO_DO_PORTO') {
        const situacao = navio.localizacao === 'FORA_DO_PORTO' ? 'em trânsito (fora do porto)' : 'no porto de destino';
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Manutenção Bloqueada', `O navio "${navioNome}" está ${situacao} e a manutenção só pode ser registrada com a embarcação atracada no Porto de Santos.`);
        }
        return;
      }

      // Tarefa 9.3: Bloqueio de duplicidade de pedido de manutenção para o mesmo navio
      const osExistente = osList.find(o => o.equipamento.includes(navioNome) && o.status !== 'CONCLUIDA' && o.status !== 'REPROVADA');
      if (osExistente) {
        const msgBloqueio = `BLOQUEIO DE DUPLICIDADE (Tarefa 9): O navio "${navioNome}" já possui uma solicitação ou ordem de serviço de manutenção ativa (${osExistente.id} - ${osExistente.status}). Não é permitido abrir solicitações duplicadas!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Manutenção Ativa', msgBloqueio);
        return;
      }

      // Item 17: Regra da Manutenção Geral (Requer >= 3 anos de uso / 1095 dias)
      if (tipoManut === 'GERAL') {
        const agora = Date.now();
        const tresAnosMs = 3 * 365 * 24 * 60 * 60 * 1000;
        const dataRef = navio ? (navio.data_ultima_manutencao_geral || navio.data_construcao || navio.dataSaida || '2025-01-01') : '2025-01-01';
        const diffMs = agora - new Date(dataRef).getTime();

        if (diffMs < tresAnosMs) {
          const msgBloqueio = `OPÇÃO BLOQUEADA (Item 17): A opção "Manutenção Geral" só pode ser selecionada se o navio estiver em uso há 3 anos ou mais (ou se a última manutenção geral tiver ocorrido há 3 anos ou mais). A embarcação "${navioNome}" possui histórico recente (${new Date(dataRef).toLocaleDateString('pt-BR')}). Selecione Preventiva, Corretiva ou Preditiva.`;
          if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Manutenção Bloqueada', msgBloqueio);
          return;
        }
      }

      const newOsId = `OS-NAVIO-${Math.floor(100 + Math.random() * 900)}`;
      osList.unshift({
        id: newOsId,
        equipamento: `Navio ${navioNome}`,
        prioridade: tipoManut === 'CORRETIVA' ? 'ALTA' : 'MEDIA',
        descricao: `[${tipoManut}] ${descricao}`,
        status: 'PENDENTE_APROVACAO',
        data: new Date().toISOString().split('T')[0]
      });

      localStorage.setItem('nexus_os_list', JSON.stringify(osList));

      if (window.nexusSupabase) {
        try {
          // Backlog 3 (tempo real): a OS guarda o navio (navio_id). Sem esse vínculo, o painel
          // não consegue contar o mesmo navio uma única vez.
          const navioUuid = navio && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(navio.id || '')) ? navio.id : null;
          const { data: insOs } = await window.nexusSupabase.from('manutencoes').insert({
            entidade_tipo: 'NAVIO',
            navio_id: navioUuid,
            descricao: `[${newOsId}][${tipoManut}] Navio: ${navioNome} - ${descricao}`,
            status: 'SOLICITADA'
          }).select('id').single();

          await window.nexusSupabase.from('navios').update({ estado_operacional: 'AGENDADO_PARA_REFORMA' }).eq('nome', navioNome);

          if (window.registrarTrailDecisao) {
            await window.registrarTrailDecisao('SOLICITOU_MANUTENCAO_NAVIO', 'navios', navio ? navio.id : null, `Solicitada manutenção [${tipoManut}] para o navio ${navioNome} por ${session.nome || session.cargo}. Motivo: ${descricao}`);
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'manutencoes', insOs ? insOs.id : null, { navio: navioNome, tipo: tipoManut, descricao });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar manutenção de navio no Supabase:', err);
        }
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('manutencoes');
        window.NexusRepository.notifyChange('navios');
      }

      renderOsTable();
      navioManutForm.reset();
      navioManutForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Manutenção Solicitada', `Solicitação de Manutenção (${tipoManut}) registrada com sucesso para o navio ${navioNome}! Ordem de Serviço ${newOsId} criada.`);
      }
    });
  }

  const guindasteForm = document.getElementById('guindasteForm');
  if (guindasteForm) {
    guindasteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isInspetor) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Cadastro de guindastes é de responsabilidade exclusiva do Inspetor!');
        return;
      }

      const identificacao = document.getElementById('gndNumero').value.trim().toUpperCase();
      const dataManut = document.getElementById('gndDataManut').value;
      const estado = document.getElementById('gndEstado').value;

      const gndExistente = guindastesList.find(g => (g.identificacao || '').toUpperCase() === identificacao);
      if (gndExistente) {
        const msg = `O guindaste "${identificacao}" já está cadastrado no sistema.`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Guindaste Duplicado', msg);
        return;
      }

      const novoGnd = { id: identificacao, identificacao, estado, dataManut };
      guindastesList.push(novoGnd);
      localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));

      if (window.nexusSupabase) {
        try {
          const { data: insGnd } = await window.nexusSupabase.from('guindastes').insert({
            numero_identificacao: identificacao,
            estado,
            data_ultima_manutencao: dataManut || null
          }).select('id').single();

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'guindastes', insGnd ? insGnd.id : null, { numero_identificacao: identificacao, estado });
          }
          if (window.NexusRepository && window.NexusRepository.notifyChange) {
            window.NexusRepository.notifyChange('guindastes');
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar guindaste com Supabase:', err);
        }
      }

      if (typeof renderGuindastesTable === 'function') renderGuindastesTable();
      guindasteForm.reset();
      guindasteForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Guindaste Cadastrado', `Guindaste ${identificacao} cadastrado com sucesso pelo Inspetor!`);
      }
    });
  }

  // opcoes (uso do agente WebMCP): { descricao? } evita o diálogo de justificativa.
  window.solicitarManutencaoGuindaste = async function(identificacao, opcoes) {
    if (!isSupervisor) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas o Supervisor pode solicitar manutenção de guindastes!');
      return;
    }

    const descricao = (opcoes && opcoes.descricao) ? opcoes.descricao : window.nexusPrompt ? await window.nexusPrompt('Solicitar Manutenção de Guindaste', `Informe a justificativa/falha para solicitar manutenção do Guindaste ${identificacao}:`, 'Revisão periódica dos cabos de aço e motores') : 'Revisão periódica';
    if (!descricao) return;

    const gnd = guindastesList.find(x => x.identificacao === identificacao);

    // Tarefa 9.3: Não permite pedir mais de uma manutenção para o mesmo guindaste
    if (gnd && gnd.estado === 'EM_MANUTENCAO') {
      const msg = `BLOQUEIO DE DUPLICIDADE (Tarefa 9): O guindaste "${identificacao}" já se encontra em manutenção. Não é permitido solicitar manutenção duplicada!`;
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Guindaste em Manutenção', msg);
      return;
    }

    if (gnd) gnd.estado = 'EM_MANUTENCAO';

    const newOsId = `OS-2026-${Math.floor(100 + Math.random() * 900)}`;
    osList.unshift({
      id: newOsId,
      equipamento: `Guindaste ${identificacao}`,
      prioridade: 'ALTA',
      descricao: `Manutenção de Guindaste: ${descricao}`,
      status: 'EM_MANUTENCAO',
      data: new Date().toISOString().split('T')[0]
    });

    localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));
    localStorage.setItem('nexus_os_list', JSON.stringify(osList));

    if (window.nexusSupabase) {
      try {
        await window.nexusSupabase.from('guindastes')
          .update({ estado: 'EM_MANUTENCAO' })
          .eq('numero_identificacao', identificacao);

        await window.nexusSupabase.from('manutencoes').insert({
          entidade_tipo: 'GUINDASTE',
          descricao: `[${newOsId}][ALTA] Guindaste: ${identificacao} - ${descricao}`,
          status: 'APROVADA'
        });

        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao('SOLICITOU_MANUTENCAO_CONTAINER', 'guindastes', null, `Solicitou manutenção do Guindaste ${identificacao}: ${descricao}`);
        }
        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'guindastes', null, { estado: 'EM_MANUTENCAO', justificativa: descricao });
        }
        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('guindastes');
          window.NexusRepository.notifyChange('manutencoes');
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar guindaste no Supabase:', err);
      }
    }

    if (typeof renderGuindastesTable === 'function') renderGuindastesTable();
    renderOsTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Manutenção Solicitada', `Manutenção solicitada para o Guindaste ${identificacao}! Ordem de Serviço ${newOsId} criada.`);
    }
  };

  window.concluirManutencaoGuindaste = async function(identificacao, opcoes) {
    if (!isSupervisor) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas o Supervisor pode aprovar/concluir manutenção de guindastes!');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const gnd = guindastesList.find(x => x.identificacao === identificacao);
    if (gnd) {
      gnd.estado = 'OPERANTE';
      gnd.dataManut = todayStr;
    }

    const os = osList.find(o => o.equipamento.includes(identificacao) && o.status === 'EM_MANUTENCAO');
    if (os) os.status = 'CONCLUIDA';

    localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));
    localStorage.setItem('nexus_os_list', JSON.stringify(osList));

    if (window.nexusSupabase) {
      try {
        await window.nexusSupabase.from('guindastes')
          .update({ estado: 'OPERANTE', data_ultima_manutencao: todayStr })
          .eq('numero_identificacao', identificacao);

        await window.nexusSupabase.from('historico_manutencoes').insert({
          data_manutencao: todayStr,
          descricao_servicos: `Conclusão da manutenção do Guindaste ${identificacao}`
        });

        const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        let q = window.nexusSupabase.from('manutencoes').update({ status: 'CONCLUIDA' });
        if (os && os.rawDbId && isUuid(os.rawDbId)) {
          q = q.eq('id', os.rawDbId);
        } else {
          q = q.ilike('descricao', `%${identificacao}%`);
        }
        await q;

        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao('APROVOU_MANUTENCAO', 'guindastes', null, `Concluiu manutenção do Guindaste ${identificacao} e reativou para OPERANTE`);
        }
        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'guindastes', null, { estado: 'OPERANTE', data_ultima_manutencao: todayStr });
        }
        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('guindastes');
          window.NexusRepository.notifyChange('manutencoes');
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar guindaste no Supabase:', err);
      }
    }

    if (typeof renderGuindastesTable === 'function') renderGuindastesTable();
    renderOsTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Manutenção Concluída', `Manutenção do Guindaste ${identificacao} CONCLUÍDA! Equipamento reativado e no estado OPERANTE.`);
    }
  };

  let osList = JSON.parse(localStorage.getItem('nexus_os_list') || '[]');

  // Backlog 3 (7h/7b): estado do filtro de status das OS (declarado junto da
  // lista para evitar erro de TDZ quando carregarOsSupabase renderiza primeiro).
  let filtroStatusOsAtual = '';

  async function carregarOsSupabase() {
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('manutencoes').select('*');
        if (!error && Array.isArray(data)) {
          osList = data.map(m => {
            let statusLocal = 'PENDENTE_APROVACAO';
            if (m.status === 'APROVADA') statusLocal = 'EM_MANUTENCAO';
            else if (m.status === 'RECUSADA') statusLocal = 'REPROVADA';
            else if (m.status === 'CONCLUIDA') statusLocal = 'CONCLUIDA';

            // Extrai equipamento e prioridade da descrição se houver formato [ID][PRIORIDADE]
            let equip = 'Equipamento Geral';
            let prioridade = 'MEDIA';
            let descLimpa = m.descricao || '';
            const matchDesc = m.descricao ? m.descricao.match(/^\[(.*?)\]\[(.*?)\]\s*(.*)$/) : null;
            if (matchDesc) {
              prioridade = matchDesc[2];
              descLimpa = matchDesc[3];
            }
            if (m.entidade_tipo === 'NAVIO') equip = 'Navio';
            else if (m.entidade_tipo === 'GUINDASTE') equip = 'Guindaste';
            else if (m.entidade_tipo === 'CONTAINER') equip = 'Contêiner';

            return {
              id: m.id ? `OS-${m.id.substring(0, 8)}` : `OS-${Date.now()}`,
              equipamento: equip,
              prioridade: prioridade,
              descricao: descLimpa,
              status: statusLocal,
              data: m.created_at ? new Date(m.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              rawDbId: m.id
            };
          });
          localStorage.setItem('nexus_os_list', JSON.stringify(osList));
        }
      } catch (e) {
        console.warn('Erro ao carregar ordens de serviço do Supabase:', e);
      }
    }
    renderOsTable();
  }

  // Rótulos legíveis (pt-BR) para os status e prioridades crus do banco (Item 3.1)
  const STATUS_OS = {
    PENDENTE_APROVACAO: { txt: 'Aguardando aprovação', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
    EM_MANUTENCAO: { txt: 'Em manutenção', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
    CONCLUIDA: { txt: 'Concluída', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
    REPROVADA: { txt: 'Reprovada', cls: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' }
  };

  // Badges montados aqui (classes em ternário estático) — o valor exibido
  // vem sempre de esc(), nunca interpolado cru.
  const statusBadgeOs = (status) => `
    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase whitespace-nowrap ${
      status === 'EM_MANUTENCAO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
      status === 'CONCLUIDA' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
      status === 'REPROVADA' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
      'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
    }">${esc((STATUS_OS[status] || {}).txt || status || 'Desconhecido')}</span>`;

  const prioridadeBadgeOs = (prioridade) => `
    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase whitespace-nowrap ${
      prioridade === 'ALTA' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
      prioridade === 'MEDIA' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
      prioridade === 'BAIXA' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
      'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
    }">${esc(prioridade || 'N/D')}</span>`;

  // Datas padronizadas em dd/mm/aaaa (Item 8.8) sem sofrer deslocamento de fuso
  function formatarDataOs(valor) {
    if (!valor) return 'N/A';
    const texto = String(valor).trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const data = new Date(texto);
    return isNaN(data.getTime()) ? texto : data.toLocaleDateString('pt-BR');
  }


  carregarOsSupabase();

  function renderOsTable() {
    if (!osTableBody) return;

    if (osList.length === 0) {
      osTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] block mb-1 text-slate-300 dark:text-slate-600">build_circle</span>
            <span class="block font-bold text-slate-400 text-xs">Nenhuma OS cadastrada ainda.</span>
            <span class="block text-[11px] text-slate-400 mt-1">Use "+ Nova Ordem de Serviço" para registrar a primeira ordem, ou solicite uma manutenção de embarcação no painel acima.</span>
          </td>
        </tr>
      `;
      return;
    }

    const buscaOsVal = (document.getElementById('buscarOsInput')?.value || '').trim().toLowerCase();
    const osVisiveis = osList.filter(os => {
      if (filtroStatusOsAtual && os.status !== filtroStatusOsAtual) return false;
      if (buscaOsVal) {
        const haystack = `${os.id || ''} ${os.equipamento || ''} ${os.descricao || ''}`.toLowerCase();
        if (!haystack.includes(buscaOsVal)) return false;
      }
      return true;
    });

    const osCounterEl = document.getElementById('osCounter');
    if (osCounterEl) {
      osCounterEl.textContent = `Exibindo ${osVisiveis.length} de ${osList.length} OS`;
    }

    if (osVisiveis.length === 0) {
      const statusTxt = filtroStatusOsAtual ? ` para o status "${(STATUS_OS[filtroStatusOsAtual] || {}).txt || filtroStatusOsAtual}"` : '';
      osTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] block mb-1 text-slate-300 dark:text-slate-600">search_off</span>
            <span class="block font-bold text-slate-400 text-xs">Nenhuma OS corresponde à busca/filtro${esc(statusTxt)}.</span>
            <span class="block text-[11px] text-slate-400 mt-1">Ajuste o texto pesquisado ou limpe o filtro de status ativo para listar novamente.</span>
          </td>
        </tr>
      `;
      return;
    }

    osTableBody.innerHTML = osVisiveis.map(os => {
      const statusHtml = statusBadgeOs(os.status);
      const prioridadeHtml = prioridadeBadgeOs(os.prioridade);

      return `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-3 font-mono font-bold text-nexus-500">${esc(os.id)}</td>
        <td class="p-3 font-bold">${esc(os.equipamento)}</td>
        <td class="p-3">${prioridadeHtml}</td>
        <td class="p-3 text-xs">${esc(os.descricao)}</td>
        <td class="p-3 font-mono text-xs text-slate-600 dark:text-slate-300">${esc(formatarDataOs(os.data))}</td>
        <td class="p-3 text-xs">${statusHtml}</td>
        <td class="p-3 text-right text-[11px]">
          <div class="flex items-center justify-end gap-1.5 flex-wrap min-w-[150px]">
          ${os.status === 'PENDENTE_APROVACAO' ? `
            <button type="button" onclick="window.executarAcaoOS(${jsArg(os.id)}, 'APROVAR')" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Aprovar</button>
            <button type="button" onclick="window.executarAcaoOS(${jsArg(os.id)}, 'REPROVAR')" class="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold">Reprovar</button>
          ` : os.status === 'EM_MANUTENCAO' ? `
            <button type="button" title="Concluir manutenção" onclick="window.executarAcaoOS(${jsArg(os.id)}, 'CONCLUIR')" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">task_alt</span><span>Concluir</span></button>
          ` : `<span class="text-slate-400 font-sans italic">Finalizada</span>`}
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  renderOsTable();

  // Backlog 3 (7b/7h): busca local e chips de status com estado visual ativo.
  const buscarOsInput = document.getElementById('buscarOsInput');
  if (buscarOsInput) {
    buscarOsInput.addEventListener('input', renderOsTable);
  }

  const osStatusChipsEl = document.getElementById('osStatusChips');
  if (osStatusChipsEl) {
    osStatusChipsEl.querySelectorAll('.os-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const alvo = chip.getAttribute('data-status');
        // Toggle: clicar no chip ATIVO limpa o filtro (volta a listar todas)
        filtroStatusOsAtual = (filtroStatusOsAtual === alvo) ? '' : alvo;
        osStatusChipsEl.querySelectorAll('.os-chip').forEach(c => {
          const ativo = c.getAttribute('data-status') === filtroStatusOsAtual;
          c.classList.toggle('ring-2', ativo);
          c.classList.toggle('ring-nexus-500', ativo);
          c.classList.toggle('bg-nexus-500', ativo);
          c.classList.toggle('text-white', ativo);
          c.classList.toggle('border-nexus-500', ativo);
          c.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
        renderOsTable();
      });
    });
  }

  async function carregarEquipamentosEAlertas() {
    const osSelect = document.getElementById('osEquipamento');
    const alertaList = document.getElementById('alertaPreventivaList');

    let gnds = guindastesList || [];
    let conts = [];
    let navs = naviosListLocal || [];

    if (window.nexusSupabase) {
      try {
        const { data: dbGnd } = await window.nexusSupabase.from('guindastes').select('*');
        if (dbGnd && dbGnd.length > 0) gnds = dbGnd.map(g => ({ identificacao: g.numero_identificacao, dataManut: g.data_ultima_manutencao }));

        const { data: dbCont } = await window.nexusSupabase.from('containers').select('*');
        if (dbCont && dbCont.length > 0) conts = dbCont.map(c => ({ identificacao: c.numero_identificacao, dataManut: c.data_ultima_manutencao || c.data_fabricacao }));

        const { data: dbNav } = await window.nexusSupabase.from('navios').select('*');
        if (dbNav && dbNav.length > 0) navs = dbNav.map(n => ({ nome: n.nome, imo: n.numero_imo, dataManut: n.data_ultima_manutencao_geral || n.data_construcao || n.created_at }));
      } catch (e) {
        console.warn('Erro ao buscar equipamentos para OS no Supabase:', e);
      }
    }

    if (conts.length === 0) {
      conts = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]').map(c => ({ identificacao: c.identificacao || c.id, dataManut: c.data_ultima_manutencao || '' }));
    }

    if (osSelect) {
      // Item 8.6: cada <optgroup> é montado de uma só vez. O padrão antigo
      // (innerHTML += '<optgroup>' ... += '</optgroup>') fazia o navegador
      // fechar o grupo automaticamente e as opções ficavam fora dele.
      const optGroup = (label, opcoes) => {
        if (!opcoes.length) return '';
        const opcoesHtml = opcoes
          .map(o => `<option value="${esc(o.valor)}">${esc(o.rotulo)}</option>`)
          .join('');
        return `<optgroup label="${esc(label)}">${opcoesHtml}</optgroup>`;
      };

      osSelect.innerHTML =
        '<option value="">Selecione o Equipamento / Ativo...</option>' +
        optGroup('Guindastes & Pórticos', gnds.map(g => {
          const identificacao = g.identificacao || g.id;
          return { valor: `Guindaste ${identificacao}`, rotulo: `Guindaste ${identificacao}` };
        })) +
        optGroup('Contêineres', conts.map(c => ({
          valor: `Contêiner ${c.identificacao}`,
          rotulo: `Contêiner ${c.identificacao}`
        })));

      // Tarefa 9.2: Opção de pedir manutenção de navios REMOVIDA de Ordens de Serviço (deixada apenas em Solicitação de Manutenção de Embarcações)
    }

    if (alertaList) {
      let equipamentos = [];
      if (window.NexusRepository && window.NexusRepository.buscarEquipamentosPreventivaSugerida) {
        const res = await window.NexusRepository.buscarEquipamentosPreventivaSugerida();
        if (res && Array.isArray(res.equipamentos)) {
          equipamentos = res.equipamentos;
        }
      }

      if (equipamentos.length > 0) {
        // Item 3.2: cada equipamento em bloco próprio (tipo + identificação + motivo)
        alertaList.innerHTML = equipamentos.map(e => `
          <div class="flex items-start gap-2 py-1.5 border-b last:border-0 border-amber-200/60 dark:border-amber-900/40">
            <span class="shrink-0 px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 text-xs font-bold uppercase">${esc(e.tipo)}</span>
            <div class="min-w-0">
              <strong class="block text-nexus-900 dark:text-white">${esc(e.identificacao)}</strong>
              <span class="text-amber-800/90 dark:text-amber-300/90">${esc(e.motivo)}</span>
            </div>
          </div>`).join('');
      } else {
        alertaList.innerHTML = '<span class="text-slate-400 italic">Nenhum equipamento com ciclo de preventiva vencido (> 3 anos) no momento. Todos os ativos operam dentro do ciclo recomendado.</span>';
      }
    }
  }

  carregarEquipamentosEAlertas();

  if (toggleOsBtn && osForm) {
    toggleOsBtn.addEventListener('click', () => osForm.classList.toggle('hidden'));
  }

  if (osForm) {
    osForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const equipamento = document.getElementById('osEquipamento').value;
      const prioridade = document.getElementById('osPrioridade').value;
      const descricao = document.getElementById('osDescricao').value.trim();

      if (!equipamento) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Selecione um equipamento para abrir a Ordem de Serviço.');
        return;
      }

      // Tarefa 9.3: Bloqueio de duplicidade de pedido de manutenção para o mesmo equipamento
      const osExistente = osList.find(o => o.equipamento === equipamento && o.status !== 'CONCLUIDA' && o.status !== 'REPROVADA');
      if (osExistente) {
        const msgBloqueio = `BLOQUEIO DE DUPLICIDADE (Tarefa 9): O equipamento "${equipamento}" já possui uma ordem de serviço de manutenção ativa (${osExistente.id} - ${osExistente.status}). Não é permitido abrir solicitações duplicadas!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Equipamento em Manutenção', msgBloqueio);
        return;
      }

      let entidadeTipo = 'CONTAINER';
      if (equipamento.startsWith('Navio')) entidadeTipo = 'NAVIO';
      else if (equipamento.startsWith('Guindaste')) entidadeTipo = 'GUINDASTE';

      const newId = `OS-2026-${Math.floor(100 + Math.random() * 900)}`;
      osList.push({
        id: newId, equipamento, prioridade, descricao,
        status: 'PENDENTE_APROVACAO', data: new Date().toISOString().split('T')[0]
      });

      localStorage.setItem('nexus_os_list', JSON.stringify(osList));

      if (window.nexusSupabase) {
        try {
          const { data: insOs } = await window.nexusSupabase.from('manutencoes').insert({
            entidade_tipo: entidadeTipo,
            descricao: `[${newId}][${prioridade}] Equipamento: ${equipamento} - ${descricao}`,
            status: 'SOLICITADA'
          }).select('id').single();

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'manutencoes', insOs ? insOs.id : null, { equipamento, prioridade, descricao });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar OS com Supabase:', err);
        }
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('manutencoes');
      }

      renderOsTable();
      osForm.reset();
      osForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Ordem de Serviço Criada', `Ordem de Serviço ${newId} criada com sucesso para ${equipamento}! Enviada para aprovação do Supervisor.`);
      }
    });
  }

  window.executarAcaoOS = async function(idOS, acao) {
    const isSupervisor = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    if (!isSupervisor) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas o Supervisor de Operações ou Diretor pode aprovar/reprovar Ordens de Serviço!');
      return;
    }

    const os = osList.find(o => o.id === idOS);
    if (!os) return;

    let supabaseStatus = 'SOLICITADA';
    let feedbackTitulo = '';
    let feedbackMsg = '';
    let tipoTrail = 'APROVOU_MANUTENCAO';

    if (acao === 'APROVAR') {
      os.status = 'EM_MANUTENCAO';
      supabaseStatus = 'APROVADA';
      tipoTrail = 'APROVOU_MANUTENCAO';
      feedbackTitulo = 'OS Aprovada';
      feedbackMsg = `Ordem de Serviço ${idOS} APROVADA pelo Supervisor! Equipamento ${os.equipamento} no estado EM_MANUTENCAO.`;
    } else if (acao === 'REPROVAR') {
      os.status = 'REPROVADA';
      supabaseStatus = 'RECUSADA';
      tipoTrail = 'RECUSOU_MANUTENCAO';
      feedbackTitulo = 'OS Reprovada';
      feedbackMsg = `Ordem de Serviço ${idOS} REPROVADA pelo Supervisor.`;
    } else if (acao === 'CONCLUIR') {
      os.status = 'CONCLUIDA';
      supabaseStatus = 'CONCLUIDA';
      tipoTrail = 'APROVOU_MANUTENCAO';
      feedbackTitulo = 'Manutenção Concluída';
      feedbackMsg = `Manutenção da OS ${idOS} CONCLUÍDA! Equipamento ${os.equipamento} reativado e no estado OPERANTE.`;
    }

    localStorage.setItem('nexus_os_list', JSON.stringify(osList));

    if (window.nexusSupabase) {
      try {
        const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        let qStatus = window.nexusSupabase.from('manutencoes').update({ status: supabaseStatus });
        if (os.rawDbId && isUuid(os.rawDbId)) {
          qStatus = qStatus.eq('id', os.rawDbId);
        } else {
          qStatus = qStatus.ilike('descricao', `%${idOS}%`);
        }
        await qStatus;

        const limpaNome = os.equipamento.replace(/^(Navio|Guindaste|Contêiner)\s+/, '').trim();

        if (os.equipamento.startsWith('Navio')) {
          if (acao === 'APROVAR') {
            await window.nexusSupabase.from('navios').update({ estado_operacional: 'EM_REFORMA' }).ilike('nome', limpaNome);
          } else if (acao === 'CONCLUIR' || acao === 'REPROVAR') {
            // Backlog3: ao REPROVAR a OS, o navio também precisa sair do estado
            // AGENDADO_PARA_REFORMA/EM_REFORMA, senão fica preso no contador de
            // "Manutenção" do dashboard sem nunca ter sido atendido.
            await window.nexusSupabase.from('navios').update({ estado_operacional: 'OPERANTE' }).ilike('nome', limpaNome);
          }
        } else if (os.equipamento.startsWith('Guindaste')) {
          if (acao === 'APROVAR') {
            await window.nexusSupabase.from('guindastes').update({ estado: 'EM_MANUTENCAO' }).ilike('numero_identificacao', limpaNome);
          } else if (acao === 'CONCLUIR') {
            await window.nexusSupabase.from('guindastes').update({ estado: 'OPERANTE', data_ultima_manutencao: new Date().toISOString().split('T')[0] }).ilike('numero_identificacao', limpaNome);
          } else if (acao === 'REPROVAR') {
            await window.nexusSupabase.from('guindastes').update({ estado: 'OPERANTE' }).ilike('numero_identificacao', limpaNome);
          }
        } else if (os.equipamento.startsWith('Contêiner')) {
          if (acao === 'APROVAR') {
            // estado_container_enum não tem EM_MANUTENCAO: o valor válido é EM_REFORMA
            await window.nexusSupabase.from('containers').update({ estado: 'EM_REFORMA' }).ilike('numero_identificacao', limpaNome);
          } else if (acao === 'CONCLUIR') {
            await window.nexusSupabase.from('containers').update({ estado: 'OPERANTE', data_ultima_manutencao: new Date().toISOString().split('T')[0] }).ilike('numero_identificacao', limpaNome);
          } else if (acao === 'REPROVAR') {
            await window.nexusSupabase.from('containers').update({ estado: 'OPERANTE' }).ilike('numero_identificacao', limpaNome);
          }
        }

        if (acao === 'CONCLUIR') {
          await window.nexusSupabase.from('historico_manutencoes').insert({
            data_manutencao: new Date().toISOString().split('T')[0],
            descricao_servicos: `Conclusão da Ordem de Serviço ${idOS} para ${os.equipamento}: ${os.descricao}`
          });
        }

        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao(tipoTrail, 'manutencoes', os.rawDbId || null, `${feedbackMsg} (Decisão registrada por ${session.nome || session.cargo})`);
        }

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'manutencoes', os.rawDbId || null, { idOS, acao, status: supabaseStatus });
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar status da OS no Supabase:', err);
      }
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('manutencoes');
      window.NexusRepository.notifyChange('navios');
      window.NexusRepository.notifyChange('guindastes');
      window.NexusRepository.notifyChange('containers');
    }

    renderOsTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', feedbackTitulo, feedbackMsg);
    }
  };

  // Botão de Pânico — GLOBAL (js/panic-realtime.js → Edge Function "panic-alert"
  // → broadcast WebSocket para todos os clientes + webhook opcional)
  // Reflete o estado da emergência no botão e no banner da página.
  function aplicarEstadoEmergencia(ativa) {
    if (emergencyBanner) emergencyBanner.classList.toggle('hidden', !ativa);
    if (resetEmergencyBtn) resetEmergencyBtn.disabled = !ativa;
    if (!panicBtn) return;
    panicBtn.disabled = !!ativa;
    panicBtn.setAttribute('aria-disabled', String(!!ativa));
    panicBtn.classList.toggle('opacity-50', !!ativa);
    panicBtn.classList.toggle('cursor-not-allowed', !!ativa);
    const rotulo = panicBtn.querySelector('span:last-child');
    if (rotulo) rotulo.textContent = ativa ? 'EMERGÊNCIA ATIVA' : 'BOTÃO DE PÂNICO';
  }

  function emergenciaJaAtiva() {
    if (window.NexusPanic && typeof window.NexusPanic.isActive === 'function' && window.NexusPanic.isActive()) return true;
    try { return localStorage.getItem('nexus_emergency_active') === 'true'; } catch (e) { return false; }
  }

  if (panicBtn) {
    panicBtn.addEventListener('click', async () => {
      // Trava: um alarme já ativo não pode ser acionado novamente (evita
      // confirmações, novos registros e logs duplicados de emergência).
      if (emergenciaJaAtiva()) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Emergência Já Ativa', 'O alarme de emergência já está ativo em todos os clientes conectados. Use o botão "Desativar Alarme" para normalizar as operações.');
        }
        return;
      }

      if (window.NexusPanic) {
        // Fluxo global: confirmação, RBAC, Edge Function, broadcast e webhook
        // são tratados pelo módulo NexusPanic.triggerPanic().
        const resultado = await window.NexusPanic.triggerPanic({ confirmar: true });
        if (resultado && resultado.ok) {
          // Mantém estado local e banner da página sincronizados (EMERGENCIA_CRITICA_ATIVADA)
          localStorage.setItem('nexus_emergency_active', 'true');
          aplicarEstadoEmergencia(true);
        }
        return;
      }

      // Fallback legado (apenas se o módulo global não estiver carregado)
      const confirmou = window.nexusConfirm ? await window.nexusConfirm('DECLARAÇÃO DE EMERGÊNCIA', 'ATENÇÃO: Deseja acionar o BOTÃO DE PÂNICO e declarar EMERGÊNCIA CRÍTICA no Terminal STS-01?') : true;
      if (confirmou) {
        localStorage.setItem('nexus_emergency_active', 'true');
        aplicarEstadoEmergencia(true);

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('emergencia', 'EDICAO', { estado: 'EMERGENCIA_CRITICA_ATIVADA', acionado_por: session.nome || session.cargo });
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'EMERGÊNCIA CRÍTICA DECLARADA', 'Alarme de emergência acionado! Operações do pátio STS-01 bloqueadas temporariamente.');
        }
      }
    });
  }

  if (resetEmergencyBtn) {
    resetEmergencyBtn.addEventListener('click', async () => {
      if (window.NexusPanic) {
        const resultado = await window.NexusPanic.clearPanic({ confirmar: true });
        if (resultado && resultado.ok) {
          localStorage.removeItem('nexus_emergency_active');
          aplicarEstadoEmergencia(false);
        }
        return;
      }

      // Fallback legado (apenas se o módulo global não estiver carregado)
      const confirmou = window.nexusConfirm ? await window.nexusConfirm('Desativar Emergência', 'Confirmar desativação do alarme de emergência?') : true;
      if (confirmou) {
        localStorage.removeItem('nexus_emergency_active');
        aplicarEstadoEmergencia(false);

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('emergencia', 'EDICAO', { estado: 'EMERGENCIA_DESATIVADA', desativado_por: session.nome || session.cargo });
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Emergência Desativada', 'Alarme de emergência desativado com sucesso. Operações normalizadas.');
        }
      }
    });
  }

  // Sincroniza o banner desta página com o estado GLOBAL do pânico
  // (eventos disparados por este ou por qualquer outro cliente conectado)
  window.addEventListener('nexus_panic_changed', (evt) => {
    const ativo = Boolean(evt && evt.detail && evt.detail.active);
    aplicarEstadoEmergencia(ativo);
  });

  // Estado inicial da página (recarregamentos e sincronização entre abas)
  aplicarEstadoEmergencia(emergenciaJaAtiva());
  window.addEventListener('storage', (evt) => {
    if (evt.key === 'nexus_emergency_active') aplicarEstadoEmergencia(emergenciaJaAtiva());
  });

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    // Backlog 3 (tempo real): recarrega do Supabase antes de redesenhar (OS e navios)
    carregarNaviosParaManutencao();
    carregarOsSupabase();
  });
});
