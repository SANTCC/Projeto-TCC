/**
 * Módulo de Gráficos por Camada de Visão (Chart.js) - NexusPort
 * ---------------------------------------------------------------------------
 * Renderiza painéis gráficos adaptados ao CARGO do usuário autenticado,
 * respeitando as três camadas de acesso à informação da Spec (RF 1) e os
 * indicadores do RF 7 / RF 16:
 *
 *  1. Visão Própria (Estivador, Conferente, Arrumador, Planejador, Técnico):
 *     - Gráficos restritos às próprias operações/atribuições do cargo.
 *     - Nenhum dado estratégico (metas, valor declarado, consolidação global).
 *
 *  2. Visão Operacional (Inspetor e Supervisor):
 *     - Indicadores operacionais do terminal (inspeções, fluxo de cargas,
 *       manutenções, ocupação de berços e trail de decisões).
 *     - RESTRIÇÃO RF 1: sem acesso a dados de pessoas (visitantes e
 *       documentação interna de funcionários) — gráficos não são sequer
 *       montados nem carregados para esses cargos.
 *
 *  3. Visão Estratégica (Diretores e Conselho de Administração):
 *     - Consolidado total: taxa de aprovação/recusa, tempo médio de
 *       permanência, embarcações mais utilizadas, produtividade por cargo,
 *       % de berços operacionais e valor declarado movimentado.
 *     - O indicador financeiro (valor declarado) é EXCLUSIVO deste nível.
 *
 * Uso:
 *   NexusCharts.initRelatorios()  -> gráficos do relatorios.html (RF 16)
 *   NexusCharts.atualizar()       -> recarga MANUAL do painel ativo: ignora o
 *                                    cache em memória, reconsulta o Supabase e
 *                                    devolve de onde vieram os dados (servidor
 *                                    × cache local) para a interface informar
 *                                    o operador do botão "Atualizar"
 *
 * Renovação automática: a cada 1 MINUTO (INTERVALO_AUTO_REFRESH_MS), além de
 * imediatamente a cada alteração real de dados (evento `nexus_data_changed`).
 * O heartbeat de sincronização de 10 s do repositório (`periodic_sync`) e o
 * foco da janela NÃO redesenham os gráficos — antes eles causavam o "auto
 * reload" de 10 em 10 segundos.
 * ---------------------------------------------------------------------------
 */

