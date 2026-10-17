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

  // A camada de visão opera apenas com dados reais; não há mais base mock.

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

      // Tarefa 12: Cargas cadastradas por diretores ou outros cargos devem aparecer para todos os cargos
      // com acesso à página. As restrições de permissão aplicam-se apenas às AÇÕES sobre as cargas.
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
      if (entityType === 'cargas') {
        // Tarefa 12: Não filtra cargas por criador no banco, garantindo visibilidade entre cargos
        return queryBuilder;
      } else if (cargo === 'TECNICO_PORTOS' && entityType === 'visitantes') {
        return queryBuilder.eq('registrado_por', session.id || userMatricula);
      }

      return queryBuilder;
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
              container_id: c.container_identificacao_historico || c.container_id || 'N/A',
              navio: c.navio_nome_historico || 'N/A',
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
          container_id: c.containerIdentificacaoHistorico || c.container_identificacao_historico || c.container || c.container_id || 'N/A',
          navio: c.navioNomeHistorico || c.navio_nome_historico || c.navio || 'N/A',
          porto_descarga: c.portoDescarga || c.porto_descarga || 'N/A',
          data: c.dataChegada || new Date().toISOString()
        }));
      }

      const headers = ['ID', 'Natureza/Tipo', 'Peso (t)', 'Volume (m3)', 'Valor Declarado (R$)', 'Status Fluxo', 'Container ID', 'Navio', 'Porto Descarga', 'Data Registro'];

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
        csvCell(c.navio),
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
