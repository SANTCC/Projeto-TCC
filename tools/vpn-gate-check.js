#!/usr/bin/env node
/**
 * Verifica IPs contra o MESMO código da Edge Function `vpn-gate` (handler.js),
 * baixando as fontes públicas reais. Serve para responder "por que este IP da
 * Proton VPN passou?" sem precisar de deploy.
 *
 * Uso:
 *   node tools/vpn-gate-check.js 146.70.199.5 37.19.221.2
 *   node tools/vpn-gate-check.js --sem-geo --nivel agressivo 62.169.136.44
 *   VPN_GATE_FONTES_BASE=http://localhost:8080/ node tools/vpn-gate-check.js 1.2.3.4
 *
 * Variáveis aceitas: VPN_GATE_BLOCK_US, VPN_GATE_NIVEL e VPN_GATE_FONTES_BASE.
 * Saída: 0 quando todos os IPs foram decididos (bloqueados ou liberados), 1 em erro.
 */
const path = require('path');
const { pathToFileURL } = require('url');
// Mesma biblioteca que a Edge Function carrega como `npm:ipaddr.js@2.5.0`, para a
// verificação usar exatamente o parse de IP que vai para produção.
const ipaddr = require('ipaddr.js');

const BASE_GITHUB_PADRAO = 'https://raw.githubusercontent.com/';

function ajuda() {
  console.log(`Verificação de IPs contra o gate VPN da NexusPort.

Uso: node tools/vpn-gate-check.js [opções] <IP> [IP...]

Opções:
  --sem-geo         desliga o geobloqueio dos EUA nesta verificação
  --nivel <nível>   padrao (blocos anunciados) ou agressivo (ASN inteiro da hospedagem)
  --json            imprime o resultado em JSON
  -h, --help        mostra esta ajuda

Camadas verificadas, na ordem: geográfica (EUA), Proton (ASNs próprias + blocos BGP
anunciados + sub-redes IPv6 observadas) e listas públicas de VPN. O motivo aparece como geo-eua, proton ou vpn.`);
}

function lerArgumentos(argumentos) {
  const opcoes = { ips: [], semGeo: false, json: false, nivel: null };
  for (let i = 0; i < argumentos.length; i++) {
    const arg = argumentos[i];
    if (arg === '--sem-geo') opcoes.semGeo = true;
    else if (arg === '--json') opcoes.json = true;
    else if (arg === '--nivel') opcoes.nivel = argumentos[++i] || null;
    else if (arg === '-h' || arg === '--help') { ajuda(); process.exit(0); }
    else if (arg.startsWith('-')) throw new Error(`Opção desconhecida: ${arg}`);
    else opcoes.ips.push(arg);
  }
  return opcoes;
}

async function carregarHandler() {
  const arquivo = path.join(__dirname, '..', 'supabase', 'functions', 'vpn-gate', 'handler.js');
  return import(pathToFileURL(arquivo).href);
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  if (opcoes.ips.length === 0) {
    ajuda();
    process.exit(1);
  }

  const base = (process.env.VPN_GATE_FONTES_BASE || BASE_GITHUB_PADRAO).replace(/\/?$/, '/');
  const ambiente = {
    VPN_GATE_BLOCK_US: opcoes.semGeo ? 'false' : (process.env.VPN_GATE_BLOCK_US || 'true'),
    VPN_GATE_NIVEL: opcoes.nivel || process.env.VPN_GATE_NIVEL || 'padrao'
  };

  const { criarHandler } = await carregarHandler();
  const handler = criarHandler({
    ipaddr,
    fetchFn: (url, init) => fetch(base === BASE_GITHUB_PADRAO ? url : url.replace(BASE_GITHUB_PADRAO, base), init),
    getEnv: (nome) => ambiente[nome]
  });

  const resultados = [];
  for (const ip of opcoes.ips) {
    const requisicao = new Request('https://gate.nexusport.local/functions/v1/vpn-gate', {
      method: 'GET',
      headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': ip }
    });
    try {
      const resposta = await handler(requisicao);
      resultados.push({
        ip,
        status: resposta.status,
        motivo: resposta.headers.get('x-vpn-gate-motivo') || null
      });
    } catch (erro) {
      resultados.push({ ip, status: 0, motivo: `erro: ${erro.message}` });
    }
  }

  if (opcoes.json) {
    console.log(JSON.stringify({ nivel: ambiente.VPN_GATE_NIVEL, geoEua: ambiente.VPN_GATE_BLOCK_US !== 'false', resultados }, null, 2));
  } else {
    console.log(`\nNível: ${ambiente.VPN_GATE_NIVEL} | geobloqueio EUA: ${ambiente.VPN_GATE_BLOCK_US === 'false' ? 'desligado' : 'ligado'}\n`);
    console.log('IP'.padEnd(42) + 'DECISÃO'.padEnd(18) + 'MOTIVO');
    for (const r of resultados) {
      const decisao = r.status === 403 ? 'BLOQUEADO (403)' : r.status === 204 ? 'liberado (204)' : `indefinido (${r.status})`;
      console.log(`${r.ip.padEnd(42)}${decisao.padEnd(18)}${r.motivo || '—'}`);
    }
    const liberados = resultados.filter((r) => r.status === 204);
    if (liberados.length) {
      console.log(`\n${liberados.length} IP(s) liberado(s). Se algum é de VPN (Proton, etc.) ligada no momento do teste,`);
      console.log('guarde o endereço exibido por https://ifconfig.me com a VPN ativa e confira: ele precisa estar em');
      console.log('alguma lista pública ou em um bloco anunciado perto de um IP anunciado pela Proton.');
      console.log('Com o IP em mãos, rode de novo com --nivel agressivo para ver se o provedor de hospedagem o cobre.');
    }
  }

  process.exit(resultados.some((r) => r.status === 0) ? 1 : 0);
}

main().catch((erro) => {
  console.error(`Falha na verificação: ${erro.message}`);
  process.exit(1);
});
