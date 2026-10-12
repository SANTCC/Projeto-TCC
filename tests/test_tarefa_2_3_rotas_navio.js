#!/usr/bin/env node
/**
 * Teste especifico para Tarefas 2 e 3:
 * Seleção de Rota Marítima do navio e atribuição de novo destino para liberar saída sem erro de "Próximo Destino não definido".
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_JAGUAR = UUID(101);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAVIO_JAGUAR, nome: 'Jaguar', numero_imo: 'IMO-1000001', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Santos' }
    ],
    rotas_maritimas: [
      { id: UUID(1), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10000 },
      { id: UUID(2), origem: 'Porto de Santos', destino: 'Porto de Paranaguá', distancia_km: 330 }
    ],
    cargas: [], bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

function naviosLocais() {
  return [
    { id: NAVIO_JAGUAR, nome: 'Jaguar', imo: 'IMO-1000001', localizacao: 'DENTRO_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Santos', distancia: null }
  ];
}

async function carregar(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: naviosLocais(), nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_cargas_fluxo: [] },
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
        win.nexusConfirm = async () => true;
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.nexusConfirm = async () => true;
      },
      'js/padronizacao-codigos.js',
      'js/pages/embarcacoes.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(400);
  return janela.w;
}

async function main() {
  log('\n[Tarefas 2 e 3] Verificando seleção de rota e atribuição de novo destino para o navio');
  const banco = bancoBase();
  const w = await carregar(banco);

  // 1. Tentar liberar navio com destino Santos -> abre alerta e modal de rota
  w.liberarNavioPeloDiretor('IMO-1000001');
  await aguardar(100);

  const feedbacks = w.__feedbacks || [];
  const alertaDestino = feedbacks.find(f => f.titulo === 'Próximo Destino Não Definido');
  check('Alertou "Próximo Destino Não Definido" ao tentar liberar com mesmo destino', !!alertaDestino, alertaDestino ? alertaDestino.msg : 'Nenhum');

  const modal = w.document.getElementById('selecionarRotaNavioModal');
  check('Abriu modal de seleção de rota automaticamente', modal && !modal.classList.contains('hidden'), 'modal ' + (modal ? 'encontrado' : 'ausente'));

  // 2. Selecionar nova rota (índice 0 = Santos -> Roterdã)
  await w.selecionarRotaNavio('IMO-1000001', { rotaIndex: 0 });
  await aguardar(200);

  const navios = JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]');
  const jaguar = navios.find(n => n.imo === 'IMO-1000001');
  check('Atualizou destino do navio localmente para Porto de Roterdã', jaguar && jaguar.destino === 'Porto de Roterdã', jaguar ? jaguar.destino : 'N/A');

  const dbJaguar = banco.tabelas.navios.find(n => n.numero_imo === 'IMO-1000001');
  check('Atualizou destino do navio no banco para Porto de Roterdã', dbJaguar && dbJaguar.porto_destino === 'Porto de Roterdã', dbJaguar ? dbJaguar.porto_destino : 'N/A');

  // 3. Tentar liberar navio novamente após atualizar rota -> sucesso
  w.__feedbacks = [];
  await w.liberarNavioPeloDiretor('IMO-1000001', { confirmado: true });
  await aguardar(200);

  const naviosPos = JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]');
  const jaguarPos = naviosPos.find(n => n.imo === 'IMO-1000001');
  check('Navio teve saída liberada com sucesso (localizacao = FORA_DO_PORTO)', jaguarPos && jaguarPos.localizacao === 'FORA_DO_PORTO', jaguarPos ? jaguarPos.localizacao : 'N/A');

  w.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefas 2 e 3 verificadas com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
