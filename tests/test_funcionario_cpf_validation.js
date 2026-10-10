#!/usr/bin/env node
/**
 * TESTE — VALIDAÇÃO DE CPF NO CADASTRO DE FUNCIONÁRIOS (tecnico_portos.html)
 * ----------------------------------------------------------------------------
 * O campo de CPF do cadastro de funcionários sugeria o placeholder
 * "Ex: 123.456.789-00", um CPF cujos dígitos verificadores são inválidos: quem
 * copiava o exemplo tinha o cadastro recusado sem entender o motivo.
 *
 * A correção troca o exemplo por uma orientação neutra (a máscara é automática e
 * os dígitos verificadores precisam conferir) e este teste garante, com a página
 * real montada em jsdom e o módulo js/pages/tecnico_portos.js executando:
 *   1. o placeholder não sugere mais um CPF de exemplo;
 *   2. a página orienta sobre os dígitos verificadores (texto de ajuda + aria);
 *   3. o envio com o exemplo antigo é recusado (dígito verificador inválido);
 *   4. CPFs de dígitos repetidos ou incompletos também são recusados;
 *   5. a mensagem de erro explica a regra, sem repetir exemplo enganoso;
 *   6. um CPF válido é aceito: gravado só com dígitos e exibido formatado;
 *   7. a máscara automática formata os 11 dígitos e o valor mascarado é aceito.
 *
 * Uso: node tests/test_funcionario_cpf_validation.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const PAGINA = 'tecnico_portos.html';
const CPF_EXEMPLO_ANTIGO = '123.456.789-00'; // dígitos verificadores inválidos
const CPF_VALIDO = '529.982.247-25';
const CPF_VALIDO_DIGITOS = '52998224725';
const MATRICULA = 'MAT-4321';
const NASCIMENTO = '1985-04-12';
const ID_INSERIDO = '44444444-4444-4444-8444-444444444444';

/** Cliente Supabase mínimo: só o suficiente para o CRUD de funcionários da página. */
function clienteSupabase(estado) {
  const encadeamento = (tabela) => {
    const enc = {
      select() { return enc; },
      order() { return enc; },
      eq() { return enc; },
      or() { return enc; },
      update() { return enc; },
      insert(payload) {
        estado.insercoes.push({ tabela, payload });
        if (tabela === 'funcionarios') estado.funcionarios.push(payload);
        return enc;
      },
      single() { return Promise.resolve({ data: { id: ID_INSERIDO }, error: null }); },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
      then(resolver, rejeitar) {
        const dados = tabela === 'funcionarios' ? estado.funcionarios : estado.visitantes;
        return Promise.resolve({ data: dados, error: null }).then(resolver, rejeitar);
      }
    };
    return enc;
  };
  return { from: (tabela) => encadeamento(tabela) };
}

