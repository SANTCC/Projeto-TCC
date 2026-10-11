/**
 * Supabase Edge Function: bloqueio visual de IPs associados a VPNs.
 *
 * O cliente não pode informar o IP a verificar: ele é lido dos cabeçalhos de
 * proxy recebidos pela Edge Function. As listas públicas do GitHub são baixadas
 * e mantidas em cache na memória por instância.
 *
 * Decisão em camadas, nesta ordem:
 *   1. geográfica dos EUA (`VPN_GATE_BLOCK_US`, ligada por padrão);
 *   2. Proton: ASNs próprias da Proton AG bloqueadas por inteiro + o bloco BGP
 *      anunciado que contém cada IP anunciado pela Proton (pega a saída NAT que
 *      as listas por `/24` não pegam) + sub-redes IPv6 de saída observadas.
 *      `VPN_GATE_NIVEL=agressivo` amplia para todo o espaço anunciado pelas
 *      hospedagens usadas pela Proton;
 *   3. listas públicas de VPN (X4BNet, tn3w e antonme).
 * As camadas 1 e 3 falham fechadas (HTTP 503 com a mensagem de bloqueio); a
 * camada 2 é um reforço e, sem dados, não derruba a decisão das outras.
 *
 * O parse de IP/CIDR vem de `ipaddr.js`, injetado por `criarHandler` (o Deno
 * resolve `npm:ipaddr.js` em index.ts; os testes Node passam o pacote instalado).
 */

import { criarUtilitariosIp } from '../_shared/ip.js';

// Reexportado para os testes e o CLI montarem os utilitários com a mesma
// biblioteca (no Node, o pacote `ipaddr.js` do node_modules).
export { criarUtilitariosIp };

export const MENSAGEM_BLOQUEIO = 'AQUI NÃO!! TICO-TICO!!!!!!!!';

const CACHE_TTL_MS = 60 * 60 * 1000;
const TEMPO_RETENTATIVA_MS = 5 * 60 * 1000;
const TIMEOUT_FONTE_MS = 8 * 1000;
const TAMANHO_MAXIMO_FONTE_BYTES = 2 * 1024 * 1024;
const MAXIMO_CIDRS_POR_FONTE = 100_000;

/**
 * X4BNet agrega redes de VPN comerciais comuns (sem a lista mais ampla de
 * datacenters). A fonte separada da ProtonVPN é necessária porque seus IPs de
 * saída IPv4 passam por NAT; o projeto tn3w expande cada servidor anunciado
 * para o /24 que contém os IPs de saída.
 */
export const FONTES_LISTAS = Object.freeze([
  {
    nome: 'VPNs conhecidas IPv4 (X4BNet)',
    url: 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt',
    minimo: 1000
  },
  {
    nome: 'VPNs conhecidas IPv6 (X4BNet)',
    url: 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv6.txt',
    minimo: 10
  },
  {
    nome: 'Saídas IPv4 da ProtonVPN (tn3w)',
    url: 'https://raw.githubusercontent.com/tn3w/ProtonVPN-IPs/master/protonvpn_ip_ranges.txt',
    minimo: 50
  },
  {
    nome: 'Redes IPv6 da ProtonVPN (antonme)',
    url: 'https://raw.githubusercontent.com/antonme/ipranges/main/protonvpn/ipv6_merged.txt',
    minimo: 1
  }
]);

/** Prefixos atribuídos a redes dos EUA, com subalocações publicadas pelo ipverse. */
export const FONTES_GEO_EUA = Object.freeze([
  {
    familia: 4,
    nome: 'Redes atribuídas aos EUA IPv4 (ipverse)',
    url: 'https://raw.githubusercontent.com/ipverse/geo-ip-blocks/master/country/us/us-ipv4.txt',
    minimo: 50_000
  },
  {
    familia: 6,
    nome: 'Redes atribuídas aos EUA IPv6 (ipverse)',
    url: 'https://raw.githubusercontent.com/ipverse/geo-ip-blocks/master/country/us/us-ipv6.txt',
    minimo: 10_000
  }
]);

