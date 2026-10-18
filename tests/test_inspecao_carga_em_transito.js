/**
 * Regressão — Correções Tarefa 1: inspeção (checklist) de carga EM_TRANSITO.
 *
 * Uma carga EM_TRANSITO já saiu do porto com o navio liberado; a inspeção
 * formal pertence às etapas anteriores do fluxo (SPEC §6: recebimento/inspeção
 * e armazenagem). Este teste cobre o bloqueio em TODOS os canais:
 *
 *   Tela (inspecao.html + js/pages/inspecao.js):
 *     1. A carga EM_TRANSITO não entra no seletor de inspeção.
 *     2. A abertura do checklist (URL ?carga= / QR Code) é recusada com
 *        mensagem clara ("Carga em Trânsito").
 *     3. A gravação (aprovar/recusar) é recusada mesmo quando a carga entrou
 *        em trânsito DEPOIS de o checklist ser aberto (conferência no banco).
 *     4. Status permitidos (RECEBIMENTO_INSPECAO/ARMAZENAGEM) continuam
 *        abrindo e gravando normalmente — sem qualquer mudança de comportamento.
 *
 *   WebMCP (js/webmcp/webmcp-inspecao.js → inspecionar_carga):
 *     5. APROVAR/RECUSAR uma carga EM_TRANSITO responde CARGA_EM_TRANSITO,
 *        sem pedir confirmação, sem tocar na tela e sem alterar o estado.
 *     6. Carga RECEBIMENTO_INSPECAO segue sendo inspecionada normalmente.
 *
 * Executar: node tests/test_inspecao_carga_em_transito.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

/* ------------------------------------------------------------------ *
 * Dublês e sementes
 * ------------------------------------------------------------------ */
const OK = { data: null, error: null };

const UUID_EM_TRANSITO = '7a1e5d0c-1111-4222-8333-aaaaaaaaaaa1';
const UUID_RECEBIMENTO = '7a1e5d0c-1111-4222-8333-aaaaaaaaaaa2';

// Itens de checklist já cadastrados no banco (a tela associa por ordem: 1..5).
const CHECKLIST_DB = [1, 2, 3, 4, 5].map((ordem) => ({
  id: `c0000000-0000-4000-8000-00000000000${ordem}`,
  ordem
}));

function cargasTela() {
  return [
    { id: 'CRG-EMT', tipo: 'Carga Geral', status: 'EM_TRANSITO', portoDescarga: 'Porto de Roterdã', navio: 'MV Teste', container: 'CONT-1', qrCode: 'QR-CRG-EMT', rawDbId: UUID_EM_TRANSITO },
    { id: 'CRG-REC', tipo: 'Carga Geral', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'Setor A', qrCode: 'QR-CRG-REC', rawDbId: UUID_RECEBIMENTO },
    { id: 'CRG-RCD', tipo: 'Carga Geral', status: 'RECUSADA', portoDescarga: 'Setor A', qrCode: 'QR-CRG-RCD' },
    { id: 'CRG-AGD', tipo: 'Carga Geral', status: 'AGENDAMENTO', portoDescarga: 'Setor A', qrCode: 'QR-CRG-AGD' },
    { id: 'CRG-ARM', tipo: 'Carga Geral', status: 'ARMAZENAGEM', portoDescarga: 'Setor B', qrCode: 'QR-CRG-ARM' },
    { id: 'CRG-PRT', tipo: 'Carga Geral', status: 'PRONTA_PARA_ENTREGA', portoDescarga: 'Setor B', qrCode: 'QR-CRG-PRT' },
    { id: 'CRG-ENT', tipo: 'Carga Geral', status: 'ENTREGUE', portoDescarga: 'Setor C', qrCode: 'QR-CRG-ENT' },
    { id: 'CRG-CAN', tipo: 'Carga Geral', status: 'CANCELADA', portoDescarga: 'Setor D', qrCode: 'QR-CRG-CAN' }
  ];
}

/**
 * Cliente Supabase falso (mesmo padrão de test_gravacao_inspecao_login.js):
 * encadeia from/select/eq/insert/update e registra cada consulta.
 * `statusCargaNoBanco` controla o status que o banco devolve para a carga
 * RECEBIMENTO_INSPECAO — usado para simular a corrida em que o navio é
 * liberado enquanto o checklist está aberto.
 */