async function carregarPagina() {
  const estado = { funcionarios: [], visitantes: [], insercoes: [], feedbacks: [] };
  const janela = criarJanela({
    url: `https://nexusport.test/${PAGINA}`,
    html: htmlDaPagina(PAGINA),
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
  const w = janela.w;
  await prontoDom(w);
  await aguardar(60);
  return { janela, w, estado };
}

function preencherFormulario(w, cpf) {
  w.document.getElementById('funcMatricula').value = MATRICULA;
  w.document.getElementById('funcNome').value = 'Funcionário de Teste';
  if (cpf !== undefined) w.document.getElementById('funcCpf').value = cpf;
  w.document.getElementById('funcDataNasc').value = NASCIMENTO;
}

/** Envia o formulário real; `cpf` undefined mantém o valor já digitado. */
function enviarFormulario(w, cpf) {
  preencherFormulario(w, cpf);
  w.document.getElementById('funcCrudForm')
    .dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

async function esperar(condicao, limiteMs = 1200) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await aguardar(10);
  }
  return Boolean(condicao());
}

const titulos = (estado, titulo) => estado.feedbacks.filter((f) => f.titulo === titulo);

(async function main() {
  log('=== Testes — validação de CPF no cadastro de funcionários ===');
  const janelas = [];
  try {
    // ------------------------------------------------------------------
    log('\n1. Interface: placeholder neutro e orientação sobre os dígitos verificadores');
    const paginaA = await carregarPagina();
    janelas.push(paginaA.janela);
    const campoCpf = paginaA.w.document.getElementById('funcCpf');
    const placeholder = campoCpf ? (campoCpf.getAttribute('placeholder') || '') : '';
    check('o placeholder não sugere mais o exemplo inválido 123.456.789-00',
      Boolean(campoCpf) && !/123\.456\.789-00/.test(placeholder) && !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(placeholder),
      `placeholder="${placeholder}"`);

    const ajuda = paginaA.w.document.getElementById('funcCpfAjuda');
    const textoAjuda = ajuda ? String(ajuda.textContent || '').replace(/\s+/g, ' ').trim() : '';
    check('a página explica que os dígitos verificadores precisam ser válidos',
      Boolean(ajuda) && campoCpf.getAttribute('aria-describedby') === 'funcCpfAjuda' &&
      /d[íi]gitos? verificador/i.test(textoAjuda) && /v[áa]lid/i.test(textoAjuda),
      `ajuda="${textoAjuda}"`);

    // ------------------------------------------------------------------
    log('\n2. Formulário real: CPF inválido não cadastra e explica o motivo');
    enviarFormulario(paginaA.w, CPF_EXEMPLO_ANTIGO);
    await esperar(() => titulos(paginaA.estado, 'CPF Inválido').length > 0);
    check('o envio com o exemplo antigo (dígito verificador inválido) é recusado',
      titulos(paginaA.estado, 'CPF Inválido').length === 1 && paginaA.estado.insercoes.length === 0,
      `recusas=${titulos(paginaA.estado, 'CPF Inválido').length}, inserções=${paginaA.estado.insercoes.length}`);

    enviarFormulario(paginaA.w, '111.111.111-11'); // dígitos repetidos
    enviarFormulario(paginaA.w, '12345'); // incompleto
    await esperar(() => titulos(paginaA.estado, 'CPF Inválido').length >= 3);
    check('CPFs de dígitos repetidos ou incompletos também são recusados',
      titulos(paginaA.estado, 'CPF Inválido').length === 3 && paginaA.estado.insercoes.length === 0,
      `recusas=${titulos(paginaA.estado, 'CPF Inválido').length}, inserções=${paginaA.estado.insercoes.length}`);

    const mensagem = String((paginaA.estado.feedbacks[0] || {}).mensagem || '');
    check('a mensagem de erro explica a regra dos dígitos verificadores, sem exemplo enganoso',
      /d[íi]gitos? verificador/i.test(mensagem) && !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(mensagem),
      `mensagem="${mensagem}"`);

    // ------------------------------------------------------------------
    log('\n3. CPF válido: aceito, gravado somente com dígitos e exibido formatado');
    const paginaB = await carregarPagina();
    janelas.push(paginaB.janela);
    enviarFormulario(paginaB.w, CPF_VALIDO);
    await esperar(() => paginaB.estado.insercoes.length > 0);
    await aguardar(80);
    const payload = (paginaB.estado.insercoes[0] || {}).payload || {};
    const tabela = paginaB.w.document.getElementById('funcCrudTableBody').textContent || '';
    check('um CPF válido é aceito (sucesso, payload só com dígitos e linha formatada)',
      titulos(paginaB.estado, 'Funcionário Cadastrado').length === 1 &&
      titulos(paginaB.estado, 'CPF Inválido').length === 0 &&
      payload.cpf === CPF_VALIDO_DIGITOS &&
      tabela.includes(CPF_VALIDO) && tabela.includes(MATRICULA),
      `sucessos=${titulos(paginaB.estado, 'Funcionário Cadastrado').length}, cpf="${payload.cpf}", tabela="${tabela.slice(0, 120)}"`);

    // ------------------------------------------------------------------
    log('\n4. Máscara automática: formata a digitação preservando o CPF');
    const campoDigitado = paginaA.w.document.getElementById('funcCpf');
    campoDigitado.value = CPF_VALIDO_DIGITOS;
    campoDigitado.dispatchEvent(new paginaA.w.Event('input', { bubbles: true }));
    const mascarado = campoDigitado.value;
    enviarFormulario(paginaA.w); // mantém o valor mascarado
    await esperar(() => paginaA.estado.insercoes.length > 0);
    const payloadMascarado = (paginaA.estado.insercoes[0] || {}).payload || {};
    check('a máscara formata os 11 dígitos e o CPF mascarado é aceito no envio',
      mascarado === CPF_VALIDO && paginaA.estado.insercoes.length === 1 &&
      payloadMascarado.cpf === CPF_VALIDO_DIGITOS &&
      titulos(paginaA.estado, 'Funcionário Cadastrado').length === 1,
      `mascarado="${mascarado}", cpf="${payloadMascarado.cpf}", inserções=${paginaA.estado.insercoes.length}`);
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach((janela) => { try { janela.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
})();
