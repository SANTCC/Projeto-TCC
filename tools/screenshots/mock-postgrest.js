/**
 * POSTGREST SIMULADO PARA AS CAPTURAS — NexusPort.
 *
 * As telas do NexusPort conversam com o Supabase pela API REST do PostgREST
 * (`@supabase/supabase-js`). Como as capturas de tela rodam em um ambiente sem
 * acesso ao Supabase, este módulo oferece um servidor HTTP que responde no mesmo
 * formato para o subconjunto de recursos que o front-end usa:
 *
 *   GET    /rest/v1/<tabela>?select=...&<filtros>&order=...&limit=...
 *   POST   /rest/v1/<tabela>            (insert / upsert — Prefer: resolution=merge-duplicates)
 *   PATCH  /rest/v1/<tabela>?<filtros>  (update)
 *   DELETE /rest/v1/<tabela>?<filtros>  (delete)
 *
 * Recursos implementados (todos usados por js/**, cf. grep de `.select(`):
 *   - projeção de colunas e `select(*)`;
 *   - recursos embutidos (joins) em um e dois níveis, inclusive com apelido:
 *       `select=*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))`
 *       `select=*, supervisor:supervisor_titular_id(nome, matricula)`
 *   - filtros eq, neq, gt, gte, lt, lte, like, ilike, in, is, `not.*` e grupos `or=(...)`;
 *   - `order=col.asc/desc`, `limit`, `offset`, `Range` (usado por `.range()`);
 *   - contagem exata (`Prefer: count=exact` → cabeçalho `Content-Range`);
 *   - `.single()`/`.maybeSingle()` (Accept: application/vnd.pgrst.object+json);
 *   - `Prefer: return=representation|minimal` nas escritas.
 *
 * O que não é implementado (e não é usado nas telas): RPC, RLS, políticas,
 * validações de tipo, triggers e Realtime. As conexões de Realtime caem no
 * fallback de polling já previsto no app.
 */
'use strict';

const http = require('http');
const { criarTabelas } = require('./demo-data');

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

/** Plural → singular, usado para inferir chaves estrangeiras nos joins. */
const SINGULAR_ESPECIAL = {
  tipos_carga: 'tipo_carga',
  logs_alteracoes: 'log_alteracao',
  trail_decisoes: 'trail_decisao',
  retificacoes_trail: 'retificacao_trail',
  leituras_qr_code: 'leitura_qr_code',
  cargo_niveis: 'cargo_nivel',
  delegacoes_supervisor: 'delegacao_supervisor',
  estivador_cargas: 'estivador_carga',
  historico_manutencoes: 'historico_manutencao',
  rotas_maritimas: 'rota_maritima',
  inspecao_itens: 'inspecao_item',
  checklist_itens: 'checklist_item',
  checklist_modelos: 'checklist_modelo',
  panic_webhook_config: 'panic_webhook_config'
};

function singular(nome) {
  if (SINGULAR_ESPECIAL[nome]) return SINGULAR_ESPECIAL[nome];
  return nome
    .split('_')
    .map((parte) => {
      if (!parte.endsWith('s')) return parte;
      if (parte.endsWith('oes')) return `${parte.slice(0, -3)}ao`;
      if (parte.endsWith('ais')) return `${parte.slice(0, -3)}al`;
      if (parte.endsWith('eis')) return `${parte.slice(0, -3)}el`;
      if (parte.endsWith('ns')) return parte.slice(0, -1);
      return parte.slice(0, -1);
    })
    .join('_');
}

