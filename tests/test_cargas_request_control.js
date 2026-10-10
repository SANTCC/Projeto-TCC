#!/usr/bin/env node
/**
 * Regressões do carregamento de cargas e da transição automática de status.
 *
 * Valida com os módulos reais carregados em jsdom:
 *   - single-flight lógico no repositório, sem cache após concluir;
 *   - fallback da consulta composta apenas para erros de schema do join opcional;
 *   - respostas antigas não sobrescrevem cache após uma invalidação;
 *   - mudanças de navio persistem o status uma vez, sem o render iniciar novo loop;
 *   - eventos relacionados são consolidados e eventos irrelevantes não consultam cargas;
 *   - uma falha não inicia retries imediatos e uma ação posterior pode tentar novamente.
 *
 * Executar: node tests/test_cargas_request_control.js
 */
const H = require('./webmcp-harness');
const { read, log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const CARGA_UUID = '11111111-1111-4111-8111-111111111111';
const NAVIO_UUID = '22222222-2222-4222-8222-222222222222';
const SELECAO_COMPOSTA = '*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))';

function linhaBanco(status) {
  return {
    id: CARGA_UUID,
    qr_code_url: 'QR-CRG-TESTE-1',
    natureza: 'Carga Geral',
    peso: 10,
    volume: 20,
    valor_declarado: 100,
    porto_descarga: 'Pátio STS-01',
    destino: 'Porto de Santos',
    status_fluxo: status,
    navio_id: NAVIO_UUID,
    container_id: null,
    navios: { id: NAVIO_UUID, nome: 'MV Teste' },
    estivador_cargas: [{
      estivador_id: '33333333-3333-4333-8333-333333333333',
      funcionarios: { nome: 'João Teste', matricula: 'MAT-1001' }
    }]
  };
}

function cargaDaPagina(status) {
  return {
    id: 'CRG-TESTE-1',
    tipo: 'Carga Geral',
    natureza: 'Carga Geral',
    peso: '10 t',
    volume: '20 m³',
    valor: 'R$ 100,00',
    portoDescarga: 'Pátio STS-01',
    destino: 'Porto de Santos',
    status,
    container: '',
    navio: 'MV Teste',
    navioId: NAVIO_UUID,
    qrCode: 'QR-CRG-TESTE-1',
    rawDbId: CARGA_UUID,
    estivador_id: '33333333-3333-4333-8333-333333333333',
    estivadorMatricula: 'MAT-1001',
    estivador: 'João Teste'
  };
}

function criarRepositorioJanela(client) {
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    native(w) {
      w.nexusSupabase = client;
      w.console.warn = () => {};
      w.console.error = () => {};
    },
    scripts: ['js/data-repository.js']
  });
  return janela;
}

async function aguardarCondicao(condicao, limiteMs = 1200) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await aguardar(10);
  }
  return Boolean(condicao());
}

async function testarSingleFlightEMapeamento() {
  log('\n1. Repositório: deduplicação, integridade dos relacionamentos e ausência de cache persistente');
  let leituras = 0;
  const client = {
    from(tabela) {
      return {
        select(selecao) {
          leituras += 1;
          return new Promise((resolve) => setTimeout(() => resolve({ data: [linhaBanco('AGENDAMENTO')], error: null }), 20));
        }
      };
    }
  };
  const { w } = criarRepositorioJanela(client);
  const [a, b, c] = await Promise.all([
    w.NexusRepository.getCargas(),
    w.NexusRepository.getCargas(),
    w.NexusRepository.getCargas()
  ]);
  check('3 chamadas simultâneas a getCargas fazem uma leitura do Supabase', leituras === 1, `leituras=${leituras}`);
  check('todos recebem uma lista; cada chamador recebe objetos próprios',
    Array.isArray(a) && Array.isArray(b) && Array.isArray(c) && a !== b && a[0] !== b[0]);
  check('a consulta mantém navio, estivador e dados do funcionário',
    a[0] && a[0].navio === 'MV Teste' && a[0].estivador === 'João Teste' && a[0].estivadorMatricula === 'MAT-1001');
  await w.NexusRepository.getCargas();
  check('uma nova chamada depois de concluída consulta o servidor (sem cache permanente)', leituras === 2, `leituras=${leituras}`);
  w.close();
}

