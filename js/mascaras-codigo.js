/**
 * Máscaras de códigos e matrículas (js/mascaras-codigo.js) — NexusPort
 *
 * Formatação automática com hífen DURANTE a digitação (e ao colar), com uma
 * regra própria para cada campo que tem padrão definido — não existe regra
 * genérica "insere hífen a cada N caracteres".
 *
 *   Padrão               Exibido no campo    Gravado no banco (formato já existente)
 *   MATRICULA            MAT-1234            MAT-1234
 *   CODIGO_INDIVIDUAL    NX-1040-5823 / EST-1040  idem
 *   CODIGO_CARGA         CRG-2026-303        CRG-2026-303
 *   QR_CARGA             QR-CRG-2026-303     QR-CRG-2026-303
 *   IMO                  ABC-1234567         ABC1234567   (numero_imo UNIQUE, sem hífen)
 *   CONTAINER            MSCU-1234567        MSCU1234567  (ISO 6346, sem hífen)
 *   GUINDASTE            ABC-123-DEF         ABC123DEF    (sem hífen)
 *
 * - `formatar(tipo, valor)`  → texto com hífens para o campo;
 * - `canonico(tipo, valor)`  → valor no formato persistido (compatível com os
 *   registros existentes);
 * - `valido(tipo, valor)`    → confere o padrão antes de salvar;
 * - `chave(valor)`           → forma normalizada (só letras/dígitos, maiúsculas)
 *   para comparar/evitar duplicidade ("mat 1234" = "MAT-1234").
 *
 * Uso: `<input data-mascara="MATRICULA">` (ligado automaticamente) ou
 * `NexusMascaras.aplicar(input, 'IMO')`. Campos de BUSCA usam
 * `data-mascara-busca` para não inserir prefixo em pesquisas parciais.
 */
