/**
 * WebMCP — página Painel Geral (js/webmcp-dashboard.js) — NexusPort
 *
 * Indicadores operacionais, detalhamento dos cards, trilha de decisões e auditoria,
 * todas somente leitura. A trilha imutável NÃO pode ser escrita por agentes: registros
 * de decisão e retificações são feitos somente pelo operador na tela.
 * Os campos de identificação (código individual) não são lidos pelas ferramentas.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  const CARGOS_PAGINA = G.todos;
  const INDICADORES = ['NAVIOS_MANUTENCAO', 'NAVIOS_FORA', 'CARGAS_ARMAZENAGEM', 'CARGAS_PRONTAS', 'OCUPACAO_PATIO'];

  function totalDe(valor) {
    if (!valor || typeof valor !== 'object') return null;
    if (Number.isFinite(valor.total)) return valor.total;
    if (Array.isArray(valor.lista)) return valor.lista.length;
    return null;
  }

  const resumo = {
    nome: 'obter_resumo_operacional',
    titulo: 'Resumo operacional',
    descricao: 'Mostra os números do pátio: cargas em armazenagem e prontas, navios fora do porto, manutenções e ocupação do pátio.',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const ind = await D.indicadores();
      if (!ind) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Indicadores indisponíveis no momento.' };
      return {
        mensagem: 'Resumo operacional.',
        dados: {
          cargas_armazenagem: totalDe(ind.cargasArmazenagem),
          cargas_prontas: totalDe(ind.cargasProntas),
          cargas_recusadas: totalDe(ind.recusadas),
          navios_fora_do_porto: totalDe(ind.naviosFora),
          manutencoes_em_andamento: ind.manutencao ? ind.manutencao.total : null,
          ocupacao_patio: ind.ocupacaoPatio ? {
            ocupados: ind.ocupacaoPatio.ocupados, capacidade: ind.ocupacaoPatio.capacidade, taxa_pct: ind.ocupacaoPatio.taxa
          } : null
        }
      };
    }
  };

  const detalhar = {
    nome: 'detalhar_indicador',
    titulo: 'Detalhar indicador',
    descricao: 'Lista os itens por trás de um indicador do painel (navios em manutenção, navios fora, cargas em armazenagem ou prontas, ocupação).',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        indicador: { type: 'string', enum: INDICADORES, rotulo: 'Indicador', description: 'Indicador a detalhar.' },
        limite: { type: 'integer', minimum: 1, maximum: 20, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      required: ['indicador'],
      additionalProperties: false
    },
    executar: async (args) => {
      const ind = await D.indicadores();
      if (!ind) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Indicadores indisponíveis no momento.' };
      const limite = args.limite || 10;
      let itens = [];
      if (args.indicador === 'NAVIOS_MANUTENCAO') {
        itens = (ind.manutencao.navios || []).map((n) => ({ nome: n.nome, estado: n.estado_operacional || n.estado || null }))
          .concat((ind.manutencao.ordens || []).map((o) => ({ ordem: o.id || null, status: o.status || null, descricao: o.descricao || null })));
      } else if (args.indicador === 'NAVIOS_FORA') {
        itens = ind.naviosFora.lista.map((n) => ({ nome: n.nome, destino: n.porto_destino || n.destino || null, situacao: n.localizacao || null }));
      } else if (args.indicador === 'CARGAS_ARMAZENAGEM') {
        itens = ind.cargasArmazenagem.lista.map((c) => ({ id: c.id || null, tipo: c.natureza || null, container: c.container_id || null }));
      } else if (args.indicador === 'CARGAS_PRONTAS') {
        itens = ind.cargasProntas.lista.map((c) => ({ id: c.id || null, tipo: c.natureza || null, container: c.container_id || null }));
      } else {
        return { mensagem: 'Ocupação do pátio.', dados: { ocupados: ind.ocupacaoPatio.ocupados, capacidade: ind.ocupacaoPatio.capacidade, taxa_pct: ind.ocupacaoPatio.taxa } };
      }
      return { mensagem: `${itens.length} item(ns) em ${args.indicador}.`, dados: { total: itens.length, itens: itens.slice(0, limite) } };
    }
  };

  const trilha = {
    nome: 'listar_trilha_decisoes',
    titulo: 'Trilha de decisões',
    descricao: 'Lista as decisões registradas na trilha imutável (aprovações, liberações, cancelamentos). Somente leitura; retificações são feitas pelo operador.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        decisao: { type: 'string', maxLength: 60, rotulo: 'Decisão', description: 'Trecho do tipo de decisão, por exemplo LIBEROU ou CANCELOU.' },
        entidade: { type: 'string', maxLength: 80, rotulo: 'Entidade', description: 'Trecho da entidade, por exemplo CARGA ou NAVIO.' },
        limite: { type: 'integer', minimum: 1, maximum: 20, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: (args) => {
      let lista = D.trilha().map((t) => D.resumirTrilha(t));
      if (args.decisao) lista = lista.filter((t) => D.contem(t.decisao, args.decisao));
      if (args.entidade) lista = lista.filter((t) => D.contem(t.entidade, args.entidade));
      return { mensagem: `${lista.length} registro(s) na trilha.`, dados: { total: lista.length, itens: lista.slice(0, args.limite || 10) } };
    }
  };

  const auditoria = {
    nome: 'listar_auditoria',
    titulo: 'Logs de auditoria',
    descricao: 'Lista os registros de alteração (criação, edição, exclusão, leitura de QR). Somente leitura. Não mostra código de usuário.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        entidade: { type: 'string', maxLength: 80, rotulo: 'Entidade', description: 'Trecho da entidade alterada.' },
        limite: { type: 'integer', minimum: 1, maximum: 20, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: (args) => {
      let lista = D.lerLista('nexus_audit_logs').map((l) => ({
        data_hora: D.dataHora(l.data_hora) || null,
        cargo: l.cargo || null,
        entidade: l.entidade || null,
        tipo: l.tipo_alteracao || null
      }));
      if (args.entidade) lista = lista.filter((l) => D.contem(l.entidade, args.entidade));
      return { mensagem: `${lista.length} registro(s) de auditoria.`, dados: { total: lista.length, itens: lista.slice(0, args.limite || 10) } };
    }
  };

  const chegada = {
    nome: 'calcular_chegada_navio',
    titulo: 'Estimativa de chegada',
    descricao: 'Calcula o tempo estimado de viagem por distância, na velocidade padrão de 33 km/h (RN 9).',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        distancia_km: { type: 'number', minimum: 1, maximum: 50000, rotulo: 'Distância (km)', description: 'Distância da rota em quilômetros.' }
      },
      required: ['distancia_km'],
      additionalProperties: false
    },
    executar: (args) => {
      if (typeof window.calcularEstimativaChegada !== 'function') return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Cálculo indisponível nesta página.' };
      return { mensagem: 'Estimativa calculada.', dados: { estimativa: window.calcularEstimativaChegada(args.distancia_km) } };
    }
  };

  const atualizarGraficos = {
    nome: 'atualizar_graficos',
    titulo: 'Atualizar gráficos',
    descricao: 'Consulta o servidor e redesenha os gráficos do painel. Não altera dados.',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const botao = document.getElementById('chartsRefreshBtn');
      if (!botao) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Botão de atualização indisponível nesta página.' };
      botao.click();
      return { mensagem: 'Atualização dos gráficos solicitada.' };
    }
  };

  D.quandoPronto(() => W.registrarPagina({
    id: 'dashboard', arquivo: 'dashboard.html',
    ferramentas: [resumo, detalhar, trilha, auditoria, chegada, atualizarGraficos]
  }));
})(window, document);
