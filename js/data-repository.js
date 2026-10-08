/**
 * Módulo de Repositório Central de Dados - NexusPort (js/data-repository.js)
 * Responsável pela centralização de leituras, gravações, atualizações e exclusões no Supabase,
 * eliminando fallbacks com dados fictícios hardcoded e garantindo persistência real.
 */

(function (window) {
  'use strict';

  const ENABLE_MOCKS = false;

  const NexusRepository = {
    ENABLE_MOCKS: ENABLE_MOCKS,

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
    getFuncionarios: async function () {
      const client = this.getSupabase();
      if (client) {
        try {
          const { data, error, count } = await client
            .from('funcionarios')
            .select('*', { count: 'exact' })
            .order('nome', { ascending: true });
          if (!error && Array.isArray(data)) {
            localStorage.setItem('nexus_func_list', JSON.stringify(data));
            return data;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao buscar funcionarios do Supabase:', err);
        }
      }
      return JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
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
     */
    deleteFuncionario: async function (matricula) {
      const client = this.getSupabase();
      if (client) {
        try {
          await client.from('funcionarios').delete().eq('matricula', matricula);
        } catch (err) {
          console.warn('[NexusRepository] Erro ao excluir funcionario do Supabase:', err);
        }
      }
      let list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      list = list.filter(f => f.matricula !== matricula);
      localStorage.setItem('nexus_func_list', JSON.stringify(list));
    },

    /**
     * BUSCAR CARGAS
     */
    getCargas: async function () {
      const client = this.getSupabase();
      if (client) {
        try {
          // Tenta trazer também a atribuição do funcionário responsável
          // (Backlog 3 — estivador_cargas); se a relação não estiver
          // disponível no schema cache, repete a consulta sem o join.
          let data = null;
          let count = null;
          {
            const rJoined = await client.from('cargas').select('*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))', { count: 'exact' });
            if (!rJoined.error && Array.isArray(rJoined.data)) {
              data = rJoined.data;
              count = rJoined.count;
            } else {
              const rPlain = await client.from('cargas').select('*, navios(id, nome)', { count: 'exact' });
              if (!rPlain.error && Array.isArray(rPlain.data)) {
                data = rPlain.data;
                count = rPlain.count;
              }
            }
          }
          if (Array.isArray(data)) {
            const mapped = data.map((c) => {
              const vinculo = Array.isArray(c.estivador_cargas) && c.estivador_cargas.length > 0 ? c.estivador_cargas[0] : null;
              return {
              id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : `CRG-${c.id}`,
              tipo: c.natureza || 'Carga Geral',
              peso: `${c.peso || 0} t`,
              volume: `${c.volume || 0} m³`,
              valor: `R$ ${(c.valor_declarado || 0).toLocaleString('pt-BR')}`,
              natureza: c.natureza || 'Geral',
              portoDescarga: c.porto_descarga || 'Terminal STS-01',
              destino: c.destino || 'Destino Geral',
              status: c.status_fluxo || 'AGENDAMENTO',
              container: c.container_id || '',
              navio: (c.navios && c.navios.nome) ? c.navios.nome : '',
              navioId: c.navio_id || null,
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
            localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao buscar cargas do Supabase:', err);
        }
      }
      return JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    },

    /**
     * SALVAR CARGA
     */
    saveCarga: async function (carga) {
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
            container_id: carga.container || null,
            navio_id: carga.navioId || carga.navio_id || null,
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
    getBercos: async function () {
      const client = this.getSupabaseTabela('bercos');
      if (client) {
        try {
          const { data, error } = await client.from('bercos').select('*').order('nome', { ascending: true });
          if (error) this.tratarErroTabela('bercos', error);
          if (!error && Array.isArray(data) && data.length > 0) {
            localStorage.setItem('nexus_bercos_list', JSON.stringify(data));
            return data;
          }
        } catch (err) {
          if (!this.tratarErroTabela('bercos', err)) {
            console.warn('[NexusRepository] Erro ao buscar bercos do Supabase:', err);
          }
        }
      }
      return JSON.parse(localStorage.getItem('nexus_bercos_list') || '[]');
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
    getNavios: async function () {
      const client = this.getSupabase();
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
            localStorage.setItem('nexus_navios_list', JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao buscar navios do Supabase:', err);
        }
      }
      return JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    },

    /**
     * BUSCAR VISITANTES
     */
    getVisitantes: async function () {
      const client = this.getSupabase();
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
            localStorage.setItem('nexus_vis_list', JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.warn('[NexusRepository] Erro ao buscar visitantes do Supabase:', err);
        }
      }
      return JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');
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
        try {
          const [resCargas, resNavios, resManut] = await Promise.all([
            client.from('cargas').select('*'),
            client.from('navios').select('*'),
            client.from('manutencoes').select('*')
          ]);
          if (!resCargas.error && Array.isArray(resCargas.data)) cargas = resCargas.data;
          if (!resNavios.error && Array.isArray(resNavios.data)) navios = resNavios.data;
          if (!resManut.error && Array.isArray(resManut.data)) osList = resManut.data;
        } catch (e) {
          console.warn('[NexusRepository] Erro ao buscar indicadores operacionais:', e);
        }
      }

      const recusadasObj = await this.buscarCargasRecusadas();
      const preventivaObj = await this.buscarEquipamentosPreventivaSugerida();

      const naviosFora = navios.filter(n => n.localizacao === 'FORA_DO_PORTO' || n.localizacao === 'NO_PORTO_DE_DESTINO');
      const cargasArmazenagem = cargas.filter(c => c.status_fluxo === 'ARMAZENAGEM');
      const cargasProntas = cargas.filter(c => c.status_fluxo === 'PRONTA_PARA_ENTREGA');

      const naviosManut = navios.filter(n => n.estado_operacional === 'EM_MANUTENCAO' || n.estado_operacional === 'AGENDADO_PARA_REFORMA');
      const osEmManut = osList.filter(o => o.status === 'SOLICITADA' || o.status === 'APROVADA');

      const CAPACIDADE_MAXIMA_PATIO = 100;
      const taxaOcupacao = Math.min(100, Math.round((cargasArmazenagem.length / CAPACIDADE_MAXIMA_PATIO) * 100));

      return {
        recusadas: recusadasObj,
        preventiva: preventivaObj,
        naviosFora: { lista: naviosFora, total: naviosFora.length },
        cargasArmazenagem: { lista: cargasArmazenagem, total: cargasArmazenagem.length },
        cargasProntas: { lista: cargasProntas, total: cargasProntas.length },
        manutencao: {
          navios: naviosManut,
          ordens: osEmManut,
          total: naviosManut.length + osEmManut.length
        },
        ocupacaoPatio: {
          capacidade: CAPACIDADE_MAXIMA_PATIO,
          ocupados: cargasArmazenagem.length,
          taxa: taxaOcupacao
        }
      };
    },

    /**
     * SINCRONIZAÇÃO AUTOMÁTICA VIA SUPABASE REALTIME (Backlog 3 — Realtime-Sync)
     * Assina mudanças (INSERT/UPDATE/DELETE) das tabelas operacionais no schema
     * público e dispara o evento local `nexus_data_changed` (com debounce), que
     * já é o gatilho de re-render das telas. Assim, quando outro operador —
     * por exemplo o pessoal do scanner — altera um registro, as telas abertas
     * atualizam sem intervenção manual. Se o Realtime não estiver habilitado
     * no projeto Supabase, cai silenciosamente no polling de 10s existente.
     */
    REALTIME_TABLES: [
      'cargas',
      'containers',
      'navios',
      'guindastes',
      'manutencoes',
      'funcionarios',
      'visitantes',
      'bercos',
      'rotas_maritimas',
      'delegacoes_supervisor',
      'inspecoes',
      'inspecao_itens',
      'tipos_carga',
      'leituras_qr_code',
      'logs_alteracoes',
      'trail_decisoes',
      'emergencias'
    ],

    _realtimeChannel: null,
    _realtimeDebounce: null,

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
              // Debounce: rajadas de mudanças viram uma única notificação,
              // e NÃO retransmitimos via BroadcastChannel — cada aba possui
              // sua própria assinatura Realtime, o que evita loops/duplas
              // notificações entre abas do mesmo dispositivo.
              if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);
              this._realtimeDebounce = setTimeout(() => {
                window.dispatchEvent(new CustomEvent('nexus_data_changed', {
                  detail: { entity: tabela, origem: 'realtime' }
                }));
              }, 400);
            }
          );
        });
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[NexusRepository] Sincronização Realtime ativa.');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[NexusRepository] Realtime indisponível (' + status + '); mantendo polling de 10s como fallback.');
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

  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('nexus_')) {
      window.dispatchEvent(new CustomEvent('nexus_data_changed', { detail: { entity: e.key } }));
    }
  });

  // Sincronização periódica e em foco da janela para atualização entre dispositivos/abas (Item 2)
  window.addEventListener('focus', () => {
    NexusRepository.notifyChange('window_focus');
  });

  setInterval(() => {
    NexusRepository.notifyChange('periodic_sync');
  }, 60000);

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
