/**
 * Edge Function Handler: Log de acessos de usuários autenticados (log-acesso)
 *
 * Registra, para cada acesso de um usuário autenticado, o IP de origem e o user agent.
 *  1. Autenticação: o app não usa Supabase Auth. A identidade é o `codigo_individual`
 *     do funcionário, que precisa existir e estar ativo na tabela `funcionarios`.
 *     Sem identidade válida, nada é gravado (401).
 *  2. IP: vem dos cabeçalhos de proxy (cf-connecting-ip, x-real-ip, x-forwarded-for).
 *     Os valores do cliente nunca são confiados além disso: o IP é só registrado.
 *  3. User agent: cabeçalho `user-agent`, truncado em 512 caracteres.
 *  4. Persistência: insere em `log_acessos_usuarios` com a service role.
 *
 * Corpo (JSON): { codigo_individual: string, pagina?: string }
 *
 * O parse/normalização de IP vem de `ipaddr.js` (mesmo utilitário compartilhado
 * do gate de VPN), injetado por `criarHandler`. A validação anterior aceitava
 * `::::` como IPv6 válido e gravava o valor no log.
 */

import { criarUtilitariosIp } from '../_shared/ip.js';

// Reexportado para os testes montarem os utilitários com a mesma biblioteca.
export { criarUtilitariosIp };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_USER_AGENT = 512;
const MAX_PAGINA = 120;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Trunca o user agent no tamanho aceito pela coluna. */
export function extrairUserAgent(headers) {
  const ua = headers && typeof headers.get === 'function' ? headers.get('user-agent') : null;
  if (typeof ua !== 'string') return null;
  const limpo = ua.trim();
  return limpo ? limpo.slice(0, MAX_USER_AGENT) : null;
}

export function criarHandler({ criarCliente, env, ipaddr }) {
  const { extrairIp: ipDoCabecalho } = criarUtilitariosIp(ipaddr);
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
      body = JSON.parse(await req.text());
    } catch (e) {
      return json({ ok: false, error: 'Corpo da requisição inválido.' }, 400);
    }

    const codigo = typeof body?.codigo_individual === 'string' ? body.codigo_individual.trim() : '';
    if (!codigo) {
      return json({ ok: false, error: 'Usuário não autenticado.' }, 401);
    }

    const admin = criarCliente(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: funcionario, error: erroBusca } = await admin
      .from('funcionarios')
      .select('id, ativo')
      .eq('codigo_individual', codigo)
      .maybeSingle();

    if (erroBusca) {
      return json({ ok: false, error: 'Falha ao validar o usuário.' }, 500);
    }
    if (!funcionario || funcionario.ativo === false) {
      return json({ ok: false, error: 'Usuário não autenticado.' }, 401);
    }

    const pagina = typeof body?.pagina === 'string' ? body.pagina.trim().slice(0, MAX_PAGINA) || null : null;

    const { error: erroInsert } = await admin.from('log_acessos_usuarios').insert({
      funcionario_id: funcionario.id,
      ip: ipDoCabecalho(req.headers),
      user_agent: extrairUserAgent(req.headers),
      pagina,
    });

    if (erroInsert) {
      return json({ ok: false, error: 'Falha ao registrar o acesso.' }, 500);
    }

    return json({ ok: true });
  };
}
