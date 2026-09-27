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

    /**
     * Filtra lista de cargas para o usuário ativo com base no perfil de visão (RF 1.3 Visão Própria)
     */
    filterCargasForUser: function (cargasList, session) {
      if (!session || !session.cargo) return cargasList;
      const cargo = session.cargo;

      // Visão Estratégica (Diretores) e Visão Operacional Ampla (Supervisor / Inspetor): enxergam todas as cargas
      if (['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR'].includes(cargo)) {
        return cargasList;
      }

      const userMat = session.matricula || session.codigo_individual;

      // Visão Própria (Cargos Operacionais): enxergam apenas cargas de sua responsabilidade/atribuição
      if (cargo === 'ESTIVADOR') {
        return cargasList.filter(c => c.estivador_id === userMat || c.estivadorMatricula === userMat || c.estivador === session.nome || c.status === 'ARMAZENAGEM' || c.status === 'RECEBIMENTO_INSPECAO');
      } else if (cargo === 'CONFERENTE_CARGA') {
        return cargasList.filter(c => c.conferente_id === userMat || c.conferenteMatricula === userMat || c.conferente === session.nome || c.status === 'AGENDAMENTO' || c.status === 'RECEBIMENTO_INSPECAO');
      } else if (cargo === 'ARRUMADOR_CONSERTADOR') {
        return cargasList.filter(c => c.arrumador_id === userMat || c.arrumadorMatricula === userMat || c.arrumador === session.nome || c.status === 'ARMAZENAGEM' || c.status === 'PRONTA_PARA_ENTREGA');
      }

      return cargasList;
    },

    /**
     * Aplica o filtro de Visão no Supabase (Própria, Operacional ou Estratégica)
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

      // Visão Própria (Cargos Operacionais)
      const userMatricula = session.matricula;
      if (cargo === 'ESTIVADOR' && entityType === 'cargas') {
        return queryBuilder.eq('estivador_id', userMatricula);
      } else if (cargo === 'CONFERENTE_CARGA' && entityType === 'cargas') {
        return queryBuilder.eq('conferente_id', userMatricula);
      } else if (cargo === 'ARRUMADOR_CONSERTADOR' && entityType === 'cargas') {
        return queryBuilder.eq('arrumador_id', userMatricula);
      } else if (cargo === 'TECNICO_PORTOS' && entityType === 'visitantes') {
        return queryBuilder.eq('registrado_por', session.id || userMatricula);
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
      const rows = cargasData.map(c => [
        `"${c.id}"`,
        `"${c.natureza}"`,
        c.peso,
        c.volume,
        c.valor,
        `"${c.status}"`,
        `"${c.container_id}"`,
        `"${c.porto_descarga}"`,
        `"${c.data}"`
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `nexusport_historico_operacoes_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  window.NexusVision = NexusVision;
})(window);
