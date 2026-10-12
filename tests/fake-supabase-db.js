/**
 * Dublê de banco Supabase (PostgREST) para testes de regras com estado persistido.
 * Aplica filtros reais (eq), update/upsert/select/delete sobre arrays em memória, e
 * registra cada operação em `log` para verificação. Não substitui o Supabase real.
 *
 * Convenções que espelham o PostgREST (importantes para as exclusões):
 *   - `update`/`delete` só devolvem `data` quando a cadeia pede `.select()` antes de aguardar;
 *   - `delete().select()` devolve as LINHAS REMOVIDAS (array vazio = nada foi excluído);
 *   - `eq` não casa valor nulo; `insert` funciona como upsert por `id`;
 *   - `.range(inicio, fim)` fatia a resposta do `select` (leitura paginada do repositório);
 *   - `ilike` aplica o padrão LIKE real (`%`/`_`, sem diferenciar caixa) — um nome genérico
 *     como "Guindaste" NÃO casa "GND-01-STS";
 *   - `or('col.eq.v,col.ilike.%x%')` casa a linha se QUALQUER termo casar (eq/neq/ilike/like),
 *     como no PostgREST — um `.or()` ignorado esconderia busca que não filtra nada;
 *   - `single()`/`maybeSingle()` devolvem UM registro (objeto) ou `null`, como o PostgREST —
 *     devolver array aqui fazia `if (dupData)` acreditar em duplicidade inexistente;
 *   - `opcoes.deleteSemEfeito: ['tabela']` simula o banco aceitando o DELETE sem excluir
 *     linha nenhuma (RLS filtrando a linha ou registro já removido por outro operador).
 */
function criarBancoFalso(tabelas, opcoes) {
  const log = [];
  // Configuração lida em tempo de execução (permite injetar falhas após o carregamento)
  const config = opcoes || {};

  /** Compara uma linha com um filtro: igualdade (eq), lista (in) ou padrão (ilike). */
  function casaFiltro(linha, coluna, valor) {
    const atual = linha[coluna];
    if (atual === undefined || atual === null) return false;
    if (valor && valor.__in) return valor.__in.indexOf(String(atual)) >= 0;
    if (valor && valor.__like !== undefined) {
      // LIKE do PostgREST: `%` = qualquer sequência, `_` = um caractere, sem diferenciar caixa.
      const padrao = String(valor.__like)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '[\\s\\S]*')
        .replace(/_/g, '[\\s\\S]');
      return new RegExp('^' + padrao + '$', 'i').test(String(atual));
    }
    return String(atual) === String(valor);
  }

  /**
   * Filtro OR do PostgREST: "coluna.eq.valor,coluna.ilike.%valor%" — casa a linha se
   * qualquer termo casar. Operador desconhecido NÃO casa (nunca "casa tudo").
   */
  function casaLinhaOu(linha, expressao) {
    return String(expressao).split(',').some((termo) => {
      const partes = String(termo).split('.');
      const coluna = partes.shift();
      const operador = String(partes.shift() || 'eq').toLowerCase();
      const valor = partes.join('.');
      if (!coluna) return false;
      if (operador === 'eq') return casaFiltro(linha, coluna, valor);
      if (operador === 'neq') {
        const atual = linha[coluna];
        // SQL: comparação com NULL não casa (IS DISTINCT FROM não é o neq do PostgREST).
        return atual !== undefined && atual !== null && String(atual) !== String(valor);
      }
      if (operador === 'ilike' || operador === 'like') return casaFiltro(linha, coluna, { __like: valor });
      return false;
    });
  }

  function executar(tabela, op, filtros, payload, opts, retorno, faixa, umSo) {
    const rows = tabelas[tabela] || (tabelas[tabela] = []);
    const casa = (r) => filtros.every(([c, v]) => (
      v && v.__or !== undefined ? casaLinhaOu(r, v.__or) : casaFiltro(r, c, v)
    ));
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
      // `deleteSemEfeito` simula o banco aceitando o DELETE sem afetar linha nenhuma
      // (RLS filtrando a linha, registro já removido por outro operador).
      const semEfeito = (config.deleteSemEfeito || []).indexOf(tabela) >= 0;
      const removidas = semEfeito ? [] : rows.filter(casa);
      removidas.forEach((r) => rows.splice(rows.indexOf(r), 1));
      log.push({ tabela, op, filtros, afetadas: removidas.length });
      // PostgREST: com .select() o DELETE devolve as linhas removidas (array vazio = nada
      // foi excluído); sem .select() o corpo não é devolvido.
      return { data: retorno ? removidas.map((r) => Object.assign({}, r)) : null, error: null };
    }
    if (op === 'select') {
      let linhas = rows.filter(casa);
      // PostgREST devolve no máximo o intervalo pedido por `.range(inicio, fim)`
      // (a leitura paginada do repositório depende disso).
      if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
      // A leitura também entra no log: sem isso não há como conferir o filtro usado
      // (ex.: as grafias de matrícula consultadas na busca).
      log.push({ tabela, op, filtros, linhas: linhas.length });
      // `.single()`/`.maybeSingle()`: um registro ou null (sem registro), como no PostgREST.
      if (umSo) return { data: linhas.length ? Object.assign({}, linhas[0]) : null, error: null };
      return { data: linhas.map((r) => Object.assign({}, r)), error: null };
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
    const estado = { op: 'select', filtros: [], payload: null, opts: null, retorno: false, faixa: null, umSo: false };
    const b = {
      select() { estado.retorno = true; return b; },
      order() { return b; },
      range(inicio, fim) { estado.faixa = [Number(inicio) || 0, Number(fim) || 0]; estado.retorno = true; return b; },
      limit() { return b; },
      ilike(c, v) { estado.filtros.push([c, { __like: v }]); return b; },
      or(expressao) { estado.filtros.push([null, { __or: String(expressao == null ? '' : expressao) }]); return b; },
      maybeSingle() { estado.umSo = true; return b; },
      single() { estado.umSo = true; return b; },
      eq(c, v) { estado.filtros.push([c, v]); return b; },
      in(c, valores) { estado.filtros.push([c, { __in: (valores || []).map(String) }]); return b; },
      update(p) { estado.op = 'update'; estado.payload = p; return b; },
      upsert(p, o) { estado.op = 'upsert'; estado.payload = p; estado.opts = o || null; return b; },
      insert(p) { estado.op = 'upsert'; estado.payload = p; estado.opts = null; return b; },
      delete() { estado.op = 'delete'; return b; },
      then(res, rej) {
        return Promise.resolve(executar(tabela, estado.op, estado.filtros, estado.payload, estado.opts, estado.retorno, estado.faixa, estado.umSo)).then(res, rej);
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