function criarSupabaseFalso(registro, opcoes) {
  const o = opcoes || {};
  const tratar = (q) => {
    registro.push({ tabela: q.tabela, op: q.op, payload: q.payload, filtros: q.filtros.slice(), terminal: q.terminal });
    if (q.tabela === 'cargas' && q.op === 'select') {
      return { data: { id: UUID_RECEBIMENTO, status_fluxo: o.statusCargaNoBanco || 'RECEBIMENTO_INSPECAO' }, error: null };
    }
    if (q.tabela === 'cargas' && q.op === 'update') return OK;
    if (q.tabela === 'inspecoes' && q.op === 'update') return OK;
    if (q.tabela === 'inspecoes') return { data: { id: 'insp-teste-1' }, error: null };
    if (q.tabela === 'checklist_itens') return { data: CHECKLIST_DB, error: null };
    return OK;
  };
  return {
    from(tabela) {
      const q = { tabela, op: 'select', payload: null, filtros: [], terminal: null };
      const executar = () => tratar(q);
      const builder = {
        select() { return builder; },
        insert(payload) { q.op = 'insert'; q.payload = payload; return builder; },
        update(payload) { q.op = 'update'; q.payload = payload; return builder; },
        eq(coluna, valor) { q.filtros.push([coluna, valor]); return builder; },
        order() { return builder; },
        maybeSingle() { q.terminal = 'maybeSingle'; return builder; },
        single() { q.terminal = 'single'; return builder; },
        then(ok, falha) { return Promise.resolve().then(executar).then(ok, falha); },
        catch(falha) { return Promise.resolve().then(executar).catch(falha); }
      };
      return builder;
    }
  };
}

