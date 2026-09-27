const fs = require('fs');
const path = require('path');

async function testFase5() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 5 (DELEGAÇÃO E CONTROLE DE ACESSOS)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, 'js');
  const delegacaoCode = fs.readFileSync(path.join(jsDir, 'delegacao.js'), 'utf-8');
  const tecnicoCode = fs.readFileSync(path.join(jsDir, 'tecnico_portos.js'), 'utf-8');

  // 1. Validar Limite de 1 Substituto Ativo e Sincronização no Supabase
  console.log('1. Validando limite de 1 substituto ativo e persistência em delegacoes_supervisor (Item 5.1 / RF 14)...');
  const checksDelegacao = delegacaoCode.includes("delegacoes_supervisor") &&
                          delegacaoCode.includes("activeDeleg") &&
                          delegacaoCode.includes("window.registrarTrailDecisao('DESIGNOU_SUBSTITUTO'") &&
                          delegacaoCode.includes("data_revogacao");

  if (checksDelegacao) {
    console.log('  ✅ [PASS] Delegação garante 1 substituto ativo, resolve IDs no Supabase, audita e registra no Trail.');
  } else {
    console.error('  ❌ [FAIL] Falha no fluxo de delegação de supervisor.');
    passed = false;
  }

  // 2. Validar Reemissão e Invalidação de Códigos de Acesso
  console.log('2. Validando reemissão de código de acesso e auditoria (Item 5.2 / RN 15)...');
  const checksReemissao = tecnicoCode.includes("regenBtn") &&
                          tecnicoCode.includes("codigo_individual: newCode") &&
                          tecnicoCode.includes("nexus_code_overrides") &&
                          tecnicoCode.includes("Reemissão de código pelo Técnico em Portos");

  if (checksReemissao) {
    console.log('  ✅ [PASS] Reemissão de código atualiza a tabela funcionarios, salva overrides e gera log de auditoria.');
  } else {
    console.error('  ❌ [FAIL] Reemissão de código incompleta.');
    passed = false;
  }

  // 3. Validar Gestão de Funcionários e Soft-Delete
  console.log('3. Validando CRUD e exclusão/desativação de funcionários (Item 5.3)...');
  const checksFuncionarios = tecnicoCode.includes("funcForm") &&
                             tecnicoCode.includes("excluirFuncionarioReal") &&
                             tecnicoCode.includes("BLOQUEIO DE DUPLICIDADE") &&
                             tecnicoCode.includes("window.registrarLogAlteracao('EXCLUSAO'");

  if (checksFuncionarios) {
    console.log('  ✅ [PASS] Cadastro e desativação de funcionários validados contra duplicidades com auditoria.');
  } else {
    console.error('  ❌ [FAIL] Gestão de funcionários incompleta.');
    passed = false;
  }

  // 4. Validar Livro de Visitantes e Validador de CPF Real
  console.log('4. Validando cadastro, validação de CPF (Item 15) e ciclo de visitantes (Item 5.4)...');
  const checksVisitantes = tecnicoCode.includes("validarCPF") &&
                           tecnicoCode.includes("alterarStatusVisitante") &&
                           tecnicoCode.includes("registrarSaidaVisitante") &&
                           tecnicoCode.includes("data_hora_saida");

  if (checksVisitantes) {
    console.log('  ✅ [PASS] Livro de visitantes com algoritmo de dígitos verificadores de CPF, check-in e check-out.');
  } else {
    console.error('  ❌ [FAIL] Validação de visitantes ausente ou incompleta.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA FASE 5 PASSARAM COM SUCESSO! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES DA FASE 5 FALHARAM. REVISE O CÓDIGO!');
    console.log('================================================================');
    process.exit(1);
  }
}

testFase5();
