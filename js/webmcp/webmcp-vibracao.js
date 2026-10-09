/**
 * WebMCP — página de teste de vibração (js/webmcp/webmcp-vibracao.js) — NexusPort
 *
 * Página de diagnóstico sem login. Ferramentas públicas: estado do alerta tátil
 * (somente leitura) e ativação/desativação da preferência neste navegador. O disparo
 * de vibração exige gesto do usuário e fica somente na tela.
 *
 * Carregamento: depois de webmcp-core e webmcp-ui (sem dados de sessão).
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  if (!W) return;

  function quandoPronto(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  const estado = {
    nome: 'obter_estado_vibracao',
    titulo: 'Estado do alerta tátil',
    descricao: 'Informa se o aparelho suporta vibração, se o alerta está ativo e o motivo de eventual bloqueio. Somente leitura.',
    anotacoes: { readOnlyHint: true },
    publica: true,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      if (!window.NexusHaptics) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Módulo de alerta tátil indisponível.' };
      const st = window.NexusHaptics.status();
      return {
        mensagem: window.NexusHaptics.describe(),
        dados: {
          ativo: window.NexusHaptics.isEnabled(),
          suporte: st.backend || null,
          aparelho_movel: st.mobile === true,
          contexto_seguro: st.secureContext === true
        }
      };
    }
  };

  const definir = {
    nome: 'definir_vibracao_ativa',
    titulo: 'Ativar ou desativar alerta tátil',
    descricao: 'Liga ou desliga o alerta tátil neste navegador. Não dispara vibração.',
    anotacoes: {},
    publica: true,
    esquema: {
      type: 'object',
      properties: { ativa: { type: 'boolean', rotulo: 'Ativo', description: 'true para ligar, false para desligar.' } },
      required: ['ativa'],
      additionalProperties: false
    },
    executar: (args) => {
      if (!window.NexusHaptics) return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Módulo de alerta tátil indisponível.' };
      const valor = window.NexusHaptics.setEnabled(args.ativa);
      return { mensagem: `Alerta tátil ${valor ? 'ativado' : 'desativado'} neste navegador.`, dados: { ativo: valor } };
    }
  };

  quandoPronto(() => W.registrarPagina({ id: 'vibracao', arquivo: null, ferramentas: [estado, definir] }));
})(window, document);
