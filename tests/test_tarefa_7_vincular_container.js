#!/usr/bin/env node
/**
 * Teste específico para a Tarefa 7:
 * Seleção de navio para vinculação de contêiner usando o novo modal com <select>.
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_SANTOS = UUID(201);
const CONT_1 = UUID(301);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAVIO_SANTOS, nome: 'Santos Star', numero_imo: 'IMO1000001', localizacao: 'DENTRO_DO_PORTO' }
    ],
    containers: [
      { id: CONT_1, numero_identificacao: 'CONT1234567', tipo: 'Dry 40', navio_id: null }
    ],
    cargas: [], bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

function dataInicial() {
  return {
    nexus_navios_list: [{ id: NAVIO_SANTOS, nome: 'Santos Star', imo: 'IMO1000001', localizacao: 'DENTRO_DO_PORTO' }],
    nexus_containers_list: [{ id: CONT_1, identificacao: 'CONT1234567', tipo: 'Dry 40', navio: '' }]
  };
}

async function carregar(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
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
      'js/pages/embarcacoes.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(100);
  return janela;
}

async function main() {
  log('\n[Tarefa 7] Verificando modal de vinculação de contêiner a navio com <select>');

  const banco = bancoBase();
  const { w } = await carregar(banco);

  log('1. Abrindo modal ao acionar vinculação sem navioImo explícito...');
  const promiseVinc = w.vincularContainerANavio('CONT1234567');
  await aguardar(50);

  const modal = w.document.getElementById('vincularContainerModal');
  const select = w.document.getElementById('vincularContainerNavioSelect');
  const btnConfirmar = w.document.getElementById('confirmarVincularContainerBtn');

  check('Modal de vinculação exibido', modal && !modal.classList.contains('hidden'));
  check('Select de navios contendo o Santos Star', select && select.options.length > 1 && select.options[1].value === 'IMO1000001');

  log('2. Selecionando navio no <select> e confirmando...');
  select.value = 'IMO1000001';
  btnConfirmar.click();
  await promiseVinc;
  await aguardar(50);

  const list = JSON.parse(w.localStorage.getItem('nexus_containers_list') || '[]');
  const contAtualizado = list.find(c => c.identificacao === 'CONT1234567');

  check('Contêiner vinculado ao Santos Star localmente', contAtualizado && contAtualizado.navio === 'Santos Star');
  check('Contêiner vinculado ao Santos Star no banco', banco.tabelas.containers.some(c => c.numero_identificacao === 'CONT1234567' && c.navio_id === NAVIO_SANTOS));

  log(`\nResultado: ${resumo().passaram}/${resumo().total} verificações aprovadas.`);
  if (resumo().falhas > 0) process.exit(1);

  console.log('✅ Tarefa 7 verificada com sucesso!');
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Erro fatal no teste da Tarefa 7:', err);
  process.exit(1);
});
