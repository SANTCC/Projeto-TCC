/** Auditoria compartilhada: preservar tipo, código e referência em decisões e logs. */
(function (window) {
'use strict';

// Os nomes de tabela e referências explícitas têm precedência sobre o formato do código.
const AUDIT_TABELAS = {
  cargas:'CARGA', navios:'NAVIO', containers:'CONTAINER', guindastes:'GUINDASTE',
  funcionarios:'FUNCIONARIO', delegacoes_supervisor:'FUNCIONARIO', documentos_funcionarios:'FUNCIONARIO',
  manutencoes:'MANUTENCAO', visitantes:'VISITANTE', checklists:'CHECKLIST',
  checklist_modelos:'CHECKLIST', rotas_maritimas:'ROTA', tipos_carga:'TIPO_CARGA'
};
const AUDIT_TIPOS = new Set([...Object.values(AUDIT_TABELAS), 'EMERGENCIA']);
function resolverEntidadeAuditoria(entidade, referencia) {
  const codigo = String((referencia && referencia.codigo) || entidade || '').trim();
  if (referencia && referencia.tipo) {
    return { tipo: AUDIT_TIPOS.has(referencia.tipo) ? referencia.tipo : null, codigo,
      id: referencia.id || null };
  }
  const entUpper = codigo.toUpperCase();
  let tipo = null;
  if (/^(MAT|FUNC|FUN|NX|SUP|INS|EST|TEC|CONF|ARR|PLAN)-/.test(entUpper)) tipo = 'FUNCIONARIO';
  else if (/^(NAVIO|NAV|IMO)(-|\s|\d)/.test(entUpper)) tipo = 'NAVIO';
  else if (/^(CONT|CONTAINER|CONTÊINER)(-|\s)/.test(entUpper) || /^[A-Z]{4}-?\d{7}$/.test(entUpper)) tipo = 'CONTAINER';
  else if (/^(GND|GUINDASTE)(-|\s)/.test(entUpper) || /^[A-Z]{3}-\d{3}-[A-Z]{3}$/.test(entUpper)) tipo = 'GUINDASTE';
  else if (/^(MANUT|OS)-/.test(entUpper)) tipo = 'MANUTENCAO';
  else if (/^(VIS|VISITANTE)-/.test(entUpper)) tipo = 'VISITANTE';
  else if (entUpper.includes('EMERGENCIA')) tipo = 'EMERGENCIA';
  // Compatibilidade com a API histórica de códigos de carga sem metadados.
  return {tipo: tipo || 'CARGA', codigo, id:null};
}
function limparCacheAuditoriaLocal() {
  try {
    localStorage.removeItem('nexus_audit_logs');
    localStorage.removeItem('nexus_trail_decisoes');
    localStorage.setItem('nexus_audit_clean_v2', 'true');
  } catch (e) {}
  if (typeof window.dispatchEvent === 'function' && typeof window.CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: 'logs_alteracoes' } }));
    window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: 'trail_decisoes' } }));
  }
}
window.limparCacheAuditoriaLocal = limparCacheAuditoriaLocal;
window.NexusAuditoria = {
  resolverEntidade: resolverEntidadeAuditoria,
  descricaoDoLog: descricaoDoLog,
  limparCacheLocal: limparCacheAuditoriaLocal
};

