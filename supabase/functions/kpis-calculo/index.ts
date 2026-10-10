// Edge Function: Cálculos Consolidados de KPIs Operacionais e Estratégicos (kpis-calculo)
import { createClient } from "npm:@supabase/supabase-js@2";
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler({
  criarCliente: createClient,
  env: (nome: string) => Deno.env.get(nome) ?? ""
}));
