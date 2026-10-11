#!/usr/bin/env node
/**
 * Regressão: classificação de chegada ao Porto de Santos (Embarcações & GPS, item 4).
 *
 * Navio que volta de Paranaguá a Santos deve ficar "No porto" (DENTRO_DO_PORTO) ao
 * chegar, e não "Chegou ao destino" (NO_PORTO_DE_DESTINO). Chegadas a outros portos
 * continuam como "Chegou ao destino". Uma embarcação já no Porto de Santos cujo destino
 * é o próprio Santos não tem próxima viagem: a saída é bloqueada com justificativa.
 *
 * Usa embarcacoes.html + js/pages/embarcacoes.js em jsdom e o dublê de banco
 * (tests/fake-supabase-db.js). Executar: node tests/test_retorno_santos.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const HORAS = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

function navio(id, imo, nome, origem, destino, localizacao, dataSaida) {
  return { id, nome, numero_imo: imo, porto_origem: origem, porto_destino: destino, localizacao, data_saida: dataSaida, estado_operacional: 'OPERANTE' };
}

function bancoBase() {
  return criarBancoFalso({
    rotas_maritimas: [
      { id: 'r1', origem: 'Porto de Santos', destino: 'Porto de Paranaguá', distancia_km: 100 }
    ],
    navios: [
      // Ida: Santos -> Paranaguá, já chegou (ETA zerado)
      navio('11111111-0000-0000-0000-000000000001', 'IMO6000002', 'Navio Ida', 'Porto de Santos', 'Porto de Paranaguá', 'FORA_DO_PORTO', HORAS(10)),
      // Retorno: Paranaguá -> Santos, já chegou (ETA zerado)
      navio('11111111-0000-0000-0000-000000000002', 'IMO6000001', 'Navio Retorno', 'Porto de Paranaguá', 'Porto de Santos', 'FORA_DO_PORTO', HORAS(10)),
      // Em trânsito para Santos, ainda não chegou
      navio('11111111-0000-0000-0000-000000000003', 'IMO6000005', 'Navio Trânsito', 'Porto de Paranaguá', 'Porto de Santos', 'FORA_DO_PORTO', HORAS(0.5)),
      // No Porto de Santos com destino Santos (sem próxima viagem)
      navio('11111111-0000-0000-0000-000000000004', 'IMO6000003', 'Navio Santos', 'Porto de Paranaguá', 'Porto de Santos', 'DENTRO_DO_PORTO', null)
    ],
    bercos: [], containers: [], cargas: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

const janelas = [];

async function carregar(banco) {
  let w;
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
        w = win;
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
  w = janela.w;
  janelas.push(janela);
  await prontoDom(w);
  await aguardar(400);
  return { janela, w };
}

const ultimo = (w) => (w.__feedbacks || []).slice(-1)[0] || {};
const porImo = (banco, imo) => banco.tabelas.navios.find(n => n.numero_imo === imo) || {};

async function main() {
  log('\n1. Chegada ao Porto de Santos após retorno: "No porto"');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  check('navio que volta a Santos vira DENTRO_DO_PORTO no banco', porImo(banco, 'IMO6000001').localizacao === 'DENTRO_DO_PORTO', porImo(banco, 'IMO6000001').localizacao);
  const local = JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]');
  check('cache local reflete "No porto"', (local.find(n => n.imo === 'IMO6000001') || {}).localizacao === 'DENTRO_DO_PORTO');
  check('navio que chega a Paranaguá segue NO_PORTO_DE_DESTINO ("Chegou ao destino")', porImo(banco, 'IMO6000002').localizacao === 'NO_PORTO_DE_DESTINO');
  check('navio em trânsito para Santos continua FORA_DO_PORTO', porImo(banco, 'IMO6000005').localizacao === 'FORA_DO_PORTO');
  const tbody = (w.document.getElementById('embarcacoesGpsTableBody') || {}).textContent || '';
  check('tabela mostra "Chegou ao destino" para o navio de ida', /Chegou ao destino/.test(tbody));

  log('\n2. Navio no Porto de Santos com destino Santos: saída bloqueada com justificativa');
  await w.liberarNavioPeloDiretor('IMO6000003', { confirmado: true });
  await aguardar(50);
  check('saída não registrada (segue DENTRO_DO_PORTO)', porImo(banco, 'IMO6000003').localizacao === 'DENTRO_DO_PORTO');
  check('aviso de próximo destino não definido', ultimo(w).titulo === 'Próximo Destino Não Definido', JSON.stringify(ultimo(w)));

  log('\n3. Ciclo completo: Santos -> Paranaguá -> Santos');
  const banco2 = criarBancoFalso({
    rotas_maritimas: [{ id: 'r1', origem: 'Porto de Santos', destino: 'Porto de Paranaguá', distancia_km: 100 }],
    navios: [navio('11111111-0000-0000-0000-000000000009', 'IMO6000009', 'Navio Ciclo', 'Porto de Santos', 'Porto de Paranaguá', 'FORA_DO_PORTO', HORAS(10))],
    bercos: [], containers: [], cargas: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
  const { w: w2 } = await carregar(banco2);
  check('ida chegou a Paranaguá', porImo(banco2, 'IMO6000009').localizacao === 'NO_PORTO_DE_DESTINO');
  await w2.autorizarRetornoNavio('IMO6000009', { confirmado: true });
  await aguardar(50);
  const naVolta = porImo(banco2, 'IMO6000009');
  check('retorno autorizado: destino Santos e em trânsito', naVolta.porto_destino === 'Porto de Santos' && naVolta.localizacao === 'FORA_DO_PORTO', JSON.stringify(naVolta));
  // Simula o tempo passando durante a viagem de volta
  naVolta.data_saida = HORAS(10);
  const { w: w3 } = await carregar(banco2);
  check('ao chegar a Santos na volta: "No porto" (DENTRO_DO_PORTO)', porImo(banco2, 'IMO6000009').localizacao === 'DENTRO_DO_PORTO', porImo(banco2, 'IMO6000009').localizacao);
  void w3;

  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
