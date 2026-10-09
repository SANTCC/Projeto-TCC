// test_sessao_cookies.js
// Backlog 3 — Item A: "Salvar o login com Cookies ao invés de SESSION_STORAGE".
//
// Verificações COMPORTAMENTAIS em jsdom com as páginas reais:
//   1. atributos do cookie de sessão (path, SameSite=Lax, max-age de 12 h, Secure em HTTPS);
//   2. nenhuma sessão em sessionStorage/localStorage (cópias legadas são ignoradas e apagadas);
//   3. logout remove o cookie;
//   4. identificação pendente minimizada e com validade de 10 min;
//   5. fluxo completo login (index.html) → confirmação (confirm-role.html) → página protegida,
//      compartilhando um CookieJar, como o navegador faria;
//   6. vigia de expiração do turno (12 h) do auth-guard.
//
// Execução: node tests/test_sessao_cookies.js   (requer `npm install` para o jsdom)

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf-8'); }

let JSDOM, VirtualConsole, CookieJar;
try {
  ({ JSDOM, VirtualConsole, CookieJar } = require('jsdom'));
} catch (e) {
  console.log('  ⏭️  [SKIP] jsdom não instalado (execute `npm install` para a validação em DOM real).');
  process.exit(0);
}

let passou = 0;
let falhou = 0;
function check(label, ok, detalhe) {
  if (ok) {
    passou++;
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    falhou++;
    console.log(`  ❌ [FAIL] ${label}${detalhe ? ' — ' + detalhe : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cliente Supabase falso: só o encadeamento usado por js/pages/login.js (from/select/eq/single). */
function clienteSupabaseFalso(funcionarios) {
  return {
    from(tabela) {
      const filtros = [];
      const consulta = {
        select() { return consulta; },
        eq(coluna, valor) { filtros.push([coluna, valor]); return consulta; },
        single() {
          const linhas = tabela === 'funcionarios' ? funcionarios : [];
          const achado = linhas.find((l) => filtros.every(([c, v]) => String(l[c]) === String(v)));
          return Promise.resolve(achado ? { data: achado, error: null } : { data: null, error: { message: 'não encontrado' } });
        }
      };
      return consulta;
    }
  };
}

/**
 * Abre uma página real. `cookieJar` é compartilhado entre páginas (simula o navegador).
 * Os cookies escritos pela página são registrados, sem alterar o comportamento.
 */
function abrirPagina({ arquivo, url, jar, scripts = [], antesDosScripts }) {
  const erros = [];
  const cookiesGravados = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => erros.push(e && e.message ? e.message : String(e)));
  vc.on('error', () => {});
  vc.on('warn', () => {});
  vc.on('log', () => {});

  const dom = new JSDOM(read(arquivo), {
    url,
    cookieJar: jar,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;

  const descritorCookie = Object.getOwnPropertyDescriptor(w.Document.prototype, 'cookie');
  Object.defineProperty(w.document, 'cookie', {
    configurable: true,
    get() { return descritorCookie.get.call(this); },
    set(valor) {
      cookiesGravados.push(String(valor));
      descritorCookie.set.call(this, valor);
    }
  });

  if (typeof w.matchMedia !== 'function') {
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  w.scrollTo = () => {};
  w.localStorage.setItem('nexus_ghost_clean_v1', 'true');

  if (antesDosScripts) antesDosScripts(w);
  scripts.forEach((f) => w.eval(read(f)));
  return { dom, w, erros, cookiesGravados };
}

function gravarSessaoDeTeste(w, extra) {
  return w.NexusAuth.establishSession(Object.assign({
    id: 'f-1',
    matricula: 'MAT-8821',
    codigo_individual: 'NX-8821',
    nome: 'Igor Teste',
    cargo: 'INSPETOR',
    cargo_nome: 'Inspetor',
    login_at: new Date().toISOString()
  }, extra || {}));
}

function ultimoCookieDe(lista, nome) {
  const achados = lista.filter((c) => c.startsWith(nome + '='));
  return achados.length ? achados[achados.length - 1] : null;
}

function atributos(cookieGravado) {
  return cookieGravado.split(';').slice(1).map((a) => a.trim());
}

async function main() {
  console.log('\n🍪 TESTES — SESSÃO EM COOKIES (BACKLOG 3, ITEM A)');
  const HTTPS = 'https://nexusport.test';

  // ─── 1. Atributos do cookie de sessão (HTTPS) ───
  console.log('\n1. Cookie de sessão: atributos e leitura');
  {
    const jar = new CookieJar();
    const { w, cookiesGravados, erros } = abrirPagina({
      arquivo: 'dashboard.html', url: `${HTTPS}/dashboard.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
    });
    gravarSessaoDeTeste(w, { cargo: 'ESTIVADOR', nome: 'Operador Teste', codigo_individual: 'COD-1' });
    const cookie = ultimoCookieDe(cookiesGravados, 'nexus_session');
    check('a sessão é gravada no cookie nexus_session', Boolean(cookie));
    if (cookie) {
      const attrs = atributos(cookie);
      check('cookie com path=/', attrs.includes('path=/'), cookie);
      check('cookie com SameSite=Lax', attrs.includes('SameSite=Lax'), cookie);
      check('cookie com validade de 12 h (max-age=43200)', attrs.includes('max-age=43200'), cookie);
      check('cookie com Secure quando servido por HTTPS', attrs.includes('Secure'), cookie);
      check('cookie não tem HttpOnly (gravado por JavaScript — limitação declarada)', !attrs.some((a) => /httponly/i.test(a)), cookie);
    }
    const sessaoLida = w.NexusAuth.getSession();
    check('getSession() lê a sessão do cookie', Boolean(sessaoLida) && sessaoLida.cargo === 'ESTIVADOR', JSON.stringify(sessaoLida));
    check('duração do turno exposta = 12 h', w.NexusSessionCookies.TURNO_SEGUNDOS === 12 * 60 * 60);
    check('nenhum erro de execução ao gravar/ler', !erros.some((e) => /SyntaxError|ReferenceError|TypeError/.test(e)), erros.join(' | '));
    w.close();
  }

  // ─── 2. Mesmo cookie em HTTP local: sem Secure (não quebra o desenvolvimento) ───
  console.log('\n2. Cookie em HTTP local (desenvolvimento)');
  {
    const jar = new CookieJar();
    const { w, cookiesGravados } = abrirPagina({
      arquivo: 'cargas.html', url: 'http://localhost:3000/cargas.html', jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
    });
    gravarSessaoDeTeste(w);
    const cookie = ultimoCookieDe(cookiesGravados, 'nexus_session');
    check('em HTTP o cookie é gravado sem o atributo Secure', Boolean(cookie) && !atributos(cookie).includes('Secure'), cookie);
    w.close();
  }

  // ─── 3. Nenhuma sessão em sessionStorage/localStorage ───
  console.log('\n3. Sem armazenamento de sessão no navegador');
  {
    const jar = new CookieJar();
    const { w } = abrirPagina({
      arquivo: 'dashboard.html', url: `${HTTPS}/dashboard.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js'],
      antesDosScripts: (win) => {
        // Cópias deixadas por versões antigas do sistema
        win.sessionStorage.setItem('nexus_session', JSON.stringify({ codigo_individual: 'NX-1', cargo: 'DIRETOR_OPERACOES_LOGISTICA' }));
        win.localStorage.setItem('nexus_session', JSON.stringify({ codigo_individual: 'NX-1', cargo: 'DIRETOR_OPERACOES_LOGISTICA' }));
        win.sessionStorage.setItem('nexus_pending_auth', JSON.stringify({ codigo_individual: 'NX-1' }));
      }
    });
    check('sessão legada (sem cookie) é ignorada: getSession() = null', w.NexusAuth.getSession() === null);
    gravarSessaoDeTeste(w);
    check('ao gravar a sessão, a cópia legada em sessionStorage é apagada', w.sessionStorage.getItem('nexus_session') === null);
    check('ao gravar a sessão, a cópia legada em localStorage é apagada', w.localStorage.getItem('nexus_session') === null);
    check('ao gravar a sessão, a pendência legada é apagada', w.sessionStorage.getItem('nexus_pending_auth') === null);
    check('após gravar, a sessão vem do cookie (cargo INSPETOR)', w.NexusAuth.getSession().cargo === 'INSPETOR');
    w.close();
  }

  // ─── 4. Logout remove o cookie ───
  console.log('\n4. Logout');
  {
    const jar = new CookieJar();
    const { w, cookiesGravados } = abrirPagina({
      arquivo: 'dashboard.html', url: `${HTTPS}/dashboard.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
    });
    gravarSessaoDeTeste(w);
    w.NexusAuth.logout();
    const remocao = ultimoCookieDe(cookiesGravados, 'nexus_session');
    check('logout expira o cookie (max-age=0)', Boolean(remocao) && atributos(remocao).includes('max-age=0'), remocao);
    check('após logout não há sessão', w.NexusAuth.getSession() === null);
    check('após logout o cookie some do documento', !w.document.cookie.includes('nexus_session='), w.document.cookie);
    w.close();
  }

  // ─── 5. Identificação pendente minimizada e com validade curta ───
  console.log('\n5. Pendência de login (10 min, campos mínimos)');
  {
    const jar = new CookieJar();
    const { w, cookiesGravados } = abrirPagina({
      arquivo: 'index.html', url: `${HTTPS}/index.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js']
    });
    w.NexusSessionCookies.gravarPendencia({
      id: 'u-9', matricula: 'MAT-9', codigo_individual: 'NX-9', nome: 'Bia Souza', cargo: 'INSPETOR',
      email: 'bia@example.com', telefone: '11999990000', senha_hash: 'segredo'
    });
    const cookie = ultimoCookieDe(cookiesGravados, 'nexus_pending_auth');
    check('a pendência é gravada em cookie nexus_pending_auth', Boolean(cookie));
    check('pendência com validade de 10 min (max-age=600)', Boolean(cookie) && atributos(cookie).includes('max-age=600'), cookie);
    const pendencia = w.NexusSessionCookies.lerPendencia();
    check('pendência contém só os campos da confirmação',
      JSON.stringify(Object.keys(pendencia).sort()) === JSON.stringify(['cargo', 'codigo_individual', 'id', 'matricula', 'nome']),
      JSON.stringify(Object.keys(pendencia)));
    check('pendência não carrega e-mail, telefone ou senha', !/bia@example|11999990000|segredo/.test(JSON.stringify(pendencia)));
    // index.html não carrega o guard: a sessão é gravada pelo módulo comum, como a confirmação faz
    w.NexusSessionCookies.gravarSessao({ codigo_individual: 'NX-9', matricula: 'MAT-9', nome: 'Bia Souza', cargo: 'INSPETOR', login_at: new Date().toISOString() });
    check('gravar a sessão consome (apaga) a pendência', w.NexusSessionCookies.lerPendencia() === null);
    w.close();
  }

  // ─── 6. Fluxo completo: login → confirmação → página protegida (CookieJar compartilhado) ───
  console.log('\n6. Fluxo completo: login → confirmação de cargo → página protegida');
  {
    const jar = new CookieJar();
    const funcionarios = [{ id: 'f-1', matricula: 'MAT-8821', codigo_individual: 'NX-8821', nome: 'Igor Teste', cargo: 'INSPETOR', ativo: true }];

    // 6.1 index.html (login)
    const login = abrirPagina({
      arquivo: 'index.html', url: `${HTTPS}/index.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/pages/login.js'],
      antesDosScripts: (win) => { win.nexusSupabase = clienteSupabaseFalso(funcionarios); }
    });
    login.w.document.dispatchEvent(new login.w.Event('DOMContentLoaded', { bubbles: true }));
    await sleep(10);
    const campo = login.w.document.getElementById('operatorCode');
    const form = login.w.document.getElementById('loginForm');
    campo.value = 'NX-8821';
    campo.dispatchEvent(new login.w.Event('input', { bubbles: true }));
    form.dispatchEvent(new login.w.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(60);
    check('login grava a pendência em cookie', Boolean(ultimoCookieDe(login.cookiesGravados, 'nexus_pending_auth')));
    check('login não grava nada em sessionStorage', login.w.sessionStorage.length === 0, `itens: ${login.w.sessionStorage.length}`);
    login.w.close();

    // 6.2 confirm-role.html (mesma ordem de scripts da página)
    const confirmacao = abrirPagina({
      arquivo: 'confirm-role.html', url: `${HTTPS}/confirm-role.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/pages/confirm-role.js']
    });
    confirmacao.w.document.dispatchEvent(new confirmacao.w.Event('DOMContentLoaded', { bubbles: true }));
    await sleep(10);
    const doc = confirmacao.w.document;
    check('confirmação exibe o nome da pendência (lida do cookie)', doc.getElementById('userName').textContent === 'Igor Teste', doc.getElementById('userName').textContent);
    check('confirmação exibe a matrícula da pendência', /MAT-8821/.test(doc.getElementById('userMatricula').textContent), doc.getElementById('userMatricula').textContent);
    doc.getElementById('confirmRoleBtn').click();
    await sleep(10);
    const sessaoConfirmada = confirmacao.w.NexusSessionCookies.lerSessao();
    check('confirmar o cargo grava a sessão em cookie', Boolean(sessaoConfirmada), String(sessaoConfirmada));
    check('confirmar o cargo apaga a pendência', confirmacao.w.NexusSessionCookies.lerPendencia() === null);
    check('confirmação não usa sessionStorage', confirmacao.w.sessionStorage.length === 0, `itens: ${confirmacao.w.sessionStorage.length}`);
    confirmacao.w.close();

    // 6.3 página protegida (cargas.html) reconhece a sessão só pelo cookie
    const protegida = abrirPagina({
      arquivo: 'cargas.html', url: `${HTTPS}/cargas.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js']
    });
    const sessao = protegida.w.NexusAuth.getSession();
    check('página protegida lê a sessão do cookie (cargo INSPETOR)', Boolean(sessao) && sessao.cargo === 'INSPETOR', JSON.stringify(sessao));
    check('permissão por página segue o cargo do cookie (cargas.html permitido ao INSPETOR)', protegida.w.NexusAuth.canAccessPage('cargas.html') === true);
    protegida.w.close();

    // 6.4 confirmação sem pendência (cookie ausente ou expirado) não preenche o operador
    const semPendencia = abrirPagina({
      arquivo: 'confirm-role.html', url: `${HTTPS}/confirm-role.html`, jar: new CookieJar(),
      scripts: ['js/security.js', 'js/session-cookies.js', 'js/pages/confirm-role.js']
    });
    semPendencia.w.document.dispatchEvent(new semPendencia.w.Event('DOMContentLoaded', { bubbles: true }));
    await sleep(10);
    check('sem pendência, a confirmação não exibe operador', semPendencia.w.document.getElementById('userName').textContent === 'Carregando...',
      semPendencia.w.document.getElementById('userName').textContent);
    check('sem pendência, a confirmação volta para o login (navegação solicitada)',
      semPendencia.erros.some((e) => /navigation/i.test(e)), semPendencia.erros.join(' | '));
    semPendencia.w.close();
  }

  // ─── 7. Vigia de expiração do turno (12 h) ───
  console.log('\n7. Vigia do auth-guard: turno de 12 h');
  {
    const jar = new CookieJar();
    const timers = [];
    const { w, cookiesGravados } = abrirPagina({
      arquivo: 'dashboard.html', url: `${HTTPS}/dashboard.html`, jar,
      scripts: ['js/security.js', 'js/session-cookies.js'],
      antesDosScripts: (win) => {
        // Captura o intervalo do guard para acioná-lo de forma determinística
        win.setInterval = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
      }
    });
    w.eval(read('js/auth-guard.js'));
    const vigia = timers.find((t) => t.ms === 60000);
    check('o guard registra vigia a cada 60 s', Boolean(vigia));

    gravarSessaoDeTeste(w, { login_at: new Date(Date.now() - 60 * 1000).toISOString() });
    vigia && vigia.fn();
    check('sessão dentro do turno continua válida', w.NexusAuth.getSession() !== null);

    gravarSessaoDeTeste(w, { login_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() });
    vigia && vigia.fn();
    const remocao = ultimoCookieDe(cookiesGravados, 'nexus_session');
    check('sessão com mais de 12 h é encerrada pelo vigia', w.NexusAuth.getSession() === null);
    check('o encerramento pelo vigia expira o cookie', Boolean(remocao) && atributos(remocao).includes('max-age=0'), remocao);
    w.close();
  }

  console.log(`\nResultado: ${passou} aprovado(s), ${falhou} falha(s).`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => {
  console.error('❌ Erro inesperado no teste:', e);
  process.exit(1);
});
