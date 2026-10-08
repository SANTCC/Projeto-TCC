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
    }
  };
})();
