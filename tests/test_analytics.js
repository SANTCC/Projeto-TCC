#!/usr/bin/env node
/**
 * TESTE — COOKIE DE DISPOSITIVO NO GOOGLE ANALYTICS (Backlog 3, item F)
 * ------------------------------------------------------------
 * Cobre js/analytics.js e as páginas reais:
 *   1. Configuração do GA4 (G-50V6WDEMPT): identificador do aparelho em cookie nativo (_ga), sem sinais de anúncio.
 *   2. Cookies com SameSite=Lax e Secure em HTTPS (SameSite=Lax em HTTP local).
 *   3. NexusAnalytics.track: nome de evento válido, parâmetros sem dados pessoais, valores curtos.
 *   4. Sem gtag (bloqueado) ou com erro: track retorna false e não lança exceção.
 *   5. Sem fingerprinting no código do módulo.
 *   6. Toda página usa js/analytics.js; nenhum snippet inline restante.
 *   7. Eventos de negócio existem nos pontos de conclusão (login, logout, pânico, QR, inspeção).
 *
 * Uso: node tests/test_analytics.js
 */
const fs = require('fs');
const {
  ROOT, read, log, check, resumo, criarJanela
} = require('./webmcp-harness');

const janelasAbertas = [];
const ID = 'G-50V6WDEMPT';

/** Remove comentários para que as verificações de código não leiam texto explicativo. */
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function eventosDoDataLayer(w) {
  return Array.from(w.dataLayer || []).map((entrada) => Array.from(entrada));
}

// ---------------------------------------------------------------------------
// 1 a 4. Módulo em jsdom
// ---------------------------------------------------------------------------
function testarModulo() {
  log('\n[1] Configuração do GA4 em HTTPS');
  const { dom, w } = criarJanela({ url: 'https://nexusport.test/index.html', scripts: ['js/analytics.js'] });
  janelasAbertas.push(dom.window);
  const itens = eventosDoDataLayer(w);
  const config = itens.find((i) => i[0] === 'config');
  check('dataLayer recebe o comando config com o ID G-50V6WDEMPT',
    !!config && config[1] === ID, JSON.stringify(config));
  check('dataLayer recebe o comando js com a data de carga', itens.some((i) => i[0] === 'js' && i[1] instanceof w.Date));
  const cfg = (config && config[2]) || {};
  check('identificador do aparelho em cookie (client_storage = cookie)', cfg.client_storage === 'cookie');
  check('cookie com SameSite=Lax;Secure em HTTPS', cfg.cookie_flags === 'SameSite=Lax;Secure', cfg.cookie_flags);
  check('validade do cookie de 2 anos (63072000 s)', cfg.cookie_expires === 63072000, String(cfg.cookie_expires));
  check('sem Google Signals', cfg.allow_google_signals === false);
  check('sem personalização de anúncios', cfg.allow_ad_personalization_signals === false);
  // O gtag.js (terceiro) só é baixado na primeira interação: a página não espera rede externa para
  // aparecer. O comando `config` já está no dataLayer e é processado quando o script chega.
  check('antes da interação: nenhum script do Google é baixado',
    !w.document.querySelector('script[src*="googletagmanager.com"]'));
  w.dispatchEvent(new w.Event('pointerdown'));
  const carregador = w.document.querySelector(`script[src="https://www.googletagmanager.com/gtag/js?id=${ID}"]`);
  check('na primeira interação, gtag.js é carregado de forma assíncrona',
    !!carregador && carregador.async === true);
  w.dispatchEvent(new w.Event('pointerdown'));
  check('duas interações não duplicam o carregamento',
    w.document.querySelectorAll('script[src*="googletagmanager.com"]').length === 1);

  log('\n[2] Cookies sem Secure em HTTP local (desenvolvimento)');
  const local = criarJanela({ url: 'http://localhost:3000/index.html', scripts: ['js/analytics.js'] });
  janelasAbertas.push(local.dom.window);
  const cfgLocal = (eventosDoDataLayer(local.w).find((i) => i[0] === 'config') || [])[2] || {};
  check('HTTP: cookie_flags = SameSite=Lax (sem Secure)', cfgLocal.cookie_flags === 'SameSite=Lax', cfgLocal.cookie_flags);

  log('\n[3] track: nome válido, parâmetros sem dados pessoais');
  const ok = w.NexusAnalytics.track('gerar_pdf', { origem: 'tela' });
  check('track com evento válido retorna true', ok === true);
  const ultimo = eventosDoDataLayer(w).pop();
  check('evento chega ao dataLayer como event/nome/parâmetros',
    ultimo && ultimo[0] === 'event' && ultimo[1] === 'gerar_pdf' && ultimo[2].origem === 'tela', JSON.stringify(ultimo));

  const sanitizado = w.NexusAnalytics.sanitizarParametros({
    nome: 'Fulano de Tal', codigo_individual: 'NX-1', matricula: 'MAT-1', email: 'a@b.c',
    user_id: 'x', origem: 'tela', cargo: 'INSPETOR', numero: 3, nulo: null, objeto: { a: 1 }
  });
  check('descarta nome, código, matrícula, e-mail e user_id',
    !('nome' in sanitizado) && !('codigo_individual' in sanitizado) && !('matricula' in sanitizado)
    && !('email' in sanitizado) && !('user_id' in sanitizado));
  check('mantém categorias (origem, cargo) e número finito',
    sanitizado.origem === 'tela' && sanitizado.cargo === 'INSPETOR' && sanitizado.numero === 3);
  check('descarta null e objetos', !('nulo' in sanitizado) && !('objeto' in sanitizado));
  check('valor de texto truncado em 100 caracteres',
    w.NexusAnalytics.sanitizarParametros({ origem: 'a'.repeat(150) }).origem.length === 100);
  check('parâmetros inválidos (nome com maiúsculas) são descartados',
    !('Origem' in w.NexusAnalytics.sanitizarParametros({ Origem: 'x' })));
  check('sem parâmetros: objeto vazio', Object.keys(w.NexusAnalytics.sanitizarParametros(null)).length === 0);

  const antes = eventosDoDataLayer(w).length;
  ['Gerar PDF', 'x', 'evento-com-hifen', '1evento', '', 'um_nome_muito_longo_para_o_ga4_com_mais_de_quarenta'].forEach((nome) => {
    w.NexusAnalytics.track(nome, {});
  });
  check('nomes de evento inválidos não são enviados', eventosDoDataLayer(w).length === antes);

  log('\n[4] Sem gtag (bloqueado) ou com erro: não quebra a página');
  w.gtag = undefined;
  let lancou = false;
  let retorno;
  try {
    retorno = w.NexusAnalytics.track('logout');
  } catch (e) {
    lancou = true;
  }
  check('gtag ausente: track retorna false sem lançar exceção', !lancou && retorno === false);
  w.gtag = () => { throw new Error('bloqueado pelo navegador'); };
  lancou = false;
  try {
    retorno = w.NexusAnalytics.track('logout');
  } catch (e) {
    lancou = true;
  }
  check('gtag que falha: track retorna false sem propagar erro', !lancou && retorno === false);
}

