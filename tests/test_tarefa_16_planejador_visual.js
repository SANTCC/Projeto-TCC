/**
 * Teste da Tarefa 16 — Permissões e Acessos do Planejador de Pátios e de Navios
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const authGuardCode = fs.readFileSync('js/auth-guard.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.NexusSessionCookies = { lerSessao: () => JSON.stringify({ cargo: 'PLANEJADOR_PATIO_NAVIOS', codigo_individual: 'NX-PLANEJADOR' }) };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = authGuardCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  console.log('--- Testando Permissões do Planejador de Pátios e Navios ---');

  const canAccessCargas = window.NexusAuth.canAccessPage('cargas.html');
  const canAccessRelatorios = window.NexusAuth.canAccessPage('relatorios.html');
  const canAccessScanner = window.NexusAuth.canAccessPage('scanner.html');
  const canAccessEmbarcacoes = window.NexusAuth.canAccessPage('embarcacoes.html');

  console.log('Planejador pode acessar cargas.html?:', canAccessCargas);
  console.log('Planejador pode acessar relatorios.html?:', canAccessRelatorios);
  console.log('Planejador pode acessar scanner.html?:', canAccessScanner);
  console.log('Planejador pode acessar embarcacoes.html?:', canAccessEmbarcacoes);

  assert.strictEqual(canAccessCargas, false, 'Planejador NÃO deve ter acesso à página Cargas & Pátio');
  assert.strictEqual(canAccessRelatorios, false, 'Planejador NÃO deve ter acesso à página Relatórios & PDF');
  assert.strictEqual(canAccessScanner, false, 'Planejador NÃO deve ter acesso à página Scanner QR Code');
  assert.strictEqual(canAccessEmbarcacoes, true, 'Planejador DEVE ter acesso à página Embarcações & GPS');

  console.log('✅ Teste da Tarefa 16 executado com sucesso!');
  process.exit(0);
}, 100);
