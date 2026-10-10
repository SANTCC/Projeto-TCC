// Edge Function: Log de acessos de usuários autenticados (log-acesso)
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler({
  criarCliente: createClient,
  env: (nome: string) => Deno.env.get(nome) ?? "",
}));
