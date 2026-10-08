/**
 * WebMCP — página Scanner QR Code (js/webmcp-scanner.js) — NexusPort
 *
 * Interpreta um código lido por QR (como o botão "simular leitura" da tela). Cada
 * leitura gera registro de auditoria e de leitura, como na tela; por isso a ferramenta
 * tem limite de taxa. O texto lido é tratado como NÃO CONFIÁVEL e só aceita códigos no
 * padrão de identificadores do sistema (o campo é usado em consultas).
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const ler = {
    nome: 'ler_codigo_qr',
    titulo: 'Ler código QR',
    descricao: 'Identifica uma carga ou contêiner pelo código do QR (como o scanner da tela) e mostra os dados e a ação sugerida. Registra a leitura na auditoria.',
    anotacoes: { untrustedContentHint: true },
    cargos: D.GRUPOS.todos,
    limiteMinuto: 10,
    esquema: {
      type: 'object',
      properties: {
        codigo: {
          type: 'string', minLength: 3, maxLength: 80, pattern: '^[A-Za-z0-9._-]{3,80}$',
          mensagemPadrao: 'use somente letras, números, ponto, traço e underline.',
          rotulo: 'Código lido', description: 'Código do QR, por exemplo QR-CRG-2026-001 ou CRG-2026-001.'
        }
      },
      required: ['codigo'],
      additionalProperties: false
    },
    executar: async (args) => {
      if (typeof window.nexusScannerProcessar !== 'function') return { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Leitor indisponível nesta página.' };
      const r = await window.nexusScannerProcessar(args.codigo);
      return {
        mensagem: r && r.encontrado ? 'Código identificado.' : 'Código não localizado no sistema.',
        dados: r || null
      };
    }
  };

  D.quandoPronto(() => W.registrarPagina({ id: 'scanner', arquivo: 'scanner.html', ferramentas: [ler] }));
})(window, document);
