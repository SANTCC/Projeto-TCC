/**
 * Lógica do Módulo de Embarcações & GPS (embarcacoes.html) - NexusPort
 * Gerencia navios, contêineres e calcula ETA a 33 km/h.
 * Corrige o tempo fora do porto para navios em NO_PORTO_DE_DESTINO (RF 5 / RN 8).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  const gpsTableBody = document.getElementById('embarcacoesGpsTableBody');
  const toggleNavioBtn = document.getElementById('toggleNavioFormBtn');
  const navioForm = document.getElementById('navioForm');
  const toggleContainerBtn = document.getElementById('toggleContainerFormBtn');
  const containerForm = document.getElementById('containerForm');
  const containersTableBody = document.getElementById('containersTableBody');

  let naviosList = [];

  // Gestão e Painel de Berços Livres do Terminal STS-01 (15 Berços para Navios)
  const bercosGrid = document.getElementById('bercosGrid');
  const bercosLivresTag = document.getElementById('bercosLivresCountTag');

  let bercosList = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
  if (!Array.isArray(bercosList) || bercosList.length < 15) {
    const existingMap = new Map();
    if (Array.isArray(bercosList)) {
      bercosList.forEach(b => existingMap.set(b.nome, b));
    }
    bercosList = Array.from({ length: 15 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const nomeBerco = `Berço ${num}`;
      return existingMap.get(nomeBerco) || {
        id: `BERCO-${num}`,
        nome: nomeBerco,
        estado: 'LIVRE',
        navio_nome: null,
        navio_imo: null
      };
    });
    localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
  }

  function renderBercosPanel() {
    bercosList = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    // Garante 15 berços
    if (bercosList.length < 15) {
      const existingMap = new Map(bercosList.map(b => [b.nome, b]));
      bercosList = Array.from({ length: 15 }, (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        const nomeBerco = `Berço ${num}`;
        return existingMap.get(nomeBerco) || { id: `BERCO-${num}`, nome: nomeBerco, estado: 'LIVRE', navio_nome: null, navio_imo: null };
      });
    }

    // Item 7: Libera berços ocupados por navios que não existem ou foram excluídos do sistema
    const currentNavios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    const activeImoSet = new Set(currentNavios.map(n => (n.imo || '').toLowerCase()));
    const activeNomeSet = new Set(currentNavios.map(n => (n.nome || '').toLowerCase()));

    let bercosAlterados = false;
    bercosList.forEach(b => {
      if (b.estado === 'OCUPADO') {
        const matchImo = b.navio_imo ? activeImoSet.has(b.navio_imo.toLowerCase()) : false;
        const matchNome = b.navio_nome ? activeNomeSet.has(b.navio_nome.toLowerCase()) : false;
        if (!matchImo && !matchNome) {
          b.estado = 'LIVRE';
          b.navio_nome = null;
          b.navio_imo = null;
          bercosAlterados = true;
        }
      }
    });

    if (bercosAlterados || bercosList.length < 15) {
      localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
    }

    const livres = bercosList.filter(b => b.estado === 'LIVRE');

    if (bercosLivresTag) {
      bercosLivresTag.textContent = `${livres.length} Berço(s) Livre(s)`;
    }

    if (bercosGrid) {
      bercosGrid.innerHTML = bercosList.map(b => `
        <div class="p-3 rounded-xl border ${
          b.estado === 'LIVRE' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60' :
          b.estado === 'OCUPADO' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60' :
          'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
        } flex flex-col gap-1 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-bold text-nexus-900 dark:text-white">${b.nome}</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              b.estado === 'LIVRE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
              b.estado === 'OCUPADO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
              'bg-slate-200 text-slate-800'
            }">${b.estado}</span>
          </div>
          <span class="text-[11px] text-slate-500 font-mono">
            ${b.estado === 'OCUPADO' ? `Navio: <strong class="text-nexus-500">${b.navio_nome || b.carga_id || 'Navio Alocado'}</strong>` : 'Pronto para atracação'}
          </span>
        </div>
      `).join('');
    }
  }

  renderBercosPanel();

  // Cálculo de ETA a 33 km/h
  function calcularETA(distanciaKm) {
    if (!distanciaKm || distanciaKm <= 0) return 'Atracado / Viagem Concluída';
    const velocidade = 33; // km/h (RN 9)
    const horasTotais = distanciaKm / velocidade;
    const dias = Math.floor(horasTotais / 24);
    const horas = Math.round(horasTotais % 24);
    return `${dias}d ${horas}h (Distância: ${distanciaKm} km @ 33 km/h)`;
  }

  // Carrega navios mantendo persistência rigorosa do Supabase / Local
  async function carregarNaviosSupabase() {
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('navios')
          .select('*');

        if (!error && Array.isArray(data)) {
          naviosList = data.map(n => ({
            id: n.id,
            nome: n.nome,
            imo: n.numero_imo || n.imo,
            gps: n.coordenadas_gps || '23.9608° S, 46.3022° W',
            localizacao: n.localizacao || 'DENTRO_DO_PORTO',
            origem: n.porto_origem || 'Porto de Santos',
            destino: n.porto_destino || 'Porto de Roterdã',
            distancia: 10200,
            dataSaida: n.data_saida || (n.localizacao === 'FORA_DO_PORTO' ? new Date(Date.now() - 86400000 * 2).toISOString() : null)
          }));
          localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));
          renderGpsTable();
          return;
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao carregar navios do Supabase:', err);
      }
    }
    const savedNaviosRaw = localStorage.getItem('nexus_navios_list');
    naviosList = savedNaviosRaw ? JSON.parse(savedNaviosRaw) : [];
    renderGpsTable();
  }

  // Renderiza Tabela de GPS com atualização viva em tempo real e entrega automática
  function renderGpsTable() {
    if (!gpsTableBody) return;

    if (naviosList.length === 0) {
      gpsTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="p-4 text-center text-slate-400 italic">Nenhuma embarcação cadastrada no banco de dados.</td>
        </tr>
      `;
      return;
    }

    // C10 & RN 12: Atualização automática do status das cargas quando o navio chega ao porto de destino
    const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    let cargasAtualizadas = false;

    naviosList.forEach(n => {
      if (n.localizacao === 'NO_PORTO_DE_DESTINO') {
        cargasFluxo.forEach(c => {
          if (c.navio && c.navio.toLowerCase() === n.nome.toLowerCase() && c.status !== 'ENTREGUE' && c.status !== 'CANCELADA') {
            c.status = 'ENTREGUE';
            cargasAtualizadas = true;
          }
        });
      }
    });

    if (cargasAtualizadas) {
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxo));
      if (window.nexusSupabase) {
        window.nexusSupabase.from('cargas')
          .update({ status_fluxo: 'ENTREGUE' })
          .eq('status_fluxo', 'EM_TRANSITO')
          .then().catch(e => console.warn('[NexusPort] Erro ao atualizar entregue no Supabase:', e));
      }
    }

    // Exibe todos os navios cadastrados no terminal (Tarefa 5.2 - RF 1.9, RF 2.1)
    if (naviosList.length === 0) {
      gpsTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="p-4 text-center text-slate-400 italic">Nenhum navio cadastrado no banco de dados.</td>
        </tr>
      `;
      return;
    }

    gpsTableBody.innerHTML = naviosList.map(n => {
      let etaText = '';
      let tempoForaText = '';

      if (n.localizacao === 'DENTRO_DO_PORTO') {
        etaText = 'Em Atracação no Porto Origem';
        tempoForaText = 'No Porto (0s)';
      } else if (n.localizacao === 'NO_PORTO_DE_DESTINO') {
        // CORREÇÃO CRÍTICA (RF 5 / RN 8): Pausa/finaliza contagem de tempo fora do porto
        etaText = 'Atracado no Destino (Concluído)';
        tempoForaText = '0d 0h 0s (Atracado no Destino)';
      } else {
        // C6 & A4: Cálculo de ETA e tempo decorrido dinâmico baseado em tempo real com parsing seguro
        let horaSaidaTime = Date.now();
        if (n.dataSaida) {
          const parsed = new Date(n.dataSaida).getTime();
          if (!isNaN(parsed)) horaSaidaTime = parsed;
        }
        const diffMs = Math.max(0, Date.now() - horaSaidaTime);

        const diasDecorridos = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const horasDecorridas = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutosDecorridos = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const segundosDecorridos = Math.floor((diffMs % (1000 * 60)) / 1000);

        tempoForaText = `${diasDecorridos}d ${horasDecorridas}h ${minutosDecorridos}m ${segundosDecorridos}s fora`;

        // Cálculo dinâmico do tempo total previsto
        const horasTotaisPrevistas = (n.distancia || 10200) / 33; // 33 km/h
        const msTotaisPrevistos = horasTotaisPrevistas * 3600 * 1000;
        const msRestantes = Math.max(0, msTotaisPrevistos - diffMs);

        const diasRestantes = Math.floor(msRestantes / (1000 * 60 * 60 * 24));
        const horasRestantes = Math.floor((msRestantes % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minRestantes = Math.floor((msRestantes % (1000 * 60 * 60)) / (1000 * 60));
        const segRestantes = Math.floor((msRestantes % (1000 * 60)) / 1000);

        etaText = `ETA: ${diasRestantes}d ${horasRestantes}h ${minRestantes}m ${segRestantes}s (@33km/h)`;
      }

      // Busca cargas do localstorage ou Supabase associadas a este navio (C2, C3)
      const cargasDoNavio = cargasFluxo.filter(c => c.navio && c.navio.toLowerCase() === n.nome.toLowerCase());

      let bercosInfoHtml = '<span class="text-slate-400 italic text-[11px]">Sem carga vinculada</span>';
      if (cargasDoNavio.length > 0) {
        bercosInfoHtml = cargasDoNavio.map(c => `
          <div class="text-[11px] leading-tight">
            <strong class="text-nexus-500">${c.id}</strong>: <span class="font-bold text-slate-700 dark:text-slate-200">${c.portoDescarga || 'Berço não atrelado'}</span>
            <span class="block text-[10px] text-slate-400">Contêiner: ${c.container || 'Não vinculado'}</span>
          </div>
        `).join('');
      }

      // RN 3: Liberação de saída de navios é competência do Supervisor de Operações e Direção
      const podeLiberarNavio = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

      let acoesHtml = '<div class="flex items-center justify-end gap-1.5 font-mono text-[11px] flex-wrap">';

      // Botão Vincular a Berço (Tarefa 6)
      acoesHtml += `<button type="button" onclick="window.vincularNavioABerco('${n.imo}')" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">dock</span><span>Vincular</span></button>`;

      if (podeLiberarNavio) {
        if (n.localizacao === 'DENTRO_DO_PORTO') {
          acoesHtml += `<button type="button" onclick="window.liberarNavioPeloDiretor('${n.imo}')" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold">Liberar Saída</button>`;
        } else if (n.localizacao === 'NO_PORTO_DE_DESTINO') {
          acoesHtml += `<button type="button" onclick="window.autorizarRetornoNavio('${n.imo}')" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Autorizar Retorno</button>`;
        } else if (n.localizacao === 'FORA_DO_PORTO') {
          acoesHtml += `<button type="button" onclick="window.autorizarRetornoNavio('${n.imo}')" class="px-2.5 py-1 rounded bg-slate-400 text-white font-bold cursor-not-allowed" title="Navio precisa chegar ao porto de destino antes de autorizar retorno">Autorizar Retorno</button>`;
        }
      }

      // Botão Excluir Navio (Tarefa 6)
      acoesHtml += `<button type="button" onclick="window.excluirNavio('${n.imo}')" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">delete</span><span>Excluir</span></button>`;

      acoesHtml += '</div>';

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-bold text-nexus-900 dark:text-white">
            ${n.nome}
            <span class="block font-mono text-[10px] text-nexus-500">${n.imo}</span>
          </td>
          <td class="p-3 font-mono text-xs">${bercosInfoHtml}</td>
          <td class="p-3 font-mono text-xs text-slate-600 dark:text-slate-300">${n.gps}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              n.localizacao === 'DENTRO_DO_PORTO' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
              n.localizacao === 'FORA_DO_PORTO' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' :
              'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
            }">${n.localizacao}</span>
          </td>
          <td class="p-3 text-xs">${n.origem} → <strong class="text-nexus-900 dark:text-white">${n.destino}</strong></td>
          <td class="p-3 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-bold">${etaText}</td>
          <td class="p-3 font-mono text-xs font-bold ${n.localizacao === 'NO_PORTO_DE_DESTINO' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}">${tempoForaText}</td>
          <td class="p-3 text-right whitespace-nowrap">${acoesHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // Gestão de Rotas Marítimas (RN 9, RF 2.4)
  const toggleRotaBtn = document.getElementById('toggleRotaFormBtn');
  const rotaForm = document.getElementById('rotaForm');
  const rotasTableBody = document.getElementById('rotasTableBody');
  let rotasMaritimasList = [];

  async function carregarRotasMaritimas() {
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('rotas_maritimas').select('*');
        if (!error && data && data.length > 0) {
          rotasMaritimasList = data;
        }
      } catch (e) {
        console.warn('Erro ao carregar rotas marítimas do Supabase:', e);
      }
    }
    if (rotasMaritimasList.length === 0) {
      rotasMaritimasList = [
        { origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 },
        { origem: 'Porto de Santos', destino: 'Porto de Xangai', distancia_km: 18500 },
        { origem: 'Porto de Santos', destino: 'Porto de Hamburgo', distancia_km: 10100 }
      ];
    }
    renderRotasTable();
  }

  function renderRotasTable() {
    if (!rotasTableBody) return;
    if (rotasMaritimasList.length === 0) {
      rotasTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="p-4 text-center text-slate-400 italic">Nenhuma rota marítima cadastrada no sistema.</td>
        </tr>
      `;
      return;
    }
    rotasTableBody.innerHTML = rotasMaritimasList.map(r => {
      const dist = parseFloat(r.distancia_km) || 10200;
      const eta = calcularETA(dist);
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 font-mono text-xs">
          <td class="p-3 font-bold">${r.origem}</td>
          <td class="p-3 text-nexus-900 dark:text-white font-bold">${r.destino}</td>
          <td class="p-3 text-emerald-600 font-bold">${dist.toLocaleString('pt-BR')} km</td>
          <td class="p-3 text-indigo-600 font-bold">${eta}</td>
        </tr>
      `;
    }).join('');
  }

  carregarRotasMaritimas();

  if (toggleRotaBtn && rotaForm) {
    toggleRotaBtn.addEventListener('click', () => rotaForm.classList.toggle('hidden'));
  }

  if (rotaForm) {
    rotaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const origem = document.getElementById('rotaOrigem').value.trim();
      const destino = document.getElementById('rotaDestino').value.trim();
      const distancia_km = parseFloat(document.getElementById('rotaDistancia').value) || 10200;

      const novaRota = { origem, destino, distancia_km };
      rotasMaritimasList.push(novaRota);

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('rotas_maritimas').insert(novaRota);
          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'rotas_maritimas', null, { origem, destino, distancia_km });
          }
          if (window.NexusRepository && window.NexusRepository.notifyChange) {
            window.NexusRepository.notifyChange('rotas_maritimas');
          }
        } catch (e) {
          console.warn('Erro ao salvar rota marítima no Supabase:', e);
        }
      }

      renderRotasTable();
      rotaForm.reset();
      rotaForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Rota Cadastrada', `Rota Marítima "${origem} ➔ ${destino}" (${distancia_km} km) cadastrada com sucesso!`);
      }
    });
  }

  // RN 3: Liberação de Saída de Navios pelo Supervisor de Operações / Diretor
  window.liberarNavioPeloDiretor = async function(imo) {
    const podeLiberar = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    if (!podeLiberar) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Negado', 'Apenas o Supervisor de Operações ou Diretor pode autorizar a liberação de navios!');
      }
      return;
    }

    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    // RN 9: Bloqueia saída se NÃO houver rota cadastrada entre a origem e o destino do navio
    const origBusca = (navio.origem || 'Porto de Santos').trim().toLowerCase();
    const destBusca = (navio.destino || '').trim().toLowerCase();

    const rotaCadastrada = rotasMaritimasList.find(r =>
      String(r.origem || '').trim().toLowerCase() === origBusca &&
      String(r.destino || '').trim().toLowerCase() === destBusca
    );

    if (!rotaCadastrada) {
      const msgErro = `REGRA DE NEGÓCIO (RN 9): A saída do navio "${navio.nome}" foi BLOQUEADA pois não existe uma rota marítima cadastrada entre "${navio.origem || 'Porto de Santos'}" e "${navio.destino}". O Supervisor deve cadastrar a rota na seção "Gestão de Rotas Marítimas" antes da liberação!`;
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Rota Não Encontrada', msgErro);
      }
      return;
    }

    navio.distancia = parseFloat(rotaCadastrada.distancia_km) || 10200;

    const confirmou = window.nexusConfirm 
      ? await window.nexusConfirm('Liberar Saída de Navio', `Confirmar liberação de saída do navio ${navio.nome} (${navio.imo}) pela rota cadastrada ${rotaCadastrada.origem} ➔ ${rotaCadastrada.destino} (${navio.distancia} km)?`) 
      : true;

    if (confirmou) {
      const horaSaida = new Date().toISOString();
      navio.localizacao = 'FORA_DO_PORTO';
      navio.dataSaida = horaSaida;

      localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

      // Atualiza status das cargas vinculadas para EM_TRANSITO
      const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      cargasFluxo.forEach(c => {
        if ((c.navio && c.navio.toLowerCase() === navio.nome.toLowerCase()) || (c.navio_id && c.navio_id === navio.id)) {
          if (c.status !== 'ENTREGUE' && c.status !== 'CANCELADA' && c.status !== 'RECUSADA') {
            c.status = 'EM_TRANSITO';
          }
        }
      });
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxo));

      // Sincroniza Supabase
      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('navios')
            .update({ localizacao: 'FORA_DO_PORTO', data_saida: horaSaida })
            .eq('numero_imo', imo);

          if (navio.id) {
            await window.nexusSupabase.from('cargas')
              .update({ status_fluxo: 'EM_TRANSITO' })
              .eq('navio_id', navio.id)
              .not('status_fluxo', 'in', '("ENTREGUE","CANCELADA","RECUSADA")');
          }
        } catch (err) { console.warn('Erro ao liberar navio no Supabase:', err); }
      }

      // Registra no Trail de Decisões Críticas
      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('LIBEROU_NAVIO', 'navios', navio.id || null, `Navio ${navio.nome} (${navio.imo}) liberado para saída com destino a ${navio.destino} por ${session.nome || session.cargo}. Horário: ${new Date(horaSaida).toLocaleString('pt-BR')}`);
      }

      // Registra auditoria
      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EDICAO', 'navios', navio.id || null, { localizacao: 'FORA_DO_PORTO', data_saida: horaSaida });
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('navios');
        window.NexusRepository.notifyChange('cargas');
      }

      renderGpsTable();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Navio Liberado', `Navio ${navio.nome} liberado com sucesso pela Rota ${rotaCadastrada.origem} ➔ ${rotaCadastrada.destino} (${navio.distancia} km). Horário de saída: ${new Date(horaSaida).toLocaleString('pt-BR')}.`);
      }
    }
  };

  // Autorização de retorno do navio ao porto de origem
  window.autorizarRetornoNavio = async function(imo) {
    const podeLiberar = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    if (!podeLiberar) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Negado', 'Apenas o Supervisor de Operações ou Diretor pode autorizar o retorno de navios!');
      }
      return;
    }

    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    // A autorização de retorno só é permitida se o navio já tiver chegado ao porto de destino
    if (navio.localizacao !== 'NO_PORTO_DE_DESTINO') {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Retorno Não Permitido', `O retorno do navio "${navio.nome}" para o porto de origem só pode ser autorizado quando ele já estiver chegado ao porto de destino! Status atual: ${navio.localizacao}.`);
      }
      return;
    }

    const confirmou = window.nexusConfirm ? await window.nexusConfirm('Autorizar Retorno de Embarcação', `Autorizar o retorno da embarcação ${navio.nome} ao Porto de Origem (${navio.origem})?`) : true;

    if (confirmou) {
      // Inverte Origem e Destino para a viagem de regresso
      const antigoDestino = navio.destino;
      navio.destino = navio.origem;
      navio.origem = antigoDestino;
      navio.localizacao = 'FORA_DO_PORTO';
      navio.dataSaida = new Date().toISOString();

      localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('navios')
            .update({
              porto_origem: navio.origem,
              porto_destino: navio.destino,
              localizacao: 'FORA_DO_PORTO',
              data_saida: navio.dataSaida
            })
            .eq('numero_imo', imo);
        } catch (err) { console.warn('Erro ao atualizar retorno do navio no Supabase:', err); }
      }

      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('LIBEROU_NAVIO', 'navios', navio.id || null, `Retorno autorizado para o porto ${navio.destino} por ${session.nome || session.cargo}`);
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EDICAO', 'navios', navio.id || null, { porto_origem: navio.origem, porto_destino: navio.destino, localizacao: 'FORA_DO_PORTO' });
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('navios');
      }

      renderGpsTable();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Retorno Autorizado', `Retorno do navio ${navio.nome} ao porto ${navio.destino} autorizado com sucesso!`);
      }
    }
  };

  // Vincular Navio a um dos 15 Berços (Tarefa 6)
  window.vincularNavioABerco = async function(imo) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    bercosList = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    const bercosLivres = bercosList.filter(b => b.estado === 'LIVRE');

    if (bercosLivres.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Berços Indisponíveis', 'Nenhum berço desocupado disponível no momento para vinculação do navio.');
      }
      return;
    }

    const optionsText = bercosLivres.map((b, idx) => `${idx + 1} - ${b.nome}`).join('\n');
    const selecao = await window.nexusPrompt('Vincular Navio a Berço', `Selecione um Berço Desocupado para o navio ${navio.nome} (${navio.imo}):\n${optionsText}`);

    if (!selecao) return;

    const idxSel = parseInt(selecao, 10) - 1;
    if (!isNaN(idxSel) && bercosLivres[idxSel]) {
      const bercoAlvo = bercosLivres[idxSel];

      // Desocupa berço anterior do navio se houver
      bercosList.forEach(b => {
        if (b.navio_imo === imo || b.navio_nome === navio.nome) {
          b.estado = 'LIVRE';
          b.navio_nome = null;
          b.navio_imo = null;
        }
      });

      const bercoReal = bercosList.find(b => b.nome === bercoAlvo.nome);
      if (bercoReal) {
        bercoReal.estado = 'OCUPADO';
        bercoReal.navio_nome = navio.nome;
        bercoReal.navio_imo = navio.imo;
      }

      localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
      renderBercosPanel();
      renderGpsTable();

      // Tarefa 6: Salva no banco de dados a vinculação do navio ao berço
      if (window.nexusSupabase) {
        try {
          // Atualiza as coordenadas/localização ou registro no Supabase se houver coluna de berço
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          let navioQuery = window.nexusSupabase.from('navios').update({
            localizacao: 'DENTRO_DO_PORTO'
          });
          if (isUuid.test(navio.id)) {
            navioQuery = navioQuery.eq('id', navio.id);
          } else {
            navioQuery = navioQuery.eq('numero_imo', navio.imo);
          }
          await navioQuery;

          // Se existir a tabela bercos no Supabase, tenta persistir lá também
          await window.nexusSupabase.from('bercos').upsert({
            nome: bercoAlvo.nome,
            estado: 'OCUPADO',
            navio_nome: navio.nome,
            navio_imo: navio.imo,
            navio_id: isUuid.test(navio.id) ? navio.id : null
          }, { onConflict: 'nome' }).catch(() => {});
        } catch (e) {
          console.warn('[NexusPort] Erro ao salvar vinculação de berço no Supabase:', e);
        }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EDICAO', 'navios', navio.id || null, `Navio ${navio.nome} vinculado ao ${bercoAlvo.nome}`);
      }
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Navio Vinculado', `Navio ${navio.nome} vinculado com sucesso ao ${bercoAlvo.nome}!`);
      }
    } else {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Opção Inválida', 'Seleção de berço inválida.');
    }
  };

  // Excluir Navio (Tarefa 6)
  window.excluirNavio = async function(imo) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    const confirmou = window.nexusConfirm
      ? await window.nexusConfirm('Excluir Navio', `Tem certeza que deseja EXCLUIR o navio ${navio.nome} (${navio.imo})? essa ação desocupará berços e removerá o navio do sistema.`)
      : true;

    if (confirmou) {
      naviosList = naviosList.filter(n => n.imo !== imo);
      localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

      // Desocupa o navio de qualquer berço
      bercosList = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
      bercosList.forEach(b => {
        if (b.navio_imo === imo || b.navio_nome === navio.nome) {
          b.estado = 'LIVRE';
          b.navio_nome = null;
          b.navio_imo = null;
        }
      });
      localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('navios').delete().eq('numero_imo', imo);
        } catch (e) {
          console.warn('Erro ao excluir navio no Supabase:', e);
        }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EXCLUSAO', 'navios', navio.id || null, `Navio ${navio.nome} (${imo}) excluído do sistema`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('navios');
      }

      renderBercosPanel();
      renderGpsTable();

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Navio Excluído', `Navio ${navio.nome} (${imo}) excluído com sucesso do sistema.`);
      }
    }
  };

  carregarNaviosSupabase();

  // C6: Relógio em tempo real que atualiza continuamente a contagem de ETA e tempo fora do porto
  setInterval(renderGpsTable, 1000);

  const isInspetorRole = ['INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

  if (toggleNavioBtn && navioForm) {
    if (!isInspetorRole) toggleNavioBtn.classList.add('hidden');
    toggleNavioBtn.addEventListener('click', () => {
      if (!isInspetorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Inspetores têm permissão para cadastrar novos navios (Spec.md RF 1)!');
        }
        return;
      }
      navioForm.classList.toggle('hidden');
    });
  }

  // Validador de Coordenadas GPS Reais (Item 12)
  function validarCoordenadaGPS(gpsStr) {
    if (!gpsStr) return false;
    const clean = gpsStr.trim();
    const regexCoords = /^[-+]?\d+(\.\d+)?\s*°?\s*([NSns])?\s*,\s*[-+]?\d+(\.\d+)?\s*°?\s*([EWEOewoe])?$/;
    if (!regexCoords.test(clean)) return false;

    const numbers = clean.match(/[-+]?\d+(\.\d+)?/g);
    if (!numbers || numbers.length < 2) return false;
    const lat = Math.abs(parseFloat(numbers[0]));
    const lon = Math.abs(parseFloat(numbers[1]));
    return lat <= 90 && lon <= 180;
  }

  if (navioForm) {
    navioForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isInspetorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Cadastro de navios é de responsabilidade do Inspetor!');
        }
        return;
      }
      const nome = document.getElementById('navioNome').value.trim();
      const imo = document.getElementById('navioImo').value.trim().toUpperCase().replace(/\s+/g, '');
      const origem = document.getElementById('navioOrigem').value.trim();
      const destino = document.getElementById('navioDestino').value.trim();
      const localizacao = document.getElementById('navioLocalizacao').value;
      const gps = document.getElementById('navioGps').value.trim();
      const distancia = parseFloat(document.getElementById('navioDistancia').value) || 10200;

      // Item 11: Validação do padrão do Número IMO (3 letras + 7 números)
      const imoRegex = /^[A-Z]{3}\d{7}$/;
      if (!imoRegex.test(imo)) {
        const msg = 'FORMATO DE IMO INVÁLIDO (Item 11): O número IMO deve seguir obrigatoriamente a estrutura fixa de 3 letras + 7 números (ex.: IMO1234567 ou ABC1234567).';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'IMO Inválido', msg);
        return;
      }

      // Item 11: Validação de unicidade do IMO
      const imoExistente = naviosList.find(n => (n.imo || '').toUpperCase().replace(/\s+/g, '') === imo);
      if (imoExistente) {
        const msg = `BLOQUEIO DE DUPLICIDADE (Item 11): Já existe um navio cadastrado com o número IMO "${imo}" (${imoExistente.nome}). Cada embarcação deve possuir IMO único!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'IMO Duplicado', msg);
        return;
      }

      // Item 12: Validação de Coordenada GPS Real
      if (!validarCoordenadaGPS(gps)) {
        const msg = 'COORDENADA GPS INVÁLIDA (Item 12): Informe uma coordenada geográfica real dentro dos limites válidos (ex.: "-23.9608, -46.3022" ou "23.9608° S, 46.3022° W").';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'GPS Inválido', msg);
        return;
      }

      // Item 12: Bloqueio de coordenadas GPS duplicadas
      const gpsExistente = naviosList.find(n => n.gps && n.gps.trim() === gps);
      if (gpsExistente) {
        const msg = `BLOQUEIO DE LOCALIZAÇÃO (Item 12): já existe navio nesta localização (${gpsExistente.nome}). Dois navios não podem ocupar exatamente a mesma coordenada GPS simultaneamente!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Localização Ocupada', msg);
        return;
      }

      const novoNavio = {
        nome, imo, gps, localizacao, origem, destino, distancia, dataSaida: localizacao === 'FORA_DO_PORTO' ? new Date().toISOString() : null
      };

      let insertedId = null;
      if (window.nexusSupabase) {
        try {
          const { data, error } = await window.nexusSupabase.from('navios').insert({
            nome,
            numero_imo: imo,
            porto_origem: origem,
            porto_destino: destino,
            localizacao,
            coordenadas_gps: gps,
            estado_operacional: 'OPERANTE',
            qr_code_url: `QR-${imo}`
          }).select('id').single();

          if (data && data.id) {
            insertedId = data.id;
            novoNavio.id = data.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'navios', insertedId, { nome, numero_imo: imo, porto_origem: origem, porto_destino: destino });
          }
          if (window.NexusRepository && window.NexusRepository.notifyChange) {
            window.NexusRepository.notifyChange('navios');
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar navio com Supabase:', err);
        }
      }

      naviosList.unshift(novoNavio);
      localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

      renderGpsTable();
      navioForm.reset();
      navioForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Navio Cadastrado', `Navio ${nome} (${imo}) cadastrado e sincronizado com sucesso no Supabase!`);
      }
    });
  }

  // CRUD de Contêineres (T2.6 / RN 7)
  let containersList = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');

  async function carregarContainersSupabase() {
    let localConts = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('containers')
          .select('*');

        if (!error && Array.isArray(data) && data.length > 0) {
          const supConts = data.map(c => ({
            id: c.id || `CONT-${c.numero_identificacao}`,
            rawDbId: c.id,
            identificacao: c.numero_identificacao,
            tipo: c.material_carregado || 'Carga Geral',
            dataFabr: c.data_fabricacao || '',
            dataManut: c.data_ultima_manutencao || 'Sem Manutenção',
            refTempo: c.tempo_uso_referencia || 'DATA_FABRICACAO',
            navio_id: c.navio_id || null,
            navio: c.navio_id ? 'Vinculado' : 'Não Vinculado',
            estado: c.estado || 'OPERANTE'
          }));

          // Mescla contêineres locais com o banco Supabase para preservar cadastros
          const supIdSet = new Set(supConts.map(x => (x.identificacao || '').toUpperCase()));
          localConts.forEach(lc => {
            if (lc.identificacao && !supIdSet.has(lc.identificacao.toUpperCase())) {
              supConts.push(lc);
            }
          });

          containersList = supConts;
          localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));
          renderContainersTable();
          return;
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao carregar contêineres do Supabase:', err);
      }
    }
    containersList = localConts;
    renderContainersTable();
  }

  function renderContainersTable() {
    if (!containersTableBody) return;

    if (containersList.length === 0) {
      containersTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-4 text-center text-slate-400 italic">Nenhum contêiner cadastrado no banco de dados.</td>
        </tr>
      `;
      return;
    }

    containersTableBody.innerHTML = containersList.map(c => {
      // C3: Busca cargas vinculadas a este contêiner
      const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      const cargasDoCont = cargasFluxo.filter(crg => crg.container && (crg.container.toLowerCase() === c.identificacao.toLowerCase() || crg.container.toLowerCase() === c.id.toLowerCase()));

      let cargasVinculadasHtml = '<span class="text-slate-400 italic text-[11px]">Nenhuma carga</span>';
      if (cargasDoCont.length > 0) {
        cargasVinculadasHtml = cargasDoCont.map(crg => `
          <span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-nexus-500 font-bold">${crg.id} (${crg.volume})</span>
        `).join(' ');
      }

      const manutDisplay = c.dataManut || 'Sem Manutenção';

      let contAcoesHtml = `
        <div class="flex items-center justify-end gap-1.5 font-mono text-[11px]">
          <button type="button" onclick="window.vincularContainerANavio('${c.identificacao}')" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">link</span><span>Vincular</span></button>
          <button type="button" onclick="window.excluirContainer('${c.identificacao}')" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">delete</span><span>Excluir</span></button>
        </div>
      `;

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-mono font-bold text-nexus-500">${c.identificacao}</td>
          <td class="p-3 font-bold">${c.tipo}</td>
          <td class="p-3 font-mono text-xs">${cargasVinculadasHtml}</td>
          <td class="p-3 font-mono text-xs">Fab: ${c.dataFabr}<br>Manut: ${manutDisplay}</td>
          <td class="p-3 font-mono text-xs"><span class="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold">${c.refTempo}</span></td>
          <td class="p-3 font-bold text-xs">${c.navio || 'Não Vinculado'}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">${c.estado}</span></td>
          <td class="p-3 text-right whitespace-nowrap">${contAcoesHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // Vincular Contêiner a um Navio com Validação de Capacidade (15.000 t e ~300m) (Tarefa 8)
  window.vincularContainerANavio = async function(contIdentificacao) {
    const cont = containersList.find(c => (c.identificacao || '').toUpperCase() === contIdentificacao.toUpperCase());
    if (!cont) return;

    if (naviosList.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Navios Indisponíveis', 'Nenhum navio cadastrado no sistema para vinculação de contêiner.');
      }
      return;
    }

    const optionsText = naviosList.map((n, idx) => `${idx + 1} - ${n.nome} (${n.imo}) [${n.localizacao}]`).join('\n');
    const selecao = await window.nexusPrompt('Vincular Contêiner a Navio', `Selecione um Navio para o contêiner ${cont.identificacao}:\n${optionsText}`);

    if (!selecao) return;

    const idxSel = parseInt(selecao, 10) - 1;
    if (!isNaN(idxSel) && naviosList[idxSel]) {
      const navioAlvo = naviosList[idxSel];

      // Validação de Capacidade Rígida (OBS Tarefa 8): max 15.000 toneladas e ~300 metros de espaço
      // Calcula peso e quantidade de contêineres atualmente alocados ao navioAlvo
      const contsDoNavio = containersList.filter(c => (c.navio || '').toLowerCase() === navioAlvo.nome.toLowerCase() || c.navio_id === navioAlvo.id);

      const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      let pesoTotalNavioTons = 0;

      cargasFluxo.filter(crg => crg.navio && crg.navio.toLowerCase() === navioAlvo.nome.toLowerCase()).forEach(crg => {
        pesoTotalNavioTons += parseFloat(crg.peso) || 0;
      });

      // Cada contêiner ocupa aproximadamente 12m de comprimento e em média 25t
      const espacoOcupadoMetros = (contsDoNavio.length + 1) * 12; // 300m max => aprox 25 contêineres
      const pesoEstimadoComNovo = pesoTotalNavioTons + 25; // 25t por contêiner padrão

      const LIMITE_PESO_TONS = 15000;
      const LIMITE_ESPACO_METROS = 300;

      if (pesoEstimadoComNovo > LIMITE_PESO_TONS || espacoOcupadoMetros > LIMITE_ESPACO_METROS) {
        const msgErro = `BLOQUEIO DE CAPACIDADE (Tarefa 8): O navio "${navioAlvo.nome}" não possui suporte para vincular este contêiner! Capacidade limite excedida: O navio suporta no máximo 15.000 toneladas e 300 metros de espaço.`;
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Capacidade Excedida', msgErro);
        }
        return;
      }

      cont.navio = navioAlvo.nome;
      cont.navio_id = navioAlvo.id;

      localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('containers')
            .update({ navio_id: navioAlvo.id })
            .eq('numero_identificacao', cont.identificacao);
        } catch (e) {
          console.warn('Erro ao atualizar vinculação de contêiner no Supabase:', e);
        }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EDICAO', 'containers', cont.id || null, `Contêiner ${cont.identificacao} vinculado ao navio ${navioAlvo.nome}`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('containers');
      }

      renderContainersTable();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Contêiner Vinculado', `Contêiner ${cont.identificacao} vinculado com sucesso ao navio ${navioAlvo.nome}!`);
      }
    } else {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Opção Inválida', 'Seleção de navio inválida.');
    }
  };

  // Excluir Contêiner (Tarefa 8)
  window.excluirContainer = async function(contIdentificacao) {
    const cont = containersList.find(c => (c.identificacao || '').toUpperCase() === contIdentificacao.toUpperCase());
    if (!cont) return;

    const confirmou = window.nexusConfirm
      ? await window.nexusConfirm('Excluir Contêiner', `Tem certeza que deseja EXCLUIR o contêiner ${cont.identificacao}? Essa ação o removerá do sistema.`)
      : true;

    if (confirmou) {
      containersList = containersList.filter(c => (c.identificacao || '').toUpperCase() !== contIdentificacao.toUpperCase());
      localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('containers').delete().eq('numero_identificacao', contIdentificacao);
        } catch (e) {
          console.warn('Erro ao excluir contêiner no Supabase:', e);
        }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EXCLUSAO', 'containers', cont.id || null, `Contêiner ${cont.identificacao} excluído do sistema`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('containers');
      }

      renderContainersTable();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Contêiner Excluído', `Contêiner ${contIdentificacao} excluído com sucesso do sistema.`);
      }
    }
  };

  carregarContainersSupabase();

  if (toggleContainerBtn && containerForm) {
    if (!isInspetorRole) toggleContainerBtn.classList.add('hidden');
    toggleContainerBtn.addEventListener('click', () => {
      if (!isInspetorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Inspetores têm permissão para cadastrar novos contêineres (Spec.md RF 1)!');
        }
        return;
      }
      containerForm.classList.toggle('hidden');
    });
  }

  const semManutCheckbox = document.getElementById('contSemManutencaoCheckbox');
  const contManutInput = document.getElementById('contManutencao');

  if (semManutCheckbox && contManutInput) {
    semManutCheckbox.addEventListener('change', () => {
      if (semManutCheckbox.checked) {
        contManutInput.value = '';
        contManutInput.disabled = true;
      } else {
        contManutInput.disabled = false;
      }
    });
  }

  if (containerForm) {
    containerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isInspetorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Cadastro de contêineres é de responsabilidade do Inspetor!');
        }
        return;
      }
      const rawIdentificacao = document.getElementById('contIdentificacao').value.trim().toUpperCase();
      const identificacao = rawIdentificacao.replace(/[^A-Z0-9]/g, '');
      const tipo = document.getElementById('contTipo').value.trim();
      const dataFabr = document.getElementById('contFabricacao').value;
      let dataManut = document.getElementById('contManutencao').value;
      if (semManutCheckbox && semManutCheckbox.checked) {
        dataManut = 'Sem Manutenção';
      } else if (!dataManut) {
        dataManut = 'Sem Manutenção';
      }
      const refTempo = document.getElementById('contRefTempo').value;

      // Tarefa 7: Validação do padrão 4 letras e 7 números (ex: ABCD1234567)
      const patternContainer = /^[A-Z]{4}\d{7}$/;
      if (!patternContainer.test(identificacao)) {
        const msg = 'PADRÃO DE CONTÊINER INVÁLIDO (Tarefa 7): A identificação do contêiner deve seguir o padrão de 4 letras seguidas de 7 números (Exemplo: MSCU1234567)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Formato Inválido', msg);
        return;
      }

      // Item 13: Validação de unicidade do código de contêiner
      const contExistente = containersList.find(c => (c.identificacao || '').toUpperCase() === identificacao);
      if (contExistente) {
        const msg = `BLOQUEIO DE DUPLICIDADE (Item 13): O código de contêiner "${identificacao}" já está cadastrado no sistema. Não é permitido duplicar contêineres!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Contêiner Duplicado', msg);
        return;
      }

      // Item 14: Validação de coerência entre data de fabricação e manutenção
      if (dataFabr && dataManut && new Date(dataManut) < new Date(dataFabr)) {
        const msg = 'DATA INCONSISTENTE (Item 14): A data da última manutenção não pode ser anterior à data de fabricação do contêiner!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data Inconsistente', msg);
        return;
      }

      const newCont = {
        id: `CONT-${Math.floor(100 + Math.random() * 900)}`,
        identificacao, tipo, dataFabr, dataManut, refTempo, navio: '', estado: 'DISPONIVEL'
      };

      let insertedContId = null;
      if (window.nexusSupabase) {
        try {
          const dbDataManut = (dataManut && dataManut !== 'Sem Manutenção') ? dataManut : null;
          const { data, error } = await window.nexusSupabase.from('containers').insert({
            numero_identificacao: identificacao,
            material_carregado: tipo,
            data_fabricacao: dataFabr || null,
            data_ultima_manutencao: dbDataManut,
            tempo_uso_referencia: refTempo,
            estado: 'OPERANTE',
            qr_code_url: `QR-${identificacao}`
          }).select('id').single();

          if (!error && data && data.id) {
            insertedContId = data.id;
            newCont.id = data.id;
            newCont.rawDbId = data.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'containers', insertedContId, { numero_identificacao: identificacao, material_carregado: tipo });
          }
          if (window.NexusRepository && window.NexusRepository.notifyChange) {
            window.NexusRepository.notifyChange('containers');
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar contêiner com Supabase:', err);
        }
      }

      containersList.push(newCont);
      localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));

      renderContainersTable();
      containerForm.reset();
      containerForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Contêiner Cadastrado', `Contêiner ${identificacao} cadastrado com sucesso com referência de tempo em "${refTempo}" (RN 7)!`);
      }
    });
  }

  // CRUD e Cadastro de Guindastes na página Embarcações & GPS (Tarefa 10)
  const toggleGuindasteBtn = document.getElementById('toggleGuindasteFormBtn');
  const guindasteForm = document.getElementById('guindasteForm');
  const guindastesTableBody = document.getElementById('guindastesTableBody');

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

    const tarefasGndAll = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');

    guindastesTableBody.innerHTML = guindastesList.map(g => {
      const tarefasAtivas = tarefasGndAll.filter(t => t.guindasteId === g.identificacao);
      const temTarefas = tarefasAtivas.length > 0;

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-mono font-bold text-nexus-500">${g.identificacao}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
              g.estado === 'OPERANTE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
              'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }">${g.estado}</span>
          </td>
          <td class="p-3 font-mono text-xs">${g.dataManut || 'N/A'}</td>
          <td class="p-3 text-right">
            <div class="flex items-center justify-end gap-1.5 font-mono text-[11px]">
              <button type="button" onclick="window.exibirTarefasGuindaste('${g.identificacao}')" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1 transition-all ${temTarefas ? 'animate-pulse ring-2 ring-amber-400' : 'opacity-80'}">
                <span class="material-symbols-outlined text-[13px]">task</span>
                <span>Tarefas (${tarefasAtivas.length})</span>
              </button>
              <button type="button" onclick="window.excluirGuindaste('${g.identificacao}')" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">delete</span><span>Excluir</span></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Excluir Guindaste (Item 6)
  window.excluirGuindaste = async function(gndIdentificacao) {
    const guindaste = guindastesList.find(g => (g.identificacao || '').toUpperCase() === gndIdentificacao.toUpperCase());
    if (!guindaste) return;

    const confirmou = window.nexusConfirm
      ? await window.nexusConfirm('Excluir Guindaste', `Tem certeza que deseja EXCLUIR o guindaste ${guindaste.identificacao}? Esta ação o removerá do sistema.`)
      : true;

    if (confirmou) {
      guindastesList = guindastesList.filter(g => (g.identificacao || '').toUpperCase() !== gndIdentificacao.toUpperCase());
      localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));

      // Remove tarefas associadas
      let tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
      tarefasGnd = tarefasGnd.filter(t => t.guindasteId !== gndIdentificacao);
      localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasGnd));

      if (window.nexusSupabase) {
        try {
          await window.nexusSupabase.from('guindastes').delete().eq('numero_identificacao', gndIdentificacao);
        } catch (e) {
          console.warn('Erro ao excluir guindaste no Supabase:', e);
        }
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EXCLUSAO', 'guindastes', guindaste.id || null, `Guindaste ${guindaste.identificacao} excluído do sistema`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('guindastes');
      }

      renderGuindastesTable();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Guindaste Excluído', `Guindaste ${gndIdentificacao} excluído com sucesso do sistema.`);
      }
    }
  }

  window.exibirTarefasGuindaste = async function(gndIdentificacao) {
    const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    const tarefasAtivas = tarefasGnd.filter(t => t.guindasteId === gndIdentificacao);

    if (tarefasAtivas.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Tarefas do Guindaste', `Nenhuma tarefa pendente para o Guindaste ${gndIdentificacao}.`);
      }
      return;
    }

    const listaTxt = tarefasAtivas.map((t, idx) => `${idx + 1}. Carga ${t.cargaId} (${t.tipoCarga || 'Geral'}) ➔ Destino: ${t.destino}`).join('\n');

    if (window.mostrarFeedback) {
      window.mostrarFeedback('atencao', `Tarefas do Guindaste ${gndIdentificacao}`, `TAREFA DE GUINDASTE (${gndIdentificacao}):\n\n${listaTxt}\n\nApós o serviço do guindaste ser concluído, na página 'Cargas & Pátio', ao clicar no botão 'receber', a tarefa sumirá.`);
    }
  };

  carregarGuindastesSupabase();

  if (toggleGuindasteBtn && guindasteForm) {
    if (!isInspetorRole) toggleGuindasteBtn.classList.add('hidden');
    toggleGuindasteBtn.addEventListener('click', () => {
      if (!isInspetorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Inspetores têm permissão para cadastrar novos guindastes!');
        }
        return;
      }
      guindasteForm.classList.toggle('hidden');
    });
  }

  if (guindasteForm) {
    guindasteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isInspetorRole) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Cadastro de guindastes é de responsabilidade do Inspetor!');
        return;
      }

      const rawIdentificacao = document.getElementById('gndNumero').value.trim().toUpperCase();
      const identificacao = rawIdentificacao.replace(/[^A-Z0-9]/g, '');
      const dataManut = document.getElementById('gndDataManut').value;
      const estado = document.getElementById('gndEstado').value;

      // Tarefa 8: Validação do padrão 3 letras - 3 números - 3 letras (ex: ABC123DEF)
      const patternCrane = /^[A-Z]{3}\d{3}[A-Z]{3}$/;
      if (!patternCrane.test(identificacao)) {
        const msg = 'PADRÃO DE GUINDASTE/PÓRTICO INVÁLIDO (Tarefa 8): A identificação deve seguir o padrão de 3 letras, 3 números e 3 letras (Exemplo: ABC123DEF)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Formato Inválido', msg);
        return;
      }

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

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    carregarNaviosSupabase();
    carregarContainersSupabase();
    carregarGuindastesSupabase();
    renderBercosPanel();
  });
});