// ---------------------------------------------------------------------------
// Comparações e filtros
// ---------------------------------------------------------------------------
function paraNumero(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Compara dois valores respeitando tipo (número, data ISO, booleano, texto). */
function comparar(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const na = paraNumero(a);
  const nb = paraNumero(b);
  if (na !== null && nb !== null && typeof a !== 'boolean' && typeof b !== 'boolean') {
    return na === nb ? 0 : (na < nb ? -1 : 1);
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const da = Date.parse(a);
    const db = Date.parse(b);
    const pareceData = (s) => /^\d{4}-\d{2}-\d{2}/.test(s);
    if (pareceData(a) && pareceData(b) && !Number.isNaN(da) && !Number.isNaN(db)) {
      return da === db ? 0 : (da < db ? -1 : 1);
    }
  }
  return String(a) === String(b) ? 0 : (String(a) < String(b) ? -1 : 1);
}

/** Valor textual do filtro: `*` vira `%` em like/ilike; listas `(a,b,c)` viram array. */
function analisarValor(operador, bruto) {
  if (operador === 'in') {
    const interno = bruto.replace(/^\(/, '').replace(/\)$/, '');
    if (interno.trim() === '') return [];
    return interno.split(',').map((v) => desescapar(v.trim()));
  }
  if (bruto === 'null') return null;
  if (bruto === 'true') return true;
  if (bruto === 'false') return false;
  return desescapar(bruto);
}

/** Remove aspas do PostgREST (`"valor com vírgula"`). */
function desescapar(valor) {
  if (valor.startsWith('"') && valor.endsWith('"')) return valor.slice(1, -1);
  return valor;
}

function pareceValor(_operador, valor) {
  return valor;
}

function combina(linha, expressao) {
  // expressao: { coluna, operador, valor, negado }
  const { coluna, operador, valor, negado } = expressao;
  const atual = linha[coluna];
  let ok;

  switch (operador) {
    case 'eq': ok = comparar(atual, valor) === 0; break;
    case 'neq': ok = comparar(atual, valor) !== 0; break;
    case 'gt': ok = comparar(atual, valor) > 0; break;
    case 'gte': ok = comparar(atual, valor) >= 0; break;
    case 'lt': ok = comparar(atual, valor) < 0; break;
    case 'lte': ok = comparar(atual, valor) <= 0; break;
    case 'like':
    case 'ilike': {
      const padrao = String(valor).replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '%' ? '%' : c === '_' ? '_' : `\\${c}`));
      const regex = new RegExp(`^${padrao.replace(/%/g, '.*').replace(/_/g, '.')}$`, operador === 'ilike' ? 'i' : '');
      ok = atual !== null && atual !== undefined && regex.test(String(atual));
      break;
    }
    case 'in': ok = (valor || []).some((v) => comparar(atual, v) === 0); break;
    case 'is':
      if (valor === null) ok = atual === null || atual === undefined;
      else if (typeof valor === 'boolean') ok = atual === valor || String(atual) === String(valor);
      else ok = String(atual) === String(valor);
      break;
    default: ok = true;
  }

  return negado ? !ok : pareceValor(operador, ok);
}

/**
 * Extrai as condições de um grupo `or=(a.eq.1,b.eq.2)` / `and=(...)`.
 * Suporta um nível de aninhamento, suficiente para as consultas do app.
 */
function analisarGrupo(texto) {
  const termos = [];
  let profundidade = 0;
  let atual = '';
  for (const ch of texto) {
    if (ch === '(') profundidade += 1;
    if (ch === ')') profundidade -= 1;
    if (ch === ',' && profundidade === 0) {
      termos.push(atual);
      atual = '';
      continue;
    }
    atual += ch;
  }
  if (atual) termos.push(atual);

  return termos.map((termo) => {
    const partes = termo.split('.');
    return {
      coluna: partes[0],
      negado: partes[1] === 'not',
      operador: partes[1] === 'not' ? partes[2] : partes[1],
      valor: analisarValor(partes[1] === 'not' ? partes[2] : partes[1], partes.slice(partes[1] === 'not' ? 3 : 2).join('.'))
    };
  });
}

/** Constrói o predicado a partir dos parâmetros da query string. */
function montarPredicado(params) {
  const condicoes = [];
  params.forEach((valor, chave) => {
    if (RESERVADOS.has(chave)) return;

    if (chave === 'or' || chave === 'and') {
      const interno = valor.replace(/^\(/, '').replace(/\)$/, '');
      const partes = analisarGrupo(interno);
      condicoes.push((linha) => (chave === 'or'
        ? partes.some((p) => combina(linha, p))
        : partes.every((p) => combina(linha, p))));
      return;
    }

    const pedacos = String(valor).split('.');
    const negado = pedacos[0] === 'not';
    const operador = negado ? pedacos[1] : pedacos[0];
    const resto = pedacos.slice(negado ? 2 : 1).join('.');
    const expressao = { coluna: chave, operador, valor: analisarValor(operador, resto), negado };
    condicoes.push((linha) => combina(linha, expressao));
  });

  return (linha) => condicoes.every((c) => c(linha));
}

