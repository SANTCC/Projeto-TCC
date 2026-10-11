// Supabase Edge Function: verificação de IPs de VPN antes de revelar as páginas estáticas.
// Camadas, em ordem: geográfica dos EUA (VPN_GATE_BLOCK_US), Proton
// (ASNs próprias + blocos BGP anunciados + sub-redes IPv6 observadas;
// VPN_GATE_NIVEL=agressivo amplia para o ASN inteiro das hospedagens) e listas públicas de VPN.
import ipaddr from "npm:ipaddr.js@2.5.0";
import { criarHandler } from "./handler.js";

Deno.serve(criarHandler({
  // Parse/normalização de IPv4 e IPv6 (ipaddr.js é sem dependências e roda no Deno).
  ipaddr,
  // VPN_GATE_BLOCK_US ausente/vazio = ligado por padrão; false/0/off/no desliga o geobloqueio dos EUA.
  getEnv: (nome) => Deno.env.get(nome)
}));