async function testarFallbackLimitado() {
  log('\n2. Fallback: erro transitório não faz uma segunda consulta; erro de relacionamento permite fallback');
  let chamadasRede = 0;
  const redeFalha = {
    from() {
      return { select() { chamadasRede += 1; return Promise.resolve({ data: null, error: { code: 'FETCH_ERROR', message: 'TypeError: Failed to fetch' } }); } };
    }
  };
  const janelaRede = criarRepositorioJanela(redeFalha);
  await janelaRede.w.NexusRepository.getCargas();
  check('falha de rede na consulta composta não dispara fallback imediato', chamadasRede === 1, `chamadas=${chamadasRede}`);
  await janelaRede.w.NexusRepository.getCargas();
  check('após terminar uma falha, uma chamada futura pode tentar novamente', chamadasRede === 2, `chamadas=${chamadasRede}`);
  janelaRede.w.close();

  let chamadasJoin = 0;
  const erroJoin = {
    from() {
      return {
        select(selecao) {
          chamadasJoin += 1;
          if (selecao === SELECAO_COMPOSTA) {
            return Promise.resolve({
              data: null,
              error: {
                code: 'PGRST200',
                message: "Could not find a relationship between 'cargas' and 'estivador_cargas' in the schema cache"
              }
            });
          }
          return Promise.resolve({ data: [linhaBanco('AGENDAMENTO')], error: null });
        }
      };
    }
  };
  const janelaJoin = criarRepositorioJanela(erroJoin);
  const dados = await janelaJoin.w.NexusRepository.getCargas();
  check('erro comprovado do join opcional executa uma única consulta simples de fallback', chamadasJoin === 2, `chamadas=${chamadasJoin}`);
  check('fallback preserva carga e relação com navios', dados.length === 1 && dados[0].navio === 'MV Teste');
  janelaJoin.w.close();
}

async function testarRespostaObsoleta() {
  log('\n3. Concorrência: resposta antiga não substitui cache após evento de invalidação');
  const pendentes = [];
  const client = {
    from() {
      return {
        select() {
          return new Promise((resolve) => pendentes.push(resolve));
        }
      };
    }
  };
  const { w } = criarRepositorioJanela(client);
  w.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([{ id: 'CACHE-ANTIGO', status: 'ANTIGO' }]));

  const antiga = w.NexusRepository.getCargas();
  await aguardar(0);
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  const recente = w.NexusRepository.getCargas();
  const segundaConsultaIniciada = await aguardarCondicao(() => pendentes.length === 2);
  check('alteração durante leitura abre nova consulta sem esperar a resposta antiga', segundaConsultaIniciada, `consultas=${pendentes.length}`);

  pendentes[1]({ data: [linhaBanco('EM_TRANSITO')], error: null });
  await recente;
  pendentes[0]({ data: [linhaBanco('AGENDAMENTO')], error: null });
  await antiga;
  const cache = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  check('a resposta antiga não retrocede o cache após a leitura mais recente', cache[0] && cache[0].status === 'EM_TRANSITO', JSON.stringify(cache));
  w.close();
}

async function carregarPaginaCargas({ falharAtualizacao = false, deferirAtualizacao = false, statusDuranteGravacao = null, localizacaoNavio = 'NO_PORTO_DE_DESTINO', herdarNavioDoContainer = false } = {}) {
  const estado = {
    leituras: 0,
    atualizacoes: 0,
    invalidacoes: 0,
    notificacoes: 0,
    statusBanco: 'AGENDAMENTO',
    falharAtualizacao,
    deferirAtualizacao,
    statusDuranteGravacao,
    herdarNavioDoContainer,
    liberarAtualizacao: null
  };

  const repository = {
    async getCargas() {
      estado.leituras += 1;
      await aguardar(8);
      const carga = cargaDaPagina(estado.statusBanco);
      if (estado.herdarNavioDoContainer) {
        carga.container = 'CONT-TESTE-1';
        carga.navio = '';
        carga.navioId = null;
        carga.herdarNavioDoContainer = true;
      }
      return [carga];
    },
    async getFuncionarios() { return []; },
    invalidarLeiturasCargas() { estado.invalidacoes += 1; },
    notifyChange(entity) {
      estado.notificacoes += 1;
      this.ultimaNotificacao = entity;
      // Simula notifyChange real, que despacha o evento local sincronamente.
      w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity } }));
    }
  };

  const client = {
    from(tabela) {
      if (tabela === 'rotas_maritimas') {
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      if (tabela === 'cargas') {
        return {
          update(payload) {
            return {
              in(_coluna, ids) {
                let statusAnterior;
                return {
                  eq(coluna, valor) {
                    if (coluna === 'status_fluxo') statusAnterior = valor;
                    return this;
                  },
                  select: async () => {
                    estado.atualizacoes += 1;
                    if (estado.deferirAtualizacao) {
                      await new Promise((resolve) => { estado.liberarAtualizacao = resolve; });
                    }
                    await aguardar(8);
                    if (estado.falharAtualizacao) {
                      return { data: null, error: { code: 'NETWORK', message: 'falha simulada de rede' } };
                    }
                    if (estado.statusDuranteGravacao) {
                      estado.statusBanco = estado.statusDuranteGravacao;
                      estado.statusDuranteGravacao = null;
                    }
                    if (estado.statusBanco !== statusAnterior) return { data: [], error: null };
                    estado.statusBanco = payload.status_fluxo;
                    return { data: ids.map((id) => ({ id })), error: null };
                  }
                };
              }
            };
          }
        };
      }
      throw new Error(`Tabela inesperada no teste de cargas: ${tabela}`);
    }
  };

  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    html: htmlDaPagina('cargas.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {
      nexus_cargas_fluxo: [cargaDaPagina('AGENDAMENTO')],
      nexus_navios_list: [{ id: NAVIO_UUID, nome: 'MV Teste', localizacao: localizacaoNavio }],
      nexus_containers_list: herdarNavioDoContainer
        ? [{ identificacao: 'CONT-TESTE-1', navio: 'MV Teste', navio_id: NAVIO_UUID }]
        : [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.NexusRepository = repository;
        win.nexusSupabase = client;
      },
      'js/pages/tipos-carga.js',
      'js/vision-layer.js',
      'js/layout.js',
      'js/pages/cargas.js'
    ]
  });
  w = janela.w;
  await prontoDom(w);
  await aguardarCondicao(() => estado.leituras > 0 && estado.atualizacoes > 0);
  await aguardar(60);
  return { janela, w, estado };
}

