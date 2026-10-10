/**
 * Teste: proteção anti-bot do login (js/pages/login.js + index.html)
 *
 *  - honeypot preenchido → envio descartado (nenhuma chamada ao servidor)
 *  - envio antes de 1 s após carregar a tela → descartado
 *  - envio normal → chama login_funcionario uma vez
 *  - resposta "bloqueado" do servidor → mensagem de bloqueio, sem seguir adiante
 *  - migration 20261010020000 existe e cria a função e a tabela com RLS
 *
 * Uso: node tests/test_login_protecao.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
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

function criarTela({ resposta }) {
  const html = read('index.html');
  const dom = new JSDOM(html, { url: 'https://nexus.test/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const chamadas = [];
  // JSDOM não implementa matchMedia (usado pelo tema do login)
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.nexusSupabase = {
    rpc(funcao, args) {
      chamadas.push({ funcao, args });
      return Promise.resolve({ data: resposta, error: null });
    },
    from() { throw new Error('login não deve consultar tabelas diretamente'); }
  };
  // O JSDOM dispara DOMContentLoaded nativo após o parse; não disparar manualmente (evita listener duplicado).
  w.eval(read('js/pages/login.js'));
  return { w, chamadas };
}

async function enviar(w, codigo, honeypot) {
  w.document.getElementById('operatorCode').value = codigo;
  if (honeypot !== undefined) w.document.getElementById('website').value = honeypot;
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(60);
}

(async () => {
  console.log('\n=== Proteção anti-bot do login ===');

  // 1. Honeypot preenchido (depois do tempo mínimo) → descartado
  {
    console.log('\n1. Honeypot');
    const { w, chamadas } = criarTela({ resposta: { ok: true, id: 'x', matricula: 'MAT-1', codigo_individual: 'NX-1', nome: 'A', cargo: 'INSPETOR' } });
    await sleep(1100);
    await enviar(w, 'NX-1', 'bot-preencheu');
    check('envio com honeypot preenchido não chama o servidor', chamadas.length === 0, JSON.stringify(chamadas));
    check('campo honeypot existe e está fora da tela (não display:none)', (() => {
      const campo = w.document.getElementById('website');
      const bloco = campo && campo.parentElement;
      return Boolean(campo) && /left:\s*-10000px/.test(bloco.getAttribute('style') || '');
    })());
    w.close();
  }

  // 2. Envio antes de 1 s → descartado
  {
    console.log('\n2. Envio rápido demais');
    const { w, chamadas } = criarTela({ resposta: { ok: true, id: 'x', matricula: 'MAT-1', codigo_individual: 'NX-1', nome: 'A', cargo: 'INSPETOR' } });
    await enviar(w, 'NX-1');
    check('envio logo após abrir a tela não chama o servidor', chamadas.length === 0, JSON.stringify(chamadas));
    w.close();
  }

  // 3. Envio normal → uma chamada à função
  {
    console.log('\n3. Envio normal');
    const { w, chamadas } = criarTela({ resposta: { ok: true, id: 'x', matricula: 'MAT-1', codigo_individual: 'NX-1', nome: 'A', cargo: 'INSPETOR' } });
    await sleep(1100);
    await enviar(w, 'nx-1', '');
    check('envio normal chama login_funcionario uma vez', chamadas.length === 1 && chamadas[0].funcao === 'login_funcionario', JSON.stringify(chamadas));
    check('código é enviado como p_codigo', chamadas[0] && chamadas[0].args.p_codigo === 'nx-1', JSON.stringify(chamadas));
    w.close();
  }

  // 4. Servidor responde bloqueado → mensagem de bloqueio, sem redirecionar
  {
    console.log('\n4. Bloqueio por tentativas');
    const { w, chamadas } = criarTela({ resposta: { ok: false, error: 'bloqueado' } });
    await sleep(1100);
    await enviar(w, 'NX-1', '');
    const titulo = w.document.getElementById('authNoticeTitle').textContent;
    check('mostra mensagem de bloqueio', /Bloqueado/.test(titulo), titulo);
    check('botão volta a ficar habilitado', w.document.getElementById('loginSubmitBtn').disabled === false);
    check('chamou o servidor exatamente uma vez', chamadas.length === 1);
    w.close();
  }

  // 5. Migration presente com a função, tabela e RLS
  {
    console.log('\n5. Migration');
    const sql = read('supabase/migrations/20261010020000_login_rate_limit.sql');
    check('cria a função login_funcionario', /create or replace function public\.login_funcionario/i.test(sql));
    check('função é security definer', /security definer/i.test(sql));
    check('tabela tentativas_login tem RLS ativa', /alter table public\.tentativas_login enable row level security/i.test(sql));
    check('concede execução somente a anon/authenticated', /grant execute on function public\.login_funcionario\(text\) to anon, authenticated/i.test(sql));
    check('login.js não usa .from(funcionarios) no login', !/from\('funcionarios'\)/.test(read('js/pages/login.js')));
  }

  console.log(`\nResultado: ${passou} aprovado(s), ${falhou} falha(s).`);
  if (falhou > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
