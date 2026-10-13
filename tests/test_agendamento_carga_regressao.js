#!/usr/bin/env node
/**
 * Regressão: o commit deed6131 inseriu validações de movimentação de uma carga
 * existente dentro do submit de agendamento. Nesse fluxo ainda não existem
 * `carga` nem `idCarga`, portanto o clique terminava em ReferenceError antes do
 * insert no Supabase.
 */
const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, '..', 'js', 'pages', 'cargas.js');
const fonte = fs.readFileSync(arquivo, 'utf8');
let falhas = 0;

function check(descricao, condicao) {
  if (condicao) {
    console.log(`✅ ${descricao}`);
  } else {
    falhas += 1;
    console.error(`❌ ${descricao}`);
  }
}

const inicio = fonte.indexOf("agendamentoForm.addEventListener('submit'");
const fim = fonte.indexOf('\n  // Modal QR Code', inicio);
const submit = inicio >= 0 && fim > inicio ? fonte.slice(inicio, fim) : '';
const antesDaNovaCarga = submit.split('const novaCarga =')[0] || '';

check('o manipulador de agendamento existe', Boolean(submit));
check('o agendamento não acessa carga.container fora de escopo', !antesDaNovaCarga.includes('carga.container'));
check('o agendamento não acessa carga.navio fora de escopo', !antesDaNovaCarga.includes('carga.navio'));
check('o agendamento não usa idCarga de uma operação de movimentação', !antesDaNovaCarga.includes('idCarga'));
check('o fluxo ainda prepara a nova carga', submit.includes('const novaCarga ='));
check('o fluxo ainda tenta persistir em public.cargas', submit.includes(".from('cargas')") && submit.includes('.insert(insertPayload)'));

const posInsert = submit.indexOf(".from('cargas')");
const posPush = submit.indexOf('cargasFluxoList.push(novaCarga)');
const posCache = submit.indexOf("localStorage.setItem('nexus_cargas_fluxo'");
const posQr = submit.indexOf('window.exibirEtiquetaQr(novaCarga)');
check('o insert remoto ocorre antes de adicionar a carga à lista local', posInsert >= 0 && posPush > posInsert);
check('o insert remoto ocorre antes de gravar a carga no cache', posInsert >= 0 && posCache > posInsert);
check('o QR só é exibido depois da confirmação remota', posInsert >= 0 && posQr > posInsert);
check('a ausência do cliente remoto bloqueia o agendamento', submit.includes('if (!window.nexusSupabase)'));
check('erro retornado pelo insert é tratado explicitamente', submit.includes('if (cargaErr || !resCarga || !resCarga.id)'));
check('o botão é protegido contra envio duplicado', submit.includes('submitBtn.disabled = true') && submit.includes('submitBtn.disabled = false'));
check('o agendamento obrigatório recebe a data prevista', submit.includes('data_prevista_entrega: dataPrevista'));
check('falha ao criar agendamento tenta reverter a carga principal', submit.includes(".from('cargas')") && submit.includes('.delete()') && submit.includes(".eq('id', resCarga.id)"));

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n14 verificações passaram.');
