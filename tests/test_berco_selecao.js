#!/usr/bin/env node
/**
 * Regressão: vincular navio a berço por SELEÇÃO (sem digitação manual).
 *
 * Usa a página real embarcacoes.html e js/pages/embarcacoes.js em jsdom, com um
 * cliente Supabase simulado (tabelas `bercos` e `navios`):
 *   - o seletor lista os berços do banco; ocupados aparecem desabilitados;
 *   - um berço já ocupado (mesmo forçado na interface) não é gravado;
 *   - a disponibilidade é revalidada no banco antes de confirmar (concorrência);
 *   - sem berço livre, o sistema informa e não abre a vinculação;
 *   - a ocupação escolhida é gravada em public.bercos (upsert).
 *
 * Executar: node tests/test_berco_selecao.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const UUID_NAVIO = '11111111-2222-3333-4444-555555555555';

const { criarBancoFalso } = require('./fake-supabase-db');
// Estado "persistido" simulado (tabelas bercos e navios)
const banco = criarBancoFalso({
  bercos: [
    { id: 'BERCO-01', nome: 'Berço 01', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null },
    { id: 'BERCO-02', nome: 'Berço 02', estado: 'OCUPADO', navio_nome: 'Navio Outro', navio_imo: 'IMO1111111', navio_id: null },
    { id: 'BERCO-03', nome: 'Berço 03', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null }
  ],
  navios: [
    { id: UUID_NAVIO, nome: 'Navio Teste', numero_imo: 'IMO9999999', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' },
    { id: '33333333-4444-5555-6666-777777777777', nome: 'Navio Outro', numero_imo: 'IMO1111111', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' },
    { id: '22222222-3333-4444-5555-666666666666', nome: 'Navio B', numero_imo: 'IMO8888888', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã' }
  ]
});
const bancoBercos = banco.tabelas.bercos;
const clienteSimulado = banco;

async function carregar() {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = clienteSimulado;
        win.NexusRepository = {
          getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => clienteSimulado, notifyChange() {}, invalidarLeiturasCargas() {}
        };
        win.mostrarFeedback = (tipo, titulo, msg) => { w.__feedbacks = (w.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.nexusConfirm = async () => true;
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
      },
      'js/pages/embarcacoes.js'
    ]
  });
  w = janela.w;
  await prontoDom(w);
  await aguardar(300);
  return { janela, w };
}

const modalAberto = (w) => !w.document.getElementById('vincularBercoModal').classList.contains('hidden');

async function main() {
  const { janela, w } = await carregar();

  log('\n1. Seletor de berços: lista do banco, ocupados desabilitados');
  w.vincularNavioABerco('IMO9999999');
  await aguardar(250);
  check('modal de seleção abre (sem prompt de digitação)', modalAberto(w));
  const fonteEmb = require('fs').readFileSync(require('path').join(__dirname, '..', 'js/pages/embarcacoes.js'), 'utf8');
  const trechoVinc = fonteEmb.slice(fonteEmb.indexOf('window.vincularNavioABerco = async'), fonteEmb.indexOf('async function aplicarVinculoBerco'));
  check('vincularNavioABerco não usa mais digitação (nexusPrompt)', !/nexusPrompt/.test(trechoVinc));
  const sel = w.document.getElementById('vincularBercoSelect');
  const opcoes = Array.from(sel.options).filter(o => o.value);
  const b02 = opcoes.find(o => o.value === 'Berço 02');
  const b01 = opcoes.find(o => o.value === 'Berço 01');
  check('berço ocupado (Berço 02) aparece desabilitado', Boolean(b02) && b02.disabled === true);
  check('berço livre (Berço 01) está habilitado', Boolean(b01) && b01.disabled === false);
  check('opção mostra o navio ocupante', Boolean(b02) && /Navio Outro/.test(b02.textContent));

  log('\n2. Seleção forçada de berço ocupado é recusada');
  const forcada = w.document.createElement('option');
  forcada.value = 'Berço 02'; forcada.textContent = 'Berço 02 (forçado)';
  sel.appendChild(forcada); sel.value = 'Berço 02';
  w.document.getElementById('confirmarVincularBercoBtn').click();
  await aguardar(250);
  check('berço ocupado NÃO é alterado pelo navio tentado', bancoBercos[1].navio_imo === 'IMO1111111' && bancoBercos[1].estado === 'OCUPADO');
  check('usuário é informado da indisponibilidade', (w.__feedbacks || []).some(f => /Indispon|não está mais livre/i.test(f.titulo + f.msg)));

  log('\n3. Escolha de berço livre grava a ocupação no Supabase');
  sel.value = 'Berço 01';
  w.document.getElementById('confirmarVincularBercoBtn').click();
  await aguardar(300);
  check('modal fecha após vincular', !modalAberto(w));
  check('banco: Berço 01 ficou OCUPADO pelo navio', bancoBercos[0].estado === 'OCUPADO' && bancoBercos[0].navio_imo === 'IMO9999999' && bancoBercos[0].navio_nome === 'Navio Teste', JSON.stringify(bancoBercos[0]));
  check('cache local reflete a ocupação', JSON.parse(w.localStorage.getItem('nexus_bercos_list')).find(b => b.nome === 'Berço 01').estado === 'OCUPADO');

  log('\n4. Concorrência: berço ocupado por outro usuário após abrir a seleção');
  w.vincularNavioABerco('IMO8888888');
  await aguardar(250);
  check('segundo navio abre a seleção com Berço 03 livre', modalAberto(w));
  bancoBercos[2].estado = 'OCUPADO'; bancoBercos[2].navio_nome = 'Navio Concorrente'; bancoBercos[2].navio_imo = 'IMO7777777';
  const sel2 = w.document.getElementById('vincularBercoSelect');
  sel2.value = 'Berço 03';
  const antes = JSON.stringify(bancoBercos[2]);
  w.document.getElementById('confirmarVincularBercoBtn').click();
  await aguardar(300);
  check('vinculação é recusada quando o berço foi ocupado no banco', JSON.stringify(bancoBercos[2]) === antes && bancoBercos[2].navio_imo === 'IMO7777777' && modalAberto(w));

  log('\n5. Sem berço livre: informa e não abre a vinculação');
  bancoBercos.forEach(b => { b.estado = 'OCUPADO'; b.navio_nome = b.navio_nome || 'X'; b.navio_imo = b.navio_imo || 'IMO0'; });
  w.document.getElementById('cancelarVincularBercoBtn').click();
  w.vincularNavioABerco('IMO8888888');
  await aguardar(250);
  check('sem berços livres o modal não abre', !modalAberto(w));
  check('usuário é informado de que não há berço livre', (w.__feedbacks || []).some(f => /Indispon/i.test(f.titulo)));

  janela.w.close();
  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
