/**
 * test_vlibras.js
 * Teste automatizado para verificar a integração do widget VLibras em todas as páginas HTML do sistema.
 */

const fs = require('fs');
const path = require('path');

const PAGES = [
  'cargas.html',
  'confirm-role.html',
  'dashboard.html',
  'delegacao.html',
  'embarcacoes.html',
  'index.html',
  'inspecao.html',
  'manutencao.html',
  'relatorios.html',
  'scanner.html',
  'tecnico_portos.html',
  'teste-vibracao.html'
];

console.log('================================================================');
console.log('TESTE DE INTEGRAÇÃO — VLIBRAS WIDGET (TODAS AS PÁGINAS HTML)');
console.log('================================================================\n');

let passedCount = 0;
let failedCount = 0;

PAGES.forEach((page) => {
  const filePath = path.join(__dirname, '..', page);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ [FAIL] Arquivo ${page} não foi encontrado.`);
    failedCount++;
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  // Verificação 1: Div container com atributo vw e classe enabled
  const hasDivVw = content.includes('vw') && content.includes('vw-access-button') && content.includes('vw-plugin-wrapper');

  // Verificação 2: Script do plugin VLibras
  const hasPluginScript = content.includes('https://vlibras.gov.br/app/vlibras-plugin.js');

  // Verificação 3: Construtor da classe VLibras Widget
  const hasWidgetInit = content.includes('VLibras.Widget');

  if (hasDivVw && hasPluginScript && hasWidgetInit) {
    console.log(`  ✅ [PASS] ${page}: VLibras container, script e widget inicializado corretamente.`);
    passedCount++;
  } else {
    console.error(`  ❌ [FAIL] ${page}: Integração VLibras incompleta.`);
    if (!hasDivVw) console.error(`      - Faltando container <div vw ...>`);
    if (!hasPluginScript) console.error(`      - Faltando <script src="https://vlibras.gov.br/app/vlibras-plugin.js">`);
    if (!hasWidgetInit) console.error(`      - Faltando new window.VLibras.Widget(...)`);
    failedCount++;
  }
});

console.log('\n================================================================');
if (failedCount === 0) {
  console.log(`🎉 VLIBRAS INTEGRADO COM SUCESSO EM TODAS AS ${passedCount} PÁGINAS! 🎉`);
  console.log('================================================================');
  process.exit(0);
} else {
  console.error(`💥 FALHA NA INTEGRAÇÃO DO VLIBRAS EM ${failedCount} PÁGINAS.`);
  console.log('================================================================');
  process.exit(1);
}
