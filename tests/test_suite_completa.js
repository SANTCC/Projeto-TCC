const { execSync } = require('child_process');

console.log('================================================================');
console.log('🚀 EXECUTANDO SUITE COMPLETA DE TESTES DEFINITIVOS (NEXUSPORT)');
console.log('================================================================\n');

const testScripts = [
  { name: 'Fase 0 - Saneamento, Banco & Eliminação de Dados Fantasmas', file: 'test_fase_0.js' },
  { name: 'Fase 1 - Painel Geral & Sincronização Total', file: 'test_fase_1.js' },
  { name: 'Fase 2 - Fluxo de Cargas, Inspeção e Scanner', file: 'test_fase_2.js' },
  { name: 'Fase 3 - Embarcações, Rotas e Contêineres', file: 'test_fase_3.js' },
  { name: 'Fase 4 - Manutenção, Emergência e Ordens de Serviço', file: 'test_fase_4.js' },
  { name: 'Fase 5 - Delegação e Controle de Acessos', file: 'test_fase_5.js' },
  { name: 'Fase 6 - Relatórios, Vision Layer e Conclusão', file: 'test_fase_6.js' },
  { name: 'Fase 7 - Logs, Trail Imutável, Delegação e Gestão de Pessoas', file: 'test_fase_7.js' },
  { name: 'Fase 8 - Relatórios, Navbar Global, Resiliência e Homologação', file: 'test_fase_8.js' },
  { name: 'Fase 9 - Navbar, Componentes Compartilhados & Responsividade Global', file: 'test_fase_9.js' },
  { name: 'Fase 10 - Resiliência, Edge Cases, Integridade, Concorrência e CPF', file: 'test_fase_10.js' },
  { name: 'Fase 11 - Critérios de Aceite Finais & Certificação End-to-End', file: 'test_fase_11.js' }
];

let allPassed = true;

for (const test of testScripts) {
  try {
    console.log(`\n▶️ Executando: ${test.name} (${test.file})...`);
    execSync(`node ${test.file}`, { stdio: 'inherit' });
    console.log(`✅ [SUCESSO] ${test.name}`);
  } catch (err) {
    console.error(`❌ [FALHA] ${test.name}`);
    allPassed = false;
    break;
  }
}

console.log('\n================================================================');
if (allPassed) {
  console.log('🎉 TODAS AS 12 FASES (FASE 0 A FASE 11) FORAM TESTADAS E HOMOLOGADAS COM 100% DE ÊXITO! 🎉');
  console.log('================================================================');
  process.exit(0);
} else {
  console.error('💥 FALHA EM UMA OU MAIS FASES.');
  console.log('================================================================');
  process.exit(1);
}
