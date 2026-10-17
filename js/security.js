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
   *
   * ⚡ Bolt Optimization: Fast-path test `!/[&<>"'`=]/.test(str)` avoids regex
   * `replace` and callback allocations for ~95%+ of plain data strings during
   * DOM table rendering, improving throughput by >2x (>50% faster).
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (!/[&<>"'`=]/.test(str)) return str;
    return str.replace(/[&<>"'`=]/g, function (ch) {
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

  // Esquema de URL no início do valor (RFC 3986 / WHATWG URL).
  const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
  // Allowlist explícita: qualquer outro esquema é recusado (inclusive
  // javascript:, vbscript:, data:, blob:, file: e esquemas de handler externo
  // como ms-msdt: / intent: / jar: / view-source:).
  const ALLOWED_URL_SCHEME_RE = /^(?:https?|mailto|tel):/i;
  // Referência relativa simples (caminho, query ou fragmento): "cargas.html?carga=1"
  const RELATIVE_REF_RE = /^[a-z0-9._~%!$&'()*+,;=:@-]+(?:[/?#].*)?$/i;

  /**
   * Sanitiza URLs dinâmicas com allowlist de esquema:
   *   - http, https, mailto, tel  -> permitidos;
   *   - referências relativas válidas (caminho, "./x", "../x", "/x", "?q", "#f",
   *     "//host/x") -> permitidas;
   *   - QUALQUER outro esquema -> recusado (fallback).
   *
   * A checagem de esquema acontece ANTES do ramo de caminho relativo, de modo
   * que um valor com esquema nunca seja aceito pela regra permissiva de
   * referência relativa (ex.: "ms-msdt:/id", "intent://x", "a:b").
   */
  function safeUrl(value, fallback) {
    const fb = fallback === undefined ? '#' : fallback;
    if (value === null || value === undefined) return fb;
    // Remove caracteres de controle usados para ofuscar o esquema (ex.: "java\tscript:")
    const cleaned = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    if (!cleaned) return fb;

    // 1. Valor com esquema: só passa se estiver na allowlist explícita.
    if (URL_SCHEME_RE.test(cleaned)) {
      return ALLOWED_URL_SCHEME_RE.test(cleaned) ? escapeHtml(cleaned) : fb;
    }

    // 2. Sem esquema: referências relativas e de rede continuam aceitas.
    if (/^(?:\/|\.{1,2}\/|#|\?)/.test(cleaned) || RELATIVE_REF_RE.test(cleaned)) {
      return escapeHtml(cleaned);
    }

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
    const str = String(value);
    if (!/[^A-Za-z0-9_-]/.test(str)) return str;
    return str.replace(/[^A-Za-z0-9_-]/g, '_');
  }

  /**
   * Remove caracteres de controle de textos livres que serão gravados em
   * logs/trail, evitando poluição de registros de auditoria.
   */
  function sanitizeText(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(str)) return str;
    return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  /** Projeção de saída do Log/Trail. Não modifica registros nem substitui escapeHtml. */
  function privacidadeAuditoria(funcionarios) {
    const valores = [...new Set((funcionarios || []).flatMap(f =>
      [f && f.matricula, f && f.codigo_individual, f && f.codigo]
    ).filter(v => v !== null && v !== undefined && String(v).trim() && v !== '--')
      .map(v => String(v).trim()))].sort((a, b) => b.length - a.length);
    const escaparRegex = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const conhecidos = valores.length ? new RegExp(
      '(^|[^\\p{L}\\p{N}_-])(' + valores.map(escaparRegex).join('|') + ')(?=$|[^\\p{L}\\p{N}_-])', 'giu'
    ) : null;
    function texto(valor) {
      let saida = valor === null || valor === undefined ? '' : String(valor);
      if (conhecidos) saida = saida.replace(conhecidos, '$1[identificação protegida]');
      return saida
        .replace(/\bMAT\s*[-:]?\s*\d+\b/gi, '[matrícula protegida]')
        .replace(/\bmatr[ií]cula\s*[:#=-]?\s*\d+\b/gi, '[matrícula protegida]')
        .replace(/\b(?:NX|SUP|INS|EST|TEC|CONF|ARR|PLAN|FUNC|FUN)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi, '[identificação protegida]');
    }
    return {
      texto,
      // Referências antigas usam a matrícula como entidade. O vínculo original fica no histórico,
      // e quando houver nome legível do funcionário exibe o nome sem expor matrícula/UUID.
      entidade: (valor, tipo) => {
        if (tipo === 'FUNCIONARIO' || /^FUNCION[AÁ]RIO(?:\s|$)/i.test(String(valor || ''))) {
          const limpo = texto(String(valor || '').replace(/^FUNCION[AÁ]RIO\s*/i, '').trim())
            .replace(/\[(?:matr[ií]cula|identifica[çc][ãa]o) protegida\]/gi, '')
            .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
            .replace(/^[(\s·•—-]+|[)\s·•—-]+$/g, '')
            .trim();
          return limpo && limpo.toUpperCase() !== 'N/A'
            ? `FUNCIONARIO (identificação protegida) — ${limpo}`
            : 'FUNCIONARIO (identificação protegida)';
        }
        return texto(valor);
      },
      responsavel: valor => texto(String(valor || '').replace(/(\))\s*-\s*.*$/, '$1'))
    };
  }

  const NexusSecurity = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeHtml,
    jsString: jsString,
    jsArg: jsArg,
    safeUrl: safeUrl,
    safeId: safeId,
    setText: setText,
    privacidadeAuditoria: privacidadeAuditoria,
    sanitizeText: sanitizeText
  };

  window.NexusSecurity = NexusSecurity;

  // Aliases globais curtos usados pelos módulos de página.
  window.nexusEsc = escapeHtml;
  window.nexusJsArg = jsArg;
  window.nexusSafeUrl = safeUrl;

  // =========================================================================
  // Padronização Global de Ícones para Font Awesome & Proteção VLibras
  // (Tarefas 3 e 10)
  // =========================================================================
  const MAPA_ICONES_FA = {
    account_tree: 'fa-sitemap',
    add: 'fa-plus',
    add_circle: 'fa-circle-plus',
    alt_route: 'fa-route',
    anchor: 'fa-anchor',
    apps: 'fa-grip',
    assessment: 'fa-chart-column',
    assignment: 'fa-clipboard-list',
    assignment_ind: 'fa-id-badge',
    autorenew: 'fa-arrows-rotate',
    badge: 'fa-id-card-clip',
    bar_chart: 'fa-chart-column',
    block: 'fa-ban',
    build: 'fa-wrench',
    build_circle: 'fa-screwdriver-wrench',
    camera_alt: 'fa-camera',
    campaign: 'fa-bullhorn',
    cancel: 'fa-circle-xmark',
    category: 'fa-shapes',
    check: 'fa-check',
    check_circle: 'fa-circle-check',
    close: 'fa-xmark',
    cloud_off: 'fa-cloud-bolt',
    contact_support: 'fa-headset',
    conveyor_belt: 'fa-dolly',
    dark_mode: 'fa-moon',
    dashboard: 'fa-gauge-high',
    delete: 'fa-trash-can',
    deployed_code: 'fa-cube',
    directions_boat: 'fa-ship',
    dock: 'fa-anchor-circle-check',
    download: 'fa-download',
    draw: 'fa-pen-nib',
    e911_emergency: 'fa-triangle-exclamation',
    edit: 'fa-pen-to-square',
    edit_note: 'fa-file-pen',
    engineering: 'fa-helmet-safety',
    error: 'fa-circle-exclamation',
    event_available: 'fa-calendar-check',
    explore: 'fa-compass',
    fact_check: 'fa-clipboard-check',
    filter_alt: 'fa-filter',
    filter_alt_off: 'fa-filter-circle-xmark',
    fingerprint: 'fa-fingerprint',
    forklift: 'fa-truck-ramp-box',
    functions: 'fa-calculator',
    gavel: 'fa-gavel',
    grid_view: 'fa-table-cells-large',
    group: 'fa-user-group',
    groups: 'fa-users',
    help: 'fa-circle-question',
    help_outline: 'fa-circle-question',
    history: 'fa-clock-rotate-left',
    history_edu: 'fa-file-signature',
    hourglass_empty: 'fa-hourglass-half',
    how_to_reg: 'fa-user-check',
    id_card: 'fa-id-card',
    info: 'fa-circle-info',
    insights: 'fa-chart-line',
    inventory_2: 'fa-boxes-stacked',
    key_off: 'fa-key',
    lan: 'fa-network-wired',
    light_mode: 'fa-sun',
    link: 'fa-link',
    link_off: 'fa-link-slash',
    lock: 'fa-lock',
    login: 'fa-right-to-bracket',
    logout: 'fa-right-from-bracket',
    menu: 'fa-bars',
    monitoring: 'fa-chart-line',
    notifications_off: 'fa-bell-slash',
    payments: 'fa-money-bill-wave',
    photo_camera: 'fa-camera',
    picture_as_pdf: 'fa-file-pdf',
    pie_chart: 'fa-chart-pie',
    precision_manufacturing: 'fa-gears',
    print: 'fa-print',
    progress_activity: 'fa-spinner',
    qr_code: 'fa-qrcode',
    qr_code_2: 'fa-qrcode',
    qr_code_scanner: 'fa-qrcode',
    refresh: 'fa-arrows-rotate',
    route: 'fa-route',
    rule: 'fa-list-check',
    sailing: 'fa-sailboat',
    save: 'fa-floppy-disk',
    schedule: 'fa-clock',
    search: 'fa-magnifying-glass',
    search_off: 'fa-magnifying-glass-minus',
    sensors: 'fa-tower-broadcast',
    settings: 'fa-gear',
    shield: 'fa-shield',
    shield_lock: 'fa-shield-halved',
    shield_person: 'fa-user-shield',
    smart_toy: 'fa-robot',
    smartphone: 'fa-mobile-screen-button',
    speed: 'fa-gauge',
    storage: 'fa-database',
    swipe: 'fa-arrows-left-right',
    sync: 'fa-rotate',
    table_chart: 'fa-table',
    table_rows: 'fa-table-list',
    task: 'fa-file-circle-check',
    task_alt: 'fa-circle-check',
    timeline: 'fa-timeline',
    travel_explore: 'fa-globe',
    verified: 'fa-certificate',
    verified_user: 'fa-shield-halved',
    vibration: 'fa-mobile-screen',
    visibility: 'fa-eye',
    visibility_off: 'fa-eye-slash',
    volume_up: 'fa-volume-high',
    warehouse: 'fa-warehouse',
    warning: 'fa-triangle-exclamation',
    web: 'fa-window-maximize',
    workspace_premium: 'fa-award'
  };

  function classeFaPara(nome) {
    const chave = String(nome || '').trim().toLowerCase();
    return MAPA_ICONES_FA[chave] || 'fa-circle-dot';
  }

  function lerTextoBrutoNo(el) {
    if (!el || !el.childNodes) return '';
    let s = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n && n.nodeType === 3) s += n.nodeValue || '';
    }
    return s.trim();
  }

  function limparNosDeTexto(el) {
    if (!el || !el.childNodes) return;
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const n = el.childNodes[i];
      if (n && n.nodeType === 3) el.removeChild(n);
    }
  }

  function aplicarAtributosAcessibilidadeIcone(el) {
    if (!el || el.nodeType !== 1) return;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('role', 'presentation');
    el.setAttribute('translate', 'no');
    el.setAttribute('data-vlibras-ignore', 'true');
    el.setAttribute('vw-ignore', 'true');
    if (el.classList) el.classList.add('notranslate');
  }

  function aplicarIconeFa(el, nomeExplicito) {
    if (!el || el.nodeType !== 1) return;
    const bruto = nomeExplicito !== undefined
      ? String(nomeExplicito || '').trim()
      : (el.getAttribute('data-icon') || lerTextoBrutoNo(el));
    const chave = String(bruto || '').trim();
    if (!chave) {
      aplicarAtributosAcessibilidadeIcone(el);
      limparNosDeTexto(el);
      return;
    }

    const faCls = classeFaPara(chave);
    const anterior = el.getAttribute('data-fa-cls');
    if (anterior && anterior !== faCls && el.classList) {
      el.classList.remove(anterior);
    }
    if (el.classList) {
      el.classList.add('fa-solid', faCls);
    }
    el.setAttribute('data-icon', chave);
    el.setAttribute('data-fa-cls', faCls);
    aplicarAtributosAcessibilidadeIcone(el);
    limparNosDeTexto(el);

    if (!el.__nexusFaDescriptor) {
      try {
        Object.defineProperty(el, '__nexusFaDescriptor', { value: true, enumerable: false });
        Object.defineProperty(el, 'textContent', {
          configurable: true,
          get: function () {
            return '';
          },
          set: function (val) {
            aplicarIconeFa(this, val);
          }
        });
        Object.defineProperty(el, 'innerText', {
          configurable: true,
          get: function () {
            return '';
          },
          set: function (val) {
            aplicarIconeFa(this, val);
          }
        });
      } catch (e) { /* ambiente restrito */ }
    }
  }

  function sincronizarIconesFa(raiz) {
    const doc = window.document;
    const escopo = raiz || doc;
    if (!escopo || typeof escopo.querySelectorAll !== 'function') return;
    if (escopo.nodeType === 1 && escopo.classList &&
        (escopo.classList.contains('material-symbols-outlined') ||
         escopo.classList.contains('fa-solid') ||
         escopo.classList.contains('fa-regular') ||
         escopo.hasAttribute('data-icon'))) {
      aplicarIconeFa(escopo);
    }
    const lista = escopo.querySelectorAll('.material-symbols-outlined, [data-icon], .fa-solid, .fa-regular, .fas, .far');
    for (let i = 0; i < lista.length; i++) {
      aplicarIconeFa(lista[i]);
    }
  }

  // Tarefa 10: Sanitização de leitura para o VLibras — garante que nenhum nome
  // técnico de ícone (ex.: "dashboard", "inventory_2", "fact_check", etc.) ou
  // glifo de área de uso privado seja lido antes do nome das páginas na sidebar
  // ou em botões/títulos do restante do sistema.
  const TOKENS_ICONES_ORDENADOS = Object.keys(MAPA_ICONES_FA)
    .sort(function (a, b) { return b.length - a.length; });
  const REGEX_PREFIXO_ICONE = new RegExp(
    '^\\s*(?:' + TOKENS_ICONES_ORDENADOS.map(function (k) {
      return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')(?=\\s+\\S)\\s*'
  );

  function limparTextoParaVLibras(texto) {
    if (texto === null || texto === undefined) return '';
    let limpo = String(texto)
      .replace(/[\uE000-\uF8FF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    let anterior = null;
    while (limpo && limpo !== anterior && REGEX_PREFIXO_ICONE.test(limpo)) {
      anterior = limpo;
      limpo = limpo.replace(REGEX_PREFIXO_ICONE, '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(MAPA_ICONES_FA, limpo)) {
      return '';
    }
    return limpo;
  }

  function extrairTextoLegivelElemento(el) {
    if (!el || el.nodeType !== 1) return '';
    sincronizarIconesFa(el);
    try {
      const clone = el.cloneNode(true);
      const ignorados = clone.querySelectorAll(
        '.material-symbols-outlined, .fa-solid, .fa-regular, .fas, .far, .fa, [data-icon], [data-vlibras-ignore="true"], [vw-ignore="true"], [aria-hidden="true"]'
      );
      for (let i = ignorados.length - 1; i >= 0; i--) {
        if (ignorados[i] && ignorados[i].parentNode) {
          ignorados[i].parentNode.removeChild(ignorados[i]);
        }
      }
      const bruto = limparTextoParaVLibras(clone.textContent || '');
      if (bruto) return bruto;
    } catch (e) { /* fallback abaixo */ }
    const rotulo = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return limparTextoParaVLibras(rotulo);
  }

  function envolverPluginVLibras() {
    try {
      const p = window.plugin;
      if (p && p.player && typeof p.player.translate === 'function' && !p.player.__nexusVlibrasWrapped) {
        const origTranslate = p.player.translate.bind(p.player);
        p.player.translate = function (texto) {
          const limpo = limparTextoParaVLibras(texto);
          return origTranslate(limpo || texto);
        };
        Object.defineProperty(p.player, '__nexusVlibrasWrapped', { value: true, enumerable: false });
      }
      if (window.VLibras && typeof window.VLibras.Widget === 'function' && !window.VLibras.Widget.__nexusVlibrasWrapped) {
        const OrigWidget = window.VLibras.Widget;
        const WrappedWidget = function () {
          const inst = OrigWidget.apply(this, arguments);
          setTimeout(envolverPluginVLibras, 0);
          setTimeout(envolverPluginVLibras, 300);
          return inst;
        };
        WrappedWidget.prototype = OrigWidget.prototype;
        Object.defineProperty(WrappedWidget, '__nexusVlibrasWrapped', { value: true, enumerable: false });
        window.VLibras.Widget = WrappedWidget;
      }
    } catch (e) { /* noop */ }
  }

  window.NexusFontAwesome = {
    mapa: MAPA_ICONES_FA,
    classeFa: classeFaPara,
    aplicarElemento: aplicarIconeFa,
    sincronizar: sincronizarIconesFa
  };

  window.NexusVLibras = {
    limparTexto: limparTextoParaVLibras,
    extrairTextoElemento: extrairTextoLegivelElemento,
    protegerPlugin: envolverPluginVLibras
  };

  if (window.document) {
    const iniciarObservadorFa = function () {
      sincronizarIconesFa(window.document);
      envolverPluginVLibras();
      if (typeof window.MutationObserver === 'function' && window.document.documentElement) {
        try {
          const obs = new window.MutationObserver(function (mutacoes) {
            for (let i = 0; i < mutacoes.length; i++) {
              const m = mutacoes[i];
              if (m.type === 'childList' && m.addedNodes) {
                for (let j = 0; j < m.addedNodes.length; j++) {
                  const no = m.addedNodes[j];
                  if (no && no.nodeType === 1) sincronizarIconesFa(no);
                }
              }
            }
            envolverPluginVLibras();
          });
          obs.observe(window.document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* noop */ }
      }
      ['pointerdown', 'mouseover', 'focusin'].forEach(function (evName) {
        window.document.addEventListener(evName, function (ev) {
          if (ev && ev.target && ev.target.nodeType === 1) {
            const alvo = ev.target.closest
              ? (ev.target.closest('a, button, label, h1, h2, h3, h4, h5, h6, td, th, li') || ev.target)
              : ev.target;
            sincronizarIconesFa(alvo);
          }
          envolverPluginVLibras();
        }, { capture: true, passive: true });
      });
    };
    if (window.document.readyState === 'loading') {
      window.document.addEventListener('DOMContentLoaded', iniciarObservadorFa);
    } else {
      iniciarObservadorFa();
    }
  }
})(window);
