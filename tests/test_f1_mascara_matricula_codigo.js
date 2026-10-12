#!/usr/bin/env node
/**
 * REGRESSÃO (F1 — Backlog, "máscara de matrícula/código"): a matrícula é padronizada
 * em UM lugar e o código de acesso nasce dela.
 *
 * Antes desta correção (verificado no código):
 *   - o campo de matrícula do cadastro de funcionários (tecnico_portos.html) era o ÚNICO
 *     campo de código SEM máscara: embarcações, contêineres, guindastes, cargas, CPF e o
 *     login já formatavam durante a digitação; a matrícula só era ajustada no envio;
 *   - "MAT-" era prefixado em cinco pontos diferentes da página, cada um do seu jeito
 *     (um deles sensível a maiúsculas: digitar "mat2001" na busca não achava ninguém);
 *   - a conferência de duplicidade comparava o texto exato, então um registro legado sem
 *     prefixo ("4322") convivia com "MAT-4322" — a mesma pessoa cadastrada duas vezes;
 *   - a busca montava o filtro da consulta com o texto digitado cru.
 *
 * Agora js/padronizacao-codigos.js é a fonte única: máscara, chave de unicidade, formas
 * gravadas no banco e geração do código individual (NX-2001-SP).
 *
 * Cobre o backlog F1: C13 (só quem está no banco; matrícula única), C25 (busca acha a
 * matrícula cadastrada em qualquer grafia), C26 (duplicidade bloqueada com mensagem),
 * C30 (matrícula e código em caixa alta, valores fora do padrão não são reescritos) e
 * C37 (documento do visitante com máscara de CPF e validação de 11 dígitos).
 *
 * Executar: node tests/test_f1_mascara_matricula_codigo.js   (ou: npm run test:f1-matricula)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const H = require('./webmcp-harness');
const { criarJanela, prontoDom, aguardar, htmlDaPagina, sessao } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const ROOT = path.join(__dirname, '..');
let total = 0;
let falhas = 0;
function check(label, cond, extra) {
  total += 1;
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    falhas += 1;
    console.error(`  ❌ [FAIL] ${label}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('\n1. Módulo: a matrícula digitada ganha o prefixo (como o IMO)');
const C = (() => {
  const janela = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/padronizacao-codigos.js'), 'utf8'),
    Object.assign(janela, { console }), { filename: 'padronizacao-codigos.js' });
  return janela.NexusCodigos;
})();
{
  check('expõe chaveMatricula, variacoesMatricula e codigoIndividual',
    ['chaveMatricula', 'variacoesMatricula', 'codigoIndividual'].every((f) => typeof C[f] === 'function'));
  check('"2001" vira MAT-2001 (o operador não precisa saber o prefixo)', C.formatarMatricula('2001') === 'MAT-2001', C.formatarMatricula('2001'));
  check('"mat2001" (colado, minúsculo) vira MAT-2001', C.formatarMatricula('mat2001') === 'MAT-2001', C.formatarMatricula('mat2001'));
  check('"MAT-2001" continua MAT-2001 (formatação idempotente)', C.formatarMatricula('MAT-2001') === 'MAT-2001');
  check('digitação parcial não inventa hífen: "M"/"MA"/"MAT" ficam como estão',
    C.formatarMatricula('M') === 'M' && C.formatarMatricula('MA') === 'MA' && C.formatarMatricula('MAT') === 'MAT');
  check('matrícula legada longa NÃO é reescrita (888001 continua 888001)', C.formatarMatricula('888001') === '888001', C.formatarMatricula('888001'));
  check('legado continua aceito e marcado como legado', C.validarMatricula('888001').ok === true && C.validarMatricula('888001').legado === true);
  check('padrão é aceito sem marcação de legado', C.validarMatricula('2001').ok === true && C.validarMatricula('2001').legado === false
    && C.validarMatricula('2001').valor === 'MAT-2001');
}

console.log('\n2. Módulo: a mesma pessoa em qualquer grafia (unicidade e busca)');
{
  check('MAT-2001, mat2001 e 2001 têm a mesma chave de unicidade',
    C.chaveMatricula('MAT-2001') === '2001' && C.chaveMatricula('mat2001') === '2001' && C.chaveMatricula('2001') === '2001');
  check('matrícula legada tem chave própria (não confunde com outra pessoa)',
    C.chaveMatricula('888001') === '888001' && C.chaveMatricula('888001') !== C.chaveMatricula('2001'));
  check('chave vazia para valor vazio', C.chaveMatricula('') === '' && C.chaveMatricula(null) === '');

  check('formas gravadas de "1040": com e sem prefixo',
    JSON.stringify(C.variacoesMatricula('1040')) === JSON.stringify(['1040', 'MAT-1040']), C.variacoesMatricula('1040'));
  check('formas gravadas de "MAT-1040": com e sem prefixo',
    JSON.stringify(C.variacoesMatricula('MAT-1040')) === JSON.stringify(['MAT-1040', '1040']), C.variacoesMatricula('MAT-1040'));
  check('matrícula legada também é procurada nas duas grafias',
    JSON.stringify(C.variacoesMatricula('888001')) === JSON.stringify(['888001', 'MAT-888001']));
  check('nome (não matrícula) não gera filtro de matrícula', C.variacoesMatricula('joao').length === 0);
  check('texto com operador de filtro não gera consulta', C.variacoesMatricula('x,id.neq.0').length === 0);
}

console.log('\n3. Módulo: código de acesso nasce da matrícula');
{
  check('MAT-2001 → NX-2001-SP', C.codigoIndividual('MAT-2001') === 'NX-2001-SP', C.codigoIndividual('MAT-2001'));
  check('matrícula digitada sem prefixo gera o mesmo código', C.codigoIndividual('2001') === 'NX-2001-SP');
  check('sufixo de reemissão é usado e normalizado', C.codigoIndividual('mat2001', 4821) === 'NX-2001-4821', C.codigoIndividual('mat2001', 4821));
  check('matrícula legada gera código com os dígitos do registro', C.codigoIndividual('888001') === 'NX-888001-SP');
  check('sem matrícula não há código (nunca "NX--SP")', C.codigoIndividual('') === '');
}

// ---------------------------------------------------------------------------
console.log('\n4. Página: máscara no campo, cadastro padronizado e código do funcionário');
const FUNC_ANA = '22220000-0000-4000-8000-000000000001';
const FUNC_LEGADO = '22220000-0000-4000-8000-000000000003';

function bancoBase() {
  return criarBancoFalso({
    funcionarios: [
      { id: FUNC_ANA, matricula: 'MAT-1040', nome: 'Ana Padrão', cargo: 'ESTIVADOR', cargo_nome: 'Estivador', codigo_individual: 'NX-1040-1111', ativo: true, cpf: '11111111111' },
      // Registro LEGADO: gravado sem o prefixo MAT-.
      { id: FUNC_LEGADO, matricula: '4322', nome: 'Bruno Legado', cargo: 'ESTIVADOR', cargo_nome: 'Estivador', codigo_individual: 'NX-4322-2222', ativo: true, cpf: '22222222222' }
    ],
    cargas: [], navios: [], containers: [], bercos: [], manutencoes: [], visitantes: [], logs_alteracoes: []
  });
}

async function carregarPagina(banco, storageExtra) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: htmlDaPagina('tecnico_portos.html'),
    session: sessao('TECNICO_PORTOS', { matricula: 'MAT-9002', nome: 'Técnico de Testes' }),
    storage: Object.assign({ nexus_func_list: [] }, storageExtra),
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.__warns = [];
        win.console.warn = (...args) => { win.__warns.push(args.map(String).join(' ')); };
      },
      'js/vision-layer.js',
      'js/layout.js',
      // Depois do layout: as funções de interface dele são trocadas pelos dublês do teste
      // (o layout redefine mostrarFeedback/nexusConfirm ao ser carregado).
      (win) => {
        win.mostrarFeedback = (tipo, titulo, mensagem) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, mensagem }]); };
        win.nexusConfirm = async () => true;
      },
      'js/padronizacao-codigos.js',
      'js/pages/tecnico_portos.js'
    ]
  });
  await prontoDom(w);
  await aguardar(200);
  return { janela, w };
}

function ultimoFeedback(w, titulo) {
  const lista = (w.__feedbacks || []).filter((f) => !titulo || f.titulo === titulo);
  return lista.length ? lista[lista.length - 1] : null;
}

async function preencherCadastro(w, { matricula, nome, cpf, cargo }) {
  const doc = w.document;
  doc.getElementById('funcMatricula').value = matricula;
  doc.getElementById('funcNome').value = nome;
  doc.getElementById('funcCargo').value = cargo || 'ESTIVADOR';
  doc.getElementById('funcCpf').value = cpf;
  doc.getElementById('funcDataNasc').value = '1990-05-20';
  doc.getElementById('funcDoc').value = 'Livro 1';
}

async function testarPagina() {
  const banco = bancoBase();
  const { janela, w } = await carregarPagina(banco);
  const doc = w.document;

  // --- máscara ---
  const campo = doc.getElementById('funcMatricula');
  campo.value = '2001';
  campo.dispatchEvent(new w.Event('input'));
  check('máscara: digitar "2001" mostra MAT-2001 no campo', campo.value === 'MAT-2001', campo.value);
  campo.value = 'mat-1041';
  campo.dispatchEvent(new w.Event('input'));
  check('máscara: colar "mat-1041" normaliza para MAT-1041', campo.value === 'MAT-1041', campo.value);
  campo.value = 'MA';
  campo.dispatchEvent(new w.Event('input'));
  check('máscara: digitação parcial é preservada ("MA")', campo.value === 'MA', campo.value);

  // --- cadastro: matrícula digitada sem prefixo é gravada padronizada ---
  await preencherCadastro(w, { matricula: '2001', nome: 'Carla Nova', cpf: '333.444.555-06', cargo: 'CONFERENTE_CARGA' });
  doc.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit'));
  await aguardar(250);

  const gravados = banco.tabelas.funcionarios.filter((f) => f.nome === 'Carla Nova');
  check('cadastro: grava a matrícula padronizada MAT-2001', gravados.length === 1 && gravados[0].matricula === 'MAT-2001',
    gravados.map((f) => f.matricula));
  check('cadastro: grava o cargo escolhido no formulário',
    gravados.length === 1 && gravados[0].cargo === 'CONFERENTE_CARGA', gravados[0] && gravados[0].cargo);
  check('cadastro: gera o código individual a partir da matrícula',
    gravados.length === 1 && /^NX-2001-\d{4}$/.test(String(gravados[0].codigo_individual)), gravados[0] && gravados[0].codigo_individual);
  const local = JSON.parse(w.localStorage.getItem('nexus_func_list') || '[]');
  const localNovo = local.find((f) => f.matricula === 'MAT-2001');
  check('cadastro: o cache local guarda o mesmo código do banco',
    localNovo && gravados[0] && localNovo.codigo === gravados[0].codigo_individual, localNovo && localNovo.codigo);

  // --- duplicidade: registro legado sem prefixo (4322) não pode ser duplicado ---
  const antes = banco.tabelas.funcionarios.length;
  await preencherCadastro(w, { matricula: '4322', nome: 'Bruno Outro', cpf: '999.888.777-66' });
  doc.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit'));
  await aguardar(250);
  const fbDuplicado = ultimoFeedback(w, 'Matrícula Duplicada');
  check('duplicidade: "4322" é bloqueado porque o legado "4322" já é a mesma matrícula',
    fbDuplicado && /já está cadastrada/.test(fbDuplicado.mensagem), fbDuplicado && fbDuplicado.mensagem);
  check('duplicidade: a mensagem diz quem já tem a matrícula (nunca "undefined")',
    fbDuplicado && /Bruno Legado/.test(fbDuplicado.mensagem) && !/undefined/.test(fbDuplicado.mensagem),
    fbDuplicado && fbDuplicado.mensagem);
  check('duplicidade: nada foi gravado', banco.tabelas.funcionarios.length === antes);

  // --- duplicidade no padrão: 1040 já existe como MAT-1040 ---
  await preencherCadastro(w, { matricula: '1040', nome: 'Ana Outra', cpf: '123.123.123-12' });
  doc.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit'));
  await aguardar(250);
  check('duplicidade: "1040" também é bloqueado (mesma chave de MAT-1040)',
    Boolean(ultimoFeedback(w, 'Matrícula Duplicada')) && banco.tabelas.funcionarios.length === antes);

  // --- duplicidade descoberta SÓ no Supabase: matrícula gravada por outra sessão
  // depois desta página carregar (a lista local já está velha). Aqui quem bloqueia é a
  // consulta `.in(...).maybeSingle()` — se ela devolvesse array vazio, o `if (dupData)`
  // acharia que existe duplicidade e a mensagem sairia com "undefined".
  banco.tabelas.funcionarios.push({
    id: 'ccc00000-0000-4000-8000-000000000009', matricula: 'MAT-7777', nome: 'Sônia Concorrente',
    cargo: 'ESTIVADOR', codigo_individual: 'NX-7777-0009', ativo: true, cpf: '55566677788'
  });
  const antesSupabase = banco.tabelas.funcionarios.length;
  await preencherCadastro(w, { matricula: '7777', nome: 'Eva Nova', cpf: '246.864.246-80' });
  doc.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit'));
  await aguardar(250);
  const fbSupabase = ultimoFeedback(w, 'Matrícula Duplicada');
  check('duplicidade: matrícula que só o Supabase conhece é bloqueada',
    fbSupabase && /já pertence ao funcionário "Sônia Concorrente"/.test(fbSupabase.mensagem),
    fbSupabase && fbSupabase.mensagem);
  check('duplicidade: a checagem no Supabase não grava nada',
    banco.tabelas.funcionarios.length === antesSupabase);

  // --- matrícula fora do padrão continua recusada ---
  await preencherCadastro(w, { matricula: '12345', nome: 'Dora Fora', cpf: '321.321.321-32' });
  doc.getElementById('funcCrudForm').dispatchEvent(new w.Event('submit'));
  await aguardar(200);
  const fbFora = ultimoFeedback(w, 'Matrícula Inválida');
  check('formato fora do padrão (12345) é recusado com a mensagem do padrão MAT-4 números',
    fbFora && /MAT-4 números/.test(fbFora.mensagem), fbFora && fbFora.mensagem);

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
console.log('\n5. Página: busca acha a matrícula em qualquer grafia (sem filtro com texto livre)');
async function testarBusca() {
  const banco = bancoBase();
  const { janela, w } = await carregarPagina(banco);
  const doc = w.document;
  const buscaInput = doc.getElementById('empMatriculaSearch');
  const buscaBtn = doc.getElementById('searchEmpBtn');

  const filtrosOr = () => banco.log
    .filter((e) => e.tabela === 'funcionarios' && e.op === 'select')
    .map((e) => (e.filtros || []).map(([, v]) => v && v.__or).filter(Boolean))
    .reduce((acc, lista) => acc.concat(lista), []);

  const buscar = async (termo) => {
    buscaInput.value = termo;
    buscaBtn.dispatchEvent(new w.Event('click'));
    await aguardar(200);
    return doc.getElementById('resEmpNome').textContent;
  };

  check('busca: "1040" encontra o funcionário gravado como MAT-1040', (await buscar('1040')) === 'Ana Padrão', doc.getElementById('resEmpNome').textContent);
  check('busca: "mat1040" também encontra', (await buscar('mat1040')) === 'Ana Padrão', doc.getElementById('resEmpNome').textContent);
  check('busca: "MAT-1040" também encontra', (await buscar('MAT-1040')) === 'Ana Padrão', doc.getElementById('resEmpNome').textContent);
  check('busca: matrícula legada "4322" é encontrada', (await buscar('4322')) === 'Bruno Legado', doc.getElementById('resEmpNome').textContent);
  check('busca: "MAT-4322" encontra o registro legado gravado sem prefixo', (await buscar('MAT-4322')) === 'Bruno Legado', doc.getElementById('resEmpNome').textContent);

  const expressoes = filtrosOr();
  check('busca: consulta as duas grafias da matrícula',
    expressoes.some((e) => /matricula\.eq\.MAT-4322/.test(e) && /matricula\.eq\.4322/.test(e)), expressoes.slice(-2));
  check('busca: nenhum filtro leva texto livre do operador',
    expressoes.every((e) => e.split(',').every((termo) => /^matricula\.eq\.[A-Za-z0-9-]*$/.test(termo))), expressoes.slice(-2));

  const logsAntes = filtrosOr().length;
  await buscar('x,id.neq.0');
  check('busca: texto com operador de filtro não vira consulta', filtrosOr().length === logsAntes, filtrosOr().slice(logsAntes));
  const caixaResultado = doc.getElementById('empSearchResultBox');
  check('busca: texto com operador de filtro avisa que não encontrou e esconde o resultado anterior',
    caixaResultado.classList.contains('hidden') && Boolean(ultimoFeedback(w, 'Não Encontrado')),
    { oculta: caixaResultado.classList.contains('hidden'), feedback: ultimoFeedback(w, 'Não Encontrado') });

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
console.log('\n6. Página: documento do visitante (C37) — máscara de CPF e validação');

async function testarVisitantes() {
  const banco = bancoBase();
  const { janela, w } = await carregarPagina(banco);
  const doc = w.document;

  const campoDoc = doc.getElementById('visDocumento');

  // --- máscara 999.999.999-99 ---
  campoDoc.value = '12345678900';
  campoDoc.dispatchEvent(new w.Event('input'));
  check('documento: 11 dígitos viram 123.456.789-00', campoDoc.value === '123.456.789-00', campoDoc.value);

  async function registrarVisitante({ nome, documento, motivo }) {
    doc.getElementById('visNome').value = nome;
    doc.getElementById('visDocumento').value = documento;
    doc.getElementById('visMotivo').value = motivo;
    doc.getElementById('visCrudForm').dispatchEvent(new w.Event('submit'));
    await aguardar(250);
  }

  // --- documento curto é recusado (a máscara nunca deixa passar 5 dígitos como CPF) ---
  await registrarVisitante({ nome: 'Visitante Curto', documento: '12345', motivo: 'Entrega' });
  const fbCurto = ultimoFeedback(w, 'Documento Inválido');
  check('documento: menos de 11 dígitos é recusado com mensagem clara', Boolean(fbCurto), fbCurto && fbCurto.mensagem);
  check('documento: nada foi gravado com documento inválido', banco.tabelas.visitantes.length === 0);

  // --- documento válido grava o visitante ---
  await registrarVisitante({ nome: 'Visitante Um', documento: '529.982.247-25', motivo: 'Fiscalização Alfandegária' });
  const gravados = banco.tabelas.visitantes.filter((v) => v.nome === 'Visitante Um');
  check('documento: visitante com CPF de 11 dígitos é gravado', gravados.length === 1, banco.tabelas.visitantes.length);
  check('documento: o banco recebe o CPF completo (comparável ao digitado)',
    gravados.length === 1 && String(gravados[0].documento || '').replace(/\D/g, '') === '52998224725',
    gravados[0] && gravados[0].documento);

  // --- o mesmo documento não pode entrar duas vezes (C14) ---
  await registrarVisitante({ nome: 'Visitante Dois', documento: '529.982.247-25', motivo: 'Nova visita' });
  const fbDuplicado = ultimoFeedback(w, 'Documento Duplicado');
  check('documento: repetido é bloqueado com o nome de quem já tem o documento',
    Boolean(fbDuplicado) && /Visitante Um/.test(fbDuplicado.mensagem), fbDuplicado && fbDuplicado.mensagem);
  check('documento: o bloqueio não grava um segundo visitante',
    banco.tabelas.visitantes.filter((v) => v.nome === 'Visitante Dois').length === 0);

  janela.dom.window.close();
}

// ---------------------------------------------------------------------------
console.log('\n7. Página: C13 — só os funcionários do banco aparecem (nada de lista inventada)');
async function testarFuncionariosForaDoBanco() {
  const banco = bancoBase();
  // Um funcionário que existe SÓ no cache local do navegador (cadastro antigo, de uma
  // versão em que a lista era local). Ele não pode continuar aparecendo como se fosse real.
  const fantasma = {
    matricula: 'MAT-5555', nome: 'Fantasma Local', cargo: 'Estivador',
    codigo: 'NX-5555-0001', cpf: '99999999999', doc: 'Local', ativo: true
  };
  const { janela, w } = await carregarPagina(banco, { nexus_func_list: [fantasma] });
  const doc = w.document;

  const tabela = doc.getElementById('funcCrudTableBody').textContent;
  check('C13: funcionário que só existe no cache local não é exibido na tabela',
    !/Fantasma Local/.test(tabela), tabela.trim().slice(0, 120));
  check('C13: a tabela mostra os funcionários do banco', /Ana Padrão/.test(tabela) && /Bruno Legado/.test(tabela));

  const cacheReescrito = JSON.parse(w.localStorage.getItem('nexus_func_list') || '[]');
  check('C13: o cache local passa a espelhar o banco (sem o funcionário inventado)',
    cacheReescrito.length === banco.tabelas.funcionarios.length && !cacheReescrito.some((f) => f.nome === 'Fantasma Local'),
    cacheReescrito.map((f) => f.matricula));

  doc.getElementById('empMatriculaSearch').value = '5555';
  doc.getElementById('searchEmpBtn').dispatchEvent(new w.Event('click'));
  await aguardar(250);
  // Sem resultado a página mantém o marcador "--" (conteúdo inicial do HTML) e esconde a caixa.
  const nomeInventado = doc.getElementById('resEmpNome').textContent;
  check('C13: buscar o funcionário inventado não encontra ninguém',
    nomeInventado !== 'Fantasma Local'
      && doc.getElementById('empSearchResultBox').classList.contains('hidden')
      && Boolean(ultimoFeedback(w, 'Não Encontrado')),
    { nome: nomeInventado, feedbacks: (w.__feedbacks || []).map((f) => f.titulo) });

  janela.dom.window.close();
}

(async function main() {
  console.log('\n=== F1 — máscara de matrícula/código (fonte única em js/padronizacao-codigos.js) ===');
  try {
    await testarPagina();
    await testarBusca();
    await testarVisitantes();
    await testarFuncionariosForaDoBanco();
  } catch (erro) {
    check('execução sem exceções', false, erro && erro.stack ? erro.stack.split('\n').slice(0, 3).join(' | ') : String(erro));
  }
  console.log(falhas === 0
    ? `\n✅ F1: ${total} verificações aprovadas.`
    : `\n❌ F1: ${falhas} falha(s) em ${total} verificações.`);
  process.exit(falhas === 0 ? 0 : 1);
})();