/**
 * ASNs próprias da Proton AG (fonte: registro RIPE/Team Cymru e os metadados do
 * ipverse). Todo o espaço anunciado por elas pertence à Proton, então o bloqueio
 * é integral — inclusive as saídas NAT que a API nunca publica.
 */
export const ASNS_PROTON_AG = Object.freeze(['209103', '208172']);

/**
 * ASNs de hospedagem onde a Proton aluga servidores. São operadoras que também
 * atendem outros clientes, então o modo padrão bloqueia apenas o bloco BGP
 * anunciado que contém um IP anunciado pela Proton (sem bloquear o ASN inteiro).
 * A lista foi levantada consultando o AS de origem de cada IP anunciado
 * (`origin.asn.cymru.com`, 2026-10-11); ASNs de trânsito/backbone foram omitidos.
 */
export const ASNS_HOSPEDAGEM_PROTON = Object.freeze([
  '212238', '9009', '56704', '8473', '49981', '60068', '136557', '206804',
  '396356', '199218', '200415', '4785', '3258', '43350', '25369', '41564',
  '35432', '137373', '32489', '137409', '12417', '39798', '200698', '200899',
  '51765', '203020', '37518', '11878', '9678', '12975', '197706', '51430',
  '61272', '63023', '46475', '7979', '24875', '1257'
]);

/** IPs que a API da Proton anuncia (saída/entrada); base do cálculo dos blocos BGP. */
export const FONTE_IPS_PROTON = Object.freeze({
  nome: 'IPs anunciados da ProtonVPN (tn3w)',
  url: 'https://raw.githubusercontent.com/tn3w/ProtonVPN-IPs/master/protonvpn_ips.txt',
  minimo: 50
});

/** Menor prefixo aceito ao expandir um IP anunciado (evita blocos gigantes de backbone). */
export const PREFIXO_MINIMO_BLOCO_PROTON = 20;

/**
 * Sub-redes IPv6 de saídas Proton confirmadas por ifconfig.me em 2026-10-11.
 * A primeira também cai no bloco IPv6 do X4BNet (`2a02:6ea0:5100::/40`). A
 * segunda está na rota compartilhada AS60068 (`2a02:6ea0:ce00::/39`) e no /48
 * onde a lista Proton do TLop503 registra um servidor. Não herdamos os blocos
 * inteiros dos provedores compartilhados: só estes /64 observados são bloqueados,
 * cobrindo rotação do identificador de interface sem bloquear o /39 do CDN77.
 */
export const BLOCOS_PROTON_IPV6_OBSERVADOS = Object.freeze([
  '2a02:6ea0:510c:3882::/64',
  '2a02:6ea0:ce14:3032::/64'
]);

/** Quantidade de downloads simultâneos ao consultar os prefixos por ASN. */
const CONCORRENCIA_FONTES = 6;

/** Monta a URL do bloco anunciado de um AS no ipverse (IPv4 ou IPv6). */
export function urlBlocosAsn(asn, familia) {
  const familiaValida = familia === 'ipv6' ? 'ipv6' : 'ipv4';
  return `https://raw.githubusercontent.com/ipverse/as-ip-blocks/master/as/${asn}/${familiaValida}-aggregated.txt`;
}

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Vpn-Gate-Motivo',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff'
});

