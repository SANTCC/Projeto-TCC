/**
 * WebMCP — leitores compartilhados (js/webmcp/webmcp-dados.js) — NexusPort
 *
 * Única porta de saída de dados das ferramentas para o agente. Cada leitor:
 *   - devolve apenas os campos necessários para a tarefa (minimização de dados);
 *   - NUNCA inclui código individual, senha/token, CPF/documento, matrícula de
 *     autoria ou valores de chaves de serviço;
 *   - formata datas (dd/mm/aaaa hh:mm), moeda (R$), peso (t) e volume (m³) como a interface;
 *   - usa as mesmas regras de visibilidade da interface (NexusVision) e os mesmos
 *     caches locais que as páginas mantêm sincronizados.
 *
 * Carregamento: depois de js/webmcp/webmcp-core.js e antes das páginas WebMCP.
 */
(function (window) {
  'use strict';

  if (window.NexusWebMCPDados) return;

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function lerLista(chave) {
    try {
      const valor = JSON.parse(localStorage.getItem(chave) || '[]');
      return Array.isArray(valor) ? valor : [];
    } catch (e) {
      return [];
    }
  }

  function sessao() {
    try {
      return window.NexusAuth ? window.NexusAuth.getSession() : null;
    } catch (e) {
      return null;
    }
  }

  function dataHora(valor) {
    if (!valor) return null;
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor).slice(0, 40);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function moeda(valor) {
    const n = Number(String(valor).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function normalizarImo(valor) {
    return String(valor || '').replace(/\s+/g, '').toUpperCase();
  }

  function normalizarMatricula(valor) {
    return String(valor || '').trim().toUpperCase();
  }

  function contem(texto, trecho) {
    return String(texto || '').toLowerCase().includes(String(trecho || '').toLowerCase());
  }

  function diaIso(valor) {
    try {
      const d = new Date(valor);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Cargas
  // ------------------------------------------------------------------
  async function cargas() {
    let lista = null;
    if (window.NexusRepository && typeof window.NexusRepository.getCargas === 'function') {
      try { lista = await window.NexusRepository.getCargas(); } catch (e) { lista = null; }
    }
    return Array.isArray(lista) ? lista : lerLista('nexus_cargas_fluxo');
  }

  function cargasVisiveis(lista) {
    if (window.NexusVision && typeof window.NexusVision.filterCargasForUser === 'function') {
      return window.NexusVision.filterCargasForUser(lista, sessao());
    }
    return lista;
  }

  /** Mesmas regras de filtro da tabela de cargas (cargas.js → renderTable). */
  function filtrarCargas(lista, filtros) {
    const f = filtros || {};
    return lista.filter((c) => {
      if (f.status && c.status !== f.status) return false;
      if (f.navio && !contem(c.navio, f.navio)) return false;
      if (f.container && !contem(c.container, f.container)) return false;
      if (f.tipo && !(contem(c.tipo, f.tipo) || contem(c.natureza, f.tipo))) return false;
      if (f.data_inicio || f.data_fim) {
        const bruto = c.data_cadastro || c.created_at || c.data_entrada || c.dataAgendamento || c.dataChegada;
        const dia = bruto ? diaIso(bruto) : null;
        if (!dia) return false;
        if (f.data_inicio && dia < f.data_inicio) return false;
        if (f.data_fim && dia > f.data_fim) return false;
      }
      return true;
    });
  }

  function numeroOuTexto(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    return valor;
  }

  function resumirCarga(c) {
    return {
      id: c.id,
      tipo: c.tipo || null,
      natureza: c.natureza || null,
      status: c.status || null,
      peso: numeroOuTexto(c.peso),
      volume: numeroOuTexto(c.volume),
      porto_descarga: c.portoDescarga || c.porto_descarga || null,
      destino: c.destino || null,
      container: c.container || null,
      navio: c.navio || null,
      guindaste: c.guindasteDesignado || null,
      codigo_qr: c.qrCode || `QR-${c.id}`,
      chegada: dataHora(c.dataChegada),
      resultado_inspecao: c.resultadoInspecao || null,
      motivo: c.motivoCancelamento || c.motivoRecusa || c.motivo_recusa || null
    };
  }

  // ------------------------------------------------------------------
  // Navios, contêineres, guindastes, berços
  // ------------------------------------------------------------------
  async function navios() {
    let lista = null;
    if (window.NexusRepository && typeof window.NexusRepository.getNavios === 'function') {
      try { lista = await window.NexusRepository.getNavios(); } catch (e) { lista = null; }
    }
    return Array.isArray(lista) ? lista : lerLista('nexus_navios_list');
  }

  function resumirNavio(n) {
    return {
      imo: n.imo || null,
      nome: n.nome || null,
      localizacao: n.localizacao || null,
      estado: n.estado || n.estado_operacional || null,
      origem: n.origem || null,
      destino: n.destino || null,
      distancia_km: Number.isFinite(Number(n.distancia)) ? Number(n.distancia) : null,
      gps: n.gps || null,
      saida: dataHora(n.dataSaida || n.data_saida)
    };
  }

  function containers() {
    return lerLista('nexus_containers_list');
  }

  function resumirContainer(c) {
    return {
      identificacao: c.identificacao || null,
      tipo: c.tipo || c.material_carregado || null,
      estado: c.estado || null,
      navio: c.navio || null,
      ultima_manutencao: c.dataManut || null
    };
  }

  function guindastes() {
    return lerLista('nexus_guindastes_list');
  }

  function resumirGuindaste(g) {
    return {
      identificacao: g.identificacao || null,
      estado: g.estado || null,
      ultima_manutencao: g.dataManut || null
    };
  }

  function bercos() {
    return lerLista('nexus_bercos_list');
  }

  function resumirBerco(b) {
    return {
      id: b.id || null,
      nome: b.nome || null,
      estado: b.estado || null,
      navio: b.navio_nome || null,
      imo_navio: b.navio_imo || null
    };
  }

  function tarefasGuindaste() {
    return lerLista('nexus_guindaste_tarefas');
  }

  // ------------------------------------------------------------------
  // Manutenção (OS)
  // ------------------------------------------------------------------
  function ordens() {
    return lerLista('nexus_os_list');
  }

  function resumirOrdem(o) {
    return {
      id: o.id || null,
      equipamento: o.equipamento || null,
      prioridade: o.prioridade || null,
      descricao: o.descricao || null,
      status: o.status || null,
      data: o.data ? dataHora(o.data) || o.data : null
    };
  }

  // ------------------------------------------------------------------
  // Pessoas (sem dados de acesso ou documentos)
  // ------------------------------------------------------------------
  function funcionarios() {
    return lerLista('nexus_func_list');
  }

  function resumirFuncionario(f) {
    return {
      matricula: f.matricula || null,
      nome: f.nome || null,
      cargo: f.cargo || null,
      ativo: f.ativo !== false
    };
  }

  async function visitantes() {
    let lista = null;
    if (window.NexusRepository && typeof window.NexusRepository.getVisitantes === 'function') {
      try { lista = await window.NexusRepository.getVisitantes(); } catch (e) { lista = null; }
    }
    return Array.isArray(lista) ? lista : lerLista('nexus_vis_list');
  }

  function resumirVisitante(v) {
    return {
      id: v.id || null,
      nome: v.nome || null,
      motivo: v.motivo || null,
      status: v.status || null,
      entrada: v.data || null,
      saida: v.data_saida ? (dataHora(v.data_saida) || v.data_saida) : null
    };
  }

  // ------------------------------------------------------------------
  // Trilha de decisões (somente leitura para agentes)
  // ------------------------------------------------------------------
  function trilha() {
    return lerLista('nexus_trail_decisoes');
  }

  /** O campo "responsavel" grava "Nome (Cargo) - CÓDIGO": só nome e cargo saem para o agente. */
  function resumirTrilha(t) {
    const responsavel = String(t.responsavel || '').split(' - ')[0];
    return {
      id: t.id || null,
      decisao: t.decisao || null,
      entidade: t.entidade || null,
      data_hora: dataHora(t.data_hora) || null,
      responsavel: responsavel || null,
      motivo: t.motivo || null,
      retificacao: t.retificacao ? String(t.retificacao).slice(0, 200) : null
    };
  }

  // ------------------------------------------------------------------
  // Indicadores e tipos
  // ------------------------------------------------------------------
  async function indicadores() {
    if (window.NexusRepository && typeof window.NexusRepository.buscarIndicadoresOperacionais === 'function') {
      try { return await window.NexusRepository.buscarIndicadoresOperacionais(); } catch (e) { return null; }
    }
    return null;
  }

  function tiposCarga() {
    return Array.isArray(window.NEXUS_TIPOS_CARGA) ? window.NEXUS_TIPOS_CARGA : [];
  }

  function tipoCarga(nomeOuId) {
    if (typeof window.getNexusTipoCarga === 'function') {
      try { return window.getNexusTipoCarga(nomeOuId) || null; } catch (e) { return null; }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Auxiliares das páginas (uso pelas ferramentas)
  // ------------------------------------------------------------------
  const STATUS_CARGA = ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA', 'EM_TRANSITO', 'ENTREGUE', 'RECUSADA', 'CANCELADA'];
  const SETORES_PATIO = ['Pátio Principal (Setor A)', 'Pátio STS-01 (Setor B)', 'Pátio STS-01 (Setor C)', 'Pátio STS-01 (Setor Refrigeração)'];
  const CAPACIDADE_CONTAINER_M3 = 75;
  const GUINDASTES_PADRAO = [
    { id: 'GND-01-STS', identificacao: 'GND-01-STS', estado: 'OPERANTE', padrao: true },
    { id: 'GND-02-STS', identificacao: 'GND-02-STS', estado: 'OPERANTE', padrao: true }
  ];

  /** Espera até o predicado virar verdadeiro (polling curto). Retorna boolean. */
  function esperar(predicado, ms) {
    const limite = Date.now() + (ms || 5000);
    return new Promise((resolve) => {
      const tentar = () => {
        let ok = false;
        try { ok = Boolean(predicado()); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() >= limite) return resolve(false);
        setTimeout(tentar, 50);
      };
      tentar();
    });
  }

  /** Define o valor de um controle do formulário e dispara input/change (como o operador faria). */
  function definirCampo(form, nome, valor) {
    const controle = form.querySelector(`[name="${nome}"], #${nome}`);
    if (!controle) throw new Error(`campo inexistente: ${nome}`);
    if (controle.type === 'checkbox') {
      controle.checked = valor === true;
    } else if (controle.tagName === 'SELECT') {
      const alvo = String(valor);
      const opcao = Array.from(controle.options).find((o) => o.value === alvo);
      if (!opcao) throw new Error(`opção inválida em ${nome}`);
      controle.value = opcao.value;
    } else {
      controle.value = String(valor);
    }
    controle.dispatchEvent(new Event('input', { bubbles: true }));
    controle.dispatchEvent(new Event('change', { bubbles: true }));
    return controle;
  }

  /** Cargas que o operador pode ver (mesma regra da tela), sem canceladas salvo filtro explícito. */
  async function cargasDoOperador() {
    return cargasVisiveis(await cargas());
  }

  /** Ocupação de um contêiner pelas cargas vinculadas (cálculo da tela de vinculação). */
  function volumeNumero(valor) {
    if (typeof valor === 'number') return valor;
    const n = parseFloat(String(valor || '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function disponibilidadeContainer(identificacao, listaCargas) {
    const usado = (listaCargas || [])
      .filter((c) => c.status !== 'CANCELADA' && c.status !== 'RECUSADA' && c.container === identificacao)
      .reduce((soma, c) => soma + volumeNumero(c.volume), 0);
    return Math.max(0, CAPACIDADE_CONTAINER_M3 - usado);
  }

  /** Guindastes como a tela os apresenta (lista salva ou padrões da primeira movimentação). */
  function guindastesEfetivos() {
    const lista = guindastes();
    return lista.length ? lista : GUINDASTES_PADRAO.map((g) => Object.assign({}, g));
  }

  // Grupos de cargos (espelham as listas de auth-guard.js e das páginas; mínimo privilégio).
  const DIRECAO = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'];
  const GRUPOS = Object.freeze({
    operacionais: Object.freeze(['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS']),
    direcao: Object.freeze(DIRECAO.slice()),
    supervisao: Object.freeze(['SUPERVISOR_GERENTE_OPERACOES'].concat(DIRECAO)),
    inspecao: Object.freeze(['INSPETOR'].concat(DIRECAO)),
    gestaoOperacional: Object.freeze(['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].concat(DIRECAO)),
    todos: Object.freeze([
      'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS',
      'INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'
    ].concat(DIRECAO))
  });

  /** Pode a sessão atual usar esta ferramenta? (mesma regra de cargo + permissão + página) */
  function podeUsar(def) {
    const s = sessao();
    if (!s || !s.cargo) return false;
    if (def.cargos && !def.cargos.includes(s.cargo)) return false;
    if (def.permissao && !(window.NexusAuth && window.NexusAuth.hasPermission(def.permissao))) return false;
    return true;
  }

  /** Executa fn isolando falhas: uma definição quebrada não derruba as demais ferramentas da página. */
  function seguro(fn, rotulo) {
    try {
      return fn();
    } catch (erro) {
      console.error(`[NexusWebMCP] ${rotulo}: ${erro && erro.message}`);
      return null;
    }
  }

  /** Executa fn quando o DOM estiver pronto (uma única vez, sem duplicar registros). */
  function quandoPronto(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  window.NexusWebMCPDados = Object.freeze({
    seguro,
    quandoPronto,
    GRUPOS,
    podeUsar,
    STATUS_CARGA,
    SETORES_PATIO,
    CAPACIDADE_CONTAINER_M3,
    esperar,
    definirCampo,
    cargasDoOperador,
    volumeNumero,
    disponibilidadeContainer,
    guindastesEfetivos,
    UUID,
    lerLista,
    sessao,
    dataHora,
    moeda,
    normalizarImo,
    normalizarMatricula,
    contem,
    cargas,
    cargasVisiveis,
    filtrarCargas,
    resumirCarga,
    navios,
    resumirNavio,
    containers,
    resumirContainer,
    guindastes,
    resumirGuindaste,
    bercos,
    resumirBerco,
    tarefasGuindaste,
    ordens,
    resumirOrdem,
    funcionarios,
    resumirFuncionario,
    visitantes,
    resumirVisitante,
    trilha,
    resumirTrilha,
    indicadores,
    tiposCarga,
    tipoCarga
  });
})(window);