// Tarefa 9 (Correções): frase legível e única do que foi feito no sistema —
// gravada no log local e no banco (detalhes.descricao) e exibida no log geral
// do Painel Geral, no lugar da leitura vaga "entidade + tipo". Detalhes
// informados como texto (ex.: "Recebimento físico registrado pelo Conferente
// de Carga") têm precedência; sem eles, a frase é montada com o verbo do tipo
// de alteração + o rótulo da entidade + o código legível (nunca UUID cru).
const AUDIT_VERBOS = {
  CRIACAO: 'Criou',
  EDICAO: 'Editou',
  EXCLUSAO: 'Excluiu',
  REIMPRESSAO_ETIQUETA: 'Reimprimiu a etiqueta de',
  EXPORTACAO: 'Gerou o PDF de',
  GERACAO_PDF: 'Gerou o PDF de'
};
const AUDIT_ROTULOS_ENTIDADE = {
  CARGA: 'a carga',
  NAVIO: 'o navio',
  CONTAINER: 'o contêiner',
  GUINDASTE: 'o guindaste',
  FUNCIONARIO: 'o funcionário',
  MANUTENCAO: 'a ordem de serviço',
  VISITANTE: 'o visitante',
  CHECKLIST: 'o checklist',
  ROTA: 'a rota marítima',
  TIPO_CARGA: 'o tipo de carga',
  EMERGENCIA: 'a emergência'
};
function descricaoDoLog(registro) {
  if (!registro) return '';
  const det = registro.detalhes;
  const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const limparUuidEmTexto = (s) => String(s || '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const tipoEntUpper = String(registro.entidade_tipo || '').toUpperCase();
  const textoDet = typeof det === 'string' ? det.trim() : String((det && det.descricao) || '').trim();
  if (textoDet) return limparUuidEmTexto(textoDet);
  if (tipoEntUpper === 'EMERGENCIA') {
    const estado = String((det && (det.estado || det.status)) || registro.entidade_id || '').toUpperCase();
    if (estado.includes('DESATIV') || estado.includes('RESOLV')) {
      return 'Botão de emergência desativado — Operações normalizadas';
    }
    const motivo = det && det.motivo ? limparUuidEmTexto(det.motivo) : '';
    return motivo
      ? `Botão de emergência ativado — Motivo: ${motivo}`
      : 'Botão de emergência ativado no terminal';
  }
  const tipo = String(registro.tipo_alteracao || '').toUpperCase();
  const verbo = AUDIT_VERBOS[tipo] || 'Alterou';
  const rotulo = AUDIT_ROTULOS_ENTIDADE[tipoEntUpper] || 'o registro';
  let codigo = String(registro.entidade_id || '').trim();
  if (!codigo || codigo.toUpperCase() === 'N/A' || ehUuid(codigo)) {
    // UUID cru não comunica nada ao operador: prefere um código legível dos
    // detalhes (para navio e funcionário, prioriza o nome; para contêiner e guindaste, numero_identificacao).
    let candidatos;
    if (tipoEntUpper === 'NAVIO') {
      candidatos = [det && det.nome, det && det.navio, det && det.codigo, det && !ehUuid(det.id) ? det.id : '', det && det.numero_imo];
    } else if (tipoEntUpper === 'FUNCIONARIO') {
      candidatos = [det && det.nome, det && det.funcionario, det && det.substituto, det && det.codigo, det && !ehUuid(det.id) ? det.id : '', det && det.matricula];
    } else if (tipoEntUpper === 'CONTAINER' || tipoEntUpper === 'GUINDASTE') {
      candidatos = [det && det.numero_identificacao, det && det.identificacao, det && det.codigo, det && !ehUuid(det.id) ? det.id : '', det && det.nome];
    } else {
      candidatos = [det && det.codigo, det && !ehUuid(det.id) ? det.id : '', det && det.qr_code_url ? String(det.qr_code_url).replace(/^QR-/i, '') : '', det && det.numero_identificacao, det && det.identificacao, det && det.matricula, det && det.nome];
    }
    codigo = (det && typeof det === 'object')
      ? String(candidatos.find((v) => v && !ehUuid(v)) || '').trim()
      : '';
  }
  return limparUuidEmTexto(codigo ? `${verbo} ${rotulo} ${codigo}` : `${verbo} ${rotulo}`);
}

// Funções utilitárias globais exigidas para integração (T7.1, T7.3, T8.3 - T8.6, T6.8)
window.registrarLogAlteracao = async function(entidade, tipoAlteracao, detalhes = '', referencia = null) {
  if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly()) {
    return { ok: false, mensagem: 'Perfil Espectador (MAT-1111) possui acesso somente leitura.' };
  }
  // Suporta também (tipoAlteracao, tabela, id, detalhes), usado pelos cadastros.
  if (AUDIT_TABELAS[tipoAlteracao]) {
    const tabela = tipoAlteracao;
    const id = detalhes;
    detalhes = referencia || {};
    tipoAlteracao = entidade;
    entidade = id || (detalhes && detalhes.matricula) || tabela;
    referencia = {tipo:AUDIT_TABELAS[tabela], id:id || null, codigo:String(entidade)};
  }
  const alvo = resolverEntidadeAuditoria(entidade, referencia);
  if (!alvo.tipo) return {ok:false, mensagem:'Tipo de entidade inválido para auditoria.'};
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
  if (tipoUpper === 'GERACAO_PDF' || tipoUpper === 'EXPORTACAO') {
    tipoEnum = 'EXPORTACAO';
  } else if (validTipos.includes(tipoUpper)) {
    tipoEnum = tipoUpper;
  } else if (tipoUpper.includes('CRI')) tipoEnum = 'CRIACAO';
  else if (tipoUpper.includes('EXCLU') || tipoUpper.includes('DELET')) tipoEnum = 'EXCLUSAO';
  else if (tipoUpper.includes('ETIQUETA')) tipoEnum = 'REIMPRESSAO_ETIQUETA';
  const tipoExibicao = tipoEnum === 'EXPORTACAO' ? 'GERACAO_PDF' : tipoEnum;

  const entidadeTipo = alvo.tipo;
  const entidadeId = alvo.codigo;

  const validCargos = [
    'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 
    'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 
    'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 
    'CONSELHO_ADMINISTRACAO'
  ];
  let cargoEnum = 'ESTIVADOR';
  if (validCargos.includes(session.cargo)) cargoEnum = session.cargo;

  const nowIso = new Date().toISOString();

  // Tarefa 9 (Correções): frase única do que foi feito (texto explícito nos
  // detalhes tem precedência; sem ele, verbo + entidade + código legível).
  const descricaoLog = descricaoDoLog({ tipo_alteracao: tipoExibicao, entidade_tipo: entidadeTipo, entidade_id: entidadeId, detalhes });

  if (window.nexusSupabase) {
    try {
      const detalhesPayload = Object.assign({}, typeof detalhes === 'object' ? detalhes : { descricao: detalhes }, { referencia_id: alvo.id });
      if (!detalhesPayload.descricao) detalhesPayload.descricao = descricaoLog;
      if (tipoExibicao === 'GERACAO_PDF') detalhesPayload.acao_exibicao = 'GERACAO_PDF';
      if (String(tipoAlteracao || '').toUpperCase().includes('ENTREGOU_CARGA')) {
        detalhesPayload.acao_exibicao = 'ENTREGOU_CARGA';
        detalhesPayload.status_fluxo = 'ENTREGUE';
      }
      const payload = {
        data_hora: nowIso,
        cargo: cargoEnum,
        codigo_individual: session.codigo_individual || session.codigo || '--',
        entidade_tipo: entidadeTipo,
        entidade_id: entidadeId || 'N/A',
        tipo_alteracao: tipoEnum,
        detalhes: detalhesPayload
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
    entidade_tipo: entidadeTipo,
    entidade_id: entidadeId,
    tipo_alteracao: tipoExibicao,
    descricao: descricaoLog,
    detalhes: detalhes
  };
  logs.unshift(newLog);
  localStorage.setItem('nexus_audit_logs', JSON.stringify(logs));

  const suprimirNotify = !!(referencia && referencia.suprimirNotifyRepository);
  if (!suprimirNotify && window.NexusRepository && window.NexusRepository.notifyChange) {
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
  ENTREGOU_CARGA: ['CARGA'],
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
  if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly()) {
    return { ok: false, mensagem: 'Perfil Espectador (MAT-1111) possui acesso somente leitura.' };
  }
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
    'APROVOU_CARGA', 'RECUSOU_CARGA', 'ENTREGOU_CARGA', 'SOLICITOU_MANUTENCAO_NAVIO', 
    'SOLICITOU_MANUTENCAO_CONTAINER', 'LIBEROU_NAVIO', 'CANCELOU_ENTREGA', 
    'APROVOU_MANUTENCAO', 'RECUSOU_MANUTENCAO', 'DESIGNOU_SUBSTITUTO'
  ];
  let decisaoEnum = 'APROVOU_CARGA';
  const decUpper = String(decisao || '').toUpperCase();
  if (validDecisoes.includes(decUpper)) {
    decisaoEnum = decUpper;
  } else if (decUpper.includes('ENTREG') && !decUpper.includes('CANCEL')) {
    decisaoEnum = 'ENTREGOU_CARGA';
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
    const tiposDaDecisao = TRAIL_TIPOS_COMPATIVEIS[decisaoEnum] || [];
    entidadeTipo = tiposDaDecisao.length === 1 ? tiposDaDecisao[0] : resolverEntidadeAuditoria(entidadeId).tipo;
  }
  if (decisaoEnum === 'ENTREGOU_CARGA') {
    detalhes = Object.assign({}, detalhes || {}, {
      acao_exibicao: 'ENTREGOU_CARGA',
      status_fluxo: 'ENTREGUE'
    });
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
      // Se o banco ainda não tiver 'ENTREGOU_CARGA' em tipo_decisao_enum, grava como
      // 'APROVOU_CARGA' preservando detalhes.acao_exibicao = 'ENTREGOU_CARGA'.
      if (resposta && resposta.error && decisaoEnum === 'ENTREGOU_CARGA') {
        payload.tipo_decisao = 'APROVOU_CARGA';
        payload.detalhes = Object.assign({}, payload.detalhes || {}, {
          acao_exibicao: 'ENTREGOU_CARGA',
          status_fluxo: 'ENTREGUE'
        });
        resposta = await window.nexusSupabase.from('trail_decisoes').insert(payload).select().maybeSingle();
      }
      const registroInserido = resposta && Array.isArray(resposta.data) ? resposta.data[0] : (resposta && resposta.data);
      if (!resposta.error && registroInserido && registroInserido.id) {
        insertedDbId = registroInserido.id;
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
    entidade_tipo: entidadeTipo,
    entidade_id: entidadeId,
    motivo: motivo || 'Decisão homologada conforme fluxo operacional',
    retificacao: null
  };
  trail.unshift(newEntry);
  localStorage.setItem('nexus_trail_decisoes', JSON.stringify(trail));

  if (window.registrarLogAlteracao) {
    await window.registrarLogAlteracao(entidadeId, `Decisão Crítica: ${decisaoEnum}`, motivo, {
      tipo: entidadeTipo,
      codigo: entidadeId,
      id: referencia ? referencia.id : null,
      suprimirNotifyRepository: !!(referencia && referencia.suprimirNotifyRepository)
    });
  }

  window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: 'trail_decisoes' } }));
  return { ok: true, id: idReg, dbId: insertedDbId };
};

