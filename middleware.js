import { ipAddress, next } from '@vercel/edge';
import { createVpnMiddleware } from './edge/vpn-gate.mjs';

// Força o Vercel Edge Runtime mesmo em projetos cuja configuração padrão mudou para Node.js.
export const config = { runtime: 'edge' };

const vpnGate = createVpnMiddleware({ getClientIp: ipAddress, next });

export default function middleware(request) {
  return vpnGate(request);
}
