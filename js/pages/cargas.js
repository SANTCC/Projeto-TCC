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
  const safeUrl = window.nexusSafeUrl || (window.NexusSecurity && window.NexusSecurity.safeUrl);

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
  const exigeEtapasPronta = ['ARRUMADOR_CONSERTADOR', 'INSPETOR'].includes(userCargo);

  // Backlog Parte 2 — Tarefa 6: Arrumador e Consertador NÃO cadastra cargas
  // (a atribuição do cargo é marcar "pronta para entrega" — Spec RF 1).
  // A decisão vem da matriz RBAC (ação CADASTRAR_CARGA); sem o NexusAuth
  // carregado, a tela mantém o comportamento atual e não bloqueia.
  const podeCadastrarCarga = !(window.NexusAuth && typeof window.NexusAuth.hasPermission === 'function')
    || window.NexusAuth.hasPermission('CADASTRAR_CARGA');
  // Uso programático (testes/WebMCP): mesma decisão aplicada à tela.
  window.nexusPodeCadastrarCarga = () => podeCadastrarCarga;

  function textoAlocacaoContainer(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Backlog Parte 2 — Tarefa 9: a carga só está "alocada no contêiner" quando
   * a movimentação física até ele foi CONCLUÍDA. A conclusão (Embarcações &
   * GPS → concluirTarefaGuindaste) grava portoDescarga = "Contêiner <id>", que
   * é a evidência durável — o simples vínculo administrativo não basta.
   */
  function cargaAlocadaNoContainer(carga) {
    if (!carga) return false;
    const destino = textoAlocacaoContainer(carga.portoDescarga || carga.porto_descarga);
    if (!destino.startsWith('conteiner ')) return false;
    const alvo = destino.slice('conteiner '.length).trim();
    if (!alvo) return false;
    return [carga.container, carga.container_id, carga.containerId]
      .map(textoAlocacaoContainer)
      .filter(Boolean)
      .includes(alvo);
  }
  // Uso programático (testes/WebMCP): mesma decisão aplicada à tela.
  window.nexusCargaAlocadaNoContainer = cargaAlocadaNoContainer;

  // ARMAZENAGEM comprova a passagem pelo recebimento/inspeção no fluxo.
  // A vinculação não é um status separado: precisa ser conferida explicitamente.
  // A alocação física no contêiner (Tarefa 9) também é requisito: vincular sem
  // movimentar não torna a carga pronta.
  function requisitosProntaConcluidos(carga) {
    return carga.status === 'ARMAZENAGEM' &&
      Boolean(carga.container || carga.container_id) &&
      cargaAlocadaNoContainer(carga) &&
      Boolean(carga.navio || carga.navio_id || carga.navioId) &&
      !carga.movimentacaoPendente &&
      !JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]').some(t => t.cargaId === carga.id) &&
      !['RECUSADA', 'PENDENTE'].includes(carga.resultadoInspecao || carga.resultado_inspecao);
  }

  // Compartilhada com a pré-condição WebMCP; não altera o estado da carga.
  window.nexusEtapasProntaConcluidas = requisitosProntaConcluidos;


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

  function montarOpcaoSessaoHtml(escala) {
    const proprio = funcionarioDaSessao(Array.isArray(escala) ? escala : []);
    const nome = (proprio && proprio.nome) || session.nome || 'Responsável logado';
    const mat = (proprio && proprio.matricula) || session.matricula || '-';
    const val = (proprio && (proprio.id || proprio.matricula || proprio.codigo_individual)) || session.matricula || session.codigo_individual || 'SESSAO_ATUAL';
    return {
      val: String(val),
      html: `<option value="${esc(String(val))}" data-matricula="${esc(mat)}" data-nome="${esc(nome)}" data-cargo="${esc(session.cargo)}">${esc(nome)} — ${esc(session.cargo_nome || session.cargo)} (você)</option>`
    };
  }

  function montarOpEscalaHtml(f) {
    const val = f.id || f.matricula || f.codigo_individual || '';
    return `<option value="${esc(String(val))}" data-matricula="${esc(f.matricula || '')}" data-nome="${esc(f.nome || '')}" data-cargo="${esc(f.cargo || '')}">${esc(f.nome || 'Funcionário')} — ${esc(f.cargo_nome || f.cargo || 'Operacional')} (Mat: ${esc(f.matricula || '-')})</option>`;
  }

  async function preencherSelectEstivadorResponsavel() {
    if (!agEstivadorSel) return;

    if (isGestorRole) {
      // Gestor (ou agente WebMCP): a opção da PRÓPRIA SESSÃO entra
      // sincronicamente como padrão — mesmo com a escala ainda carregando o
      // campo required fica válido (corrige o agendamento sem interação humana).
      const sessaoPadrao = montarOpcaoSessaoHtml(funcionariosEscalaCache || []);
      agEstivadorSel.disabled = false;
      agEstivadorSel.required = true;
      agEstivadorSel.innerHTML = sessaoPadrao.html.replace('<option value=', '<option selected value=');
      agEstivadorSel.value = sessaoPadrao.val;

      // Upgrade: quando a escala resolver, anexa os funcionários ativos.
      const escala = await carregarFuncionariosEscala();
      const escolada = agEstivadorSel.value; // preserva a escolha feita no intervalo
      const sessaoAtual = montarOpcaoSessaoHtml(escala);
      agEstivadorSel.innerHTML = sessaoAtual.html.replace('<option value=', '<option selected value=') +
        escala.map(montarOpEscalaHtml).join('');
      agEstivadorSel.value = escolada && escolada !== '' ? escolada : sessaoAtual.val;
      if (agEstivadorHint) {
        agEstivadorHint.textContent = escala.length > 0
          ? `${escala.length} funcionário(s) em escala disponíveis para assumir a carga.`
          : 'Nenhum funcionário ativo em escala — a carga fica atribuída a você por padrão.';
      }
    } else {
      // Funcionário operacional: auto-seleção e travamento do campo (sincrona).
      const sessoOp = montarOpcaoSessaoHtml(funcionariosEscalaCache || []);
      agEstivadorSel.innerHTML = sessoOp.html.replace('<option value=', '<option selected value=');
      agEstivadorSel.value = sessoOp.val;
      agEstivadorSel.disabled = true;
      agEstivadorSel.required = false;
      // Aproveita para refinar com a escala quando chegar (sem destravar o campo).
      const escala = await carregarFuncionariosEscala();
      const sessoOpRef = montarOpcaoSessaoHtml(escala);
      if (sessoOpRef.val !== sessoOp.val) {
        agEstivadorSel.innerHTML = sessoOpRef.html.replace('<option value=', '<option selected value=');
        agEstivadorSel.value = sessoOpRef.val;
      }
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

  // Tarefa 1 (Backlog Parte 2): `estivador_cargas` é o vínculo de movimentação
  // do cargo ESTIVADOR. O responsável pelo agendamento pode ser de qualquer
  // cargo (fica em agendamentos.agendado_por); só vira linha em
  // estivador_cargas quando o responsável é estivador de fato. Sem isso, um
  // Técnico em Portos designado responsável era gravado "como estivador" e
  // depois não podia ser excluído em Gestão de Pessoas.
  // Aceita o enum do banco ('ESTIVADOR') e o rótulo exibido ('Estivador').
  function ehCargoEstivador(cargo) {
    const normalizado = String(cargo || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    return normalizado === 'ESTIVADOR';
  }
  // Compartilhado para testes/regressão sem depender do formulário.
  window.nexusEhCargoEstivador = ehCargoEstivador;

  // Preenche o select de tipos de carga usando a lista compartilhada NEXUS_TIPOS_CARGA
  const selectTipoCarga = document.getElementById('agTipoCarga');
  const preencherTiposAgendamento = () => window.preencherNexusTiposCargaSelect?.(selectTipoCarga);
  preencherTiposAgendamento();
  window.addEventListener('nexus_tipos_carga_changed', preencherTiposAgendamento);

  function renderBercosPanel() {}

  let currentEntityData = null;

  // Carrega lista de cargas
  let cargasFluxoList = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
  let cargasLoadRevision = 0;
  let cargasRefreshTimer = null;
  const transicoesStatusEmVoo = new Map();
  const CARGA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Tarefa 5 (Backlog Parte 2): entregar não é "apagar o passado". Antes de
  // liberar navio_id/container_id, guardamos nome/identificação em snapshots
  // históricos — é isso que tabelas, gráficos e relatórios passam a exibir.
  function textoHistoricoEntrega(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
  }

  function lerListaLocalCargas(chave) {
    try {
      const valor = JSON.parse(localStorage.getItem(chave) || '[]');
      return Array.isArray(valor) ? valor : [];
    } catch (error) {
      return [];
    }
  }

  function snapshotHistoricoEntrega(carga, navioConhecido) {
    if (!carga) return { navio_nome_historico: '', container_identificacao_historico: '' };
    let navio = textoHistoricoEntrega(carga.navioNomeHistorico)
      || textoHistoricoEntrega(carga.navio_nome_historico)
      || textoHistoricoEntrega(carga.navioHistorico)
      || textoHistoricoEntrega(carga.navio_historico)
      || textoHistoricoEntrega(navioConhecido && navioConhecido.nome)
      || textoHistoricoEntrega(carga.navio);
    if (!navio) {
      const navioId = carga.navioId || carga.navio_id;
      if (navioId) {
        const encontrado = lerListaLocalCargas('nexus_navios_list')
          .find((n) => String(n.id || '') === String(navioId));
        if (encontrado) navio = textoHistoricoEntrega(encontrado.nome);
      }
    }

    let container = textoHistoricoEntrega(carga.containerIdentificacaoHistorico)
      || textoHistoricoEntrega(carga.container_identificacao_historico)
      || textoHistoricoEntrega(carga.containerHistorico)
      || textoHistoricoEntrega(carga.container_historico);
    const referencias = [carga.container, carga.container_id, carga.containerId]
      .map(textoHistoricoEntrega).filter(Boolean);
    if (!container && referencias.length > 0) {
      const containers = lerListaLocalCargas('nexus_containers_list');
      for (const referencia of referencias) {
        const encontrado = containers.find((cont) => [cont.identificacao, cont.numero_identificacao, cont.id, cont.rawDbId]
          .some((valor) => textoHistoricoEntrega(valor).toLowerCase() === referencia.toLowerCase()));
        if (encontrado) {
          container = textoHistoricoEntrega(encontrado.identificacao || encontrado.numero_identificacao);
          if (container) break;
        }
      }
    }
    if (!container) {
      container = referencias.find((referencia) => !CARGA_UUID_RE.test(referencia)
        && referencia !== 'Vinculado' && referencia !== 'Não Vinculado') || '';
    }
    return { navio_nome_historico: navio, container_identificacao_historico: container };
  }

  function finalizarEntregaLocal(carga, navioOuHistorico) {
    if (!carga) return { navio_nome_historico: '', container_identificacao_historico: '' };
    const historico = navioOuHistorico && (
      Object.prototype.hasOwnProperty.call(navioOuHistorico, 'navio_nome_historico')
      || Object.prototype.hasOwnProperty.call(navioOuHistorico, 'container_identificacao_historico'))
      ? {
        navio_nome_historico: textoHistoricoEntrega(navioOuHistorico.navio_nome_historico),
        container_identificacao_historico: textoHistoricoEntrega(navioOuHistorico.container_identificacao_historico)
      }
      : snapshotHistoricoEntrega(carga, navioOuHistorico);
    carga.navioNomeHistorico = historico.navio_nome_historico;
    carga.navio_nome_historico = historico.navio_nome_historico;
    carga.containerIdentificacaoHistorico = historico.container_identificacao_historico;
    carga.container_identificacao_historico = historico.container_identificacao_historico;
    carga.navio = '';
    carga.navioId = null;
    carga.navio_id = null;
    carga.container = '';
    carga.container_id = null;
    if ('containerId' in carga) carga.containerId = null;
    carga.herdarNavioDoContainer = false;
    return historico;
  }
  // Mesmo comportamento da transição automática, para testes/WebMCP.
  window.nexusFinalizarEntregaCarga = finalizarEntregaLocal;

  function obterTransicoesAutomaticas(cargas) {
    let naviosLocais = [];
    try {
      const valor = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      if (Array.isArray(valor)) naviosLocais = valor;
    } catch (error) {
      console.warn('[NexusPort] Cache local de navios inválido ao avaliar status das cargas:', error);
    }

    const naviosPorNome = new Map();
    naviosLocais.forEach((navio) => {
      const nome = String(navio && navio.nome || '').trim().toLowerCase();
      if (nome) naviosPorNome.set(nome, navio);
    });

    const transicoes = [];
    (Array.isArray(cargas) ? cargas : []).forEach((carga) => {
      if (!carga || !carga.navio || ['CANCELADA', 'RECUSADA'].includes(carga.status)) return;
      const navio = naviosPorNome.get(String(carga.navio).trim().toLowerCase());
      if (!navio) return;

      const localizacao = navio.localizacao || navio.estado;
      let statusNovo = null;
      if (localizacao === 'NO_PORTO_DE_DESTINO' && carga.status !== 'ENTREGUE') {
        statusNovo = 'ENTREGUE';
      } else if (localizacao === 'FORA_DO_PORTO' && carga.status === 'PRONTA_PARA_ENTREGA') {
        // Tarefa 2 (Correções): a saída do navio só leva para EM_TRANSITO as cargas
        // PRONTA_PARA_ENTREGA — a mesma regra aplicada pela liberação de saída em
        // Embarcações & GPS e pelo trigger do banco. Status como ARMAZENAGEM não
        // podem pular a etapa de "pronta para entrega" por nenhuma via automática.
        statusNovo = 'EM_TRANSITO';
      }
      if (statusNovo) transicoes.push({ carga, statusAnterior: carga.status, statusNovo, navio });
    });
    return transicoes;
  }

  /** Persiste transições reais uma vez por grupo de status; não dispara um refresh local. */
  async function aplicarStatusAutomaticoCargas(cargas, requestRevision) {
    const transicoes = obterTransicoesAutomaticas(cargas);
    if (transicoes.length === 0) return false;

    const client = window.nexusSupabase || null;
    // O snapshot precisa ser resolvido ANTES de qualquer vínculo ser liberado.
    transicoes.forEach((t) => {
      if (t.statusNovo === 'ENTREGUE') t.historicoEntrega = snapshotHistoricoEntrega(t.carga, t.navio);
    });
    const locais = transicoes.filter((t) => !client || !CARGA_UUID_RE.test(String(t.carga.rawDbId || '')));
    const remotas = transicoes.filter((t) => client && CARGA_UUID_RE.test(String(t.carga.rawDbId || '')));
    const promessasPorChave = new Map();
    const gruposNovos = new Map();

    locais.forEach((t) => {
      t.carga.status = t.statusNovo;
      if (t.statusNovo === 'ENTREGUE') finalizarEntregaLocal(t.carga, t.historicoEntrega);
    });

    remotas.forEach((t) => {
      const id = String(t.carga.rawDbId);
      const chave = JSON.stringify([id, t.statusAnterior, t.statusNovo]);
      const existente = transicoesStatusEmVoo.get(chave);
      if (existente) {
        promessasPorChave.set(chave, existente);
        return;
      }
      // Entregas só agrupam quando o snapshot também é o mesmo: cada carga
      // carrega o seu contêiner histórico, mesmo vindo no mesmo navio.
      const chaveGrupo = t.statusNovo === 'ENTREGUE'
        ? JSON.stringify([t.statusAnterior, t.statusNovo, t.historicoEntrega || {}])
        : JSON.stringify([t.statusAnterior, t.statusNovo]);
      if (!gruposNovos.has(chaveGrupo)) {
        gruposNovos.set(chaveGrupo, {
          statusAnterior: t.statusAnterior,
          statusNovo: t.statusNovo,
          historicoEntrega: t.historicoEntrega || null,
          ids: new Set(),
          chaves: new Set()
        });
      }
      gruposNovos.get(chaveGrupo).ids.add(id);
      gruposNovos.get(chaveGrupo).chaves.add(chave);
    });

    gruposNovos.forEach((grupo) => {
      const ids = Array.from(grupo.ids);
      const tracked = Promise.resolve().then(async () => {
        if (requestRevision !== undefined && requestRevision !== cargasLoadRevision) {
          return { ok: false, obsoleta: true, atualizados: new Set() };
        }
        const updatePayload = { status_fluxo: grupo.statusNovo };
        if (grupo.statusNovo === 'ENTREGUE') {
          updatePayload.navio_id = null;
          updatePayload.container_id = null;
          updatePayload.navio_nome_historico = grupo.historicoEntrega?.navio_nome_historico || null;
          updatePayload.container_identificacao_historico = grupo.historicoEntrega?.container_identificacao_historico || null;
        }
        const { data, error } = await client
          .from('cargas')
          .update(updatePayload)
          .in('id', ids)
          .eq('status_fluxo', grupo.statusAnterior)
          .select('id');
        if (error) throw error;
        const atualizados = new Set((Array.isArray(data) ? data : []).map((linha) => String(linha.id)));
        const faltantes = ids.filter((id) => !atualizados.has(id));
        if (faltantes.length > 0) {
          console.warn(`[NexusPort] ${faltantes.length} carga(s) não tiveram a transição automática aplicada; o status mudou em paralelo ou a política do Supabase não autorizou a atualização.`);
        }
        return { ok: faltantes.length === 0, atualizados, faltantes };
      }).catch((error) => {
        console.warn('[NexusPort] Não foi possível persistir a transição automática de status das cargas:', error);
        return { ok: false, erro: error, atualizados: new Set() };
      }).finally(() => {
        grupo.chaves.forEach((chave) => {
          if (transicoesStatusEmVoo.get(chave) === tracked) transicoesStatusEmVoo.delete(chave);
        });
      });

      grupo.chaves.forEach((chave) => {
        transicoesStatusEmVoo.set(chave, tracked);
        promessasPorChave.set(chave, tracked);
      });
    });

    const promessas = Array.from(new Set(promessasPorChave.values()));
    const resultados = await Promise.all(promessas);
    const resultadoPorPromessa = new Map(promessas.map((promessa, indice) => [promessa, resultados[indice]]));
    let houveGravacaoRemota = false;

    remotas.forEach((t) => {
      const id = String(t.carga.rawDbId);
      const chave = JSON.stringify([id, t.statusAnterior, t.statusNovo]);
      const resultado = resultadoPorPromessa.get(promessasPorChave.get(chave));
      if (resultado && resultado.atualizados && resultado.atualizados.has(id)) {
        t.carga.status = t.statusNovo;
        if (t.statusNovo === 'ENTREGUE') finalizarEntregaLocal(t.carga, t.historicoEntrega);
        houveGravacaoRemota = true;
      }
    });

    // Invalida qualquer leitura iniciada antes da gravação, mesmo se este carregador
    // já ficou obsoleto. Só a revisão atual pode gravar seu snapshot no cache local.
    if (houveGravacaoRemota && window.NexusRepository && typeof window.NexusRepository.invalidarLeiturasCargas === 'function') {
      window.NexusRepository.invalidarLeiturasCargas();
    }

    // Uma falha remota não pode fazer outra aba ler um status rejeitado; uma
    // resposta de carregamento obsoleta também não pode sobrescrever dados novos.
    const revisaoAindaAtual = requestRevision === undefined || requestRevision === cargasLoadRevision;
    if (revisaoAindaAtual && (locais.length > 0 || houveGravacaoRemota)) {
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));
    }

    // Mantém a transição visível nesta tela se o Supabase estiver indisponível,
    // mas sem salvá-la no cache compartilhado nem notificar um novo carregamento.
    remotas.forEach((t) => {
      const id = String(t.carga.rawDbId);
      const chave = JSON.stringify([id, t.statusAnterior, t.statusNovo]);
      const resultado = resultadoPorPromessa.get(promessasPorChave.get(chave));
      if (resultado && resultado.erro && !resultado.obsoleta) {
        t.carga.status = t.statusNovo;
        if (t.statusNovo === 'ENTREGUE') finalizarEntregaLocal(t.carga, t.historicoEntrega);
      }
    });

    return true;
  }

  async function carregarCargasSupabase(revision) {
    const requestRevision = revision === undefined ? ++cargasLoadRevision : revision;
    // Tarefa 3 (Correções): navios frescos do banco antes de ler as cargas — as
    // transições automáticas (entrega/chegada) não podem depender de um cache
    // local obsoleto escrito por outra página.
    await atualizarNaviosCacheDoBanco();
    if (requestRevision !== cargasLoadRevision) return;
    if (window.NexusRepository) {
      try {
        const loadedCargas = await window.NexusRepository.getCargas();
        if (requestRevision !== cargasLoadRevision) return;
        if (Array.isArray(loadedCargas)) cargasFluxoList = loadedCargas;
      } catch (err) {
        if (requestRevision === cargasLoadRevision) {
          console.warn('[NexusPort] Erro ao carregar cargas via repositório:', err);
        }
      }
    }

    if (requestRevision !== cargasLoadRevision) return;
    // Resolve primeiro os navios herdados do contêiner, para as mesmas transições
    // automáticas continuarem válidas também para cargas vinculadas indiretamente.
    sincronizarNaviosHerdados();
    try {
      await aplicarStatusAutomaticoCargas(cargasFluxoList, requestRevision);
    } catch (err) {
      console.warn('[NexusPort] Erro ao sincronizar status automático das cargas:', err);
    }
    if (requestRevision !== cargasLoadRevision) return;
    renderTable();
  }

  function agendarAtualizacaoCargas() {
    const revision = ++cargasLoadRevision;
    if (cargasRefreshTimer !== null) clearTimeout(cargasRefreshTimer);
    cargasRefreshTimer = setTimeout(() => {
      cargasRefreshTimer = null;
      carregarCargasSupabase(revision);
    }, 100);
  }

  window.addEventListener('pagehide', () => {
    cargasLoadRevision += 1;
    if (cargasRefreshTimer !== null) {
      clearTimeout(cargasRefreshTimer);
      cargasRefreshTimer = null;
    }
    if (window.NexusRepository && typeof window.NexusRepository.invalidarLeiturasCargas === 'function') {
      window.NexusRepository.invalidarLeiturasCargas();
    }
  });

  // Tarefa 4 (Backlog Parte 2): limite visual das tabelas de histórico.
  // Cada tabela (Entregues/Canceladas/Recusadas) mostra 4 registros e tem o
  // seu próprio "Mostrar mais/menos" — expandir uma não expande as outras.
  // É só exibição: a lista completa continua intacta em cargasFluxoList.
  const LIMITE_HISTORICO_CARGAS = 4;
  const historicoCargasExpandido = { entregues: false, canceladas: false, recusadas: false };
  const ultimasCargasHistorico = { entregues: [], canceladas: [], recusadas: [] };
  const HISTORICO_CARGAS_UI = {
    entregues: { botao: 'mostrarMaisEntreguesBtn', contador: 'cargasEntreguesContador' },
    canceladas: { botao: 'mostrarMaisCanceladasBtn', contador: 'cargasCanceladasContador' },
    recusadas: { botao: 'mostrarMaisRecusadasBtn', contador: 'cargasRecusadasContador' }
  };

  function atualizarResumoHistoricoCargas(tipo, visiveis, total) {
    const ui = HISTORICO_CARGAS_UI[tipo];
    if (!ui) return;
    const contador = document.getElementById(ui.contador);
    if (contador) contador.textContent = total > 0 ? `Exibindo ${visiveis} de ${total} registros` : '';
    const botao = document.getElementById(ui.botao);
    if (botao) {
      const temMais = total > LIMITE_HISTORICO_CARGAS;
      botao.classList.toggle('hidden', !temMais);
      botao.disabled = !temMais;
      botao.textContent = historicoCargasExpandido[tipo] ? 'Mostrar menos' : 'Mostrar mais';
      botao.setAttribute('aria-expanded', String(!!historicoCargasExpandido[tipo]));
    }
  }

  function cargasVisiveisHistorico(tipo, lista) {
    return historicoCargasExpandido[tipo] ? lista : lista.slice(0, LIMITE_HISTORICO_CARGAS);
  }

  function alternarHistoricoCargas(tipo) {
    if (!(tipo in historicoCargasExpandido)) return;
    historicoCargasExpandido[tipo] = !historicoCargasExpandido[tipo];
    if (tipo === 'entregues') renderCargasEntreguesTable(ultimasCargasHistorico.entregues);
    if (tipo === 'canceladas') renderCargasCanceladasTable(ultimasCargasHistorico.canceladas);
    if (tipo === 'recusadas') renderCargasRecusadasTable(ultimasCargasHistorico.recusadas);
  }
  // Uso programático (testes/WebMCP): mesmo comportamento do botão da tela.
  window.nexusAlternarHistoricoCargas = alternarHistoricoCargas;

  Object.keys(HISTORICO_CARGAS_UI).forEach((tipo) => {
    const botao = document.getElementById(HISTORICO_CARGAS_UI[tipo].botao);
    if (botao) botao.addEventListener('click', () => alternarHistoricoCargas(tipo));
  });

  function navioExibicaoEntregue(carga) {
    return snapshotHistoricoEntrega(carga).navio_nome_historico || textoHistoricoEntrega(carga && carga.navio) || 'Desvinculado';
  }

  function containerExibicaoEntregue(carga) {
    const historico = snapshotHistoricoEntrega(carga).container_identificacao_historico;
    if (historico) return historico;
    const ativo = textoHistoricoEntrega(carga && carga.container);
    // container_id (UUID) é vínculo interno, não identificação para a tabela.
    return ativo && !CARGA_UUID_RE.test(ativo) ? ativo : 'Sem contêiner';
  }

  // Renderização de cargas entregues na Tabela de Cargas Entregues (verde - Tarefa 6)
  function renderCargasEntreguesTable(cargasEntregues = []) {
    const entreguesTableBody = document.getElementById('cargasEntreguesTableBody');
    if (!entreguesTableBody) return;
    const lista = Array.isArray(cargasEntregues) ? cargasEntregues : [];
    ultimasCargasHistorico.entregues = lista;

    if (lista.length === 0) {
      atualizarResumoHistoricoCargas('entregues', 0, 0);
      entreguesTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-600 italic">Nenhuma carga entregue no sistema.</td>
        </tr>
      `;
      return;
    }

    const visiveis = cargasVisiveisHistorico('entregues', lista);
    atualizarResumoHistoricoCargas('entregues', visiveis.length, lista.length);
    entreguesTableBody.innerHTML = visiveis.map(c => `
      <tr class="hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 transition-colors">
        <td class="p-3 font-mono font-bold text-emerald-950 dark:text-emerald-200">${esc(c.id)}</td>
        <td class="p-3 font-bold">${esc(c.tipo || c.natureza || 'Carga Geral')}</td>
        <td class="p-3 font-mono text-xs">${esc(c.destino || c.portoDescarga || 'Porto de Destino')}</td>
        <td class="p-3 font-mono text-xs">${esc(containerExibicaoEntregue(c))} / ${esc(navioExibicaoEntregue(c))}</td>
        <td class="p-3">
          <span class="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100">ENTREGUE</span>
        </td>
      </tr>
    `).join('');
  }

  // Renderização de cargas canceladas na Tabela de Cargas Canceladas (cinza)
  function renderCargasCanceladasTable(cargasCanceladas = []) {
    const canceladasTableBody = document.getElementById('cargasCanceladasTableBody');
    if (!canceladasTableBody) return;
    const lista = Array.isArray(cargasCanceladas) ? cargasCanceladas : [];
    ultimasCargasHistorico.canceladas = lista;

    if (lista.length === 0) {
      atualizarResumoHistoricoCargas('canceladas', 0, 0);
      canceladasTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-600 italic">Nenhuma carga cancelada no sistema.</td>
        </tr>
      `;
      return;
    }

    const visiveis = cargasVisiveisHistorico('canceladas', lista);
    atualizarResumoHistoricoCargas('canceladas', visiveis.length, lista.length);
    canceladasTableBody.innerHTML = visiveis.map(c => `
      <tr class="hover:bg-slate-200/60 dark:hover:bg-slate-700/40 transition-colors">
        <td class="p-3 font-mono font-bold text-slate-600 dark:text-slate-300">${esc(c.id)}</td>
        <td class="p-3 font-bold">${esc(c.tipo || 'Carga Geral')}</td>
        <td class="p-3 font-mono text-xs">${esc(c.portoDescarga || 'Setor Pátio')}</td>
        <td class="p-3 text-slate-700 dark:text-slate-300">${esc(c.motivoCancelamento || c.motivo_recusa || c.motivo || 'Cancelado pelo Supervisor')}</td>
        <td class="p-3">
          <span class="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200">CANCELADA</span>
        </td>
      </tr>
    `).join('');
  }

  // Renderização de cargas recusadas na Tabela de Cargas Recusadas (vermelha)
  function renderCargasRecusadasTable(cargasRecusadas = []) {
    const recusadasTableBody = document.getElementById('cargasRecusadasTableBody');
    if (!recusadasTableBody) return;
    const lista = Array.isArray(cargasRecusadas) ? cargasRecusadas : [];
    ultimasCargasHistorico.recusadas = lista;

    if (lista.length === 0) {
      atualizarResumoHistoricoCargas('recusadas', 0, 0);
      recusadasTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-4 text-center text-slate-600 italic">Nenhuma carga recusada no sistema.</td>
        </tr>
      `;
      return;
    }

    const podeAbrirChecklist = window.NexusAuth?.canAccessPage('inspecao.html') === true;
    const visiveis = cargasVisiveisHistorico('recusadas', lista);
    atualizarResumoHistoricoCargas('recusadas', visiveis.length, lista.length);
    recusadasTableBody.innerHTML = visiveis.map(c => `
      <tr class="hover:bg-red-100/60 dark:hover:bg-red-950/40 transition-colors">
        <td class="p-3 font-mono font-bold text-red-700 dark:text-red-300">${esc(c.id)}</td>
        <td class="p-3 font-bold">${esc(c.tipo || 'Carga Geral')}</td>
        <td class="p-3 font-mono text-xs">${esc(c.portoDescarga || 'Setor Pátio')}</td>
        <td class="p-3 text-slate-700 dark:text-slate-300">${esc(c.motivoRecusa || c.motivo_recusa || c.motivo || 'Recusada na inspeção formal')}</td>
        <td class="p-3">
          <span class="px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase bg-red-600 text-white dark:bg-red-800 dark:text-red-100">RECUSADA</span>
        </td>
        <td class="p-3">
          ${podeAbrirChecklist && c.id ? `<a href="${safeUrl('inspecao.html?carga=' + encodeURIComponent(c.id))}" aria-label="Abrir checklist da carga ${esc(c.id)}" title="Revisar checklist para nova tentativa de aceite" class="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 min-w-[44px] min-h-[40px] rounded-lg bg-nexus-500 hover:bg-nexus-900 text-white font-semibold shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nexus-500"><span class="material-symbols-outlined text-[18px]" aria-hidden="true">fact_check</span><span>Checklist</span></a>` : '<span class="text-slate-500">—</span>'}
        </td>
      </tr>
    `).join('');
  }

  // Herança do navio do contêiner (pós-vinculação): cargas vinculadas com a
  // opção "Herdar o navio do contêiner" — cujo contêiner ainda não tinha navio
  // na época — passam a exibir o navio automaticamente assim que o contêiner
  // for vinculado a alguma embarcação (Embarcações & GPS).
  function contemineresPorIdentificacao() {
    const mapa = new Map();
    try {
      (JSON.parse(localStorage.getItem('nexus_containers_list') || '[]') || []).forEach(cont => {
        const chave = String(cont.identificacao || cont.id || '').trim().toLowerCase();
        if (chave) mapa.set(chave, cont);
      });
    } catch (e) { /* cache indisponível */ }
    return mapa;
  }

  function sincronizarNaviosHerdados() {
    const mapaConts = contemineresPorIdentificacao();
    if (mapaConts.size === 0) return false;
    const naviosLocais = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    let alterado = false;
    cargasFluxoList.forEach(c => {
      // ENTREGUE é terminal: seu navio é histórico e nunca pode ser "herdado"
      // de volta como vínculo ativo a partir do contêiner.
      if (!c || ['CANCELADA', 'RECUSADA', 'ENTREGUE'].includes(c.status)) return;
      // Herdam: cargas marcadas com a opção de herança OU (legado) cargas com
      // contêiner e sem navio vinculado.
      const deveHerdar = c.herdarNavioDoContainer === true || (c.container && !c.navio);
      if (!deveHerdar || !c.container) return;
      const cont = mapaConts.get(String(c.container).trim().toLowerCase());
      if (!cont) return;
      const nomeNavioCont = cont.navio && String(cont.navio).trim() !== '' && cont.navio !== 'Não Vinculado' && cont.navio !== 'Vinculado'
        ? cont.navio
        : null;
      let navioResolvido = nomeNavioCont;
      let navioIdResolvido = cont.navio_id || cont.navioId || c.navioId || c.navio_id || null;
      if (!navioResolvido && navioIdResolvido) {
        const porId = naviosLocais.find(n => String(n.id || '') === String(navioIdResolvido));
        if (porId) navioResolvido = porId.nome;
      }
      if (navioResolvido && (!c.navio || c.navio !== navioResolvido)) {
        c.navio = navioResolvido;
        if (navioIdResolvido) {
          c.navioId = navioIdResolvido;
          c.navio_id = navioIdResolvido;
        }
        alterado = true;
      }
    });
    // O navio herdado é uma projeção de apresentação. Não sobrescrevemos o cache
    // canônico de cargas aqui: outras abas poderiam reler a versão do banco sem a
    // projeção e entrar em um ciclo de storage → reload → projeção.
    return alterado;
  }

  // ETA da carga = ETA do navio vinculado (@ 33 km/h, RN 9). Sem navio ou sem
  // rota cadastrada, não há estimativa — nunca um valor inventado.
  let rotasCacheCargas = null;
  async function carregarRotasCacheCargas() {
    if (Array.isArray(rotasCacheCargas)) return rotasCacheCargas;
    rotasCacheCargas = [];
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('rotas_maritimas').select('*');
        if (!error && Array.isArray(data)) rotasCacheCargas = data;
      } catch (e) { /* mantém vazio */ }
    }
    return rotasCacheCargas;
  }

  function distanciaRotaCargas(origem, destino) {
    const o = String(origem || '').trim().toLowerCase();
    const d = String(destino || '').trim().toLowerCase();
    if (!o || !d || !Array.isArray(rotasCacheCargas)) return null;
    // A rota vale nos dois sentidos: o caminho de volta tem a mesma distância.
    const rota = rotasCacheCargas.find(r => {
      const ro = String(r.origem || '').trim().toLowerCase();
      const rd = String(r.destino || '').trim().toLowerCase();
      return (ro === o && rd === d) || (ro === d && rd === o);
    });
    const km = rota ? parseFloat(rota.distancia_km) : NaN;
    return km > 0 ? km : null;
  }

  // ── Tarefa 3 (Correções): chegada do navio independente da página Embarcações ──
  // A classificação de chegada (ETA zerado → NO_PORTO_DE_DESTINO, ou
  // DENTRO_DO_PORTO quando o destino é o próprio Porto de Santos) rodava apenas
  // no render da página Embarcações & GPS. Sem abrir aquela tela, o navio
  // seguia FORA_DO_PORTO no banco e as cargas ficavam presas em EM_TRANSITO,
  // mesmo com o ETA da página de cargas zerado. Cargas & Pátio agora:
  //   1) atualiza os navios do banco no cache local (fonte de verdade), e
  //   2) confirma as chegadas vencidas com o MESMO compare-and-set de
  //      embarcacoes.js — o trigger fn_propagar_status_navio marca as cargas
  //      EM_TRANSITO como ENTREGUE no banco e as transições automáticas desta
  //      página cobrem as cargas restantes ao carregar.
  const VELOCIDADE_MEDIA_KMH = 33; // RN 9 — mesma premissa do ETA de embarcacoes.js

  function ehPortoSantosCargas(nomePorto) {
    return /santos/i.test(String(nomePorto || ''));
  }

  /**
   * Atualiza o cache nexus_navios_list a partir do banco. Resposta vazia ou
   * erro mantém o cache (degradação graciosa: a página continua funcionando
   * offline, como no restante do sistema).
   */
  async function atualizarNaviosCacheDoBanco() {
    if (!window.nexusSupabase) return;
    try {
      const { data, error } = await window.nexusSupabase.from('navios').select('*');
      if (error || !Array.isArray(data) || data.length === 0) return;
      const navios = data.map(n => ({
        id: n.id,
        nome: n.nome,
        imo: n.numero_imo || n.imo,
        localizacao: n.localizacao || 'DENTRO_DO_PORTO',
        origem: n.porto_origem || 'Porto de Santos',
        destino: n.porto_destino || '',
        // A distância não é gravada no navio: vem da rota marítima cadastrada.
        distancia: null,
        // Nunca inventa horário de saída: sem data persistida, não há ETA.
        dataSaida: n.data_saida || null
      }));
      localStorage.setItem('nexus_navios_list', JSON.stringify(navios));
    } catch (e) {
      console.warn('[NexusPort] Cargas: não foi possível atualizar os navios do banco:', e);
    }
  }

  /**
   * Confirma no banco as chegadas vencidas (ETA zerado), com a mesma regra de
   * embarcacoes.js: compare-and-set FORA_DO_PORTO → NO_PORTO_DE_DESTINO (ou
   * DENTRO_DO_PORTO no retorno a Santos). O estado local/cache só muda após a
   * confirmação remota; falha em um navio não impede os demais.
   */
  async function confirmarChegadasVencidas() {
    if (!window.nexusSupabase) return;
    let navios = [];
    try {
      navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    } catch (e) {
      navios = [];
    }
    if (!Array.isArray(navios)) return;
    const candidatos = navios.filter(n => n && n.localizacao === 'FORA_DO_PORTO'
      && CARGA_UUID_RE.test(String(n.id || '')) // padrão UUID (mesmo formato do id de navio)
      && Number.isFinite(n.dataSaida ? new Date(n.dataSaida).getTime() : NaN));
    if (candidatos.length === 0) return;
    await carregarRotasCacheCargas();
    for (const navio of candidatos) {
      try {
        const saida = new Date(navio.dataSaida).getTime();
        const km = parseFloat(navio.distancia) || distanciaRotaCargas(navio.origem, navio.destino);
        if (!(km > 0)) continue; // sem rota cadastrada não há ETA — nunca um valor padrão
        const msPrevistos = (km / VELOCIDADE_MEDIA_KMH) * 3600 * 1000;
        if (Date.now() - saida < msPrevistos) continue; // ainda em viagem
        const novaLocalizacao = ehPortoSantosCargas(navio.destino) ? 'DENTRO_DO_PORTO' : 'NO_PORTO_DE_DESTINO';
        const { data, error } = await window.nexusSupabase
          .from('navios')
          .update({ localizacao: novaLocalizacao })
          .eq('id', navio.id)
          .eq('localizacao', 'FORA_DO_PORTO')
          .select('id, localizacao, data_saida')
          .maybeSingle();
        if (error) continue;
        // Alguns dublês devolvem lista mesmo com maybeSingle; o Supabase atual
        // devolve o objeto único (mesma normalização de embarcacoes.js).
        const registro = Array.isArray(data) ? data[0] : data;
        if (!registro || registro.localizacao !== novaLocalizacao) continue;
        navio.localizacao = registro.localizacao;
        navio.dataSaida = registro.data_saida || navio.dataSaida;
        localStorage.setItem('nexus_navios_list', JSON.stringify(navios));
      } catch (e) {
        console.warn('[NexusPort] Cargas: falha ao confirmar chegada vencida do navio:', e);
      }
    }
  }

  /** Sincronização completa de chegada usada ao abrir a página (Tarefa 3). */
  async function sincronizarChegadasNavios() {
    await atualizarNaviosCacheDoBanco();
    await confirmarChegadasVencidas();
  }

  function etaCargaTexto(carga, naviosLocais) {
    if (!carga || !carga.navio) return null;
    const navio = (naviosLocais || []).find(n => String(n.nome || '').toLowerCase() === String(carga.navio).toLowerCase());
    if (!navio) return null;
    if (navio.localizacao === 'NO_PORTO_DE_DESTINO') return 'Entregue no destino';
    if (navio.localizacao === 'DENTRO_DO_PORTO') {
      const km = parseFloat(navio.distancia) || distanciaRotaCargas(navio.origem, navio.destino);
      if (!(km > 0)) return 'ETA após liberação do navio';
      const horas = km / 33;
      const d = Math.floor(horas / 24);
      const h = Math.round(horas % 24);
      return `ETA previsto: ${d}d ${h}h após liberação`;
    }
    const km = parseFloat(navio.distancia) || distanciaRotaCargas(navio.origem, navio.destino);
    if (!(km > 0)) return 'ETA indisponível: rota sem distância';
    let saida = Date.now();
    if (navio.dataSaida) {
      const parsed = new Date(navio.dataSaida).getTime();
      if (!isNaN(parsed)) saida = parsed;
    }
    const restante = Math.max(0, (km / 33) * 3600 * 1000 - (Date.now() - saida));
    const d = Math.floor(restante / 86400000);
    const h = Math.floor((restante % 86400000) / 3600000);
    const m = Math.floor((restante % 3600000) / 60000);
    return `ETA: ${d}d ${h}h ${m}m`;
  }

  function renderTable() {
    if (!cargasTableBody) return;

    // A lista é atualizada pelo carregador e pelos handlers de ação; renderizar
    // não a relê do localStorage nem dispara operações de rede.

    // Herança pós-vinculação: contêiner que ganhou navio atualiza as cargas
    sincronizarNaviosHerdados();
    const naviosLocais = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');

    const filterNavioVal = (document.getElementById('filterNavio')?.value || '').trim().toLowerCase();
    const filterContVal = (document.getElementById('filterContainer')?.value || '').trim().toLowerCase();
    const filterTipoVal = (document.getElementById('filterTipo')?.value || '').trim().toLowerCase();
    const filterCodigoVal = (document.getElementById('filterCodigo')?.value || '').trim().toLowerCase();
    const filterStatusVal = (document.getElementById('filterStatus')?.value || '').trim();
    const filterDataInicioVal = (document.getElementById('filterDataInicio')?.value || '').trim();
    const filterDataFimVal = (document.getElementById('filterDataFim')?.value || '').trim();
    const filterBuscaVal = (document.getElementById('filterBusca')?.value || '').trim().toLowerCase();

    // A tabela principal exibe apenas cargas pendentes no fluxo; entregues, canceladas e
    // recusadas ficam nas tabelas próprias (verde, cinza e vermelha - Tarefa 6).
    // Exibe cargas ativas aplicando Visão Própria / Visão Operacional (RF 1.3)
    let cargasAtivas = cargasFluxoList.filter(c => c.status !== 'CANCELADA' && c.status !== 'RECUSADA' && c.status !== 'ENTREGUE');
    if (window.NexusVision && window.NexusVision.filterCargasForUser) {
      cargasAtivas = window.NexusVision.filterCargasForUser(cargasAtivas, session);
    }
    const cargasEntregues = cargasFluxoList.filter(c => c.status === 'ENTREGUE');
    const cargasCanceladas = cargasFluxoList.filter(c => c.status === 'CANCELADA');
    const cargasRecusadas = cargasFluxoList.filter(c => c.status === 'RECUSADA');

    const userItems = cargasAtivas.filter(c => {
      if (filterNavioVal && !(c.navio || '').toLowerCase().includes(filterNavioVal)) return false;
      if (filterContVal && !(c.container || '').toLowerCase().includes(filterContVal)) return false;
      if (filterTipoVal && !(c.tipo || '').toLowerCase().includes(filterTipoVal) && !(c.natureza || '').toLowerCase().includes(filterTipoVal)) return false;
      // Filtro por código da carga (usado pelo Scanner QR Code): compara id e QR
      if (filterCodigoVal) {
        const codigoHay = `${c.id || ''} ${c.qrCode || ''}`.toLowerCase();
        const codigoBusca = filterCodigoVal.replace(/^qr-/i, '');
        const codigoChaveHay = NexusCodigos.chave(codigoHay);
        if (!codigoHay.includes(filterCodigoVal) && !codigoHay.includes(codigoBusca) && !codigoChaveHay.includes(NexusCodigos.chave(filterCodigoVal))) return false;
      }
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

    renderCargasEntreguesTable(cargasEntregues);
    renderCargasCanceladasTable(cargasCanceladas);
    renderCargasRecusadasTable(cargasRecusadas);

    // Contador "Exibindo X de Y" (Backlog 3 - 7b)
    const cargasCounterEl = document.getElementById('cargasCounter');
    if (cargasCounterEl) {
      cargasCounterEl.textContent = `Exibindo ${userItems.length} de ${cargasAtivas.length} carga(s) ativa(s)`;
    }

    if (userItems.length === 0) {
      cargasTableBody.innerHTML = `
        <tr>
          <td colspan="7" class="p-4 text-center text-slate-600 italic">Nenhuma carga encontrada para os filtros aplicados.</td>
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
        if (c.status === 'AGENDAMENTO') {
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Aguardando recebimento físico no Porto de Santos: a carga ainda não pode ser movimentada" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        } else if (cargaEmTransito) {
          // Carga em trânsito não pode ser movimentada pelo sistema
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Carga em trânsito: a movimentação fica bloqueada até a entrega no porto de destino" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        } else if (emergenciaAtiva) {
          actionButtonsHtml += `<button type="button" disabled aria-disabled="true" title="Emergência ativa: operações do pátio bloqueadas temporariamente" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 font-semibold flex items-center gap-1 cursor-not-allowed"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        } else {
          actionButtonsHtml += `<button type="button" title="Movimentar carga no pátio" aria-label="Movimentar carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'MOVIMENTAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">forklift</span><span class="hidden sm:inline">Movimentar</span></button>`;
        }
      }

      if (c.status === 'AGENDAMENTO' && isConferente) {
        actionButtonsHtml += `<button type="button" title="Confirmar recebimento no porto" aria-label="Receber carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'RECEBER')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">download</span><span class="hidden sm:inline">Receber</span></button>`;
      }

      if (c.status === 'RECEBIMENTO_INSPECAO' && (isInspetor || isConferente)) {
        actionButtonsHtml += `<button type="button" title="Abrir inspeção e checklist formal da carga" aria-label="Inspecionar carga" onclick="window.location.href=${jsArg('inspecao.html?carga=' + encodeURIComponent(c.id || ''))}" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-nexus-500 hover:bg-nexus-900 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">fact_check</span><span class="hidden sm:inline">Checklist</span></button>`;
      }

      if (c.status === 'ARMAZENAGEM') {
        if (isArrumador && (!exigeEtapasPronta || requisitosProntaConcluidos(c))) {
          actionButtonsHtml += `<button type="button" title="Marcar carga como pronta para entrega" aria-label="Marcar como pronta" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'PRONTA')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">verified</span><span class="hidden sm:inline">Pronta</span></button>`;
        }
        if (isSupervisor) {
          actionButtonsHtml += `<button type="button" title="Vincular carga a um contêiner" aria-label="Vincular a contêiner" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'VINCULAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">link</span><span class="hidden sm:inline">Vincular</span></button>`;
        }
      }

      // Sem botão "Liberar": a carga vai para EM_TRANSITO automaticamente quando
      // o navio vinculado for liberado para o porto de destino (Embarcações & GPS).
      if (c.status === 'PRONTA_PARA_ENTREGA' && isSupervisor) {
        const navioInfoHtml = c.navio
          ? `aguardando liberação do navio ${esc(c.navio)}`
          : 'sem navio vinculado — use "Vincular"';
        actionButtonsHtml += `<span title="A saída ocorre automaticamente quando o navio vinculado for liberado (${navioInfoHtml})" class="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold text-[11px] flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">schedule</span><span class="hidden sm:inline">Aguarda navio</span></span>`;
      }

      // C10: Botão manual de "Entregar" REMOVIDO — a entrega ocorre automaticamente quando o navio chega ao destino

      if (['AGENDAMENTO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'].includes(c.status) && isSupervisor) {
        actionButtonsHtml += `<button type="button" title="Cancelar carga (Supervisor)" aria-label="Cancelar carga" onclick="window.executarAcaoCarga(${jsArg(c.id)}, 'CANCELAR')" class="px-2.5 py-1.5 min-w-[44px] min-h-[40px] justify-center rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold shadow-sm transition-all flex items-center gap-1"><span class="material-symbols-outlined text-[18px]">block</span><span class="hidden sm:inline">Cancelar</span></button>`;
      }

      if (!actionButtonsHtml) {
        actionButtonsHtml = `<span class="text-slate-600 font-mono italic text-[11px]">Leitura (${esc(session.cargo_nome || userCargo)})</span>`;
      }

      const etaLinha = etaCargaTexto(c, naviosLocais);
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <td class="p-3 font-mono font-bold text-nexus-500 whitespace-nowrap">
            ${esc(c.id)}
            <span class="block text-[10px] text-slate-600 font-normal">${esc(c.qrCode || '')}</span>
          </td>
          <td class="p-3 whitespace-nowrap">${esc(c.tipo)} <span class="block text-[10px] text-slate-600">${esc(c.natureza || '')}</span></td>
          <td class="p-3 font-mono whitespace-nowrap">${esc(c.peso)} / ${esc(c.volume)}</td>
          <td class="p-3 font-bold whitespace-nowrap">${esc(c.portoDescarga)}</td>
          <td class="p-3 text-xs whitespace-nowrap">
            <span class="block font-mono ${c.container ? '' : 'text-slate-600 italic'}">${c.container ? esc(c.container) : 'Contêiner: não vinculado'}</span>
            <span class="block text-[10px] ${c.navio ? 'text-slate-600 dark:text-slate-400' : 'text-slate-600 italic'}">${c.navio ? esc(c.navio) : 'Navio: não vinculado'}</span>
            ${etaLinha ? `<span class="block text-[10px] font-mono text-indigo-600 dark:text-indigo-400" title="Estimativa calculada pelo navio vinculado (@ 33 km/h)">${esc(etaLinha)}</span>` : ''}
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
  const filterCodigo = document.getElementById('filterCodigo');
  if (window.NexusCodigos) NexusCodigos.vincularFormatacao(filterCodigo, NexusCodigos.formatarCarga);
  const filterStatus = document.getElementById('filterStatus');
  const filterDataInicio = document.getElementById('filterDataInicio');
  const filterDataFim = document.getElementById('filterDataFim');
  const limparFiltrosBtn = document.getElementById('limparFiltrosBtn');

  if (filterNavio) filterNavio.value = '';
  if (filterContainer) filterContainer.value = '';
  if (filterTipo) filterTipo.value = '';
  if (filterCodigo) filterCodigo.value = '';
  if (filterStatus) filterStatus.value = '';
  if (filterDataInicio) filterDataInicio.value = '';
  if (filterDataFim) filterDataFim.value = '';

  // Scanner QR Code ("Ir para Tela de Ação do Cargo"): o código escaneado vai
  // para o campo de CÓDIGO da carga — antes caía no campo "Tipo de Carga" e
  // filtrava todas as cargas para fora, inclusive a escaneada.
  if (cargaQueryParam && filterCodigo) {
    filterCodigo.value = cargaQueryParam.replace(/^QR-/i, '');
  }

  const filterBusca = document.getElementById('filterBusca');
  if (filterBusca) filterBusca.value = '';

  [filterNavio, filterContainer, filterTipo, filterCodigo, filterStatus, filterDataInicio, filterDataFim, filterBusca].forEach(el => {
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
      if (filterCodigo) filterCodigo.value = '';
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

  // A data prevista registra a entrega terrestre da carga ao Porto de Santos
  // (SPEC 6.1). Ela é diferente do ETA marítimo, calculado depois pelo navio.
  const agDataPrevistaEl = document.getElementById('agDataPrevista');
  const hojeAgendamento = new Date().toISOString().split('T')[0];
  if (agDataPrevistaEl) agDataPrevistaEl.setAttribute('min', hojeAgendamento);

  // O destino final continua restrito às rotas marítimas cadastradas.
  const agDestinoSel = document.getElementById('agDestino');
  let rotasDestinoCache = null;

  async function carregarRotasDestino() {
    if (Array.isArray(rotasDestinoCache)) return rotasDestinoCache;
    rotasDestinoCache = [];
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('rotas_maritimas').select('*').order('destino', { ascending: true });
        if (!error && Array.isArray(data)) rotasDestinoCache = data;
      } catch (e) { /* mantém vazio */ }
    }
    return rotasDestinoCache;
  }

  async function preencherSelectDestinoRota() {
    if (!agDestinoSel) return;
    const rotas = await carregarRotasDestino();
    if (!rotas || rotas.length === 0) {
      agDestinoSel.innerHTML = '<option value="">Nenhuma rota cadastrada — peça ao Supervisor para registrar em Embarcações & GPS (Gestão de Rotas Marítimas).</option>';
      return;
    }
    const atual = agDestinoSel.value;
    agDestinoSel.innerHTML = '<option value="">Selecione o destino (rota cadastrada)...</option>' +
      rotas.map((r, idx) => {
        const dist = parseFloat(r.distancia_km);
        const trechoKm = dist > 0 ? ` (${dist.toLocaleString('pt-BR')} km)` : '';
        return `<option value="${idx}">${esc(r.origem)} ➔ ${esc(r.destino)}${esc(trechoKm)}</option>`;
      }).join('');
    if (atual) agDestinoSel.value = atual;
  }

  function rotaDestinoSelecionada() {
    if (!agDestinoSel || agDestinoSel.value === '') return null;
    const rotas = Array.isArray(rotasDestinoCache) ? rotasDestinoCache : [];
    return rotas[parseInt(agDestinoSel.value, 10)] || null;
  }

  // A opção padrão da sessão precisa existir mesmo com o formulário oculto
  // (o agente WebMCP abre o formulário sem clicar no botão superior).
  preencherSelectEstivadorResponsavel();
  preencherSelectDestinoRota();
  carregarRotasCacheCargas().then(() => renderTable());

  // Sem permissão de cadastro, o botão nem aparece e o formulário nunca abre
  // (a trava definitiva está no submit, logo abaixo).
  if (!podeCadastrarCarga) {
    if (toggleFormBtn) toggleFormBtn.classList.add('hidden');
    if (agendamentoForm) agendamentoForm.classList.add('hidden');
  }

  if (toggleFormBtn && agendamentoForm) {
    toggleFormBtn.addEventListener('click', () => {
      if (!podeCadastrarCarga) {
        agendamentoForm.classList.add('hidden');
        return;
      }
      agendamentoForm.classList.toggle('hidden');
      if (!agendamentoForm.classList.contains('hidden')) {
        preencherSelectEstivadorResponsavel();
        preencherSelectDestinoRota();
      }
    });
  }

  // Submissão de Agendamento com Trava de Pré-requisito (RF 2 / RN 13 / RF 17.1)
  if (agendamentoForm) {
    agendamentoForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Backlog Parte 2 — Tarefa 6: sem permissão de cadastro, nada é gravado.
      // Vale para o envio humano e para envios programáticos (ex.: WebMCP,
      // que agenda através deste mesmo formulário).
      if (!podeCadastrarCarga) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Negado', `Seu cargo (${session.cargo_nome || userCargo}) não tem permissão para cadastrar cargas.`);
        }
        return;
      }

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
      // O responsável só é persistido como estivador se o cargo for ESTIVADOR;
      // nos demais casos ele fica apenas como agendador (agendamentos).
      const responsavelEhEstivador = ehCargoEstivador(estivadorResp && estivadorResp.cargo);

      const tipo = document.getElementById('agTipoCarga').value;
      const tipoCompartilhado = window.getNexusTipoCarga?.(tipo);
      const pesoVal = parseFloat(document.getElementById('agPeso').value) || 0;
      const volumeVal = parseFloat(document.getElementById('agVolume').value) || 0;
      const valorVal = parseFloat(document.getElementById('agValor').value) || 0;
      const natureza = document.getElementById('agNatureza').value.trim();
      const portoDescarga = document.getElementById('agPortoDescarga').value;
      const dataPrevista = agDataPrevistaEl ? agDataPrevistaEl.value : '';
      const hoje = new Date().toISOString().split('T')[0];
      if (!dataPrevista || dataPrevista < hoje) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Data Prevista Inválida', 'Informe uma data prevista de entrega ao porto igual ou posterior à data de hoje.');
        }
        return;
      }

      const rotaDestino = rotaDestinoSelecionada();
      if (!rotaDestino) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Destino Obrigatório', 'Selecione o destino final entre as rotas marítimas cadastradas no sistema. Se a rota desejada não existir, solicite ao Supervisor o registro em Embarcações & GPS (Gestão de Rotas Marítimas).');
        return;
      }
      const destino = rotaDestino.destino;
      const rotaOrigem = rotaDestino.origem || 'Porto de Santos';

      // Item 16: Validação de valores estritamente positivos em peso, volume e valor declarado
      if (pesoVal <= 0 || volumeVal <= 0 || valorVal <= 0) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Valores Inválidos', 'VALORES INVÁLIDOS (Item 16): Os campos de Peso, Volume e Valor Declarado não aceitam valores negativos ou iguais a zero. Informe apenas valores estritamente maiores que zero!');
        return;
      }

      if (!portoDescarga) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Ponto de Descarga', 'BLOQUEIO: É obrigatório selecionar o Setor do Pátio para descarga!');
        return;
      }

      // Regra 2.9 (Área do pátio / Capacidade máxima): Limite regulamentar de 100 ha (1.000.000 m² / 100 posições ativas)
      const CAPACIDADE_MAXIMA_PATIO_HA = 100;
      const cargasAtivasPatio = cargasFluxoList.filter(c => ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'].includes(c.status));
      if (cargasAtivasPatio.length >= CAPACIDADE_MAXIMA_PATIO_HA) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Capacidade Máxima do Pátio Excedida', `BLOQUEIO DE CAPACIDADE REGULAMENTAR (Regra 2.9): O pátio atingiu o limite operacional máximo de 100 hectares (1.000.000 m² / ${CAPACIDADE_MAXIMA_PATIO_HA} cargas em fluxo ativo)! Não é permitido agendar novas cargas até a liberação de espaço.`);
        }
        return;
      }

      const submitBtn = agendamentoForm.querySelector('button[type="submit"]');
      if (submitBtn && submitBtn.disabled) return;
      if (submitBtn) submitBtn.disabled = true;

      try {
        if (!window.nexusSupabase) {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Sem Conexão', 'O agendamento não pode ser concluído enquanto o banco de dados estiver indisponível. Nenhuma carga foi registrada.');
          }
          return;
        }

        const idNum = Math.floor(100 + Math.random() * 900);
        const newId = `CRG-2026-${idNum}`;
        const newQrCode = `QR-${newId}`;
        const nowIso = new Date().toISOString();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let tipoCargaUuid = (typeof tipoCompartilhado !== 'undefined' && tipoCompartilhado && isUuid.test(tipoCompartilhado.id)) ? tipoCompartilhado.id : null;

        if (!tipoCargaUuid) {
          const { data: dbTipo, error: tipoErr } = await window.nexusSupabase.from('tipos_carga').select('id').eq('nome', tipo).maybeSingle();
          // tipo_carga_id é opcional no schema. Se a consulta auxiliar estiver
          // indisponível, o próprio insert ainda decide se o cadastro é aceito;
          // nunca criamos sucesso local antes dessa confirmação.
          if (tipoErr) {
            console.warn('[NexusPort] Não foi possível resolver o UUID do tipo de carga:', tipoErr);
          } else if (dbTipo && dbTipo.id) {
            tipoCargaUuid = dbTipo.id;
          }
        }

        const insertPayload = {
          natureza: natureza || 'Carga Geral',
          peso: pesoVal,
          volume: volumeVal,
          valor_declarado: valorVal,
          porto_descarga: portoDescarga,
          destino,
          status_fluxo: 'AGENDAMENTO',
          qr_code_url: newQrCode
        };
        if (tipoCargaUuid) insertPayload.tipo_carga_id = tipoCargaUuid;

        // O Supabase é a fonte de verdade: nada entra na lista ou no cache antes
        // de o banco confirmar e devolver o registro persistido.
        const { data: resCarga, error: cargaErr } = await window.nexusSupabase
          .from('cargas')
          .insert(insertPayload)
          .select()
          .maybeSingle();

        if (cargaErr || !resCarga || !resCarga.id) {
          const motivo = cargaErr && cargaErr.message
            ? cargaErr.message
            : 'O banco não confirmou o registro da carga.';
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Carga Não Agendada', `${motivo} Nenhuma carga foi registrada neste dispositivo.`);
          }
          return;
        }

        const novaCarga = {
          id: newId,
          rawDbId: resCarga.id,
          tipo,
          tipo_carga_id: tipoCargaUuid,
          peso: `${pesoVal} t`,
          volume: `${volumeVal} m³`,
          valor: `R$ ${valorVal.toLocaleString('pt-BR')}`,
          natureza,
          portoDescarga,
          destino,
          rotaOrigem,
          rota_id: rotaDestino.id || null,
          status: 'AGENDAMENTO',
          container: '',
          navio: '',
          qrCode: newQrCode,
          data_cadastro: resCarga.created_at || nowIso,
          created_at: resCarga.created_at || nowIso,
          dataPrevista,
          data_prevista_entrega: dataPrevista,
          // Espelha o que será relido do banco: estivador só se for ESTIVADOR;
          // o responsável pelo agendamento fica registrado à parte (agendado_por).
          estivador_id: responsavelEhEstivador && estivadorResp ? estivadorResp.id : null,
          estivadorMatricula: responsavelEhEstivador && estivadorResp ? estivadorResp.matricula : null,
          estivador: responsavelEhEstivador && estivadorResp ? estivadorResp.nome : null,
          agendado_por: estivadorResp ? estivadorResp.id : null,
          responsavelMatricula: estivadorResp ? estivadorResp.matricula : null,
          responsavel: estivadorResp ? estivadorResp.nome : null
        };

        const { error: agendamentoErr } = await window.nexusSupabase.from('agendamentos').insert({
          carga_id: resCarga.id,
          data_prevista_entrega: dataPrevista,
          agendado_por: estivadorResp && isUuid.test(String(estivadorResp.id)) ? estivadorResp.id : null
        });

        if (agendamentoErr) {
          // Enquanto não há uma RPC transacional implantada, desfazemos a carga
          // principal para não confirmar um cadastro sem o agendamento obrigatório.
          const { error: rollbackErr } = await window.nexusSupabase
            .from('cargas')
            .delete()
            .eq('id', resCarga.id);
          const detalheRollback = rollbackErr
            ? ' A carga principal foi criada, mas a reversão automática também falhou; informe o suporte.'
            : ' A criação da carga foi revertida.';
          throw new Error(`Não foi possível registrar o agendamento: ${agendamentoErr.message}.${detalheRollback}`);
        }

        // estivador_cargas só para responsável ESTIVADOR (vínculo de movimentação).
        // Responsável de outro cargo já foi registrado em agendamentos.agendado_por
        // acima — gravá-lo também como "estivador" criava o bloqueio indevido de
        // exclusão em Gestão de Pessoas (Tarefa 1, Backlog Parte 2).
        if (responsavelEhEstivador && estivadorResp && isUuid.test(String(estivadorResp.id)) && isUuid.test(String(resCarga.id))) {
          try {
            const { error: attrErr } = await window.nexusSupabase.from('estivador_cargas').upsert({
              estivador_id: estivadorResp.id,
              carga_id: resCarga.id,
              data_inicio: nowIso
            }, { onConflict: 'estivador_id,carga_id' });
            if (attrErr) console.warn('[NexusPort] Falha ao persistir a atribuição do estivador:', attrErr);
          } catch (attrErr) {
            console.warn('[NexusPort] Falha ao persistir a atribuição do estivador:', attrErr);
          }
        }

        cargasFluxoList.push(novaCarga);
        localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('CRIACAO', 'cargas', resCarga.id, { id: newId, responsavel: estivadorResp ? estivadorResp.nome : null });
        }
        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('cargas');
        }

        renderTable();
        agendamentoForm.reset();
        agendamentoForm.classList.add('hidden');
        window.exibirEtiquetaQr(novaCarga);
      } catch (err) {
        console.error('[NexusPort] Falha ao agendar carga:', err);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Erro ao Agendar', `Não foi possível concluir o agendamento: ${err.message || err}`);
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
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

    // A biblioteca de QR Code é local (vendor/) e só é baixada ao abrir a etiqueta (js/asset-loader.js).
    if (window.NexusAssets) {
      window.NexusAssets.carregar('qrcode').then((disponivel) => {
        if (disponivel && typeof QRCode !== 'undefined') {
          QRCode.toCanvas(qrCanvas, qrPayload, { width: 180, margin: 1 });
        }
      });
    } else if (typeof QRCode !== 'undefined') {
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
  const vincularNavioAviso = document.getElementById('vincularNavioAviso');
  const vincularCargaIdLabel = document.getElementById('vincularCargaIdLabel');
  const vincularCargaVolumeLabel = document.getElementById('vincularCargaVolumeLabel');

  let targetCargaParaVinculacao = null;
  // Estado do modal aberto: todos os navios, os navios aptos (listados no seletor) e os contêineres.
  let naviosModal = [];
  let naviosAptosModal = [];
  let containersModal = [];

  // Backlog 3 (L): só navios atracados no Porto de Santos e operantes recebem carga.
  // Fonte: NexusRepository.getNavios() (Supabase, com cache local); sem Supabase, o cache local.
  async function carregarNaviosParaVinculo() {
    if (window.NexusRepository && typeof window.NexusRepository.getNavios === 'function') {
      try {
        const lista = await window.NexusRepository.getNavios();
        if (Array.isArray(lista)) return lista;
      } catch (e) {
        console.warn('[Cargas] Falha ao carregar navios para vinculação:', e);
      }
    }
    return JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
  }

  /**
   * Motivo pelo qual o navio NÃO pode receber carga; null quando está apto.
   * Apto = DENTRO_DO_PORTO e estado operacional OPERANTE (sem reforma agendada ou em curso).
   * Navio sem estado conhecido no cache é tratado como OPERANTE (default do banco).
   */
  function motivoDestinoIncompativel(carga, navio) {
    if (!navio) return null; // Contêiner ainda sem navio: não há vínculo marítimo a validar.
    const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
    const destinoCarga = String(carga.destino || '').trim();
    const destinoNavio = String(navio.destino || navio.porto_destino || '').trim();
    const a = normalizar(destinoCarga);
    const b = normalizar(destinoNavio);
    if (!a || !b || ['destino', 'destino geral'].includes(a) || ['destino', 'destino geral'].includes(b)) {
      return 'Não foi possível confirmar os destinos da carga e do navio. Complete os cadastros antes de vincular.';
    }
    return a === b ? null : `O destino da carga (${destinoCarga}) diverge do destino do navio ${navio.nome || ''} (${destinoNavio}). Selecione um navio com o mesmo destino.`;
  }
  window.nexusMotivoDestinoIncompativel = motivoDestinoIncompativel;

  function motivoNavioInaptoVinculo(navio) {
    if (!navio || navio._naoEncontrado) return 'não foi encontrado no cadastro de navios';
    const loc = navio.localizacao || 'DENTRO_DO_PORTO';
    if (loc === 'FORA_DO_PORTO') return 'está em trânsito (fora do porto)';
    if (loc === 'NO_PORTO_DE_DESTINO') return 'está no porto de destino (já descarregado)';
    if (loc !== 'DENTRO_DO_PORTO') return 'está com localização desconhecida';
    const estadosOperacionais = ['OPERANTE', 'AGENDADO_PARA_REFORMA', 'EM_REFORMA', 'APROVADO_PARA_REFORMA'];
    const estado = String(navio.estado_operacional || (estadosOperacionais.includes(navio.estado) ? navio.estado : '') || 'OPERANTE').toUpperCase();
    if (estado !== 'OPERANTE') return `não está operante (${estado.replace(/_/g, ' ').toLowerCase()})`;
    return null;
  }

  /** Navio ao qual o contêiner está vinculado (por id ou por nome); null quando não tem navio. */
  function navioDoContainerVinculo(cont, navios) {
    if (!cont || (!cont.navio_id && !cont.navio_nome)) return null;
    if (cont.navio_id) {
      const porId = navios.find(n => String(n.id || '') === String(cont.navio_id));
      if (porId) return porId;
    }
    const nomeBusca = String(cont.navio_nome || '').trim().toUpperCase();
    const porNome = nomeBusca ? navios.find(n => String(n.nome || '').trim().toUpperCase() === nomeBusca) : null;
    return porNome || { nome: cont.navio_nome || '(navio sem nome)', _naoEncontrado: true };
  }

  function mesmoNavioVinculo(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return String(a.id) === String(b.id);
    return String(a.nome || '').trim().toUpperCase() === String(b.nome || '').trim().toUpperCase();
  }

  function obterNavioEscolhidoVinculo() {
    if (!vincularNavioSelect || vincularNavioSelect.value === '') return null;
    return naviosAptosModal[parseInt(vincularNavioSelect.value, 10)] || null;
  }

  /**
   * Estado persistido de um contêiner (Supabase, fonte de verdade). Sem Supabase configurado,
   * usa o estado local. Retorna { ok, estado, erro }; ok=false = não foi possível confirmar.
   */
  async function estadoContainerNoBanco(cont) {
    const client = window.nexusSupabase;
    const idLocal = String((cont && cont.identificacao) || '').toUpperCase();
    if (!client) return { ok: true, estado: cont && cont.estado ? cont.estado : null };
    try {
      const { data, error } = await client.from('containers').select('*');
      if (error || !Array.isArray(data)) {
        return { ok: false, erro: error ? error.message : 'resposta inválida' };
      }
      const linha = data.find(c => String(c.numero_identificacao || '').toUpperCase() === idLocal);
      if (!linha) return { ok: true, estado: cont && cont.estado ? cont.estado : null };
      return { ok: true, estado: linha.estado || 'OPERANTE', registro: linha };
    } catch (e) {
      return { ok: false, erro: e && e.message ? e.message : String(e) };
    }
  }
  window.nexusEstadoContainerNoBanco = estadoContainerNoBanco;

  function uuidContainerVinculo(cont) {
    return cont.rawDbId || cont.id || cont.identificacao;
  }

  // Opções de contêiner conforme o navio escolhido: contêiner de navio inapto (ou de outro
  // navio que não o escolhido) fica indisponível, com o motivo; a capacidade é recalculada.
  function renderOpcoesContainerVinculo() {
    if (!vincularContainerSelect) return;
    const navioEscolhido = obterNavioEscolhidoVinculo();
    vincularContainerSelect.innerHTML = '<option value="">Selecione o Contêiner...</option>';
    containersModal.forEach(cont => {
      // Contêiner em manutenção/reforma (estado persistido diferente de OPERANTE) não é opção.
      if (cont.estado && cont.estado !== 'OPERANTE') return;
      if (!window.nexusTiposCargaCompativeis?.(targetCargaParaVinculacao, cont)) return;
      // Tarefa 5: volume já ocupado em cada contêiner, com limite de 75 m³
      const volCargasNoCont = cargasFluxoList
        .filter(c => !['CANCELADA', 'RECUSADA', 'ENTREGUE'].includes(c.status) && (
          (c.container && (c.container === cont.identificacao || c.container === cont.id)) ||
          (c.container_id && (c.container_id === cont.id || c.container_id === cont.rawDbId))
        ))
        .reduce((sum, c) => {
          const v = typeof c.volume === 'number' ? c.volume : parseFloat(String(c.volume || '').replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;
          return sum + v;
        }, 0);

      const dispVol = Math.max(0, 75 - volCargasNoCont);
      const navioDoCont = navioDoContainerVinculo(cont, naviosModal);
      let statusText = '';
      if (cont.estado !== 'OPERANTE') {
        statusText = ` [INDISPONÍVEL: ${cont.estado}]`;
      } else if (navioDoCont && motivoNavioInaptoVinculo(navioDoCont)) {
        statusText = ` [Navio ${navioDoCont.nome || ''} ${motivoNavioInaptoVinculo(navioDoCont)}]`;
      } else if (navioEscolhido && navioDoCont && !mesmoNavioVinculo(navioEscolhido, navioDoCont)) {
        statusText = ` [Vinculado ao navio ${navioDoCont.nome || ''}]`;
      }
      const indisponivel = dispVol <= 0 || statusText !== '';
      // Contêineres só locais não têm id: a identificação serve de valor (a confirmação resolve o id no Supabase).
      vincularContainerSelect.innerHTML += `
        <option value="${esc(uuidContainerVinculo(cont))}" data-identificacao="${esc(cont.identificacao)}" data-disp="${esc(dispVol)}" data-estado="${esc(cont.estado)}" ${indisponivel ? 'disabled' : ''}>
          ${esc(cont.identificacao)} (${esc(cont.tipo)}) - Disp: ${esc(dispVol.toFixed(1))} m³ / 75.0 m³${esc(statusText)}
        </option>
      `;
    });
  }

  if (vincularNavioSelect) {
    vincularNavioSelect.addEventListener('change', renderOpcoesContainerVinculo);
  }

  window.abrirModalVinculacao = async function(idCarga) {
    if (userCargo === 'ESTIVADOR') return;
    targetCargaParaVinculacao = cargasFluxoList.find(c => c.id === idCarga);
    if (!targetCargaParaVinculacao || !vincularModal) return;

    if (vincularCargaIdLabel) vincularCargaIdLabel.textContent = targetCargaParaVinculacao.id;
    if (vincularCargaVolumeLabel) vincularCargaVolumeLabel.textContent = targetCargaParaVinculacao.volume;

    // Backlog 3 (L): o seletor lista somente navios atracados no Porto de Santos e operantes
    naviosModal = await carregarNaviosParaVinculo();
    naviosAptosModal = naviosModal.filter(n => !motivoNavioInaptoVinculo(n));
    if (vincularNavioSelect) {
      vincularNavioSelect.innerHTML = '<option value="">Herdar o navio do contêiner</option>' +
        naviosAptosModal.map((n, idx) => `<option value="${idx}">${esc(n.nome || 'Sem nome')} (IMO ${esc(n.imo || n.numero_imo || '—')})</option>`).join('');
    }
    if (vincularNavioAviso) {
      vincularNavioAviso.textContent = 'Nenhum navio atracado no Porto de Santos e operante está disponível. Cargas só podem ser vinculadas a navios nessa condição.';
      vincularNavioAviso.classList.toggle('hidden', naviosAptosModal.length > 0);
    }

    // Buscar Contêineres do Supabase / Local
    let containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    if (window.nexusSupabase) {
      try {
        const { data } = await window.nexusSupabase.from('containers').select('*');
        if (data && data.length > 0) {
          const mapConts = data.map(c => ({
            id: c.id || `CONT-${c.numero_identificacao}`,
            identificacao: c.numero_identificacao,
            tipo: c.material_carregado || '',
            tipo_carga_id: c.tipo_carga_id || null,
            estado: c.estado || 'OPERANTE',
            navio_id: c.navio_id || null
          }));
          const idSet = new Set(mapConts.map(x => x.identificacao));
          containers.forEach(item => { if (!idSet.has(item.identificacao)) mapConts.push(item); });
          containers = mapConts;
        }
      } catch (e) { console.warn('Erro ao carregar contêineres para modal:', e); }
    }

    containersModal = containers.map(cont => Object.assign({}, cont, {
      navio_id: cont.navio_id || cont.navioId || null,
      navio_nome: cont.navio_nome || cont.navio || null
    }));
    renderOpcoesContainerVinculo();

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

      // Contêiner marcado como indisponível no seletor (navio inapto, outro navio ou capacidade)
      if (selectedContOpt && selectedContOpt.disabled) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Contêiner Indisponível', `O contêiner ${contIdentificacao} não pode ser vinculado a esta carga no momento. Veja o motivo indicado na lista de contêineres.`);
        }
        return;
      }

      // Estado do contêiner relido no banco (o modal pode estar desatualizado).
      const estadoLido = await estadoContainerNoBanco({
        identificacao: contIdentificacao,
        estado: selectedContOpt ? selectedContOpt.getAttribute('data-estado') : null
      });
      if (!estadoLido.ok) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Estado Não Confirmado', `Não foi possível confirmar o estado do contêiner ${contIdentificacao} no banco de dados (${estadoLido.erro}). Vinculação não realizada.`);
        }
        return;
      }
      if (estadoLido.estado && estadoLido.estado !== 'OPERANTE') {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Contêiner Indisponível', `BLOQUEIO DE SEGURANÇA: o contêiner ${contIdentificacao} está em ${estadoLido.estado} e não pode ser vinculado!`);
        }
        renderOpcoesContainerVinculo();
        return;
      }

      // Backlog 3 (L): o navio da carga é o escolhido no seletor (somente aptos) ou, na falta de
      // escolha, o navio do contêiner. Ambos são conferidos de novo, com dados frescos do cadastro.
      const naviosAtuais = await carregarNaviosParaVinculo();
      const navioEscolhido = obterNavioEscolhidoVinculo();
      const navioEscolhidoAtual = navioEscolhido
        ? (naviosAtuais.find(n => mesmoNavioVinculo(n, navioEscolhido)) || { nome: navioEscolhido.nome, _naoEncontrado: true })
        : null;
      const contModal = containersModal.find(c => uuidContainerVinculo(c) === contUuid) || null;
      const contAtual = estadoLido.registro
        ? Object.assign({}, contModal, { navio_id: estadoLido.registro.navio_id || null, navio_nome: null })
        : contModal;
      const navioDoContAtual = contAtual ? navioDoContainerVinculo(contAtual, naviosAtuais) : null;
      const contTipoAtual = estadoLido.registro || contModal;
      const cargaAtual = cargasFluxoList.find(c => c.id === targetCargaParaVinculacao.id);
      if (!window.nexusTiposCargaCompativeis?.(cargaAtual, contTipoAtual)) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Tipos de Carga Incompatíveis', 'A carga só pode ser vinculada a um contêiner do mesmo tipo. Atualize ou corrija os cadastros antes de vincular.');
        return;
      }

      if (navioEscolhidoAtual && navioDoContAtual && !mesmoNavioVinculo(navioEscolhidoAtual, navioDoContAtual)) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Vinculação Bloqueada', `O contêiner ${contIdentificacao} já está vinculado ao navio ${navioDoContAtual.nome}. Escolha esse navio ou um contêiner sem navio.`);
        }
        return;
      }

      const navioFinal = navioEscolhidoAtual || navioDoContAtual;
      if (navioFinal) {
        const motivoBloqueio = motivoNavioInaptoVinculo(navioFinal);
        if (motivoBloqueio) {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('alerta', 'Vinculação Bloqueada', `BLOQUEIO DE REGRA DE NEGÓCIO: O navio ${navioFinal.nome || ''} ${motivoBloqueio}. Cargas só podem ser vinculadas a embarcações atracadas no Porto de Santos e operantes.`);
          }
          return;
        }
      }
      // A carga pode ter sido atualizada enquanto o modal estava aberto.
      targetCargaParaVinculacao = cargasFluxoList.find(c => c.id === targetCargaParaVinculacao.id);
      if (!targetCargaParaVinculacao) return;
      if (!window.nexusTiposCargaCompativeis?.(targetCargaParaVinculacao, contTipoAtual)) return;
      const divergenciaDestino = motivoDestinoIncompativel(targetCargaParaVinculacao, navioFinal);
      if (divergenciaDestino) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Destinos Incompatíveis', divergenciaDestino);
        return;
      }
      const navVal = navioFinal ? (navioFinal.nome || '') : '';
      const navUuid = navioFinal && !navioFinal._naoEncontrado ? (navioFinal.id || null) : null;

      const cargaVol = parseFloat(targetCargaParaVinculacao.volume) || 0;
      const dispVol = parseFloat(selectedContOpt.getAttribute('data-disp')) || 0;
      if (cargaVol > dispVol) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Capacidade Excedida', `A7 REGRA DE CAPACIDADE: Volume da carga (${cargaVol} m³) excede a capacidade disponível do contêiner (${dispVol.toFixed(1)} m³ de no máximo 75 m³)!`);
        return;
      }

      targetCargaParaVinculacao.container = contIdentificacao;
      targetCargaParaVinculacao.container_id = contUuid;
      targetCargaParaVinculacao.navio = navVal;
      targetCargaParaVinculacao.navioId = navUuid;
      targetCargaParaVinculacao.navio_id = navUuid;
      // Opção "Herdar o navio do contêiner": se o contêiner ainda não tem
      // navio, a carga passa a exibi-lo automaticamente quando ele for
      // vinculado (sincronizarNaviosHerdados). Escolha explícita não herda.
      targetCargaParaVinculacao.herdarNavioDoContainer = !vincularNavioSelect || vincularNavioSelect.value === '';

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
        const msgVinculo = navVal
          ? `Carga ${targetCargaParaVinculacao.id} vinculada ao Contêiner ${contIdentificacao} e Navio ${navVal} com sucesso!`
          : `Carga ${targetCargaParaVinculacao.id} vinculada ao Contêiner ${contIdentificacao}. O contêiner ainda não tem navio: assim que ele for vinculado a uma embarcação, a carga herdará o navio automaticamente.`;
        window.mostrarFeedback('sucesso', 'Vinculação Concluída', msgVinculo);
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

      // O jsPDF é local (vendor/) e só é baixado na primeira impressão de etiqueta.
      const temPdf = window.NexusAssets
        ? await window.NexusAssets.carregar('jspdf')
        : !!(window.jspdf && window.jspdf.jsPDF);
      if (temPdf && window.jspdf && window.jspdf.jsPDF) {
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

  // Movimentação entre setores do pátio: cria a tarefa pendente do guindaste
  // (visível em Embarcações & GPS). O Setor do Pátio da carga só é alterado
  // quando a tarefa for marcada como concluída por lá.
  const SETORES_PATIO = [
    'Pátio Principal (Setor A)',
    'Pátio STS-01 (Setor B)',
    'Pátio STS-01 (Setor C)',
    'Pátio STS-01 (Setor Refrigeração)'
  ];

  function guindastesDisponiveis() {
    let guindastes = JSON.parse(localStorage.getItem('nexus_guindastes_list') || '[]');
    if (!Array.isArray(guindastes) || guindastes.length === 0) {
      guindastes = [
        { id: 'GND-01-STS', identificacao: 'GND-01-STS', estado: 'OPERANTE' },
        { id: 'GND-02-STS', identificacao: 'GND-02-STS', estado: 'OPERANTE' }
      ];
      localStorage.setItem('nexus_guindastes_list', JSON.stringify(guindastes));
    }
    return guindastes;
  }

  window.nexusObterGuindastesAtuais = function () { return obterGuindastesAtuais(); };

  /** Guindaste só pode receber tarefas quando estiver OPERANTE (estado persistido). */
  function guindasteOperante(gnd) {
    return !!gnd && (!gnd.estado || gnd.estado === 'OPERANTE');
  }

  /**
   * Lê o estado REAL dos guindastes na tabela `guindastes` do Supabase (fonte de verdade)
   * e espelha o resultado no cache local. Guindastes existentes só no cache (sem registro
   * no banco) são mantidos com o estado local. Sem Supabase configurado, usa o cache.
   * Retorna { ok, lista, origem, erro }; ok=false significa que não foi possível confirmar.
   */
  async function obterGuindastesAtuais() {
    const cache = guindastesDisponiveis();
    const client = window.nexusSupabase;
    if (!client) return { ok: true, lista: cache, origem: 'local' };
    try {
      const { data, error } = await client.from('guindastes').select('*');
      if (error || !Array.isArray(data)) {
        return { ok: false, lista: cache, origem: 'local', erro: error ? error.message : 'resposta inválida' };
      }
      const doBanco = data.map(g => {
        const id = g.numero_identificacao || g.id;
        const antigo = cache.find(c => String(c.identificacao || '').toUpperCase() === String(id).toUpperCase()) || {};
        return Object.assign({}, antigo, { id, identificacao: id, estado: g.estado || 'OPERANTE', dataManut: g.data_ultima_manutencao || antigo.dataManut || '' });
      });
      const idsBanco = new Set(doBanco.map(g => String(g.identificacao).toUpperCase()));
      const somenteLocais = cache.filter(g => !idsBanco.has(String(g.identificacao || '').toUpperCase()));
      const lista = doBanco.concat(somenteLocais);
      localStorage.setItem('nexus_guindastes_list', JSON.stringify(lista));
      return { ok: true, lista, origem: 'banco' };
    } catch (e) {
      return { ok: false, lista: cache, origem: 'local', erro: e && e.message ? e.message : String(e) };
    }
  }

  function montarInstrucaoMovimentacao(carga, setorDestino, guindasteIdent) {
    return `Movimentar a carga ${carga.id} (${carga.tipo || 'Carga Geral'} — ${carga.peso || '?'} / ${carga.volume || '?'}) ` +
      `do setor "${carga.portoDescarga || 'atual'}" para o setor "${setorDestino}", utilizando o guindaste ${guindasteIdent}. ` +
      `Após posicionar a carga no setor de destino, marcar esta tarefa como concluída para atualizar o Setor do Pátio da carga.`;
  }

  function validarRecebimentoParaMovimentacao(carga) {
    if (!carga) return false;
    if (carga.status !== 'AGENDAMENTO') return true;
    if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Aguardando Recebimento', 'A carga ainda está em agendamento. Registre o recebimento físico no Porto de Santos antes de movimentá-la.');
    return false;
  }

  async function criarTarefaMovimentacao(carga, setorDestino, guindasteIdent) {
    carga = cargasFluxoList.find(c => c.id === carga.id);
    if (!validarRecebimentoParaMovimentacao(carga)) return false;
    // Validação no momento da confirmação, com o estado persistido (não o cache da tela).
    const atual = await obterGuindastesAtuais();
    if (!atual.ok) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Disponibilidade Não Confirmada', `Não foi possível confirmar o estado do guindaste no banco de dados (${atual.erro || 'sem conexão'}). A tarefa não foi criada; tente novamente.`);
      return false;
    }
    const gnd = atual.lista.find(g => String(g.identificacao || '').toUpperCase() === String(guindasteIdent || '').toUpperCase());
    if (!gnd) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Guindaste Inválido', `Guindaste "${guindasteIdent}" não encontrado no cadastro.`);
      return false;
    }
    if (!guindasteOperante(gnd)) {
      if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Guindaste Indisponível', `O guindaste ${gnd.identificacao} está em "${gnd.estado}" e não pode executar a tarefa. Escolha um guindaste OPERANTE.`);
      return false;
    }
    const isDestinoContainer = setorDestino.startsWith('Contêiner') || setorDestino.startsWith('Conteiner');
    if (!SETORES_PATIO.includes(setorDestino) && !isDestinoContainer) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Setor Inválido', 'Selecione um setor de destino válido do pátio ou o contêiner vinculado.');
      return false;
    }
    if (setorDestino === carga.portoDescarga) {
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Mesmo Setor', `A carga ${carga.id} já está no setor "${setorDestino}". Escolha um setor de destino diferente.`);
      return false;
    }

    // A leitura assíncrona do guindaste pode coincidir com atualização das cargas.
    carga = cargasFluxoList.find(c => c.id === carga.id);
    if (!validarRecebimentoParaMovimentacao(carga)) return false;

    const instrucoes = montarInstrucaoMovimentacao(carga, setorDestino, gnd.identificacao);
    const tarefasGnd = JSON.parse(localStorage.getItem('nexus_guindaste_tarefas') || '[]');
    const tarefasFiltradas = tarefasGnd.filter(t => t.cargaId !== carga.id);
    const novaTarefa = {
      id: `TRF-${carga.id}-${Date.now()}`,
      guindasteId: gnd.identificacao,
      cargaId: carga.id,
      tipoCarga: carga.tipo || 'Carga Geral',
      origem: carga.portoDescarga || 'Setor atual',
      destino: setorDestino,
      instrucoes,
      status: 'PENDENTE',
      dataCriacao: new Date().toLocaleString('pt-BR'),
      solicitadoPor: session.nome || session.matricula || 'Estivador'
    };
    tarefasFiltradas.push(novaTarefa);
    localStorage.setItem('nexus_guindaste_tarefas', JSON.stringify(tarefasFiltradas));

    carga.guindasteDesignado = gnd.identificacao;
    carga.movimentacaoPendente = setorDestino;

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao(carga.id, 'EDICAO', `Tarefa de movimentação criada: ${carga.portoDescarga} ➔ ${setorDestino} via Guindaste ${gnd.identificacao} (aguardando conclusão)`);
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('guindaste_tarefas');
    }
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Tarefa de Movimentação Criada', `Carga ${carga.id}: movimentação de "${carga.portoDescarga}" para "${setorDestino}" atribuída ao guindaste ${gnd.identificacao}. A tarefa está pendente em Embarcações & GPS — o setor só muda após a conclusão por lá.`);
    }
    return true;
  }

  // Modal de movimentação (setor de destino + guindaste + instruções)
  const movimentarModal = document.getElementById('movimentarModal');
  const closeMovimentarModalBtn = document.getElementById('closeMovimentarModalBtn');
  const cancelMovimentarModalBtn = document.getElementById('cancelMovimentarModalBtn');
  const confirmMovimentarModalBtn = document.getElementById('confirmMovimentarModalBtn');
  const movimentarSetorSelect = document.getElementById('movimentarSetorSelect');
  const movimentarGuindasteSelect = document.getElementById('movimentarGuindasteSelect');
  const movimentarCargaIdLabel = document.getElementById('movimentarCargaIdLabel');
  const movimentarSetorAtualLabel = document.getElementById('movimentarSetorAtualLabel');
  const movimentarInstrucaoBox = document.getElementById('movimentarInstrucaoBox');
  const movimentarInstrucaoText = document.getElementById('movimentarInstrucaoText');
  let targetCargaMovimentacao = null;

  // Mantém o cache local de guindastes alinhado ao estado persistido ao abrir a tela.
  obterGuindastesAtuais();

  function fecharMovimentarModal() {
    if (movimentarModal) movimentarModal.classList.add('hidden');
    targetCargaMovimentacao = null;
  }

  function atualizarInstrucaoMovimentacao() {
    if (!targetCargaMovimentacao || !movimentarSetorSelect || !movimentarGuindasteSelect) return;
    const setor = movimentarSetorSelect.value;
    const gnd = movimentarGuindasteSelect.value;
    if (setor && gnd && movimentarInstrucaoBox && movimentarInstrucaoText) {
      movimentarInstrucaoText.textContent = montarInstrucaoMovimentacao(targetCargaMovimentacao, setor, gnd);
      movimentarInstrucaoBox.classList.remove('hidden');
    } else if (movimentarInstrucaoBox) {
      movimentarInstrucaoBox.classList.add('hidden');
    }
  }

  window.abrirModalMovimentacao = function(idCarga) {
    targetCargaMovimentacao = cargasFluxoList.find(c => c.id === idCarga);
    if (!targetCargaMovimentacao || !movimentarModal) return;
    if (!validarRecebimentoParaMovimentacao(targetCargaMovimentacao)) {
      targetCargaMovimentacao = null;
      return;
    }
    if (movimentarCargaIdLabel) movimentarCargaIdLabel.textContent = targetCargaMovimentacao.id;
    if (movimentarSetorAtualLabel) movimentarSetorAtualLabel.textContent = targetCargaMovimentacao.portoDescarga || '—';

    if (movimentarSetorSelect) {
      let htmlOptions = '<option value="">Selecione o setor de destino...</option>' +
        SETORES_PATIO.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

      // Tarefa 11: A opção de movimentar a carga para o contêiner vinculado só aparece se a carga estiver vinculada a um contêiner
      const contVinculado = targetCargaMovimentacao.container || targetCargaMovimentacao.container_id;
      if (contVinculado) {
        const destCont = `Contêiner ${contVinculado}`;
        htmlOptions += `<option value="${esc(destCont)}">📦 ${esc(destCont)} (Embarque em Contêiner Vinculado)</option>`;
      }

      movimentarSetorSelect.innerHTML = htmlOptions;
      movimentarSetorSelect.value = '';
    }

    if (movimentarInstrucaoBox) movimentarInstrucaoBox.classList.add('hidden');
    movimentarModal.classList.remove('hidden');
    renderSelectGuindastesMovimentacao();
  };

  /**
   * Preenche o seletor de guindastes apenas com equipamentos OPERANTES (estado do Supabase).
   * Guindastes em manutenção não aparecem como opção; são listados em um aviso informativo.
   */
  async function renderSelectGuindastesMovimentacao() {
    if (!movimentarGuindasteSelect) return;
    const atual = await obterGuindastesAtuais();
    const operantes = atual.lista.filter(guindasteOperante);
    const indisponiveis = atual.lista.filter(g => !guindasteOperante(g));
    movimentarGuindasteSelect.innerHTML = '<option value="">' +
      (operantes.length ? 'Selecione o guindaste...' : 'Nenhum guindaste operante disponível') + '</option>' +
      operantes.map(g => `<option value="${esc(g.identificacao)}">${esc(g.identificacao)} (OPERANTE)</option>`).join('');
    const aviso = document.getElementById('movimentarGuindasteAviso');
    if (aviso) {
      const partes = [];
      if (indisponiveis.length) {
        partes.push(`Indisponíveis para tarefas (não selecionáveis): ${indisponiveis.map(g => `${g.identificacao} (${g.estado})`).join(', ')}.`);
      }
      if (!atual.ok) {
        partes.push('Não foi possível confirmar o estado dos guindastes no banco de dados; a lista pode estar desatualizada.');
      }
      aviso.textContent = partes.join(' ');
      aviso.classList.toggle('hidden', partes.length === 0);
    }
  }

  if (movimentarSetorSelect) movimentarSetorSelect.addEventListener('change', atualizarInstrucaoMovimentacao);
  if (movimentarGuindasteSelect) movimentarGuindasteSelect.addEventListener('change', atualizarInstrucaoMovimentacao);
  if (closeMovimentarModalBtn) closeMovimentarModalBtn.addEventListener('click', fecharMovimentarModal);
  if (cancelMovimentarModalBtn) cancelMovimentarModalBtn.addEventListener('click', fecharMovimentarModal);
  if (confirmMovimentarModalBtn) {
    confirmMovimentarModalBtn.addEventListener('click', async () => {
      if (!targetCargaMovimentacao) return;
      const setor = movimentarSetorSelect ? movimentarSetorSelect.value : '';
      const gnd = movimentarGuindasteSelect ? movimentarGuindasteSelect.value : '';
      if (!setor) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Setor Obrigatório', 'Selecione o setor de destino da carga no pátio.');
        return;
      }
      if (!gnd) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Guindaste Obrigatório', 'Selecione o guindaste que executará a movimentação.');
        return;
      }
      const ok = await criarTarefaMovimentacao(targetCargaMovimentacao, setor, gnd);
      if (ok) {
        localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));
        fecharMovimentarModal();
        renderTable();
      }
    });
  }

  // Executa Ações Operacionais
  // opcoes (uso do agente WebMCP; a interface não envia): { guindasteIdentificacao?, setorDestino?, motivo? } evitam os diálogos.
  window.executarAcaoCarga = async function(idCarga, acao, opcoes) {
    if (userCargo === 'ESTIVADOR' && acao !== 'MOVIMENTAR') return;
    const op = opcoes || {};
    const carga = cargasFluxoList.find(c => c.id === idCarga);
    if (!carga) return;

    if (acao === 'MOVIMENTAR') {
      if (!isEstivadorRole) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Acesso Restrito', 'Apenas Estivadores podem registrar movimentação de cargas!');
        return;
      }

      if (!validarRecebimentoParaMovimentacao(carga)) return;

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

      // Uso do agente WebMCP: setor + guindaste informados criam a tarefa sem modal.
      if (op.setorDestino !== undefined || op.guindasteIdentificacao !== undefined) {
        if (!op.setorDestino || !op.guindasteIdentificacao) {
          if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Dados Incompletos', 'Informe o setor de destino e o guindaste para criar a tarefa de movimentação.');
          return;
        }
        const criada = await criarTarefaMovimentacao(carga, op.setorDestino, op.guindasteIdentificacao);
        if (!criada) return;
        localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargasFluxoList));
        renderTable();
        return;
      }

      // Interface: abre o modal com setor de destino + guindaste.
      window.abrirModalMovimentacao(idCarga);
      return;
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
      // Item 4: A opção "Pronta" só é permitida se a carga já tiver sido vinculada a um contêiner
      if (!carga.container && !carga.container_id) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Vínculo Obrigatório', `BLOQUEIO DE SEGURANÇA (Item 4): A carga ${idCarga} só pode ser alterada para "Pronta" se já tiver sido vinculada a um contêiner! Use o botão "Vincular" primeiro.`);
        }
        return;
      }
      // Backlog Parte 2 — Tarefa 9: vínculo não basta — a carga precisa ter
      // sido movimentada até o contêiner e a movimentação concluída. Vale
      // para todos os cargos (a supervisão não pula a etapa física).
      if (!cargaAlocadaNoContainer(carga)) {
        const contRef = carga.container || carga.container_id;
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Movimentação até o Contêiner Pendente', `A carga ${idCarga} está vinculada ao contêiner ${contRef}, mas ainda não foi movimentada até ele. Use "Movimentar" com destino "Contêiner ${contRef}", conclua a movimentação em Embarcações & GPS e só então marque como pronta.`);
        }
        return;
      }
      if (exigeEtapasPronta && !requisitosProntaConcluidos(carga)) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Etapas Pendentes', 'Conclua o recebimento, a inspeção, a vinculação ao contêiner e navio e as movimentações pendentes antes de marcar a carga como pronta.');
        return;
      }

      if (!isArrumadorRole) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Acesso Restrito', 'Acesso Restrito (RF 1.8): Apenas Arrumadores e Consertadores (ou Supervisão/Direção) podem alterar o status da carga para Pronta para Entrega!');
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
      // Ação descontinuada: não existe mais liberação manual de carga. O status
      // vai para EM_TRANSITO automaticamente quando o navio vinculado for
      // liberado para o porto de destino (Embarcações & GPS → Liberar Saída).
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Liberação Automática', `A carga ${idCarga} entrará em EM_TRANSITO automaticamente quando o navio vinculado (${carga.navio || 'sem navio vinculado — use "Vincular"'}) for liberado em Embarcações & GPS. Não há mais liberação manual por botão.`);
      }
      return;
    } else if (acao === 'CANCELAR') {
      const statusPermitidos = ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'];
      if (!statusPermitidos.includes(carga.status)) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Regra de Negócio', `REGRA DE NEGÓCIO (RN 16): O cancelamento só é permitido para cargas em Agendamento, Armazenagem ou Pronta para Entrega! O status atual "${carga.status}" não permite cancelamento.`);
        }
        return;
      }

      const motivo = op.motivo !== undefined ? op.motivo : await window.nexusPrompt('Cancelar Carga', 'Informe obrigatoriamente o MOTIVO do cancelamento:');
      if (motivo) {
        // C9: Carga cancelada sai da tabela principal, desocupa contêiner e navio e retorna ao berço
        carga.status = 'CANCELADA';
        carga.motivoCancelamento = motivo;
        carga.motivo_recusa = motivo;
        carga.container = '';
        carga.container_id = null;
        carga.navio = '';
        carga.navio_id = null;
        carga.navioId = null;
        carga.herdarNavioDoContainer = false;
        carga.movimentacaoPendente = null;
        carga.guindasteDesignado = null;

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

  // Carregamento inicial ao abrir a página.
  // Tarefa 3 (Correções): antes da primeira leitura de cargas, confirma no banco
  // as chegadas vencidas (ETA zerado) — o trigger fn_propagar_status_navio
  // entrega as cargas EM_TRANSITO do navio e as transições automáticas desta
  // página concluem o restante. Assim a carga aparece na tabela de entregues ao
  // abrir/recarregar Cargas & Pátio, sem depender de abrir Embarcações & GPS.
  (async () => {
    try {
      await sincronizarChegadasNavios();
    } catch (e) {
      console.warn('[NexusPort] Cargas: sincronização de chegada dos navios falhou:', e);
    }
    await carregarCargasSupabase();
  })();

  // Sincronização viva: somente entidades que afetam a carga disparam uma leitura.
  // A rajada de eventos é consolidada em um timer único; cada evento invalida a
  // resposta anterior antes de agendar a leitura mais recente.
  const ENTIDADES_QUE_AFETAM_CARGAS = new Set([
    'cargas', 'navios', 'containers', 'estivador_cargas', 'funcionarios',
    'nexus_cargas_fluxo', 'nexus_navios_list', 'nexus_containers_list', 'nexus_func_list',
    'periodic_sync', 'window_focus', 'visibility_sync'
  ]);
  window.addEventListener('nexus_data_changed', (event) => {
    const entity = event && event.detail ? event.detail.entity : null;
    if (entity && !ENTIDADES_QUE_AFETAM_CARGAS.has(entity)) return;
    agendarAtualizacaoCargas();
    renderBercosPanel();
  });
});
