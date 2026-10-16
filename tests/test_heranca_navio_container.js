#!/usr/bin/env node
/**
 * Regressão — Tarefa 4 (Correções): herança de navio do contêiner nas duas
 * ordens de vinculação.
 *
 * Cenários:
 *  1. (a) carga→contêiner→navio DEPOIS, com o cache no formato do repositório
 *     de dados (container = UUID, sem flag de herança): ao vincular o contêiner
 *     ao navio em Embarcações & GPS, a carga herda o navio (cache + Supabase).
 *  2. (a) mesmo fluxo com o cache no formato da tela (container = identificação
 *     textual + herdarNavioDoContainer): comportamento preservado.
 *  3. Navio escolhido manualmente NUNCA é sobrescrito pela herança (nem no
 *     cache, nem no banco).
 *  4. Carga vinculada ao contêiner que só existe no banco (outro dispositivo)
 *     também herda e é persistida.
 *  5. (b) contêiner→navio→carga DEPOIS: ao vincular a carga ao contêiner em
 *     Cargas & Pátio, o navio do contêiner é herdado imediatamente (comportamento
 *     atual correto mantido).
 *  6. Projeção na página de Cargas: carga mapeada pelo repositório (container =
 *     UUID) exibe o navio do contêiner sem depender de ação manual.
 *
 * Executar: node tests/test_heranca_navio_container.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAVIO = UUID(501);
const NAVIO_MANUAL = UUID(503);
const CONT = UUID(502);
const CARGA_DB = UUID(511);
const IDENT = 'MSCU-5000002';
const IMO = 'IMO-5000001';
const IMO_MANUAL = 'IMO-5000003';

function bancoHeranca(opts = {}) {
  return criarBancoFalso({
    navios: [
      { id: NAVIO, nome: 'Navio Teste', numero_imo: IMO, localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' },
      { id: NAVIO_MANUAL, nome: 'Navio Manual', numero_imo: IMO_MANUAL, localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' }
    ],
    containers: [
      { id: CONT, numero_identificacao: IDENT, estado: 'OPERANTE', material_carregado: 'Carga Geral', navio_id: opts.contJaVinculado ? NAVIO : null }
    ],
    cargas: [
      {
        id: CARGA_DB, qr_code_url: 'QR-CRG-H1', status_fluxo: 'ARMAZENAGEM', natureza: 'Geral',
        destino: 'Porto de Roterdã',
        // Cenário (b): a carga ainda não tem contêiner no banco — o vínculo
        // acontece depois, pela tela de Cargas & Pátio.
        container_id: opts.cargaSemContainer ? null : CONT,
        navio_id: opts.navioIdBanco === undefined ? null : opts.navioIdBanco
      }
    ],
    rotas_maritimas: [], bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

const cargaBanco = (banco) => banco.tabelas.cargas.find((c) => c.id === CARGA_DB) || {};
const contBanco = (banco) => banco.tabelas.containers.find((c) => c.id === CONT) || {};
const cargaCache = (w) => (JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]').find((c) => c.id === 'CRG-H1') || {});
const avisoCont = (avisos) => avisos.find((a) => a.titulo === 'Contêiner Vinculado');

/** Janela Embarcações & GPS (padrão dos testes de vinculação de contêiner). */
async function abrirEmbarcacoes(banco, cargasCache) {
  const avisos = [];
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_navios_list: [],
      nexus_bercos_list: [],
      nexus_containers_list: [],
      nexus_guindastes_list: [],
      nexus_cargas_fluxo: cargasCache
    },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => banco, notifyChange() {}, invalidarLeiturasCargas() {}
        };
        win.nexusConfirm = async () => true;
        win.mostrarFeedback = (tipo, titulo, msg) => { avisos.push({ tipo, titulo, msg }); };
      },
      'js/padronizacao-codigos.js',
      'js/pages/embarcacoes.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(300);
  return { w: janela.w, janela, avisos };
}

