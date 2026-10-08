/**
 * WebMCP — página Inspeção & Checklist (js/webmcp-inspecao.js) — NexusPort
 *
 * Checklist técnico formal (RN 14): a aprovação exige 100% dos itens críticos
 * CONFORME. A ferramenta de inspeção aplica as respostas pelos mesmos controles
 * (botões de rádio) que o inspetor usaria, confere o estado da própria tela e só
 * então chama a aprovação ou a recusa da página. Os dados de checklist vêm do
 * modelo do tipo de carga, como na interface.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // Cargos de PAGE_PERMISSIONS['inspecao.html'] que podem inspecionar; Supervisão apenas consulta.
  const CARGOS_CONSULTA = G.gestaoOperacional;
  const CARGOS_INSPECAO = G.inspecao;
  const STATUS_INSPECIONAVEL = 'RECEBIMENTO_INSPECAO';

  function modeloChecklist(carga) {
    if (typeof window.nexusInspecaoModeloChecklist === 'function') {
      return window.nexusInspecaoModeloChecklist(carga.tipo) || [];
    }
    return [];
  }

  function estadoTela() {
    return typeof window.nexusInspecaoEstado === 'function' ? window.nexusInspecaoEstado() : null;
  }

  async function cargaDoOperador(id) {
    return (await D.cargasDoOperador()).find((c) => c.id === id) || null;
  }

  function cargaLocal(id) {
    return D.lerLista('nexus_cargas_fluxo').find((c) => c.id === id) || null;
  }

  const listarCargasInspecao = {
    nome: 'listar_cargas_inspecao',
    titulo: 'Cargas para inspeção',
    descricao: 'Lista as cargas aguardando inspeção técnica (RECEBIMENTO_INSPECAO), ou outro status informado, visíveis ao operador.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CONSULTA,
    esquema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: D.STATUS_CARGA, rotulo: 'Status', description: 'Status a listar (padrão RECEBIMENTO_INSPECAO).' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: async (args) => {
      const status = args.status || STATUS_INSPECIONAVEL;
      const itens = (await D.cargasDoOperador()).filter((c) => c.status === status);
      return {
        mensagem: `${itens.length} carga(s) em ${status}.`,
        dados: { total: itens.length, itens: itens.slice(0, args.limite || 10).map((c) => D.resumirCarga(c)) }
      };
    }
  };

  const obterChecklist = {
    nome: 'obter_checklist',
    titulo: 'Checklist da carga',
    descricao: 'Mostra os itens do checklist técnico do tipo da carga, com indicação de itens críticos. Não altera a tela.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_CONSULTA,
    esquema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 3, maxLength: 60, pattern: '^[A-Za-z0-9._-]{3,60}$', rotulo: 'Código da carga', description: 'Código da carga, por exemplo CRG-2026-001.' } },
      required: ['id'],
      additionalProperties: false
    },
    executar: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return { ok: false, codigo: 'CARGA_NAO_ENCONTRADA', mensagem: `Carga ${args.id} não encontrada ou fora da sua visão.` };
      const itens = modeloChecklist(carga).map((i) => ({
        item_id: i.id, descricao: i.desc, critico: i.critico === true, categoria: i.categoria || null
      }));
      return {
        mensagem: `Checklist de ${itens.length} item(ns); ${itens.filter((i) => i.critico).length} crítico(s).`,
        dados: { carga: D.resumirCarga(carga), itens }
      };
    }
  };

  function analisarRespostas(carga, respostas, decisao, motivo) {
    const modelo = modeloChecklist(carga);
    const idsValidos = new Set(modelo.map((i) => i.id));
    const vistos = new Set();
    for (const r of respostas || []) {
      if (!idsValidos.has(r.item_id)) return { codigo: 'ITEM_INEXISTENTE', mensagem: `Item ${r.item_id} não pertence ao checklist deste tipo de carga.` };
      if (vistos.has(r.item_id)) return { codigo: 'ITEM_DUPLICADO', mensagem: `Item ${r.item_id} informado mais de uma vez.` };
      vistos.add(r.item_id);
    }
    if (decisao === 'APROVAR') {
      const criticos = modelo.filter((i) => i.critico);
      const naoConformes = criticos.filter((i) => {
        const r = (respostas || []).find((x) => x.item_id === i.id);
        return !r || r.conforme !== true;
      });
      if (naoConformes.length) {
        return { codigo: 'CHECKLIST_INCOMPLETO', mensagem: `RN 14: aprovação exige todos os ${criticos.length} itens críticos CONFORME. Pendentes: ${naoConformes.map((i) => i.id).join(', ')}.` };
      }
    } else if (!motivo || String(motivo).trim().length < 5) {
      return { codigo: 'MOTIVO_OBRIGATORIO', mensagem: 'A recusa exige motivo formal (mínimo de 5 caracteres).' };
    }
    return null;
  }

  const inspecionar = {
    nome: 'inspecionar_carga',
    titulo: 'Concluir inspeção',
    descricao: 'Aprova (APROVAR, exige todos os itens críticos conformes) ou recusa (RECUSAR, exige motivo) uma carga em RECEBIMENTO_INSPECAO. Registra o checklist. Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_INSPECAO,
    permissao: 'INSPECIONAR_CARGA',
    esquema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 60, pattern: '^[A-Za-z0-9._-]{3,60}$', rotulo: 'Código da carga', description: 'Código da carga a inspecionar.' },
        decisao: { type: 'string', enum: ['APROVAR', 'RECUSAR'], rotulo: 'Decisão', description: 'APROVAR ou RECUSAR a carga.' },
        respostas: {
          type: 'array', minItems: 1, maxItems: 40, rotulo: 'Respostas', description: 'Respostas por item do checklist (item_id e conforme).',
          items: {
            type: 'object',
            properties: {
              item_id: { type: 'string', minLength: 1, maxLength: 40, rotulo: 'Item', description: 'Identificador do item (ver obter_checklist).' },
              conforme: { type: 'boolean', rotulo: 'Conforme', description: 'true se conforme, false se não conforme.' }
            },
            required: ['item_id', 'conforme'],
            additionalProperties: false
          }
        },
        motivo: { type: 'string', minLength: 5, maxLength: 300, rotulo: 'Motivo', description: 'Motivo formal (obrigatório para RECUSAR).' }
      },
      required: ['id', 'decisao', 'respostas'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.id === undefined) return null;
      const carga = await cargaDoOperador(args.id);
      if (!carga) return { codigo: 'CARGA_NAO_ENCONTRADA', mensagem: `Carga ${args.id} não encontrada ou fora da sua visão.` };
      if (carga.status !== STATUS_INSPECIONAVEL) {
        return { codigo: 'ESTADO_INVALIDO', mensagem: `A carga ${carga.id} está em ${carga.status}; a inspeção só é feita em ${STATUS_INSPECIONAVEL}.` };
      }
      if (args.decisao !== undefined && args.respostas !== undefined) {
        const erro = analisarRespostas(carga, args.respostas, args.decisao, args.motivo);
        if (erro) return erro;
      }
      return null;
    },
    resumo: (args) => {
      const linhas = [];
      if (args.decisao === 'APROVAR') {
        linhas.push(`Aprovar a inspeção técnica da carga ${args.id}.`, 'Status: RECEBIMENTO_INSPECAO → ARMAZENAGEM.');
      } else {
        linhas.push(`Recusar a carga ${args.id}.`, 'Status: RECEBIMENTO_INSPECAO → RECUSADA.', `Motivo: ${args.motivo || ''}`);
      }
      linhas.push(`Itens informados: ${(args.respostas || []).length}.`);
      return linhas;
    },
    executar: async (args) => {
      const carga = await cargaDoOperador(args.id);
      if (!carga) return { ok: false, codigo: 'CARGA_NAO_ENCONTRADA', mensagem: `Carga ${args.id} não encontrada ou fora da sua visão.` };
      const erro = analisarRespostas(carga, args.respostas, args.decisao, args.motivo);
      if (erro) return { ok: false, codigo: erro.codigo, mensagem: erro.mensagem };

      // 1) Abre o checklist desta carga na própria tela.
      const seletor = document.getElementById('inspecaoCargaSelect');
      const carregar = document.getElementById('carregarChecklistBtn');
      if (!seletor || !carregar) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Tela de inspeção indisponível.' };
      seletor.value = args.id;
      if (seletor.value !== args.id) {
        return { ok: false, codigo: 'CARGA_NAO_LISTADA', mensagem: `A carga ${args.id} não aparece na lista de inspeção (cancelada ou inexistente).` };
      }
      carregar.click();
      const estado = estadoTela();
      if (!estado || estado.cargaId !== args.id) {
        return { ok: false, codigo: 'CHECKLIST_NAO_CARREGADO', mensagem: `Não foi possível abrir o checklist da carga ${args.id}.` };
      }

      // 2) Aplica as respostas pelos mesmos controles de rádio do operador.
      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
      for (const r of args.respostas || []) {
        const valor = r.conforme ? 'CONFORME' : 'NAO_CONFORME';
        const alvo = radios.find((x) => x.name === `chk_${r.item_id}` && x.value === valor);
        if (!alvo) return { ok: false, codigo: 'ITEM_INEXISTENTE', mensagem: `Controle do item ${r.item_id} não encontrado na tela.` };
        alvo.click();
        // Garante o estado da própria página mesmo se o manipulador inline não executar.
        if (typeof window.atualizarChecklistItem === 'function') window.atualizarChecklistItem(r.item_id, r.conforme);
      }

      // 3) Aprovação ou recusa pelas funções da própria página.
      if (args.decisao === 'APROVAR') {
        const botao = document.getElementById('aprovarCargaBtn');
        if (!botao || botao.disabled) {
          return { ok: false, codigo: 'CHECKLIST_INCOMPLETO', mensagem: 'A tela ainda não liberou a aprovação (itens críticos pendentes).' };
        }
        await window.nexusInspecaoAprovar();
        const c = cargaLocal(args.id);
        if (c && c.status === 'ARMAZENAGEM') {
          return { mensagem: `Carga ${args.id} APROVADA na inspeção. Status: ARMAZENAGEM.`, dados: D.resumirCarga(c) };
        }
        return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A aprovação não foi registrada. Veja a mensagem exibida ao operador.' };
      }

      await window.nexusInspecaoRecusar({ motivo: args.motivo });
      const c = cargaLocal(args.id);
      if (c && c.status === 'RECUSADA') {
        return { mensagem: `Carga ${args.id} RECUSADA na inspeção. Motivo registrado.`, dados: D.resumirCarga(c) };
      }
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A recusa não foi registrada. Veja a mensagem exibida ao operador.' };
    }
  };

  D.quandoPronto(() => W.registrarPagina({
    id: 'inspecao',
    arquivo: 'inspecao.html',
    ferramentas: [listarCargasInspecao, obterChecklist, inspecionar]
  }));
})(window, document);
