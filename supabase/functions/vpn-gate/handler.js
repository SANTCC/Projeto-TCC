/**
 * Supabase Edge Function: bloqueio visual de IPs associados a VPNs.
 *
 * O cliente não pode informar o IP a verificar: ele é lido dos cabeçalhos de
 * proxy recebidos pela Edge Function. As listas públicas do GitHub são baixadas
 * e mantidas em cache na memória por instância.
 */

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

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff'
});

function respostaTexto(texto, status) {
  return new Response(texto, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/** Tira brackets e portas que alguns proxies acrescentam ao IP. */
function limparIp(valor) {
  if (typeof valor !== 'string') return null;
  let ip = valor.trim();
  if (!ip || ip.length > 80) return null;

  const entreColchetes = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (entreColchetes) ip = entreColchetes[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));

  if (ip.includes('%')) return null; // IPv6 com zone-id não é endereço público canônico.
  return ip;
}

function ipv4ParaBigInt(valor) {
  const octetos = valor.split('.');
  if (octetos.length !== 4) return null;
  let numero = 0n;
  for (const octeto of octetos) {
    if (!/^\d{1,3}$/.test(octeto)) return null;
    const parte = Number(octeto);
    if (parte < 0 || parte > 255) return null;
    numero = (numero << 8n) | BigInt(parte);
  }
  return numero;
}

function ipv6ParaBigInt(valor) {
  let ip = valor.toLowerCase();
  if (!ip.includes(':')) return null;

  // Converte a cauda IPv4 da forma IPv4-mapped (::ffff:192.0.2.1) em dois hextets.
  if (ip.includes('.')) {
    const separador = ip.lastIndexOf(':');
    if (separador < 0) return null;
    const ipv4 = ipv4ParaBigInt(ip.slice(separador + 1));
    if (ipv4 === null) return null;
    const hextetAlto = Number((ipv4 >> 16n) & 0xffffn).toString(16);
    const hextetBaixo = Number(ipv4 & 0xffffn).toString(16);
    ip = `${ip.slice(0, separador + 1)}${hextetAlto}:${hextetBaixo}`;
  }

  const partes = ip.split('::');
  if (partes.length > 2) return null;
  const esquerda = partes[0] ? partes[0].split(':') : [];
  const direita = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const quantidadeZeros = partes.length === 2 ? 8 - esquerda.length - direita.length : 0;
  if ((partes.length === 1 && esquerda.length !== 8) || (partes.length === 2 && quantidadeZeros < 1)) return null;

  const hextets = partes.length === 2
    ? [...esquerda, ...Array(quantidadeZeros).fill('0'), ...direita]
    : esquerda;
  if (hextets.length !== 8 || hextets.some((parte) => !/^[0-9a-f]{1,4}$/.test(parte))) return null;

  let numero = 0n;
  for (const hextet of hextets) numero = (numero << 16n) | BigInt(`0x${hextet}`);

  // Um cliente pode aparecer como IPv4-mapped IPv6, mas as listas VPN usam IPv4.
  if ((numero >> 32n) === 0xffffn) return { familia: 4, valor: numero & 0xffffffffn };
  return { familia: 6, valor: numero };
}

/** Converte IPv4 ou IPv6 para uma representação numérica validada. */
export function parseIPAddress(valor) {
  const ip = limparIp(valor);
  if (!ip) return null;
  const ipv4 = ipv4ParaBigInt(ip);
  if (ipv4 !== null) return { familia: 4, bits: 32, valor: ipv4 };
  const ipv6 = ipv6ParaBigInt(ip);
  if (ipv6 === null) return null;
  return { ...ipv6, bits: ipv6.familia === 4 ? 32 : 128 };
}

/** Normaliza/valida um IP vindo do cabeçalho de proxy. */
export function normalizarIp(valor) {
  const ip = limparIp(valor);
  return ip && parseIPAddress(ip) ? ip : null;
}

/** Interpreta um IP ou CIDR IPv4/IPv6. Retorna null se inválido. */
export function parseCIDR(valor) {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (!texto) return null;
  const separador = texto.indexOf('/');
  if (separador !== texto.lastIndexOf('/')) return null;

  const enderecoTexto = separador < 0 ? texto : texto.slice(0, separador);
  const endereco = parseIPAddress(enderecoTexto);
  if (!endereco) return null;

  const prefixoTexto = separador < 0 ? String(endereco.bits) : texto.slice(separador + 1);
  if (!/^\d{1,3}$/.test(prefixoTexto)) return null;
  const prefixo = Number(prefixoTexto);
  if (prefixo < 0 || prefixo > endereco.bits) return null;

  const deslocamento = BigInt(endereco.bits - prefixo);
  return {
    familia: endereco.familia,
    bits: endereco.bits,
    prefixo,
    valor: endereco.valor >> deslocamento
  };
}

/** Lê linhas de CIDR/IP simples, ignorando comentários e conteúdo inválido. */
export function parseListaCIDR(texto, maximo = MAXIMO_CIDRS_POR_FONTE) {
  if (typeof texto !== 'string') return [];
  const redes = [];
  const vistos = new Set();
  for (const linhaOriginal of texto.split(/\r?\n/)) {
    const linha = linhaOriginal.split('#', 1)[0].trim();
    if (!linha) continue;
    const entrada = linha.split(/[\s,;|]/, 1)[0];
    const rede = parseCIDR(entrada);
    if (!rede) continue;
    const chave = `${rede.familia}/${rede.prefixo}/${rede.valor}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    redes.push(rede);
    if (redes.length > maximo) throw new Error('Lista excedeu o limite de redes aceito.');
  }
  return redes;
}

const indicesRedes = new WeakMap();

function indexarRedes(redes) {
  const indice = new Map([[4, new Map()], [6, new Map()]]);
  for (const rede of redes) {
    if (!rede || (rede.familia !== 4 && rede.familia !== 6)) continue;
    let prefixos = indice.get(rede.familia);
    let valores = prefixos.get(rede.prefixo);
    if (!valores) {
      valores = new Set();
      prefixos.set(rede.prefixo, valores);
    }
    valores.add(rede.valor);
  }
  return indice;
}

/** Retorna true se o IP pertence a qualquer rede do conjunto informado. */
export function ipPertenceALista(ipTexto, redes) {
  const ip = typeof ipTexto === 'string' ? parseIPAddress(ipTexto) : ipTexto;
  if (!ip || !Array.isArray(redes)) return false;
  let indice = indicesRedes.get(redes);
  if (!indice) {
    indice = indexarRedes(redes);
    indicesRedes.set(redes, indice);
  }

  const prefixos = indice.get(ip.familia);
  if (!prefixos) return false;
  for (let prefixo = 0; prefixo <= ip.bits; prefixo++) {
    const valores = prefixos.get(prefixo);
    const deslocamento = BigInt(ip.bits - prefixo);
    if (valores && valores.has(ip.valor >> deslocamento)) return true;
  }
  return false;
}

/** Extrai o IP de origem dos cabeçalhos normalmente definidos pelo gateway/proxy. */
export function extrairIp(headers) {
  const obter = (nome) => headers && typeof headers.get === 'function' ? headers.get(nome) : null;
  for (const nome of ['cf-connecting-ip', 'x-real-ip']) {
    const ip = normalizarIp(obter(nome));
    if (ip) return ip;
  }

  const encaminhados = obter('x-forwarded-for');
  if (typeof encaminhados === 'string') {
    for (const candidato of encaminhados.split(',')) {
      const ip = normalizarIp(candidato);
      if (ip) return ip;
    }
  }
  return null;
}

async function carregarFonte(fonte, fetchFn) {
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
    const redes = parseListaCIDR(texto);
    if (redes.length < fonte.minimo) throw new Error(`Fonte vazia ou incompleta: ${fonte.nome}`);
    return redes;
  } finally {
    clearTimeout(temporizador);
  }
}

function criarCarregadorRedes({ fetchFn, now, ttlMs, fontes }) {
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
        if (!Array.isArray(fontes) || fontes.length === 0) throw new Error('Nenhuma fonte de IP configurada.');
        const listas = await Promise.all(fontes.map((fonte) => carregarFonte(fonte, fetchFn)));
        const redes = listas.flat();
        if (redes.length === 0) throw new Error('As listas de IP estão vazias.');
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
  fetchFn = globalThis.fetch,
  now = () => Date.now(),
  ttlMs = CACHE_TTL_MS,
  ttlGeoEuaMs = 24 * 60 * 60 * 1000,
  fontes = FONTES_LISTAS,
  fontesGeoEua = FONTES_GEO_EUA,
  getEnv = () => undefined
} = {}) {
  const obterRedesVpn = criarCarregadorRedes({ fetchFn, now, ttlMs, fontes });
  const carregadoresGeoEua = new Map([4, 6].map((familia) => [
    familia,
    criarCarregadorRedes({
      fetchFn,
      now,
      ttlMs: ttlGeoEuaMs,
      fontes: Array.isArray(fontesGeoEua)
        ? fontesGeoEua.filter((fonte) => fonte.familia === familia)
        : []
    })
  ]));
  const bloquearEua = geoEuaHabilitado(getEnv);

  return async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== 'GET') return respostaTexto('Método não permitido.', 405);

    const ip = extrairIp(req.headers);
    if (!ip) return respostaTexto(MENSAGEM_BLOQUEIO, 503);
    const ipValidado = parseIPAddress(ip);
    if (!ipValidado) return respostaTexto(MENSAGEM_BLOQUEIO, 503);

    // A geografia é verificada primeiro; um IP dos EUA nem precisa carregar os feeds VPN.
    if (bloquearEua) {
      try {
        const obterRedesEua = carregadoresGeoEua.get(ipValidado.familia);
        if (!obterRedesEua) throw new Error('Família IP sem fonte geográfica configurada.');
        const redesEua = await obterRedesEua();
        if (ipPertenceALista(ipValidado, redesEua)) return respostaTexto(MENSAGEM_BLOQUEIO, 403);
      } catch (_erro) {
        // Sem uma base geográfica validada e sem snapshot, mantém o fail-closed.
        return respostaTexto(MENSAGEM_BLOQUEIO, 503);
      }
    }

    try {
      const redesVpn = await obterRedesVpn();
      if (ipPertenceALista(ipValidado, redesVpn)) return respostaTexto(MENSAGEM_BLOQUEIO, 403);
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    } catch (_erro) {
      // Se uma instância fria não conseguir validar as fontes, o conteúdo do app
      // não deve ser liberado por engano.
      return respostaTexto(MENSAGEM_BLOQUEIO, 503);
    }
  };
}