function respostaTexto(texto, status, motivo) {
  const headers = { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' };
  // Diagnóstico do operador (visível com `curl -i`); nunca revela nada além da camada que decidiu.
  if (motivo) headers['X-Vpn-Gate-Motivo'] = motivo;
  return new Response(texto, { status, headers });
}

async function carregarFonte(fonte, fetchFn, ip) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_FONTE_MS);
  try {
    const resposta = await fetchFn(fonte.url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controlador.signal,
      headers: { 'User-Agent': 'NexusPort-vpn-gate/1.0' }
    });
    if (!resposta || !resposta.ok) throw new Error(`Fonte indisponível: ${fonte.nome}`);

    const tamanhoDeclarado = Number(resposta.headers && resposta.headers.get('content-length'));
    if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > TAMANHO_MAXIMO_FONTE_BYTES) {
      throw new Error(`Fonte grande demais: ${fonte.nome}`);
    }

    const texto = await resposta.text();
    if (new TextEncoder().encode(texto).byteLength > TAMANHO_MAXIMO_FONTE_BYTES) {
      throw new Error(`Fonte grande demais: ${fonte.nome}`);
    }
    const redes = ip.parseListaCIDR(texto, MAXIMO_CIDRS_POR_FONTE);
    if (redes.length < fonte.minimo) throw new Error(`Fonte vazia ou incompleta: ${fonte.nome}`);
    return redes;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Envolve um carregamento assíncrono com cache, retentativa e conservação do
 * último snapshot validado (usado por todas as camadas do gate).
 */
function criarCarregadorComCache(carregar, { now, ttlMs }) {
  let cache = null;
  let carregamento = null;
  let tentarNovamenteApos = 0;
  let ultimoErro = null;

  return async function obterRedes() {
    const instante = now();
    if (cache && instante < cache.validoAte) return cache.redes;
    if (instante < tentarNovamenteApos) {
      if (cache) return cache.redes;
      throw ultimoErro || new Error('Listas de IP indisponíveis.');
    }
    if (carregamento) return carregamento;

    carregamento = (async () => {
      try {
        const redes = await carregar();
        if (!Array.isArray(redes) || redes.length === 0) throw new Error('As listas de IP estão vazias.');
        cache = { redes, validoAte: now() + ttlMs };
        tentarNovamenteApos = 0;
        ultimoErro = null;
        return redes;
      } catch (erro) {
        ultimoErro = erro;
        tentarNovamenteApos = now() + TEMPO_RETENTATIVA_MS;
        if (cache) {
          // Em uma falha de atualização, conserva o último snapshot já validado.
          cache = { ...cache, validoAte: tentarNovamenteApos };
          return cache.redes;
        }
        throw erro;
      } finally {
        carregamento = null;
      }
    })();
    return carregamento;
  };
}

function criarCarregadorRedes({ fetchFn, now, ttlMs, fontes, ip }) {
  return criarCarregadorComCache(async () => {
    if (!Array.isArray(fontes) || fontes.length === 0) throw new Error('Nenhuma fonte de IP configurada.');
    const listas = await Promise.all(fontes.map((fonte) => carregarFonte(fonte, fetchFn, ip)));
    return listas.flat();
  }, { now, ttlMs });
}

/** Executa `tarefa` para cada item respeitando um limite de downloads simultâneos. */
async function mapearComLimite(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.max(1, Math.min(limite, itens.length)) }, async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultados[indice] = await tarefa(itens[indice], indice);
    }
  });
  await Promise.all(trabalhadores);
  return resultados;
}

/**
 * Baixa várias fontes tolerando falhas individuais: uma lista fora do ar não
 * derruba a camada inteira, apenas deixa de contribuir com aquele ASN.
 */
async function carregarFontesTolerantes(fontes, fetchFn, ip) {
  const listas = await mapearComLimite(fontes, CONCORRENCIA_FONTES, async (fonte) => {
    try {
      return await carregarFonte(fonte, fetchFn, ip);
    } catch (_erro) {
      return null;
    }
  });
  return listas.filter(Boolean).flat();
}

