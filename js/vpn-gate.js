/**
 * Verificação visual de IP via Supabase Edge Function.
 *
 * Esta camada evita que a interface apareça antes da resposta, mas não substitui
 * um proxy/firewall: o host estático ainda entrega os arquivos ao navegador.
 */
(function () {
  'use strict';

  var CLASSE_ESPERA = 'nexus-vpn-gate-checking';
  var TEXTO_BLOQUEIO = 'AQUI NÃO!! TICO-TICO!!!!!!!!';
  var raiz = document.documentElement;
  if (!raiz || !raiz.classList.contains(CLASSE_ESPERA)) return;

  function liberarTela() {
    raiz.classList.remove(CLASSE_ESPERA);
  }

  function mostrarTextoPuro(texto) {
    var mensagem = texto === TEXTO_BLOQUEIO ? texto : TEXTO_BLOQUEIO;
    try {
      var blob = new Blob([mensagem], { type: 'text/plain;charset=utf-8' });
      window.location.replace(URL.createObjectURL(blob));
      return;
    } catch (_erro) {
      // Fallback para navegadores que não aceitam navegação para Blob.
      if (document.body) {
        raiz.classList.remove(CLASSE_ESPERA);
        document.body.textContent = mensagem;
        document.body.style.cssText = 'margin:8px;font:13px monospace;white-space:pre-wrap;color:#000;background:#fff';
      }
    }
  }

  function hostDeDesenvolvimento() {
    var host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function verificar() {
    // Build/teste local continua funcionando sem depender de deploy da Edge Function.
    if (hostDeDesenvolvimento()) {
      liberarTela();
      return;
    }

    var config = window.NEXUS_CONFIG || {};
    var supabaseUrl = typeof config.SUPABASE_URL === 'string' ? config.SUPABASE_URL.trim() : '';
    var anonKey = typeof config.SUPABASE_ANON_KEY === 'string' ? config.SUPABASE_ANON_KEY.trim() : '';

    // Configuração de exemplo mantém o modo de demonstração/offline do projeto.
    if (/sua-url-supabase/i.test(supabaseUrl) || /sua-chave-anon/i.test(anonKey)) {
      liberarTela();
      return;
    }
    if (!supabaseUrl || !anonKey) {
      mostrarTextoPuro(TEXTO_BLOQUEIO);
      return;
    }

    var endpoint;
    try {
      var base = new URL(supabaseUrl);
      if (base.protocol !== 'https:') throw new Error('A URL do Supabase deve usar HTTPS.');
      endpoint = new URL('/functions/v1/vpn-gate', base.origin).toString();
    } catch (_erro) {
      mostrarTextoPuro(TEXTO_BLOQUEIO);
      return;
    }

    window.fetch(endpoint, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + anonKey
      }
    }).then(function (resposta) {
      if (resposta.status === 204) {
        liberarTela();
        return;
      }
      return resposta.text().catch(function () { return ''; }).then(function (texto) {
        mostrarTextoPuro(texto.trim() === TEXTO_BLOQUEIO ? texto : TEXTO_BLOQUEIO);
      });
    }).catch(function () {
      // Fail-closed: função/listas indisponíveis não liberam a interface.
      mostrarTextoPuro(TEXTO_BLOQUEIO);
    });
  }

  verificar();
})();
