// Supabase Edge Function: verificação de IPs de VPN antes de revelar as páginas estáticas.
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler());
