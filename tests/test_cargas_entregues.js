#!/usr/bin/env node
/**
 * Regressão (C1 — Backlog NexusPort): Cargas & Pátio separa as CARGAS ENTREGUES.
 *
 * Usa a página real cargas.html e js/pages/cargas.js em jsdom:
 *   - a tabela principal exibe apenas cargas NÃO ENTREGUES;
 *   - as cargas entregues ficam na "Tabela de Cargas Entregues", na mesma página,
 *     com código, tipo, peso/volume, porto de entrega e contêiner;
 *   - o contador de entregues acompanha a tabela e o contador principal não
 *     conta cargas já entregues;
 *   - o filtro/chip de status ENTREGUE aponta para a tabela de entregues;
 *   - a Visão Própria (RF 1.3) vale também para as entregues;
 *   - sem entregues, a tabela própria informa a ausência (nada inventado).
 *
 * Executar: node tests/test_cargas_entregues.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const agora = new Date().toISOString();

/** Carga como o cache da página a guarda (projeção de Cargas). */
function carga(over) {
  return Object.assign({
    id: 'CRG-2026-001',
    tipo: "Contêiner 20' Dry",
    natureza: 'Geral',
    peso: '12 t',
    volume: '20 m³',
    portoDescarga: 'Pátio STS-01 (Setor B)',
    container: '',
    navio: '',
    status: 'ARMAZENAGEM',
    qrCode: 'QR-CRG-2026-001',
    data_cadastro: agora
  }, over);
}

/** Uma entregue (com contêiner e vínculo já removido pelo A1) e três não entregues. */
function cargasBase() {
  return [
    carga({ id: 'CRG-2026-900', tipo: 'Reefer (Contêiner Refrigerado)', natureza: 'Perecível', peso: '8 t', volume: '30 m³', portoDescarga: 'Porto de Roterdã', container: 'MSCU1234567', status: 'ENTREGUE', qrCode: 'QR-CRG-2026-900' }),
    carga({ id: 'CRG-2026-901', tipo: 'Granel Sólido', natureza: 'Grãos', portoDescarga: 'Porto de Paranaguá', status: 'ENTREGUE', qrCode: 'QR-CRG-2026-901' }),
    carga({ id: 'CRG-2026-002', status: 'AGENDAMENTO' }),
    carga({ id: 'CRG-2026-003', status: 'EM_TRANSITO' }),
    carga({ id: 'CRG-2026-004', status: 'PRONTA_PARA_ENTREGA' })
  ];
}

const janelas = [];

async function carregar(cargas, session) {
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: session || sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: cargas,
      nexus_navios_list: [],
      nexus_containers_list: [],
      nexus_guindastes_list: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { win.currentUserSession = win.NexusAuth.getSession(); },
      'js/pages/tipos-carga.js',
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
      },
      'js/padronizacao-codigos.js',
      'js/pages/cargas.js'
    ]
  });
  janelas.push(janela);
  await prontoDom(janela.w);
  await aguardar(250);
  return janela.w;
}

const textoDe = (w, id) => (w.document.getElementById(id) || { textContent: '' }).textContent || '';
const linhasDe = (w, id) => Array.from((w.document.getElementById(id) || { querySelectorAll: () => [] }).querySelectorAll('tr'));
const contem = (texto, termo) => texto.includes(termo);
const linhaDe = (w, tbodyId, codigo) => linhasDe(w, tbodyId).find((tr) => contem(tr.textContent, codigo)) || null;