async function testarCicloDeInterface() {
  log('\n4. Página real de cargas: transição automática não recursa por renderização');
  const { janela, w, estado } = await carregarPaginaCargas();
  const textoTabela = w.document.getElementById('cargasTableBody').textContent || '';
  check('carregamento inicial conclui uma leitura e uma atualização de status',
    estado.leituras === 1 && estado.atualizacoes === 1 && estado.statusBanco === 'ENTREGUE',
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}, status=${estado.statusBanco}`);
  check('listagem continua renderizada com status ENTREGUE', /ENTREGUE/.test(textoTabela), textoTabela.slice(0, 180));
  check('a transição automática não chama notifyChange localmente', estado.notificacoes === 0, `notificações=${estado.notificacoes}`);

  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'logs_alteracoes' } }));
  await aguardar(180);
  check('evento de auditoria não relê cargas', estado.leituras === 1, `leituras=${estado.leituras}`);

  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'navios' } }));
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  await aguardar(240);
  check('rajada de eventos relacionados é consolidada em uma nova leitura', estado.leituras === 2, `leituras=${estado.leituras}`);
  check('status persistido não é atualizado novamente nem cria novas leituras', estado.atualizacoes === 1 && estado.notificacoes === 0,
    `atualizações=${estado.atualizacoes}, notificações=${estado.notificacoes}`);
  janela.w.close();
}

async function testarTransicaoSaidaNavio() {
  log('\n5. Transição de saída: navio fora do porto move a carga para EM_TRANSITO');
  const { janela, w, estado } = await carregarPaginaCargas({ localizacaoNavio: 'FORA_DO_PORTO' });
  const textoTabela = w.document.getElementById('cargasTableBody').textContent || '';
  check('a liberação do navio persiste EM_TRANSITO e mantém a carga na listagem',
    estado.leituras === 1 && estado.atualizacoes === 1 && estado.statusBanco === 'EM_TRANSITO' && /EM_TRANSITO/.test(textoTabela),
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}, status=${estado.statusBanco}`);
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'navios' } }));
  await aguardar(220);
  check('status EM_TRANSITO já persistido não gera nova atualização automática',
    estado.leituras === 2 && estado.atualizacoes === 1,
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}`);
  janela.w.close();
}

async function testarTransicaoCargaComNavioHerdado() {
  log('\n6. Navio herdado: transição automática preservada para vínculo via contêiner');
  const { janela, w, estado } = await carregarPaginaCargas({ herdarNavioDoContainer: true });
  const textoTabela = w.document.getElementById('cargasTableBody').textContent || '';
  check('herança do contêiner resolve o navio antes de avaliar e persistir a transição',
    estado.leituras === 1 && estado.atualizacoes === 1 && estado.statusBanco === 'ENTREGUE',
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}, status=${estado.statusBanco}`);
  check('carga com navio herdado segue visível na listagem', /MV Teste/.test(textoTabela) && /ENTREGUE/.test(textoTabela), textoTabela.slice(0, 180));
  janela.w.close();
}

