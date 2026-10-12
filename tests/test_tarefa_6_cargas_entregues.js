/**
 * Teste da Tarefa 6 — Tabela de Cargas Entregues no Módulo Cargas & Pátio
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
  <div id="cargasCounter"></div>
  <table id="cargasTable"><tbody id="cargasTableBody"></tbody></table>
  <table id="cargasEntreguesTable"><tbody id="cargasEntreguesTableBody"></tbody></table>
  <table id="cargasCanceladasTable"><tbody id="cargasCanceladasTableBody"></tbody></table>
  <table id="cargasRecusadasTable"><tbody id="cargasRecusadasTableBody"></tbody></table>
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
  { id: 'CRG-ATIVA-1', tipo: 'Geral', status: 'ARMAZENADA' },
  { id: 'CRG-ENTREGUE-1', tipo: 'Grãos', status: 'ENTREGUE', destino: 'Porto de Roterdã' }
]));

window.nexusSupabase = {
  from: () => ({
    select: () => ({
      order: () => Promise.resolve({
        data: [
          { id: 101, qr_code_url: 'QR-CRG-ATIVA-1', natureza: 'Geral', status_fluxo: 'ARMAZENADA' },
          { id: 102, qr_code_url: 'QR-CRG-ENTREGUE-1', natureza: 'Grãos', status_fluxo: 'ENTREGUE', destino: 'Porto de Roterdã' }
        ],
        error: null
      })
    })
  })
};

const scriptEl = window.document.createElement('script');
scriptEl.textContent = cargasCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  const activeRows = window.document.querySelectorAll('#cargasTableBody tr');
  const deliveredRows = window.document.querySelectorAll('#cargasEntreguesTableBody tr');

  console.log('Qtd de linhas ativas:', activeRows.length);
  console.log('Qtd de linhas entregues:', deliveredRows.length);
  console.log('Conteúdo da linha ativa:', activeRows[0].innerHTML);
  console.log('Conteúdo da linha entregue:', deliveredRows[0].innerHTML);

  assert.strictEqual(activeRows.length, 1, 'A tabela de cargas ativas deve conter apenas a carga ativa');
  assert.ok(activeRows[0].innerHTML.includes('CRG-ATIVA-1') || activeRows[0].innerHTML.includes('101'), 'Carga ativa deve estar na tabela');
  assert.ok(!activeRows[0].innerHTML.includes('CRG-ENTREGUE-1') && !activeRows[0].innerHTML.includes('102'), 'Carga entregue NÃO pode estar na tabela ativa');

  assert.strictEqual(deliveredRows.length, 1, 'A tabela de cargas entregues deve conter exatamente 1 carga');
  assert.ok(deliveredRows[0].innerHTML.includes('CRG-ENTREGUE-1'), 'CRG-ENTREGUE-1 deve estar na tabela de cargas entregues');
  assert.ok(deliveredRows[0].innerHTML.includes('ENTREGUE'), 'Deve exibir o badge ENTREGUE');

  console.log('✅ Teste da Tarefa 6 executado com sucesso!');
}, 200);
