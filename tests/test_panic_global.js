/**
 * Teste de Verificação — Botão de Pânico GLOBAL
 * (Edge Function panic-alert + Broadcast WebSocket; webhook opcional existe
 * apenas no servidor — o front-end não possui UI nem chamadas de webhook)
 *
 * Executar: node tests/test_panic_global.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function testPanicGlobal() {
  console.log('================================================================');
  console.log('TESTE — BOTÃO DE PÂNICO GLOBAL (EDGE FUNCTION + WEBSOCKET; WEBHOOK SÓ NO SERVIDOR)');
  console.log('================================================================\n');

  let passed = true;
  function check(label, cond) {
    if (cond) {
      console.log(`  ✅ [PASS] ${label}`);
    } else {
      console.error(`  ❌ [FAIL] ${label}`);
      passed = false;
    }
  }

  // 1. Edge Function (evento de servidor)
  console.log('1. Validando Edge Function "panic-alert"...');
  const fn = read('supabase/functions/panic-alert/index.ts');
  check('Edge Function existe (supabase/functions/panic-alert/index.ts)', fn.length > 0);
  check('Faz broadcast no canal Realtime "nexus-emergency"', fn.includes('nexus-emergency') && fn.includes('type: "broadcast"'));
  check('Persiste estado global na tabela emergencias', fn.includes('from("emergencias")'));
  check('RBAC no servidor (ROLES_ACIONAR / ACIONAR_EMERGENCIA)', fn.includes('ROLES_ACIONAR') && fn.includes('INSPETOR') && fn.includes('resolveIdentity'));
  check('CORS liberado para o frontend', fn.includes('Access-Control-Allow-Origin'));
  check('Responde ao preflight OPTIONS com 200 + CORS', fn.includes('req.method === \"OPTIONS\"') && fn.includes('new Response(\"ok\", { headers: CORS_HEADERS })'));
  // Sem verify_jwt=false, o gateway do Supabase devolve 401 no preflight e o navegador bloqueia (CORS)
  const cfg = read('supabase/config.toml');
  check('config.toml desliga verify_jwt do panic-alert (evita 401 no preflight CORS)', /\[functions\.panic-alert\]\s*\nverify_jwt\s*=\s*false/.test(cfg));

  // 2. Webhook OPCIONAL — DESATIVADO POR PADRÃO (SOMENTE no servidor)
  console.log('\n2. Validando webhook opcional do servidor (OFF por padrão)...');
  check('Lê configuração de panic_webhook_config', fn.includes('panic_webhook_config'));
  check('Padrão do código: enabled=false quando não há configuração', fn.includes('return { id: null, enabled: false, url: null }'));
  check('Só dispara com enabled=true E url configurada', fn.includes('webhookConfig.enabled && webhookConfig.url'));
  check('Timeout de segurança no disparo do webhook', fn.includes('AbortController') && fn.includes('WEBHOOK_TIMEOUT_MS'));
  check('Ação de teste do webhook (test-webhook)', fn.includes('test-webhook') && fn.includes('PANIC_WEBHOOK_TEST'));
  check('Eventos PANIC_ACTIVATED / PANIC_DEACTIVATED', fn.includes('PANIC_ACTIVATED') && fn.includes('PANIC_DEACTIVATED'));

  // 3. Migração SQL
  console.log('\n3. Validando migração SQL...');
  const mig = read('supabase/migrations/20261007000000_panic_button_global.sql');
  check('Cria tabela emergencias', mig.includes('create table if not exists emergencias'));
  check('Cria panic_webhook_config com enabled DEFAULT FALSE', mig.includes('panic_webhook_config') && mig.includes('enabled boolean not null default false'));
  check('Seed garante linha única com webhook DESLIGADO', mig.includes('select false, null'));
  check('RLS habilitado + políticas nexus_*', mig.includes('alter table emergencias enable row level security') && mig.includes('nexus_select_panic_webhook_config'));

  // 4. Módulo cliente global (js/panic-realtime.js)
  console.log('\n4. Validando módulo cliente js/panic-realtime.js...');
  const pr = read('js/panic-realtime.js');
  check('Expõe window.NexusPanic', pr.includes('window.NexusPanic'));
  check('Invoca a Edge Function panic-alert', pr.includes("FUNCTION_SLUG = 'panic-alert'") && pr.includes('functions.invoke'));
  check('Assina o canal WebSocket (broadcast) nexus-emergency', pr.includes("CHANNEL_NAME = 'nexus-emergency'") && pr.includes(".on('broadcast'") && pr.includes('.subscribe('));
  check('Banner fixo no RODAPÉ da tela (backlog3)', pr.includes('nexusPanicFooter') && pr.includes('fixed bottom-0'));
  check('Mensagem de emergência no rodapé', pr.includes('Emergência global ativa'));
  check('Sincroniza estado inicial via tabela emergencias', pr.includes("from('emergencias')") && pr.includes("eq('estado', 'ATIVA')"));
  check('Fallback de broadcast direto quando a função está indisponível', pr.includes('client_fallback') && pr.includes('ch.send'));
  check('Não usa fallback quando o servidor bloqueia por RBAC (401/403)', pr.includes('httpStatus === 401 || httpStatus === 403'));
  check('Front-end SEM webhook (painel/bind removidos do módulo cliente)',
    !pr.includes('bindWebhookSettingsUI') && !pr.includes('panicWebhookEnabled') && !pr.includes("from('panic_webhook_config')"));
  check('Evento global nexus_panic_changed', pr.includes('nexus_panic_changed'));
  check('Indicador SOS anima em todas as páginas enquanto ativo', pr.includes('nexus-panic-vibrating') && pr.includes('nexusPanicVibrate'));
  check('Vibração tátil periódica em dispositivos compatíveis', pr.includes('navigator.vibrate') && pr.includes('HAPTIC_INTERVAL_MS'));
  check('Vibração interrompida ao desativar ou ocultar a página', pr.includes('navigator.vibrate(0)') && pr.includes("'visibilitychange'"));
  check('Respeita preferência de movimento reduzido', pr.includes('prefers-reduced-motion: reduce'));

  // 4.1 Alerta no próprio aparelho (regressão: "o SOS não faz o celular vibrar")
  const hp = read('js/haptics.js');
  check('Motor de alerta no aparelho existe (js/haptics.js)', hp.includes('window.NexusHaptics'));
  check('Respeita contexto seguro, sticky user activation e limitações do iOS',
    hp.includes('insecure_context') && hp.includes('no_activation') && hp.includes('Vibration API') && hp.includes("isIOS()"));
  check('Explica em português por que o aparelho não vibrou', hp.includes('function describe()') && hp.includes('function hint('));
  check('Alerta sonoro de fallback quando a vibração é impossível', hp.includes('AudioContext') && hp.includes('function beep('));
  check('O tátil NÃO é desligado por prefers-reduced-motion (só a animação)', !/reduced_motion/.test(pr));
  check('Pânico delega a vibração ao motor de haptics', pr.includes('window.NexusHaptics'));
  check('Padrão SOS disparado no acionamento (local e broadcast)', pr.includes('HAPTIC_PATTERN_SOS') && pr.includes('fireActivationAlert'));
  check('Rodapé mostra o motivo de o aparelho não vibrar', pr.includes('nexusPanicFooterHaptics') && pr.includes('deviceAlertHint'));
  check('Não aplica pseudo-haptics ao botão SOS em navegadores sem suporte', !pr.includes('attachTapHaptic'));

  // 5. Botão existente delegado ao fluxo global
  console.log('\n5. Validando integração do botão existente (manutencao)...');
  const man = read('js/pages/manutencao.js');
  check('panicBtn delega para NexusPanic.triggerPanic', man.includes('window.NexusPanic.triggerPanic'));
  check('resetEmergencyBtn delega para NexusPanic.clearPanic', man.includes('window.NexusPanic.clearPanic'));
  check('Banner da página sincroniza via nexus_panic_changed', man.includes("window.addEventListener('nexus_panic_changed'"));
  check('Tokens legados preservados (compatibilidade test_fase_4)', ['panicBtn', 'resetEmergencyBtn', 'nexus_emergency_active', 'EMERGENCIA_CRITICA_ATIVADA'].every(t => man.includes(t)));

  // 6. Módulo carregado em TODAS as páginas internas
  console.log('\n6. Validando carregamento global do módulo...');
  const pages = ['dashboard.html', 'cargas.html', 'inspecao.html', 'scanner.html', 'embarcacoes.html', 'manutencao.html', 'delegacao.html', 'tecnico_portos.html', 'relatorios.html'];
  pages.forEach(p => check(`${p} carrega js/panic-realtime.js`, read(p).includes('<script src="js/panic-realtime.js"></script>')));

  // 7. Botão original + diagnóstico de banco em manutencao.html (sem painel de webhook)
  console.log('\n7. Validando UI do pânico em manutencao.html...');
  const mh = read('manutencao.html');
  check('Botão de pânico original preservado (#panicButton)', mh.includes('id="panicButton"'));
  check('Painel de webhook REMOVIDO do front-end',
    !['panicWebhookPanel', 'panicWebhookEnabled', 'panicWebhookUrl', 'panicWebhookSaveBtn',
      'panicWebhookTestBtn', 'panicWebhookStatus'].some(id => mh.includes(id)));
  check('Painel \"Banco de dados (tabelas do pânico)\" REMOVIDO da interface',
    !mh.includes('id="panicTablesCheckBtn"') && !mh.includes('id="panicTablesStatus"') && !mh.includes('id="panicDbPanel"'));

  // 7.1 Painel "Alerta no Aparelho" + testes dedicados
  console.log('\n7.1. Validando painel de vibração/som e testes dedicados...');
  check('Painel de vibração/som em manutencao.html',
    ['hapticsPanel', 'hapticsStatus', 'hapticsEnabledToggle', 'hapticsSoundToggle', 'hapticsTestBtn', 'hapticsRefreshBtn']
      .every(id => mh.includes(`id="${id}"`)));
  check('js/haptics.js carregado ANTES de js/panic-realtime.js em todas as páginas internas',
    pages.every(p => {
      const html = read(p);
      return html.indexOf('js/haptics.js') !== -1
        && html.indexOf('js/haptics.js') < html.indexOf('js/panic-realtime.js');
    }));
  check('Teste dedicado do alerta no aparelho (tests/test_haptics.js)', read('tests/test_haptics.js').includes('NexusHaptics'));
  check('Página pública de teste de vibração (teste-vibracao.html)', read('teste-vibracao.html').includes('js/haptics.js'));
  check('Pulsos do alerta com duração perceptível (>= 300ms)', pr.includes('HAPTIC_PULSE_MS = 300'));
  check('Vibração é repetida na primeira interação durante a emergência',
    pr.includes('onUserInteraction') && /pointerdown.*touchstart.*keydown.*click/.test(pr));

  // 8. Documentação
  console.log('\n8. Validando documentação...');
  check('README documenta arquitetura e deploy (--no-verify-jwt)', read('README.md').includes('functions deploy panic-alert --no-verify-jwt'));
  check('SPECs/schema.sql documenta novas tabelas', read('SPECs/schema.sql').includes('create table emergencias') && read('SPECs/schema.sql').includes('panic_webhook_config'));
  check('TABLES.md documenta novas tabelas e políticas', read('TABLES.md').includes('## Table `emergencias`') && read('TABLES.md').includes('### `panic_webhook_config`'));

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DO BOTÃO DE PÂNICO GLOBAL PASSARAM! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES DO PÂNICO GLOBAL FALHARAM. REVISE O CÓDIGO!');
    console.log('================================================================');
    process.exit(1);
  }
}

testPanicGlobal();
