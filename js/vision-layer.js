/**
 * Camada de Visão Própria, Visão Operacional e Visão Estratégica (T1.4, T1.5 & T1.6) - NexusPort
 *
 * Especificação (Spec.md RF 1):
 * 1. Visão Própria (Cargos Operacionais):
 *    - Estivador, Conferente, Arrumador, Planejador, Técnico: enxergam apenas entidades diretamente ligadas às suas atribuições.
 *
 * 2. Visão Operacional (Inspetor e Supervisor):
 *    - Leitura de TODOS os dados operacionais dos cargos inferiores (cargas, navios, contêineres, manutenções, checklists, logs, trail).
 *    - RESTRIÇÃO OBRIGATÓRIA: NÃO têm acesso à documentação interna de funcionários nem ao cadastro de visitantes.
 *
 * 3. Visão Estratégica (Diretor de Operações, Diretor-Presidente, Conselho de Administração):
 *    - Acesso TOTAL de leitura a todas as funcionalidades e dados do sistema.
 *    - Dashboards exclusivos com gráficos consolidados (taxa de aprovação/recusa, tempo médio de permanência, navios mais utilizados, produtividade).
 *    - Exportação de dados históricos em formato estruturado.
 */

(function (window) {
  'use strict';

  // Desativação total de dados mock e dados fictícios (Etapa 3 - Plano de Correção)
  const ENABLE_MOCKS = false;
  const mockDatabase = {
    cargas: [],
    navios: [],
    containers: [],
    visitantes: [],
    documentacao_funcionarios: []
  };

  const NexusVision = {
    /**
     * Verifica se o usuário tem permissão para acessar determinado módulo do sistema (T1.5 & T1.6)
     */
    hasAccessToModule: function (moduleName, session) {
      if (!session || !session.cargo) return false;

      const cargo = session.cargo;

      // Diretores têm acesso total de leitura (Visão Estratégica)
      if (['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(cargo)) {
        return true;
      }

      // Restrição para Inspetor e Supervisor (RF 1)
      if (['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].includes(cargo)) {
        if (moduleName === 'visitantes' || moduleName === 'documentacao_funcionarios') {
          return false;
        }
        return true;
      }

      // Técnico em Portos tem acesso a visitantes e documentos de funcionários
      if (cargo === 'TECNICO_PORTOS') {
        return true;
      }

      if (['visitantes', 'documentacao_funcionarios'].includes(moduleName)) {
        return false;
      }

      return true;
    },

    // -----------------------------------------------------------------------
    // CARGAS: VISIBILIDADE DE TELA × PERMISSÃO DE AÇÃO × ESCOPO DE INDICADORES
    // (H1 — Backlog NexusPort)
    // -----------------------------------------------------------------------
    // Eram três regras diferentes para "o que este cargo enxerga": a página Cargas
    // filtrava, o Painel e Embarcações mostravam tudo, o agente filtrava de outro jeito —
    // e uma carga registrada pela Direção (ou atribuída a ela, o padrão do formulário)
    // simplesmente não aparecia para o Estivador que precisa trabalhar nela.
    //
    // Decisão de produto (H1): a carga EM FLUXO é visível para todos os cargos. Quem
    // restringe é a PERMISSÃO da ação (botões e ferramentas) e o ESCOPO dos indicadores
    // ("minhas operações"), nunca a visibilidade da tela.
    // O histórico segue a Visão Própria do RF 1.3: a carga ENTREGUE de outro operador não
    // aparece para quem não participou dela.

    /** Cargos cuja visão é limitada ao próprio escopo operacional. */
    CARGOS_OPERACIONAIS: ['ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR'],

    /** Campo da carga que guarda o responsável de cada cargo operacional. */
    CAMPO_RESPONSAVEL: { ESTIVADOR: 'estivador', CONFERENTE_CARGA: 'conferente', ARRUMADOR_CONSERTADOR: 'arrumador' },

    /** Status em que a carga está na mão de cada cargo operacional. */
    STATUS_DO_CARGO: {
      ESTIVADOR: ['ARMAZENAGEM', 'RECEBIMENTO_INSPECAO'],
      CONFERENTE_CARGA: ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO'],
      ARRUMADOR_CONSERTADOR: ['ARMAZENAGEM', 'PRONTA_PARA_ENTREGA']
    },

    /** A carga está atribuída ao usuário logado? (id, matrícula ou nome — como no cadastro) */
    pertenceAoUsuario: function (carga, session) {
      if (!carga || !session || !session.cargo) return false;
      const campo = this.CAMPO_RESPONSAVEL[session.cargo];
      if (!campo) return true;
      const matricula = session.matricula || session.codigo_individual;
      return carga[`${campo}_id`] === matricula
        || carga[`${campo}Matricula`] === matricula
        || carga[campo] === session.nome;
    },

    /** A carga está em um status que este cargo operacional trabalha. */
    statusDoCargo: function (carga, session) {
      if (!carga || !session || !session.cargo) return false;
      const status = (this.STATUS_DO_CARGO[session.cargo] || []);
      return status.indexOf(String(carga.status || carga.status_fluxo || '').toUpperCase()) !== -1;
    },

    /**
     * Cargas que as TELAS e o agente podem exibir para esta sessão (H1).
     * Visibilidade ampla no fluxo ativo; Visão Própria apenas no histórico (ENTREGUE).
     * Diferente de filterCargasForUser, que é o ESCOPO DE INDICADORES ("minhas operações").
     */
    visibilidadeDeCargas: function (cargasList, session) {
      if (!Array.isArray(cargasList)) return cargasList;
      if (!session || !session.cargo) return cargasList;
      if (this.CARGOS_OPERACIONAIS.indexOf(session.cargo) === -1) return cargasList;
      return cargasList.filter((c) => String(c && (c.status || c.status_fluxo) || '').toUpperCase() !== 'ENTREGUE'
        || this.pertenceAoUsuario(c, session));
    },

    /**
     * Filtra lista de cargas para o usuário ativo com base no perfil de visão (RF 1.3 Visão Própria).
     * Uso: ESCOPO DE INDICADORES — "meus indicadores", produtividade e produtividade por cargo.
     * Para o que aparece na tela, use visibilidadeDeCargas.
     */
    filterCargasForUser: function (cargasList, session) {
      if (!session || !session.cargo) return cargasList;
      const cargo = session.cargo;

      // Visão Estratégica (Diretores) e Visão Operacional Ampla (Supervisor / Inspetor): enxergam todas as cargas
      if (['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR'].includes(cargo)) {
        return cargasList;
      }

      // Visão Própria (Cargos Operacionais): apenas as cargas de sua responsabilidade/atribuição
      // ou as que estão no status que o cargo trabalha.
      return cargasList.filter((c) => this.pertenceAoUsuario(c, session) || this.statusDoCargo(c, session));
    },

    /**
     * Filtro de Visão Própria para REGISTROS DE AUDITORIA (log de alterações e
     * trail de decisões) — RF 1.1. Cada funcionário operacional (Técnico em
     * Portos incluído) vê os próprios registros; Inspetor, Supervisor e Direção
     * leem a trilha completa (RF 1.2/1.3).
     *
     * Sem isso, o Painel Geral mostrava a um Estivador as liberações,
     * cancelamentos e aprovações de toda a operação, enquanto os gráficos da
     * mesma página (js/pages/charts.js) já recortavam os logs por Visão Própria.
     *
     * Aceita as grafias usadas pelas telas: codigo/codigo_individual/codigo_usuario,
     * matricula, funcionario_id e o código embutido no campo `responsavel` do
     * trail ("Nome (Cargo) - CODIGO").
     */
    filtrarRegistrosDeVisaoPropria: function (registros, session) {
      const lista = Array.isArray(registros) ? registros : [];
      if (!session || !session.cargo) return lista;

      const cargo = String(session.cargo).toUpperCase();
      const visaoPropria = (this.CARGOS_OPERACIONAIS || []).indexOf(cargo) !== -1 || cargo === 'TECNICO_PORTOS';
      if (!visaoPropria) return lista;

      const identificadores = [session.id, session.codigo_individual, session.codigo, session.matricula]
        .filter(Boolean).map((v) => String(v));
      const codigoDoResponsavel = (texto) => {
        const partes = String(texto || '').split(' - ');
        return partes.length > 1 ? partes[partes.length - 1].trim() : '';
      };

      return lista.filter((registro) => {
        if (!registro) return false;
        const chaves = [
          registro.codigo,
          registro.codigo_individual,
          registro.codigo_usuario,
          registro.codigo_usuario_individual,
          registro.matricula,
          registro.funcionario_id,
          registro.funcionarioId,
          codigoDoResponsavel(registro.responsavel)
        ].filter(Boolean).map((v) => String(v));
        return chaves.some((chave) => identificadores.indexOf(chave) !== -1);
      });
    },

    /**
     * Aplica o filtro de Visão no Supabase (Própria, Operacional ou Estratégica).
     * H1: para CARGAS não há filtro de visibilidade — a carga em fluxo é visível para
     * todos (o que restringe é a permissão da ação). Antes daqui saía
     * `.eq('estivador_id', matrícula)`, que escondia a carga do pátio e contradizia a tela.
     * As restrições que continuam valendo são de DADOS PESSOAIS (visitantes e documentos).
     */
    applyVisaoFilter: function (queryBuilder, entityType, session) {
      if (!session || !session.cargo) return queryBuilder;

      const cargo = session.cargo;

      // Visão Estratégica (Diretores): acesso total de leitura sem restrições
      if (['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(cargo)) {
        return queryBuilder;
      }

      // Visão Operacional (Inspetor / Supervisor)
      if (['SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR'].includes(cargo)) {
        if (entityType === 'visitantes' || entityType === 'documentacao_funcionarios') {
          return queryBuilder.eq('id', 'ACCESSO_NEGADO');
        }
        return queryBuilder;
      }

      // Visão Própria (Cargos Operacionais): só os dados pessoais são restritos ao próprio registro.
      if (cargo === 'TECNICO_PORTOS' && entityType === 'visitantes') {
        return queryBuilder.eq('registrado_por', session.id || session.matricula);
      }

      return queryBuilder;
    },

    /**
     * Retorna os dados operacionais na camada mock respeitando a camada de visão
     */
    getMockVisaoData: function (entityType, session) {
      if (!session) return [];

      const cargo = session.cargo;

      // Visão Estratégica: acesso total de leitura
      if (['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(cargo)) {
        return mockDatabase[entityType] || [];
      }

      // Módulos restritos para Inspetor / Supervisor (RF 1)
      if (['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].includes(cargo)) {
        if (entityType === 'visitantes' || entityType === 'documentacao_funcionarios') {
          return [];
        }
        return mockDatabase[entityType] || [];
      }

      // Visão Própria (Cargos Operacionais):
      return this.getMockVisaoPropria(entityType, session);
    },

    /**
     * Retorna os dados filtrados pela Visão Própria na camada mock
     */
    getMockVisaoPropria: function (entityType, session) {
      if (!session) return [];

      const userMatricula = session.matricula || 'MAT-1040';

      if (entityType === 'cargas') {
        const allCargas = mockDatabase.cargas;

        if (session.cargo === 'ESTIVADOR') {
          return allCargas.filter(c => c.estivador_id === userMatricula);
        } else if (session.cargo === 'CONFERENTE_CARGA') {
          return allCargas.filter(c => c.conferente_id === userMatricula);
        } else if (session.cargo === 'ARRUMADOR_CONSERTADOR') {
          return allCargas.filter(c => c.arrumador_id === userMatricula);
        }

        return allCargas;
      }

      return mockDatabase[entityType] || [];
    },

    /**
     * Retorna indicadores executivos consolidados para a Visão Estratégica (T1.6 / RF 1)
     */
    getEstrategicoMetrics: function () {
      const cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      const navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      const logs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');

      const total = cargas.length;
      const recusadas = cargas.filter(c => c.status === 'RECUSADA').length;
      const aprovadas = cargas.filter(c => c.status !== 'RECUSADA' && c.status !== 'CANCELADA').length;

      const taxaAprovacao = total > 0 ? Number(((aprovadas / total) * 100).toFixed(1)) : 0;
      const taxaRecusa = total > 0 ? Number(((recusadas / total) * 100).toFixed(1)) : 0;

      const naviosMaisUtilizados = navios.map(n => ({
        nome: n.nome,
        operacoes: n.operacoes || 0
      })).sort((a, b) => b.operacoes - a.operacoes).slice(0, 5);

      const cargoCounts = {};
      logs.forEach(l => {
        const c = l.cargo || 'Operador';
        cargoCounts[c] = (cargoCounts[c] || 0) + 1;
      });

      const produtividadePorCargo = Object.keys(cargoCounts).map(cargo => ({
        cargo: cargo,
        operacoes: cargoCounts[cargo]
      }));

      return {
        taxaAprovacao,
        taxaRecusa,
        tempoMedioPermanenciaDias: 0,
        totalCargasAno: total,
        naviosMaisUtilizados,
        produtividadePorCargo
      };
    },

    /**
     * Exporta os dados históricos reais de operações em formato CSV para download (T1.6 / Tarefa 6.3)
     */
    exportDadosHistoricos: async function () {
      let cargasData = [];
      if (window.nexusSupabase) {
        try {
          const { data } = await window.nexusSupabase.from('cargas').select('*');
          if (data && data.length > 0) {
            cargasData = data.map(c => ({
              id: c.id,
              natureza: c.natureza || 'Carga Geral',
              peso: c.peso || 0,
              volume: c.volume || 0,
              valor: c.valor_declarado || 0,
              status: c.status_fluxo || 'ARMAZENAGEM',
              container_id: c.container_id || 'N/A',
              porto_descarga: c.porto_descarga || 'N/A',
              data: c.created_at || c.data_entrada || new Date().toISOString()
            }));
          }
        } catch (e) {
          console.warn('Erro ao carregar histórico de cargas para exportação:', e);
        }
      }

      if (cargasData.length === 0) {
        const local = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
        cargasData = local.map(c => ({
          id: c.id,
          natureza: c.tipo || c.natureza || 'Carga Geral',
          peso: c.peso || 0,
          volume: c.volume || 0,
          valor: c.valor || 0,
          status: c.status || 'ARMAZENAGEM',
          container_id: c.container || c.container_id || 'N/A',
          porto_descarga: c.portoDescarga || c.porto_descarga || 'N/A',
          data: c.dataChegada || new Date().toISOString()
        }));
      }

      const headers = ['ID', 'Natureza/Tipo', 'Peso (t)', 'Volume (m3)', 'Valor Declarado (R$)', 'Status Fluxo', 'Container ID', 'Porto Descarga', 'Data Registro'];

      // Codificação segura de célula CSV: neutraliza injeção de fórmula
      // (=, +, -, @, TAB, CR) e aspas/quebras de linha vindas dos dados.
      const csvCell = (value) => {
        let text = (value === null || value === undefined) ? '' : String(value);
        text = text.replace(/[\r\n]+/g, ' ').trim();
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
      };

      const rows = cargasData.map(c => [
        csvCell(c.id),
        csvCell(c.natureza),
        csvCell(c.peso),
        csvCell(c.volume),
        csvCell(c.valor),
        csvCell(c.status),
        csvCell(c.container_id),
        csvCell(c.porto_descarga),
        csvCell(c.data)
      ]);

      const csvContent = '\uFEFF' + [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const encodedUri = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `nexusport_historico_operacoes_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(encodedUri), 0);
    }
  };

  window.NexusVision = NexusVision;
})(window);
