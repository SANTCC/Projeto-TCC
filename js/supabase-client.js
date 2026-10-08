/**
 * Cliente Supabase Centralizado - NexusPort
 * Inicializa o cliente do Supabase utilizando as credenciais definidas em js/config.js
 * ou variáveis globais/ambiente se fornecidas.
 *
 * Além do cliente, expõe `window.NexusSupabaseUtils`: utilitários de resiliência
 * e DIAGNÓSTICO para tabelas que ainda não foram provisionadas no banco.
 *
 * Caso real atendido por este módulo (erro relatado no painel Network):
 *   GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
 *   -> HTTP 404 (PostgREST: PGRST205 — "Could not find the table
 *      'public.emergencias' in the schema cache")
 *
 * Sem esse tratamento, cada tela que consulta uma tabela inexistente dispara um
 * erro vermelho no console e a sensação de sistema quebrado. Aqui a tabela é
 * marcada como indisponível, a aplicação continua operando com o cache local e
 * a mensagem aponta EXATAMENTE qual migração SQL deve ser aplicada.
 */
(function () {
  const config = window.NEXUS_CONFIG || {};
  let supabaseClient = null;
  // Network debug (optional): js/net-debug.js, loaded before this file, logs every
  // client -> server connection to the console. Without it nothing changes.
  const netDebug = window.NexusNetDebug || null;

  const urlParams = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : null;
  const url = config.SUPABASE_URL || window.SUPABASE_URL || (typeof localStorage !== 'undefined' && localStorage.getItem('SUPABASE_URL')) || (urlParams && urlParams.get('supabase_url'));
  const key = config.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || (typeof localStorage !== 'undefined' && localStorage.getItem('SUPABASE_ANON_KEY')) || (urlParams && urlParams.get('supabase_key'));

  // Only used by the network debug log (js/net-debug.js).
  function origemUrl() {
    if (config.SUPABASE_URL) return 'js/config.js (window.NEXUS_CONFIG)';
    if (window.SUPABASE_URL) return 'window.SUPABASE_URL';
    if (typeof localStorage !== 'undefined' && localStorage.getItem('SUPABASE_URL')) return 'localStorage';
    if (urlParams && urlParams.get('supabase_url')) return 'query string ?supabase_url=';
    return 'unknown';
  }
  function motivoSemCliente() {
    if (typeof supabase === 'undefined') {
      return 'supabase-js library not loaded (the CDN script failed or was blocked). No server connection will be made.';
    }
    if (!url) return 'Supabase URL missing (js/config.js missing or empty). No server connection will be made.';
    return 'Supabase anon key missing (js/config.js missing or empty). No server connection will be made.';
  }

  if (typeof supabase !== 'undefined' && url && key) {
    try {
      const clientOptions = {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      };
      if (netDebug) {
        // fetch (REST, Auth, Functions, Storage), WebSocket (Realtime) and GoTrue internals.
        const debugOptions = netDebug.clientOptions();
        clientOptions.auth = Object.assign({}, clientOptions.auth, debugOptions.auth);
        clientOptions.global = debugOptions.global;
        clientOptions.realtime = debugOptions.realtime;
      }
      supabaseClient = supabase.createClient(url, key, clientOptions);
      console.log("[NexusPort] Cliente Supabase inicializado com sucesso.");
      if (netDebug) netDebug.clientCreated({ url: url, key: key, urlSource: origemUrl() });
    } catch (err) {
      console.warn("[NexusPort] Erro ao inicializar o cliente Supabase:", err);
      if (netDebug) netDebug.note('error', 'createClient() failed', err);
    }
  } else {
    console.log("[NexusPort] Aguardando credenciais do Supabase para inicialização.");
    if (netDebug) netDebug.note('warn', motivoSemCliente());
  }

  window.nexusSupabase = supabaseClient;

  // ------------------------------------------------------------------
  // Tabelas provisionadas por migração — a mensagem de erro aponta o
  // arquivo .sql exato que cria a tabela (o "porquê" do 404 / PGRST205).
  // ------------------------------------------------------------------
  const MIGRACOES_CONHECIDAS = {
    bercos: 'SPECs/migrations/001_create_bercos.sql',
    emergencias: 'supabase/migrations/20261008000000_emergencias_fix_404.sql',
    panic_webhook_config: 'supabase/migrations/20261008000000_emergencias_fix_404.sql'
  };

  const COMO_APLICAR =
    'Aplique a migração no painel do Supabase (SQL Editor > New query > colar > Run) ' +
    'ou pela CLI (supabase link --project-ref <ref> && supabase db push). ' +
    'Se o erro PGRST205 persistir por alguns segundos, use Settings > API > Restart server.';

  // Tabelas já identificadas como ausentes nesta sessão: evita repetir
  // requisições condenadas ao 404 e repetir o aviso no console.
  const tabelasAusentes = new Set();

  function descricaoTabela(tabela) {
    const migracao = MIGRACOES_CONHECIDAS[tabela];
    return migracao
      ? `A tabela 'public.${tabela}' não existe no Supabase (erro PGRST205 / HTTP 404). ` +
        `Operando apenas com dados locais. Aplique ${migracao} para habilitar a persistência. ` + COMO_APLICAR
      : `A tabela 'public.${tabela}' não existe no Supabase (erro PGRST205 / HTTP 404). ` +
        `Operando apenas com dados locais. ` + COMO_APLICAR;
  }

  const utils = {
    /**
     * Detecta erro de tabela inexistente / fora do cache do PostgREST.
     * Aceita tanto o objeto de erro do supabase-js v2 ({ code, message, status })
     * quanto o corpo devolvido pelo PostgREST.
     */
    isTabelaAusenteError: function (error) {
      if (!error) return false;
      const code = String(error.code || '');
      const message = String(error.message || error.error_description || '');
      const status = Number(error.status || (error.context && error.context.status) || 0);
      return (
        code === 'PGRST205' || // tabela fora do schema cache (caso do 404 em emergencias)
        code === 'PGRST202' || // função/RPC não encontrada
        code === '42P01' ||    // undefined_table (PostgreSQL)
        status === 404 ||      // PostgREST responde 404 quando a rota/tabela não existe
        /Could not find the table/i.test(message) ||
        /relation .* does not exist/i.test(message)
      );
    },

    /**
     * Registra o erro e, se for tabela ausente, desativa novas chamadas remotas.
     * Retorna true quando o erro foi de tabela inexistente.
     */
    registrarErroTabela: function (tabela, error) {
      if (!this.isTabelaAusenteError(error)) {
        if (error) console.warn(`[NexusPort] Erro na tabela '${tabela}':`, error.message || error);
        return false;
      }
      if (!tabelasAusentes.has(tabela)) {
        tabelasAusentes.add(tabela);
        console.warn(`[NexusPort] ${descricaoTabela(tabela)}`);
      }
      return true;
    },

    /** Marca manualmente uma tabela como indisponível (usado nos fallbacks). */
    marcarTabelaAusente: function (tabela, error) {
      if (!tabelasAusentes.has(tabela)) {
        tabelasAusentes.add(tabela);
        console.warn(`[NexusPort] ${descricaoTabela(tabela)}`);
      }
      return false;
    },

    /**
     * Remove a marca de indisponível — chamado quando uma verificação
     * posterior encontra a tabela (o operador aplicou a migração).
     */
    liberarTabela: function (tabela) {
      if (tabelasAusentes.delete(tabela)) {
        console.log(`[NexusPort] Tabela 'public.${tabela}' disponível novamente — persistência remota reativada.`);
      }
      return true;
    },

    /** Indica se a tabela já foi identificada como ausente nesta sessão */
    tabelaIndisponivel: function (tabela) {
      return tabelasAusentes.has(tabela);
    },

    /** Lista as tabelas marcadas como ausentes nesta sessão (diagnóstico) */
    tabelasIndisponiveis: function () {
      return Array.from(tabelasAusentes);
    },

    /**
     * Normaliza um berço para o formato aceito pelas constraints de public.bercos.
     *
     * Motivo: a constraint `bercos_vinculo_navio_check` (ver
     * SPECs/migrations/001_create_bercos.sql e SPECs/schema.sql) exige que
     *   - berço NÃO ocupado não carregue resíduo de vínculo (navio_* nulos);
     *   - berço OCUPADO identifique o navio por `navio_nome` ou `navio_imo`.
     * Cache local legado (berços marcados OCUPADO por carga, sem navio) ou ids
     * fora do padrão (`BERCO-6`) faziam o upsert — inclusive o lote de 15 berços
     * em js/embarcacoes.js — abortar com:
     *   23514: new row for relation "bercos" violates check constraint
     *          "bercos_vinculo_navio_check"
     * como uma única linha inválida derruba a instrução inteira, o painel
     * deixava de sincronizar. Esta função devolve sempre uma linha gravável.
     *
     * @param {Object} berco Registro vindo do cache local ou do formulário.
     * @returns {{payload: Object|null, corrigido: boolean, motivo: string|null}}
     *          `payload: null` quando a linha não tem como ser identificada
     *          (sem nome e/ou sem número de berço): deve ser ignorada.
     */
    normalizarBerco: function (berco) {
      const registro = berco || {};
      const limpar = function (valor) {
        if (valor === null || valor === undefined) return null;
        const texto = String(valor).trim();
        return texto === '' ? null : texto;
      };

      const nome = limpar(registro.nome);
      if (!nome) return { payload: null, corrigido: false, motivo: 'berço sem nome' };

      // `id` precisa casar com ^BERCO-[0-9]{2}$ (bercos_id_formato_check).
      let id = limpar(registro.id) || '';
      if (!/^BERCO-[0-9]{2}$/.test(id)) {
        const digitos = nome.replace(/\D/g, '');
        id = digitos ? `BERCO-${String(parseInt(digitos, 10)).padStart(2, '0')}` : '';
      }
      if (!/^BERCO-[0-9]{2}$/.test(id)) {
        return { payload: null, corrigido: false, motivo: `sem identificador BERCO-NN para "${nome}"` };
      }

      const estadoInformado = limpar(registro.estado);
      const estadoBruto = estadoInformado ? estadoInformado.toUpperCase() : 'LIVRE';
      const estadoValido = ['LIVRE', 'OCUPADO', 'MANUTENCAO'].indexOf(estadoBruto) >= 0;
      let estado = estadoValido ? estadoBruto : 'LIVRE';

      let navioNome = limpar(registro.navio_nome);
      let navioImo = limpar(registro.navio_imo);
      let navioId = limpar(registro.navio_id);
      let motivo = null;

      if (estado === 'OCUPADO' && !navioNome && !navioImo) {
        // Caso do erro 23514: berço OCUPADO sem nenhuma identificação de navio.
        estado = 'LIVRE';
        motivo = 'estado OCUPADO sem navio_nome/navio_imo — gravado como LIVRE';
      } else if (!estadoValido) {
        motivo = `estado "${estadoBruto}" fora do domínio esperado — gravado como LIVRE`;
      }

      if (estado !== 'OCUPADO') {
        // Berço livre/manutenção não guarda resíduo de vínculo.
        if (navioNome || navioImo || navioId) {
          motivo = motivo || 'resíduo de vínculo em berço não ocupado — limpo';
        }
        navioNome = null;
        navioImo = null;
        navioId = null;
      } else if (navioId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(navioId)) {
        // A FK bercos_navio_id_fkey só aceita uuid de public.navios; o front
        // mantém o nome/IMO como snapshot quando o navio ainda é local.
        motivo = motivo || 'navio_id não é UUID de public.navios — gravado como null';
        navioId = null;
      }

      const payload = {
        id: id,
        nome: nome,
        estado: estado,
        navio_nome: navioNome,
        navio_imo: navioImo,
        navio_id: navioId
      };

      const original = {
        id: limpar(registro.id),
        nome: limpar(registro.nome),
        estado: estadoInformado,
        navio_nome: limpar(registro.navio_nome),
        navio_imo: limpar(registro.navio_imo),
        navio_id: limpar(registro.navio_id)
      };

      return {
        payload: payload,
        corrigido: JSON.stringify(payload) !== JSON.stringify(original),
        motivo: motivo
      };
    },

    /** Cliente pronto para uso em uma tabela específica (ou null) */
    clientePara: function (tabela) {
      if (!window.nexusSupabase) return null;
      if (tabelasAusentes.has(tabela)) return null;
      return window.nexusSupabase;
    },

    /** Arquivo de migração que provisiona a tabela (ou null) */
    migracaoDaTabela: function (tabela) {
      return MIGRACOES_CONHECIDAS[tabela] || null;
    },

    /**
     * Verifica uma tabela com uma requisição HEAD barata e atualiza o estado.
     * É o que permite "auto-curar" a sessão quando a migração é aplicada com
     * a tela já aberta (o retry do botão de pânico usa este método).
     *
     * @returns {Promise<{tabela: string, disponivel: boolean, erro: Object|null,
     *                    aviso: string, migracao: string|null}>}
     */
    diagnosticar: function (tabela) {
      const sb = window.nexusSupabase;
      const migracao = MIGRACOES_CONHECIDAS[tabela] || null;

      if (!sb) {
        return Promise.resolve({
          tabela: tabela,
          disponivel: false,
          erro: null,
          aviso: 'Supabase não configurado (js/config.js ausente ou sem credenciais). Aplicação em modo local.',
          migracao: migracao
        });
      }

      const self = this;
      return sb
        .from(tabela)
        .select('*', { count: 'exact', head: true })
        .then(function (res) {
          const error = res && res.error;
          if (!error) {
            self.liberarTabela(tabela);
            return { tabela: tabela, disponivel: true, erro: null, aviso: null, migracao: migracao };
          }
          self.registrarErroTabela(tabela, error);
          return {
            tabela: tabela,
            disponivel: false,
            erro: error,
            aviso: descricaoTabela(tabela),
            migracao: migracao
          };
        })
        .catch(function (e) {
          return {
            tabela: tabela,
            disponivel: false,
            erro: e,
            aviso: `Falha de rede ao verificar 'public.${tabela}': ${e && e.message ? e.message : e}`,
            migracao: migracao
          };
        });
    },

    /** Aviso textual padronizado sobre uma tabela ausente (UI/diagnóstico) */
    avisoTabela: function (tabela) {
      return descricaoTabela(tabela);
    }
  };

  window.NexusSupabaseUtils = utils;
})();
