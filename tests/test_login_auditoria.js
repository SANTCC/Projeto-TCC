/**
 * Teste: auditoria das tentativas de login (migration 20261011000000 +
 * tela seguranca.html / js/pages/seguranca.js)
 *
 *  - a migration mantém o formato de `tentativas_login` (chave/falhas/janela_inicio)
 *    e acrescenta o contador acumulado e os carimbos de data
 *  - o log NÃO é apagado quando o login acerta (some o `delete` da função)
 *  - as linhas do formato antigo são limpas uma única vez
 *  - tentativas erradas e já bloqueadas entram no log
 *  - login_funcionario grava ip + código + contagem + horário
 *  - a função de relatório devolve o agregado e a tela consome
 *  - a tela é restrita aos cargos altos e escapa IP/código/datas (Anti-XSS)
 *
 * Uso: node tests/test_login_auditoria.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  throw new Error('jsdom não instalado (rode npm install).');
}

let passou = 0;
let falhou = 0;
function check(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ✅ ${nome}`);
  } else {
    falhou++;
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ' — ' + detalhe : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Relatório de exemplo: um IP recidivo, um que "acertou depois" e um código sondado. */
const RELATORIO = {
  horas: 24,
  gerado_em: '2026-10-11T17:12:00Z',
  resumo: {
    tentativas: 7,
    ips: 2,
    ips_periodo: 1,
    em_alerta: 1,
    bloqueados: 0,
    codigos: 3,
    ultima_tentativa: '2026-10-11T17:11:06.195Z'
  },
  ips: [
    {
      ip: '212.104.215.159',
      total: 3,
      falhas_janela: 2,
      inicio: '2026-10-11T17:11:06.195Z',
      ultima: '2026-10-11T17:11:08.309Z',
      sucesso: null,
      nivel: 'moderado',
      em_janela: true
    },
    {
      ip: '<img src=x onerror="window.__xss=1">',
      total: 4,
      falhas_janela: 0,
      inicio: null,
      ultima: '2026-10-11T16:59:31.616Z',
      sucesso: '2026-10-11T17:00:12.000Z',
      nivel: 'limpo',
      em_janela: false
    }
  ],
  codigos: [{ codigo: 'MAT-676', total: 1, ultima: '2026-10-11T16:59:31.616Z' }],
  serie: [{ hora: '2026-10-11T16:00:00Z', ips: 2 }, { hora: '2026-10-11T17:00:00Z', ips: 1 }]
};

/** Chart.js falso: registra as configurações para o teste não depender da biblioteca. */
function criarChartFalso() {
  const instancias = [];
  function FakeChart(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.destroy = () => { this.destruido = true; };
    instancias.push(this);
  }
  FakeChart.instancias = instancias;
  return FakeChart;
}

