// test_backlog3_restantes.js
// Backlog 3 — TAREFAS 4 e 5: verificações de CÓDIGO-FONTE para os itens do
// backlog3 implementados nesta rodada que ainda não tinham suíte dedicada:
// cookies de sessão (1.x), Supabase Realtime (2), select de rotas (5),
// bloqueios de vínculo fora do Porto (1.5 em espaço), e anotações 3.3/3.4,
// 7a-7i e 8.x de UX/UI.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
function readFile(f) { return fs.readFileSync(path.join(ROOT, f), 'utf-8'); }

function assertIncludes(markers, label, fileName, content) {
  const missing = markers.filter(m => !content.includes(m));
  if (missing.length) {
    console.error(`\n❌ ${label} — ${fileName} sem:\n${missing.map(m => '  - ' + m).join('\n')}`);
    process.exit(1);
  }
  console.log(`✅ ${label} (${fileName})`);
}

function assertNotIncludes(marker, label, fileName, content) {
  if (content.includes(marker)) {
    console.error(`\n❌ ${label} — ${fileName} ainda contém: ${marker}`);
    process.exit(1);
  }
  console.log(`✅ ${label} (${fileName})`);
}

function assertSyntaxOk(f) { execSync(`node --check ${JSON.stringify(path.join(ROOT, f))}`); }

const srcAuthGuard  = readFile('js/auth-guard.js');
const srcConfirmRole = readFile('js/pages/confirm-role.js');
const srcRepo       = readFile('js/data-repository.js');
const srcEmb        = readFile('js/pages/embarcacoes.js');
const srcCargas     = readFile('js/pages/cargas.js');
const srcManut      = readFile('js/pages/manutencao.js');
const srcDash       = readFile('js/pages/dashboard.js');
const srcLayout     = readFile('js/layout.js');
const srcScanner    = readFile('js/pages/scanner.js');
const embHtml       = readFile('embarcacoes.html');
const cargasHtml    = readFile('cargas.html');
const manutHtml     = readFile('manutencao.html');
const dashHtml      = readFile('dashboard.html');
const scannerHtml   = readFile('scanner.html');

// ─── 1.x Sessão via Cookies ───
assertIncludes([
  'SESSION_COOKIE_MAX_AGE_SECONDS', 'setSessionCookie', 'getSessionCookie',
  'clearSessionCookie', 'establishSession', 'sessionExpired', 'SameSite=Lax',
], 'Bug 1.1: auth-guard implementa cookie de sessão com expiração de turno (12h)', 'js/auth-guard.js', srcAuthGuard);

assertIncludes(['establishSession'],
  'Bug 1.3: confirm-role persiste a sessão via cookie (NexusAuth.establishSession)', 'js/pages/confirm-role.js', srcConfirmRole);
assertNotIncludes("sessionStorage.setItem('nexus_session'",
  'Bug 1.3: confirm-role NÃO grava mais a sessão no sessionStorage', 'js/pages/confirm-role.js', srcConfirmRole);

// ─── 2. Supabase Realtime ───
assertIncludes([
  'REALTIME_TABLES', 'iniciarSincronizacaoRealtime', 'pararSincronizacaoRealtime',
  'postgres_changes', '_realtimeDebounce', 'nexus_data_changed',
], 'Bug 2: data-repository assina canais Supabase Realtime com debounce', 'js/data-repository.js', srcRepo);
['cargas', 'navios', 'manutencoes', 'guindastes', 'rotas_maritimas', 'logs_alteracoes', 'trail_decisoes'].forEach(t => {
  assertIncludes([`'${t}'`], `Bug 2: tabela ${t} listada para Realtime`, 'js/data-repository.js', srcRepo);
});
assertIncludes(['periodic_sync'],
  'Bug 2: polling periódico permanece como fallback seguro', 'js/data-repository.js', srcRepo);

// ─── 5. Select de Rota Marítima (navio herda origem/destino/distância) ───
assertIncludes([
  'preencherSelectRotasNavio', "document.getElementById('navioRotaSelect')",
  'ROTA MARÍTIMA OBRIGATÓRIA', 'rotas_maritimas',
], 'Bug 5: form de navio exige rota cadastrada (sem registro manual de destino)', 'js/pages/embarcacoes.js', srcEmb);
assertIncludes(['id="navioRotaSelect"'],
  'Bug 5: embarcacoes.html usa select de rota marítima', 'embarcacoes.html', embHtml);

