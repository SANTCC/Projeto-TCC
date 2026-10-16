#!/usr/bin/env node
/**
 * Regressão — Tarefa 8 (Backlog Parte 2): verde padronizado para "Entregue"
 * nos gráficos de fluxo, para todos os perfis.
 *
 * A paleta de status é única (CORES.status em js/pages/charts.js) e segue o
 * design system do repo (Specs/design/design.md §3.2/§4.1): ENTREGUE é o verde
 * "success" #2E7D32 — nunca cinza. PRONTA_PARA_ENTREGA usa o tom emerald
 * #059669 (o mesmo das tabelas) para os dois status não se confundirem.
 *
 * Executar: node tests/test_backlog2_tarefa8_cor_entregue_grafico.js
 */
const H = require('./webmcp-harness');
const { read, log, check, resumo, criarJanela } = H;

const VERDE_ENTREGUE = '#2E7D32';
const EMERALD_PRONTA = '#059669';
const CINZA_ANTIGO = '#64748B';

function dadosComTodosStatus() {
  const statuses = [
    'AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA',
    'EM_TRANSITO', 'ENTREGUE', 'RECUSADA', 'CANCELADA'
  ];
  return {
    cargas: statuses.map((status, i) => ({ id: `CRG-COR-${i + 1}`, status, tipo: 'Carga Geral' })),
    navios: [], containers: [], manutencoes: [], bercos: [],
    funcionarios: [], visitantes: [], logs: [], trail: []
  };
}

function corPorRotulo(spec) {
  const mapa = {};
  if (!spec) return mapa;
  const cores = (spec.datasets && spec.datasets[0] && spec.datasets[0].backgroundColor) || [];
  (spec.labels || []).forEach((rotulo, i) => { mapa[rotulo] = cores[i]; });
  return mapa;
}

async function main() {
  const janelas = [];
  try {
    const fonte = read('js/pages/charts.js');
    const blocoStatus = (fonte.match(/status:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    check('paleta única: ENTREGUE usa o verde success #2E7D32',
      blocoStatus.includes(`ENTREGUE: '${VERDE_ENTREGUE}'`), blocoStatus.trim().slice(0, 200));
    check('paleta única: ENTREGUE não usa mais o cinza #64748B',
      !blocoStatus.includes(`ENTREGUE: '${CINZA_ANTIGO}'`));

    const janela = criarJanela({
      url: 'https://nexusport.test/relatorios.html',
      scripts: ['js/pages/charts.js']
    });
    janelas.push(janela);
    const w = janela.w;
    const dados = dadosComTodosStatus();

    log('\n1. Gráficos de fluxo: Entregue verde em todos os construtores');
    const esperado = {
      Agendamento: '#D97706',
      'Recebimento/Inspeção': '#6366F1',
      Armazenagem: '#445987',
      'Pronta p/ Entrega': EMERALD_PRONTA,
      'Em Trânsito': '#0D9488',
      Entregue: VERDE_ENTREGUE,
      Recusada: '#C62828',
      Cancelada: '#7E57C2'
    };
    for (const id of ['cargas_fluxo', 'minhas_cargas_status', 'fila_liberacao']) {
      const spec = w.NexusCharts.construir(id, dados, {});
      const cores = corPorRotulo(spec);
      check(`${id}: barra/fatia "Entregue" está verde (${VERDE_ENTREGUE})`,
        cores.Entregue === VERDE_ENTREGUE, JSON.stringify(cores));
      check(`${id}: nenhuma cor de status usa o cinza antigo`,
        !Object.values(cores).includes(CINZA_ANTIGO), JSON.stringify(cores));
      check(`${id}: demais status mantêm as cores de sempre`,
        Object.entries(esperado).every(([rotulo, cor]) => cores[rotulo] === cor),
        JSON.stringify(cores));
    }

    log('\n2. Mesma cor para qualquer perfil (conferente × diretor)');
    const perfis = ['CONFERENTE_CARGA', 'DIRETOR_OPERACOES_LOGISTICA', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR'];
    const mapas = perfis.map((cargo) => corPorRotulo(w.NexusCharts.construir('cargas_fluxo', dadosComTodosStatus(), { cargo })));
    check('cargas_fluxo: mapa rótulo→cor idêntico entre perfis',
      mapas.every((m) => JSON.stringify(m) === JSON.stringify(mapas[0])),
      JSON.stringify(mapas));
    check('cargas_fluxo: Entregue verde para conferente E para diretor',
      mapas[0].Entregue === VERDE_ENTREGUE && mapas[1].Entregue === VERDE_ENTREGUE,
      JSON.stringify(mapas.map((m) => m.Entregue)));
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach((j) => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
}

main();
