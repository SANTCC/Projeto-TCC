/**
 * Teste da Tarefa 14 — Conferente de Carga com permissão de Checklist/Inspeção
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const authGuardCode = fs.readFileSync('js/auth-guard.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.NexusSessionCookies = { lerSessao: () => JSON.stringify({ cargo: 'CONFERENTE_CARGA', codigo_individual: 'NX-CONFERENTE' }) };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = authGuardCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  console.log('--- Testando Permissão do Conferente para inspecao.html (Checklist) ---');
  const canAccessInspecao = window.NexusAuth.canAccessPage('inspecao.html');
  console.log('Conferente pode acessar inspecao.html?:', canAccessInspecao);

  assert.strictEqual(canAccessInspecao, true, 'Conferente de Carga DEVE ter acesso à página de inspeção/checklist');

  console.log('✅ Teste da Tarefa 14 executado com sucesso!');
  process.exit(0);
}, 100);