(function (global) {
  'use strict';

  function alfanum(valor) {
    return String(valor == null ? '' : valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** "MAT-1234": prefixo fixo MAT + 4 dígitos. */
  function formatarMatricula(valor, busca) {
    const s = alfanum(valor);
    if (!s) return '';
    if (s.startsWith('MAT')) {
      const digitos = s.slice(3).replace(/\D/g, '').slice(0, 4);
      return digitos ? `MAT-${digitos}` : 'MAT';
    }
    if (/^\d/.test(s)) {
      const digitos = s.replace(/\D/g, '').slice(0, 4);
      return busca ? digitos : `MAT-${digitos}`;
    }
    if ('MAT'.startsWith(s)) return s; // digitando o prefixo ("M", "MA")
    return busca ? String(valor).toUpperCase() : s.slice(0, 8);
  }

  /**
   * Código individual: PREFIXO-MATRÍCULA(4 dígitos)[-SUFIXO].
   * Gerado pelo sistema como NX-1040-5823 (tecnico_portos.js); códigos de
   * perfil como EST-1040 / SUP-2001; legados como NX-1040-SP.
   */
  function formatarCodigoIndividual(valor) {
    const s = alfanum(valor).slice(0, 12);
    const m = s.match(/^([A-Z]*)(\d{0,4})([A-Z0-9]*)$/);
    if (!m) return s;
    let out = m[1];
    if (m[2]) out += (out ? '-' : '') + m[2];
    if (m[3]) out += (out ? '-' : '') + m[3];
    return out;
  }

  /** "CRG-2026-303": prefixo CRG + ano (4 dígitos) + sequencial. */
  function formatarCodigoCarga(valor, busca) {
    const s = alfanum(valor);
    if (!s) return '';
    let resto;
    if (s.startsWith('CRG')) {
      resto = s.slice(3);
    } else if (/^\d/.test(s)) {
      if (busca) return s; // busca parcial por número: não força o prefixo
      resto = s;
    } else {
      return 'CRG'.startsWith(s) ? s : (busca ? String(valor).toUpperCase() : s);
    }
    const digitos = resto.replace(/\D/g, '').slice(0, 10);
    if (!digitos) return 'CRG';
    const ano = digitos.slice(0, 4);
    const seq = digitos.slice(4);
    return `CRG-${ano}${seq ? `-${seq}` : ''}`;
  }

  /** "QR-CRG-2026-303": etiqueta QR da carga. */
  function formatarQrCarga(valor, busca) {
    const s = alfanum(valor);
    if (!s) return '';
    if (s.startsWith('QR')) {
      const resto = s.slice(2);
      return resto ? `QR-${formatarCodigoCarga(resto, false)}` : 'QR';
    }
    if ('QR'.startsWith(s)) return s;
    return formatarCodigoCarga(s, busca);
  }

  /** Divide letras e dígitos de um padrão fixo (IMO 3+7, contêiner 4+7, guindaste 3+3+3). */
  function formatarSegmentos(valor, segmentos) {
    const s = alfanum(valor);
    let pos = 0;
    const partes = [];
    for (const seg of segmentos) {
      if (pos >= s.length) break;
      const trecho = s.slice(pos, pos + seg);
      partes.push(trecho);
      pos += seg;
    }
    return partes.join('-');
  }

  const PADROES = {
    MATRICULA: {
      formatar: formatarMatricula,
      canonico: (v) => formatarMatricula(v, false),
      regex: /^MAT-\d{4}$/,
      exemplo: 'MAT-1234'
    },
    CODIGO_INDIVIDUAL: {
      formatar: formatarCodigoIndividual,
      canonico: formatarCodigoIndividual,
      regex: /^[A-Z]{2,5}-\d{4}(-[A-Z0-9]{1,6})?$/,
      exemplo: 'NX-1040-5823 ou EST-1040'
    },
    CODIGO_CARGA: {
      formatar: formatarCodigoCarga,
      canonico: (v) => formatarCodigoCarga(v, false),
      regex: /^CRG-\d{4}-\d{1,6}$/,
      exemplo: 'CRG-2026-303'
    },
    QR_CARGA: {
      formatar: formatarQrCarga,
      canonico: (v) => formatarQrCarga(v, false),
      regex: /^QR-CRG-\d{4}-\d{1,6}$/,
      exemplo: 'QR-CRG-2026-303'
    },
    IMO: {
      formatar: (v) => formatarSegmentos(v, [3, 7]),
      canonico: (v) => alfanum(v).slice(0, 10),
      regex: /^[A-Z]{3}\d{7}$/,
      exemplo: 'IMO-1234567'
    },
    CONTAINER: {
      formatar: (v) => formatarSegmentos(v, [4, 7]),
      canonico: (v) => alfanum(v).slice(0, 11),
      regex: /^[A-Z]{4}\d{7}$/,
      exemplo: 'MSCU-1234567'
    },
    GUINDASTE: {
      formatar: (v) => formatarSegmentos(v, [3, 3, 3]),
      canonico: (v) => alfanum(v).slice(0, 9),
      regex: /^[A-Z]{3}\d{3}[A-Z]{3}$/,
      exemplo: 'ABC-123-DEF'
    }
  };

  function padrao(tipo) {
    const p = PADROES[String(tipo || '').toUpperCase()];
    if (!p) throw new Error(`[NexusMascaras] Padrão desconhecido: ${tipo}`);
    return p;
  }

  function formatar(tipo, valor, busca) {
    return padrao(tipo).formatar(valor, Boolean(busca));
  }

  function canonico(tipo, valor) {
    return padrao(tipo).canonico(valor);
  }

  function valido(tipo, valor) {
    return padrao(tipo).regex.test(canonico(tipo, valor));
  }

  /** Forma de comparação: só letras e dígitos, maiúsculas. */
  function chave(valor) {
    return alfanum(valor);
  }

  /** Mesmo código, independentemente de hífens/espaços/maiúsculas? */
  function mesmoCodigo(a, b) {
    const ka = chave(a);
    return ka !== '' && ka === chave(b);
  }

  /**
   * Liga a máscara ao campo: formata a cada digitação/colagem preservando a
   * posição do cursor (conta letras/dígitos antes dele). Apagar um hífen não
   * "trava" o campo: o hífen só existe entre dois trechos preenchidos.
   */
  function aplicar(input, tipo, opcoes) {
    if (!input || input.dataset.mascaraLigada === '1') return;
    const busca = Boolean((opcoes && opcoes.busca) || input.hasAttribute('data-mascara-busca'));
    padrao(tipo); // valida o tipo
    input.dataset.mascaraLigada = '1';
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('spellcheck', 'false');

    const reformatar = () => {
      const anterior = input.value;
      const formatado = formatar(tipo, anterior, busca);
      if (formatado === anterior) return;
      let cursor = anterior.length;
      try { if (input.selectionStart != null) cursor = input.selectionStart; } catch (e) { /* tipo sem seleção */ }
      const significativosAntes = alfanum(anterior.slice(0, cursor)).length;
      input.value = formatado;
      let novaPos = formatado.length;
      if (significativosAntes === 0) {
        novaPos = 0;
      } else {
        let vistos = 0;
        for (let i = 0; i < formatado.length; i++) {
          if (/[A-Z0-9]/.test(formatado[i])) {
            vistos += 1;
            if (vistos === significativosAntes) { novaPos = i + 1; break; }
          }
        }
      }
      try { if (document.activeElement === input) input.setSelectionRange(novaPos, novaPos); } catch (e) { /* ignora */ }
    };

    input.addEventListener('input', reformatar);
    // Colagem: o evento input já cobre; o blur garante o formato final.
    input.addEventListener('blur', reformatar);
    if (input.value) reformatar();
  }

  function ligarTodos(raiz) {
    const base = raiz || document;
    base.querySelectorAll('[data-mascara]').forEach((el) => {
      try { aplicar(el, el.getAttribute('data-mascara')); } catch (e) { console.warn(e); }
    });
  }

  global.NexusMascaras = { PADROES, formatar, canonico, valido, chave, mesmoCodigo, aplicar, ligarTodos };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => ligarTodos());
    } else {
      ligarTodos();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
