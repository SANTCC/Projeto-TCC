/**
 * Edge Function Handler: Leitor e Decodificador de QR Codes Operacionais (scanner-qr)
 *
 * Processa leituras de QR Codes em tempo real no pátio / navio:
 *  1. Identificação do Token: Decodifica tokens de cargas (QR-CRG-*), contêineres (QR-CNT-*),
 *     navios (QR-NAV-*) e guindastes (QR-GND-*).
 *  2. Validação da Entidade: Busca o registro real na tabela correspondente.
 *  3. Matriz de Ações por Cargo (RBAC): Calcula quais ações operacionais estão liberadas
 *     para o operador autenticado (Estivador, Conferente, Inspetor, Arrumador, Supervisor).
 *  4. Log de Leitura (RF 5.8): Registra automaticamente a leitura no log de alterações.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    const token = typeof body?.token_or_code === 'string' ? body.token_or_code.trim() : '';
    const codigo = typeof body?.codigo_individual === 'string' ? body.codigo_individual.trim() : '';

    if (!token) {
      return json({ ok: false, error: 'O token ou código do QR Code (token_or_code) é obrigatório.' }, 400);
    }

    const admin = criarCliente(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Identity Validation
    let funcionario = null;
    if (codigo) {
      const { data } = await admin
        .from('funcionarios')
        .select('id, nome, cargo, ativo, codigo_individual')
        .eq('codigo_individual', codigo)
        .maybeSingle();
      if (data && data.ativo !== false) funcionario = data;
    }

    const cargo = funcionario?.cargo || 'GUEST';

    // 2. Identify Entity Type and Raw Code
    let tipoEntidade = 'DESCONHECIDO';
    let codigoLimpo = token;

    if (token.startsWith('QR-CRG-') || token.startsWith('CRG-')) {
      tipoEntidade = 'CARGA';
      codigoLimpo = token.replace('QR-CRG-', '').replace('CRG-', '');
    } else if (token.startsWith('QR-CNT-') || token.startsWith('CNT-')) {
      tipoEntidade = 'CONTAINER';
      codigoLimpo = token.replace('QR-CNT-', '').replace('CNT-', '');
    } else if (token.startsWith('QR-NAV-') || token.startsWith('IMO-') || token.startsWith('NAV-')) {
      tipoEntidade = 'NAVIO';
      codigoLimpo = token.replace('QR-NAV-', '').replace('NAV-', '');
    } else if (token.startsWith('QR-GND-') || token.startsWith('GND-')) {
      tipoEntidade = 'GUINDASTE';
      codigoLimpo = token.replace('QR-GND-', '').replace('GND-', '');
    } else {
      // Tenta determinar por padrão numérico/heurística
      if (/^\d+$/.test(token)) {
        tipoEntidade = 'CARGA'; // padrão ID primário
      }
    }

    // 3. Fetch Entity Details from DB
    let registroEncontrado = null;
    try {
      if (tipoEntidade === 'CARGA') {
        let q = admin.from('cargas').select('*, navios(nome), containers(numero_identificacao)');
        if (/^\d+$/.test(codigoLimpo)) q = q.eq('id', Number(codigoLimpo));
        else q = q.eq('qr_code_url', token);
        const { data } = await q.maybeSingle();
        registroEncontrado = data;
      } else if (tipoEntidade === 'CONTAINER') {
        let q = admin.from('containers').select('*, navios(nome)');
        if (/^\d+$/.test(codigoLimpo)) q = q.eq('id', Number(codigoLimpo));
        else q = q.eq('numero_identificacao', codigoLimpo);
        const { data } = await q.maybeSingle();
        registroEncontrado = data;
      } else if (tipoEntidade === 'NAVIO') {
        let q = admin.from('navios').select('*');
        if (/^\d+$/.test(codigoLimpo)) q = q.eq('id', Number(codigoLimpo));
        else q = q.or(`imo.eq.${codigoLimpo},numero_imo.eq.${codigoLimpo},nome.ilike.%${codigoLimpo}%`);
        const { data } = await q.maybeSingle();
        registroEncontrado = data;
      } else if (tipoEntidade === 'GUINDASTE') {
        let q = admin.from('equipamentos').select('*');
        if (/^\d+$/.test(codigoLimpo)) q = q.eq('id', Number(codigoLimpo));
        else q = q.eq('numero_identificacao', codigoLimpo);
        const { data } = await q.maybeSingle();
        registroEncontrado = data;
      }
    } catch (e) {
      console.warn('scanner-qr: falha ao buscar registro:', e);
    }

    // 4. Calculate Role-Permitted Actions
    const acoesPermitidas = [];

    if (cargo === 'ESTIVADOR') {
      acoesPermitidas.push('MOVIMENTAR_CARGA', 'VER_POSICAO_PATIO');
    } else if (cargo === 'CONFERENTE_CARGA') {
      acoesPermitidas.push('REGISTRAR_RECEBIMENTO', 'CONFERIR_CONDICOES_SAIDA');
    } else if (cargo === 'INSPETOR') {
      acoesPermitidas.push('CHECKLIST_INSPECAO', 'REGISTRAR_AVARIA', 'SOLICITAR_MANUTENCAO');
    } else if (cargo === 'ARRUMADOR_CONSERTADOR') {
      acoesPermitidas.push('MARCAR_PRONTA_ENTREGA', 'REPARAR_EMBALAGEM');
    } else if (cargo === 'PLANEJADOR_PATIO_NAVIOS') {
      acoesPermitidas.push('ATUALIZAR_ESTADO', 'VINCULAR_BERCO', 'PLANEJAR_DESCARGA');
    } else if (['SUPERVISOR_GERENTE_OPERACOES', 'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(cargo)) {
      acoesPermitidas.push('LIBERAR_SAIDA', 'CANCELAR_ENTREGA', 'VISUALIZAR_VINCULOS', 'GERAR_RELATORIO');
    } else if (cargo === 'TECNICO_PORTOS') {
      acoesPermitidas.push('GERENCIAR_CODIGO', 'VISUALIZAR_DADOS_TECNICOS');
    }

    // Target Redirect Page (RF 5.7)
    let paginaRedirecionamento = 'cargas.html';
    if (cargo === 'ESTIVADOR') paginaRedirecionamento = 'cargas.html?aba=movimentacao';
    else if (cargo === 'CONFERENTE_CARGA') paginaRedirecionamento = 'cargas.html?aba=recebimento';
    else if (cargo === 'INSPETOR') paginaRedirecionamento = 'inspecao.html';
    else if (cargo === 'ARRUMADOR_CONSERTADOR') paginaRedirecionamento = 'cargas.html?aba=pronta';
    else if (cargo === 'SUPERVISOR_GERENTE_OPERACOES') paginaRedirecionamento = 'embarcacoes.html';

    // 5. Automatic Log Registration (RF 5.8)
    if (funcionario) {
      try {
        await admin.from('logs_alteracoes').insert({
          data_hora: new Date().toISOString(),
          funcionario_id: funcionario.id,
          cargo: funcionario.cargo,
          codigo_individual: funcionario.codigo_individual,
          entidade_tipo: tipoEntidade !== 'DESCONHECIDO' ? tipoEntidade : 'CARGA',
          entidade_id: registroEncontrado?.id ? String(registroEncontrado.id) : token,
          tipo_alteracao: 'CONSULTA',
          detalhes: {
            descricao: `Leitura de QR Code (${token}) via scanner móvel`,
            qr_code: token,
            entidade: tipoEntidade
          }
        });
      } catch (e) {
        console.warn('scanner-qr: falha ao gravar log de leitura:', e);
      }
    }

    return json({
      ok: true,
      qr_code: token,
      entidade_tipo: tipoEntidade,
      encontrado: Boolean(registroEncontrado),
      registro: registroEncontrado,
      operador: funcionario ? { nome: funcionario.nome, cargo: funcionario.cargo } : null,
      acoes_permitidas: acoesPermitidas,
      redirecionamento_sugerido: paginaRedirecionamento
    });
  };
}
