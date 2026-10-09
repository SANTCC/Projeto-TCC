/**
 * WebMCP — página Relatórios & PDF (js/webmcp/webmcp-relatorios.js) — NexusPort
 *
 * Geração de relatório PDF de uma carga (somente leitura) e exportação do histórico
 * em CSV (ação consequente, restrita à Direção, com confirmação do operador).
 * O CSV é baixado no navegador do operador: o conteúdo nunca é devolvido ao agente.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // PAGE_PERMISSIONS['relatorios.html'] inclui todos os cargos.
  const CARGOS_PAGINA = G.todos;

  const gerarPdf = {
    nome: 'gerar_relatorio_carga',
    titulo: 'Gerar relatório PDF da carga',
    descricao: 'Gera o relatório PDF A4 de uma carga visível ao operador e inicia o download no navegador. Não altera dados.',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 60, pattern: '^[A-Za-z0-9._-]{3,60}$', rotulo: 'Carga', description: 'Código da carga, por exemplo CRG-2026-001.' }
      },
      required: ['id'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.id === undefined) return null;
      const existe = (await D.cargasDoOperador()).some((c) => c.id === args.id);
      return existe ? null : { codigo: 'CARGA_NAO_ENCONTRADA', mensagem: `Carga ${args.id} não encontrada ou fora da sua visão.` };
    },
    executar: async (args) => {
      if (typeof window.nexusRelatorioGerarPdf !== 'function') return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Geração de PDF indisponível nesta página.' };
      await window.nexusRelatorioGerarPdf(args.id);
      return { mensagem: `Relatório PDF da carga ${args.id} gerado para download.`, dados: { id: args.id, formato: 'A4' } };
    }
  };

  const exportarCsv = {
    nome: 'exportar_historico_csv',
    titulo: 'Exportar histórico de operações (CSV)',
    descricao: 'Baixa no navegador do operador o CSV com o histórico de todas as cargas. Ação restrita à Direção; exige confirmação. O conteúdo não é enviado ao agente.',
    anotacoes: { consequentialHint: true },
    cargos: G.direcao,
    permissao: 'EXPORTAR_HISTORICO',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    resumo: () => [
      'Exportar o histórico de operações de todas as cargas em CSV.',
      'O arquivo é baixado no seu navegador; o conteúdo não é enviado ao agente.',
      'Contém dados operacionais: use somente para fins autorizados.'
    ],
    executar: async () => {
      if (!window.NexusVision || typeof window.NexusVision.exportDadosHistoricos !== 'function') {
        return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Exportação indisponível nesta página.' };
      }
      await window.NexusVision.exportDadosHistoricos();
      return { mensagem: 'Download do histórico iniciado no seu navegador.', dados: { formato: 'CSV' } };
    }
  };

  const atualizarGraficos = {
    nome: 'atualizar_graficos',
    titulo: 'Atualizar gráficos',
    descricao: 'Consulta o servidor e redesenha os gráficos de Relatórios. Não altera dados.',
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

  D.quandoPronto(() => W.registrarPagina({ id: 'relatorios', arquivo: 'relatorios.html', ferramentas: [gerarPdf, exportarCsv, atualizarGraficos] }));
})(window, document);
