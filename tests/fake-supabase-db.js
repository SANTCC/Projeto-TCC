/**
 * Dublê de banco Supabase (PostgREST) para testes de regras com estado persistido.
 * Aplica filtros reais (eq), update/upsert/select sobre arrays em memória, e registra
 * cada operação em `log` para verificação. Não substitui o Supabase real.
 */
function criarBancoFalso(tabelas, opcoes) {
  const log = [];
  // Configuração lida em tempo de execução (permite injetar falhas após o carregamento)
  const config = opcoes || {};

  function executar(tabela, op, filtros, payload, opts, retorno) {
    const rows = tabelas[tabela] || (tabelas[tabela] = []);
    const casa = (r) => filtros.every(([c, v]) => r[c] !== undefined && r[c] !== null && (v && v.__in ? v.__in.indexOf(String(r[c])) >= 0 : String(r[c]) === String(v)));
    const falhar = config.falhar || [];
    const falharOp = config.falharOp || {};
    if (falhar.indexOf(tabela) >= 0) {
      log.push({ tabela, op, falha: true });
      return { data: null, error: { message: 'falha simulada de conexão' } };
    }
    if ((falharOp[tabela] || []).indexOf(op) >= 0) {
      log.push({ tabela, op, falha: true });
      return { data: null, error: { message: 'falha simulada na operação ' + op } };
    }
    if (op === 'delete') {
      const removidas = rows.filter(casa);
      removidas.forEach((r) => rows.splice(rows.indexOf(r), 1));
      log.push({ tabela, op, filtros, afetadas: removidas.length });
      return { data: null, error: null };
    }
    if (op === 'select') {
      return { data: rows.filter(casa).map((r) => Object.assign({}, r)), error: null };
    }
    if (op === 'update') {
      const alvo = rows.filter(casa);
      alvo.forEach((r) => Object.assign(r, payload));
      log.push({ tabela, op, payload, filtros, afetadas: alvo.length });
      return { data: retorno ? alvo.map((r) => Object.assign({}, r)) : null, error: null };
    }
    if (op === 'upsert') {
      const lista = Array.isArray(payload) ? payload : [payload];
      const chave = (opts && opts.onConflict) || 'id';
      lista.forEach((p) => {
        const existente = rows.find((r) => r[chave] === p[chave]);
        if (existente) {
          if (!(opts && opts.ignoreDuplicates)) Object.assign(existente, p);
        } else {
          rows.push(Object.assign({}, p));
        }
      });
      log.push({ tabela, op, payload: lista, opts });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  function construir(tabela) {
    const estado = { op: 'select', filtros: [], payload: null, opts: null, retorno: false };
    const b = {
      select() { estado.retorno = true; return b; },
      order() { return b; },
      limit() { return b; },
      ilike() { return b; },
      or() { return b; },
      maybeSingle() { return b; },
      single() { return b; },
      eq(c, v) { estado.filtros.push([c, v]); return b; },
      in(c, valores) { estado.filtros.push([c, { __in: (valores || []).map(String) }]); return b; },
      update(p) { estado.op = 'update'; estado.payload = p; return b; },
      upsert(p, o) { estado.op = 'upsert'; estado.payload = p; estado.opts = o || null; return b; },
      insert(p) { estado.op = 'upsert'; estado.payload = p; estado.opts = null; return b; },
      delete() { estado.op = 'delete'; return b; },
      then(res, rej) {
        return Promise.resolve(executar(tabela, estado.op, estado.filtros, estado.payload, estado.opts, estado.retorno)).then(res, rej);
      }
    };
    return b;
  }

  return {
    from: (t) => construir(t),
    channel: () => ({ on() { return this; }, subscribe() { return {}; } }),
    log,
    tabelas,
    config
  };
}

module.exports = { criarBancoFalso };
