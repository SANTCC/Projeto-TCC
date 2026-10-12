/**
 * Teste da Tarefa 4 — Período de Referência no Módulo Relatórios & PDF
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const relatoriosCode = fs.readFileSync('js/pages/relatorios.js', 'utf8');

const html = `
<!DOCTYPE html>
<html>
<head></head>
<body>
  <select id="relatorioPeriodoSelect">
    <option value="HOJE">Hoje</option>
    <option value="7D">Últimos 7 dias</option>
    <option value="30D" selected>Últimos 30 dias</option>
    <option value="MENSAL">Este mês</option>
  </select>
  <div id="relatorioPeriodoChips">
    <button data-periodo="HOJE" class="periodo-chip">Hoje</button>
    <button data-periodo="7D" class="periodo-chip">7 dias</button>
    <button data-periodo="30D" class="periodo-chip">30 dias</button>
  </div>
  <select id="relatorioCargaSelect"></select>
  <tbody id="produtividadeTableBody"></tbody>
</body>
</html>
`;

const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

window.nexusEsc = (str) => str || '';
window.NexusSecurity = { escapeHtml: (str) => str || '' };
window.NexusAuth = {
  getSession: () => ({ cargo: 'DIRETOR_OPERACOES_LOGISTICA', codigo_individual: 'NX-1001-TEST' })
};
window.currentUserSession = window.NexusAuth.getSession();

const hojeIso = new Date().toISOString();
const dezDiasAtrasIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

window.nexusSupabase = {
  from: (table) => {
    if (table === 'cargas') {
      return {
        select: async () => ({
          data: [
            { id: 1, qr_code_url: 'QR-CRG-HOJE-1', natureza: 'Conteinerizada', status_fluxo: 'ARMAZENADA', created_at: hojeIso },
            { id: 2, qr_code_url: 'QR-CRG-HOJE-2', natureza: 'Granel', status_fluxo: 'EM_TRANSITO', created_at: hojeIso },
            { id: 3, qr_code_url: 'QR-CRG-ANTIGA', natureza: 'Carga Viva', status_fluxo: 'ENTREGUE', created_at: dezDiasAtrasIso }
          ],
          error: null
        })
      };
    }
    if (table === 'funcionarios' || table === 'logs_alteracoes') {
      return {
        select: () => ({
          eq: () => ({ order: () => Promise.resolve([]) }),
          order: () => Promise.resolve([])
        })
      };
    }
    return {};
  }
};

// Carrega relatorios.js no JSDOM
const scriptEl = window.document.createElement('script');
scriptEl.textContent = relatoriosCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  const selectCarga = window.document.getElementById('relatorioCargaSelect');
  const periodoSelect = window.document.getElementById('relatorioPeriodoSelect');

  console.log('--- Testando Seleção "Hoje" ---');
  periodoSelect.value = 'HOJE';
  periodoSelect.dispatchEvent(new window.Event('change'));

  // Espera atualização assíncrona
  setTimeout(() => {
    const optionsHoje = Array.from(selectCarga.options).map(o => o.value).filter(v => v !== '');
    console.log('Opções no select com filtro HOJE:', optionsHoje);

    assert.strictEqual(optionsHoje.length, 2, 'Deveria exibir exatamente 2 cargas criadas hoje');
    assert.ok(optionsHoje.includes('CRG-HOJE-1'), 'Deveria conter CRG-HOJE-1');
    assert.ok(optionsHoje.includes('CRG-HOJE-2'), 'Deveria conter CRG-HOJE-2');
    assert.ok(!optionsHoje.includes('CRG-ANTIGA'), 'NÃO deveria conter CRG-ANTIGA para a seleção de HOJE');

    console.log('--- Testando Seleção "30D" ---');
    periodoSelect.value = '30D';
    periodoSelect.dispatchEvent(new window.Event('change'));

    setTimeout(() => {
      const options30D = Array.from(selectCarga.options).map(o => o.value).filter(v => v !== '');
      console.log('Opções no select com filtro 30D:', options30D);
      assert.strictEqual(options30D.length, 3, 'Deveria exibir todas as 3 cargas em 30 dias');

      console.log('✅ Teste da Tarefa 4 executado com sucesso!');
    }, 100);
  }, 100);
}, 100);
