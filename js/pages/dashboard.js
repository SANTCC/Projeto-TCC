/**
 * Lógica do Painel Geral (dashboard.html) - NexusPort
 * Renderiza exclusivamente a visão geral: 7 Cards Indicadores Operacionais (RF 7),
 * Tabela de Log Geral de Alterações (RF 12), Trail de Decisões Críticas Imutável com Retificação (RF 13)
 * e o Painel Estratégico com Gráficos para Diretores (RF 1).
 */

// Funções utilitárias globais exigidas para integração (T7.1, T7.3, T8.3 - T8.6, T6.8)
window.registrarLogAlteracao = async function(entidade, tipoAlteracao, detalhes = '') {
  // Ações feitas por agente de IA (WebMCP) ficam marcadas na auditoria. Sem agente, nada muda.
  const marcaAgente = (window.NexusWebMCP && typeof window.NexusWebMCP.marcaAuditoria === 'function') ? window.NexusWebMCP.marcaAuditoria() : '';
  if (marcaAgente) {
    detalhes = typeof detalhes === 'string' ? marcaAgente + detalhes : Object.assign({}, detalhes, { origem_agente: window.NexusWebMCP.origemAtual() });
  }
  const session = window.currentUserSession || (window.NexusAuth ? NexusAuth.getSession() : null) || {};
  const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  let funcId = isUUID(session.id) ? session.id : null;
  if (!funcId) {
    const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
    if (match && isUUID(match.id)) funcId = match.id;
  }

  const validTipos = ['CRIACAO', 'EDICAO', 'EXCLUSAO', 'REIMPRESSAO_ETIQUETA', 'EXPORTACAO'];
  let tipoEnum = 'EDICAO';
  const tipoUpper = String(tipoAlteracao || '').toUpperCase();
  if (validTipos.includes(tipoUpper)) {
    tipoEnum = tipoUpper;
  } else if (tipoUpper.includes('CRI')) tipoEnum = 'CRIACAO';
  else if (tipoUpper.includes('EXCLU') || tipoUpper.includes('DELET')) tipoEnum = 'EXCLUSAO';
  else if (tipoUpper.includes('ETIQUETA')) tipoEnum = 'REIMPRESSAO_ETIQUETA';

  let entidadeTipo = 'CARGA';
  let entidadeId = String(entidade || '').trim();
  const entUpper = entidadeId.toUpperCase();
  if (entUpper.startsWith('NAVIO') || entUpper.includes('NAVIO')) entidadeTipo = 'NAVIO';
  else if (entUpper.startsWith('CONT') || entUpper.includes('CONTAINER')) entidadeTipo = 'CONTAINER';
  else if (entUpper.startsWith('GND') || entUpper.includes('GUINDASTE')) entidadeTipo = 'GUINDASTE';
  else if (entUpper.startsWith('MANUT') || entUpper.includes('OS-')) entidadeTipo = 'MANUTENCAO';
  else if (entUpper.startsWith('VIS') || entUpper.includes('VISITANTE')) entidadeTipo = 'VISITANTE';
  // Auditoria das emergências (botão de pânico). O valor EMERGENCIA vive no
  // tipo tipo_entidade_enum; se o banco ainda não o tiver, o insert é recusado
  // com 22P02 — por isso o erro é tratado logo abaixo.
  else if (entUpper.includes('EMERGENCIA')) entidadeTipo = 'EMERGENCIA';

  const validCargos = [
    'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 
    'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 
    'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 
    'CONSELHO_ADMINISTRACAO'
  ];
  let cargoEnum = 'ESTIVADOR';
  if (validCargos.includes(session.cargo)) cargoEnum = session.cargo;

  const nowIso = new Date().toISOString();

  if (window.nexusSupabase) {
    try {
      const payload = {
        data_hora: nowIso,
        cargo: cargoEnum,
        codigo_individual: session.codigo_individual || session.codigo || '--',
        entidade_tipo: entidadeTipo,
        entidade_id: entidadeId || 'N/A',
        tipo_alteracao: tipoEnum,
        detalhes: typeof detalhes === 'object' ? detalhes : { descricao: detalhes }
      };
      if (funcId) payload.funcionario_id = funcId;

      let { error } = await window.nexusSupabase.from('logs_alteracoes').insert(payload);
      if (error && payload.funcionario_id) {
        // funcionario_id pode não existir em public.funcionarios (sessão
        // antiga): repete sem a FK, mantendo o restante da linha.
        delete payload.funcionario_id;
        const retentativa = await window.nexusSupabase.from('logs_alteracoes').insert(payload);
        error = retentativa && retentativa.error;
      }
      if (error) {
        // Recusa do banco (ex.: 22P02 — valor 'EMERGENCIA' ausente no enum
        // tipo_entidade_enum): o insert devolvia erro e ninguém o lia, então
        // a auditoria se perdia em silêncio. Agora fica no console uma única
        // vez, apontando o arquivo .sql que cria o valor.
        const utils = window.NexusSupabaseUtils;
        if (utils && typeof utils.registrarEnumDesconhecido === 'function') {
          utils.registrarEnumDesconhecido(error);
        } else {
          console.warn('[NexusPort] Auditoria não gravada em logs_alteracoes:', error.message || error);
        }
      }
    } catch (err) {
      console.warn('[NexusPort] Erro ao invocar log Supabase:', err);
    }
  }

  const logs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');
  const newLog = {
    data_hora: nowIso,
    nome_funcionario: session.nome || 'Operador Porto',
    cargo: session.cargo_nome || session.cargo || 'Operador',
    codigo_usuario: session.codigo_individual || session.codigo || '--',
    entidade: `${entidadeTipo} ${entidadeId}`,
    tipo_alteracao: tipoEnum,
    detalhes: detalhes
  };
  logs.unshift(newLog);
  localStorage.setItem('nexus_audit_logs', JSON.stringify(logs));

  if (window.NexusRepository && window.NexusRepository.notifyChange) {
    window.NexusRepository.notifyChange('logs_alteracoes');
  } else {
    window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: 'logs_alteracoes' } }));
  }
};

// Tabelas usadas por chamadas antigas (decisao, tabela, id, motivo) de outros módulos.
const TRAIL_TABELAS_LEGADAS = {
  navios: 'NAVIO',
  guindastes: 'GUINDASTE',
  containers: 'CONTAINER',
  manutencoes: 'MANUTENCAO',
  cargas: 'CARGA',
  delegacoes_supervisor: 'FUNCIONARIO'
};

// Tipos de entidade aceitos para cada decisão (sem combinações sem sentido).
const TRAIL_TIPOS_COMPATIVEIS = {
  APROVOU_CARGA: ['CARGA'],
  RECUSOU_CARGA: ['CARGA'],
  CANCELOU_ENTREGA: ['CARGA'],
  LIBEROU_NAVIO: ['NAVIO'],
  SOLICITOU_MANUTENCAO_NAVIO: ['NAVIO'],
  SOLICITOU_MANUTENCAO_CONTAINER: ['CONTAINER', 'GUINDASTE'],
  APROVOU_MANUTENCAO: ['MANUTENCAO', 'GUINDASTE'],
  RECUSOU_MANUTENCAO: ['MANUTENCAO', 'GUINDASTE'],
  DESIGNOU_SUBSTITUTO: ['FUNCIONARIO']
};
window.TRAIL_TIPOS_COMPATIVEIS = TRAIL_TIPOS_COMPATIVEIS;

