#!/usr/bin/env node
/**
 * Regressão (C2 — Backlog NexusPort): movimentar a carga para o CONTÊINER vinculado
 * e liberar o pátio.
 *
 * Usa a página real cargas.html + js/pages/cargas.js e o módulo de dados
 * (js/data-repository.js) com o dublê de banco (tests/fake-supabase-db.js):
 *   - o botão "P/ Contêiner" só existe DEPOIS que a carga tem contêiner vinculado;
 *     carga sem vínculo não ganha o botão (nem a ação);
 *   - enquanto a carga apenas vinculada está em ARMAZENAGEM, ela CONTINUA ocupando
 *     o pátio (ocupacaoPatio.ocupados conta a carga);
 *   - movimentar para o contêiner leva a carga a PRONTA_PARA_ENTREGA, grava essa
 *     transição no banco e a carga DEIXA de ocupar o pátio (ocupados cai);
 *   - a ação é recusada sem vínculo, fora de ARMAZENAGEM, para cargo sem a
 *     permissão e durante emergência (sem alterar status no banco);
 *   - o agente WebMCP expõe a mesma ação (mover_carga_container), com pré-condição,
 *     confirmação e resultado conferido no estado salvo.
 *
 * Executar: node tests/test_c2_carga_container_patio.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CRG_VINCULADA = 'CRG-2026-001';   // ARMAZENAGEM + contêiner vinculado
const CRG_SEM_VINCULO = 'CRG-2026-002'; // ARMAZENAGEM sem contêiner
const CRG_JA_NO_CONTAINER = 'CRG-2026-003'; // PRONTA_PARA_ENTREGA (já no contêiner)
const CRG_WEBMCP = 'CRG-2026-004';      // ARMAZENAGEM + contêiner (caminho do agente)
const CONT_ID = UUID(50);
const CONT_IDENT = 'MSCU1234567';

const ID = {
  [CRG_VINCULADA]: UUID(1),
  [CRG_SEM_VINCULO]: UUID(2),
  [CRG_JA_NO_CONTAINER]: UUID(3),
  [CRG_WEBMCP]: UUID(4)
};

function bancoBase() {
  return criarBancoFalso({
    cargas: [
      { id: ID[CRG_VINCULADA], qr_code_url: `QR-${CRG_VINCULADA}`, status_fluxo: 'ARMAZENAGEM', natureza: "Contêiner 20' Dry", peso: 12, volume: 20, porto_descarga: 'Pátio STS-01 (Setor B)', container_id: CONT_ID, navio_id: null },
      { id: ID[CRG_SEM_VINCULO], qr_code_url: `QR-${CRG_SEM_VINCULO}`, status_fluxo: 'ARMAZENAGEM', natureza: 'Granel Sólido', peso: 30, volume: 45, porto_descarga: 'Pátio STS-01 (Setor C)', container_id: null, navio_id: null },
      { id: ID[CRG_JA_NO_CONTAINER], qr_code_url: `QR-${CRG_JA_NO_CONTAINER}`, status_fluxo: 'PRONTA_PARA_ENTREGA', natureza: 'Carga Geral', peso: 8, volume: 15, porto_descarga: 'Pátio STS-01 (Setor B)', container_id: CONT_ID, navio_id: null },
      { id: ID[CRG_WEBMCP], qr_code_url: `QR-${CRG_WEBMCP}`, status_fluxo: 'ARMAZENAGEM', natureza: 'Reefer (Contêiner Refrigerado)', peso: 6, volume: 12, porto_descarga: 'Pátio STS-01 (Setor C)', container_id: CONT_ID, navio_id: null }
    ],
    containers: [{ id: CONT_ID, numero_identificacao: CONT_IDENT, estado: 'OPERANTE', navio_id: null }],
    navios: [], bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

const NUCLEO = ['js/webmcp/webmcp-core.js'];
const UI_DADOS_GLOBAL = ['js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js'];

/** Provedor de confirmação de teste: registra os pedidos e responde sempre "sim". */
function provedorDeTeste(w) {
  w.__pedidos = [];
  w.NexusWebMCP.iniciar({
    confirmar: async (pedido) => { w.__pedidos.push(pedido); return true; }
  });
}

