#!/usr/bin/env node
/**
 * Teste para Tarefa 2: Guindaste em manutenção exibido como tal e bloqueio de movimentação
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GND_ID = 'GND-01-STS';

function bancoBase() {
  return criarBancoFalso({
    guindastes: [
      { id: UUID(201), numero_identificacao: GND_ID, estado: 'OPERANTE' }
    ],
    manutencoes: [
      { id: UUID(301), entidade_tipo: 'GUINDASTE', descricao: `[OS-2026-999][ALTA] Guindaste: ${GND_ID} - Troca de motor`, status: 'SOLICITADA' }
    ],
    cargas: [
      { id: UUID(1), qr_code_url: 'QR-CRG-2026-100', status_fluxo: 'ARMAZENAGEM', natureza: 'Geral', setor_patio: 'Setor A' }
    ],
    navios: [], bercos: [], containers: [], historico_manutencoes: []
  });
}

async function carregarManutencao(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/manutencao.html',
    html: htmlDaPagina('manutencao.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_guindastes_list: [{ id: GND_ID, identificacao: GND_ID, estado: 'OPERANTE' }],
      nexus_os_list: [{ id: 'OS-00000301', rawDbId: UUID(301), equipamento: `Guindaste ${GND_ID}`, prioridade: 'ALTA', descricao: 'Troca de motor', status: 'PENDENTE_APROVACAO' }]
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getGuindastes: async () => banco.tabelas.guindastes.map(g => ({ identificacao: g.numero_identificacao, estado: g.estado })),
          getSupabase: () => banco, notifyChange() {}
        };
        win.nexusConfirm = async () => true;
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
      },
      'js/padronizacao-codigos.js', 'js/pages/manutencao.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(100);
  return janela;
}

async function carregarCargas(banco, storageOverride = {}) {
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('ESTIVADOR'),
    storage: Object.assign({
      nexus_cargas_fluxo: [{ id: 'CRG-2026-100', rawDbId: UUID(1), status: 'ARMAZENAGEM', portoDescarga: 'Setor A' }],
      nexus_guindastes_list: [{ id: GND_ID, identificacao: GND_ID, estado: 'OPERANTE' }]
    }, storageOverride),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getGuindastes: async () => banco.tabelas.guindastes.map(g => ({ identificacao: g.numero_identificacao, estado: g.estado })),
          getSupabase: () => banco, notifyChange() {}
        };
        win.nexusConfirm = async () => true;
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
      },
      'js/padronizacao-codigos.js', 'js/pages/cargas.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(100);
  return janela;
}

async function main() {
  log('\n[Tarefa 2 Nova] Verificando estado de manutenção do guindaste e bloqueio de movimentação');
  const banco = bancoBase();

  log('1. Aprovando OS de manutenção do guindaste...');
  const jManut = await carregarManutencao(banco);
  const osList = JSON.parse(jManut.w.localStorage.getItem('nexus_os_list') || '[]');
  const osTarget = osList.find(o => (o.equipamento || '').includes(GND_ID) || (o.descricao || '').includes(GND_ID)) || osList[0];

  await jManut.w.executarAcaoOS(osTarget ? osTarget.id : 'OS-00000301', 'APROVAR');
  await aguardar(100);

  const dbGnd = banco.tabelas.guindastes.find(g => g.numero_identificacao === GND_ID);
  check('Supabase DB: estado do guindaste atualizado para EM_MANUTENCAO', dbGnd && dbGnd.estado === 'EM_MANUTENCAO', dbGnd ? dbGnd.estado : 'não encontrado');

  const gndLocalManut = JSON.parse(jManut.w.localStorage.getItem('nexus_guindastes_list') || '[]').find(g => g.identificacao === GND_ID);
  check('LocalStorage manutencao: estado do guindaste em EM_MANUTENCAO', gndLocalManut && gndLocalManut.estado === 'EM_MANUTENCAO', gndLocalManut ? gndLocalManut.estado : 'não encontrado');
  jManut.w.close();

  log('2. Tentando movimentar carga em cargas.html usando o guindaste em manutenção...');
  const jCargas = await carregarCargas(banco, {
    nexus_guindastes_list: [{ id: GND_ID, identificacao: GND_ID, estado: 'EM_MANUTENCAO' }]
  });

  await jCargas.w.executarAcaoCarga('CRG-2026-100', 'MOVIMENTAR', { setorDestino: 'Setor B', guindasteIdentificacao: GND_ID });
  await aguardar(100);

  const feedbacks = jCargas.w.__feedbacks || [];
  const blockedFeedback = feedbacks.find(f => f.titulo === 'Guindaste Indisponível' || (f.msg && (f.msg.includes('EM_MANUTENCAO') || f.msg.includes('em "EM_MANUTENCAO"'))));

  check('Bloqueio de movimentação disparou aviso de guindaste indisponível', !!blockedFeedback, blockedFeedback ? blockedFeedback.msg : 'Feedback não encontrado');

  const tarefasGnd = JSON.parse(jCargas.w.localStorage.getItem('nexus_guindaste_tarefas') || '[]');
  check('Nenhuma tarefa de movimentação foi criada para o guindaste em manutenção', tarefasGnd.length === 0, `${tarefasGnd.length} tarefas encontradas`);

  jCargas.w.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Teste de estado de manutenção de guindaste concluído com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
