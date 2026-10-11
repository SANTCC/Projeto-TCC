#!/usr/bin/env node
/**
 * Atualiza a snapshot usada pelo middleware da Vercel a partir da lista MIT X4BNet.
 * Executado automaticamente pelo lifecycle `prebuild` e manualmente com `npm run vpn:update`.
 */
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');

const REPOSITORY = 'X4BNet/lists_vpn';
const REF = 'main';
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}/contents`;
const OUTPUT = path.join(__dirname, '..', 'edge', 'vpn-cidrs.mjs');
const SOURCE_FILES = {
  ipv4: 'output/vpn/ipv4.txt',
  ipv6: 'output/vpn/ipv6.txt',
  proton: 'input/vpn/ips/protonvpn.txt'
};

function validarLista(texto, familia, origem) {
  const maxPrefixo = familia === 4 ? 32 : 128;
  const lista = [];

  for (const linhaOriginal of texto.split(/\r?\n/)) {
    const linha = linhaOriginal.trim();
    if (!linha || linha.startsWith('#')) continue;

    const partes = linha.split('/');
    if (partes.length > 2 || net.isIP(partes[0]) !== familia) {
      throw new Error(`CIDR inválido em ${origem}: ${linha}`);
    }

    const prefixo = partes.length === 1 ? maxPrefixo : Number(partes[1]);
    if (!Number.isInteger(prefixo) || prefixo < 0 || prefixo > maxPrefixo) {
      throw new Error(`Prefixo inválido em ${origem}: ${linha}`);
    }
    lista.push(`${partes[0]}/${prefixo}`);
  }

  return [...new Set(lista)];
}

async function baixarArquivo(caminho) {
  const url = `${API_ROOT}/${caminho}?ref=${encodeURIComponent(REF)}`;
  const argumentos = [
    '-fsSL',
    '--max-time', '20',
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-H', 'User-Agent: nexusport-vpn-ip-blocklist-updater'
  ];
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN;
  if (token) argumentos.push('-H', `Authorization: Bearer ${token}`);
  argumentos.push(url);

  // `curl` respeita o proxy configurado no ambiente do build (inclusive CI); não depende de módulos extras.
  let resposta;
  try {
    resposta = execFileSync('curl', argumentos, {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (erro) {
    // Não propaga o erro original: ele inclui todos os argumentos do processo e poderia expor um token.
    throw new Error(`Falha de rede ao buscar ${caminho} no GitHub (curl: ${erro.status ?? erro.code ?? 'erro'}).`);
  }
  const arquivo = JSON.parse(resposta);
  if (arquivo.encoding !== 'base64' || typeof arquivo.content !== 'string') {
    throw new Error(`Formato inesperado retornado pelo GitHub para ${caminho}`);
  }
  return Buffer.from(arquivo.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

function gerarModulo(ipv4, ipv6) {
  // As fontes contêm somente dígitos, pontos, dois-pontos e barras; não há conteúdo executável.
  const listaComoTexto = (lista) => JSON.stringify(lista);
  return [
    '// Gerado por `npm run vpn:update`; não editar manualmente.',
    '// Fonte: https://github.com/X4BNet/lists_vpn (MIT), mais a lista específica ProtonVPN.',
    `export const VPN_IPV4_CIDRS = ${listaComoTexto(ipv4)};`,
    `export const VPN_IPV6_CIDRS = ${listaComoTexto(ipv6)};`,
    ''
  ].join('\n');
}

async function atualizar() {
  let conteudos;
  try {
    conteudos = await Promise.all(Object.entries(SOURCE_FILES).map(async ([nome, caminho]) => [
      nome,
      await baixarArquivo(caminho)
    ]));
  } catch (erro) {
    if (fs.existsSync(OUTPUT) && process.env.REQUIRE_VPN_BLOCKLIST_UPDATE !== '1') {
      console.warn(`Aviso: não foi possível atualizar a lista no GitHub (${erro.message}); usando a snapshot existente.`);
      return { atualizado: false, fallback: true };
    }
    throw erro;
  }

  const arquivos = Object.fromEntries(conteudos);
  const ipv4Agregado = validarLista(arquivos.ipv4, 4, SOURCE_FILES.ipv4);
  const ipv6 = validarLista(arquivos.ipv6, 6, SOURCE_FILES.ipv6);
  const proton = validarLista(arquivos.proton, 4, SOURCE_FILES.proton);

  // Guard rails: não substitui uma lista completa por resposta vazia, HTML de erro ou arquivo errado.
  if (ipv4Agregado.length < 1000 || ipv6.length < 50 || proton.length < 500) {
    throw new Error(
      `Lista upstream inesperadamente pequena (IPv4=${ipv4Agregado.length}, IPv6=${ipv6.length}, ProtonVPN=${proton.length}).`
    );
  }

  const ipv4 = [...new Set([...ipv4Agregado, ...proton])].sort();
  const modulo = gerarModulo(ipv4, ipv6);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  const anterior = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';

  if (modulo === anterior) {
    console.log(`Lista já atualizada: ${ipv4.length} CIDRs IPv4 (incluindo ProtonVPN) e ${ipv6.length} CIDRs IPv6.`);
    return { atualizado: false, fallback: false };
  }

  fs.writeFileSync(OUTPUT, modulo, 'utf8');
  console.log(`Lista atualizada: ${ipv4.length} CIDRs IPv4 (incluindo ${proton.length} ProtonVPN) e ${ipv6.length} CIDRs IPv6.`);
  return { atualizado: true, fallback: false };
}

if (require.main === module) {
  atualizar().catch((erro) => {
    console.error(`Falha ao validar/atualizar a lista de VPNs: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = { atualizar, validarLista, gerarModulo, SOURCE_FILES };