async function testarFalhaSemRetryInfinito() {
  log('\n7. Falha de rede: sem retry imediato; próxima sincronização pode recuperar');
  const { janela, w, estado } = await carregarPaginaCargas({ falharAtualizacao: true });
  await aguardar(180);
  check('falha de persistência não reinicia getCargas nem cria ciclo de requests',
    estado.leituras === 1 && estado.atualizacoes === 1,
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}`);

  estado.falharAtualizacao = false;
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  await aguardarCondicao(() => estado.atualizacoes >= 2);
  await aguardar(100);
  check('evento posterior permite nova tentativa e a sincronização se estabiliza',
    estado.leituras === 2 && estado.atualizacoes === 2 && estado.statusBanco === 'ENTREGUE',
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}, status=${estado.statusBanco}`);
  check('falha e recuperação não geram notifyChange recursivo', estado.notificacoes === 0, `notificações=${estado.notificacoes}`);
  janela.w.close();
}

async function testarConflitoDeStatusConcorrente() {
  log('\n8. Corrida de gravação: transição condicional preserva status terminal concorrente');
  const { janela, w, estado } = await carregarPaginaCargas({ statusDuranteGravacao: 'CANCELADA' });
  await aguardar(100);
  check('atualização condicional não sobrescreve CANCELADA com uma transição automática antiga',
    estado.statusBanco === 'CANCELADA' && estado.atualizacoes === 1,
    `status=${estado.statusBanco}, atualizações=${estado.atualizacoes}`);

  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  await aguardar(220);
  const canceladas = w.document.getElementById('cargasCanceladasTableBody').textContent || '';
  check('nova leitura reflete o status terminal sem repetir a atualização automática',
    estado.leituras === 2 && estado.atualizacoes === 1 && /CANCELADA/.test(canceladas),
    `leituras=${estado.leituras}, atualizações=${estado.atualizacoes}, tabela=${canceladas.slice(0, 100)}`);
  janela.w.close();
}

async function testarNavegacaoDuranteAtualizacao() {
  log('\n9. Navegação: timer e gravação obsoleta são invalidados ao sair da página');
  const { janela, w, estado } = await carregarPaginaCargas({ deferirAtualizacao: true });
  const cacheAntes = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  w.dispatchEvent(new w.CustomEvent('nexus_data_changed', { detail: { entity: 'cargas' } }));
  w.dispatchEvent(new w.Event('pagehide'));
  estado.liberarAtualizacao();
  await aguardar(180);
  const cacheDepois = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo') || '[]');
  check('pagehide cancela a leitura pendente agendada por evento', estado.leituras === 1, `leituras=${estado.leituras}`);
  check('a gravação remota já iniciada pode terminar sem reiniciar o ciclo',
    estado.atualizacoes === 1 && estado.statusBanco === 'ENTREGUE',
    `atualizações=${estado.atualizacoes}, status=${estado.statusBanco}`);
  check('a resposta obsoleta não grava no cache compartilhado após navegação',
    cacheAntes[0].status === 'AGENDAMENTO' && cacheDepois[0].status === 'AGENDAMENTO',
    `antes=${cacheAntes[0].status}, depois=${cacheDepois[0].status}`);
  janela.w.close();
}

function testarEsquemaCpfNascimento() {
  log('\n10. Campos de funcionário: tipos SQL e referência de migração exibida na interface');
  const migration = read('supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql');
  const tecnico = read('js/pages/tecnico_portos.js');
  check('migração declara funcionarios.cpf como text nullable', /ADD COLUMN IF NOT EXISTS cpf\s+text(?:\s|;)/i.test(migration));
  check('migração declara funcionarios.data_nascimento como date nullable', /ADD COLUMN IF NOT EXISTS data_nascimento\s+date(?:\s|;)/i.test(migration));
  check('migração usa índice único parcial para CPF não nulo', /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?ON public\.funcionarios\s*\(cpf\)[\s\S]*?WHERE cpf IS NOT NULL/i.test(migration));
  check('aviso da tela aponta para o nome exato da migração', tecnico.includes('20261010000000_funcionarios_cpf_nascimento.sql'));
}

(async function main() {
  log('=== Testes de regressão — controle de requisições de cargas ===');
  try {
    await testarSingleFlightEMapeamento();
    await testarFallbackLimitado();
    await testarRespostaObsoleta();
    await testarCicloDeInterface();
    await testarTransicaoSaidaNavio();
    await testarTransicaoCargaComNavioHerdado();
    await testarFalhaSemRetryInfinito();
    await testarConflitoDeStatusConcorrente();
    await testarNavegacaoDuranteAtualizacao();
    testarEsquemaCpfNascimento();
  } catch (error) {
    log(`\n❌ Erro inesperado: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  }
  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
})();
