/**
 * Testes de regressão — correções "fáceis" do backlog3 (SPECs/backlog3.md)
 *
 * Cobre, executando as páginas reais em jsdom:
 *   1. Login: auto-complete do hífen ("MAT" + "1" → "MAT-1").
 *   2. Layout: contêiner principal limitado à viewport no desktop (barra
 *      lateral permanece fixa durante a rolagem) + helper global de emergência.
 *   3. Scanner: área de leitura 1:1 (quadrada) no celular.
 *   4. Cargas: carga EM_TRÂNSITO não pode ser movimentada.
 *   5. Embarcações: "Autorizar Retorno" realmente bloqueado para navio
 *      FORA_DO_PORTO + trava de regra de negócio na função.
 *   6. Manutenção: status legível na tabela de OS, datas dd/mm/aaaa,
 *      botão de pânico não reaciona com alarme ativo e manutenção de navio
 *      fora do Porto de Santos fica indisponível.
 *
 * Executar: node tests/test_backlog3_correcoes.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const SESSION = {
  matricula: '888001',
  codigo_individual: 'SUP-2001',
  nome: 'Supervisor de Testes',
  cargo: 'SUPERVISOR_GERENTE_OPERACOES',
  cargo_nome: 'Supervisor de Operações',
  camada_visao: 'Visão Operacional'
};

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

/**
 * Carrega uma página real em jsdom e executa, no contexto dela, os módulos
 * informados (depois de js/security.js e js/auth-guard.js).
 */