/** Monta a camada Proton: ASNs próprias da Proton AG + blocos BGP anunciados. */
async function montarBlocosProton({ fetchFn, asnsProprias, asnsHospedagem, fonteIpsProton, prefixoMinimoBloco, nivel, ip }) {
  const fontesProprias = [];
  for (const asn of asnsProprias) {
    fontesProprias.push({ nome: `AS${asn} IPv4`, url: urlBlocosAsn(asn, 'ipv4'), minimo: 1 });
    fontesProprias.push({ nome: `AS${asn} IPv6`, url: urlBlocosAsn(asn, 'ipv6'), minimo: 1 });
  }
  const fontesHospedagem = asnsHospedagem.map((asn) => ({
    nome: `AS${asn} IPv4`, url: urlBlocosAsn(asn, 'ipv4'), minimo: 1
  }));

  const agressivo = nivel === 'agressivo';
  const [redesProprias, redesHospedagem, ipsAnunciados] = await Promise.all([
    carregarFontesTolerantes(fontesProprias, fetchFn, ip),
    agressivo ? carregarFontesTolerantes(fontesHospedagem, fetchFn, ip) : Promise.resolve([]),
    agressivo ? Promise.resolve(null) : carregarFonte(fonteIpsProton, fetchFn, ip).catch(() => null)
  ]);

  if (!agressivo && !ipsAnunciados && redesProprias.length === 0) {
    throw new Error('Camada Proton sem dados de IPs ou de ASNs.');
  }

  const blocos = new Map();
  const adicionar = (rede) => {
    if (!rede) return;
    blocos.set(`${rede.familia}/${rede.prefixo}/${rede.valor}`, rede);
  };
  for (const rede of redesProprias) adicionar(rede);

  if (agressivo) {
    // Modo agressivo: bloqueia tudo que os provedores de hospedagem anunciam.
    for (const rede of redesHospedagem) adicionar(rede);
  } else {
    const prefixosHospedagem = await carregarFontesTolerantes(fontesHospedagem, fetchFn, ip);
    for (const anunciado of ipsAnunciados || []) {
      // O endereço que o site vê é uma saída NAT diferente do IP anunciado, mas
      // dentro do mesmo bloco que a operadora anuncia para a Proton.
      const contido = ip.menorBlocoContido(anunciado, prefixosHospedagem, prefixoMinimoBloco);
      if (contido) adicionar(contido);
      else if (anunciado.familia === 4) {
        adicionar({ familia: 4, bits: 32, prefixo: 24, valor: anunciado.valor >> 8n });
      }
    }
  }

  return [...blocos.values()];
}

function criarCarregadorBlocosProton({ fetchFn, now, ttlMs, asnsProprias, asnsHospedagem, fonteIpsProton, prefixoMinimoBloco, nivel, ip }) {
  return criarCarregadorComCache(
    () => montarBlocosProton({ fetchFn, asnsProprias, asnsHospedagem, fonteIpsProton, prefixoMinimoBloco, nivel, ip }),
    { now, ttlMs }
  );
}

/** Normaliza o nível de bloqueio da camada Proton (`padrao` ou `agressivo`). */
function nivelProton(getEnv) {
  try {
    const valor = typeof getEnv === 'function' ? getEnv('VPN_GATE_NIVEL') : undefined;
    if (valor == null) return 'padrao';
    return /^(agressivo|aggressive|estrito|strict)$/i.test(String(valor).trim()) ? 'agressivo' : 'padrao';
  } catch (_erro) {
    return 'padrao';
  }
}

function geoEuaHabilitado(getEnv) {
  try {
    const valor = typeof getEnv === 'function' ? getEnv('VPN_GATE_BLOCK_US') : undefined;
    if (valor == null || String(valor).trim() === '') return true;
    return !['0', 'false', 'off', 'no'].includes(String(valor).trim().toLowerCase());
  } catch (_erro) {
    // Uma falha ao ler configuração não deve desligar o bloqueio por acidente.
    return true;
  }
}

