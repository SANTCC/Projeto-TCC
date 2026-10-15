/** Tarefa 6: vincular um berço não pode registrar chegada nem tirar navio de trânsito. */
const assert = require('node:assert/strict');
const H = require('./webmcp-harness');
const {criarBancoFalso} = require('./fake-supabase-db');
const IMO = 'IMO-1234567';
const UUID = '11111111-2222-4333-8444-555555555555';
async function abrir(localizacao, remoto = true) {
  const banco = criarBancoFalso({
    navios:[{id:UUID, numero_imo:IMO, nome:'Navio Teste', localizacao, porto_origem:'Porto de Santos', porto_destino:'Roterdã'}],
    bercos:[{id:'BERCO-01', nome:'Berço 01', estado:'LIVRE', navio_nome:null, navio_imo:null, navio_id:null}]
  });
  const cache = [{id:UUID, imo:IMO, nome:'Navio Teste', localizacao}];
  const avisos=[];
  const j = H.criarJanela({url:'https://nexusport.test/embarcacoes.html', html:H.htmlDaPagina('embarcacoes.html'), session:H.sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage:{nexus_navios_list:cache, nexus_bercos_list:banco.tabelas.bercos},
    scripts:['js/security.js','js/session-cookies.js','js/supabase-client.js','js/auth-guard.js','js/padronizacao-codigos.js',w => {
      w.currentUserSession=w.NexusAuth.getSession();
      w.nexusSupabase=remoto ? banco : null;
      w.mostrarFeedback=(tipo,titulo,msg) => avisos.push({tipo,titulo,msg});
    },'js/pages/embarcacoes.js']});
  await H.prontoDom(j.w); await H.aguardar(80);
  assert.deepEqual(j.erros,[]);
  banco.log.length=0;
  return {w:j.w,j,banco,avisos};
}
const modalAberto = w => !w.document.getElementById('vincularBercoModal').classList.contains('hidden');
const botaoVincular = w => Array.from(w.document.querySelectorAll('#embarcacoesGpsTableBody button')).find(b => b.textContent.includes('Vincular'));
async function confirmar(w) {
  w.document.getElementById('vincularBercoSelect').value='Berço 01';
  w.document.getElementById('confirmarVincularBercoBtn').click();
  await H.aguardar(50);
}
(async () => {
  for (const remoto of [true,false]) {
    for (const localizacao of ['FORA_DO_PORTO','NO_PORTO_DE_DESTINO']) {
      const {w,banco,avisos}=await abrir(localizacao,remoto);
      try {
        assert.equal(botaoVincular(w).disabled,true);
        assert.equal(botaoVincular(w).getAttribute('aria-disabled'),'true');
        await w.vincularNavioABerco(IMO);
        assert.equal(modalAberto(w),false);
        await w.vincularNavioABerco(IMO,{bercoNome:'Berço 01',confirmado:true});
        assert.equal(banco.tabelas.bercos[0].estado,'LIVRE');
        assert.equal(banco.tabelas.navios[0].localizacao,localizacao);
        assert.equal(JSON.parse(w.localStorage.getItem('nexus_navios_list'))[0].localizacao,localizacao);
        assert.equal(banco.log.length,0,'Bloqueio não grava no banco');
        assert.ok(avisos.some(a => a.titulo === 'Vinculação Bloqueada'));
      } finally {w.close();}
    }
  }
  // A lista do navegador está no porto, mas o banco já registra a saída.
  {
    const {w,banco}=await abrir('DENTRO_DO_PORTO');
    try {
      banco.tabelas.navios[0].localizacao='FORA_DO_PORTO';
      await w.vincularNavioABerco(IMO,{bercoNome:'Berço 01'});
      assert.equal(banco.log.length,0);
      assert.equal(banco.tabelas.bercos[0].estado,'LIVRE');
      assert.equal(banco.tabelas.navios[0].localizacao,'FORA_DO_PORTO');
    } finally {w.close();}
  }
  // O navio sai depois de abrir a seleção: revalidar antes da reserva.
  {
    const {w,banco}=await abrir('DENTRO_DO_PORTO');
    try {
      await w.vincularNavioABerco(IMO);
      assert.equal(modalAberto(w),true);
      banco.tabelas.navios[0].localizacao='FORA_DO_PORTO';
      await confirmar(w);
      assert.equal(banco.tabelas.bercos[0].estado,'LIVRE');
      assert.equal(banco.log.length,0);
      assert.equal(banco.tabelas.navios[0].localizacao,'FORA_DO_PORTO');
    } finally {w.close();}
  }
  // Falha de consulta ou registro removido: não usar localização em cache como confirmação.
  for (const cenario of ['falha','removido']) {
    const {w,banco}=await abrir('DENTRO_DO_PORTO');
    try {
      if (cenario === 'falha') banco.config.falhar=['navios'];
      else banco.tabelas.navios.splice(0);
      await w.vincularNavioABerco(IMO,{bercoNome:'Berço 01'});
      assert.equal(banco.tabelas.bercos[0].estado,'LIVRE');
      assert.ok(!banco.log.some(l => l.op === 'update' || l.op === 'upsert'));
    } finally {w.close();}
  }
  // Controle: permanece possível vincular navio que já está em Santos, online e offline.
  for (const remoto of [true,false]) {
    const {w,banco}=await abrir('DENTRO_DO_PORTO',remoto);
    try {
      assert.equal(botaoVincular(w).disabled,false);
      await w.vincularNavioABerco(IMO,{bercoNome:'Berço 01'});
      assert.equal(JSON.parse(w.localStorage.getItem('nexus_bercos_list'))[0].estado,'OCUPADO');
      if (remoto) assert.equal(banco.tabelas.bercos[0].estado,'OCUPADO');
      assert.ok(!banco.log.some(l => l.tabela === 'navios' && l.op === 'update'),'Vinculação não escreve localização');
    } finally {w.close();}
  }
  // Pré-condição WebMCP também rejeita navio fora do porto.
  {
    const {w}=await abrir('FORA_DO_PORTO');
    try {
      let ferramentas;
      w.NexusWebMCP={registrarPagina:p => {ferramentas=p.ferramentas;}};
      w.NexusWebMCPDados={GRUPOS:{gestaoOperacional:[],supervisao:[],inspecao:[],direcao:[]},
        normalizarImo:v => v, navios:async () => JSON.parse(w.localStorage.getItem('nexus_navios_list')),
        quandoPronto:f => f()};
      w.eval(H.read('js/webmcp/webmcp-embarcacoes.js'));
      const f=ferramentas.find(t => t.nome === 'vincular_navio_berco');
      assert.equal((await f.precondicao({imo:IMO,berco:'Berço 01'})).codigo,'ESTADO_INVALIDO');
    } finally {w.close();}
  }
  console.log('✅ Tarefa 6: botão, ação direta, modal desatualizado, falha de leitura, WebMCP e vínculo válido sem alterar localização.');
})().catch(e => {console.error(e);process.exit(1);});
