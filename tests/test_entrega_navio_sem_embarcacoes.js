#!/usr/bin/env node
/**
 * Regressão — Tarefa 3 (Correções): a carga vira ENTREGUE quando o navio chega
 * ao porto de destino SEM depender da abertura da página Embarcações & GPS.
 *
 * Cenários:
 *  1. ETA vencido (navio FORA_DO_PORTO com saída antiga e rota com distância):
 *     abrir Cargas & Pátio classifica a chegada no banco (compare-and-set
 *     FORA_DO_PORTO → NO_PORTO_DE_DESTINO, mesma regra de embarcacoes.js) e a
 *     carga EM_TRANSITO vinculada aparece ENTREGUE (banco, cache e tabela de
 *     entregues). Navio com ETA não vencido e cargas de outros status/navios
 *     não são afetados.
 *  2. ETA não vencido: nada é classificado nem entregue.
 *  3. Retorno ao Porto de Santos: chegada vira DENTRO_DO_PORTO (não
 *     NO_PORTO_DE_DESTINO) e as cargas permanecem EM_TRANSITO.
 *  4. Navio já classificado no banco com cache local obsoleto (cenário raiz do
 *     bug): a página atualiza os navios do banco, não reclassifica nada e as
 *     cargas EM_TRANSITO são entregues ao carregar.
 *
 * Executar: node tests/test_entrega_navio_sem_embarcacoes.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO_DESTINO = UUID(401);
const NAVIO_ALHEIO = UUID(402);
const C1 = UUID(411);
const C2 = UUID(412);
const C3 = UUID(413);
const HORAS = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

function bancoCenas(opts = {}) {
  const destino = opts.destino || 'Porto de Roterdã';
  const origem = opts.origem || 'Porto de Santos';
  const rotas = opts.rotas || [{ id: UUID(1), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }];
  return criarBancoFalso({
    navios: [
      {
        id: NAVIO_DESTINO, nome: 'MV Destino', numero_imo: 'IMO-4000001',
        localizacao: opts.localizacaoNavio || 'FORA_DO_PORTO',
        estado_operacional: 'OPERANTE', porto_origem: origem, porto_destino: destino,
        data_saida: opts.dataSaida === undefined ? HORAS(24 * 20) : opts.dataSaida
      },
      {
        id: NAVIO_ALHEIO, nome: 'MV Alheio', numero_imo: 'IMO-4000002',
        localizacao: 'FORA_DO_PORTO', estado_operacional: 'OPERANTE',
        porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã',
        data_saida: HORAS(1) // em viagem: ETA longe de zerar (10200 km @ 33 km/h)
      }
    ],
    rotas_maritimas: rotas,
    cargas: [
      { id: C1, qr_code_url: 'QR-CRG-C1', status_fluxo: opts.statusC1 || 'EM_TRANSITO', natureza: 'Geral', navio_id: NAVIO_DESTINO, container_id: null },
      { id: C2, qr_code_url: 'QR-CRG-C2', status_fluxo: 'EM_TRANSITO', natureza: 'Geral', navio_id: NAVIO_ALHEIO, container_id: null },
      { id: C3, qr_code_url: 'QR-CRG-C3', status_fluxo: 'ARMAZENAGEM', natureza: 'Geral', navio_id: null, container_id: null }
    ],
    bercos: [], containers: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

/** Repositório mínimo que reflete o banco em tempo real (como o NexusRepository). */
function repositorioDe(banco) {
  return {
    async getCargas() {
      return banco.tabelas.cargas.map((c) => {
        const navioRow = banco.tabelas.navios.find((n) => n.id === c.navio_id);
        return {
          id: String(c.qr_code_url || '').replace('QR-', '') || `CRG-${c.id}`,
          rawDbId: c.id,
          tipo: 'Carga Geral', natureza: c.natureza || 'Geral',
          peso: '10 t', volume: '20 m³', valor: 'R$ 100,00',
          portoDescarga: 'Pátio STS-01',
          destino: navioRow ? navioRow.porto_destino : 'Destino geral',
          status: c.status_fluxo,
          container: '', containerId: c.container_id || null, container_id: c.container_id || null,
          navio: navioRow ? navioRow.nome : (c.navio_nome_historico || ''),
          navioId: c.navio_id || null, navio_id: c.navio_id || null,
          navio_nome_historico: c.navio_nome_historico || '',
          container_identificacao_historico: c.container_identificacao_historico || '',
          qrCode: c.qr_code_url || ''
        };
      });
    },
    async getNavios() { return []; },
    async getFuncionarios() { return []; },
    getSupabase: () => banco,
    notifyChange() {},
    invalidarLeiturasCargas() {}
  };
}

