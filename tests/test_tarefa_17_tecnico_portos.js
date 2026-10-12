/**
 * Teste da Tarefa 17 — Permissões e Acessos do Técnico em Portos
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

window.NexusSessionCookies = { lerSessao: () => JSON.stringify({ cargo: 'TECNICO_PORTOS', codigo_individual: 'NX-TECNICO' }) };

const scriptEl = window.document.createElement('script');
scriptEl.textContent = authGuardCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  console.log('--- Testando Permissões do Técnico em Portos ---');

  const canAccessScanner = window.NexusAuth.canAccessPage('scanner.html');
  const canAccessRelatorios = window.NexusAuth.canAccessPage('relatorios.html');
  const canAccessTecnicoPortos = window.NexusAuth.canAccessPage('tecnico_portos.html');

  console.log('Técnico pode acessar scanner.html?:', canAccessScanner);
  console.log('Técnico pode acessar relatorios.html?:', canAccessRelatorios);
  console.log('Técnico pode acessar tecnico_portos.html?:', canAccessTecnicoPortos);

  assert.strictEqual(canAccessScanner, false, 'Técnico em Portos NÃO deve ter acesso à página Scanner QR Code');
  assert.strictEqual(canAccessRelatorios, false, 'Técnico em Portos NÃO deve ter acesso à página Relatórios & PDF');
  assert.strictEqual(canAccessTecnicoPortos, true, 'Técnico em Portos DEVE ter acesso à página Gestão de Pessoas');

  console.log('✅ Teste da Tarefa 17 executado com sucesso!');
  process.exit(0);
}, 100);
