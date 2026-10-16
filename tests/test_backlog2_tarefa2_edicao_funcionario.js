#!/usr/bin/env node
/**
 * Regressão — Tarefa 2 (Backlog Parte 2): edição de funcionários.
 *
 * Gestão de Pessoas (tecnico_portos.html) ganha o botão "Editar" por
 * funcionário para incluir/atualizar CPF e data de nascimento, reutilizando
 * o formulário do cadastro em modo edição:
 *   - matrícula, nome e cargo ficam travados (identidade do cadastro);
 *   - CPF e data de nascimento passam pelas mesmas validações do cadastro
 *     (CPF de 11 dígitos único, nascimento de maior de idade);
 *   - manter o próprio CPF não é "duplicidade"; usar o CPF de outra pessoa é;
 *   - a atualização vai ao Supabase (update, nunca insert) e ao cache local;
 *   - cancelar a edição e reabrir pelo "+ Cadastrar Funcionário" volta ao
 *     cadastro novo normal (sem herdar o modo edição).
 *
 * Executar: node tests/test_backlog2_tarefa2_edicao_funcionario.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const ID1 = '55555555-0000-0000-0000-000000000001';
const ID2 = '55555555-0000-0000-0000-000000000002';
const CPF_OUTRO = '11122233344';
const CPF_NOVO = '529.982.247-25';
const CPF_NOVO_DIGITOS = '52998224725';

/** Supabase falso com estado: select/update/insert/maybeSingle/single reais em memória. */
function clienteSupabase(estado) {
  const from = (tabela) => {
    let op = 'select';
    let payload = null;
    const filtros = [];
    const linhas = () => estado[tabela] || (estado[tabela] = []);
    const casa = (r) => filtros.every(([c, v]) => String(r[c]) === String(v));
    const executar = () => {
      if (op === 'update') {
        const alvo = linhas().filter(casa);
        alvo.forEach(r => Object.assign(r, payload));
        estado.atualizacoes.push({ tabela, payload, filtros: filtros.slice() });
        return { data: alvo.map(r => ({ ...r })), error: null };
      }
      if (op === 'insert') {
        const novo = { id: `55555555-0000-0000-0000-${String(linhas().length + 10).padStart(12, '0')}`, ...payload };
        linhas().push(novo);
        estado.insercoes.push({ tabela, payload });
        estado.ultimoInserido = novo;
        return { data: [{ ...novo }], error: null };
      }
      return { data: linhas().filter(casa).map(r => ({ ...r })), error: null };
    };
    const b = {
      select() { return b; },
      order() { return b; },
      limit() { return b; },
      eq(c, v) { filtros.push([c, v]); return b; },
      or() { return b; },
      ilike() { return b; },
      update(p) { op = 'update'; payload = p; return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      maybeSingle() {
        const r = executar();
        return Promise.resolve({ data: (r.data && r.data[0]) || null, error: null });
      },
      single() {
        if (op === 'insert') executar();
        const r = estado.ultimoInserido ? { id: estado.ultimoInserido.id } : (executar().data || [])[0];
        return Promise.resolve({ data: r || null, error: null });
      },
      then(res, rej) { return Promise.resolve(executar()).then(res, rej); }
    };
    return b;
  };
  return { from };
}

async function carregarPagina() {
  const estado = {
    funcionarios: [
      { id: ID1, matricula: 'MAT-5001', nome: 'Funcionário Sem CPF', cargo: 'ESTIVADOR', codigo_individual: 'NX-5001-1', cpf: null, data_nascimento: null, ativo: true },
      { id: ID2, matricula: 'MAT-5002', nome: 'outra Pessoa', cargo: 'CONFERENTE_CARGA', codigo_individual: 'NX-5002-1', cpf: CPF_OUTRO, data_nascimento: '1992-03-15', ativo: true }
    ],
    visitantes: [],
    insercoes: [],
    atualizacoes: [],
    feedbacks: []
  };
  const janela = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: htmlDaPagina('tecnico_portos.html'),
    session: sessao('TECNICO_PORTOS', { matricula: 'MAT-9002', nome: 'Técnico de Testes' }),
    storage: { nexus_func_list: [], nexus_vis_list: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = clienteSupabase(estado);
        win.mostrarFeedback = (tipo, titulo, mensagem) => estado.feedbacks.push({ tipo, titulo, mensagem });
        win.console.warn = () => {};
      },
      'js/pages/tecnico_portos.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(80);
  return { janela, w: janela.w, estado };
}

async function esperar(condicao, limiteMs = 1500) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await aguardar(10);
  }
  return Boolean(condicao());
}

