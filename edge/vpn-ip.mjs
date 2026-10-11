import { VPN_IPV4_CIDRS, VPN_IPV6_CIDRS } from './vpn-cidrs.mjs';

const IPV4_MAX = 0xffffffff;
const IPV6_MAX = (1n << 128n) - 1n;

function parseIPv4(ip) {
  const partes = ip.split('.');
  if (partes.length !== 4) return null;

  let valor = 0;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const octeto = Number(parte);
    if (octeto > 255) return null;
    valor = valor * 256 + octeto;
  }
  return valor;
}

function parseIPv6(ip) {
  let endereco = ip.trim().toLowerCase();
  if (endereco.startsWith('[') && endereco.endsWith(']')) {
    endereco = endereco.slice(1, -1);
  }
  const zona = endereco.indexOf('%');
  if (zona !== -1) endereco = endereco.slice(0, zona);

  // IPv4 embutido em IPv6, por exemplo ::ffff:192.0.2.1.
  if (endereco.includes('.')) {
    const ultimoDoisPontos = endereco.lastIndexOf(':');
    if (ultimoDoisPontos === -1) return null;
    const ipv4 = parseIPv4(endereco.slice(ultimoDoisPontos + 1));
    if (ipv4 === null) return null;
    const hexaAlto = Math.floor(ipv4 / 65536).toString(16);
    const hexaBaixo = (ipv4 % 65536).toString(16);
    endereco = `${endereco.slice(0, ultimoDoisPontos + 1)}${hexaAlto}:${hexaBaixo}`;
  }

  const separador = endereco.indexOf('::');
  if (separador !== -1 && endereco.indexOf('::', separador + 2) !== -1) return null;

  let grupos;
  if (separador === -1) {
    grupos = endereco.split(':');
    if (grupos.length !== 8) return null;
  } else {
    const esquerda = endereco.slice(0, separador);
    const direita = endereco.slice(separador + 2);
    const antes = esquerda ? esquerda.split(':') : [];
    const depois = direita ? direita.split(':') : [];
    const zeros = 8 - antes.length - depois.length;
    if (zeros < 1) return null;
    grupos = [...antes, ...Array(zeros).fill('0'), ...depois];
  }

  if (grupos.length !== 8 || grupos.some((grupo) => !/^[0-9a-f]{1,4}$/.test(grupo))) {
    return null;
  }
  return BigInt(`0x${grupos.map((grupo) => grupo.padStart(4, '0')).join('')}`);
}

function intervaloIPv4(cidr) {
  const [ip, prefixoTexto] = cidr.split('/');
  const endereco = parseIPv4(ip);
  const prefixo = Number(prefixoTexto);
  if (endereco === null || !Number.isInteger(prefixo) || prefixo < 0 || prefixo > 32) return null;

  const tamanho = 2 ** (32 - prefixo);
  const inicio = Math.floor(endereco / tamanho) * tamanho;
  return { inicio, fim: inicio + tamanho - 1 };
}

function intervaloIPv6(cidr) {
  const [ip, prefixoTexto] = cidr.split('/');
  const endereco = parseIPv6(ip);
  const prefixo = Number(prefixoTexto);
  if (endereco === null || !Number.isInteger(prefixo) || prefixo < 0 || prefixo > 128) return null;

  const bitsHost = BigInt(128 - prefixo);
  const tamanho = 1n << bitsHost;
  const inicio = (endereco / tamanho) * tamanho;
  return { inicio, fim: inicio + tamanho - 1n };
}

function unirIntervalos(intervalos, maximo) {
  intervalos.sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  const unidos = [];

  for (const intervalo of intervalos) {
    const anterior = unidos[unidos.length - 1];
    if (anterior && intervalo.inicio <= anterior.fim + (typeof maximo === 'bigint' ? 1n : 1)) {
      if (intervalo.fim > anterior.fim) anterior.fim = intervalo.fim;
    } else {
      unidos.push({ ...intervalo });
    }
  }
  return unidos;
}

function criarFaixas(cidrs, converter, maximo) {
  const intervalos = [];
  for (const cidr of cidrs) {
    const intervalo = converter(cidr);
    if (intervalo) intervalos.push(intervalo);
  }
  return unirIntervalos(intervalos, maximo);
}

const faixasIPv4 = criarFaixas(VPN_IPV4_CIDRS, intervaloIPv4, IPV4_MAX);
const faixasIPv6 = criarFaixas(VPN_IPV6_CIDRS, intervaloIPv6, IPV6_MAX);

function contem(faixas, endereco) {
  let esquerda = 0;
  let direita = faixas.length - 1;

  while (esquerda <= direita) {
    const meio = (esquerda + direita) >> 1;
    const faixa = faixas[meio];
    if (endereco < faixa.inicio) direita = meio - 1;
    else if (endereco > faixa.fim) esquerda = meio + 1;
    else return true;
  }
  return false;
}

/** Retorna true quando o IP pertence à lista conhecida de redes VPN. */
export function isVpnIp(ip) {
  if (typeof ip !== 'string') return false;
  const endereco = ip.trim();
  if (!endereco) return false;

  const ipv4 = parseIPv4(endereco);
  if (ipv4 !== null) return contem(faixasIPv4, ipv4);

  const ipv6 = parseIPv6(endereco);
  if (ipv6 === null) return false;

  // Normaliza endereços IPv4 mapeados em IPv6 para que usem também a lista IPv4.
  if ((ipv6 >> 32n) === 0xffffn) {
    return contem(faixasIPv4, Number(ipv6 & 0xffffffffn));
  }
  return contem(faixasIPv6, ipv6);
}

export function getVpnBlocklistStats() {
  return {
    cidrsIpv4: VPN_IPV4_CIDRS.length,
    cidrsIpv6: VPN_IPV6_CIDRS.length,
    faixasIpv4: faixasIPv4.length,
    faixasIpv6: faixasIPv6.length
  };
}