/** Vincula o contêiner ao Navio Teste e devolve o aviso de sucesso, se houver. */
async function vincularContainerAoNavioTeste(w, avisos) {
  await w.vincularContainerANavio(IDENT, { navioImo: IMO, confirmado: true });
  await aguardar(120);
  return avisoCont(avisos);
}

async function main() {
  // ------------------------------------------------------------------
  log('\n1. (a) carga→contêiner→navio depois — cache no formato do repositório (UUID)');
  {
    const banco = bancoHeranca();
    // Formato exatamente como o NexusRepository.getCargas mapeia: container é o
    // UUID (container_id) e não há flag herdarNavioDoContainer; navio vazio.
    const cargasCache = [{
      id: 'CRG-H1', rawDbId: CARGA_DB, status: 'ARMAZENAGEM', tipo: 'Carga Geral',
      natureza: 'Geral', peso: '5 t', volume: '10 m³', destino: 'Porto de Roterdã',
      container: CONT, container_id: CONT, navio: '', navioId: null, navio_id: null,
      qrCode: 'QR-CRG-H1'
    }];
    const { w, avisos } = await abrirEmbarcacoes(banco, cargasCache);
    const aviso = await vincularContainerAoNavioTeste(w, avisos);
    check('contêiner vinculado ao navio (banco)', contBanco(banco).navio_id === NAVIO, String(contBanco(banco).navio_id));
    check('carga herda o navio no cache mesmo com container=UUID e sem flag',
      cargaCache(w).navio === 'Navio Teste' && cargaCache(w).navio_id === NAVIO,
      JSON.stringify({ navio: cargaCache(w).navio, navio_id: cargaCache(w).navio_id }));
    check('herança persistida no Supabase (cargas.navio_id)',
      cargaBanco(banco).navio_id === NAVIO, String(cargaBanco(banco).navio_id));
    check('feedback informa que a carga herdou o navio automaticamente',
      Boolean(aviso) && /1 carga\(s\) do contêiner herdaram o navio/.test(aviso.msg),
      aviso ? aviso.msg : 'sem aviso');
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n2. (a) mesmo fluxo com o cache no formato da tela (identificação + flag)');
  {
    const banco = bancoHeranca();
    const cargasCache = [{
      id: 'CRG-H1', rawDbId: CARGA_DB, status: 'ARMAZENAGEM', tipo: 'Carga Geral',
      destino: 'Porto de Roterdã', container: IDENT, container_id: CONT,
      navio: '', herdarNavioDoContainer: true, qrCode: 'QR-CRG-H1'
    }];
    const { w, avisos } = await abrirEmbarcacoes(banco, cargasCache);
    await vincularContainerAoNavioTeste(w, avisos);
    check('carga com identificação textual + flag continua herdando (cache e banco)',
      cargaCache(w).navio === 'Navio Teste' && cargaBanco(banco).navio_id === NAVIO,
      JSON.stringify({ cache: cargaCache(w).navio, banco: cargaBanco(banco).navio_id }));
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n3. Navio escolhido manualmente nunca é sobrescrito pela herança');
  {
    const banco = bancoHeranca({ navioIdBanco: NAVIO_MANUAL });
    const cargasCache = [{
      id: 'CRG-H1', rawDbId: CARGA_DB, status: 'ARMAZENAGEM', tipo: 'Carga Geral',
      destino: 'Porto de Roterdã', container: CONT, container_id: CONT,
      navio: 'Navio Manual', navioId: NAVIO_MANUAL, navio_id: NAVIO_MANUAL,
      herdarNavioDoContainer: false, qrCode: 'QR-CRG-H1'
    }];
    const { w, avisos } = await abrirEmbarcacoes(banco, cargasCache);
    const aviso = await vincularContainerAoNavioTeste(w, avisos);
    check('contêiner é vinculado ao navio normalmente', contBanco(banco).navio_id === NAVIO, String(contBanco(banco).navio_id));
    check('cache mantém o navio manual da carga',
      cargaCache(w).navio === 'Navio Manual' && cargaCache(w).navio_id === NAVIO_MANUAL,
      JSON.stringify({ navio: cargaCache(w).navio }));
    check('banco mantém o navio manual da carga (herança não sobrescreve)',
      cargaBanco(banco).navio_id === NAVIO_MANUAL, String(cargaBanco(banco).navio_id));
    check('feedback não anuncia herança para carga com navio manual',
      Boolean(aviso) && !/herdaram o navio/.test(aviso.msg), aviso ? aviso.msg : 'sem aviso');
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n4. Carga do contêiner que só existe no banco (outro dispositivo) também herda');
  {
    const banco = bancoHeranca(); // carga no banco com container_id e sem navio
    const { w, avisos } = await abrirEmbarcacoes(banco, []); // cache local vazio
    const aviso = await vincularContainerAoNavioTeste(w, avisos);
    check('herança aplicada e persistida apenas com os dados do banco',
      cargaBanco(banco).navio_id === NAVIO, String(cargaBanco(banco).navio_id));
    check('feedback contabiliza a carga herdada do banco',
      Boolean(aviso) && /1 carga\(s\) do contêiner herdaram o navio/.test(aviso.msg),
      aviso ? aviso.msg : 'sem aviso');
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n5. (b) contêiner→navio→carga depois: herança imediata na vinculação da carga');
  {
    const banco = bancoHeranca({ contJaVinculado: true, cargaSemContainer: true });
    const cargaTela = {
      id: 'CRG-H1', rawDbId: CARGA_DB, status: 'ARMAZENAGEM', tipo: 'Carga Geral',
      natureza: 'Geral', peso: '5 t', volume: '10 m³', destino: 'Porto de Roterdã',
      portoDescarga: 'Pátio STS-01', container: '', navio: '', qrCode: 'QR-CRG-H1'
    };
    const repository = {
      async getCargas() {
        return banco.tabelas.cargas.map((c) => ({
          id: String(c.qr_code_url || '').replace('QR-', ''),
          rawDbId: c.id, tipo: 'Carga Geral', natureza: c.natureza || 'Geral',
          peso: '5 t', volume: '10 m³', valor: 'R$ 100,00', portoDescarga: 'Pátio STS-01',
          destino: c.destino || 'Porto de Roterdã', status: c.status_fluxo,
          container: c.container_id || '', container_id: c.container_id || null,
          navio: (banco.tabelas.navios.find((n) => n.id === c.navio_id) || {}).nome || '',
          navioId: c.navio_id || null, navio_id: c.navio_id || null,
          qrCode: c.qr_code_url || ''
        }));
      },
      async getNavios() {
        return banco.tabelas.navios.map((n) => ({ ...n, imo: n.numero_imo, origem: n.porto_origem, destino: n.porto_destino }));
      },
      async getFuncionarios() { return []; },
      getSupabase: () => banco,
      notifyChange() {},
      invalidarLeiturasCargas() {}
    };
    const avisos = [];
    const janela = criarJanela({
      url: 'https://nexusport.test/cargas.html',
      html: htmlDaPagina('cargas.html'),
      session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
      storage: {
        nexus_cargas_fluxo: [cargaTela],
        nexus_navios_list: [
          { id: NAVIO, nome: 'Navio Teste', imo: IMO, localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE', origem: 'Porto de Santos', destino: 'Porto de Roterdã' }
        ],
        nexus_containers_list: [
          { id: CONT, identificacao: IDENT, tipo: 'Carga Geral', estado: 'OPERANTE', navio_id: NAVIO }
        ],
        nexus_func_list: []
      },
      scripts: [
        'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
        'js/padronizacao-codigos.js', 'js/pages/tipos-carga.js',
        (win) => {
          win.currentUserSession = win.NexusAuth.getSession();
          win.nexusSupabase = banco;
          win.NexusRepository = repository;
          win.registrarLogAlteracao = async () => {};
          win.mostrarFeedback = (tipo, titulo, msg) => { avisos.push({ tipo, titulo, msg }); };
        },
        'js/pages/cargas.js'
      ]
    });
    const w = janela.w;
    await prontoDom(w);
    await aguardar(250);
    check('sem erros não capturados ao abrir Cargas & Pátio', janela.erros.length === 0, JSON.stringify(janela.erros).slice(0, 160));

    // Vincula a carga ao contêiner (que já tem navio) sem escolher navio: herança imediata.
    await w.abrirModalVinculacao('CRG-H1');
    await aguardar(60);
    const navioSel = w.document.getElementById('vincularNavioSelect');
    navioSel.value = '';
    navioSel.dispatchEvent(new w.Event('change'));
    w.document.getElementById('vincularContainerSelect').value = CONT;
    w.document.getElementById('confirmVincularModalBtn').click();
    await aguardar(200);

    check('carga herda imediatamente o navio do contêiner (cache)',
      cargaCache(w).navio === 'Navio Teste' && cargaCache(w).container === IDENT,
      JSON.stringify({ navio: cargaCache(w).navio, container: cargaCache(w).container }));
    check('vínculo persistido no Supabase (container_id + navio_id)',
      cargaBanco(banco).container_id === CONT && cargaBanco(banco).navio_id === NAVIO,
      JSON.stringify({ container_id: cargaBanco(banco).container_id, navio_id: cargaBanco(banco).navio_id }));
    w.close();
  }

  // ------------------------------------------------------------------
  log('\n6. Projeção em Cargas & Pátio: container=UUID exibe o navio do contêiner');
  {
    const banco = bancoHeranca({ contJaVinculado: true });
    const repository = {
      async getCargas() {
        return banco.tabelas.cargas.map((c) => ({
          id: String(c.qr_code_url || '').replace('QR-', ''),
          rawDbId: c.id, tipo: 'Carga Geral', natureza: 'Geral', peso: '5 t', volume: '10 m³',
          destino: 'Porto de Roterdã', status: c.status_fluxo,
          // Formato do repositório: container é o UUID; navio só existe se o
          // banco já tiver navio_id — aqui a herança precisa vir da projeção.
          container: c.container_id || '', container_id: c.container_id || null,
          navio: '', navioId: null, navio_id: null, qrCode: c.qr_code_url || ''
        }));
      },
      async getNavios() { return []; },
      async getFuncionarios() { return []; },
      getSupabase: () => null,
      notifyChange() {},
      invalidarLeiturasCargas() {}
    };
    const janela = criarJanela({
      url: 'https://nexusport.test/cargas.html',
      html: htmlDaPagina('cargas.html'),
      session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
      storage: {
        nexus_cargas_fluxo: [],
        nexus_navios_list: [
          { id: NAVIO, nome: 'Navio Teste', imo: IMO, localizacao: 'DENTRO_DO_PORTO', origem: 'Porto de Santos', destino: 'Porto de Roterdã' }
        ],
        nexus_containers_list: [
          { id: CONT, rawDbId: CONT, identificacao: IDENT, tipo: 'Carga Geral', estado: 'OPERANTE', navio_id: NAVIO, navio: 'Não Vinculado' }
        ],
        nexus_func_list: []
      },
      scripts: [
        'js/security.js', 'js/session-cookies.js', 'js/supabase-client.js', 'js/auth-guard.js',
        'js/padronizacao-codigos.js', 'js/pages/tipos-carga.js',
        (win) => {
          win.currentUserSession = win.NexusAuth.getSession();
          win.nexusSupabase = null; // offline: só projeção local, sem persistir
          win.NexusRepository = repository;
        },
        'js/pages/cargas.js'
      ]
    });
    const w = janela.w;
    await prontoDom(w);
    await aguardar(300);
    const tabela = (w.document.getElementById('cargasTableBody') || {}).textContent || '';
    check('carga com container=UUID exibe o navio herdado do contêiner na tabela',
      tabela.includes('Navio Teste') && !tabela.includes('Navio: não vinculado'),
      tabela.replace(/\s+/g, ' ').slice(0, 200));
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 4 (herança de navio do contêiner nas duas ordens) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
