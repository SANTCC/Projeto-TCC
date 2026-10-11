import { isVpnIp } from './vpn-ip.mjs';

export const VPN_NOTICE_PATH = '/vpn-blocked.txt';

/** Cria o gate de middleware, isolando a API específica da plataforma para facilitar os testes. */
export function createVpnMiddleware({ getClientIp, next }) {
  if (typeof getClientIp !== 'function' || typeof next !== 'function') {
    throw new TypeError('getClientIp e next precisam ser funções.');
  }

  return function vpnMiddleware(request) {
    const url = new URL(request.url);

    // O destino do redirecionamento precisa continuar acessível, senão haveria um loop.
    if (url.pathname === VPN_NOTICE_PATH) return next();

    const clientIp = getClientIp(request);
    if (!clientIp || !isVpnIp(clientIp)) return next();

    const destino = new URL(VPN_NOTICE_PATH, url);
    // POST/OPTIONS também terminam na página .txt por GET, sem reenviar o corpo para o arquivo.
    const status = request.method === 'GET' || request.method === 'HEAD' ? 302 : 303;
    return new Response(null, {
      status,
      headers: {
        Location: destino.toString(),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  };
}
