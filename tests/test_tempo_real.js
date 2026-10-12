#!/usr/bin/env node
/**
 * TESTE — TEMPO REAL E INDICADORES (Backlog 3, item J)
 * ------------------------------------------------------------
 * Cobre as correções do item J em páginas reais (jsdom) e em arquivos de configuração:
 *   1. Equipamentos em manutenção contam cada equipamento uma única vez (derivação).
 *   2. Leitura paginada: o PostgREST corta em 1000 linhas; nada pode ficar de fora.
 *   3. Realtime: assina todas as tabelas de REALTIME_TABLES e agrupa rajadas (debounce).
 *   4. Log de auditoria (Painel Geral): todas as linhas, responsável pelo cadastro,
 *      sem cair no nome da sessão ("meu perfil") nem em outro usuário.
 *   5. Produtividade (Relatórios): outros usuários aparecem com a contagem real.
 *   6. Migração de publicação: mesma lista de REALTIME_TABLES, idempotente, sem RLS.
 *   7. Sem intervalo de 5 s em Relatórios; contêiner em reforma grava EM_REFORMA;
 *      listeners de nexus_data_changed recarregam do Supabase.
 *
 * Uso:  node tests/test_tempo_real.js        (ou: npm run test:tempo-real)
 * Sem dados reais: o cliente Supabase é falso e em memória.
 */
const {
  read, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina, log
} = require('./webmcp-harness');

const janelasAbertas = [];

const iguais = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Espera uma condição no DOM/estado (a renderização das páginas é assíncrona). */
async function esperar(condicao, limiteMs) {
  const fim = Date.now() + (limiteMs || 3000);
  while (Date.now() < fim) {
    try { if (condicao()) return true; } catch (e) { /* ainda não pronto */ }
    await aguardar(20);
  }
  return false;
}

/**
 * Cliente Supabase falso, em memória, com recorte real: eq, in, range (paginação) e limit.
 * Ordem e colunas não são simuladas (não afetam os cenários). Registra cada range() pedido.
 * `opcoes.tabelasComErro`: tabelas que respondem erro.
 */
function clienteFalso(tabelas, opcoes) {
  const o = opcoes || {};
  const chamadasRange = [];
  const leituras = [];

  function executar(tabela, estado) {
    leituras.push({ tabela, escrita: Boolean(estado.escrita) });
    if (estado.escrita) return Promise.resolve({ data: null, error: null });
    if ((o.tabelasComErro || []).includes(tabela)) {
      return Promise.resolve({ data: null, error: { message: `falha simulada em ${tabela}` } });
    }
    let linhas = (tabelas[tabela] || []).slice();
    estado.filtros.forEach((filtro) => { linhas = linhas.filter(filtro); });
    if (estado.inicio !== null) {
      chamadasRange.push({ tabela, inicio: estado.inicio, fim: estado.fim });
      linhas = linhas.slice(estado.inicio, estado.fim + 1);
    }
    if (estado.limite !== null) linhas = linhas.slice(0, estado.limite);
    if (estado.single || estado.maybeSingle) {
      const primeira = linhas[0] || null;
      if (estado.single && !primeira) return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'não encontrado' } });
      return Promise.resolve({ data: primeira, error: null });
    }
    return Promise.resolve({ data: linhas.map((l) => Object.assign({}, l)), error: null });
  }

  function construir(tabela) {
    const estado = { filtros: [], inicio: null, fim: null, limite: null, single: false, maybeSingle: false, escrita: false };
    const consulta = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => executar(tabela, estado).then(res, rej);
        if (prop === 'catch') return (rej) => executar(tabela, estado).catch(rej);
        if (typeof prop !== 'string') return undefined;
        return (...args) => {
          switch (prop) {
            case 'eq': estado.filtros.push((l) => String(l[args[0]]) === String(args[1])); break;
            case 'in': estado.filtros.push((l) => args[1].map(String).includes(String(l[args[0]]))); break;
            case 'range': estado.inicio = args[0]; estado.fim = args[1]; break;
            case 'limit': estado.limite = args[0]; break;
            case 'single': estado.single = true; break;
            case 'maybeSingle': estado.maybeSingle = true; break;
            case 'insert': case 'update': case 'upsert': case 'delete': estado.escrita = true; break;
            default: break; // select, order, ilike... não mudam o recorte destes cenários
          }
          return consulta;
        };
      }
    });
    return consulta;
  }

  return { from: (tabela) => construir(tabela), chamadasRange, leituras };
}

