/**
 * WebMCP — página Gestão de Pessoas / Técnico em Portos (js/webmcp/webmcp-tecnico.js) — NexusPort
 *
 * Dados sensíveis desta página (código individual, CPF/documentos, documento de visitante)
 * NUNCA saem para o agente:
 *   - a reemissão de código (RN 15) acontece na tela; o novo código só aparece para o operador;
 *   - cadastros com documento são apenas PREENCHIDOS (sem documento) e enviados pelo operador;
 *   - leituras mostram nome, cargo, matrícula, status e motivo, sem documentos.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // Mesmos cargos que PAGE_PERMISSIONS['tecnico_portos.html'].
  const CARGOS_PAGINA = ['TECNICO_PORTOS'].concat(G.direcao);
  const STATUS_VISITA = ['AGUARDANDO_AUTORIZACAO', 'EM_VISITA', 'CONCLUIDO'];
  const ESQUEMA_MATRICULA = {
    type: 'string', minLength: 2, maxLength: 20, pattern: '^(MAT-)?[A-Za-z0-9]{2,20}$',
    rotulo: 'Matrícula', description: 'Matrícula do funcionário, por exemplo MAT-2001 ou 2001.'
  };

  function normalizarMat(valor) {
    return String(valor || '').trim().toUpperCase();
  }

  function funcionarioPorMatricula(valor) {
    const q = normalizarMat(valor);
    const comPrefixo = q.startsWith('MAT-') ? q : `MAT-${q}`;
    return D.funcionarios().find((f) => {
      const m = normalizarMat(f.matricula);
      return m === q || m === comPrefixo;
    }) || null;
  }

  function visitantePorId(id) {
    return D.lerLista('nexus_vis_list').find((v) => v.id === id) || null;
  }

  function horaAgoraPtBr() {
    return new Date().toLocaleString('pt-BR');
  }

  const pesquisar = {
    nome: 'pesquisar_funcionario',
    titulo: 'Pesquisar funcionário',
    descricao: 'Mostra nome, cargo, matrícula e situação de um funcionário. Não mostra código de acesso nem documentos.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: { matricula: ESQUEMA_MATRICULA }, required: ['matricula'], additionalProperties: false },
    executar: (args) => {
      const f = funcionarioPorMatricula(args.matricula);
      if (!f) return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: `Funcionário ${normalizarMat(args.matricula)} não localizado.` };
      return { mensagem: `Funcionário ${f.nome}.`, dados: D.resumirFuncionario(f) };
    }
  };

  const listarFuncionarios = {
    nome: 'listar_funcionarios',
    titulo: 'Listar funcionários',
    descricao: 'Lista funcionários por nome ou cargo, com situação ativa ou inativa. Não mostra códigos nem documentos.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        nome: { type: 'string', maxLength: 120, rotulo: 'Nome', description: 'Trecho do nome do funcionário.' },
        cargo: { type: 'string', maxLength: 80, rotulo: 'Cargo', description: 'Trecho do cargo.' },
        ativo: { type: 'boolean', rotulo: 'Ativo', description: 'true para ativos, false para desativados.' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: (args) => {
      let lista = D.funcionarios();
      if (args.nome) lista = lista.filter((f) => D.contem(f.nome, args.nome));
      if (args.cargo) lista = lista.filter((f) => D.contem(f.cargo, args.cargo));
      if (args.ativo !== undefined) lista = lista.filter((f) => (f.ativo !== false) === args.ativo);
      return {
        mensagem: `${lista.length} funcionário(s).`,
        dados: { total: lista.length, itens: lista.slice(0, args.limite || 10).map((f) => D.resumirFuncionario(f)) }
      };
    }
  };

  const reemitir = {
    nome: 'reemitir_codigo_funcionario',
    titulo: 'Reemitir código de acesso',
    descricao: 'Invalida o código de acesso atual do funcionário e gera um novo, exibido SOMENTE na tela do Técnico em Portos (RN 15). Exige confirmação.',
    anotacoes: { consequentialHint: true },
    ocultarFeedback: true,
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: { matricula: ESQUEMA_MATRICULA }, required: ['matricula'], additionalProperties: false },
    precondicao: (args) => {
      if (args.matricula === undefined) return null;
      const f = funcionarioPorMatricula(args.matricula);
      if (!f || f.ativo === false) return { codigo: 'FUNCIONARIO_NAO_ENCONTRADO', mensagem: `Funcionário ${normalizarMat(args.matricula)} não localizado ou inativo.` };
      return null;
    },
    resumo: (args) => {
      const f = funcionarioPorMatricula(args.matricula);
      return [
        `Invalidar o código de acesso atual de ${f ? f.nome : normalizarMat(args.matricula)} e gerar um novo.`,
        'O novo código aparece somente na tela do Técnico em Portos; o agente não o recebe.',
        'O código antigo deixa de funcionar imediatamente.'
      ];
    },
    executar: async (args) => {
      const f = funcionarioPorMatricula(args.matricula);
      if (!f) return { ok: false, codigo: 'FUNCIONARIO_NAO_ENCONTRADO', mensagem: 'Funcionário não localizado.' };
      const antes = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');
      const marcaAntes = antes[f.matricula] ? antes[f.matricula].data_geracao : null;
      await window.nexusTecnicoReemitir(f.matricula, { confirmado: true });
      const depois = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');
      if (depois[f.matricula] && depois[f.matricula].data_geracao !== marcaAntes) {
        return {
          mensagem: `Código de ${f.nome} reemitido. O novo código foi exibido na tela do Técnico em Portos e não é informado ao agente.`,
          dados: { matricula: f.matricula, nome: f.nome }
        };
      }
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'O código não foi reemitido. Veja a mensagem exibida ao operador.' };
    }
  };

  const desativar = {
    nome: 'desativar_funcionario',
    titulo: 'Desativar funcionário',
    descricao: 'Desativa um funcionário, removendo o acesso dele ao sistema. Ação destrutiva. Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: { matricula: ESQUEMA_MATRICULA }, required: ['matricula'], additionalProperties: false },
    precondicao: (args) => {
      if (args.matricula === undefined) return null;
      return funcionarioPorMatricula(args.matricula) ? null : { codigo: 'FUNCIONARIO_NAO_ENCONTRADO', mensagem: `Funcionário ${normalizarMat(args.matricula)} não localizado.` };
    },
    resumo: (args) => {
      const f = funcionarioPorMatricula(args.matricula);
      return [`DESATIVAR o funcionário ${f ? f.nome : ''} (${f ? f.matricula : normalizarMat(args.matricula)}).`, 'O acesso dele ao sistema é removido.'];
    },
    executar: async (args) => {
      const f = funcionarioPorMatricula(args.matricula);
      if (!f) return { ok: false, codigo: 'FUNCIONARIO_NAO_ENCONTRADO', mensagem: 'Funcionário não localizado.' };
      await window.excluirFuncionarioReal(f.matricula, { confirmado: true });
      // Excluído (sumiu da lista) ou desativado (ativo = false, histórico preservado)
      const atual = D.funcionarios().find((x) => x.matricula === f.matricula);
      if (!atual || atual.ativo === false) return { mensagem: `Funcionário ${f.matricula} ${atual ? 'desativado (possui registros vinculados)' : 'excluído'}.`, dados: { matricula: f.matricula } };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'O funcionário não foi desativado. Veja a mensagem exibida ao operador.' };
    }
  };

  const listarVisitantes = {
    nome: 'listar_visitantes',
    titulo: 'Listar visitantes',
    descricao: 'Lista visitantes do livro de visitas por status e motivo. Não mostra documento nem o responsável pelo registro.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS_VISITA, rotulo: 'Status', description: 'Status da visita a listar.' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: async (args) => {
      let lista = await D.visitantes();
      if (args.status) lista = lista.filter((v) => v.status === args.status);
      return {
        mensagem: `${lista.length} visitante(s).`,
        dados: { total: lista.length, itens: lista.slice(0, args.limite || 10).map((v) => D.resumirVisitante(v)) }
      };
    }
  };

  const autorizarEntrada = {
    nome: 'autorizar_entrada_visitante',
    titulo: 'Autorizar entrada de visitante',
    descricao: 'Autoriza a entrada de um visitante que aguarda autorização (status EM_VISITA). Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'CADASTRAR_VISITANTE',
    esquema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 3, maxLength: 40, rotulo: 'Visitante', description: 'Identificador do visitante (ver listar_visitantes).' } },
      required: ['id'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.id === undefined) return null;
      const v = visitantePorId(args.id);
      if (!v) return { codigo: 'VISITANTE_NAO_ENCONTRADO', mensagem: `Visitante ${args.id} não encontrado.` };
      if (v.status !== 'AGUARDANDO_AUTORIZACAO') return { codigo: 'ESTADO_INVALIDO', mensagem: `O visitante está em ${v.status}; a entrada só é autorizada aguardando autorização.` };
      return null;
    },
    resumo: (args) => {
      const v = visitantePorId(args.id);
      return [`Autorizar a entrada do visitante ${v ? v.nome : args.id}.`, 'Status: AGUARDANDO_AUTORIZACAO → EM_VISITA.'];
    },
    executar: async (args) => {
      await window.alterarStatusVisitante(args.id, 'EM_VISITA');
      const v = visitantePorId(args.id);
      if (v && v.status === 'EM_VISITA') return { mensagem: `Entrada de ${v.nome} autorizada.`, dados: D.resumirVisitante(v) };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A entrada não foi autorizada. Veja a mensagem exibida ao operador.' };
    }
  };

  const registrarSaida = {
    nome: 'registrar_saida_visitante',
    titulo: 'Registrar saída de visitante',
    descricao: 'Registra a saída de um visitante em visita, com parecer da vistoria (status CONCLUIDO). Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'CADASTRAR_VISITANTE',
    esquema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 40, rotulo: 'Visitante', description: 'Identificador do visitante em visita.' },
        parecer: { type: 'string', minLength: 5, maxLength: 200, rotulo: 'Parecer', description: 'Parecer da vistoria (5 a 200 caracteres).' },
        data_saida: { type: 'string', minLength: 8, maxLength: 40, rotulo: 'Data e hora de saída', description: 'Data e hora da saída (padrão: agora).' }
      },
      required: ['id', 'parecer'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.id === undefined) return null;
      const v = visitantePorId(args.id);
      if (!v) return { codigo: 'VISITANTE_NAO_ENCONTRADO', mensagem: `Visitante ${args.id} não encontrado.` };
      if (v.status !== 'EM_VISITA') return { codigo: 'ESTADO_INVALIDO', mensagem: `O visitante está em ${v.status}; a saída só é registrada em EM_VISITA.` };
      return null;
    },
    resumo: (args) => {
      const v = visitantePorId(args.id);
      return [`Registrar a saída do visitante ${v ? v.nome : args.id}.`, `Parecer da vistoria: ${args.parecer}`, `Saída: ${args.data_saida || horaAgoraPtBr()}.`];
    },
    executar: async (args) => {
      await window.registrarSaidaVisitante(args.id, { confirmado: true, dataSaida: args.data_saida || horaAgoraPtBr(), parecer: args.parecer });
      const v = visitantePorId(args.id);
      if (v && v.status === 'CONCLUIDO') return { mensagem: `Saída de ${v.nome} registrada.`, dados: D.resumirVisitante(v) };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A saída não foi registrada. Veja a mensagem exibida ao operador.' };
    }
  };

  // Cadastros com documento: o agente só preenche o que não é pessoal; o operador completa e envia.
  function criarFormularios() {
    const lista = [];
    const visitas = document.getElementById('visCrudForm');
    const funcionarios = document.getElementById('funcCrudForm');
    if (visitas && typeof W.formularioComoFerramenta === 'function') {
      const visitante = D.seguro(() => W.formularioComoFerramenta({
        nome: 'preparar_cadastro_visitante',
        titulo: 'Preparar cadastro de visitante',
        descricao: 'Preenche nome do visitante e motivo da visita. O documento é preenchido e enviado pelo operador. Não envia o formulário.',
        cargos: CARGOS_PAGINA,
        permissao: 'CADASTRAR_VISITANTE',
        elemento: visitas,
        campos: {
          visNome: { descricao: 'Nome completo do visitante.', rotulo: 'Nome' },
          visMotivo: { descricao: 'Motivo da visita, por exemplo Fiscalização Alfandegária.', rotulo: 'Motivo' }
        }
      }), 'preparar_cadastro_visitante');
      if (visitante) lista.push(visitante);
    }
    if (funcionarios && typeof W.formularioComoFerramenta === 'function') {
      const funcionario = D.seguro(() => W.formularioComoFerramenta({
        nome: 'preparar_cadastro_funcionario',
        titulo: 'Preparar cadastro de funcionário',
        descricao: 'Preenche matrícula, nome e cargo do funcionário. Documentos são preenchidos pelo operador. Não envia o formulário.',
        cargos: CARGOS_PAGINA,
        elemento: funcionarios,
        campos: {
          funcMatricula: { descricao: 'Matrícula do funcionário, por exemplo MAT-9900.', rotulo: 'Matrícula' },
          funcNome: { descricao: 'Nome completo do funcionário.', rotulo: 'Nome' },
          funcCargo: { descricao: 'Cargo do funcionário (opções da lista).', rotulo: 'Cargo' }
        }
      }), 'preparar_cadastro_funcionario');
      if (funcionario) lista.push(funcionario);
    }
    return lista;
  }

  const ferramentas = [pesquisar, listarFuncionarios, reemitir, desativar, listarVisitantes, autorizarEntrada, registrarSaida];

  D.quandoPronto(() => {
    W.registrarPagina({ id: 'tecnico_portos', arquivo: 'tecnico_portos.html', ferramentas: ferramentas.concat(criarFormularios()) });
  });
})(window, document);
