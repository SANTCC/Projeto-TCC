#!/usr/bin/env node
/**
 * Regressão (D — Backlog NexusPort): manutenção APROVADA vale no banco e bloqueia a movimentação.
 *
 * Antes desta correção, uma OS carregada do banco perdia a identificação do equipamento
 * (virava "Guindaste"/"Navio" genérico) e o update não encontrava nenhuma linha: a tela
 * anunciava "em manutenção" e o equipamento continuava OPERANTE no banco — a movimentação
 * seguia liberada. O dublê de banco ignorava `ilike`, escondendo o defeito.
 *
 * Usa as páginas reais manutencao.html (js/pages/manutencao.js) e cargas.html
 * (js/pages/cargas.js) com o dublê de banco (tests/fake-supabase-db.js):
 *   - a OS persistida mostra o equipamento identificado (GND-01-STS, Jaguar, MSCU-1234567);
 *   - APROVAR grava o estado no equipamento (EM_MANUTENCAO / EM_REFORMA) — pelo id do
 *     vínculo e, nas OS antigas sem vínculo, pela identificação — sem tocar em outro ativo;
 *   - a decisão da OS persiste após recarregar a página (segue "Em manutenção");
 *   - com o guindaste em manutenção a movimentação de carga é recusada e nenhuma tarefa
 *     é criada; com ele operante (CONCLUIR) a movimentação volta a ser aceita;
 *   - CONCLUIR devolve OPERANTE e registra o histórico; REPROVAR libera o equipamento;
 *   - OS sem equipamento localizável NÃO anuncia sucesso: avisa que o estado não mudou.
 *
 * Executar: node tests/test_d_manutencao_persistente.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const GND_1 = UUID(11);
const GND_2 = UUID(12);
const NAVIO = UUID(13);
const CONTAINER = UUID(14);
const CARGA = UUID(21);

const OS_GND_POR_NOME = 'aaa10000-0000-4000-8000-000000000001';
const OS_GND_POR_ID = 'bbb10000-0000-4000-8000-000000000002';
const OS_NAVIO = 'ccc10000-0000-4000-8000-000000000003';
const OS_CONTAINER = 'ddd10000-0000-4000-8000-000000000004';
const OS_NAVIO_REPROVAR = 'eee10000-0000-4000-8000-000000000005';
const OS_SEM_EQUIPAMENTO = 'fff10000-0000-4000-8000-000000000006';

/** OS como o banco as guarda: a identificação vive na descrição e/ou no vínculo por id. */
function bancoBase() {
  const agora = new Date().toISOString();
  return criarBancoFalso({
    guindastes: [
      { id: GND_1, numero_identificacao: 'GND-01-STS', estado: 'OPERANTE', data_ultima_manutencao: null },
      { id: GND_2, numero_identificacao: 'GND-02-STS', estado: 'OPERANTE', data_ultima_manutencao: null }
    ],
    navios: [
      { id: NAVIO, nome: 'Jaguar', numero_imo: 'IMO-1000001', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' }
    ],
    containers: [
      { id: CONTAINER, numero_identificacao: 'MSCU-1234567', estado: 'OPERANTE', navio_id: null }
    ],
    cargas: [
      { id: CARGA, qr_code_url: 'QR-CRG-2026-001', status_fluxo: 'ARMAZENAGEM', natureza: 'Carga Geral', peso: 10, volume: 20, porto_descarga: 'Pátio STS-01 (Setor B)', container_id: null, navio_id: null }
    ],
    manutencoes: [
      // Sem vínculo de id: o equipamento é identificado pela descrição (formato do sistema).
      { id: OS_GND_POR_NOME, entidade_tipo: 'GUINDASTE', descricao: `[OS-2026-100][ALTA] Guindaste: GND-01-STS - Cabos de aço rompidos`, status: 'SOLICITADA', created_at: agora },
      // Com vínculo de id no banco: atualiza direto pela chave.
      { id: OS_GND_POR_ID, entidade_tipo: 'GUINDASTE', guindaste_id: GND_2, descricao: `[OS-2026-101][ALTA] Equipamento: Guindaste GND-02-STS - Motor do guincho`, status: 'SOLICITADA', created_at: agora },
      { id: OS_NAVIO, entidade_tipo: 'NAVIO', navio_id: NAVIO, descricao: `[OS-NAVIO-200][MEDIA] Navio: Jaguar - Pintura do casco`, status: 'SOLICITADA', created_at: agora },
      { id: OS_CONTAINER, entidade_tipo: 'CONTAINER', container_id: CONTAINER, descricao: `[OS-2026-300][MEDIA] Equipamento: Contêiner MSCU-1234567 - Troca de vedação`, status: 'SOLICITADA', created_at: agora },
      { id: OS_NAVIO_REPROVAR, entidade_tipo: 'NAVIO', navio_id: NAVIO, descricao: `[OS-NAVIO-201][BAIXA] Navio: Jaguar - Limpeza de porão`, status: 'SOLICITADA', created_at: agora },
      // Sem vínculo e sem identificação: não existe equipamento para atualizar.
      { id: OS_SEM_EQUIPAMENTO, entidade_tipo: null, descricao: `[OS-2026-999][BAIXA] Ajuste interno sem equipamento vinculado`, status: 'SOLICITADA', created_at: agora }
    ],
    bercos: [], historico_manutencoes: []
  });
}

const janelas = [];

async function carregarManutencao(banco) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/manutencao.html',
    html: htmlDaPagina('manutencao.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_os_list: [],
      nexus_guindastes_list: [{ id: GND_1, identificacao: 'GND-01-STS', estado: 'OPERANTE' }, { id: GND_2, identificacao: 'GND-02-STS', estado: 'OPERANTE' }],
      nexus_navios_list: [{ id: NAVIO, nome: 'Jaguar', estado: 'OPERANTE' }],
      nexus_containers_list: [{ id: CONTAINER, identificacao: 'MSCU-1234567', estado: 'OPERANTE' }],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { win.currentUserSession = win.NexusAuth.getSession(); win.nexusSupabase = banco; },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        w = win;
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.registrarTrailDecisao = async () => {};
        win.registrarLogAlteracao = async () => {};
        win.nexusPrompt = async () => null;
      },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/manutencao.js'
    ]
  });
  w = janela.w;
  janelas.push(janela);
  await prontoDom(w);
  await aguardar(300);
  return w;
}

