/**
 * Integridade operacional — NexusPort
 *
 * Regras compartilhadas entre as telas (Cargas & Pátio, Embarcações & GPS,
 * Manutenção). Em todas elas o Supabase é a FONTE DA VERDADE; o cache local
 * (localStorage) só é usado no modo sem banco configurado.
 *
 *  1. Disponibilidade de equipamentos (guindastes, contêineres e navios):
 *     o estado persistido no banco (estado / estado_operacional) e as ordens de
 *     serviço APROVADAS (em execução) são conferidos imediatamente antes de
 *     registrar a operação — uma tela aberta há horas ou uma chamada direta à
 *     função não consegue usar um equipamento que entrou em manutenção.
 *
 *  2. Exclusão real: `delete ... select('id')` confere quantas linhas o banco
 *     removeu. Zero linhas com o registro ainda presente = exclusão recusada
 *     pela RLS (antes era exibida como sucesso e o registro "voltava").
 *
 *  3. Berços: a ocupação é lida do banco e gravada de forma atômica
 *     (RPC nexus_ocupar_berco ou UPDATE condicional `estado = 'LIVRE'`), o que
 *     impede dois navios no mesmo berço mesmo em acessos simultâneos.
 *
 * Migração correspondente: supabase/migrations/20261011000000_integridade_operacional.sql
 */