/** Dados de auditoria: 1158 logs de 4 origens. Ana ocupa as primeiras 1050 posições. */
function dadosDeAuditoria(agora) {
  const funcionarios = [
    { id: 'f-ana', nome: 'Ana Estivadora', cargo: 'ESTIVADOR', codigo_individual: 'NX-ANA-1', matricula: '1001', ativo: true },
    { id: 'f-bruno', nome: 'Bruno Conferente', cargo: 'CONFERENTE_CARGA', codigo_individual: 'NX-BRU-2', matricula: '1002', ativo: true },
    { id: 'f-carla', nome: 'Carla Inspetora', cargo: 'INSPETOR', codigo_individual: 'NX-CAR-3', matricula: '1003', ativo: true }
  ];
  const logs = [];
  let seq = 0;
  const adicionar = (base, quantidade) => {
    for (let k = 0; k < quantidade; k++) {
      logs.push(Object.assign({
        id: 'log-' + String(seq).padStart(5, '0'),
        data_hora: new Date(agora - seq * 60000).toISOString(),
        tipo_alteracao: 'EDICAO',
        entidade_tipo: 'CARGA',
        entidade_id: 'carga-' + seq
      }, base));
      seq += 1;
    }
  };
  adicionar({ funcionario_id: 'f-ana', codigo_individual: 'NX-ANA-1' }, 1050);   // primeiras 1000+ linhas
  adicionar({ funcionario_id: null, codigo_individual: 'NX-BRU-2' }, 60);         // só o código: resolve por codigo_individual
  adicionar({ funcionario_id: 'f-carla', codigo_individual: null }, 40);          // só o id: resolve por funcionario_id
  adicionar({ funcionario_id: null, codigo_individual: 'NX-XYZ-9' }, 5);          // sem cadastro
  adicionar({ funcionario_id: null, codigo_individual: null }, 3);                // sem identificação
  return { funcionarios, logs, total: logs.length };
}

