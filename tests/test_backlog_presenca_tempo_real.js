/** Tarefa 19: Presence real entre páginas (rede simulada), ciclo de vida e concorrência. */
const assert=require('node:assert/strict');
const fs=require('fs');
const H=require('./webmcp-harness');
const abertas=[];
function rede(){
  const canais=[];
  const estado=()=>{
    const s={};for(const c of canais)if(c.inscrito&&c.rastreado)(s[c.chave]||=[]).push({online_at:'2026-10-15T12:00:00Z'});
    return s;
  };
  const sync=()=>{for(const c of canais)if(c.inscrito)c.handlers.sync?.();};
  const cliente={canais,channel(nome,o){
    const c={nome,chave:o.config.presence.key,handlers:{},inscrito:false,rastreado:false,payloads:[],untracks:0,
      on(tipo,filtro,fn){this.handlers[filtro.event]=fn;return this;},subscribe(fn){this.cb=fn;return this;},
      presenceState:estado,track(p){this.payloads.push(p);this.rastreado=true;sync();return Promise.resolve('ok');},
      untrack(){this.untracks++;this.rastreado=false;sync();return Promise.resolve('ok');},
      entrar(){this.inscrito=true;this.cb('SUBSCRIBED');},
      erro(status='CHANNEL_ERROR'){this.inscrito=false;this.rastreado=false;this.cb(status);sync();}
    };canais.push(c);return c;
  },removeChannel(c){c.inscrito=false;c.rastreado=false;sync();return Promise.resolve('ok');}};
  return cliente;
}
async function abrir(cliente,codigo='NX-1',pagina){
  const timers=[];const cancelados=[];
  const scripts=pagina?['js/security.js','js/session-cookies.js','js/auth-guard.js','js/vision-layer.js','js/layout.js']:[];
  const j=H.criarJanela({url:`https://nexusport.test/${pagina||'dashboard.html'}`,
    html:pagina?H.htmlDaPagina(pagina):'<div id="headerOnline"><span id="headerOnlineCount">—</span></div>',
    session:H.sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE',{codigo_individual:codigo}),
    scripts:[...scripts,w=>{w.nexusSupabase=cliente;},'js/online-presence.js']});
  abertas.push(j.w);
  if(pagina){await H.prontoDom(j.w);await H.aguardar(30);}
  else j.w.NexusOnlinePresence.iniciar({codigo,cliente,agendar:(fn,ms)=>{timers.push({fn,ms});return timers.length;},cancelar:id=>cancelados.push(id)});
  return {...j,timers,cancelados};
}
const texto=w=>w.document.getElementById('headerOnlineCount').textContent;
function paginaEvento(w,nome,persisted){const e=new w.Event(nome);Object.defineProperty(e,'persisted',{value:persisted});w.dispatchEvent(e);}
(async()=>{
  const cliente=rede();
  const a=await abrir(cliente,'NX-A');const ca=cliente.canais.at(-1);ca.entrar();assert.equal(texto(a.w),'1');
  const b=await abrir(cliente,'NX-B');const cb=cliente.canais.at(-1);cb.entrar();
  assert.equal(texto(a.w),'2','Entrada remota atualiza imediatamente');assert.equal(texto(b.w),'2');
  const aba=await abrir(cliente,'NX-A');const cc=cliente.canais.at(-1);cc.entrar();
  assert.equal(texto(a.w),'2','Mesmo código em outra aba não duplica usuário');
  paginaEvento(a.w,'pagehide',false);
  assert.equal(texto(a.w),'—');assert.equal(texto(b.w),'2','Outra aba do mesmo usuário permanece online');
  paginaEvento(aba.w,'pagehide',false);assert.equal(texto(b.w),'1','Última aba saiu: atualização imediata');
  // Navegação: novo documento entra no mesmo canal/chave, sem carregar número do cache.
  const proxima=await abrir(cliente,'NX-A','cargas.html');const cp=cliente.canais.at(-1);
  assert.equal(texto(proxima.w),'—');cp.entrar();assert.equal(texto(proxima.w),'2');assert.equal(texto(b.w),'2');
  // BFCache: a volta não executa DOMContentLoaded/layout novamente.
  paginaEvento(proxima.w,'pagehide',true);assert.equal(texto(b.w),'1');
  const suspensos=cliente.canais.length;proxima.w.dispatchEvent(new proxima.w.Event('online'));proxima.w.dispatchEvent(new proxima.w.Event('focus'));
  assert.equal(cliente.canais.length,suspensos,'Página suspensa não se reanuncia');
  paginaEvento(proxima.w,'pageshow',true);const restaurado=cliente.canais.at(-1);
  assert.notEqual(restaurado,cp);assert.equal(texto(proxima.w),'—');restaurado.entrar();assert.equal(texto(proxima.w),'2');
  // Callbacks da página/canal anterior não podem invalidar o atual.
  cp.cb('CHANNEL_ERROR');cp.cb('SUBSCRIBED');cp.handlers.sync();assert.equal(texto(proxima.w),'2');
  assert.equal(cp.payloads.length,1,'Canal encerrado não registra presença novamente');
  // Rede offline encerra o canal e descarta contagem; online espera nova sincronização.
  b.w.dispatchEvent(new b.w.Event('offline'));assert.equal(texto(b.w),'—');assert.equal(texto(proxima.w),'1');
  b.w.dispatchEvent(new b.w.Event('online'));const novo=cliente.canais.at(-1);assert.equal(texto(b.w),'—');
  novo.entrar();assert.equal(texto(b.w),'2');
  novo.erro('TIMED_OUT');assert.equal(texto(b.w),'—');novo.entrar();assert.equal(texto(b.w),'2');
  novo.erro('CLOSED');b.w.dispatchEvent(new b.w.Event('focus'));const foco=cliente.canais.at(-1);
  assert.notEqual(foco,novo);foco.entrar();assert.equal(texto(b.w),'2');
  const antes=cliente.canais.length;
  b.w.NexusOnlinePresence.iniciar({codigo:'NX-B',cliente});assert.equal(cliente.canais.length,antes,'Iniciar repetido é idempotente');
  foco.erro();b.timers.at(-1).fn();const periodico=cliente.canais.at(-1);assert.notEqual(periodico,foco);periodico.entrar();
  assert.equal(texto(b.w),'2','Intervalo recupera canal que falhou sem evento de foco');
  periodico.erro();Object.defineProperty(b.w.document,'visibilityState',{value:'visible',configurable:true});
  b.w.document.dispatchEvent(new b.w.Event('visibilitychange'));const visivel=cliente.canais.at(-1);visivel.entrar();
  assert.equal(texto(b.w),'2','Retorno à aba recupera inscrição falha');
  b.w.NexusOnlinePresence.parar();assert.equal(texto(b.w),'—');
  b.w.dispatchEvent(new b.w.Event('online'));b.w.dispatchEvent(new b.w.Event('focus'));paginaEvento(b.w,'pageshow',true);
  assert.equal(cliente.canais.at(-1),visivel,'Parada explícita não é desfeita por listeners');
  assert.equal(texto(proxima.w),'1');
  // Sessão encerrada enquanto documento estava no BFCache: não reanunciar usuário antigo.
  paginaEvento(proxima.w,'pagehide',true);proxima.w.NexusAuth.getSession=()=>null;
  const qtd=cliente.canais.length;paginaEvento(proxima.w,'pageshow',true);
  assert.equal(cliente.canais.length,qtd);assert.equal(texto(proxima.w),'—');
  assert.ok(a.cancelados.length&&b.cancelados.length,'Suspensão/parada cancela temporizadores');
  for(const c of cliente.canais)for(const p of c.payloads)assert.deepEqual(Object.keys(p),['online_at']);
  // Falhas assíncronas de track/limpeza são tratadas, inclusive resultados de inscrições antigas.
  const j=await abrir(rede());const client=j.w.nexusSupabase;const antigo=client.canais[0];
  let rejeitar;antigo.track=()=>new Promise((_,reject)=>{rejeitar=reject;});antigo.entrar();
  antigo.erro();j.w.dispatchEvent(new j.w.Event('focus'));const atual=client.canais.at(-1);atual.entrar();
  rejeitar(new Error('track antigo'));await H.aguardar(0);assert.equal(texto(j.w),'1','Rejeição antiga não apaga sincronização atual');
  atual.erro();atual.track=()=>Promise.reject(new Error('sem rede'));atual.entrar();await H.aguardar(0);
  assert.equal(texto(j.w),'—');atual.handlers.sync();assert.equal(texto(j.w),'—','Track rejeitado não produz contagem confirmada');
  atual.erro();atual.track=()=>Promise.resolve('timed out');atual.entrar();await H.aguardar(0);
  assert.equal(texto(j.w),'—','Timeout de track também invalida a contagem');
  atual.untrack=()=>Promise.reject(new Error('já encerrado'));client.removeChannel=()=>Promise.reject(new Error('já removido'));
  j.w.NexusOnlinePresence.parar();await H.aguardar(0);
  // Todas as dez páginas que usam o layout participam da mesma contagem.
  const paginas=fs.readdirSync(H.ROOT).filter(p=>p.endsWith('.html')&&/<script[^>]+src="js\/layout\.js"/.test(H.read(p)));
  assert.equal(paginas.length,10);
  const r=rede();let total=0;const docs=[];
  for(const pagina of paginas){
    const doc=await abrir(r,`NX-PAG-${total}`,pagina);docs.push(doc);
    const c=r.canais.at(-1);assert.equal(c.chave,`NX-PAG-${total}`);c.entrar();total++;
    for(const d of docs)assert.equal(texto(d.w),String(total),`${pagina}: contagem comum, imediata`);
    assert.deepEqual(doc.erros,[]);
  }
  const saindo=docs.at(-1);saindo.w.NexusAuth.logout();
  assert.equal(saindo.w.NexusAuth.getSession(),null);assert.equal(texto(saindo.w),'—');
  for(const d of docs.slice(0,-1))assert.equal(texto(d.w),'9','Logout real remove presença das outras páginas');
  const semRetorno=r.canais.length;saindo.w.dispatchEvent(new saindo.w.Event('focus'));saindo.w.dispatchEvent(new saindo.w.Event('online'));
  assert.equal(r.canais.length,semRetorno);
  assert.ok(saindo.erros.every(e=>e.includes('Not implemented: navigation')),'Somente limitação de navegação do jsdom é permitida no logout');
  assert.match(H.read('js/auth-guard.js'),/logout: function\s*\(\)\s*\{\s*if \(window\.NexusOnlinePresence\) window\.NexusOnlinePresence\.parar\(\)/,'Logout encerra presença antes de limpar sessão');
  console.log('✅ Tarefa 19: sync imediato, dez páginas, deduplicação, navegação, BFCache, rede/reconexão, recuperação periódica, callbacks obsoletos, falhas assíncronas e logout.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>abertas.forEach(w=>{w.NexusOnlinePresence?.parar();w.close();}));
