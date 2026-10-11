#!/usr/bin/env node
/**
 * Regressão: equipamentos em manutenção não podem ser usados em novas tarefas.
 *
 * Valida a página real cargas.html (módulo js/pages/cargas.js) em jsdom, com um cliente
 * Supabase simulado cuja tabela `guindastes` é a fonte de verdade:
 *   - o seletor de guindastes da movimentação lista apenas equipamentos OPERANTES;
 *   - o guindaste em manutenção aparece no aviso informativo, nunca como opção;
 *   - uma opção forçada na interface (cache/DOM desatualizado) é recusada pela checagem no banco;
 *   - após a liberação no banco, o guindaste volta a ficar disponível.
 *
 * Executar: node tests/test_equipamentos_manutencao.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const CARGA_ID = 'CRG-TESTE-1';

// Estado "persistido" simulado (tabela guindastes do Supabase).
const bancoGuindastes = [
  { id: 'g-1', numero_identificacao: 'GND-01-STS', estado: 'EM_MANUTENCAO', data_ultima_manutencao: null },
  { id: 'g-2', numero_identificacao: 'GND-02-STS', estado: 'OPERANTE', data_ultima_manutencao: null }
];

function consultaSimulada(tabela) {
  const resultado = () => {
    if (tabela === 'guindastes') return { data: bancoGuindastes.map(g => Object.assign({}, g)), error: null };
    return { data: [], error: null };
  };
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    ilike() { return builder; },
    or() { return builder; },
    order() { return builder; },
    insert() { return builder; },
    update() { return builder; },
    delete() { return builder; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res, rej) { return Promise.resolve(resultado()).then(res, rej); }
  };
  return builder;
}

const clienteSimulado = { from: (tabela) => consultaSimulada(tabela) };

function cargaPagina() {
  return {
    id: CARGA_ID, tipo: 'Carga Geral', natureza: 'Carga Geral', peso: '10 t', volume: '20 m³',
    valor: 'R$ 100,00', portoDescarga: 'Pátio STS-01 (Setor B)', destino: 'Porto de Santos',
    status: 'AGENDAMENTO', container: '', navio: '', navioId: null, qrCode: 'QR-CRG-TESTE-1',
    rawDbId: '11111111-1111-4111-8111-111111111111'
  };
}

async function carregar() {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: [cargaPagina()],
      nexus_guindastes_list: [
        { id: 'GND-01-STS', identificacao: 'GND-01-STS', estado: 'OPERANTE' },
        { id: 'GND-02-STS', identificacao: 'GND-02-STS', estado: 'OPERANTE' }
      ],
      nexus_navios_list: [],
      nexus_containers_list: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.NexusRepository = {
          getCargas: async () => [cargaPagina()],
          getNavios: async () => [],
          getFuncionarios: async () => [],
          invalidarLeiturasCargas() {},
          notifyChange() {},
          getSupabase: () => clienteSimulado
        };
        win.nexusSupabase = clienteSimulado;
      },
      'js/pages/tipos-carga.js',
      'js/vision-layer.js',
      'js/layout.js',
      'js/padronizacao-codigos.js',
      'js/pages/cargas.js'
    ]
  });
  w = janela.w;
  await prontoDom(w);
  await aguardar(250);
  return { janela, w };
}

function opcoesGuindaste(w) {
  const sel = w.document.getElementById('movimentarGuindasteSelect');
  return Array.from(sel.options).map(o => o.value).filter(v => v);
}

function tarefasCriadas(w) {
  return JSON.parse(w.localStorage.getItem('nexus_guindaste_tarefas') || '[]').filter(t => t.cargaId === CARGA_ID);
}

async function main() {
  log('\n1. Seletor de movimentação usa o estado persistido do Supabase');
  const { janela, w } = await carregar();
  w.abrirModalMovimentacao(CARGA_ID);
  await aguardar(200);
  let ops = opcoesGuindaste(w);
  check('guindaste em manutenção NÃO aparece como opção', !ops.includes('GND-01-STS'), `opções=${ops.join(',')}`);
  check('guindaste operante aparece como opção', ops.includes('GND-02-STS'), `opções=${ops.join(',')}`);
  const aviso = w.document.getElementById('movimentarGuindasteAviso').textContent || '';
  check('aviso informativo identifica o guindaste indisponível', /GND-01-STS/.test(aviso) && /EM_MANUTENCAO/.test(aviso), aviso);

  log('\n2. Interface desatualizada não contorna a indisponibilidade');
  const sel = w.document.getElementById('movimentarGuindasteSelect');
  const setor = w.document.getElementById('movimentarSetorSelect');
  setor.value = 'Pátio Principal (Setor A)';
  const forcada = w.document.createElement('option');
  forcada.value = 'GND-01-STS';
  forcada.textContent = 'GND-01-STS (forçada)';
  sel.appendChild(forcada);
  sel.value = 'GND-01-STS';
  w.document.getElementById('confirmMovimentarModalBtn').click();
  await aguardar(250);
  check('tarefa NÃO é criada para guindaste em manutenção', tarefasCriadas(w).length === 0,
    `tarefas=${tarefasCriadas(w).length}`);

  // Controle positivo: o mesmo fluxo com guindaste OPERANTE cria a tarefa (prova que o caminho é válido).
  sel.value = 'GND-02-STS';
  w.document.getElementById('confirmMovimentarModalBtn').click();
  await aguardar(250);
  check('controle: guindaste OPERANTE cria a tarefa normalmente', tarefasCriadas(w).length === 1 && tarefasCriadas(w)[0].guindasteId === 'GND-02-STS',
    `tarefas=${JSON.stringify(tarefasCriadas(w).map(t => t.guindasteId))}`);
  w.localStorage.setItem('nexus_guindaste_tarefas', '[]');

  log('\n3. Após liberação no banco, o guindaste volta a ficar disponível');
  bancoGuindastes[0].estado = 'OPERANTE';
  w.abrirModalMovimentacao(CARGA_ID);
  await aguardar(200);
  ops = opcoesGuindaste(w);
  check('guindaste liberado volta a aparecer como opção', ops.includes('GND-01-STS'), `opções=${ops.join(',')}`);
  const avisoLiberado = w.document.getElementById('movimentarGuindasteAviso').textContent || '';
  check('aviso não lista mais equipamentos indisponíveis', !/GND-01-STS/.test(avisoLiberado), avisoLiberado);

  janela.w.close();
  const r = resumo();
  process.exit(r.falhas > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