/** Cria o handler com dependências injetáveis para testes Node, sem Deno/Supabase. */
export function criarHandler({
  ipaddr,
  fetchFn = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = CACHE_TTL_MS,
  ttlGeoEuaMs = 24 * 60 * 60 * 1000,
  ttlProtonMs = CACHE_TTL_MS,
  fontes = FONTES_LISTAS,
  fontesGeoEua = FONTES_GEO_EUA,
  asnsProprias = ASNS_PROTON_AG,
  asnsHospedagem = ASNS_HOSPEDAGEM_PROTON,
  fonteIpsProton = FONTE_IPS_PROTON,
  prefixoMinimoBloco = PREFIXO_MINIMO_BLOCO_PROTON,
  getEnv = () => undefined
} = {}) {
  const ip = criarUtilitariosIp(ipaddr);
  const redesProtonIpv6Observadas = ip.parseListaCIDR(BLOCOS_PROTON_IPV6_OBSERVADOS.join('\n'));
  const obterRedesVpn = criarCarregadorRedes({ fetchFn, now, ttlMs, fontes, ip });
  const carregadoresGeoEua = new Map([4, 6].map((familia) => [
    familia,
    criarCarregadorRedes({
      fetchFn,
      now,
      ttlMs: ttlGeoEuaMs,
      fontes: Array.isArray(fontesGeoEua)
        ? fontesGeoEua.filter((fonte) => fonte.familia === familia)
        : [],
      ip
    })
  ]));
  const obterBlocosProton = criarCarregadorBlocosProton({
    fetchFn,
    now,
    ttlMs: ttlProtonMs,
    asnsProprias,
    asnsHospedagem,
    fonteIpsProton,
    prefixoMinimoBloco,
    nivel: nivelProton(getEnv),
    ip
  });
  const bloquearEua = geoEuaHabilitado(getEnv);

  return async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'GET') return respostaTexto('Método não permitido.', 405, 'metodo');

    const ipCliente = ip.extrairIp(req.headers);
    if (!ipCliente) return respostaTexto(MENSAGEM_BLOQUEIO, 503, 'sem-ip');
    const ipValidado = ip.parseIPAddress(ipCliente);
    if (!ipValidado) return respostaTexto(MENSAGEM_BLOQUEIO, 503, 'ip-invalido');

    // A geografia é verificada primeiro; um IP dos EUA nem precisa carregar as outras camadas.
    if (bloquearEua) {
      try {
        const obterRedesEua = carregadoresGeoEua.get(ipValidado.familia);
        if (!obterRedesEua) throw new Error('Família IP sem fonte geográfica configurada.');
        const redesEua = await obterRedesEua();
        if (ip.ipPertenceALista(ipValidado, redesEua)) return respostaTexto(MENSAGEM_BLOQUEIO, 403, 'geo-eua');
      } catch (_erro) {
        // Sem uma base geográfica validada e sem snapshot, mantém o fail-closed.
        return respostaTexto(MENSAGEM_BLOQUEIO, 503, 'geo-indisponivel');
      }
    }

    // Os /64s confirmados são locais e podem ser negados sem esperar downloads
    // das listas dinâmicas (ou depender de uma conexão com o GitHub).
    if (ip.ipPertenceALista(ipValidado, redesProtonIpv6Observadas)) {
      return respostaTexto(MENSAGEM_BLOQUEIO, 403, 'proton');
    }

    const [blocosProton, listasVpn] = await Promise.all([
      // A camada Proton é adicional: se ela ficar sem dados, as listas de VPN abaixo
      // continuam decidindo — perder um reforço não pode liberar o app por engano.
      obterBlocosProton().catch(() => null),
      obterRedesVpn().then((redes) => ({ redes })).catch(() => null)
    ]);

    if (blocosProton && ip.ipPertenceALista(ipValidado, blocosProton)) {
      return respostaTexto(MENSAGEM_BLOQUEIO, 403, 'proton');
    }
    if (!listasVpn) {
      // Se uma instância fria não conseguir validar as listas de VPN, o conteúdo do
      // app não deve ser liberado por engano.
      return respostaTexto(MENSAGEM_BLOQUEIO, 503, 'vpn-indisponivel');
    }
    if (ip.ipPertenceALista(ipValidado, listasVpn.redes)) {
      return respostaTexto(MENSAGEM_BLOQUEIO, 403, 'vpn');
    }
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  };
}
