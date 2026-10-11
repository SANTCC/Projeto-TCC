#!/usr/bin/env node
/** Testes da lista de CIDRs VPN e do middleware de bloqueio Vercel. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
let passed = 0;
let failed = 0;

function check(description, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${description}`);
  } else {
    failed++;
    console.error(`  ❌ ${description}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  console.log('\n=== Bloqueio de VPN no Vercel Edge ===');

  const { isVpnIp, getVpnBlocklistStats } = await import('../edge/vpn-ip.mjs');
  const { createVpnMiddleware, VPN_NOTICE_PATH } = await import('../edge/vpn-gate.mjs');
  const { default: vercelMiddleware, config: vercelMiddlewareConfig } = await import('../middleware.js');
  const stats = getVpnBlocklistStats();

  console.log(`\nLista compilada: ${stats.cidrsIpv4} CIDRs IPv4 / ${stats.cidrsIpv6} CIDRs IPv6.`);
  check('middleware está explicitamente no Edge Runtime', vercelMiddlewareConfig.runtime === 'edge');
  check('snapshot contém a lista geral de IPv4', stats.cidrsIpv4 >= 12000, String(stats.cidrsIpv4));
  check('snapshot contém redes IPv6', stats.cidrsIpv6 >= 400, String(stats.cidrsIpv6));
  check('ProtonVPN — primeiro IP publicado pela fonte específica é bloqueado', isVpnIp('2.58.241.67'));
  check('ProtonVPN — endereço dentro de um CIDR publicado é bloqueado', isVpnIp('5.157.13.5'));
  check('CIDR IPv6 listado é reconhecido', isVpnIp('2001:550:1d05:ffff::1'));
  check('endereço IPv4 mapeado em IPv6 usa a lista IPv4', isVpnIp('::ffff:2.58.241.67'));
  check('IP de documentação não é bloqueado', !isVpnIp('192.0.2.1'));
  check('IPv6 de documentação não é bloqueado', !isVpnIp('2001:db8::1'));
  check('entrada inválida falha aberta sem erro', !isVpnIp('não-é-um-ip'));

  const continuar = () => new Response(null, {
    status: 200,
    headers: { 'x-middleware-next': '1' }
  });
  const middleware = createVpnMiddleware({
    getClientIp: (request) => request.headers.get('x-real-ip'),
    next: continuar
  });

  console.log('\nComportamento do gate:');
  const blockedPage = middleware(new Request('https://nexus.test/index.html?aba=home', {
    headers: { 'x-real-ip': '2.58.241.67' }
  }));
  check('IP VPN recebe redirect antes de servir a página (HTTP 302)', blockedPage.status === 302);
  check('redirect vai só para /vpn-blocked.txt, sem query da página',
    blockedPage.headers.get('location') === 'https://nexus.test/vpn-blocked.txt');
  check('redirect não fica em cache por IP/CDN', blockedPage.headers.get('cache-control') === 'private, no-store');

  const blockedAsset = middleware(new Request('https://nexus.test/js/layout.js', {
    headers: { 'x-real-ip': '2.58.241.67' }
  }));
  check('o bloqueio vale também para arquivos estáticos', blockedAsset.status === 302);

  const blockedPost = middleware(new Request('https://nexus.test/api/login', {
    method: 'POST',
    headers: { 'x-real-ip': '2.58.241.67' },
    body: '{}'
  }));
  check('POST de IP VPN vira GET para o TXT (HTTP 303)', blockedPost.status === 303);

  const blockedNotice = middleware(new Request(`https://nexus.test${VPN_NOTICE_PATH}`, {
    headers: { 'x-real-ip': '2.58.241.67' }
  }));
  check('o próprio TXT é liberado para evitar loop de redirect',
    blockedNotice.headers.get('x-middleware-next') === '1');

  const allowed = middleware(new Request('https://nexus.test/index.html', {
    headers: { 'x-real-ip': '192.0.2.1' }
  }));
  check('IP fora da lista continua normalmente', allowed.headers.get('x-middleware-next') === '1');
  const noIp = middleware(new Request('https://nexus.test/index.html'));
  check('sem IP confiável, o gate não bloqueia visitantes por engano',
    noIp.headers.get('x-middleware-next') === '1');

  const respostaDoAdapterVercel = vercelMiddleware(new Request('https://nexus.test/', {
    headers: { 'x-real-ip': '2.58.241.67' }
  }));
  check('adapter real @vercel/edge lê x-real-ip e aplica o redirect',
    respostaDoAdapterVercel.status === 302
      && respostaDoAdapterVercel.headers.get('location') === 'https://nexus.test/vpn-blocked.txt');

  console.log('\nArtefato plain text:');
  check('vpn-blocked.txt contém exatamente a mensagem pedida',
    read('vpn-blocked.txt') === 'AQUI NÃO!! TICO-TICO!!!!!!!!\n');
  const vercel = JSON.parse(read('vercel.json'));
  const txtHeaders = vercel.headers.find((item) => item.source === '/vpn-blocked.txt');
  const headerMap = Object.fromEntries((txtHeaders?.headers || []).map(({ key, value }) => [key.toLowerCase(), value]));
  check('Vercel publica o destino com Content-Type text/plain',
    headerMap['content-type'] === 'text/plain; charset=utf-8');

  console.log(`\nResultado: ${passed} passou, ${failed} falhou.`);
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(`Erro no teste VPN: ${error.stack || error}`);
  process.exitCode = 1;
});