const entregasAuditadasMemoria = new Set();

function extrairDadosEntregaCarga(carga, navio, historico) {
  if (!carga) return null;
  const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
  const candidatosCodigo = [
    carga.codigo,
    !ehUuid(carga.id) ? carga.id : '',
    carga.qrCode ? String(carga.qrCode).replace(/^QR-/i, '') : '',
    carga.qr_code_url ? String(carga.qr_code_url).replace(/^QR-/i, '') : ''
  ];
  const codigoCarga = String(candidatosCodigo.find((v) => v && String(v).trim() && !ehUuid(v)) || '').trim();
  if (!codigoCarga) return null;
  const idBanco = [carga.rawDbId, ehUuid(carga.id) ? carga.id : ''].find((v) => ehUuid(v)) || null;
  const nomeNavio = String(
    (historico && historico.navio_nome_historico)
    || (navio && navio.nome)
    || carga.navioNomeHistorico
    || carga.navio_nome_historico
    || (!ehUuid(carga.navio) && !/^Nenhum/i.test(String(carga.navio || '')) ? carga.navio : '')
    || ''
  ).trim();
  const identContainer = String(
    (historico && historico.container_identificacao_historico)
    || carga.containerIdentificacaoHistorico
    || carga.container_identificacao_historico
    || (!ehUuid(carga.container) && !/^Nenhum/i.test(String(carga.container || '')) ? carga.container : '')
    || ''
  ).trim();
  const destino = String(carga.destino || (navio && navio.destino) || '').trim();
  const detalhesPartes = [];
  if (destino && !/^destino não informado/i.test(destino)) detalhesPartes.push(`destino: ${destino}`);
  if (nomeNavio) detalhesPartes.push(`navio: ${nomeNavio}`);
  if (identContainer && !ehUuid(identContainer)) detalhesPartes.push(`contêiner: ${identContainer}`);
  const sufixo = detalhesPartes.length > 0 ? ` (${detalhesPartes.join(' · ')})` : '';
  const fraseEntrega = `Carga ${codigoCarga} marcada como ENTREGUE no porto de destino${sufixo}`;
  return {
    codigoCarga,
    idBanco,
    nomeNavio: nomeNavio || null,
    identContainer: identContainer || null,
    destino: destino || null,
    fraseEntrega,
    chaveCodigo: `${codigoCarga.toUpperCase()}:ENTREGUE`,
    chaveId: idBanco ? `${String(idBanco).toLowerCase()}:ENTREGUE` : null
  };
}

