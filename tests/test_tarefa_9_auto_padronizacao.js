/**
 * Teste da Tarefa 9 — Hífen e Caixa Alta automáticos em campos de matrícula e código
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const codePadronizacao = fs.readFileSync('js/padronizacao-codigos.js', 'utf8');

const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <input type="text" id="inputMatricula" placeholder="Digite a matrícula (ex: MAT-2001)" />
  <input type="text" id="inputImo" placeholder="Digite o IMO" />
  <input type="text" id="inputContainer" placeholder="Identificação do Contêiner" />
  <input type="text" id="inputGuindaste" placeholder="Código do Guindaste" />
  <input type="search" id="inputBuscaGeral" placeholder="Procurar por código ou matrícula..." />
</body>
</html>
`;

const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

const scriptEl = window.document.createElement('script');
scriptEl.textContent = codePadronizacao;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  const inputMatricula = window.document.getElementById('inputMatricula');
  const inputImo = window.document.getElementById('inputImo');
  const inputContainer = window.document.getElementById('inputContainer');
  const inputGuindaste = window.document.getElementById('inputGuindaste');
  const inputBuscaGeral = window.document.getElementById('inputBuscaGeral');

  console.log('--- Testando Digitação de Matrícula (mat2001 -> MAT-2001) ---');
  inputMatricula.value = 'mat2001';
  inputMatricula.dispatchEvent(new window.Event('input'));
  console.log('Resultado Matrícula:', inputMatricula.value);
  assert.strictEqual(inputMatricula.value, 'MAT-2001', 'Matrícula digitada em minúsculo e sem hífen deve virar MAT-2001');

  console.log('--- Testando Digitação de IMO (imo1234567 -> IMO-1234567) ---');
  inputImo.value = 'imo1234567';
  inputImo.dispatchEvent(new window.Event('input'));
  console.log('Resultado IMO:', inputImo.value);
  assert.strictEqual(inputImo.value, 'IMO-1234567', 'IMO digitado em minúsculo e sem hífen deve virar IMO-1234567');

  console.log('--- Testando Digitação de Contêiner (mscu1234567 -> MSCU-1234567) ---');
  inputContainer.value = 'mscu1234567';
  inputContainer.dispatchEvent(new window.Event('input'));
  console.log('Resultado Contêiner:', inputContainer.value);
  assert.strictEqual(inputContainer.value, 'MSCU-1234567', 'Contêiner deve virar MSCU-1234567');

  console.log('--- Testando Digitação de Guindaste (abc123def -> ABC-123-DEF) ---');
  inputGuindaste.value = 'abc123def';
  inputGuindaste.dispatchEvent(new window.Event('input'));
  console.log('Resultado Guindaste:', inputGuindaste.value);
  assert.strictEqual(inputGuindaste.value, 'ABC-123-DEF', 'Guindaste deve virar ABC-123-DEF');

  console.log('--- Testando Busca Geral (mat1001 -> MAT-1001) ---');
  inputBuscaGeral.value = 'mat1001';
  inputBuscaGeral.dispatchEvent(new window.Event('input'));
  console.log('Resultado Busca Geral:', inputBuscaGeral.value);
  assert.strictEqual(inputBuscaGeral.value, 'MAT-1001', 'Busca por matrícula deve formatar para MAT-1001');

  console.log('✅ Teste da Tarefa 9 executado com sucesso!');
}, 200);
