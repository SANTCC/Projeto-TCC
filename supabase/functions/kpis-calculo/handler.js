/**
 * Edge Function Handler: Cálculos Consolidados de KPIs Operacionais e Estratégicos (kpis-calculo)
 *
 * Suporta GET e POST. Valida identidade via `codigo_individual` ou `matricula` na tabela `funcionarios`.
 * Calcula com autoridade de servidor:
 *  - Ocupação de berços (% e quantidade)
 *  - Tempo médio de permanência das cargas no pátio (horas)
 *  - Taxa de aprovação/recusa de inspeções técnicas
 *  - Alertas de manutenção preventiva (navios/contêineres sem manutenção há >3 anos)
 *  - Valor total declarado de cargas no pátio (restrito às visões estratégicas da Direção/Conselho)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const CARGOS_ESTRATEGICOS = [
  'DIRETOR_OPERACOES_LOGISTICA',
  'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
  'CONSELHO_ADMINISTRACAO'
];

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

    if (req.method !== 'GET' && req.method !== 'POST') {
      return json({ ok: false, error: 'Método não permitido.' }, 405);
    }

    const url = env('SUPABASE_URL');
    const chave = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
    if (!url || !chave) {
      return json({ ok: false, error: 'Configuração do servidor indisponível.' }, 500);
    }

    let codigo = '';
    let matricula = '';

    if (req.method === 'POST') {
      try {
        const texto = await req.text();
        if (texto.trim()) {
          const body = JSON.parse(texto);
          if (body && typeof body.codigo_individual === 'string') codigo = body.codigo_individual.trim();
          if (body && typeof body.matricula === 'string') matricula = body.matricula.trim();
        }
      } catch (e) {
        return json({ ok: false, error: 'JSON inválido no corpo da requisição.' }, 400);
      }
    } else {
      const parsedUrl = new URL(req.url);
      codigo = (parsedUrl.searchParams.get('codigo_individual') || parsedUrl.searchParams.get('codigo') || '').trim();
      matricula = (parsedUrl.searchParams.get('matricula') || '').trim();
    }

    const admin = criarCliente(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

    let funcionario = null;
    if (codigo || matricula) {
      let query = admin.from('funcionarios').select('id, nome, cargo, ativo');
      if (codigo) query = query.eq('codigo_individual', codigo);
      else if (matricula) query = query.eq('matricula', matricula);

      const { data } = await query.maybeSingle();
      if (data && data.ativo !== false) funcionario = data;
    }

    const cargo = funcionario?.cargo || null;
    const isEstrategico = cargo ? CARGOS_ESTRATEGICOS.includes(cargo) : false;

    // 1. Ocupação de Berços
    let bercos = [];
    try {
      const { data } = await admin.from('bercos').select('id, nome, estado, navio_nome');
      bercos = data || [];
    } catch (e) { /* fallback */ }

    const totalBercos = bercos.length;
    const bercosOcupados = bercos.filter(b => b.estado === 'OCUPADO').length;
    const taxaOcupacaoBercos = totalBercos > 0 ? Number(((bercosOcupados / totalBercos) * 100).toFixed(1)) : 0;

    // 2. Cargas & Tempo Médio de Permanência
    let cargas = [];
    try {
      const { data } = await admin.from('cargas').select('id, status_fluxo, valor_declarado, data_entrada, created_at');
      cargas = data || [];
    } catch (e) { /* fallback */ }

    const agora = new Date();
    let tempoPermanenciaTotalHoras = 0;
    let cargasContadasPermanencia = 0;

    let valorDeclaradoTotalPatios = 0;

    for (const c of cargas) {
      const dataInicio = c.data_entrada || c.created_at;
      if (dataInicio && c.status_fluxo !== 'ENTREGUE' && c.status_fluxo !== 'CANCELADA') {
        const dt = new Date(dataInicio);
        if (!isNaN(dt.getTime())) {
          const horas = Math.max(0, (agora.getTime() - dt.getTime()) / (1000 * 60 * 60));
          tempoPermanenciaTotalHoras += horas;
          cargasContadasPermanencia++;
        }
      }
      if (c.status_fluxo === 'ARMAZENAGEM' || c.status_fluxo === 'PRONTA_PARA_ENTREGA') {
        valorDeclaradoTotalPatios += (Number(c.valor_declarado) || 0);
      }
    }

    const permanenciaMediaHoras = cargasContadasPermanencia > 0
      ? Number((tempoPermanenciaTotalHoras / cargasContadasPermanencia).toFixed(1))
      : 0;

    // 3. Inspeções & Taxa de Aprovação
    let inspecoes = [];
    try {
      const { data } = await admin.from('inspecoes').select('id, resultado, ativa');
      inspecoes = data || [];
    } catch (e) { /* fallback */ }

    const inspecoesAtivas = inspecoes.filter(i => i.ativa !== false);
    const totalInspecoes = inspecoesAtivas.length;
    const aprovadas = inspecoesAtivas.filter(i => i.resultado === 'APROVADA').length;
    const recusadas = inspecoesAtivas.filter(i => i.resultado === 'RECUSADA').length;
    const taxaAprovacao = totalInspecoes > 0 ? Number(((aprovadas / totalInspecoes) * 100).toFixed(1)) : 0;

    // 4. Manutenção Preventiva Sugerida (>3 anos)
    let navios = [];
    let conteineres = [];
    try {
      const { data: nData } = await admin.from('navios').select('id, nome, data_ultima_manutencao, data_fabricacao');
      const { data: cData } = await admin.from('containers').select('id, numero_identificacao, data_ultima_manutencao, data_fabricacao');
      navios = nData || [];
      conteineres = cData || [];
    } catch (e) { /* fallback */ }

    const tresAnosAtras = new Date();
    tresAnosAtras.setFullYear(tresAnosAtras.getFullYear() - 3);

    const naviosPreventiva = navios.filter(n => {
      const refDate = n.data_ultima_manutencao || n.data_fabricacao;
      return refDate && new Date(refDate) < tresAnosAtras;
    });

    const conteineresPreventiva = conteineres.filter(c => {
      const refDate = c.data_ultima_manutencao || c.data_fabricacao;
      return refDate && new Date(refDate) < tresAnosAtras;
    });

    return json({
      ok: true,
      timestamp: agora.toISOString(),
      solicitante: funcionario ? { nome: funcionario.nome, cargo: funcionario.cargo } : null,
      kpis: {
        bercos: {
          total: totalBercos,
          ocupados: bercosOcupados,
          livres: totalBercos - bercosOcupados,
          taxa_ocupacao_pct: taxaOcupacaoBercos
        },
        cargas: {
          total_registradas: cargas.length,
          permanencia_media_horas: permanenciaMediaHoras,
          valor_declarado_total: isEstrategico ? valorDeclaradoTotalPatios : 0,
          valor_declarado_visivel: isEstrategico
        },
        inspecoes: {
          total_ativas: totalInspecoes,
          aprovadas,
          recusadas,
          taxa_aprovacao_pct: taxaAprovacao
        },
        manutencao_preventiva_sugerida: {
          total_equipamentos: naviosPreventiva.length + conteineresPreventiva.length,
          navios: naviosPreventiva.map(n => ({ id: n.id, nome: n.nome })),
          conteineres: conteineresPreventiva.map(c => ({ id: c.id, numero: c.numero_identificacao }))
        }
      }
    });
  };
}
