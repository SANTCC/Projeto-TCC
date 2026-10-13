// Edge Function: Log de acessos de usuários autenticados (log-acesso)
import { createClient } from "npm:@supabase/supabase-js@2";
import ipaddr from "npm:ipaddr.js@2.5.0";
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler({
  criarCliente: createClient,
  // Parse/normalização de IPv4 e IPv6 compartilhado com o gate de VPN.
  ipaddr,
  env: (nome: string) => Deno.env.get(nome) ?? "",
}));
