#!/usr/bin/env node
/**
 * Regressão — Tarefa 5 (Correções): limite visual na tabela de Ordens de
 * Serviço de Manutenção & OS (manutencao.html), no MESMO padrão das tabelas de
 * histórico de cargas:
 *   - 4 registros iniciais;
 *   - botão "Mostrar mais"/"Mostrar menos" (oculto quando há ≤ 4 registros);
 *   - contador "Exibindo X de Y registros";
 *   - mudança puramente VISUAL: nenhuma ação das OS (aprovar, reprovar,
 *     concluir) é afetada e a lista completa fica disponível ao expandir.
 *
 * Cenários:
 *  S1. 6 OS → tabela inicia com 4 linhas, contador "Exibindo 4 de 6 registros"
 *      e botão "Mostrar mais" visível/habilitado (aria-expanded=false).
 *  S2. Clique no botão → 6 linhas, "Exibindo 6 de 6 registros", rótulo
 *      "Mostrar menos" (aria-expanded=true); novo clique recolhe para 4.
 *  S3. Gancho programático window.nexusAlternarOsTabela (padrão dos testes).
 *  S4. ≤ 4 registros (3 OS) → botão oculto E desabilitado, contador
 *      "Exibindo 3 de 3 registros", todas as 3 linhas visíveis.
 *  S5. 0 registros → estado vazio, "Exibindo 0 de 0 registros", botão oculto.
 *  S6. Filtros existentes preservados: chip de status e busca continuam
 *      valendo e o limite incide sobre a lista FILTRADA (contador mostra
 *      exibidos/total do filtro; botão some quando o filtro retorna ≤ 4).
 *  S7. Ações intactas: aprovar OS visível (recolhido) e aprovar OS que só
 *      aparece após expandir — ambas persistem em nexus_os_list.
 *  S8. Sem erros de runtime na carga da página (regressão do TDZ de
 *      carregarOsSupabase × declarações do limite).
 *
 * Executar: node tests/test_manutencao_mostrar_mais.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const SCRIPTS = [
  'js/security.js',
  'js/session-cookies.js',
  'js/supabase-client.js',
  'js/auth-guard.js',
  (win) => {
    win.currentUserSession = win.NexusAuth.getSession();
    win.NexusRepository = {
      getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
      getSupabase: () => undefined, notifyChange() {}, invalidarLeiturasCargas() {}
    };
  },
  'js/padronizacao-codigos.js',
  'js/pages/manutencao.js'
];

function os(n, status) {
  return {
    id: `OS-${n}`, equipamento: `Guindaste GND-00${n}`, prioridade: 'ALTA',
    descricao: `Reparo ${n} no motor`, data: `2026-10-0${n}`, status
  };
}

async function abrir(ordens) {
  const janela = criarJanela({
    url: 'https://nexusport.test/manutencao.html',
    html: htmlDaPagina('manutencao.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_os_list: ordens,
      nexus_guindastes_list: [],
      nexus_containers_list: [],
      nexus_navios_list: []
    },
    scripts: SCRIPTS
  });
  await prontoDom(janela.w);
  await aguardar(120);
  janela.w.nexusConfirm = async () => true;
  return janela;
}

// ---- Leitores de estado da tabela ------------------------------------------
const linhas = (w) => {
  const tbody = w.document.getElementById('osTableBody');
  const trs = Array.from(tbody.querySelectorAll('tr'));
  // Linhas de estado vazio (colspan) não contam como registro.
  return trs.filter((tr) => !tr.querySelector('td[colspan]')).length;
};
const contador = (w) => (w.document.getElementById('osCounter') || {}).textContent || '';
const botao = (w) => w.document.getElementById('mostrarMaisOsBtn');

async function main() {
  log('\n[Tarefa 5] Limite visual "Mostrar mais/menos" na tabela de OS (Manutenção & OS)\n');

  // ---------- S1: 6 OS → inicia com 4 registros ----------------------------
  log('S1. Seis OS: limite inicial de 4 registros + contador + botão');
  let j = await abrir([os(1, 'PENDENTE_APROVACAO'), os(2, 'PENDENTE_APROVACAO'), os(3, 'EM_MANUTENCAO'),
    os(4, 'PENDENTE_APROVACAO'), os(5, 'CONCLUIDA'), os(6, 'PENDENTE_APROVACAO')]);
  let w = j.w;
  check('S1: tabela inicia com 4 linhas', linhas(w) === 4, `linhas=${linhas(w)}`);
  check('S1: contador "Exibindo 4 de 6 registros"', contador(w) === 'Exibindo 4 de 6 registros', contador(w));
  check('S1: botão existe com aria-controls da tabela', Boolean(botao(w)) && botao(w).getAttribute('aria-controls') === 'osTableBody');
  check('S1: botão visível e habilitado ("Mostrar mais", aria-expanded=false)',
    Boolean(botao(w)) && !botao(w).classList.contains('hidden') && botao(w).disabled === false &&
    botao(w).textContent === 'Mostrar mais' && botao(w).getAttribute('aria-expanded') === 'false');
  check('S1: as 4 primeiras OS são OS-1..OS-4',
    /OS-1[\s\S]*OS-2[\s\S]*OS-3[\s\S]*OS-4/.test(w.document.getElementById('osTableBody').textContent) &&
    !/OS-5|OS-6/.test(w.document.getElementById('osTableBody').textContent));

  // ---------- S2: expandir/recolher pelo clique ----------------------------
  log('\nS2. Clique em "Mostrar mais" revela a lista completa; "Mostrar menos" recolhe');
  botao(w).click();
  await aguardar(60);
  check('S2: expande para 6 linhas', linhas(w) === 6, `linhas=${linhas(w)}`);
  check('S2: contador "Exibindo 6 de 6 registros"', contador(w) === 'Exibindo 6 de 6 registros', contador(w));
  check('S2: rótulo vira "Mostrar menos" (aria-expanded=true)',
    botao(w).textContent === 'Mostrar menos' && botao(w).getAttribute('aria-expanded') === 'true');
  check('S2: OS-5 e OS-6 aparecem na tabela',
    /OS-5/.test(w.document.getElementById('osTableBody').textContent) &&
    /OS-6/.test(w.document.getElementById('osTableBody').textContent));
  botao(w).click();
  await aguardar(60);
  check('S2: recolhe de volta para 4 linhas ("Exibindo 4 de 6 registros", "Mostrar mais")',
    linhas(w) === 4 && contador(w) === 'Exibindo 4 de 6 registros' && botao(w).textContent === 'Mostrar mais');
  j.dom.window.close();

  // ---------- S3: gancho programático --------------------------------------
  log('\nS3. Gancho programático window.nexusAlternarOsTabela (mesmo padrão de cargas)');
  j = await abrir([os(1, 'PENDENTE_APROVACAO'), os(2, 'PENDENTE_APROVACAO'), os(3, 'EM_MANUTENCAO'),
    os(4, 'PENDENTE_APROVACAO'), os(5, 'CONCLUIDA'), os(6, 'PENDENTE_APROVACAO')]);
  w = j.w;
  check('S3: gancho exposto no window', typeof w.nexusAlternarOsTabela === 'function');
  await w.nexusAlternarOsTabela();
  check('S3: alternância programática expande para 6', linhas(w) === 6 && contador(w) === 'Exibindo 6 de 6 registros');
  j.dom.window.close();

  // ---------- S4: ≤ 4 registros → sem botão --------------------------------
  log('\nS4. Três OS (≤ 4): botão não aparece, lista completa direta');
  j = await abrir([os(1, 'PENDENTE_APROVACAO'), os(2, 'EM_MANUTENCAO'), os(3, 'CONCLUIDA')]);
  w = j.w;
  check('S4: todas as 3 linhas visíveis', linhas(w) === 3, `linhas=${linhas(w)}`);
  check('S4: contador "Exibindo 3 de 3 registros"', contador(w) === 'Exibindo 3 de 3 registros', contador(w));
  check('S4: botão oculto e desabilitado',
    Boolean(botao(w)) && botao(w).classList.contains('hidden') && botao(w).disabled === true);
  j.dom.window.close();

  // ---------- S5: 0 registros ----------------------------------------------
  log('\nS5. Nenhuma OS: estado vazio com contador zerado e botão oculto');
  j = await abrir([]);
  w = j.w;
  check('S5: estado vazio exibido', /Nenhuma OS cadastrada/.test(w.document.getElementById('osTableBody').textContent));
  check('S5: contador "Exibindo 0 de 0 registros"', contador(w) === 'Exibindo 0 de 0 registros', contador(w));
  check('S5: botão oculto e desabilitado',
    Boolean(botao(w)) && botao(w).classList.contains('hidden') && botao(w).disabled === true);
  j.dom.window.close();

  // ---------- S6: filtros (chips + busca) × limite --------------------------
  log('\nS6. Filtros preservados: limite incide sobre a lista filtrada');
  j = await abrir([os(1, 'PENDENTE_APROVACAO'), os(2, 'PENDENTE_APROVACAO'), os(3, 'EM_MANUTENCAO'),
    os(4, 'PENDENTE_APROVACAO'), os(5, 'CONCLUIDA'), os(6, 'PENDENTE_APROVACAO')]);
  w = j.w;
  const chipEmManut = w.document.querySelector('#osStatusChips .os-chip[data-status="EM_MANUTENCAO"]');
  chipEmManut.click();
  await aguardar(60);
  check('S6: chip "Em manutenção" filtra para 1 OS ("Exibindo 1 de 1 registros")',
    linhas(w) === 1 && contador(w) === 'Exibindo 1 de 1 registros' &&
    /OS-3/.test(w.document.getElementById('osTableBody').textContent));
  check('S6: botão oculto quando o filtro retorna ≤ 4 registros',
    botao(w).classList.contains('hidden') && botao(w).disabled === true);
  chipEmManut.click(); // toggle: limpa o filtro
  await aguardar(60);
  check('S6: ao limpar o chip, volta ao limite geral (4 de 6) com botão visível',
    linhas(w) === 4 && contador(w) === 'Exibindo 4 de 6 registros' &&
    !botao(w).classList.contains('hidden') && botao(w).textContent === 'Mostrar mais');

  const busca = w.document.getElementById('buscarOsInput');
  busca.value = 'Reparo 5';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S6: busca combina com o limite ("Exibindo 1 de 1 registros", botão oculto)',
    linhas(w) === 1 && contador(w) === 'Exibindo 1 de 1 registros' &&
    /OS-5/.test(w.document.getElementById('osTableBody').textContent) &&
    botao(w).classList.contains('hidden'));
  busca.value = 'Reparo';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  await aguardar(60);
  check('S6: busca ampla mantém o limite de 4 ("Exibindo 4 de 6 registros")',
    linhas(w) === 4 && contador(w) === 'Exibindo 4 de 6 registros');
  j.dom.window.close();

  // ---------- S7: ações das OS permanecem intactas --------------------------
  log('\nS7. Ações (aprovar) funcionam recolhido e expandido; persistência mantida');
  j = await abrir([os(1, 'PENDENTE_APROVACAO'), os(2, 'PENDENTE_APROVACAO'), os(3, 'EM_MANUTENCAO'),
    os(4, 'PENDENTE_APROVACAO'), os(5, 'CONCLUIDA'), os(6, 'PENDENTE_APROVACAO')]);
  w = j.w;
  const lerOs = () => JSON.parse(w.localStorage.getItem('nexus_os_list') || '[]');
  // Os botões de ação da linha usam onclick inline — o jsdom do harness roda em
  // 'outside-only' e não executa handlers inline, então exercitamos a função
  // window.executarAcaoOS que o onclick invoca e validamos a presença dos
  // botões no DOM (disponibilidade visual da ação).
  const acoesDaLinha = (idOs) => {
    const trs = Array.from(w.document.getElementById('osTableBody').querySelectorAll('tr'));
    const tr = trs.find((r) => r.textContent.includes(idOs));
    if (!tr) return [];
    return Array.from(tr.querySelectorAll('button')).map((b) => b.textContent.trim());
  };
  check('S7: linha recolhida de OS-1 renderiza botões Aprovar/Reprovar',
    acoesDaLinha('OS-1').some((t) => t.includes('Aprovar')) && acoesDaLinha('OS-1').some((t) => t.includes('Reprovar')),
    JSON.stringify(acoesDaLinha('OS-1')));
  await w.executarAcaoOS('OS-1', 'APROVAR');
  await aguardar(160);
  check('S7: aprovar OS visível (recolhido) atualiza status para EM_MANUTENCAO',
    lerOs().find((o) => o.id === 'OS-1').status === 'EM_MANUTENCAO', JSON.stringify(lerOs()[0]));
  check('S7: limite reaplicado após a ação (4 de 6 registros)',
    linhas(w) === 4 && contador(w) === 'Exibindo 4 de 6 registros');
  check('S7: OS-6 (oculta pelo limite) não é renderizada enquanto recolhida',
    !/OS-6/.test(w.document.getElementById('osTableBody').textContent));
  botao(w).click();
  await aguardar(60);
  check('S7: OS-6 revelada após expandir traz seus botões de ação',
    acoesDaLinha('OS-6').some((t) => t.includes('Aprovar')), JSON.stringify(acoesDaLinha('OS-6')));
  await w.executarAcaoOS('OS-6', 'APROVAR');
  await aguardar(160);
  check('S7: aprovar OS revelada após expandir também persiste (EM_MANUTENCAO)',
    lerOs().find((o) => o.id === 'OS-6').status === 'EM_MANUTENCAO', JSON.stringify(lerOs().find((o) => o.id === 'OS-6')));
  check('S7: tabela continua expandida com 6 linhas ("Exibindo 6 de 6 registros")',
    linhas(w) === 6 && contador(w) === 'Exibindo 6 de 6 registros' && botao(w).textContent === 'Mostrar menos');
  await w.executarAcaoOS('OS-3', 'CONCLUIR');
  await aguardar(160);
  check('S7: concluir OS em manutenção segue funcionando (CONCLUIDA)',
    lerOs().find((o) => o.id === 'OS-3').status === 'CONCLUIDA', JSON.stringify(lerOs().find((o) => o.id === 'OS-3')));
  check('S8: nenhum erro de runtime na janela (TDZ/carregamento)', j.erros.length === 0, JSON.stringify(j.erros).slice(0, 200));
  j.dom.window.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 5 (limite visual "Mostrar mais/menos" na tabela de OS) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
