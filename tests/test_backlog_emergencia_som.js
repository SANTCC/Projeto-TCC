/** Tarefa 13: som obrigatório de emergência e pulsos reforçados, respeitando o aparelho. */
const assert=require('node:assert/strict');
const H=require('./webmcp-harness');
async function abrir(o={}) {
  let ativado=o.ativado!==false,oculto=false;
  const osciladores=[],contextos=[],vibracoes=[];
  const j=H.criarJanela({url:'https://nexusport.test/manutencao.html',html:H.htmlDaPagina('manutencao.html'),
    session:H.sessao('INSPETOR'),storage:{nexus_haptics_prefs:{enabled:true,sound:false}},
    scripts:['js/security.js','js/session-cookies.js','js/auth-guard.js',w=>{
      w.currentUserSession=w.NexusAuth.getSession();
      Object.defineProperty(w.navigator,'userAgent',{configurable:true,value:'Android Mobile Chrome'});
      Object.defineProperty(w.navigator,'userActivation',{configurable:true,get:()=>({hasBeenActive:ativado})});
      Object.defineProperty(w.document,'hidden',{configurable:true,get:()=>oculto});
      w.navigator.vibrate=p=>{vibracoes.push(p);return true;};
      w.isSecureContext=true;
      if(!o.semAudio) w.AudioContext=class {
        constructor(){this.state=o.estado||'running';this.currentTime=0;this.destination={};contextos.push(this);}
        resume(){if(o.rejeitar)return Promise.reject(new Error('bloqueado'));if(o.liberar)this.state='running';return Promise.resolve();}
        createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
        createOscillator(){
          if(o.falharSintese)throw new Error('síntese indisponível');
          const n={frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){},start(){this.iniciado=true;},stop(at){if(at===undefined)this.cancelado=true;}};
          osciladores.push(n);return n;
        }
      };
    },'js/haptics.js']});
  await H.prontoDom(j.w);
  assert.deepEqual(j.erros,[]);
  return {...j,osciladores,contextos,vibracoes,ativar:v=>{ativado=v;},ocultar:v=>{oculto=v;}};
}
(async()=>{
  {
    const t=await abrir();const h=t.w.NexusHaptics;
    try {
      assert.equal(h.isSoundEnabled(),true,'Preferência antiga false não silencia emergências em Android');
      assert.equal(h.status().soundRequired,true);
      assert.equal(h.setSoundEnabled(false),true,'API antiga não pode desativar a sirene');
      assert.equal(JSON.parse(t.w.localStorage.getItem('nexus_haptics_prefs')).sound,true);
      assert.equal(h.alert().sounded,true);assert.equal(t.osciladores.length,4);
      assert.equal(h.sos().sounded,true);assert.equal(t.osciladores.length,12);
      h.setEnabled(false);
      assert.equal(t.osciladores.some(n=>n.cancelado),false,'Desativar vibração não cancela som obrigatório');
      const r=h.alert();assert.equal(r.fired,false);assert.equal(r.sounded,true);
      for(const tipo of ['alert','sos']) {
        const p=Array.from(h.PATTERNS[tipo]);
        assert.ok(p.length<=10);assert.ok(p.every(ms=>ms>=0&&ms<=10000));
        assert.ok(p.filter((_,i)=>i%2===0).every(ms=>ms>=600));
      }
      assert.ok(h.PATTERNS.alert.reduce((a,b)=>a+b,0)<3000,'Pulso periódico termina antes do próximo ciclo');
      h.bindUI();const toggle=t.w.document.getElementById('hapticsSoundToggle');
      assert.equal(toggle.checked,true);assert.equal(toggle.disabled,true);
      toggle.checked=false;toggle.dispatchEvent(new t.w.Event('change'));
      assert.equal(toggle.checked,true);assert.equal(h.isSoundEnabled(),true);
      t.w.document.getElementById('hapticsTestBtn').click();
      assert.match(t.w.document.getElementById('hapticsFeedback').textContent,/Sinal sonoro programado/);
      h.stop();assert.ok(t.osciladores.every(n=>n.cancelado),'Parada encerra os sons programados');
    } finally {t.w.close();}
  }
  for(const o of [{ativado:false},{semAudio:true},{estado:'suspended'},{estado:'suspended',rejeitar:true},{falharSintese:true}]) {
    const t=await abrir(o);
    try {
      const h=t.w.NexusHaptics;const r=h.alert();
      assert.equal(r.sounded,false,'Nunca anunciar áudio reproduzido se bloqueado/ausente');
      assert.equal(t.osciladores.length,0);
      await H.aguardar(0);
      assert.ok(h.status().soundReason);
      assert.match(h.describe(),/som obrigatório/);
      assert.equal(h.isSoundEnabled(),true,'Obrigatoriedade não equivale a suporte do navegador');
      if(o.ativado===false) {
        assert.equal(t.contextos.length,0,'Sem interação não cria contexto nem agenda sirene');
        t.ativar(true);assert.equal(h.alert().sounded,true,'Nova tentativa após interação libera som');
      }
      if(o.rejeitar)assert.equal(h.status().soundReason,'blocked');
    } finally {t.w.close();}
  }
  {
    const t=await abrir({estado:'suspended',liberar:true});
    try {
      assert.equal(t.w.NexusHaptics.alert().sounded,true);
      t.ocultar(true);const r=t.w.NexusHaptics.alert();
      assert.equal(r.sounded,false);assert.equal(r.status.soundReason,'hidden');
      t.w.document.dispatchEvent(new t.w.Event('visibilitychange'));
      assert.ok(t.osciladores.every(n=>n.cancelado));
    } finally {t.w.close();}
  }
  // Integração real: SOS local, primeiro ciclo não o trunca, repetição e desativação.
  {
    const t=await abrir();const timers=new Map();let agora=100000,id=0;
    try {
      t.w.Date.now=()=>agora;
      t.w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};
      t.w.clearTimeout=n=>timers.delete(n);
      t.w.eval(H.read('js/panic-realtime.js'));
      await H.aguardar(10);
      assert.equal((await t.w.NexusPanic.triggerPanic({confirmar:false})).ok,true);
      assert.equal(t.w.NexusPanic.isActive(),true);
      const padroes=t.vibracoes.filter(p=>p!==0);
      assert.equal(padroes.length,1,'Não substituir SOS por pulso comum imediatamente');
      assert.deepEqual(Array.from(padroes[0]),Array.from(t.w.NexusHaptics.PATTERNS.sos));
      const total=Array.from(t.w.NexusHaptics.PATTERNS.sos).reduce((a,b)=>a+b,0);
      assert.equal(timers.size,1);const [timerId,primeiro]=[...timers][0];
      assert.ok(primeiro.ms>=total,'Primeiro ciclo espera SOS inteiro');
      agora+=primeiro.ms;timers.delete(timerId);primeiro.fn();
      assert.equal([...timers.values()][0].ms,3000,'Demais ciclos mantêm intervalo de 3s');
      assert.ok(t.osciladores.length>=12,'SOS e repetição também programam sirene');
      assert.equal((await t.w.NexusPanic.clearPanic({confirmar:false})).ok,true);
      assert.equal(timers.size,0);assert.ok(t.osciladores.every(n=>n.cancelado));
      assert.equal(t.w.NexusPanic.isActive(),false);
      assert.deepEqual(t.erros,[]);
    } finally {t.w.close();}
  }
  console.log('✅ Tarefa 13: som obrigatório apesar de preferência antiga, API/UI sem mute, pulsos de 600/900ms, bloqueios honestos, SOS completo, repetição e parada.');
})().catch(e=>{console.error(e);process.exit(1);});
