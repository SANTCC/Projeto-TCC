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
  'seguranca.html',
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

  // Verificação 4 (Tarefa 10): Nenhum ícone nas páginas HTML possui texto interno que o VLibras leria antes do rótulo
  const iconesComTexto = content.match(/<(?:span|i)\b[^>]*(?:material-symbols-outlined|data-icon|fa-solid|fa-regular)[^>]*>([^<]+)<\/(?:span|i)>/g) || [];
  const naoVazios = iconesComTexto.filter((t) => />(\s*\S+\s*)</.test(t));
  if (naoVazios.length === 0) {
    console.log(`  ✅ [PASS] ${page}: Ícones sem texto de ligadura interno (compatível 100% com VLibras).`);
    passedCount++;
  } else {
    console.error(`  ❌ [FAIL] ${page}: Encontrados ícones com texto interno lido pelo VLibras:`, naoVazios.slice(0, 3));
    failedCount++;
  }
});

// Verificação 5 (Tarefa 10): Sidebar e restante do sistema em runtime (JSDOM)
try {
  const { JSDOM } = require('jsdom');
  const htmlDash = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  const dom = new JSDOM(htmlDash, { url: 'http://localhost/dashboard.html', runScripts: 'outside-only' });
  const w = dom.window;
  if (typeof w.matchMedia !== 'function') {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  const sessaoTeste = {
    id: '00000000-0000-4000-8000-000000000001',
    codigo_individual: 'NX-9001-DIR',
    matricula: 'MAT-9001',
    nome: 'Operador Teste',
    cargo: 'DIRETOR_OPERACOES_LOGISTICA',
    cargo_nome: 'Diretor de Operações e Logística',
    camada_visao: 'Visão Estratégica'
  };
  w.currentUserSession = sessaoTeste;
  w.localStorage.setItem('nexus_session', JSON.stringify(sessaoTeste));
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'security.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'session-cookies.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'auth-guard.js'), 'utf8'));
  w.currentUserSession = sessaoTeste;
  w.eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'layout.js'), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

  const linksSidebar = Array.from(w.document.querySelectorAll('#appSidebar .sidebar-nav-item'));
  const sidebarLimpa = linksSidebar.length > 0 && linksSidebar.every((a) => {
    const labelEl = a.querySelector('.sidebar-nav-label');
    const esperado = labelEl ? labelEl.textContent.trim() : '';
    const lidoPeloDom = a.textContent.trim();
    const lidoPeloVLibras = w.NexusVLibras && w.NexusVLibras.extrairTextoElemento(a);
    return esperado && lidoPeloDom === esperado && lidoPeloVLibras === esperado;
  });

  if (sidebarLimpa) {
    console.log('  ✅ [PASS] Sidebar: Todos os links da sidebar expõem apenas o nome da página em português para o VLibras (sem nome do ícone).');
    passedCount++;
  } else {
    console.error('  ❌ [FAIL] Sidebar: Algum item ainda contém o nome do ícone antes do texto da página.');
    failedCount++;
  }

  const sanitizadorOk = w.NexusVLibras &&
    w.NexusVLibras.limparTexto('dashboard Painel Geral') === 'Painel Geral' &&
    w.NexusVLibras.limparTexto('inventory_2 Cargas & Pátio') === 'Cargas & Pátio' &&
    w.NexusVLibras.limparTexto('fact_check Inspeção') === 'Inspeção' &&
    w.NexusVLibras.limparTexto('directions_boat Embarcações & Equipamentos') === 'Embarcações & Equipamentos';

  if (sanitizadorOk) {
    console.log('  ✅ [PASS] NexusVLibras: Sanitizador remove nomes técnicos de ícones em qualquer leitura do sistema.');
    passedCount++;
  } else {
    console.error('  ❌ [FAIL] NexusVLibras: Falha no sanitizador de texto do VLibras.');
    failedCount++;
  }
  dom.window.close();
} catch (err) {
  console.error('  ❌ [FAIL] Erro ao validar VLibras em runtime:', err.message);
  failedCount++;
}

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
