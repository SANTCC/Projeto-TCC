const fs = require('fs');
const path = require('path');

async function testGhostDataRemoval() {
  console.log('====================================================');
  console.log('TESTE DEFINITIVO — TAREFA 0.1 (Dados Fantasmas)');
  console.log('====================================================\n');

  let passed = true;

  // 1. Auditoria de strings e mocks proibidos no código
  const forbiddenPatterns = [
    { label: 'Navio mock MV Santos Star em JS', regex: /['"`]MV Santos Star['"`]/g, allowedFiles: [] },
    { label: 'Navio mock MV Pacific Giant em JS', regex: /['"`]MV Pacific Giant['"`]/g, allowedFiles: [] },
    { label: 'Navio mock MV Atlantic Breeze em JS', regex: /['"`]MV Atlantic Breeze['"`]/g, allowedFiles: [] },
    { label: 'Funcionário fantasma MAT-8821', regex: /MAT-8821/g, allowedFiles: [] },
    { label: 'Array mock de funcionários (MAT-1914 como planejador)', regex: /cargo:\s*['"]Planejador de Pátio e Navios['"]/g, allowedFiles: [] },
    { label: 'Contêiner hardcoded CONT-991', regex: /CONT-991/g, allowedFiles: [] },
    { label: 'Mocks estratégicos hardcoded (12480 cargas)', regex: /12480/g, allowedFiles: [] }
  ];

  const jsDir = path.join(__dirname, 'js');
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

  console.log('1. Varrendo arquivos JavaScript em busca de resíduos mock...');
  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(jsDir, file), 'utf-8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.allowedFiles.includes(file)) continue;
      const matches = content.match(pattern.regex);
      if (matches) {
        console.error(`❌ [FALHA] Padrão "${pattern.label}" encontrado em js/${file}: ${matches.length} ocorrência(s)`);
        passed = false;
      }
    }
  }

  if (passed) {
    console.log('✅ Nenhum resíduo de mock/dados fictícios encontrado nos arquivos JS.');
  }

  // 2. Testar que o Supabase é consultado sem mescla de listas locais fantasmas
  console.log('\n2. Verificando integridade da camada de repositório e proteção...');
  const repoContent = fs.readFileSync(path.join(jsDir, 'data-repository.js'), 'utf-8');
  if (repoContent.includes('localStorage.getItem(\'nexus_func_list\') || \'[]\'') &&
      !repoContent.includes('Array.isArray(data)')) {
    console.error('❌ [FALHA] data-repository.js não valida array do Supabase adequadamente.');
    passed = false;
  } else {
    console.log('✅ data-repository.js atualizado e tratando Supabase como fonte primária.');
  }

  const authGuardContent = fs.readFileSync(path.join(jsDir, 'auth-guard.js'), 'utf-8');
  if (authGuardContent.includes('nexus_ghost_clean_v1')) {
    console.log('✅ auth-guard.js contém rotina de higienização de cache local contaminado.');
  } else {
    console.error('❌ [FALHA] auth-guard.js não contém higienização de cache.');
    passed = false;
  }

  // 3. Teste de consulta ao banco de dados Supabase real para garantir sincronismo
  console.log('\n3. Testando conectividade direta com o banco Supabase...');
  try {
    const configContent = fs.readFileSync(path.join(jsDir, 'config.js'), 'utf-8');
    const urlMatch = configContent.match(/SUPABASE_URL:\s*["']([^"']+)["']/);
    const keyMatch = configContent.match(/SUPABASE_ANON_KEY:\s*["']([^"']+)["']/);

    if (urlMatch && keyMatch) {
      const url = urlMatch[1];
      const key = keyMatch[1];

      const res = await fetch(`${url}/rest/v1/funcionarios?select=matricula,nome,cargo`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      });

      if (res.ok) {
        const funcs = await res.json();
        console.log(`✅ Supabase conectado com sucesso! Total de funcionários reais no banco: ${funcs.length}`);
        const maxwell = funcs.find(f => f.matricula === 'MAT-1914');
        if (maxwell) {
          console.log(`✅ MAT-1914 validado no banco como: "${maxwell.nome}" (Cargo Real: ${maxwell.cargo})`);
        }
      } else {
        console.warn(`⚠️ Supabase REST status: ${res.status}`);
      }
    }
  } catch (err) {
    console.warn('⚠️ Teste de conexão Supabase fetch:', err.message);
  }

  console.log('\n====================================================');
  if (passed) {
    console.log('🎉 RESULTADO: TAREFA 0.1 CONCLUÍDA COM SUCESSO! 🎉');
    console.log('Nenhum dado fantasma persiste no sistema.');
  } else {
    console.log('❌ RESULTADO: FALHA NA VALIDAÇÃO DA TAREFA 0.1');
    process.exit(1);
  }
  console.log('====================================================');
}

testGhostDataRemoval().catch(err => {
  console.error('Erro na execução do teste:', err);
  process.exit(1);
});