// ---------------------------------------------------------------------------
// 1. Derivação de equipamentos em manutenção
// ---------------------------------------------------------------------------
async function testarDerivacao() {
  log('\n1. Equipamentos em manutenção: cada equipamento conta uma única vez');
  const { w } = criarJanela({ scripts: ['js/data-repository.js'] });
  janelasAbertas.push(w);
  const R = w.NexusRepository;
  const navios = [
    { id: 'n1', nome: 'MV A', estado_operacional: 'AGENDADO_PARA_REFORMA' },
    { id: 'n2', nome: 'MV B', estado_operacional: 'OPERANTE' }
  ];
  const casos = [
    ['vazio não conta nada', [], [], 0],
    ['estado de reforma sem OS (resíduo) não conta', [navios[0]], [], 0],
    ['OS ativa + estado do mesmo navio = 1', [navios[0]], [{ id: 'o1', status: 'SOLICITADA', navio_id: 'n1', descricao: 'x' }], 1],
    ['duas OS do mesmo navio = 1', navios, [{ id: 'o1', status: 'SOLICITADA', navio_id: 'n1' }, { id: 'o2', status: 'APROVADA', navio_id: 'n1' }], 1],
    ['OS concluída ou recusada não conta', [], [{ id: 'o1', status: 'CONCLUIDA', navio_id: 'n1' }, { id: 'o2', status: 'RECUSADA', navio_id: 'n2' }], 0],
    ['OS legada casada por nome = 1 (com estado)', [navios[0]], [{ id: 'OS-NAVIO-1', status: 'SOLICITADA', descricao: '[GERAL] Navio: MV A - revisão' }], 1],
    ['OS legada sem navio no cache = 1 pelo nome', [], [{ id: 'OS-NAVIO-2', status: 'APROVADA', descricao: '[GERAL] Navio: MV Z - revisão' }], 1],
    ['OS de contêiner e de guindaste = 2', [], [{ id: 'a', status: 'APROVADA', container_id: 'c1' }, { id: 'b', status: 'SOLICITADA', guindaste_id: 'g1' }], 2],
    ['OS sem vínculo = 1 por OS', [], [{ id: 'x', status: 'SOLICITADA', descricao: 'sem vínculo' }], 1]
  ];
  for (const [rotulo, listaNavios, os, esperado] of casos) {
    const r = R.derivarEquipamentosEmManutencao(listaNavios, os);
    check(`derivação: ${rotulo}`, r.total === esperado, `total=${r.total}, esperado=${esperado}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Leitura paginada
// ---------------------------------------------------------------------------
async function testarPaginacao() {
  log('\n2. Leitura paginada (PostgREST devolve no máximo 1000 linhas por resposta)');
  const { w } = criarJanela({ scripts: ['js/supabase-client.js', 'js/data-repository.js'] });
  janelasAbertas.push(w);
  const linhas = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1 }));
  const cli = clienteFalso({ logs_alteracoes: linhas });
  const montar = () => cli.from('logs_alteracoes').select('*').order('id');

  const lidas = await w.NexusSupabaseUtils.lerTodasAsLinhas(montar);
  check('NexusSupabaseUtils lê as 1234 linhas', lidas.length === 1234, lidas.length);
  check('a última linha lida é a 1234 (nenhuma cortada no limite de 1000)', lidas[lidas.length - 1].id === 1234);
  check('duas páginas pedidas: 0–999 e 1000–1999',
    cli.chamadasRange.length === 2 && cli.chamadasRange[0].inicio === 0 && cli.chamadasRange[0].fim === 999 && cli.chamadasRange[1].inicio === 1000,
    JSON.stringify(cli.chamadasRange));

  const viaRepositorio = await w.NexusRepository.lerTodasAsLinhas(montar);
  check('NexusRepository.lerTodasAsLinhas delega à mesma paginação', viaRepositorio.length === 1234);

  const cliExato = clienteFalso({ logs_alteracoes: Array.from({ length: 1000 }, (_, i) => ({ id: i })) });
  const exatas = await w.NexusSupabaseUtils.lerTodasAsLinhas(() => cliExato.from('logs_alteracoes').select('*'));
  check('exatamente 1000 linhas: 1000 lidas e uma página extra vazia encerra', exatas.length === 1000 && cliExato.chamadasRange.length === 2);

  const cliErro = clienteFalso({ logs_alteracoes: linhas }, { tabelasComErro: ['logs_alteracoes'] });
  let erroPropagado = false;
  try { await w.NexusSupabaseUtils.lerTodasAsLinhas(() => cliErro.from('logs_alteracoes').select('*')); } catch (e) { erroPropagado = true; }
  check('erro do banco é propagado (a tela cai no cache, não mostra lista parcial)', erroPropagado);
}

// ---------------------------------------------------------------------------
// 3. Realtime
// ---------------------------------------------------------------------------
async function testarRealtime() {
  log('\n3. Realtime: assinaturas e agrupamento de rajadas');
  const canais = [];
  const cliente = {
    from() { throw new Error('não usado nesta verificação'); },
    channel(nome) {
      const canal = {
        nome,
        filtros: [],
        on(tipo, filtro, cb) { this.filtros.push(Object.assign({ tipo }, filtro, { cb })); return this; },
        subscribe() { return this; }
      };
      canais.push(canal);
      return canal;
    },
    removeChannel() {}
  };
  const { w } = criarJanela({
    scripts: ['js/supabase-client.js', (win) => { win.nexusSupabase = cliente; }, 'js/data-repository.js']
  });
  janelasAbertas.push(w);
  const R = w.NexusRepository;

  check('um único canal Realtime é criado ao carregar o repositório', canais.length === 1, canais.length);
  const assinados = (canais[0] && canais[0].filtros) || [];
  check('assina exatamente as tabelas de REALTIME_TABLES',
    iguais(assinados.map((f) => f.table), R.REALTIME_TABLES), `${assinados.length} assinaturas`);
  check('todas as assinaturas são postgres_changes, schema public, evento *',
    assinados.length > 0 && assinados.every((f) => f.tipo === 'postgres_changes' && f.schema === 'public' && f.event === '*'));

  let eventos = 0;
  w.addEventListener('nexus_data_changed', () => { eventos += 1; });
  const cb = assinados[0].cb;
  cb({}); cb({}); cb({});
  await aguardar(550);
  check('rajada de três mudanças vira UMA notificação nexus_data_changed (debounce)', eventos === 1, eventos);

  check('polling de segurança = 60 s (Realtime é o mecanismo principal)', R.POLLING_SEGURANCA_MS === 60000, R.POLLING_SEGURANCA_MS);
}

// ---------------------------------------------------------------------------
// 4. Log de auditoria no Painel Geral (página real)
// ---------------------------------------------------------------------------
async function testarPainelAuditoria() {
  log('\n4. Painel Geral: log de auditoria completo e com responsável correto');
  const dados = dadosDeAuditoria(Date.now());
  const cli = clienteFalso({ funcionarios: dados.funcionarios, logs_alteracoes: dados.logs });
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { nome: 'Diretora Sessão', codigo_individual: 'NX-SES-0', id: 'f-sessao' }),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js',
      'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js',
      (win) => { win.nexusSupabase = cli; },
      'js/data-repository.js', 'js/pages/dashboard.js'
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);

  const tbody = () => w.document.getElementById('auditLogTableBody');
  const contador = () => (w.document.getElementById('auditLogCounter') || {}).textContent || '';
  const linhas = () => (tbody() ? Array.from(tbody().querySelectorAll('tr')) : []);
  const pronto = await esperar(() => linhas().length === dados.total, 5000);
  check(`painel mostra TODAS as ${dados.total} linhas (não só as 1000 primeiras)`, pronto, `${linhas().length} linhas`);
  check('contador informa "Exibindo 1158 de 1158"', contador().includes(`${dados.total} de ${dados.total}`), contador());

  const nomeDaLinha = (tr) => (tr.querySelectorAll('td')[1] || {}).textContent || '';
  const nomes = linhas().map(nomeDaLinha);
  const contar = (n) => nomes.filter((x) => x.trim() === n).length;
  check('Ana (cadastro pelo funcionario_id) aparece em 1050 linhas', contar('Ana Estivadora') === 1050, contar('Ana Estivadora'));
  check('Bruno (só codigo_individual gravado no log) é resolvido: 60 linhas', contar('Bruno Conferente') === 60, contar('Bruno Conferente'));
  check('Carla (só funcionario_id gravado no log) é resolvida: 40 linhas', contar('Carla Inspetora') === 40, contar('Carla Inspetora'));
  check('código sem cadastro aparece como "Sem cadastro (código)"', contar('Sem cadastro (NX-XYZ-9)') === 5, contar('Sem cadastro (NX-XYZ-9)'));
  check('log sem identificação aparece como "Não identificado"', contar('Não identificado') === 3, contar('Não identificado'));
  check('nome da sessão ("Diretora Sessão") NÃO aparece como responsável de outros logs',
    !nomes.some((x) => x.includes('Diretora Sessão')));
}

// ---------------------------------------------------------------------------
// 5. Produtividade em Relatórios (página real)
// ---------------------------------------------------------------------------
async function testarProdutividade() {
  log('\n5. Relatórios: produtividade de TODOS os usuários (leitura paginada)');
  const dados = dadosDeAuditoria(Date.now());
  const cli = clienteFalso({ funcionarios: dados.funcionarios, logs_alteracoes: dados.logs });
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    html: htmlDaPagina('relatorios.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { nome: 'Diretora Sessão', codigo_individual: 'NX-SES-0', id: 'f-sessao' }),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js',
      'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js',
      (win) => { win.nexusSupabase = cli; },
      'js/data-repository.js', 'js/pages/relatorios.js'
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);

  const corpo = w.document.getElementById('produtividadeTableBody');
  const linhaDe = (nome) => Array.from((corpo && corpo.querySelectorAll('tr')) || [])
    .find((tr) => (tr.querySelectorAll('td')[1] || {}).textContent === nome);
  const volumeDe = (nome) => {
    const tr = linhaDe(nome);
    return tr ? (tr.querySelectorAll('td')[3] || {}).textContent.trim() : null;
  };
  const pronto = await esperar(() => Boolean(linhaDe('Bruno Conferente')), 5000);
  check('tabela de produtividade mostra os três funcionários ativos', pronto && linhaDe('Ana Estivadora') && linhaDe('Carla Inspetora'));
  check('Ana: 1050 operações', volumeDe('Ana Estivadora') === '1050 Operação(ões) Registrada(s)', volumeDe('Ana Estivadora'));
  check('Bruno (fora da primeira página) NÃO aparece com 0: 60 operações',
    volumeDe('Bruno Conferente') === '60 Operação(ões) Registrada(s)', volumeDe('Bruno Conferente'));
  check('Carla (fora da primeira página) com 40 operações',
    volumeDe('Carla Inspetora') === '40 Operação(ões) Registrada(s)', volumeDe('Carla Inspetora'));
  const logsLidos = cli.chamadasRange.filter((r) => r.tabela === 'logs_alteracoes');
  check('logs de produtividade lidos em páginas (≥ 2 range() para 1158 linhas)', logsLidos.length >= 2, logsLidos.length);
}

// ---------------------------------------------------------------------------
// 6–7. Configuração, migração e código-fonte
// ---------------------------------------------------------------------------
function testarConfiguracao() {
  log('\n6. Migração de publicação e configuração');
  const migracao = read('supabase/migrations/20261009000000_realtime_publication.sql');
  const sqlSemComentarios = migracao.replace(/--.*$/gm, '');
  const dataRepo = read('js/data-repository.js');
  const listaApp = [...dataRepo.match(/REALTIME_TABLES:\s*\[([\s\S]*?)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const bloco = sqlSemComentarios.match(/tabelas_tempo_real text\[\] := array\[([\s\S]*?)\];/);
  const listaSql = bloco ? [...bloco[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];

  check('migração publica exatamente as tabelas de REALTIME_TABLES (mesmo conjunto, sem duplicata)',
    listaSql.length > 0 && iguais(listaApp, listaSql) && new Set(listaSql).size === listaSql.length,
    `app=${listaApp.length} sql=${listaSql.length}`);
  check('migração adiciona à publicação supabase_realtime', /alter publication supabase_realtime add table/.test(sqlSemComentarios));
  check('migração é idempotente (checa pg_publication_tables antes de adicionar)', /pg_publication_tables/.test(sqlSemComentarios) && /not exists/i.test(sqlSemComentarios));
  check('migração ignora tabela inexistente (to_regclass) em vez de abortar', /to_regclass/.test(sqlSemComentarios));
  check('migração não altera RLS, políticas nem dados',
    !/row level security|create policy|drop policy|insert into|delete from|update\s+public/i.test(sqlSemComentarios));

  const schema = read('SPECs/schema.sql');
  const enumContainer = (schema.match(/create type estado_container_enum as enum \(([\s\S]*?)\);/) || [])[1] || '';
  check('estado_container_enum tem EM_REFORMA e não tem EM_MANUTENCAO', enumContainer.includes("'EM_REFORMA'") && !enumContainer.includes("'EM_MANUTENCAO'"));

  log('\n7. Código: manutenção, embarcações e Relatórios');
  const manut = read('js/pages/manutencao.js');
  check('manutenção de contêiner grava EM_REFORMA (não EM_MANUTENCAO)',
    /from\('containers'\)\.update\(\{ estado: 'EM_REFORMA' \}\)/.test(manut) && !/from\('containers'\)\.update\(\{ estado: 'EM_MANUTENCAO' \}\)/.test(manut));
  check('OS de navio grava navio_id (UUID validado)', /navio_id:\s*navioUuid/.test(manut) && /navioUuid\s*=.*test\(/.test(manut));
  check('listener nexus_data_changed de manutenção recarrega do Supabase (carregarOsSupabase)',
    /addEventListener\('nexus_data_changed'[\s\S]*?carregarOsSupabase\(\)/.test(manut));
  check('listener nexus_data_changed de embarcações recarrega as rotas (carregarRotasMaritimas)',
    /addEventListener\('nexus_data_changed'[\s\S]*?carregarRotasMaritimas\(\)/.test(read('js/pages/embarcacoes.js')));

  const relatorios = read('js/pages/relatorios.js');
  check('Relatórios não tem intervalo de 5 s para produtividade (setInterval removido)',
    !/setInterval\([\s\S]{0,160}5000\)/.test(relatorios) && !/setInterval\(\s*\(\)\s*=>\s*\{\s*renderProdutividadeTable/.test(relatorios));
  const dashboard = read('js/pages/dashboard.js');
  const inicioAuditoria = dashboard.indexOf('async function renderAuditLogTable');
  const fimAuditoria = dashboard.indexOf('async function renderTrailDecisoesTable');
  check('log de auditoria não usa o nome da sessão como fallback (session.nome)',
    inicioAuditoria > 0 && fimAuditoria > inicioAuditoria
      && !dashboard.slice(inicioAuditoria, fimAuditoria).includes('session.nome'));
}

// ---------------------------------------------------------------------------
// 8. Listeners de nexus_data_changed em páginas reais
// ---------------------------------------------------------------------------
async function testarListenersAoVivo() {
  log('\n8. Listeners de nexus_data_changed: páginas reais refazem a leitura do Supabase sem erro');
  const erroDeExecucao = (e) => /is not defined|is not a function|Cannot read|undefined/.test(e);

  // Manutenção: o evento recarrega as ordens de serviço (carregarOsSupabase)
  const cliManut = clienteFalso({ manutencoes: [], navios: [], containers: [], guindastes: [], funcionarios: [] });
  const manut = criarJanela({
    url: 'https://nexusport.test/manutencao.html',
    html: htmlDaPagina('manutencao.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA'),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/layout.js',
      'js/supabase-client.js', (win) => { win.nexusSupabase = cliManut; },
      'js/data-repository.js', 'js/pages/manutencao.js'
    ]
  });
  janelasAbertas.push(manut.w);
  await prontoDom(manut.w);
  await aguardar(250);
  const osAntes = cliManut.leituras.filter((l) => l.tabela === 'manutencoes' && !l.escrita).length;
  manut.w.dispatchEvent(new manut.w.CustomEvent('nexus_data_changed', { detail: { entity: 'manutencoes' } }));
  await aguardar(250);
  const osDepois = cliManut.leituras.filter((l) => l.tabela === 'manutencoes' && !l.escrita).length;
  check('manutenção: nexus_data_changed refaz a leitura de manutencoes no Supabase', osDepois > osAntes, `${osAntes} → ${osDepois}`);
  check('manutenção: o listener roda sem erro de execução', !manut.erros.some(erroDeExecucao), manut.erros.join(' | '));

  // Embarcações: o evento recarrega as rotas marítimas (carregarRotasMaritimas)
  const cliEmb = clienteFalso({ rotas_maritimas: [], navios: [], containers: [], guindastes: [], bercos: [] });
  const emb = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA'),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/vision-layer.js', 'js/layout.js',
      'js/supabase-client.js', (win) => { win.nexusSupabase = cliEmb; },
      'js/data-repository.js', 'js/pages/embarcacoes.js'
    ]
  });
  janelasAbertas.push(emb.w);
  await prontoDom(emb.w);
  await aguardar(250);
  const rotasAntes = cliEmb.leituras.filter((l) => l.tabela === 'rotas_maritimas' && !l.escrita).length;
  emb.w.dispatchEvent(new emb.w.CustomEvent('nexus_data_changed', { detail: { entity: 'rotas_maritimas' } }));
  await aguardar(250);
  const rotasDepois = cliEmb.leituras.filter((l) => l.tabela === 'rotas_maritimas' && !l.escrita).length;
  check('embarcações: nexus_data_changed refaz a leitura de rotas_maritimas no Supabase', rotasDepois > rotasAntes, `${rotasAntes} → ${rotasDepois}`);
  check('embarcações: o listener roda sem erro de execução', !emb.erros.some(erroDeExecucao), emb.erros.join(' | '));
}

// ---------------------------------------------------------------------------
(async function main() {
  log('\n=== Tempo real e indicadores (Backlog 3 — J) ===');
  try {
    await testarDerivacao();
    await testarPaginacao();
    await testarRealtime();
    await testarPainelAuditoria();
    await testarProdutividade();
    await testarListenersAoVivo();
    testarConfiguracao();
  } finally {
    // Fecha as janelas: o repositório mantém um setInterval (polling de segurança).
    janelasAbertas.forEach((janela) => { try { janela.close(); } catch (e) { /* já fechada */ } });
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch((erro) => {
  console.error('❌ Erro inesperado no teste:', erro);
  process.exit(1);
});