// ---------------------------------------------------------------------------
// 5 a 7. Código e páginas
// ---------------------------------------------------------------------------
function testarCodigoEPaginas() {
  log('\n[5] Sem fingerprinting no módulo');
  const codigo = semComentarios(read('js/analytics.js'));
  const proibidos = [
    'navigator.', 'canvas', 'AudioContext', 'getBattery', 'screen.', 'enumerateDevices',
    'WebGL', 'webgl', 'deviceMemory', 'hardwareConcurrency', 'localStorage', 'document.cookie'
  ];
  const achados = proibidos.filter((p) => codigo.includes(p));
  check('código do módulo não usa APIs de fingerprinting nem armazenamento próprio', achados.length === 0,
    achados.join(', '));

  log('\n[6] Páginas: js/analytics.js em todas e nenhum snippet inline');
  const paginas = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  const comGa = paginas.filter((f) => read(f).includes('js/analytics.js'));
  check('12 páginas carregam js/analytics.js', comGa.length === 12, `${comGa.length}`);
  const restos = paginas.filter((f) => /googletagmanager|gtag\('config'/.test(read(f)));
  check('nenhuma página mantém o snippet inline do GA', restos.length === 0, restos.join(', '));
  const idsEspalhados = paginas.filter((f) => read(f).includes(ID));
  check('o identificador do GA fica só em js/analytics.js', idsEspalhados.length === 0,
    idsEspalhados.join(', '));

  log('\n[7] Eventos de negócio nos pontos de conclusão');
  const pontos = [
    ['js/pages/confirm-role.js', 'login_confirmado'],
    ['js/pages/login.js', 'login_falha'],
    ['js/layout.js', 'logout'],
    ['js/panic-realtime.js', 'botao_panico_acionado'],
    ['js/pages/scanner.js', 'qr_lido'],
    ['js/pages/inspecao.js', 'inspecao_aprovada'],
    ['js/pages/inspecao.js', 'inspecao_recusada']
  ];
  pontos.forEach(([arquivo, evento]) => {
    check(`${arquivo} registra ${evento}`, semComentarios(read(arquivo)).includes(`track('${evento}'`));
  });

  const todosOsTracks = [];
  fs.readdirSync(`${ROOT}/js`, { recursive: true })
    .filter((f) => String(f).endsWith('.js') && String(f) !== 'analytics.js')
    .forEach((f) => {
      const src = semComentarios(read(`js/${String(f).replace(/\\/g, '/')}`));
      const reg = /track\('([^']+)'(?:,\s*(\{[^}]*\}))?/g;
      let m;
      while ((m = reg.exec(src)) !== null) todosOsTracks.push({ arquivo: f, nome: m[1], params: m[2] || '' });
    });
  const nomesValidos = todosOsTracks.every((t) => /^[a-z][a-z0-9_]{2,39}$/.test(t.nome));
  check('todos os nomes de evento usados são válidos para o GA4', nomesValidos,
    todosOsTracks.filter((t) => !/^[a-z][a-z0-9_]{2,39}$/.test(t.nome)).map((t) => t.nome).join(', '));
  const comPessoal = todosOsTracks.filter((t) => /nome|codigo|matric|email/i.test(t.params));
  check('nenhum evento envia nome, código ou matrícula como parâmetro', comPessoal.length === 0,
    comPessoal.map((t) => `${t.arquivo}:${t.nome}`).join(', '));
  check(`eventos rastreados no código: ${todosOsTracks.length} (mínimo 7)`, todosOsTracks.length >= 7);
}

// ---------------------------------------------------------------------------
(function main() {
  log('\n=== Cookie de dispositivo no Google Analytics (Backlog 3 — F) ===');
  try {
    testarModulo();
    testarCodigoEPaginas();
  } finally {
    janelasAbertas.forEach((janela) => { try { janela.close(); } catch (e) { /* já fechada */ } });
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})();
