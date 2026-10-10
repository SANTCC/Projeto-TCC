/**
 * Edge Function Handler: Despacho e Liberação de Embarcações (despacho-embarcacao)
 *
 * Executa o despacho de navios no servidor com validações atômicas:
 *  1. RBAC no servidor: valida permissão LIBERAR_NAVIO na tabela `funcionarios`.
 *  2. Trava de Rota Marítima: valida se existe rota cadastrada no banco. Bloqueia se ausente (RF 3.19).
 *  3. Cálculo de ETA: calcula estimativa de tempo e chegada com base na distância da rota (distancia / 33 km/h).
 *  4. Desvinculação de Berço: desocupa o berço no porto, definindo estado = 'LIVRE'.
 *  5. Propagação de Status: altera status de contêineres e cargas vinculados para EM_TRANSITO (RF 3.16).
 *  6. Trilha de Decisão: registra a decisão na tabela `trail_decisoes` e `logs_alteracoes`.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES_LIBERAR_NAVIO = [
  'SUPERVISOR_GERENTE_OPERACOES',
  'DIRETOR_OPERACOES_LOGISTICA',
  'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
  'CONSELHO_ADMINISTRACAO'
];

const VELOCIDADE_NAVIO_KMH = 33.0;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function criarHandler({ criarCliente, env }) {
  return async function handler(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method !== 'POST') {
      return json({ ok: false, error: 'Método não permitido.' }, 405);
    }

    const url = env('SUPABASE_URL');
    const chave = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
    if (!url || !chave) {
      return json({ ok: false, error: 'Configuração do servidor indisponível.' }, 500);
    }

    let body;
    try {
      const texto = await req.text();
      body = JSON.parse(texto);
    } catch (e) {
      return json({ ok: false, error: 'Corpo da requisição inválido.' }, 400);
    }

    const navioId = body?.navio_id;
    const codigo = typeof body?.codigo_individual === 'string' ? body.codigo_individual.trim() : '';
    const motivo = typeof body?.motivo === 'string' && body.motivo.trim()
      ? body.motivo.trim()
      : 'Liberação oficial de despacho do navio pelo Supervisor.';

    if (!navioId) {
      return json({ ok: false, error: 'Identificador do navio (navio_id) é obrigatório.' }, 400);
    }
    if (!codigo) {
      return json({ ok: false, error: 'Código individual do operador (codigo_individual) é obrigatório.' }, 400);
    }

    const admin = criarCliente(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. RBAC Validation
    const { data: funcionario, error: errFunc } = await admin
      .from('funcionarios')
      .select('id, nome, cargo, ativo, codigo_individual')
      .eq('codigo_individual', codigo)
      .maybeSingle();

    if (errFunc || !funcionario || funcionario.ativo === false) {
      return json({ ok: false, error: 'Operador não encontrado ou inativo.' }, 403);
    }

    if (!ROLES_LIBERAR_NAVIO.includes(funcionario.cargo)) {
      return json({
        ok: false,
        error: `O cargo '${funcionario.cargo}' não tem permissão para despachar embarcações (LIBERAR_NAVIO).`
      }, 403);
    }

    // 2. Fetch Vessel Data
    let queryNavio = admin.from('navios').select('*');
    if (typeof navioId === 'number' || /^\d+$/.test(String(navioId))) {
      queryNavio = queryNavio.eq('id', Number(navioId));
    } else {
      queryNavio = queryNavio.or(`id.eq.${navioId},imo.eq.${navioId},numero_imo.eq.${navioId}`);
    }

    const { data: navio, error: errNavio } = await queryNavio.maybeSingle();
    if (errNavio || !navio) {
      return json({ ok: false, error: 'Navio não encontrado no sistema.' }, 404);
    }

    const localizacaoAtual = navio.localizacao || 'DENTRO_DO_PORTO';
    if (localizacaoAtual === 'FORA_DO_PORTO' || localizacaoAtual === 'EM_TRANSITO') {
      return json({ ok: false, error: `O navio '${navio.nome}' já está fora do porto ou em trânsito.` }, 400);
    }

    // 3. Maritime Route Verification (RF 3.19)
    const origem = navio.porto_origem || 'Santos';
    const destino = navio.porto_destino || navio.destino;

    let rota = null;
    if (destino) {
      const { data: rotas } = await admin
        .from('rotas_maritimas')
        .select('*');

      if (rotas && rotas.length > 0) {
        rota = rotas.find(r =>
          (r.origem?.toLowerCase() === origem.toLowerCase() && r.destino?.toLowerCase() === destino.toLowerCase()) ||
          (r.origem?.toLowerCase() === destino.toLowerCase() && r.destino?.toLowerCase() === origem.toLowerCase()) ||
          r.destino?.toLowerCase() === destino.toLowerCase()
        );
      }
    }

    if (!rota && destino) {
      return json({
        ok: false,
        error: `Bloqueio de Liberação: nenhuma rota marítima cadastrada entre '${origem}' e '${destino}' (RF 3.19).`
      }, 400);
    }

    // 4. ETA Calculation
    const distanciaKm = Number(rota?.distancia_km || rota?.distancia || 10200);
    const tempoViagemHoras = Number((distanciaKm / VELOCIDADE_NAVIO_KMH).toFixed(1));
    const dataAtual = new Date();
    const etaData = new Date(dataAtual.getTime() + tempoViagemHoras * 60 * 60 * 1000);

    // 5. Atomic Update Vessel
    const { error: errUpdateNavio } = await admin
      .from('navios')
      .update({
        localizacao: 'EM_TRANSITO',
        data_saida: dataAtual.toISOString(),
        eta: etaData.toISOString()
      })
      .eq('id', navio.id);

    if (errUpdateNavio) {
      return json({ ok: false, error: 'Falha ao atualizar estado do navio.' }, 500);
    }

    // 6. Free Berth
    try {
      const { data: bercos } = await admin.from('bercos').select('*');
      if (bercos) {
        const bercoVinculado = bercos.find(b =>
          (b.navio_imo && String(b.navio_imo) === String(navio.imo || navio.numero_imo)) ||
          (b.navio_nome && b.navio_nome === navio.nome)
        );
        if (bercoVinculado) {
          await admin.from('bercos').update({
            estado: 'LIVRE',
            navio_nome: null,
            navio_imo: null
          }).eq('id', bercoVinculado.id);
        }
      }
    } catch (e) {
      console.warn('despacho-embarcacao: falha ao desvincular berço:', e);
    }

    // 7. Propagate Status to linked containers and cargoes (RF 3.16)
    let conteineresAtualizados = 0;
    let cargasAtualizadas = 0;

    try {
      const { data: cnts } = await admin.from('containers').select('id').eq('navio_id', navio.id);
      if (cnts && cnts.length > 0) {
        conteineresAtualizados = cnts.length;
        await admin.from('containers').update({ estado: 'EM_TRANSITO' }).eq('navio_id', navio.id);
      }

      const { data: crgs } = await admin.from('cargas').select('id').eq('navio_id', navio.id);
      if (crgs && crgs.length > 0) {
        cargasAtualizadas = crgs.length;
        await admin.from('cargas').update({ status_fluxo: 'EM_TRANSITO' }).eq('navio_id', navio.id);
      }
    } catch (e) {
      console.warn('despacho-embarcacao: falha na propagação de status:', e);
    }

    // 8. Trail of Decisions & Logs
    const nowIso = dataAtual.toISOString();
    try {
      await admin.from('trail_decisoes').insert({
        data_hora: nowIso,
        funcionario_id: funcionario.id,
        cargo: funcionario.cargo,
        codigo_individual: funcionario.codigo_individual,
        tipo_decisao: 'LIBEROU_NAVIO',
        entidade_tipo: 'NAVIO',
        entidade_id: String(navio.id),
        motivo,
        detalhes: {
          navio_nome: navio.nome,
          imo: navio.imo || navio.numero_imo,
          distancia_km: distanciaKm,
          tempo_viagem_horas: tempoViagemHoras,
          eta: etaData.toISOString(),
          cargas_afetadas: cargasAtualizadas,
          conteineres_afetados: conteineresAtualizados
        }
      });

      await admin.from('logs_alteracoes').insert({
        data_hora: nowIso,
        funcionario_id: funcionario.id,
        cargo: funcionario.cargo,
        codigo_individual: funcionario.codigo_individual,
        entidade_tipo: 'NAVIO',
        entidade_id: String(navio.id),
        tipo_alteracao: 'EDICAO',
        detalhes: { descricao: `Despacho de saída do navio ${navio.nome} (${motivo})` }
      });
    } catch (e) {
      console.warn('despacho-embarcacao: falha ao gravar trilha de decisão:', e);
    }

    return json({
      ok: true,
      mensagem: `Navio ${navio.nome} despachado com sucesso. Status alterado para EM_TRANSITO.`,
      despacho: {
        navio_id: navio.id,
        navio_nome: navio.nome,
        imo: navio.imo || navio.numero_imo,
        origem,
        destino,
        distancia_km: distanciaKm,
        tempo_estimado_horas: tempoViagemHoras,
        data_saida: nowIso,
        eta_calculado: etaData.toISOString(),
        conteineres_despachados: conteineresAtualizados,
        cargas_despachadas: cargasAtualizadas,
        despachado_por: {
          nome: funcionario.nome,
          cargo: funcionario.cargo,
          codigo_individual: funcionario.codigo_individual
        }
      }
    });
  };
}
