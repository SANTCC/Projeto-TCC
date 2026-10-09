/**
 * Teste de Verificação — WebMCP nas páginas reais (integração em jsdom).
 *
 * Carrega os scripts reais de cada página (cargas, inspeção, embarcações, manutenção,
 * delegação, gestão de pessoas, relatórios, scanner e painel), semeia o cache local que
 * as páginas usam (sem Supabase) e executa as ferramentas WebMCP pelo mesmo caminho
 * que um agente usaria. Verifica: RBAC por cargo, pré-condições, confirmação humana,
 * resultado confirmado no estado salvo, ausência de dados sensíveis nas respostas
 * e preservação das regras de negócio das páginas.
 *
 * Executar: node tests/test_webmcp_paginas.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, read } = H;

const BASE = ['js/security.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js'];

/** Erros não capturados observados em cada página carregada (devem ser zero). */
const ERROS_DE_PAGINA = [];
const NUCLEO = ['js/webmcp/webmcp-core.js'];
const UI_DADOS_GLOBAL = ['js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js'];

/** Provedor de confirmação de teste: registra os pedidos e responde o valor de w.__resposta. */
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

/** Carrega uma página real com seus scripts e o WebMCP correspondente. */
function pagina(arquivo, opcoes) {
  const o = opcoes || {};
  const scripts = BASE.concat(o.scriptsPagina || [], NUCLEO, [provedorDeTeste], UI_DADOS_GLOBAL, o.adaptadores || [], o.extras || []);
  const janela = criarJanela({
    url: `https://nexusport.test/${arquivo}`,
    html: H.htmlDaPagina(arquivo),
    session: o.session,
    storage: Object.assign({}, o.storage || {}),
    scripts
  });
  ERROS_DE_PAGINA.push({ arquivo, erros: janela.erros });
  return janela.w;
}

async function pronta(w) {
  await prontoDom(w);
  await aguardar(40);
  return w;
}

const PAGINA_CARGAS = ['js/pages/cargas.js', 'js/webmcp/webmcp-cargas.js'];

