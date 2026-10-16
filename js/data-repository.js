/**
 * Módulo de Repositório Central de Dados - NexusPort (js/data-repository.js)
 * Responsável pela centralização de leituras, gravações, atualizações e exclusões no Supabase,
 * eliminando fallbacks com dados fictícios hardcoded e garantindo persistência real.
 */

(function (window) {
  'use strict';

  const ENABLE_MOCKS = false;
  const EVENTOS_QUE_INVALIDAM_CARGAS = new Set([
    'cargas',
    'navios',
    'containers',
    'estivador_cargas',
    'funcionarios',
    'nexus_cargas_fluxo',
    'nexus_navios_list',
    'nexus_containers_list',
    'nexus_func_list',
    'periodic_sync',
    'window_focus',
    'visibility_sync',
    'online_sync',
    'realtime_sync'
  ]);

  function ehErroDaRelacaoEstivador(error) {
    if (!error) return false;
    const code = String(error.code || '');
    const message = [error.message, error.details, error.hint].filter(Boolean).join(' ');
    const erroDeSchema = ['PGRST200', 'PGRST201', 'PGRST204', '42703'].includes(code);
    const mencionaRelacaoOpcional = /estivador_cargas|funcionarios/i.test(message);
    const descricaoDeRelacaoAusente = /relationship|schema cache|column|could not find|does not exist|ambiguous/i.test(message);

    // A consulta simples só é um fallback válido se o erro vier do join opcional.
    // Erros de rede, autenticação ou da relação obrigatória com navios não devem
    // causar uma segunda requisição imediata.
    return (erroDeSchema && (!message || mencionaRelacaoOpcional)) ||
      (mencionaRelacaoOpcional && descricaoDeRelacaoAusente);
  }

  function lerCacheCargas() {
    try {
      const lista = JSON.parse(window.localStorage.getItem('nexus_cargas_fluxo') || '[]');
      if (!Array.isArray(lista)) return [];
      // Cache legado pode ter carga ENTREGUE ainda com vínculo ativo: a leitura
      // já devolve snapshot + vínculos liberados, sem reescrever o cache aqui.
      return lista.map((carga) => aplicarHistoricoEntrega(Object.assign({}, carga)));
    } catch (error) {
      console.warn('[NexusRepository] Cache local de cargas inválido:', error);
      return [];
    }
  }

  function clonarCargas(lista) {
    return Array.isArray(lista) ? lista.map((carga) => Object.assign({}, carga)) : [];
  }

  function clonarListaObjetos(lista) {
    return Array.isArray(lista) ? lista.map((item) => (item && typeof item === 'object' ? Object.assign({}, item) : item)) : [];
  }

  function salvarCacheSeMudou(chave, valorJson) {
    try {
      if (window.localStorage.getItem(chave) !== valorJson) {
        window.localStorage.setItem(chave, valorJson);
        return true;
      }
    } catch (error) {
      /* localStorage indisponível ou cheio */
    }
    return false;
  }

  // Tarefa 5 (Backlog Parte 2): a entrega libera navio_id/container_id ativos,
  // mas preserva nome/identificação em snapshots históricos. Estes helpers são
  // a tradução única entre o formato do banco (snake_case) e o do cache local.
  const CARGA_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function textoHistoricoCarga(valor) {
    return typeof valor === 'string' ? valor.trim() : '';
  }

  function navioHistoricoDe(carga) {
    if (!carga) return '';
    return textoHistoricoCarga(carga.navioNomeHistorico)
      || textoHistoricoCarga(carga.navio_nome_historico)
      || textoHistoricoCarga(carga.navioHistorico)
      || textoHistoricoCarga(carga.navio_historico);
  }

  function containerHistoricoDe(carga) {
    if (!carga) return '';
    const snapshot = textoHistoricoCarga(carga.containerIdentificacaoHistorico)
      || textoHistoricoCarga(carga.container_identificacao_historico)
      || textoHistoricoCarga(carga.containerHistorico)
      || textoHistoricoCarga(carga.container_historico);
    if (snapshot) return snapshot;
    // Antes da entrega, `container` pode ser a própria identificação textual.
    // UUID é chave ativa, não identificação para exibir como histórico.
    const referencias = [carga.containerIdentificacao, carga.container_identificacao, carga.container];
    for (const referencia of referencias) {
      const texto = textoHistoricoCarga(referencia);
      if (texto && !CARGA_UUID_RE.test(texto) && texto !== 'Vinculado' && texto !== 'Não Vinculado') return texto;
    }
    return '';
  }

  function aplicarHistoricoEntrega(carga, navioNome) {
    if (!carga || String(carga.status || carga.status_fluxo || '').toUpperCase() !== 'ENTREGUE') return carga;
    const navio = navioHistoricoDe(carga) || textoHistoricoCarga(navioNome) || textoHistoricoCarga(carga.navio);
    const container = containerHistoricoDe(carga);
    carga.navioNomeHistorico = navio;
    carga.navio_nome_historico = navio;
    carga.containerIdentificacaoHistorico = container;
    carga.container_identificacao_historico = container;
    carga.navio = '';
    carga.navioId = null;
    carga.navio_id = null;
    carga.container = '';
    carga.container_id = null;
    if ('containerId' in carga) carga.containerId = null;
    carga.herdarNavioDoContainer = false;
    return carga;
  }

  const NexusRepository = {
    ENABLE_MOCKS: ENABLE_MOCKS,
    _cargasRevision: 0,
    _cargasInFlight: new Map(),
    _entidadesRevision: 0,
    _entidadesInFlight: new Map(),

    /**
     * Compartilha uma única leitura lógica enquanto a requisição para a mesma
     * entidade e revisão estiver em voo (L-08). Não mantém cache após concluir.
     */
    _executarLeituraInFlight: function (chave, executor) {
      const repository = this;
      const token = `${chave}:${this._entidadesRevision}`;
      const existente = this._entidadesInFlight.get(token);
      if (existente) return existente.then(clonarListaObjetos);

      let requisicaoRastreada;
      requisicaoRastreada = Promise.resolve()
        .then(executor)
        .finally(() => {
          if (repository._entidadesInFlight.get(token) === requisicaoRastreada) {
            repository._entidadesInFlight.delete(token);
          }
        });
      this._entidadesInFlight.set(token, requisicaoRastreada);
      return requisicaoRastreada.then(clonarListaObjetos);
    },

    /**
     * Invalida leituras em andamento após uma alteração canônica de cargas/navios.
     * As respostas antigas continuam podendo resolver para os seus chamadores, mas
     * não podem sobrescrever o cache mais recente.
     */
    invalidarLeiturasCargas: function () {
      this._cargasRevision += 1;
      this._cargasInFlight.clear();
      this._entidadesRevision += 1;
      this._entidadesInFlight.clear();
      return this._cargasRevision;
    },

    /** Normaliza uma carga ENTREGUE: snapshot histórico + vínculos ativos liberados. */
    prepararHistoricoEntrega: function (carga, navioNome) {
      return aplicarHistoricoEntrega(carga, navioNome);
    },


    /**
     * Retorna o cliente Supabase se disponível
     */
    getSupabase: function () {
      return window.nexusSupabase || null;
    },

    /**
     * Retorna o cliente Supabase somente se a tabela informada estiver
     * disponível no banco. Se a tabela ainda não foi provisionada
     * (erro PGRST205), retorna null e o chamador usa o cache local.
     */
    getSupabaseTabela: function (tabela) {
      if (window.NexusSupabaseUtils) return window.NexusSupabaseUtils.clientePara(tabela);
      return this.getSupabase();
    },

    /**
     * Trata erros de tabela ausente. Retorna true se o erro foi de
     * tabela inexistente (e já foi registrado/silenciado).
     */
    tratarErroTabela: function (tabela, error) {
      if (!error) return false;
      if (window.NexusSupabaseUtils) return window.NexusSupabaseUtils.registrarErroTabela(tabela, error);
      console.warn(`[NexusRepository] Erro na tabela '${tabela}':`, error.message || error);
      return false;
    },

    /**
     * BUSCAR FUNCIONÁRIOS
     */
    getFuncionarios: function () {
      const repository = this;
      return this._executarLeituraInFlight('funcionarios', async function () {
        const client = repository.getSupabase();
        if (client) {
          try {
            const { data, error } = await client
              .from('funcionarios')
              .select('*', { count: 'exact' })
              .order('nome', { ascending: true });
            if (!error && Array.isArray(data)) {
              salvarCacheSeMudou('nexus_func_list', JSON.stringify(data));
              return data;
            }
          } catch (err) {
            console.warn('[NexusRepository] Erro ao buscar funcionarios do Supabase:', err);
          }
        }
        return JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      });
    },

    /**
     * SALVAR / ATUALIZAR FUNCIONÁRIO
     */
    saveFuncionario: async function (funcionario) {
      const client = this.getSupabase();
      if (client) {
        try {
          if (funcionario.id) {
            await client.from('funcionarios').update(funcionario).eq('id', funcionario.id);
          } else {
            const { data } = await client.from('funcionarios').insert(funcionario).select().maybeSingle();
            if (data && data.id) funcionario.id = data.id;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao salvar funcionario no Supabase:', err);
        }
      }
      return funcionario;
    },

    /**
     * EXCLUIR FUNCIONÁRIO
     *
     * Regra (Tarefa 1 — Backlog Parte 2): `estivador_cargas` é o vínculo de
     * movimentação do cargo ESTIVADOR (schema: ON DELETE CASCADE, ou seja,
     * vínculo operacional descartável, não histórico). O agendamento de cargas
     * registra o RESPONSÁVEL pela carga nessa tabela apenas quando ele é
     * estivador; para os demais cargos o responsável fica em
     * `agendamentos.agendado_por` (ON DELETE RESTRICT, histórico preservado).
     * Por isso a exclusão NÃO pode bloquear um funcionário de outro cargo só
     * por existir linha em `estivador_cargas` (atribuição indevida legada):
     * esse vínculo é desfeito junto com a exclusão. Bloqueiam de verdade:
     * estivador com cargas ainda não finalizadas, delegações de supervisão e
     * vínculos RESTRICT do banco (agendamentos, inspeções, logs etc.).
     */
    deleteFuncionario: async function (matricula) {
      const client = this.getSupabase();
      if (!client) {
        return { ok: false, erro: 'Sem conexão com o banco de dados. O funcionário não foi excluído.' };
      }
      try {
        const busca = await client.from('funcionarios').select('id, cargo').eq('matricula', matricula);
        if (busca.error) return { ok: false, erro: 'não foi possível consultar o funcionário (' + (busca.error.message || 'erro') + ').' };
        const registro = busca.data && busca.data[0];
        const id = registro && registro.id;
        if (!id) {
          // Não existe no banco: só o cache local precisa ser limpo.
          this._removerFuncionarioLocal(matricula);
          return { ok: true, removido: 0 };
        }

        const normalizarCargo = (cargo) => String(cargo || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
        const cargoFuncionario = normalizarCargo(registro.cargo);
        // Sem cargo conhecido (registro legado), trata como possível estivador
        // por segurança; com cargo conhecido, só ESTIVADOR é estivador.
        const podeSerEstivador = !cargoFuncionario || cargoFuncionario === 'ESTIVADOR';

        const estivador = await client.from('estivador_cargas').select('id, carga_id').eq('estivador_id', id);
        if (estivador.error) return { ok: false, erro: 'não foi possível verificar os vínculos de carga (' + (estivador.error.message || 'erro') + ').' };
        const vinculosEstivador = Array.isArray(estivador.data) ? estivador.data : [];

        if (vinculosEstivador.length > 0 && podeSerEstivador) {
          // Estivador só é bloqueado por carga ainda não finalizada. Carga
          // ENTREGUE/CANCELADA/RECUSADA é histórico: o vínculo operacional é
          // desfeito na exclusão (CASCADE no banco) sem apagar a carga.
          const STATUS_FINAIS = ['ENTREGUE', 'CANCELADA', 'RECUSADA'];
          let bloqueantes = vinculosEstivador.length; // conservador se não confirmar os status
          try {
            const idsCargas = vinculosEstivador.map(v => v.carga_id).filter(Boolean);
            if (idsCargas.length > 0) {
              const cargasVinculadas = await client.from('cargas').select('id, status_fluxo').in('id', idsCargas);
              if (!cargasVinculadas.error && Array.isArray(cargasVinculadas.data)) {
                const finalizadas = new Set(
                  cargasVinculadas.data
                    .filter(c => STATUS_FINAIS.includes(String(c.status_fluxo || '').toUpperCase()))
                    .map(c => String(c.id))
                );
                bloqueantes = vinculosEstivador.filter(v => !finalizadas.has(String(v.carga_id))).length;
              }
            }
          } catch (e) { /* sem confirmação de status: mantém o bloqueio conservador */ }
          if (bloqueantes > 0) {
            return { ok: false, bloqueio: true, erro: 'o funcionário está vinculado a ' + bloqueantes + ' carga(s) ativa(s) como estivador. Desvincule-o das cargas antes de excluí-lo.' };
          }
        }

        // Histórico de agendamento (agendamentos.agendado_por, RESTRICT):
        // quem agendou cargas não é apagado, para preservar a auditoria de
        // quem registrou cada carga. A mensagem precisa dizer isso — não é
        // vínculo de estivador.
        const agendamentos = await client.from('agendamentos').select('id').eq('agendado_por', id);
        if (agendamentos.error) return { ok: false, erro: 'não foi possível verificar os agendamentos do funcionário (' + (agendamentos.error.message || 'erro') + ').' };
        if (agendamentos.data && agendamentos.data.length > 0) {
          return { ok: false, bloqueio: true, erro: 'o funcionário foi registrado como responsável pelo agendamento de ' + agendamentos.data.length + ' carga(s). Esse histórico é preservado e impede a exclusão; desative o funcionário em vez de excluí-lo.' };
        }

        const delegTitular = await client.from('delegacoes_supervisor').select('id').eq('supervisor_titular_id', id);
        const delegSubst = await client.from('delegacoes_supervisor').select('id').eq('substituto_id', id);
        if (delegTitular.error || delegSubst.error) {
          const e = delegTitular.error || delegSubst.error;
          return { ok: false, erro: 'não foi possível verificar as delegações de supervisão (' + (e.message || 'erro') + ').' };
        }
        const delegacoes = (delegTitular.data || []).length + (delegSubst.data || []).length;
        if (delegacoes > 0) {
          return { ok: false, bloqueio: true, erro: 'o funcionário participa de ' + delegacoes + ' delegação(ões) de supervisão. Encerre as delegações antes de excluí-lo.' };
        }

        const { data, error } = await client.from('funcionarios').delete().eq('id', id).select();
        if (error) {
          // Vínculos RESTRICT (agendamentos, inspeções, movimentações, logs) impedem a exclusão no banco.
          const restrito = error.code === '23503' || /foreign key|violates/i.test(String(error.message || ''));
          return {
            ok: false,
            bloqueio: restrito,
            erro: restrito
              ? 'o funcionário possui registros vinculados (agendamentos, inspeções, movimentações ou logs) e não pode ser excluído.'
              : 'o banco de dados recusou a exclusão (' + (error.message || 'erro') + ').'
          };
        }
        if (!data || data.length === 0) {
          return {
            ok: false,
            erro: 'o banco de dados não removeu nenhuma linha (nenhum registro afetado ou bloqueio por política RLS).'
          };
        }
        // O banco remove estivador_cargas em cascata; a limpeza explícita cobre
        // vínculos legados e mantém o mesmo resultado em qualquer ambiente.
        // Falha aqui não desfaz a exclusão já confirmada pelo banco.
        if (vinculosEstivador.length > 0) {
          try {
            await client.from('estivador_cargas').delete().eq('estivador_id', id);
          } catch (limpezaErr) {
            console.warn('[NexusRepository] Funcionário excluído; limpeza de estivador_cargas falhou:', limpezaErr);
          }
        }
        this._removerFuncionarioLocal(matricula);
        return { ok: true, removido: 1 };
      } catch (err) {
        return { ok: false, erro: 'falha de comunicação com o banco de dados (' + (err && err.message ? err.message : err) + ').' };
      }
    },

    _removerFuncionarioLocal: function (matricula) {
      let list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      list = list.filter(f => f.matricula !== matricula);
      localStorage.setItem('nexus_func_list', JSON.stringify(list));
    },

    /**
     * BUSCAR CARGAS
     * Leituras idênticas em andamento compartilham uma única operação lógica.
     * A deduplicação dura somente enquanto a requisição está em voo: não há cache
     * de resposta concluída, e uma invalidação abre uma nova revisão.
     */
    getCargas: function () {
      const client = this.getSupabase();
      if (!client) return Promise.resolve(clonarCargas(lerCacheCargas()));

      const repository = this;
      const revision = this._cargasRevision;
      const existing = this._cargasInFlight.get(revision);
      if (existing) return existing.then(clonarCargas);

      const request = (async function () {
        try {
          let result = await client
            .from('cargas')
            .select('*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))');

          if (result && result.error) {
            if (!ehErroDaRelacaoEstivador(result.error)) {
              repository.tratarErroTabela('cargas', result.error);
              return clonarCargas(lerCacheCargas());
            }

            // Fallback limitado ao erro de schema do join opcional. Erros de rede,
            // autenticação e autorização retornam ao cache sem retry instantâneo.
            result = await client
              .from('cargas')
              .select('*, navios(id, nome)');
            if (result && result.error) {
              repository.tratarErroTabela('cargas', result.error);
              return clonarCargas(lerCacheCargas());
            }
          }

          if (!result || !Array.isArray(result.data)) {
            return clonarCargas(lerCacheCargas());
          }

          const mapped = result.data.map((c) => {
            const vinculo = Array.isArray(c.estivador_cargas) && c.estivador_cargas.length > 0
              ? c.estivador_cargas[0]
              : null;
            const status = c.status_fluxo || 'AGENDAMENTO';
            const finalizada = ['ENTREGUE', 'CANCELADA', 'RECUSADA'].includes(status);
            const entregue = status === 'ENTREGUE';
            // Snapshot gravado na entrega; para linha legada ainda vinculada,
            // o join com navios é a última fonte disponível do nome histórico.
            const navioNomeHistorico = navioHistoricoDe(c)
              || (entregue && c.navios ? textoHistoricoCarga(c.navios.nome) : '');
            const containerIdentificacaoHistorico = entregue ? containerHistoricoDe(c) : '';
            return {
              id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : `CRG-${c.id}`,
              tipo: window.getNexusTipoCarga?.(c.tipo_carga_id)?.nome || c.natureza || '',
              tipo_carga_id: c.tipo_carga_id || null,
              peso: `${c.peso || 0} t`,
              volume: `${c.volume || 0} m³`,
              valor: `R$ ${(c.valor_declarado || 0).toLocaleString('pt-BR')}`,
              natureza: c.natureza || 'Geral',
              portoDescarga: c.porto_descarga || 'Terminal STS-01',
              destino: c.destino || 'Destino Geral',
              status,
              container: finalizada ? '' : (c.container_id || ''),
              container_id: finalizada ? null : (c.container_id || null),
              containerIdentificacaoHistorico,
              container_identificacao_historico: containerIdentificacaoHistorico,
              navio: finalizada ? '' : ((c.navios && c.navios.nome) ? c.navios.nome : ''),
              navioId: finalizada ? null : (c.navio_id || null),
              navio_id: finalizada ? null : (c.navio_id || null),
              navioNomeHistorico,
              navio_nome_historico: navioNomeHistorico,
              qrCode: c.qr_code_url || `QR-CRG-${c.id}`,
              motivoCancelamento: c.motivo_recusa || null,
              rawDbId: c.id,
              data_cadastro: c.created_at || c.data_cadastro || null,
              created_at: c.created_at || null,
              estivador_id: vinculo ? vinculo.estivador_id : null,
              estivadorMatricula: (vinculo && vinculo.funcionarios) ? vinculo.funcionarios.matricula : null,
              estivador: (vinculo && vinculo.funcionarios) ? vinculo.funcionarios.nome : null
            };
          });

          // Uma resposta de geração antiga pode resolver para o chamador, mas não
          // pode retroceder o cache após uma alteração mais recente.
          if (repository._cargasRevision === revision) {
            salvarCacheSeMudou('nexus_cargas_fluxo', JSON.stringify(mapped));
          }
          return mapped;
        } catch (error) {
          console.warn('[NexusRepository] Erro ao buscar cargas do Supabase:', error);
          return clonarCargas(lerCacheCargas());
        }
      })();

      let trackedRequest;
      trackedRequest = request.finally(() => {
        if (repository._cargasInFlight.get(revision) === trackedRequest) {
          repository._cargasInFlight.delete(revision);
        }
      });
      this._cargasInFlight.set(revision, trackedRequest);
      return trackedRequest.then(clonarCargas);
    },

    /**
     * SALVAR CARGA
     */
    saveCarga: async function (carga) {
      const entregue = String(carga && carga.status || '').toUpperCase() === 'ENTREGUE';
      if (entregue) aplicarHistoricoEntrega(carga);
      const client = this.getSupabase();
      if (client) {
        try {
          const dbData = {
            natureza: carga.natureza || carga.tipo,
            peso: parseFloat(carga.peso) || 0,
            volume: parseFloat(carga.volume) || 0,
            valor_declarado: parseFloat(carga.valor ? carga.valor.replace(/[^0-9,.-]/g, '').replace(',', '.') : 0) || 0,
            porto_descarga: carga.portoDescarga,
            destino: carga.destino,
            status_fluxo: carga.status,
            qr_code_url: carga.qrCode || `QR-${carga.id}`,
            container_id: entregue ? null : (carga.container_id || carga.container || null),
            navio_id: entregue ? null : (carga.navioId || carga.navio_id || null),
            navio_nome_historico: entregue ? (navioHistoricoDe(carga) || null) : null,
            container_identificacao_historico: entregue ? (containerHistoricoDe(carga) || null) : null,
            motivo_recusa: carga.motivoCancelamento || null
          };

          if (carga.rawDbId) {
            await client.from('cargas').update(dbData).eq('id', carga.rawDbId);
          } else {
            const { data } = await client.from('cargas').insert(dbData).select().maybeSingle();
            if (data) carga.rawDbId = data.id;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao salvar carga no Supabase:', err);
        }
      }

      let list = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      const idx = list.findIndex(c => c.id === carga.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...carga };
      } else {
        list.push(carga);
      }
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(list));
      return carga;
    },

    /**
     * EXCLUIR / CANCELAR CARGA REAL
     */
    deleteCarga: async function (idCarga) {
      const client = this.getSupabase();
      if (client) {
        try {
          await client.from('cargas').delete().eq('qr_code_url', `QR-${idCarga}`);
        } catch (err) {
          console.warn('[NexusRepository] Erro ao excluir carga do Supabase:', err);
        }
      }
      let list = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      list = list.filter(c => c.id !== idCarga);
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(list));
    },

    /**
     * BUSCAR BERÇOS DO TERMINAL
     */
    getBercos: function () {
      const repository = this;
      return this._executarLeituraInFlight('bercos', async function () {
        const client = repository.getSupabaseTabela('bercos');
        if (client) {
          try {
            const { data, error } = await client.from('bercos').select('*').order('nome', { ascending: true });
            if (error) repository.tratarErroTabela('bercos', error);
            if (!error && Array.isArray(data) && data.length > 0) {
              salvarCacheSeMudou('nexus_bercos_list', JSON.stringify(data));
              return data;
            }
          } catch (err) {
            if (!repository.tratarErroTabela('bercos', err)) {
              console.warn('[NexusRepository] Erro ao buscar bercos do Supabase:', err);
            }
          }
        }
        return JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
      });
    },

    /**
     * SALVAR / ATUALIZAR BERÇO
     * O payload passa pela normalização de `NexusSupabaseUtils.normalizarBerco`
     * (regras de `bercos_vinculo_navio_check` / `bercos_id_formato_check`):
     * berço OCUPADO sem navio_nome/navio_imo e ids fora de 'BERCO-NN' faziam o
     * upsert falhar com 23514 e a linha nunca era persistida.
     */
    saveBerco: async function (berco) {
      const resultado = (window.NexusSupabaseUtils && window.NexusSupabaseUtils.normalizarBerco)
        ? window.NexusSupabaseUtils.normalizarBerco(berco)
        : { payload: null, corrigido: false, motivo: 'utilitário de normalização indisponível' };

      if (!resultado.payload) {
        console.warn(`[NexusRepository] Berço não salvo: ${resultado.motivo}.`);
        return berco;
      }
      if (resultado.corrigido) {
        console.warn(`[NexusRepository] Berço ${resultado.payload.nome} ajustado para gravação: ${resultado.motivo || 'registro fora do padrão de public.bercos'}.`);
      }

      const registro = resultado.payload;
      const client = this.getSupabaseTabela('bercos');
      if (client) {
        try {
          const { error } = await client.from('bercos').upsert(registro, { onConflict: 'nome' });
          this.tratarErroTabela('bercos', error);
        } catch (err) {
          if (!this.tratarErroTabela('bercos', err)) {
            console.warn('[NexusRepository] Erro ao salvar berco no Supabase:', err);
          }
        }
      }
      let list = JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
      const idx = list.findIndex(b => b.nome === registro.nome || b.id === registro.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...registro };
      } else {
        list.push(registro);
      }
      localStorage.setItem('nexus_bercos_list', JSON.stringify(list));
      return registro;
    },

    /**
     * BUSCAR NAVIOS
     */
    getNavios: function () {
      const repository = this;
      return this._executarLeituraInFlight('navios', async function () {
        const client = repository.getSupabase();
        if (client) {
          try {
            const { data, error } = await client.from('navios').select('*');
            if (!error && Array.isArray(data)) {
              const mapped = data.map(n => ({
                id: n.id,
                nome: n.nome,
                imo: n.numero_imo || n.imo,
                estado: n.estado_operacional || n.estado || 'OPERANTE',
                localizacao: n.localizacao || 'DENTRO_DO_PORTO',
                origem: n.porto_origem || n.origem || 'Porto de Santos',
                destino: n.porto_destino || n.destino || 'Destino',
                operacoes: n.quantidade_cargas_realizadas || n.operacoes || 0,
                data_saida: n.data_saida || null
              }));
              salvarCacheSeMudou('nexus_navios_list', JSON.stringify(mapped));
              return mapped;
            }
          } catch (err) {
            console.warn('[NexusRepository] Erro ao buscar navios do Supabase:', err);
          }
        }
        return JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      });
    },

    /**
     * BUSCAR VISITANTES
     */
    getVisitantes: function () {
      const repository = this;
      return this._executarLeituraInFlight('visitantes', async function () {
        const client = repository.getSupabase();
        if (client) {
          try {
            const { data, error } = await client.from('visitantes').select('*');
            if (!error && Array.isArray(data)) {
              const mapped = data.map(v => ({
                id: v.id,
                nome: v.nome,
                documento: v.documento,
                motivo: v.motivo,
                registrado_por: v.registrado_por,
                data: v.data_hora_entrada ? new Date(v.data_hora_entrada).toLocaleDateString('pt-BR') : (v.created_at ? new Date(v.created_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')),
                data_saida: v.data_hora_saida ? new Date(v.data_hora_saida).toLocaleDateString('pt-BR') : null
              }));
              salvarCacheSeMudou('nexus_vis_list', JSON.stringify(mapped));
              return mapped;
            }
          } catch (err) {
            console.warn('[NexusRepository] Erro ao buscar visitantes do Supabase:', err);
          }
        }
        return JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');
      });
    },

    /**
     * SALVAR VISITANTE
     */
    saveVisitante: async function (vis) {
      const client = this.getSupabase();
      if (client) {
        try {
          await client.from('visitantes').insert({
            nome: vis.nome,
            documento: vis.documento,
            motivo: vis.motivo,
            registrado_por: vis.registrado_por
          });
        } catch (err) {
          console.warn('[NexusRepository] Erro ao salvar visitante no Supabase:', err);
        }
      }
      let list = JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');
      list.push(vis);
      localStorage.setItem('nexus_vis_list', JSON.stringify(list));
      return vis;
    },

    /**
     * EXCLUIR VISITANTE
     */
    deleteVisitante: async function (docOuId) {
      const client = this.getSupabase();
      if (client) {
        try {
          await client.from('visitantes').delete().or(`documento.eq.${docOuId},id.eq.${docOuId}`);
        } catch (err) {
          console.warn('[NexusRepository] Erro ao excluir visitante do Supabase:', err);
        }
      }
      let list = JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');
      list = list.filter(v => v.documento !== docOuId && v.id !== docOuId);
      localStorage.setItem('nexus_vis_list', JSON.stringify(list));
    },

    /**
     * BUSCAR CARGAS RECUSADAS E CANCELADAS (Função Única - Item 1.2)
     */
    buscarCargasRecusadas: async function () {
      const client = this.getSupabase();
      let cargasRecusadas = [];
      let cargasCanceladas = [];

      if (client) {
        try {
          const { data, error } = await client
            .from('cargas')
            .select('*')
            .in('status_fluxo', ['RECUSADA', 'CANCELADA']);

          if (!error && Array.isArray(data)) {
            data.forEach(c => {
              const item = {
                id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : `CRG-${c.id}`,
                rawDbId: c.id,
                tipo: c.natureza || 'Carga Geral',
                peso: `${c.peso || 0} t`,
                volume: `${c.volume || 0} m³`,
                status: c.status_fluxo,
                motivo: c.motivo_recusa || 'Sem motivo registrado',
                portoDescarga: c.porto_descarga || 'Terminal STS-01'
              };
              if (c.status_fluxo === 'RECUSADA') cargasRecusadas.push(item);
              else cargasCanceladas.push(item);
            });
            return {
              recusadas: cargasRecusadas,
              canceladas: cargasCanceladas,
              totalRecusadas: cargasRecusadas.length,
              totalCanceladas: cargasCanceladas.length,
              totalGeral: cargasRecusadas.length + cargasCanceladas.length
            };
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao buscar cargas recusadas do Supabase:', err);
        }
      }

      const localCargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      localCargas.forEach(c => {
        if (c.status === 'RECUSADA') cargasRecusadas.push(c);
        else if (c.status === 'CANCELADA') cargasCanceladas.push(c);
      });

      return {
        recusadas: cargasRecusadas,
        canceladas: cargasCanceladas,
        totalRecusadas: cargasRecusadas.length,
        totalCanceladas: cargasCanceladas.length,
        totalGeral: cargasRecusadas.length + cargasCanceladas.length
      };
    },

    /**
     * BUSCAR EQUIPAMENTOS PREVENTIVA SUGERIDA (> 3 ANOS) (Função Única - Item 1.8)
     * Reutilizada obrigatoriamente tanto no Painel Geral quanto em Manutenção & OS.
     */
    buscarEquipamentosPreventivaSugerida: async function () {
      const client = this.getSupabase();
      const tresAnosMs = 3 * 365 * 24 * 60 * 60 * 1000;
      const agora = Date.now();
      const equipamentos = [];

      let dbConts = [];
      let dbGuindastes = [];
      let dbNavios = [];

      if (client) {
        try {
          const [resCont, resGnd, resNav] = await Promise.all([
            client.from('containers').select('*'),
            client.from('guindastes').select('*'),
            client.from('navios').select('*')
          ]);
          if (!resCont.error && Array.isArray(resCont.data)) dbConts = resCont.data;
          if (!resGnd.error && Array.isArray(resGnd.data)) dbGuindastes = resGnd.data;
          if (!resNav.error && Array.isArray(resNav.data)) dbNavios = resNav.data;
        } catch (e) {
          console.warn('[NexusRepository] Erro ao buscar dados para preventiva sugerida:', e);
        }
      }

      // 1. Contêineres
      dbConts.forEach(c => {
        const dStr = c.data_ultima_manutencao || c.data_fabricacao;
        if (dStr) {
          const diff = agora - new Date(dStr).getTime();
          if (diff >= tresAnosMs) {
            equipamentos.push({
              tipo: 'CONTAINER',
              identificacao: c.numero_identificacao || `CONT-${c.id}`,
              dataReferencia: dStr,
              motivo: `Última manutenção/fabricação em ${new Date(dStr).toLocaleDateString('pt-BR')} (> 3 anos de uso)`,
              rawObj: c
            });
          }
        }
      });

      // 2. Guindastes
      dbGuindastes.forEach(g => {
        const dStr = g.data_ultima_manutencao;
        if (dStr) {
          const diff = agora - new Date(dStr).getTime();
          if (diff >= tresAnosMs) {
            equipamentos.push({
              tipo: 'GUINDASTE',
              identificacao: g.numero_identificacao || `GND-${g.id}`,
              dataReferencia: dStr,
              motivo: `Última manutenção registrada em ${new Date(dStr).toLocaleDateString('pt-BR')} (> 3 anos sem manutenção)`,
              rawObj: g
            });
          }
        }
      });

      // 3. Navios
      dbNavios.forEach(n => {
        const dStr = n.data_registro_sistema || n.data_saida || n.created_at;
        if (dStr) {
          const diff = agora - new Date(dStr).getTime();
          if (diff >= tresAnosMs) {
            equipamentos.push({
              tipo: 'NAVIO',
              identificacao: n.nome,
              dataReferencia: dStr,
              motivo: `Registro/reforma em ${new Date(dStr).toLocaleDateString('pt-BR')} (> 3 anos)`,
              rawObj: n
            });
          }
        }
      });

      return {
        equipamentos,
        total: equipamentos.length
      };
    },

    /**
     * BUSCAR INDICADORES OPERACIONAIS CONSOLIDADOS (Função Única - Item 1.1)
     */
    buscarIndicadoresOperacionais: async function () {
      const client = this.getSupabase();
      let cargas = [];
      let navios = [];
      let osList = [];

      if (client) {
        // Leitura paginada: o PostgREST corta cada resposta em 1000 linhas.
        const lerTabela = (tabela) => this.lerTodasAsLinhas(() => client.from(tabela).select('*').order('id'));
        try {
          const [c, n, m] = await Promise.all([lerTabela('cargas'), lerTabela('navios'), lerTabela('manutencoes')]);
          cargas = c;
          navios = n;
          osList = m;
        } catch (e) {
          console.warn('[NexusRepository] Erro ao buscar indicadores operacionais:', e);
        }
      }

      if (cargas.length === 0) {
        cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      }
      if (navios.length === 0) {
        navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      }
      if (osList.length === 0) {
        osList = JSON.parse(localStorage.getItem('nexus_os_list') || '[]');
      }

      const recusadasObj = await this.buscarCargasRecusadas();
      const preventivaObj = await this.buscarEquipamentosPreventivaSugerida();

      const naviosFora = navios.filter(n => n.localizacao === 'FORA_DO_PORTO' || n.localizacao === 'NO_PORTO_DE_DESTINO');
      const cargasArmazenagem = cargas.filter(c => c.status_fluxo === 'ARMAZENAGEM' || c.status === 'ARMAZENAGEM');
      const cargasProntas = cargas.filter(c => c.status_fluxo === 'PRONTA_PARA_ENTREGA' || c.status === 'PRONTA_PARA_ENTREGA');

      // Cargas efetivamente ocupando o pátio (armazenadas, em inspeção ou prontas no pátio - Tarefa 10)
      const cargasNoPatio = cargas.filter(c => {
        const st = String(c.status_fluxo || c.status || '').toUpperCase();
        return ['RECEBIMENTO_INSPECAO', 'INSPECAO', 'ARMAZENAGEM', 'ARMAZENADA', 'PRONTA_PARA_ENTREGA'].includes(st) ||
               (st !== '' && st !== 'AGENDAMENTO' && st !== 'EM_TRANSITO' && st !== 'ENTREGUE' && st !== 'CANCELADA' && st !== 'RECUSADA');
      });

      // Um equipamento conta uma única vez (ver derivarEquipamentosEmManutencao)
      const emManutencao = this.derivarEquipamentosEmManutencao(navios, osList);

      const CAPACIDADE_MAXIMA_PATIO = 100;
      const taxaOcupacao = Math.min(100, Math.round((cargasNoPatio.length / CAPACIDADE_MAXIMA_PATIO) * 100));

      return {
        recusadas: recusadasObj,
        preventiva: preventivaObj,
        naviosFora: { lista: naviosFora, total: naviosFora.length },
        cargasArmazenagem: { lista: cargasArmazenagem, total: cargasArmazenagem.length },
        cargasProntas: { lista: cargasProntas, total: cargasProntas.length },
        manutencao: {
          navios: emManutencao.navios,
          ordens: emManutencao.ordens,
          total: emManutencao.total
        },
        ocupacaoPatio: {
          capacidade: CAPACIDADE_MAXIMA_PATIO,
          ocupados: cargasNoPatio.length,
          taxa: taxaOcupacao,
          lista: cargasNoPatio
        }
      };
    },

    /**
     * Lê todas as linhas de uma consulta (paginação); delega a NexusSupabaseUtils.
     * `montar` deve devolver uma consulta nova a cada chamada.
     */
    lerTodasAsLinhas: async function (montar) {
      if (window.NexusSupabaseUtils && typeof window.NexusSupabaseUtils.lerTodasAsLinhas === 'function') {
        return window.NexusSupabaseUtils.lerTodasAsLinhas(montar);
      }
      const res = await montar();
      if (res && res.error) throw res.error;
      return Array.isArray(res && res.data) ? res.data : [];
    },

    /**
     * EQUIPAMENTOS EM MANUTENÇÃO (Backlog 3 — indicadores em tempo real)
     * Fonte única: ordens de serviço ATIVAS (manutencoes com status SOLICITADA ou APROVADA).
     *  - Cada equipamento conta UMA vez: duas OS para o mesmo navio = 1; OS + estado de reforma
     *    do mesmo navio = 1 (o estado do navio só serve para casar a OS com o navio).
     *  - Estado de reforma de navio SEM OS ativa não conta: é resíduo de um fluxo anterior,
     *    não manutenção em andamento (era a origem de "equipamentos" fantasmas no painel).
     *  - OS antigas sem navio_id são casadas com o navio pelo nome gravado na descrição
     *    ("Navio: NOME - ..."). Sem casamento, o navio é contado pelo nome.
     * Retorna { total, navios (cadastros dos navios em manutenção), ordens (OS ativas) }.
     */
    derivarEquipamentosEmManutencao: function (navios, osList) {
      const listaNavios = Array.isArray(navios) ? navios : [];
      const ativas = (Array.isArray(osList) ? osList : [])
        .filter(o => o && (o.status === 'SOLICITADA' || o.status === 'APROVADA'));

      const naviosPorId = new Map();
      const naviosPorNome = new Map();
      listaNavios.forEach(n => {
        if (n.id) naviosPorId.set(String(n.id), n);
        const nomeKey = String(n.nome || '').trim().toLowerCase();
        if (nomeKey && !naviosPorNome.has(nomeKey)) naviosPorNome.set(nomeKey, n);
      });

      const chaves = new Set();
      const naviosEmManutencao = new Map();
      ativas.forEach(o => {
        if (o.navio_id) {
          const navio = naviosPorId.get(String(o.navio_id));
          chaves.add(`navio:${o.navio_id}`);
          if (navio) naviosEmManutencao.set(String(navio.id), navio);
          return;
        }
        if (o.container_id) { chaves.add(`container:${o.container_id}`); return; }
        if (o.guindaste_id) { chaves.add(`guindaste:${o.guindaste_id}`); return; }
        // OS legada: o navio aparece só no texto ("Navio: NOME - ...")
        const casamento = /Navio:\s*(.+?)\s+-\s/.exec(String(o.descricao || ''));
        const nomeLegado = casamento ? casamento[1].trim().toLowerCase() : '';
        if (nomeLegado) {
          const navio = naviosPorNome.get(nomeLegado);
          if (navio) {
            chaves.add(`navio:${navio.id || navio.nome}`);
            naviosEmManutencao.set(String(navio.id || navio.nome), navio);
          } else {
            chaves.add(`navio-nome:${nomeLegado}`);
          }
          return;
        }
        chaves.add(`os:${o.id}`);
      });

      return {
        total: chaves.size,
        navios: Array.from(naviosEmManutencao.values()),
        ordens: ativas
      };
    },

    /**
     * SINCRONIZAÇÃO AUTOMÁTICA VIA SUPABASE REALTIME (Backlog 3 — Realtime-Sync)
     * Assina mudanças (INSERT/UPDATE/DELETE) das tabelas operacionais no schema
     * público e dispara o evento local `nexus_data_changed` (com debounce), que
     * já é o gatilho de re-render das telas. Assim, quando outro operador —
     * por exemplo o pessoal do scanner — altera um registro, as telas abertas
     * atualizam sem intervenção manual. A lista abaixo DEVE coincidir com as
     * tabelas da publicação `supabase_realtime` (migração 20261009000000 e teste
     * tests/test_tempo_real.js). Sem a publicação, o canal não recebe eventos e o
     * polling de segurança (abaixo) é o que mantém os dados atualizados.
     */
    REALTIME_TABLES: [
      'cargas',
      'containers',
      'navios',
      'guindastes',
      'manutencoes',
      'historico_manutencoes',
      'funcionarios',
      'visitantes',
      'bercos',
      'rotas_maritimas',
      'delegacoes_supervisor',
      'inspecoes',
      'inspecao_itens',
      'checklist_modelos',
      'checklist_itens',
      'tipos_carga',
      'leituras_qr_code',
      'estivador_cargas',
      'agendamentos',
      'logs_alteracoes',
      'trail_decisoes',
      'retificacoes_trail',
      'emergencias'
    ],

    /** Intervalo do polling de segurança (quando o Realtime não entrega eventos). */
    POLLING_SEGURANCA_MS: 60000,

    _realtimeChannel: null,
    _realtimeDebounce: null,
    _realtimePendentes: new Set(),
    _realtimePrecisaRessincronizar: false,

    iniciarSincronizacaoRealtime: function () {
      const client = this.getSupabase();
      if (!client || typeof client.channel !== 'function') return null;
      if (this._realtimeChannel) return this._realtimeChannel;

      try {
        const channel = client.channel('nexus_data_sync');
        this.REALTIME_TABLES.forEach((tabela) => {
          channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tabela },
            () => {
              // Agrupa sem perder tabelas: carga + auditoria na mesma rajada
              // precisam invalidar as cargas, não apenas o último log recebido.
              // Janela fixa de 400 ms evita adiar indefinidamente sob fluxo contínuo.
              this._realtimePendentes.add(tabela);
              if (this._realtimeDebounce !== null) return;
              this._realtimeDebounce = setTimeout(() => {
                this._realtimeDebounce = null;
                const entities = Array.from(this._realtimePendentes);
                this._realtimePendentes.clear();
                // null mantém compatibilidade com ouvintes antigos: lote misto
                // significa atualização geral, nunca uma tabela arbitrária.
                window.dispatchEvent(new CustomEvent('nexus_data_changed', {
                  detail: { entity: entities.length === 1 ? entities[0] : null, entities, origem: 'realtime' }
                }));
                // Não retransmitir Realtime via BroadcastChannel: evita ecos.
              }, 400);
            }
          );
        });
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[NexusRepository] Sincronização Realtime ativa.');
            // Evita duplicar todas as leituras logo na abertura da página (L-04):
            // só dispara realtime_sync quando reconectar após queda/erro.
            if (this._realtimePrecisaRessincronizar) {
              this._realtimePrecisaRessincronizar = false;
              this.notifyChange('realtime_sync');
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            this._realtimePrecisaRessincronizar = true;
            if (status !== 'CLOSED') {
              console.warn('[NexusRepository] Realtime indisponível (' + status + '); o polling de segurança (' + (this.POLLING_SEGURANCA_MS / 1000) + ' s) mantém os dados atualizados.');
            }
          }
        });
        this._realtimeChannel = channel;
        return channel;
      } catch (err) {
        console.warn('[NexusRepository] Falha ao iniciar Realtime (fallback: polling):', err);
        return null;
      }
    },

    /**
     * Encerra a assinatura Realtime (ex.: logout/troca de sessão).
     */
    pararSincronizacaoRealtime: function () {
      const client = this.getSupabase();
      if (client && this._realtimeChannel && typeof client.removeChannel === 'function') {
        try { client.removeChannel(this._realtimeChannel); } catch (e) {}
      }
      this._realtimeChannel = null;
      this._realtimePrecisaRessincronizar = false;
      if (this._realtimeDebounce !== null) clearTimeout(this._realtimeDebounce);
      this._realtimeDebounce = null;
      this._realtimePendentes.clear();
    },

    /**
     * NOTIFICAÇÃO DE ALTERAÇÃO EM TEMPO REAL (Item 2)
     */
    notifyChange: function (entity) {
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('nexusport_sync');
          bc.postMessage({ type: 'NEXUS_DATA_CHANGED', entity: entity, timestamp: Date.now() });
          bc.close();
        } catch (e) {}
      }
      window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: entity } }));
    }
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bcSync = new BroadcastChannel('nexusport_sync');
      bcSync.onmessage = (event) => {
        if (event.data && event.data.type === 'NEXUS_DATA_CHANGED') {
          window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: event.data }));
        }
      };
    } catch (e) {}
  }

  // O listener está na fase de captura para invalidar as respostas antigas antes
  // que os módulos de página iniciem uma nova leitura no mesmo evento.
  window.addEventListener('nexus_data_changed', (event) => {
    const entity = event && event.detail ? event.detail.entity : null;
    const entities = event && event.detail && Array.isArray(event.detail.entities) ? event.detail.entities : [];
    NexusRepository._entidadesRevision += 1;
    NexusRepository._entidadesInFlight.clear();
    if (!entity || EVENTOS_QUE_INVALIDAM_CARGAS.has(entity) || entities.some(e => EVENTOS_QUE_INVALIDAM_CARGAS.has(e))) {
      NexusRepository.invalidarLeiturasCargas();
    }
  }, true);

  const CHAVES_CACHE_LEITURA = new Set([
    'nexus_func_list',
    'nexus_cargas_fluxo',
    'nexus_bercos_list',
    'nexus_navios_list',
    'nexus_vis_list',
    'nexus_containers_list',
    'nexus_guindastes_list',
    'nexus_os_list',
    'nexus_audit_logs',
    'nexus_trail_decisoes'
  ]);

  window.addEventListener('storage', (e) => {
    if (!e || !e.key || !e.key.startsWith('nexus_')) return;
    if (e.oldValue === e.newValue) return;
    // Gravações de cache de leitura vindas de outra aba não disparam novas
    // consultas ao Supabase (L-02); mutações reais usam BroadcastChannel e Realtime.
    if (CHAVES_CACHE_LEITURA.has(e.key)) return;
    window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: e.key } }));
  });

  // Sincronização periódica e em foco da janela para atualização entre dispositivos/abas (Item 2 / L-07)
  let ultimoSyncFocoTs = 0;
  const COOLDOWN_FOCO_MS = 15000;

  window.addEventListener('focus', () => {
    NexusRepository.iniciarSincronizacaoRealtime();
    const agora = Date.now();
    if (agora - ultimoSyncFocoTs < COOLDOWN_FOCO_MS) return;
    ultimoSyncFocoTs = agora;
    NexusRepository.notifyChange('window_focus');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      NexusRepository.iniciarSincronizacaoRealtime();
      const agora = Date.now();
      if (agora - ultimoSyncFocoTs < COOLDOWN_FOCO_MS) return;
      ultimoSyncFocoTs = agora;
      NexusRepository.notifyChange('visibility_sync');
    }
  });

  window.addEventListener('online', () => {
    NexusRepository.iniciarSincronizacaoRealtime();
    NexusRepository.notifyChange('online_sync');
  });

  // Polling de segurança: sem o Realtime (ou entre eventos perdidos), as telas são
  // reconsultadas a cada POLLING_SEGURANCA_MS (60 s por padrão). Pausa quando a aba está oculta.
  setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    NexusRepository.notifyChange('periodic_sync');
  }, NexusRepository.POLLING_SEGURANCA_MS);

  // Inicia a assinatura Realtime em todas as telas que carregam o repositório
  // (o cliente Supabase é criado antes deste módulo na ordem dos <script>).
  // Em contextos de teste/offline sem cliente, não faz nada.
  if (typeof window !== 'undefined') {
    try {
      NexusRepository.iniciarSincronizacaoRealtime();
    } catch (e) {}
  }

  window.NexusRepository = NexusRepository;
})(window);
