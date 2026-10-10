/**
 * Medição de uso com Google Analytics 4 (Backlog 3, item F).
 *
 * - Identificador do aparelho: o cookie `_ga`, gravado pelo próprio gtag.js. É o mecanismo nativo do
 *   GA4, então o Google reconhece as ações de um mesmo dispositivo sem artifícios.
 * - Sem fingerprinting: nada de canvas, áudio, fontes, plugins, bateria ou hardware.
 * - Cookies com SameSite=Lax e Secure quando a página é HTTPS (mesma política dos cookies de sessão).
 * - Sem sinais de publicidade (Google Signals) e sem personalização de anúncios.
 * - Eventos sem dados pessoais: campos com nomes de codigo, nome, matrícula, e-mail etc. são descartados.
 *   Valores são categorias (ex.: "tela"), nunca nomes ou códigos de funcionário.
 * - Se o gtag.js estiver bloqueado (ad blocker, rede), `track` retorna false e não lança erro.
 *
 * Uso: NexusAnalytics.track('gerar_pdf', { origem: 'tela' })
 * Consentimento de cookies (LGPD) não está implementado aqui: ver SPECs/backlog3.md, item F.
 */
(function (window) {
  'use strict';

  const MEDICAO_ID = 'G-50V6WDEMPT';
  const DOIS_ANOS_EM_SEGUNDOS = 2 * 365 * 24 * 60 * 60;
  const NOME_EVENTO = /^[a-z][a-z0-9_]{2,39}$/;
  const NOME_PARAMETRO = /^[a-z][a-z0-9_]{0,39}$/;
  const PARAMETRO_PESSOAL = /codigo|matric|nome|e_?mail|cpf|senha|token|cookie|telefone|endereco|user_?id/i;
  const MAX_VALOR = 100;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  // gtag.js entra na primeira interação do visitante (ou no primeiro evento registrado), e não no
  // carregamento da página: o script do Google (terceiro) fica fora do caminho crítico, a página
  // abre sem depender de rede externa e quem só lê não baixa nada. Os eventos são enfileirados em
  // `dataLayer` e o gtag.js os processa assim que chega — o mesmo comportamento do snippet oficial.
  let requisitado = false;
  function carregarGtag() {
    if (requisitado || typeof document === 'undefined' || !document.head) return;
    requisitado = true;
    if (document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) return;
    const carregador = document.createElement('script');
    carregador.async = true;
    carregador.src = `https://www.googletagmanager.com/gtag/js?id=${MEDICAO_ID}`;
    document.head.appendChild(carregador);
  }
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((evento) => {
    window.addEventListener(evento, carregarGtag, { once: true, passive: true });
  });

  const seguro = Boolean(window.location && window.location.protocol === 'https:');
  window.gtag('js', new Date());
  window.gtag('config', MEDICAO_ID, {
    client_storage: 'cookie',
    cookie_flags: seguro ? 'SameSite=Lax;Secure' : 'SameSite=Lax',
    cookie_expires: DOIS_ANOS_EM_SEGUNDOS,
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });

  /** Mantém só parâmetros com nome válido, sem dados pessoais e com valores curtos. */
  function sanitizarParametros(params) {
    const limpo = {};
    if (!params || typeof params !== 'object') return limpo;
    Object.keys(params).forEach((chave) => {
      if (!NOME_PARAMETRO.test(chave) || PARAMETRO_PESSOAL.test(chave)) return;
      const valor = params[chave];
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        limpo[chave] = valor;
      } else if (typeof valor === 'string' && valor.length > 0) {
        limpo[chave] = valor.slice(0, MAX_VALOR);
      }
    });
    return limpo;
  }

  /** Envia um evento ao GA4. Retorna true quando foi enfileirado para envio. */
  function track(nome, params) {
    if (typeof nome !== 'string' || !NOME_EVENTO.test(nome)) return false;
    if (typeof window.gtag !== 'function') return false;
    carregarGtag();
    try {
      window.gtag('event', nome, sanitizarParametros(params));
      return true;
    } catch (erro) {
      return false;
    }
  }

  window.NexusAnalytics = {
    MEDICAO_ID,
    track,
    sanitizarParametros,
    carregarGtag
  };
})(window);