// ─── 1.5: bloqueio de vínculo com navio fora do Porto de Santos ───
assertIncludes(['Vinculação Bloqueada', 'DENTRO_DO_PORTO', 'Porto de Santos'],
  'Bug 1.5: vinculação de carga a contêiner de navio fora do porto é bloqueada', 'js/pages/cargas.js', srcCargas);

// ─── 3.3: botões de ação legíveis (ícone ≥18px, alvo de toque grande, labels ocultos no mobile) ───
assertIncludes([
  'text-[18px]', 'min-w-[44px] min-h-[40px] justify-center', 'hidden sm:inline', 'aria-label',
], '3.3: botões da tabela de cargas com ícone maior + aria-label + alvo de toque', 'js/pages/cargas.js', srcCargas);

// ─── 3.4: estivador responsável no cadastro ───
assertIncludes([
  'agEstivadorResponsavel', 'preencherSelectEstivadorResponsavel', 'obterEstivadorSelecionado',
  'funcionarioDaSessao', 'isGestorRole',
], '3.4: cadastro de carga define estivador responsável', 'js/pages/cargas.js', srcCargas);
assertIncludes(['estivador_cargas'],
  '3.4: vínculo carga↔estivador persistido em estivador_cargas', 'js/pages/cargas.js + js/data-repository.js',
  srcCargas + srcRepo);
assertIncludes(['id="agEstivadorResponsavel"'],
  '3.4: select de estivador no formulário de carga', 'cargas.html', cargasHtml);

// ─── 7a: chips de status nas cargas ───
assertIncludes(['sincronizarChipsCargas', 'window.atualizarCargasChips', 'aria-pressed'],
  '7a: chips rápidos de status alternam o filtro de cargas', 'js/pages/cargas.js', srcCargas);
assertIncludes(['id="cargasStatusChips"'],
  '7a: DOM dos chips de status', 'cargas.html', cargasHtml);

// ─── 7b: busca local + contadores em todas as tabelas ───
assertIncludes(['filterBusca', 'cargasCounter'],
  '7b: busca texto-livre + contador nas cargas', 'js/pages/cargas.js', srcCargas);
assertIncludes(['id="filterBusca"', 'id="cargasCounter"'],
  '7b: DOM de busca/contador nas cargas', 'cargas.html', cargasHtml);
assertIncludes(['buscarNavioInput', 'embarcacoesCounter', 'naviosVisiveis'],
  '7b: busca + contador na tabela GPS de embarcações', 'js/pages/embarcacoes.js', srcEmb);
assertIncludes(['id="buscarNavioInput"', 'id="embarcacoesCounter"'],
  '7b: DOM de busca/contador em embarcacoes.html', 'embarcacoes.html', embHtml);
assertIncludes(['buscarOsInput', 'osCounter', 'osVisiveis'],
  '7b: busca + contador nas ordens de serviço', 'js/pages/manutencao.js', srcManut);
assertIncludes(['id="buscarOsInput"', 'id="osCounter"'],
  '7b: DOM de busca/contador em manutencao.html', 'manutencao.html', manutHtml);
assertIncludes(['buscarAuditLogInput', 'auditLogCounter'],
  '7b: busca + contador no log de auditoria (dashboard)', 'js/pages/dashboard.js', srcDash);
assertIncludes(['id="buscarAuditLogInput"', 'id="auditLogCounter"'],
  '7b: DOM de busca/contador no dashboard', 'dashboard.html', dashHtml);

// ─── 7c: empty-state enriquecido em embarcações ───
assertIncludes(['search_off'],
  '7c: empty-state explicativo (ícone search_off) quando a busca zera resultados',
  'js/pages/embarcacoes.js + js/pages/manutencao.js', srcEmb + srcManut);

// ─── 7d: barra de progresso do ETA ───
assertIncludes(['calcularProgressoViagem', 'role="progressbar"', 'aria-valuenow'],
  '7d: barra de progresso do ETA na tabela de GPS', 'js/pages/embarcacoes.js', srcEmb);

