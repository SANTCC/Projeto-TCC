/**
 * WebMCP — página Delegação de Supervisor (js/webmcp-delegacao.js) — NexusPort
 *
 * A designação de um substituto exige CPF e data de nascimento do substituto. Por
 * privacidade, o agente NÃO recebe nem preenche esses dados: a ferramenta declarativa
 * preenche apenas nome, matrícula e vigência, e o operador completa CPF e data de
 * nascimento e envia o formulário. A revogação exige confirmação.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  const CARGOS_PAGINA = G.supervisao;

  function delegacaoAtiva() {
    try {
      const v = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
      return v && typeof v === 'object' ? v : null;
    } catch (e) {
      return null;
    }
  }

  const obterDelegacao = {
    nome: 'obter_delegacao_ativa',
    titulo: 'Delegação ativa',
    descricao: 'Mostra o substituto temporário do Supervisor e a vigência da delegação ativa. Não mostra CPF nem data de nascimento.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const d = delegacaoAtiva();
      if (!d) return { mensagem: 'Nenhum substituto ativo.', dados: { ativa: false, limite: 'Cada Supervisor pode ter no máximo 1 substituto ativo (RF 14).' } };
      return {
        mensagem: 'Delegação ativa.',
        dados: {
          ativa: true,
          substituido: { nome: d.substituidoNome || d.supervisor || null, matricula: d.substituidoMatricula || null },
          substituto: { nome: d.substitutoNome || null, matricula: d.substitutoMatricula || null },
          inicio: D.dataHora(d.inicio),
          fim: D.dataHora(d.fim)
        }
      };
    }
  };

  const revogar = {
    nome: 'revogar_delegacao',
    titulo: 'Revogar delegação',
    descricao: 'Encerra imediatamente os poderes do substituto temporário do Supervisor. Exige confirmação do operador.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'DESIGNAR_SUBSTITUTO',
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    precondicao: () => (delegacaoAtiva() ? null : { codigo: 'SEM_DELEGACAO', mensagem: 'Não há substituto ativo para revogar.' }),
    resumo: () => {
      const d = delegacaoAtiva();
      return [
        `Revogar a delegação de ${d ? (d.substitutoNome || d.substitutoMatricula || 'substituto') : 'substituto'}.`,
        'Os poderes de Supervisor do substituto terminam imediatamente.'
      ];
    },
    executar: async () => {
      if (typeof window.nexusRevogarDelegacao !== 'function') return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Revogação indisponível nesta página.' };
      await window.nexusRevogarDelegacao({ confirmado: true });
      if (!delegacaoAtiva()) return { mensagem: 'Delegação revogada.', dados: { ativa: false } };
      return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: 'A delegação não foi revogada. Veja a mensagem exibida ao operador.' };
    }
  };

  function criarDesignacao() {
    const form = document.getElementById('delegacaoForm');
    if (!form || typeof W.formularioComoFerramenta !== 'function') return null;
    return W.formularioComoFerramenta({
      nome: 'preparar_designacao_substituto',
      titulo: 'Preparar designação de substituto',
      descricao: 'Preenche matrícula do Supervisor substituído, nome do substituto e vigência. CPF e data de nascimento são do operador. Não envia o formulário.',
      cargos: CARGOS_PAGINA,
      permissao: 'DESIGNAR_SUBSTITUTO',
      elemento: form,
      campos: {
        delegSubstituidoMatricula: { descricao: 'Matrícula do Supervisor que será substituído, por exemplo MAT-2001.', rotulo: 'Matrícula substituída' },
        delegSubstitutoNome: { descricao: 'Nome completo do substituto.', rotulo: 'Nome do substituto' },
        delegDataInicio: { descricao: 'Início da vigência (AAAA-MM-DDTHH:MM).', rotulo: 'Início' },
        delegDataFim: { descricao: 'Fim da vigência (AAAA-MM-DDTHH:MM).', rotulo: 'Fim' }
      }
    });
  }

  const ferramentas = [obterDelegacao, revogar];

  D.quandoPronto(() => {
    const todas = ferramentas.slice();
    const designacao = D.seguro(criarDesignacao, 'preparar_designacao_substituto');
    if (designacao) todas.push(designacao);
    W.registrarPagina({ id: 'delegacao', arquivo: 'delegacao.html', ferramentas: todas });
  });
})(window, document);
