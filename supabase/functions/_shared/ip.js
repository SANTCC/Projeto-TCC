/**
 * Endereços IP e redes CIDR compartilhados pelas Edge Functions do NexusPort.
 *
 * O parse, a normalização e a validação ficam com o `ipaddr.js`: biblioteca
 * madura (desde 2011), sem dependências, que implementa IPv4 e IPv6 conforme
 * as RFCs e é usada por servidores e clientes em produção.
 *
 * Antes existiam DOIS parsers caseiros e divergentes no projeto:
 *   - `vpn-gate/handler.js`: ~130 linhas de aritmética BigInt própria, que
 *     rejeitavam redes IPv4 escritas na forma mapeada (`::ffff:198.51.100.0/120`);
 *   - `log-acesso/handler.js`: uma "validação" por expressão regular
 *     (`/^[0-9a-fA-F:.]+$/`) que aceitava `::::` ou `1:2:3:4:5:6:7:8:9` como
 *     IPv6 válido e gravava esse lixo na coluna `ip` do log de acessos.
 *
 * Continua sendo código do projeto (não substituível por biblioteca):
 *   - a leitura dos cabeçalhos de proxy (ordem de confiança e `x-forwarded-for`);
 *   - a remoção de colchetes/portas/zone-id antes do parse;
 *   - o índice por prefixo, que responde "este IP pertence a alguma destas
 *     dezenas de milhares de redes?" em O(bits) em vez de percorrer a lista.
 *
 * A biblioteca é INJETADA por `criarUtilitariosIp(ipaddr)` porque cada runtime a
 * resolve de um jeito: o Deno da Edge Function usa `npm:ipaddr.js` (importado
 * estaticamente em index.ts) e o Node dos testes/CLI usa o pacote do
 * node_modules. É o mesmo padrão já usado com o `pdf-lib` em relatorio-pdf.
 */

/** Tamanho máximo aceito para um valor de IP vindo de cabeçalho de proxy. */
const MAXIMO_CARACTERES_IP = 80;

/** Limite padrão de redes aceitas por lista (proteção contra lista gigante). */
const MAXIMO_CIDRS_POR_FONTE = 100_000;

/** Tira colchetes e portas que alguns proxies acrescentam ao IP. */
function limparIp(valor) {
  if (typeof valor !== 'string') return null;
  let ip = valor.trim();
  if (!ip || ip.length > MAXIMO_CARACTERES_IP) return null;

  const entreColchetes = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (entreColchetes) ip = entreColchetes[1];

  // IPv6 com zone-id não é endereço público canônico.
  if (ip.includes('%')) return null;
  return ip;
}

/** Converte os octetos de um endereço ipaddr.js em BigInt. */
function bytesParaBigInt(bytes) {
  let numero = 0n;
  for (const byte of bytes) numero = (numero << 8n) | BigInt(byte);
  return numero;
}

/**
 * Endereço ipaddr.js -> { familia, bits, valor }.
 * Um IPv4 escrito como IPv6 mapeado (`::ffff:198.51.100.8`) é comparado na
 * família 4, porque é assim que as listas públicas de VPN publicam a rede.
 */
function paraEndereco(endereco) {
  if (endereco.kind() === 'ipv6' && endereco.isIPv4MappedAddress()) {
    return { familia: 4, bits: 32, valor: bytesParaBigInt(endereco.toIPv4Address().toByteArray()) };
  }
  const ipv4 = endereco.kind() === 'ipv4';
  return { familia: ipv4 ? 4 : 6, bits: ipv4 ? 32 : 128, valor: bytesParaBigInt(endereco.toByteArray()) };
}

/**
 * Cria o conjunto de utilitários de IP sobre uma implementação de ipaddr.js.
 * @param {object} ipaddr módulo ipaddr.js
 */