const janelas = [];

async function carregar(banco, opcoes) {
  const o = opcoes || {};
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: o.session || sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: [],
      nexus_containers_list: [{ id: CONT_ID, identificacao: CONT_IDENT, estado: 'OPERANTE' }],
      nexus_navios_list: [],
      nexus_guindastes_list: [],
      nexus_guindaste_tarefas: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        // js/layout.js já instalou o nexusEmergenciaAtiva real; aqui ele é simulado.
        if (o.emergencia) win.nexusEmergenciaAtiva = () => true;
      },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/cargas.js'
    ].concat(o.webmcp ? NUCLEO.concat([provedorDeTeste], UI_DADOS_GLOBAL, ['js/webmcp/webmcp-cargas.js']) : [])
  });
  janelas.push(janela);
  await prontoDom(janela.w);
  await aguardar(250);
  return janela.w;
}

const linhasDe = (w, id) => Array.from((w.document.getElementById(id) || { querySelectorAll: () => [] }).querySelectorAll('tr'));
const linhaDe = (w, codigo) => linhasDe(w, 'cargasTableBody').find((tr) => tr.textContent.includes(codigo)) || null;
const cargaLocal = (w, id) => JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]').find((c) => c.id === id) || {};
const noBanco = (banco, id) => banco.tabelas.cargas.find((c) => c.id === ID[id]) || {};
const ultimoFeedback = (w) => (w.__feedbacks || []).slice(-1)[0] || {};
const ocupacao = async (w) => (await w.NexusRepository.buscarIndicadoresOperacionais()).ocupacaoPatio;