function entregaJaRegistradaLocalmente(dados) {
  if (!dados) return true;
  if (entregasAuditadasMemoria.has(dados.chaveCodigo) || (dados.chaveId && entregasAuditadasMemoria.has(dados.chaveId))) {
    return true;
  }
  try {
    const auditadas = JSON.parse(localStorage.getItem('nexus_entregas_auditadas') || '[]');
    if (Array.isArray(auditadas) && (auditadas.includes(dados.chaveCodigo) || (dados.chaveId && auditadas.includes(dados.chaveId)))) {
      entregasAuditadasMemoria.add(dados.chaveCodigo);
      if (dados.chaveId) entregasAuditadasMemoria.add(dados.chaveId);
      return true;
    }
    const trailLocal = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');
    if (Array.isArray(trailLocal) && trailLocal.some((t) => {
      const ent = String((t && (t.entidade_id || t.entidade)) || '').toUpperCase();
      const dec = String((t && t.decisao) || '').toUpperCase();
      const mot = String((t && t.motivo) || '');
      return ent.includes(dados.codigoCarga.toUpperCase())
        && (dec === 'ENTREGOU_CARGA' || /marcada como ENTREGUE|entregue no porto de destino/i.test(mot));
    })) {
      marcarEntregaAuditadaLocal(dados);
      return true;
    }
  } catch (e) {}
  return false;
}