export function criarUtilitariosIp(ipaddr) {
  if (!ipaddr || typeof ipaddr.parse !== 'function' || typeof ipaddr.parseCIDR !== 'function') {
    throw new Error('criarUtilitariosIp exige o módulo ipaddr.js (npm:ipaddr.js na Edge Function).');
  }

  /** Converte IPv4 ou IPv6 em uma representação numérica validada. */
  function parseIPAddress(valor) {
    const ip = limparIp(valor);
    if (!ip) return null;
    try {
      return paraEndereco(ipaddr.parse(ip));
    } catch (_erro) {
      return null;
    }
  }

  /** Normaliza/valida um IP vindo do cabeçalho de proxy (forma canônica). */
  function normalizarIp(valor) {
    const ip = limparIp(valor);
    if (!ip) return null;
    try {
      return ipaddr.parse(ip).toString();
    } catch (_erro) {
      return null;
    }
  }

  /** Interpreta um IP ou CIDR IPv4/IPv6. Retorna null se inválido. */
  function parseCIDR(valor) {
    if (typeof valor !== 'string') return null;
    const texto = valor.trim();
    if (!texto) return null;
    const separador = texto.indexOf('/');
    if (separador !== texto.lastIndexOf('/')) return null;

    let endereco;
    let prefixo;
    try {
      if (separador < 0) {
        endereco = ipaddr.parse(texto);
        prefixo = endereco.kind() === 'ipv4' ? 32 : 128;
      } else {
        const [parseado, mascara] = ipaddr.parseCIDR(texto);
        endereco = parseado;
        prefixo = mascara;
        // Rede IPv4 publicada em notação mapeada: o prefixo é relativo aos 32 bits.
        if (endereco.kind() === 'ipv6' && endereco.isIPv4MappedAddress()) prefixo -= 96;
      }
    } catch (_erro) {
      return null;
    }

    const numero = paraEndereco(endereco);
    if (!Number.isInteger(prefixo) || prefixo < 0 || prefixo > numero.bits) return null;

    const deslocamento = BigInt(numero.bits - prefixo);
    return {
      familia: numero.familia,
      bits: numero.bits,
      prefixo,
      valor: numero.valor >> deslocamento
    };
  }

  /** Lê linhas de CIDR/IP simples, ignorando comentários e conteúdo inválido. */
  function parseListaCIDR(texto, maximo = MAXIMO_CIDRS_POR_FONTE) {
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

  /**
   * Índice por família e prefixo. Sem ele, cada requisição percorreria todas as
   * dezenas de milhares de redes baixadas das listas públicas.
   */
  const indicesRedes = new WeakMap();

  function indexarRedes(redes) {
    const indice = new Map([[4, new Map()], [6, new Map()]]);
    for (const rede of redes) {
      if (!rede || (rede.familia !== 4 && rede.familia !== 6)) continue;
      const prefixos = indice.get(rede.familia);
      let valores = prefixos.get(rede.prefixo);
      if (!valores) {
        valores = new Map();
        prefixos.set(rede.prefixo, valores);
      }
      valores.set(rede.valor, rede);
    }
    return indice;
  }

  function obterIndice(redes) {
    let indice = indicesRedes.get(redes);
    if (!indice) {
      indice = indexarRedes(redes);
      indicesRedes.set(redes, indice);
    }
    return indice;
  }

  /** Retorna true se o IP pertence a qualquer rede do conjunto informado. */
  function ipPertenceALista(ipTexto, redes) {
    const ip = typeof ipTexto === 'string' ? parseIPAddress(ipTexto) : ipTexto;
    if (!ip || !Array.isArray(redes)) return false;
    const prefixos = obterIndice(redes).get(ip.familia);
    if (!prefixos) return false;
    for (let prefixo = 0; prefixo <= ip.bits; prefixo++) {
      const valores = prefixos.get(prefixo);
      if (valores && valores.has(ip.valor >> BigInt(ip.bits - prefixo))) return true;
    }
    return false;
  }

  /**
   * Retorna o prefixo mais específico da lista que contém o IP informado, ou null.
   * Usado para expandir um IP anunciado até o bloco BGP anunciado que o abriga,
   * sem nunca devolver blocos maiores que `prefixoMinimo`.
   */
  function menorBlocoContido(ipTexto, redes, prefixoMinimo = 0) {
    const ip = typeof ipTexto === 'string' ? parseIPAddress(ipTexto) : ipTexto;
    if (!ip || !Array.isArray(redes)) return null;
    const prefixos = obterIndice(redes).get(ip.familia);
    if (!prefixos) return null;

    const limite = Math.max(0, Math.min(ip.bits, prefixoMinimo));
    for (let prefixo = ip.bits; prefixo >= limite; prefixo--) {
      const valores = prefixos.get(prefixo);
      if (!valores) continue;
      const rede = valores.get(ip.valor >> BigInt(ip.bits - prefixo));
      if (rede) return rede;
    }
    return null;
  }

  /** Extrai o IP de origem dos cabeçalhos normalmente definidos pelo gateway/proxy. */
  function extrairIp(headers) {
    const obter = (nome) => (headers && typeof headers.get === 'function' ? headers.get(nome) : null);
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

  return {
    parseIPAddress,
    normalizarIp,
    parseCIDR,
    parseListaCIDR,
    ipPertenceALista,
    menorBlocoContido,
    extrairIp
  };
}