// ─── 7h: chips de status das OS ───
assertIncludes(['filtroStatusOsAtual', 'osStatusChips', 'os-chip', 'data-status'],
  '7h: chips de status operacional das OS', 'js/pages/manutencao.js', srcManut);
assertIncludes(['id="osStatusChips"', 'data-status='],
  '7h: DOM dos chips de status das OS', 'manutencao.html', manutHtml);

// ─── 7i: impressão da etiqueta isolada ───
assertIncludes(['imprimirEtiquetaScanBtn', 'window.print()', 'REIMPRESSAO_ETIQUETA'],
  '7i: botão Imprimir Etiqueta no scanner registra trilha', 'js/pages/scanner.js', srcScanner);
assertIncludes(['id="imprimirEtiquetaScanBtn"', '@media print', 'qrResultCard'],
  '7i: cartão de resultado do scanner isolado em CSS print', 'scanner.html', scannerHtml);
assertIncludes(['@media print', 'qrModal'],
  '7i: modal de QR das cargas com impressão isolada', 'cargas.html', cargasHtml);

// ─── 8.3: indicadores do dashboard clicáveis (botões semânticos + placeholder BD) ───
assertIncludes(['button type="button" onclick="window.detalharCardOperacional'],
  '8.3: cartões de indicadores viraram botões semânticos', 'dashboard.html', dashHtml);
['cardNaviosManutencaoVal', 'cardNaviosForaVal', 'cardCargasArmazenagemVal', 'cardCargasProntasVal', 'cardCargasRecusadasVal', 'cardOcupacaoPatioVal', 'cardPreventivaVal'].forEach(id => {
  assertIncludes([`id="${id}" class="font-display font-bold text-xl text-nexus-900 dark:text-white">--<`],
    `8.3: ${id} inicia como '--' até a primeira consulta sem número fictício`, 'dashboard.html', dashHtml);
});

// ─── 8.2: hint de rolagem horizontal nas tabelas ───
assertIncludes(['aplicarHintDeRolagemTabelas', 'Deslize', 'overflow-x-auto'],
  '8.2: hint de rolagem horizontal em tabelas grandes no mobile', 'js/layout.js', srcLayout);

// ─── 8.4: acessibilidade mínima nos componentes compartilhados ───
assertIncludes(["setAttribute('role', 'alertdialog')", "setAttribute('aria-modal', 'true')", 'aria-live',
                'focus-visible:ring-2', 'aria-label="Confirmar ação"'],
  '8.4: modais de feedback/confirm com ARIA + foco visível', 'js/layout.js', srcLayout);

// ─── 8.5: badges com 12px (text-xs) ───
assertIncludes(['text-xs font-mono font-bold uppercase ${'],
  '8.5: badges de status de carga legíveis (12px)', 'js/pages/cargas.js', srcCargas);
assertNotIncludes('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase',
  '8.5: badges de OS/prioridade sem fonte de 10px', 'js/pages/manutencao.js', srcManut);

// ─── 8.7: feedback de sucesso/info se fecha sozinho ───
assertIncludes(['__nexusFeedbackTimer', '5000'],
  '8.7: feedbacks sucesso/info auto-fecham em 5s', 'js/layout.js', srcLayout);

// ─── 7d/8.6: paleta nexus em markup dinâ novo da barra de ETA ───
assertNotIncludes("progressoPct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'",
  '8.6: barra de progresso usa a paleta nexus (não indigo)', 'js/pages/embarcacoes.js', srcEmb);

// ─── Sanidade sintática ───
['js/auth-guard.js', 'js/pages/confirm-role.js', 'js/data-repository.js', 'js/pages/embarcacoes.js',
 'js/pages/cargas.js', 'js/pages/manutencao.js', 'js/pages/dashboard.js', 'js/layout.js', 'js/pages/scanner.js',
 'js/pages/charts.js', 'js/pages/relatorios.js'].forEach(assertSyntaxOk);
console.log('✅ Sintaxe OK em todos os arquivos editados');

console.log('\nTODOS OS TESTES DO BACKLOG 3 (restantes) PASSARAM ✅');