async function carregarCargas(banco, opts = {}) {
  const repository = repositorioDe(banco);
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: [],
      nexus_navios_list: opts.naviosCache || [],
      nexus_containers_list: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.NexusRepository = repository;
        win.nexusSupabase = banco;
      },
      'js/pages/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js',
      'js/padronizacao-codigos.js', 'js/pages/cargas.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(700);
  return janela;
}

const navioDb = (banco, id) => banco.tabelas.navios.find((n) => n.id === id) || {};
const cargaDb = (banco, id) => banco.tabelas.cargas.find((c) => c.id === id) || {};
const navioCache = (w, id) => (JSON.parse(w.localStorage.getItem('nexus_navios_list') || '[]').find((n) => n.id === id) || {});
const cargaCache = (w, id) => (JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]').find((c) => c.id === id) || {});
const tabelaEntregues = (w) => (w.document.getElementById('cargasEntreguesTableBody') || {}).textContent || '';
const updatesNavios = (banco) => banco.log.filter((l) => l.tabela === 'navios' && l.op === 'update').length;

async function main() {
  // ------------------------------------------------------------------
  log('\n1. ETA vencido: abrir Cargas & Pátio classifica a chegada e entrega a carga');
  {
    const banco = bancoCenas();
    const { w, erros } = await carregarCargas(banco);
    check('sem erros não capturados na página', erros.length === 0, JSON.stringify(erros).slice(0, 160));
    check('navio classificado NO_PORTO_DE_DESTINO no banco (sem abrir Embarcações & GPS)',
      navioDb(banco, NAVIO_DESTINO).localizacao === 'NO_PORTO_DE_DESTINO', navioDb(banco, NAVIO_DESTINO).localizacao);
    check('cache local de navios atualizado a partir do banco',
      navioCache(w, NAVIO_DESTINO).localizacao === 'NO_PORTO_DE_DESTINO', navioCache(w, NAVIO_DESTINO).localizacao);
    const c1 = cargaDb(banco, C1);
    check('carga EM_TRANSITO do navio entregue no banco com snapshot histórico',
      c1.status_fluxo === 'ENTREGUE' && c1.navio_id === null && c1.navio_nome_historico === 'MV Destino',
      JSON.stringify(c1));
    const c1c = cargaCache(w, 'CRG-C1');
    check('cache: carga ENTREGUE, desvinculada e com histórico preservado',
      c1c.status === 'ENTREGUE' && c1c.navio === '' && c1c.navioNomeHistorico === 'MV Destino',
      JSON.stringify(c1c).slice(0, 200));
    check('tabela de entregues exibe a carga ao abrir a página',
      tabelaEntregues(w).includes('CRG-C1'), tabelaEntregues(w).slice(0, 120));
    check('navio ainda em viagem (ETA não vencido) segue FORA_DO_PORTO',
      navioDb(banco, NAVIO_ALHEIO).localizacao === 'FORA_DO_PORTO', navioDb(banco, NAVIO_ALHEIO).localizacao);
    check('carga de outro navio continua EM_TRANSITO (banco e cache)',
      cargaDb(banco, C2).status_fluxo === 'EM_TRANSITO' && cargaCache(w, 'CRG-C2').status === 'EM_TRANSITO',
      `${cargaDb(banco, C2).status_fluxo}/${cargaCache(w, 'CRG-C2').status}`);
    check('carga sem navio em outro status não é afetada',
      cargaDb(banco, C3).status_fluxo === 'ARMAZENAGEM' && cargaCache(w, 'CRG-C3').status === 'ARMAZENAGEM',
      `${cargaDb(banco, C3).status_fluxo}/${cargaCache(w, 'CRG-C3').status}`);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n2. ETA não vencido: nenhuma classificação nem entrega');
  {
    const banco = bancoCenas({ dataSaida: HORAS(1) });
    const { w } = await carregarCargas(banco);
    check('navio continua FORA_DO_PORTO no banco e nenhuma atualização de navios ocorreu',
      navioDb(banco, NAVIO_DESTINO).localizacao === 'FORA_DO_PORTO' && updatesNavios(banco) === 0,
      `${navioDb(banco, NAVIO_DESTINO).localizacao}, updates=${updatesNavios(banco)}`);
    check('carga continua EM_TRANSITO e não aparece na tabela de entregues',
      cargaDb(banco, C1).status_fluxo === 'EM_TRANSITO' && !tabelaEntregues(w).includes('CRG-C1'),
      cargaDb(banco, C1).status_fluxo);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n3. Retorno ao Porto de Santos: chegada vira DENTRO_DO_PORTO, cargas seguem em trânsito');
  {
    const banco = bancoCenas({
      origem: 'Porto de Paranaguá',
      destino: 'Porto de Santos',
      dataSaida: HORAS(10),
      rotas: [{ id: UUID(2), origem: 'Porto de Paranaguá', destino: 'Porto de Santos', distancia_km: 100 }]
    });
    const { w } = await carregarCargas(banco);
    check('navio que volta a Santos é classificado DENTRO_DO_PORTO (não NO_PORTO_DE_DESTINO)',
      navioDb(banco, NAVIO_DESTINO).localizacao === 'DENTRO_DO_PORTO', navioDb(banco, NAVIO_DESTINO).localizacao);
    check('cargas permanecem EM_TRANSITO (entrega só ocorre no porto de destino)',
      cargaDb(banco, C1).status_fluxo === 'EM_TRANSITO' && !tabelaEntregues(w).includes('CRG-C1'),
      cargaDb(banco, C1).status_fluxo);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n4. Navio já classificado no banco + cache obsoleto: entrega ao carregar, sem reclassificar');
  {
    const banco = bancoCenas({ localizacaoNavio: 'NO_PORTO_DE_DESTINO' });
    // Cache obsoleto: ainda diz FORA_DO_PORTO e sem horário de saída (raiz do bug:
    // as transições automáticas liam apenas este cache).
    const naviosCache = [{
      id: NAVIO_DESTINO, nome: 'MV Destino', imo: 'IMO-4000001',
      localizacao: 'FORA_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Roterdã',
      distancia: null, dataSaida: null
    }];
    const { w } = await carregarCargas(banco, { naviosCache });
    check('cache obsoleto é substituído pelo estado real do banco',
      navioCache(w, NAVIO_DESTINO).localizacao === 'NO_PORTO_DE_DESTINO', navioCache(w, NAVIO_DESTINO).localizacao);
    check('nenhuma reclassificação de navios é enviada ao banco',
      updatesNavios(banco) === 0, `updates=${updatesNavios(banco)}`);
    check('carga EM_TRANSITO é entregue ao carregar a página (banco + tabela de entregues)',
      cargaDb(banco, C1).status_fluxo === 'ENTREGUE' && tabelaEntregues(w).includes('CRG-C1'),
      `${cargaDb(banco, C1).status_fluxo} / tabela="${tabelaEntregues(w).slice(0, 80)}"`);
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n5. ETA zera em segundos com Cargas & Pátio já aberta: atualiza para ENTREGUE automaticamente');
  {
    // 1 km @ 33 km/h = ~109,09 s. Saída há 108 s -> restam ~1,09 s ao abrir a página.
    const saidaQuaseChegando = new Date(Date.now() - 108 * 1000).toISOString();
    const banco = bancoCenas({
      dataSaida: saidaQuaseChegando,
      rotas: [{ id: UUID(5), origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 1 }]
    });
    const { w } = await carregarCargas(banco);
    check('antes de os segundos zerarem, a carga ainda está EM_TRANSITO',
      cargaDb(banco, C1).status_fluxo === 'EM_TRANSITO', cargaDb(banco, C1).status_fluxo);
    await aguardar(1600);
    check('assim que os segundos zeram na própria tela de Cargas, o navio vira NO_PORTO_DE_DESTINO',
      navioDb(banco, NAVIO_DESTINO).localizacao === 'NO_PORTO_DE_DESTINO', navioDb(banco, NAVIO_DESTINO).localizacao);
    check('a carga EM_TRANSITO passa automaticamente para ENTREGUE sem abrir Embarcações',
      cargaDb(banco, C1).status_fluxo === 'ENTREGUE' && tabelaEntregues(w).includes('CRG-C1'),
      `${cargaDb(banco, C1).status_fluxo} / tabela="${tabelaEntregues(w).slice(0, 80)}"`);
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 3 (entrega independente da página Embarcações & GPS) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
