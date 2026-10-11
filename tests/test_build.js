#!/usr/bin/env node
/**
 * TESTE — BUILD DE PRODUÇÃO (Backlog 3, item G)
 * ------------------------------------------------------------
 *   1. Saída completa: todas as páginas e todos os módulos js/ existem em dist/.
 *   2. JS e CSS minificados: menores que a origem e com sintaxe válida.
 *   3. Caminhos preservados: todo <script src>/<link href>/<img src> local existe na saída.
 *   4. Estrutura preservada: os mesmos id= de cada página e os mesmos blocos <script> inline.
 *   5. Fora da saída: testes, ferramentas, SPECs, supabase, THEME, documentação e manifestos.
 *   6. Proteção: a saída não pode ser a raiz do projeto.
 *   7. Código minificado executa: página real do dist/ (dashboard) monta o cabeçalho e a presença.
 *   8. Configuração: vercel.json e package.json apontam para o build.
 *   9. Determinismo: dois builds seguidos geram arquivos idênticos.
 *
 * Uso: node tests/test_build.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  ROOT, read, log, check, resumo, criarJanela, prontoDom, htmlDaPagina, sessao, aguardar
} = require('./webmcp-harness');
const { build, listarArquivos, RAIZ } = require('../tools/build');

const janelasAbertas = [];
const temporarios = [];

function novaPastaTemporaria(prefixo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  temporarios.push(dir);
  return dir;
}

function listarRecursivo(dir, base = '') {
  const saida = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) saida.push(...listarRecursivo(path.join(dir, e.name), rel));
    else saida.push(rel);
  });
  return saida.sort();
}

const paginasRaiz = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();
const jsDaOrigem = () => listarRecursivo(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));

/** Referências locais (não http, não data:, não âncoras) de um HTML. */
function referenciasLocais(html) {
  const refs = [];
  const padrao = /<(script|link|img)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = padrao.exec(html)) !== null) {
    const alvo = m[3];
    if (/^(https?:|\/\/|data:|#|mailto:|javascript:)/i.test(alvo)) continue;
    if (m[1].toLowerCase() === 'link' && !/rel\s*=\s*["']?(stylesheet|icon|manifest)/i.test(m[0])) continue;
    refs.push(alvo.split('?')[0]);
  }
  return refs;
}

const idsDe = (html) => Array.from(new Set((html.match(/\sid\s*=\s*["'][^"']+["']/g) || []).map((s) => s.trim()))).sort();

/** Blocos <script> inline de tipo JavaScript (sem src). */
function inlinesDe(html) {
  return (html.match(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi) || [])
    .filter((b) => !/\ssrc\s*=/i.test(b.slice(0, b.indexOf('>') + 1)) && /\S/.test(b.replace(/<[^>]+>/g, '')));
}

async function testarSaida(saida) {
  log('\n[1] Saída completa');
  const pastasPaginas = paginasRaiz();
  check(`todas as ${pastasPaginas.length} páginas HTML estão na saída`,
    pastasPaginas.every((p) => fs.existsSync(path.join(saida, p))));
  const modulos = jsDaOrigem();
  check(`todos os ${modulos.length} módulos js/ estão na saída`,
    modulos.every((m) => fs.existsSync(path.join(saida, 'js', m))));
  check('estáticos usados pelas páginas foram copiados (logo e favicon)',
    fs.existsSync(path.join(saida, 'design', 'logo_porto.png')) && fs.existsSync(path.join(saida, 'favicon.ico')));
  check('TXT de bloqueio VPN foi copiado sem alterar a mensagem',
    fs.readFileSync(path.join(saida, 'vpn-blocked.txt'), 'utf8').trimEnd() === 'AQUI NÃO!! TICO-TICO!!!!!!!!');
  check('código/dados do middleware não são publicados como arquivos estáticos',
    !fs.existsSync(path.join(saida, 'middleware.js')) && !fs.existsSync(path.join(saida, 'edge')));
  check('aviso da licença da lista upstream acompanha o build',
    fs.existsSync(path.join(saida, 'licenses', 'X4BNet-lists-vpn-MIT.txt')));

  log('\n[2] JS e CSS minificados e válidos');
  const antes = modulos.reduce((t, m) => t + fs.statSync(path.join(ROOT, 'js', m)).size, 0);
  const depois = modulos.reduce((t, m) => t + fs.statSync(path.join(saida, 'js', m)).size, 0);
  check(`JS total reduzido em pelo menos 30% (${antes} → ${depois} bytes)`, depois <= antes * 0.7);
  const invalidos = modulos.filter((m) => {
    try {
      // eslint-disable-next-line no-new
      new vm.Script(fs.readFileSync(path.join(saida, 'js', m), 'utf-8'), { filename: m });
      return false;
    } catch (e) {
      return true;
    }
  });
  check('todo módulo minificado tem sintaxe válida', invalidos.length === 0, invalidos.join(', '));
  const maiores = modulos.filter((m) => fs.statSync(path.join(saida, 'js', m)).size
    > fs.statSync(path.join(ROOT, 'js', m)).size);
  check('nenhum módulo ficou maior que a origem', maiores.length === 0, maiores.join(', '));
  const comentarios = modulos.filter((m) => /^\s*\/\*\*/m.test(fs.readFileSync(path.join(saida, 'js', m), 'utf-8')));
  check('comentários de bloco removidos dos módulos', comentarios.length === 0, comentarios.join(', '));

  log('\n[3] Caminhos locais de cada página existem na saída');
  const quebrados = [];
  pastasPaginas.forEach((pagina) => {
    referenciasLocais(fs.readFileSync(path.join(saida, pagina), 'utf-8')).forEach((ref) => {
      if (!fs.existsSync(path.join(saida, ref))) quebrados.push(`${pagina} → ${ref}`);
    });
  });
  check('nenhuma referência local quebrada', quebrados.length === 0, quebrados.slice(0, 5).join('; '));

  log('\n[4] Estrutura das páginas preservada (ids e blocos inline)');
  const divergentes = pastasPaginas.filter((p) => {
    const origem = read(p);
    const copia = fs.readFileSync(path.join(saida, p), 'utf-8');
    return JSON.stringify(idsDe(origem)) !== JSON.stringify(idsDe(copia));
  });
  check('mesmos id= em todas as páginas', divergentes.length === 0, divergentes.join(', '));
  const semBlocos = pastasPaginas.filter((p) => {
    const origem = inlinesDe(read(p)).length;
    const copia = inlinesDe(fs.readFileSync(path.join(saida, p), 'utf-8')).length;
    return origem !== copia;
  });
  check('mesmo número de <script> inline em cada página', semBlocos.length === 0, semBlocos.join(', '));

  log('\n[5] Fora da saída: testes, ferramentas, documentação e manifestos');
  const arquivosSaida = listarRecursivo(saida);
  const indevidos = arquivosSaida.filter((f) => /^(tests|tools|SPECs|supabase|THEME|lighthouse|lighthouse-report|node_modules|\.git)\//.test(f)
    || /^(package(-lock)?\.json|vercel\.json|README\.md|TABLES\.md|agents\.md|ai\.md|claude\.md)$/.test(f)
    || /\.(md|py)$/i.test(f));
  check('nenhum arquivo de desenvolvimento ou documentação na saída', indevidos.length === 0,
    indevidos.slice(0, 5).join(', '));
}

async function testarProtecao() {
  log('\n[6] Proteção: saída não pode apagar o projeto');
  let recusouRaiz = false;
  try {
    await build({ saida: RAIZ });
  } catch (e) {
    recusouRaiz = /raiz do projeto/.test(e.message);
  }
  check('build recusa a própria raiz como saída', recusouRaiz);
  let recusouAcima = false;
  try {
    await build({ saida: path.join(RAIZ, '..') });
  } catch (e) {
    recusouAcima = /raiz do projeto/.test(e.message);
  }
  check('build recusa uma pasta acima da raiz', recusouAcima);
  check('arquivos da raiz continuam existindo', fs.existsSync(path.join(RAIZ, 'package.json'))
    && fs.existsSync(path.join(RAIZ, 'js', 'layout.js')));
}

async function testarExecucao(relSaida) {
  log('\n[7] Página real do dist/ executa com o código minificado');
  const cliente = {
    canais: [],
    channel(nome, opcoes) {
      const canal = {
        nome,
        opcoes,
        handlers: {},
        estado: {},
        on(tipo, filtro, fn) { this.handlers[`${tipo}:${filtro.event}`] = fn; return this; },
        subscribe(cb) { this.subscribeCb = cb; return this; },
        track() { return Promise.resolve('ok'); },
        untrack() { return Promise.resolve('ok'); },
        presenceState() { return this.estado; }
      };
      this.canais.push(canal);
      return canal;
    },
    removeChannel() { return Promise.resolve('ok'); }
  };
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina(`${relSaida}/dashboard.html`),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-BUILD-1', nome: 'Sessão de build' }),
    scripts: [
      `${relSaida}/js/security.js`, `${relSaida}/js/session-cookies.js`, `${relSaida}/js/auth-guard.js`,
      `${relSaida}/js/vision-layer.js`, `${relSaida}/js/layout.js`, `${relSaida}/js/analytics.js`,
      `${relSaida}/js/supabase-client.js`, (win) => { win.nexusSupabase = cliente; },
      `${relSaida}/js/online-presence.js`
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);
  await aguardar(200);
  const topbar = w.document.getElementById('appTopbar') || w.document.querySelector('header');
  check('cabeçalho foi montado pelo layout minificado', !!topbar && /NexusPort/.test(topbar.textContent));
  check('nome do usuário aparece no cabeçalho', /Sessão de build/.test(w.document.body.textContent));
  check('módulo de analytics expõe NexusAnalytics.track', !!(w.NexusAnalytics && typeof w.NexusAnalytics.track === 'function'));
  check('track sem dados pessoais passa pelo gtag minificado',
    w.NexusAnalytics.track('logout', { origem: 'teste' }) === true);
  const canal = cliente.canais[0];
  check('presença criada com a chave do codigo_individual', !!canal && canal.opcoes.config.presence.key === 'NX-BUILD-1');
  if (canal) {
    canal.subscribeCb('SUBSCRIBED');
    canal.estado = { 'NX-BUILD-1': [{}], 'NX-OUTRO': [{}] };
    canal.handlers['presence:sync']();
  }
  check('contagem on-line calculada pelo código minificado',
    w.document.getElementById('headerOnlineCount').textContent === '2',
    w.document.getElementById('headerOnlineCount').textContent);
  if (w.NexusOnlinePresence) w.NexusOnlinePresence.parar();
}

function testarConfiguracao() {
  log('\n[8] Configuração do build e do deploy');
  const pacote = JSON.parse(read('package.json'));
  check('package.json tem o script build', pacote.scripts && pacote.scripts.build === 'node tools/build.js');
  check('terser e clean-css estão em devDependencies',
    !!(pacote.devDependencies && pacote.devDependencies.terser && pacote.devDependencies['clean-css']));
  const vercel = JSON.parse(read('vercel.json'));
  check('vercel.json executa npm run build antes do deploy', vercel.buildCommand === 'npm run build');
  check('vercel.json publica dist/', vercel.outputDirectory === 'dist');
  check('middleware Edge do Vercel e helper estão configurados',
    fs.existsSync(path.join(ROOT, 'middleware.js'))
      && /runtime:\s*'edge'/.test(read('middleware.js'))
      && !!pacote.dependencies?.['@vercel/edge']);
  check('prepare/prebuild atualizam a lista de VPNs do GitHub',
    pacote.scripts?.prepare === 'npm run vpn:update' && pacote.scripts?.prebuild === 'npm run vpn:update');
  const avisoVpn = (vercel.headers || []).find((item) => item.source === '/vpn-blocked.txt');
  check('vercel.json serve o aviso VPN como text/plain',
    !!avisoVpn && avisoVpn.headers.some((header) => header.key.toLowerCase() === 'content-type'
      && header.value === 'text/plain; charset=utf-8'));
  check('.gitignore ignora dist/', /^dist\/?$/m.test(read('.gitignore')));
}

async function testarDeterminismo(saida) {
  log('\n[9] Determinismo: dois builds seguidos geram os mesmos bytes');
  const segunda = novaPastaTemporaria('nexus-build-2-');
  await build({ saida: segunda });
  const arquivos = listarRecursivo(saida);
  const diferentes = arquivos.filter((f) => {
    const a = fs.readFileSync(path.join(saida, f));
    const b = fs.readFileSync(path.join(segunda, f));
    return !a.equals(b);
  });
  check(`mesma lista de arquivos e mesmos bytes (${arquivos.length} arquivos)`,
    diferentes.length === 0 && arquivos.length === listarRecursivo(segunda).length, diferentes.slice(0, 5).join(', '));
}

(async function main() {
  log('\n=== Build de produção (Backlog 3 — G) ===');
  try {
    const saida = novaPastaTemporaria('nexus-build-');
    await build({ saida });
    const relSaida = path.relative(ROOT, saida).split(path.sep).join('/');
    await testarSaida(saida);
    await testarProtecao();
    await testarExecucao(relSaida);
    testarConfiguracao();
    await testarDeterminismo(saida);
  } finally {
    janelasAbertas.forEach((janela) => { try { janela.close(); } catch (e) { /* já fechada */ } });
    temporarios.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch((erro) => {
  console.error('❌ Erro inesperado no teste:', erro);
  process.exit(1);
});