function marcarEntregaAuditadaLocal(dados) {
  if (!dados) return;
  entregasAuditadasMemoria.add(dados.chaveCodigo);
  if (dados.chaveId) entregasAuditadasMemoria.add(dados.chaveId);
  try {
    const atual = JSON.parse(localStorage.getItem('nexus_entregas_auditadas') || '[]');
    const conjunto = new Set(Array.isArray(atual) ? atual : []);
    conjunto.add(dados.chaveCodigo);
    if (dados.chaveId) conjunto.add(dados.chaveId);
    localStorage.setItem('nexus_entregas_auditadas', JSON.stringify([...conjunto]));
  } catch (e) {}
}

window.registrarEntregaCargaAuditoria = async function(carga, navio = null, historico = null, opcoes = null) {
  if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly()) {
    return { ok: false, mensagem: 'Perfil Espectador (MAT-1111) possui acesso somente leitura.' };
  }
  const dados = extrairDadosEntregaCarga(carga, navio, historico);
  if (!dados) return { ok: false };
  if (entregaJaRegistradaLocalmente(dados)) {
    return { ok: true, jaAuditada: true };
  }

  // Se o banco já possui o registro de entrega no trail_decisoes (ex.: gravado por trigger ou outra aba),
  // marca como auditada sem duplicar linhas no Supabase.
  if (window.nexusSupabase && !(opcoes && opcoes.ignorarConsultaPrevia)) {
    try {
      const consulta = window.nexusSupabase
        .from('trail_decisoes')
        .select('id, tipo_decisao, entidade_id, motivo, detalhes')
        .eq('entidade_id', dados.codigoCarga);
      const res = await consulta;
      const linhas = res && Array.isArray(res.data) ? res.data : [];
      const jaNoBanco = linhas.some((t) => {
        const dec = String((t && t.tipo_decisao) || '').toUpperCase();
        const acao = t && t.detalhes && t.detalhes.acao_exibicao ? String(t.detalhes.acao_exibicao).toUpperCase() : '';
        const mot = String((t && t.motivo) || '');
        return dec === 'ENTREGOU_CARGA' || acao === 'ENTREGOU_CARGA' || /marcada como ENTREGUE|entregue no porto de destino/i.test(mot);
      });
      if (jaNoBanco) {
        marcarEntregaAuditadaLocal(dados);
        return { ok: true, jaAuditada: true };
      }
    } catch (e) {}
  }

  marcarEntregaAuditadaLocal(dados);
  return window.registrarTrailDecisao('ENTREGOU_CARGA', dados.codigoCarga, dados.fraseEntrega, {
    tipo: 'CARGA',
    id: dados.idBanco,
    codigo: dados.codigoCarga,
    rotulo: `Carga ${dados.codigoCarga}`,
    legado: true,
    suprimirNotifyRepository: !!(opcoes && opcoes.suprimirNotifyRepository)
  });
};

window.sincronizarAuditoriaCargasEntregues = async function(listaCargas, opcoes = null) {
  if (!Array.isArray(listaCargas) || listaCargas.length === 0) return [];
  if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly()) return [];
  const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
  const candidatas = listaCargas.filter((c) => {
    if (!c) return false;
    const st = String(c.status || c.status_fluxo || '').toUpperCase();
    if (st !== 'ENTREGUE') return false;
    const temUuid = ehUuid(c.rawDbId || c.id);
    const temHistorico = Boolean(
      c.navioNomeHistorico
      || c.navio_nome_historico
      || c.containerIdentificacaoHistorico
      || c.container_identificacao_historico
    );
    if (!temUuid || !temHistorico) return false;
    const dados = extrairDadosEntregaCarga(c, null, null);
    return dados && !entregaJaRegistradaLocalmente(dados);
  });
  if (candidatas.length === 0) return [];

  const resultados = [];
  for (const c of candidatas) {
    const r = await window.registrarEntregaCargaAuditoria(c, null, null, opcoes);
    resultados.push(r);
  }
  return resultados;
};

if (window.NexusAuditoria) {
  window.NexusAuditoria.registrarEntregaCarga = window.registrarEntregaCargaAuditoria;
  window.NexusAuditoria.sincronizarCargasEntregues = window.sincronizarAuditoriaCargasEntregues;
  window.NexusAuditoria.extrairDadosEntregaCarga = extrairDadosEntregaCarga;
}

})(window);
