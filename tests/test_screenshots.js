#!/usr/bin/env node
/**
 * TESTE — CAPTURA DE TELAS (tools/screenshots/*)
 * ------------------------------------------------------------
 * Sem navegador: valida as três peças que sustentam as capturas.
 *
 *   1. Dados de demonstração (tools/screenshots/demo-data.js):
 *      as três contas MAT-0000/MAT-2011/MAT-9999 com cargos distintos, os 9 status do
 *      fluxo presentes e integridade referencial das chaves estrangeiras usadas nas telas.
 *   2. PostgREST simulado (tools/screenshots/mock-postgrest.js): filtros, `or`, `not.in`,
 *      ordenação, limite, contagem exata, recurso único, joins com apelido e erro PGRST205 —
 *      exatamente as consultas que js/** faz.
 *   3. Catálogo de telas (tools/screenshots/paginas.js) em sincronia com a matriz
 *      PAGE_PERMISSIONS de js/auth-guard.js (quem vê o quê nas capturas).
 *
 * Uso: node tests/test_screenshots.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, read, log, check, resumo } = require('./webmcp-harness');

const { criarTabelas, CONTAS, CARGO_META } = require('../tools/screenshots/demo-data');
const { iniciarPostgrestDemo } = require('../tools/screenshots/mock-postgrest');
const { PAGINAS, paginasParaCargo } = require('../tools/screenshots/paginas');

const STATUS_FLUXO = [
  'AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA',
  'SAIDA', 'EM_TRANSITO', 'ENTREGUE', 'CANCELADA', 'RECUSADA'
];

// ---------------------------------------------------------------------------
// 1. Dados de demonstração
// ---------------------------------------------------------------------------
function testarDados() {
  log('\n[1] Dados de demonstração (tools/screenshots/demo-data.js)');
  const tabelas = criarTabelas();

  check('gera as tabelas usadas pelas telas',
    ['funcionarios', 'cargas', 'containers', 'navios', 'bercos', 'guindastes', 'manutencoes',
      'inspecoes', 'inspecao_itens', 'visitantes', 'logs_alteracoes', 'trail_decisoes',
      'retificacoes_trail', 'delegacoes_supervisor', 'agendamentos', 'estivador_cargas',
      'tipos_carga', 'rotas_maritimas', 'checklist_modelos', 'checklist_itens', 'emergencias']
      .every((t) => Array.isArray(tabelas[t])),
    Object.keys(tabelas).filter((t) => !Array.isArray(tabelas[t])).join(', '));

  check('três contas de demonstração com matrícula, código e cargo',
    CONTAS.length === 3
    && CONTAS.map((c) => c.matricula).join(',') === 'MAT-0000,MAT-2011,MAT-9999'
    && CONTAS.every((c) => /^NX-\d{4}-SP$/.test(c.codigo) && CARGO_META[c.cargo]),
    CONTAS.map((c) => `${c.matricula}=${c.cargo}`).join(' | '));

  const cargos = new Set(CONTAS.map((c) => c.cargo));
  check('as três contas cobrem cargos diferentes', cargos.size === 3, [...cargos].join(', '));

  const funcionariosNasTabelas = tabelas.funcionarios.filter((f) => CONTAS.some((c) => c.matricula === f.matricula));
  check('as contas existem na tabela funcionarios e estão ativas',
    funcionariosNasTabelas.length === 3 && funcionariosNasTabelas.every((f) => f.ativo === true));

  const status = new Set(tabelas.cargas.map((c) => c.status_fluxo));
  check('os 9 status do fluxo têm carga de exemplo',
    STATUS_FLUXO.every((s) => status.has(s)),
    STATUS_FLUXO.filter((s) => !status.has(s)).join(', ') || 'todos presentes');

  const ids = (tabela) => new Set(tabelas[tabela].map((l) => l.id));
  const idsFuncionarios = ids('funcionarios');
  const idsCargas = ids('cargas');
  const idsContainers = ids('containers');
  const idsNavios = ids('navios');

  // [descrição, linhas, coluna da chave estrangeira, ids válidos na tabela referenciada]
  const chavesOk = [
    ['cargas.container_id', tabelas.cargas, 'container_id', idsContainers],
    ['cargas.navio_id', tabelas.cargas, 'navio_id', idsNavios],
    ['bercos.navio_id', tabelas.bercos, 'navio_id', idsNavios],
    ['containers.navio_id', tabelas.containers, 'navio_id', idsNavios],
    ['containers.tipo_carga_id', tabelas.containers, 'tipo_carga_id', ids('tipos_carga')],
    ['cargas.checklist_modelo_id', tabelas.cargas, 'checklist_modelo_id', ids('checklist_modelos')],
    ['agendamentos.carga_id', tabelas.agendamentos, 'carga_id', idsCargas],
    ['agendamentos.agendado_por', tabelas.agendamentos, 'agendado_por', idsFuncionarios],
    ['estivador_cargas.carga_id', tabelas.estivador_cargas, 'carga_id', idsCargas],
    ['estivador_cargas.estivador_id', tabelas.estivador_cargas, 'estivador_id', idsFuncionarios],
    ['inspecoes.carga_id', tabelas.inspecoes, 'carga_id', idsCargas],
    ['inspecoes.inspetor_id', tabelas.inspecoes, 'inspetor_id', idsFuncionarios],
    ['inspecao_itens.checklist_item_id', tabelas.inspecao_itens, 'checklist_item_id', ids('checklist_itens')],
    ['inspecao_itens.inspecao_id', tabelas.inspecao_itens, 'inspecao_id', ids('inspecoes')],
    ['checklist_itens.checklist_modelo_id', tabelas.checklist_itens, 'checklist_modelo_id', ids('checklist_modelos')],
    ['checklist_modelos.tipo_carga_id', tabelas.checklist_modelos, 'tipo_carga_id', ids('tipos_carga')],
    ['retificacoes_trail.trail_id', tabelas.retificacoes_trail, 'trail_id', ids('trail_decisoes')],
    ['logs_alteracoes.funcionario_id', tabelas.logs_alteracoes, 'funcionario_id', idsFuncionarios],
    ['trail_decisoes.funcionario_id', tabelas.trail_decisoes, 'funcionario_id', idsFuncionarios],
    ['leituras_qr_code.funcionario_id', tabelas.leituras_qr_code, 'funcionario_id', idsFuncionarios],
    ['visitantes.registrado_por', tabelas.visitantes, 'registrado_por', idsFuncionarios],
    ['delegacoes_supervisor.substituto_id', tabelas.delegacoes_supervisor, 'substituto_id', idsFuncionarios],
    ['delegacoes_supervisor.supervisor_titular_id', tabelas.delegacoes_supervisor, 'supervisor_titular_id', idsFuncionarios],
    ['manutencoes.solicitado_por', tabelas.manutencoes, 'solicitado_por', idsFuncionarios],
    ['manutencoes.navio_id', tabelas.manutencoes.filter((m) => m.navio_id), 'navio_id', idsNavios],
    ['manutencoes.guindaste_id', tabelas.manutencoes.filter((m) => m.guindaste_id), 'guindaste_id', ids('guindastes')],
    ['historico_manutencoes.registrado_por', tabelas.historico_manutencoes, 'registrado_por', idsFuncionarios],
    ['emergencias.funcionario_id', tabelas.emergencias, 'funcionario_id', idsFuncionarios]
  ];
  const orfas = chavesOk.filter(([, linhas, coluna, alvo]) => linhas.some((l) => l[coluna] && !alvo.has(l[coluna])));
  check('chaves estrangeiras apontam para registros existentes', orfas.length === 0,
    orfas.map((o) => `${o[0]} (${o[1].filter((l) => !o[3].has(l[o[2]])).length} órfã(s))`).join(', '));

  const bercosOcupados = tabelas.bercos.filter((b) => b.estado === 'OCUPADO');
  const bercosLivres = tabelas.bercos.filter((b) => b.estado !== 'OCUPADO');
  check('berços: 15 posições, ocupados com navio identificado e livres sem resíduo',
    tabelas.bercos.length === 15
    && bercosOcupados.every((b) => b.navio_nome && b.navio_imo)
    && bercosLivres.every((b) => b.navio_nome === null && b.navio_imo === null && b.navio_id === null),
    `${bercosOcupados.length} ocupados`);

  check('todo objeto é serializável em JSON (sem undefined)',
    JSON.parse(JSON.stringify(tabelas)) && Object.values(tabelas).every((linhas) => linhas.every((l) => !Object.values(l).includes(undefined))));

  check('cargo_niveis cobre os 10 cargos do enum cargo_enum',
    tabelas.cargo_niveis.length === 10 && tabelas.cargo_niveis.every((l) => CARGO_META[l.cargo]),
    `${tabelas.cargo_niveis.length}`);

  check('um único agendamento por carga em AGENDAMENTO',
    new Set(tabelas.agendamentos.map((a) => a.carga_id)).size === tabelas.agendamentos.length
    && tabelas.agendamentos.length === tabelas.cargas.filter((c) => c.status_fluxo === 'AGENDAMENTO').length);

  check('inspeção ativa é única por carga (índice parcial do banco)',
    (() => {
      const ativas = tabelas.inspecoes.filter((i) => i.ativa).map((i) => i.carga_id);
      return new Set(ativas).size === ativas.length;
    })());
}

// ---------------------------------------------------------------------------
// 2. PostgREST simulado
// ---------------------------------------------------------------------------
async function testarPostgrest() {
  log('\n[2] PostgREST simulado (consultas reais do front-end)');
  const servidor = await iniciarPostgrestDemo();
  const base = `${servidor.url}/rest/v1`;
  const json = async (caminho, opcoes) => {
    const resposta = await fetch(`${base}${caminho}`, opcoes);
    const texto = await resposta.text();
    let corpo = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch (e) { corpo = texto; }
    return { status: resposta.status, corpo, headers: resposta.headers };
  };

  const cargas = await json('/cargas?select=*');
  check('GET /cargas devolve as 14 cargas de demonstração', cargas.status === 200 && cargas.corpo.length === 14,
    `status=${cargas.status} n=${Array.isArray(cargas.corpo) ? cargas.corpo.length : cargas.corpo}`);

  const login = await json('/funcionarios?select=*&codigo_individual=eq.NX-2011-SP&ativo=eq.true');
  check('login por código individual encontra o supervisor', login.corpo.length === 1 && login.corpo[0].matricula === 'MAT-2011');

  const loginMatricula = await json('/funcionarios?select=*&matricula=eq.MAT-9999&ativo=eq.true');
  check('login por matrícula encontra o técnico em portos', loginMatricula.corpo.length === 1 && loginMatricula.corpo[0].cargo === 'TECNICO_PORTOS');

  const armazenagem = await json('/cargas?select=id&status_fluxo=eq.ARMAZENAGEM');
  check('filtro eq', armazenagem.corpo.length === 3, `${armazenagem.corpo.length}`);

  const naoFinalizadas = await json(`/cargas?select=id&status_fluxo=not.in.(${encodeURIComponent('"ENTREGUE","CANCELADA","RECUSADA"')})`);
  check('filtro not.in (embarcações)', naoFinalizadas.corpo.length === 11, `${naoFinalizadas.corpo.length}`);

  const porMatricula = await json('/funcionarios?select=id,nome&or=(matricula.eq.MAT-2011,matricula.eq.MAT2011)');
  check('grupo or por matrícula (delegação)', porMatricula.corpo.length === 1 && porMatricula.corpo[0].nome === 'Marcos Tavares');

  const porNome = await json(`/funcionarios?select=id&or=(${encodeURIComponent('nome.ilike.%patrícia%')},telefone.eq.x)`);
  check('grupo or com ilike (busca de substituto)', porNome.corpo.length === 2, `${porNome.corpo.length}`);

  const ordenado = await json('/bercos?select=id,nome&order=nome.asc');
  check('ordenação ascendente por nome', ordenado.corpo[0].nome === 'Berço 01' && ordenado.corpo[14].nome === 'Berço 15');

  const limitado = await json('/cargas?select=id&order=data_entrada.desc.nullslast&limit=3');
  check('ordenação com nulos por último + limite', limitado.corpo.length === 3);

  const comContagem = await json('/cargas?select=id&limit=2', { headers: { Prefer: 'count=exact' } });
  check('contagem exata no cabeçalho Content-Range',
    /^0-1\/14$/.test(comContagem.headers.get('content-range') || ''),
    comContagem.headers.get('content-range'));

  const objetoUnico = await json('/cargas?select=*&qr_code_url=eq.QR-DEMO-CRG-003', { headers: { Accept: 'application/vnd.pgrst.object+json' } });
  check('recurso único (Accept: pgrst.object) devolve objeto', objetoUnico.status === 200 && !Array.isArray(objetoUnico.corpo) && objetoUnico.corpo.material === 'Café em grão');

  const objetoAusente = await json('/cargas?select=*&qr_code_url=eq.INEXISTENTE', { headers: { Accept: 'application/vnd.pgrst.object+json' } });
  check('recurso único sem linhas devolve 406 (PGRST116) para o maybeSingle do supabase-js',
    objetoAusente.status === 406 && objetoAusente.corpo.code === 'PGRST116');

  const join = await json(`/cargas?select=${encodeURIComponent('*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))')}&qr_code_url=eq.QR-DEMO-CRG-003`);
  const linha = join.corpo[0];
  check('join aninhado (carga → navio e → estivador_cargas → funcionários)',
    linha.navios && linha.navios.nome === 'Navio Atlântico Sul'
    && Array.isArray(linha.estivador_cargas) && linha.estivador_cargas[0].funcionarios.matricula === 'MAT-1040',
    JSON.stringify(linha.navios));

  const joinApelido = await json(`/delegacoes_supervisor?select=${encodeURIComponent('*, supervisor:supervisor_titular_id(nome, matricula), substituto:substituto_id(nome, matricula)')}&ativo=eq.true`);
  check('join com apelido de chave estrangeira (delegação ativa)',
    joinApelido.corpo.length === 1
    && joinApelido.corpo[0].supervisor.matricula === 'MAT-2010'
    && joinApelido.corpo[0].substituto.nome === 'Patrícia Duarte');

  const comRetificacoes = await json(`/trail_decisoes?select=${encodeURIComponent('*, funcionarios(nome, cargo), retificacoes_trail(*)')}`);
  const comRet = comRetificacoes.corpo.find((t) => t.retificacoes_trail.length > 0);
  check('join com (*) traz todas as colunas da tabela filha (retificações da trilha)',
    Boolean(comRet) && typeof comRet.retificacoes_trail[0].retificacao === 'string');

  const contagemHead = await json('/cargas?select=*', { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  check('HEAD com contagem (usado pelo diagnóstico do supabase-client)',
    /\/14$/.test(contagemHead.headers.get('content-range') || ''), contagemHead.headers.get('content-range'));

  const escrita = await json('/cargas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ material: 'Teste', peso: 1, volume: 1, valor_declarado: 1, natureza: 'Carga geral', porto_descarga: 'Teste', status_fluxo: 'AGENDAMENTO', qr_code_url: 'QR-TESTE' })
  });
  check('POST insere e devolve o registro (return=representation)', escrita.status === 201 && escrita.corpo[0].id && escrita.corpo[0].qr_code_url === 'QR-TESTE');

  const atualizacao = await json('/cargas?qr_code_url=eq.QR-TESTE', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status_fluxo: 'SAIDA' })
  });
  const depois = await json('/cargas?select=status_fluxo&qr_code_url=eq.QR-TESTE');
  check('PATCH atualiza a linha filtrada', atualizacao.status === 204 && depois.corpo[0].status_fluxo === 'SAIDA');

  const remocao = await json('/cargas?qr_code_url=eq.QR-TESTE', { method: 'DELETE' });
  const restaram = await json('/cargas?select=id');
  check('DELETE remove a linha filtrada', remocao.status === 204 && restaram.corpo.length === 14, `${restaram.corpo.length}`);

  const inexistente = await json('/tabela_que_nao_existe?select=*');
  check('tabela ausente responde 404 PGRST205 (diagnóstico do app)',
    inexistente.status === 404 && inexistente.corpo.code === 'PGRST205');

  const emergencia = await json('/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1', { headers: { Accept: 'application/vnd.pgrst.object+json' } });
  check('consulta do botão de pânico sem emergência ativa responde 406 (tratado no app)',
    emergencia.status === 406);

  await servidor.fechar();
}

// ---------------------------------------------------------------------------
// 3. Catálogo de telas x matriz de permissões do app
// ---------------------------------------------------------------------------
function matrizDePermissoes() {
  const fonte = read('js/auth-guard.js');
  const inicio = fonte.indexOf('const PAGE_PERMISSIONS = {');
  const fim = fonte.indexOf('};', inicio);
  const trecho = fonte.slice(inicio + 'const PAGE_PERMISSIONS = '.length, fim + 1);
  return new Function(`return ${trecho};`)();
}

function testarCatalogo() {
  log('\n[3] Catálogo de telas x PAGE_PERMISSIONS (js/auth-guard.js)');
  const permissoes = matrizDePermissoes();

  // Fora da matriz PAGE_PERMISSIONS por definição: login (index), confirmação de cargo
  // (etapa pós-login) e a página pública de diagnóstico do alerta tátil.
  const FORA_DA_MATRIZ = ['index.html', 'confirm-role.html', 'teste-vibracao.html'];
  const paginasComMatriz = PAGINAS.filter((p) => permissoes[p.arquivo]);
  const semMatriz = PAGINAS.filter((p) => !permissoes[p.arquivo] && !FORA_DA_MATRIZ.includes(p.arquivo));
  check('toda tela interna do catálogo existe na matriz de permissões',
    semMatriz.length === 0 && paginasComMatriz.length === PAGINAS.length - FORA_DA_MATRIZ.length,
    semMatriz.map((p) => p.arquivo).join(', '));

  const divergentes = paginasComMatriz.filter((p) => {
    const esperado = [...permissoes[p.arquivo]].sort().join(',');
    const informado = [...p.cargos].sort().join(',');
    return esperado !== informado;
  });
  check('os cargos de cada tela batem com a matriz do app',
    divergentes.length === 0,
    divergentes.map((p) => `${p.arquivo}: catálogo=[${p.cargos.join(',')}] matriz=[${permissoes[p.arquivo].join(',')}]`).join(' | '));

  check('telas públicas são apenas as declaradas como tal',
    PAGINAS.filter((p) => p.publica).map((p) => p.arquivo).sort().join(',') === 'index.html,teste-vibracao.html',
    PAGINAS.filter((p) => p.publica).map((p) => p.arquivo).join(', '));

  const cargosDeTeste = CONTAS.map((c) => c.cargo);
  const telasDoDiretor = paginasParaCargo('DIRETOR_PRESIDENTE_SUPERINTENDENTE').map((p) => p.arquivo);
  const telasDoTecnico = paginasParaCargo('TECNICO_PORTOS').map((p) => p.arquivo);
  const telasDoSupervisor = paginasParaCargo('SUPERVISOR_GERENTE_OPERACOES').map((p) => p.arquivo);

  check('as três contas de demonstração capturam conjuntos diferentes de telas',
    new Set([telasDoDiretor.join(','), telasDoSupervisor.join(','), telasDoTecnico.join(',')]).size === 3,
    `diretor=${telasDoDiretor.length} supervisor=${telasDoSupervisor.length} técnico=${telasDoTecnico.length}`);

  check('o técnico em portos não recebe telas de inspeção, manutenção ou delegação',
    !telasDoTecnico.includes('inspecao.html') && !telasDoTecnico.includes('manutencao.html') && !telasDoTecnico.includes('delegacao.html'));

  check('o diretor-presidente recebe também inspeção, manutenção e delegação',
    ['inspecao.html', 'manutencao.html', 'delegacao.html'].every((t) => telasDoDiretor.includes(t)));

  check('telefone de exemplo das telas (cargos de demonstração) tem metadados de exibição',
    cargosDeTeste.every((c) => CARGO_META[c] && CARGO_META[c].nome && CARGO_META[c].camada && CARGO_META[c].nivel));
}

(async function principal() {
  console.log('\n=== Captura de telas — dados, PostgREST simulado e catálogo ===');
  testarDados();
  await testarPostgrest();
  testarCatalogo();
  const { total, falhas } = resumo();
  process.stdout.write(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).\n`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  process.stdout.write(`Falha inesperada: ${erro && erro.stack ? erro.stack : erro}\n`);
  process.exit(1);
});
