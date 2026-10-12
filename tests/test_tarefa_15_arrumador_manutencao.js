/**
 * Teste da Tarefa 15 — Arrumador e Consertador com acesso à Manutenção & OS e bloqueio de Relatórios
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const authGuardCode = fs.readFileSync('js/auth-guard.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.NexusSessionCookies = { lerSessao: () => JSON.stringify({ cargo: 'ARRUMADOR_CONSERTADOR', codigo_individual: 'NX-ARRUMADOR' }) };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = authGuardCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  console.log('--- Testando Permissão do Arrumador/Consertador ---');
  const canAccessManutencao = window.NexusAuth.canAccessPage('manutencao.html');
  const canAccessRelatorios = window.NexusAuth.canAccessPage('relatorios.html');

  console.log('Arrumador pode acessar manutencao.html?:', canAccessManutencao);
  console.log('Arrumador pode acessar relatorios.html?:', canAccessRelatorios);

  assert.strictEqual(canAccessManutencao, true, 'Arrumador e Consertador DEVE ter acesso à página Manutenção & OS');
  assert.strictEqual(canAccessRelatorios, false, 'Arrumador e Consertador NÃO deve ter acesso à página Relatórios & PDF');

  console.log('✅ Teste da Tarefa 15 executado com sucesso!');
  process.exit(0);
}, 100);