const titulos = (estado, titulo) => estado.feedbacks.filter(f => f.titulo === titulo);
const botoesEditar = (w) => Array.from(w.document.querySelectorAll('#funcCrudTableBody button'))
  .filter(b => b.textContent.trim() === 'Editar');
const enviar = (w) => w.document.getElementById('funcCrudForm')
  .dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));

async function main() {
  const janelas = [];
  try {
    log('1. Tabela: botão Editar por funcionário, sem expor matrícula no onclick');
    let p = await carregarPagina(); janelas.push(p.janela);
    check('há um botão Editar por funcionário', botoesEditar(p.w).length === 2, `botões=${botoesEditar(p.w).length}`);
    check('onclick usa só o índice (editarFuncionarioPorIndice)',
      botoesEditar(p.w).every(b => /editarFuncionarioPorIndice/.test(b.getAttribute('onclick') || '') && !/MAT-/.test(b.getAttribute('onclick') || '')));
    const tabelaAntes = p.w.document.getElementById('funcCrudTableBody').textContent;
    check('funcionário sem CPF/nascimento aparece para inclusão', tabelaAntes.includes('Funcionário Sem CPF'));

    log('\n2. Incluir CPF e nascimento de quem não tinha: UPDATE no banco, sem INSERT');
    p.w.editarFuncionarioPorIndice(0); // onclick inline não roda no jsdom (outside-only)
    await aguardar(30);
    const form = p.w.document.getElementById('funcCrudForm');
    check('clicar em Editar abre o formulário', !form.classList.contains('hidden'));
    check('matrícula/nome/cargo travados na edição',
      p.w.document.getElementById('funcMatricula').disabled === true &&
      p.w.document.getElementById('funcNome').disabled === true &&
      p.w.document.getElementById('funcCargo').disabled === true);
    check('botão de envio vira "Salvar Alterações"',
      p.w.document.getElementById('funcFormSubmitLabel').textContent === 'Salvar Alterações');
    p.w.document.getElementById('funcCpf').value = CPF_NOVO;
    p.w.document.getElementById('funcDataNasc').value = '1990-05-10';
    enviar(p.w);
    await esperar(() => titulos(p.estado, 'Funcionário Atualizado').length === 1);
    const func1 = p.estado.funcionarios.find(f => f.id === ID1);
    check('feedback de atualização exibido', titulos(p.estado, 'Funcionário Atualizado').length === 1, JSON.stringify(p.estado.feedbacks));
    check('banco atualizado com CPF só dígitos e nascimento ISO',
      func1.cpf === CPF_NOVO_DIGITOS && func1.data_nascimento === '1990-05-10', JSON.stringify(func1));
    check('foi UPDATE (não INSERT)', p.estado.atualizacoes.length === 1 && p.estado.insercoes.length === 0,
      `updates=${p.estado.atualizacoes.length}, inserts=${p.estado.insercoes.length}`);
    const tabelaDepois = p.w.document.getElementById('funcCrudTableBody').textContent;
    check('tabela exibe CPF formatado e nascimento dd/mm/aaaa',
      tabelaDepois.includes(CPF_NOVO) && tabelaDepois.includes('10/05/1990'), tabelaDepois.slice(0, 200));
    check('cache local atualizado', (JSON.parse(p.w.localStorage.getItem('nexus_func_list')) || [])
      .some(f => f.matricula === 'MAT-5001' && f.cpf === CPF_NOVO_DIGITOS));
    check('formulário fechou após salvar', form.classList.contains('hidden'));

    log('\n3. Manter o próprio CPF não é duplicidade; trocar a data atualiza');
    p = await carregarPagina(); janelas.push(p.janela);
    p.w.editarFuncionarioPorIndice(1); // idem: entrada real é o onclick do botão
    await aguardar(30);
    check('edição abre com o CPF atual preenchido',
      p.w.document.getElementById('funcCpf').value === '111.222.333-44', p.w.document.getElementById('funcCpf').value);
    p.w.document.getElementById('funcDataNasc').value = '1990-01-20';
    enviar(p.w);
    await esperar(() => titulos(p.estado, 'Funcionário Atualizado').length === 1);
    const func2 = p.estado.funcionarios.find(f => f.id === ID2);
    check('próprio CPF mantido sem bloqueio', titulos(p.estado, 'CPF Já Cadastrado').length === 0, JSON.stringify(p.estado.feedbacks));
    check('nova data gravada e CPF preservado', func2.data_nascimento === '1990-01-20' && func2.cpf === CPF_OUTRO, JSON.stringify(func2));

    log('\n4. CPF de outra pessoa e nascimento de menor: bloqueados, nada gravado');
    p = await carregarPagina(); janelas.push(p.janela);
    p.w.editarFuncionarioPorIndice(0); // onclick inline não roda no jsdom (outside-only)
    await aguardar(30);
    p.w.document.getElementById('funcCpf').value = '111.222.333-44'; // CPF da outra Pessoa
    p.w.document.getElementById('funcDataNasc').value = '1990-05-10';
    enviar(p.w);
    await esperar(() => titulos(p.estado, 'CPF Já Cadastrado').length === 1);
    check('CPF de outra pessoa bloqueado', titulos(p.estado, 'CPF Já Cadastrado').length === 1, JSON.stringify(p.estado.feedbacks));
    check('nada foi gravado', p.estado.atualizacoes.length === 0 && !p.estado.funcionarios.find(f => f.id === ID1).cpf);
    p.w.document.getElementById('funcCpf').value = CPF_NOVO;
    p.w.document.getElementById('funcDataNasc').value = '2015-01-01'; // menor de idade
    enviar(p.w);
    await esperar(() => titulos(p.estado, 'Menor de Idade').length === 1);
    check('nascimento de menor bloqueado', titulos(p.estado, 'Menor de Idade').length === 1, JSON.stringify(p.estado.feedbacks));
    check('continua nada gravado', p.estado.atualizacoes.length === 0);

    log('\n5. Cancelar edição não deixa resíduo: "+ Cadastrar" volta a cadastrar');
    p.w.document.getElementById('cancelarEdicaoFuncionarioBtn').click();
    await aguardar(30);
    check('cancelar fecha o formulário', p.w.document.getElementById('funcCrudForm').classList.contains('hidden'));
    check('identidade destravada após cancelar', p.w.document.getElementById('funcMatricula').disabled === false);
    p.w.document.getElementById('toggleFuncFormBtn').click();
    await aguardar(30);
    check('reabrir mostra "Salvar Funcionário" (cadastro novo)',
      p.w.document.getElementById('funcFormSubmitLabel').textContent === 'Salvar Funcionário');
    p.w.document.getElementById('funcMatricula').value = 'MAT-5003';
    p.w.document.getElementById('funcNome').value = 'Pessoa Nova';
    p.w.document.getElementById('funcCpf').value = CPF_NOVO;
    p.w.document.getElementById('funcDataNasc').value = '1988-07-22';
    enviar(p.w);
    await esperar(() => titulos(p.estado, 'Funcionário Cadastrado').length === 1);
    check('cadastro novo continua funcionando (INSERT)',
      p.estado.insercoes.length === 1 && titulos(p.estado, 'Funcionário Cadastrado').length === 1,
      `inserts=${p.estado.insercoes.length}, feedbacks=${JSON.stringify(p.estado.feedbacks)}`);
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
}

main();
