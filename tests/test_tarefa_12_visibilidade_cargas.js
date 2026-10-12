/**
 * Teste da Tarefa 12 — Visibilidade de Cargas entre Diferentes Cargos
 */

const assert = require('assert');
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const visionCode = fs.readFileSync('js/vision-layer.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously", url: "http://localhost/" });
const { window } = dom;

const scriptEl = window.document.createElement('script');
scriptEl.textContent = visionCode;
window.document.body.appendChild(scriptEl);

setTimeout(() => {
  const cargasOriginal = [
    { id: 'CRG-DIRETOR-1', tipo: 'Geral', estivador_id: null, conferente_id: null, criado_por: 'DIRETOR' },
    { id: 'CRG-SUPERVISOR-1', tipo: 'Grãos', estivador_id: 'MAT-999', conferente_id: 'MAT-888', criado_por: 'SUPERVISOR' }
  ];

  console.log('--- Testando Visibilidade para ESTIVADOR ---');
  const sessaoEstivador = { cargo: 'ESTIVADOR', matricula: 'MAT-1001', nome: 'Estivador Silva' };
  const cargasEstivador = window.NexusVision.filterCargasForUser(cargasOriginal, sessaoEstivador);
  console.log('Qtd cargas para Estivador:', cargasEstivador.length);
  assert.strictEqual(cargasEstivador.length, 2, 'O Estivador deve visualizar todas as cargas, inclusive as cadastradas por Diretores');

  console.log('--- Testando Visibilidade para CONFERENTE_CARGA ---');
  const sessaoConferente = { cargo: 'CONFERENTE_CARGA', matricula: 'MAT-1002', nome: 'Conferente Santos' };
  const cargasConferente = window.NexusVision.filterCargasForUser(cargasOriginal, sessaoConferente);
  console.log('Qtd cargas para Conferente:', cargasConferente.length);
  assert.strictEqual(cargasConferente.length, 2, 'O Conferente deve visualizar todas as cargas, inclusive as cadastradas por Diretores');

  console.log('✅ Teste da Tarefa 12 executado com sucesso!');
}, 100);
