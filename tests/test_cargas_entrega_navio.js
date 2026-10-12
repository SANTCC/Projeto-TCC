#!/usr/bin/env node
/**
 * Regressão: entrega automática de cargas ao chegar o navio (Cargas & Pátio).
 *
 * Quando um navio chega ao porto de destino (NO_PORTO_DE_DESTINO), somente as cargas
 * vinculadas a ele passam a ENTREGUE — local e no banco. Cargas de outros navios e cargas
 * sem navio não mudam. A gravação no banco é feita por id de carga, não por status.
 *
 * A1 (Backlog NexusPort): a carga entregue também é DESVINCULADA do navio
 * (cargas.navio_id = null) — o navio que volta a Santos não mostra mais as cargas
 * de viagens anteriores, e vínculos antigos (entregue ainda ligada) são reconciliados
 * na abertura da página.
 *
 * Executar: node tests/test_cargas_entrega_navio.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_JAGUAR = UUID(101);
const NAVIO_OUTRO = UUID(102);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAVIO_JAGUAR, nome: 'Jaguar', numero_imo: 'IMO-1000001', localizacao: 'NO_PORTO_DE_DESTINO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Paranaguá' },
      { id: NAVIO_OUTRO, nome: 'Outro Navio', numero_imo: 'IMO-1000002', localizacao: 'FORA_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' }
    ],
    cargas: [
      { id: UUID(1), qr_code_url: 'QR-CRG-2026-303', status_fluxo: 'EM_TRANSITO', natureza: 'Geral' },
      { id: UUID(2), qr_code_url: 'QR-CRG-2026-304', status_fluxo: 'EM_TRANSITO', natureza: 'Geral' },
      { id: UUID(3), qr_code_url: 'QR-CRG-2026-305', status_fluxo: 'EM_TRANSITO', natureza: 'Geral' }
    ],
    bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

function cargasLocais() {
  return [
    { id: 'CRG-2026-303', rawDbId: UUID(1), navio: 'Jaguar', navioId: NAVIO_JAGUAR, status: 'EM_TRANSITO' },
    { id: 'CRG-2026-304', rawDbId: UUID(2), navio: 'Outro Navio', navioId: NAVIO_OUTRO, status: 'EM_TRANSITO' },
    { id: 'CRG-2026-305', rawDbId: UUID(3), navio: '', status: 'EM_TRANSITO' }
  ];
}

async function carregar(banco, cargas) {
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_cargas_fluxo: cargas },
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
  log('\n[1] Só a carga do navio que chegou ao destino vira ENTREGUE');
  {
    const banco = bancoBase();
    const w = await carregar(banco, cargasLocais());
    const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const st = (id) => (locais.find((c) => c.id === id) || {}).status;
    check('CRG-2026-303 (Jaguar, chegou ao destino) fica ENTREGUE', st('CRG-2026-303') === 'ENTREGUE', st('CRG-2026-303'));
    check('CRG-2026-304 (outro navio, fora do porto) continua EM_TRANSITO', st('CRG-2026-304') === 'EM_TRANSITO', st('CRG-2026-304'));
    check('CRG-2026-305 (sem navio) continua EM_TRANSITO', st('CRG-2026-305') === 'EM_TRANSITO', st('CRG-2026-305'));

    const dbStatus = (n) => (banco.tabelas.cargas.find((c) => c.id === UUID(n)) || {}).status_fluxo;
    check('banco: carga 303 gravada como ENTREGUE', dbStatus(1) === 'ENTREGUE', dbStatus(1));
    check('banco: cargas 304 e 305 não foram alteradas', dbStatus(2) === 'EM_TRANSITO' && dbStatus(3) === 'EM_TRANSITO', `${dbStatus(2)} / ${dbStatus(3)}`);

    const updates = banco.log.filter((l) => l.tabela === 'cargas' && l.op === 'update');
    const todosPorId = updates.every((u) => (u.filtros || []).some(([c]) => c === 'id'));
    check('gravação no banco é feita por id de carga (nenhuma atualização em massa)', updates.length > 0 && todosPorId, JSON.stringify(updates));

    // A1: a carga entregue sai do navio (local e banco) — o navio fica livre.
    const carga303 = locais.find((c) => c.id === 'CRG-2026-303') || {};
    check('A1: cache local desvincula a carga entregue do navio',
      carga303.navio === '' && !carga303.navioId && !carga303.navio_id, JSON.stringify(carga303));
    check('A1: banco desvincula a carga entregue (navio_id = null)',
      (banco.tabelas.cargas.find((c) => c.id === UUID(1)) || {}).navio_id === null,
      String((banco.tabelas.cargas.find((c) => c.id === UUID(1)) || {}).navio_id));
    check('A1: gravação da entrega inclui navio_id = null',
      updates.some((u) => u.payload && u.payload.status_fluxo === 'ENTREGUE' && u.payload.navio_id === null),
      JSON.stringify(updates.map((u) => u.payload)));
    const colunaNavio = (w.document.getElementById('embarcacoesGpsTableBody') || {}).textContent || '';
    check('A1: navio no destino não exibe cargas vinculadas de viagens anteriores',
      /Sem carga vinculada/.test(colunaNavio), colunaNavio.slice(0, 200));
    w.close();
  }

  log('\n[4] A1: reconciliação de vínculo antigo (entregue ainda ligada ao navio que voltou a Santos)');
  {
    const banco = bancoBase();
    banco.tabelas.navios[0].localizacao = 'DENTRO_DO_PORTO';
    banco.tabelas.navios[0].porto_destino = 'Porto de Santos';
    banco.tabelas.cargas.push({ id: UUID(9), qr_code_url: 'QR-CRG-2026-309', status_fluxo: 'ENTREGUE', natureza: 'Geral', navio_id: NAVIO_JAGUAR });
    const cargas = cargasLocais().slice(0, 1);
    cargas[0].status = 'ENTREGUE'; // já entregue, mas ainda apontando para o navio
    const w = await carregar(banco, cargas);
    const local = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]')[0] || {};
    check('A1: carga entregue perde o vínculo no cache local',
      local.navio === '' && !local.navioId && !local.navio_id, JSON.stringify(local));
    check('A1: banco corrige a carga entregue que ainda apontava para o navio',
      (banco.tabelas.cargas.find((c) => c.id === UUID(9)) || {}).navio_id === null,
      String((banco.tabelas.cargas.find((c) => c.id === UUID(9)) || {}).navio_id));
    const updates = banco.log.filter((l) => l.tabela === 'cargas' && l.op === 'update');
    check('A1: reconciliação também é feita por id de carga',
      updates.length > 0 && updates.every((u) => (u.filtros || []).some(([c]) => c === 'id')), JSON.stringify(updates));
    w.close();
  }

  log('\n[2] Navio que não chegou ao destino não entrega nada');
  {
    const banco = bancoBase();
    banco.tabelas.navios[0].localizacao = 'FORA_DO_PORTO';
    const w = await carregar(banco, cargasLocais());
    const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
    check('nenhuma carga entregue enquanto o navio está fora do porto', locais.every((c) => c.status === 'EM_TRANSITO'), JSON.stringify(locais.map((c) => c.status)));
    w.close();
  }

  log('\n[3] Vínculo pelo id do navio tem prioridade sobre o nome');
  {
    const banco = bancoBase();
    const cargas = cargasLocais();
    cargas[0].navioId = NAVIO_OUTRO; // mesmo nome, outro navio de fato
    const w = await carregar(banco, cargas);
    const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
    check('carga de outro navio com o mesmo nome não é entregue indevidamente',
      (locais.find((c) => c.id === 'CRG-2026-303') || {}).status === 'EM_TRANSITO', JSON.stringify(locais[0]));
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações de entrega por navio passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
