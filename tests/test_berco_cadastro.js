#!/usr/bin/env node
/**
 * Regressão: berço no CADASTRO de navio DENTRO_DO_PORTO (js/pages/embarcacoes.js).
 *
 * Usa a página real embarcacoes.html em jsdom e um banco Supabase simulado:
 *   - o seletor de berço lista somente berços LIVRES do banco (cache local desatualizado não conta);
 *   - cadastro com berço escolhido grava o navio e ocupa o berço no banco;
 *   - berço que ficou ocupado depois de aberto o formulário é recusado antes de gravar;
 *   - falha ao ocupar o berço desfaz o cadastro do navio (nenhum navio sem berço);
 *   - sem berços livres, o cadastro é impedido com aviso.
 *
 * Executar: node tests/test_berco_cadastro.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const IMO_NOVO = 'IMO-9123456';

// Navios das tabelas: um berço OCUPADO precisa ter o navio correspondente no banco
// (berço cujo navio não existe é órfão e a página o libera).
const NAVIOS_PADRAO = [
  { id: 'nav-teste', nome: 'Navio Teste', numero_imo: 'IMO-9999999', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' }
];

function bancoInicial(bercos, opcoes, navios) {
  return bancoComoSupabase(criarBancoFalso({
    bercos: bercos || [
      { id: 'BERCO-01', nome: 'Berço 01', estado: 'OCUPADO', navio_nome: 'Navio Teste', navio_imo: 'IMO-9999999', navio_id: null },
      { id: 'BERCO-02', nome: 'Berço 02', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null },
      { id: 'BERCO-03', nome: 'Berço 03', estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null }
    ],
    navios: navios || NAVIOS_PADRAO.map(n => Object.assign({}, n)),
    rotas_maritimas: [{ origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 }]
  }, opcoes));
}

// Ajustes do dublê usados só neste teste (o compartilhado não é alterado):
//  - maybeSingle() devolve a primeira linha ou null, como o Supabase real;
//  - insert em navios devolve o id gerado (insert().select('id').single()).
function bancoComoSupabase(banco) {
  const original = banco.from;
  banco.from = (tabela) => {
    const b = original(tabela);
    b.maybeSingle = () => {
      const thenAnterior = b.then;
      b.then = (res, rej) => thenAnterior((r) => res(r && Array.isArray(r.data)
        ? { data: r.data[0] || null, error: r.error }
        : r), rej);
      return b;
    };
    if (tabela === 'navios') {
      const insertOrig = b.insert;
      let idGerado = null;
      b.insert = (p) => {
        idGerado = 'nav-' + Math.random().toString(36).slice(2, 8);
        return insertOrig(Object.assign({ id: idGerado }, p));
      };
      const thenInsert = b.then;
      b.then = (res, rej) => thenInsert((r) => res(r && r.error ? r : (idGerado ? { data: { id: idGerado }, error: null } : r)), rej);
    }
    return b;
  };
  return banco;
}

async function carregar(banco, storage) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('INSPETOR'),
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
  await prontoDom(w);
  await aguardar(400);
  return { janela, w };
}

function opcoesBerco(w) {
  return Array.from(w.document.getElementById('navioBercoSelect').options).map(o => o.value);
}

async function escolherLocalizacao(w, valor) {
  const loc = w.document.getElementById('navioLocalizacao');
  loc.value = valor;
  loc.dispatchEvent(new w.Event('change'));
  await aguardar(300);
}

async function enviarCadastro(w, { nome, imo, berco }) {
  w.document.getElementById('navioNome').value = nome;
  w.document.getElementById('navioImo').value = imo;
  w.document.getElementById('navioRotaSelect').value = '0';
  if (berco !== undefined) w.document.getElementById('navioBercoSelect').value = berco;
  w.document.getElementById('navioForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await aguardar(400);
}

function feedbacks(w) { return w.__feedbacks || []; }

async function main() {
  log('\n1. Seletor do cadastro lista só berços livres do banco');
  {
    // Cache local diz que o Berço 01 está LIVRE, mas o banco diz OCUPADO: vale o banco.
    const banco = bancoInicial();
    const storage = { nexus_navios_list: [], nexus_containers_list: [], nexus_guindastes_list: [],
      nexus_bercos_list: [{ id: 'BERCO-01', nome: 'Berço 01', estado: 'LIVRE' }, { id: 'BERCO-02', nome: 'Berço 02', estado: 'OCUPADO' }] };
    const { janela, w } = await carregar(banco, storage);
    await escolherLocalizacao(w, 'DENTRO_DO_PORTO');
    const ops = opcoesBerco(w);
    check('Berço 01 (ocupado no banco) não aparece no seletor', !ops.includes('Berço 01'), ops.join(','));
    check('Berço 02 (livre no banco, ocupado no cache) aparece', ops.includes('Berço 02'), ops.join(','));
    check('Berço 03 (livre) aparece', ops.includes('Berço 03'), ops.join(','));
    janela.w.close();
  }

  log('\n2. Cadastro com berço livre grava o navio e ocupa o berço no banco');
  {
    const banco = bercoComoSupabaseOk();
    const { janela, w } = await carregar(banco);
    await escolherLocalizacao(w, 'DENTRO_DO_PORTO');
    await enviarCadastro(w, { nome: 'Navio Novo', imo: IMO_NOVO, berco: 'Berço 02' });
    const navio = (banco.tabelas.navios || []).find(n => n.numero_imo === IMO_NOVO);
    check('navio gravado no banco', !!navio, JSON.stringify(banco.tabelas.navios));
    const b2 = banco.tabelas.bercos.find(b => b.nome === 'Berço 02');
    check('Berço 02 OCUPADO no banco pelo navio cadastrado', b2 && b2.estado === 'OCUPADO' && b2.navio_imo === IMO_NOVO, JSON.stringify(b2));
    janela.w.close();
  }

  log('\n3. Berço que ficou ocupado depois de aberto o formulário é recusado antes de gravar');
  {
    const banco = bancoInicial();
    const { janela, w } = await carregar(banco);
    await escolherLocalizacao(w, 'DENTRO_DO_PORTO');
    // Outro operador ocupa o Berço 02 depois que o formulário foi preenchido.
    banco.tabelas.bercos[1].estado = 'OCUPADO';
    banco.tabelas.bercos[1].navio_imo = 'IMO-7777777';
    banco.tabelas.bercos[1].navio_nome = 'Outro Navio';
    banco.tabelas.navios.push({ id: 'nav-outro', nome: 'Outro Navio', numero_imo: 'IMO-7777777', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' });
    const sel = w.document.getElementById('navioBercoSelect');
    const forcada = w.document.createElement('option');
    forcada.value = 'Berço 02';
    forcada.textContent = 'Berço 02 (forçado)';
    sel.appendChild(forcada);
    await enviarCadastro(w, { nome: 'Navio Novo', imo: IMO_NOVO, berco: 'Berço 02' });
    check('navio NÃO é gravado quando o berço já foi ocupado', !(banco.tabelas.navios || []).some(n => n.numero_imo === IMO_NOVO), JSON.stringify(banco.tabelas.navios));
    check('berço ocupado por outro navio permanece com o outro navio', banco.tabelas.bercos[1].navio_imo === 'IMO-7777777');
    const fb = feedbacks(w).pop() || {};
    check('usuário é avisado do berço indisponível', /Berço 02/.test(fb.msg || ''), JSON.stringify(fb));
    janela.w.close();
  }

  log('\n4. Falha ao ocupar o berço desfaz o cadastro do navio');
  {
    const opts = {};
    const banco = bancoComoSupabase(bancoInicial(null, opts));
    opts.falharOp = { bercos: ['update'] };
    const { janela, w } = await carregar(banco);
    await escolherLocalizacao(w, 'DENTRO_DO_PORTO');
    await enviarCadastro(w, { nome: 'Navio Novo', imo: IMO_NOVO, berco: 'Berço 02' });
    check('nenhum navio sem berço fica gravado após falha da reserva', !(banco.tabelas.navios || []).some(n => n.numero_imo === IMO_NOVO), JSON.stringify(banco.tabelas.navios));
    const fb = feedbacks(w).pop() || {};
    check('usuário é informado que o cadastro foi desfeito', fb.tipo === 'alerta' && /desfeito/.test(fb.msg || ''), JSON.stringify(fb));
    janela.w.close();
  }

  log('\n5. Sem berços livres: o cadastro é impedido e o seletor informa');
  {
    const bercos15 = Array.from({ length: 15 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return { id: `BERCO-${n}`, nome: `Berço ${n}`, estado: 'OCUPADO', navio_nome: `Navio ${n}`, navio_imo: `IMO-${n}000000`, navio_id: null };
    });
    const navios15 = bercos15.map(b => ({ id: `nav-${b.id}`, nome: b.navio_nome, numero_imo: b.navio_imo, localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' }));
    const banco = bancoInicial(bercos15, null, navios15);
    const { janela, w } = await carregar(banco);
    await escolherLocalizacao(w, 'DENTRO_DO_PORTO');
    const ops = opcoesBerco(w);
    check('seletor informa que não há berço livre', ops.length === 1 && /Nenhum berço livre/.test(w.document.getElementById('navioBercoSelect').textContent), ops.join(','));
    await enviarCadastro(w, { nome: 'Navio Novo', imo: IMO_NOVO, berco: '' });
    check('navio NÃO é cadastrado sem berço disponível', !(banco.tabelas.navios || []).some(n => n.numero_imo === IMO_NOVO));
    janela.w.close();
  }

  const r = resumo();
  process.exit(r.falhas > 0 ? 1 : 0);
}

function bercoComoSupabaseOk() {
  return bancoInicial();
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
