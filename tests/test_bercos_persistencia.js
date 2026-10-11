#!/usr/bin/env node
/**
 * Regressão: persistência da ocupação de berços (Tarefa de Embarcações — persistência).
 *
 * Usa a página real embarcacoes.html e js/pages/embarcacoes.js em jsdom, com um banco
 * Supabase simulado (dublê com filtros reais, compare-and-set e falhas injetáveis):
 *   - berço ocupado no banco continua ocupado com localStorage vazio (sem cookies/cache);
 *   - berço cujo navio não existe mais é liberado no banco (órfão);
 *   - falha de leitura dos berços não grava nada no banco;
 *   - duas vinculações concorrentes ao mesmo berço: só uma vence;
 *   - exclusão do navio libera o berço no banco.
 *
 * Executar: node tests/test_bercos_persistencia.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const NAVIO_TESTE = { id: '11111111-2222-3333-4444-555555555555', nome: 'Navio Teste', numero_imo: 'IMO9999999', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' };
const NAVIO_B = { id: '22222222-3333-4444-5555-666666666666', nome: 'Navio B', numero_imo: 'IMO8888888', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' };

function bancoInicial(opcoes) {
  return criarBancoFalso({
    bercos: [
      { id: 'BERCO-01', nome: 'Berço 01', estado: 'OCUPADO', navio_nome: 'Navio Teste', navio_imo: 'IMO9999999', navio_id: null },
      { id: 'BERCO-02', nome: 'Berço 02', estado: 'OCUPADO', navio_nome: 'Navio Fantasma', navio_imo: 'IMO0000000', navio_id: null },
      { id: 'BERCO-03', nome: 'Berço 03', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null }
    ],
    navios: [Object.assign({}, NAVIO_TESTE), Object.assign({}, NAVIO_B)]
  }, opcoes);
}

const janelas = [];

// Carrega a página com o banco simulado e localStorage informado (padrão: vazio)
async function carregar(banco, storage) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: storage || { nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [] },
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

const escritasEmBercos = (banco) => banco.log.filter(e => e.tabela === 'bercos' && ['update', 'upsert', 'delete'].includes(e.op));

async function cenarioCarregamentoSemCache() {
  log('\n1. Carregamento sem cache local: berço ocupado no banco continua ocupado');
  const banco = bancoInicial();
  const { w } = await carregar(banco);
  const b1 = banco.tabelas.bercos[0];
  check('Berço 01 segue OCUPADO no banco após carregar com localStorage vazio', b1.estado === 'OCUPADO' && b1.navio_imo === 'IMO9999999', JSON.stringify(b1));
  check('nenhuma liberação de Berço 01 foi gravada no carregamento', !escritasEmBercos(banco).some(e => e.payload && e.payload.estado === 'LIVRE' && (e.filtros || []).some(f => f[0] === 'nome' && f[1] === 'Berço 01')));
  const card = w.document.getElementById('bercosGrid') && w.document.getElementById('bercosGrid').textContent;
  check('painel mostra o Navio Teste no Berço 01', /Navio Teste/.test(card || ''), (card || '').slice(0, 200));

  log('\n2. Nova navegação (cache apagado, cookies limpos): ocupação continua no banco');
  const { w: w2 } = await carregar(banco);
  check('Berço 01 continua OCUPADO em uma segunda carga sem storage', banco.tabelas.bercos[0].estado === 'OCUPADO');
  check('painel da segunda carga também mostra o Navio Teste', /Navio Teste/.test((w2.document.getElementById('bercosGrid') || {}).textContent || ''));
}

async function cenarioOrfao() {
  log('\n3. Berço ocupado por navio inexistente é liberado no banco (órfão)');
  const banco = bancoInicial();
  await carregar(banco);
  const b2 = banco.tabelas.bercos[1];
  check('Berço 02 (navio fantasma) foi liberado no banco', b2.estado === 'LIVRE' && b2.navio_imo === null, JSON.stringify(b2));
  check('Berço 01 (navio existente) não foi liberado', banco.tabelas.bercos[0].estado === 'OCUPADO');
}

async function cenarioFalhaLeitura() {
  log('\n4. Falha de leitura dos berços: nada é gravado no banco');
  const banco = bancoInicial({ falhar: ['bercos'] });
  await carregar(banco);
  check('nenhuma escrita em bercos quando a leitura falha', escritasEmBercos(banco).length === 0, JSON.stringify(escritasEmBercos(banco)));
}

async function cenarioConcorrencia() {
  log('\n5. Concorrência: duas vinculações ao mesmo berço livre, simultâneas');
  const banco = bancoInicial();
  const { w } = await carregar(banco);
  const antes = JSON.stringify(banco.tabelas.bercos[2]);
  check('Berço 03 começa livre', banco.tabelas.bercos[2].estado === 'LIVRE', antes);
  await Promise.all([
    w.vincularNavioABerco('IMO9999999', { confirmado: true, bercoNome: 'Berço 03' }),
    w.vincularNavioABerco('IMO8888888', { confirmado: true, bercoNome: 'Berço 03' })
  ]);
  await aguardar(100);
  const b3 = banco.tabelas.bercos[2];
  check('Berço 03 ficou ocupado exatamente uma vez', b3.estado === 'OCUPADO');
  const venceu = [NAVIO_TESTE.nome, NAVIO_B.nome].includes(b3.navio_nome);
  check('o berço pertence a um dos dois navios (sem dupla vinculação)', venceu, JSON.stringify(b3));
  const vinculadosAoBerco = banco.tabelas.bercos.filter(b => b.navio_nome === NAVIO_TESTE.nome || b.navio_nome === NAVIO_B.nome);
  check('o outro navio não ficou com berço no banco', vinculadosAoBerco.length === 1, JSON.stringify(vinculadosAoBerco));
  check('a perdedora recebeu aviso de berço indisponível', (w.__feedbacks || []).some(f => /Berço Indisponível/.test(f.titulo)), JSON.stringify(w.__feedbacks || []));
}

async function cenarioExclusao() {
  log('\n6. Exclusão do navio libera o berço no banco');
  const banco = bancoInicial();
  const { w } = await carregar(banco);
  await w.excluirNavio('IMO9999999', { confirmado: true });
  await aguardar(100);
  const b1 = banco.tabelas.bercos[0];
  check('Berço 01 ficou LIVRE no banco após excluir o navio', b1.estado === 'LIVRE' && b1.navio_imo === null && b1.navio_nome === null, JSON.stringify(b1));
  check('navio removido do banco', !banco.tabelas.navios.some(n => n.numero_imo === 'IMO9999999'));
}

async function main() {
  await cenarioCarregamentoSemCache();
  await cenarioOrfao();
  await cenarioFalhaLeitura();
  await cenarioConcorrencia();
  await cenarioExclusao();
  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
