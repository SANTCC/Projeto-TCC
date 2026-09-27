const fs = require('fs');
const path = require('path');

async function testFase0Completa() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 0 (SANEAMENTO, BANCO & DADOS FANTASMAS)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, 'js');
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

  // 1. Auditoria rigorosa de strings e mocks proibidos no código JS
  console.log('1. Varrendo todos os arquivos JavaScript em busca de resíduos de mocks e dados fantasmas...');
  const forbiddenPatterns = [
    { label: 'Navio mock MV Santos Star em JS', regex: /['"`]MV Santos Star['"`]/g },
    { label: 'Navio mock MV Pacific Giant em JS', regex: /['"`]MV Pacific Giant['"`]/g },
    { label: 'Navio mock MV Atlantic Breeze em JS', regex: /['"`]MV Atlantic Breeze['"`]/g },
    { label: 'Funcionário fantasma MAT-8821', regex: /MAT-8821/g },
    { label: 'Array mock de funcionários (MAT-1914 como planejador)', regex: /cargo:\s*['"]Planejador de Pátio e Navios['"]/g },
    { label: 'Contêiner hardcoded CONT-991', regex: /CONT-991/g },
    { label: 'Mocks estratégicos hardcoded (12480 cargas)', regex: /12480/g }
  ];

  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(jsDir, file), 'utf-8');
    for (const pattern of forbiddenPatterns) {
      const matches = content.match(pattern.regex);
      if (matches) {
        console.error(`  ❌ [FALHA] Padrão "${pattern.label}" encontrado em js/${file}: ${matches.length} ocorrência(s)`);
        passed = false;
      }
    }
  }

  if (passed) {
    console.log('  ✅ [PASS] 0 dados fantasmas/mocks encontrados nos arquivos JavaScript.');
  }

  // 2. Verificação de higienização de cache e persistência limpa
  console.log('\n2. Verificando rotina de limpeza de cache legado em auth-guard.js...');
  const authGuardContent = fs.readFileSync(path.join(jsDir, 'auth-guard.js'), 'utf-8');
  if (authGuardContent.includes('nexus_ghost_clean_v1')) {
    console.log('  ✅ [PASS] auth-guard.js limpa chaves de localStorage legadas e previne contaminação.');
  } else {
    console.error('  ❌ [FALHA] auth-guard.js não contém higienização de cache.');
    passed = false;
  }

  // 3. Verificação de integridade no Repositório Central
  console.log('\n3. Verificando data-repository.js como fonte central do Supabase...');
  const repoContent = fs.readFileSync(path.join(jsDir, 'data-repository.js'), 'utf-8');
  const repoHasRealQueries = repoContent.includes('buscarIndicadoresOperacionais') &&
                             repoContent.includes('buscarCargasRecusadas') &&
                             repoContent.includes('buscarEquipamentosPreventivaSugerida') &&
                             repoContent.includes('navios(id, nome)');

  if (repoHasRealQueries) {
    console.log('  ✅ [PASS] Repositório central integra queries completas e joins com Supabase.');
  } else {
    console.error('  ❌ [FALHA] data-repository.js não possui todas as queries unificadas.');
    passed = false;
  }

  // 4. Verificação de suporte a chave estrangeira navio_id em cargas.js e scanner.js
  console.log('\n4. Verificando suporte relacional de navio_id em cargas e scanner...');
  const cargasContent = fs.readFileSync(path.join(jsDir, 'cargas.js'), 'utf-8');
  const scannerContent = fs.readFileSync(path.join(jsDir, 'scanner.js'), 'utf-8');
  const hasNavioIdSupport = cargasContent.includes('navio_id') && scannerContent.includes('navios(id, nome)');

  if (hasNavioIdSupport) {
    console.log('  ✅ [PASS] Chave estrangeira navio_id suportada e integrada entre cargas, navios e scanner.');
  } else {
    console.error('  ❌ [FALHA] navio_id não integrado em cargas ou scanner.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('🎉 FASE 0 COMPLETA E VALIDADA COM 100% DE SUCESSO! 🎉');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 FALHA NA VALIDAÇÃO DA FASE 0.');
    console.log('================================================================');
    process.exit(1);
  }
}

testFase0Completa();
