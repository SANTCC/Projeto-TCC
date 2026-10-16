#!/usr/bin/env node
/**
 * Regressão — Tarefa 7 (Correções): cores dos gráficos padronizadas POR
 * STATUS/CHAVE em todos os perfis (Relatórios & PDF).
 *
 * Causa raiz corrigida: navios_localizacao, containers_estado e
 * manutencoes_status usavam arrays/ternários POSICIONAIS sobre a saída de
 * ordenarMapa (ordenada por quantidade decrescente). Como cada perfil vê
 * subconjuntos diferentes dos dados (RLS por cargo), a MESMA chave podia
 * receber cores diferentes conforme a posição na ordenação (ex.: Conferente
 * de Cargas × Diretor de Operações). Agora as cores vêm de mapas por chave
 * em CORES (localizacaoNavio/estadoContainer/statusManutencao), com os
 * valores canônicos de SPECs/design/design.md §3.2/§4.2/§4.3/§4.4.
 *
 * Cenários:
 *  S1. navios_localizacao: cada localização tem SEMPRE a cor canônica, em
 *      três "perfis" (subconjuntos/ordenações diferentes dos dados).
 *  S2. containers_estado: cada estado tem SEMPRE a cor canônica, idem.
 *  S3. manutencoes_status: cada status de OS tem SEMPRE a cor canônica, idem.
 *  S4. CORES.status (fluxo de cargas) permanece inalterado (fonte única já
 *      coberta por test_backlog2_tarefa8) e cargas_fluxo segue chaveado.
 *  S5. Estático: os arrays posicionais antigos não existem mais no fonte.
 *
 * Executar: node tests/test_cores_graficos_por_perfil.js
 */
const H = require('./webmcp-harness');
const { read, log, check, resumo, criarJanela } = H;

// Valores canônicos — SPECs/design/design.md §3.2/§4.2/§4.3/§4.4
const CANON_LOCAL = {
  DENTRO_DO_PORTO: '#2E7D32',
  FORA_DO_PORTO: '#445987',
  NO_PORTO_DE_DESTINO: '#1B5E20'
};
const CANON_ESTADO = {
  OPERANTE: '#2E7D32',
  APROVADO_PARA_REFORMA: '#445987',
  AGENDADO_PARA_REFORMA: '#D97706',
  EM_REFORMA: '#B45309'
};
const CANON_OS = {
  SOLICITADA: '#D97706',
  APROVADA: '#D97706',
  EM_MANUTENCAO: '#D97706',
  CONCLUIDA: '#2E7D32',
  RECUSADA: '#C62828'
};
const ROTULO_LOCAL = { DENTRO_DO_PORTO: 'Dentro do Porto', FORA_DO_PORTO: 'Fora do Porto', NO_PORTO_DE_DESTINO: 'No Porto de Destino' };
const ROTULO_ESTADO = { OPERANTE: 'Operante', AGENDADO_PARA_REFORMA: 'Agendado p/ Reforma', EM_REFORMA: 'Em Reforma', APROVADO_PARA_REFORMA: 'Aprovado p/ Reforma' };
const ROTULO_OS = { SOLICITADA: 'Solicitada', APROVADA: 'Aprovada', EM_MANUTENCAO: 'Em Manutenção', CONCLUIDA: 'Concluída', RECUSADA: 'Recusada' };

const base = () => ({
  cargas: [], navios: [], containers: [], manutencoes: [], bercos: [],
  funcionarios: [], visitantes: [], logs: [], trail: []
});

/** rótulo → cor do primeiro dataset (padrão dos testes de gráfico do repo). */
function corPorRotulo(spec) {
  const mapa = {};
  if (!spec) return mapa;
  const cores = (spec.datasets && spec.datasets[0] && spec.datasets[0].backgroundColor) || [];
  const lista = Array.isArray(cores) ? cores : (spec.labels || []).map(() => cores);
  (spec.labels || []).forEach((rotulo, i) => { mapa[rotulo] = lista[i]; });
  return mapa;
}