async function carregarCargas(banco) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_cargas_fluxo: [], nexus_navios_list: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_guindaste_tarefas: [], nexus_func_list: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => { win.currentUserSession = win.NexusAuth.getSession(); win.nexusSupabase = banco; },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        w = win;
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.registrarLogAlteracao = async () => {};
      },
      'js/padronizacao-codigos.js',
      'js/data-repository.js',
      'js/pages/cargas.js'
    ]
  });
  w = janela.w;
  janelas.push(janela);
  await prontoDom(w);
  await aguardar(300);
  return w;
}

const osDaPagina = (w) => JSON.parse(w.localStorage.getItem('nexus_os_list') || '[]');
const osPorSufixo = (w, sufixo) => osDaPagina(w).find((o) => String(o.rawDbId || '').startsWith(sufixo)) || {};
const tabelaOs = (w) => Array.from(w.document.querySelectorAll('#osTableBody tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()).join('\n');
const ultimoFeedback = (w) => (w.__feedbacks || []).slice(-1)[0] || {};
const estadoGnd = (banco, id) => (banco.tabelas.guindastes.find((g) => g.id === id) || {}).estado;
const estadoNavio = (banco) => (banco.tabelas.navios[0] || {}).estado_operacional;
const estadoContainer = (banco) => (banco.tabelas.containers[0] || {}).estado;
const tarefasDe = (w) => JSON.parse(w.localStorage.getItem('nexus_guindaste_tarefas') || '[]');

/** Cria a tarefa de movimentação com o guindaste informado (caminho do agente, sem modal). */
async function movimentar(w, guindaste) {
  w.__feedbacks = [];
  await w.executarAcaoCarga('CRG-2026-001', 'MOVIMENTAR', { guindasteIdentificacao: guindaste, setorDestino: 'Pátio STS-01 (Setor C)' });
  await aguardar(150);
}

async function main() {
  const banco = bancoBase();
  const w = await carregarManutencao(banco);

  log('\n1. OS persistida mostra o EQUIPAMENTO identificado (não um tipo genérico)');
  let tabela = tabelaOs(w);
  check('OS do guindaste sem vínculo traz a identificação', tabela.includes('Guindaste GND-01-STS'), tabela.slice(0, 200));
  check('OS do guindaste com vínculo por id traz a identificação', tabela.includes('Guindaste GND-02-STS'));
  check('OS do navio traz o nome da embarcação', tabela.includes('Navio Jaguar'));
  check('OS do contêiner traz o número', tabela.includes('Contêiner MSCU-1234567'));
  check('nenhuma OS identificável cai no equipamento genérico', !/\b(Guindaste|Navio|Contêiner) (ALTA|MEDIA|BAIXA)\b/.test(tabela), tabela.slice(0, 200));
  check('OS sem equipamento vinculado aparece como Equipamento Geral', /Equipamento Geral (ALTA|MEDIA|BAIXA)/.test(tabela), tabela.slice(0, 300));

  log('\n2. APROVAR coloca o equipamento em manutenção NO BANCO (e só o equipamento da OS)');
  const osGndNome = osPorSufixo(w, OS_GND_POR_NOME.substring(0, 8));
  await w.executarAcaoOS(osGndNome.id, 'APROVAR');
  await aguardar(250);
  check('guindaste GND-01-STS fica EM_MANUTENCAO no banco', estadoGnd(banco, GND_1) === 'EM_MANUTENCAO', estadoGnd(banco, GND_1));
  check('o outro guindaste (GND-02-STS) não é afetado', estadoGnd(banco, GND_2) === 'OPERANTE', estadoGnd(banco, GND_2));
  check('a OS fica APROVADA no banco', banco.tabelas.manutencoes.find((m) => m.id === OS_GND_POR_NOME).status === 'APROVADA');
  let fb = ultimoFeedback(w);
  check('o feedback identifica o equipamento e o estado aplicado', /GND-01-STS/.test(fb.msg || '') && /EM_MANUTENCAO/.test(fb.msg || ''), JSON.stringify(fb));
  check('o cache local do guindaste reflete a manutenção', JSON.parse(w.localStorage.getItem('nexus_guindastes_list')).find((g) => g.id === GND_1).estado === 'EM_MANUTENCAO', w.localStorage.getItem('nexus_guindastes_list'));
  check('a tabela passa a mostrar "Em manutenção" com o botão Concluir',
    /Em manutenção/.test(tabelaOs(w)) && tabelaOs(w).includes('Concluir'), tabelaOs(w).slice(0, 200));

  log('\n3. Com o guindaste em manutenção, a movimentação de carga é BLOQUEADA');
  const wCargas = await carregarCargas(banco);
  await movimentar(wCargas, 'GND-01-STS');
  check('movimentação com o guindaste em manutenção é recusada', /Indisponível/i.test(ultimoFeedback(wCargas).titulo || ''), JSON.stringify(ultimoFeedback(wCargas)));
  check('nenhuma tarefa de movimentação é criada', tarefasDe(wCargas).length === 0, JSON.stringify(tarefasDe(wCargas)));
  check('a carga permanece no setor de origem', JSON.parse(wCargas.localStorage.getItem('nexus_cargas_fluxo')).find((c) => c.id === 'CRG-2026-001').portoDescarga === 'Pátio STS-01 (Setor B)');
  await movimentar(wCargas, 'GND-02-STS');
  check('o guindaste que continua operante executa a movimentação', ultimoFeedback(wCargas).titulo === 'Tarefa de Movimentação Criada', JSON.stringify(ultimoFeedback(wCargas)));
  check('a tarefa do guindaste operante é criada', tarefasDe(wCargas).some((t) => t.cargaId === 'CRG-2026-001' && t.guindasteId === 'GND-02-STS'), JSON.stringify(tarefasDe(wCargas)));

  log('\n4. A decisão persiste ao RECARREGAR a página (F5) e o equipamento segue em manutenção');
  const wF5 = await carregarManutencao(banco);
  const tabelaF5 = tabelaOs(wF5);
  check('após o F5 a OS continua "Em manutenção"', /Em manutenção/.test(tabelaF5), tabelaF5.slice(0, 200));
  check('após o F5 a OS ainda oferece o botão Concluir', tabelaF5.includes('Concluir'));
  check('o guindaste continua EM_MANUTENCAO no banco', estadoGnd(banco, GND_1) === 'EM_MANUTENCAO', estadoGnd(banco, GND_1));

  log('\n5. CONCLUIR devolve o equipamento a OPERANTE e libera a movimentação');
  const osGndF5 = osPorSufixo(wF5, OS_GND_POR_NOME.substring(0, 8));
  await wF5.executarAcaoOS(osGndF5.id, 'CONCLUIR');
  await aguardar(250);
  check('o guindaste volta a OPERANTE no banco', estadoGnd(banco, GND_1) === 'OPERANTE', estadoGnd(banco, GND_1));
  check('a OS fica CONCLUIDA no banco', banco.tabelas.manutencoes.find((m) => m.id === OS_GND_POR_NOME).status === 'CONCLUIDA');
  check('a conclusão entra no histórico de manutenções', banco.tabelas.historico_manutencoes.length === 1 && /GND-01-STS/.test(banco.tabelas.historico_manutencoes[0].descricao_servicos || ''), JSON.stringify(banco.tabelas.historico_manutencoes));
  check('o feedback cita o equipamento e o estado liberado', /GND-01-STS/.test(ultimoFeedback(wF5).msg || '') && /OPERANTE/.test(ultimoFeedback(wF5).msg || ''), JSON.stringify(ultimoFeedback(wF5)));
  const wCargas2 = await carregarCargas(banco);
  await movimentar(wCargas2, 'GND-01-STS');
  check('depois de concluir, a movimentação com o guindaste é aceita', ultimoFeedback(wCargas2).titulo === 'Tarefa de Movimentação Criada', JSON.stringify(ultimoFeedback(wCargas2)));

  log('\n6. Vínculo por id, navio e contêiner também são atualizados (com o estado do banco)');
  await wF5.executarAcaoOS(osPorSufixo(wF5, OS_GND_POR_ID.substring(0, 8)).id, 'APROVAR');
  await aguardar(200);
  check('guindaste atualizado pelo VÍNCULO de id no banco', estadoGnd(banco, GND_2) === 'EM_MANUTENCAO', estadoGnd(banco, GND_2));
  await wF5.executarAcaoOS(osPorSufixo(wF5, OS_NAVIO.substring(0, 8)).id, 'APROVAR');
  await aguardar(200);
  check('navio passa a EM_REFORMA (manutenção aprovada)', estadoNavio(banco) === 'EM_REFORMA', estadoNavio(banco));
  check('o feedback do navio informa o estado do banco', /EM_REFORMA/.test(ultimoFeedback(wF5).msg || ''), JSON.stringify(ultimoFeedback(wF5)));
  await wF5.executarAcaoOS(osPorSufixo(wF5, OS_CONTAINER.substring(0, 8)).id, 'APROVAR');
  await aguardar(200);
  check('contêiner passa a EM_REFORMA', estadoContainer(banco) === 'EM_REFORMA', estadoContainer(banco));

  log('\n7. REPROVAR libera o equipamento (não fica preso em reforma)');
  await wF5.executarAcaoOS(osPorSufixo(wF5, OS_NAVIO_REPROVAR.substring(0, 8)).id, 'REPROVAR');
  await aguardar(200);
  check('navio reprovado volta a OPERANTE', estadoNavio(banco) === 'OPERANTE', estadoNavio(banco));
  check('a OS fica RECUSADA no banco', banco.tabelas.manutencoes.find((m) => m.id === OS_NAVIO_REPROVAR).status === 'RECUSADA');

  log('\n8. OS sem equipamento localizável NÃO anuncia sucesso (nada de manutenção fictícia)');
  const osSemEquip = osPorSufixo(wF5, OS_SEM_EQUIPAMENTO.substring(0, 8));
  await wF5.executarAcaoOS(osSemEquip.id, 'APROVAR');
  await aguardar(200);
  fb = ultimoFeedback(wF5);
  check('o aviso é de atenção, com o equipamento não atualizado', fb.tipo === 'atencao' && /equipamento não atualizado/.test(fb.titulo || ''), JSON.stringify(fb));
  check('a mensagem explica que o equipamento continua disponível', /continua disponível/.test(fb.msg || ''), fb.msg);
  check('nenhum equipamento foi alterado por essa OS', estadoGnd(banco, GND_1) === 'OPERANTE' && estadoGnd(banco, GND_2) === 'EM_MANUTENCAO' && estadoContainer(banco) === 'EM_REFORMA');

  log('\n9. OS aberta nesta sessão também entra em manutenção (com vínculo gravado na abertura)');
  wF5.document.getElementById('osEquipamento').value = 'Guindaste GND-01-STS';
  wF5.document.getElementById('osPrioridade').value = 'ALTA';
  wF5.document.getElementById('osDescricao').value = 'Troca do cabo auxiliar';
  wF5.document.getElementById('osForm').dispatchEvent(new wF5.Event('submit', { bubbles: true, cancelable: true }));
  await aguardar(300);
  const osNova = osDaPagina(wF5).find((o) => o.status === 'PENDENTE_APROVACAO') || {};
  check('a OS nova registra o vínculo do guindaste já na abertura',
    Boolean(osNova.equipamentoId) && osNova.equipamentoTipo === 'GUINDASTE' && osNova.equipamentoIdentificacao === 'GND-01-STS',
    JSON.stringify({ id: osNova.equipamentoId, tipo: osNova.equipamentoTipo, identificacao: osNova.equipamentoIdentificacao }));
  const osNovaNoBanco = banco.tabelas.manutencoes.find((m) => m.descricao && m.descricao.includes('Troca do cabo auxiliar')) || {};
  check('o banco guarda guindaste_id na OS criada pelo formulário', osNovaNoBanco.guindaste_id === GND_1, JSON.stringify(osNovaNoBanco));
  await wF5.executarAcaoOS(osNova.id, 'APROVAR');
  await aguardar(250);
  check('aprovar a OS da sessão coloca o guindaste em manutenção no banco', estadoGnd(banco, GND_1) === 'EM_MANUTENCAO', estadoGnd(banco, GND_1));
  check('o feedback da OS da sessão confirma o estado', /EM_MANUTENCAO/.test(ultimoFeedback(wF5).msg || ''), JSON.stringify(ultimoFeedback(wF5)));

  janelas.forEach((j) => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações do D (manutenção persistente + bloqueio) passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