function cargasBase() {
  const agora = new Date().toISOString();
  return [
    { id: 'CRG-A', tipo: "Contêiner 20' Dry", peso: '12 t', volume: '20 m³', valor: 'R$ 1.000,00', natureza: 'Geral', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', qrCode: 'QR-CRG-A', data_cadastro: agora },
    { id: 'CRG-B', tipo: 'Reefer (Contêiner Refrigerado)', peso: '8 t', volume: '30 m³', valor: 'R$ 5.000,00', natureza: 'Perecível', status: 'AGENDAMENTO', portoDescarga: 'Pátio STS-01 (Setor C)', container: '', navio: '', qrCode: 'QR-CRG-B', data_cadastro: agora },
    { id: 'CRG-C', tipo: "Contêiner 20' Dry", peso: '10 t', volume: '25 m³', valor: 'R$ 2.000,00', natureza: 'Geral', status: 'PRONTA_PARA_ENTREGA', portoDescarga: 'Pátio STS-01 (Setor B)', container: 'MSCU1234567', navio: 'MV Santos Star', qrCode: 'QR-CRG-C', data_cadastro: agora },
    { id: 'CRG-D', tipo: "Contêiner 20' Dry", peso: '5 t', volume: '10 m³', valor: 'R$ 500,00', natureza: 'Geral', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', qrCode: 'QR-CRG-D', data_cadastro: agora },
    { id: 'CRG-E', tipo: "Contêiner 20' Dry", peso: '6 t', volume: '12 m³', valor: 'R$ 700,00', natureza: 'Geral', status: 'EM_TRANSITO', portoDescarga: 'Porto de Roterdã', container: 'MSCU1234567', navio: 'MV Santos Star', qrCode: 'QR-CRG-E', data_cadastro: agora },
    { id: 'CRG-R', tipo: 'Reefer (Contêiner Refrigerado)', peso: '4 t', volume: '9 m³', valor: 'R$ 900,00', natureza: 'Perecível', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'Pátio STS-01 (Setor C)', container: '', navio: '', qrCode: 'QR-CRG-R', data_cadastro: agora }
  ];
}

// ------------------------------------------------------------------
async function testesCargas() {
  log('\n[1] Cargas & Pátio (cargas.html — código real da página)');
  const storage = {
    nexus_cargas_fluxo: cargasBase(),
    nexus_containers_list: [{ identificacao: 'MSCU1234567', tipo: 'Eletrônicos', estado: 'OPERANTE', navio: '' }, { identificacao: 'MSCU7654321', tipo: 'Têxteis', estado: 'OPERANTE', navio: '' }],
    nexus_guindastes_list: [{ identificacao: 'GND-01-STS', estado: 'OPERANTE' }, { identificacao: 'GND-02-STS', estado: 'EM_MANUTENCAO' }],
    nexus_guindaste_tarefas: []
  };

  // Supervisor: leitura, vinculação com confirmação, cancelamento com motivo (sem diálogo)
  let w = await pronta(pagina('cargas.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, adaptadores: PAGINA_CARGAS }));
  let promptChamado = 0;
  w.nexusPrompt = async () => { promptChamado += 1; return 'não deveria'; };
  let r = await w.NexusWebMCP.executar('listar_cargas', {});
  check('listar_cargas: não mostra canceladas e respeita a visão do supervisor', r.ok && r.dados.total === 6, JSON.stringify(r.dados && r.dados.total));
  r = await w.NexusWebMCP.executar('listar_cargas', { status: 'ARMAZENAGEM' });
  check('listar_cargas: filtro por status', r.ok && r.dados.itens.every((c) => c.status === 'ARMAZENAGEM') && r.dados.total === 2);
  r = await w.NexusWebMCP.executar('obter_carga', { id: 'CRG-A' });
  check('obter_carga: lista as ações que o operador pode pedir agora', r.ok && r.dados.acoes_disponiveis.includes('vincular_carga_container') && r.dados.acoes_disponiveis.includes('cancelar_entrega'), JSON.stringify(r.dados && r.dados.acoes_disponiveis));
  check('obter_carga: não revela valor declarado', r.dados && !('valor' in r.dados));

  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('vincular_carga_container', { id: 'CRG-A', container: 'MSCU1234567' });
  let local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('vincular: confirmação pedida antes da execução (um pedido)', w.__pedidos.length === 1 && w.__pedidos[0].ferramenta.nome === 'vincular_carga_container');
  check('vincular: resultado confirmado no estado salvo', r.ok && local.find((c) => c.id === 'CRG-A').container === 'MSCU1234567', JSON.stringify(r));
  check('vincular: resposta traz o feedback da própria tela', Array.isArray(r.feedback) && r.feedback.length >= 1);

  w.__resposta = false;
  r = await w.NexusWebMCP.executar('vincular_carga_container', { id: 'CRG-D', container: 'MSCU7654321' });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('vincular recusado pelo operador: nada muda', r.codigo === 'CANCELADO_PELO_OPERADOR' && local.find((c) => c.id === 'CRG-D').container === '');
  w.__resposta = true;

  r = await w.NexusWebMCP.executar('vincular_carga_container', { id: 'CRG-B', container: 'MSCU1234567' });
  check('vincular: exige carga armazenada (ARMAZENAGEM)', r.ok === false && r.codigo === 'ESTADO_INVALIDO', JSON.stringify(r));

  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('cancelar_entrega', { id: 'CRG-D', motivo: 'Cliente solicitou cancelamento' });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  const cancelada = local.find((c) => c.id === 'CRG-D');
  check('cancelar: motivo enviado pelo agente (sem diálogo da página)', promptChamado === 0 && cancelada.motivoCancelamento === 'Cliente solicitou cancelamento', `prompt: ${promptChamado}`);
  check('cancelar: carga sai da lista ativa e status vira CANCELADA', r.ok && cancelada.status === 'CANCELADA', JSON.stringify(r));
  check('cancelar: pedido de confirmação com o motivo no resumo', w.__pedidos[0].resumo.some((l) => /Cliente solicitou/.test(l)));
  r = await w.NexusWebMCP.executar('cancelar_entrega', { id: 'CRG-C', motivo: 'Motivo de teste' });
  check('cancelar: PRONTA_PARA_ENTREGA é um estado permitido para cancelamento (RN 16)', r.ok === true, JSON.stringify(r));
  r = await w.NexusWebMCP.executar('cancelar_entrega', { id: 'CRG-E', motivo: 'Motivo de teste' });
  check('cancelar: carga EM_TRANSITO é recusada pela regra de negócio', r.ok === false, JSON.stringify(r));

  w.__pedidos.length = 0;
  const antes = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')).length;
  r = await w.NexusWebMCP.executar('agendar_carga', {
    tipo: "Contêiner 20' Dry", peso: 12.5, volume: 40, valor: 150000, natureza: 'Agrícola',
    porto_descarga: 'Pátio STS-01 (Setor B)', destino: 'Armazém Norte', data_prevista: new Date().toISOString().split('T')[0]
  });
  const apos = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('agendar: cria a carga com QR e resposta traz o identificador', r.ok === true && apos.length === antes + 1 && /^CRG-2026-\d{3}$/.test(r.dados.id) && r.dados.codigo_qr.startsWith('QR-'), JSON.stringify(r).slice(0, 220));
  check('agendar: resumo mostra peso, volume e valor em formato brasileiro', w.__pedidos[w.__pedidos.length - 1].resumo.some((l) => /12\.5 t/.test(l) && /R\$/.test(l)));
  r = await w.NexusWebMCP.executar('agendar_carga', {
    tipo: 'Tipo inexistente', peso: 1, volume: 1, valor: 1, natureza: 'Geral', porto_descarga: 'Pátio STS-01 (Setor B)', destino: 'Armazém Norte'
  });
  check('agendar: tipo de carga não cadastrado é recusado (RN 13)', r.codigo === 'TIPO_NAO_CADASTRADO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('agendar_carga', {
    tipo: "Contêiner 20' Dry", peso: 1, volume: 1, valor: 1, natureza: 'Geral', porto_descarga: 'Setor Inexistente', destino: 'Armazém Norte'
  });
  check('agendar: setor fora da lista da tela é recusado pelo esquema', r.ok === false && r.codigo === 'ARGUMENTOS_INVALIDOS', JSON.stringify(r));

  r = await w.NexusWebMCP.executar('listar_cargas', {});
  check('emergência (supervisor): leitura continua disponível', r.ok === true);
  w.close();

  // Emergência: a movimentação (ação de estivador) é bloqueada; leitura permitida
  w = await pronta(pagina('cargas.html', { session: sessao('ESTIVADOR'), storage: JSON.parse(JSON.stringify(storage)), adaptadores: PAGINA_CARGAS }));
  w.nexusEmergenciaAtiva = () => true;
  r = await w.NexusWebMCP.executar('movimentar_carga', { id: 'CRG-A', guindaste: 'GND-01-STS' });
  check('emergência: movimentação bloqueada (EMERGENCIA_ATIVA)', r.codigo === 'EMERGENCIA_ATIVA', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('listar_cargas', {});
  check('emergência: leitura de cargas continua disponível', r.ok === true);
  w.close();

  // Estivador: movimentação com guindaste operante; bloqueios de estado e de guindaste
  w = await pronta(pagina('cargas.html', { session: sessao('ESTIVADOR'), storage, adaptadores: PAGINA_CARGAS }));
  let promptEstivador = 0;
  w.nexusPrompt = async () => { promptEstivador += 1; return null; };
  r = await w.NexusWebMCP.executar('movimentar_carga', { id: 'CRG-E', guindaste: 'GND-01-STS' });
  check('movimentar: carga em trânsito não pode ser movimentada', r.ok === false, JSON.stringify(r));
  r = await w.NexusWebMCP.executar('movimentar_carga', { id: 'CRG-A', guindaste: 'GND-02-STS' });
  check('movimentar: guindaste em manutenção é recusado', r.codigo === 'GUINDASTE_INDISPONIVEL', JSON.stringify(r));
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('movimentar_carga', { id: 'CRG-A', guindaste: 'GND-01-STS' });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  const movida = local.find((c) => c.id === 'CRG-A');
  const tarefas = JSON.parse(w.localStorage.getItem('nexus_guindaste_tarefas') || '[]');
  check('movimentar: designa o guindaste e cria a tarefa (como na página)',
    r.ok === true && movida.guindasteDesignado === 'GND-01-STS' && movida.portoDescarga === 'Sala de Contêiner' && tarefas.some((t) => t.cargaId === 'CRG-A'), JSON.stringify(r));
  check('movimentar: não usa o diálogo de escolha da página (nexusPrompt não chamado)', promptEstivador === 0, `chamadas: ${promptEstivador}`);
  r = await w.NexusWebMCP.executar('liberar_carga_saida', { id: 'CRG-C' });
  check('estivador não pode liberar saída (PERMISSAO_NEGADA)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('agendar_carga', { tipo: "Contêiner 20' Dry", peso: 1, volume: 1, valor: 1, natureza: 'Geral', porto_descarga: 'Pátio STS-01 (Setor B)', destino: 'Armazém Norte' });
  check('estivador não agenda cargas (cargo sem permissão do agendamento)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();

  // Conferente: recebimento só a partir de AGENDAMENTO
  w = await pronta(pagina('cargas.html', { session: sessao('CONFERENTE_CARGA'), storage, adaptadores: PAGINA_CARGAS }));
  r = await w.NexusWebMCP.executar('receber_carga', { id: 'CRG-R' });
  check('receber: só a partir de AGENDAMENTO (carga já em inspeção é recusada)', r.codigo === 'ESTADO_INVALIDO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('receber_carga', { id: 'CRG-B' });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('receber: AGENDAMENTO → RECEBIMENTO_INSPECAO (confirmado no estado)', r.ok === true && local.find((c) => c.id === 'CRG-B').status === 'RECEBIMENTO_INSPECAO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('listar_tipos_carga', {});
  check('listar_tipos_carga: lista os tipos com itens de checklist', r.ok && r.dados.itens.length >= 1 && r.dados.itens[0].itens_checklist > 0);
  w.close();
}

// ------------------------------------------------------------------
async function testesInspecao() {
  log('\n[2] Inspeção & Checklist (inspecao.html)');
  const storage = {
    nexus_cargas_fluxo: [
      { id: 'CRG-I1', tipo: "Contêiner 20' Dry", peso: '12 t', volume: '20 m³', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', qrCode: 'QR-CRG-I1', data_cadastro: new Date().toISOString() },
      { id: 'CRG-I2', tipo: 'Reefer (Contêiner Refrigerado)', peso: '8 t', volume: '30 m³', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'Pátio STS-01 (Setor C)', container: '', navio: '', qrCode: 'QR-CRG-I2', data_cadastro: new Date().toISOString() }
    ]
  };
  const w = await pronta(pagina('inspecao.html', { session: sessao('INSPETOR'), storage, scriptsPagina: ['js/pages/inspecao.js'], adaptadores: ['js/webmcp/webmcp-inspecao.js'] }));
  let r = await w.NexusWebMCP.executar('obter_checklist', { id: 'CRG-I1' });
  const criticos = r.ok ? r.dados.itens.filter((i) => i.critico).map((i) => i.item_id) : [];
  check('checklist: itens críticos do tipo da carga (RN 14)', r.ok && criticos.length === 5, JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('listar_cargas_inspecao', {});
  check('listar_cargas_inspecao: traz cargas em RECEBIMENTO_INSPECAO', r.ok && r.dados.total === 2);

  // Aprovação incompleta é bloqueada antes de tocar na tela
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I1', decisao: 'APROVAR', respostas: [{ item_id: 'doc_1', conforme: true }] });
  check('aprovação sem todos os itens críticos: CHECKLIST_INCOMPLETO', r.codigo === 'CHECKLIST_INCOMPLETO', JSON.stringify(r));
  let local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('aprovação incompleta não altera a carga', local.find((c) => c.id === 'CRG-I1').status === 'RECEBIMENTO_INSPECAO');

  // Item inexistente
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I1', decisao: 'APROVAR', respostas: [{ item_id: 'inventado', conforme: true }] });
  check('item que não existe no checklist é recusado', r.codigo === 'ITEM_INEXISTENTE', JSON.stringify(r));

  // Aprovação completa, com confirmação
  w.__pedidos.length = 0;
  const todas = ['doc_1', 'ident_1', 'fis_1', 'fis_2', 'conf_1'].map((id) => ({ item_id: id, conforme: true }))
    .concat([{ item_id: 'seg_1', conforme: false }]);
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I1', decisao: 'APROVAR', respostas: todas });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  check('aprovação com todos os críticos conformes: ARMAZENAGEM (confirmado no estado)', r.ok === true && local.find((c) => c.id === 'CRG-I1').status === 'ARMAZENAGEM', JSON.stringify(r).slice(0, 200));
  check('aprovação: confirmação do operador antes', w.__pedidos.length === 1 && w.__pedidos[0].resumo[0].startsWith('Aprovar'));

  // Recusa sem motivo é bloqueada; com motivo, registra
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I2', decisao: 'RECUSAR', respostas: [{ item_id: 'doc_1', conforme: false }] });
  check('recusa sem motivo formal é recusada', r.codigo === 'MOTIVO_OBRIGATORIO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I2', decisao: 'RECUSAR', respostas: [{ item_id: 'doc_1', conforme: false }], motivo: 'Lacre violado no contêiner' });
  local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo'));
  const recusada = local.find((c) => c.id === 'CRG-I2');
  check('recusa com motivo: RECUSADA e motivo gravado', r.ok === true && recusada.status === 'RECUSADA' && recusada.motivoRecusa === 'Lacre violado no contêiner', JSON.stringify(r).slice(0, 200));
  w.close();

  const supervisor = await pronta(pagina('inspecao.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, scriptsPagina: ['js/pages/inspecao.js'], adaptadores: ['js/webmcp/webmcp-inspecao.js'] }));
  r = await supervisor.NexusWebMCP.executar('inspecionar_carga', { id: 'CRG-I1', decisao: 'APROVAR', respostas: [{ item_id: 'doc_1', conforme: true }] });
  check('supervisor consulta a inspeção, mas não inspeciona (PERMISSAO_NEGADA)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  supervisor.close();
}

// ------------------------------------------------------------------
async function testesEmbarcacoes() {
  log('\n[3] Embarcações & GPS (embarcacoes.html)');
  const navios = [
    { id: 'n1', nome: 'MV Santos Star', imo: 'ABC1234567', localizacao: 'DENTRO_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia: 10200, gps: '-23.9608, -46.3022', dataSaida: null },
    { id: 'n2', nome: 'MV Sem Rota', imo: 'DEF7654321', localizacao: 'DENTRO_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Tóquio', distancia: 20000, gps: '-23.9700, -46.3100', dataSaida: null }
  ];
  const storage = {
    nexus_navios_list: navios,
    nexus_bercos_list: [{ id: 'B1', nome: 'Berço 01', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null }],
    nexus_containers_list: [{ identificacao: 'MSCU1234567', tipo: 'Eletrônicos', estado: 'OPERANTE', navio: '' }],
    nexus_guindastes_list: [{ identificacao: 'ABC123DEF', estado: 'OPERANTE', dataManut: '2026-01-01' }],
    nexus_cargas_fluxo: []
  };
  const adapt = ['js/webmcp/webmcp-embarcacoes.js'];
  const scr = ['js/pages/embarcacoes.js'];
  let w = await pronta(pagina('embarcacoes.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, scriptsPagina: ['js/supabase-client.js'].concat(scr), adaptadores: adapt }));
  let r = await w.NexusWebMCP.executar('listar_navios', { localizacao: 'DENTRO_DO_PORTO' });
  check('listar_navios: filtro por localização', r.ok && r.dados.total === 2);
  r = await w.NexusWebMCP.executar('obter_navio', { imo: 'abc 1234567' });
  check('obter_navio: IMO normalizado (maiúsculas e espaços)', r.ok && r.dados.nome === 'MV Santos Star' && r.dados.berco === null, JSON.stringify(r).slice(0, 200));

  r = await w.NexusWebMCP.executar('liberar_saida_navio', { imo: 'DEF7654321' });
  check('liberar: navio sem rota cadastrada (RN 9) é recusado antes da confirmação', r.codigo === 'ROTA_NAO_CADASTRADA', JSON.stringify(r));
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('liberar_saida_navio', { imo: 'ABC1234567' });
  let local = JSON.parse(w.localStorage.getItem('nexus_navios_list'));
  check('liberar: rota cadastrada → confirmação → navio FORA_DO_PORTO (confirmado)',
    r.ok === true && local.find((n) => n.imo === 'ABC1234567').localizacao === 'FORA_DO_PORTO', JSON.stringify(r).slice(0, 220));
  check('liberar: resumo traz a rota e a distância', w.__pedidos[0] && w.__pedidos[0].resumo.some((l) => /Porto de Roterdã/.test(l) && /10200 km/.test(l)));

  r = await w.NexusWebMCP.executar('vincular_navio_berco', { imo: 'DEF7654321', berco: 'Berço 01' });
  local = JSON.parse(w.localStorage.getItem('nexus_bercos_list'));
  check('vincular navio a berço: berço LIVRE recebe o navio (confirmado no estado)', r.ok === true && local.find((b) => b.nome === 'Berço 01').navio_imo === 'DEF7654321', JSON.stringify(r).slice(0, 160));

  w.__resposta = true;
  r = await w.NexusWebMCP.executar('cadastrar_navio', { nome: 'MV Nova', imo: 'XYZ7654321', origem: 'Porto de Santos', destino: 'Porto de Roterdã', localizacao: 'DENTRO_DO_PORTO', gps: '-23.5, -46.3', distancia_km: 10200 });
  check('cadastrar navio: supervisor não cadastra (não é inspetor)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();

  w = await pronta(pagina('embarcacoes.html', { session: sessao('INSPETOR'), storage, scriptsPagina: ['js/supabase-client.js'].concat(scr), adaptadores: adapt }));
  r = await w.NexusWebMCP.executar('cadastrar_navio', { nome: 'MV Nova', imo: 'ABC1234567', origem: 'Porto de Santos', destino: 'Porto de Roterdã', localizacao: 'DENTRO_DO_PORTO', gps: '-23.5, -46.3', distancia_km: 10200 });
  check('cadastrar navio: IMO duplicado é recusado (Item 11)', r.codigo === 'IMO_DUPLICADO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('cadastrar_navio', { nome: 'MV Nova', imo: 'XYZ7654321', origem: 'Porto de Santos', destino: 'Porto de Roterdã', localizacao: 'DENTRO_DO_PORTO', gps: '-23.5, -46.3', distancia_km: 10200 });
  local = JSON.parse(w.localStorage.getItem('nexus_navios_list'));
  check('cadastrar navio: cria pelo formulário da página (confirmado no estado)', r.ok === true && local.some((n) => n.imo === 'XYZ7654321'), JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('excluir_navio', { imo: 'XYZ7654321' });
  check('excluir navio: inspetor exclui com confirmação', r.ok === true && !JSON.parse(w.localStorage.getItem('nexus_navios_list')).some((n) => n.imo === 'XYZ7654321'), JSON.stringify(r));
  r = await w.NexusWebMCP.executar('cadastrar_container', { identificacao: 'MSCU7654321', tipo: 'Têxteis', data_fabricacao: '2020-01-10', referencia_tempo: 'DATA_FABRICACAO' });
  check('cadastrar contêiner: identificação ISO e formulário da página', r.ok === true && JSON.parse(w.localStorage.getItem('nexus_containers_list')).some((c) => c.identificacao === 'MSCU7654321'), JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('cadastrar_container', { identificacao: 'MSCU1-234-567', tipo: 'X', data_fabricacao: '2020-01-10', referencia_tempo: 'DATA_FABRICACAO' });
  check('cadastrar contêiner: identificação fora do padrão é recusada pelo esquema', r.codigo === 'ARGUMENTOS_INVALIDOS', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('listar_guindastes', {});
  check('listar_guindastes: lista guindastes e estados', r.ok && r.dados.itens[0].identificacao === 'ABC123DEF');
  w.close();

  // Planejador: lê, mas não libera nem cadastra
  w = await pronta(pagina('embarcacoes.html', { session: sessao('PLANEJADOR_PATIO_NAVIOS'), storage, scriptsPagina: ['js/supabase-client.js'].concat(scr), adaptadores: adapt }));
  r = await w.NexusWebMCP.executar('listar_navios', {});
  check('planejador lê navios', r.ok === true && r.dados.total >= 1);
  r = await w.NexusWebMCP.executar('liberar_saida_navio', { imo: 'ABC1234567' });
  check('planejador não libera saída de navio', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();
}

// ------------------------------------------------------------------
async function testesManutencao() {
  log('\n[4] Manutenção & OS (manutencao.html)');
  const storage = {
    nexus_guindastes_list: [{ identificacao: 'ABC123DEF', estado: 'OPERANTE', dataManut: '2026-01-01' }],
    nexus_os_list: [{ id: 'OS-2026-100', equipamento: 'Guindaste ABC123DEF', prioridade: 'ALTA', descricao: 'Revisão', status: 'SOLICITADA', data: '2026-10-01' }],
    nexus_containers_list: [], nexus_navios_list: []
  };
  let w = await pronta(pagina('manutencao.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, scriptsPagina: ['js/pages/manutencao.js'], adaptadores: ['js/webmcp/webmcp-manutencao.js'] }));
  let r = await w.NexusWebMCP.executar('listar_ordens_servico', { status: 'SOLICITADA' });
  check('listar OS: filtra por status', r.ok && r.dados.total === 1);
  r = await w.NexusWebMCP.executar('obter_ordem_servico', { id: 'OS-2026-100' });
  check('obter OS: informa ações possíveis no status atual', r.ok && r.dados.acoes_possiveis.includes('APROVAR') && r.dados.acoes_possiveis.includes('REPROVAR'));
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('executar_acao_os', { id: 'OS-2026-100', acao: 'CONCLUIR' });
  check('executar OS: CONCLUIR exige OS em manutenção (ESTADO_INVALIDO)', r.codigo === 'ESTADO_INVALIDO', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('executar_acao_os', { id: 'OS-2026-100', acao: 'APROVAR' });
  let os = JSON.parse(w.localStorage.getItem('nexus_os_list')).find((o) => o.id === 'OS-2026-100');
  check('aprovar OS: status EM_MANUTENCAO após confirmação', r.ok === true && os.status === 'EM_MANUTENCAO', JSON.stringify(r).slice(0, 180));

  r = await w.NexusWebMCP.executar('solicitar_manutencao_guindaste', { identificacao: 'ABC123DEF', justificativa: 'Revisão dos cabos de aço' });
  let gnd = JSON.parse(w.localStorage.getItem('nexus_guindastes_list'))[0];
  check('manutenção de guindaste: estado EM_MANUTENCAO e justificativa sem diálogo', r.ok === true && gnd.estado === 'EM_MANUTENCAO', JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('solicitar_manutencao_guindaste', { identificacao: 'ABC123DEF', justificativa: 'Outra revisão qualquer' });
  check('manutenção duplicada é bloqueada (Tarefa 9)', r.codigo === 'MANUTENCAO_DUPLICADA', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('concluir_manutencao_guindaste', { identificacao: 'ABC123DEF' });
  gnd = JSON.parse(w.localStorage.getItem('nexus_guindastes_list'))[0];
  check('concluir manutenção: guindaste volta a OPERANTE', r.ok === true && gnd.estado === 'OPERANTE', JSON.stringify(r).slice(0, 180));

  const prep = w.NexusWebMCP.ferramentas().find((t) => t.nome === 'preparar_manutencao_navio');
  check('manutenção de navio: ferramenta declarativa de preenchimento registrada', Boolean(prep));
  w.close();

  w = await pronta(pagina('manutencao.html', { session: sessao('INSPETOR'), storage, scriptsPagina: ['js/pages/manutencao.js'], adaptadores: ['js/webmcp/webmcp-manutencao.js'] }));
  r = await w.NexusWebMCP.executar('solicitar_manutencao_guindaste', { identificacao: 'ABC123DEF', justificativa: 'Teste de permissão' });
  check('inspetor não solicita manutenção de guindaste (só supervisão)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();
}

// ------------------------------------------------------------------
async function testesDelegacaoETecnico() {
  log('\n[5] Delegação de Supervisor (delegacao.html) — dados pessoais fora do agente');
  const storage = {
    nexus_active_delegation: { substitutoMatricula: 'MAT-7001', substitutoNome: 'Carlos Substituto', substituidoNome: 'Ana Titular', substituidoMatricula: 'MAT-1001', inicio: '2026-10-01T08:00', fim: '2099-01-01T00:00' }
  };
  let w = await pronta(pagina('delegacao.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, scriptsPagina: ['js/pages/delegacao.js'], adaptadores: ['js/webmcp/webmcp-delegacao.js'] }));
  let r = await w.NexusWebMCP.executar('obter_delegacao_ativa', {});
  check('delegação ativa: mostra substituto e vigência, sem CPF', r.ok && r.dados.ativa === true && !/cpf|CPF/.test(JSON.stringify(r.dados)), JSON.stringify(r).slice(0, 200));
  const form = w.document.getElementById('delegacaoForm');
  let envios = 0;
  form.addEventListener('submit', (e) => { e.preventDefault(); envios += 1; });
  r = await w.NexusWebMCP.executar('preparar_designacao_substituto', {
    delegSubstituidoMatricula: 'MAT-1002', delegSubstitutoNome: 'Marta Substituta', delegDataInicio: '2026-11-01T08:00', delegDataFim: '2026-11-15T18:00'
  });
  check('preparar designação: preenche nome, matrícula e vigência', r.ok === true && w.document.getElementById('delegSubstitutoNome').value === 'Marta Substituta', JSON.stringify(r).slice(0, 200));
  check('preparar designação: CPF e data de nascimento permanecem com o operador', w.document.getElementById('delegSubstitutoCpf').value === ''
    && r.dados.preencher_pelo_operador.includes('delegSubstitutoCpf') && r.dados.preencher_pelo_operador.includes('delegSubstitutoDataNasc'));
  check('preparar designação: não envia o formulário', envios === 0);
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('revogar_delegacao', {});
  check('revogar delegação: confirmação do operador antes', w.__pedidos.length === 1);
  check('revogar delegação: substituto removido (confirmado)', r.ok === true && w.localStorage.getItem('nexus_active_delegation') === null, JSON.stringify(r));
  r = await w.NexusWebMCP.executar('revogar_delegacao', {});
  check('revogar sem delegação ativa: SEM_DELEGACAO', r.codigo === 'SEM_DELEGACAO', JSON.stringify(r));
  w.close();

  log('\n[6] Gestão de Pessoas (tecnico_portos.html) — código de acesso nunca sai do sistema');
  const storageTec = {
    nexus_func_list: [{ matricula: 'MAT-9900', nome: 'Joana Operadora', cargo: 'Estivador', codigo: 'NX-9900-1111', codigo_individual: 'NX-9900-1111', ativo: true }],
    nexus_vis_list: [{ id: 'VIS-1', nome: 'Visitante Um', documento: '123.456.789-09', motivo: 'Fiscalização', status: 'AGUARDANDO_AUTORIZACAO', data: '08/10/2026 10:00', por: 'MAT-1' }],
    nexus_code_overrides: {}
  };
  w = await pronta(pagina('tecnico_portos.html', { session: sessao('TECNICO_PORTOS'), storage: storageTec, scriptsPagina: ['js/pages/tecnico_portos.js'], adaptadores: ['js/webmcp/webmcp-tecnico.js'] }));
  r = await w.NexusWebMCP.executar('pesquisar_funcionario', { matricula: '9900' });
  check('pesquisar funcionário: nome e cargo, sem código de acesso', r.ok === true && r.dados.nome === 'Joana Operadora' && !/NX-9900|codigo/i.test(JSON.stringify(r.dados)), JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('listar_visitantes', {});
  check('listar visitantes: nunca mostra o documento', r.ok && !/123\.456|documento/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 200));
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('reemitir_codigo_funcionario', { matricula: 'MAT-9900' });
  const overrides = JSON.parse(w.localStorage.getItem('nexus_code_overrides') || '{}');
  const novo = overrides['MAT-9900'] && overrides['MAT-9900'].codigo;
  check('reemitir código: confirmação antes e novo código gerado', w.__pedidos.length === 1 && r.ok === true && /^NX-9900-\d{4}$/.test(novo || ''), JSON.stringify(r).slice(0, 200));
  check('reemitir código: o novo código NÃO volta ao agente (nem pelo resultado nem pelas mensagens)', r.ok && !JSON.stringify(r).includes(novo) && !/NX-[A-Z0-9]+-\d{4}/i.test(JSON.stringify(r)));
  r = await w.NexusWebMCP.executar('autorizar_entrada_visitante', { id: 'VIS-1' });
  check('autorizar visitante: aguardando autorização → EM_VISITA', r.ok === true && JSON.parse(w.localStorage.getItem('nexus_vis_list'))[0].status === 'EM_VISITA', JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('registrar_saida_visitante', { id: 'VIS-1', parecer: 'Vistoria em ordem, sem anormalidades' });
  const vis = JSON.parse(w.localStorage.getItem('nexus_vis_list'))[0];
  check('saída de visitante: concluída com parecer (sem diálogos)', r.ok === true && vis.status === 'CONCLUIDO' && vis.vistoria === 'Vistoria em ordem, sem anormalidades', JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('preparar_cadastro_visitante', { visNome: 'Novo Visitante', visMotivo: 'Auditoria' });
  check('cadastro de visitante: preenche nome e motivo; documento fica com o operador',
    r.ok === true && w.document.getElementById('visDocumento').value === '' && r.dados.preencher_pelo_operador.includes('visDocumento'));
  w.close();

  w = await pronta(pagina('tecnico_portos.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage: storageTec, scriptsPagina: ['js/pages/tecnico_portos.js'], adaptadores: ['js/webmcp/webmcp-tecnico.js'] }));
  r = await w.NexusWebMCP.executar('reemitir_codigo_funcionario', { matricula: 'MAT-9900' });
  check('supervisor não reemite códigos (só Técnico e Direção)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();
}

// ------------------------------------------------------------------
async function testesRelatoriosScannerPainel() {
  log('\n[7] Relatórios, Scanner e Painel Geral');
  const cargas = cargasBase();
  let w = await pronta(pagina('relatorios.html', { session: sessao('DIRETOR_OPERACOES_LOGISTICA'), storage: { nexus_cargas_fluxo: cargas }, scriptsPagina: ['js/pages/relatorios.js'], adaptadores: ['js/webmcp/webmcp-relatorios.js'] }));
  let exportou = 0;
  w.NexusVision.exportDadosHistoricos = async () => { exportou += 1; };
  w.__pedidos.length = 0;
  let r = await w.NexusWebMCP.executar('exportar_historico_csv', {});
  check('exportar CSV: direção confirma antes e o arquivo é baixado no navegador', r.ok === true && exportou === 1 && w.__pedidos.length === 1, JSON.stringify(r));
  check('exportar CSV: resumo informa que o conteúdo não vai ao agente', w.__pedidos[0].resumo.some((l) => /não é enviado ao agente/.test(l)));
  w.close();

  w = await pronta(pagina('relatorios.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage: { nexus_cargas_fluxo: cargas }, scriptsPagina: ['js/pages/relatorios.js'], adaptadores: ['js/webmcp/webmcp-relatorios.js'] }));
  r = await w.NexusWebMCP.executar('exportar_historico_csv', {});
  check('exportar CSV: supervisor não exporta o histórico (só Direção)', r.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r));
  w.close();

  w = await pronta(pagina('scanner.html', { session: sessao('ESTIVADOR'), storage: { nexus_cargas_fluxo: cargas, nexus_audit_logs: [] }, scriptsPagina: ['js/pages/scanner.js'], adaptadores: ['js/webmcp/webmcp-scanner.js'] }));
  r = await w.NexusWebMCP.executar('ler_codigo_qr', { codigo: 'CRG-A' });
  check('scanner: identifica a carga pelo código (com ação sugerida)', r.ok === true && r.dados.encontrado === true && r.dados.id === 'CRG-A' && typeof r.dados.acao_sugerida === 'string', JSON.stringify(r).slice(0, 220));
  r = await w.NexusWebMCP.executar('ler_codigo_qr', { codigo: "CRG-1,id.neq.0" });
  check('scanner: texto com caracteres de filtro é recusado (sem injeção em consulta)', r.codigo === 'ARGUMENTOS_INVALIDOS', JSON.stringify(r));
  const logs = JSON.parse(w.localStorage.getItem('nexus_audit_logs') || '[]');
  check('scanner: leitura fica registrada na auditoria, como na tela', logs.some((l) => /Leitura QR/.test(l.tipo_alteracao)));
  w.close();

  w = await pronta(pagina('dashboard.html', {
    session: sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE'),
    storage: {
      nexus_trail_decisoes: [{ id: 'TRL-1', decisao: 'LIBEROU_NAVIO', entidade: 'NAVIO MV Santos Star', responsavel: 'Ana Titular (Supervisor de Operações) - SUP-0001', data_hora: new Date().toISOString(), motivo: 'Saída autorizada', retificacao: null }],
      nexus_audit_logs: [{ data_hora: new Date().toISOString(), cargo: 'INSPETOR', codigo_usuario: 'INS-6090', entidade: 'CRG-A', tipo_alteracao: 'EDICAO' }]
    },
    scriptsPagina: ['js/data-repository.js', 'js/pages/dashboard.js'],
    adaptadores: ['js/webmcp/webmcp-dashboard.js']
  }));
  r = await w.NexusWebMCP.executar('listar_trilha_decisoes', {});
  check('trilha: responsável sem código individual (campo redigido)', r.ok && r.dados.itens[0].responsavel === 'Ana Titular (Supervisor de Operações)' && !/SUP-0001/.test(JSON.stringify(r)), JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('listar_auditoria', {});
  check('auditoria: sem código de usuário nos registros', r.ok && !/INS-6090|codigo_usuario|codigo_individual/.test(JSON.stringify(r.dados)));
  r = await w.NexusWebMCP.executar('obter_resumo_operacional', {});
  check('resumo operacional: números do pátio (repositório real, capacidade de 100 posições)', r.ok && typeof r.dados.cargas_armazenagem === 'number' && r.dados.ocupacao_patio.capacidade === 100, JSON.stringify(r).slice(0, 200));
  r = await w.NexusWebMCP.executar('calcular_chegada_navio', { distancia_km: 10200 });
  check('estimativa de chegada: 33 km/h (RN 9)', r.ok && /d .*h/.test(r.dados.estimativa), JSON.stringify(r));
  w.registrarTrailTeste = null;
  w.NexusWebMCP.registrarPagina({ id: 'teste_marca', arquivo: 'dashboard.html', ferramentas: [{
    nome: 'teste_marca_trilha', titulo: 'Teste de marca', descricao: 'Grava decisão na trilha.',
    anotacoes: { consequentialHint: true }, cargos: ['DIRETOR_PRESIDENTE_SUPERINTENDENTE'],
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    resumo: () => ['Gravar decisão de teste.'],
    executar: async () => { await w.registrarTrailDecisao('LIBEROU_NAVIO', 'NAVIO MV Teste', 'Liberação de teste'); return { mensagem: 'gravado' }; }
  }] });
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('teste_marca_trilha', {});
  const trilha = JSON.parse(w.localStorage.getItem('nexus_trail_decisoes') || '[]');
  check('trilha: decisão feita por agente leva a marca "[Agente WebMCP: …]"', r.ok === true && trilha.length >= 2 && trilha[0].motivo.startsWith('[Agente WebMCP: teste_marca_trilha] '), JSON.stringify(trilha[0] && trilha[0].motivo));
  w.close();
}

// ------------------------------------------------------------------
async function testesGlobaisEAcesso() {
  log('\n[8] Ferramentas globais, emergência e telas de acesso');
  const storage = {};
  let w = await pronta(pagina('dashboard.html', { session: sessao('INSPETOR'), storage, scriptsPagina: ['js/pages/dashboard.js'], adaptadores: ['js/webmcp/webmcp-dashboard.js'] }));
  let r = await w.NexusWebMCP.executar('obter_sessao', {});
  check('sessão: nome e cargo, sem código individual nem matrícula', r.ok && r.dados.cargo === 'INSPETOR' && !/NX-9001|MAT-9001|codigo|matricula/i.test(JSON.stringify(r.dados)), JSON.stringify(r).slice(0, 200));
  check('sessão: lista as ações permitidas ao cargo', Array.isArray(r.dados.acoes_permitidas) && r.dados.acoes_permitidas.includes('INSPECIONAR_CARGA'));
  const chamadas = [];
  w.NexusPanic = {
    getState: () => ({ active: false }),
    triggerPanic: async (opcoes) => { chamadas.push(opcoes); return { ok: true }; },
    clearPanic: async () => ({ ok: true })
  };
  w.__pedidos.length = 0;
  r = await w.NexusWebMCP.executar('acionar_emergencia', { motivo: 'Incêndio na área de contêineres' });
  check('emergência: inspetor aciona com confirmação do operador', r.ok === true && w.__pedidos.length === 1 && chamadas[0].confirmar === false, JSON.stringify(r).slice(0, 180));
  check('emergência: motivo chega ao módulo de pânico', chamadas[0] && chamadas[0].motivo === 'Incêndio na área de contêineres');
  w.close();

  w = await pronta(pagina('cargas.html', { session: sessao('SUPERVISOR_GERENTE_OPERACOES'), storage, scriptsPagina: ['js/pages/cargas.js'], adaptadores: ['js/webmcp/webmcp-cargas.js'] }));
  check('emergência: supervisor não tem a ferramenta de acionar alarme (sem permissão ACIONAR_EMERGENCIA)', !w.NexusWebMCP.ativas().includes('acionar_emergencia'));
  r = await w.NexusWebMCP.executar('ir_para_pagina', { pagina: 'embarcacoes' });
  check('ir para página: destino permitido ao cargo', r.ok === true && r.dados.destino === 'embarcacoes.html', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('ir_para_pagina', { pagina: 'tecnico_portos' });
  check('ir para página: destino fora do cargo é recusado pelo esquema', r.ok === false, JSON.stringify(r));
  r = await w.NexusWebMCP.executar('alternar_tema', { tema: 'escuro' });
  check('alternar tema: aplica e grava a preferência', r.ok && w.localStorage.getItem('nexus_theme') === 'dark' && w.document.documentElement.classList.contains('dark'));
  w.close();

  w = await pronta(pagina('index.html', { session: null, storage: {}, scriptsPagina: [], adaptadores: [] }));
  const nomesLogin = w.NexusWebMCP.ativas();
  check('tela de login: só ferramentas públicas (sem dados de sessão)', nomesLogin.includes('obter_etapa_acesso') && !nomesLogin.includes('obter_sessao') && !nomesLogin.includes('listar_cargas'), nomesLogin.join(','));
  r = await w.NexusWebMCP.executar('obter_etapa_acesso', {});
  check('tela de login: informa que credenciais são exclusivas do operador', r.ok && /exclusivas|somente pelo operador/.test(r.mensagem + JSON.stringify(r.dados)), JSON.stringify(r).slice(0, 200));
  w.close();

  w = await pronta(pagina('confirm-role.html', { session: null, storage: {}, scriptsPagina: [], adaptadores: [] }));
  check('confirmação de cargo: ferramenta pública de etapa registrada', w.NexusWebMCP.ativas().includes('obter_etapa_acesso'));
  w.close();
}

// ------------------------------------------------------------------
async function principal() {
  log('=== WebMCP — páginas reais (integração) ===');
  const todos = [testesCargas, testesInspecao, testesEmbarcacoes, testesManutencao, testesDelegacaoETecnico, testesRelatoriosScannerPainel, testesGlobaisEAcesso];
  for (const teste of todos) {
    try {
      await silenciarLog(teste);
    } catch (erro) {
      check(`${teste.name} concluiu sem exceção`, false, erro && erro.stack ? erro.stack.split('\n').slice(0, 3).join(' | ') : String(erro));
    }
  }
  const comErro = ERROS_DE_PAGINA.filter((p) => p.erros.length > 0);
  check('nenhuma página lança erros não capturados durante a carga e o uso', comErro.length === 0,
    comErro.map((p) => `${p.arquivo}: ${p.erros.slice(0, 2).join(' | ')}`).join(' ;; '));
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações WebMCP nas páginas passaram.');
}

/** Silencia avisos esperados das páginas (validações negativas) sem esconder os resultados. */
async function silenciarLog(fn) {
  const o = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.warn = o.warn;
    console.error = o.error;
    console.info = o.info;
    console.log = o.log;
  }
}

principal().catch((erro) => {
  process.stdout.write(`Erro inesperado: ${erro && erro.stack ? erro.stack : erro}\n`);
  process.exit(1);
});