function abrirTela({ relatorio, erro }) {
  const html = read('seguranca.html');
  const dom = new JSDOM(html, {
    url: 'https://nexus.test/seguranca.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  const chamadas = [];

  w.currentUserSession = {
    cargo: 'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
    cargo_nome: 'Diretor-Presidente',
    nome: 'Teste',
    matricula: 'MAT-0000',
    codigo_individual: 'NX-TEST'
  };
  w.nexusEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  w.Chart = criarChartFalso();
  w.nexusSupabase = {
    rpc(nome, args) {
      chamadas.push({ nome, args });
      return Promise.resolve(erro ? { data: null, error: erro } : { data: relatorio, error: null });
    }
  };

  // O JSDOM dispara o DOMContentLoaded nativo logo depois do parse: o módulo é
  // avaliado antes, então o ouvinte do próprio módulo o recebe. Não dispara
  // manualmente (o mesmo cuidado de tests/test_login_protecao.js), senão a tela
  // carregaria duas vezes e as consultas duplicariam.
  w.eval(read('js/pages/seguranca.js'));
  return { w, chamadas };
}

/**
 * Abre o Painel Geral (dashboard.html) em jsdom com o layout real injetado, para
 * exercitar o gesto que revela o item "Auditoria de Login" na barra lateral.
 * `gestoLiberado` simula a liberação já feita nesta aba (sessionStorage).
 */
function abrirPainel({ cargo = 'SUPERVISOR_GERENTE_OPERACOES', gestoLiberado = false } = {}) {
  const virtualConsole = new VirtualConsole();
  ['jsdomError', 'error', 'warn', 'log'].forEach((evento) => virtualConsole.on(evento, () => {}));

  const dom = new JSDOM(read('dashboard.html'), {
    url: 'https://nexus.test/dashboard.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const w = dom.window;

  if (typeof w.matchMedia !== 'function') {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  if (gestoLiberado) w.sessionStorage.setItem('nexus_auditoria_login_liberada', '1');

  w.currentUserSession = {
    cargo,
    cargo_nome: cargo,
    nome: 'Operadora de Teste',
    matricula: 'MAT-0001',
    codigo_individual: 'SUP-0001'
  };

  // Os <script src> do HTML não são baixados pelo jsdom: o ambiente é montado aqui.
  w.eval(read('js/security.js'));
  w.eval(read('js/session-cookies.js'));
  w.eval(read('js/auth-guard.js'));
  w.eval(read('js/layout.js'));
  w.eval(read('js/pages/dashboard.js'));

  // o DOMContentLoaded da página já passou no parse: dispara de novo para os
  // módulos que esperam o evento (mesma abordagem de tests/test_backlog3_correcoes.js)
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { dom, w };
}

const itemAuditoria = (doc) => doc.querySelector('#appSidebar a[href="seguranca.html"]');

(async () => {
  console.log('\n=== Auditoria das tentativas de login ===');

  const sql = read('supabase/migrations/20261011000000_login_auditoria_tentativas.sql');

  // 1. Formato da tabela preservado
  {
    console.log('\n1. Formato do log');
    check('mantém as três colunas originais (chave/falhas/janela_inicio)',
      /tentativas_login[\s\S]*?\bchave\b/.test(sql) && /falhas/.test(sql) && /janela_inicio/.test(sql));
    check('acrescenta o contador acumulado (total_falhas)',
      /add column if not exists total_falhas integer not null default 0/i.test(sql));
    check('acrescenta o carimbo da última tentativa errada',
      /add column if not exists ultima_tentativa timestamptz/i.test(sql));
    check('acrescenta o carimbo do acerto posterior (ultimo_sucesso)',
      /add column if not exists ultimo_sucesso timestamptz/i.test(sql));
    check('documenta que a chave é ip:<endereço> ou cod:<CÓDIGO>',
      /'ip:<endereço>'/.test(sql) && /'cod:<CÓDIGO>'/.test(sql));
  }

  // 2. O log para de ser apagado
  {
    console.log('\n2. Log permanente');
    const funcao = sql.slice(sql.indexOf('create or replace function public.login_funcionario'));
    check('a função de login não apaga mais as linhas do log',
      !/delete from public\.tentativas_login/.test(funcao),
      (funcao.match(/delete from public\.tentativas_login[^\n]*/) || [''])[0]);
    check('o acerto zera a janela em vez de apagar (libera o bloqueio)',
      /set falhas = 0,\s*\n\s*ultimo_sucesso = now\(\)/.test(funcao));
    check('o acerto carimba ultimo_sucesso',
      /ultimo_sucesso = now\(\)/.test(funcao));
    check('cada falha soma no contador acumulado e carimba a hora',
      /total_falhas = t\.total_falhas \+ 1/.test(funcao) && /ultima_tentativa = now\(\)/.test(funcao));
    // ramo do bloqueio: o que a função faz ANTES de devolver 'bloqueado'
    const iBloqueado = funcao.indexOf("return json_build_object('ok', false, 'error', 'bloqueado'");
    const ramoBloqueado = funcao.slice(Math.max(0, iBloqueado - 900), iBloqueado);
    check('a tentativa JÁ bloqueada também entra no log',
      iBloqueado > -1 &&
      /insert into public\.tentativas_login/.test(ramoBloqueado) &&
      /total_falhas = t\.total_falhas \+ 1/.test(ramoBloqueado) &&
      /ultima_tentativa = now\(\)/.test(ramoBloqueado));
    check('o limite de tentativas continua valendo (janela de 15 min)',
      /falhas >= v_limite/.test(funcao) && /janela_inicio > now\(\) - interval '15 minutes'/.test(funcao));
  }

  // 3. Limpeza única dos dados antigos
  {
    console.log('\n3. Limpeza dos logs antigos');
    check('apaga as linhas do formato antigo',
      /delete from public\.tentativas_login\s*\n?\s*where total_falhas = 0\s*\n?\s*and ultima_tentativa is null/i.test(sql));
    check('a limpeza não apaga linhas novas (idempotente)',
      /total_falhas = 0[\s\S]{0,60}ultima_tentativa is null/.test(sql));
    check('não há limpeza automática por idade (histórico permanente)',
      !/delete from public\.tentativas_login\s*\n?\s*where[^;]*(janela_inicio|ultima_tentativa)\s*<\s*now\(\)/i.test(sql));
  }

  // 4. Função de relatório
  {
    console.log('\n4. Relatório agregado');
    check('cria login_tentativas_relatorio(p_limite, p_horas)',
      /create or replace function public\.login_tentativas_relatorio\(p_limite int default \d+, p_horas int default \d+\)/.test(sql));
    check('é security definer', /security definer/i.test(sql));
    check('devolve resumo, ips, codigos e serie',
      /'resumo'/.test(sql) && /'ips'/.test(sql) && /'codigos'/.test(sql) && /'serie'/.test(sql));
    check('o total de tentativas soma os contadores dos IPs',
      /coalesce\(sum\(total_falhas\), 0\)[\s\S]{0,120}chave like 'ip:%'/.test(sql));
    check('concede execução a anon/authenticated',
      /grant execute on function public\.login_tentativas_relatorio\(int, int\) to anon, authenticated/i.test(sql));
    check('a tabela continua sem policy de leitura direta',
      !/create policy[^;]*on public\.tentativas_login/i.test(sql));
    check('os índices do painel existem',
      /idx_tentativas_login_chave_prefixo/.test(sql) && /idx_tentativas_login_ultima_tentativa/.test(sql));
    check('recarrega o schema cache do PostgREST (evita PGRST202 na tela)',
      /notify pgrst, 'reload schema'/.test(sql));
  }

  // 5. Acesso restrito aos cargos altos
  {
    console.log('\n5. Acesso à tela');
    const html = read('seguranca.html');
    const guard = read('js/auth-guard.js');
    const layout = read('js/layout.js');
    const cargos = ['DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'DIRETOR_OPERACOES_LOGISTICA', 'CONSELHO_ADMINISTRACAO', 'SUPERVISOR_GERENTE_OPERACOES'];
    check('a tela exige autenticação', /NexusAuth\.requireAuth\(/.test(html));
    check('a tela é restrita aos cargos altos',
      cargos.every((c) => new RegExp(`requireAuth\\(\\[[\\s\\S]*?'${c}'[\\s\\S]*?\\]\\)`).test(html)),
      cargos.filter((c) => !html.includes(c)).join(', '));
    check('o guard conhece a rota seguranca.html',
      /'seguranca\.html': \[/.test(guard));
    check('o guard lista os mesmos cargos da tela',
      cargos.every((c) => /'seguranca\.html': \[[^\]]*\]/.test(guard) && guard.match(/'seguranca\.html': \[[^\]]*\]/)[0].includes(c)));
    check('o item da sidebar fica oculto por padrão e só aparece para Direção/Supervisor depois do gesto',
      /id: 'seguranca\.html'[\s\S]*?visible: \(\) => \(isDiretor \|\| isSupervisor\) && auditoriaLiberada\(\)/.test(layout));
    check('a sidebar usa um ícone já presente no subconjunto da fonte',
      /id: 'seguranca\.html', label: 'Auditoria de Login', icon: 'shield_lock'/.test(layout));
  }

  // 5.1 O menu oculto só entra na barra lateral depois dos 5 cliques no nome
  {
    console.log('\n5.1 Menu oculto (5 cliques no nome do usuário)');

    const { dom, w } = abrirPainel();
    const doc = w.document;

    check('o módulo do gesto está exposto (window.NexusAuditoriaLogin)',
      Boolean(w.NexusAuditoriaLogin) && typeof w.NexusAuditoriaLogin.liberar === 'function');
    check('o gesto não está liberado por padrão', w.NexusAuditoriaLogin.liberado() === false);
    check('a barra lateral NÃO traz o item "Auditoria de Login"',
      itemAuditoria(doc) === null && !doc.getElementById('appSidebar').textContent.includes('Auditoria de Login'));
    check('os demais itens do menu continuam no lugar (Painel Geral/Cargas & Pátio)',
      doc.getElementById('appSidebar').textContent.includes('Painel Geral') &&
      doc.getElementById('appSidebar').textContent.includes('Cargas & Pátio'));

    const nome = doc.getElementById('welcomeName');
    check('o nome do usuário é renderizado no Painel Geral',
      Boolean(nome) && nome.textContent === 'Operadora de Teste', nome && nome.textContent);

    const itensAntesDoGesto = doc.querySelectorAll('#appSidebar .sidebar-nav-item').length;

    const clicarNoNome = (vezes) => {
      for (let i = 0; i < vezes; i++) nome.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    };

    clicarNoNome(4);
    check('4 cliques ainda não revelam o item', itemAuditoria(doc) === null);
    check('o gesto só se completa no 5º clique', w.NexusAuditoriaLogin.liberado() === false);

    clicarNoNome(1);
    const item = itemAuditoria(doc);
    check('o 5º clique faz o item aparecer na barra lateral', Boolean(item));
    check('o item aponta para o painel de auditoria com o rótulo/ícone esperados',
      Boolean(item) && item.textContent.includes('Auditoria de Login') &&
      item.querySelector('.material-symbols-outlined').textContent === 'shield_lock' &&
      item.classList.contains('sidebar-nav-item'),
      item && item.textContent.trim());
    check('a liberação fica registrada na sessão da aba', w.NexusAuditoriaLogin.liberado() === true);
    check('o operador é avisado de que o painel foi liberado',
      !doc.getElementById('globalFeedbackModal').classList.contains('hidden') &&
      doc.getElementById('globalFeedbackMsg').textContent.includes('auditoria'),
      doc.getElementById('globalFeedbackMsg') && doc.getElementById('globalFeedbackMsg').textContent);
    check('os itens que já existiam permanecem no menu (nada é substituído)',
      doc.getElementById('appSidebar').textContent.includes('Painel Geral') &&
      doc.querySelectorAll('#appSidebar .sidebar-nav-item').length === itensAntesDoGesto + 1,
      `${itensAntesDoGesto} → ${doc.querySelectorAll('#appSidebar .sidebar-nav-item').length}`);
    dom.window.close();

    // A liberação vale para as outras telas da mesma aba (mesmo sessionStorage)
    const outra = abrirPainel({ gestoLiberado: true });
    check('o item já liberado continua visível quando o layout é montado de novo',
      Boolean(itemAuditoria(outra.w.document)));
    outra.dom.window.close();

    // Cargo operacional: o gesto é ignorado em silêncio (não revela o painel)
    const estivador = abrirPainel({ cargo: 'ESTIVADOR', gestoLiberado: true });
    const docEst = estivador.w.document;
    check('cargo operacional não vê o item nem com o gesto liberado',
      itemAuditoria(docEst) === null && estivador.w.NexusAuditoriaLogin.permitido() === false);
    const nomeEst = docEst.getElementById('welcomeName');
    for (let i = 0; i < 5; i++) nomeEst.dispatchEvent(new estivador.w.MouseEvent('click', { bubbles: true }));
    check('5 cliques no nome não liberam nada para cargo sem permissão',
      itemAuditoria(docEst) === null && estivador.w.NexusAuditoriaLogin.liberar() === false);
    estivador.dom.window.close();
  }

  // 6. A tela consome o relatório e desenha o painel
  {
    console.log('\n6. Painel');
    const { w, chamadas } = abrirTela({ relatorio: RELATORIO });
    await sleep(120);

    check('consulta login_tentativas_relatorio uma vez',
      chamadas.length === 1 && chamadas[0].nome === 'login_tentativas_relatorio', JSON.stringify(chamadas));
    check('envia o limite e o período inicial (24 h)',
      chamadas[0] && chamadas[0].args.p_limite === 15 && chamadas[0].args.p_horas === 24,
      JSON.stringify(chamadas[0] && chamadas[0].args));

    const doc = w.document;
    check('indicador de tentativas erradas preenchido',
      doc.getElementById('kpiTentativas').textContent === '7', doc.getElementById('kpiTentativas').textContent);
    check('indicador de IPs distintos preenchido',
      doc.getElementById('kpiIps').textContent === '2', doc.getElementById('kpiIps').textContent);
    check('indicador de IPs em alerta preenchido',
      doc.getElementById('kpiAlerta').textContent === '1', doc.getElementById('kpiAlerta').textContent);
    check('indicador de IPs bloqueados preenchido',
      doc.getElementById('kpiBloqueados').textContent === '0', doc.getElementById('kpiBloqueados').textContent);

    const linhasIp = doc.querySelectorAll('#segTabelaIps tr');
    check('tabela de IPs com uma linha por IP', linhasIp.length === 2, String(linhasIp.length));
    check('mostra o IP, o total de tentativas e a data da última tentativa',
      linhasIp[0].textContent.includes('212.104.215.159') &&
      linhasIp[0].textContent.includes('3') &&
      linhasIp[0].textContent.includes('2026'),
      linhasIp[0] && linhasIp[0].textContent.slice(0, 120));
    check('mostra a situação do IP (moderado)',
      linhasIp[0].textContent.includes('Moderado'), linhasIp[0] && linhasIp[0].textContent.slice(0, 80));
    check('marca o IP que acertou depois das falhas',
      linhasIp[1].textContent.includes('2026'), linhasIp[1] && linhasIp[1].textContent.slice(0, 80));

    const linhasCod = doc.querySelectorAll('#segTabelaCodigos tr');
    check('tabela de códigos com o código tentado',
      linhasCod.length === 1 && linhasCod[0].textContent.includes('MAT-676'),
      linhasCod[0] && linhasCod[0].textContent.slice(0, 80));

    check('monta os três gráficos',
      w.Chart.instancias.length === 3, String(w.Chart.instancias.length));
    const gIps = w.Chart.instancias[0];
    check('gráfico de IPs rotula o endereço e usa o total de tentativas',
      gIps && gIps.config.data.labels[0] === '212.104.215.159' && gIps.config.data.datasets[0].data[0] === 3,
      JSON.stringify(gIps && gIps.config.data));
    check('gráfico por hora usa a série do servidor',
      w.Chart.instancias[1] && w.Chart.instancias[1].config.data.datasets[0].data.join(',') === '2,1',
      JSON.stringify(w.Chart.instancias[1] && w.Chart.instancias[1].config.data.datasets[0].data));
    check('gráfico de códigos usa os códigos mais tentados',
      w.Chart.instancias[2] && w.Chart.instancias[2].config.data.labels[0] === 'MAT-676');

    check('mostra o horário da última atualização',
      /Atualizado às/.test(doc.getElementById('segStatus').textContent), doc.getElementById('segStatus').textContent);
    check('sem aviso de erro', doc.getElementById('segAviso').classList.contains('hidden'));

    w.close();
  }

  // 7. Anti-XSS: IP e código-hostis não viram marcação
  {
    console.log('\n7. Anti-XSS');
    const { w } = abrirTela({ relatorio: RELATORIO });
    await sleep(120);
    const doc = w.document;
    check('nenhuma <img> injetada pelo IP do log',
      doc.querySelectorAll('#segTabelaIps img').length === 0);
    check('o texto do IP aparece escapado na tabela',
      doc.getElementById('segTabelaIps').textContent.includes('<img src=x onerror='),
      doc.getElementById('segTabelaIps').textContent.slice(0, 160));
    check('o script não roda ao renderizar (window.__xss indefinido)', w.__xss === undefined);
    w.close();
  }

  // 8. Troca de período
  {
    console.log('\n8. Período e recarga manual');
    const { w, chamadas } = abrirTela({ relatorio: RELATORIO });
    await sleep(120);
    const sel = w.document.getElementById('segPeriodo');
    sel.value = '168';
    sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    await sleep(120);
    check('trocar o período consulta de novo com as novas horas',
      chamadas.length === 2 && chamadas[1].args.p_horas === 168, JSON.stringify(chamadas));

    w.document.getElementById('segAtualizarBtn').click();
    await sleep(120);
    check('o botão Atualizar consulta de novo', chamadas.length === 3, String(chamadas.length));
    w.close();
  }

  // 9. Estados de erro e vazio
  {
    console.log('\n9. Erro e vazio');
    const { w, chamadas } = abrirTela({ relatorio: null, erro: { message: 'PGRST202: função não encontrada' } });
    await sleep(120);
    const aviso = w.document.getElementById('segAviso');
    check('erro do servidor aparece em aviso', !aviso.classList.contains('hidden'));
    check('o aviso explica a migração que falta',
      aviso.textContent.includes('20261011000000_login_auditoria_tentativas.sql'), aviso.textContent.slice(0, 200));
    check('o botão volta a ficar habilitado', w.document.getElementById('segAtualizarBtn').disabled === false);
    check('nenhum gráfico é montado sem dados', w.Chart.instancias.length === 0, String(w.Chart.instancias.length));
    w.close();

    const vazio = abrirTela({ relatorio: { ...RELATORIO, resumo: { ...RELATORIO.resumo, tentativas: 0, ips: 0 }, ips: [], codigos: [], serie: [] } });
    await sleep(120);
    check('log vazio mostra estado inicial nas tabelas',
      vazio.w.document.getElementById('segTabelaIps').textContent.includes('Nenhuma tentativa errada registrada') &&
      vazio.w.document.getElementById('segTabelaCodigos').textContent.includes('Nenhum código foi tentado'));
    check('log vazio não deixa o botão travado', vazio.w.document.getElementById('segAtualizarBtn').disabled === false);
    vazio.w.close();
  }

  console.log(`\nResultado: ${passou} aprovado(s), ${falhou} falha(s).`);
  if (falhou > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});