async function main() {
  const w = await carregar(cargasBase());

  log('\n1. Tabela principal: apenas cargas NÃO entregues');
  const principal = textoDe(w, 'cargasTableBody');
  check('carga AGENDAMENTO na tabela principal', contem(principal, 'CRG-2026-002'));
  check('carga EM_TRANSITO na tabela principal', contem(principal, 'CRG-2026-003'));
  check('carga PRONTA_PARA_ENTREGA na tabela principal', contem(principal, 'CRG-2026-004'));
  check('nenhuma carga ENTREGUE na tabela principal', !contem(principal, 'ENTREGUE'), principal.slice(0, 200));
  check('as entregues não aparecem na tabela principal', !contem(principal, 'CRG-2026-900') && !contem(principal, 'CRG-2026-901'));

  log('\n2. Tabela de Cargas Entregues: mesma página, cargas entregues');
  const card = w.document.getElementById('cargasEntreguesCard');
  const entregues = textoDe(w, 'cargasEntreguesTableBody');
  check('a Tabela de Cargas Entregues existe na página de Cargas & Pátio', Boolean(card) && Boolean(w.document.getElementById('cargasEntreguesTableBody')));
  check('as duas cargas entregues estão na tabela própria', contem(entregues, 'CRG-2026-900') && contem(entregues, 'CRG-2026-901'));
  check('cargas não entregues não aparecem na tabela de entregues', !contem(entregues, 'CRG-2026-002') && !contem(entregues, 'CRG-2026-003'));
  const linha900 = linhaDe(w, 'cargasEntreguesTableBody', 'CRG-2026-900');
  check('a linha da entregue mostra tipo, peso/volume, porto de entrega e contêiner',
    Boolean(linha900) && contem(linha900.textContent, 'Reefer') && contem(linha900.textContent, '8 t') && contem(linha900.textContent, 'Porto de Roterdã') && contem(linha900.textContent, 'MSCU1234567'),
    linha900 && linha900.textContent.slice(0, 220));
  check('a linha da entregue mostra o status ENTREGUE em selo próprio', Boolean(linha900) && /ENTREGUE/.test(linha900.textContent));
  check('entrega sem navio vinculado é explicada (desvinculado na entrega)', contem(entregues, 'Navio desvinculado na entrega'), entregues.slice(0, 200));

  log('\n3. Contadores: entregues na tabela própria, não no total de ativas');
  check('contador de entregues informa 2 cargas', /2 carga\(s\) entregue\(s\)/.test(textoDe(w, 'cargasEntreguesCounter')), textoDe(w, 'cargasEntreguesCounter'));
  check('contador principal conta apenas as 3 cargas não entregues', /Exibindo 3 de 3 carga\(s\) ativa\(s\)/.test(textoDe(w, 'cargasCounter')), textoDe(w, 'cargasCounter'));

  log('\n4. Filtro de status ENTREGUE aponta para a tabela de entregues');
  const filtroStatus = w.document.getElementById('filterStatus');
  filtroStatus.value = 'ENTREGUE';
  filtroStatus.dispatchEvent(new w.Event('change', { bubbles: true }));
  await aguardar(80);
  check('a tabela principal não lista entregues mesmo com o filtro ENTREGUE', !contem(textoDe(w, 'cargasTableBody'), 'CRG-2026-900') && /Nenhuma carga encontrada/.test(textoDe(w, 'cargasTableBody')), textoDe(w, 'cargasTableBody').slice(0, 120));
  check('a Tabela de Cargas Entregues é destacada (foco visual)', card.classList.contains('ring-2'), card.className.slice(0, 160));
  check('a tabela de entregues continua mostrando as entregues', contem(textoDe(w, 'cargasEntreguesTableBody'), 'CRG-2026-900'));

  // Limpar filtros volta a exibir as cargas não entregues
  w.document.getElementById('limparFiltrosBtn').click();
  await aguardar(80);
  check('limpar filtros restaura a tabela principal com as 3 cargas não entregues',
    /Exibindo 3 de 3 carga\(s\) ativa\(s\)/.test(textoDe(w, 'cargasCounter')) && contem(textoDe(w, 'cargasTableBody'), 'CRG-2026-002'),
    textoDe(w, 'cargasCounter'));

  log('\n5. Visão Própria (RF 1.3) vale também para as entregues');
  const wEstivador = await carregar([
    // A Visão Própria do Estivador casa pela matrícula da sessão (MAT-9001 no harness)
    carga({ id: 'CRG-2026-910', status: 'ENTREGUE', estivador: 'Outro Estivador', estivadorMatricula: 'MAT-9001', qrCode: 'QR-CRG-2026-910' }),
    carga({ id: 'CRG-2026-911', status: 'ENTREGUE', estivador: 'Outro Estivador', estivadorMatricula: 'MAT-9999', qrCode: 'QR-CRG-2026-911' }),
    carga({ id: 'CRG-2026-912', status: 'ARMAZENAGEM' })
  ], sessao('ESTIVADOR'));
  const entreguesEstivador = textoDe(wEstivador, 'cargasEntreguesTableBody');
  check('estivador vê a própria carga entregue', contem(entreguesEstivador, 'CRG-2026-910'));
  check('estivador não vê a carga entregue de outro estivador', !contem(entreguesEstivador, 'CRG-2026-911'), entreguesEstivador.slice(0, 200));

  log('\n6. Sem cargas entregues: a tabela informa a ausência');
  const wVazio = await carregar([carga({ id: 'CRG-2026-002' })]);
  check('tabela de entregues informa que não há entregues', /Nenhuma carga entregue no sistema/.test(textoDe(wVazio, 'cargasEntreguesTableBody')), textoDe(wVazio, 'cargasEntreguesTableBody').slice(0, 160));
  check('contador de entregues zera', /0 carga\(s\) entregue\(s\)/.test(textoDe(wVazio, 'cargasEntreguesCounter')), textoDe(wVazio, 'cargasEntreguesCounter'));

  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações de Cargas Entregues passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