function conferir(codigo, titulo, spec, canon, rotulos, chavesEsperadas) {
  const mapa = corPorRotulo(spec);
  chavesEsperadas.forEach((chave) => {
    check(`${codigo}: ${titulo} → "${rotulos[chave]}" tem a cor canônica ${canon[chave]} (fonte única por chave)`,
      mapa[rotulos[chave]] === canon[chave], `${rotulos[chave]}=${mapa[rotulos[chave]]}`);
  });
}

async function main() {
  log('\n[Tarefa 7] Cores dos gráficos por status — padrão único em todos os perfis\n');

  // ---------- S5: estático — arrays posicionais removidos --------------------
  log('S5. Fonte não contém mais as paletas posicionais divergentes');
  const fonte = read('js/pages/charts.js');
  check('S5: array posicional antigo de navios_localizacao removido',
    !fonte.includes("['#445987', '#0D9488', '#D97706', '#64748B']"));
  check('S5: array posicional antigo de containers_estado removido',
    !fonte.includes("['#445987', '#D97706', '#C62828', '#7E57C2', '#64748B']"));
  check('S5: ternário inline de manutencoes_status substituído pelo mapa CORES.statusManutencao',
    !/status === 'RECUSADA' \? '#C62828'/.test(fonte) && fonte.includes('statusManutencao'));
  check('S5: mapas por chave presentes em CORES (localizacaoNavio/estadoContainer/statusManutencao)',
    fonte.includes('localizacaoNavio:') && fonte.includes('estadoContainer:') && fonte.includes('statusManutencao:'));

  const janela = criarJanela({ url: 'https://nexusport.test/relatorios.html', scripts: ['js/pages/charts.js'] });
  const w = janela.w;

  // ---------- S1: navios_localizacao em 3 "perfis" ---------------------------
  log('\nS1. navios_localizacao: mesma cor por localização em qualquer perfil/subconjunto');
  const navio = (localizacao, n) => Array.from({ length: n }, (_, i) => ({ id: `NAV-${localizacao}-${i}`, nome: `Navio ${i}`, localizacao }));
  // Perfil A (Diretor): frota completa com DENTRO majoritário; Perfil B
  // (Conferente/Inspetor): subconjunto onde FORA_DO_PORTO domina a ordenação;
  // Perfil C: só uma localização presente (caso extremo de subconjunto).
  const perfisNavios = [
    ['perfil A (DENTRO majoritário)', [...navio('DENTRO_DO_PORTO', 5), ...navio('FORA_DO_PORTO', 2), ...navio('NO_PORTO_DE_DESTINO', 1)],
      ['DENTRO_DO_PORTO', 'FORA_DO_PORTO', 'NO_PORTO_DE_DESTINO']],
    ['perfil B (FORA majoritário)', [...navio('FORA_DO_PORTO', 6), ...navio('NO_PORTO_DE_DESTINO', 3), ...navio('DENTRO_DO_PORTO', 1)],
      ['DENTRO_DO_PORTO', 'FORA_DO_PORTO', 'NO_PORTO_DE_DESTINO']],
    ['perfil C (somente NO_PORTO_DE_DESTINO)', navio('NO_PORTO_DE_DESTINO', 2), ['NO_PORTO_DE_DESTINO']]
  ];
  perfisNavios.forEach(([titulo, navios, chaves]) => {
    const dados = base(); dados.navios = navios;
    conferir('S1', titulo, w.NexusCharts.construir('navios_localizacao', dados, {}), CANON_LOCAL, ROTULO_LOCAL, chaves);
  });

  // ---------- S2: containers_estado em 3 "perfis" ----------------------------
  log('\nS2. containers_estado: mesma cor por estado em qualquer perfil/subconjunto');
  const cont = (estado, n) => Array.from({ length: n }, (_, i) => ({ identificacao: `CONT-${estado}-${i}`, estado }));
  const perfisContainers = [
    ['perfil A (OPERANTE majoritário)', [...cont('OPERANTE', 8), ...cont('AGENDADO_PARA_REFORMA', 3), ...cont('EM_REFORMA', 2), ...cont('APROVADO_PARA_REFORMA', 1)],
      ['OPERANTE', 'AGENDADO_PARA_REFORMA', 'EM_REFORMA', 'APROVADO_PARA_REFORMA']],
    ['perfil B (EM_REFORMA majoritário)', [...cont('EM_REFORMA', 7), ...cont('APROVADO_PARA_REFORMA', 4), ...cont('OPERANTE', 1)],
      ['OPERANTE', 'EM_REFORMA', 'APROVADO_PARA_REFORMA']],
    ['perfil C (somente AGENDADO_PARA_REFORMA)', cont('AGENDADO_PARA_REFORMA', 3), ['AGENDADO_PARA_REFORMA']]
  ];
  perfisContainers.forEach(([titulo, containers, chaves]) => {
    const dados = base(); dados.containers = containers;
    conferir('S2', titulo, w.NexusCharts.construir('containers_estado', dados, {}), CANON_ESTADO, ROTULO_ESTADO, chaves);
  });

  // ---------- S3: manutencoes_status em 3 "perfis" ---------------------------
  log('\nS3. manutencoes_status: mesma cor por status de OS em qualquer perfil/subconjunto');
  const os = (status, n) => Array.from({ length: n }, (_, i) => ({ id: `OS-${status}-${i}`, status }));
  const perfisOs = [
    ['perfil A (CONCLUIDA majoritária)', [...os('CONCLUIDA', 9), ...os('SOLICITADA', 4), ...os('RECUSADA', 2), ...os('APROVADA', 1)],
      ['SOLICITADA', 'APROVADA', 'CONCLUIDA', 'RECUSADA']],
    ['perfil B (RECUSADA majoritária)', [...os('RECUSADA', 5), ...os('EM_MANUTENCAO', 3), ...os('SOLICITADA', 1)],
      ['SOLICITADA', 'EM_MANUTENCAO', 'RECUSADA']],
    ['perfil C (somente SOLICITADA)', os('SOLICITADA', 2), ['SOLICITADA']]
  ];
  perfisOs.forEach(([titulo, manutencoes, chaves]) => {
    const dados = base(); dados.manutencoes = manutencoes;
    conferir('S3', titulo, w.NexusCharts.construir('manutencoes_status', dados, {}), CANON_OS, ROTULO_OS, chaves);
  });

  // ---------- S4: CORES.status do fluxo de cargas intacto --------------------
  log('\nS4. Paleta do fluxo de cargas (CORES.status) permanece inalterada');
  const blocoStatus = (fonte.match(/status:\s*\{([\s\S]*?)\}/) || [])[1] || '';
  const esperados = {
    AGENDAMENTO: '#D97706', RECEBIMENTO_INSPECAO: '#6366F1', ARMAZENAGEM: '#445987',
    PRONTA_PARA_ENTREGA: '#059669', EM_TRANSITO: '#0D9488', ENTREGUE: '#2E7D32',
    RECUSADA: '#C62828', CANCELADA: '#7E57C2'
  };
  Object.entries(esperados).forEach(([status, cor]) => {
    check(`S4: CORES.status.${status} continua ${cor}`, blocoStatus.includes(`${status}: '${cor}'`));
  });
  const dadosFluxo = base();
  dadosFluxo.cargas = [
    { id: 'CRG-1', status: 'ENTREGUE' }, { id: 'CRG-2', status: 'ENTREGUE' },
    { id: 'CRG-3', status: 'AGENDAMENTO' }
  ];
  const specFluxo = w.NexusCharts.construir('cargas_fluxo', dadosFluxo, {});
  conferir('S4', 'cargas_fluxo (ENTREGUE majoritário)', specFluxo,
    { ENTREGUE: '#2E7D32', AGENDAMENTO: '#D97706' },
    { ENTREGUE: 'Entregue', AGENDAMENTO: 'Agendamento' }, ['ENTREGUE', 'AGENDAMENTO']);

  janela.dom.window.close();

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Tarefa 7 (cores dos gráficos padronizadas por status em todos os perfis) verificada com sucesso!');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
