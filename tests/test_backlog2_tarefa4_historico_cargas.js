#!/usr/bin/env node
/**
 * Regressão — Tarefa 4 (Backlog Parte 2): limite visual das tabelas de histórico.
 *
 * Em Cargas & Pátio, as tabelas de Entregues, Canceladas e Recusadas mostram
 * no máximo 4 registros inicialmente, cada uma com seu botão "Mostrar mais"
 * independente para expandir os demais (e "Mostrar menos" para recolher):
 *   - expandir uma tabela não expande as outras;
 *   - é só exibição: a lista completa continua nos dados (contador "de N");
 *   - com 4 ou menos registros (ou tabela vazia), o botão fica oculto;
 *   - re-renderizações (filtro/atualização) mantêm o limite e a expansão.
 *
 * Executar: node tests/test_backlog2_tarefa4_historico_cargas.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const carga = (id, status, extra) => Object.assign({
  id, tipo: 'Carga Geral', natureza: 'Geral', status,
  peso: '10 t', volume: '10 m³', portoDescarga: 'Pátio STS-01 (Setor B)',
  destino: 'Hamburgo', container: '', navio: '', qrCode: `QR-${id}`,
  motivoCancelamento: 'Motivo de teste', motivoRecusa: 'Motivo de teste'
}, extra || {});

const SERIE = (prefixo, status, n) => Array.from({ length: n }, (_, i) => carga(`${prefixo}${String(i + 1).padStart(2, '0')}`, status));

async function abrir(cargas) {
  const banco = criarBancoFalso({ containers: [], navios: [], cargas: [], rotas_maritimas: [] });
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_cargas_fluxo: cargas },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/padronizacao-codigos.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.console.warn = () => {};
      },
      'js/pages/cargas.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(150);
  return janela;
}

const linhas = (w, id) => w.document.querySelectorAll(`#${id} tr`).length;
const botao = (w, id) => w.document.getElementById(id);
const contador = (w, id) => w.document.getElementById(id).textContent;

async function main() {
  const janelas = [];
  try {
    log('1. Exibição inicial: no máximo 4 por tabela, botões visíveis e independentes');
    const cargas = [
      ...SERIE('CRG-E', 'ENTREGUE', 6),
      ...SERIE('CRG-C', 'CANCELADA', 5),
      ...SERIE('CRG-R', 'RECUSADA', 7),
      carga('CRG-ATIVA-01', 'ARMAZENAGEM')
    ];
    let j = await abrir(cargas); janelas.push(j);
    let w = j.w;
    check('entregues mostra 4 de 6', linhas(w, 'cargasEntreguesTableBody') === 4 && contador(w, 'cargasEntreguesContador') === 'Exibindo 4 de 6 registros',
      `${linhas(w, 'cargasEntreguesTableBody')} / "${contador(w, 'cargasEntreguesContador')}"`);
    check('canceladas mostra 4 de 5', linhas(w, 'cargasCanceladasTableBody') === 4 && contador(w, 'cargasCanceladasContador') === 'Exibindo 4 de 5 registros');
    check('recusadas mostra 4 de 7', linhas(w, 'cargasRecusadasTableBody') === 4 && contador(w, 'cargasRecusadasContador') === 'Exibindo 4 de 7 registros');
    check('botões visíveis com "Mostrar mais" e aria-expanded=false',
      ['mostrarMaisEntreguesBtn', 'mostrarMaisCanceladasBtn', 'mostrarMaisRecusadasBtn'].every(id =>
        !botao(w, id).classList.contains('hidden') && botao(w, id).textContent === 'Mostrar mais' &&
        botao(w, id).getAttribute('aria-expanded') === 'false'));
    const entreguesTexto = w.document.getElementById('cargasEntreguesTableBody').textContent;
    check('5ª entregue em diante fica fora da exibição inicial', entreguesTexto.includes('CRG-E04') && !entreguesTexto.includes('CRG-E05'));

    log('\n2. Expandir só entregues: mostra todas, vira "Mostrar menos", demais intactas');
    botao(w, 'mostrarMaisEntreguesBtn').click();
    await aguardar(20);
    check('entregues expande para 6', linhas(w, 'cargasEntreguesTableBody') === 6 && contador(w, 'cargasEntreguesContador') === 'Exibindo 6 de 6 registros');
    check('botão vira "Mostrar menos" com aria-expanded=true',
      botao(w, 'mostrarMaisEntreguesBtn').textContent === 'Mostrar menos' && botao(w, 'mostrarMaisEntreguesBtn').getAttribute('aria-expanded') === 'true');
    check('canceladas e recusadas continuam em 4',
      linhas(w, 'cargasCanceladasTableBody') === 4 && linhas(w, 'cargasRecusadasTableBody') === 4);

    log('\n3. Recolher volta a 4; expandir as outras funciona de forma independente');
    botao(w, 'mostrarMaisEntreguesBtn').click();
    await aguardar(20);
    check('entregues recolhe para 4 com "Mostrar mais"', linhas(w, 'cargasEntreguesTableBody') === 4 && botao(w, 'mostrarMaisEntreguesBtn').textContent === 'Mostrar mais');
    botao(w, 'mostrarMaisCanceladasBtn').click();
    botao(w, 'mostrarMaisRecusadasBtn').click();
    await aguardar(20);
    check('canceladas expande para 5 e recusadas para 7',
      linhas(w, 'cargasCanceladasTableBody') === 5 && linhas(w, 'cargasRecusadasTableBody') === 7);
    check('entregues permanece recolhida em 4', linhas(w, 'cargasEntreguesTableBody') === 4);

    log('\n4. Os dados completos não são truncados pela exibição');
    const armazenadas = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
    check('cache continua com todas as cargas (6+5+7+1)', armazenadas.length === 19, `total=${armazenadas.length}`);
    check('contadores continuam reportando os totais reais',
      contador(w, 'cargasCanceladasContador') === 'Exibindo 5 de 5 registros' &&
      contador(w, 'cargasRecusadasContador') === 'Exibindo 7 de 7 registros');

    log('\n5. Tabelas com até 4 (ou vazias): sem botão, sem quebrar a renderização');
    j = await abrir([...SERIE('CRG-E', 'ENTREGUE', 3), ...SERIE('CRG-R', 'RECUSADA', 4)]); janelas.push(j);
    w = j.w;
    check('entregues com 3 mostra 3 e botão oculto',
      linhas(w, 'cargasEntreguesTableBody') === 3 && botao(w, 'mostrarMaisEntreguesBtn').classList.contains('hidden'));
    check('recusadas com exatamente 4 mostra 4 e botão oculto',
      linhas(w, 'cargasRecusadasTableBody') === 4 && botao(w, 'mostrarMaisRecusadasBtn').classList.contains('hidden'));
    check('canceladas vazia mostra a mensagem e botão oculto',
      w.document.getElementById('cargasCanceladasTableBody').textContent.includes('Nenhuma carga cancelada') &&
      botao(w, 'mostrarMaisCanceladasBtn').classList.contains('hidden'));
    check('sem erros de página', (j.erros || []).length === 0, JSON.stringify(j.erros));
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
}

main();