(function (window) {
  'use strict';

  const CDN_CHARTJS = 'https://cdn.jsdelivr.net/npm/chart.js';
  const TTL_CACHE_MS = 4000;

  /**
   * Cadência da renovação AUTOMÁTICA do painel de gráficos: 1 minuto.
   *
   * O painel já foi redesenhado a cada 10 s porque o heartbeat de
   * sincronização do repositório (`periodic_sync`, ver js/data-repository.js)
   * dispara `nexus_data_changed` e o ouvinte abaixo redesenhava tudo. Isso
   * piscava a tela e gastava leituras no Supabase sem dado novo. Agora a
   * renovação automática é de 1 em 1 minuto; alterações reais de dados
   * continuam refletindo na hora (evento com entidade verdadeira) e o botão
   * "Atualizar" força a leitura do servidor a qualquer momento.
   */
  const INTERVALO_AUTO_REFRESH_MS = 60000;

  /**
   * Eventos de sincronização de FUNDO — heartbeat do repositório e foco da
   * janela. Não representam alteração de dados, portanto não redesenham os
   * gráficos (a renovação periódica de 1 minuto cobre esse caso).
   */
  const ENTIDADES_SYNC_FUNDO = ['periodic_sync', 'window_focus'];

  // ---------------------------------------------------------------------
  // Paleta de cores (Specs/design/design.md): barras #445987, linhas #1E293B,
  // grade #E1E5ED, cores semânticas para status.
  // ---------------------------------------------------------------------
  const CORES = {
    primaria: '#445987',
    escura: '#1E293B',
    grade: '#E1E5ED',
    gradeDark: '#334155',
    texto: '#475569',
    textoDark: '#CBD5E1',
    paleta: ['#445987', '#6366F1', '#0D9488', '#D97706', '#C62828', '#7E57C2', '#2E7D32', '#64748B'],
    status: {
      AGENDAMENTO: '#D97706',
      RECEBIMENTO_INSPECAO: '#6366F1',
      ARMAZENAGEM: '#445987',
      PRONTA_PARA_ENTREGA: '#2E7D32',
      EM_TRANSITO: '#0D9488',
      ENTREGUE: '#64748B',
      RECUSADA: '#C62828',
      CANCELADA: '#7E57C2'
    }
  };

  const ROTULOS_STATUS_CARGA = {
    AGENDAMENTO: 'Agendamento',
    RECEBIMENTO_INSPECAO: 'Recebimento/Inspeção',
    ARMAZENAGEM: 'Armazenagem',
    PRONTA_PARA_ENTREGA: 'Pronta p/ Entrega',
    EM_TRANSITO: 'Em Trânsito',
    ENTREGUE: 'Entregue',
    RECUSADA: 'Recusada',
    CANCELADA: 'Cancelada'
  };

  const ROTULOS_CARGO = {
    ESTIVADOR: 'Estivador',
    CONFERENTE_CARGA: 'Conferente de Carga',
    ARRUMADOR_CONSERTADOR: 'Arrumador/Consertador',
    PLANEJADOR_PATIO_NAVIOS: 'Planejador de Pátio',
    TECNICO_PORTOS: 'Técnico em Portos',
    SUPERVISOR_GERENTE_OPERACOES: 'Supervisor/Gerente',
    INSPETOR: 'Inspetor',
    DIRETOR_OPERACOES_LOGISTICA: 'Diretor de Operações',
    DIRETOR_PRESIDENTE_SUPERINTENDENTE: 'Diretor-Presidente',
    CONSELHO_ADMINISTRACAO: 'Conselho de Administração'
  };

  const ROTULOS_DECISAO = {
    APROVOU_CARGA: 'Aprovou Carga',
    RECUSOU_CARGA: 'Recusou Carga',
    LIBEROU_NAVIO: 'Liberou Navio',
    CANCELOU_ENTREGA: 'Cancelou Entrega',
    APROVOU_MANUTENCAO: 'Aprovou Manutenção',
    RECUSOU_MANUTENCAO: 'Recusou Manutenção',
    SOLICITOU_MANUTENCAO_NAVIO: 'Solicitou Manut. Navio',
    SOLICITOU_MANUTENCAO_CONTAINER: 'Solicitou Manut. Contêiner',
    DESIGNOU_SUBSTITUTO: 'Designou Substituto'
  };

  const ROTULOS_MANUTENCAO = {
    SOLICITADA: 'Solicitada',
    APROVADA: 'Aprovada',
    EM_MANUTENCAO: 'Em Manutenção',
    CONCLUIDA: 'Concluída',
    RECUSADA: 'Recusada'
  };

  const ROTULOS_LOCALIZACAO = {
    DENTRO_DO_PORTO: 'Dentro do Porto',
    FORA_DO_PORTO: 'Fora do Porto',
    NO_PORTO_DE_DESTINO: 'No Porto de Destino'
  };

  const ROTULOS_ESTADO_CONTAINER = {
    OPERANTE: 'Operante',
    AGENDADO_PARA_REFORMA: 'Agendado p/ Reforma',
    EM_REFORMA: 'Em Reforma',
    APROVADO_PARA_REFORMA: 'Aprovado p/ Reforma',
    EM_MANUTENCAO: 'Em Manutenção'
  };

  const CARGOS_DIRETOR = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'];
  const CARGOS_OPERACIONAIS = ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS'];
  const CARGOS_SUPERVISAO = ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'];

  const GRUPOS = {
    OPERACIONAL_CARGA: {
      cargo: 'OPERACIONAL',
      titulo: 'Meus indicadores operacionais',
      subtitulo: 'Visão Própria — apenas cargas e registros vinculados às suas atribuições no Terminal STS-01.',
      camada: 'Visão Própria (RLS)',
      fontes: ['cargas', 'logs'],
      charts: [
        {
          id: 'minhas_operacoes_7d',
          titulo: 'Minhas operações registradas (7 dias)',
          descricao: 'Volume diário de registros de auditoria efetuados por você.',
          icone: 'timeline',
          badge: 'RF 12'
        },
        {
          id: 'minhas_cargas_status',
          titulo: 'Minhas cargas por status no fluxo',
          descricao: 'Situação atual das cargas sob sua responsabilidade operacional.',
          icone: 'inventory_2',
          badge: 'RF 6'
        },
        {
          id: 'minhas_cargas_tipo',
          titulo: 'Minhas cargas por tipo',
          descricao: 'Top 5 tipos de carga (natureza da mercadoria) na sua fila de trabalho.',
          icone: 'category',
          badge: 'RF 6'
        }
      ]
    },

    PLANEJADOR_PATIO: {
      cargo: 'PLANEJADOR_PATIO_NAVIOS',
      titulo: 'Painel de pátio e embarcações',
      subtitulo: 'Visão Própria — estado operacional das embarcações, contêineres e seus registros de atualização.',
      camada: 'Visão Própria (RLS)',
      fontes: ['navios', 'containers', 'logs'],
      charts: [
        {
          id: 'navios_localizacao',
          titulo: 'Embarcações por localização (GPS)',
          descricao: 'Classificação DENTRO / FORA do porto e porto de destino (RF 8).',
          icone: 'sailing',
          badge: 'RF 8'
        },
        {
          id: 'containers_estado',
          titulo: 'Contêineres por estado operacional',
          descricao: 'Distribuição da frota de contêineres entre operação e reforma.',
          icone: 'deployed_code',
          badge: 'RF 3'
        },
        {
          id: 'minhas_operacoes_7d',
          titulo: 'Meus registros de atualização (7 dias)',
          descricao: 'Volume diário de atualizações de navios/contêineres efetuadas por você.',
          icone: 'timeline',
          badge: 'RF 12'
        }
      ]
    },

    TECNICO_PORTOS: {
      cargo: 'TECNICO_PORTOS',
      titulo: 'Painel de gestão de pessoas no porto',
      subtitulo: 'Visão Própria ampliada — visitantes temporários, efetivo cadastrado e seus próprios registros (RF 15).',
      camada: 'Visão Própria (RLS)',
      fontes: ['visitantes', 'funcionarios', 'logs'],
      charts: [
        {
          id: 'visitantes_7d',
          titulo: 'Visitantes registrados (7 dias)',
          descricao: 'Entradas temporárias registradas no porto por dia (RF 15).',
          icone: 'groups',
          badge: 'RF 15'
        },
        {
          id: 'visitantes_motivo',
          titulo: 'Visitantes por motivo de entrada',
          descricao: 'Top 5 motivos declarados no registro de visitantes.',
          icone: 'badge',
          badge: 'RF 15'
        },
        {
          id: 'funcionarios_cargo',
          titulo: 'Efetivo ativo por cargo',
          descricao: 'Distribuição dos funcionários ativos por cargo no terminal.',
          icone: 'workspace_premium',
          badge: 'RF 15'
        },
        {
          id: 'meus_registros_pessoas_7d',
          titulo: 'Meus registros de pessoas (7 dias)',
          descricao: 'Volume diário de cadastros/liberações efetuados por você (RF 12).',
          icone: 'timeline',
          badge: 'RF 12'
        }
      ]
    },

    INSPETOR: {
      cargo: 'INSPETOR',
      titulo: 'Painel operacional do inspetor',
      subtitulo: 'Visão Operacional — inspeções técnicas, fluxo de cargas e manutenções. Dados de pessoas não são exibidos (RF 1).',
      camada: 'Visão Operacional (RLS)',
      fontes: ['cargas', 'manutencoes', 'navios'],
      charts: [
        {
          id: 'inspecoes_resultado',
          titulo: 'Resultado das inspeções técnicas',
          descricao: 'Cargas aprovadas, recusadas e pendentes de inspeção formal (RF 6 / RF 9).',
          icone: 'fact_check',
          badge: 'RF 9'
        },
        {
          id: 'cargas_fluxo',
          titulo: 'Cargas por status do fluxo',
          descricao: 'Posição da esteira de cargas nas 8 etapas do fluxo operacional.',
          icone: 'inventory_2',
          badge: 'RF 6'
        },
        {
          id: 'manutencoes_status',
          titulo: 'Manutenções por status',
          descricao: 'Ordens de serviço de navios, contêineres e guindastes por etapa.',
          icone: 'build',
          badge: 'RF 3'
        },
        {
          id: 'navios_localizacao',
          titulo: 'Embarcações por localização (GPS)',
          descricao: 'Cobertura operacional das embarcações monitoradas no terminal.',
          icone: 'sailing',
          badge: 'RF 8'
        }
      ]
    },

    SUPERVISOR: {
      cargo: 'SUPERVISOR_GERENTE_OPERACOES',
      titulo: 'Painel tático de operações',
      subtitulo: 'Visão Operacional — fila de liberação, manutenções, berços e trail de decisões. Dados de pessoas não são exibidos (RF 1).',
      camada: 'Visão Operacional (RLS)',
      fontes: ['cargas', 'manutencoes', 'bercos', 'trail'],
      charts: [
        {
          id: 'fila_liberacao',
          titulo: 'Fila operacional por status de carga',
          descricao: 'Cargas aguardando armazenagem, prontidão e liberação de saída (RN 3 / RN 16).',
          icone: 'conveyor_belt',
          badge: 'RF 6'
        },
        {
          id: 'manutencoes_status',
          titulo: 'Manutenções por status (aprovação)',
          descricao: 'Ordens aguardando sua aprovação, em execução e concluídas (RF 3).',
          icone: 'build',
          badge: 'RF 3'
        },
        {
          id: 'bercos_ocupacao',
          titulo: 'Ocupação dos berços de atracação',
          descricao: '% de berços operacionais (ocupados) em relação à malha do terminal.',
          icone: 'anchor',
          badge: 'RF 7'
        },
        {
          id: 'trail_decisoes_tipo',
          titulo: 'Trail de decisões críticas por tipo',
          descricao: 'Governança das liberações, cancelamentos e aprovações registradas (RF 13).',
          icone: 'gavel',
          badge: 'RF 13'
        }
      ]
    },

    DIRETOR: {
      cargo: 'DIRETOR_OPERACOES_LOGISTICA',
      titulo: 'Painel estratégico consolidado',
      subtitulo: 'Visão Estratégica — consolidação total do terminal, incluindo indicadores financeiros exclusivos deste nível (RF 1 / RF 7).',
      camada: 'Visão Estratégica (RLS)',
      fontes: ['cargas', 'navios', 'bercos', 'logs', 'funcionarios'],
      charts: [
        {
          id: 'aprovacao_recusa',
          titulo: 'Taxa de aprovação e recusa de cargas',
          descricao: 'Resultado consolidado das inspeções técnicas no período.',
          icone: 'verified',
          badge: 'RF 7'
        },
        {
          id: 'tempo_permanencia',
          titulo: 'Tempo médio de permanência por tipo',
          descricao: 'Média de dias da carga no porto (entrada → saída) por natureza de mercadoria.',
          icone: 'schedule',
          badge: 'RF 4'
        },
        {
          id: 'embarcacoes_utilizadas',
          titulo: 'Embarcações mais utilizadas (Top 5)',
          descricao: 'Volume de cargas operadas por embarcação ativa no sistema.',
          icone: 'directions_boat',
          badge: 'RF 2'
        },
        {
          id: 'produtividade_cargo',
          titulo: 'Produtividade operacional por cargo (mês)',
          descricao: 'Operações registradas no mês corrente, considerando apenas operadores ativos.',
          icone: 'engineering',
          badge: 'RF 16'
        },
        {
          id: 'bercos_ocupacao',
          titulo: 'Percentual de berços operacionais',
          descricao: 'Taxa de ocupação da malha de berços do Terminal STS-01.',
          icone: 'anchor',
          badge: 'RF 7'
        },
        {
          id: 'valor_declarado_mes',
          titulo: 'Valor declarado movimentado (6 meses)',
          descricao: 'Indicador financeiro estratégico restrito à Direção e ao Conselho.',
          icone: 'payments',
          badge: 'ESTRATÉGICO'
        }
      ]
    }
  };

  // ---------------------------------------------------------------------
  // Utilidades numéricas, datas e agrupamentos (funções puras)
  // ---------------------------------------------------------------------

  function paraNumero(valor) {
    if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
    if (valor === null || valor === undefined) return 0;
    const limpo = String(valor).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const numero = parseFloat(limpo);
    return isFinite(numero) ? numero : 0;
  }

  function formatarMoeda(valor) {
    return `R$ ${paraNumero(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatarMoedaCompacta(valor) {
    const v = paraNumero(valor);
    if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1).replace('.', ',')} mi`;
    if (v >= 1000) return `R$ ${(v / 1000).toFixed(0)} mil`;
    return `R$ ${v.toFixed(0)}`;
  }

  function formatarNumero(valor) {
    return paraNumero(valor).toLocaleString('pt-BR');
  }

  function chaveDia(dataValor) {
    const data = dataValor ? new Date(dataValor) : new Date();
    if (isNaN(data.getTime())) return null;
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${data.getFullYear()}-${mes}-${dia}`;
  }

  function rotuloDiaCurto(data) {
    return `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Retorna os últimos N dias (mais antigo → mais recente) com chave e rótulo.
   */
  function ultimosDias(qtd) {
    const dias = [];
    const hoje = new Date();
    for (let i = qtd - 1; i >= 0; i--) {
      const data = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i);
      dias.push({ chave: chaveDia(data), rotulo: rotuloDiaCurto(data) });
    }
    return dias;
  }

  /**
   * Conta ocorrências agrupadas pela chave retornada por fnChave.
   */
  function contarPor(lista, fnChave) {
    const mapa = new Map();
    (Array.isArray(lista) ? lista : []).forEach(item => {
      const chave = fnChave(item);
      if (chave === null || chave === undefined || chave === '') return;
      mapa.set(chave, (mapa.get(chave) || 0) + 1);
    });
    return mapa;
  }

  /**
   * Conta ocorrências agrupadas e somando o valor retornado por fnValor.
   */
  function somarPor(lista, fnChave, fnValor) {
    const mapa = new Map();
    (Array.isArray(lista) ? lista : []).forEach(item => {
      const chave = fnChave(item);
      if (chave === null || chave === undefined || chave === '') return;
      mapa.set(chave, (mapa.get(chave) || 0) + paraNumero(fnValor(item)));
    });
    return mapa;
  }

  function ordenarMapa(mapa, limite) {
    const ordenado = Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]);
    return limite ? ordenado.slice(0, limite) : ordenado;
  }

  function somaMapa(mapa) {
    let total = 0;
    mapa.forEach(v => { total += v; });
    return total;
  }

  function percentual(parte, total) {
    if (!total) return 0;
    return Math.round((parte / total) * 1000) / 10;
  }

  function diferencaEmDias(inicio, fim) {
    if (!inicio) return null;
    const d1 = new Date(inicio).getTime();
    const d2 = fim ? new Date(fim).getTime() : Date.now();
    if (isNaN(d1) || isNaN(d2)) return null;
    return Math.max(0, (d2 - d1) / (1000 * 60 * 60 * 24));
  }

  function normalizarCargo(valor) {
    if (!valor) return 'NAO_INFORMADO';
    const bruto = String(valor).trim();
    if (ROTULOS_CARGO[bruto]) return bruto;
    const upper = bruto.toUpperCase();
    const encontrado = Object.keys(ROTULOS_CARGO).find(k => k === upper);
    if (encontrado) return encontrado;
    const porNome = Object.keys(ROTULOS_CARGO).find(k => ROTULOS_CARGO[k].toUpperCase() === upper);
    return porNome || 'NAO_INFORMADO';
  }

  function nomeCargo(cargo) {
    const chave = normalizarCargo(cargo);
    return ROTULOS_CARGO[chave] || String(cargo || 'Não informado');
  }

  function chaveMes(dataValor) {
    const data = dataValor ? new Date(dataValor) : null;
    if (!data || isNaN(data.getTime())) return null;
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
  }

  function rotuloMes(chave) {
    const [ano, mes] = String(chave).split('-');
    const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${nomes[parseInt(mes, 10) - 1]}/${String(ano).slice(2)}`;
  }

  function ultimosMeses(qtd) {
    const meses = [];
    const hoje = new Date();
    for (let i = qtd - 1; i >= 0; i--) {
      const data = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
      meses.push({ chave, rotulo: rotuloMes(chave) });
    }
    return meses;
  }

  // ---------------------------------------------------------------------
  // Camadas de visão (RF 1) — controle de escopo de dados
  // ---------------------------------------------------------------------

  function grupoDoCargo(cargo) {
    const bruto = String(cargo || '').toUpperCase();
    if (CARGOS_DIRETOR.includes(bruto)) return 'DIRETOR';
    if (bruto === 'INSPETOR') return 'INSPETOR';
    if (bruto === 'SUPERVISOR_GERENTE_OPERACOES') return 'SUPERVISOR';
    if (bruto === 'TECNICO_PORTOS') return 'TECNICO_PORTOS';
    if (bruto === 'PLANEJADOR_PATIO_NAVIOS') return 'PLANEJADOR_PATIO';
    return 'OPERACIONAL_CARGA';
  }

  function ehVisaoPropria(sessao) {
    const cargo = String((sessao && sessao.cargo) || '').toUpperCase();
    return CARGOS_OPERACIONAIS.includes(cargo) || cargo === 'TECNICO_PORTOS';
  }

  /**
   * Dados de pessoas (visitantes/documentação de funcionários): RF 1 nega
   * acesso ao Inspetor e ao Supervisor. Usa a Vision Layer quando disponível.
   */
  function podeVerDadosDePessoas(sessao, modulo) {
    const alvo = modulo || 'visitantes';
    if (!sessao || !sessao.cargo) return false;
    if (window.NexusVision && typeof window.NexusVision.hasAccessToModule === 'function') {
      return window.NexusVision.hasAccessToModule(alvo, sessao);
    }
    const cargo = String(sessao.cargo).toUpperCase();
    if (CARGOS_DIRETOR.includes(cargo) || cargo === 'TECNICO_PORTOS') return true;
    return false;
  }

  /**
   * Visão Própria: o funcionário enxerga apenas as entidades ligadas às suas
   * atribuições. Reutiliza a regra oficial da Vision Layer quando disponível.
   */
  function filtrarCargasPorVisao(cargas, sessao) {
    if (!sessao || !ehVisaoPropria(sessao)) return cargas;
    if (window.NexusVision && typeof window.NexusVision.filterCargasForUser === 'function') {
      return window.NexusVision.filterCargasForUser(cargas, sessao);
    }
    const cargo = String(sessao.cargo).toUpperCase();
    const identificadores = [sessao.matricula, sessao.codigo_individual].filter(Boolean).map(v => String(v));
    const pertence = (valor) => valor && identificadores.includes(String(valor));
    return cargas.filter(c => {
      if (cargo === 'ESTIVADOR') return pertence(c.estivador) || ['ARMAZENAGEM', 'RECEBIMENTO_INSPECAO'].includes(c.status);
      if (cargo === 'CONFERENTE_CARGA') return pertence(c.conferente) || ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO'].includes(c.status);
      if (cargo === 'ARRUMADOR_CONSERTADOR') return pertence(c.arrumador) || ['ARMAZENAGEM', 'PRONTA_PARA_ENTREGA'].includes(c.status);
      return true;
    });
  }

  /**
   * Escopo dos logs de auditoria: Visão Própria filtra pelo próprio código;
   * Inspetor/Supervisor/Direção leem os logs operacionais completos (RF 1).
   */
  function filtrarLogsPorVisao(logs, sessao) {
    if (!sessao || !ehVisaoPropria(sessao)) return logs;
    const identificadores = [sessao.codigo_individual, sessao.codigo, sessao.matricula, sessao.id]
      .filter(Boolean).map(v => String(v));
    return logs.filter(l => {
      const chaves = [
        l.codigo,
        l.codigo_individual,
        l.codigo_usuario,
        l.codigo_usuario_individual,
        l.matricula,
        l.funcionarioId,
        l.funcionario_id
      ].filter(Boolean).map(v => String(v));
      return chaves.some(k => identificadores.includes(k));
    });
  }

  // ---------------------------------------------------------------------
  // Normalização das entidades vindas do Supabase ou do cache local
  // ---------------------------------------------------------------------

  function normalizarCarga(c) {
    return {
      id: c.id || c.rawDbId || c.qr_code_url || '',
      status: String(c.status || c.status_fluxo || 'AGENDAMENTO').toUpperCase(),
      tipo: c.tipo || c.natureza || 'Carga Geral',
      natureza: c.natureza || c.tipo || 'Carga Geral',
      peso: paraNumero(c.peso),
      volume: paraNumero(c.volume),
      valor: paraNumero(c.valor_declarado !== undefined ? c.valor_declarado : c.valor),
      navioId: c.navioId || c.navio_id || null,
      navioNome: c.navio || c.navioNome || null,
      containerId: c.container || c.container_id || c.containerId || null,
      dataEntrada: c.data_entrada || c.dataChegada || c.created_at || c.data_cadastro || c.dataEntrada || null,
      dataSaida: c.data_saida || c.dataSaida || null,
      inspecao: String(c.resultado_inspecao || c.inspecao || '').toUpperCase() || null,
      estivador: c.estivador_id || c.estivadorMatricula || c.estivador || null,
      conferente: c.conferente_id || c.conferenteMatricula || c.conferente || null,
      arrumador: c.arrumador_id || c.arrumadorMatricula || c.arrumador || null
    };
  }

  function normalizarNavio(n) {
    return {
      id: n.id || n.navio_id || n.nome || '',
      nome: n.nome || 'Embarcação',
      imo: n.numero_imo || n.imo || '',
      estado: String(n.estado_operacional || n.estado || 'OPERANTE').toUpperCase(),
      localizacao: String(n.localizacao || 'DENTRO_DO_PORTO').toUpperCase(),
      operacoes: paraNumero(n.quantidade_cargas_realizadas !== undefined ? n.quantidade_cargas_realizadas : n.operacoes),
      portoDestino: n.porto_destino || n.destino || n.portoDestino || null,
      dataSaida: n.data_saida || n.dataSaida || null
    };
  }

  function normalizarContainer(c) {
    return {
      id: c.id || c.numero_identificacao || '',
      identificacao: c.numero_identificacao || c.identificacao || c.id || 'Contêiner',
      estado: String(c.estado || 'OPERANTE').toUpperCase()
    };
  }

  function normalizarManutencao(m) {
    return {
      id: m.id || '',
      status: String(m.status || 'SOLICITADA').toUpperCase(),
      entidade: String(m.entidade_tipo || m.equipamento_tipo || m.entidade || 'EQUIPAMENTO').toUpperCase(),
      descricao: m.descricao || '',
      data: m.data_solicitacao || m.created_at || m.data_manutencao || null
    };
  }

  function normalizarLog(l) {
    return {
      data: l.data_hora || l.created_at || l.data || null,
      cargoNome: l.cargo_nome || null,
      cargo: normalizarCargo(l.cargo || l.cargo_nome),
      codigo: l.codigo_individual || l.codigo_usuario || l.codigo || null,
      funcionarioId: l.funcionario_id || l.funcionarioId || null,
      entidade: String(l.entidade_tipo || l.entidade || '').toUpperCase(),
      tipoAlteracao: String(l.tipo_alteracao || '').toUpperCase()
    };
  }

  function normalizarVisitante(v) {
    return {
      nome: v.nome || 'Visitante',
      motivo: (v.motivo || '').trim() || 'Não informado',
      entrada: v.data_hora_entrada || v.data_entrada || v.created_at || v.data || v.entrada || null,
      saida: v.data_hora_saida || v.data_saida || v.saida || null
    };
  }

  function normalizarFuncionario(f) {
    return {
      id: f.id || f.matricula || '',
      nome: f.nome || 'Colaborador',
      cargo: normalizarCargo(f.cargo || f.cargo_nome),
      ativo: f.ativo === undefined ? true : !!f.ativo,
      matricula: f.matricula || '',
      codigo: f.codigo_individual || f.codigo || ''
    };
  }

  function normalizarBerco(b) {
    return {
      nome: b.nome || b.id || 'Berço',
      estado: String(b.estado || 'LIVRE').toUpperCase(),
      navio: b.navio_nome || null
    };
  }

  function normalizarTrail(t) {
    return {
      decisao: String(t.tipo_decisao || t.decisao || 'DECISAO').toUpperCase(),
      data: t.data_hora || t.created_at || t.data || null,
      entidade: String(t.entidade_tipo || '').toUpperCase()
    };
  }

  /**
   * Normaliza um pacote completo de dados. Aceita tanto registros crus
   * (Supabase / localStorage) quanto registros já normalizados — a operação é
   * idempotente e garante que os construtores sempre leiam as mesmas chaves.
   */
  function normalizarDados(dados) {
    const origem = dados || {};
    return {
      cargas: (origem.cargas || []).map(normalizarCarga),
      navios: (origem.navios || []).map(normalizarNavio),
      containers: (origem.containers || []).map(normalizarContainer),
      manutencoes: (origem.manutencoes || []).map(normalizarManutencao),
      bercos: (origem.bercos || []).map(normalizarBerco),
      funcionarios: (origem.funcionarios || []).map(normalizarFuncionario),
      visitantes: (origem.visitantes || []).map(normalizarVisitante),
      logs: (origem.logs || []).map(normalizarLog),
      trail: (origem.trail || []).map(normalizarTrail)
    };
  }

  function construirSpec(id, dados, sessao) {
    const construtor = CONSTRUTORES[id];
    if (!construtor) return null;
    return construtor(normalizarDados(dados), sessao || {});
  }

  // ---------------------------------------------------------------------
  // Carregamento de dados (Supabase → fallback cache local) por escopo
  // ---------------------------------------------------------------------

  const cacheDados = { chave: '', timestamp: 0, dados: null, promessa: null };
  let tokenCarregamento = 0;

  // Metadados do último carregamento concluído: de ONDE vieram as linhas de cada
  // tabela (servidor Supabase × cache local) e quando. É o que permite ao botão
  // "Atualizar" informar o operador se o painel realmente trouxe dado novo do
  // servidor ou se está operando com o cache local (fallback offline) — antes o
  // clique redesenha o gráfico sem que ninguém saiba que nada novo foi lido.
  const ROTULOS_ORIGEM = {
    supabase: 'servidor (Supabase)',
    local: 'cache local',
    misto: 'servidor + cache local'
  };
  let metaCarregamento = { origem: 'local', atualizadoEm: null, porFonte: {}, forcar: false };

  function lerLocalStorage(chave) {
    try {
      return JSON.parse(window.localStorage.getItem(chave) || '[]');
    } catch (e) {
      return [];
    }
  }

  /** Marca a tabela como atendida pelo cache local e devolve as linhas. */
  function dadosLocais(tabela, chaveLocal, meta) {
    if (meta) meta.porFonte[tabela] = 'local';
    return lerLocalStorage(chaveLocal);
  }

  /**
   * Consulta uma tabela no Supabase (fonte oficial dos gráficos).
   *
   * @param {string} tabela
   * @param {object} sessao
   * @param {{forcar?: boolean, meta?: object}} [opcoes]
   *        `forcar: true` = recarga manual (botão "Atualizar"): reabre tabelas
   *        marcadas como ausentes nesta sessão, para que uma migração aplicada
   *        com a tela aberta passe a trazer dados reais sem recarregar a página.
   * @returns {Promise<Array|null>} linhas do servidor, ou null para usar o cache local
   */
  async function consultarTabela(tabela, sessao, opcoes) {
    const cfg = opcoes || {};
    const meta = cfg.meta;
    const utils = window.NexusSupabaseUtils;

    if (cfg.forcar && utils && typeof utils.liberarTabela === 'function') {
      utils.liberarTabela(tabela);
    }

    // Tabela já diagnosticada como ausente (PGRST205 / HTTP 404): não repete uma
    // requisição condenada ao 404 — o painel segue com o cache local e o aviso
    // aponta exatamente a migração pendente.
    if (utils && typeof utils.clientePara === 'function' && !utils.clientePara(tabela)) return null;

    const client = window.nexusSupabase;
    if (!client) return null;
    try {
      let query = client.from(tabela).select('*');
      if (tabela === 'logs_alteracoes' || tabela === 'trail_decisoes') {
        query = query.order('data_hora', { ascending: false }).limit(500);
      } else if (tabela === 'cargas') {
        query = query.limit(500);
      } else if (tabela === 'visitantes') {
        query = query.order('data_hora_entrada', { ascending: false }).limit(300);
      }
      const { data, error } = await query;
      if (error) throw error;
      if (!Array.isArray(data)) return null;
      if (meta) meta.porFonte[tabela] = 'supabase';
      return data;
    } catch (erro) {
      if (meta) meta.porFonte[tabela] = 'local';
      // Registra o erro (uma vez por tabela/sessão) e mantém o app operando.
      if (utils && typeof utils.registrarErroTabela === 'function') {
        utils.registrarErroTabela(tabela, erro);
      } else {
        console.warn(`[NexusCharts] Tabela ${tabela} indisponível no Supabase, usando cache local.`, erro && erro.message);
      }
      return null;
    }
  }

  /**
   * Monta o pacote de dados necessário para o grupo de gráficos do cargo,
   * carregando estritamente as fontes permitidas pela camada de visão.
   *
   * @param {object} sessao
   * @param {Array<string>} fontes
   * @param {{forcar?: boolean}} [opcoes] - `forcar: true` (botão "Atualizar")
   *        ignora o cache em memória e reconsulta o servidor agora.
   */
  async function carregarDados(sessao, fontes, opcoes) {
    const forcar = !!(opcoes && opcoes.forcar);
    const listaFontes = Array.isArray(fontes) ? fontes : [];
    const chaveCache = `${sessao && sessao.cargo}|${listaFontes.join(',')}|${sessao && sessao.codigo_individual}`;
    const agora = Date.now();

    // Recarga manual nunca reaproveita o cache em memória (TTL de 4s): o
    // operador pediu o estado do servidor AGORA e o clique precisa refleti-lo.
    if (!forcar && cacheDados.dados && cacheDados.chave === chaveCache && (agora - cacheDados.timestamp) < TTL_CACHE_MS) {
      return cacheDados.dados;
    }
    if (!forcar && cacheDados.promessa && cacheDados.chave === chaveCache) {
      return cacheDados.promessa;
    }
    if (forcar) invalidarCache();

    const promessa = (async () => {
      const meta = { origem: 'local', atualizadoEm: null, porFonte: {}, forcar: forcar };
      const meuTokenCarga = ++tokenCarregamento;
      const buscar = tabela => consultarTabela(tabela, sessao, { forcar: forcar, meta: meta });

      const dados = {
        cargas: [],
        navios: [],
        containers: [],
        manutencoes: [],
        bercos: [],
        funcionarios: [],
        visitantes: [],
        logs: [],
        trail: []
      };

      // ---- Cargas (Visão Própria aplica filtro por atribuição)
      if (listaFontes.includes('cargas')) {
        const bruto = await buscar('cargas');
        const origem = bruto || dadosLocais('cargas', 'nexus_cargas_fluxo', meta);
        dados.cargas = filtrarCargasPorVisao(origem.map(normalizarCarga), sessao);
      }

      // ---- Navios e contêineres
      if (listaFontes.includes('navios')) {
        const bruto = await buscar('navios');
        dados.navios = (bruto || dadosLocais('navios', 'nexus_navios_list', meta)).map(normalizarNavio);
      }
      if (listaFontes.includes('containers')) {
        const bruto = await buscar('containers');
        dados.containers = (bruto || dadosLocais('containers', 'nexus_containers_list', meta)).map(normalizarContainer);
      }

      // ---- Manutenções
      if (listaFontes.includes('manutencoes')) {
        const bruto = await buscar('manutencoes');
        dados.manutencoes = (bruto || dadosLocais('manutencoes', 'nexus_os_list', meta)).map(normalizarManutencao);
      }

      // ---- Berços de atracação
      if (listaFontes.includes('bercos')) {
        const bruto = await buscar('bercos');
        dados.bercos = (bruto || dadosLocais('bercos', 'nexus_bercos_list', meta)).map(normalizarBerco);
      }

      // ---- Trail de decisões críticas
      if (listaFontes.includes('trail')) {
        const bruto = await buscar('trail_decisoes');
        dados.trail = (bruto || dadosLocais('trail_decisoes', 'nexus_trail_decisoes', meta)).map(normalizarTrail);
      }

      // ---- Logs de auditoria (escopo próprio ou operacional completo)
      if (listaFontes.includes('logs')) {
        const bruto = await buscar('logs_alteracoes');
        dados.logs = filtrarLogsPorVisao((bruto || dadosLocais('logs_alteracoes', 'nexus_audit_logs', meta)).map(normalizarLog), sessao);
      }

      // ---- Pessoas: somente cargos autorizados pela Vision Layer (RF 1)
      if (listaFontes.includes('funcionarios') && podeVerDadosDePessoas(sessao, 'documentacao_funcionarios')) {
        const bruto = await buscar('funcionarios');
        dados.funcionarios = (bruto || dadosLocais('funcionarios', 'nexus_func_list', meta)).map(normalizarFuncionario);
      }

      if (listaFontes.includes('visitantes') && podeVerDadosDePessoas(sessao, 'visitantes')) {
        const bruto = await buscar('visitantes');
        dados.visitantes = (bruto || dadosLocais('visitantes', 'nexus_vis_list', meta)).map(normalizarVisitante);
      }

      // Sanitização estratégica: valor declarado só transita na Visão Estratégica.
      if (!sessao || !CARGOS_DIRETOR.includes(String(sessao.cargo || '').toUpperCase())) {
        dados.cargas = dados.cargas.map(c => Object.assign({}, c, { valor: 0 }));
      }

      // Resumo da origem: o que veio do servidor e o que caiu no cache local.
      const origens = Object.keys(meta.porFonte).map(tabela => meta.porFonte[tabela]);
      const usouServidor = origens.indexOf('supabase') >= 0;
      const usouLocal = origens.indexOf('local') >= 0;
      meta.origem = usouServidor ? (usouLocal ? 'misto' : 'supabase') : 'local';
      meta.atualizadoEm = new Date().toISOString();

      // Uma carga mais recente pode ter sido disparada durante os awaits: a
      // última concluída é a que descreve os dados realmente disponíveis.
      if (meuTokenCarga === tokenCarregamento) metaCarregamento = meta;

      return dados;
    })();

    cacheDados.chave = chaveCache;
    cacheDados.promessa = promessa;
    const resultado = await promessa;
    cacheDados.dados = resultado;
    cacheDados.timestamp = Date.now();
    cacheDados.promessa = null;
    return resultado;
  }

  function invalidarCache() {
    cacheDados.dados = null;
    cacheDados.promessa = null;
    cacheDados.timestamp = 0;
    cacheDados.chave = '';
  }

  /** Texto legível da origem do último carregamento (servidor × cache local). */
  function textoOrigem(origem) {
    return ROTULOS_ORIGEM[origem] || ROTULOS_ORIGEM.local;
  }

  // ---------------------------------------------------------------------
  // Construtores de gráficos (cada um devolve um "spec" ou null = vazio)
  // ---------------------------------------------------------------------

  function datasetBarras(rotulo, valores, cores) {
    return {
      label: rotulo,
      data: valores,
      backgroundColor: cores || CORES.primaria,
      borderRadius: 6,
      maxBarThickness: 34
    };
  }

  function classificarInspecao(carga) {
    if (carga.status === 'CANCELADA') return 'CANCELADA';
    const resultado = (carga.inspecao || '').toUpperCase();
    if (resultado.includes('RECUS')) return 'RECUSADA';
    if (resultado.includes('APROV')) return 'APROVADA';
    if (carga.status === 'RECUSADA') return 'RECUSADA';
    if (['ARMAZENAGEM', 'PRONTA_PARA_ENTREGA', 'EM_TRANSITO', 'ENTREGUE'].includes(carga.status)) return 'APROVADA';
    return 'PENDENTE';
  }

    /**
   * Normaliza a categoria do tipo de carga para evitar duplicidades no gráfico
   * devido a diferenças de caixa e acentuação (ex: 'Perecível' vs 'PERECIVEL').
   */
  function normalizarTipoCarga(tipo) {
    if (!tipo) return 'Carga Geral';
    const str = String(tipo).trim();
    if (!str) return 'Carga Geral';

    const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const chave = semAcento(str);

    const tipos = (typeof window !== 'undefined' && Array.isArray(window.NEXUS_TIPOS_CARGA)) ? window.NEXUS_TIPOS_CARGA : [];
    for (const t of tipos) {
      const nomeOficial = typeof t === 'string' ? t : (t && t.nome);
      if (nomeOficial && semAcento(nomeOficial) === chave) {
        return nomeOficial;
      }
    }

    // Capitalização limpa se não constar no catálogo
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  const CONSTRUTORES = {
    /** Volume diário de logs do próprio usuário (Visão Própria). */
    minhas_operacoes_7d: function (dados, sessao) {
      const dias = ultimosDias(7);
      const porDia = contarPor(dados.logs, l => chaveDia(l.data));
      const valores = dias.map(d => porDia.get(d.chave) || 0);
      const total = valores.reduce((a, b) => a + b, 0);
      if (total === 0) return null;
      return {
        tipo: 'line',
        labels: dias.map(d => d.rotulo),
        datasets: [{
          label: 'Registros de auditoria',
          data: valores,
          borderColor: CORES.escura,
          backgroundColor: 'rgba(68, 89, 135, 0.18)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: CORES.primaria
        }],
        resumo: `${total} registro(s) de auditoria nos últimos 7 dias • média de ${(total / 7).toFixed(1)}/dia`
      };
    },

    /** Cargas sob responsabilidade do usuário por status do fluxo. */
    minhas_cargas_status: function (dados) {
      if (!dados.cargas.length) return null;
      const porStatus = contarPor(dados.cargas, c => c.status);
      const entradas = ordenarMapa(porStatus);
      const total = dados.cargas.length;
      const prontas = porStatus.get('PRONTA_PARA_ENTREGA') || 0;
      return {
        tipo: 'doughnut',
        labels: entradas.map(([status]) => ROTULOS_STATUS_CARGA[status] || status),
        datasets: [{
          label: 'Cargas',
          data: entradas.map(([, qtd]) => qtd),
          backgroundColor: entradas.map(([status]) => CORES.status[status] || CORES.primaria),
          borderWidth: 0
        }],
        resumo: `${total} carga(s) na sua fila • ${prontas} pronta(s) para entrega aguardando liberação do Supervisor`
      };
    },

    /** Top 5 tipos de carga da fila do usuário. */
    minhas_cargas_tipo: function (dados) {
      if (!dados.cargas.length) return null;
      const porTipo = ordenarMapa(contarPor(dados.cargas, c => c.tipo), 5);
      const total = dados.cargas.length;
      const principal = porTipo[0];
      return {
        tipo: 'bar',
        labels: porTipo.map(([tipo]) => tipo),
        datasets: [datasetBarras('Cargas na minha fila', porTipo.map(([, qtd]) => qtd), CORES.primaria)],
        resumo: principal
          ? `Tipo predominante: ${principal[0]} (${principal[1]} de ${total} carga(s) — ${percentual(principal[1], total)}%)`
          : `${total} carga(s) na fila`
      };
    },

    /** Embarcações por localização classificada (RF 8). */
    navios_localizacao: function (dados) {
      if (!dados.navios.length) return null;
      const porLocal = contarPor(dados.navios, n => n.localizacao);
      const entradas = ordenarMapa(porLocal);
      const dentro = porLocal.get('DENTRO_DO_PORTO') || 0;
      return {
        tipo: 'doughnut',
        labels: entradas.map(([loc]) => ROTULOS_LOCALIZACAO[loc] || loc),
        datasets: [{
          label: 'Embarcações',
          data: entradas.map(([, qtd]) => qtd),
          backgroundColor: ['#445987', '#0D9488', '#D97706', '#64748B'],
          borderWidth: 0
        }],
        resumo: `${dados.navios.length} embarcação(ões) monitorada(s) • ${dentro} atracada(s) no terminal (${percentual(dentro, dados.navios.length)}%)`
      };
    },

    /** Contêineres por estado operacional. */
    containers_estado: function (dados) {
      if (!dados.containers.length) return null;
      const porEstado = contarPor(dados.containers, c => c.estado);
      const entradas = ordenarMapa(porEstado);
      const manutencao = dados.containers.filter(c => c.estado !== 'OPERANTE').length;
      return {
        tipo: 'bar',
        labels: entradas.map(([estado]) => ROTULOS_ESTADO_CONTAINER[estado] || estado),
        datasets: [datasetBarras('Contêineres', entradas.map(([, qtd]) => qtd), ['#445987', '#D97706', '#C62828', '#7E57C2', '#64748B'])],
        resumo: `${dados.containers.length} contêiner(es) cadastrado(s) • ${manutencao} fora de operação (reforma/manutenção)`
      };
    },

    /** Visitantes registrados por dia (RF 15). */
    visitantes_7d: function (dados) {
      const dias = ultimosDias(7);
      const porDia = contarPor(dados.visitantes, v => chaveDia(v.entrada));
      const valores = dias.map(d => porDia.get(d.chave) || 0);
      const total = valores.reduce((a, b) => a + b, 0);
      if (!dados.visitantes.length) return null;
      return {
        tipo: 'bar',
        labels: dias.map(d => d.rotulo),
        datasets: [datasetBarras('Visitantes registrados', valores, CORES.primaria)],
        resumo: `${total} visitante(s) registrado(s) nos últimos 7 dias • ${dados.visitantes.filter(v => v.saida).length} com saída confirmada`
      };
    },

    /** Visitantes por motivo de entrada (top 5). */
    visitantes_motivo: function (dados) {
      if (!dados.visitantes.length) return null;
      const porMotivo = ordenarMapa(contarPor(dados.visitantes, v => v.motivo), 5);
      return {
        tipo: 'doughnut',
        labels: porMotivo.map(([motivo]) => motivo.length > 26 ? `${motivo.slice(0, 24)}…` : motivo),
        datasets: [{
          label: 'Visitantes',
          data: porMotivo.map(([, qtd]) => qtd),
          backgroundColor: CORES.paleta,
          borderWidth: 0
        }],
        resumo: `Motivo mais recorrente: ${porMotivo[0][0]} (${porMotivo[0][1]} entrada(s) de ${dados.visitantes.length})`
      };
    },

    /** Efetivo ativo por cargo (RF 15). */
    funcionarios_cargo: function (dados) {
      const ativos = dados.funcionarios.filter(f => f.ativo !== false);
      if (!ativos.length) return null;
      const porCargo = ordenarMapa(contarPor(ativos, f => f.cargo));
      return {
        tipo: 'bar',
        horizontal: true,
        labels: porCargo.map(([cargo]) => nomeCargo(cargo)),
        datasets: [datasetBarras('Funcionários ativos', porCargo.map(([, qtd]) => qtd), CORES.primaria)],
        resumo: `${ativos.length} funcionário(s) ativo(s) distribuído(s) em ${porCargo.length} cargo(s)`
      };
    },

    /** Registros de pessoas efetuados pelo próprio técnico. */
    meus_registros_pessoas_7d: function (dados, sessao) {
      const dias = ultimosDias(7);
      const meus = filtrarLogsPorVisao(dados.logs, sessao);
      const porDia = contarPor(meus, l => chaveDia(l.data));
      const valores = dias.map(d => porDia.get(d.chave) || 0);
      const total = valores.reduce((a, b) => a + b, 0);
      if (total === 0) return null;
      return {
        tipo: 'line',
        labels: dias.map(d => d.rotulo),
        datasets: [{
          label: 'Cadastros e liberações',
          data: valores,
          borderColor: CORES.escura,
          backgroundColor: 'rgba(68, 89, 135, 0.18)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: CORES.primaria
        }],
        resumo: `${total} registro(s) de pessoas efetuado(s) por você nos últimos 7 dias`
      };
    },

    /** Resultado consolidado das inspeções técnicas. */
    inspecoes_resultado: function (dados) {
      if (!dados.cargas.length) return null;
      // Deduplicação por ID de carga para evitar contagem múltipla da mesma carga
      const cargasUnicas = [];
      const vistos = new Set();
      dados.cargas.forEach(c => {
        const id = c.id || c.qr_code_url || JSON.stringify(c);
        if (!vistos.has(id)) {
          vistos.add(id);
          cargasUnicas.push(c);
        }
      });

      const porResultado = new Map([['APROVADA', 0], ['RECUSADA', 0], ['PENDENTE', 0], ['CANCELADA', 0]]);
      cargasUnicas.forEach(c => {
        const chave = classificarInspecao(c);
        porResultado.set(chave, (porResultado.get(chave) || 0) + 1);
      });
      const total = cargasUnicas.length;
      if (total === 0) return null;
      const aprovadas = porResultado.get('APROVADA') || 0;
      const recusadas = porResultado.get('RECUSADA') || 0;
      const pendentes = porResultado.get('PENDENTE') || 0;
      const canceladas = porResultado.get('CANCELADA') || 0;

      // Cargas canceladas são excluídas da taxa de aprovação/eficiência
      const baseCalculoTaxa = total - canceladas;
      const taxaAprovacao = baseCalculoTaxa > 0 ? percentual(aprovadas, baseCalculoTaxa) : 0;
      const taxaRecusa = baseCalculoTaxa > 0 ? percentual(recusadas, baseCalculoTaxa) : 0;

      return {
        tipo: 'doughnut',
        labels: ['Aprovadas', 'Recusadas', 'Pendentes', 'Canceladas'],
        datasets: [{
          label: 'Cargas',
          data: [aprovadas, recusadas, pendentes, canceladas],
          backgroundColor: ['#2E7D32', '#C62828', '#D97706', '#64748B'],
          borderWidth: 0
        }],
        resumo: `${total} carga(s) analisada(s) (${aprovadas} aprovadas, ${recusadas} recusadas, ${pendentes} pendentes, ${canceladas} canceladas) • taxa de aprovação de ${taxaAprovacao}% e recusa de ${taxaRecusa}% (excluindo canceladas)`
      };
    },

    /** Cargas por status do fluxo (esteira operacional). */
    cargas_fluxo: function (dados) {
      if (!dados.cargas.length) return null;
      const porStatus = contarPor(dados.cargas, c => c.status);
      const entradas = ordenarMapa(porStatus);
      const prontas = porStatus.get('PRONTA_PARA_ENTREGA') || 0;
      const armazenadas = porStatus.get('ARMAZENAGEM') || 0;
      return {
        tipo: 'bar',
        labels: entradas.map(([status]) => ROTULOS_STATUS_CARGA[status] || status),
        datasets: [datasetBarras('Cargas no fluxo', entradas.map(([, qtd]) => qtd), entradas.map(([status]) => CORES.status[status] || CORES.primaria))],
        resumo: `${dados.cargas.length} carga(s) no fluxo • ${armazenadas} em armazenagem e ${prontas} aguardando liberação`
      };
    },

    /** Ordens de manutenção por status (RF 3). */
    manutencoes_status: function (dados) {
      if (!dados.manutencoes.length) return null;
      const porStatus = contarPor(dados.manutencoes, m => m.status);
      const entradas = ordenarMapa(porStatus);
      const pendentes = (porStatus.get('SOLICITADA') || 0) + (porStatus.get('APROVADA') || 0);
      return {
        tipo: 'bar',
        labels: entradas.map(([status]) => ROTULOS_MANUTENCAO[status] || status),
        datasets: [datasetBarras('Ordens de serviço', entradas.map(([, qtd]) => qtd), entradas.map(([status]) => status === 'RECUSADA' ? '#C62828' : status === 'CONCLUIDA' ? '#2E7D32' : '#D97706'))],
        resumo: `${dados.manutencoes.length} ordem(ns) de serviço registrada(s) • ${pendentes} aguardando aprovação/execução`
      };
    },

    /** Fila operacional do Supervisor (RN 3 / RN 16). */
    fila_liberacao: function (dados) {
      if (!dados.cargas.length) return null;
      const porStatus = contarPor(dados.cargas, c => c.status);
      const entradas = ordenarMapa(porStatus);
      const prontas = porStatus.get('PRONTA_PARA_ENTREGA') || 0;
      const armazenadas = porStatus.get('ARMAZENAGEM') || 0;
      const canceladas = (porStatus.get('CANCELADA') || 0) + (porStatus.get('RECUSADA') || 0);
      return {
        tipo: 'bar',
        labels: entradas.map(([status]) => ROTULOS_STATUS_CARGA[status] || status),
        datasets: [datasetBarras('Cargas por status', entradas.map(([, qtd]) => qtd), entradas.map(([status]) => CORES.status[status] || CORES.primaria))],
        resumo: `Fila de liberação: ${prontas} pronta(s) para entrega + ${armazenadas} em armazenagem • ${canceladas} recusada(s)/cancelada(s)`
      };
    },

    /** Percentual de berços ocupados (operacionais) no terminal. */
    bercos_ocupacao: function (dados) {
      if (!dados.bercos.length) return null;
      const total = dados.bercos.length;
      const ocupados = dados.bercos.filter(b => b.estado === 'OCUPADO').length;
      const livres = total - ocupados;
      const taxa = percentual(ocupados, total);
      return {
        tipo: 'doughnut',
        labels: ['Berços ocupados', 'Berços livres'],
        datasets: [{
          label: 'Berços',
          data: [ocupados, livres],
          backgroundColor: ['#445987', '#E1E5ED'],
          borderWidth: 0
        }],
        resumo: `${taxa}% de berços operacionais • ${ocupados} ocupado(s) de ${total} berço(s) da malha STS-01`
      };
    },

    /** Trail de decisões críticas agrupado por tipo (RF 13). */
    trail_decisoes_tipo: function (dados) {
      if (!dados.trail.length) return null;
      const porDecisao = ordenarMapa(contarPor(dados.trail, t => t.decisao));
      return {
        tipo: 'bar',
        horizontal: true,
        labels: porDecisao.map(([decisao]) => ROTULOS_DECISAO[decisao] || decisao),
        datasets: [datasetBarras('Decisões registradas', porDecisao.map(([, qtd]) => qtd), CORES.paleta)],
        resumo: `${dados.trail.length} decisão(ões) crítica(s) no trail imutável • ${porDecisao[0][1]} do tipo "${ROTULOS_DECISAO[porDecisao[0][0]] || porDecisao[0][0]}"`
      };
    },

    /** Taxa de aprovação/recusa consolidada (Visão Estratégica). */
    aprovacao_recusa: function (dados) {
      if (!dados.cargas.length) return null;
      const cargasUnicas = [];
      const vistos = new Set();
      dados.cargas.forEach(c => {
        const id = c.id || c.qr_code_url || JSON.stringify(c);
        if (!vistos.has(id)) {
          vistos.add(id);
          cargasUnicas.push(c);
        }
      });

      const porResultado = new Map([['APROVADA', 0], ['RECUSADA', 0], ['PENDENTE', 0], ['CANCELADA', 0]]);
      cargasUnicas.forEach(c => {
        const chave = classificarInspecao(c);
        porResultado.set(chave, (porResultado.get(chave) || 0) + 1);
      });
      const total = cargasUnicas.length;
      const aprovadas = porResultado.get('APROVADA') || 0;
      const recusadas = porResultado.get('RECUSADA') || 0;
      const pendentes = porResultado.get('PENDENTE') || 0;
      const canceladas = porResultado.get('CANCELADA') || 0;

      const baseCalculoTaxa = total - canceladas;
      const taxaAprovacao = baseCalculoTaxa > 0 ? percentual(aprovadas, baseCalculoTaxa) : 0;
      const taxaRecusa = baseCalculoTaxa > 0 ? percentual(recusadas, baseCalculoTaxa) : 0;

      return {
        tipo: 'doughnut',
        labels: ['Aprovadas', 'Recusadas', 'Pendentes', 'Canceladas'],
        datasets: [{
          label: 'Cargas',
          data: [aprovadas, recusadas, pendentes, canceladas],
          backgroundColor: ['#2E7D32', '#C62828', '#D97706', '#64748B'],
          borderWidth: 0
        }],
        resumo: `Taxa de aprovação de ${taxaAprovacao}% e recusa de ${taxaRecusa}% sobre ${baseCalculoTaxa} carga(s) ativas (${canceladas} canceladas excluídas)`
      };
    },


    /** Tempo médio de permanência no porto por tipo de carga (RF 4). */
    tempo_permanencia: function (dados) {
      if (!dados.cargas.length) return null;
      const acumulado = new Map();
      let amostragemTotal = 0;
      dados.cargas.forEach(c => {
        // Prioriza cargas já concluídas; cargas em pátio usam a data corrente.
        const finalizado = c.dataSaida || ['EM_TRANSITO', 'ENTREGUE', 'CANCELADA'].includes(c.status);
        const inicio = c.dataEntrada;
        if (!inicio) return;
        const dias = diferencaEmDias(inicio, finalizado ? (c.dataSaida || null) : null);
        if (dias === null) return;
        const tipoNormalizado = normalizarTipoCarga(c.tipo);
        const atual = acumulado.get(tipoNormalizado) || { dias: 0, quantidade: 0 };
        atual.dias += dias;
        atual.quantidade += 1;
        amostragemTotal += 1;
        acumulado.set(tipoNormalizado, atual);
      });
      if (!acumulado.size) return null;
      const medias = Array.from(acumulado.entries())
        .map(([tipo, info]) => [tipo, Math.round((info.dias / info.quantidade) * 10) / 10])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const geral = medias.reduce((acc, [, m]) => acc + m, 0) / medias.length;
      return {
        tipo: 'bar',
        labels: medias.map(([tipo]) => tipo),
        datasets: [datasetBarras('Dias médios no porto', medias.map(([, m]) => m), CORES.primaria)],
        resumo: `Média geral de ${geral.toFixed(1)} dia(s) por tipo de carga [Fórmula: Σ(Data Saída - Data Entrada) / Total de Cargas] • Amostragem: ${amostragemTotal} carga(s) analisada(s)`
      };
    },

    /** Embarcações mais utilizadas — Top 5 da frota ativa (RF 2). */
    embarcacoes_utilizadas: function (dados) {
      if (!dados.navios.length) return null;
      const operacoesPorNavio = new Map();
      dados.navios.forEach(n => operacoesPorNavio.set(n.nome, 0));
      // Volume real de cargas vinculadas à embarcação (por id ou nome).
      dados.cargas.forEach(c => {
        const alvo = dados.navios.find(n => (c.navioId && (n.id === c.navioId || n.imo === c.navioId)) || (c.navioNome && n.nome === c.navioNome));
        if (alvo) operacoesPorNavio.set(alvo.nome, (operacoesPorNavio.get(alvo.nome) || 0) + 1);
      });
      // Complementa com o contador oficial de cargas realizadas do navio.
      dados.navios.forEach(n => {
        if (n.operacoes > (operacoesPorNavio.get(n.nome) || 0)) operacoesPorNavio.set(n.nome, n.operacoes);
      });
      const entradas = ordenarMapa(operacoesPorNavio, 5).filter(([, qtd]) => qtd > 0);
      if (!entradas.length) return null;
      return {
        tipo: 'bar',
        labels: entradas.map(([nome]) => nome),
        datasets: [datasetBarras('Cargas operadas', entradas.map(([, qtd]) => qtd), CORES.primaria)],
        resumo: `Embarcação mais utilizada: ${entradas[0][0]} com ${entradas[0][1]} carga(s) operada(s)`
      };
    },

    /** Produtividade operacional por cargo no mês corrente (RF 16). */
    produtividade_cargo: function (dados) {
      if (!dados.logs.length) return null;
      const mesAtual = chaveMes(new Date());
      const cargosAtivos = new Set(dados.funcionarios.filter(f => f.ativo !== false).map(f => f.cargo));
      const porCargo = contarPor(
        dados.logs.filter(l => chaveMes(l.data) === mesAtual),
        l => l.cargo
      );
      const entradas = ordenarMapa(
        new Map(Array.from(porCargo.entries()).filter(([cargo]) => cargo !== 'NAO_INFORMADO' && (cargosAtivos.size === 0 || cargosAtivos.has(cargo))))
      ).slice(0, 8);
      if (!entradas.length) return null;
      const total = somaMapa(new Map(entradas));
      return {
        tipo: 'bar',
        labels: entradas.map(([cargo]) => nomeCargo(cargo)),
        datasets: [datasetBarras('Operações registradas no mês', entradas.map(([, qtd]) => qtd), CORES.primaria)],
        resumo: `${total} operação(ões) registrada(s) no mês por ${entradas.length} cargo(s) ativo(s)`
      };
    },

    /** Valor declarado movimentado por mês (indicador estratégico/financeiro). */
    valor_declarado_mes: function (dados) {
      if (!dados.cargas.length) return null;
      const meses = ultimosMeses(6);
      const porMes = somarPor(
        dados.cargas.filter(c => c.valor > 0),
        c => chaveMes(c.dataEntrada),
        c => c.valor
      );
      const valores = meses.map(m => Math.round(porMes.get(m.chave) || 0));
      const total = valores.reduce((a, b) => a + b, 0);
      if (total <= 0) return null;
      return {
        tipo: 'line',
        labels: meses.map(m => m.rotulo),
        datasets: [{
          label: 'Valor declarado (R$)',
          data: valores,
          borderColor: CORES.primaria,
          backgroundColor: 'rgba(68, 89, 135, 0.18)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: CORES.escura
        }],
        formatoMoeda: true,
        resumo: `${formatarMoedaCompacta(total)} em valor declarado movimentado nos últimos 6 meses`
      };
    }
  };

  // ---------------------------------------------------------------------
  // Renderização (Chart.js)
  // ---------------------------------------------------------------------

  // Catálogo global: permite montar conjuntos de gráficos de qualquer painel
  // (ex.: a página de Relatórios reutiliza indicadores de diferentes grupos).
  const CATALOGO_CHARTS = {};
  Object.keys(GRUPOS).forEach(grupoKey => {
    GRUPOS[grupoKey].charts.forEach(chart => {
      if (!CATALOGO_CHARTS[chart.id]) CATALOGO_CHARTS[chart.id] = chart;
    });
  });

  const instancias = new Map();
  let tokenRender = 0;
  let padraoAtual = { containerId: 'relatoriosChartsGrid', sessao: null, grupo: null, charts: null };
  let chartJsPromessa = null;
  let observadorTema = null;
  let debounceTimer = null;

  function temaEscuro() {
    try {
      return !!(window.document && window.document.documentElement && window.document.documentElement.classList.contains('dark'));
    } catch (e) {
      return false;
    }
  }

  function garantirChartJs() {
    if (typeof window.Chart !== 'undefined') return Promise.resolve(true);
    if (chartJsPromessa) return chartJsPromessa;
    chartJsPromessa = new Promise((resolve) => {
      const doc = window.document;
      if (!doc || !doc.createElement) return resolve(false);
      const existente = doc.querySelector ? doc.querySelector('script[src*="chart.js"]') : null;
      if (existente) {
        existente.addEventListener('load', () => resolve(typeof window.Chart !== 'undefined'));
        existente.addEventListener('error', () => resolve(false));
        setTimeout(() => resolve(typeof window.Chart !== 'undefined'), 4000);
        return;
      }
      const script = doc.createElement('script');
      script.src = CDN_CHARTJS;
      script.async = true;
      script.setAttribute('data-nexus-chartjs', 'true');
      script.addEventListener('load', () => resolve(typeof window.Chart !== 'undefined'));
      script.addEventListener('error', () => resolve(false));
      doc.head.appendChild(script);
      setTimeout(() => resolve(typeof window.Chart !== 'undefined'), 6000);
    });
    return chartJsPromessa;
  }

  function aplicarPadroesGlobais() {
    if (!window.Chart || !window.Chart.defaults) return;
    window.Chart.defaults.font.family = "'Inter', sans-serif";
    window.Chart.defaults.font.size = 11;
    window.Chart.defaults.color = temaEscuro() ? CORES.textoDark : CORES.texto;
  }

  function montarConfig(spec) {
    const escuro = temaEscuro();
    const corGrade = escuro ? CORES.gradeDark : CORES.grade;
    const corTexto = escuro ? CORES.textoDark : CORES.texto;

    const tooltip = {
      backgroundColor: '#1E293B',
      titleColor: '#FFFFFF',
      bodyColor: '#E2E8F0',
      padding: 10,
      cornerRadius: 8,
      displayColors: spec.tipo === 'doughnut',
      callbacks: {}
    };

    if (spec.tipo === 'doughnut') {
      tooltip.callbacks.label = function (item) {
        const dados = item.dataset.data || [];
        const total = dados.reduce((a, b) => a + paraNumero(b), 0);
        const valor = paraNumero(item.parsed);
        return ` ${item.label}: ${formatarNumero(valor)} (${percentual(valor, total)}%)`;
      };
    } else if (spec.formatoMoeda) {
      tooltip.callbacks.label = function (item) {
        return ` ${formatarMoeda(item.parsed.y)}`;
      };
    } else {
      tooltip.callbacks.label = function (item) {
        const valor = item.parsed && item.parsed.y !== undefined ? item.parsed.y : item.parsed;
        return ` ${item.dataset.label}: ${formatarNumero(valor)}`;
      };
    }

    const config = {
      type: spec.tipo,
      data: { labels: spec.labels, datasets: spec.datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        layout: { padding: 4 },
        plugins: {
          legend: {
            display: spec.tipo === 'doughnut',
            position: 'bottom',
            labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 12, color: corTexto, font: { size: 10 } }
          },
          tooltip: tooltip
        }
      }
    };

    if (spec.tipo === 'doughnut') {
      config.options.cutout = '62%';
    }

    if (spec.tipo === 'bar' || spec.tipo === 'line') {
      const eixoValor = {
        beginAtZero: true,
        grid: { color: corGrade, drawBorder: false },
        ticks: {
          color: corTexto,
          font: { size: 10 },
          callback: function (valor) {
            return spec.formatoMoeda ? formatarMoedaCompacta(valor) : formatarNumero(valor);
          }
        }
      };
      const eixoCategoria = {
        grid: { display: false, drawBorder: false },
        ticks: { color: corTexto, font: { size: 10 }, autoSkip: false, maxRotation: spec.horizontal ? 0 : 45, minRotation: 0 }
      };
      config.options.scales = spec.horizontal
        ? { x: eixoValor, y: eixoCategoria }
        : { x: eixoCategoria, y: eixoValor };

      if (spec.tipo === 'line') {
        config.options.elements = { line: { borderWidth: 2.5 } };
      }
    }

    return config;
  }

  function destruirInstancias() {
    instancias.forEach(chart => {
      try { chart.destroy(); } catch (e) { /* noop */ }
    });
    instancias.clear();
  }

  const ENTIDADES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

  /**
   * Codifica dados NÃO CONFIÁVEIS antes de qualquer inserção em HTML.
   * Delega para `window.nexusEsc` (js/security.js — convenção obrigatória do
   * projeto) e mantém um fallback equivalente para ambientes onde o módulo de
   * segurança não esteja carregado (ex.: execução em Node/testes).
   */
  function esc(valor) {
    if (typeof window.nexusEsc === 'function') return window.nexusEsc(valor);
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"'`=]/g, function (ch) { return ENTIDADES_HTML[ch]; });
  }

  function cartaoGrafico(definicao, indice, spec) {
    const canvasId = `nexusChart_${definicao.id}_${indice}`;
    return `
      <div class="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-nexus-border dark:border-nexus-dark-border p-4 flex flex-col gap-3" data-chart-card="${esc(definicao.id)}">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-start gap-2 min-w-0">
            <span class="material-symbols-outlined text-[20px] text-nexus-500 dark:text-indigo-400 shrink-0">${esc(definicao.icone || 'insights')}</span>
            <div class="min-w-0">
              <h4 class="font-display font-bold text-xs text-nexus-900 dark:text-white leading-snug">${esc(definicao.titulo)}</h4>
              <p class="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">${esc(definicao.descricao)}</p>
            </div>
          </div>
          <span class="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-nexus-border dark:border-nexus-dark-border text-slate-500 dark:text-slate-400 shrink-0">${esc(definicao.badge || 'RF 7')}</span>
        </div>
        <div class="relative w-full h-56">
          <canvas id="${esc(canvasId)}" role="img" aria-label="${esc(definicao.titulo)}"></canvas>
        </div>
        <p class="text-[11px] font-mono text-slate-600 dark:text-slate-300 border-t border-nexus-border dark:border-nexus-dark-border pt-2">${esc(spec.resumo || '')}</p>
      </div>
    `;
  }

  function cartaoVazio(definicao, mensagem) {
    return `
      <div class="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-nexus-border dark:border-nexus-dark-border p-4 flex flex-col gap-3" data-chart-card="${esc(definicao.id)}" data-empty="true">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-start gap-2 min-w-0">
            <span class="material-symbols-outlined text-[20px] text-slate-400 shrink-0">${esc(definicao.icone || 'insights')}</span>
            <div class="min-w-0">
              <h4 class="font-display font-bold text-xs text-slate-500 dark:text-slate-400 leading-snug">${esc(definicao.titulo)}</h4>
              <p class="text-[11px] text-slate-400 dark:text-slate-500 leading-snug mt-0.5">${esc(definicao.descricao)}</p>
            </div>
          </div>
          <span class="font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-nexus-border dark:border-nexus-dark-border text-slate-400 shrink-0">${esc(definicao.badge || 'RF 7')}</span>
        </div>
        <div class="flex flex-col items-center justify-center gap-2 h-56 text-center">
          <span class="material-symbols-outlined text-[36px] text-slate-300 dark:text-slate-600">bar_chart</span>
          <p class="text-[11px] text-slate-400 dark:text-slate-500 max-w-[240px]">${esc(mensagem)}</p>
        </div>
      </div>
    `;
  }

  function cartaoCarregando(definicao) {
    return `
      <div class="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-nexus-border dark:border-nexus-dark-border p-4 flex flex-col gap-3">
        <h4 class="font-display font-bold text-xs text-slate-400 dark:text-slate-500">${esc(definicao.titulo)}</h4>
        <div class="h-56 rounded-xl bg-slate-200/70 dark:bg-slate-700/40 animate-pulse"></div>
      </div>
    `;
  }

  function definirCabecalho(painel, total) {
    const elTitulo = window.document ? window.document.getElementById('chartsRoleTitle') : null;
    const elSubtitulo = window.document ? window.document.getElementById('chartsRoleSubtitle') : null;
    const elBadge = window.document ? window.document.getElementById('chartsRoleBadge') : null;
    if (elTitulo) elTitulo.textContent = painel.titulo;
    if (elSubtitulo) elSubtitulo.textContent = painel.subtitulo;
    if (elBadge) elBadge.textContent = painel.camada;
  }

  /**
   * Rodapé do painel: além das fontes, informa de onde vieram os dados
   * (servidor × cache local) e o horário da última leitura. É o rastro que
   * faltava para o operador confiar (ou não) no botão "Atualizar".
   */
  function atualizarRodape(painel, total, opcoes) {
    const elFooter = window.document ? window.document.getElementById('chartsRoleFooter') : null;
    if (!elFooter) return;
    const base = `${total} indicador(es) gráfico(s) da camada ${painel.camada} • fontes: ${painel.fontes.join(', ')}`;
    if (opcoes && opcoes.carregando) {
      elFooter.textContent = `${base} • consultando o servidor...`;
      return;
    }
    const hora = metaCarregamento.atualizadoEm
      ? new Date(metaCarregamento.atualizadoEm).toLocaleTimeString('pt-BR')
      : '--';
    elFooter.textContent = `${base} • dados de ${textoOrigem(metaCarregamento.origem)} • atualizado às ${hora} • atualização periódica automática`;
  }

  function observadorDeTema() {
    if (observadorTema || typeof window.MutationObserver === 'undefined' || !window.document) return;
    try {
      observadorTema = new window.MutationObserver(() => {
        if (padraoAtual.sessao) renderPainel(padraoAtual.sessao, padraoAtual);
      });
      observadorTema.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* noop */ }
  }

  /**
   * Renderiza o painel gráfico do cargo informado.
   * @param {object} sessao - sessão autenticada (NexusAuth.getSession())
   * @param {object} [opcoes] - { containerId, charts, tituloPainel, fontes, forcar }
   *        `forcar: true` = recarga manual: ignora o cache em memória e
   *        reconsulta o servidor (usado pelo botão "Atualizar").
   * @returns {Promise<{ok: boolean, origem?: string, origemTexto?: string,
   *                    atualizadoEm?: string|null, motivo?: string}>}
   */
  async function renderPainel(sessao, opcoes) {
    const cfg = opcoes || padraoAtual;
    const forcar = !!cfg.forcar;
    const doc = window.document;
    if (!doc) return { ok: false, motivo: 'sem-documento' };
    const container = doc.getElementById(cfg.containerId || 'relatoriosChartsGrid');
    if (!container || !sessao) return { ok: false, motivo: 'sem-container' };
    const meuToken = ++tokenRender;

    const grupo = grupoDoCargo(sessao.cargo);
    const painel = GRUPOS[grupo] || GRUPOS.OPERACIONAL_CARGA;
    const ordenados = cfg.charts ? cfg.charts.slice() : painel.charts;
    const definicoes = ordenados.map(item => {
      if (typeof item !== 'string') return item;
      return Object.assign({}, CATALOGO_CHARTS[item] || painel.charts.find(c => c.id === item) || { id: item, titulo: item, descricao: '', icone: 'insights', badge: 'RF 7' });
    });
    const fontes = cfg.fontes || painel.fontes;

    padraoAtual = { containerId: cfg.containerId || 'relatoriosChartsGrid', sessao: sessao, grupo: grupo, charts: definicoes, fontes: fontes };
    definirCabecalho(painel, definicoes.length);

    destruirInstancias();
    container.innerHTML = definicoes.map(def => cartaoCarregando(def)).join('');
    atualizarRodape(painel, definicoes.length, { carregando: true });

    const disponivel = await garantirChartJs();
    const dados = await carregarDados(sessao, fontes, { forcar: forcar });

    // Uma renderização mais recente pode ter sido disparada durante os awaits.
    if (meuToken !== tokenRender) return { ok: false, motivo: 'substituido' };

    let html = '';
    const paraRenderizar = [];

    definicoes.forEach((def, indice) => {
      const spec = construirSpec(def.id, dados, sessao);
      if (!spec) {
        html += cartaoVazio(def, 'Sem dados suficientes para gerar este gráfico. Os indicadores aparecerão automaticamente assim que houver registros no sistema.');
        return;
      }
      html += cartaoGrafico(def, indice, spec);
      paraRenderizar.push({ definicao: def, indice: indice, spec: spec });
    });

    container.innerHTML = html;

    if (!disponivel || typeof window.Chart === 'undefined') {
      paraRenderizar.forEach(item => {
        const canvas = doc.getElementById(`nexusChart_${item.definicao.id}_${item.indice}`);
        const pai = canvas && canvas.parentNode;
        if (pai) {
          pai.innerHTML = `<div class="flex flex-col items-center justify-center gap-2 h-full text-center">
            <span class="material-symbols-outlined text-[32px] text-slate-300 dark:text-slate-600">cloud_off</span>
            <p class="text-[11px] text-slate-400">Chart.js indisponível no momento. Verifique a conexão com a CDN para exibir este gráfico.</p>
          </div>`;
        }
      });
      atualizarRodape(painel, definicoes.length);
      return {
        ok: false,
        motivo: 'chartjs-indisponivel',
        origem: metaCarregamento.origem,
        origemTexto: textoOrigem(metaCarregamento.origem),
        atualizadoEm: metaCarregamento.atualizadoEm
      };
    }

    aplicarPadroesGlobais();

    paraRenderizar.forEach(item => {
      const canvas = doc.getElementById(`nexusChart_${item.definicao.id}_${item.indice}`);
      if (!canvas) return;
      try {
        const chart = new window.Chart(canvas.getContext('2d'), montarConfig(item.spec));
        instancias.set(item.definicao.id, chart);
      } catch (err) {
        console.warn(`[NexusCharts] Falha ao renderizar o gráfico ${item.definicao.id}:`, err);
      }
    });

    observadorDeTema();
    atualizarRodape(painel, definicoes.length);

    return {
      ok: true,
      origem: metaCarregamento.origem,
      origemTexto: textoOrigem(metaCarregamento.origem),
      atualizadoEm: metaCarregamento.atualizadoEm,
      forcar: forcar,
      indicadores: definicoes.length,
      graficos: paraRenderizar.length
    };
  }

  function sessaoAtual() {
    if (window.NexusAuth && typeof window.NexusAuth.getSession === 'function') {
      return window.currentUserSession || window.NexusAuth.getSession();
    }
    return window.currentUserSession || null;
  }

  function ligarEventos() {
    if (ligarEventos.ligado) return;
    ligarEventos.ligado = true;

    window.addEventListener('nexus_data_changed', function (evento) {
      // Heartbeat de sync (10 s) e foco da janela não são alterações de dados:
      // redesenhar a cada 10 s fazia o painel piscar sem novidade. Esses casos
      // ficam por conta da renovação automática de 1 minuto (INTERVALO_AUTO_REFRESH_MS).
      const entidade = evento && evento.detail ? evento.detail.entity : null;
      if (entidade && ENTIDADES_SYNC_FUNDO.indexOf(entidade) !== -1) return;

      invalidarCache();
      if (!padraoAtual.sessao) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        renderPainel(padraoAtual.sessao, padraoAtual);
      }, 400);
    });

    if (typeof window.setInterval !== 'function') return;
    // Renovação automática: a cada 1 minuto (nunca durante o heartbeat de 10 s).
    window.setInterval(function () {
      if (!padraoAtual.sessao) return;
      if (window.document && window.document.hidden) return;
      invalidarCache();
      renderPainel(padraoAtual.sessao, padraoAtual);
    }, INTERVALO_AUTO_REFRESH_MS);
  }

  const NexusCharts = {
    GRUPOS: GRUPOS,
    CONSTRUTORES: CONSTRUTORES,

    /** Cadência da renovação automática do painel (1 minuto) — exposta para testes/auditoria. */
    INTERVALO_AUTO_REFRESH_MS: INTERVALO_AUTO_REFRESH_MS,
    /** Entidades de sincronização de fundo que NÃO disparam redesenho imediato. */
    ENTIDADES_SYNC_FUNDO: ENTIDADES_SYNC_FUNDO,

    /**
     * Inicializa os gráficos do relatórios.html (RF 16).
     * Cada cargo recebe o recorte previsto na Spec: Direção/Inspetor veem a
     * produtividade consolidada; os demais cargos veem apenas os próprios dados.
     */
    initRelatorios: function () {
      const sessao = sessaoAtual();
      if (!sessao) return Promise.resolve({ ok: false, motivo: 'sem-sessao' });
      const grupo = grupoDoCargo(sessao.cargo);
      // Backlog 3: esta página passa a ser a central única de gráficos do
      // sistema (a análise gráfica saiu do Dashboard). Os conjuntos foram
      // expandidos com as visões que antes só existiam no painel do Dashboard,
      // e com os conjuntos planejados que estavam ausentes (navios por
      // localização, embarcações mais utilizadas, tempo de permanência das
      // cargas, decisões do trail, etc.).
      const conjuntos = {
        DIRETOR: {
          charts: ['produtividade_cargo', 'aprovacao_recusa', 'valor_declarado_mes', 'tempo_permanencia', 'bercos_ocupacao', 'embarcacoes_utilizadas', 'navios_localizacao'],
          fontes: ['cargas', 'logs', 'funcionarios', 'navios', 'bercos']
        },
        INSPETOR: {
          charts: ['produtividade_cargo', 'inspecoes_resultado', 'cargas_fluxo', 'manutencoes_status', 'navios_localizacao', 'embarcacoes_utilizadas'],
          fontes: ['cargas', 'logs', 'navios', 'manutencoes']
        },
        SUPERVISOR: {
          charts: ['fila_liberacao', 'manutencoes_status', 'bercos_ocupacao', 'trail_decisoes_tipo', 'navios_localizacao', 'embarcacoes_utilizadas'],
          fontes: ['cargas', 'manutencoes', 'bercos', 'trail', 'navios']
        },
        TECNICO_PORTOS: { charts: ['meus_registros_pessoas_7d', 'visitantes_motivo'], fontes: ['visitantes', 'logs'] },
        PLANEJADOR_PATIO: {
          charts: ['minhas_operacoes_7d', 'containers_estado', 'navios_localizacao', 'embarcacoes_utilizadas'],
          fontes: ['containers', 'logs', 'navios']
        },
        OPERACIONAL_CARGA: { charts: ['minhas_operacoes_7d', 'minhas_cargas_status'], fontes: ['cargas', 'logs'] }
      };
      const conjunto = conjuntos[grupo] || conjuntos.OPERACIONAL_CARGA;
      ligarEventos();
      return renderPainel(sessao, {
        containerId: 'relatoriosChartsGrid',
        charts: conjunto.charts,
        fontes: conjunto.fontes
      });
    },

    /**
     * Força a recarga manual (botão "Atualizar" do painel).
     *
     * Diferente da renovação periódica, aqui o cache em memória (TTL de 4s) é
     * ignorado e as tabelas marcadas como ausentes são reabertas: cada clique
     * consulta o Supabase de verdade e o resultado diz de onde os dados vieram,
     * para a interface informar o operador (servidor × cache local).
     *
     * @returns {Promise<{ok: boolean, origem: string, origemTexto: string,
     *                    atualizadoEm: string|null, motivo?: string}>}
     */
    atualizar: function (opcoes) {
      invalidarCache();
      if (!padraoAtual.sessao) {
        return Promise.resolve({ ok: false, motivo: 'sem-sessao', origem: 'local', origemTexto: textoOrigem('local'), atualizadoEm: null });
      }
      return renderPainel(padraoAtual.sessao, Object.assign({}, padraoAtual, { forcar: true }, opcoes || {}));
    },

    /** Origem dos dados do último carregamento (auditoria do refresh). */
    ultimaAtualizacao: function () {
      return {
        origem: metaCarregamento.origem,
        origemTexto: textoOrigem(metaCarregamento.origem),
        atualizadoEm: metaCarregamento.atualizadoEm,
        forcar: !!metaCarregamento.forcar,
        porFonte: Object.assign({}, metaCarregamento.porFonte)
      };
    },

    grupoDoCargo: grupoDoCargo,
    painelDoCargo: function (cargo) {
      const painel = GRUPOS[grupoDoCargo(cargo)];
      return painel ? painel.charts.map(c => c.id) : [];
    },
    construir: function (id, dados, sessao) {
      return construirSpec(id, dados, sessao);
    },
    invalidarCache: invalidarCache,
    carregarDados: carregarDados,
    podeVerDadosDePessoas: podeVerDadosDePessoas,
    filtrarCargasPorVisao: filtrarCargasPorVisao,
    filtrarLogsPorVisao: filtrarLogsPorVisao,

    // Utilidades expostas para testes automatizados e reuso em outros módulos.
    utils: {
      paraNumero: paraNumero,
      formatarMoeda: formatarMoeda,
      formatarMoedaCompacta: formatarMoedaCompacta,
      ultimosDias: ultimosDias,
      ultimosMeses: ultimosMeses,
      contarPor: contarPor,
      somarPor: somarPor,
      ordenarMapa: ordenarMapa,
      percentual: percentual,
      normalizarCargo: normalizarCargo,
      normalizarTipoCarga: normalizarTipoCarga,
      nomeCargo: nomeCargo,
      chaveMes: chaveMes,
      montarConfig: montarConfig,
      textoOrigem: textoOrigem
    }
  };

  window.NexusCharts = NexusCharts;
})(window);
