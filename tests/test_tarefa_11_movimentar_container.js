/**
 * Teste da Tarefa 11 — Opção de movimentação de carga para contêiner vinculado
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const cargasCode = fs.readFileSync('js/pages/cargas.js', 'utf8');

const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="cargasTableBody"></div>
  <div id="movimentarModal" class="hidden">
    <span id="movimentarCargaIdLabel"></span>
    <span id="movimentarSetorAtualLabel"></span>
    <select id="movimentarSetorSelect"></select>
    <select id="movimentarGuindasteSelect"></select>
    <div id="movimentarInstrucaoBox" class="hidden"></div>
  </div>
</body>
</html>
`;

const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.nexusEsc = (str) => str || '';
window.nexusJsArg = (str) => JSON.stringify(str);
window.NexusSecurity = { escapeHtml: (str) => str || '', jsString: (str) => JSON.stringify(str) };
window.NexusCodigos = { chave: (str) => (str || '').toLowerCase(), vincularFormatacao: () => {} };
window.NexusAuth = {
  getSession: () => ({ cargo: 'DIRETOR_OPERACOES_LOGISTICA', codigo_individual: 'NX-1001-TEST' })
};
window.currentUserSession = window.NexusAuth.getSession();

window.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([
  { id: 'CRG-SEM-CONT', tipo: 'Geral', status: 'ARMAZENAGEM', container: '' },
  { id: 'CRG-COM-CONT', tipo: 'Grãos', status: 'ARMAZENAGEM', container: 'CONT1234567' }
]));

const scriptEl = window.document.createElement('script');
scriptEl.textContent = cargasCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  const select = window.document.getElementById('movimentarSetorSelect');

  console.log('--- Testando Carga Sem Contêiner ---');
  window.abrirModalMovimentacao('CRG-SEM-CONT');
  const optionsSemCont = Array.from(select.options).map(o => o.value);
  console.log('Opções no select (sem contêiner):', optionsSemCont);

  assert.ok(!optionsSemCont.some(o => o.startsWith('Contêiner')), 'NÃO deve exibir opção de movimentar para contêiner se a carga não tiver vínculo');

  console.log('--- Testando Carga Com Contêiner ---');
  window.abrirModalMovimentacao('CRG-COM-CONT');
  const optionsComCont = Array.from(select.options).map(o => o.value);
  console.log('Opções no select (com contêiner):', optionsComCont);

  assert.ok(optionsComCont.some(o => o === 'Contêiner CONT1234567'), 'DEVE exibir a opção de movimentar para o Contêiner CONT1234567');

  console.log('✅ Teste da Tarefa 11 executado com sucesso!');
}, 200);