function ordenar(linhas, ordem) {
  if (!ordem) return linhas;
  const criterios = ordem.split(',').map((trecho) => {
    const [coluna, direcao, nulos] = trecho.split('.');
    return { coluna, desc: (direcao || 'asc').toLowerCase() === 'desc', nulosFirst: (nulos || '').toLowerCase() === 'nullsfirst' };
  });

  return linhas.slice().sort((a, b) => {
    for (const c of criterios) {
      const va = a[c.coluna];
      const vb = b[c.coluna];
      const nuloA = va === null || va === undefined;
      const nuloB = vb === null || vb === undefined;
      if (nuloA || nuloB) {
        if (nuloA && nuloB) continue;
        const primeiro = c.nulosFirst ? nuloA : !nuloA;
        return (primeiro ? -1 : 1) * (c.desc ? -1 : 1);
      }
      const resultado = comparar(va, vb);
      if (resultado !== 0) return c.desc ? -resultado : resultado;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Projeção e recursos embutidos (joins)
// ---------------------------------------------------------------------------
/** Divide `a, b(c, d), e` em itens de primeiro nível. */
function separarItens(texto) {
  const itens = [];
  let profundidade = 0;
  let atual = '';
  for (const ch of texto) {
    if (ch === '(') profundidade += 1;
    if (ch === ')') profundidade -= 1;
    if (ch === ',' && profundidade === 0) {
      itens.push(atual.trim());
      atual = '';
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) itens.push(atual.trim());
  return itens;
}

/**
 * Converte `select` em uma árvore: [{ coluna, apelido, filhos, embutido }].
 * `embutido` marca os recursos com parênteses (join); `filhos === null` dentro de
 * um recurso embutido significa `(*)` — todas as colunas da tabela filha.
 */
function analisarSelect(texto) {
  if (!texto || texto.trim() === '' || texto.trim() === '*') return null;
  return separarItens(texto).map((item) => {
    const abreParentese = item.indexOf('(');
    if (abreParentese === -1) {
      const [apelido, nome] = item.includes(':') ? item.split(':') : [null, item];
      return { apelido: apelido || nome, coluna: nome, filhos: null, embutido: false };
    }
    const cabecalho = item.slice(0, abreParentese);
    const corpo = item.slice(abreParentese + 1, item.lastIndexOf(')'));
    const [apelido, nome] = cabecalho.includes(':') ? cabecalho.split(':') : [null, cabecalho];
    const alvo = nome.replace(/!(inner|left)$/, '');
    return { apelido: apelido || alvo, coluna: alvo, filhos: analisarSelect(corpo), embutido: true };
  });
}

/** Índice global `id → tabela`, usado para resolver apelidos de FK. */
function indexarIds(tabelas) {
  const indice = new Map();
  Object.entries(tabelas).forEach(([nome, linhas]) => {
    linhas.forEach((linha) => {
      if (linha && typeof linha.id === 'string') indice.set(linha.id, nome);
    });
  });
  return indice;
}

/** Colunas presentes nas linhas de uma tabela. */
function colunasDe(tabelas, nome) {
  const linhas = tabelas[nome] || [];
  const colunas = new Set();
  linhas.forEach((linha) => Object.keys(linha).forEach((c) => colunas.add(c)));
  return colunas;
}

/**
 * Resolve o vínculo de um recurso embutido e devolve as linhas ligadas.
 * @returns {{ linhas: Array, unico: boolean }}
 */
function resolverVinculo(tabelas, indiceIds, tabelaPai, linha, item, dicaColuna) {
  // (a) apelido de coluna: `supervisor:supervisor_titular_id(...)`
  const colunaDica = dicaColuna && !tabelas[dicaColuna] ? dicaColuna : null;

  // (b) tabela filha informada explicitamente
  const tabelaFilha = tabelas[item.coluna] ? item.coluna : null;

  const alvo = tabelaFilha || (colunaDica ? indiceIds.get(linha[colunaDica]) : null);
  if (!alvo) return { linhas: [], unico: false };

  const candidatos = tabelas[alvo];

  // Chave estrangeira no PAI (relação N:1 → objeto)
  const colunasPai = Object.keys(linha);
  const nomeFk = `${singular(alvo)}_id`;
  if (colunaDica) {
    return { linhas: candidatos.filter((c) => c.id === linha[colunaDica]), unico: true };
  }
  if (colunasPai.includes(nomeFk)) {
    return { linhas: candidatos.filter((c) => c.id === linha[nomeFk]), unico: true };
  }
  // Qualquer coluna do pai terminando em _id cujo valor aponte para a tabela filha
  for (const coluna of colunasPai) {
    if (!coluna.endsWith('_id') || coluna === 'id') continue;
    const valor = linha[coluna];
    if (valor && candidatos.some((c) => c.id === valor)) {
      return { linhas: candidatos.filter((c) => c.id === valor), unico: true };
    }
  }

  // Chave estrangeira na FILHA (relação 1:N → lista)
  const nomeFkFilha = `${singular(tabelaPai)}_id`;
  const colunasFilha = colunasDe(tabelas, alvo);
  if (colunasFilha.has(nomeFkFilha)) {
    return { linhas: candidatos.filter((c) => c[nomeFkFilha] === linha.id), unico: false };
  }
  for (const coluna of colunasFilha) {
    if (!coluna.endsWith('_id') || coluna === 'id') continue;
    const ligadas = candidatos.filter((c) => c[coluna] === linha.id);
    if (ligadas.length) return { linhas: ligadas, unico: false };
  }

  return { linhas: [], unico: false };
}

/** Aplica a projeção (e os embutidos) a uma linha. */
function projetar(tabelas, indiceIds, tabelaPai, linha, arvore) {
  if (!arvore) return { ...linha };

  const saida = {};
  arvore.forEach((item) => {
    if (item.embutido) {
      const { linhas, unico } = resolverVinculo(tabelas, indiceIds, tabelaPai, linha, item, item.coluna);
      const projetadas = linhas.map((l) => projetar(tabelas, indiceIds, tabelas[item.coluna] ? item.coluna : tabelaPai, l, item.filhos));
      saida[item.apelido] = unico ? (projetadas[0] || null) : projetadas;
      return;
    }
    if (item.coluna === '*') {
      Object.assign(saida, linha);
      return;
    }
    saida[item.apelido] = linha[item.coluna] === undefined ? null : linha[item.coluna];
  });
  return saida;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
function resposta(res, status, corpo, cabecalhos) {
  const headers = Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Location',
      'Content-Type': 'application/json; charset=utf-8'
    },
    cabecalhos || {}
  );
  const texto = corpo === null || corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(status, headers);
  res.end(res.req.method === 'HEAD' ? undefined : texto);
}

function erroPostgrest(res, status, code, message, details) {
  resposta(res, status, { code, message, details: details || null, hint: null });
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      const texto = Buffer.concat(pedacos).toString('utf-8');
      if (!texto) return resolve(null);
      try {
        resolve(JSON.parse(texto));
      } catch (e) {
        resolve(null);
      }
    });
  });
}