(function (global) {
  'use strict';

  const MIGRACAO = 'supabase/migrations/20261011000000_integridade_operacional.sql';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function cliente() {
    return global.nexusSupabase || null;
  }

  function ehUuid(valor) {
    return UUID_RE.test(String(valor || ''));
  }

  function maiusculo(valor) {
    return String(valor == null ? '' : valor).trim().toUpperCase();
  }

  /** Código sem hífens/espaços: "ABC-123-DEF" e "ABC123DEF" são o mesmo equipamento. */
  function normalizarCodigo(valor) {
    return maiusculo(valor).replace(/[^A-Z0-9]/g, '');
  }

  function lerCache(chave) {
    try {
      const lista = JSON.parse(global.localStorage.getItem(chave) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (e) {
      return [];
    }
  }

  const ESTADO_ROTULO = {
    OPERANTE: 'Operante',
    EM_MANUTENCAO: 'Em manutenção',
    AGENDADO_PARA_REFORMA: 'Agendado para reforma',
    APROVADO_PARA_REFORMA: 'Aprovado para reforma',
    EM_REFORMA: 'Em reforma',
    DISPONIVEL: 'Operante'
  };

  function rotuloEstado(estado) {
    const chave = maiusculo(estado);
    return ESTADO_ROTULO[chave] || (chave ? chave.replace(/_/g, ' ').toLowerCase() : 'desconhecido');
  }

  /**
   * Configuração por tipo de equipamento. `cache` é a chave do localStorage
   * usada pelas telas; `rotuloOs` é o prefixo gravado na descrição da OS
   * (manutencao.js) quando a FK da OS não foi preenchida.
   */
  const TIPOS = {
    GUINDASTE: {
      tabela: 'guindastes', colEstado: 'estado', colCodigo: 'numero_identificacao', fk: 'guindaste_id',
      nome: 'guindaste', cache: 'nexus_guindastes_list', rotuloOs: 'Guindaste'
    },
    CONTAINER: {
      tabela: 'containers', colEstado: 'estado', colCodigo: 'numero_identificacao', fk: 'container_id',
      nome: 'contêiner', cache: 'nexus_containers_list', rotuloOs: 'Contêiner'
    },
    NAVIO: {
      tabela: 'navios', colEstado: 'estado_operacional', colCodigo: 'numero_imo', fk: 'navio_id',
      nome: 'navio', cache: 'nexus_navios_list', rotuloOs: 'Navio'
    }
  };

  function configDo(tipo) {
    const cfg = TIPOS[maiusculo(tipo)];
    if (!cfg) throw new Error(`Tipo de equipamento desconhecido: ${tipo}`);
    return cfg;
  }

  /** Normaliza uma linha do banco ou do cache local para o formato comum. */
  function registroComum(tipo, linha) {
    const cfg = configDo(tipo);
    const l = linha || {};
    const codigo = l[cfg.colCodigo] || l.identificacao || l.imo || l.numero_imo || l.numero_identificacao || '';
    const estadoCru = l[cfg.colEstado] || (tipo === 'NAVIO' ? l.estado : l.estado) || 'OPERANTE';
    const estado = maiusculo(estadoCru) === 'DISPONIVEL' ? 'OPERANTE' : maiusculo(estadoCru);
    return {
      id: l.rawDbId || l.id || null,
      codigo: String(codigo || ''),
      nome: l.nome || String(codigo || ''),
      estado,
      linha: l
    };
  }

  /**
   * A OS (manutencoes) pertence ao equipamento? Usa a FK quando preenchida e,
   * para OS antigas sem FK, a identificação gravada na descrição
   * ("[OS-ID][PRIO] Guindaste: ABC123DEF - ...", "... Navio: Jaguar - ...").
   */
  function osPertenceAo(tipo, os, reg) {
    const cfg = configDo(tipo);
    if (!os) return false;
    if (os[cfg.fk] && reg.id && String(os[cfg.fk]) === String(reg.id)) return true;
    if (os[cfg.fk]) return false; // FK aponta para outro equipamento
    if (os.entidade_tipo && maiusculo(os.entidade_tipo) !== maiusculo(tipo)) return false;
    const descricao = String(os.descricao || '');
    const alvos = [reg.codigo, tipo === 'NAVIO' ? reg.nome : null].filter(Boolean);
    return alvos.some((alvo) => {
      const marcador = new RegExp(`${cfg.rotuloOs}[^:]*:\\s*${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|-|,)`, 'i');
      if (marcador.test(descricao)) return true;
      return normalizarCodigo(descricao).includes(normalizarCodigo(alvo)) && normalizarCodigo(alvo).length >= 6;
    });
  }

  function motivoIndisponivel(tipo, reg, osAtiva) {
    if (!reg) return 'não foi encontrado no cadastro';
    if (reg.estado !== 'OPERANTE') return `em manutenção (${rotuloEstado(reg.estado)})`;
    if (osAtiva) return 'com ordem de serviço de manutenção em execução';
    return null;
  }

  function mensagemErro(error) {
    if (!error) return 'erro desconhecido';
    return error.message || error.details || String(error);
  }

  /** OS em execução (APROVADA). Falha de leitura não bloqueia: o estado do equipamento continua valendo. */
  async function lerOsAtivas(client) {
    try {
      const { data, error } = await client
        .from('manutencoes')
        .select('id, entidade_tipo, descricao, status, navio_id, container_id, guindaste_id')
        .eq('status', 'APROVADA');
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[NexusIntegridade] Não foi possível ler as ordens de serviço ativas:', e);
      return [];
    }
  }

  /**
   * Lista os equipamentos de um tipo com a disponibilidade calculada.
   * @returns {Promise<{fonte:'supabase'|'local'|'erro', erro?:string, itens:Array}>}
   */
  async function listarDisponibilidade(tipo) {
    const cfg = configDo(tipo);
    const client = cliente();
    if (!client) {
      const itens = lerCache(cfg.cache).map((l) => {
        const reg = registroComum(tipo, l);
        const motivo = motivoIndisponivel(tipo, reg, false);
        return Object.assign(reg, { disponivel: !motivo, motivo });
      });
      return { fonte: 'local', itens };
    }
    try {
      const { data, error } = await client.from(cfg.tabela).select('*');
      if (error) throw error;
      const osAtivas = await lerOsAtivas(client);
      const itens = (Array.isArray(data) ? data : []).map((l) => {
        const reg = registroComum(tipo, l);
        const os = osAtivas.find((o) => osPertenceAo(tipo, o, reg)) || null;
        const motivo = motivoIndisponivel(tipo, reg, os);
        return Object.assign(reg, { disponivel: !motivo, motivo, os });
      });
      return { fonte: 'supabase', itens };
    } catch (e) {
      return { fonte: 'erro', erro: mensagemErro(e), itens: [] };
    }
  }

  /**
   * Confere no banco, no momento da operação, se o equipamento pode ser usado.
   * Falha FECHADA: se o banco está configurado mas não responde, a operação é
   * bloqueada com a explicação (nunca se usa um estado possivelmente antigo).
   *
   * @param {'GUINDASTE'|'CONTAINER'|'NAVIO'} tipo
   * @param {string|{id?:string,codigo?:string,nome?:string}} ref
   * @returns {Promise<{disponivel:boolean, motivo:string|null, fonte:string, registro:object|null}>}
   */
  async function verificarDisponibilidade(tipo, ref) {
    const cfg = configDo(tipo);
    const r = (ref && typeof ref === 'object') ? ref : { codigo: ref };
    const client = cliente();

    if (!client) {
      const lista = lerCache(cfg.cache).map((l) => registroComum(tipo, l));
      const reg = lista.find((x) => (r.id && String(x.id) === String(r.id))
        || (r.codigo && normalizarCodigo(x.codigo) === normalizarCodigo(r.codigo))
        || (r.nome && maiusculo(x.nome) === maiusculo(r.nome))) || null;
      // Modo sem banco: o cache pode não conhecer o equipamento — só bloqueia
      // quando o estado local conhecido indica manutenção.
      const motivo = reg ? motivoIndisponivel(tipo, reg, false) : null;
      return { disponivel: !motivo, motivo, fonte: 'local', registro: reg };
    }

    try {
      let linhas = [];
      if (r.id && ehUuid(r.id)) {
        const { data, error } = await client.from(cfg.tabela).select('*').eq('id', r.id).limit(1);
        if (error) throw error;
        linhas = data || [];
      }
      if (linhas.length === 0 && r.codigo) {
        const { data, error } = await client.from(cfg.tabela).select('*').eq(cfg.colCodigo, String(r.codigo).trim()).limit(1);
        if (error) throw error;
        linhas = data || [];
        if (linhas.length === 0) {
          // Registros com/sem hífen: compara pela forma normalizada
          const { data: todos, error: erroTodos } = await client.from(cfg.tabela).select('*');
          if (erroTodos) throw erroTodos;
          linhas = (todos || []).filter((l) => normalizarCodigo(l[cfg.colCodigo]) === normalizarCodigo(r.codigo)).slice(0, 1);
        }
      }
      if (linhas.length === 0 && r.nome && tipo === 'NAVIO') {
        const { data, error } = await client.from(cfg.tabela).select('*').ilike('nome', String(r.nome).trim()).limit(1);
        if (error) throw error;
        linhas = data || [];
      }
      const reg = linhas[0] ? registroComum(tipo, linhas[0]) : null;
      let os = null;
      if (reg && reg.estado === 'OPERANTE') {
        const osAtivas = await lerOsAtivas(client);
        os = osAtivas.find((o) => osPertenceAo(tipo, o, reg)) || null;
      }
      const motivo = motivoIndisponivel(tipo, reg, os);
      return { disponivel: !motivo, motivo, fonte: 'supabase', registro: reg };
    } catch (e) {
      return {
        disponivel: false,
        motivo: `não foi possível confirmar a disponibilidade no banco de dados (${mensagemErro(e)})`,
        fonte: 'erro',
        registro: null
      };
    }
  }

  // ------------------------------------------------------------------
  // Exclusão com verificação
  // ------------------------------------------------------------------

  /** Mensagem pt-BR para erros do PostgREST/PostgreSQL em operações de escrita. */
  function descreverErroBanco(error) {
    const codigo = error && error.code ? String(error.code) : '';
    if (codigo === '23503') {
      return 'existem registros vinculados que impedem a operação (integridade referencial do banco de dados)';
    }
    if (codigo === '42501') {
      return `o banco de dados recusou a operação por permissão (RLS). Aplique a migração ${MIGRACAO}`;
    }
    if (codigo === 'P0001') {
      return mensagemErro(error);
    }
    if (/failed to fetch|network|timeout/i.test(mensagemErro(error))) {
      return 'falha de conexão com o banco de dados';
    }
    return mensagemErro(error);
  }

  /**
   * Exclui linhas de `tabela` onde `coluna = valor` e confirma a remoção.
   * @returns {Promise<{ok:boolean, local?:boolean, removidos:number, codigo?:string, mensagem?:string, erro?:object}>}
   */
  async function excluirRegistro(tabela, coluna, valor) {
    const client = cliente();
    if (!client) return { ok: true, local: true, removidos: 0 };
    try {
      const { data, error } = await client.from(tabela).delete().eq(coluna, valor).select('id');
      if (error) {
        return { ok: false, removidos: 0, codigo: error.code || 'ERRO', erro: error, mensagem: descreverErroBanco(error) };
      }
      const removidos = Array.isArray(data) ? data.length : 0;
      if (removidos > 0) return { ok: true, removidos };

      // 0 linhas: o registro não existia ou a RLS recusou silenciosamente.
      const { data: aindaExiste, error: erroLeitura } = await client.from(tabela).select('id').eq(coluna, valor).limit(1);
      if (!erroLeitura && Array.isArray(aindaExiste) && aindaExiste.length > 0) {
        return {
          ok: false,
          removidos: 0,
          codigo: 'RLS_DELETE',
          mensagem: `o banco de dados não autorizou a exclusão (política de DELETE ausente em "${tabela}"). Aplique a migração ${MIGRACAO} no Supabase`
        };
      }
      return { ok: true, removidos: 0, codigo: 'JA_EXCLUIDO' };
    } catch (e) {
      return { ok: false, removidos: 0, codigo: 'ERRO', erro: e, mensagem: descreverErroBanco(e) };
    }
  }

  /**
   * Chama uma função RPC. `ausente: true` quando a função ainda não existe no
   * banco (migração não aplicada) — o chamador usa o caminho alternativo.
   */
  async function chamarRpc(nome, argumentos) {
    const client = cliente();
    if (!client || typeof client.rpc !== 'function') return { ausente: true };
    try {
      const { data, error } = await client.rpc(nome, argumentos);
      if (error) {
        const ausente = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(mensagemErro(error));
        return ausente ? { ausente: true } : { erro: error, mensagem: descreverErroBanco(error) };
      }
      return { data };
    } catch (e) {
      return { erro: e, mensagem: descreverErroBanco(e) };
    }
  }

  /** Resolve o registro do equipamento no banco (id + código + nome). */
  async function resolverNoBanco(tipo, alvo) {
    const cfg = configDo(tipo);
    const client = cliente();
    const a = (alvo && typeof alvo === 'object') ? alvo : { codigo: alvo };
    if (a.id && ehUuid(a.id)) {
      const { data, error } = await client.from(cfg.tabela).select('*').eq('id', a.id).limit(1);
      if (error) throw error;
      if (data && data[0]) return registroComum(tipo, data[0]);
    }
    if (a.codigo) {
      const { data, error } = await client.from(cfg.tabela).select('*').eq(cfg.colCodigo, String(a.codigo).trim()).limit(1);
      if (error) throw error;
      if (data && data[0]) return registroComum(tipo, data[0]);
    }
    if (a.nome && tipo === 'NAVIO') {
      const { data, error } = await client.from(cfg.tabela).select('*').eq('nome', String(a.nome).trim()).limit(1);
      if (error) throw error;
      if (data && data[0]) return registroComum(tipo, data[0]);
    }
    return null;
  }

  /** Ordens de serviço ativas (SOLICITADA ou APROVADA) do equipamento. */
  async function osAtivasDo(tipo, reg) {
    const client = cliente();
    if (!client || !reg) return [];
    const { data, error } = await client
      .from('manutencoes')
      .select('id, entidade_tipo, descricao, status, navio_id, container_id, guindaste_id')
      .in('status', ['SOLICITADA', 'APROVADA']);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).filter((os) => osPertenceAo(tipo, os, reg));
  }

  /**
   * Grava o estado de manutenção do equipamento, localizado pelo id (FK da OS)
   * ou pela identificação, com verificação (.select): o chamador só informa
   * sucesso se o banco confirmou. Ao liberar (OPERANTE), o equipamento continua
   * indisponível se ainda houver OUTRA ordem de serviço em execução (APROVADA).
   *
   * @param {'GUINDASTE'|'CONTAINER'|'NAVIO'} tipo
   * @param {{id?:string,codigo?:string,nome?:string}} alvo
   * @param {string} estado  ex.: 'EM_MANUTENCAO', 'EM_REFORMA', 'OPERANTE'
   * @param {object} [extras] colunas adicionais (ex.: data_ultima_manutencao)
   * @param {{ignorarOsId?:string}} [opcoes]
   * @returns {Promise<{ok:boolean, codigo:string, mensagem?:string, registro?:object, local?:boolean}>}
   */
  async function definirEstadoEquipamento(tipo, alvo, estado, extras, opcoes) {
    const cfg = configDo(tipo);
    const client = cliente();
    if (!client) return { ok: true, local: true, codigo: 'SEM_BANCO' };
    try {
      const reg = await resolverNoBanco(tipo, alvo);
      if (!reg) {
        return { ok: false, codigo: 'NAO_ENCONTRADO', mensagem: `o ${cfg.nome} não foi encontrado no banco de dados` };
      }
      if (estado === 'OPERANTE') {
        const ignorar = opcoes && opcoes.ignorarOsId ? String(opcoes.ignorarOsId) : null;
        const outras = (await osAtivasDo(tipo, reg)).filter((o) => o.status === 'APROVADA' && String(o.id) !== ignorar);
        if (outras.length > 0) {
          return { ok: true, codigo: 'MANTIDO_EM_MANUTENCAO', registro: reg, mensagem: `o ${cfg.nome} continua em manutenção: há outra ordem de serviço em execução` };
        }
      }
      const payload = Object.assign({ [cfg.colEstado]: estado }, extras || {});
      const { data, error } = await client.from(cfg.tabela).update(payload).eq('id', reg.id).select('id');
      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) {
        return { ok: false, codigo: 'NAO_CONFIRMADO', registro: reg, mensagem: `o banco de dados não confirmou a alteração do estado do ${cfg.nome} (verifique as políticas de UPDATE em "${cfg.tabela}")` };
      }
      return { ok: true, codigo: 'ATUALIZADO', registro: reg };
    } catch (e) {
      return { ok: false, codigo: 'ERRO', mensagem: descreverErroBanco(e) };
    }
  }

  /**
   * Desvincula (FK = null) o histórico de manutenção do equipamento antes da
   * exclusão. Em bancos sem a migração as FKs ainda são ON DELETE CASCADE e
   * apagariam todo o histórico junto com o equipamento.
   */
  async function preservarHistoricoManutencao(tipo, id) {
    const cfg = configDo(tipo);
    const client = cliente();
    if (!client || !ehUuid(id)) return { ok: true };
    for (const tabela of ['manutencoes', 'historico_manutencoes']) {
      const { error } = await client.from(tabela).update({ [cfg.fk]: null }).eq(cfg.fk, id);
      if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
        return { ok: false, mensagem: `não foi possível preservar o histórico de manutenção (${descreverErroBanco(error)})` };
      }
    }
    return { ok: true };
  }

  /**
   * Exclusão segura de guindaste ou contêiner no banco:
   *  - bloqueia (com justificativa) equipamento com OS ativa;
   *  - preserva o histórico de manutenção (desvincula, não apaga);
   *  - confere as linhas removidas (RLS/FK geram mensagem clara).
   * Bloqueios de negócio específicos da tela (tarefas, cargas) ficam no chamador.
   */
  async function excluirEquipamento(tipo, alvo) {
    const cfg = configDo(tipo);
    const client = cliente();
    if (!client) return { ok: true, local: true, removidos: 0 };
    try {
      const reg = await resolverNoBanco(tipo, alvo);
      if (!reg) return { ok: true, removidos: 0, codigo: 'JA_EXCLUIDO' };
      const ativas = await osAtivasDo(tipo, reg);
      if (ativas.length > 0) {
        return {
          ok: false,
          codigo: 'OS_ATIVA',
          mensagem: `${cfg.nome === 'contêiner' ? 'o contêiner' : 'o ' + cfg.nome} ${reg.codigo || reg.nome} possui ${ativas.length} ordem(ns) de serviço de manutenção ativa(s). Conclua ou recuse a OS em Manutenção antes de excluí-lo`
        };
      }
      const historico = await preservarHistoricoManutencao(tipo, reg.id);
      if (!historico.ok) return { ok: false, codigo: 'HISTORICO', mensagem: historico.mensagem };
      const resultado = await excluirRegistro(cfg.tabela, 'id', reg.id);
      return Object.assign({ registro: reg }, resultado);
    } catch (e) {
      return { ok: false, codigo: 'ERRO', erro: e, mensagem: descreverErroBanco(e) };
    }
  }

  // ------------------------------------------------------------------
  // Berços (public.bercos) — Supabase como fonte da verdade
  // ------------------------------------------------------------------

  function clienteBercos() {
    if (global.NexusSupabaseUtils && typeof global.NexusSupabaseUtils.clientePara === 'function') {
      return global.NexusSupabaseUtils.clientePara('bercos');
    }
    return cliente();
  }

  /** @returns {Promise<{ok:boolean, bercos:Array, mensagem?:string}>} */
  async function carregarBercos() {
    const client = clienteBercos();
    if (!client) return { ok: false, local: true, bercos: [] };
    try {
      const { data, error } = await client.from('bercos').select('*').order('nome', { ascending: true });
      if (error) {
        if (global.NexusSupabaseUtils) global.NexusSupabaseUtils.registrarErroTabela('bercos', error);
        return { ok: false, bercos: [], mensagem: descreverErroBanco(error) };
      }
      return { ok: true, bercos: Array.isArray(data) ? data : [] };
    } catch (e) {
      return { ok: false, bercos: [], mensagem: descreverErroBanco(e) };
    }
  }

  function mesmoNavioNoBerco(berco, navio) {
    if (!berco || !navio) return false;
    if (berco.navio_id && navio.id && String(berco.navio_id) === String(navio.id)) return true;
    if (berco.navio_imo && navio.imo && normalizarCodigo(berco.navio_imo) === normalizarCodigo(navio.imo)) return true;
    return false;
  }

  /** Libera (LIVRE) os berços ocupados pelo navio, exceto `exceto` (id do berço). */
  async function liberarBercosDoNavio(navio, exceto) {
    const client = clienteBercos();
    if (!client || !navio) return { ok: true, local: !client, liberados: 0 };
    const livre = { estado: 'LIVRE', navio_nome: null, navio_imo: null, navio_id: null };
    let liberados = 0;
    try {
      const filtros = [];
      if (navio.id && ehUuid(navio.id)) filtros.push(['navio_id', navio.id]);
      if (navio.imo) filtros.push(['navio_imo', navio.imo]);
      for (const [coluna, valor] of filtros) {
        let q = client.from('bercos').update(livre).eq('estado', 'OCUPADO').eq(coluna, valor);
        if (exceto) q = q.neq('id', exceto);
        const { data, error } = await q.select('id');
        if (error) throw error;
        liberados += Array.isArray(data) ? data.length : 0;
      }
      return { ok: true, liberados };
    } catch (e) {
      return { ok: false, liberados, mensagem: descreverErroBanco(e) };
    }
  }

  /**
   * Ocupa o berço com o navio de forma atômica, revalidando o estado no banco.
   * Transferência (navio já em outro berço) libera o berço anterior.
   * @param {string} bercoId  ex.: 'BERCO-03'
   * @param {{id?:string, nome:string, imo:string}} navio
   * @returns {Promise<{ok:boolean, codigo:string, mensagem?:string, local?:boolean}>}
   */
  async function ocuparBerco(bercoId, navio) {
    const client = clienteBercos();
    if (!client) return { ok: false, local: true, codigo: 'SEM_BANCO' };

    // 1) Caminho transacional (migração aplicada)
    const rpc = await chamarRpc('nexus_ocupar_berco', {
      p_berco_id: bercoId,
      p_navio_id: navio && ehUuid(navio.id) ? navio.id : null,
      p_navio_imo: navio ? (navio.imo || null) : null
    });
    if (!rpc.ausente) {
      if (rpc.erro) return { ok: false, codigo: 'ERRO', mensagem: rpc.mensagem };
      const r = rpc.data || {};
      return { ok: r.ok === true, codigo: r.codigo || (r.ok ? 'VINCULADO' : 'ERRO'), mensagem: r.mensagem || null };
    }

    // 2) Caminho alternativo: UPDATE condicional (atômico no PostgreSQL)
    try {
      const { data: atual, error: erroLeitura } = await client.from('bercos').select('*').eq('id', bercoId).limit(1);
      if (erroLeitura) throw erroLeitura;
      const berco = Array.isArray(atual) ? atual[0] : null;
      if (!berco) return { ok: false, codigo: 'BERCO_NAO_ENCONTRADO', mensagem: 'O berço selecionado não existe no banco de dados.' };
      if (berco.estado === 'OCUPADO' && mesmoNavioNoBerco(berco, navio)) return { ok: true, codigo: 'JA_VINCULADO' };
      if (berco.estado !== 'LIVRE') {
        return {
          ok: false,
          codigo: 'BERCO_INDISPONIVEL',
          mensagem: berco.estado === 'OCUPADO'
            ? `O ${berco.nome} já está ocupado pelo navio ${berco.navio_nome || berco.navio_imo || '(sem nome)'}.`
            : `O ${berco.nome} está indisponível (${berco.estado}).`
        };
      }
      const ocupacao = {
        estado: 'OCUPADO',
        navio_nome: navio.nome || null,
        navio_imo: navio.imo || null,
        navio_id: ehUuid(navio.id) ? navio.id : null
      };
      const { data: ocupados, error } = await client.from('bercos')
        .update(ocupacao).eq('id', bercoId).eq('estado', 'LIVRE').select('id');
      if (error) throw error;
      if (!Array.isArray(ocupados) || ocupados.length === 0) {
        return { ok: false, codigo: 'BERCO_INDISPONIVEL', mensagem: `O ${berco.nome} acabou de ser ocupado por outro navio. Escolha outro berço.` };
      }
      const liberacao = await liberarBercosDoNavio(navio, bercoId);
      if (!liberacao.ok) console.warn('[NexusIntegridade] Berço anterior não liberado:', liberacao.mensagem);
      return { ok: true, codigo: 'VINCULADO' };
    } catch (e) {
      return { ok: false, codigo: 'ERRO', mensagem: descreverErroBanco(e) };
    }
  }

  global.NexusIntegridade = {
    MIGRACAO,
    ehUuid,
    normalizarCodigo,
    rotuloEstado,
    registroComum,
    osPertenceAo,
    listarDisponibilidade,
    verificarDisponibilidade,
    descreverErroBanco,
    excluirRegistro,
    excluirEquipamento,
    resolverNoBanco,
    osAtivasDo,
    preservarHistoricoManutencao,
    definirEstadoEquipamento,
    chamarRpc,
    carregarBercos,
    ocuparBerco,
    liberarBercosDoNavio,
    mesmoNavioNoBerco
  };
})(typeof window !== 'undefined' ? window : globalThis);
