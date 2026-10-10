/**
 * CARREGADOR SOB DEMANDA DAS BIBLIOTECAS LOCAIS — NexusPort.
 *
 * As bibliotecas de terceiros ficam versionadas em `vendor/` (geradas por tools/assets.js a partir
 * dos pacotes npm). Só entram na página quando a funcionalidade é usada — abrir a câmera, gerar a
 * etiqueta QR, imprimir a etiqueta em PDF ou desenhar os gráficos — em vez de serem baixadas,
 * interpretadas e executadas na abertura de toda tela.
 *
 * API:
 *   window.NexusAssets.carregar('jspdf').then((ok) => { ... })   // resolve true quando o global existe
 *   window.NexusAssets.carregar('html5-qrcode')
 *
 * Cada biblioteca é buscada uma única vez por página (a promessa é reaproveitada; uma falha de rede
 * libera a próxima tentativa). Sem DOM (testes com jsdom), a promessa resolve false e o chamador
 * segue pelo caminho de degradação que já existia (`typeof X === 'undefined'`).
 */
(function (window) {
  'use strict';

  /** Bibliotecas locais: arquivo em vendor/ e global que precisa existir para considerá-la pronta. */
  const BIBLIOTECAS = {
    qrcode: { arquivo: 'vendor/qrcode.min.js', pronto: () => typeof window.QRCode !== 'undefined' },
    jspdf: { arquivo: 'vendor/jspdf.min.js', pronto: () => !!(window.jspdf && window.jspdf.jsPDF) },
    'html5-qrcode': { arquivo: 'vendor/html5-qrcode.min.js', pronto: () => typeof window.Html5Qrcode !== 'undefined' },
    chartjs: { arquivo: 'vendor/chart-js.min.js', pronto: () => typeof window.Chart !== 'undefined' },
    'supabase-js': { arquivo: 'vendor/supabase-js.min.js', pronto: () => typeof window.supabase !== 'undefined' }
  };

  const promessas = {};

  /** Carrega a biblioteca (idempotente) e resolve true quando o global estiver disponível. */
  function carregar(nome) {
    const biblioteca = BIBLIOTECAS[nome];
    if (!biblioteca) return Promise.resolve(false);
    if (biblioteca.pronto()) return Promise.resolve(true);
    if (promessas[nome]) return promessas[nome];

    const promessa = new Promise((resolve) => {
      const doc = window.document;
      if (!doc || !doc.createElement || !(doc.head || doc.body)) {
        resolve(false);
        return;
      }
      const existente = doc.querySelector ? doc.querySelector(`script[src$="${biblioteca.arquivo}"]`) : null;
      const script = existente || doc.createElement('script');
      const concluir = () => resolve(biblioteca.pronto());
      script.addEventListener('load', concluir);
      script.addEventListener('error', concluir);
      if (!existente) {
        script.src = biblioteca.arquivo;
        script.async = true;
        script.setAttribute('data-nexus-asset', nome);
        (doc.head || doc.body).appendChild(script);
      }
    }).then((disponivel) => {
      if (!disponivel) delete promessas[nome]; // permite nova tentativa depois de uma falha
      return disponivel;
    });

    promessas[nome] = promessa;
    return promessa;
  }

  window.NexusAssets = { carregar, disponiveis: Object.keys(BIBLIOTECAS) };
})(window);
