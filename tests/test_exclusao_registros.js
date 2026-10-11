#!/usr/bin/env node
/**
 * Regressão: exclusão de navios, contêineres e guindastes (página Embarcações).
 *
 * Usa embarcacoes.html + js/pages/embarcacoes.js em jsdom com um banco Supabase simulado
 * (tests/fake-supabase-db.js). Verifica:
 *   - a exclusão só altera a interface depois que o banco confirma;
 *   - falha de leitura ou de DELETE no banco não remove nada da interface;
 *   - histórico de manutenção ligado ao registro bloqueia a exclusão (sem cascata);
 *   - cargas não são apagadas ao excluir contêiner/navio (apenas desvinculadas pelo banco);
 *   - berços do navio excluído são liberados no banco;
 *   - a tabela é atualizada sem recarregar a página.
 *
 * Executar: node tests/test_exclusao_registros.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const NAV1 = '11111111-2222-3333-4444-555555555555';
const NAV2 = '22222222-3333-4444-5555-666666666666';
const C1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const C2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const C3 = 'aaaaaaaa-0000-0000-0000-000000000003';
const G1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const G2 = 'bbbbbbbb-0000-0000-0000-000000000002';

function bancoBase(opcoes, extras) {
  const tabelas = {
    navios: [
      { id: NAV1, nome: 'Navio Teste', numero_imo: 'IMO9999999', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' },
      { id: NAV2, nome: 'Navio Livre', numero_imo: 'IMO7777777', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' }
    ],
    bercos: [
      { id: 'BERCO-01', nome: 'Berço 01', estado: 'OCUPADO', navio_nome: 'Navio Teste', navio_imo: 'IMO9999999', navio_id: null },
      { id: 'BERCO-02', nome: 'Berço 02', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null }
    ],
    containers: [
      { id: C1, numero_identificacao: 'CONT-1', navio_id: NAV1, estado: 'OPERANTE' },
      { id: C2, numero_identificacao: 'CONT-2', navio_id: null, estado: 'OPERANTE' },
      { id: C3, numero_identificacao: 'CONT-3', navio_id: null, estado: 'OPERANTE' }
    ],
    cargas: [
      { id: 'carga-1', container_id: C1, status_fluxo: 'AGENDAMENTO', qr_code_url: 'QR-carga-1' }
    ],
    guindastes: [
      { id: G1, numero_identificacao: 'GND-1', estado: 'OPERANTE' },
      { id: G2, numero_identificacao: 'GND-2', estado: 'OPERANTE' }
    ],
    manutencoes: [],
    historico_manutencoes: []
  };
  if (extras) Object.keys(extras).forEach(k => { tabelas[k] = extras[k]; });
  return criarBancoFalso(tabelas, opcoes);
}

const janelas = [];

async function carregar(banco, confirmacao) {
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
        win.nexusConfirm = async () => (confirmacao === undefined ? true : confirmacao);
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        // layout.js define o nexusConfirm real (modal); o teste o substitui pela decisão do cenário
        win.nexusConfirm = async () => (confirmacao === undefined ? true : confirmacao);
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
const linhas = (w, id) => (w.document.getElementById(id) || { children: [] }).querySelectorAll('tr').length;

async function cenarioNavio() {
  log('\n1. Exclusão de navio sem histórico: banco confirma, interface atualiza, berço liberado');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  const antes = linhas(w, 'embarcacoesGpsTableBody');
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('navio removido do banco', !banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('Berço 01 liberado no banco', banco.tabelas.bercos[0].estado === 'LIVRE' && banco.tabelas.bercos[0].navio_imo === null);
  check('contêiner CONT-1 NÃO foi apagado (só desvinculado)', banco.tabelas.containers.some(c => c.id === C1));
  check('carga NÃO foi apagada', banco.tabelas.cargas.some(c => c.id === 'carga-1'));
  check('tabela de navios atualizada sem recarregar', linhas(w, 'embarcacoesGpsTableBody') === antes - 1, `${antes} -> ${linhas(w, 'embarcacoesGpsTableBody')}`);
  check('sucesso informado após confirmação do banco', ultimo(w).tipo === 'sucesso', JSON.stringify(ultimo(w)));
}

async function cenarioNavioCargaEmTransito() {
  log('\n1b. Navio com carga EM_TRANSITO: a volta para PRONTA_PARA_ENTREGA é gravada NO BANCO');
  const cargaT = { id: 'carga-t', navio_id: NAV1, status_fluxo: 'EM_TRANSITO', qr_code_url: 'QR-carga-t' };
  const banco = bancoBase(undefined, { cargas: [cargaT] });
  const { w } = await carregar(banco);
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('navio removido após a gravação', !banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  const c = banco.tabelas.cargas.find(x => x.id === 'carga-t');
  check('carga em trânsito voltou a PRONTA_PARA_ENTREGA no banco', c && c.status_fluxo === 'PRONTA_PARA_ENTREGA', JSON.stringify(c));

  log('\n1c. Falha ao gravar a carga: o navio NÃO é excluído e a interface não muda');
  const banco2 = bancoBase({ falharOp: { cargas: ['update'] } }, { cargas: [{ id: 'carga-t', navio_id: NAV1, status_fluxo: 'EM_TRANSITO', qr_code_url: 'QR-carga-t' }] });
  const { w: w2 } = await carregar(banco2);
  const antes2 = linhas(w2, 'embarcacoesGpsTableBody');
  await w2.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('navio segue no banco', banco2.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('carga segue EM_TRANSITO no banco', banco2.tabelas.cargas.find(x => x.id === 'carga-t').status_fluxo === 'EM_TRANSITO');
  check('tabela não alterada', linhas(w2, 'embarcacoesGpsTableBody') === antes2);
  check('erro informado ao usuário', ultimo(w2).tipo === 'erro', JSON.stringify(ultimo(w2)));
}

async function cenarioNavioBloqueado() {
  log('\n2. Navio com histórico de manutenção: exclusão bloqueada com justificativa');
  const banco = bancoBase({}, { manutencoes: [{ id: 'm1', navio_id: NAV1 }] });
  const { w } = await carregar(banco);
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('navio NÃO foi removido do banco', banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('histórico de manutenção preservado', banco.tabelas.manutencoes.length === 1);
  check('berço continua ocupado', banco.tabelas.bercos[0].estado === 'OCUPADO');
  check('aviso de exclusão bloqueada com justificativa', ultimo(w).titulo === 'Exclusão Bloqueada' && /manutenção/.test(ultimo(w).msg || ''), JSON.stringify(ultimo(w)));
}

async function cenarioNavioFalhaDelete() {
  log('\n3. Banco recusa o DELETE do navio: interface não muda');
  const banco = bancoBase({ falharOp: { navios: ['delete'] } });
  const { w } = await carregar(banco);
  const antes = linhas(w, 'embarcacoesGpsTableBody');
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('navio segue no banco', banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('tabela não mudou', linhas(w, 'embarcacoesGpsTableBody') === antes);
  check('berço continua ocupado', banco.tabelas.bercos[0].estado === 'OCUPADO');
  check('erro informado (sem sucesso)', ultimo(w).tipo === 'erro', JSON.stringify(ultimo(w)));
}

async function cenarioNavioFalhaLeitura() {
  log('\n4. Falha de leitura no banco: nada é excluído e o usuário é avisado');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  // A falha entra depois do carregamento: a leitura de confirmação da exclusão falha
  banco.config.falhar = ['navios'];
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(50);
  check('nenhum DELETE executado em navios', !banco.log.some(e => e.tabela === 'navios' && e.op === 'delete' && !e.falha));
  check('navio segue no banco', banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('berço continua ocupado', banco.tabelas.bercos[0].estado === 'OCUPADO');
  check('erro informado (sem sucesso)', !(w.__feedbacks || []).some(f => f.tipo === 'sucesso') && ultimo(w).tipo === 'erro', JSON.stringify(ultimo(w)));
}

async function cenarioCancelamento() {
  log('\n5. Usuário cancela a confirmação: nenhuma alteração');
  const banco = bancoBase();
  const { w } = await carregar(banco, false);
  await w.excluirNavio('IMO9999999');
  await aguardar(50);
  check('navio permanece no banco após cancelar', banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
  check('nenhum feedback de sucesso', !(w.__feedbacks || []).some(f => f.tipo === 'sucesso'));
}

async function cenarioContainer() {
  log('\n6. Exclusão de contêiner sem histórico');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  const antes = linhas(w, 'containersTableBody');
  await w.excluirContainer('CONT-2', { confirmado: true });
  await aguardar(50);
  check('CONT-2 removido do banco', !banco.tabelas.containers.some(c => c.numero_identificacao === 'CONT-2'));
  check('tabela de contêineres atualizada', linhas(w, 'containersTableBody') === antes - 1, `${antes} -> ${linhas(w, 'containersTableBody')}`);
  check('sucesso informado', ultimo(w).tipo === 'sucesso', JSON.stringify(ultimo(w)));
}

async function cenarioContainerComCarga() {
  log('\n7. Contêiner com carga: carga preservada');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  await w.excluirContainer('CONT-1', { confirmado: true });
  await aguardar(50);
  check('carga continua existindo', banco.tabelas.cargas.some(c => c.id === 'carga-1'));
  check('contêiner removido', !banco.tabelas.containers.some(c => c.numero_identificacao === 'CONT-1'));
}

async function cenarioContainerBloqueado() {
  log('\n8. Contêiner com histórico de manutenção: bloqueado');
  const banco = bancoBase({}, { manutencoes: [{ id: 'm2', container_id: C3 }] });
  const { w } = await carregar(banco);
  await w.excluirContainer('CONT-3', { confirmado: true });
  await aguardar(50);
  check('CONT-3 mantido no banco', banco.tabelas.containers.some(c => c.numero_identificacao === 'CONT-3'));
  check('aviso de exclusão bloqueada', ultimo(w).titulo === 'Exclusão Bloqueada', JSON.stringify(ultimo(w)));
}

async function cenarioGuindaste() {
  log('\n9. Exclusão de guindaste sem histórico');
  const banco = bancoBase();
  const { w } = await carregar(banco);
  const antes = linhas(w, 'guindastesTableBody');
  await w.excluirGuindaste('GND-1', { confirmado: true });
  await aguardar(50);
  check('GND-1 removido do banco', !banco.tabelas.guindastes.some(g => g.numero_identificacao === 'GND-1'));
  check('tabela de guindastes atualizada', linhas(w, 'guindastesTableBody') === antes - 1, `${antes} -> ${linhas(w, 'guindastesTableBody')}`);
  check('sucesso informado', ultimo(w).tipo === 'sucesso', JSON.stringify(ultimo(w)));
}

async function cenarioGuindasteBloqueado() {
  log('\n10. Guindaste com histórico: bloqueado; falha de DELETE mantém tela');
  const banco = bancoBase({}, { historico_manutencoes: [{ id: 'h1', guindaste_id: G2 }] });
  const { w } = await carregar(banco);
  await w.excluirGuindaste('GND-2', { confirmado: true });
  await aguardar(50);
  check('GND-2 mantido no banco com histórico', banco.tabelas.guindastes.some(g => g.numero_identificacao === 'GND-2') && banco.tabelas.historico_manutencoes.length === 1);
  check('aviso de exclusão bloqueada', ultimo(w).titulo === 'Exclusão Bloqueada', JSON.stringify(ultimo(w)));

  const banco2 = bancoBase({ falharOp: { guindastes: ['delete'] } });
  const { w: w2 } = await carregar(banco2);
  const antes = linhas(w2, 'guindastesTableBody');
  await w2.excluirGuindaste('GND-1', { confirmado: true });
  await aguardar(50);
  check('falha de DELETE: guindaste segue no banco e na tabela', banco2.tabelas.guindastes.some(g => g.numero_identificacao === 'GND-1') && linhas(w2, 'guindastesTableBody') === antes);
  check('falha de DELETE: erro informado', ultimo(w2).tipo === 'erro', JSON.stringify(ultimo(w2)));
}

async function main() {
  await cenarioNavio();
  await cenarioNavioCargaEmTransito();
  await cenarioNavioBloqueado();
  await cenarioNavioFalhaDelete();
  await cenarioNavioFalhaLeitura();
  await cenarioCancelamento();
  await cenarioContainer();
  await cenarioContainerComCarga();
  await cenarioContainerBloqueado();
  await cenarioGuindaste();
  await cenarioGuindasteBloqueado();
  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
