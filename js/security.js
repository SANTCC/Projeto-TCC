/**
 * Módulo de Segurança de Saída / Anti-XSS - NexusPort (js/security.js)
 *
 * Centraliza a codificação de dados NÃO CONFIÁVEIS antes de qualquer
 * inserção em HTML. O sistema renderiza tabelas via `innerHTML` a partir de
 * dados vindos do Supabase, do localStorage e de leitura de QR Code; sem
 * codificação esses valores permitem injeção de HTML/JS arbitrário
 * (DOM-based XSS) inclusive dentro de manipuladores inline `onclick="..."`.
 *
 * Regras de uso obrigatórias neste projeto:
 *
 *   1. Interpolação em HTML/texto/atributo:
 *        `<td>${nexusEsc(c.nome)}</td>`
 *
 *   2. Argumento de manipulador inline (JS dentro de atributo HTML):
 *        `<button onclick="fn(${nexusJsArg(c.id)})">`
 *      NUNCA use `${c.id}` cru nem `${nexusEsc(c.id)}` para argumentos de
 *      evento: `nexusEsc` não impede escape da string JavaScript.
 *
 *   3. URLs dinâmicas (href/src):
 *        `<a href="${nexusSafeUrl(u.url)}">`
 *
 * Este arquivo deve ser carregado ANTES de qualquer módulo de página.
 */
(function (window) {
  'use strict';

  const HTML_ENTITIES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
    '=': '&#61;'
  };

  /**
   * Codifica um valor para uso como texto HTML ou como valor de atributo
   * delimitado por aspas. Neutraliza `<`, `>`, `&`, aspas simples/duplas,
   * crase e `=`, impedindo quebra de tag ou de atributo.
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`=]/g, function (ch) {
      return HTML_ENTITIES[ch];
    });
  }

  /**
   * Converte um valor em um literal de string JavaScript (aspas simples)
   * seguro para ser embutido dentro de um atributo HTML de evento
   * (`onclick`, `onchange`, `oninput`, ...).
   *
   * Todos os caracteres sensíveis são emitidos como escapes hexadecimais
   * (`\x27`) ou unicode (`\u2028`), de forma que o resultado:
   *   - nunca contém `'` nem `"` → não fecha a string JS e não fecha o
   *     atributo HTML (que é delimitado por aspas duplas);
   *   - nunca contém `<`, `>`, `&` → não permite abrir tag nem entidade;
   *   - nunca contém quebras de linha literais → não permite quebra de
   *     linha dentro do atributo;
   *   - preserva o valor original quando interpretado pelo JavaScript.
   */
  function jsString(value) {
    const raw = (value === null || value === undefined) ? '' : String(value);
    let out = "'";
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      const ch = raw.charAt(i);
      if (code === 0x5c) { out += '\\x5C'; continue; }        // backslash
      if (code === 0x27) { out += '\\x27'; continue; }        // '
      if (code === 0x22) { out += '\\x22'; continue; }        // "
      if (code === 0x60) { out += '\\x60'; continue; }        // `
      if (code === 0x3c) { out += '\\x3C'; continue; }        // <
      if (code === 0x3e) { out += '\\x3E'; continue; }        // >
      if (code === 0x26) { out += '\\x26'; continue; }        // &
      if (code === 0x0a) { out += '\\x0A'; continue; }        // \n
      if (code === 0x0d) { out += '\\x0D'; continue; }        // \r
      if (code === 0x09) { out += '\\x09'; continue; }        // \t
      if (code === 0x2028) { out += '\\u2028'; continue; }    // line separator
      if (code === 0x2029) { out += '\\u2029'; continue; }    // paragraph separator
      if (code < 0x20) { out += '\\x' + code.toString(16).toUpperCase().padStart(2, '0'); continue; }
      out += ch;
    }
    return out + "'";
  }

  /**
   * Compatibilidade: recebe um argumento "cru" e devolve o literal seguro
   * já pronto para uso em manipuladores inline.
   */
  function jsArg(value) {
    return jsString(value);
  }

  /**
   * Bloqueia esquemas perigosos (`javascript:`, `vbscript:`, `data:`) em
   * URLs dinâmicas, permitindo apenas http(s), mailto, tel, caminhos
   * relativos e âncoras.
   */
  function safeUrl(value, fallback) {
    const fb = fallback === undefined ? '#' : fallback;
    if (value === null || value === undefined) return fb;
    // Remove caracteres de controle usados para ofuscar o esquema (ex.: "java\tscript:")
    const cleaned = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    if (!cleaned) return fb;
    const lowered = cleaned.toLowerCase();
    if (/^(?:javascript|vbscript|data|blob|file):/i.test(lowered)) return fb;
    if (/^(?:https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|\?)/i.test(lowered)) return escapeHtml(cleaned);
    // Caminho relativo simples (ex.: "cargas.html?carga=1")
    if (/^[a-z0-9._~%!$&'()*+,;=:@-]+(?:[/?#].*)?$/i.test(cleaned)) return escapeHtml(cleaned);
    return fb;
  }

  /**
   * Define texto de forma segura (nunca interpreta HTML).
   */
  function setText(element, value) {
    if (!element) return;
    element.textContent = (value === null || value === undefined) ? '' : String(value);
  }

  /**
   * Codifica um valor para uso dentro de um ID de elemento/classe CSS.
   */
  function safeId(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[^A-Za-z0-9_-]/g, '_');
  }

  /**
   * Remove caracteres de controle de textos livres que serão gravados em
   * logs/trail, evitando poluição de registros de auditoria.
   */
  function sanitizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  const NexusSecurity = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeHtml,
    jsString: jsString,
    jsArg: jsArg,
    safeUrl: safeUrl,
    safeId: safeId,
    setText: setText,
    sanitizeText: sanitizeText
  };

  window.NexusSecurity = NexusSecurity;

  // Aliases globais curtos usados pelos módulos de página.
  window.nexusEsc = escapeHtml;
  window.nexusJsArg = jsArg;
  window.nexusSafeUrl = safeUrl;
})(window);
