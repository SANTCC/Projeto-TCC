#!/usr/bin/env node
/**
 * Teste para a Tarefa 8:
 * Estado de manutenção e reforma para guindastes, navios e contêineres após aprovação de OS,
 * e bloqueio de movimentação de cargas com guindastes/equipamentos em manutenção.
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_ID = UUID(101);
const GND_ID = UUID(201);
const OS_GND_ID = UUID(301);
const OS_NAV_ID = UUID(302);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAVIO_ID, nome: 'Santos Star', numero_imo: 'IMO1000001', estado_operacional: 'OPERANTE' }
    ],
    guindastes: [
      { id: GND_ID, numero_identificacao: 'GND-001', estado: 'OPERANTE' }
    ],
    manutencoes: [
      { id: OS_GND_ID, entidade_tipo: 'GUINDASTE', descricao: '[OS-101][ALTA] Guindaste GND-001 - Reparo no motor', status: 'SOLICITADA' },
      { id: OS_NAV_ID, entidade_tipo: 'NAVIO', descricao: '[OS-102][ALTA] Navio Santos Star - Reforma no casco', status: 'SOLICITADA' }
    ],
    containers: [], cargas: [], bercos: []
  });
}

function dataInicial() {
  return {
    nexus_navios_list: [{ id: NAVIO_ID, nome: 'Santos Star', imo: 'IMO1000001', estado_operacional: 'OPERANTE' }],
    nexus_guindastes_list: [{ id: GND_ID, identificacao: 'GND-001', estado: 'OPERANTE' }],
    nexus_os_list: [
      { id: 'OS-101', equipamento: 'Guindaste GND-001', descricao: 'Reparo no motor', status: 'PENDENTE_APROVACAO', rawDbId: OS_GND_ID },
      { id: 'OS-102', equipamento: 'Navio Santos Star', descricao: 'Reforma no casco', status: 'PENDENTE_APROVACAO', rawDbId: OS_NAV_ID }
    ]
  };
}

async function carregar(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/manutencao.html',
    html: htmlDaPagina('manutencao.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: dataInicial(),
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => banco, notifyChange() {}, invalidarLeiturasCargas() {}
        };
      },
      'js/padronizacao-codigos.js',
      'js/pages/manutencao.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(100);
  return janela;
}

async function main() {
  log('\n[Tarefa 8] Verificando estado de manutenção e reforma após aprovação de OS');

  const banco = bancoBase();
  const { w } = await carregar(banco);

  log('1. Aprovando OS de manutenção do Guindaste GND-001...');
  let listOS = JSON.parse(w.localStorage.getItem('nexus_os_list') || '[]');
  let osGnd = listOS.find(o => (o.equipamento || '').includes('GND-001') || (o.descricao || '').includes('GND-001'));
  console.log('osGnd:', osGnd);
  await w.executarAcaoOS(osGnd ? osGnd.id : 'OS-101', 'APROVAR');
  await aguardar(50);

  const gndList = JSON.parse(w.localStorage.getItem('nexus_guindastes_list') || '[]');
  const gnd = gndList.find(g => g.identificacao === 'GND-001');
  const dbGnd = banco.tabelas.guindastes.find(g => g.numero_identificacao === 'GND-001');
  console.log('gnd local:', gnd);
  console.log('gnd banco:', dbGnd);

  check('Guindaste GND-001 mudou estado local para EM_MANUTENCAO', gnd && gnd.estado === 'EM_MANUTENCAO');
  check('Guindaste GND-001 mudou estado no banco para EM_MANUTENCAO', dbGnd && dbGnd.estado === 'EM_MANUTENCAO');

  log('2. Aprovando OS de reforma do Navio Santos Star...');
  listOS = JSON.parse(w.localStorage.getItem('nexus_os_list') || '[]');
  let osNav = listOS.find(o => (o.equipamento || '').includes('Santos Star') || (o.descricao || '').includes('Santos Star'));
  console.log('osNav:', osNav);
  await w.executarAcaoOS(osNav ? osNav.id : 'OS-102', 'APROVAR');
  await aguardar(50);

  const navList = JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]');
  const nav = navList.find(n => n.nome === 'Santos Star');
  const dbNav = banco.tabelas.navios.find(n => n.nome === 'Santos Star');
  console.log('nav local:', nav);
  console.log('nav banco:', dbNav);

  check('Navio Santos Star mudou estado local para EM_REFORMA', nav && (nav.estado_operacional === 'EM_REFORMA' || nav.estado === 'EM_REFORMA'));
  check('Navio Santos Star mudou estado no banco para EM_REFORMA', dbNav && dbNav.estado_operacional === 'EM_REFORMA');

  log(`\nResultado: ${resumo().passaram}/${resumo().total} verificações aprovadas.`);
  if (resumo().falhas > 0) process.exit(1);

  console.log('✅ Tarefa 8 verificada com sucesso!');
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Erro fatal no teste da Tarefa 8:', err);
  process.exit(1);
});