async function main() {
  const banco = bancoBase();
  const w = await carregar(banco);

  log('\n1. O botão "P/ Contêiner" só existe depois do vínculo com o contêiner');
  const linhaVinculada = linhaDe(w, CRG_VINCULADA);
  const linhaSemVinculo = linhaDe(w, CRG_SEM_VINCULO);
  const linhaJaNoContainer = linhaDe(w, CRG_JA_NO_CONTAINER);
  check('carga em ARMAZENAGEM com contêiner vinculado mostra o botão', Boolean(linhaVinculada) && linhaVinculada.textContent.includes('P/ Contêiner'), linhaVinculada && linhaVinculada.textContent.slice(0, 160));
  check('o botão dispara a ação MOVIMENTAR_CONTAINER', Boolean(linhaVinculada) && linhaVinculada.innerHTML.includes("'MOVIMENTAR_CONTAINER'"));
  check('o botão usa o ícone de contêiner (deployed_code)', Boolean(linhaVinculada) && linhaVinculada.innerHTML.includes('deployed_code'));
  check('carga sem contêiner vinculado NÃO mostra o botão', Boolean(linhaSemVinculo) && !linhaSemVinculo.textContent.includes('P/ Contêiner'), linhaSemVinculo && linhaSemVinculo.textContent.slice(0, 160));
  check('carga que já está no contêiner (PRONTA_PARA_ENTREGA) não mostra o botão', Boolean(linhaJaNoContainer) && !linhaJaNoContainer.textContent.includes('P/ Contêiner'));

  log('\n2. Enquanto apenas vinculada, a carga CONTINUA ocupando o pátio');
  check('status local da carga vinculada segue ARMAZENAGEM', cargaLocal(w, CRG_VINCULADA).status === 'ARMAZENAGEM', cargaLocal(w, CRG_VINCULADA).status);
  check('status no banco da carga vinculada segue ARMAZENAGEM', noBanco(banco, CRG_VINCULADA).status_fluxo === 'ARMAZENAGEM', noBanco(banco, CRG_VINCULADA).status_fluxo);
  let patio = await ocupacao(w);
  check('ocupação do pátio conta as 3 cargas em armazenagem (vinculada + sem vínculo + a do agente)', patio.ocupados === 3 && patio.capacidade === 100, JSON.stringify(patio));

  log('\n3. Movimentar para o contêiner deixa a carga PRONTA_PARA_ENTREGA e libera o pátio');
  await w.executarAcaoCarga(CRG_VINCULADA, 'MOVIMENTAR_CONTAINER');
  await aguardar(200);
  check('status local passou a PRONTA_PARA_ENTREGA', cargaLocal(w, CRG_VINCULADA).status === 'PRONTA_PARA_ENTREGA', cargaLocal(w, CRG_VINCULADA).status);
  check('transição gravada no banco (status_fluxo)', noBanco(banco, CRG_VINCULADA).status_fluxo === 'PRONTA_PARA_ENTREGA', noBanco(banco, CRG_VINCULADA).status_fluxo);
  check('o vínculo com o contêiner foi preservado', cargaLocal(w, CRG_VINCULADA).container === CONT_ID, cargaLocal(w, CRG_VINCULADA).container);
  patio = await ocupacao(w);
  check('a carga deixou de ocupar o pátio (ocupados caem de 3 para 2)', patio.ocupados === 2, JSON.stringify(patio));
  const fb = ultimoFeedback(w);
  check('feedback de sucesso informa a movimentação para o contêiner', fb.tipo === 'sucesso' && fb.titulo === 'Carga no Contêiner', JSON.stringify(fb));
  check('feedback informa que a carga deixou de ocupar o pátio (2 de 100)', /deixou de ocupar o pátio/.test(fb.msg || '') && /2 de 100/.test(fb.msg || ''), fb.msg);
  const linhaApos = linhaDe(w, CRG_VINCULADA);
  check('a carga movimentada não mostra mais o botão do contêiner', Boolean(linhaApos) && !linhaApos.textContent.includes('P/ Contêiner'));
  check('a carga movimentada passa a aguardar o navio', Boolean(linhaApos) && linhaApos.textContent.includes('Aguarda navio'), linhaApos && linhaApos.textContent.slice(0, 160));

  log('\n4. Ação recusada sem vínculo e fora de ARMAZENAGEM (sem alterar o banco)');
  await w.executarAcaoCarga(CRG_SEM_VINCULO, 'MOVIMENTAR_CONTAINER');
  await aguardar(120);
  let recusa = ultimoFeedback(w);
  check('carga sem contêiner é recusada com "Vínculo Obrigatório"', recusa.titulo === 'Vínculo Obrigatório', JSON.stringify(recusa));
  check('a carga sem contêiner continua em ARMAZENAGEM no banco', noBanco(banco, CRG_SEM_VINCULO).status_fluxo === 'ARMAZENAGEM', noBanco(banco, CRG_SEM_VINCULO).status_fluxo);
  await w.executarAcaoCarga(CRG_JA_NO_CONTAINER, 'MOVIMENTAR_CONTAINER');
  await aguardar(120);
  recusa = ultimoFeedback(w);
  check('carga já no contêiner é recusada por regra de negócio', recusa.titulo === 'Regra de Negócio' && /ARMAZENAGEM/.test(recusa.msg || ''), JSON.stringify(recusa));
  check('o status da carga fora de ARMAZENAGEM não mudou no banco', noBanco(banco, CRG_JA_NO_CONTAINER).status_fluxo === 'PRONTA_PARA_ENTREGA');
  patio = await ocupacao(w);
  check('a ocupação do pátio não mudou com as recusas (2)', patio.ocupados === 2, JSON.stringify(patio));

  log('\n5. Cargo sem a permissão não vê o botão nem executa a ação');
  const bancoArrumador = bancoBase();
  const wArrumador = await carregar(bancoArrumador, { session: sessao('ARRUMADOR_CONSERTADOR') });
  const linhaArrumador = linhaDe(wArrumador, CRG_VINCULADA);
  check('o Arrumador enxerga a carga em armazenagem (Visão Própria)', Boolean(linhaArrumador), linhaArrumador && linhaArrumador.textContent.slice(0, 160));
  check('o Arrumador não vê o botão "P/ Contêiner" (ação do Estivador)', Boolean(linhaArrumador) && !linhaArrumador.textContent.includes('P/ Contêiner'), linhaArrumador && linhaArrumador.textContent.slice(0, 160));
  await wArrumador.executarAcaoCarga(CRG_VINCULADA, 'MOVIMENTAR_CONTAINER');
  await aguardar(120);
  const recusaArrumador = ultimoFeedback(wArrumador);
  check('a ação é recusada com "Acesso Restrito"', recusaArrumador.titulo === 'Acesso Restrito', JSON.stringify(recusaArrumador));
  check('nenhuma escrita no banco aconteceu', noBanco(bancoArrumador, CRG_VINCULADA).status_fluxo === 'ARMAZENAGEM', noBanco(bancoArrumador, CRG_VINCULADA).status_fluxo);

  log('\n6. Emergência ativa: botão desabilitado e ação bloqueada');
  const bancoEmergencia = bancoBase();
  const wEmergencia = await carregar(bancoEmergencia, { session: sessao('ESTIVADOR'), emergencia: true });
  const linhaEmergencia = linhaDe(wEmergencia, CRG_VINCULADA);
  const botaoEmergencia = linhaEmergencia ? Array.from(linhaEmergencia.querySelectorAll('button')).find((b) => b.textContent.includes('P/ Contêiner')) : null;
  check('durante a emergência o botão aparece desabilitado', Boolean(botaoEmergencia) && botaoEmergencia.disabled === true, botaoEmergencia && botaoEmergencia.outerHTML.slice(0, 140));
  await wEmergencia.executarAcaoCarga(CRG_VINCULADA, 'MOVIMENTAR_CONTAINER');
  await aguardar(120);
  check('a ação é bloqueada durante a emergência', ultimoFeedback(wEmergencia).titulo === 'Emergência Ativa', JSON.stringify(ultimoFeedback(wEmergencia)));
  check('a carga continua ocupando o pátio no banco', noBanco(bancoEmergencia, CRG_VINCULADA).status_fluxo === 'ARMAZENAGEM');

  log('\n7. Agente WebMCP: mesma ação, com pré-condição, confirmação e resultado conferido');
  const bancoAgente = bancoBase();
  const wAgente = await carregar(bancoAgente, { session: sessao('INSPETOR'), webmcp: true });
  let r = await wAgente.NexusWebMCP.executar('obter_carga', { id: CRG_VINCULADA });
  check('obter_carga: a ação está disponível para a carga vinculada', r.ok && (r.dados.acoes_disponiveis || []).includes('mover_carga_container'), JSON.stringify(r.dados && r.dados.acoes_disponiveis));
  r = await wAgente.NexusWebMCP.executar('obter_carga', { id: CRG_SEM_VINCULO });
  check('obter_carga: a ação NÃO aparece para a carga sem vínculo', r.ok && !(r.dados.acoes_disponiveis || []).includes('mover_carga_container'), JSON.stringify(r.dados && r.dados.acoes_disponiveis));
  r = await wAgente.NexusWebMCP.executar('mover_carga_container', { id: CRG_SEM_VINCULO });
  check('mover_carga_container: recusa sem vínculo com VINCULO_OBRIGATORIO', r.ok === false && r.codigo === 'VINCULO_OBRIGATORIO', JSON.stringify(r));
  r = await wAgente.NexusWebMCP.executar('mover_carga_container', { id: CRG_WEBMCP });
  check('mover_carga_container: executada com confirmação pedida ao operador', r.ok === true && wAgente.__pedidos.length === 1 && wAgente.__pedidos[0].ferramenta.nome === 'mover_carga_container', JSON.stringify({ ok: r.ok, pedidos: wAgente.__pedidos.length }));
  check('mover_carga_container: resultado confere o estado salvo', /deixou de ocupar o pátio/.test(r.mensagem || ''), r.mensagem);
  check('mover_carga_container: status no banco é PRONTA_PARA_ENTREGA', noBanco(bancoAgente, CRG_WEBMCP).status_fluxo === 'PRONTA_PARA_ENTREGA', noBanco(bancoAgente, CRG_WEBMCP).status_fluxo);
  const patioAgente = await ocupacao(wAgente);
  check('mover_carga_container: o pátio caiu de 3 para 2 cargas em armazenagem', patioAgente.ocupados === 2, JSON.stringify(patioAgente));

  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  const res = resumo();
  log(`\nResultado: ${res.total - res.falhas}/${res.total} verificações aprovadas.`);
  if (res.falhas > 0) {
    process.stdout.write(`❌ ${res.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações de C2 (carga no contêiner / pátio liberado) passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
