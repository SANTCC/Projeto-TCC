/**
 * Cliente Supabase Centralizado - NexusPort
 * Inicializa o cliente do Supabase utilizando as credenciais definidas em js/config.js
 * ou variáveis globais/ambiente se fornecidas.
 */
(function () {
  const config = window.NEXUS_CONFIG || {};
  let supabaseClient = null;

  const urlParams = typeof window !== 'undefined' && window.location ? new URLSearchParams(window.location.search) : null;
  const url = config.SUPABASE_URL || window.SUPABASE_URL || (typeof localStorage !== 'undefined' && localStorage.getItem('SUPABASE_URL')) || (urlParams && urlParams.get('supabase_url'));
  const key = config.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || (typeof localStorage !== 'undefined' && localStorage.getItem('SUPABASE_ANON_KEY')) || (urlParams && urlParams.get('supabase_key'));

  if (typeof supabase !== 'undefined' && url && key) {
    try {
      supabaseClient = supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true
        }
      });
      console.log("[NexusPort] Cliente Supabase inicializado com sucesso.");
    } catch (err) {
      console.warn("[NexusPort] Erro ao inicializar o cliente Supabase:", err);
    }
  } else {
    console.log("[NexusPort] Aguardando credenciais do Supabase para inicialização.");
  }

  window.nexusSupabase = supabaseClient;

  /**
   * Utilitários de resiliência para tabelas ainda não provisionadas no banco.
   * Evita que um erro PGRST205 ("Could not find the table 'public.x' in the
   * schema cache") quebre a tela: a tabela é marcada como indisponível e a
   * aplicação segue operando com o cache local (localStorage).
   */
  const tabelasAusentes = new Set();

  window.NexusSupabaseUtils = {
    /** Detecta erro de tabela inexistente / fora do cache do PostgREST */
    isTabelaAusenteError: function (error) {
      if (!error) return false;
      const code = error.code || '';
      const message = String(error.message || '');
      return code === 'PGRST205' || code === '42P01' || /Could not find the table/i.test(message);
    },

    /** Registra o erro e, se for tabela ausente, desativa novas chamadas remotas */
    registrarErroTabela: function (tabela, error) {
      if (!this.isTabelaAusenteError(error)) {
        if (error) console.warn(`[NexusPort] Erro na tabela '${tabela}':`, error.message || error);
        return false;
      }
      if (!tabelasAusentes.has(tabela)) {
        tabelasAusentes.add(tabela);
        console.warn(
          `[NexusPort] A tabela 'public.${tabela}' não existe no Supabase. ` +
          `Operando apenas com dados locais. Aplique a migração ` +
          `SPECs/migrations/001_create_bercos.sql no SQL Editor do Supabase para habilitar a persistência.`
        );
      }
      return true;
    },

    /** Indica se a tabela já foi identificada como ausente nesta sessão */
    tabelaIndisponivel: function (tabela) {
      return tabelasAusentes.has(tabela);
    },

    /** Cliente pronto para uso em uma tabela específica (ou null) */
    clientePara: function (tabela) {
      if (!window.nexusSupabase) return null;
      if (tabelasAusentes.has(tabela)) return null;
      return window.nexusSupabase;
    }
  };
})();
