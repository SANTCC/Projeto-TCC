#!/usr/bin/env node
/** Testes unitários da Edge Function vpn-gate (sem rede e sem Supabase real). */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');

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
    parseIPAddress,
    parseCIDR,
    parseListaCIDR,
    ipPertenceALista,
    normalizarIp,
    extrairIp,
    criarHandler
  } = vpn;

  console.log('\n[1] Parsing e correspondência CIDR IPv4/IPv6');
  const redes = parseListaCIDR([
    '# comentário',
    '198.51.100.0/24',
    '198.51.100.0/24 # repetida',
    '2001:db8:abcd::/48',
    '203.0.113.7',
    'linha inválida'
  ].join('\n'));
  check('CIDR válidos são carregados e duplicatas removidas', redes.length === 3);
  check('IPv4 no /24 é bloqueável', ipPertenceALista('198.51.100.42', redes));
  check('IPv4 fora do /24 não é bloqueado', !ipPertenceALista('198.51.101.42', redes));
  check('IP exato sem máscara vira /32', ipPertenceALista('203.0.113.7', redes));
  check('IPv6 comprimido corresponde a /48', ipPertenceALista('2001:db8:abcd:1234::42', redes));
  check('IPv6 fora do /48 não corresponde', !ipPertenceALista('2001:db8:abce::42', redes));
  check('IPv4-mapped IPv6 usa a lista IPv4', ipPertenceALista('::ffff:198.51.100.8', redes));
  check('prefixos inválidos são rejeitados', parseCIDR('198.51.100.0/33') === null && parseCIDR('2001:db8::/129') === null);
  check('IPv6 baixo válido não é confundido com IPv4', parseIPAddress('::1')?.familia === 6);
  check('IP malformado é rejeitado', parseIPAddress('999.1.2.3') === null && parseIPAddress('2001:::1') === null);
  check('normalizarIp remove colchetes/porta IPv6', normalizarIp('[2001:db8::1]:443') === '2001:db8::1');

  console.log('\n[2] Descoberta do IP no gateway');
  const cabeçalhosProxy = new Headers({
    'cf-connecting-ip': '198.51.100.10',
    'x-real-ip': '203.0.113.4',
    'x-forwarded-for': '192.0.2.9, 10.0.0.1'
  });
  check('prioriza cf-connecting-ip', extrairIp(cabeçalhosProxy) === '198.51.100.10');
  check('usa x-real-ip se cf-connecting-ip não existir', extrairIp(new Headers({ 'x-real-ip': '203.0.113.4' })) === '203.0.113.4');
  check('usa o primeiro IP válido de x-forwarded-for', extrairIp(new Headers({ 'x-forwarded-for': '192.0.2.9, 10.0.0.1' })) === '192.0.2.9');
  check('retorna null quando não há IP confiável', extrairIp(new Headers()) === null);

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
    chamadasFonte++;
    if (!conteudos.has(url)) throw new Error('URL de teste desconhecida');
    return new Response(conteudos.get(url), { status: 200 });
  };
  const handler = criarHandler({ fetchFn: fetchFonte, fontes: feedsTeste, getEnv: () => 'false', now: () => 1_000_000 });

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

  console.log(`\nResultado: ${ok} aprovados, ${falhas} falhas.`);
  process.exit(falhas ? 1 : 0);
}

main().catch((erro) => {
  console.error('❌ Erro inesperado nos testes de vpn-gate:', erro);
  process.exit(1);
});
