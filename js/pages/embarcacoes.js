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

  const UUID_NAVIO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CAMPOS_BERCO_LIVRE = { estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null };

  /** Reflete no cache local (e, depois, no painel) um estado de berço já gravado no banco. */
  function refletirBercoLocal(nomeBerco, campos) {
    const lista = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    const berco = lista.find(b => b.nome === nomeBerco);
    if (!berco) return;
    Object.assign(berco, campos);
    localStorage.setItem('nexus_bercos_list', JSON.stringify(lista));
  }

  /** Lê uma linha de berço do banco pelo nome. */
  async function buscarBercoNoBanco(nomeBerco) {
    const client = clienteBercos();
    if (!client) return { ok: false };
    try {
      const { data, error } = await client.from('bercos').select('*').eq('nome', nomeBerco);
      if (error) {
        if (tratarErroBercos(error)) return { ok: true, linha: null };
        return { ok: false, erro: error.message || 'erro desconhecido' };
      }
      if (!Array.isArray(data)) return { ok: false, erro: 'resposta inválida' };
      return { ok: true, linha: data[0] || null };
    } catch (e) {
      return { ok: false, erro: e && e.message ? e.message : String(e) };
    }
  }

  /**
   * Ocupa um berço NO BANCO de forma condicional (compare-and-set): a linha só é
   * atualizada se ainda estiver LIVRE. Dois operadores que tentem ocupar o mesmo
   * berço ao mesmo tempo não conseguem: o segundo recebe "já ocupado".
   * Sem a tabela no banco (modo local), devolve ok com local:true.
   * @returns {Promise<{ok:boolean, local?:boolean, motivo?:string, payload?:object}>}
   */
  async function reservarBercoNoBanco(berco, navio) {
    const ocupacao = normalizarBerco({
      id: berco.id,
      nome: berco.nome,
      estado: 'OCUPADO',
      navio_nome: navio.nome,
      navio_imo: navio.imo,
      navio_id: (navio.id && UUID_NAVIO_RE.test(navio.id)) ? navio.id : null
    });
    if (!ocupacao.payload || ocupacao.payload.estado !== 'OCUPADO') {
      return { ok: false, motivo: 'Não foi possível identificar o navio (nome/IMO) para ocupar o berço. Verifique o cadastro da embarcação.' };
    }
    const p = ocupacao.payload;
    const client = clienteBercos();
    if (!client) return { ok: true, local: true, payload: p };
    try {
      const { data, error } = await client.from('bercos')
        .update({ estado: 'OCUPADO', navio_nome: p.navio_nome, navio_imo: p.navio_imo, navio_id: p.navio_id })
        .eq('nome', berco.nome)
        .eq('estado', 'LIVRE')
        .select('nome');
      if (error) {
        if (tratarErroBercos(error)) return { ok: true, local: true, payload: p };
        return { ok: false, motivo: `Falha ao gravar a ocupação no banco de dados (${error.message || 'erro desconhecido'}). Vinculação não realizada.` };
      }
      if (Array.isArray(data) && data.length > 0) return { ok: true, payload: p };
      // Nenhuma linha atualizada: o berço já estava ocupado ou não existe no banco.
      const lido = await buscarBercoNoBanco(berco.nome);
      if (!lido.ok) return { ok: false, motivo: 'Não foi possível confirmar a disponibilidade do berço no banco de dados. Vinculação não realizada.' };
      if (!lido.linha) return { ok: false, motivo: `O ${berco.nome} não está cadastrado no banco de dados.` };
      return { ok: false, motivo: `O ${berco.nome} já está ocupado${lido.linha.navio_nome ? ` por ${lido.linha.navio_nome}` : ''}. Escolha outro berço.` };
    } catch (e) {
      return { ok: false, motivo: `Falha de comunicação com o banco de dados (${e && e.message ? e.message : e}). Vinculação não realizada.` };
    }
  }

  /**
   * Libera um berço NO BANCO somente se ele ainda estiver ocupado pelo ocupante
   * informado ({ imo, nome }). Evita liberar um berço que já foi ocupado por outro navio.
   */
  async function liberarBercoNoBanco(nomeBerco, ocupante) {
    const client = clienteBercos();
    if (!client) return { ok: true, local: true };
    try {
      let q = client.from('bercos')
        .update(CAMPOS_BERCO_LIVRE)
        .eq('nome', nomeBerco)
        .eq('estado', 'OCUPADO');
      if (ocupante && ocupante.imo) q = q.eq('navio_imo', ocupante.imo);
      else if (ocupante && ocupante.nome) q = q.eq('navio_nome', ocupante.nome);
      const { data, error } = await q.select('nome');
      if (error) {
        if (tratarErroBercos(error)) return { ok: true, local: true };
        return { ok: false, motivo: error.message || 'erro desconhecido' };
      }
      return { ok: true, liberou: Array.isArray(data) && data.length > 0 };
    } catch (e) {
      return { ok: false, motivo: e && e.message ? e.message : String(e) };
    }
  }

  /** Libera, no banco e no cache, todos os berços ocupados pelo navio (saída ou exclusão). */
  async function liberarBercosDoNavio(navio) {
    const atual = await lerBercosAtuais();
    if (!atual.ok) return { liberados: 0, falhas: [{ berco: '(leitura dos berços)', motivo: atual.erro || 'falha ao ler os berços' }] };
    const meus = atual.lista.filter(b => b.estado === 'OCUPADO' && ((navio.imo && b.navio_imo === navio.imo) || (navio.nome && b.navio_nome === navio.nome)));
    const falhas = [];
    for (const b of meus) {
      const r = await liberarBercoNoBanco(b.nome, { imo: b.navio_imo, nome: b.navio_nome });
      if (r.ok) refletirBercoLocal(b.nome, CAMPOS_BERCO_LIVRE);
      else falhas.push({ berco: b.nome, motivo: r.motivo });
    }
    renderBercosPanel();
    return { liberados: meus.length - falhas.length, falhas };
  }

  /**
   * Rede de segurança: libera no banco berços OCUPADOS cujo navio não existe mais.
   * Lê os berços antes dos navios: um berço ocupado sempre tem seu navio já cadastrado.
   */
  async function liberarBercosOrfaos() {
    const client = window.nexusSupabase;
    if (!client || !clienteBercos()) return;
    const atual = await lerBercosAtuais();
    if (!atual.ok || atual.origem !== 'banco') return;
    const ocupados = atual.lista.filter(b => b.estado === 'OCUPADO');
    if (ocupados.length === 0) return;
    const { data, error } = await client.from('navios').select('numero_imo, nome');
    if (error || !Array.isArray(data)) return;
    const imos = new Set(data.map(n => String(n.numero_imo || '').toLowerCase()).filter(Boolean));
    const nomes = new Set(data.map(n => String(n.nome || '').toLowerCase()).filter(Boolean));
    for (const b of ocupados) {
      const existe = (b.navio_imo && imos.has(String(b.navio_imo).toLowerCase()))
        || (b.navio_nome && nomes.has(String(b.navio_nome).toLowerCase()));
      if (existe) continue;
      const r = await liberarBercoNoBanco(b.nome, { imo: b.navio_imo, nome: b.navio_nome });
      if (r.ok) refletirBercoLocal(b.nome, CAMPOS_BERCO_LIVRE);
    }
    renderBercosPanel();
  }

  /**
   * Carrega os berços do banco (fonte de verdade). Só cadastra no banco os berços
   * que ainda não existem; berços já cadastrados nunca são sobrescritos. Se a leitura
   * falhar, usa o cache local e não grava nada.
   */
  async function carregarBercosSupabase() {
    const clientLeitura = clienteBercos();
    let leituraOk = false;
    let doBanco = [];
    if (clientLeitura) {
      try {
        const { data, error } = await clientLeitura.from('bercos').select('*').order('nome', { ascending: true });
        if (error) tratarErroBercos(error);
        if (!error && Array.isArray(data)) {
          leituraOk = true;
          doBanco = data.map(b => ({
            id: b.id || `BERCO-${String(b.nome).replace(/\D/g, '')}`,
            nome: b.nome,
            estado: b.estado || 'LIVRE',
            navio_nome: b.navio_nome || null,
            navio_imo: b.navio_imo || null,
            navio_id: b.navio_id || null
          }));
        }
      } catch (err) {
        if (!tratarErroBercos(err)) {
          console.warn('[NexusPort] Erro ao carregar berços do Supabase:', err);
        }
      }
    }

    const cache = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    const doBancoPorNome = new Map(doBanco.map(b => [b.nome, b]));
    const cachePorNome = new Map((Array.isArray(cache) ? cache : []).map(b => [b.nome, b]));
    const faltantes = [];

    bercosList = Array.from({ length: 15 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const nomeBerco = `Berço ${num}`;
      if (leituraOk && doBancoPorNome.has(nomeBerco)) return doBancoPorNome.get(nomeBerco);
      const padrao = cachePorNome.get(nomeBerco) || {
        id: `BERCO-${num}`, nome: nomeBerco, estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null
      };
      if (leituraOk) faltantes.push(padrao);
      return padrao;
    });

    sanearBercosLocais(bercosList);
    // Cadastra apenas os berços ausentes; ignoreDuplicates impede sobrescrever uma linha criada por outro operador.
    if (leituraOk && faltantes.length > 0 && clientLeitura) {
      try {
        const payload = faltantes.map(b => normalizarBerco(b).payload).filter(Boolean);
        if (payload.length > 0) {
          const { error } = await clientLeitura.from('bercos').upsert(payload, { onConflict: 'nome', ignoreDuplicates: true });
          tratarErroBercos(error);
        }
      } catch (e) {
        if (!tratarErroBercos(e)) console.warn('[NexusPort] Erro ao cadastrar berços ausentes no Supabase:', e);
      }
    }

    localStorage.setItem('nexus_bercos_list', JSON.stringify(bercosList));
    renderBercosPanel();
  }

  function renderBercosPanel() {
    bercosList = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    if (bercosList.length < 15) {
      const existingMap = new Map(bercosList.map(b => [b.nome, b]));
      bercosList = Array.from({ length: 15 }, (_, i) => {
        const num = String(i + 1).padStart(2, '0');
        const nomeBerco = `Berço ${num}`;
        return existingMap.get(nomeBerco) || { id: `BERCO-${num}`, nome: nomeBerco, estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null };
      });
    }

    // Corrige cache legado (OCUPADO sem navio / id fora do padrão) antes de
    // renderizar e antes de qualquer gravação.
    let bercosAlterados = sanearBercosLocais(bercosList);

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
            <span class="font-bold text-nexus-900 dark:text-white">${esc(b.nome)}</span>
            <span class="px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
              b.estado === 'LIVRE' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
              b.estado === 'OCUPADO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' :
              'bg-slate-200 text-slate-800'
            }">${esc(b.estado)}</span>
          </div>
          <span class="text-[11px] text-slate-600 font-mono">
            ${b.estado === 'OCUPADO' ? `Navio: <strong class="text-nexus-500">${esc(b.navio_nome || b.carga_id || 'Navio Alocado')}</strong>` : 'Pronto para atracação'}
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
  // Identifica o Porto de Santos pelo nome cadastrado (origem/destino da rota)
  function ehPortoSantos(nomePorto) {
    return /santos/i.test(String(nomePorto || ''));
  }

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
          liberarBercosOrfaos().catch(e => console.warn('[NexusPort] Verificação de berços órfãos falhou:', e));
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
          <td colspan="7" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] text-slate-300 dark:text-slate-600 block mb-1">sailing</span>
            <span class="block font-bold text-slate-600 text-xs">Nenhuma embarcação cadastrada ainda.</span>
            <span class="block text-[11px] text-slate-600 mt-1">Navios são cadastrados pelo Inspetor em "Gerenciar Embarcações". Assim que o primeiro cadastro for salvo, o GPS, o ETA e as ações aparecem aqui automaticamente.</span>
          </td>
        </tr>
      `;
      return;
    }

    // C10 & RN 12: só as cargas vinculadas ao navio que chegou ao porto de destino viram ENTREGUE.
    // A gravação no Supabase é feita por id de carga, nunca por status (não atinge outras cargas).
    const UUID_CARGA_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const idsRemotosEntregues = [];
    let cargasAtualizadas = false;

    const cargaPertenceAoNavio = (c, n) => {
      const navioIdCarga = c.navioId || c.navio_id;
      if (navioIdCarga && n.id) return String(navioIdCarga) === String(n.id);
      const nomeNavio = String(n.nome || '').trim().toLowerCase();
      return !!nomeNavio && String(c.navio || '').trim().toLowerCase() === nomeNavio;
    };

    cargasFluxo.forEach((c) => {
      if (!c || (!c.navio && !c.navioId && !c.navio_id)) return;
      if (['ENTREGUE', 'CANCELADA', 'RECUSADA'].includes(c.status)) return;
      const navio = naviosList.find((n) => n.localizacao === 'NO_PORTO_DE_DESTINO' && cargaPertenceAoNavio(c, n));
      if (!navio) return;
      c.status = 'ENTREGUE';
      cargasAtualizadas = true;
      const idBanco = String(c.rawDbId || '');
      if (UUID_CARGA_RE.test(idBanco)) idsRemotosEntregues.push(idBanco);
    });

    if (cargasAtualizadas) {
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxo));
      if (window.nexusSupabase && idsRemotosEntregues.length > 0) {
        window.nexusSupabase.from('cargas')
          .update({ status_fluxo: 'ENTREGUE' })
          .in('id', idsRemotosEntregues)
          .then(({ error }) => {
            if (error) console.warn('[NexusPort] Erro ao atualizar cargas entregues no Supabase:', error);
          })
          .catch(e => console.warn('[NexusPort] Erro ao atualizar entregue no Supabase:', e));
      }
    }

    // Exibe todos os navios cadastrados no terminal (Tarefa 5.2 - RF 1.9, RF 2.1)


    // Backlog 3 (7b): busca local + contador "Exibindo X de Y"
    const buscaNavioVal = (document.getElementById('buscarNavioInput')?.value || '').trim().toLowerCase();
    const naviosVisiveis = naviosList.filter(n => {
      if (!buscaNavioVal) return true;
      const haystack = `${n.nome || ''} ${n.imo || ''} ${n.origem || ''} ${n.destino || ''}`.toLowerCase();
      return haystack.includes(buscaNavioVal);
    });

    const embarcacoesCounterEl = document.getElementById('embarcacoesCounter');
    if (embarcacoesCounterEl) {
      embarcacoesCounterEl.textContent = `Exibindo ${naviosVisiveis.length} de ${naviosList.length} embarcação(ões)`;
    }

    if (naviosVisiveis.length === 0) {
      gpsTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-8 text-center">
            <span class="material-symbols-outlined text-[32px] text-slate-300 dark:text-slate-600 block mb-1">search_off</span>
            <span class="block font-bold text-slate-600 text-xs">Nenhuma embarcação corresponde à busca.</span>
            <span class="block text-[11px] text-slate-600 mt-1">Ajuste o termo pesquisado (nome, IMO ou destino) para listar novamente.</span>
          </td>
        </tr>
      `;
      return;
    }

    gpsTableBody.innerHTML = naviosVisiveis.map(n => {
      let etaText = '';
      let tempoForaText = '';
      let etaExtraHtml = '';

      if (n.localizacao === 'DENTRO_DO_PORTO') {
        etaText = ehPortoSantos(n.origem) || !n.origem ? 'Em Atracação no Porto Origem' : 'Atracado no Porto de Santos (destino da viagem)';
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

          // Transição automática para NO_PORTO_DE_DESTINO se o ETA zerou
          if (msRestantes <= 0 && n.localizacao === 'FORA_DO_PORTO') {
            // Chegada ao Porto de Santos (ex.: retorno de Paranaguá) = "No porto", apto a receber cargas.
            // Demais destinos = "Chegou ao destino" (cargas são entregues).
            const novaLocalizacao = ehPortoSantos(n.destino) ? 'DENTRO_DO_PORTO' : 'NO_PORTO_DE_DESTINO';
            n.localizacao = novaLocalizacao;
            localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));
            if (window.nexusSupabase) {
              window.nexusSupabase.from('navios')
                .update({ localizacao: novaLocalizacao })
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
                <div class="flex items-center justify-between text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                  <span>Progresso da viagem</span>
                  <span class="text-indigo-600 dark:text-indigo-400">${esc(String(progressoPct))}%</span>
                </div>
                <div class="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow="${esc(String(progressoPct))}" aria-valuemin="0" aria-valuemax="100" title="Progresso da viagem: ${esc(String(progressoPct))}% do tempo previsto decorrido">
                  <div class="h-1.5 rounded-full ${progressoPct >= 100 ? 'bg-emerald-700' : 'bg-nexus-500'}" style="width:${esc(String(progressoPct))}%"></div>
                </div>
              </div>`;
          }
        }
      }

      // Busca cargas do localstorage ou Supabase associadas a este navio (C2, C3)
      const cargasDoNavio = cargasFluxo.filter(c => c.navio && c.navio.toLowerCase() === n.nome.toLowerCase());

      let bercosInfoHtml = '<span class="text-slate-600 italic text-[11px]">Sem carga vinculada</span>';
      if (cargasDoNavio.length > 0) {
        bercosInfoHtml = cargasDoNavio.map(c => `
          <div class="text-[11px] leading-tight">
            <strong class="text-nexus-500">${esc(c.id)}</strong>: <span class="font-bold text-slate-700 dark:text-slate-200">${esc(c.portoDescarga || 'Berço não atrelado')}</span>
            <span class="block text-[10px] text-slate-600">Contêiner: ${esc(c.container || 'Não vinculado')}</span>
          </div>
        `).join('');
      }

      // RN 3: Liberação de saída de navios é competência do Supervisor de Operações e Direção
      const podeLiberarNavio = ['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);

      const emergenciaAtiva = typeof window.nexusEmergenciaAtiva === 'function' && window.nexusEmergenciaAtiva();

      let acoesHtml = '<div class="flex items-center justify-end gap-1.5 text-[11px] flex-wrap">';

      // Botão Vincular a Berço (Tarefa 6)
      acoesHtml += `<button type="button" onclick="window.vincularNavioABerco(${jsArg(n.imo)})" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">dock</span><span>Vincular</span></button>`;

      if (podeLiberarNavio) {
        if (n.localizacao === 'DENTRO_DO_PORTO') {
          if (emergenciaAtiva) {
            acoesHtml += `<button type="button" disabled aria-disabled="true" class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-600 font-bold cursor-not-allowed opacity-70" title="Emergência ativa: operações do pátio bloqueadas temporariamente">Liberar Saída</button>`;
          } else {
            acoesHtml += `<button type="button" onclick="window.liberarNavioPeloDiretor(${jsArg(n.imo)})" class="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold">Liberar Saída</button>`;
          }
        } else if (n.localizacao === 'NO_PORTO_DE_DESTINO') {
          if (emergenciaAtiva) {
            acoesHtml += `<button type="button" disabled aria-disabled="true" class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-600 font-bold cursor-not-allowed opacity-70" title="Emergência ativa: operações do pátio bloqueadas temporariamente">Autorizar Retorno</button>`;
          } else {
            acoesHtml += `<button type="button" onclick="window.autorizarRetornoNavio(${jsArg(n.imo)})" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold">Autorizar Retorno</button>`;
          }
        } else if (n.localizacao === 'FORA_DO_PORTO') {
          // Botão realmente desabilitado: o navio precisa chegar ao porto de destino
          acoesHtml += `<button type="button" disabled aria-disabled="true"
            class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-600 font-bold cursor-not-allowed opacity-70"
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

      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
          <td class="p-3 font-bold text-nexus-900 dark:text-white">
            ${esc(n.nome)}
            <span class="block font-mono text-[10px] text-nexus-500">${esc(n.imo)}</span>
          </td>
          <td class="p-3 font-mono text-xs">${bercosInfoHtml}</td>
          <td class="p-3">${localizacaoHtml}</td>
          <td class="p-3 text-xs">${esc(n.origem)} → <strong class="text-nexus-900 dark:text-white">${esc(n.destino || 'Destino não informado')}</strong></td>
          <td class="p-3 font-mono text-xs text-indigo-600 dark:text-indigo-400 font-bold">${esc(etaText)}${etaExtraHtml}</td>
          <td class="p-3 font-mono text-xs font-bold ${n.localizacao === 'NO_PORTO_DE_DESTINO' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600'}">${esc(tempoForaText)}</td>
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
          <td colspan="4" class="p-4 text-center text-slate-600 italic">${esc(texto)}</td>
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
          <td class="p-3 text-emerald-700 font-bold">${temDistancia ? `${esc(dist.toLocaleString('pt-BR'))} km` : '—'}</td>
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

    // Navio já no Porto de Santos com destino Santos não tem próxima viagem definida:
    // liberar a saída o faria "navegar" de volta ao próprio porto.
    if (navio.localizacao === 'DENTRO_DO_PORTO' && ehPortoSantos(navio.destino)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Próximo Destino Não Definido', `O navio ${navio.nome} está no Porto de Santos, que também é o destino cadastrado. Informe o próximo destino da embarcação antes de liberar a saída.`);
      }
      return;
    }

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
      // Libera os berços do navio NO BANCO antes da saída: se a liberação falhar, a saída não é registrada
      const resLibSaida = await liberarBercosDoNavio(navio);
      if (resLibSaida.falhas.length > 0) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Saída Não Registrada', `Não foi possível liberar o(s) berço(s) ${resLibSaida.falhas.map(f => f.berco).join(', ')} no banco de dados (${resLibSaida.falhas[0].motivo}). A saída não foi registrada; tente novamente.`);
        }
        return;
      }

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

  // Ocupa um berço com o navio no cadastro (revalidação e gravação condicional no banco).
  // Retorna { ok, motivo? }.
  async function ocuparBercoComNavio(nomeBerco, navio) {
    const atual = await lerBercosAtuais();
    if (!atual.ok) return { ok: false, motivo: 'Não foi possível confirmar a situação dos berços no banco de dados.' };
    const bercoReal = atual.lista.find(b => b.nome === nomeBerco);
    if (!bercoReal) return { ok: false, motivo: `${nomeBerco} não encontrado.` };
    if (bercoReal.estado !== 'LIVRE') return { ok: false, motivo: `O ${nomeBerco} já está ocupado.` };
    const reserva = await reservarBercoNoBanco(bercoReal, navio);
    if (!reserva.ok) return { ok: false, motivo: reserva.motivo };
    refletirBercoLocal(nomeBerco, reserva.payload);
    return { ok: true };
  }

  // Preenche o seletor de berço do formulário de cadastro com os berços LIVRES do banco.
  // Sem consulta bem-sucedida, o seletor não oferece berço algum.
  async function preencherBercoCadastroSelect() {
    const bercoSel = document.getElementById('navioBercoSelect');
    if (!bercoSel) return;
    const lido = await lerBercosAtuais();
    // Lido DEPOIS da consulta: uma escolha feita enquanto o banco respondia não pode ser apagada.
    const atual = bercoSel.value;
    if (!lido.ok) {
      bercoSel.innerHTML = '<option value="">Não foi possível consultar os berços</option>';
      return;
    }
    const livres = lido.lista.filter(b => b.estado === 'LIVRE');
    bercoSel.innerHTML = livres.length === 0
      ? '<option value="">Nenhum berço livre no momento</option>'
      : '<option value="">Selecione o berço...</option>' + livres.map(b => `<option value="${esc(b.nome)}">${esc(b.nome)}</option>`).join('');
    if (atual && livres.some(b => b.nome === atual)) bercoSel.value = atual;
  }

  // ------------------------------------------------------------------
  // Vincular Navio a Berço (Tarefa 6 / seleção sem digitação manual)
  // Os berços vêm do Supabase; ocupados aparecem desabilitados e a
  // disponibilidade é revalidada antes de qualquer gravação.
  // ------------------------------------------------------------------
  const vincularBercoModal = document.getElementById('vincularBercoModal');
  const vincularBercoSelect = document.getElementById('vincularBercoSelect');
  const vincularBercoNavioLabel = document.getElementById('vincularBercoNavioLabel');
  const vincularBercoAviso = document.getElementById('vincularBercoAviso');
  const confirmarVincularBercoBtn = document.getElementById('confirmarVincularBercoBtn');
  const cancelarVincularBercoBtn = document.getElementById('cancelarVincularBercoBtn');
  const closeVincularBercoBtn = document.getElementById('closeVincularBercoBtn');
  let navioPendenteBerco = null;

  /** Lê o estado atual dos berços no Supabase e espelha no cache local. */
  async function lerBercosAtuais() {
    const cache = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
    const client = clienteBercos();
    if (!client) return { ok: true, lista: cache, origem: 'local' };
    try {
      const { data, error } = await client.from('bercos').select('*').order('nome', { ascending: true });
      if (error) {
        // Tabela ausente: operação segue apenas com o cache local (comportamento já existente).
        if (tratarErroBercos(error)) return { ok: true, lista: cache, origem: 'local' };
        return { ok: false, lista: cache, erro: error.message || 'erro desconhecido' };
      }
      if (!Array.isArray(data)) return { ok: false, lista: cache, erro: 'resposta inválida' };
      const doBanco = data.map(b => ({
        id: b.id || `BERCO-${String(b.nome).replace(/\D/g, '')}`,
        nome: b.nome,
        estado: b.estado || 'LIVRE',
        navio_nome: b.navio_nome || null,
        navio_imo: b.navio_imo || null,
        navio_id: b.navio_id || null
      }));
      // O banco é a fonte de verdade: com registros, nenhum berço do cache local entra na lista
      // (um berço só-local marcado LIVRE poderia ser vinculado por engano). Sem registros, usa o cache.
      if (doBanco.length === 0) return { ok: true, lista: cache, origem: 'local' };
      const lista = doBanco;
      localStorage.setItem('nexus_bercos_list', JSON.stringify(lista));
      bercosList = lista;
      return { ok: true, lista, origem: 'banco' };
    } catch (e) {
      return { ok: false, lista: cache, erro: e && e.message ? e.message : String(e) };
    }
  }

  function preencherSelectVincularBerco(lista) {
    if (!vincularBercoSelect) return;
    vincularBercoSelect.innerHTML = '<option value="">Selecione o berço...</option>' + lista.map(b => {
      const livre = b.estado === 'LIVRE';
      const situacao = livre ? 'Livre' : `Ocupado${b.navio_nome ? ` por ${b.navio_nome}` : ''}`;
      return `<option value="${esc(b.nome)}" ${livre ? '' : 'disabled'}>${esc(b.nome)} — ${esc(situacao)}</option>`;
    }).join('');
  }

  function fecharVincularBerco() {
    if (vincularBercoModal) vincularBercoModal.classList.add('hidden');
    navioPendenteBerco = null;
  }

  // Vincular Navio a um dos 15 Berços: abre a seleção (somente berços livres habilitados)
  window.vincularNavioABerco = async function(imo, opcoes) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    const atual = await lerBercosAtuais();
    if (!atual.ok) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Berços Não Confirmados', `Não foi possível confirmar a situação dos berços no banco de dados (${atual.erro}). Tente novamente.`);
      return;
    }
    const livres = atual.lista.filter(b => b.estado === 'LIVRE');
    if (livres.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Berços Indisponíveis', 'Nenhum berço desocupado disponível no momento para vinculação do navio.');
      }
      return;
    }

    // Uso do agente WebMCP: berço informado pelo nome, validado no mesmo caminho da interface.
    if (opcoes && opcoes.bercoNome !== undefined) {
      await aplicarVinculoBerco(navio, opcoes.bercoNome);
      return;
    }

    if (!vincularBercoModal || !vincularBercoSelect) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Tela Incompleta', 'Seletor de berços não encontrado nesta página.');
      return;
    }
    navioPendenteBerco = navio;
    if (vincularBercoNavioLabel) vincularBercoNavioLabel.textContent = `${navio.nome} (IMO ${navio.imo})`;
    preencherSelectVincularBerco(atual.lista);
    vincularBercoSelect.value = '';
    if (vincularBercoAviso) vincularBercoAviso.textContent = `${livres.length} berço(s) livre(s). Berços ocupados aparecem desabilitados e não podem ser selecionados.`;
    vincularBercoModal.classList.remove('hidden');
  };

  /**
   * Efetiva a vinculação após revalidar, no Supabase, que o berço continua LIVRE.
   * Retorna true quando a ocupação foi registrada.
   */
  async function aplicarVinculoBerco(navio, nomeBerco) {
    const fresh = await lerBercosAtuais();
    if (!fresh.ok) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Berços Não Confirmados', `Não foi possível confirmar a disponibilidade do berço no banco de dados (${fresh.erro}). Vinculação não realizada.`);
      return false;
    }
    const bercoAlvo = fresh.lista.find(b => b.nome === nomeBerco);
    if (!bercoAlvo) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Opção Inválida', 'Seleção de berço inválida.');
      return false;
    }
    if (bercoAlvo.estado !== 'LIVRE') {
      if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Berço Indisponível', `O ${bercoAlvo.nome} não está mais livre${bercoAlvo.navio_nome ? ` (ocupado por ${bercoAlvo.navio_nome})` : ''}. Escolha outro berço.`);
      return false;
    }

    // 1) Reserva o novo berço no banco (falha se outro operador o ocupou primeiro)
    const reserva = await reservarBercoNoBanco(bercoAlvo, navio);
    if (!reserva.ok) {
      if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Berço Indisponível', reserva.motivo);
      return false;
    }

    // 2) Libera o berço anterior do navio, se houver. Se falhar, desfaz a reserva nova.
    const anteriores = fresh.lista.filter(b => b.nome !== bercoAlvo.nome && b.estado === 'OCUPADO'
      && ((navio.imo && b.navio_imo === navio.imo) || (navio.nome && b.navio_nome === navio.nome)));
    const falhasAnterior = [];
    for (const b of anteriores) {
      const r = await liberarBercoNoBanco(b.nome, { imo: b.navio_imo, nome: b.navio_nome });
      if (r.ok) refletirBercoLocal(b.nome, CAMPOS_BERCO_LIVRE);
      else falhasAnterior.push(b.nome);
    }
    if (falhasAnterior.length > 0) {
      await liberarBercoNoBanco(bercoAlvo.nome, { imo: navio.imo, nome: navio.nome });
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Vinculação Não Realizada', `Não foi possível liberar o berço anterior (${falhasAnterior.join(', ')}) no banco de dados. A vinculação foi desfeita; tente novamente.`);
      renderBercosPanel();
      return false;
    }

    // 3) Atualiza cache e painel a partir do que foi gravado
    refletirBercoLocal(bercoAlvo.nome, reserva.payload);
    renderBercosPanel();
    renderGpsTable();

    if (window.nexusSupabase) {
      try {
        let navioQuery = window.nexusSupabase.from('navios').update({ localizacao: 'DENTRO_DO_PORTO' });
        navioQuery = UUID_NAVIO_RE.test(navio.id) ? navioQuery.eq('id', navio.id) : navioQuery.eq('numero_imo', navio.imo);
        await navioQuery;
      } catch (e) {
        console.warn('[NexusPort] Erro ao salvar vinculação de navio no Supabase:', e);
      }
    }

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EDICAO', 'navios', navio.id || null, `Navio ${navio.nome} vinculado ao ${bercoAlvo.nome}`);
    }
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Navio Vinculado', `Navio ${navio.nome} vinculado com sucesso ao ${bercoAlvo.nome}!`);
    }
    return true;
  }

  if (confirmarVincularBercoBtn) {
    confirmarVincularBercoBtn.addEventListener('click', async () => {
      if (!navioPendenteBerco) return;
      const nome = vincularBercoSelect ? vincularBercoSelect.value : '';
      if (!nome) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Berço Obrigatório', 'Selecione um berço desocupado para vincular o navio.');
        return;
      }
      const navio = navioPendenteBerco;
      const ok = await aplicarVinculoBerco(navio, nome);
      if (ok) fecharVincularBerco();
    });
  }
  if (cancelarVincularBercoBtn) cancelarVincularBercoBtn.addEventListener('click', fecharVincularBerco);
  if (closeVincularBercoBtn) closeVincularBercoBtn.addEventListener('click', fecharVincularBerco);

  // Excluir Navio (Tarefa 6): apaga do banco e da interface; contêineres e
  // cargas vinculados são DESVINCULADOS (não apagados) e ficam livres para
  // nova vinculação com outra embarcação.
  // ---------- Exclusão de registros: banco primeiro; sucesso só após confirmação do banco ----------
  // Conta registros do banco ligados ao registro. Retorna { ok, erro?, contagem }.
  async function contarNoBanco(tabela, coluna, valor) {
    const { data, error } = await window.nexusSupabase.from(tabela).select('id').eq(coluna, valor);
    if (error) return { ok: false, erro: (error && error.message) || 'erro desconhecido' };
    return { ok: true, contagem: (data || []).length };
  }

  // Localiza o id do registro no banco. Retorna { ok, erro?, id } (id null = não existe no banco).
  async function localizarNoBanco(tabela, coluna, valor) {
    const { data, error } = await window.nexusSupabase.from(tabela).select('id').eq(coluna, valor);
    if (error) return { ok: false, erro: (error && error.message) || 'erro desconhecido' };
    return { ok: true, id: (data && data[0] && data[0].id) || null };
  }

  // Histórico de manutenção ligado ao registro seria apagado em cascata (ON DELETE CASCADE).
  // Retorna { ok, erro?, total }.
  async function contarHistoricoManutencao(coluna, idBanco) {
    const a = await contarNoBanco('manutencoes', coluna, idBanco);
    if (!a.ok) return a;
    const b = await contarNoBanco('historico_manutencoes', coluna, idBanco);
    if (!b.ok) return b;
    return { ok: true, total: a.contagem + b.contagem };
  }

  function avisoExclusao(tipo, titulo, mensagem) {
    if (window.mostrarFeedback) window.mostrarFeedback(tipo, titulo, mensagem);
  }

  window.excluirNavio = async function(imo, opcoes) {
    const navio = naviosList.find(n => n.imo === imo);
    if (!navio) return;

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Navio', `Tem certeza que deseja EXCLUIR o navio ${navio.nome} (${navio.imo})? Os berços dele serão liberados e os contêineres vinculados serão desvinculados. O navio sai do banco de dados.`)
      : true;
    if (!confirmou) return;

    if (!window.nexusSupabase) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Sem conexão com o banco de dados: o navio ${navio.nome} não foi excluído. Tente novamente quando a conexão for restabelecida.`);
      return;
    }

    // 1) Localiza o navio no banco (pelo id; ou pelo IMO quando o registro local não tem UUID)
    const usaId = UUID_NAVIO_RE.test(String(navio.id || ''));
    const busca = await localizarNoBanco('navios', usaId ? 'id' : 'numero_imo', usaId ? navio.id : imo);
    if (!busca.ok) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível consultar o navio ${navio.nome} no banco (${busca.erro}). Nada foi excluído.`);
      return;
    }

    let contsDesvinc = 0;
    if (busca.id) {
      // 2) Impede a exclusão se houver histórico de manutenção (seria apagado junto com o navio)
      const hist = await contarHistoricoManutencao('navio_id', busca.id);
      if (!hist.ok) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar o histórico do navio ${navio.nome} (${hist.erro}). Nada foi excluído.`);
        return;
      }
      if (hist.total > 0) {
        avisoExclusao('alerta', 'Exclusão Bloqueada', `O navio ${navio.nome} possui ${hist.total} registro(s) de manutenção/histórico vinculados. Excluí-lo apagaria esse histórico; a exclusão foi cancelada.`);
        return;
      }

      // 3) Contêineres vinculados são desvinculados pelo próprio banco (ON DELETE SET NULL)
      const conts = await contarNoBanco('containers', 'navio_id', busca.id);
      if (!conts.ok) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar os contêineres do navio ${navio.nome} (${conts.erro}). Nada foi excluído.`);
        return;
      }
      contsDesvinc = conts.contagem;

      // 3b) Cargas deste navio que estavam EM_TRANSITO voltam a PRONTA_PARA_ENTREGA NO BANCO
      //     (antes só o cache local era ajustado). Se não for possível gravar, nada é excluído.
      const cargasNoNavio = await window.nexusSupabase.from('cargas').select('id, status_fluxo').eq('navio_id', busca.id);
      if (cargasNoNavio.error) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar as cargas do navio ${navio.nome} (${cargasNoNavio.error.message || 'erro'}). Nada foi excluído.`);
        return;
      }
      const emTransito = (cargasNoNavio.data || []).filter(c => c.status_fluxo === 'EM_TRANSITO').map(c => c.id);
      if (emTransito.length > 0) {
        const { error: errCargas } = await window.nexusSupabase.from('cargas')
          .update({ status_fluxo: 'PRONTA_PARA_ENTREGA' })
          .in('id', emTransito);
        if (errCargas) {
          avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível devolver as cargas do navio ${navio.nome} para pronta entrega (${errCargas.message || 'erro'}). Nada foi excluído.`);
          return;
        }
      }

      // 4) Exclui no banco. Só depois disso a interface é alterada.
      const { error: errDel } = await window.nexusSupabase.from('navios').delete().eq('id', busca.id);
      if (errDel) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `O banco de dados recusou a exclusão do navio ${navio.nome} (${errDel.message}). Nada foi alterado.`);
        return;
      }
    }

    // 5) Libera os berços ocupados pelo navio (banco e cache). Falha aqui não reabre o navio:
    //    o berço ocupado sem navio é liberado automaticamente na próxima carga.
    const resLib = await liberarBercosDoNavio(navio);
    const avisoBercos = resLib.falhas.length > 0
      ? ` Atenção: o(s) berço(s) ${resLib.falhas.map(f => f.berco).join(', ')} não puderam ser liberados agora e serão revisados na próxima carga.`
      : '';

    // 6) Remove da interface e do cache local (somente após a exclusão no banco)
    naviosList = naviosList.filter(n => n.imo !== imo);
    localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

    const nomeNavioLower = String(navio.nome || '').toLowerCase();
    const containersLocais = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    containersLocais.forEach(c => {
      const peloNome = c.navio && String(c.navio).toLowerCase() === nomeNavioLower;
      const peloId = navio.id && (c.navio_id === navio.id || c.navioId === navio.id);
      if (peloNome || peloId) { c.navio = ''; c.navio_id = null; c.navioId = null; c.navio_nome = null; }
    });
    localStorage.setItem('nexus_containers_list', JSON.stringify(containersLocais));
    containersList = containersLocais;

    const cargasLocais = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    cargasLocais.forEach(c => {
      const peloNome = c.navio && String(c.navio).toLowerCase() === nomeNavioLower;
      const peloId = navio.id && (c.navio_id === navio.id || c.navioId === navio.id);
      if (peloNome || peloId) {
        c.navio = ''; c.navio_id = null; c.navioId = null;
        if (c.status === 'EM_TRANSITO') c.status = 'PRONTA_PARA_ENTREGA';
      }
    });
    localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasLocais));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'navios', navio.id || null, `Navio ${navio.nome} (${imo}) excluído do sistema; ${contsDesvinc} contêiner(es) desvinculados`);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('navios');
      window.NexusRepository.notifyChange('containers');
      window.NexusRepository.notifyChange('cargas');
    }

    renderBercosPanel();
    renderGpsTable();
    if (typeof renderContainersTable === 'function') renderContainersTable();

    const mensagemBanco = busca.id
      ? `Navio ${navio.nome} (${imo}) excluído do banco de dados. ${contsDesvinc} contêiner(es) desvinculados.`
      : `Navio ${navio.nome} (${imo}) removido da interface; ele não existia no banco de dados.`;
    avisoExclusao(avisoBercos ? 'alerta' : 'sucesso', avisoBercos ? 'Navio Excluído com Pendência' : 'Navio Excluído', mensagemBanco + avisoBercos);
  };

  // Padronização com hífen durante a digitação (IMO, contêiner e guindaste)
  if (window.NexusCodigos) {
    NexusCodigos.vincularFormatacao(document.getElementById('navioImo'), NexusCodigos.formatarImo);
    NexusCodigos.vincularFormatacao(document.getElementById('contIdentificacao'), NexusCodigos.formatarConteiner);
    NexusCodigos.vincularFormatacao(document.getElementById('gndNumero'), NexusCodigos.formatarGuindaste);
  }

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
      const imoValidacao = NexusCodigos.validarImo(document.getElementById('navioImo').value);
      const imo = imoValidacao.valor;
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

      // Item 11: Validação do padrão do Número IMO (IMO-1234567: prefixo IMO + 7 números)
      if (!imoValidacao.ok) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'IMO Inválido', imoValidacao.erro);
        return;
      }

      // Item 11: Validação de unicidade do IMO
      const imoExistente = naviosList.find(n => NexusCodigos.chave(n.imo) === NexusCodigos.chave(imo));
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
      if (localizacao === 'DENTRO_DO_PORTO') {
        // Revalidação no banco (não no cache local) antes de qualquer gravação.
        const lidoBercos = await lerBercosAtuais();
        if (!lidoBercos.ok) {
          if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Berços Não Confirmados', `Não foi possível confirmar os berços no banco de dados (${lidoBercos.erro}). Navio não cadastrado.`);
          return;
        }
        const livresBanco = lidoBercos.lista.filter(b => b.estado === 'LIVRE');
        if (!bercoEscolhido || !livresBanco.some(b => b.nome === bercoEscolhido)) {
          const msg = livresBanco.length === 0
            ? 'BERÇOS ESGOTADOS: não há berço livre no Terminal STS-01. Libere um berço antes de cadastrar um navio DENTRO_DO_PORTO, ou cadastre-o como FORA_DO_PORTO.'
            : (bercoEscolhido
              ? `O ${bercoEscolhido} não está mais livre. Escolha outro berço na lista atualizada.`
              : 'BERÇO OBRIGATÓRIO: um navio DENTRO_DO_PORTO precisa estar vinculado a um berço imediatamente. Selecione o berço de atracação no formulário.');
          if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Berço Obrigatório', msg);
          await preencherBercoCadastroSelect();
          return;
        }
      }

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

      // Vinculação imediata ao berço (obrigatória para DENTRO_DO_PORTO). Se a reserva falhar,
      // o navio recém-gravado é removido: nenhum navio pode ficar DENTRO_DO_PORTO sem berço.
      let bercoOcupadoMsg = '';
      if (localizacao === 'DENTRO_DO_PORTO' && bercoEscolhido) {
        const resOcupacao = await ocuparBercoComNavio(bercoEscolhido, novoNavio);
        if (!resOcupacao.ok) {
          let desfeito = true;
          if (insertedId && window.nexusSupabase) {
            const { error: errDesfazer } = await window.nexusSupabase.from('navios').delete().eq('id', insertedId);
            if (errDesfazer) desfeito = false;
          }
          if (window.mostrarFeedback) {
            window.mostrarFeedback('alerta', 'Navio Não Cadastrado', desfeito
              ? `${resOcupacao.motivo} O cadastro foi desfeito: um navio DENTRO_DO_PORTO precisa ocupar um berço no mesmo momento.`
              : `${resOcupacao.motivo} Não foi possível desfazer o registro do navio ${nome} no banco; verifique a lista de embarcações e remova-o se necessário.`);
          }
          await preencherBercoCadastroSelect();
          return;
        }
        renderBercosPanel();
        bercoOcupadoMsg = ` Vinculado imediatamente ao ${bercoEscolhido}.`;
        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'navios', novoNavio.id || null, `Navio ${nome} vinculado ao ${bercoEscolhido} no cadastro (DENTRO_DO_PORTO)`);
        }
      }

      naviosList.unshift(novoNavio);
      localStorage.setItem('nexus_navios_list', JSON.stringify(naviosList));

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
          <td colspan="7" class="p-4 text-center text-slate-600 italic">Nenhum contêiner cadastrado no banco de dados.</td>
        </tr>
      `;
      return;
    }

    containersTableBody.innerHTML = containersList.map(c => {
      // C3: Busca cargas vinculadas a este contêiner
      const cargasFluxo = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      const cargasDoCont = cargasFluxo.filter(crg => crg.container && (crg.container.toLowerCase() === c.identificacao.toLowerCase() || crg.container.toLowerCase() === c.id.toLowerCase()));

      let cargasVinculadasHtml = '<span class="text-slate-600 italic text-[11px]">Nenhuma carga</span>';
      if (cargasDoCont.length > 0) {
        cargasVinculadasHtml = cargasDoCont.map(crg => `
          <span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[10px] text-nexus-500 font-bold">${esc(crg.id)} (${esc(crg.volume)})</span>
        `).join(' ');
      }

      const manutDisplay = c.dataManut || 'Sem Manutenção';

      let contAcoesHtml = `
        <div class="flex items-center justify-end gap-1.5 font-mono text-[11px]">
          <button type="button" onclick="window.vincularContainerANavio(${jsArg(c.identificacao)})" class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">link</span><span>Vincular</span></button>
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
          <td class="p-3"><span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-mono text-xs font-bold">${esc(c.estado)}</span></td>
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
    const cont = containersList.find(c => NexusCodigos.chave(c.identificacao) === NexusCodigos.chave(contIdentificacao));
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
    const naviosElegiveis = naviosList.filter(n => (n.localizacao || 'DENTRO_DO_PORTO') === 'DENTRO_DO_PORTO');
    if (naviosElegiveis.length === 0) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Nenhum Navio no Porto', 'Não há embarcações atracadas no Porto de Santos disponíveis para vinculação. Navios em trânsito ou no porto de destino não podem receber contêineres.');
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
        window.mostrarFeedback('alerta', 'Navio Fora do Porto', `A embarcação ${nomePedido} não está atracada no Porto de Santos (situação: ${navioPedido ? localizacaoInfo(navioPedido.localizacao).txt : 'não encontrada'}) e não pode receber contêineres.`);
      }
    } else {
      selecao = await window.nexusPrompt('Vincular Contêiner a Navio', `Selecione um Navio para o contêiner ${cont.identificacao} (apenas embarcações no Porto de Santos):\n${optionsText}`);
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

      cont.navio = navioAlvo.nome;
      cont.navio_id = navioAlvo.id;
      cont.navio_nome = navioAlvo.nome;

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

  // Excluir Contêiner (Tarefa 8)
  window.excluirContainer = async function(contIdentificacao, opcoes) {
    const cont = containersList.find(c => NexusCodigos.chave(c.identificacao) === NexusCodigos.chave(contIdentificacao));
    if (!cont) return;

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Contêiner', `Tem certeza que deseja EXCLUIR o contêiner ${cont.identificacao}? Essa ação o removerá do sistema.`)
      : true;
    if (!confirmou) return;

    if (!window.nexusSupabase) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Sem conexão com o banco de dados: o contêiner ${cont.identificacao} não foi excluído.`);
      return;
    }

    const busca = await localizarNoBanco('containers', 'numero_identificacao', cont.identificacao);
    if (!busca.ok) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível consultar o contêiner ${cont.identificacao} no banco (${busca.erro}). Nada foi excluído.`);
      return;
    }

    let cargasDesvinc = 0;
    if (busca.id) {
      const hist = await contarHistoricoManutencao('container_id', busca.id);
      if (!hist.ok) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar o histórico do contêiner ${cont.identificacao} (${hist.erro}). Nada foi excluído.`);
        return;
      }
      if (hist.total > 0) {
        avisoExclusao('alerta', 'Exclusão Bloqueada', `O contêiner ${cont.identificacao} possui ${hist.total} registro(s) de manutenção/histórico vinculados. Excluí-lo apagaria esse histórico; a exclusão foi cancelada.`);
        return;
      }
      const cargas = await contarNoBanco('cargas', 'container_id', busca.id);
      if (!cargas.ok) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar as cargas do contêiner ${cont.identificacao} (${cargas.erro}). Nada foi excluído.`);
        return;
      }
      cargasDesvinc = cargas.contagem;

      // As cargas NÃO são apagadas: o banco apenas as desvincula (ON DELETE SET NULL)
      const { error: errDel } = await window.nexusSupabase.from('containers').delete().eq('id', busca.id);
      if (errDel) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `O banco de dados recusou a exclusão do contêiner ${cont.identificacao} (${errDel.message}). Nada foi alterado.`);
        return;
      }
    }

    containersList = containersList.filter(c => NexusCodigos.chave(c.identificacao) !== NexusCodigos.chave(contIdentificacao));
    localStorage.setItem('nexus_containers_list', JSON.stringify(containersList));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'containers', cont.id || null, `Contêiner ${cont.identificacao} excluído do sistema; ${cargasDesvinc} carga(s) desvinculadas`);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('containers');
      window.NexusRepository.notifyChange('cargas');
    }

    renderContainersTable();
    avisoExclusao('sucesso', 'Contêiner Excluído', busca.id
      ? `Contêiner ${cont.identificacao} excluído do banco de dados. ${cargasDesvinc} carga(s) permanecem cadastradas, sem contêiner vinculado.`
      : `Contêiner ${cont.identificacao} removido da interface; ele não existia no banco de dados.`);
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
      const contValidacao = NexusCodigos.validarConteiner(document.getElementById('contIdentificacao').value);
      const identificacao = contValidacao.valor;
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
      if (!contValidacao.ok) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Formato Inválido', contValidacao.erro);
        return;
      }

      // Item 13: Validação de unicidade do código de contêiner
      const contExistente = containersList.find(c => NexusCodigos.chave(c.identificacao) === NexusCodigos.chave(identificacao));
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
          <td colspan="4" class="p-4 text-center text-slate-600 italic">Nenhum guindaste cadastrado no banco de dados.</td>
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
  window.excluirGuindaste = async function(gndIdentificacao, opcoes) {
    const guindaste = guindastesList.find(g => NexusCodigos.chave(g.identificacao) === NexusCodigos.chave(gndIdentificacao));
    if (!guindaste) return;

    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm
      ? await window.nexusConfirm('Excluir Guindaste', `Tem certeza que deseja EXCLUIR o guindaste ${guindaste.identificacao}? Esta ação o removerá do sistema.`)
      : true;
    if (!confirmou) return;

    if (!window.nexusSupabase) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Sem conexão com o banco de dados: o guindaste ${guindaste.identificacao} não foi excluído.`);
      return;
    }

    const busca = await localizarNoBanco('guindastes', 'numero_identificacao', guindaste.identificacao);
    if (!busca.ok) {
      avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível consultar o guindaste ${guindaste.identificacao} no banco (${busca.erro}). Nada foi excluído.`);
      return;
    }

    if (busca.id) {
      const hist = await contarHistoricoManutencao('guindaste_id', busca.id);
      if (!hist.ok) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `Não foi possível verificar o histórico do guindaste ${guindaste.identificacao} (${hist.erro}). Nada foi excluído.`);
        return;
      }
      if (hist.total > 0) {
        avisoExclusao('alerta', 'Exclusão Bloqueada', `O guindaste ${guindaste.identificacao} possui ${hist.total} registro(s) de manutenção/histórico vinculados. Excluí-lo apagaria esse histórico; a exclusão foi cancelada.`);
        return;
      }
      const { error: errDel } = await window.nexusSupabase.from('guindastes').delete().eq('id', busca.id);
      if (errDel) {
        avisoExclusao('erro', 'Exclusão Não Realizada', `O banco de dados recusou a exclusão do guindaste ${guindaste.identificacao} (${errDel.message}). Nada foi alterado.`);
        return;
      }
    }

    guindastesList = guindastesList.filter(g => NexusCodigos.chave(g.identificacao) !== NexusCodigos.chave(gndIdentificacao));
    localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastesList));

    // Tarefas locais do guindaste (cache de operação) também são removidas
    let tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    tarefasGnd = tarefasGnd.filter(t => t.guindasteId !== guindaste.identificacao && t.guindasteId !== gndIdentificacao);
    localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasGnd));

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'guindastes', guindaste.id || null, `Guindaste ${guindaste.identificacao} excluído do sistema`);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('guindastes');
    }

    renderGuindastesTable();
    avisoExclusao('sucesso', 'Guindaste Excluído', busca.id
      ? `Guindaste ${gndIdentificacao} excluído do banco de dados.`
      : `Guindaste ${gndIdentificacao} removido da interface; ele não existia no banco de dados.`);
  }

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
        <div class="p-6 text-center text-slate-600 italic">
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
            <span class="font-mono font-bold text-nexus-900 dark:text-white">Carga ${esc(t.cargaId || '?')} <span class="text-slate-600 font-normal">(${esc(t.tipoCarga || 'Geral')})</span></span>
            <span class="px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-mono text-[10px] font-bold uppercase">Pendente</span>
          </div>
          <div class="text-slate-600 dark:text-slate-300 leading-relaxed">
            <span class="font-bold block text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-400">Instruções da tarefa</span>
            ${esc(instrucoes)}
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
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

      const gndValidacao = NexusCodigos.validarGuindaste(document.getElementById('gndNumero').value);
      const identificacao = gndValidacao.valor;
      const dataManut = document.getElementById('gndDataManut').value;
      const estado = document.getElementById('gndEstado').value;

      // Tarefa 8: Validação do padrão 3 letras - 3 números - 3 letras (ex: ABC123DEF)
      if (!gndValidacao.ok) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Formato Inválido', gndValidacao.erro);
        return;
      }

      const gndExistente = guindastesList.find(g => NexusCodigos.chave(g.identificacao) === NexusCodigos.chave(identificacao));
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
