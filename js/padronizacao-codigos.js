/**
 * NexusPort — Padronização de matrículas e códigos com hífen (vanilla JS, sem dependências).
 *
 * Regras definidas CAMPO A CAMPO (não há regra genérica):
 *   imo        IMO-1234567    prefixo IMO + 7 números           (navio)
 *   conteiner  MSCU-1234567   4 letras + hífen + 7 números      (contêiner)
 *   guindaste  ABC-123-DEF    3 letras, 3 números, 3 letras     (guindaste)
 *   matricula  MAT-2001       prefixo MAT + 4 números           (funcionário)
 *   carga      CRG-2026-303   prefixo CRG + ano + sequência     (pesquisa de cargas)
 *
 * Princípios:
 *   - Formatação durante a digitação: o hífen é inserido automaticamente.
 *   - Colagem de código completo ou sem hífen é aceita e normalizada.
 *   - Valores fora do padrão NÃO são reescritos: a formatação devolve o texto como foi
 *     digitado e a validação recusa (para novos cadastros). Registros existentes não são alterados.
 *   - Comparação (duplicidade/busca) usa a chave: sem hífen, sem espaços e em maiúsculas.
 *
 * Expõe window.NexusCodigos.
 */
(function (global) {
  'use strict';

  function alnum(valor) {
    return String(valor == null ? '' : valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Chave de comparação: ignora hífens, espaços e caixa. */
  function chave(valor) {
    return alnum(valor);
  }

  // ---------- IMO (navio): IMO-1234567 ----------
  function formatarImo(bruto) {
    const up = alnum(bruto);
    if (up === '') return '';
    if (/^I(M(O)?)?$/.test(up)) return up;                      // prefixo em digitação
    if (/^IMO\d+$/.test(up)) return `IMO-${up.slice(3)}`;
    if (/^\d+$/.test(up)) return `IMO-${up}`;                   // só números: acrescenta o prefixo
    return String(bruto).trim();                                // fora do padrão: mantém como digitado
  }

  function validarImo(bruto) {
    const valor = formatarImo(bruto);
    const ok = /^IMO-\d{7}$/.test(valor);
    return { ok, valor, erro: ok ? null : 'O número IMO deve seguir o formato IMO-1234567 (prefixo IMO, hífen e 7 números).' };
  }

  // ---------- Contêiner: MSCU-1234567 ----------
  function formatarConteiner(bruto) {
    const up = alnum(bruto);
    if (up === '') return '';
    if (/^[A-Z]{1,4}$/.test(up)) return up;                     // letras em digitação
    const m = up.match(/^([A-Z]{4})(\d+)$/);
    if (m) return `${m[1]}-${m[2]}`;
    return String(bruto).trim();
  }

  function validarConteiner(bruto) {
    const valor = formatarConteiner(bruto);
    const ok = /^[A-Z]{4}-\d{7}$/.test(valor);
    return { ok, valor, erro: ok ? null : 'A identificação do contêiner deve seguir o formato MSCU-1234567 (4 letras, hífen e 7 números).' };
  }

  // ---------- Guindaste: ABC-123-DEF ----------
  function formatarGuindaste(bruto) {
    const up = alnum(bruto);
    if (up === '') return '';
    const m = up.match(/^([A-Z]{0,3})(\d{0,3})([A-Z]{0,3})$/);
    if (!m) return String(bruto).trim();
    const a = m[1];
    const d = m[2];
    const l = m[3];
    if (!d && l) return a + l;                                  // letras sem números: não insere hífen
    const partes = [];
    if (a) partes.push(a);
    if (d) partes.push(d);
    if (l) partes.push(l);
    return partes.join('-');
  }

  function validarGuindaste(bruto) {
    const valor = formatarGuindaste(bruto);
    const ok = /^[A-Z]{3}-\d{3}-[A-Z]{3}$/.test(valor);
    return { ok, valor, erro: ok ? null : 'A identificação do guindaste deve seguir o formato ABC-123-DEF (3 letras, 3 números e 3 letras).' };
  }

  // ---------- Matrícula de funcionário: MAT-2001 ----------
  // Matrículas já existentes fora do padrão (ex.: 888001) são aceitas como estão.
  function formatarMatricula(bruto) {
    const up = alnum(bruto);
    if (up === '') return '';
    if (/^M(A(T)?)?$/.test(up)) return up;
    const m = up.match(/^MAT(\d+)$/);
    if (m) return `MAT-${m[1]}`;
    return String(bruto).trim().toUpperCase();
  }

  function validarMatricula(bruto) {
    const valor = formatarMatricula(bruto);
    const padrao = /^MAT-\d{4}$/.test(valor);
    const legado = /^(MAT-)?\d+$/.test(valor);                  // matrícula legada já cadastrada
    const ok = padrao || legado;
    return { ok, valor, legado: ok && !padrao, erro: ok ? null : 'A matrícula deve seguir o formato MAT-2001 (prefixo MAT, hífen e 4 números).' };
  }

  // ---------- Código de carga (pesquisa): CRG-2026-303 ----------
  function formatarCarga(bruto) {
    const up = alnum(bruto);
    if (up === '') return '';
    if (/^C(R(G)?)?$/.test(up)) return up;
    const m = up.match(/^CRG(\d{4})(\d*)$/);
    if (m) return m[2] ? `CRG-${m[1]}-${m[2]}` : `CRG-${m[1]}`;
    return String(bruto).trim();
  }

  /**
   * Liga a formatação durante a digitação a um campo de texto.
   * Se o texto formatado for diferente, o campo é atualizado (o cursor vai para o fim,
   * que é o comportamento esperado na digitação normal).
   */
  function vincularFormatacao(campo, formatar) {
    if (!campo || campo.dataset.padronizado === '1') return;
    campo.dataset.padronizado = '1';
    campo.addEventListener('input', function () {
      const atual = campo.value;
      const novo = formatar(atual);
      if (novo !== atual) campo.value = novo;
    });
    campo.addEventListener('blur', function () {
      const atual = campo.value;
      const novo = formatar(atual);
      if (novo !== atual) campo.value = novo;
    });
  }

  global.NexusCodigos = {
    chave,
    formatarImo, validarImo,
    formatarConteiner, validarConteiner,
    formatarGuindaste, validarGuindaste,
    formatarMatricula, validarMatricula,
    formatarCarga,
    vincularFormatacao
  };
})(typeof window !== 'undefined' ? window : globalThis);