/** Abre inspecao.html real em jsdom com a sessão e o banco simulado. */
async function abrirInspecao({ query = '', statusCargaNoBanco = 'RECEBIMENTO_INSPECAO', cargos = cargasTela() } = {}) {
  const registro = [];
  const feedbacks = [];
  const janela = criarJanela({
    url: `https://nexusport.test/inspecao.html${query}`,
    html: htmlDaPagina('inspecao.html'),
    session: sessao('INSPETOR'),
    storage: { nexus_cargas_fluxo: cargos },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (w) => {
        w.currentUserSession = w.NexusAuth.getSession();
        w.nexusSupabase = criarSupabaseFalso(registro, { statusCargaNoBanco });
        w.mostrarFeedback = (tipo, titulo, mensagem) => feedbacks.push({ tipo, titulo, mensagem });
      },
      'js/pages/inspecao.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(150);
  return { w: janela.w, erros: janela.erros, registro, feedbacks };
}

/** Marca todos os itens do checklist como CONFORME (rádios + estado da página). */
function marcarTudoConforme(w) {
  const doc = w.document;
  doc.querySelectorAll('input[type="radio"][value="CONFORME"]').forEach((radio) => {
    radio.click();
    const itemId = String(radio.name || '').replace(/^chk_/, '');
    if (itemId && typeof w.atualizarChecklistItem === 'function') w.atualizarChecklistItem(itemId, true);
  });
}

function abrirChecklistPelaTela(w, idCarga) {
  const doc = w.document;
  doc.getElementById('inspecaoCargaSelect').value = idCarga;
  doc.getElementById('carregarChecklistBtn').click();
}

function cargaSalva(w, id) {
  return (JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]')).find((c) => c.id === id) || null;
}

/* ------------------------------------------------------------------ *
 * Parte 1 — Tela de Inspeção & Checklist
 * ------------------------------------------------------------------ */
async function testarTela() {
  log('\n[1] Tela: seletor oferece somente RECEBIMENTO_INSPECAO e RECUSADA');
  {
    const { w, erros } = await abrirInspecao();
    const opcoes = Array.from(w.document.getElementById('inspecaoCargaSelect').options).map((opt) => opt.value);
    check('carga EM_TRANSITO não pode ser selecionada para inspeção', !opcoes.includes('CRG-EMT'), JSON.stringify(opcoes));
    check('carga RECEBIMENTO_INSPECAO continua disponível', opcoes.includes('CRG-REC'));
    check('carga RECUSADA continua disponível', opcoes.includes('CRG-RCD'));
    check('demais status (AGENDAMENTO, ARMAZENAGEM, PRONTA_PARA_ENTREGA, ENTREGUE, CANCELADA) ficam fora da lista',
      !opcoes.includes('CRG-AGD') && !opcoes.includes('CRG-ARM') && !opcoes.includes('CRG-PRT') && !opcoes.includes('CRG-ENT') && !opcoes.includes('CRG-CAN'),
      JSON.stringify(opcoes));
    check('nenhum erro não capturado na página', erros.length === 0, JSON.stringify(erros));
    w.close();
  }

  log('\n[2] Tela: abertura de checklist de carga EM_TRANSITO ou status não inspecionável é recusada com mensagem clara');
  {
    // Mesma entrada usada pelo QR Code e pelo atalho ?carga= (scanner/URL).
    const { w, feedbacks, erros } = await abrirInspecao({ query: '?carga=CRG-EMT' });
    const aviso = feedbacks.find((f) => f.titulo === 'Carga em Trânsito');
    check('abertura recusada com aviso "Carga em Trânsito"', Boolean(aviso), JSON.stringify(feedbacks));
    check('mensagem explica que a carga já saiu do porto e não pode ser inspecionada',
      Boolean(aviso) && aviso.mensagem.includes('EM TRÂNSITO') && aviso.mensagem.includes('não pode ser inspecionada'),
      aviso && aviso.mensagem);
    check('o checklist não é carregado (formulário permanece oculto)',
      w.document.getElementById('checklistFormContainer').classList.contains('hidden'));
    check('nenhuma carga fica marcada como em inspeção', w.nexusInspecaoEstado().cargaId === null);
    check('nenhum erro não capturado na página', erros.length === 0, JSON.stringify(erros));
    w.close();
  }
  {
    const { w, feedbacks } = await abrirInspecao({ query: '?carga=CRG-ARM' });
    const aviso = feedbacks.find((f) => f.titulo === 'Inspeção Indisponível');
    check('abertura de carga em ARMAZENAGEM é bloqueada com aviso "Inspeção Indisponível"',
      Boolean(aviso) && w.document.getElementById('checklistFormContainer').classList.contains('hidden') && w.nexusInspecaoEstado().cargaId === null,
      JSON.stringify(feedbacks));
    w.close();
  }

  log('\n[3] Tela: status permitidos (RECEBIMENTO_INSPECAO e RECUSADA) continuam abrindo o checklist normalmente');
  {
    const { w } = await abrirInspecao({ query: '?carga=CRG-RCD' });
    check('carga RECUSADA abre o checklist', !w.document.getElementById('checklistFormContainer').classList.contains('hidden'));
    const estado = w.nexusInspecaoEstado();
    check('estado da tela aponta a carga RECUSADA', estado.cargaId === 'CRG-RCD' && estado.carga_status === 'RECUSADA', JSON.stringify(estado));
    w.close();
  }
  {
    const { w } = await abrirInspecao();
    abrirChecklistPelaTela(w, 'CRG-REC');
    const estado = w.nexusInspecaoEstado();
    check('carga RECEBIMENTO_INSPECAO abre pelo seletor + botão "Carregar Checklist"',
      estado.cargaId === 'CRG-REC' && estado.carga_status === 'RECEBIMENTO_INSPECAO', JSON.stringify(estado));
    w.close();
  }

  log('\n[4] Tela: gravação recusada quando a carga entrou em trânsito com o checklist aberto');
  {
    // Corrida: a tela abriu com RECEBIMENTO_INSPECAO, mas o navio foi liberado
    // e o banco agora responde EM_TRANSITO — aprovar não pode gravar nada.
    const { w, registro, feedbacks } = await abrirInspecao({ statusCargaNoBanco: 'EM_TRANSITO' });
    abrirChecklistPelaTela(w, 'CRG-REC');
    marcarTudoConforme(w);
    check('itens críticos conformes liberam o botão (regra RN 14 intacta)', !w.document.getElementById('aprovarCargaBtn').disabled);
    registro.length = 0;
    const gravou = await w.nexusInspecaoAprovar();
    const aviso = feedbacks.find((f) => f.titulo === 'Carga em Trânsito');
    check('aprovação retorna false (gravação recusada)', gravou === false, String(gravou));
    check('aprovação recusada mostra o aviso "Carga em Trânsito"', Boolean(aviso), JSON.stringify(feedbacks));
    check('nenhuma atualização de status da carga foi enviada ao banco',
      !registro.some((r) => r.tabela === 'cargas' && r.op === 'update'), JSON.stringify(registro));
    check('nenhuma inspeção foi gravada no banco', !registro.some((r) => r.tabela === 'inspecoes'), JSON.stringify(registro));
    check('o cache local preserva o status real da carga (nada de ARMAZENAGEM fantasma)',
      cargaSalva(w, 'CRG-REC') && cargaSalva(w, 'CRG-REC').status === 'RECEBIMENTO_INSPECAO');
    w.close();
  }
  {
    // A mesma corrida na recusa formal: também é barrada antes de gravar.
    const { w, registro, feedbacks } = await abrirInspecao({ statusCargaNoBanco: 'EM_TRANSITO' });
    abrirChecklistPelaTela(w, 'CRG-REC');
    registro.length = 0;
    const gravou = await w.nexusInspecaoRecusar({ motivo: 'Lacre rompido na chegada' });
    const aviso = feedbacks.find((f) => f.titulo === 'Carga em Trânsito');
    check('recusa retorna false (gravação recusada)', gravou === false, String(gravou));
    check('recusa recusada mostra o aviso "Carga em Trânsito"', Boolean(aviso), JSON.stringify(feedbacks));
    check('recusa não envia escritas ao banco', registro.filter((r) => r.op !== 'select').length === 0, JSON.stringify(registro));
    check('motivo de recusa não é gravado no cache local',
      cargaSalva(w, 'CRG-REC').status === 'RECEBIMENTO_INSPECAO' && !cargaSalva(w, 'CRG-REC').motivoRecusa);
    w.close();
  }

  log('\n[5] Tela: inspeção normal segue funcionando (aprovação grava ARMAZENAGEM)');
  {
    const { w, registro, feedbacks } = await abrirInspecao({ statusCargaNoBanco: 'RECEBIMENTO_INSPECAO' });
    abrirChecklistPelaTela(w, 'CRG-REC');
    marcarTudoConforme(w);
    const gravou = await w.nexusInspecaoAprovar();
    check('aprovação normal retorna true', gravou === true, String(gravou));
    check('feedback de sucesso "Inspeção Concluída"', feedbacks.some((f) => f.tipo === 'sucesso' && f.titulo === 'Inspeção Concluída'), JSON.stringify(feedbacks));
    check('banco recebe a atualização da carga para ARMAZENAGEM/APROVADA',
      registro.some((r) => r.tabela === 'cargas' && r.op === 'update' && r.payload && r.payload.status_fluxo === 'ARMAZENAGEM' && r.payload.resultado_inspecao === 'APROVADA'),
      JSON.stringify(registro.filter((r) => r.tabela === 'cargas')));
    check('inspeção formal gravada como ativa e APROVADA',
      registro.some((r) => r.tabela === 'inspecoes' && r.op === 'insert' && r.payload && r.payload.resultado === 'APROVADA' && r.payload.ativa === true));
    check('cache local atualizado para ARMAZENAGEM', cargaSalva(w, 'CRG-REC').status === 'ARMAZENAGEM');
    check('nenhum aviso de "Carga em Trânsito" no fluxo normal', !feedbacks.some((f) => f.titulo === 'Carga em Trânsito'));
    w.close();
  }
}

/* ------------------------------------------------------------------ *
 * Parte 2 — WebMCP (ferramenta inspecionar_carga)
 * ------------------------------------------------------------------ */
const BASE = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js'];
const NUCLEO = ['js/webmcp/webmcp-core.js'];
const UI_DADOS_GLOBAL = ['js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js'];

/** Provedor de confirmação de teste (mesmo padrão de test_webmcp_paginas.js). */
function provedorDeTeste(w) {
  w.__pedidos = [];
  w.__resposta = true;
  w.NexusWebMCP.iniciar({
    confirmar: async (pedido) => {
      w.__pedidos.push(pedido);
      return typeof w.__resposta === 'function' ? w.__resposta(pedido) : w.__resposta;
    }
  });
}

function cargasWebMcp() {
  const agora = new Date().toISOString();
  return [
    { id: 'CRG-W1', tipo: "Contêiner 20' Dry", peso: '12 t', volume: '20 m³', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', qrCode: 'QR-CRG-W1', data_cadastro: agora },
    { id: 'CRG-W2', tipo: "Contêiner 20' Dry", peso: '6 t', volume: '12 m³', status: 'EM_TRANSITO', portoDescarga: 'Porto de Roterdã', container: 'MSCU1234567', navio: 'MV Santos Star', qrCode: 'QR-CRG-W2', data_cadastro: agora },
    { id: 'CRG-W3', tipo: "Contêiner 20' Dry", peso: '10 t', volume: '25 m³', status: 'RECUSADA', portoDescarga: 'Pátio STS-01 (Setor C)', container: '', navio: '', qrCode: 'QR-CRG-W3', data_cadastro: agora },
    { id: 'CRG-W4', tipo: "Contêiner 20' Dry", peso: '10 t', volume: '25 m³', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor C)', container: '', navio: '', qrCode: 'QR-CRG-W4', data_cadastro: agora }
  ];
}

async function abrirPaginaWebMcp() {
  const scripts = BASE.concat(['js/pages/inspecao.js'], NUCLEO, [provedorDeTeste], UI_DADOS_GLOBAL, ['js/webmcp/webmcp-inspecao.js']);
  const janela = criarJanela({
    url: 'https://nexusport.test/inspecao.html',
    html: htmlDaPagina('inspecao.html'),
    session: sessao('INSPETOR'),
    storage: { nexus_cargas_fluxo: cargasWebMcp() },
    scripts
  });
  await prontoDom(janela.w);
  await aguardar(80);
  return janela;
}

const RESPOSTAS_CONFORMES = ['doc_1', 'ident_1', 'fis_1', 'fis_2', 'conf_1', 'seg_1'].map((item_id) => ({ item_id, conforme: true }));

async function testarWebMcp() {
  log('\n[6] WebMCP: inspecionar_carga responde bloqueio para carga EM_TRANSITO');
  const janela = await abrirPaginaWebMcp();
  const w = janela.w;

  // O seletor da tela (que o WebMCP usa) também lista apenas RECEBIMENTO_INSPECAO e RECUSADA.
  const opcoes = Array.from(w.document.getElementById('inspecaoCargaSelect').options).map((opt) => opt.value);
  check('tela do WebMCP: somente RECEBIMENTO_INSPECAO e RECUSADA no seletor; EM_TRANSITO e ARMAZENAGEM fora',
    !opcoes.includes('CRG-W2') && !opcoes.includes('CRG-W4') && opcoes.includes('CRG-W1') && opcoes.includes('CRG-W3'), JSON.stringify(opcoes));

  let r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-W4', decisao: 'APROVAR', respostas: RESPOSTAS_CONFORMES });
  check('APROVAR carga ARMAZENAGEM: bloqueio ESTADO_INVALIDO', r.ok === false && r.codigo === 'ESTADO_INVALIDO', JSON.stringify(r).slice(0, 220));

  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-W2', decisao: 'APROVAR', respostas: RESPOSTAS_CONFORMES });
  check('APROVAR carga EM_TRANSITO: bloqueio CARGA_EM_TRANSITO', r.ok === false && r.codigo === 'CARGA_EM_TRANSITO', JSON.stringify(r).slice(0, 220));
  check('mensagem do bloqueio explica que a carga já saiu do porto',
    typeof r.mensagem === 'string' && r.mensagem.includes('EM_TRANSITO') && r.mensagem.includes('não pode ser inspecionada'), r.mensagem);
  check('bloqueio acontece antes de qualquer confirmação do operador', w.__pedidos.length === 0, JSON.stringify(w.__pedidos.length));
  check('a tela não abriu o checklist da carga em trânsito', w.nexusInspecaoEstado().cargaId === null);
  check('estado salvo intacto: carga continua EM_TRANSITO com navio vinculado',
    cargaSalva(w, 'CRG-W2').status === 'EM_TRANSITO' && cargaSalva(w, 'CRG-W2').navio === 'MV Santos Star');

  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-W2', decisao: 'RECUSAR', respostas: [{ item_id: 'doc_1', conforme: false }], motivo: 'Lacre violado no contêiner' });
  check('RECUSAR carga EM_TRANSITO: mesmo bloqueio CARGA_EM_TRANSITO', r.ok === false && r.codigo === 'CARGA_EM_TRANSITO', JSON.stringify(r).slice(0, 220));
  check('recusa bloqueada não altera o estado salvo', cargaSalva(w, 'CRG-W2').status === 'EM_TRANSITO' && !cargaSalva(w, 'CRG-W2').motivoRecusa);
  check('nenhum erro não capturado na página WebMCP', janela.erros.length === 0, JSON.stringify(janela.erros));

  log('\n[7] WebMCP: inspeção normal continua funcionando nos demais status');
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-W1', decisao: 'APROVAR', respostas: RESPOSTAS_CONFORMES });
  check('APROVAR carga RECEBIMENTO_INSPECAO: inspeção concluída', r.ok === true, JSON.stringify(r).slice(0, 220));
  check('estado salvo: carga aprovada vira ARMAZENAGEM', cargaSalva(w, 'CRG-W1').status === 'ARMAZENAGEM');
  w.close();
}

/* ------------------------------------------------------------------ */
(async () => {
  log('================================================================');
  log('🧪 REGRESSÃO — INSPEÇÃO DE CARGA EM_TRANSITO (TAREFA 1)');
  log('================================================================');

  try {
    await testarTela();
    await testarWebMcp();
  } catch (erro) {
    check('execução sem exceções', false, erro && erro.stack ? erro.stack : String(erro));
  }

  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas}/${total} verificações aprovadas.`);
  if (falhas === 0) {
    log('✅ Bloqueio de inspeção de carga EM_TRANSITO validado em todos os canais.');
    process.exit(0);
  } else {
    log('💥 FALHA EM UMA OU MAIS VERIFICAÇÕES.');
    process.exit(1);
  }
})();
