#!/usr/bin/env node
/** Testes unitários da Edge Function vpn-gate (sem rede e sem Supabase real). */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');
// Mesma biblioteca que a Edge Function carrega como `npm:ipaddr.js@2.5.0`.
const ipaddr = require('ipaddr.js');

const ROOT = path.resolve(__dirname, '..');
let ok = 0;
let falhas = 0;
function check(nome, passou, detalhe) {
  if (passou) {
    ok++;
    console.log(`  ✅ ${nome}`);
  } else {
    falhas++;
    console.error(`  ❌ ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  }
}

async function main() {
  const vpn = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/vpn-gate/handler.js')).href);
  const {
    MENSAGEM_BLOQUEIO,
    FONTES_LISTAS,
    FONTES_GEO_EUA,
    FONTE_IPS_PROTON,
    BLOCOS_PROTON_IPV6_OBSERVADOS,
    ASNS_PROTON_AG,
    ASNS_HOSPEDAGEM_PROTON,
    PREFIXO_MINIMO_BLOCO_PROTON,
    urlBlocosAsn,
    criarUtilitariosIp,
    criarHandler
  } = vpn;
  // Os utilitários de IP/CIDR recebem a biblioteca por injeção (Deno: npm:ipaddr.js).
  const ip = criarUtilitariosIp(ipaddr);

  console.log('\n[1] Parsing e correspondência CIDR IPv4/IPv6');
  const redes = ip.parseListaCIDR([
    '# comentário',
    '198.51.100.0/24',
    '198.51.100.0/24 # repetida',
    '2001:db8:abcd::/48',
    '203.0.113.7',
    'linha inválida'
  ].join('\n'));
  check('CIDR válidos são carregados e duplicatas removidas', redes.length === 3);
  check('IPv4 no /24 é bloqueável', ip.ipPertenceALista('198.51.100.42', redes));
  check('IPv4 fora do /24 não é bloqueado', !ip.ipPertenceALista('198.51.101.42', redes));
  check('IP exato sem máscara vira /32', ip.ipPertenceALista('203.0.113.7', redes));
  check('IPv6 comprimido corresponde a /48', ip.ipPertenceALista('2001:db8:abcd:1234::42', redes));
  check('IPv6 fora do /48 não corresponde', !ip.ipPertenceALista('2001:db8:abce::42', redes));
  check('IPv4-mapped IPv6 usa a lista IPv4', ip.ipPertenceALista('::ffff:198.51.100.8', redes));
  check('prefixos inválidos são rejeitados', ip.parseCIDR('198.51.100.0/33') === null && ip.parseCIDR('2001:db8::/129') === null);
  check('IPv6 baixo válido não é confundido com IPv4', ip.parseIPAddress('::1')?.familia === 6);
  check('IP malformado é rejeitado', ip.parseIPAddress('999.1.2.3') === null && ip.parseIPAddress('2001:::1') === null);
  check('normalizarIp remove colchetes/porta IPv6', ip.normalizarIp('[2001:db8::1]:443') === '2001:db8::1');

  // Regressões do parser caseiro anterior, substituído por ipaddr.js
  // (supabase/functions/_shared/ip.js, compartilhado com log-acesso).
  check('IPv6 malformado é rejeitado (o parser antigo do log-acesso aceitava)',
    ['::::', ':::', '1:2:3:4:5:6:7:8:9', '0:0:0:0:0:0:0:0:0', 'a:b', '2001:db8::1::2', 'fe80::1%eth0']
      .every((v) => ip.normalizarIp(v) === null));
  check('IPv6 com zeros à esquerda é válido e normalizado', ip.normalizarIp('2001:0db8:0000:0000:0000:0000:0000:0001') === '2001:db8::1');
  check('IPv6 terminado em "::" é válido', ip.parseIPAddress('1:2:3:4:5:6:7::') !== null);
  check('IPv6 com zone-id é recusado (não é endereço público canônico)', ip.parseIPAddress('fe80::1%eth0') === null);
  check('rede IPv4 em notação mapeada é comparada na família 4', (() => {
    const mapeada = ip.parseCIDR('::ffff:198.51.100.0/120');
    return !!mapeada && mapeada.familia === 4 && mapeada.prefixo === 24 && mapeada.valor === ip.parseCIDR('198.51.100.0/24').valor;
  })());
  check('prefixo com zero à esquerda é recusado', ip.parseCIDR('198.51.100.0/033') === null);

  console.log('\n[2] Descoberta do IP no gateway');
  const cabeçalhosProxy = new Headers({
    'cf-connecting-ip': '198.51.100.10',
    'x-real-ip': '203.0.113.4',
    'x-forwarded-for': '192.0.2.9, 10.0.0.1'
  });
  check('prioriza cf-connecting-ip', ip.extrairIp(cabeçalhosProxy) === '198.51.100.10');
  check('usa x-real-ip se cf-connecting-ip não existir', ip.extrairIp(new Headers({ 'x-real-ip': '203.0.113.4' })) === '203.0.113.4');
  check('usa o primeiro IP válido de x-forwarded-for', ip.extrairIp(new Headers({ 'x-forwarded-for': '192.0.2.9, 10.0.0.1' })) === '192.0.2.9');
  check('retorna null quando não há IP confiável', ip.extrairIp(new Headers()) === null);

  console.log('\n[3] Endpoint Edge Function, texto simples e cache');
  check('mensagem exata solicitada', MENSAGEM_BLOQUEIO === 'AQUI NÃO!! TICO-TICO!!!!!!!!');
  check('fontes consultadas são listas GitHub conhecidas',
    FONTES_LISTAS.some((f) => f.url.includes('X4BNet/lists_vpn'))
    && FONTES_LISTAS.some((f) => f.url.includes('tn3w/ProtonVPN-IPs'))
    && FONTES_LISTAS.every((f) => f.url.startsWith('https://raw.githubusercontent.com/')));
  check('base geográfica dos EUA usa feeds IPv4 e IPv6 do ipverse',
    FONTES_GEO_EUA.length === 2
    && FONTES_GEO_EUA.some((f) => f.familia === 4 && f.url.endsWith('/us-ipv4.txt'))
    && FONTES_GEO_EUA.some((f) => f.familia === 6 && f.url.endsWith('/us-ipv6.txt')));

  const feedsTeste = [
    { nome: 'vpn-v4', url: 'https://github.test/vpn-v4.txt', minimo: 1 },
    { nome: 'vpn-v6', url: 'https://github.test/vpn-v6.txt', minimo: 1 }
  ];
  const conteudos = new Map([
    [feedsTeste[0].url, '198.51.100.0/24\n203.0.113.7/32\n'],
    [feedsTeste[1].url, '2001:db8:abcd::/48\n']
  ]);
  let chamadasFonte = 0;
  const fetchFonte = async (url) => {
    if (!conteudos.has(url)) throw new Error('URL de teste desconhecida');
    chamadasFonte++;
    return new Response(conteudos.get(url), { status: 200 });
  };
  const handler = criarHandler({ ipaddr, fetchFn: fetchFonte, fontes: feedsTeste, getEnv: () => 'false', now: () => 1_000_000 });

  const criarReq = (ip) => new Request('https://nexus.test/functions/v1/vpn-gate', {
    method: 'GET',
    headers: ip ? { 'cf-connecting-ip': ip } : {}
  });
  const bloqueada = await handler(criarReq('198.51.100.25'));
  const corpo = await bloqueada.text();
  check('IP bloqueado recebe HTTP 403', bloqueada.status === 403);
  check('resposta bloqueada é exatamente o texto pedido', corpo === MENSAGEM_BLOQUEIO);
  check('resposta bloqueada usa text/plain', bloqueada.headers.get('content-type') === 'text/plain; charset=utf-8');

  const liberada = await handler(criarReq('192.0.2.25'));
  check('IP fora das listas recebe HTTP 204', liberada.status === 204);
  check('snapshot é reutilizado enquanto válido', chamadasFonte === feedsTeste.length);

  const preflight = await handler(new Request('https://nexus.test/functions/v1/vpn-gate', { method: 'OPTIONS' }));
  check('preflight CORS recebe HTTP 204', preflight.status === 204);
  check('CORS aceita apikey e authorization', /apikey/i.test(preflight.headers.get('access-control-allow-headers'))
    && /authorization/i.test(preflight.headers.get('access-control-allow-headers')));
  const metodoInvalido = await handler(new Request('https://nexus.test/functions/v1/vpn-gate', { method: 'POST' }));
  check('métodos diferentes de GET são rejeitados', metodoInvalido.status === 405);
  const semIp = await handler(criarReq(null));
  check('sem IP detectável a função falha fechada em texto puro', semIp.status === 503
    && await semIp.text() === MENSAGEM_BLOQUEIO);

  console.log('\n[4] Snapshot em cache quando uma atualização falha');
  let instante = 1_000_000;
  let fonteIndisponivel = false;
  const handlerComCache = criarHandler({
    ipaddr,
    fetchFn: async (url) => {
      if (fonteIndisponivel) throw new Error('GitHub fora do ar');
      return new Response(conteudos.get(url), { status: 200 });
    },
    fontes: feedsTeste,
    getEnv: () => 'false',
    now: () => instante,
    ttlMs: 1_000
  });
  const primeiraVerificacao = await handlerComCache(criarReq('198.51.100.50'));
  instante += 1_001;
  fonteIndisponivel = true;
  const verificacaoComSnapshot = await handlerComCache(criarReq('198.51.100.50'));
  check('primeira consulta carrega listas e bloqueia o IP', primeiraVerificacao.status === 403);
  check('atualização indisponível conserva o último snapshot validado', verificacaoComSnapshot.status === 403);

  console.log('\n[5] Indisponibilidade de feed sem snapshot');
  const handlerIndisponivel = criarHandler({
    ipaddr,
    fetchFn: async () => { throw new Error('GitHub fora do ar'); },
    fontes: [feedsTeste[0]],
    getEnv: () => 'false'
  });
  const falhaFonte = await handlerIndisponivel(criarReq('192.0.2.2'));
  check('sem snapshot e sem lista, não libera a página (HTTP 503)', falhaFonte.status === 503);
  check('falha de feed também retorna somente o texto definido', await falhaFonte.text() === MENSAGEM_BLOQUEIO);

  console.log('\n[6] Geobloqueio dos EUA: padrão ligado, prioridade e toggle');
  const fontesGeoTeste = [
    { familia: 4, nome: 'eua-v4', url: 'https://github.test/eua-v4.txt', minimo: 1 },
    { familia: 6, nome: 'eua-v6', url: 'https://github.test/eua-v6.txt', minimo: 1 }
  ];
  const conteudosGeo = new Map([
    [fontesGeoTeste[0].url, '203.0.113.0/24\n'],
    [fontesGeoTeste[1].url, '2001:db8:ffff::/48\n']
  ]);
  let chamadasGeo = 0;
  let chamadasVpnGeo = 0;
  const fetchGeo = async (url) => {
    if (conteudosGeo.has(url)) {
      chamadasGeo++;
      return new Response(conteudosGeo.get(url), { status: 200 });
    }
    if (conteudos.has(url)) {
      chamadasVpnGeo++;
      return new Response(conteudos.get(url), { status: 200 });
    }
    throw new Error('URL de teste desconhecida');
  };
  const handlerGeoPadrao = criarHandler({
    ipaddr,
    fetchFn: fetchGeo,
    fontes: feedsTeste,
    fontesGeoEua: fontesGeoTeste,
    now: () => 2_000_000
  });
  const ipEuaV4 = await handlerGeoPadrao(criarReq('203.0.113.50'));
  check('geobloqueio é ligado por padrão e bloqueia IPv4 dos EUA', ipEuaV4.status === 403
    && await ipEuaV4.text() === MENSAGEM_BLOQUEIO);
  check('decisão geográfica precede VPN e não carrega os feeds VPN', chamadasGeo === 1 && chamadasVpnGeo === 0);
  const ipEuaV6 = await handlerGeoPadrao(criarReq('2001:db8:ffff::12'));
  check('geobloqueio também reconhece IPv6 dos EUA', ipEuaV6.status === 403 && chamadasVpnGeo === 0);
  const ipForaEua = await handlerGeoPadrao(criarReq('192.0.2.99'));
  check('IP fora dos EUA continua para a verificação VPN', ipForaEua.status === 204
    && chamadasVpnGeo === feedsTeste.length);

  let chamadasGeoDesligado = 0;
  const handlerGeoDesligado = criarHandler({
    ipaddr,
    fetchFn: async (url) => {
      if (conteudosGeo.has(url)) {
        chamadasGeoDesligado++;
        return new Response(conteudosGeo.get(url), { status: 200 });
      }
      return new Response(conteudos.get(url), { status: 200 });
    },
    fontes: feedsTeste,
    fontesGeoEua: fontesGeoTeste,
    getEnv: () => 'false',
    now: () => 3_000_000
  });
  const ipEuaComToggleOff = await handlerGeoDesligado(criarReq('203.0.113.50'));
  check('VPN_GATE_BLOCK_US=false desliga só o geobloqueio', ipEuaComToggleOff.status === 204
    && chamadasGeoDesligado === 0);

  const handlerGeoIndisponivel = criarHandler({
    ipaddr,
    fetchFn: async () => { throw new Error('GitHub fora do ar'); },
    fontes: feedsTeste,
    fontesGeoEua: fontesGeoTeste,
    now: () => 4_000_000
  });
  const erroGeo = await handlerGeoIndisponivel(criarReq('192.0.2.50'));
  check('sem feed geográfico validado, a função falha fechada antes de liberar', erroGeo.status === 503
    && await erroGeo.text() === MENSAGEM_BLOQUEIO);

  console.log('\n[7] Integração do build e configuração Supabase');
  const configToml = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
  check('vpn-gate está configurada sem validação JWT no gateway', /\[functions\.vpn-gate\][\s\S]*?verify_jwt\s*=\s*false/.test(configToml));
  const edgeEntry = fs.readFileSync(path.join(ROOT, 'supabase/functions/vpn-gate/index.ts'), 'utf8');
  check('Edge Function lê o toggle geográfico no servidor', edgeEntry.includes('Deno.env.get(nome)')
    && edgeEntry.includes('VPN_GATE_BLOCK_US'));
  const build = fs.readFileSync(path.join(ROOT, 'tools/build.js'), 'utf8');
  check('build injeta o gate em todas as páginas estáticas', build.includes('aplicarVpnGate(html, rel)')
    && build.includes('css/vpn-gate.css') && build.includes('js/vpn-gate.js'));
  const ui = fs.readFileSync(path.join(ROOT, 'js/vpn-gate.js'), 'utf8');
  check('UI só revela a página após HTTP 204 e redireciona para plain text ao bloquear',
    ui.includes('resposta.status === 204') && ui.includes("type: 'text/plain;charset=utf-8'")
    && ui.includes('window.location.replace'));

  async function simularUi(resposta, config = {
    SUPABASE_URL: 'https://nexus.test.supabase.co',
    SUPABASE_ANON_KEY: 'public-test-key'
  }) {
    const classes = new Set(['nexus-vpn-gate-checking']);
    const body = { textContent: 'conteúdo da aplicação', style: {} };
    const URLTeste = class extends URL {};
    URLTeste.createObjectURL = () => { throw new Error('fallback plain text'); };
    let chamadas = 0;
    const contexto = {
      document: {
        documentElement: { classList: {
          contains: (classe) => classes.has(classe),
          remove: (classe) => classes.delete(classe)
        } },
        body
      },
      window: {
        location: { hostname: 'app.example.test', replace: () => {} },
        NEXUS_CONFIG: config,
        fetch: async () => { chamadas++; return resposta; }
      },
      URL: URLTeste,
      Blob,
      console: { warn: () => {} }
    };
    vm.runInNewContext(ui, contexto, { filename: 'js/vpn-gate.js' });
    await new Promise((resolve) => setImmediate(resolve));
    return { classes, body, chamadas };
  }

  const uiLiberada = await simularUi({ status: 204, text: async () => '' });
  check('no navegador, HTTP 204 revela a tela', !uiLiberada.classes.has('nexus-vpn-gate-checking')
    && uiLiberada.body.textContent === 'conteúdo da aplicação');
  const uiBloqueada = await simularUi({ status: 403, text: async () => MENSAGEM_BLOQUEIO });
  check('no navegador, HTTP 403 deixa somente o texto de bloqueio', uiBloqueada.body.textContent === MENSAGEM_BLOQUEIO);
  const uiFalha = await simularUi(Promise.reject(new Error('rede indisponível')));
  check('no navegador, falha de rede também fecha o gate', uiFalha.body.textContent === MENSAGEM_BLOQUEIO);
  const uiOffline = await simularUi({ status: 204, text: async () => '' }, {
    SUPABASE_URL: 'https://sua-url-supabase.supabase.co',
    SUPABASE_ANON_KEY: 'sua-chave-anon-aqui'
  });
  check('configuração de exemplo mantém o modo offline e não chama a função',
    uiOffline.chamadas === 0 && !uiOffline.classes.has('nexus-vpn-gate-checking'));

  console.log('\n[8] Camada Proton: ASNs próprias, blocos BGP, IPv6 observado e nível de bloqueio');
  check('ASNs próprias da Proton AG são as registradas no RIPE/ipverse',
    ASNS_PROTON_AG.includes('209103') && ASNS_PROTON_AG.includes('208172'));
  check('ASNs de hospedagem incluem Datacamp, M247, WorldStream e CDN77',
    ['212238', '9009', '49981', '60068'].every((asn) => ASNS_HOSPEDAGEM_PROTON.includes(asn)));
  check('blocos anunciados vêm do ipverse (agregados por ASN, IPv4 e IPv6)',
    urlBlocosAsn('209103', 'ipv4') === 'https://raw.githubusercontent.com/ipverse/as-ip-blocks/master/as/209103/ipv4-aggregated.txt'
    && urlBlocosAsn('209103', 'ipv6').endsWith('/209103/ipv6-aggregated.txt'));
  check('IPs anunciados vêm do tn3w/ProtonVPN-IPs',
    /tn3w\/ProtonVPN-IPs/.test(FONTE_IPS_PROTON.url) && FONTE_IPS_PROTON.minimo >= 50);
  check('expansão nunca herda blocos maiores que /20 (evita backbone inteiro)',
    PREFIXO_MINIMO_BLOCO_PROTON === 20);
  const redesProtonIpv6Observadas = ip.parseListaCIDR(BLOCOS_PROTON_IPV6_OBSERVADOS.join('\n'));
  check('os dois IPv6 relatados estão protegidos por prefixos /64 específicos',
    BLOCOS_PROTON_IPV6_OBSERVADOS.length === 2
    && BLOCOS_PROTON_IPV6_OBSERVADOS.every((cidr) => cidr.endsWith('/64'))
    && ip.ipPertenceALista('2a02:6ea0:510c:3882::13', redesProtonIpv6Observadas)
    && ip.ipPertenceALista('2a02:6ea0:ce14:3032::12', redesProtonIpv6Observadas));
  check('a regra IPv6 evita herdar a rota compartilhada inteira da CDN77',
    !ip.ipPertenceALista('2a02:6ea0:ce14:3033::12', redesProtonIpv6Observadas)
    && !ip.ipPertenceALista('2a02:6ea0:ce15::12', redesProtonIpv6Observadas));

  const redesAnunciadas = ip.parseListaCIDR(['192.0.2.0/22', '10.20.0.0/16', '172.16.40.0/21'].join('\n'));
  const blocoEspecifico = ip.menorBlocoContido('192.0.2.40', redesAnunciadas, 20);
  check('menorBlocoContido escolhe o prefixo mais específico que contém o IP',
    !!blocoEspecifico && blocoEspecifico.prefixo === 22 && blocoEspecifico.valor === ip.parseCIDR('192.0.2.0/22').valor);
  check('menorBlocoContido respeita o piso /20', ip.menorBlocoContido('10.20.30.40', redesAnunciadas, 20) === null);
  check('menorBlocoContido devolve null para IP fora das redes', ip.menorBlocoContido('203.0.113.9', redesAnunciadas, 20) === null);

  const ASNS_PROPIAS_TESTE = ['64500'];
  const ASNS_HOSPEDAGEM_TESTE = ['64510', '64511'];
  // A fonte real exige um mínimo de IPs anunciados para aceitar a lista; o fixture
  // precisa ter o mesmo tamanho mínimo para exercitar o caminho de produção.
  const ipsAnunciadosFicticios = [
    '192.0.2.40', '10.20.30.40', '172.16.45.10',
    ...Array.from({ length: FONTE_IPS_PROTON.minimo }, (_, i) => `192.0.3.${(i % 200) + 1}`)
  ];
  const conteudosProton = new Map([
    [urlBlocosAsn('64500', 'ipv4'), '203.0.113.0/24\n198.51.100.128/25\n'],
    [urlBlocosAsn('64500', 'ipv6'), '2001:db8:aaaa::/48\n'],
    [urlBlocosAsn('64510', 'ipv4'), '192.0.2.0/22\n10.20.0.0/16\n'],
    [urlBlocosAsn('64511', 'ipv4'), '172.16.40.0/21\n'],
    [FONTE_IPS_PROTON.url, `${ipsAnunciadosFicticios.join('\n')}\n`]
  ]);
  const fonteVpnProton = { nome: 'vpn-v4', url: 'https://github.test/vpn-v4.txt', minimo: 1 };
  const conteudoVpnProton = '198.51.100.0/24\n';
  let chamadasProton = 0;
  const fetchProton = async (url) => {
    if (url === fonteVpnProton.url) return new Response(conteudoVpnProton, { status: 200 });
    if (!conteudosProton.has(url)) throw new Error(`fonte ausente: ${url}`);
    chamadasProton++;
    return new Response(conteudosProton.get(url), { status: 200 });
  };
  const reqComIp = (ip) => new Request('https://nexus.test/functions/v1/vpn-gate', {
    method: 'GET',
    headers: { 'cf-connecting-ip': ip }
  });
  const handlerProton = criarHandler({
    ipaddr,
    fetchFn: fetchProton,
    fontes: [fonteVpnProton],
    asnsProprias: ASNS_PROPIAS_TESTE,
    asnsHospedagem: ASNS_HOSPEDAGEM_TESTE,
    getEnv: () => 'false',
    now: () => 5_000_000
  });

  const dentroAsnPropria = await handlerProton(reqComIp('203.0.113.77'));
  check('IP de ASN própria da Proton é bloqueado mesmo sem estar nas listas públicas',
    dentroAsnPropria.status === 403 && await dentroAsnPropria.text() === MENSAGEM_BLOQUEIO);
  check('cabeçalho de diagnóstico informa a camada que bloqueou',
    dentroAsnPropria.headers.get('x-vpn-gate-motivo') === 'proton');
  check('CORS expõe o cabeçalho de diagnóstico para o operador',
    /x-vpn-gate-motivo/i.test(dentroAsnPropria.headers.get('access-control-expose-headers') || ''));
  const asnPropriaIpv6 = await handlerProton(reqComIp('2001:db8:aaaa::42'));
  check('IPv6 das ASNs próprias também é bloqueado', asnPropriaIpv6.status === 403);
  const saidaProtonIpv6A = await handlerProton(reqComIp('2a02:6ea0:510c:3882::13'));
  const saidaProtonIpv6B = await handlerProton(reqComIp('2a02:6ea0:ce14:3032::12'));
  check('os dois IPv6 observados são bloqueados com motivo proton',
    saidaProtonIpv6A.status === 403 && saidaProtonIpv6B.status === 403
    && saidaProtonIpv6A.headers.get('x-vpn-gate-motivo') === 'proton'
    && saidaProtonIpv6B.headers.get('x-vpn-gate-motivo') === 'proton');
  const outro64Cdn77 = await handlerProton(reqComIp('2a02:6ea0:ce14:3033::12'));
  check('outro /64 do prefixo compartilhado não é bloqueado por engano', outro64Cdn77.status === 204);
  let chamadasParaBloqueioEstatico = 0;
  const handlerIpv6ObservadoSemRede = criarHandler({
    ipaddr,
    fetchFn: async () => {
      chamadasParaBloqueioEstatico++;
      throw new Error('GitHub indisponível');
    },
    fontes: [fonteVpnProton],
    asnsProprias: [],
    asnsHospedagem: [],
    getEnv: () => 'false'
  });
  const bloqueioIpv6OfflineA = await handlerIpv6ObservadoSemRede(reqComIp('2a02:6ea0:510c:3882::13'));
  const bloqueioIpv6OfflineB = await handlerIpv6ObservadoSemRede(reqComIp('2a02:6ea0:ce14:3032::12'));
  check('os dois /64 são bloqueados imediatamente, sem consultar feeds externos',
    bloqueioIpv6OfflineA.status === 403 && bloqueioIpv6OfflineB.status === 403
    && chamadasParaBloqueioEstatico === 0);
  const vizinhoDoAnunciado = await handlerProton(reqComIp('192.0.3.9'));
  check('saída NAT em /24 vizinho do bloco anunciado é bloqueada (antes escapava)',
    vizinhoDoAnunciado.status === 403 && vizinhoDoAnunciado.headers.get('x-vpn-gate-motivo') === 'proton');
  const mesmoBloco24 = await handlerProton(reqComIp('10.20.30.99'));
  check('IP no mesmo /24 de um anunciado é bloqueado', mesmoBloco24.status === 403);
  const foraDoBlocoCapado = await handlerProton(reqComIp('10.20.31.99'));
  check('agregado maior que /20 não é herdado inteiro', foraDoBlocoCapado.status === 204);
  const hospedagemSecundaria = await handlerProton(reqComIp('172.16.47.5'));
  check('bloco anunciado de outra hospedagem também é bloqueado', hospedagemSecundaria.status === 403);
  check('camada Proton mantém cache e não repete downloads na mesma janela',
    chamadasProton === conteudosProton.size);

  const handlerAgressivo = criarHandler({
    ipaddr,
    fetchFn: fetchProton,
    fontes: [fonteVpnProton],
    asnsProprias: ASNS_PROPIAS_TESTE,
    asnsHospedagem: ASNS_HOSPEDAGEM_TESTE,
    getEnv: (nome) => (nome === 'VPN_GATE_NIVEL' ? 'agressivo' : 'false'),
    now: () => 6_000_000
  });
  const foraDeQualquerBloco = await handlerProton(reqComIp('10.20.99.99'));
  check('modo padrão não herda o ASN inteiro do provedor de hospedagem', foraDeQualquerBloco.status === 204);
  const hosterInteiro = await handlerAgressivo(reqComIp('10.20.99.99'));
  check('VPN_GATE_NIVEL=agressivo bloqueia todo o espaço anunciado da hospedagem',
    hosterInteiro.status === 403 && hosterInteiro.headers.get('x-vpn-gate-motivo') === 'proton');
  const ipNeutroAgressivo = await handlerAgressivo(reqComIp('198.18.5.5'));
  check('modo agressivo continua liberando IP fora de todas as fontes', ipNeutroAgressivo.status === 204);

  const handlerSemCamadaProton = criarHandler({
    ipaddr,
    fetchFn: async (url) => {
      if (url === fonteVpnProton.url) return new Response(conteudoVpnProton, { status: 200 });
      throw new Error('GitHub fora do ar');
    },
    fontes: [fonteVpnProton],
    asnsProprias: ASNS_PROPIAS_TESTE,
    asnsHospedagem: ASNS_HOSPEDAGEM_TESTE,
    getEnv: () => 'false',
    now: () => 7_000_000
  });
  const semReforco = await handlerSemCamadaProton(reqComIp('192.0.2.77'));
  check('camada Proton indisponível é reforço ausente, não bloqueio geral (HTTP 204)', semReforco.status === 204);
  const vpnSemReforco = await handlerSemCamadaProton(reqComIp('198.51.100.30'));
  check('listas de VPN seguem decidindo quando a camada Proton falha',
    vpnSemReforco.status === 403 && vpnSemReforco.headers.get('x-vpn-gate-motivo') === 'vpn');
  const urlsSolicitadas = [];
  const handlerFontesReais = criarHandler({
    ipaddr,
    fetchFn: async (url) => {
      urlsSolicitadas.push(url);
      if (url === FONTE_IPS_PROTON.url) {
        const ipAnunciado = ['62.169.136.40'];
        while (ipAnunciado.length < FONTE_IPS_PROTON.minimo) ipAnunciado.push('62.169.136.41');
        return new Response(`${ipAnunciado.join('\n')}\n`, { status: 200 });
      }
      if (/ipverse\/as-ip-blocks/.test(url)) return new Response('62.169.136.0/23\n', { status: 200 });
      return new Response(conteudoVpnProton, { status: 200 });
    },
    fontes: [fonteVpnProton],
    getEnv: () => 'false',
    now: () => 8_000_000
  });
  const ipDaProtonReal = await handlerFontesReais(reqComIp('62.169.136.44'));
  check('produção consulta as ASNs próprias e a lista de hospedagem da Proton',
    ipDaProtonReal.status === 403 && ipDaProtonReal.headers.get('x-vpn-gate-motivo') === 'proton'
    && urlsSolicitadas.some((u) => u.includes('/as/209103/ipv4-aggregated.txt'))
    && urlsSolicitadas.some((u) => u.includes('/as/208172/ipv4-aggregated.txt'))
    && urlsSolicitadas.some((u) => u.includes('/as/212238/ipv4-aggregated.txt'))
    && urlsSolicitadas.some((u) => u.includes('tn3w/ProtonVPN-IPs/master/protonvpn_ips.txt')));

  console.log(`\nResultado: ${ok} aprovados, ${falhas} falhas.`);
  process.exit(falhas ? 1 : 0);
}

main().catch((erro) => {
  console.error('❌ Erro inesperado nos testes de vpn-gate:', erro);
  process.exit(1);
});
