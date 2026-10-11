// Supabase Edge Function: verificação de IPs de VPN antes de revelar as páginas estáticas.
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler({
  // VPN_GATE_BLOCK_US ausente/vazio = ligado por padrão; false/0/off/no desliga o geobloqueio dos EUA.
  getEnv: (nome) => Deno.env.get(nome)
}));