async function loadPage(pageFile, { scripts = [], seed = {}, session = SESSION } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  virtualConsole.on('error', () => {});
  virtualConsole.on('warn', () => {});
  virtualConsole.on('log', () => {});

  const dom = new JSDOM(read(pageFile), {
    url: `http://localhost:3000/${pageFile}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  // jsdom não implementa window.matchMedia (usado pelo tema claro/escuro do login)
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {}
    });
  }

  if (session) {
    window.localStorage.setItem('nexus_session', JSON.stringify(session));
    window.sessionStorage.setItem('nexus_session', JSON.stringify(session));
  }
  window.localStorage.setItem('nexus_ghost_clean_v1', 'true');

  Object.entries(seed).forEach(([key, value]) => {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  });

  window.eval(read('js/security.js'));
  window.eval(read('js/auth-guard.js'));
  window.currentUserSession = window.NexusAuth.getSession();
  for (const file of scripts) {
    window.eval(read(file));
  }

  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  return dom;
}

/* ------------------------------------------------------------------ *
 * 1. Login — auto-complete do separador
 * ------------------------------------------------------------------ */
async function testarLoginHifen() {
  console.log('\n1. Login — auto-complete do hífen (UX)');

  const dom = await loadPage('index.html', { scripts: ['js/login.js'], session: null });
  const { window } = dom;
  const input = window.document.getElementById('operatorCode');

  const digitar = (texto) => {
    input.value = texto;
    input.selectionStart = texto.length;
    input.selectionEnd = texto.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return input.value;
  };

  check('campo de código individual existe em index.html', Boolean(input));
  check('"MAT" + "1" completa para "MAT-1"', digitar('MAT1') === 'MAT-1', digitar('MAT1'));
  check('"NX8821" completa para "NX-8821"', digitar('NX8821') === 'NX-8821', digitar('NX8821'));
  check('código já hifenizado não é alterado', digitar('NX-8821-SP') === 'NX-8821-SP', digitar('NX-8821-SP'));
  check('matrícula apenas numérica permanece intacta', digitar('888001') === '888001', digitar('888001'));

  dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 2. Layout — barra lateral fixa + emergência global
 * ------------------------------------------------------------------ */
async function testarLayoutSidebarFixa() {
  console.log('\n2. Layout — barra lateral fixa ao rolar + helper de emergência');

  const dom = await loadPage('dashboard.html', { scripts: ['js/layout.js'] });
  const { window } = dom;
  const wrapper = window.document.querySelector('.flex-1.flex');

  check('contêiner principal limitado à viewport no desktop',
    Boolean(wrapper) && wrapper.className.includes('md:h-[calc(100vh-4rem)]') && wrapper.className.includes('md:overflow-hidden'),
    wrapper && wrapper.className);

  const sidebar = window.document.getElementById('appSidebar');
  check('barra lateral não rola junto com o conteúdo (overflow próprio)',
    Boolean(sidebar) && sidebar.className.includes('md:static'));

  check('helper global window.nexusEmergenciaAtiva existe', typeof window.nexusEmergenciaAtiva === 'function');
  check('helper reflete o estado desativado por padrão', window.nexusEmergenciaAtiva() === false);
  window.localStorage.setItem('nexus_emergency_active', 'true');
  check('helper detecta emergência ativa no localStorage', window.nexusEmergenciaAtiva() === true);

  dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 3. Scanner — área de leitura quadrada
 * ------------------------------------------------------------------ */
function testarScannerQuadrado() {
  console.log('\n3. Scanner QR Code — área de leitura 1:1');

  const html = read('scanner.html');
  const qrReader = html.match(/<div id="qrReader"[^>]*>/);
  check('#qrReader usa aspect-square (não mais a caixa h-64 retangular)',
    Boolean(qrReader) && qrReader[0].includes('aspect-square') && !qrReader[0].includes('h-64'),
    qrReader && qrReader[0]);
  check('CSS garante proporção 1:1 do preview', html.includes('aspect-ratio: 1 / 1'));
  check('vídeo da câmera sem distorção (object-fit: cover)', html.includes('object-fit: cover'));

  const js = read('js/scanner.js');
  check('área de leitura (qrbox) calculada quadrada', js.includes('ladoLeitura') && js.includes('qrbox: { width: ladoLeitura, height: ladoLeitura }'));
}

/* ------------------------------------------------------------------ *
 * 4. Cargas — carga em trânsito não é movimentada
 * ------------------------------------------------------------------ */
async function testarCargaEmTransito() {
  console.log('\n4. Cargas — bloqueio de movimentação em trânsito');

  const carga = {
    id: 'CRG-TRANSITO-1',
    tipo: 'Carga Geral',
    natureza: 'Geral',
    peso: '10 t',
    volume: '20 m³',
    portoDescarga: 'Pátio',
    destino: 'Destino',
    status: 'EM_TRANSITO',
    container: 'CONT-01',
    navio: 'Navio Teste',
    qrCode: 'QR-CRG-TRANSITO-1',
    data_cadastro: new Date().toISOString()
  };

  const dom = await loadPage('cargas.html', {
    scripts: ['js/tipos-carga.js', 'js/vision-layer.js', 'js/layout.js', 'js/cargas.js'],
    seed: { nexus_cargas_fluxo: [carga], nexus_containers_list: [], nexus_navios_list: [] }
  });
  const { window } = dom;
  const document = window.document;

  const btn = Array.from(document.querySelectorAll('#cargasTableBody button'))
    .find((b) => /Movimentar/.test(b.textContent));
  check('botão Movimentar continua listado para a carga em trânsito', Boolean(btn));
  check('botão Movimentar está desabilitado (disabled)', Boolean(btn) && btn.disabled === true);
  check('botão possui title explicando o bloqueio',
    Boolean(btn) && /trânsito/i.test(btn.getAttribute('title') || ''));

  // Trava de regra de negócio: nem chamando a função diretamente a carga se move
  window.localStorage.removeItem('nexus_guindaste_tarefas');
  window.nexusPrompt = async () => '1';
  await window.executarAcaoCarga('CRG-TRANSITO-1', 'MOVIMENTAR');

  const tarefas = JSON.parse(window.localStorage.getItem('nexus_guindaste_tarefas') || '[]');
  const cargaPersistida = JSON.parse(window.localStorage.getItem('nexus_cargas_fluxo') || '[]')[0];
  check('nenhuma tarefa de guindaste é criada', tarefas.length === 0, JSON.stringify(tarefas));
  check('carga permanece EM_TRANSITO', cargaPersistida && cargaPersistida.status === 'EM_TRANSITO');
  check('destino da carga não foi alterado', cargaPersistida && cargaPersistida.portoDescarga === 'Pátio');

  dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 5. Embarcações — autorizar retorno bloqueado fora do destino
 * ------------------------------------------------------------------ */
async function testarAutorizarRetorno() {
  console.log('\n5. Embarcações — trava de autorizar retorno / liberar saída');

  const navioForaDoPorto = {
    id: '11111111-1111-1111-1111-111111111111',
    nome: 'Navio Em Trânsito',
    imo: 'IMO-7770001',
    gps: '23.9608° S, 46.3022° W',
    localizacao: 'FORA_DO_PORTO',
    origem: 'Porto de Santos',
    destino: 'Porto de Roterdã',
    distancia: 10200,
    dataSaida: new Date(Date.now() - 86400000).toISOString()
  };

  const dom = await loadPage('embarcacoes.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/embarcacoes.js'],
    seed: { nexus_navios_list: [navioForaDoPorto], nexus_bercos_list: [], nexus_cargas_fluxo: [] }
  });
  const { window } = dom;
  const document = window.document;

  const linhas = Array.from(document.querySelectorAll('#embarcacoesGpsTableBody tr'));
  const btn = linhas
    .map((tr) => Array.from(tr.querySelectorAll('button')).find((b) => /Autorizar Retorno/.test(b.textContent)))
    .find(Boolean);

  check('navio FORA_DO_PORTO renderiza o botão Autorizar Retorno', Boolean(btn));
  check('botão está desabilitado de verdade (disabled + aria-disabled)',
    Boolean(btn) && btn.disabled === true && btn.getAttribute('aria-disabled') === 'true');
  check('botão não dispara mais manipulador inline', Boolean(btn) && !btn.hasAttribute('onclick'));

  // Trava de regra de negócio dentro da função
  window.nexusConfirm = async () => true;
  const antes = window.localStorage.getItem('nexus_navios_list');
  await window.autorizarRetornoNavio('IMO-7770001');
  const depois = JSON.parse(window.localStorage.getItem('nexus_navios_list') || '[]')[0];

  check('navio continua FORA_DO_PORTO (retorno não autorizado)', depois.localizacao === 'FORA_DO_PORTO', depois.localizacao);
  check('dados do navio não foram alterados pela chamada direta', window.localStorage.getItem('nexus_navios_list') === antes);

  // Rótulo amigável da localização em vez do código técnico cru
  const badge = linhas.length
    ? Array.from(linhas[0].querySelectorAll('span')).map((s) => s.textContent.trim()).join(' | ')
    : '';
  check('etiqueta de localização usa nome amigável "Em trânsito"', /Em trânsito/.test(badge), badge);
  check('código técnico permanece acessível no title', /FORA_DO_PORTO/.test(linhas[0] ? linhas[0].innerHTML : ''));

  dom.window.close();
}

/* ------------------------------------------------------------------ *
 * 6. Manutenção — tabela de OS, pânico idempotente e navio fora do porto
 * ------------------------------------------------------------------ */
async function testarManutencao() {
  console.log('\n6. Manutenção — status legível, datas e travas');

  const dom = await loadPage('manutencao.html', {
    scripts: ['js/vision-layer.js', 'js/layout.js', 'js/data-repository.js', 'js/manutencao.js'],
    seed: {
      nexus_emergency_active: 'true',
      nexus_os_list: [{
        id: 'OS-NAVIO-777',
        equipamento: 'Navio Teste',
        prioridade: 'BAIXA',
        descricao: '[PREVENTIVA] Revisão de casco',
        data: '2026-09-27',
        status: 'PENDENTE_APROVACAO'
      }],
      nexus_guindastes_list: [{ identificacao: 'GND-01-STS', dataManut: '' }],
      nexus_containers_list: [],
      nexus_navios_list: [
        { id: 'n-1', nome: 'Navio No Porto', imo: 'IMO-1', localizacao: 'DENTRO_DO_PORTO' },
        { id: 'n-2', nome: 'Navio Em Alto Mar', imo: 'IMO-2', localizacao: 'FORA_DO_PORTO' }
      ]
    }
  });
  const { window } = dom;
  const document = window.document;

  const osBody = document.getElementById('osTableBody');
  const textoOs = osBody ? osBody.textContent : '';
  check('status cru vira rótulo legível ("Aguardando aprovação")', /Aguardando aprovação/.test(textoOs), textoOs.slice(0, 120));
  check('data da OS no padrão dd/mm/aaaa', /27\/09\/2026/.test(textoOs), textoOs.slice(0, 160));

  // Botão de pânico não pode ser reacionado com o alarme já ativo
  const panicBtn = document.getElementById('panicButton');
  const banner = document.getElementById('emergencyAlertBanner');
  check('estado inicial aplica emergência ativa ao carregar',
    Boolean(panicBtn) && panicBtn.disabled === true && /EMERGÊNCIA ATIVA/.test(panicBtn.textContent));
  check('banner da página fica visível com o alarme ativo', Boolean(banner) && !banner.classList.contains('hidden'));

  let confirmacoes = 0;
  window.nexusConfirm = async () => { confirmacoes += 1; return true; };
  window.NexusPanic = { isActive: () => true, triggerPanic: async () => { confirmacoes += 100; return { ok: true }; } };
  panicBtn.click();
  await new Promise((r) => setTimeout(r, 60));
  check('clique no pânico com alarme ativo não pede confirmação nem reaciona', confirmacoes === 0, `confirmacoes=${confirmacoes}`);

  // Navio fora do Porto de Santos não aparece para manutenção
  const select = document.getElementById('navioManutSelect');
  const opcoes = select ? Array.from(select.options).map((o) => o.textContent) : [];
  check('navio dentro do Porto de Santos disponível para manutenção',
    opcoes.some((t) => /Navio No Porto/.test(t)), opcoes.join(' | '));
  check('navio fora do Porto de Santos não aparece na seleção',
    !opcoes.some((t) => /Navio Em Alto Mar/.test(t)), opcoes.join(' | '));

  dom.window.close();
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log('================================================================');
  console.log('🧪 TESTES — CORREÇÕES DO BACKLOG 3 (TAREFAS MAIS SIMPLES)');
  console.log('================================================================');

  await testarLoginHifen();
  await testarLayoutSidebarFixa();
  testarScannerQuadrado();
  await testarCargaEmTransito();
  await testarAutorizarRetorno();
  await testarManutencao();

  console.log('\n================================================================');
  if (passed) {
    console.log('🎉 TODAS AS CORREÇÕES DO BACKLOG 3 VALIDADAS COM SUCESSO! 🎉');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 FALHA EM UMA OU MAIS VERIFICAÇÕES.');
    console.log('================================================================');
    process.exit(1);
  }
})();
