/**
 * Teste da Tarefa 13 — Ajustes Visuais e Permissões do Estivador
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const authGuardCode = fs.readFileSync('js/auth-guard.js', 'utf8');

const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
</body>
</html>
`;

const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.NexusSessionCookies = { lerSessao: () => JSON.stringify({ cargo: 'ESTIVADOR', codigo_individual: 'NX-ESTIVADOR' }) };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = authGuardCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  console.log('--- Testando Permissão do Estivador para relatorios.html ---');
  const canAccessRelatorios = window.NexusAuth.canAccessPage('relatorios.html');
  console.log('Estivador pode acessar relatorios.html?:', canAccessRelatorios);

  assert.strictEqual(canAccessRelatorios, false, 'Estivador NÃO deve ter acesso à página Relatórios & PDF');

  const canAccessCargas = window.NexusAuth.canAccessPage('cargas.html');
  console.log('Estivador pode acessar cargas.html?:', canAccessCargas);
  assert.strictEqual(canAccessCargas, true, 'Estivador deve ter acesso à página Cargas & Pátio');

  console.log('✅ Teste da Tarefa 13 executado com sucesso!');
  process.exit(0);
}, 100);