/**
 * Sobe o servidor simulado.
 * @param {{porta?: number, tabelas?: object}} opcoes
 * @returns {Promise<{url: string, porta: number, tabelas: object, fechar: Function}>}
 */
function iniciarPostgrestDemo(opcoes = {}) {
  const tabelas = opcoes.tabelas || criarTabelas();
  let indiceIds = indexarIds(tabelas);

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const partes = url.pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') return resposta(res, 204, null);

    // Supabase Auth e Storage não são usados pelo login (código individual próprio).
    if (partes[0] === 'auth' || partes[0] === 'storage' || partes[0] === 'functions') {
      return resposta(res, 200, {});
    }

    if (partes[0] !== 'rest' || partes[1] !== 'v1') {
      return resposta(res, 404, { message: 'Not found' });
    }

    const nomeTabela = partes[2];
    const linhas = tabelas[nomeTabela];
    if (!linhas) {
      return erroPostgrest(
        res,
        404,
        'PGRST205',
        `Could not find the table 'public.${nomeTabela}' in the schema cache`
      );
    }

    const params = url.searchParams;
    const cabecalhos = req.headers;
    const prefer = String(cabecalhos.prefer || '');
    const querContagem = /count=(exact|planned|estimated)/.test(prefer);
    const representacao = /return=representation/.test(prefer);
    const objetoUnico = String(cabecalhos.accept || '').includes('application/vnd.pgrst.object+json');

    try {
      // ---------------------------------------------------------------- GET
      if (req.method === 'GET' || req.method === 'HEAD') {
        const predicado = montarPredicado(params);
        let resultado = linhas.filter(predicado);
        if (querContagem && /count=exact/.test(prefer)) {
          // total antes de limit/offset, informado no Content-Range
        }
        const total = resultado.length;
        resultado = ordenar(resultado, params.get('order'));

        const limite = params.get('limit') !== null ? Number(params.get('limit')) : null;
        const deslocamento = params.get('offset') !== null ? Number(params.get('offset')) : 0;
        if (deslocamento) resultado = resultado.slice(deslocamento);
        if (limite !== null && !Number.isNaN(limite)) resultado = resultado.slice(0, limite);

        const arvore = analisarSelect(params.get('select'));
        const projetadas = resultado.map((l) => projetar(tabelas, indiceIds, nomeTabela, l, arvore));

        const cabecalhosSaida = {};
        if (querContagem) {
          const inicio = projetadas.length ? deslocamento : 0;
          const fim = projetadas.length ? deslocamento + projetadas.length - 1 : 0;
          cabecalhosSaida['Content-Range'] = `${inicio}-${fim}/${total}`;
        }

        if (objetoUnico) {
          if (projetadas.length !== 1) {
            return erroPostgrest(
              res,
              406,
              'PGRST116',
              'JSON object requested, multiple (or no) rows returned',
              `The result contains ${projetadas.length} rows`
            );
          }
          return resposta(res, 200, projetadas[0], cabecalhosSaida);
        }
        return resposta(res, 200, projetadas, cabecalhosSaida);
      }

      // -------------------------------------------------- POST / PATCH / DELETE
      const corpo = await lerCorpo(req);
      const predicado = montarPredicado(params);

      if (req.method === 'POST' || req.method === 'PUT') {
        const novos = Array.isArray(corpo) ? corpo : [corpo];
        const inseridos = [];
        const upsert = /resolution=merge-duplicates/.test(prefer);
        const colunasConflito = (params.get('on_conflict') || 'id').split(',').map((c) => c.trim());

        novos.forEach((registro) => {
          if (!registro) return;
          if (upsert) {
            const existente = linhas.find((l) => colunasConflito.every((c) => l[c] === registro[c]));
            if (existente) {
              Object.assign(existente, registro);
              inseridos.push(existente);
              return;
            }
          }
          const linha = { id: registro.id || require('crypto').randomUUID(), ...registro };
          linhas.push(linha);
          inseridos.push(linha);
        });
        indiceIds = indexarIds(tabelas);

        if (objetoUnico && inseridos.length === 1) {
          return resposta(res, 201, inseridos.length ? representacao || objetoUnico ? inseridos[0] : null : null);
        }
        if (!representacao && !objetoUnico) return resposta(res, 201, null);
        return resposta(res, 201, inseridos);
      }

      if (req.method === 'PATCH') {
        const alvos = linhas.filter(predicado);
        alvos.forEach((l) => Object.assign(l, corpo || {}));
        if (!representacao) return resposta(res, 204, null, { 'Content-Range': `0-${Math.max(alvos.length - 1, 0)}/${alvos.length}` });
        return resposta(res, 200, alvos, { 'Content-Range': `0-${Math.max(alvos.length - 1, 0)}/${alvos.length}` });
      }

      if (req.method === 'DELETE') {
        const remover = new Set(linhas.filter(predicado));
        const restantes = linhas.filter((l) => !remover.has(l));
        tabelas[nomeTabela] = restantes;
        indiceIds = indexarIds(tabelas);
        return resposta(res, 204, null, { 'Content-Range': `*/${remover.size}` });
      }

      return erroPostgrest(res, 405, 'PGRST102', 'Método não suportado pela simulação');
    } catch (erro) {
      return erroPostgrest(res, 500, 'PGRST000', erro.message);
    }
  });

  return new Promise((resolve) => {
    servidor.listen(opcoes.porta || 0, '127.0.0.1', () => {
      const porta = servidor.address().port;
      resolve({
        url: `http://127.0.0.1:${porta}`,
        porta,
        tabelas,
        fechar: () => new Promise((ok) => servidor.close(ok))
      });
    });
  });
}

module.exports = { iniciarPostgrestDemo, montarPredicado, analisarSelect, projetar, ordenar, singular };
