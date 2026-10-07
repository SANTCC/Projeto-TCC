// ============================================================
// NexusPort — Botão de Pânico GLOBAL (Edge Function "panic-alert")
// ------------------------------------------------------------
// Evento de servidor acionado pelo botão de pânico existente
// (manutencao.html → js/panic-realtime.js). Responsabilidades:
//
//  1. RBAC no servidor: valida quem acionou contra a tabela
//     `funcionarios` (cargo precisa ter permissão ACIONAR_EMERGENCIA,
//     mesma matriz de js/auth-guard.js).
//  2. Persistência: registra/resolve a emergência na tabela
//     `emergencias` (estado ATIVA/RESOLVIDA) para que clientes que
//     conectem depois também vejam o alarme.
//  3. Broadcast (WebSocket): envia mensagem via Supabase Realtime
//     para TODOS os clientes conectados no canal "nexus-emergency".
//     `channel.send()` antes de `subscribe()` usa a API HTTP do
//     Realtime, que entrega o evento via WebSocket aos assinantes.
//  4. Webhook OPCIONAL (DESLIGADO POR PADRÃO): se a linha de
//     `panic_webhook_config` tiver enabled=true + url válida,
//     dispara um POST JSON para a URL configurada (timeout de 5s).
//     O resultado volta no corpo da resposta, nunca no broadcast.
//
// Deploy (sem verificação de JWT, pois o app usa sessão própria
// baseada em codigo_individual e não Supabase Auth):
//   supabase functions deploy panic-alert --no-verify-jwt
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CHANNEL_NAME = "nexus-emergency";
const BROADCAST_EVENT = "panic";
const TERMINAL = "STS-01";
const WEBHOOK_TIMEOUT_MS = 5000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Mesma matriz de RBAC de js/auth-guard.js (ação ACIONAR_EMERGENCIA)
const ROLES_ACIONAR = [
  "INSPETOR",
  "DIRETOR_OPERACOES_LOGISTICA",
  "DIRETOR_PRESIDENTE_SUPERINTENDENTE",
  "CONSELHO_ADMINISTRACAO",
];
// Desativação também permitida ao Supervisor/Gerente de Operações
// (mesma regra da página manutencao.html, que ele já acessa).
const ROLES_DESATIVAR = [...ROLES_ACIONAR, "SUPERVISOR_GERENTE_OPERACOES"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    "";
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL ou a chave service role (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY) não estão disponíveis no ambiente da Edge Function.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolve a identidade de quem acionou. Prioriza o registro real da
 * tabela `funcionarios` (cargo/nome vindo do banco); se não houver
 * registro (contas locais de demonstração), usa a identidade enviada
 * pelo cliente, marcando verificado_no_banco=false.
 */
async function resolveIdentity(
  admin: ReturnType<typeof createClient>,
  acionadoPor: Record<string, unknown> | undefined,
) {
  const claimed = acionadoPor ?? {};
  const codigo =
    typeof claimed.codigo_individual === "string"
      ? claimed.codigo_individual.trim()
      : "";
  const matricula =
    typeof claimed.matricula === "string" ? claimed.matricula.trim() : "";

  let funcionario: any = null;
  try {
    if (codigo) {
      const { data } = await admin
        .from("funcionarios")
        .select("*")
        .eq("codigo_individual", codigo)
        .maybeSingle();
      funcionario = data;
    }
    if (!funcionario && matricula) {
      const { data } = await admin
        .from("funcionarios")
        .select("*")
        .eq("matricula", matricula)
        .maybeSingle();
      funcionario = data;
    }
    if (funcionario && funcionario.ativo === false) funcionario = null;
  } catch (err) {
    console.warn("[panic-alert] Falha ao consultar funcionarios:", err);
  }

  return {
    funcionario_id: funcionario?.id ?? null,
    nome: funcionario?.nome ?? (claimed.nome as string) ??
      "Operador não identificado",
    cargo: funcionario?.cargo ?? (claimed.cargo as string) ?? null,
    codigo_individual: funcionario?.codigo_individual ?? codigo ??
      (claimed.codigo as string) ?? null,
    matricula: funcionario?.matricula ?? matricula ?? null,
    verificado_no_banco: Boolean(funcionario),
  };
}

/**
 * Envia o evento para TODOS os clientes conectados (WebSocket).
 * `channel.send()` sem `subscribe()` usa o endpoint HTTP de broadcast
 * do Realtime, que repassa a mensagem via WebSocket aos assinantes
 * do canal "nexus-emergency".
 */
async function broadcastToClients(
  admin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
) {
  const channel = admin.channel(CHANNEL_NAME);
  try {
    const status = await channel.send({
      type: "broadcast",
      event: BROADCAST_EVENT,
      payload,
    });
    return { ok: status === "ok", status };
  } catch (error: any) {
    console.error("[panic-alert] Erro no broadcast Realtime:", error);
    return {
      ok: false,
      status: "error",
      error: String(error?.message ?? error),
    };
  } finally {
    try {
      await admin.removeChannel(channel);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Lê a configuração do webhook opcional. PADRÃO: DESLIGADO.
 * Se a tabela ainda não existir (migração não aplicada) ou não houver
 * linha, retorna enabled=false — o webhook nunca dispara por padrão.
 */
async function getWebhookConfig(admin: ReturnType<typeof createClient>) {
  try {
    const { data } = await admin
      .from("panic_webhook_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        id: data.id ?? null,
        enabled: data.enabled === true,
        url: typeof data.url === "string" && data.url.trim() ? data.url.trim() : null,
      };
    }
  } catch (error) {
    console.warn("[panic-alert] Falha ao ler panic_webhook_config:", error);
  }
  return { id: null, enabled: false, url: null };
}

async function fireWebhook(url: string, payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let preview = "";
    try {
      preview = (await resp.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    return {
      fired: true,
      ok: resp.ok,
      status: resp.status,
      response_preview: preview,
    };
  } catch (error: any) {
    const aborted = error?.name === "AbortError";
    return {
      fired: true,
      ok: false,
      status: null,
      error: aborted
        ? `Timeout de ${WEBHOOK_TIMEOUT_MS}ms ao chamar o webhook`
        : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  let admin: ReturnType<typeof createClient>;
  try {
    admin = getAdminClient();
  } catch (error: any) {
    return json(
      { ok: false, error: String(error?.message ?? error) },
      500,
    );
  }

  // GET: estado atual (apoio para diagnóstico/clients sem acesso à tabela)
  if (req.method === "GET") {
    let ativa: any = null;
    try {
      const { data } = await admin
        .from("emergencias")
        .select("*")
        .eq("estado", "ATIVA")
        .order("data_hora", { ascending: false })
        .limit(1)
        .maybeSingle();
      ativa = data;
    } catch {
      /* tabela pode não existir ainda */
    }
    const webhook = await getWebhookConfig(admin);
    return json({
      ok: true,
      emergency_active: Boolean(ativa),
      emergency: ativa,
      webhook: {
        enabled: webhook.enabled,
        url_configured: Boolean(webhook.url),
      },
    });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não suportado." }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo JSON inválido." }, 400);
  }

  const action = String(body?.action ?? "").toLowerCase();
  if (!["activate", "deactivate", "test-webhook"].includes(action)) {
    return json({
      ok: false,
      error:
        "Ação inválida. Use 'activate', 'deactivate' ou 'test-webhook'.",
    }, 400);
  }

  // --- RBAC no servidor -------------------------------------------------
  const identity = await resolveIdentity(admin, body?.acionado_por);
  const allowedRoles = action === "activate" ? ROLES_ACIONAR : ROLES_DESATIVAR;
  if (!identity.cargo || !allowedRoles.includes(identity.cargo)) {
    return json({
      ok: false,
      error: `Cargo '${identity.cargo ?? "desconhecido"}' não tem permissão para '${action}' no protocolo de emergência (RBAC ACIONAR_EMERGENCIA).`,
    }, 403);
  }

  const nowIso = new Date().toISOString();

  // --- Ação: test-webhook -----------------------------------------------
  if (action === "test-webhook") {
    const webhookConfig = await getWebhookConfig(admin);
    if (!webhookConfig.url) {
      return json({
        ok: false,
        error: "Nenhuma URL de webhook configurada em panic_webhook_config.",
      }, 400);
    }
    const result = await fireWebhook(webhookConfig.url, {
      event: "PANIC_WEBHOOK_TEST",
      source: "nexusport",
      terminal: TERMINAL,
      timestamp: nowIso,
      message:
        "Evento de teste do webhook de emergência do botão de pânico global.",
      sent_by: {
        nome: identity.nome,
        cargo: identity.cargo,
        codigo_individual: identity.codigo_individual,
        matricula: identity.matricula,
      },
    });
    return json({ ok: result.ok, webhook: result });
  }

  // --- Ações: activate / deactivate --------------------------------------
  let emergencia: any = null;
  let persistencia: { ok: boolean; error?: string } = { ok: true };
  let broadcastPayload: Record<string, unknown>;

  if (action === "activate") {
    const motivo = typeof body?.motivo === "string" && body.motivo.trim()
      ? body.motivo.trim().slice(0, 500)
      : "Emergência crítica declarada manualmente no Terminal STS-01.";

    try {
      const { data, error } = await admin
        .from("emergencias")
        .insert({
          estado: "ATIVA",
          motivo,
          funcionario_id: identity.funcionario_id,
          acionado_por_nome: identity.nome,
          acionado_por_cargo: identity.cargo,
          acionado_por_codigo: identity.codigo_individual,
          data_hora: nowIso,
          origem: "EDGE_FUNCTION",
        })
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      emergencia = data;
    } catch (error: any) {
      // Persistência é importante, mas não pode impedir o alarme global.
      persistencia = { ok: false, error: String(error?.message ?? error) };
      console.error("[panic-alert] Erro ao persistir emergência:", error);
    }

    broadcastPayload = {
      estado: "ATIVA",
      emergencia_id: emergencia?.id ?? null,
      motivo,
      terminal: TERMINAL,
      acionado_por: {
        nome: identity.nome,
        cargo: identity.cargo,
        codigo_individual: identity.codigo_individual,
        matricula: identity.matricula,
      },
      data_hora: nowIso,
      origem: "edge_function",
    };
  } else {
    // deactivate
    try {
      const { data: ativa } = await admin
        .from("emergencias")
        .select("*")
        .eq("estado", "ATIVA")
        .order("data_hora", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ativa) {
        const { data: updated, error } = await admin
          .from("emergencias")
          .update({
            estado: "RESOLVIDA",
            resolvido_por_nome: identity.nome,
            resolvido_por_cargo: identity.cargo,
            data_resolucao: nowIso,
          })
          .eq("id", ativa.id)
          .select()
          .maybeSingle();
        if (error) throw new Error(error.message);
        emergencia = updated ?? { ...ativa, estado: "RESOLVIDA" };
      }
    } catch (error: any) {
      persistencia = { ok: false, error: String(error?.message ?? error) };
      console.error("[panic-alert] Erro ao resolver emergência:", error);
    }

    broadcastPayload = {
      estado: "RESOLVIDA",
      emergencia_id: emergencia?.id ?? null,
      motivo: "Alarme de emergência desativado. Operações normalizadas.",
      terminal: TERMINAL,
      resolvido_por: {
        nome: identity.nome,
        cargo: identity.cargo,
        codigo_individual: identity.codigo_individual,
        matricula: identity.matricula,
      },
      data_hora: nowIso,
      origem: "edge_function",
    };
  }

  // 1) Broadcast via WebSocket (Supabase Realtime) para todos os clientes
  const broadcast = await broadcastToClients(admin, broadcastPayload);

  // 2) Webhook OPCIONAL — desligado por padrão
  const webhookConfig = await getWebhookConfig(admin);
  let webhook: Record<string, unknown> = {
    fired: false,
    ok: null,
    reason: "Webhook desativado (padrão) ou sem URL configurada.",
  };
  if (webhookConfig.enabled && webhookConfig.url) {
    const result = await fireWebhook(webhookConfig.url, {
      event: action === "activate" ? "PANIC_ACTIVATED" : "PANIC_DEACTIVATED",
      source: "nexusport",
      terminal: TERMINAL,
      timestamp: nowIso,
      emergency: emergencia
        ? {
          id: emergencia.id,
          estado: emergencia.estado,
          motivo: emergencia.motivo ?? null,
          data_hora: emergencia.data_hora ?? nowIso,
        }
        : broadcastPayload,
      triggered_by: {
        nome: identity.nome,
        cargo: identity.cargo,
        codigo_individual: identity.codigo_individual,
        matricula: identity.matricula,
      },
    });
    webhook = result;
    if (emergencia?.id) {
      try {
        await admin
          .from("emergencias")
          .update({ webhook_disparado: Boolean(result.ok) })
          .eq("id", emergencia.id);
      } catch {
        /* não bloqueia a resposta */
      }
    }
  } else if (webhookConfig.enabled && !webhookConfig.url) {
    webhook = {
      fired: false,
      ok: null,
      reason: "Webhook ativado, porém sem URL configurada.",
    };
  }

  return json({
    ok: true,
    action,
    identity,
    emergencia,
    persistencia,
    broadcast,
    webhook,
  });
});
