/**
 * WebMCP — página Cargas & Pátio (js/webmcp/webmcp-cargas.js) — NexusPort
 *
 * Ferramentas de leitura (listar, obter, etiquetas, cadastros de apoio) e de ação
 * (agendar, receber, movimentar, pronta para entrega, vincular, liberar, cancelar).
 * Cada ação consequente:
 *   1) valida o estado da carga ANTES de pedir confirmação (precondicao);
 *   2) mostra o impacto ao operador (resumo) e só executa após confirmação;
 *   3) chama a função da própria página (executarAcaoCarga, formulários e modal),
 *      com as mesmas validações da interface;
 *   4) confirma no estado salvo que a mudança aconteceu e só então responde "ok".
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // Mesmos cargos que PAGE_PERMISSIONS['cargas.html'] (sem Técnico em Portos).
  const CARGOS_CARGAS = G.todos.filter((c) => c !== 'TECNICO_PORTOS');
  const ESQUEMA_ID = {
    type: 'string', minLength: 3, maxLength: 60, pattern: '^[A-Za-z0-9._-]{3,60}$',
    rotulo: 'Código da carga', description: 'Código da carga, por exemplo CRG-2026-001.'
  };

  function hojeIso() {
    return new Date().toISOString().split('T')[0];
  }

  function cargaLocal(id) {
    return D.lerLista('nexus_cargas_fluxo').find((c) => c.id === id) || null;
  }

  async function cargaDoOperador(id) {
    return (await D.cargasDoOperador()).find((c) => c.id === id) || null;
  }

  function naoEncontrada(id) {
    return { codigo: 'CARGA_NAO_ENCONTRADA', mensagem: `Carga ${id} não encontrada ou fora da sua visão.` };
  }

  function estadoEsperado(carga, permitidos) {
    if (permitidos.includes(carga.status)) return null;
    return {
      codigo: 'ESTADO_INVALIDO',
      mensagem: `A carga ${carga.id} está em ${carga.status}. Esta ação exige: ${permitidos.join(' ou ')}.`
    };
  }

  function falhaNaoConcluida(mensagem) {
    return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: mensagem || 'A ação não foi registrada. Veja a mensagem exibida ao operador.' };
  }

  function listaGuindastes() {
    return D.guindastesEfetivos();
  }

  // ------------------------------------------------------------------
  // Definições
  // ------------------------------------------------------------------
  const listarCargas = {
    nome: 'listar_cargas',
    titulo: 'Listar cargas',
    descricao: 'Lista as cargas visíveis ao operador, com filtros por status, navio, contêiner, tipo e período. Canceladas só aparecem com o status CANCELADA.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CARGAS,
    esquema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: D.STATUS_CARGA, rotulo: 'Status', description: 'Status do fluxo da carga.' },
        navio: { type: 'string', maxLength: 120, rotulo: 'Navio', description: 'Trecho do nome do navio vinculado.' },
        container: { type: 'string', maxLength: 40, rotulo: 'Contêiner', description: 'Trecho da identificação do contêiner.' },
        tipo: { type: 'string', maxLength: 80, rotulo: 'Tipo', description: 'Trecho do tipo ou da natureza da carga.' },
        data_inicio: { type: 'string', format: 'date', rotulo: 'Data inicial', description: 'Data inicial do cadastro (AAAA-MM-DD).' },
        data_fim: { type: 'string', format: 'date', rotulo: 'Data final', description: 'Data final do cadastro (AAAA-MM-DD).' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: async (args) => {
      const visiveis = await D.cargasDoOperador();
      const base = args.status ? visiveis : visiveis.filter((c) => c.status !== 'CANCELADA');
      const filtradas = D.filtrarCargas(base, args);
      const limite = args.limite || 10;
      return {
        mensagem: `${filtradas.length} carga(s) encontrada(s).`,
        dados: { total: filtradas.length, itens: filtradas.slice(0, limite).map((c) => D.resumirCarga(c)) }
      };
    }
  };

  const obterCarga = {
    nome: 'obter_carga',
    titulo: 'Detalhes da carga',
    descricao: 'Mostra os dados de uma carga e as ações que podem ser solicitadas agora (acoes_disponiveis), conforme cargo e estado.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CARGAS,
    esquema: { type: 'object', properties: { id: ESQUEMA_ID }, required: ['id'], additionalProperties: false },
    executar: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return { ok: false, codigo: 'CARGA_NAO_ENCONTRADA', mensagem: naoEncontrada(args.id).mensagem };
      const acoes = await acoesDisponiveis(carga);
      return { mensagem: `Carga ${carga.id} (${carga.status}).`, dados: Object.assign(D.resumirCarga(carga), { acoes_disponiveis: acoes }) };
    }
  };

  const exibirEtiqueta = {
    nome: 'exibir_etiqueta_qr',
    titulo: 'Exibir etiqueta QR',
    descricao: 'Abre na tela a etiqueta QR da carga para o operador imprimir. Não imprime sozinho e não registra reimpressão.',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_CARGAS,
    esquema: { type: 'object', properties: { id: ESQUEMA_ID }, required: ['id'], additionalProperties: false },
    executar: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return { ok: false, codigo: 'CARGA_NAO_ENCONTRADA', mensagem: naoEncontrada(args.id).mensagem };
      if (typeof window.exibirEtiquetaQr === 'function') {
        window.exibirEtiquetaQr({ id: carga.id, tipo: carga.tipo, qrCode: carga.qrCode, natureza: carga.natureza });
      }
      return { mensagem: 'Etiqueta exibida na tela para o operador.', dados: { id: carga.id, codigo_qr: carga.qrCode || `QR-${carga.id}` } };
    }
  };

  const listarGuindastes = {
    nome: 'listar_guindastes',
    titulo: 'Listar guindastes',
    descricao: 'Lista os guindastes e o estado de cada um. Só guindastes OPERANTE podem movimentar cargas.',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_CARGAS,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const itens = listaGuindastes().map((g) => D.resumirGuindaste(g));
      return { mensagem: `${itens.length} guindaste(s).`, dados: { itens } };
    }
  };

  const listarContainers = {
    nome: 'listar_containers',
    titulo: 'Listar contêineres',
    descricao: 'Lista os contêineres com estado e capacidade disponível (m³, de 75 m³) para vincular cargas.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CARGAS,
    esquema: {
      type: 'object',
      properties: {
        apenas_operantes: { type: 'boolean', rotulo: 'Só operantes', description: 'Se verdadeiro, mostra só contêineres OPERANTE.' }
      },
      additionalProperties: false
    },
    executar: async (args) => {
      const cargasTodas = await D.cargas();
      let itens = D.containers().map((c) => Object.assign(D.resumirContainer(c), {
        disponivel_m3: D.disponibilidadeContainer(c.identificacao, cargasTodas)
      }));
      if (args.apenas_operantes) itens = itens.filter((c) => c.estado === 'OPERANTE');
      return { mensagem: `${itens.length} contêiner(es).`, dados: { itens: itens.slice(0, 25) } };
    }
  };

  const listarTipos = {
    nome: 'listar_tipos_carga',
    titulo: 'Tipos de carga',
    descricao: 'Lista os tipos de carga cadastrados com a quantidade de itens do checklist. Agendamento só aceita tipos cadastrados.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CARGAS,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const itens = D.tiposCarga().map((t) => ({
        nome: t.nome || null,
        descricao: t.descricao ? String(t.descricao).slice(0, 160) : null,
        itens_checklist: Array.isArray(t.checklist) ? t.checklist.length : 0,
        itens_criticos: Array.isArray(t.checklist) ? t.checklist.filter((i) => i.critico).length : 0
      }));
      return { mensagem: `${itens.length} tipo(s) de carga cadastrado(s).`, dados: { itens } };
    }
  };

  const agendar = {
    nome: 'agendar_carga',
    titulo: 'Agendar carga',
    descricao: 'Registra o agendamento de uma nova carga do tipo cadastrado, com etiqueta QR. Exige confirmação do operador. Só Supervisor, Inspetor ou Direção.',
    anotacoes: { consequentialHint: true },
    cargos: G.gestaoOperacional,
    esquema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', minLength: 2, maxLength: 80, rotulo: 'Tipo de carga', description: 'Tipo já cadastrado (ver listar_tipos_carga).' },
        peso: { type: 'number', minimum: 0.01, maximum: 100000, rotulo: 'Peso (t)', description: 'Peso bruto em toneladas (maior que zero).' },
        volume: { type: 'number', minimum: 0.01, maximum: 100000, rotulo: 'Volume (m³)', description: 'Volume em metros cúbicos (maior que zero).' },
        valor: { type: 'number', minimum: 0.01, maximum: 1000000000000, rotulo: 'Valor declarado (R$)', description: 'Valor declarado em reais (maior que zero).' },
        natureza: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Natureza', description: 'Natureza da mercadoria, por exemplo Agrícola ou Perecível.' },
        porto_descarga: { type: 'string', enum: D.SETORES_PATIO, rotulo: 'Setor do pátio', description: 'Setor do pátio de descarga.' },
        destino: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Destino (rota cadastrada)', description: 'Porto de destino de uma rota marítima JÁ CADASTRADA (ver listar_rotas). Não há destino manual: o valor precisa casar com uma rota registrada.' },
        data_prevista: { type: 'string', format: 'date', rotulo: 'Data prevista (ignorado)', description: 'Aceito por compatibilidade, mas IGNORADO: a previsão de chegada agora é o ETA do navio vinculado, não há mais data manual no agendamento.' }
      },
      required: ['tipo', 'peso', 'volume', 'valor', 'natureza', 'porto_descarga', 'destino'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.tipo !== undefined) {
        const tipo = D.tiposCarga().find((t) => t.nome === args.tipo);
        if (!tipo || !Array.isArray(tipo.checklist) || tipo.checklist.length === 0) {
          return { codigo: 'TIPO_NAO_CADASTRADO', mensagem: 'O tipo de carga precisa estar cadastrado com checklist antes do agendamento (RN 13).' };
        }
      }
      return null;
    },
    resumo: (args) => [
      `Agendar nova carga do tipo ${args.tipo}.`,
      `Peso ${args.peso} t · volume ${args.volume} m³ · valor declarado ${D.moeda(args.valor)}.`,
      `Setor ${args.porto_descarga} · destino ${args.destino} (rota cadastrada) · ETA calculado pelo navio vinculado.`
    ],
    executar: async (args) => {
      const form = document.getElementById('agendamentoCargaForm');
      if (!form) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Formulário de agendamento indisponível nesta página.' };
      const antes = new Set(D.lerLista('nexus_cargas_fluxo').map((c) => c.id));
      form.classList.remove('hidden');
      try {
        D.definirCampo(form, 'agTipoCarga', args.tipo);
        D.definirCampo(form, 'agPeso', args.peso);
        D.definirCampo(form, 'agVolume', args.volume);
        D.definirCampo(form, 'agValor', args.valor);
        D.definirCampo(form, 'agNatureza', args.natureza);
        D.definirCampo(form, 'agPortoDescarga', args.porto_descarga);
      } catch (erro) {
        return { ok: false, codigo: 'ARGUMENTOS_INVALIDOS', mensagem: `Um valor não corresponde às opções da tela (${erro.message}).` };
      }
      // Destino final = rota marítima cadastrada (sem digitação manual, sem
      // data prevista): o agente casa o destino pedido com o rótulo da rota
      // ("origem ➔ destino (km)") carregado pela própria página.
      const agDestinoSel = form.querySelector('#agDestino');
      if (!agDestinoSel) {
        return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Seletor de destino indisponível no formulário de agendamento.' };
      }
      if (D.esperar) {
        await D.esperar(() => Array.from(agDestinoSel.options).some((o) => o.value !== ''), 4000);
      }
      const rotasDisponiveis = Array.from(agDestinoSel.options).filter((o) => o.value !== '');
      if (rotasDisponiveis.length === 0) {
        return { ok: false, codigo: 'ROTA_NAO_CADASTRADA', mensagem: 'Nenhuma rota marítima cadastrada no sistema. Peça à supervisão para registrar a rota na Gestão de Rotas Marítimas (Embarcações & GPS) antes de agendar.' };
      }
      const destinoAlvo = String(args.destino || '').trim().toLowerCase();
      const opcaoRota = rotasDisponiveis.find((o) => (o.textContent || '').toLowerCase().includes(destinoAlvo)) ||
        rotasDisponiveis.find((o) => o.value === String(args.destino));
      if (!opcaoRota) {
        const lista = rotasDisponiveis.map((o) => (o.textContent || '').trim()).join(' | ');
        return { ok: false, codigo: 'ARGUMENTOS_INVALIDOS', mensagem: `O destino "${args.destino}" não corresponde a nenhuma rota marítima cadastrada. Rotas disponíveis: ${lista}.` };
      }
      agDestinoSel.value = opcaoRota.value;
      agDestinoSel.dispatchEvent(new Event('change', { bubbles: true }));
      // Backlog 3 (3.4 / WebMCP): o formulário exige o Responsável pela Carga
      // (#agEstivadorResponsavel), preenchido de forma assíncrona pela página.
      // O agente aguarda o preenchimento e, se nada tiver sido escolhido, assume
      // a opção padrão da sessão (o operador logado), como no uso humano.
      const selResp = form.querySelector('#agEstivadorResponsavel');
      if (selResp && D.esperar) {
        await D.esperar(() => Array.from(selResp.options).some((o) => o.value), 4000);
        if (!selResp.value) {
          const padrao = Array.from(selResp.options).find((o) => o.value);
          if (padrao) selResp.value = padrao.value;
        }
      }
      if (!form.checkValidity()) {
        const invalidos = Array.from(form.querySelectorAll(':invalid')).map((c) => c.name || c.id);
        return { ok: false, codigo: 'FORMULARIO_INVALIDO', mensagem: `Campos inválidos: ${invalidos.join(', ') || 'verifique o formulário'}.` };
      }
      form.requestSubmit();
      const nova = D.lerLista('nexus_cargas_fluxo').find((c) => !antes.has(c.id));
      if (!nova) return falhaNaoConcluida('O agendamento não foi registrado. Veja a mensagem exibida ao operador.');
      return { mensagem: `Carga ${nova.id} agendada. A etiqueta QR foi exibida para o operador.`, dados: D.resumirCarga(nova) };
    }
  };

  const receber = {
    nome: 'receber_carga',
    titulo: 'Registrar recebimento',
    descricao: 'Registra o recebimento físico de uma carga agendada (AGENDAMENTO → RECEBIMENTO_INSPECAO). Só Conferente de Carga ou Direção. Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: ['CONFERENTE_CARGA', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    permissao: 'REGISTRAR_RECEBIMENTO',
    esquema: { type: 'object', properties: { id: ESQUEMA_ID }, required: ['id'], additionalProperties: false },
    precondicao: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return naoEncontrada(args.id);
      return estadoEsperado(carga, ['AGENDAMENTO']);
    },
    resumo: (args) => [`Registrar o recebimento físico da carga ${args.id}.`, 'Status: AGENDAMENTO → RECEBIMENTO_INSPECAO.'],
    executar: async (args) => {
      await window.executarAcaoCarga(args.id, 'RECEBER');
      const c = cargaLocal(args.id);
      if (c && c.status === 'RECEBIMENTO_INSPECAO') {
        return { mensagem: `Recebimento da carga ${args.id} registrado. Aguardando inspeção.`, dados: D.resumirCarga(c) };
      }
      return falhaNaoConcluida();
    }
  };

  const movimentar = {
    nome: 'movimentar_carga',
    titulo: 'Movimentar carga',
    descricao: 'Move a carga entre setores do pátio: designa um guindaste OPERANTE e cria a tarefa de movimentação (pendente em Embarcações & GPS); o setor só muda quando a tarefa for concluída por lá. Não funciona em trânsito nem durante emergência. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: ['ESTIVADOR', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    permissao: 'MOVIMENTAR_CARGA',
    bloqueiaEmergencia: true,
    esquema: {
      type: 'object',
      properties: {
        id: ESQUEMA_ID,
        guindaste: { type: 'string', minLength: 2, maxLength: 40, rotulo: 'Guindaste', description: 'Identificação de um guindaste OPERANTE (ver listar_guindastes).' },
        setor: { type: 'string', enum: D.SETORES_PATIO, rotulo: 'Setor de destino', description: 'Setor do pátio de destino. Se omitido, usa o primeiro setor diferente do atual.' }
      },
      required: ['id', 'guindaste'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.id !== undefined) {
        const carga = await cargaDoOperador(args.id);
        if (!carga) return naoEncontrada(args.id);
        if (carga.status === 'EM_TRANSITO') {
          return { codigo: 'ESTADO_INVALIDO', mensagem: `A carga ${carga.id} está em trânsito e não pode ser movimentada.` };
        }
        if (args.setor !== undefined && carga.portoDescarga === args.setor) {
          return { codigo: 'MESMO_SETOR', mensagem: `A carga ${carga.id} já está no setor "${args.setor}". Escolha um setor de destino diferente.` };
        }
      }
      if (args.guindaste !== undefined) {
        const g = listaGuindastes().find((x) => x.identificacao === args.guindaste);
        if (!g) return { codigo: 'GUINDASTE_NAO_ENCONTRADO', mensagem: `Guindaste ${args.guindaste} não cadastrado.` };
        if (g.estado !== 'OPERANTE') return { codigo: 'GUINDASTE_INDISPONIVEL', mensagem: `Guindaste ${args.guindaste} está em ${g.estado}.` };
      }
      return null;
    },
    resumo: async (args) => {
      const carga = await cargaDoOperador(args.id).catch(() => null);
      const origem = (carga && carga.portoDescarga) || 'setor atual';
      const destino = args.setor || D.SETORES_PATIO.find((s) => s !== origem) || args.setor;
      return [
        `Movimentar a carga ${args.id} do setor "${origem}" para o setor "${destino}" com o guindaste ${args.guindaste}.`,
        'Cria a tarefa pendente do guindaste em Embarcações & GPS; o Setor do Pátio só muda após a conclusão por lá.'
      ];
    },
    executar: async (args) => {
      const antes = cargaLocal(args.id);
      const setorDestino = args.setor || D.SETORES_PATIO.find((s) => s !== ((antes && antes.portoDescarga) || ''));
      if (!setorDestino) return falhaNaoConcluida('Não há setor de destino diferente do atual para esta carga.');
      await window.executarAcaoCarga(args.id, 'MOVIMENTAR', { guindasteIdentificacao: args.guindaste, setorDestino: setorDestino });
      const c = cargaLocal(args.id);
      const tarefas = D.lerLista('nexus_guindaste_tarefas');
      const tarefaCriada = tarefas.some((t) => t.cargaId === args.id && t.guindasteId === args.guindaste && (!t.status || t.status === 'PENDENTE'));
      if (c && c.guindasteDesignado === args.guindaste && c.movimentacaoPendente === setorDestino && tarefaCriada) {
        return { mensagem: `Carga ${args.id} associada ao guindaste ${args.guindaste}. Tarefa de movimentação para "${setorDestino}" criada (pendente em Embarcações & GPS).`, dados: D.resumirCarga(c) };
      }
      return falhaNaoConcluida();
    }
  };

  const prontaEntrega = {
    nome: 'marcar_pronta_entrega',
    titulo: 'Marcar pronta para entrega',
    descricao: 'Marca a carga como PRONTA_PARA_ENTREGA. Exige que a carga já esteja vinculada a um contêiner. Só Arrumador, Inspetor ou Direção.',
    anotacoes: { consequentialHint: true },
    cargos: ['ARRUMADOR_CONSERTADOR', 'INSPETOR', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'],
    permissao: 'ALTERAR_PRONTA_ENTREGA',
    esquema: { type: 'object', properties: { id: ESQUEMA_ID }, required: ['id'], additionalProperties: false },
    precondicao: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return naoEncontrada(args.id);
      const estado = estadoEsperado(carga, ['ARMAZENAGEM']);
      if (estado) return estado;
      if (!carga.container) return { codigo: 'VINCULO_OBRIGATORIO', mensagem: 'A carga precisa estar vinculada a um contêiner antes de ficar pronta (Item 4).' };
      return null;
    },
    resumo: (args) => [`Marcar a carga ${args.id} como Pronta para Entrega.`],
    executar: async (args) => {
      await window.executarAcaoCarga(args.id, 'PRONTA');
      const c = cargaLocal(args.id);
      if (c && c.status === 'PRONTA_PARA_ENTREGA') return { mensagem: `Carga ${args.id} pronta para entrega.`, dados: D.resumirCarga(c) };
      return falhaNaoConcluida();
    }
  };

  const vincular = {
    nome: 'vincular_carga_container',
    titulo: 'Vincular carga a contêiner',
    descricao: 'Vincula uma carga armazenada a um contêiner OPERANTE com capacidade disponível (até 75 m³). Usa o modal de vinculação da tela. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    esquema: {
      type: 'object',
      properties: {
        id: ESQUEMA_ID,
        container: { type: 'string', minLength: 2, maxLength: 40, rotulo: 'Contêiner', description: 'Identificação do contêiner (ver listar_containers).' }
      },
      required: ['id', 'container'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.id !== undefined) {
        const carga = await cargaDoOperador(args.id);
        if (!carga) return naoEncontrada(args.id);
        const estado = estadoEsperado(carga, ['ARMAZENAGEM']);
        if (estado) return estado;
        if (args.container !== undefined) {
          const cont = D.containers().find((c) => c.identificacao === args.container);
          if (!cont) return { codigo: 'CONTAINER_NAO_ENCONTRADO', mensagem: `Contêiner ${args.container} não cadastrado.` };
          if (cont.estado !== 'OPERANTE') return { codigo: 'CONTAINER_INDISPONIVEL', mensagem: `Contêiner ${args.container} está em ${cont.estado}.` };
          const disponivel = D.disponibilidadeContainer(args.container, await D.cargas());
          const volume = D.volumeNumero(carga.volume);
          if (volume > disponivel) {
            return { codigo: 'CAPACIDADE_EXCEDIDA', mensagem: `Volume da carga (${volume} m³) excede a capacidade disponível (${disponivel} m³).` };
          }
        }
      }
      return null;
    },
    resumo: async (args) => {
      const cont = D.containers().find((c) => c.identificacao === args.container);
      const disponivel = D.disponibilidadeContainer(args.container, await D.cargas());
      return [
        `Vincular a carga ${args.id} ao contêiner ${args.container}${cont && cont.tipo ? ` (${cont.tipo})` : ''}.`,
        `Capacidade disponível no contêiner: ${disponivel} m³ de 75 m³.`,
        'O navio vinculado ao contêiner, se houver, passa a valer para a carga.'
      ];
    },
    executar: async (args) => {
      const modal = document.getElementById('vincularModal');
      const select = document.getElementById('vincularContainerSelect');
      const confirmarBtn = document.getElementById('confirmVincularModalBtn');
      const cancelarBtn = document.getElementById('cancelVincularModalBtn');
      if (!modal || !select || !confirmarBtn || typeof window.abrirModalVinculacao !== 'function') {
        return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Tela de vinculação indisponível nesta página.' };
      }
      await window.abrirModalVinculacao(args.id);
      const opcao = Array.from(select.options).find((o) => o.getAttribute('data-identificacao') === args.container);
      if (!opcao || opcao.disabled || !opcao.value) {
        if (cancelarBtn) cancelarBtn.click();
        return { ok: false, codigo: 'CONTAINER_INDISPONIVEL', mensagem: `Contêiner ${args.container} sem capacidade ou indisponível para esta carga.` };
      }
      select.value = opcao.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      confirmarBtn.click();
      const ok = await D.esperar(() => { const c = cargaLocal(args.id); return Boolean(c && c.container === args.container); }, 4000);
      if (!ok) {
        if (cancelarBtn) cancelarBtn.click();
        return falhaNaoConcluida('A vinculação não foi concluída. Veja a mensagem exibida ao operador.');
      }
      return { mensagem: `Carga ${args.id} vinculada ao contêiner ${args.container}.`, dados: D.resumirCarga(cargaLocal(args.id)) };
    }
  };

  const liberar = {
    nome: 'liberar_carga_saida',
    titulo: 'Liberar saída da carga',
    descricao: 'Libera a saída de uma carga PRONTA_PARA_ENTREGA vinculada a contêiner e navio (status EM_TRANSITO). Bloqueado em emergência. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    permissao: 'LIBERAR_CARGA',
    bloqueiaEmergencia: true,
    esquema: { type: 'object', properties: { id: ESQUEMA_ID }, required: ['id'], additionalProperties: false },
    precondicao: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return naoEncontrada(args.id);
      const estado = estadoEsperado(carga, ['PRONTA_PARA_ENTREGA']);
      if (estado) return estado;
      if (!carga.container || !carga.navio) {
        return { codigo: 'VINCULO_OBRIGATORIO', mensagem: 'A carga precisa estar vinculada a contêiner e navio para sair do porto (Regra A6).' };
      }
      return null;
    },
    resumo: async (args) => {
      const c = await cargaDoOperador(args.id);
      return [
        `Liberar a saída da carga ${args.id} com destino a ${c ? (c.portoDescarga || c.destino || 'destino não informado') : 'destino não informado'}.`,
        c ? `Vínculos: contêiner ${c.container} · navio ${c.navio}.` : 'Vínculos verificados na tela.',
        'Status: PRONTA_PARA_ENTREGA → EM_TRANSITO.'
      ];
    },
    executar: async (args) => {
      await window.executarAcaoCarga(args.id, 'LIBERAR');
      const c = cargaLocal(args.id);
      if (c && c.status === 'EM_TRANSITO') return { mensagem: `Saída da carga ${args.id} liberada (em trânsito).`, dados: D.resumirCarga(c) };
      return falhaNaoConcluida();
    }
  };

  const cancelar = {
    nome: 'cancelar_entrega',
    titulo: 'Cancelar entrega',
    descricao: 'Cancela a entrega de uma carga em AGENDAMENTO, ARMAZENAGEM ou PRONTA_PARA_ENTREGA, com motivo obrigatório. Desvincula contêiner e navio. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    permissao: 'CANCELAR_ENTREGA',
    esquema: {
      type: 'object',
      properties: {
        id: ESQUEMA_ID,
        motivo: { type: 'string', minLength: 5, maxLength: 300, rotulo: 'Motivo', description: 'Motivo formal do cancelamento (5 a 300 caracteres).' }
      },
      required: ['id', 'motivo'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return naoEncontrada(args.id);
      return estadoEsperado(carga, ['AGENDAMENTO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA']);
    },
    resumo: (args) => [
      `Cancelar a entrega da carga ${args.id}. A carga sai da tabela principal.`,
      'Contêiner e navio são desvinculados e tarefas de guindaste são removidas.',
      `Motivo: ${args.motivo}`
    ],
    executar: async (args) => {
      await window.executarAcaoCarga(args.id, 'CANCELAR', { motivo: args.motivo });
      const c = cargaLocal(args.id);
      if (c && c.status === 'CANCELADA') return { mensagem: `Entrega da carga ${args.id} cancelada.`, dados: D.resumirCarga(c) };
      return falhaNaoConcluida();
    }
  };

  const ACOES_DA_CARGA = [receber, movimentar, prontaEntrega, vincular, liberar, cancelar];

  /** Ações consequentes que o operador pode pedir AGORA para esta carga. */
  async function acoesDisponiveis(carga) {
    const nomes = [];
    for (const def of ACOES_DA_CARGA) {
      if (!D.podeUsar(def)) continue;
      const motivo = def.precondicao ? await def.precondicao({ id: carga.id }, {}) : null;
      if (!motivo) nomes.push(def.nome);
    }
    return nomes;
  }

  const ferramentas = [
    listarCargas, obterCarga, exibirEtiqueta, listarGuindastes, listarContainers, listarTipos,
    agendar, receber, movimentar, prontaEntrega, vincular, liberar, cancelar
  ];

  D.quandoPronto(() => W.registrarPagina({ id: 'cargas', arquivo: 'cargas.html', ferramentas }));
})(window, document);
