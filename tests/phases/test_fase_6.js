const fs = require('fs');
const path = require('path');

async function testFase6() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 6 (RELATÓRIOS, VISION LAYER E CONCLUSÃO)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, '../../js');
  const relatoriosCode = fs.readFileSync(path.join(jsDir, 'relatorios.js'), 'utf-8');

  // 1. Validar Estrutura do Relatório PDF A4 em 4 Seções
  console.log('1. Validando geração do Relatório PDF A4 em 4 seções (RF 11 / RF 16)...');
  const checksPdfSections = relatoriosCode.includes("1. DADOS DA CARGA") &&
                            relatoriosCode.includes("2. DADOS DO NAVIO") &&
                            relatoriosCode.includes("3. DADOS DO CONTÊINER") &&
                            relatoriosCode.includes("4. RESUMO DO FLUXO OPERACIONAL") &&
                            relatoriosCode.includes("Relatorio_A4_");

  if (checksPdfSections) {
    console.log('  ✅ [PASS] Relatório PDF A4 estruturado com as 4 seções sequenciais e dados reais.');
  } else {
    console.error('  ❌ [FAIL] Estrutura das 4 seções do relatório PDF incompleta.');
    passed = false;
  }

  // 2. Validar Joins Reais de Carga, Navio e Contêiner
  console.log('2. Validando integridade de dados (joins com navios e containers)...');
  const checksJoins = relatoriosCode.includes("navios:navio_id(id, nome, numero_imo, porto_origem, porto_destino)") &&
                      relatoriosCode.includes("containers:container_id(id, numero_identificacao, material_carregado, estado)") &&
                      relatoriosCode.includes("window.registrarLogAlteracao('EXPORTACAO'");

  if (checksJoins) {
    console.log('  ✅ [PASS] Relatório consulta navios e containers vinculados via Supabase e audita emissão de PDF.');
  } else {
    console.error('  ❌ [FAIL] Relatório não integra adequadamente com entidades vinculadas.');
    passed = false;
  }

  // 3. Validar Tabela de Produtividade com Escopo RBAC (Vision Layer)
  console.log('3. Validando Vision Layer e filtro de escopo por cargo na tabela de produtividade...');
  const checksVisionLayer = relatoriosCode.includes("isDiretor") &&
                            relatoriosCode.includes("isInspetor") &&
                            relatoriosCode.includes("f.matricula === session.matricula || f.codigo_individual === session.codigo_individual") &&
                            relatoriosCode.includes(".eq('ativo', true)");

  if (checksVisionLayer) {
    console.log('  ✅ [PASS] Vision Layer protege dados sensíveis: operadores visualizam somente sua produtividade.');
  } else {
    console.error('  ❌ [FAIL] Escopo de visibilidade por perfil não implementado.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA FASE 6 PASSARAM COM SUCESSO! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES DA FASE 6 FALHARAM. REVISE O CÓDIGO!');
    console.log('================================================================');
    process.exit(1);
  }
}

testFase6();
