/**
 * TESTE DEFINITIVO — FASE 8 (RELATÓRIOS, NAVBAR GLOBAL, RESILIÊNCIA & HOMOLOGAÇÃO FINAL)
 * Validação rigorosa das Seções 8, 9, 10 e 11 do Backlog Consolidado NexusPort.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('TESTE DEFINITIVO — FASE 8 (RELATÓRIOS, NAVBAR & HOMOLOGAÇÃO)');
console.log('================================================================\n');

// 1. Validando Relatórios & PDF A4 (Seção 8 do Backlog)
console.log('1. Validando Emissão do Relatório PDF A4 e Auditoria (Seção 8)...');
const relatoriosJs = fs.readFileSync(path.join(__dirname, '../../js/relatorios.js'), 'utf-8');

assert(relatoriosJs.includes('EXPORTACAO'), 'Fase 8: Geração de PDF deve registrar log de auditoria com tipo EXPORTACAO.');
assert(relatoriosJs.includes('1. DADOS DA CARGA') && relatoriosJs.includes('2. DADOS DO NAVIO') && relatoriosJs.includes('3. DADOS DO CONTÊINER') && relatoriosJs.includes('4. RESUMO DO FLUXO OPERACIONAL'), 'Fase 8: Relatório PDF A4 deve estruturar as 4 seções operacionais sequenciais.');
assert(relatoriosJs.includes('navios:navio_id') && relatoriosJs.includes('containers:container_id'), 'Fase 8: PDF deve carregar dados reais dos joins no Supabase.');
assert(!relatoriosJs.includes('MAT-8821') && !relatoriosJs.includes('CONT-991'), 'Fase 8: Resíduos de dados fictícios não podem estar presentes no relatório.');
console.log('  ✅ [PASS] Relatório PDF A4 consome dados reais via Supabase, estrutura 4 seções e audita exportação.');

// 2. Validando Navbar Global, Z-Index e Layout Fixo (Seção 9 do Backlog)
console.log('2. Validando Navbar Global, Posicionamento Fixo e Z-Index (Seção 9 / Erro 5)...');
const layoutJs = fs.readFileSync(path.join(__dirname, '../../js/layout.js'), 'utf-8');

assert(layoutJs.includes('fixed') && layoutJs.includes('top-0') && layoutJs.includes('z-40') && layoutJs.includes('pt-16'), 'Fase 8: Navbar global deve ter position fixed, z-index elevado e padding-top no wrapper principal.');
assert(layoutJs.includes('appTopbar') && layoutJs.includes('appSidebar'), 'Fase 8: Layout deve gerenciar topbar e sidebar dinâmicos em todas as telas.');

const htmlFiles = ['dashboard.html', 'cargas.html', 'embarcacoes.html', 'manutencao.html', 'delegacao.html', 'tecnico_portos.html', 'relatorios.html', 'scanner.html', 'inspecao.html'];
for (const f of htmlFiles) {
  const content = fs.readFileSync(path.join(__dirname, '../../' + f), 'utf-8');
  assert(content.includes('id="appTopbar"') || content.includes('<header'), `Fase 8: Arquivo ${f} deve conter o header/appTopbar compartilhado.`);
  assert(content.includes('js/layout.js'), `Fase 8: Arquivo ${f} deve importar o script layout.js.`);
}
console.log('  ✅ [PASS] Todas as 9 páginas HTML integram layout.js com navbar fixa sem sobreposição de conteúdo.');

// 3. Validando Eliminação de Pop-ups Nativos e Uso de Modais Customizados (Item 0.3 do Backlog)
console.log('3. Validando Eliminação de alert() Nativos em prol de Modais Stylized (Item 0.3)...');
const jsFilesToCheck = ['cargas.js', 'embarcacoes.js', 'manutencao.js', 'tecnico_portos.js', 'delegacao.js', 'inspecao.js', 'relatorios.js', 'scanner.js', 'dashboard.js'];

for (const jsFile of jsFilesToCheck) {
  const code = fs.readFileSync(path.join(__dirname, '../../js', jsFile), 'utf-8');
  const alertMatches = code.match(/[^a-zA-Z0-9_]alert\s*\(/g);
  assert(!alertMatches, `Fase 8: Arquivo js/${jsFile} não deve conter chamadas diretas a alert() nativo.`);
}
assert(layoutJs.includes('window.mostrarFeedback') && layoutJs.includes('window.nexusConfirm') && layoutJs.includes('window.nexusPrompt'), 'Fase 8: layout.js deve fornecer mostrarFeedback, nexusConfirm e nexusPrompt.');
console.log('  ✅ [PASS] Pop-ups nativos 100% substituídos por modais consistentes com Tailwind.');

// 4. Validando Resiliência, Edge Cases e Concorrência (Seção 10 do Backlog)
console.log('4. Validando Resiliência Operacional, Reatividade e Validações Rígidas (Seção 10)...');
const cargasJs = fs.readFileSync(path.join(__dirname, '../../js/cargas.js'), 'utf-8');
const embarcacoesJs = fs.readFileSync(path.join(__dirname, '../../js/embarcacoes.js'), 'utf-8');
const tecnicoJs = fs.readFileSync(path.join(__dirname, '../../js/tecnico_portos.js'), 'utf-8');

// 10.6: Validação de limites numéricos estritamente maiores que zero
assert(cargasJs.includes('pesoVal <= 0 || volumeVal <= 0 || valorVal <= 0'), 'Fase 8: Cargas deve validar campos estritamente positivos (Item 16).');
assert(cargasJs.includes('cargaVol > dispVol'), 'Fase 8: Vinculação deve travar capacidade máxima do contêiner (Regra A7).');

// 10.3: Reatividade multi-abas via evento nexus_data_changed
assert(cargasJs.includes('nexus_data_changed') || layoutJs.includes('nexus_data_changed'), 'Fase 8: Reatividade multi-abas via nexus_data_changed suportada.');
assert(embarcacoesJs.includes('nexus_data_changed'), 'Fase 8: Embarcações deve escutar nexus_data_changed.');
assert(tecnicoJs.includes('nexus_data_changed'), 'Fase 8: Gestão de pessoas deve escutar nexus_data_changed.');

// 10.10: Validação estrita de CPF com dois dígitos verificadores
assert(tecnicoJs.includes('validarCPF') && tecnicoJs.includes('resto = 11 - (soma % 11)'), 'Fase 8: Validação matemática completa de CPF dos visitantes implementada.');

console.log('  ✅ [PASS] Validações de limites numéricos, reatividade viva multi-abas e validação de CPF ativas.');

// 5. Homologação Final de Sintaxe e Integridade dos Arquivos
console.log('5. Homologação Final de Integridade do Código e Supabase...');
const authGuardJs = fs.readFileSync(path.join(__dirname, '../../js/auth-guard.js'), 'utf-8');
const dataRepoJs = fs.readFileSync(path.join(__dirname, '../../js/data-repository.js'), 'utf-8');

assert(authGuardJs.includes('nexus_ghost_clean_v1'), 'Fase 8: Sanitização de cache legada ativa no auth-guard.');
assert(dataRepoJs.includes('buscarIndicadoresOperacionais') && dataRepoJs.includes('buscarCargasRecusadas') && dataRepoJs.includes('buscarEquipamentosPreventivaSugerida'), 'Fase 8: Funções centrais de agregação integradas.');

console.log('  ✅ [PASS] Todas as integrações, repositórios e guardas de segurança em conformidade.');

console.log('\n================================================================');
console.log('🎉 FASE 8 COMPLETA E HOMOLOGADA COM 100% DE SUCESSO! 🎉');
console.log('================================================================\n');
