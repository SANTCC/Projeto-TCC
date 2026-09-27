/**
 * Lógica do Módulo de Manutenção & OS (manutencao.html) - NexusPort
 * Gerencia Ordens de Serviço (OS), aprovação do Supervisor, alarmes de emergência e preventivas (> 3 anos).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  const toggleGuindasteBtn = document.getElementById('toggleGuindasteFormBtn');
  const guindasteForm = document.getElementById('guindasteForm');
  const guindastesTableBody = document.getElementById('guindastesTableBody');

  const toggleOsBtn = document.getElementById('toggleOsFormBtn');
  const osForm = document.getElementById('osForm');
  const osTableBody = document.getElementById('osTableBody');

  const panicBtn = document.getElementById('panicButton');
  const resetEmergencyBtn = document.getElementById('resetEmergencyBtn');
  const emergencyBanner = document.getElementById('emergencyAlertBanner');

  const isInspetor = ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
  const isSupervisor = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

  if (toggleGuindasteBtn && !isInspetor) {
    toggleGuindasteBtn.classList.add('hidden');
  }

  // Lista e CRUD de Guindastes (Point 2 / Spec.md RF 2, T2.7)
  let guindastesList = JSON.parse(localStorage.getItem('nexus_guindastes_list') || '[]');

  async function carregarGuindastesSupabase() {
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('guindastes').select('*');
        if (!error && Array.isArray(data)) {
          guindastesList = data.map(g => ({
            id: g.id || g.numero_identificacao,
            identificacao: g.numero_identificacao,
            estado: g.estado || 'OPERANTE',
            dataManut: g.data_ultima_manutencao || ''
          }));
          localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));
          renderGuindastesTable();
          return;
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao carregar guindastes do Supabase:', err);
      }
    }
    renderGuindastesTable();
  }

  function renderGuindastesTable() {
    if (!guindastesTableBody) return;

    if (guindastesList.length === 0) {
      guindastesTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="p-4 text-center text-slate-400 italic">Nenhum guindaste cadastrado no banco de dados.</td>
        </tr>
      `;
      return;
    }

    guindastesTableBody.innerHTML = guindastesList.map(g => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-3 font-mono font-bold text-nexus-500">${g.identificacao}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
            g.estado === 'OPERANTE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
            'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }">${g.estado}</span>
        </td>
        <td class="p-3 font-mono text-xs">${g.dataManut}</td>
        <td class="p-3 text-right">
          ${g.estado === 'OPERANTE' && isSupervisor ? `
            <button type="button" onclick="window.solicitarManutencaoGuindaste('${g.identificacao}')" class="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs">Solicitar Manutenção</button>
          ` : g.estado === 'EM_MANUTENCAO' && isSupervisor ? `
            <button type="button" onclick="window.concluirManutencaoGuindaste('${g.identificacao}')" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs">Concluir Manutenção</button>
          ` : `<span class="text-slate-400 font-mono italic text-[11px]">Sem Ação Permissível</span>`}
        </td>
      </tr>
    `).join('');
  }

  carregarGuindastesSupabase();

  if (toggleGuindasteBtn && guindasteForm) {
    toggleGuindasteBtn.addEventListener('click', () => {
      if (!isInspetor) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Inspetores têm permissão para cadastrar novos guindastes (Spec.md RF 1)!');
        }
        return;
      }
      guindasteForm.classList.toggle('hidden');
    });
  }

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
    navioManutSelect.innerHTML = '<option value="">Selecione a Embarcação...</option>';
    if (navs.length === 0) {
      navioManutSelect.innerHTML = '<option value="" disabled>Nenhuma embarcação cadastrada no sistema</option>';
      return;
    }
    navs.forEach(n => {
      navioManutSelect.innerHTML += `<option value="${n.nome}">${n.nome} (${n.imo || n.id})</option>`;
    });
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
          const { data: insOs } = await window.nexusSupabase.from('manutencoes').insert({
            entidade_tipo: 'NAVIO',
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

      renderGuindastesTable();
      guindasteForm.reset();
      guindasteForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Guindaste Cadastrado', `Guindaste ${identificacao} cadastrado com sucesso pelo Inspetor!`);
      }
    });
  }

  window.solicitarManutencaoGuindaste = async function(identificacao) {
    if (!isSupervisor) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas o Supervisor pode solicitar manutenção de guindastes!');
      return;
    }

    const descricao = window.nexusPrompt ? await window.nexusPrompt('Solicitar Manutenção de Guindaste', `Informe a justificativa/falha para solicitar manutenção do Guindaste ${identificacao}:`, 'Revisão periódica dos cabos de aço e motores') : 'Revisão periódica';
    if (!descricao) return;

    const gnd = guindastesList.find(x => x.identificacao === identificacao);
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

    renderGuindastesTable();
    renderOsTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Manutenção Solicitada', `Manutenção solicitada para o Guindaste ${identificacao}! Ordem de Serviço ${newOsId} criada.`);
    }
  };

  window.concluirManutencaoGuindaste = async function(identificacao) {
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

        await window.nexusSupabase.from('manutencoes')
          .update({ status: 'CONCLUIDA' })
          .ilike('descricao', `%${identificacao}%`);

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

    renderGuindastesTable();
    renderOsTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Manutenção Concluída', `Manutenção do Guindaste ${identificacao} CONCLUÍDA! Equipamento reativado e no estado OPERANTE.`);
    }
  };

  let osList = JSON.parse(localStorage.getItem('nexus_os_list') || '[]');

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

  carregarOsSupabase();

  function renderOsTable() {
    if (!osTableBody) return;

    if (osList.length === 0) {
      osTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-4 text-center text-slate-400 italic">Nenhuma ordem de serviço cadastrada no banco de dados.</td>
        </tr>
      `;
      return;
    }

    osTableBody.innerHTML = osList.map(os => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-3 font-mono font-bold text-nexus-500">${os.id}</td>
        <td class="p-3 font-bold">${os.equipamento}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
            os.prioridade === 'ALTA' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
            os.prioridade === 'MEDIA' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
            'bg-slate-100 text-slate-800'
          }">${os.prioridade}</span>
        </td>
        <td class="p-3 text-xs">${os.descricao}</td>
        <td class="p-3 font-mono text-xs">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
            os.status === 'EM_MANUTENCAO' ? 'bg-amber-100 text-amber-800' :
            os.status === 'CONCLUIDA' ? 'bg-emerald-100 text-emerald-800' :
            os.status === 'REPROVADA' ? 'bg-red-100 text-red-800' :
            'bg-blue-100 text-blue-800'
          }">${os.status}</span>
        </td>
        <td class="p-3 text-right font-mono text-[11px]">
          ${os.status === 'PENDENTE_APROVACAO' ? `
            <button type="button" onclick="window.executarAcaoOS('${os.id}', 'APROVAR')" class="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold mr-1">Aprovar</button>
            <button type="button" onclick="window.executarAcaoOS('${os.id}', 'REPROVAR')" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold">Reprovar</button>
          ` : os.status === 'EM_MANUTENCAO' ? `
            <button type="button" onclick="window.executarAcaoOS('${os.id}', 'CONCLUIR')" class="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold">Concluir Manutenção</button>
          ` : `<span class="text-slate-400 font-sans italic">Finalizada</span>`}
        </td>
      </tr>
    `).join('');
  }

  renderOsTable();

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
      osSelect.innerHTML = '<option value="">Selecione o Equipamento / Ativo...</option>';

      if (gnds.length > 0) {
        osSelect.innerHTML += '<optgroup label="Guindastes & Pórticos">';
        gnds.forEach(g => {
          osSelect.innerHTML += `<option value="Guindaste ${g.identificacao || g.id}">Guindaste ${g.identificacao || g.id}</option>`;
        });
        osSelect.innerHTML += '</optgroup>';
      }

      if (conts.length > 0) {
        osSelect.innerHTML += '<optgroup label="Contêineres">';
        conts.forEach(c => {
          osSelect.innerHTML += `<option value="Contêiner ${c.identificacao}">Contêiner ${c.identificacao}</option>`;
        });
        osSelect.innerHTML += '</optgroup>';
      }

      if (navs.length > 0) {
        osSelect.innerHTML += '<optgroup label="Embarcações (Navios)">';
        navs.forEach(n => {
          osSelect.innerHTML += `<option value="Navio ${n.nome}">Navio ${n.nome}</option>`;
        });
        osSelect.innerHTML += '</optgroup>';
      }
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
        alertaList.innerHTML = equipamentos.map((e, idx) => 
          `<div class="py-1"><strong>${idx + 1}. [${e.tipo}] ${e.identificacao}:</strong> ${e.motivo}</div>`
        ).join('');
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
        await window.nexusSupabase.from('manutencoes')
          .update({ status: supabaseStatus })
          .ilike('descricao', `%${idOS}%`);

        const limpaNome = os.equipamento.replace(/^(Navio|Guindaste|Contêiner)\s+/, '').trim();

        if (os.equipamento.startsWith('Navio')) {
          if (acao === 'APROVAR') {
            await window.nexusSupabase.from('navios').update({ estado_operacional: 'EM_REFORMA' }).eq('nome', limpaNome);
          } else if (acao === 'CONCLUIR') {
            await window.nexusSupabase.from('navios').update({ estado_operacional: 'OPERANTE' }).eq('nome', limpaNome);
          }
        } else if (os.equipamento.startsWith('Guindaste')) {
          if (acao === 'APROVAR') {
            await window.nexusSupabase.from('guindastes').update({ estado: 'EM_MANUTENCAO' }).eq('numero_identificacao', limpaNome);
          } else if (acao === 'CONCLUIR') {
            await window.nexusSupabase.from('guindastes').update({ estado: 'OPERANTE', data_ultima_manutencao: new Date().toISOString().split('T')[0] }).eq('numero_identificacao', limpaNome);
          }
        } else if (os.equipamento.startsWith('Contêiner')) {
          if (acao === 'APROVAR') {
            await window.nexusSupabase.from('containers').update({ estado: 'EM_MANUTENCAO' }).eq('numero_identificacao', limpaNome);
          } else if (acao === 'CONCLUIR') {
            await window.nexusSupabase.from('containers').update({ estado: 'OPERANTE', data_ultima_manutencao: new Date().toISOString().split('T')[0] }).eq('numero_identificacao', limpaNome);
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

  // Botão de Pânico
  if (panicBtn) {
    panicBtn.addEventListener('click', async () => {
      const confirmou = window.nexusConfirm ? await window.nexusConfirm('DECLARAÇÃO DE EMERGÊNCIA', 'ATENÇÃO: Deseja acionar o BOTÃO DE PÂNICO e declarar EMERGÊNCIA CRÍTICA no Terminal STS-01?') : true;
      if (confirmou) {
        localStorage.setItem('nexus_emergency_active', 'true');
        if (emergencyBanner) emergencyBanner.classList.remove('hidden');

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'emergencia', null, { estado: 'EMERGENCIA_CRITICA_ATIVADA', acionado_por: session.nome || session.cargo });
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'EMERGÊNCIA CRÍTICA DECLARADA', 'Alarme de emergência acionado! Operações do pátio STS-01 bloqueadas temporariamente.');
        }
      }
    });
  }

  if (resetEmergencyBtn) {
    resetEmergencyBtn.addEventListener('click', async () => {
      const confirmou = window.nexusConfirm ? await window.nexusConfirm('Desativar Emergência', 'Confirmar desativação do alarme de emergência?') : true;
      if (confirmou) {
        localStorage.removeItem('nexus_emergency_active');
        if (emergencyBanner) emergencyBanner.classList.add('hidden');

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'emergencia', null, { estado: 'EMERGENCIA_DESATIVADA', desativado_por: session.nome || session.cargo });
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Emergência Desativada', 'Alarme de emergência desativado com sucesso. Operações normalizadas.');
        }
      }
    });
  }

  if (localStorage.getItem('nexus_emergency_active') === 'true' && emergencyBanner) {
    emergencyBanner.classList.remove('hidden');
  }

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    carregarGuindastesSupabase();
    carregarNaviosParaManutencao();
    renderOsTable();
  });
});
