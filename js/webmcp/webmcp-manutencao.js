/**
 * WebMCP — página Manutenção & OS (js/webmcp/webmcp-manutencao.js) — NexusPort
 *
 * Ordens de serviço (aprovação, reprovação e conclusão pelo Supervisor/Direção),
 * manutenção de guindastes e abertura de OS. O formulário de manutenção de navio
 * é apenas PREENCHIDO pelo agente; o envio é sempre feito pelo operador.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // Mesmos cargos que PAGE_PERMISSIONS['manutencao.html'] e isSupervisor da página.
  const CARGOS_PAGINA = G.gestaoOperacional;
  const CARGOS_SUPERVISAO = G.supervisao;
  const ESQUEMA_OS = { type: 'string', minLength: 5, maxLength: 40, pattern: '^[A-Za-z0-9._-]{5,40}$', rotulo: 'Ordem de serviço', description: 'Número da OS, por exemplo OS-2026-123.' };
  const ESQUEMA_GUINDASTE = { type: 'string', minLength: 9, maxLength: 11, pattern: '^[A-Za-z]{3}-?\\d{3}-?[A-Za-z]{3}$', rotulo: 'Guindaste', description: 'Identificação do guindaste no padrão ABC-123-DEF (o hífen é aceito também sem separação).' };

  function osLocal(id) {
    return D.ordens().find((o) => o.id === id) || null;
  }

  function guindasteLocal(id) {
    return D.guindastes().find((g) => NexusCodigos.chave(g.identificacao) === NexusCodigos.chave(id)) || null;
  }

  const listarOrdens = {
    nome: 'listar_ordens_servico',
    titulo: 'Ordens de serviço',
    descricao: 'Lista as ordens de serviço de manutenção com status, prioridade e equipamento. Filtra por status.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['SOLICITADA', 'APROVADA', 'EM_MANUTENCAO', 'CONCLUIDA', 'REPROVADA', 'RECUSADA'], rotulo: 'Status', description: 'Status da OS a listar.' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: (args) => {
      let lista = D.ordens();
      if (args.status) lista = lista.filter((o) => o.status === args.status);
      return {
        mensagem: `${lista.length} ordem(ns) de serviço.`,
        dados: { total: lista.length, itens: lista.slice(0, args.limite || 10).map((o) => D.resumirOrdem(o)) }
      };
    }
  };

  const obterOrdem = {
    nome: 'obter_ordem_servico',
    titulo: 'Detalhes da OS',
    descricao: 'Mostra os dados de uma ordem de serviço e as ações possíveis no status atual.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: { id: ESQUEMA_OS }, required: ['id'], additionalProperties: false },
    executar: (args) => {
      const os = osLocal(args.id);
      if (!os) return { ok: false, codigo: 'OS_NAO_ENCONTRADA', mensagem: `Ordem ${args.id} não encontrada.` };
      const acoes = [];
      if (os.status === 'SOLICITADA' && D.podeUsar(executarAcao)) acoes.push('APROVAR', 'REPROVAR');
      if (os.status === 'EM_MANUTENCAO' && D.podeUsar(executarAcao)) acoes.push('CONCLUIR');
      return { mensagem: `OS ${os.id} (${os.status}).`, dados: Object.assign(D.resumirOrdem(os), { acoes_possiveis: acoes }) };
    }
  };

  const abrirOrdem = {
    nome: 'abrir_ordem_servico',
    titulo: 'Abrir ordem de serviço',
    descricao: 'Abre uma ordem de serviço para um equipamento ou navio, enviada para aprovação do Supervisor. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'SOLICITAR_MANUTENCAO',
    esquema: {
      type: 'object',
      properties: {
        equipamento: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Equipamento', description: 'Equipamento ou ativo da lista da tela (guindaste, contêiner ou navio).' },
        prioridade: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAIXA'], rotulo: 'Prioridade', description: 'Prioridade da ordem.' },
        descricao: { type: 'string', minLength: 5, maxLength: 300, rotulo: 'Descrição', description: 'Descrição objetiva do serviço (5 a 300 caracteres).' }
      },
      required: ['equipamento', 'prioridade', 'descricao'],
      additionalProperties: false
    },
    resumo: (args) => [`Abrir OS para ${args.equipamento} (prioridade ${args.prioridade}).`, `Descrição: ${args.descricao}`, 'A OS vai para aprovação do Supervisor.'],
    executar: async (args) => {
      const form = document.getElementById('osForm');
      const select = document.getElementById('osEquipamento');
      if (!form || !select) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Formulário de OS indisponível nesta página.' };
      const opcao = Array.from(select.options).find((o) => o.value === args.equipamento || o.textContent.trim() === args.equipamento);
      if (!opcao || !opcao.value) return { ok: false, codigo: 'EQUIPAMENTO_INVALIDO', mensagem: `Equipamento ${args.equipamento} não está na lista da tela.` };
      const antes = new Set(D.ordens().map((o) => o.id));
      form.classList.remove('hidden');
      D.definirCampo(form, 'osEquipamento', opcao.value);
      D.definirCampo(form, 'osPrioridade', args.prioridade);
      D.definirCampo(form, 'osDescricao', args.descricao);
      if (!form.checkValidity()) return { ok: false, codigo: 'FORMULARIO_INVALIDO', mensagem: 'Verifique os campos da ordem de serviço.' };
      form.requestSubmit();
      const nova = await D.esperar(() => D.ordens().some((o) => !antes.has(o.id)), 6000) ? D.ordens().find((o) => !antes.has(o.id)) : null;
      if (!nova) return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A OS não foi criada. Veja a mensagem exibida ao operador.' };
      return { mensagem: `OS ${nova.id} criada e enviada para aprovação.`, dados: D.resumirOrdem(nova) };
    }
  };

  const executarAcao = {
    nome: 'executar_acao_os',
    titulo: 'Aprovar, reprovar ou concluir OS',
    descricao: 'Aprova ou reprova uma OS solicitada, ou conclui uma OS em manutenção. Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_SUPERVISAO,
    permissao: 'APROVAR_MANUTENCAO',
    esquema: {
      type: 'object',
      properties: {
        id: ESQUEMA_OS,
        acao: { type: 'string', enum: ['APROVAR', 'REPROVAR', 'CONCLUIR'], rotulo: 'Ação', description: 'APROVAR e REPROVAR valem para OS solicitadas; CONCLUIR para OS em manutenção.' }
      },
      required: ['id', 'acao'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.id === undefined) return null;
      const os = osLocal(args.id);
      if (!os) return { codigo: 'OS_NAO_ENCONTRADA', mensagem: `Ordem ${args.id} não encontrada.` };
      const esperado = args.acao === 'CONCLUIR' ? 'EM_MANUTENCAO' : 'SOLICITADA';
      if (args.acao !== undefined && os.status !== esperado) {
        return { codigo: 'ESTADO_INVALIDO', mensagem: `A OS ${os.id} está em ${os.status}; ${args.acao} exige ${esperado}.` };
      }
      return null;
    },
    resumo: (args) => {
      const os = osLocal(args.id);
      const equipamento = os ? os.equipamento : args.id;
      const efeito = args.acao === 'APROVAR' ? 'Equipamento passa para EM_MANUTENCAO.'
        : args.acao === 'REPROVAR' ? 'A OS fica como REPROVADA.' : 'Equipamento volta a OPERANTE.';
      return [`${args.acao} a OS ${args.id} (${equipamento}).`, efeito];
    },
    executar: async (args) => {
      await window.executarAcaoOS(args.id, args.acao);
      const os = osLocal(args.id);
      const esperado = { APROVAR: 'EM_MANUTENCAO', REPROVAR: 'REPROVADA', CONCLUIR: 'CONCLUIDA' }[args.acao];
      if (os && os.status === esperado) return { mensagem: `OS ${args.id} atualizada para ${esperado}.`, dados: D.resumirOrdem(os) };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A OS não foi atualizada. Veja a mensagem exibida ao operador.' };
    }
  };

  const solicitarGuindaste = {
    nome: 'solicitar_manutencao_guindaste',
    titulo: 'Solicitar manutenção de guindaste',
    descricao: 'Coloca o guindaste EM_MANUTENÇÃO e abre a OS de manutenção (não permite duplicidade). Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_SUPERVISAO,
    permissao: 'SOLICITAR_MANUTENCAO',
    esquema: {
      type: 'object',
      properties: {
        identificacao: ESQUEMA_GUINDASTE,
        justificativa: { type: 'string', minLength: 5, maxLength: 200, rotulo: 'Justificativa', description: 'Falha ou motivo da manutenção (5 a 200 caracteres).' }
      },
      required: ['identificacao', 'justificativa'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.identificacao === undefined) return null;
      const g = guindasteLocal(args.identificacao);
      if (!g) return { codigo: 'GUINDASTE_NAO_ENCONTRADO', mensagem: `Guindaste ${args.identificacao.toUpperCase()} não cadastrado.` };
      if (g.estado === 'EM_MANUTENCAO') return { codigo: 'MANUTENCAO_DUPLICADA', mensagem: `O guindaste ${g.identificacao} já está em manutenção.` };
      return null;
    },
    resumo: (args) => [`Colocar o guindaste ${args.identificacao.toUpperCase()} EM_MANUTENÇÃO.`, 'Será aberta uma OS de prioridade ALTA.', `Justificativa: ${args.justificativa}`],
    executar: async (args) => {
      const id = args.identificacao.toUpperCase();
      await window.solicitarManutencaoGuindaste(id, { confirmado: true, descricao: args.justificativa });
      const g = guindasteLocal(id);
      if (g && g.estado === 'EM_MANUTENCAO') return { mensagem: `Manutenção solicitada para o guindaste ${id}.`, dados: D.resumirGuindaste(g) };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A manutenção não foi registrada. Veja a mensagem exibida ao operador.' };
    }
  };

  const concluirGuindaste = {
    nome: 'concluir_manutencao_guindaste',
    titulo: 'Concluir manutenção de guindaste',
    descricao: 'Conclui a manutenção de um guindaste EM_MANUTENÇÃO e o devolve a OPERANTE. Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_SUPERVISAO,
    permissao: 'APROVAR_MANUTENCAO',
    esquema: { type: 'object', properties: { identificacao: ESQUEMA_GUINDASTE }, required: ['identificacao'], additionalProperties: false },
    precondicao: (args) => {
      if (args.identificacao === undefined) return null;
      const g = guindasteLocal(args.identificacao);
      if (!g) return { codigo: 'GUINDASTE_NAO_ENCONTRADO', mensagem: `Guindaste ${args.identificacao.toUpperCase()} não cadastrado.` };
      if (g.estado !== 'EM_MANUTENCAO') return { codigo: 'ESTADO_INVALIDO', mensagem: `O guindaste ${g.identificacao} não está em manutenção.` };
      return null;
    },
    resumo: (args) => [`Concluir a manutenção do guindaste ${args.identificacao.toUpperCase()}.`, 'Estado: EM_MANUTENÇÃO → OPERANTE.'],
    executar: async (args) => {
      const id = args.identificacao.toUpperCase();
      await window.concluirManutencaoGuindaste(id, { confirmado: true });
      const g = guindasteLocal(id);
      if (g && g.estado === 'OPERANTE') return { mensagem: `Manutenção do guindaste ${id} concluída.`, dados: D.resumirGuindaste(g) };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A conclusão não foi registrada. Veja a mensagem exibida ao operador.' };
    }
  };

  // Formulário de manutenção de navio: somente preenchimento; o envio é do operador.
  function criarPrepararManutencaoNavio() {
    const form = document.getElementById('navioManutForm');
    if (!form || typeof W.formularioComoFerramenta !== 'function') return null;
    return W.formularioComoFerramenta({
      nome: 'preparar_manutencao_navio',
      titulo: 'Preparar manutenção de navio',
      descricao: 'Preenche o formulário de manutenção de navio sem enviar. O operador revisa e envia pelo próprio botão.',
      cargos: CARGOS_PAGINA,
      permissao: 'SOLICITAR_MANUTENCAO',
      elemento: form,
      campos: {
        navioManutSelect: { descricao: 'Navio, como aparece na lista do formulário.', rotulo: 'Navio' },
        navioTipoManutSelect: { descricao: 'Tipo: PREVENTIVA, CORRETIVA, PREDITIVA ou GERAL.', rotulo: 'Tipo' },
        navioDescManut: { descricao: 'Descrição da manutenção do navio.', rotulo: 'Descrição' }
      }
    });
  }

  const ferramentas = [listarOrdens, obterOrdem, abrirOrdem, executarAcao, solicitarGuindaste, concluirGuindaste];

  D.quandoPronto(() => {
    const todas = ferramentas.slice();
    const preparar = D.seguro(criarPrepararManutencaoNavio, 'preparar_manutencao_navio');
    if (preparar) todas.push(preparar);
    W.registrarPagina({ id: 'manutencao', arquivo: 'manutencao.html', ferramentas: todas });
  });
})(window, document);
