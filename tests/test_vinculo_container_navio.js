#!/usr/bin/env node
/**
 * Regressão (A4 — Backlog NexusPort): vincular contêiner a navio por SELEÇÃO.
 *
 * Usa a página real embarcacoes.html e js/pages/embarcacoes.js em jsdom, com o dublê
 * de banco (tests/fake-supabase-db.js):
 *   - o botão "Vincular" da tabela de contêineres abre um modal com <select> de navios
 *     (o operador não digita o número do navio em prompt de texto);
 *   - navios indisponíveis (em trânsito, no porto de destino, fora de operação ou sem
 *     capacidade) aparecem desabilitados, com o motivo na opção;
 *   - a escolha é revalidada com dados frescos antes de gravar (navio que saiu do porto
 *     com o modal aberto é recusado — "Vinculação Bloqueada");
 *   - a capacidade continua valendo (15.000 t / 300 m) e o vínculo é gravado no Supabase;
 *   - o caminho do agente WebMCP (opcoes.navioImo) segue funcionando sem diálogo.
 *
 * Executar: node tests/test_vinculo_container_navio.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const NAV_SANTOS = '11111111-2222-3333-4444-555555555555';
const NAV_TRANSITO = '22222222-3333-4444-5555-666666666666';
const NAV_DESTINO = '33333333-4444-5555-6666-777777777777';
const NAV_REFORMA = '44444444-5555-6666-7777-888888888888';
const NAV_CHEIO = '55555555-6666-7777-8888-999999999999';

/** Contêineres que lotam a capacidade do Navio Cheio (25 × 12 m = 300 m). */
function containersDoNavioCheio() {
  return Array.from({ length: 25 }, (_, i) => ({
    id: `cccccccc-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
    numero_identificacao: `CHEIO-${i}`,
    navio_id: NAV_CHEIO,
    estado: 'OPERANTE'
  }));
}

const CONTAINER_SOLTO = { id: 'aaaaaaaa-0000-0000-0000-000000000001', numero_identificacao: 'MSCU-1234567', navio_id: null, estado: 'OPERANTE' };

function bancoBase() {
  return criarBancoFalso({
    navios: [
      { id: NAV_SANTOS, nome: 'Navio Santos', numero_imo: 'IMO6000001', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' },
      { id: NAV_TRANSITO, nome: 'Navio Trânsito', numero_imo: 'IMO6000002', localizacao: 'FORA_DO_PORTO', estado_operacional: 'OPERANTE' },
      { id: NAV_DESTINO, nome: 'Navio Destino', numero_imo: 'IMO6000003', localizacao: 'NO_PORTO_DE_DESTINO', estado_operacional: 'OPERANTE' },
      { id: NAV_REFORMA, nome: 'Navio Reforma', numero_imo: 'IMO6000004', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'EM_REFORMA' },
      { id: NAV_CHEIO, nome: 'Navio Cheio', numero_imo: 'IMO6000005', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' }
    ],
    containers: [CONTAINER_SOLTO].concat(containersDoNavioCheio()),
    cargas: [], bercos: [], guindastes: [], manutencoes: [], historico_manutencoes: []
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
          // Mesma projeção do NexusRepository real (estado operacional incluído): é o que a
          // página usa para revalidar a situação do navio antes de vincular.
          getNavios: async () => (banco.tabelas.navios || []).map(n => ({
            id: n.id, nome: n.nome, imo: n.numero_imo || n.imo,
            estado: n.estado_operacional || n.estado || 'OPERANTE',
            localizacao: n.localizacao || 'DENTRO_DO_PORTO'
          })),
          getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => banco, notifyChange() {}, invalidarLeiturasCargas() {}
        };
        win.nexusConfirm = async () => true;
        // O prompt de digitação não deve ser usado neste fluxo (A4)
        win.nexusPrompt = async () => { win.__prompts = (win.__prompts || 0) + 1; return ''; };
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.nexusPrompt = async () => { win.__prompts = (win.__prompts || 0) + 1; return ''; };
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
const modalAberto = (w) => !w.document.getElementById('vincularContainerModal').classList.contains('hidden');
const opcaoDe = (sel, imo) => Array.from(sel.options).find((o) => o.value === imo) || null;
/** Identificação tolerante a hífen/caixa (o banco guarda MSCU-1234567, a tela mostra igual). */
const normalizar = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const containerNoBanco = (banco, identificacao) => banco.tabelas.containers.find((c) => normalizar(c.numero_identificacao) === normalizar(identificacao)) || {};
const linhaDoContainer = (w, texto) => Array.from(w.document.querySelectorAll('#containersTableBody tr'))
  .find((tr) => normalizar(tr.textContent).includes(normalizar(texto))) || null;

async function main() {
  const banco = bancoBase();
  const { w } = await carregar(banco);

  log('\n1. Botão "Vincular" do contêiner abre SELEÇÃO de navio (sem digitação)');
  w.vincularContainerANavio('MSCU1234567');
  await aguardar(120);
  check('modal de seleção de navio abre', modalAberto(w));

  const fonte = fs.readFileSync(path.join(__dirname, '..', 'js/pages/embarcacoes.js'), 'utf8');
  const trecho = fonte.slice(fonte.indexOf('window.vincularContainerANavio = async'), fonte.indexOf('// Excluir Contêiner (Tarefa 8)'));
  check('o vínculo contêiner ➜ navio não usa mais digitação (nexusPrompt)', !/nexusPrompt/.test(trecho));
  check('nenhum prompt de texto foi aberto no fluxo', (w.__prompts || 0) === 0, `prompts: ${w.__prompts || 0}`);
  check('label identifica o contêiner', /MSCU1234567|MSCU-1234567/.test(w.document.getElementById('vincularContainerLabel').textContent), w.document.getElementById('vincularContainerLabel').textContent);

  log('\n2. Somente navios aptos ficam habilitados; o motivo aparece na opção');
  const sel = w.document.getElementById('vincularContainerNavioSelect');
  const santos = opcaoDe(sel, 'IMO6000001');
  check('navio atracado em Santos e operante está habilitado', Boolean(santos) && santos.disabled === false, santos && santos.textContent);
  check('navio em trânsito aparece desabilitado com o motivo',
    opcaoDe(sel, 'IMO6000002').disabled === true && /trânsito/.test(opcaoDe(sel, 'IMO6000002').textContent), opcaoDe(sel, 'IMO6000002').textContent);
  check('navio no porto de destino aparece desabilitado',
    opcaoDe(sel, 'IMO6000003').disabled === true && /porto de destino/.test(opcaoDe(sel, 'IMO6000003').textContent), opcaoDe(sel, 'IMO6000003').textContent);
  check('navio não operante aparece desabilitado',
    opcaoDe(sel, 'IMO6000004').disabled === true && /operante/.test(opcaoDe(sel, 'IMO6000004').textContent), opcaoDe(sel, 'IMO6000004').textContent);
  check('navio sem capacidade (25 contêineres) aparece desabilitado',
    opcaoDe(sel, 'IMO6000005').disabled === true && /capacidade/.test(opcaoDe(sel, 'IMO6000005').textContent), opcaoDe(sel, 'IMO6000005').textContent);
  check('aviso do modal orienta a escolha', /1 navio\(s\) disponível\(is\)/.test(w.document.getElementById('vincularContainerAviso').textContent), w.document.getElementById('vincularContainerAviso').textContent);

  log('\n3. Confirmar sem escolher não vincula (o operador é avisado)');
  w.document.getElementById('confirmarVincularContainerBtn').click();
  await aguardar(80);
  check('vínculo não gravado sem escolha', !containerNoBanco(banco, 'MSCU1234567').navio_id, JSON.stringify(containerNoBanco(banco, 'MSCU1234567')));
  check('usuário é informado de que o navio é obrigatório', ultimo(w).titulo === 'Navio Obrigatório', JSON.stringify(ultimo(w)));
  check('modal continua aberto', modalAberto(w));

  log('\n4. Escolha de navio apto grava o vínculo no Supabase');
  sel.value = 'IMO6000001';
  w.document.getElementById('confirmarVincularContainerBtn').click();
  await aguardar(200);
  check('banco: contêiner vinculado ao navio escolhido', containerNoBanco(banco, 'MSCU1234567').navio_id === NAV_SANTOS, JSON.stringify(containerNoBanco(banco, 'MSCU1234567')));
  check('modal fecha após gravar', !modalAberto(w));
  check('feedback de sucesso informa o navio', ultimo(w).titulo === 'Contêiner Vinculado' && /Navio Santos/.test(ultimo(w).msg || ''), JSON.stringify(ultimo(w)));
  const linhasApos = linhaDoContainer(w, 'MSCU1234567');
  check('tabela de contêineres mostra o navio vinculado', Boolean(linhasApos) && /Navio Santos/.test(linhasApos.textContent), linhasApos && linhasApos.textContent.slice(0, 200));

  log('\n5. Concorrência: o navio saiu do porto com o modal aberto');
  w.vincularContainerANavio('CHEIO-1');
  await aguardar(150);
  check('modal abre para o próximo contêiner', modalAberto(w));
  // Outro operador libera a saída do navio enquanto o modal está aberto
  banco.tabelas.navios.find((n) => n.numero_imo === 'IMO6000001').localizacao = 'FORA_DO_PORTO';
  sel.value = 'IMO6000001';
  w.document.getElementById('confirmarVincularContainerBtn').click();
  await aguardar(200);
  check('vínculo é recusado quando o navio não está mais no porto',
    containerNoBanco(banco, 'CHEIO-1').navio_id === NAV_CHEIO, JSON.stringify(containerNoBanco(banco, 'CHEIO-1')));
  check('aviso de vinculação bloqueada com o motivo', ultimo(w).titulo === 'Vinculação Bloqueada' && /trânsito/.test(ultimo(w).msg || ''), JSON.stringify(ultimo(w)));
  check('modal continua aberto para corrigir a escolha', modalAberto(w));
  // O navio volta ao porto: os cenários seguintes trabalham com ele atracado
  banco.tabelas.navios.find((n) => n.numero_imo === 'IMO6000001').localizacao = 'DENTRO_DO_PORTO';

  log('\n6. Caminho do agente WebMCP: navio informado pelo IMO, sem diálogo');
  w.document.getElementById('cancelarVincularContainerBtn').click();
  await aguardar(50);
  const promptsAntes = w.__prompts || 0;
  await w.vincularContainerANavio('MSCU1234567', { navioImo: 'IMO6000005' });
  await aguardar(150);
  check('agente com navio sem capacidade é recusado com o motivo',
    containerNoBanco(banco, 'MSCU1234567').navio_id === NAV_SANTOS && ultimo(w).titulo === 'Capacidade Excedida', JSON.stringify(ultimo(w)));
  check('agente não abre modal nem prompt', !modalAberto(w) && (w.__prompts || 0) === promptsAntes);

  await w.vincularContainerANavio('CHEIO-0', { navioImo: 'IMO6000006' });
  await aguardar(150);
  check('agente com IMO inexistente é recusado', ultimo(w).titulo === 'Navio Não Encontrado', JSON.stringify(ultimo(w)));

  await w.vincularContainerANavio('CHEIO-1', { navioImo: 'IMO6000004' });
  await aguardar(150);
  check('agente com navio não operante é recusado', ultimo(w).titulo === 'Navio Fora do Porto' && /operante/.test(ultimo(w).msg || ''), JSON.stringify(ultimo(w)));

  log('\n7. Sem navio cadastrado o sistema informa (não abre seleção vazia)');
  const banco2 = bancoBase();
  banco2.tabelas.navios = [];
  const { w: w2 } = await carregar(banco2);
  w2.vincularContainerANavio('MSCU1234567');
  await aguardar(150);
  check('vínculo não abre sem navios cadastrados', !modalAberto(w2));
  check('usuário é informado de que não há navio', ultimo(w2).titulo === 'Navios Indisponíveis', JSON.stringify(ultimo(w2)));

  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações do vínculo contêiner ➜ navio passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
