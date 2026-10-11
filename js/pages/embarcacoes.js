/**
 * Lógica do Módulo de Embarcações & GPS (embarcacoes.html) - NexusPort
 * Gerencia navios, contêineres e calcula ETA a 33 km/h.
 * Corrige o tempo fora do porto para navios em NO_PORTO_DE_DESTINO (RF 5 / RN 8).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  const gpsTableBody = document.getElementById('embarcacoesGpsTableBody');
  const toggleNavioBtn = document.getElementById('toggleNavioFormBtn');
  const navioForm = document.getElementById('navioForm');
  const toggleContainerBtn = document.getElementById('toggleContainerFormBtn');
  const containerForm = document.getElementById('containerForm');
  const containersTableBody = document.getElementById('containersTableBody');

  let naviosList = [];
  // Backlog 3 (rotas): única fonte de origem/destino/distância = rotas_maritimas do Supabase.
  let rotasMaritimasList = [];
  let rotasCarregamentoFalhou = false;

  // Gestão e Painel de Berços Livres do Terminal STS-01 (15 Berços para Navios)
  const bercosGrid = document.getElementById('bercosGrid');
  const bercosLivresTag = document.getElementById('bercosLivresCountTag');

  let bercosList = [];

  /**
   * Retorna o cliente Supabase apenas se a tabela `bercos` estiver disponível.
   * Caso a tabela ainda não exista no banco (erro PGRST205), a aplicação
   * continua funcionando somente com o cache local (localStorage).
   */
  function clienteBercos() {
    if (window.NexusSupabaseUtils) return window.NexusSupabaseUtils.clientePara('bercos');
    return window.nexusSupabase || null;
  }

  function tratarErroBercos(error) {
    if (!error) return false;
    if (window.NexusSupabaseUtils) return window.NexusSupabaseUtils.registrarErroTabela('bercos', error);
    console.warn('[NexusPort] Erro na tabela bercos:', error.message || error);
    return false;
  }

  /**
   * Delega a normalização do berço para a definição única das regras de
   * `public.bercos` (js/supabase-client.js). Se o utilitário não estiver
   * carregado, devolve payload nulo — falha fechada, nada é gravado.
   */
  function normalizarBerco(berco) {
    const utils = window.NexusSupabaseUtils;
    if (utils && typeof utils.normalizarBerco === 'function') {
      return utils.normalizarBerco(berco);
    }
    return { payload: null, corrigido: false, motivo: 'utilitário de normalização indisponível' };
  }

  /**
   * Corrige o cache local (e o array em memória) para que nenhuma linha viole
   * as constraints de public.bercos — em especial
   * `bercos_vinculo_navio_check` (OCUPADO exige navio_nome ou navio_imo).
   * Sem isso, um único berço legado inválido derruba o upsert em lote com o
   * erro 23514 e o painel para de sincronizar.
   *
   * @returns {boolean} true se algum berço precisou ser corrigido.
   */
  function sanearBercosLocais(lista) {
    let alterado = false;
    (lista || []).forEach(b => {
      const resultado = normalizarBerco(b);
      if (!resultado.payload) {
        if (resultado.motivo) {
          console.warn(`[NexusPort] Berço ignorado na sincronização: ${resultado.motivo}.`);
        }
        return;
      }
      b.id = resultado.payload.id;
      b.nome = resultado.payload.nome;
      b.estado = resultado.payload.estado;
      b.navio_nome = resultado.payload.navio_nome;
      b.navio_imo = resultado.payload.navio_imo;
      b.navio_id = resultado.payload.navio_id;
      if (resultado.corrigido) {
        alterado = true;
        console.warn(`[NexusPort] Berço ${b.nome} ajustado para gravação: ${resultado.motivo || 'registro fora do padrão de public.bercos'}.`);
      }
    });
    return alterado;
  }

  /** Os 15 berços do terminal STS-01 (modelo usado para completar a tabela). */
  function modeloBercos() {
    return Array.from({ length: 15 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      return { id: `BERCO-${num}`, nome: `Berço ${num}`, estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null };
    });
  }

  // true quando a lista em memória veio do Supabase nesta carga da página.
  // Sem essa confirmação a tela não grava ocupação a partir do cache.
  let bercosConfirmadosNoBanco = false;

  /**
   * Carrega a ocupação dos berços SEMPRE do Supabase (public.bercos).
   *
   * Causa-raiz corrigida: antes o painel lia o localStorage, completava o
   * banco com o cache e LIBERAVA no banco todo berço cujo navio não estivesse
   * na lista local de navios — limpar cookies/cache (ou abrir outra máquina)
   * desocupava os berços. Agora o cache é só um espelho de leitura do banco e
   * nunca decide ocupação. Berços faltantes (tabela recém-criada) são
   * inseridos como LIVRE, sem sobrescrever linhas existentes.
   */
  async function carregarBercosSupabase() {
    const clientLeitura = clienteBercos();
    if (clientLeitura) {
      try {
        const { data, error } = await clientLeitura.from('bercos').select('*').order('nome', { ascending: true });
        if (error) {
          tratarErroBercos(error);
        } else if (Array.isArray(data)) {
          const doBanco = new Map(data.map(b => [b.nome, {
            id: b.id || `BERCO-${String(b.nome || '').replace(/\D/g, '').padStart(2, '0')}`,
            nome: b.nome,
            estado: b.estado || 'LIVRE',
            navio_nome: b.navio_nome || null,
            navio_imo: b.navio_imo || null,
            navio_id: b.navio_id || null
          }]));
          const faltantes = modeloBercos().filter(b => !doBanco.has(b.nome));
          if (faltantes.length > 0) {
            try {
              const payload = faltantes.map(b => normalizarBerco(b).payload).filter(Boolean);
              // ignoreDuplicates: nunca sobrescreve um berço que outro usuário acabou de ocupar
              const { error: erroInsert } = await clientLeitura.from('bercos').upsert(payload, { onConflict: 'nome', ignoreDuplicates: true });
              tratarErroBercos(erroInsert);
            } catch (e) {
              if (!tratarErroBercos(e)) console.warn('[NexusPort] Erro ao completar os berços no Supabase:', e);
            }
          }
          bercosList = modeloBercos().map(b => doBanco.get(b.nome) || b);
          sanearBercosLocais(bercosList);
          bercosConfirmadosNoBanco = true;
          localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
          renderBercosPanel();
          Promise.resolve().then(() => renderGpsTable());
          return;
        }
      } catch (err) {
        if (!tratarErroBercos(err)) {
          console.warn('[NexusPort] Erro ao carregar berços do Supabase:', err);
        }
      }
    }

    // Modo sem banco (ou banco indisponível): exibe o último espelho conhecido.
    bercosConfirmadosNoBanco = false;
    const cache = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    const porNome = new Map((Array.isArray(cache) ? cache : []).map(b => [b.nome, b]));
    bercosList = modeloBercos().map(b => porNome.get(b.nome) || b);
    sanearBercosLocais(bercosList);
    renderBercosPanel();
    // Após o término do handler (as constantes da tabela GPS já existem)
    Promise.resolve().then(() => renderGpsTable());
  }

  /** Berço ocupado pelo navio (por id do banco ou IMO), ou null. */
  function bercoDoNavio(navio) {
    if (!navio) return null;
    return bercosList.find(b => b.estado === 'OCUPADO' && (
      (b.navio_id && navio.id && String(b.navio_id) === String(navio.id)) ||
      (b.navio_imo && navio.imo && String(b.navio_imo).toUpperCase() === String(navio.imo).toUpperCase())
    )) || null;
  }

  /**
   * Libera o berço do navio (saída liberada / exclusão). No banco, o gatilho
   * trg_navios_liberar_bercos_* faz o mesmo; a chamada explícita cobre bancos
   * ainda sem a migração. Em seguida a tela relê a ocupação do Supabase.
   */
  async function liberarBercoDoNavio(navio) {
    const integ = window.NexusIntegridade;
    if (clienteBercos() && integ) {
      const r = await integ.liberarBercosDoNavio(navio);
      if (!r.ok) console.warn('[NexusPort] Berço do navio não liberado no Supabase:', r.mensagem);
      await carregarBercosSupabase();
      return r.ok;
    }
    // Modo sem banco: atualiza o espelho local
    let alterado = false;
    bercosList.forEach(b => {
      const mesmo = b.estado === 'OCUPADO' && (
        (b.navio_imo && navio.imo && String(b.navio_imo).toUpperCase() === String(navio.imo).toUpperCase()) ||
        (b.navio_id && navio.id && String(b.navio_id) === String(navio.id)) ||
        (!b.navio_imo && b.navio_nome && navio.nome && b.navio_nome === navio.nome)
      );
      if (mesmo) {
        Object.assign(b, { estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null });
        alterado = true;
      }
    });
    if (alterado) localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
    renderBercosPanel();
    return true;
  }

  // Renderiza a lista em memória (carregada do banco). Não altera ocupação.
  function renderBercosPanel() {
    if (!Array.isArray(bercosList) || bercosList.length < 15) {
      const porNome = new Map((bercosList || []).map(b => [b.nome, b]));
      bercosList = modeloBercos().map(b => porNome.get(b.nome) || b);
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
            <span class="font-bold text-nexus-900 dark:text-white">${esc(b.nome)}</span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
              b.estado === 'LIVRE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
              b.estado === 'OCUPADO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
              'bg-slate-200 text-slate-800'
            }">${esc(b.estado)}</span>
          </div>
          <span class="text-[11px] text-slate-500 font-mono">
            ${b.estado === 'OCUPADO' ? `Navio: <strong class="text-nexus-500">${esc(b.navio_nome || b.navio_imo || 'Navio Alocado')}</strong>` : b.estado === 'LIVRE' ? 'Pronto para atracação' : 'Indisponível'}
          </span>
        </div>
      `).join('');
    }
  }

  carregarBercosSupabase();

  // Rótulos amigáveis para as localizações técnicas da embarcação (RN 12)
  const LOCALIZACAO_NAVIO = {
    DENTRO_DO_PORTO: { txt: 'No porto', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
    FORA_DO_PORTO: { txt: 'Em trânsito', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
    NO_PORTO_DE_DESTINO: { txt: 'Chegou ao destino', cls: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' }
  };

  function localizacaoInfo(localizacao) {
    return LOCALIZACAO_NAVIO[localizacao] || { txt: localizacao || 'Indefinida', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }

  // Etiqueta da coluna Localização (nome amigável + situação técnica no title)
  function localizacaoBadgeHtml(localizacao) {
    return `
      <span class="px-2 py-0.5 rounded text-xs font-bold uppercase ${
        localizacao === 'DENTRO_DO_PORTO' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
        localizacao === 'FORA_DO_PORTO' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' :
        localizacao === 'NO_PORTO_DE_DESTINO' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' :
        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }" title="${esc(`Situação técnica: ${localizacao || 'Indefinida'}`)}">${esc(localizacaoInfo(localizacao).txt)}</span>`;
  }

  // Cálculo de ETA a 33 km/h
  /**
   * Backlog 3 (7d): porcentagem decorrida do tempo previsto da viagem.
   * Mesma premissa do ETA: velocidade fixa de 33 km/h. Retorna null quando
   * não é possível estimar (data de saída ausente/inválida).
   */
  function calcularProgressoViagem(dataSaida, distanciaKm) {
    if (!dataSaida) return null;
    const saidaTime = new Date(dataSaida).getTime();
    if (isNaN(saidaTime)) return null;
    // Sem rota cadastrada não há distância: nunca se usa um valor padrão.
    const dist = parseFloat(distanciaKm);
    if (!(dist > 0)) return null;
    const msPrevistos = (dist / 33) * 3600 * 1000;
    if (msPrevistos <= 0) return null;
    const decorridos = Math.max(0, Date.now() - saidaTime);
    return Math.min(100, Math.round((decorridos / msPrevistos) * 100));
  }

  function calcularETA(distanciaKm) {
    if (!distanciaKm || distanciaKm <= 0) return 'Atracado / Viagem Concluída';
    const velocidade = 33; // km/h (RN 9)
    const horasTotais = distanciaKm / velocidade;
    const dias = Math.floor(horasTotais / 24);
    const horas = Math.round(horasTotais % 24);
    return `${dias}d ${horas}h (Distância: ${distanciaKm} km @ 33 km/h)`;
  }

  /**
   * Distância (km) cadastrada na rota marítima entre os dois portos (rotas_maritimas).
   * A busca é BIDIRECIONAL: a viagem de volta percorre o mesmo caminho invertido,
   * portanto usa a mesma distância (ex.: Santos → Paranaguá e Paranaguá → Santos).
   * Retorna null quando não há rota ou a distância não é válida — nunca um valor padrão.
   */
  function distanciaDaRota(origem, destino) {
    const o = String(origem || '').trim().toLowerCase();
    const d = String(destino || '').trim().toLowerCase();
    if (!o || !d) return null;
    const rota = rotasMaritimasList.find((r) => {
      const ro = String(r.origem || '').trim().toLowerCase();
      const rd = String(r.destino || '').trim().toLowerCase();
      return (ro === o && rd === d) || (ro === d && rd === o);
    });
    const km = rota ? parseFloat(rota.distancia_km) : NaN;
    return km > 0 ? km : null;
  }

  /** Rota cadastrada entre os dois portos, em qualquer um dos sentidos. */
  function rotaEntrePortos(origem, destino) {
    const o = String(origem || '').trim().toLowerCase();
    const d = String(destino || '').trim().toLowerCase();
    if (!o || !d) return null;
    return rotasMaritimasList.find((r) => {
      const ro = String(r.origem || '').trim().toLowerCase();
      const rd = String(r.destino || '').trim().toLowerCase();
      return (ro === o && rd === d) || (ro === d && rd === o);
    }) || null;
  }

  /** Distância oficial do navio: a da rota cadastrada (ETA e progresso dependem dela). */
  function distanciaDoNavio(navio) {
    const km = parseFloat(navio && navio.distancia);
    if (km > 0) return km;
    return distanciaDaRota(navio && navio.origem, navio && navio.destino);
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
            localizacao: n.localizacao || 'DENTRO_DO_PORTO',
            origem: n.porto_origem || 'Porto de Santos',
            destino: n.porto_destino || '',
            // A distância não é gravada no navio: vem da rota marítima cadastrada (distanciaDoNavio)
            distancia: null,
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

  /** O porto de origem/base do sistema é o Porto de Santos (STS-01). */
  function ehPortoDeSantos(porto) {
    return String(porto || '').toLowerCase().includes('santos');
  }

  /**
   * A carga pertence ao navio? Pelo id do navio (navio_id) quando a carga o
   * tem; o nome é usado apenas para cargas antigas sem navio_id.
   */
  function cargaPertenceAoNavio(carga, navio) {
    if (!carga || !navio) return false;
    const idCarga = carga.navio_id || carga.navioId;
    if (idCarga && navio.id) return String(idCarga) === String(navio.id);
    return Boolean(carga.navio) && Boolean(navio.nome) && String(carga.navio).trim().toLowerCase() === String(navio.nome).trim().toLowerCase();
  }

  // Navios cuja entrega já foi gravada no Supabase nesta sessão (evita repetir a cada segundo)
  const entregasSincronizadas = new Set();

  /** Grava ENTREGUE no banco só para as cargas EM_TRANSITO deste navio. */
  function sincronizarEntregaDoNavio(navio) {
    if (!window.nexusSupabase || !navio || entregasSincronizadas.has(navio.id || navio.imo)) return;
    const ehUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(navio.id || ''));
    if (!ehUuid) return; // sem id do banco não há filtro seguro: nada é gravado em lote
    entregasSincronizadas.add(navio.id);
    window.nexusSupabase.from('cargas')
      .update({ status_fluxo: 'ENTREGUE' })
      .eq('navio_id', navio.id)
      .eq('status_fluxo', 'EM_TRANSITO')
      .then(({ error } = {}) => {
        if (error) {
          entregasSincronizadas.delete(navio.id);
          console.warn('[NexusPort] Erro ao registrar entrega das cargas do navio no Supabase:', error);
        }
      })
      .catch(e => {
        entregasSincronizadas.delete(navio.id);
        console.warn('[NexusPort] Erro ao registrar entrega das cargas do navio no Supabase:', e);
      });
  }

  /**
   * Chegada de volta ao Porto de Santos: o navio fica "No porto"
   * (DENTRO_DO_PORTO) — e não "Chegou ao destino" — para poder receber novas
   * cargas e contêineres. A rota volta ao sentido de ida
   * (Santos → último destino), pronta para a próxima liberação de saída.
   */
  function registrarChegadaAoPortoDeSantos(navio) {
    const portoSantos = navio.destino || 'Porto de Santos';
    const proximoDestino = ehPortoDeSantos(navio.origem) ? navio.destino : navio.origem;
    navio.localizacao = 'DENTRO_DO_PORTO';
    navio.origem = portoSantos;
    navio.destino = proximoDestino || '';
    navio.dataSaida = null;
    localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));
    if (window.nexusSupabase) {
      let q = window.nexusSupabase.from('navios').update({
        localizacao: 'DENTRO_DO_PORTO',
        porto_origem: navio.origem,
        porto_destino: navio.destino || null,
        data_chegada: new Date().toISOString(),
        data_saida: null
      });
      q = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(navio.id || '')) ? q.eq('id', navio.id) : q.eq('numero_imo', navio.imo);
      Promise.resolve(q).then(({ error } = {}) => {
        if (error) console.warn('[NexusPort] Erro ao registrar chegada ao Porto de Santos:', error);
      }).catch(err => console.warn('[NexusPort] Erro ao registrar chegada ao Porto de Santos:', err));
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('navios');
    }
  }

  // Renderiza Tabela de GPS com atualização viva em tempo real e entrega automática
  function renderGpsTable() {
    if (!gpsTableBody) return;

    if (naviosList.length === 0) {
      gpsTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] text-slate-300 dark:text-slate-600 block mb-1">sailing</span>
            <span class="block font-bold text-slate-400 text-xs">Nenhuma embarcação cadastrada ainda.</span>
            <span class="block text-[11px] text-slate-400 mt-1">Navios são cadastrados pelo Inspetor em "Gerenciar Embarcações". Assim que o primeiro cadastro for salvo, a localização, o ETA e as ações aparecem aqui automaticamente.</span>
          </td>
        </tr>
      `;
      return;
    }

    // Navios já parados como "Chegou ao destino" com destino = Porto de Santos
    // (retorno autorizado antes desta correção) passam a constar "No porto".
    naviosList.forEach(n => {
      if (n.localizacao === 'NO_PORTO_DE_DESTINO' && ehPortoDeSantos(n.destino)) registrarChegadaAoPortoDeSantos(n);
    });

    // C10 & RN 12: quando o navio chega ao porto de destino, SOMENTE as cargas
    // a bordo DESTE navio (EM_TRANSITO) passam a ENTREGUE.
    // Causa-raiz corrigida: o update no Supabase não filtrava o navio
    // (`.eq('status_fluxo','EM_TRANSITO')` apenas) e rodava a cada segundo,
    // entregando as cargas em trânsito de TODOS os navios; no cache local,
    // qualquer status (agendada, recusada...) do navio de mesmo nome virava ENTREGUE.
    const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    let cargasAtualizadas = false;

    naviosList.forEach(n => {
      if (n.localizacao !== 'NO_PORTO_DE_DESTINO') return;
      cargasFluxo.forEach(c => {
        if (c.status === 'EM_TRANSITO' && cargaPertenceAoNavio(c, n)) {
          c.status = 'ENTREGUE';
          cargasAtualizadas = true;
        }
      });
      sincronizarEntregaDoNavio(n);
    });

    if (cargasAtualizadas) {
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxo));
      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('cargas');
      }
    }

    // Exibe todos os navios cadastrados no terminal (Tarefa 5.2 - RF 1.9, RF 2.1)


    // Backlog 3 (7b): busca local + contador "Exibindo X de Y"
    const buscaNavioVal = (document.getElementById('buscarNavioInput')?.value || '').trim().toLowerCase();
    const naviosVisiveis = naviosList.filter(n => {
      if (!buscaNavioVal) return true;
      const bercoBusca = bercoDoNavio(n);
      const haystack = `${n.nome || ''} ${n.imo || ''} ${bercoBusca ? `${bercoBusca.nome} ${bercoBusca.id}` : ''} ${n.origem || ''} ${n.destino || ''}`.toLowerCase();
      return haystack.includes(buscaNavioVal);
    });

    const embarcacoesCounterEl = document.getElementById('embarcacoesCounter');
    if (embarcacoesCounterEl) {
      embarcacoesCounterEl.textContent = `Exibindo ${naviosVisiveis.length} de ${naviosList.length} embarcação(ões)`;
    }

    if (naviosVisiveis.length === 0) {
      gpsTableBody.innerHTML = `
        <tr>
          <td colspan="8" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] text-slate-300 dark:text-slate-600 block mb-1">search_off</span>
            <span class="block font-bold text-slate-400 text-xs">Nenhuma embarcação corresponde à busca.</span>
            <span class="block text-[11px] text-slate-400 mt-1">Ajuste o termo pesquisado (nome, IMO, berço ou destino) para listar novamente.</span>
          </td>
        </tr>
      `;
      return;
    }

    gpsTableBody.innerHTML = naviosVisiveis.map(n => {
      const bercoAtual = bercoDoNavio(n);
      let etaText = '';
      let tempoForaText = '';
      let etaExtraHtml = '';

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

        // Distância oficial = rota marítima cadastrada (sem valor padrão)
        const distanciaKm = distanciaDoNavio(n);
        if (!distanciaKm) {
          etaText = 'ETA indisponível: rota sem distância cadastrada';
        } else {
          // Cálculo dinâmico do tempo total previsto
          const horasTotaisPrevistas = distanciaKm / 33; // 33 km/h
          const msTotaisPrevistos = horasTotaisPrevistas * 3600 * 1000;
          const msRestantes = Math.max(0, msTotaisPrevistos - diffMs);

          // Transição automática quando o ETA zerou: retorno ao Porto de
          // Santos = "No porto"; demais portos = NO_PORTO_DE_DESTINO.
          if (msRestantes <= 0 && n.localizacao === 'FORA_DO_PORTO' && ehPortoDeSantos(n.destino)) {
            registrarChegadaAoPortoDeSantos(n);
          } else if (msRestantes <= 0 && n.localizacao === 'FORA_DO_PORTO') {
            n.localizacao = 'NO_PORTO_DE_DESTINO';
            localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));
            if (window.nexusSupabase) {
              window.nexusSupabase.from('navios')
                .update({ localizacao: 'NO_PORTO_DE_DESTINO' })
                .eq('numero_imo', n.imo)
                .then(() => {})
                .catch(err => console.warn('Erro ao atualizar chegada ao destino no Supabase:', err));
            }
            if (window.NexusRepository && window.NexusRepository.notifyChange) {
              window.NexusRepository.notifyChange('navios');
            }
          }

          const diasRestantes = Math.floor(msRestantes / (1000 * 60 * 60 * 24));
          const horasRestantes = Math.floor((msRestantes % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minRestantes = Math.floor((msRestantes % (1000 * 60 * 60)) / (1000 * 60));
          const segRestantes = Math.floor((msRestantes % (1000 * 60)) / 1000);

          etaText = `ETA: ${diasRestantes}d ${horasRestantes}h ${minRestantes}m ${segRestantes}s (@33km/h)`;

          // Backlog 3 (7d): barra de progresso visual da viagem (X% decorrido do tempo previsto)
          const progressoPct = calcularProgressoViagem(n.dataSaida, distanciaKm);
          if (progressoPct !== null) {
            etaExtraHtml = `
              <div class="mt-1.5">
                <div class="flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase mb-0.5">
                  <span>Progresso da viagem</span>
                  <span class="text-indigo-600 dark:text-indigo-400">${esc(String(progressoPct))}%</span>
                </div>
                <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow="${esc(String(progressoPct))}" aria-valuemin="0" aria-valuemax="100" title="Progresso da viagem: ${esc(String(progressoPct))}% do tempo previsto decorrido">
                  <div class="h-1.5 rounded-full ${progressoPct >= 100 ? 'bg-emerald-500' : 'bg-nexus-500'}" style="width:${esc(String(progressoPct))}%"></div>
                </div>
              </div>`;
          }
        }
      }

      // Busca cargas do localstorage ou Supabase associadas a este navio (C2, C3)
      const cargasDoNavio = cargasFluxo.filter(c => cargaPertenceAoNavio(c, n));

      let bercosInfoHtml = '<span class="text-slate-400 italic text-[11px]">Sem carga vinculada</span>';
      if (cargasDoNavio.length > 0) {
        bercosInfoHtml = cargasDoNavio.map(c => `
          <div class="text-[11px] leading-tight">
            <strong class="text-nexus-500">${esc(c.id)}</strong>: <span class="font-bold text-slate-700 dark:text-slate-200">${esc(c.portoDescarga || 'Berço não atrelado')}</span>
            <span class="block text-[10px] text-slate-400">Contêiner: ${esc(c.container || 'Não vinculado')}</span>
          </div>
        `).join('');
      }

      // RN 3: Liberação de saída de navios é competência do Supervisor de Operações e Direção
      const podeLiberarNavio = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

      const emergenciaAtiva = typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva();

      let acoesHtml = '<div class="flex items-center justify-end gap-1.5 text-[11px] flex-wrap">';

      // Botão Vincular a Berço (Tarefa 6)
      // Somente navio no Porto de Santos ocupa berço (o modal lista os berços do banco).
      if (n.localizacao === 'DENTRO_DO_PORTO') {
        acoesHtml += `<button type="button" onclick="window.vincularNavioABerco(${jsArg(n.imo)})" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1" title="${bercoAtual ? 'Transferir para outro berço' : 'Vincular a um berço livre'}"><span class="material-symbols-outlined text-[13px]">dock</span><span>${bercoAtual ? 'Transferir' : 'Vincular'}</span></button>`;
      } else {
        acoesHtml += `<button type="button" disabled aria-disabled="true" class="px-2 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold flex items-center gap-1 cursor-not-allowed opacity-70" title="Apenas navios no Porto de Santos podem ocupar berço"><span class="material-symbols-outlined text-[13px]">dock</span><span>Vincular</span></button>`;
      }

      if (podeLiberarNavio) {
        if (n.localizacao === 'DENTRO_DO_PORTO') {
          if (emergenciaAtiva) {
            acoesHtml += `<button type="button" disabled aria-disabled="true" class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold cursor-not-allowed opacity-70" title="Emergência ativa: operações do pátio bloqueadas temporariamente">Liberar Saída</button>`;
          } else {
            acoesHtml += `<button type="button" onclick="window.liberarNavioPeloDiretor(${jsArg(n.imo)})" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold">Liberar Saída</button>`;
          }
        } else if (n.localizacao === 'NO_PORTO_DE_DESTINO') {
          if (emergenciaAtiva) {
            acoesHtml += `<button type="button" disabled aria-disabled="true" class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold cursor-not-allowed opacity-70" title="Emergência ativa: operações do pátio bloqueadas temporariamente">Autorizar Retorno</button>`;
          } else {
            acoesHtml += `<button type="button" onclick="window.autorizarRetornoNavio(${jsArg(n.imo)})" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Autorizar Retorno</button>`;
          }
        } else if (n.localizacao === 'FORA_DO_PORTO') {
          // Botão realmente desabilitado: o navio precisa chegar ao porto de destino
          acoesHtml += `<button type="button" disabled aria-disabled="true"
            class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold cursor-not-allowed opacity-70"
            title="O navio precisa chegar ao porto de destino antes de autorizar o retorno">Autorizar Retorno</button>`;
        }
      }

      // Botão Excluir Navio (Tarefa 6) — ação secundária, separada por divisor
      acoesHtml += `<span class="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></span>
        <button type="button"
          title="Excluir navio"
          aria-label="Excluir navio ${esc(n.nome)}"
          onclick="window.excluirNavio(${jsArg(n.imo)})"
          class="p-1.5 rounded bg-red-50 hover:bg-red-600 text-red-600 hover:text-white focus-visible:ring-2 focus-visible:ring-nexus-500 focus-visible:outline-none transition-colors">
          <span class="material-symbols-outlined text-[16px]">delete</span>
        </button>`;

      acoesHtml += '</div>';

      const localizacaoHtml = localizacaoBadgeHtml(n.localizacao);

      // Berço ocupado pelo navio (public.bercos) — substitui a antiga coluna de coordenadas GPS
      const bercoAtualHtml = bercoAtual
        ? `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold">${esc(bercoAtual.nome)}</span>`
        : n.localizacao === 'DENTRO_DO_PORTO'
          ? '<span class="text-amber-600 dark:text-amber-400 font-bold" title="Navio no porto sem berço: use o botão Vincular">Sem berço — vincular</span>'
          : '<span class="text-slate-400 italic">—</span>';

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-bold text-nexus-900 dark:text-white">
            ${esc(n.nome)}
            <span class="block font-mono text-[10px] text-nexus-500">${esc(n.imo)}</span>
          </td>
          <td class="p-3 font-mono text-xs">${bercosInfoHtml}</td>
          <td class="p-3 font-mono text-xs text-slate-600 dark:text-slate-300">${bercoAtualHtml}</td>
          <td class="p-3">${localizacaoHtml}</td>
          <td class="p-3 text-xs">${esc(n.origem)} → <strong class="text-nexus-900 dark:text-white">${esc(n.destino || 'Destino não informado')}</strong></td>
          <td class="p-3 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-bold">${esc(etaText)}${etaExtraHtml}</td>
          <td class="p-3 font-mono text-xs font-bold ${n.localizacao === 'NO_PORTO_DE_DESTINO' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}">${esc(tempoForaText)}</td>
          <td class="p-3 text-right whitespace-nowrap">${acoesHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // Gestão de Rotas Marítimas (RN 9, RF 2.4)
  const toggleRotaBtn = document.getElementById('toggleRotaFormBtn');
  const rotaForm = document.getElementById('rotaForm');
  const rotasTableBody = document.getElementById('rotasTableBody');

  /**
   * Carrega as rotas marítimas SOMENTE do Supabase (tabela rotas_maritimas).
   * Backlog 3 (rotas): não existe lista estática de rotas; sem dados do banco o
   * select e a tabela informam a situação em vez de exibir rotas inventadas.
   */
  async function carregarRotasMaritimas() {
    let rotas = [];
    rotasCarregamentoFalhou = false;
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('rotas_maritimas').select('*');
        if (error) throw error;
        rotas = Array.isArray(data) ? data : [];
      } catch (e) {
        rotasCarregamentoFalhou = true;
        console.warn('Erro ao carregar rotas marítimas do Supabase:', e);
      }
    } else {
      rotasCarregamentoFalhou = true;
    }
    rotasMaritimasList = rotas;
    renderRotasTable();
    preencherSelectRotasNavio();
    renderGpsTable();
  }

  /**
   * Backlog3 (formulários): o cadastro de navio NÃO registra destino/distância
   * manualmente — o Inspetor seleciona uma das rotas marítimas já registradas
   * pelos níveis superiores na `rotas_maritimas` do Supabase, e a embarcação
   * herda origem, destino e distância dessa rota.
   */
  function preencherSelectRotasNavio() {
    const rotaSel = document.getElementById('navioRotaSelect');
    if (!rotaSel) return;
    if (!Array.isArray(rotasMaritimasList) || rotasMaritimasList.length === 0) {
      rotaSel.innerHTML = rotasCarregamentoFalhou
        ? '<option value="">Não foi possível carregar as rotas do Supabase — tente novamente.</option>'
        : '<option value="">Nenhuma rota cadastrada — peça ao Supervisor para registrar na Gestão de Rotas Marítimas.</option>';
      return;
    }
    rotaSel.innerHTML = '<option value="">Selecione a Rota Marítima...</option>' +
      rotasMaritimasList.map((r, idx) => {
        const dist = parseFloat(r.distancia_km);
        // Montado e codificado aqui mesmo (variável ...Html, verificada pelo scan anti-XSS)
        const trechoKmHtml = dist > 0 ? ` (${esc(dist.toLocaleString('pt-BR'))} km)` : ' (distância não cadastrada)';
        return `<option value="${idx}">${esc(r.origem)} ➔ ${esc(r.destino)}${trechoKmHtml}</option>`;
      }).join('');
  }

  // Leitura somente das rotas carregadas (uso das ferramentas WebMCP: regra RN 9 da saída de navios).
  window.nexusEmbarcacoesRotas = function () {
    return rotasMaritimasList.map((r) => ({ origem: r.origem, destino: r.destino, distancia_km: r.distancia_km }));
  };

  // Função para despachar embarcação via Edge Function "despacho-embarcacao"
  window.nexusDespacharEmbarcacaoEdgeFunction = async function(navioId, motivo) {
    if (!window.nexusSupabase || !window.nexusSupabase.functions) return null;
    try {
      const codigo = session && session.codigo_individual;
      const { data, error } = await window.nexusSupabase.functions.invoke('despacho-embarcacao', {
        body: { navio_id: navioId, codigo_individual: codigo, motivo: motivo }
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('despacho-embarcacao Edge Function:', e);
      return null;
    }
  };

  function renderRotasTable() {
    if (!rotasTableBody) return;
    if (rotasMaritimasList.length === 0) {
      const texto = rotasCarregamentoFalhou
        ? 'Não foi possível carregar as rotas marítimas do Supabase.'
        : 'Nenhuma rota marítima cadastrada no sistema.';
      rotasTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="p-4 text-center text-slate-400 italic">${esc(texto)}</td>
        </tr>
      `;
      return;
    }
    rotasTableBody.innerHTML = rotasMaritimasList.map(r => {
      const dist = parseFloat(r.distancia_km);
      const temDistancia = dist > 0;
      const eta = temDistancia ? calcularETA(dist) : '—';
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 font-mono text-xs">
          <td class="p-3 font-bold">${esc(r.origem)}</td>
          <td class="p-3 text-nexus-900 dark:text-white font-bold">${esc(r.destino)}</td>
          <td class="p-3 text-emerald-600 font-bold">${temDistancia ? `${esc(dist.toLocaleString('pt-BR'))} km` : '—'}</td>
          <td class="p-3 text-indigo-600 font-bold">${esc(eta)}</td>
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
      const distancia_km = parseFloat(document.getElementById('rotaDistancia').value);

      if (!origem || !destino) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Dados Incompletos', 'Informe o porto de origem e o porto de destino da rota.');
        return;
      }
      if (!(distancia_km > 0)) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Distância Inválida', 'Informe uma distância em km maior que zero.');
        return;
      }
      if (!window.nexusSupabase) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Sem Conexão', 'A rota só pode ser cadastrada com conexão ao Supabase. Nada foi salvo.');
        return;
      }

      // Backlog 3 (rotas): a rota só existe na tela depois de gravada no Supabase.
      try {
        const { error } = await window.nexusSupabase.from('rotas_maritimas').insert({ origem, destino, distancia_km });
        if (error) throw error;
      } catch (erro) {
        console.warn('Erro ao salvar rota marítima no Supabase:', erro);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Rota Não Cadastrada', 'Não foi possível salvar a rota no Supabase. Verifique a conexão ou se a rota já existe (origem e destino devem ser únicos).');
        }
        return;
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('CRIACAO', 'rotas_maritimas', null, { origem, destino, distancia_km });
      }
      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('rotas_maritimas');
      }

      await carregarRotasMaritimas();
      rotaForm.reset();
      rotaForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Rota Cadastrada', `Rota Marítima "${origem} ➔ ${destino}" (${distancia_km} km) cadastrada com sucesso!`);
      }
    });
  }

  // RN 3: Liberação de Saída de Navios pelo Supervisor de Operações / Diretor
  window.liberarNavioPeloDiretor = async function(imo, opcoes) {
    const podeLiberar = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    if (!podeLiberar) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Negado', 'Apenas o Supervisor de Operações ou Diretor pode autorizar a liberação de navios!');
      }
      return;
    }

    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    // Trava de regra de negócio: só libera a saída de navio que está no porto
    if (navio.localizacao !== 'DENTRO_DO_PORTO') {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Liberação Não Permitida', `O navio ${navio.nome} não está no Porto de Santos (situação atual: ${localizacaoInfo(navio.localizacao).txt}). Apenas embarcações atracadas no porto podem ter a saída liberada.`);
      }
      return;
    }

    // Item 6 (backlog): operações do pátio bloqueadas com o alarme de emergência ativo
    if (typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva()) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Emergência Ativa', 'Operações do pátio bloqueadas temporariamente enquanto o alarme de emergência estiver ativo.');
      }
      return;
    }

    // RN 9: Bloqueia saída se NÃO houver rota cadastrada entre a origem e o destino
    // do navio (qualquer sentido: ida e volta usam a mesma distância oficial).
    const rotaCadastrada = rotaEntrePortos(navio.origem || 'Porto de Santos', navio.destino || '');

    if (!rotaCadastrada) {
      const msgErro = `REGRA DE NEGÓCIO (RN 9): A saída do navio "${navio.nome}" foi BLOQUEADA pois não existe uma rota marítima cadastrada entre "${navio.origem || 'Porto de Santos'}" e "${navio.destino}". O Supervisor deve cadastrar a rota na seção "Gestão de Rotas Marítimas" antes da liberação!`;
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Rota Não Encontrada', msgErro);
      }
      return;
    }

    // Distância oficial = da rota cadastrada (sem valor padrão)
    const kmRota = parseFloat(rotaCadastrada.distancia_km);
    if (!(kmRota > 0)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Rota Sem Distância', `A rota ${rotaCadastrada.origem} ➔ ${rotaCadastrada.destino} não tem distância válida cadastrada. Corrija o cadastro da rota antes de liberar o navio.`);
      }
      return;
    }
    navio.distancia = kmRota;

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm 
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

      // Navio fora do porto não ocupa berço: libera no banco e relê a ocupação
      await liberarBercoDoNavio(navio);

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
  window.autorizarRetornoNavio = async function(imo, opcoes) {
    const podeLiberar = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    if (!podeLiberar) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Negado', 'Apenas o Supervisor de Operações ou Diretor pode autorizar o retorno de navios!');
      }
      return;
    }

    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    // Trava de regra de negócio: o navio precisa ter chegado ao porto de destino
    if (navio.localizacao !== 'NO_PORTO_DE_DESTINO') {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Retorno Não Permitido', `O navio ${navio.nome} ainda não chegou ao porto de destino (situação atual: ${localizacaoInfo(navio.localizacao).txt}). O retorno só pode ser autorizado após a chegada ao destino.`);
      }
      return;
    }

    // Item 6 (backlog): operações do pátio bloqueadas com o alarme de emergência ativo
    if (typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva()) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Emergência Ativa', 'Operações do pátio bloqueadas temporariamente enquanto o alarme de emergência estiver ativo.');
      }
      return;
    }

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Autorizar Retorno de Embarcação', `Autorizar o retorno da embarcação ${navio.nome} ao Porto de Origem (${navio.origem})?`) : true;

    if (confirmou) {
      // Inverte Origem e Destino para a viagem de regresso. O caminho de volta
      // é o mesmo invertido: a distância oficial é reaproveitada para o ETA.
      const antigoDestino = navio.destino;
      navio.destino = navio.origem;
      navio.origem = antigoDestino;
      navio.localizacao = 'FORA_DO_PORTO';
      navio.dataSaida = new Date().toISOString();
      const kmVolta = distanciaDaRota(navio.origem, navio.destino);
      if (kmVolta) navio.distancia = kmVolta;

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

  // Ocupa um berço com o navio de forma DIRETA (sem diálogo) — usada pelo
  // cadastro obrigatório de berço e pela vinculação manual (modal).
  // Com banco: vínculo atômico no Supabase (NexusIntegridade.ocuparBerco), que
  // revalida o estado do berço no momento da gravação e libera o berço
  // anterior em caso de transferência; a tela relê a ocupação do banco.
  // @returns {Promise<{ok:boolean, mensagem?:string}>}
  async function ocuparBercoComNavio(refBerco, navio) {
    const bercoReal = bercosList.find(b => b.nome === refBerco || b.id === refBerco);
    if (!bercoReal) return { ok: false, mensagem: `O berço "${refBerco}" não existe no terminal.` };
    if (!navio || (!navio.nome && !navio.imo)) {
      return { ok: false, mensagem: 'Não foi possível identificar o navio (nome/IMO) para ocupar o berço. Verifique o cadastro da embarcação.' };
    }

    const integ = window.NexusIntegridade;
    if (clienteBercos() && integ) {
      const r = await integ.ocuparBerco(bercoReal.id, navio);
      await carregarBercosSupabase();
      if (r.ok) return { ok: true, berco: bercoReal.nome };
      return { ok: false, mensagem: r.mensagem || `Não foi possível ocupar o ${bercoReal.nome} no banco de dados.` };
    }

    // Modo sem banco configurado: espelho local
    if (bercoReal.estado !== 'LIVRE') {
      const atual = bercoDoNavio(navio);
      if (atual && atual.id === bercoReal.id) return { ok: true, berco: bercoReal.nome };
      return { ok: false, mensagem: `O ${bercoReal.nome} já está ocupado${bercoReal.navio_nome ? ` pelo navio ${bercoReal.navio_nome}` : ''}.` };
    }
    const ocupacao = normalizarBerco({
      id: bercoReal.id,
      nome: bercoReal.nome,
      estado: 'OCUPADO',
      navio_nome: navio.nome,
      navio_imo: navio.imo,
      navio_id: (navio.id && window.NexusIntegridade && window.NexusIntegridade.ehUuid(navio.id)) ? navio.id : null
    });
    if (!ocupacao.payload || ocupacao.payload.estado !== 'OCUPADO') {
      return { ok: false, mensagem: 'Não foi possível identificar o navio (nome/IMO) para ocupar o berço.' };
    }
    bercosList.forEach(b => {
      if (b.id !== bercoReal.id && b.estado === 'OCUPADO' && ((navio.imo && b.navio_imo === navio.imo) || (!b.navio_imo && navio.nome && b.navio_nome === navio.nome))) {
        Object.assign(b, { estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null });
      }
    });
    Object.assign(bercoReal, {
      estado: 'OCUPADO',
      navio_nome: ocupacao.payload.navio_nome,
      navio_imo: ocupacao.payload.navio_imo,
      navio_id: ocupacao.payload.navio_id
    });
    localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
    renderBercosPanel();
    return { ok: true, berco: bercoReal.nome };
  }

  // Preenche o seletor de berço do formulário de cadastro (somente livres,
  // conforme o estado mais recente do banco).
  async function preencherBercoCadastroSelect() {
    const bercoSel = document.getElementById('navioBercoSelect');
    if (!bercoSel) return;
    await carregarBercosSupabase();
    const livres = bercosList.filter(b => b.estado === 'LIVRE');
    const atual = bercoSel.value;
    bercoSel.innerHTML = livres.length === 0
      ? '<option value="">Nenhum berço livre no momento</option>'
      : '<option value="">Selecione o berço...</option>' + livres.map(b => `<option value="${esc(b.nome)}">${esc(b.nome)}</option>`).join('');
    if (atual && livres.some(b => b.nome === atual)) bercoSel.value = atual;
  }

  // ------------------------------------------------------------------
  // Modal "Vincular Navio a Berço": select com os berços cadastrados em
  // public.bercos (ocupados desabilitados), atualizado ao abrir e
  // revalidado no banco ao confirmar.
  // ------------------------------------------------------------------
  const vincularBercoModal = document.getElementById('vincularBercoModal');
  const vincularBercoSelect = document.getElementById('vincularBercoSelect');
  const vincularBercoAviso = document.getElementById('vincularBercoAviso');
  const vincularBercoNavioLabel = document.getElementById('vincularBercoNavioLabel');
  const vincularBercoAtualLabel = document.getElementById('vincularBercoAtualLabel');
  const confirmVincularBercoBtn = document.getElementById('confirmVincularBercoBtn');
  let navioParaVincularBerco = null;
  let vinculandoBerco = false;

  function avisoVincularBerco(texto) {
    if (!vincularBercoAviso) return;
    vincularBercoAviso.textContent = texto || '';
    vincularBercoAviso.classList.toggle('hidden', !texto);
  }

  function fecharVincularBercoModal() {
    if (vincularBercoModal) vincularBercoModal.classList.add('hidden');
    navioParaVincularBerco = null;
    avisoVincularBerco('');
  }

  function renderOpcoesVincularBerco(navio) {
    if (!vincularBercoSelect) return 0;
    const atual = bercoDoNavio(navio);
    const livres = bercosList.filter(b => b.estado === 'LIVRE');
    vincularBercoSelect.innerHTML = '<option value="">Selecione o berço...</option>' + bercosList.map(b => {
      const ehAtual = atual && atual.id === b.id;
      const disponivel = b.estado === 'LIVRE';
      const situacaoTxt = ehAtual
        ? ' — berço atual deste navio'
        : b.estado === 'OCUPADO'
          ? ` — ocupado por ${b.navio_nome || b.navio_imo || 'outro navio'}`
          : disponivel ? ' — livre' : ` — indisponível (${b.estado})`;
      return `<option value="${esc(b.id)}" ${disponivel ? '' : 'disabled'}>${esc(b.id)} · ${esc(b.nome)}${esc(situacaoTxt)}</option>`;
    }).join('');
    if (vincularBercoAtualLabel) {
      vincularBercoAtualLabel.textContent = atual ? `Atualmente atracado no ${atual.nome}. Escolher outro berço fará a transferência.` : 'Sem berço vinculado no momento.';
    }
    if (confirmVincularBercoBtn) confirmVincularBercoBtn.disabled = livres.length === 0;
    if (livres.length === 0) {
      avisoVincularBerco('Nenhum berço livre no Terminal STS-01 no momento. Libere um berço (saída de navio) antes de vincular.');
    } else {
      avisoVincularBerco('');
    }
    return livres.length;
  }

  /**
   * Valida e grava o vínculo navio × berço. Usada pelo modal e pelo agente
   * WebMCP (opcoes.bercoNome). Reconsulta o banco antes de gravar.
   */
  async function confirmarVinculoBerco(navio, refBerco) {
    if (!refBerco) {
      return { ok: false, titulo: 'Berço Não Selecionado', mensagem: 'Selecione um dos berços livres da lista.' };
    }
    if ((navio.localizacao || 'DENTRO_DO_PORTO') !== 'DENTRO_DO_PORTO') {
      return { ok: false, titulo: 'Vínculo Não Permitido', mensagem: `O navio ${navio.nome} não está no Porto de Santos (situação: ${localizacaoInfo(navio.localizacao).txt}). Apenas navios atracados no porto ocupam berço.` };
    }
    // Estado mais recente do banco antes de confirmar
    await carregarBercosSupabase();
    const berco = bercosList.find(b => b.id === refBerco || b.nome === refBerco);
    if (!berco) {
      return { ok: false, titulo: 'Berço Inexistente', mensagem: `O berço "${refBerco}" não está cadastrado no terminal.` };
    }
    const atual = bercoDoNavio(navio);
    if (atual && atual.id === berco.id) {
      return { ok: false, titulo: 'Berço Já Vinculado', mensagem: `O navio ${navio.nome} já está atracado no ${berco.nome}.` };
    }
    if (berco.estado !== 'LIVRE') {
      return { ok: false, titulo: 'Berço Ocupado', mensagem: berco.estado === 'OCUPADO'
        ? `O ${berco.nome} acabou de ser ocupado pelo navio ${berco.navio_nome || berco.navio_imo || '(sem nome)'}. Escolha outro berço.`
        : `O ${berco.nome} está indisponível (${berco.estado}).` };
    }
    const resultado = await ocuparBercoComNavio(berco.id, navio);
    if (!resultado.ok) {
      return { ok: false, titulo: 'Vínculo Não Registrado', mensagem: resultado.mensagem };
    }
    return { ok: true, berco, anterior: atual };
  }

  async function concluirVinculoBerco(navio, refBerco) {
    const r = await confirmarVinculoBerco(navio, refBerco);
    if (!r.ok) {
      if (vincularBercoModal && !vincularBercoModal.classList.contains('hidden')) {
        avisoVincularBerco(r.mensagem);
        renderOpcoesVincularBerco(navio);
      }
      if (window.mostrarFeedback) window.mostrarFeedback('alerta', r.titulo, r.mensagem);
      return false;
    }

    renderGpsTable();
    const descricao = r.anterior
      ? `Navio ${navio.nome} transferido do ${r.anterior.nome} para o ${r.berco.nome}`
      : `Navio ${navio.nome} vinculado ao ${r.berco.nome}`;
    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EDICAO', 'navios', navio.id || null, descricao);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('bercos');
    }
    fecharVincularBercoModal();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Navio Vinculado', `${descricao} com sucesso!`);
    }
    return true;
  }

  // Vincular Navio a um dos 15 Berços (Tarefa 6)
  window.vincularNavioABerco = async function(imo, opcoes) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    if ((navio.localizacao || 'DENTRO_DO_PORTO') !== 'DENTRO_DO_PORTO') {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Vínculo Não Permitido', `O navio ${navio.nome} não está no Porto de Santos (situação: ${localizacaoInfo(navio.localizacao).txt}). Apenas navios atracados no porto ocupam berço.`);
      }
      return;
    }

    // Uso do agente WebMCP: berço informado pelo nome/código, sem diálogo.
    if (opcoes && opcoes.bercoNome !== undefined) {
      await concluirVinculoBerco(navio, opcoes.bercoNome);
      return;
    }

    // Lista sempre atualizada com o estado atual do banco
    await carregarBercosSupabase();
    const livres = bercosList.filter(b => b.estado === 'LIVRE');
    if (livres.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Berços Indisponíveis', 'Nenhum berço livre no Terminal STS-01 no momento. Não é possível vincular o navio até que um berço seja liberado.');
      }
      return;
    }

    if (!vincularBercoModal || !vincularBercoSelect) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Vínculo Indisponível', 'O seletor de berços não está disponível nesta página.');
      return;
    }

    navioParaVincularBerco = navio;
    if (vincularBercoNavioLabel) vincularBercoNavioLabel.textContent = `${navio.nome} (${navio.imo})`;
    renderOpcoesVincularBerco(navio);
    vincularBercoModal.classList.remove('hidden');
    vincularBercoSelect.focus();
  };

  if (confirmVincularBercoBtn) {
    confirmVincularBercoBtn.addEventListener('click', async () => {
      if (!navioParaVincularBerco || vinculandoBerco) return;
      vinculandoBerco = true;
      confirmVincularBercoBtn.disabled = true;
      try {
        await concluirVinculoBerco(navioParaVincularBerco, vincularBercoSelect ? vincularBercoSelect.value : '');
      } finally {
        vinculandoBerco = false;
        if (confirmVincularBercoBtn) confirmVincularBercoBtn.disabled = bercosList.every(b => b.estado !== 'LIVRE');
      }
    });
  }
  ['closeVincularBercoModalBtn', 'cancelVincularBercoBtn'].forEach((idBtn) => {
    const btn = document.getElementById(idBtn);
    if (btn) btn.addEventListener('click', fecharVincularBercoModal);
  });

  /**
   * Exclusão do navio no banco quando a RPC transacional ainda não existe
   * (migração não aplicada). Ordem pensada para não deixar estado parcial:
   *   1. bloqueios (OS ativa / cargas a bordo) conferidos no banco;
   *   2. histórico de manutenção desvinculado (FK antiga é CASCADE);
   *   3. DELETE verificado; se uma FK impedir (23503), desvincula
   *      contêineres/cargas e tenta de novo;
   *   4. berço liberado.
   */
  async function excluirNavioNoBancoSequencial(navio) {
    const sb = window.nexusSupabase;
    const integ = window.NexusIntegridade;
    const isUuidNavio = integ ? integ.ehUuid(navio.id) : false;
    try {
      if (isUuidNavio) {
        const { data: aBordo, error: errTransito } = await sb.from('cargas').select('id').eq('navio_id', navio.id).eq('status_fluxo', 'EM_TRANSITO');
        if (errTransito) throw errTransito;
        if (Array.isArray(aBordo) && aBordo.length > 0) {
          return { ok: false, mensagem: `o navio está em viagem com ${aBordo.length} carga(s) a bordo (EM_TRANSITO). Aguarde a entrega antes de excluí-lo` };
        }
      }
      const reg = integ ? await integ.resolverNoBanco('NAVIO', { id: navio.id, codigo: navio.imo }) : null;
      if (!reg) return { ok: true, jaExcluido: true, containers: 0, cargas: 0 };
      const ativas = await integ.osAtivasDo('NAVIO', reg);
      if (ativas.length > 0) {
        return { ok: false, mensagem: `o navio possui ${ativas.length} ordem(ns) de serviço de manutenção ativa(s). Conclua ou recuse a OS em Manutenção antes de excluí-lo` };
      }
      const historico = await integ.preservarHistoricoManutencao('NAVIO', reg.id);
      if (!historico.ok) return { ok: false, mensagem: historico.mensagem };

      let contsBanco = 0;
      let cargasBanco = 0;
      let del = await integ.excluirRegistro('navios', 'id', reg.id);
      if (!del.ok && del.codigo === '23503') {
        const { data: conts, error: errCont } = await sb.from('containers').update({ navio_id: null }).eq('navio_id', reg.id).select('id');
        if (errCont) throw errCont;
        const { data: crgs, error: errCargas } = await sb.from('cargas').update({ navio_id: null }).eq('navio_id', reg.id).select('id');
        if (errCargas) throw errCargas;
        contsBanco = (conts || []).length;
        cargasBanco = (crgs || []).length;
        del = await integ.excluirRegistro('navios', 'id', reg.id);
      }
      if (!del.ok) return { ok: false, mensagem: del.mensagem };
      return { ok: true, containers: contsBanco, cargas: cargasBanco };
    } catch (e) {
      return { ok: false, mensagem: integ ? integ.descreverErroBanco(e) : ((e && e.message) || String(e)) };
    }
  }

  // Excluir Navio (Tarefa 6): apaga do banco e da interface; contêineres e
  // cargas vinculados são DESVINCULADOS (não apagados) e ficam livres para
  // nova vinculação com outra embarcação. Bloqueado (com justificativa) para
  // navio em viagem com cargas a bordo ou com OS de manutenção ativa.
  window.excluirNavio = async function(imo, opcoes) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    const nomeNavioLower = String(navio.nome || '').toLowerCase();
    const cargaDoNavio = (c) => {
      const idCarga = c.navio_id || c.navioId;
      if (idCarga && navio.id) return String(idCarga) === String(navio.id);
      return Boolean(c.navio) && String(c.navio).toLowerCase() === nomeNavioLower;
    };

    // Bloqueio de regra de negócio: cargas a bordo em viagem não ficam órfãs
    const cargasAntes = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const aBordo = cargasAntes.filter(c => cargaDoNavio(c) && c.status === 'EM_TRANSITO');
    if (aBordo.length > 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Exclusão Bloqueada', `O navio ${navio.nome} está em viagem com ${aBordo.length} carga(s) a bordo (${aBordo.slice(0, 3).map(c => c.id).join(', ')}${aBordo.length > 3 ? '…' : ''}). Aguarde a chegada ao destino antes de excluí-lo.`);
      }
      return;
    }

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Navio', `Tem certeza que deseja EXCLUIR o navio ${navio.nome} (${navio.imo})? Essa ação desocupará o berço, apagará o navio do banco de dados e desvinculará seus contêineres e cargas (que poderão ser vinculados a outro navio). O histórico de manutenção é preservado.`)
      : true;

    if (!confirmou) return;

    // 1) Banco primeiro: a interface só muda depois da confirmação do Supabase.
    let contsBanco = null;
    let cargasBanco = null;
    if (window.nexusSupabase) {
      const integ = window.NexusIntegridade;
      let resultado = null;
      if (integ && integ.ehUuid(navio.id)) {
        const rpc = await integ.chamarRpc('nexus_excluir_navio', { p_navio_id: navio.id });
        if (!rpc.ausente) {
          if (rpc.erro) {
            resultado = { ok: false, mensagem: rpc.mensagem };
          } else if (rpc.data && rpc.data.ok) {
            resultado = { ok: true, containers: rpc.data.containers_desvinculados || 0, cargas: rpc.data.cargas_desvinculadas || 0 };
          } else {
            resultado = { ok: false, mensagem: (rpc.data && rpc.data.mensagem) || 'o banco de dados recusou a exclusão' };
          }
        }
      }
      if (!resultado) {
        resultado = integ
          ? await excluirNavioNoBancoSequencial(navio)
          : { ok: false, mensagem: 'módulo de integridade (js/integridade-operacional.js) não carregado' };
      }
      if (!resultado.ok) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Exclusão Não Realizada', `Não foi possível excluir o navio ${navio.nome} (${imo}): ${resultado.mensagem}. Nada foi removido.`);
        }
        await carregarNaviosSupabase();
        return;
      }
      contsBanco = resultado.containers;
      cargasBanco = resultado.cargas;
    }

    // 2) Banco confirmou (ou modo local): atualiza a interface sem recarregar
    naviosList = naviosList.filter(n => n.imo !== imo);
    localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));
    await liberarBercoDoNavio(navio);

    // 3) Desvincula contêineres e cargas do navio excluído (ficam livres)
    let contsDesvinc = 0;
    const containersLocais = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    containersLocais.forEach(c => {
      const peloNome = c.navio && String(c.navio).toLowerCase() === nomeNavioLower;
      const peloId = navio.id && (c.navio_id === navio.id || c.navioId === navio.id);
      if (peloNome || peloId) {
        c.navio = '';
        c.navio_id = null;
        c.navioId = null;
        c.navio_nome = null;
        contsDesvinc++;
      }
    });
    localStorage.setItem('nexus_containers_list', JSON.stringify(containersLocais));
    containersList = containersLocais;

    let cargasDesvinc = 0;
    const cargasLocais = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    cargasLocais.forEach(c => {
      if (cargaDoNavio(c)) {
        c.navio = '';
        c.navio_id = null;
        c.navioId = null;
        cargasDesvinc++;
      }
    });
    localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasLocais));
    if (contsBanco !== null && contsBanco !== undefined) contsDesvinc = Math.max(contsDesvinc, contsBanco);
    if (cargasBanco !== null && cargasBanco !== undefined) cargasDesvinc = Math.max(cargasDesvinc, cargasBanco);

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'navios', navio.id || null, `Navio ${navio.nome} (${imo}) excluído do sistema; ${contsDesvinc} contêiner(es) e ${cargasDesvinc} carga(s) desvinculados e livres para nova vinculação`);
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('navios');
      window.NexusRepository.notifyChange('containers');
      window.NexusRepository.notifyChange('cargas');
    }

    renderBercosPanel();
    renderGpsTable();
    if (typeof renderContainersTable === 'function') renderContainersTable();

    if (window.mostrarFeedback) {
      const origem = window.nexusSupabase ? 'apagado do banco de dados e removido da interface' : 'removido (modo local, sem banco configurado)';
      window.mostrarFeedback('sucesso', 'Navio Excluído', `Navio ${navio.nome} (${imo}) ${origem}. ${contsDesvinc} contêiner(es) e ${cargasDesvinc} carga(s) foram desvinculados e já podem ser vinculados a outro navio.`);
    }
  };

  carregarNaviosSupabase();

  // C6: Relógio em tempo real que atualiza continuamente a contagem de ETA e tempo fora do porto
  setInterval(renderGpsTable, 1000);

  // Busca local na tabela de embarcações (Backlog 3 - 7b)
  const buscarNavioInput = document.getElementById('buscarNavioInput');
  if (buscarNavioInput) {
    buscarNavioInput.addEventListener('input', renderGpsTable);
  }

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
      preencherSelectRotasNavio();
      preencherBercoCadastroSelect();
      navioForm.classList.toggle('hidden');
    });
  }

  // O berço só é exigido para navio DENTRO_DO_PORTO (para os demais, o campo
  // fica desabilitado — navio fora do porto não ocupa berço).
  const navioLocalizacaoSel = document.getElementById('navioLocalizacao');
  if (navioLocalizacaoSel) {
    const ajustarBercoObrigatorio = () => {
      const bercoSel = document.getElementById('navioBercoSelect');
      if (!bercoSel) return;
      const dentro = navioLocalizacaoSel.value === 'DENTRO_DO_PORTO';
      bercoSel.disabled = !dentro;
      bercoSel.required = dentro;
      if (dentro) preencherBercoCadastroSelect();
    };
    navioLocalizacaoSel.addEventListener('change', ajustarBercoObrigatorio);
    ajustarBercoObrigatorio();
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
      const rotaSel = document.getElementById('navioRotaSelect');
      const localizacao = document.getElementById('navioLocalizacao').value;

      // Backlog3 (formulários): origem, destino e distância vêm SOMENTE de
      // uma rota marítima registrada no Supabase (rotas_maritimas), selecionada
      // pelo operador — não há mais registro manual de destino/distância.
      const rotaIdx = rotaSel ? parseInt(rotaSel.value, 10) : NaN;
      const rota = (!Number.isNaN(rotaIdx) && Array.isArray(rotasMaritimasList)) ? rotasMaritimasList[rotaIdx] : null;
      if (!rota) {
        const msg = 'ROTA MARÍTIMA OBRIGATÓRIA (Backlog3): selecione uma das rotas cadastradas no sistema para o navio. Se a rota desejada não existir, solicite ao Supervisor o registro na seção "Gestão de Rotas Marítimas" — o cadastro de destino/distância manual não é permitido.';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Rota Não Selecionada', msg);
        return;
      }
      const origem = (rota.origem || 'Porto de Santos').trim();
      const destino = (rota.destino || '').trim();
      const distancia = parseFloat(rota.distancia_km);
      if (!(distancia > 0)) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Rota Sem Distância', 'A rota selecionada não tem distância válida cadastrada. Corrija o cadastro da rota em Gestão de Rotas Marítimas.');
        }
        return;
      }

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

      // Item 11: a lista local pode estar desatualizada; numero_imo é UNIQUE no banco (evita erro 23505)
      if (window.nexusSupabase) {
        try {
          const { data: imoDb } = await window.nexusSupabase
            .from('navios')
            .select('nome, numero_imo')
            .eq('numero_imo', imo)
            .maybeSingle();

          if (imoDb) {
            const msg = `BLOQUEIO DE DUPLICIDADE (Item 11): Já existe um navio cadastrado com o número IMO "${imo}" (${imoDb.nome}). Cada embarcação deve possuir IMO único!`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'IMO Duplicado', msg);
            return;
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao verificar IMO no Supabase:', err);
        }
      }

      // Berço OBRIGATÓRIO e IMEDIATO para navio DENTRO_DO_PORTO: um navio não
      // pode estar dentro do porto sem ocupar um berço ao mesmo tempo.
      const bercoSelCadastro = document.getElementById('navioBercoSelect');
      const bercoEscolhido = localizacao === 'DENTRO_DO_PORTO' ? (bercoSelCadastro ? bercoSelCadastro.value : '') : '';
      if (localizacao === 'DENTRO_DO_PORTO' && !bercoEscolhido) {
        await carregarBercosSupabase();
        const livres = bercosList.filter(b => b.estado === 'LIVRE');
        const msg = livres.length === 0
          ? 'BERÇOS ESGOTADOS: não há berço livre no Terminal STS-01. Libere um berço antes de cadastrar um navio DENTRO_DO_PORTO, ou cadastre-o como FORA_DO_PORTO.'
          : 'BERÇO OBRIGATÓRIO: um navio DENTRO_DO_PORTO precisa estar vinculado a um berço imediatamente. Selecione o berço de atracação no formulário.';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Berço Obrigatório', msg);
        if (bercoSelCadastro) preencherBercoCadastroSelect();
        return;
      }

      // Berço escolhido ainda livre? (estado atual do banco, não do formulário aberto)
      if (localizacao === 'DENTRO_DO_PORTO' && bercoEscolhido) {
        await carregarBercosSupabase();
        const bercoAtual = bercosList.find(b => b.nome === bercoEscolhido);
        if (!bercoAtual || bercoAtual.estado !== 'LIVRE') {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('alerta', 'Berço Indisponível', `O ${bercoEscolhido} foi ocupado por outro navio. Selecione outro berço livre.`);
          }
          preencherBercoCadastroSelect();
          return;
        }
      }

      // Localização fictícia controlada pelos estados do sistema
      // (DENTRO_DO_PORTO / FORA_DO_PORTO / NO_PORTO_DE_DESTINO): não há mais
      // coordenadas GPS digitadas no cadastro.
      const novoNavio = {
        nome, imo, localizacao, origem, destino, distancia, dataSaida: localizacao === 'FORA_DO_PORTO' ? new Date().toISOString() : null
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
            estado_operacional: 'OPERANTE',
            qr_code_url: `QR-${imo}`
          }).select('id').single();

          if (error) {
            if (window.mostrarFeedback) {
              const detalhe = window.NexusIntegridade ? window.NexusIntegridade.descreverErroBanco(error) : (error.message || error);
              window.mostrarFeedback('erro', 'Navio Não Cadastrado', `Não foi possível salvar o navio ${nome} no banco de dados: ${detalhe}.`);
            }
            return;
          }

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

      // Vinculação imediata ao berço (obrigatória para DENTRO_DO_PORTO)
      let bercoOcupadoMsg = '';
      if (localizacao === 'DENTRO_DO_PORTO' && bercoEscolhido) {
        const ocupacao = await ocuparBercoComNavio(bercoEscolhido, novoNavio);
        if (ocupacao.ok) {
          renderBercosPanel();
          bercoOcupadoMsg = ` Vinculado imediatamente ao ${bercoEscolhido}.`;
          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('EDICAO', 'navios', novoNavio.id || null, `Navio ${nome} vinculado ao ${bercoEscolhido} no cadastro (DENTRO_DO_PORTO)`);
          }
        } else {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('alerta', 'Berço Indisponível', `Navio cadastrado, mas o ${bercoEscolhido} não pôde ser ocupado: ${ocupacao.mensagem || 'berço indisponível'}. Use o botão "Vincular" na tabela para escolher outro berço imediatamente.`);
          }
        }
      }

      renderGpsTable();
      navioForm.reset();
      navioForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Navio Cadastrado', `Navio ${nome} (${imo}) cadastrado e sincronizado com sucesso no Supabase!${bercoOcupadoMsg}`);
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

        if (!error && Array.isArray(data)) {
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

          // O banco é a fonte da verdade: contêineres que só existem no cache
          // local (ex.: excluídos em outra sessão) não voltam para a tela.
          const naviosPorId = new Map(naviosList.map(n => [String(n.id), n]));
          supConts.forEach(c => {
            const navio = c.navio_id ? naviosPorId.get(String(c.navio_id)) : null;
            if (navio) {
              c.navio = navio.nome;
              c.navio_nome = navio.nome;
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
          <span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-nexus-500 font-bold">${esc(crg.id)} (${esc(crg.volume)})</span>
        `).join(' ');
      }

      const manutDisplay = c.dataManut || 'Sem Manutenção';
      const estadoCont = String(c.estado || 'OPERANTE').toUpperCase();
      const contOperante = estadoCont === 'OPERANTE' || estadoCont === 'DISPONIVEL';
      const estadoContHtml = contOperante
        ? `<span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-mono text-xs font-bold">${esc(c.estado || 'OPERANTE')}</span>`
        : `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-mono text-xs font-bold" title="Em manutenção: indisponível para novas operações">${esc(c.estado)} · Indisponível</span>`;

      let contAcoesHtml = `
        <div class="flex items-center justify-end gap-1.5 font-mono text-[11px]">
          ${contOperante
            ? `<button type="button" onclick="window.vincularContainerANavio(${jsArg(c.identificacao)})" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">link</span><span>Vincular</span></button>`
            : `<button type="button" disabled aria-disabled="true" title="Contêiner em manutenção: indisponível para novas operações" class="px-2 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold flex items-center gap-1 cursor-not-allowed opacity-70"><span class="material-symbols-outlined text-[13px]">link_off</span><span>Indisponível</span></button>`}
          <button type="button" onclick="window.excluirContainer(${jsArg(c.identificacao)})" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">delete</span><span>Excluir</span></button>
        </div>
      `;

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-mono font-bold text-nexus-500">${esc(c.identificacao)}</td>
          <td class="p-3 font-bold">${esc(c.tipo)}</td>
          <td class="p-3 font-mono text-xs">${cargasVinculadasHtml}</td>
          <td class="p-3 font-mono text-xs">Fab: ${esc(c.dataFabr)}<br>Manut: ${esc(manutDisplay)}</td>
          <td class="p-3 font-mono text-xs"><span class="px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-bold">${esc(c.refTempo)}</span></td>
          <td class="p-3 font-bold text-xs">${esc(c.navio || 'Não Vinculado')}</td>
          <td class="p-3">${estadoContHtml}</td>
          <td class="p-3 text-right whitespace-nowrap">${contAcoesHtml}</td>
        </tr>
      `;
    }).join('');
  }

  // Herança pós-vinculação: quando o contêiner ganha um navio, as cargas dele
  // vinculadas com a opção "Herdar o navio do contêiner" (ou sem navio)
  // passam a exibir o navio automaticamente.
  async function propagarNavioParaCargasDoContainer(contIdentificacao, navioAlvo) {
    const chaveCont = String(contIdentificacao || '').trim().toLowerCase();
    if (!chaveCont || !navioAlvo) return 0;
    const cargasLocais = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    let atualizadas = 0;
    cargasLocais.forEach(c => {
      if (!c || c.status === 'CANCELADA' || c.status === 'RECUSADA') return;
      const mesmoCont = c.container && String(c.container).trim().toLowerCase() === chaveCont;
      if (!mesmoCont) return;
      const deveHerdar = c.herdarNavioDoContainer === true || !c.navio;
      if (!deveHerdar) return;
      c.navio = navioAlvo.nome;
      if (navioAlvo.id) {
        c.navioId = navioAlvo.id;
        c.navio_id = navioAlvo.id;
      }
      atualizadas++;
    });
    if (atualizadas > 0) {
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasLocais));
      if (window.nexusSupabase && navioAlvo.id) {
        try {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const idsUuid = cargasLocais
            .filter(c => c.container && String(c.container).trim().toLowerCase() === chaveCont && isUuid.test(String(c.rawDbId || '')))
            .map(c => c.rawDbId);
          if (idsUuid.length > 0) {
            await window.nexusSupabase.from('cargas').update({ navio_id: navioAlvo.id }).in('id', idsUuid);
          }
        } catch (e) {
          console.warn('Erro ao propagar navio herdado para cargas no Supabase:', e);
        }
      }
      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('cargas');
      }
    }
    return atualizadas;
  }

  // Vincular Contêiner a um Navio com Validação de Capacidade (15.000 t e ~300m) (Tarefa 8)
  window.vincularContainerANavio = async function(contIdentificacao, opcoes) {
    const cont = containersList.find(c => (c.identificacao || '').toUpperCase() === contIdentificacao.toUpperCase());
    if (!cont) return;

    if (naviosList.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Navios Indisponíveis', 'Nenhum navio cadastrado no sistema para vinculação de contêiner.');
      }
      return;
    }

    // Backlog3: somente embarcações ATRACADAS no Porto de Santos podem
    // receber contêineres. Navios em trânsito (FORA_DO_PORTO) ou já no
    // porto de destino ficam fora da lista de vínculo.
    // Equipamento em manutenção não entra em novas operações (estado do banco)
    const integ = window.NexusIntegridade;
    if (integ) {
      const dispCont = await integ.verificarDisponibilidade('CONTAINER', { id: cont.rawDbId, codigo: cont.identificacao });
      if (!dispCont.disponivel) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Contêiner Indisponível', `O contêiner ${cont.identificacao} está ${dispCont.motivo} e não pode ser vinculado a um navio.`);
        }
        await carregarContainersSupabase();
        return;
      }
    } else if (!['OPERANTE', 'DISPONIVEL'].includes(String(cont.estado || 'OPERANTE').toUpperCase())) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Contêiner Indisponível', `O contêiner ${cont.identificacao} está em manutenção (${cont.estado}) e não pode ser vinculado a um navio.`);
      }
      return;
    }

    // Navios em manutenção (estado operacional ≠ OPERANTE) ficam fora da lista
    let estadoNavios = null;
    if (integ) {
      const lista = await integ.listarDisponibilidade('NAVIO');
      if (lista.fonte === 'erro') {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Vinculação Não Realizada', `Não foi possível conferir o estado dos navios no banco de dados (${lista.erro}). Tente novamente.`);
        }
        return;
      }
      estadoNavios = lista.itens;
    }
    const navioIndisponivel = (n) => {
      if (!estadoNavios) return null;
      const item = estadoNavios.find(x => (x.id && n.id && String(x.id) === String(n.id)) || (x.codigo && n.imo && String(x.codigo).toUpperCase() === String(n.imo).toUpperCase()));
      return item && !item.disponivel ? item.motivo : null;
    };
    const naviosElegiveis = naviosList.filter(n => (n.localizacao || 'DENTRO_DO_PORTO') === 'DENTRO_DO_PORTO' && !navioIndisponivel(n));
    if (naviosElegiveis.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Nenhum Navio Disponível', 'Não há embarcações atracadas no Porto de Santos e operantes disponíveis para vinculação. Navios em trânsito, no porto de destino ou em manutenção não podem receber contêineres.');
      }
      return;
    }

    const optionsText = naviosElegiveis.map((n, idx) => `${idx + 1} - ${n.nome} (${n.imo})`).join('\n');
    let selecao;
    if (opcoes && opcoes.navioImo !== undefined) {
      // Uso do agente WebMCP: escolhe o navio pelo IMO, sem diálogo.
      // O filtro do Backlog3 vale também aqui: IMO de navio fora do Porto
      // de Santos não entra na lista de elegíveis e a vinculação é recusada.
      const idxNavio = naviosElegiveis.findIndex((n) => n.imo === opcoes.navioImo);
      selecao = idxNavio >= 0 ? String(idxNavio + 1) : '';
      if (!selecao && window.mostrarFeedback) {
        const navioPedido = naviosList.find((n) => n.imo === opcoes.navioImo);
        const nomePedido = navioPedido ? `${navioPedido.nome} (${navioPedido.imo})` : `IMO ${opcoes.navioImo}`;
        const motivoManut = navioPedido ? navioIndisponivel(navioPedido) : null;
        if (motivoManut) {
          window.mostrarFeedback('alerta', 'Navio Indisponível', `A embarcação ${nomePedido} está ${motivoManut} e não pode receber contêineres.`);
        } else {
          window.mostrarFeedback('alerta', 'Navio Fora do Porto', `A embarcação ${nomePedido} não está atracada no Porto de Santos (situação: ${navioPedido ? localizacaoInfo(navioPedido.localizacao).txt : 'não encontrada'}) e não pode receber contêineres.`);
        }
      }
    } else {
      selecao = await window.nexusPrompt('Vincular Contêiner a Navio', `Selecione um Navio para o contêiner ${cont.identificacao} (apenas embarcações no Porto de Santos e operantes):\n${optionsText}`);
    }

    if (!selecao) return;

    const idxSel = parseInt(selecao, 10) - 1;
    if (!isNaN(idxSel) && naviosElegiveis[idxSel]) {
      const navioAlvo = naviosElegiveis[idxSel];

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

      // Revalida no banco imediatamente antes de gravar (tela pode estar desatualizada)
      if (integ) {
        const [dispContFinal, dispNavio] = await Promise.all([
          integ.verificarDisponibilidade('CONTAINER', { id: cont.rawDbId, codigo: cont.identificacao }),
          integ.verificarDisponibilidade('NAVIO', { id: navioAlvo.id, codigo: navioAlvo.imo, nome: navioAlvo.nome })
        ]);
        const bloqueio = !dispContFinal.disponivel
          ? `O contêiner ${cont.identificacao} está ${dispContFinal.motivo}`
          : !dispNavio.disponivel ? `O navio ${navioAlvo.nome} está ${dispNavio.motivo}` : null;
        if (bloqueio) {
          if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Vinculação Bloqueada', `${bloqueio}. Nada foi alterado.`);
          return;
        }
      }

      if (window.nexusSupabase) {
        try {
          const { error } = await window.nexusSupabase.from('containers')
            .update({ navio_id: navioAlvo.id })
            .eq('numero_identificacao', cont.identificacao);
          if (error) throw error;
        } catch (e) {
          console.warn('Erro ao atualizar vinculação de contêiner no Supabase:', e);
          if (window.mostrarFeedback) {
            const detalhe = integ ? integ.descreverErroBanco(e) : ((e && e.message) || e);
            window.mostrarFeedback('erro', 'Vinculação Não Realizada', `Não foi possível vincular o contêiner ${cont.identificacao} ao navio ${navioAlvo.nome}: ${detalhe}.`);
          }
          return;
        }
      }

      cont.navio = navioAlvo.nome;
      cont.navio_id = navioAlvo.id;
      cont.navio_nome = navioAlvo.nome;
      localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));

      // As cargas do contêiner com herança ativa passam a exibir o navio
      const cargasHerdadas = await propagarNavioParaCargasDoContainer(cont.identificacao, navioAlvo);

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EDICAO', 'containers', cont.id || null, `Contêiner ${cont.identificacao} vinculado ao navio ${navioAlvo.nome}${cargasHerdadas > 0 ? `; ${cargasHerdadas} carga(s) herdaram o navio` : ''}`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('containers');
      }

      renderContainersTable();
      if (window.mostrarFeedback) {
        const msgHeranca = cargasHerdadas > 0 ? ` ${cargasHerdadas} carga(s) do contêiner herdaram o navio automaticamente.` : '';
        window.mostrarFeedback('sucesso', 'Contêiner Vinculado', `Contêiner ${cont.identificacao} vinculado com sucesso ao navio ${navioAlvo.nome}!${msgHeranca}`);
      }
    } else {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Opção Inválida', 'Seleção de navio inválida.');
    }
  };

  // Excluir Contêiner (Tarefa 8): exclusão real no Supabase, verificada.
  // Bloqueado (com justificativa) se houver carga ativa dentro do contêiner ou
  // OS de manutenção ativa; cargas já finalizadas são apenas desvinculadas
  // (FK ON DELETE SET NULL) e o histórico de manutenção é preservado.
  window.excluirContainer = async function(contIdentificacao, opcoes) {
    const chave = String(contIdentificacao || '').toUpperCase();
    const cont = containersList.find(c => (c.identificacao || '').toUpperCase() === chave);
    if (!cont) return;

    const finalizados = ['ENTREGUE', 'CANCELADA', 'RECUSADA'];
    const cargasLocais = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const cargaNoCont = (c) => (c.container && String(c.container).toUpperCase() === chave) ||
      (c.container_id && cont.rawDbId && String(c.container_id) === String(cont.rawDbId));
    let ativas = cargasLocais.filter(c => cargaNoCont(c) && !finalizados.includes(c.status)).map(c => c.id);

    // Confere também no banco (a lista local pode estar desatualizada)
    if (window.nexusSupabase && window.NexusIntegridade && window.NexusIntegridade.ehUuid(cont.rawDbId)) {
      try {
        const { data, error } = await window.nexusSupabase.from('cargas')
          .select('id, qr_code_url, status_fluxo').eq('container_id', cont.rawDbId);
        if (error) throw error;
        (data || []).filter(c => !finalizados.includes(c.status_fluxo)).forEach(c => {
          const rotulo = c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/, '') : c.id;
          if (!ativas.includes(rotulo)) ativas.push(rotulo);
        });
      } catch (e) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Exclusão Não Realizada', `Não foi possível conferir as cargas do contêiner ${cont.identificacao} no banco de dados (${window.NexusIntegridade.descreverErroBanco(e)}). Tente novamente.`);
        }
        return;
      }
    }
    if (ativas.length > 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Exclusão Bloqueada', `O contêiner ${cont.identificacao} possui ${ativas.length} carga(s) em andamento (${ativas.slice(0, 3).join(', ')}${ativas.length > 3 ? '…' : ''}). Conclua, cancele ou vincule essas cargas a outro contêiner antes de excluí-lo.`);
      }
      return;
    }

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Contêiner', `Tem certeza que deseja EXCLUIR o contêiner ${cont.identificacao}? Ele será removido do banco de dados; cargas já finalizadas serão desvinculadas e o histórico de manutenção será preservado.`)
      : true;
    if (!confirmou) return;

    if (window.nexusSupabase) {
      const resultado = window.NexusIntegridade
        ? await window.NexusIntegridade.excluirEquipamento('CONTAINER', { id: cont.rawDbId, codigo: cont.identificacao })
        : { ok: false, mensagem: 'módulo de integridade (js/integridade-operacional.js) não carregado' };
      if (!resultado.ok) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Exclusão Não Realizada', `Não foi possível excluir o contêiner ${cont.identificacao}: ${resultado.mensagem}. Nada foi removido.`);
        }
        await carregarContainersSupabase();
        return;
      }
    }

    containersList = containersList.filter(c => (c.identificacao || '').toUpperCase() !== chave);
    localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));
    // Cargas finalizadas que apontavam para o contêiner ficam sem contêiner
    let cargasAlteradas = false;
    cargasLocais.forEach(c => {
      if (cargaNoCont(c)) {
        c.container = '';
        c.container_id = null;
        cargasAlteradas = true;
      }
    });
    if (cargasAlteradas) localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasLocais));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'containers', cont.rawDbId || cont.id || null, `Contêiner ${cont.identificacao} excluído do sistema`);
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('containers');
      if (cargasAlteradas) window.NexusRepository.notifyChange('cargas');
    }

    renderContainersTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Contêiner Excluído', `Contêiner ${cont.identificacao} excluído ${window.nexusSupabase ? 'do banco de dados' : '(modo local)'} com sucesso.`);
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
          <td class="p-3 font-mono font-bold text-nexus-500">${esc(g.identificacao)}</td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
              g.estado === 'OPERANTE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
              'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            }">${esc(g.estado)}</span>
          </td>
          <td class="p-3 font-mono text-xs">${esc(g.dataManut || 'N/A')}</td>
          <td class="p-3 text-right">
            <div class="flex items-center justify-end gap-1.5 font-mono text-[11px]">
              <button type="button" onclick="window.exibirTarefasGuindaste(${jsArg(g.identificacao)})" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold inline-flex items-center gap-1 transition-all ${temTarefas ? 'animate-pulse ring-2 ring-amber-400' : 'opacity-80'}">
                <span class="material-symbols-outlined text-[13px]">task</span>
                <span>Tarefas (${tarefasAtivas.length})</span>
              </button>
              <button type="button" onclick="window.excluirGuindaste(${jsArg(g.identificacao)})" class="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">delete</span><span>Excluir</span></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Excluir Guindaste (Item 6)
  // Excluir Guindaste/Pórtico: exclusão real no Supabase, verificada.
  // Bloqueado (com justificativa) se houver tarefa de movimentação pendente
  // (a carga ficaria presa aguardando um guindaste inexistente) ou OS de
  // manutenção ativa. O histórico de manutenção é preservado.
  window.excluirGuindaste = async function(gndIdentificacao, opcoes) {
    const chave = String(gndIdentificacao || '').toUpperCase();
    const guindaste = guindastesList.find(g => (g.identificacao || '').toUpperCase() === chave);
    if (!guindaste) return;

    const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    const pendentes = tarefasGnd.filter(t => String(t.guindasteId || '').toUpperCase() === chave && (!t.status || t.status === 'PENDENTE'));
    if (pendentes.length > 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Exclusão Bloqueada', `O guindaste ${guindaste.identificacao} possui ${pendentes.length} tarefa(s) de movimentação pendente(s) (cargas ${pendentes.slice(0, 3).map(t => t.cargaId).join(', ')}). Conclua as tarefas antes de excluí-lo.`);
      }
      return;
    }

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Guindaste', `Tem certeza que deseja EXCLUIR o guindaste ${guindaste.identificacao}? Ele será removido do banco de dados; o histórico de manutenção será preservado.`)
      : true;
    if (!confirmou) return;

    if (window.nexusSupabase) {
      const resultado = window.NexusIntegridade
        ? await window.NexusIntegridade.excluirEquipamento('GUINDASTE', { id: guindaste.id, codigo: guindaste.identificacao })
        : { ok: false, mensagem: 'módulo de integridade (js/integridade-operacional.js) não carregado' };
      if (!resultado.ok) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Exclusão Não Realizada', `Não foi possível excluir o guindaste ${guindaste.identificacao}: ${resultado.mensagem}. Nada foi removido.`);
        }
        await carregarGuindastesSupabase();
        return;
      }
    }

    guindastesList = guindastesList.filter(g => (g.identificacao || '').toUpperCase() !== chave);
    localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));
    // Tarefas já concluídas/antigas do guindaste deixam de existir
    localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasGnd.filter(t => String(t.guindasteId || '').toUpperCase() !== chave)));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'guindastes', guindaste.id || null, `Guindaste ${guindaste.identificacao} excluído do sistema`);
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('guindastes');
    }

    renderGuindastesTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Guindaste Excluído', `Guindaste ${guindaste.identificacao} excluído ${window.nexusSupabase ? 'do banco de dados' : '(modo local)'} com sucesso.`);
    }
  };

  // Modal de tarefas do guindaste: exibe as instruções de cada movimentação
  // pendente, com botão "Concluída" que atualiza o Setor do Pátio da carga.
  const tarefasModal = document.getElementById('tarefasGuindasteModal');
  const tarefasListEl = document.getElementById('tarefasGuindasteList');
  const tarefasGndLabel = document.getElementById('tarefasGuindasteIdLabel');
  const closeTarefasBtn = document.getElementById('closeTarefasGuindasteModalBtn');
  const fecharTarefasBtn = document.getElementById('fecharTarefasGuindasteBtn');
  let tarefasGndAtual = null;

  function fecharTarefasModal() {
    if (tarefasModal) tarefasModal.classList.add('hidden');
    tarefasGndAtual = null;
  }
  if (closeTarefasBtn) closeTarefasBtn.addEventListener('click', fecharTarefasModal);
  if (fecharTarefasBtn) fecharTarefasBtn.addEventListener('click', fecharTarefasModal);

  function renderTarefasModal() {
    if (!tarefasModal || !tarefasListEl || !tarefasGndAtual) return;
    if (tarefasGndLabel) tarefasGndLabel.textContent = tarefasGndAtual;
    const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    const pendentes = tarefasGnd.filter(t => t.guindasteId === tarefasGndAtual && (!t.status || t.status === 'PENDENTE'));
    if (pendentes.length === 0) {
      tarefasListEl.innerHTML = `
        <div class="p-6 text-center text-slate-400 italic">
          <span class="material-symbols-outlined text-[32px] block mb-1 text-slate-300 dark:text-slate-600">task_alt</span>
          Nenhuma tarefa pendente para este guindaste.
        </div>`;
      return;
    }
    tarefasListEl.innerHTML = pendentes.map(t => {
      const instrucoes = t.instrucoes || `Movimentar a carga ${t.cargaId} (${t.tipoCarga || 'Geral'}) para o setor "${t.destino || 'destino'}".`;
      return `
        <div class="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono font-bold text-nexus-900 dark:text-white">Carga ${esc(t.cargaId || '?')} <span class="text-slate-400 font-normal">(${esc(t.tipoCarga || 'Geral')})</span></span>
            <span class="px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-mono text-[10px] font-bold uppercase">Pendente</span>
          </div>
          <div class="text-slate-600 dark:text-slate-300 leading-relaxed">
            <span class="font-bold block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Instruções da tarefa</span>
            ${esc(instrucoes)}
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            <span>${esc(t.origem || 'Origem ?')} ➔ <strong class="text-nexus-900 dark:text-white">${esc(t.destino || '?')}</strong></span>
            <span>${esc(t.dataCriacao || '')}</span>
          </div>
          <div class="flex justify-end pt-1">
            <button type="button" onclick="window.concluirTarefaGuindaste(${jsArg(t.id)})" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm">
              <span class="material-symbols-outlined text-[16px]">check_circle</span>
              <span>Concluída</span>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  window.exibirTarefasGuindaste = async function(gndIdentificacao) {
    tarefasGndAtual = gndIdentificacao;
    if (!tarefasModal) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Tarefas do Guindaste', `Modal de tarefas indisponível nesta página.`);
      }
      return;
    }
    renderTarefasModal();
    tarefasModal.classList.remove('hidden');
  };

  // Conclui a tarefa: atualiza o Setor do Pátio da carga (Cargas & Pátio) e
  // remove a pendência do guindaste.
  window.concluirTarefaGuindaste = async function(tarefaId, opcoes) {
    const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    const tarefa = tarefasGnd.find(t => String(t.id) === String(tarefaId));
    if (!tarefa) {
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Tarefa Não Encontrada', 'Esta tarefa já foi concluída ou removida.');
      return;
    }
    // Guindaste que entrou em manutenção depois da criação da tarefa não executa a movimentação
    if (window.NexusIntegridade) {
      const disp = await window.NexusIntegridade.verificarDisponibilidade('GUINDASTE', { codigo: tarefa.guindasteId });
      if (!disp.disponivel) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Guindaste Indisponível', `O guindaste ${tarefa.guindasteId} está ${disp.motivo}. A movimentação da carga ${tarefa.cargaId} não pode ser concluída por ele; aguarde a liberação da manutenção.`);
        }
        return;
      }
    }
    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Concluir Movimentação', `Confirmar que a carga ${tarefa.cargaId} foi posicionada no setor "${tarefa.destino}"? O Setor do Pátio será atualizado em Cargas & Pátio.`)
      : true;
    if (!confirmou) return;

    // Atualiza o ponto de descarga (Setor do Pátio) da carga
    const cargasLocais = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const carga = cargasLocais.find(c => c.id === tarefa.cargaId);
    if (carga) {
      carga.portoDescarga = tarefa.destino || carga.portoDescarga;
      carga.movimentacaoPendente = null;
      carga.guindasteDesignado = null;
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasLocais));
      if (window.nexusSupabase && tarefa.destino) {
        try {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(carga.rawDbId || carga.id);
          let q = window.nexusSupabase.from('cargas').update({ porto_descarga: tarefa.destino });
          q = isUuid ? q.eq('id', carga.rawDbId || carga.id) : q.eq('qr_code_url', carga.qrCode || `QR-${carga.id}`);
          await q;
        } catch (e) {
          console.warn('[NexusPort] Erro ao atualizar setor da carga no Supabase:', e);
        }
      }
    }

    const restantes = tarefasGnd.filter(t => String(t.id) !== String(tarefaId));
    localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(restantes));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao(tarefa.cargaId || tarefaId, 'EDICAO', `Movimentação concluída pelo guindaste ${tarefa.guindasteId}: setor atualizado para "${tarefa.destino}"`);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('cargas');
      window.NexusRepository.notifyChange('guindaste_tarefas');
    }

    renderGuindastesTable();
    renderTarefasModal();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Movimentação Concluída', `Carga ${tarefa.cargaId} posicionada em "${tarefa.destino}". O Setor do Pátio foi atualizado na tabela Cargas & Pátio.`);
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
    carregarBercosSupabase();
    carregarNaviosSupabase();
    carregarContainersSupabase();
    carregarGuindastesSupabase();
    carregarRotasMaritimas();   // Backlog 3 (tempo real): rotas cadastradas em outra tela/usuário
  });
});
