#!/usr/bin/env node
/**
 * Teste para Tarefa 1: Persistência do Status do Navio Jaguar após Liberação e Reload
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_JAGUAR = UUID(101);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      {
        id: NAVIO_JAGUAR,
        nome: 'Jaguar',
        numero_imo: 'IMO-9876543',
        localizacao: 'DENTRO_DO_PORTO',
        estado_operacional: 'OPERANTE',
        porto_origem: 'Porto de Santos',
        porto_destino: 'Porto de Paranaguá'
      }
    ],
    rotas_maritimas: [
      { id: UUID(10), origem: 'Porto de Santos', destino: 'Porto de Paranaguá', distancia_km: '150' }
    ],
    cargas: [], bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

async function carregar(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_cargas_fluxo: [] },
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
  return janela;
}

async function main() {
  log('\n[Tarefa 1 Nova] Verificando persistência do status do navio Jaguar após liberação de saída');
  const banco = bancoBase();
  const janela = await carregar(banco);
  const w = janela.w;

  const dbNavioInicial = banco.tabelas.navios.find(n => n.id === NAVIO_JAGUAR);
  check('Inicialmente Jaguar está DENTRO_DO_PORTO no banco', dbNavioInicial && dbNavioInicial.localizacao === 'DENTRO_DO_PORTO', dbNavioInicial ? dbNavioInicial.localizacao : 'não encontrado');

  log('Executando liberarNavioPeloDiretor("IMO-9876543")...');
  await w.liberarNavioPeloDiretor('IMO-9876543', { confirmado: true });
  await aguardar(200);

  const dbNavioAposSaida = banco.tabelas.navios.find(n => n.id === NAVIO_JAGUAR);
  check('Supabase: localizacao do Jaguar alterada para FORA_DO_PORTO', dbNavioAposSaida && dbNavioAposSaida.localizacao === 'FORA_DO_PORTO', dbNavioAposSaida ? dbNavioAposSaida.localizacao : 'não encontrado');
  check('Supabase: data_saida do Jaguar foi gravada', dbNavioAposSaida && !!dbNavioAposSaida.data_saida, dbNavioAposSaida ? dbNavioAposSaida.data_saida : 'null');

  log('Simulando recarregamento da página...');
  const janela2 = await carregar(banco);
  const w2 = janela2.w;

  const naviosLocais2 = JSON.parse(w2.localStorage.getItem('nexus_navios_list') || '[]');
  const navioJaguarLocal2 = naviosLocais2.find(n => n.imo === 'IMO-9876543');

  check('Após reload: localizacao no localStorage/tela do Jaguar permanece FORA_DO_PORTO', navioJaguarLocal2 && navioJaguarLocal2.localizacao === 'FORA_DO_PORTO', navioJaguarLocal2 ? navioJaguarLocal2.localizacao : 'não encontrado');

  janela.w.close();
  janela2.w.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Teste de persistência de status de navio concluído com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
