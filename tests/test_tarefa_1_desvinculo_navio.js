#!/usr/bin/env node
/**
 * Teste especifico para Tarefa 1:
 * Carga desvincula do navio apos a entrega no porto de destino.
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_JAGUAR = UUID(101);

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAVIO_JAGUAR, nome: 'Jaguar', numero_imo: 'IMO-1000001', localizacao: 'NO_PORTO_DE_DESTINO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Paranaguá' }
    ],
    cargas: [
      { id: UUID(1), qr_code_url: 'QR-CRG-2026-901', status_fluxo: 'EM_TRANSITO', natureza: 'Geral', navio_id: NAVIO_JAGUAR }
    ],
    bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

function cargasLocais() {
  return [
    { id: 'CRG-2026-901', rawDbId: UUID(1), navio: 'Jaguar', navioId: NAVIO_JAGUAR, status: 'EM_TRANSITO' }
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
  log('\n[Tarefa 1] Verificando desvinculação da carga após a entrega no destino');
  {
    const banco = bancoBase();
    const w = await carregar(banco, cargasLocais());
    const locais = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const carga = locais.find((c) => c.id === 'CRG-2026-901');

    check('Carga CRG-2026-901 virou ENTREGUE', carga && carga.status === 'ENTREGUE', carga ? carga.status : 'não encontrada');
    check('Carga CRG-2026-901 desvinculou do navio localmente (navio = \'\')', carga && carga.navio === '', carga ? carga.navio : 'N/A');
    check('Carga CRG-2026-901 desvinculou do navio localmente (navioId = null)', carga && (carga.navioId === null || carga.navio_id === null), carga ? carga.navioId : 'N/A');

    const dbCarga = banco.tabelas.cargas.find((c) => c.id === UUID(1));
    check('Banco: status_fluxo atualizado para ENTREGUE', dbCarga && dbCarga.status_fluxo === 'ENTREGUE', dbCarga ? dbCarga.status_fluxo : 'N/A');
    check('Banco: navio_id desvinculado (navio_id = null)', dbCarga && dbCarga.navio_id === null, dbCarga ? dbCarga.navio_id : 'N/A');

    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 1 verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