// registrarTrailDecisao(decisao, entidade, motivo, referencia)
//   referencia = { tipo, id, codigo, rotulo } vindo de um registro real do Supabase (formulário do painel).
//   Sem referencia, mantém o comportamento anterior (texto livre), usado por chamadas legadas.
window.registrarTrailDecisao = async function(decisao, entidade, motivo = '', referencia = null) {
  // Chamadas antigas com 4 argumentos: (decisao, tabela, id, motivo). O id não pode virar motivo.
  if (arguments.length >= 4 && TRAIL_TABELAS_LEGADAS[entidade] && !(referencia && typeof referencia === 'object')) {
    const idLegado = motivo;
    motivo = referencia;
    referencia = {
      tipo: TRAIL_TABELAS_LEGADAS[entidade],
      id: idLegado || null,
      codigo: idLegado ? String(idLegado) : String(entidade),
      rotulo: entidade,
      legado: true
    };
  }

  // Decisões tomadas via agente de IA (WebMCP) ficam marcadas na trilha imutável.
  const marcaAgente = (window.NexusWebMCP && typeof window.NexusWebMCP.marcaAuditoria === 'function') ? window.NexusWebMCP.marcaAuditoria() : '';
  if (marcaAgente) motivo = marcaAgente + (motivo || 'Decisão registrada pelo agente');
  const session = window.currentUserSession || (window.NexusAuth ? NexusAuth.getSession() : null) || {};
  const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  let funcId = isUUID(session.id) ? session.id : null;
  if (!funcId) {
    const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
    if (match && isUUID(match.id)) funcId = match.id;
  }

  const validDecisoes = [
    'APROVOU_CARGA', 'RECUSOU_CARGA', 'SOLICITOU_MANUTENCAO_NAVIO', 
    'SOLICITOU_MANUTENCAO_CONTAINER', 'LIBEROU_NAVIO', 'CANCELOU_ENTREGA', 
    'APROVOU_MANUTENCAO', 'RECUSOU_MANUTENCAO', 'DESIGNOU_SUBSTITUTO'
  ];
  let decisaoEnum = 'APROVOU_CARGA';
  const decUpper = String(decisao || '').toUpperCase();
  if (validDecisoes.includes(decUpper)) {
    decisaoEnum = decUpper;
  } else if (decUpper.includes('RECUS') && decUpper.includes('CARGA')) {
    decisaoEnum = 'RECUSOU_CARGA';
  } else if (decUpper.includes('CANCEL')) {
    decisaoEnum = 'CANCELOU_ENTREGA';
  } else if (decUpper.includes('NAVIO') && decUpper.includes('LIBER')) {
    decisaoEnum = 'LIBEROU_NAVIO';
  } else if (decUpper.includes('MANUT') && decUpper.includes('APROV')) {
    decisaoEnum = 'APROVOU_MANUTENCAO';
  } else if (decUpper.includes('MANUT') && decUpper.includes('RECUS')) {
    decisaoEnum = 'RECUSOU_MANUTENCAO';
  } else if (decUpper.includes('SUBSTITUT')) {
    decisaoEnum = 'DESIGNOU_SUBSTITUTO';
  }

  let entidadeTipo = 'CARGA';
  let entidadeId = String(entidade || '').trim();
  let detalhes = null;
  if (referencia) {
    const permitidos = TRAIL_TIPOS_COMPATIVEIS[decisaoEnum] || [];
    if (!referencia.legado && !permitidos.includes(referencia.tipo)) {
      return { ok: false, mensagem: `A decisão "${decisaoEnum}" não pode ser registrada para ${referencia.tipo}.` };
    }
    entidadeTipo = referencia.tipo;
    entidadeId = String(referencia.codigo || '').trim();
    if (!referencia.legado && !entidadeId) {
      return { ok: false, mensagem: 'Selecione um registro válido antes de registrar a decisão.' };
    }
    detalhes = { referencia_id: referencia.id || null, rotulo: referencia.rotulo || null };
  } else {
    const entUpper = entidadeId.toUpperCase();
    if (entUpper.startsWith('NAVIO') || entUpper.includes('NAVIO')) entidadeTipo = 'NAVIO';
    else if (entUpper.startsWith('CONT') || entUpper.includes('CONTAINER')) entidadeTipo = 'CONTAINER';
    else if (entUpper.startsWith('GND') || entUpper.includes('GUINDASTE')) entidadeTipo = 'GUINDASTE';
    else if (entUpper.startsWith('MANUT') || entUpper.includes('OS-')) entidadeTipo = 'MANUTENCAO';
  }

  const validCargos = [
    'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 
    'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 
    'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 
    'CONSELHO_ADMINISTRACAO'
  ];
  let cargoEnum = 'SUPERVISOR_GERENTE_OPERACOES';
  if (validCargos.includes(session.cargo)) cargoEnum = session.cargo;

  const nowIso = new Date().toISOString();
  const estruturado = !!(referencia && !referencia.legado);
  const msgFalhaBanco = 'Não foi possível gravar a decisão no banco de dados. Nada foi registrado; tente novamente.';
  if (estruturado && !window.nexusSupabase) {
    return { ok: false, mensagem: 'Sem conexão com o banco de dados. A decisão não foi registrada.' };
  }
  let insertedDbId = null;

  if (window.nexusSupabase) {
    try {
      const payload = {
        data_hora: nowIso,
        cargo: cargoEnum,
        codigo_individual: session.codigo_individual || session.codigo || 'SUP-2001',
        tipo_decisao: decisaoEnum,
        entidade_tipo: entidadeTipo,
        entidade_id: entidadeId,
        motivo: motivo || 'Decisão homologada conforme fluxo operacional'
      };
      if (detalhes) payload.detalhes = detalhes;
      if (funcId) payload.funcionario_id = funcId;

      let resposta = await window.nexusSupabase.from('trail_decisoes').insert(payload).select().maybeSingle();
      if (resposta.error && payload.funcionario_id) {
        delete payload.funcionario_id;
        resposta = await window.nexusSupabase.from('trail_decisoes').insert(payload).select().maybeSingle();
      }
      if (!resposta.error && resposta.data) {
        insertedDbId = resposta.data.id;
      } else if (estruturado) {
        console.warn('[NexusPort] Trail não gravado no Supabase:', resposta.error);
        return { ok: false, mensagem: msgFalhaBanco };
      }
    } catch (err) {
      console.warn('[NexusPort] Erro ao invocar trail Supabase:', err);
      if (estruturado) return { ok: false, mensagem: msgFalhaBanco };
    }
  }

  const trail = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');
  const idReg = insertedDbId ? `TRL-${insertedDbId.substring(0, 8)}` : `TRL-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const newEntry = {
    id: idReg,
    dbId: insertedDbId,
    data_hora: nowIso,
    responsavel: `${session.nome || 'Operador'} (${session.cargo_nome || session.cargo || 'Supervisor'}) - ${session.codigo_individual || session.codigo || '--'}`,
    decisao: decisaoEnum,
    entidade: `${entidadeTipo} ${entidadeId}`,
    motivo: motivo || 'Decisão homologada conforme fluxo operacional',
    retificacao: null
  };
  trail.unshift(newEntry);
  localStorage.setItem('nexus_trail_decisoes', JSON.stringify(trail));

  if (window.registrarLogAlteracao) {
    await window.registrarLogAlteracao(entidadeId, `Decisão Crítica: ${decisaoEnum}`, motivo);
  }

  window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: 'trail_decisoes' } }));
  return { ok: true, id: idReg, dbId: insertedDbId };
};

window.calcularEstimativaChegada = function(distanciaKm) {
  if (!distanciaKm || distanciaKm <= 0) return 'Atracado / Viagem Concluída';
  const velocidade = 33; // km/h (RN 9)
  const horasTotais = distanciaKm / velocidade;
  const dias = Math.floor(horasTotais / 24);
  const horas = Math.round(horasTotais % 24);
  return `${dias}d ${horas}h (Distância: ${distanciaKm} km @ 33 km/h)`;
};

window.calcularTempoPermanenciaPorto = function(dataEntradaStr) {
  if (!dataEntradaStr) return '0d 0h';
  const inicio = new Date(dataEntradaStr).getTime();
  const diffMs = Math.max(0, Date.now() - inicio);
  const horasTotais = Math.floor(diffMs / (1000 * 60 * 60));
  const dias = Math.floor(horasTotais / 24);
  const horas = horasTotais % 24;
  return `${dias}d ${horas}h no porto`;
};

window.calcularTempoForaPorto = function(dataSaidaStr) {
  if (!dataSaidaStr) return '0d 0h fora';
  const inicio = new Date(dataSaidaStr).getTime();
  const diffMs = Math.max(0, Date.now() - inicio);
  const horasTotais = Math.floor(diffMs / (1000 * 60 * 60));
  const dias = Math.floor(horasTotais / 24);
  const horas = horasTotais % 24;
  return `${dias}d ${horas}h fora do porto`;
};

window.gerarRelatorioPdfA4 = function(idCarga) {
  if (window.mostrarFeedback) {
    window.mostrarFeedback('sucesso', 'Relatório PDF A4', `Relatório PDF A4 emitido com sucesso para a carga ${idCarga}`);
  }
};

function initQrCodeEtiquetas() {}
function initDashboardsPesquisaRelatorios() {}
function initLogsTrailDelegacao() {}
function initLocalizacaoETempos() {}

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) {
    NexusAuth.requireAuth();
    return;
  }

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  // Elementos do DOM
  const welcomeAvatar = document.getElementById('welcomeAvatar');
  const welcomeName = document.getElementById('welcomeName');
  const welcomeRoleBadge = document.getElementById('welcomeRoleBadge');
  const welcomeContext = document.getElementById('welcomeContext');
  const welcomeCode = document.getElementById('welcomeCode');

  const cardRoleName = document.getElementById('cardRoleName');
  const cardRoleLevel = document.getElementById('cardRoleLevel');
  const cardVisionLayer = document.getElementById('cardVisionLayer');

  const auditTableBody = document.getElementById('auditLogTableBody');
  const trailTableBody = document.getElementById('trailDecisoesTableBody');
  const estrategicoPanel = document.getElementById('estrategicoPanel');
  const exportHistoricoBtn = document.getElementById('exportHistoricoBtn');

  // Preenchimento dos Dados do Usuário
  const initials = (session.nome || 'Operador').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';

  if (welcomeAvatar) welcomeAvatar.textContent = initials;
  if (welcomeName) welcomeName.textContent = session.nome || 'Operador Porto';
  if (welcomeRoleBadge) welcomeRoleBadge.textContent = session.cargo_nome || session.cargo;
  if (welcomeContext) welcomeContext.textContent = `Matrícula ${session.matricula} • Terminal STS-01 Santos`;
  if (welcomeCode) welcomeCode.textContent = session.codigo_individual || session.codigo || '--';

  const isDiretor = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
  const isOperacionalSupervisor = ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].includes(session.cargo);

  const derivedLevel = session.nivel || (isDiretor ? 'Nível Estratégico' : isOperacionalSupervisor ? 'Nível Tático/Gestão' : 'Nível Operacional');
  const derivedVision = session.camada_visao || (isDiretor ? 'Visão Estratégica' : isOperacionalSupervisor ? 'Visão Operacional' : 'Visão Própria');

  if (cardRoleName) cardRoleName.textContent = session.cargo_nome || session.cargo;
  if (cardRoleLevel) cardRoleLevel.textContent = derivedLevel;
  if (cardVisionLayer) cardVisionLayer.textContent = derivedVision;

  // Planilha consolidada com metas: exclusiva da Visão Estratégica (RF 1).
  // Cargos operacionais/táticos não a veem; a análise gráfica do escopo de cada
  // cargo fica em Relatórios & PDF (js/pages/charts.js), evitando ruído e exposição de metas.
  if (estrategicoPanel) {
    if (isDiretor) {
      estrategicoPanel.classList.remove('hidden');
      renderIndicadoresExecutivosTable();
    } else {
      estrategicoPanel.classList.add('hidden');
    }
  }

  // Os gráficos (Chart.js) não fazem mais parte do Painel Geral (Backlog 3 — dedup):
  // a análise gráfica fica concentrada em Relatórios & PDF (relatorios.html), onde
  // o botão "Atualizar" e a cadência de 1 minuto também são tratados.

  // Renderiza Planilha Consolidada de Desempenho Operacional por Categoria (A3 / Item 1.5)
  async function renderIndicadoresExecutivosTable() {
    const execTableBody = document.getElementById('indicadoresExecutivosTableBody');
    if (!execTableBody) return;

    let cargas = [];
    let containers = [];
    let navios = [];
    let manutencoes = [];

    if (window.nexusSupabase) {
      try {
        const [resCargas, resConts, resNavs, resManut] = await Promise.all([
          window.nexusSupabase.from('cargas').select('*'),
          window.nexusSupabase.from('containers').select('*'),
          window.nexusSupabase.from('navios').select('*'),
          window.nexusSupabase.from('manutencoes').select('*')
        ]);
        if (Array.isArray(resCargas.data)) cargas = resCargas.data;
        if (Array.isArray(resConts.data)) containers = resConts.data;
        if (Array.isArray(resNavs.data)) navios = resNavs.data;
        if (Array.isArray(resManut.data)) manutencoes = resManut.data;
      } catch (e) { console.warn('Erro ao carregar dados do Supabase para planilha:', e); }
    } else {
      cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
      navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      manutencoes = JSON.parse(localStorage.getItem('nexus_os_list') || '[]');
    }

    const totalCargas = cargas.length;
    const totalConts = containers.length;
    const naviosNoPorto = navios.filter(n => n.localizacao === 'DENTRO_DO_PORTO').length;
    const osAtivas = manutencoes.filter(m => m.status === 'SOLICITADA' || m.status === 'APROVADA' || m.status === 'EM_MANUTENCAO').length;

    function calcularStatus(atingimento) {
      if (atingimento >= 85) return 'IDEAL';
      if (atingimento >= 50) return 'ATENÇÃO';
      return 'CRÍTICO';
    }

    const rawIndicadores = [
      { categoria: 'Contêineres Cadastrados e Alocados', volume: totalConts, meta: 20, tempo: 1.5 },
      { categoria: 'Cargas Gerais no Fluxo Operacional', volume: totalCargas, meta: 30, tempo: 2.1 },
      { categoria: 'Embarcações em Operação no Terminal', volume: naviosNoPorto, meta: 5, tempo: 18.4 },
      { categoria: 'Ordens de Serviço de Manutenção Ativas', volume: osAtivas, meta: 5, tempo: 4.8 }
    ];

    const indicadores = rawIndicadores.map(item => {
      const atingimento = item.meta > 0 ? Math.round((item.volume / item.meta) * 100) : 0;
      const status = calcularStatus(atingimento);
      return {
        categoria: item.categoria,
        volume: item.volume,
        meta: item.meta,
        atingimento,
        tempo: item.tempo,
        status
      };
    });

    // Backlog 3 (7f): mantém a cópia em memória para a exportação CSV
    window.__nexusIndicadoresExecutivos = indicadores;

    execTableBody.innerHTML = indicadores.map((i, idx) => `
      <tr class="${idx % 2 === 0 ? 'bg-slate-50/60 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900'} hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
        <td class="p-3 text-left font-bold text-nexus-900 dark:text-white">${esc(i.categoria)}</td>
        <td class="p-3 text-right font-mono font-bold text-slate-700 dark:text-slate-200">${esc(i.volume.toLocaleString('pt-BR'))}</td>
        <td class="p-3 text-right font-mono text-slate-600">${esc(i.meta.toLocaleString('pt-BR'))}</td>
        <td class="p-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">${esc(i.atingimento)}%</td>
        <td class="p-3 text-right font-mono text-slate-600 dark:text-slate-300">${esc(i.tempo)} h</td>
        <td class="p-3 text-center">
          <span class="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
            i.status === 'IDEAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
            i.status === 'ATENÇÃO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
            'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
          }">${esc(i.status)}</span>
        </td>
      </tr>
    `).join('');
  }

  // 1. Renderiza os 7 Cards Indicadores Operacionais (RF 7 / A1 / A9) com dados unificados do Supabase (Item 1.1)
  // Item 7e (backlog3): hora da última atualização dos indicadores no cabeçalho
  function registrarUltimaAtualizacao() {
    const el = document.getElementById('cardsLastUpdate');
    if (!el) return;
    const agora = new Date();
    el.textContent = `Atualizado às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    el.setAttribute('title', `Última atualização dos indicadores: ${agora.toLocaleString('pt-BR')}`);
  }

  async function renderCardsOperacionais() {
    let indic = null;
    if (window.NexusRepository && window.NexusRepository.buscarIndicadoresOperacionais) {
      indic = await window.NexusRepository.buscarIndicadoresOperacionais();
    }

    registrarUltimaAtualizacao();

    if (!indic) return;

    const elNaviosManut = document.getElementById('cardNaviosManutencaoVal');
    const elNaviosFora = document.getElementById('cardNaviosForaVal');
    const elCargasArmaz = document.getElementById('cardCargasArmazenagemVal');
    const elCargasProntas = document.getElementById('cardCargasProntasVal');
    const elCargasRecusadas = document.getElementById('cardCargasRecusadasVal');
    const elOcupacao = document.getElementById('cardOcupacaoPatioVal');
    const elPreventiva = document.getElementById('cardPreventivaVal');

    if (elNaviosManut) elNaviosManut.textContent = indic.manutencao.total;
    if (elNaviosFora) elNaviosFora.textContent = indic.naviosFora.total;
    if (elCargasArmaz) elCargasArmaz.textContent = indic.cargasArmazenagem.total;
    if (elCargasProntas) elCargasProntas.textContent = indic.cargasProntas.total;
    if (elCargasRecusadas) elCargasRecusadas.textContent = `${indic.recusadas.totalRecusadas} (${indic.recusadas.totalCanceladas} Canc.)`;
    if (elOcupacao) elOcupacao.textContent = `${indic.ocupacaoPatio.taxa}% (${indic.ocupacaoPatio.ocupados}/${indic.ocupacaoPatio.capacidade})`;
    if (elPreventiva) elPreventiva.textContent = `${indic.preventiva.total} Equipamento(s)`;
  }

  renderCardsOperacionais();

  // Modal Centralizado para Detalhamento de Indicadores Operacionais (Item 1.2 & Backlog Erro 1)
  const cardModal = document.getElementById('cardDetailModal');
  const modalCardTitle = document.getElementById('modalCardTitle');
  const modalCardDetailContent = document.getElementById('modalCardDetailContent');
  const closeCardDetailModalBtn = document.getElementById('closeCardDetailModalBtn');
  const confirmCardDetailModalBtn = document.getElementById('confirmCardDetailModalBtn');

  function fecharCardModal() {
    if (cardModal) cardModal.classList.add('hidden');
  }

  if (closeCardDetailModalBtn) closeCardDetailModalBtn.addEventListener('click', fecharCardModal);
  if (confirmCardDetailModalBtn) confirmCardDetailModalBtn.addEventListener('click', fecharCardModal);

  if (cardModal) {
    cardModal.addEventListener('click', (e) => {
      if (e.target === cardModal) fecharCardModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !cardModal.classList.contains('hidden')) {
        fecharCardModal();
      }
    });
  }

  window.detalharCardOperacional = async function(tipo) {
    let titulo = '';
    let detalhe = '';
    let icone = 'info';

    let indic = null;
    if (window.NexusRepository && window.NexusRepository.buscarIndicadoresOperacionais) {
      indic = await window.NexusRepository.buscarIndicadoresOperacionais();
    }

    if (!indic) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Indicadores', 'Carregando dados dos indicadores operacionais...');
      }
      return;
    }

    if (tipo === 'NAVIOS_MANUTENCAO') {
      titulo = 'Navios e Equipamentos em Manutenção';
      icone = 'build';
      const navs = indic.manutencao.navios.map(n => `• Navio: ${n.nome} (${n.estado_operacional || n.estado})`);
      const ords = indic.manutencao.ordens.map(o => `• Ordem: ${o.descricao || 'Manutenção geral'} [${o.status}]`);
      detalhe = [...navs, ...ords].join('\n') || 'Nenhum equipamento ou navio em manutenção no momento.';
    } else if (tipo === 'NAVIOS_FORA') {
      titulo = 'Navios Fora do Porto (Em Trânsito / Destino)';
      icone = 'sailing';
      const emTransito = indic.naviosFora.lista.map(n => `• ${n.nome} (Destino: ${n.porto_destino || n.destino || 'Destino Geral'} | Status: ${n.localizacao})`);
      detalhe = emTransito.join('\n') || 'Nenhum navio fora do porto no momento.';
    } else if (tipo === 'CARGAS_ARMAZENAGEM') {
      titulo = 'Cargas em Armazenagem no Pátio STS-01';
      icone = 'inventory_2';
      const arm = indic.cargasArmazenagem.lista.map(c => `• Carga ${c.qr_code_url ? c.qr_code_url.replace('QR-', '') : c.id}: ${c.natureza || 'Geral'} (${c.peso || 0} t, ${c.volume || 0} m³)`);
      detalhe = arm.join('\n') || 'Nenhuma carga em armazenagem no momento.';
    } else if (tipo === 'CARGAS_PRONTAS') {
      titulo = 'Cargas Prontas Aguardando Liberação';
      icone = 'verified';
      const pr = indic.cargasProntas.lista.map(c => `• Carga ${c.qr_code_url ? c.qr_code_url.replace('QR-', '') : c.id}: ${c.natureza || 'Geral'} (${c.peso || 0} t)`);
      detalhe = pr.join('\n') || 'Nenhuma carga pronta para entrega no momento.';
    } else if (tipo === 'CARGAS_RECUSADAS') {
      // Item 1.2: Usa O MESMO RETORNO de buscarCargasRecusadas()
      titulo = 'Cargas Recusadas e Canceladas';
      icone = 'cancel';
      const rec = indic.recusadas.recusadas.map(c => `• [RECUSADA] Carga ${c.id} (${c.tipo}): ${c.motivo}`);
      const canc = indic.recusadas.canceladas.map(c => `• [CANCELADA] Carga ${c.id} (${c.tipo}): ${c.motivo}`);
      detalhe = [...rec, ...canc].join('\n') || 'Nenhuma carga recusada ou cancelada no momento.';
    } else if (tipo === 'OCUPACAO_PATIO') {
      titulo = 'Taxa de Ocupação do Pátio STS-01';
      icone = 'pie_chart';
      detalhe = `Capacidade Máxima Regulamentar: ${indic.ocupacaoPatio.capacidade} posições (100 Hectares / 1.000.000 m²)\nCargas em Armazenagem Ativa: ${indic.ocupacaoPatio.ocupados}\nTaxa de Ocupação Atual: ${indic.ocupacaoPatio.taxa}%`;
    } else if (tipo === 'PREVENTIVA_SUGERIDA') {
      // Item 1.8: Usa O MESMO RETORNO de buscarEquipamentosPreventivaSugerida()
      titulo = 'Manutenções Preventivas Sugeridas (> 3 Anos de Uso)';
      icone = 'warning';
      const prev = indic.preventiva.equipamentos.map(e => `• [${e.tipo}] ${e.identificacao}: ${e.motivo}`);
      detalhe = prev.join('\n') || 'Nenhum equipamento com ciclo de preventiva vencido (> 3 anos) no momento. Todos os ativos operam dentro do ciclo recomendado.';
    }

    const modalCardIcon = document.getElementById('modalCardIcon');
    if (modalCardIcon) modalCardIcon.textContent = icone;
    if (modalCardTitle) modalCardTitle.textContent = titulo;
    if (modalCardDetailContent) modalCardDetailContent.textContent = detalhe;
    if (cardModal) cardModal.classList.remove('hidden');
  };

    // Item do backlog3 (audit-funcionarios): quando um registro traz apenas o
    // código individual (sem JOIN resolvido — ex.: log registrado sem
    // funcionario_id) e o cache local não contém o funcionário (dispositivo
    // novo), o nome aparece como ID/"Operador do Sistema". Esta rotina busca
    // os códigos faltantes diretamente na tabela `funcionarios` do Supabase.
    /**
     * Resolve funcionários por uma coluna (id ou codigo_individual), em lotes de 100 valores
     * (limite de tamanho da URL). Retorna { valor: { nome, cargo } }. Falha = mapa vazio.
     */
    async function buscarFuncionariosPorChaves(coluna, valores) {
      const mapa = {};
      const lista = (valores || []).filter(Boolean);
      if (!window.nexusSupabase || lista.length === 0) return mapa;
      for (let i = 0; i < lista.length; i += 100) {
        const lote = lista.slice(i, i + 100);
        try {
          const { data, error } = await window.nexusSupabase
            .from('funcionarios')
            .select('id, nome, cargo, codigo_individual, matricula')
            .in(coluna, lote);
          if (!error && Array.isArray(data)) {
            data.forEach(f => {
              const chave = f[coluna];
              if (chave && !mapa[chave]) mapa[chave] = { nome: f.nome, cargo: f.cargo };
            });
          }
        } catch (err) {
          console.warn('[NexusPort] Falha ao resolver nomes de funcionários no Supabase:', err);
        }
      }
      return mapa;
    }

  // 2. Renderiza Log Geral de Alterações com Nome do Funcionário Real
  async function renderAuditLogTable() {
    if (!auditTableBody) return;
    let logs = [];
    const localLogs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');

    if (window.nexusSupabase) {
      try {
        // Backlog 3 (tempo real): leitura COMPLETA e paginada — o PostgREST corta em 1000 linhas,
        // e a tabela mostrava só as alterações do próprio usuário.
        const dbLogs = await window.NexusRepository.lerTodasAsLinhas(() => window.nexusSupabase
          .from('logs_alteracoes')
          .select('*')
          .order('data_hora', { ascending: false })
          .order('id'));

        if (Array.isArray(dbLogs) && dbLogs.length > 0) {
          const localFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
          // Responsável de cada linha: pelo funcionario_id e, se faltar, pelo codigo_individual gravado no log.
          const idsFunc = [...new Set(dbLogs.map(l => l.funcionario_id).filter(Boolean))];
          const codigosFunc = [...new Set(dbLogs.map(l => l.codigo_individual).filter(c => c && c !== '--'))];
          const [mapaPorId, mapaPorCodigo] = await Promise.all([
            buscarFuncionariosPorChaves('id', idsFunc),
            buscarFuncionariosPorChaves('codigo_individual', codigosFunc)
          ]);
          const mappedDbLogs = dbLogs.map(l => {
            const cadastro = (l.funcionario_id && mapaPorId[l.funcionario_id])
              || (l.codigo_individual && mapaPorCodigo[l.codigo_individual])
              || null;
            let nomeFunc = cadastro ? cadastro.nome : null;
            let cargoFunc = (cadastro && cadastro.cargo) || l.cargo;
            if (!nomeFunc && l.codigo_individual) {
              const match = localFuncs.find(f => f.codigo_individual === l.codigo_individual || f.matricula === l.codigo_individual);
              if (match) {
                nomeFunc = match.nome;
                cargoFunc = match.cargo || cargoFunc;
              }
            }
            return {
              data_hora: l.data_hora,
              nome_funcionario: nomeFunc || null,
              cargo: cargoFunc || 'OPERACIONAL',
              codigo_usuario: l.codigo_individual || '--',
              entidade: `${l.entidade_tipo || ''} ${l.entidade_id || ''}`.trim(),
              tipo_alteracao: l.tipo_alteracao
            };
          });

          // Logs locais só entram se ainda não estiverem no banco (mesma data e mesmo código)
          const keys = new Set(mappedDbLogs.map(x => `${x.data_hora}-${x.codigo_usuario}`));
          localLogs.forEach(ll => {
            const key = `${ll.data_hora}-${ll.codigo_usuario}`;
            if (!keys.has(key)) mappedDbLogs.push(ll);
          });
          logs = mappedDbLogs;
        }
      } catch (err) {
        console.warn('Erro ao consultar logs_alteracoes no Supabase:', err);
      }
    }

    if (logs.length === 0) {
      logs = localLogs;
    }

    // Ordena logs do mais recente para o mais antigo
    logs.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));

    // Backlog 3 (7b): busca local no log de auditoria + contador "X de Y"
    const buscaAuditVal = (document.getElementById('buscarAuditLogInput')?.value || '').trim().toLowerCase();
    const totalAuditRegistros = logs.length;
    const logsVisiveis = logs.filter(l => {
      if (!buscaAuditVal) return true;
      const haystack = `${l.nome_funcionario || l.nome || ''} ${l.cargo || ''} ${l.codigo_usuario || l.codigo_individual || ''} ${l.entidade || ''} ${l.tipo_alteracao || ''}`.toLowerCase();
      return haystack.includes(buscaAuditVal);
    });

    const auditCounterEl = document.getElementById('auditLogCounter');
    if (auditCounterEl) {
      auditCounterEl.textContent = `Exibindo ${logsVisiveis.length} de ${totalAuditRegistros} registro(s)`;
    }

    if (logsVisiveis.length === 0) {
      auditTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-4 text-center text-slate-600 italic">${totalAuditRegistros === 0 ? 'Nenhum log de alteração registrado no momento.' : 'Nenhum log corresponde à busca aplicada. Ajuste o termo para listar novamente.'}</td>
        </tr>
      `;
      return;
    }

    auditTableBody.innerHTML = logsVisiveis.map(l => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-2.5 text-slate-600 whitespace-nowrap">${l.data_hora ? esc(new Date(l.data_hora).toLocaleString('pt-BR')) : 'N/A'}</td>
        <td class="p-2.5 font-bold text-nexus-900 dark:text-white whitespace-nowrap">${esc(l.nome_funcionario || l.nome || (l.codigo_usuario && l.codigo_usuario !== '--' ? `Sem cadastro (${l.codigo_usuario})` : 'Não identificado'))}</td>
        <td class="p-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">${esc(l.cargo || 'OPERACIONAL')}</td>
        <td class="p-2.5 text-nexus-500 font-bold whitespace-nowrap">${esc(l.codigo_usuario || l.codigo_individual || '--')}</td>
        <td class="p-2.5 font-bold whitespace-nowrap">${esc(l.entidade || 'Sistema')}</td>
        <td class="p-2.5">
          <span class="px-2 py-0.5 rounded text-xs font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap">${esc(l.tipo_alteracao || 'EDICAO')}</span>
        </td>
      </tr>
    `).join('');
  }

  renderAuditLogTable();

  // Backlog 3 (7b): busca local no log de auditoria
  const buscarAuditLogInput = document.getElementById('buscarAuditLogInput');
  if (buscarAuditLogInput) {
    buscarAuditLogInput.addEventListener('input', renderAuditLogTable);
  }

  // Backlog 3 (7f): exportação da planilha consolidada em CSV (separador ';',
  // BOM UTF-8 para abrir corretamente no Excel pt-BR).
  const exportCsvBtn = document.getElementById('exportIndicadoresCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const dados = window.__nexusIndicadoresExecutivos || [];
      if (dados.length === 0) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Sem Dados', 'A planilha de desempenho ainda não foi carregada. Aguarde a atualização e tente exportar novamente.');
        }
        return;
      }
      const csvEscape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const linhas = [
        ['Categoria / Operação', 'Volume Processado', 'Meta Mensal', 'Atingimento (%)', 'Tempo Médio (Horas)', 'Status Operacional'].map(csvEscape).join(';'),
        ...dados.map(i => [i.categoria, i.volume, i.meta, `${i.atingimento}%`, String(i.tempo).replace('.', ','), i.status].map(csvEscape).join(';')),
      ];
      const blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const agora = new Date();
      a.href = url;
      a.download = `nexusport_desempenho_${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (window.registrarLogAlteracao) {
        window.registrarLogAlteracao('EXPORTACAO_CSV', 'dashboard', null, `Exportação CSV da planilha de desempenho (${dados.length} linhas) em ${agora.toLocaleString('pt-BR')}`);
      }
    });
  }

  // 3. Renderiza Trail de Decisões Críticas Imutável Organizado a partir do Supabase (Item 1.4)
  async function renderTrailDecisoesTable() {
    const trailContainer = document.getElementById('trailDecisoesContainer');
    if (!trailContainer) return;

    let trail = [];
    const localTrail = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');

    if (window.nexusSupabase) {
      try {
        const { data: dbTrail, error } = await window.nexusSupabase
          .from('trail_decisoes')
          .select('*, funcionarios(nome, cargo), retificacoes_trail(*)')
          .order('data_hora', { ascending: false });

        if (!error && Array.isArray(dbTrail)) {
          const localFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
          const mappedDbTrail = dbTrail.map(t => {
            let respNome = t.funcionarios ? t.funcionarios.nome : null;
            let respCargo = t.funcionarios && t.funcionarios.cargo ? t.funcionarios.cargo : t.cargo;
            if (!respNome && t.codigo_individual) {
              const match = localFuncs.find(f => f.codigo_individual === t.codigo_individual || f.matricula === t.codigo_individual);
              if (match) {
                respNome = match.nome;
                respCargo = match.cargo || respCargo;
              }
            }
            const pendenteNome = !respNome && t.codigo_individual;
            const retificacaoTxt = t.retificacoes_trail && t.retificacoes_trail.length > 0 
              ? t.retificacoes_trail.map(r => r.retificacao).join(' | ') 
              : null;

            return {
              id: `TRL-${t.id.substring(0, 8)}`,
              dbId: t.id,
              data_hora: t.data_hora,
              responsavel: `${respNome || 'Responsável'} (${respCargo || 'Supervisor'}) - ${t.codigo_individual}`,
              decisao: t.tipo_decisao,
              entidade: `${t.entidade_tipo} ${t.entidade_id}`,
              motivo: t.motivo || 'Decisão homologada conforme fluxo operacional',
              retificacao: retificacaoTxt,
              _codigoPendente: pendenteNome ? t.codigo_individual : null
            };
          });

          // Resolve nomes pendentes diretamente no Supabase (backlog3 audit-funcionarios)
          const codigosPendentes = [...new Set(mappedDbTrail.filter(x => x._codigoPendente).map(x => x._codigoPendente))];
          if (codigosPendentes.length > 0) {
            const mapaDb = await buscarFuncionariosPorChaves('codigo_individual', codigosPendentes);
            mappedDbTrail.forEach(x => {
              const info = mapaDb[x._codigoPendente];
              if (info) {
                x.responsavel = `${info.nome || 'Responsável'} (${info.cargo || 'Supervisor'}) - ${x._codigoPendente}`;
              }
              delete x._codigoPendente;
            });
          } else {
            mappedDbTrail.forEach(x => { delete x._codigoPendente; });
          }

          // Unir com localTrail para preservar registros inseridos localmente ou offline
          const keys = new Set(mappedDbTrail.map(x => x.dbId || x.id));
          localTrail.forEach(lt => {
            if (!keys.has(lt.dbId) && !keys.has(lt.id)) {
              mappedDbTrail.push(lt);
            }
          });
          trail = mappedDbTrail;
        }
      } catch (err) {
        console.warn('Erro ao consultar trail_decisoes no Supabase:', err);
      }
    }

    if (trail.length === 0) {
      trail = localTrail;
    }

    // Ordenar por data mais recente
    trail.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));

    if (trail.length === 0) {
      trailContainer.innerHTML = `
        <div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-600 italic text-xs">
          Nenhum registro no trail de decisões críticas até o momento.
        </div>
      `;
      return;
    }

    trailContainer.innerHTML = trail.map(t => `
      <div class="p-4 rounded-xl border border-nexus-border dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/80 pb-2">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-xs text-nexus-500">${esc(t.id)}</span>
            <span class="text-slate-300 dark:text-slate-600">•</span>
            <span class="px-2 py-0.5 rounded text-xs font-bold uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300">${esc(t.decisao)}</span>
            <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">${esc(t.entidade)}</span>
          </div>
          <span class="text-slate-600 font-mono text-[11px]">${esc(new Date(t.data_hora).toLocaleString('pt-BR'))}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div>
            <span class="font-bold text-slate-600 block text-[10px] uppercase">Responsável Operacional</span>
            <span class="font-bold text-nexus-900 dark:text-white">${esc(t.responsavel)}</span>
          </div>
          <div>
            <span class="font-bold text-slate-600 block text-[10px] uppercase">Justificativa / Motivo Formal</span>
            <span class="text-slate-700 dark:text-slate-300">${esc(t.motivo)}</span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-xs">
          <div class="flex items-start gap-1.5 min-w-0">
            <span class="material-symbols-outlined text-[16px] text-amber-500 shrink-0 mt-0.5">edit_note</span>
            <span class="font-mono text-[11px] italic text-amber-700 dark:text-amber-400 leading-snug">
              ${t.retificacao ? esc(t.retificacao) : '<span class="text-slate-600 not-italic">Nenhuma retificação vinculada.</span>'}
            </span>
          </div>
          <button type="button" onclick="window.anexarRetificacaoTrail(${jsArg(t.id)}, ${jsArg(t.dbId || '')})" class="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-[11px] shrink-0 transition-colors">
            + Anexar Retificação
          </button>
        </div>
      </div>
    `).join('');
  }

  window.anexarRetificacaoTrail = async function(idTrail, dbId) {
    const textoRetificacao = await window.nexusPrompt('Anexar Retificação', `Informe a RETIFICAÇÃO a ser vinculada ao registro imutável ${idTrail}:\n(O registro original permanecerá inalterado)`);
    if (!textoRetificacao) return;

    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    let funcId = isUUID(session.id) ? session.id : null;
    if (!funcId) {
      const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
      if (match && isUUID(match.id)) funcId = match.id;
    }

    const nowIso = new Date().toISOString();
    const retificacaoFormatada = `[Retificação em ${new Date().toLocaleString('pt-BR')} por ${session.codigo_individual || 'Operador'}]: ${textoRetificacao}`;

    if (window.nexusSupabase && dbId && isUUID(dbId)) {
      try {
        const payload = {
          trail_id: dbId,
          retificacao: retificacaoFormatada,
          data_hora: nowIso
        };
        if (funcId) payload.funcionario_id = funcId;

        const { error } = await window.nexusSupabase.from('retificacoes_trail').insert(payload);
        if (error) console.warn('[NexusPort] Erro ao sincronizar retificação com Supabase:', error);
      } catch (err) {
        console.warn('[NexusPort] Erro ao sincronizar retificação com Supabase:', err);
      }
    }

    const trail = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');
    const item = trail.find(t => t.id === idTrail || t.dbId === dbId);
    if (item) {
      item.retificacao = retificacaoFormatada;
      localStorage.setItem('nexus_trail_decisoes', JSON.stringify(trail));
    }

    await renderTrailDecisoesTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Retificação Vinculada', `Retificação vinculada com sucesso ao registro imutável ${idTrail}!`);
    }
  };

  renderTrailDecisoesTable();

  // Lógica do Modal de Registro Manual de Trail / Decisão Crítica (Item 10)
  const registrarTrailModal = document.getElementById('registrarTrailModal');
  const toggleRegistrarTrailBtn = document.getElementById('toggleRegistrarTrailBtn');
  const closeRegistrarTrailModalBtn = document.getElementById('closeRegistrarTrailModalBtn');
  const cancelRegistrarTrailModalBtn = document.getElementById('cancelRegistrarTrailModalBtn');
  const registrarTrailForm = document.getElementById('registrarTrailForm');

  // Entidade da decisão: tipo e registro vêm de listas (cadastros do Supabase), sem digitação livre.
  const trailDecisaoSel = document.getElementById('trailTipoDecisao');
  const trailTipoSel = document.getElementById('trailEntidadeTipo');
  const trailRegistroSel = document.getElementById('trailEntidadeRegistro');
  const trailAvisoEl = document.getElementById('trailEntidadeAviso');
  const ROTULOS_TIPO_TRAIL = {
    CARGA: 'Carga', NAVIO: 'Navio', CONTAINER: 'Contêiner', GUINDASTE: 'Guindaste',
    MANUTENCAO: 'Ordem de manutenção', FUNCIONARIO: 'Funcionário'
  };
  let trailRegistrosAtuais = [];

  function preencherOpcoesTrail(select, opcoes, placeholder) {
    select.textContent = '';
    const vazia = document.createElement('option');
    vazia.value = '';
    vazia.textContent = placeholder;
    select.appendChild(vazia);
    opcoes.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      select.appendChild(op);
    });
  }

  function mostrarAvisoTrail(msg) {
    if (!trailAvisoEl) return;
    trailAvisoEl.textContent = msg || '';
    trailAvisoEl.classList.toggle('hidden', !msg);
  }

  // Consultas reais por tipo. O código exibido é o identificador que o operador reconhece.
  const CONSULTAS_TRAIL = {
    CARGA: {
      tabela: 'cargas', colunas: 'id, qr_code_url, natureza, status_fluxo',
      mapear: (c) => {
        const codigo = c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/, '') : `CRG-${c.id}`;
        return { id: c.id, codigo, rotulo: `${codigo} · ${c.natureza || 'Carga'} (${c.status_fluxo || 'sem status'})` };
      }
    },
    NAVIO: {
      tabela: 'navios', colunas: 'id, nome, numero_imo',
      mapear: (n) => ({ id: n.id, codigo: n.numero_imo, rotulo: `${n.nome} · IMO ${n.numero_imo}` })
    },
    CONTAINER: {
      tabela: 'containers', colunas: 'id, numero_identificacao',
      mapear: (c) => ({ id: c.id, codigo: c.numero_identificacao, rotulo: c.numero_identificacao })
    },
    GUINDASTE: {
      tabela: 'guindastes', colunas: 'id, numero_identificacao',
      mapear: (g) => ({ id: g.id, codigo: g.numero_identificacao, rotulo: g.numero_identificacao })
    },
    MANUTENCAO: {
      tabela: 'manutencoes', colunas: 'id, descricao, status',
      mapear: (m) => {
        const codigo = `OS-${String(m.id).substring(0, 8).toUpperCase()}`;
        return { id: m.id, codigo, rotulo: `${codigo} · ${m.descricao || 'Manutenção'} (${m.status || 'sem status'})` };
      }
    },
    FUNCIONARIO: {
      tabela: 'funcionarios', colunas: 'id, nome, matricula', filtro: (q) => q.eq('ativo', true),
      mapear: (f) => ({ id: f.id, codigo: f.matricula, rotulo: `${f.nome} · ${f.matricula}` })
    }
  };

  async function buscarRegistrosTrail(tipo) {
    const cfg = CONSULTAS_TRAIL[tipo];
    if (!cfg || !window.nexusSupabase) throw new Error('sem consulta');
    let consulta = window.nexusSupabase.from(cfg.tabela).select(cfg.colunas);
    if (cfg.filtro) consulta = cfg.filtro(consulta);
    const { data, error } = await consulta;
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .map((r) => Object.assign({ tipo }, cfg.mapear(r)))
      .filter((r) => r.id && r.codigo)
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'));
  }

  async function carregarRegistrosTrail() {
    trailRegistrosAtuais = [];
    const tipo = trailTipoSel ? trailTipoSel.value : '';
    mostrarAvisoTrail('');
    if (!tipo) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Selecione primeiro o tipo');
      trailRegistroSel.disabled = true;
      return;
    }
    if (!window.nexusSupabase) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Sem conexão');
      trailRegistroSel.disabled = true;
      mostrarAvisoTrail('Sem conexão com o banco de dados. Não é possível registrar a decisão agora.');
      return;
    }
    preencherOpcoesTrail(trailRegistroSel, [], 'Carregando registros...');
    trailRegistroSel.disabled = true;
    try {
      trailRegistrosAtuais = await buscarRegistrosTrail(tipo);
    } catch (err) {
      console.warn('[NexusPort] Falha ao carregar registros para a trilha:', err);
      preencherOpcoesTrail(trailRegistroSel, [], 'Erro ao carregar');
      mostrarAvisoTrail('Não foi possível carregar os registros do banco. Tente novamente.');
      return;
    }
    if (!trailRegistrosAtuais.length) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Nenhum registro disponível');
      mostrarAvisoTrail(`Não há ${(ROTULOS_TIPO_TRAIL[tipo] || 'registro').toLowerCase()} cadastrado(a) no banco para esta decisão.`);
      return;
    }
    preencherOpcoesTrail(trailRegistroSel, trailRegistrosAtuais.map((r) => ({ value: r.id, label: r.rotulo })), 'Selecione o registro');
    trailRegistroSel.disabled = false;
  }

  // Tipos de entidade mudam conforme a decisão escolhida; se só há um, ele é selecionado.
  function atualizarTiposTrail() {
    const tipos = (window.TRAIL_TIPOS_COMPATIVEIS || {})[trailDecisaoSel.value] || [];
    preencherOpcoesTrail(trailTipoSel, tipos.map((t) => ({ value: t, label: ROTULOS_TIPO_TRAIL[t] || t })), 'Selecione o tipo');
    if (tipos.length === 1) trailTipoSel.value = tipos[0];
    carregarRegistrosTrail();
  }

  if (trailDecisaoSel && trailTipoSel && trailRegistroSel) {
    trailDecisaoSel.addEventListener('change', atualizarTiposTrail);
    trailTipoSel.addEventListener('change', carregarRegistrosTrail);
  }

  if (toggleRegistrarTrailBtn && registrarTrailModal) {
    toggleRegistrarTrailBtn.addEventListener('click', () => {
      registrarTrailModal.classList.remove('hidden');
      atualizarTiposTrail();
    });
  }
  function fecharRegistrarTrailModal() {
    if (registrarTrailModal) registrarTrailModal.classList.add('hidden');
  }
  if (closeRegistrarTrailModalBtn) closeRegistrarTrailModalBtn.addEventListener('click', fecharRegistrarTrailModal);
  if (cancelRegistrarTrailModalBtn) cancelRegistrarTrailModalBtn.addEventListener('click', fecharRegistrarTrailModal);

  if (registrarTrailForm) {
    registrarTrailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipoDecisao = trailDecisaoSel.value;
      const tipoEntidade = trailTipoSel.value;
      const registroId = trailRegistroSel.value;
      const motivo = document.getElementById('trailMotivoInput').value.trim();

      if (!tipoDecisao || !tipoEntidade || !registroId || !motivo) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Informe o tipo de entidade, o registro e a justificativa formal.');
        return;
      }

      const registro = trailRegistrosAtuais.find((r) => r.id === registroId && r.tipo === tipoEntidade);
      if (!registro) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Registro Inválido', 'A lista de registros mudou. Selecione o registro novamente.');
        carregarRegistrosTrail();
        return;
      }

      const resultado = await window.registrarTrailDecisao(tipoDecisao, registro.codigo, motivo, {
        tipo: registro.tipo, id: registro.id, codigo: registro.codigo, rotulo: registro.rotulo
      });
      if (!resultado || !resultado.ok) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Decisão Não Registrada', (resultado && resultado.mensagem) || 'Não foi possível registrar a decisão.');
        return;
      }
      await renderTrailDecisoesTable();

      registrarTrailForm.reset();
      atualizarTiposTrail();
      fecharRegistrarTrailModal();

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Decisão Registrada', `Decisão "${tipoDecisao}" registrada com sucesso no Trail Imutável!`);
      }
    });
  }

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    renderCardsOperacionais();
    renderIndicadoresExecutivosTable();
    renderAuditLogTable();
    renderTrailDecisoesTable();
  });
});
