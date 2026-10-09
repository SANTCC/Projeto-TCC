#!/usr/bin/env node
/**
 * TESTE — GATE LIGHTHOUSE PARA PULL REQUESTS (Backlog 3, item H)
 * ------------------------------------------------------------
 *   1. Configuração (lighthouse/limiares.json) válida e com validação que pega erros comuns.
 *   2. Avaliação: categorias abaixo do mínimo, auditorias críticas, exceções e avisos.
 *   3. Servidor estático de dist/: não sai da pasta (path traversal) e resolve URLs limpas.
 *   4. Workflow do CI: dispara em pull_request, usa npm ci e npm run lighthouse, sem segredos.
 *   5. Scripts e dependências no package.json; relatórios fora do git.
 *   6. Execução ponta a ponta com Chrome real: só com LIGHTHOUSE_E2E=1 (CHROME_PATH opcional).
 *
 * Uso: node tests/test_lighthouse.js        (LIGHTHOUSE_E2E=1 node tests/test_lighthouse.js para o Chrome real)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, read, log, check, resumo } = require('./webmcp-harness');
const gate = require('../tools/lighthouse-check');

const temporarios = [];
function pastaTemporaria(prefixo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  temporarios.push(dir);
  return dir;
}

/** LHR sintético: só o que a avaliação lê. */
function lhrSintetico(pontos, auditorias) {
  const categorias = {};
  Object.keys(pontos).forEach((id) => { categorias[id] = { id, score: pontos[id] }; });
  const audits = {};
  Object.keys(auditorias || {}).forEach((id) => { audits[id] = { id, score: auditorias[id] }; });
  return { categories: categorias, audits };
}

const BOM = { performance: 0.9, accessibility: 0.95, 'best-practices': 0.96, seo: 0.92 };
const ESTRUTURA = {
  categorias: { performance: 0.6, accessibility: 0.75, 'best-practices': 0.9, seo: 0.9 },
  paginas: [{ arquivo: 'index.html', sessao: 'publica' }, { arquivo: 'dashboard.html', sessao: 'sessao' }],
  auditoriasCriticas: ['label', 'meta-viewport', 'button-name'],
  excecoes: { 'meta-viewport': { paginas: ['dashboard.html'], motivo: 'dívida de teste' } },
  rede: { bloquearHosts: ['*supabase.co*'], motivo: 'teste' }
};
const copia = (obj) => JSON.parse(JSON.stringify(obj));

// ---------------------------------------------------------------------------
// 1. Configuração
// ---------------------------------------------------------------------------
function testarConfiguracao() {
  log('\n[1] Configuração lighthouse/limiares.json');
  const cfg = gate.carregarLimiares();
  check('limiares.json carrega sem problemas', !!cfg && cfg.paginas.length > 0);
  const problemasReais = gate.validarLimiares(cfg);
  check('configuração real não tem problemas', problemasReais.length === 0, problemasReais.join(' | '));
  const paginas = cfg.paginas.map((p) => p.arquivo);
  check('páginas de produto estão no gate (login, confirmação, painel, cargas, relatórios, scanner)',
    ['index.html', 'confirm-role.html', 'dashboard.html', 'cargas.html', 'relatorios.html', 'scanner.html']
      .every((p) => paginas.includes(p)));
  check('página de diagnóstico teste-vibracao.html fica fora do gate', !paginas.includes('teste-vibracao.html'));
  check('sessao de cada página é publica, sessao ou pendencia',
    cfg.paginas.every((p) => ['publica', 'sessao', 'pendencia'].includes(p.sessao)));
  check('login é publica e confirmação é pendencia',
    cfg.paginas.find((p) => p.arquivo === 'index.html').sessao === 'publica'
    && cfg.paginas.find((p) => p.arquivo === 'confirm-role.html').sessao === 'pendencia');
  check('toda exceção aponta para página do gate e auditoria crítica',
    Object.keys(cfg.excecoes).every((a) => cfg.auditoriasCriticas.includes(a)
      && cfg.excecoes[a].paginas.every((p) => paginas.includes(p))));
  check('toda exceção tem motivo', Object.keys(cfg.excecoes).every((a) => cfg.excecoes[a].motivo.length > 10));

  const casos = [
    ['categoria desconhecida', (c) => { c.categorias.foo = 0.5; }, /categoria desconhecida/],
    ['mínimo fora de 0–1', (c) => { c.categorias.seo = 1.5; }, /entre 0 e 1/],
    ['página inexistente', (c) => { c.paginas.push({ arquivo: 'nao-existe.html', sessao: 'publica' }); }, /inexistente/],
    ['sessão inválida', (c) => { c.paginas[0].sessao = 'root'; }, /sessao deve ser/],
    ['exceção sem auditoria crítica', (c) => { c.excecoes.foo = { paginas: ['dashboard.html'], motivo: 'x' }; }, /não está em auditoriasCriticas/],
    ['exceção para página fora da lista', (c) => { c.excecoes['meta-viewport'].paginas.push('cargas.html'); }, /fora da lista/]
  ];
  casos.forEach(([nome, mexer, esperado]) => {
    const c = copia(ESTRUTURA);
    mexer(c);
    const problemas = gate.validarLimiares(c).join(' | ');
    check(`validação pega: ${nome}`, esperado.test(problemas), problemas);
  });
}

// ---------------------------------------------------------------------------
// 2. Avaliação
// ---------------------------------------------------------------------------
function testarAvaliacao() {
  log('\n[2] Avaliação do resultado por página');
  const ok = gate.avaliarLhr(lhrSintetico(BOM, { label: 1, 'meta-viewport': 0, 'button-name': 1 }), ESTRUTURA, 'dashboard.html');
  check('página com categorias boas e exceção conhecida passa', ok.ok === true, JSON.stringify(ok.falhas));
  check('exceção aplicada aparece no relatório', ok.excecoesAplicadas.length === 1 && /meta-viewport/.test(ok.excecoesAplicadas[0]));

  const abaixo = gate.avaliarLhr(lhrSintetico({ ...BOM, accessibility: 0.6 }, { label: 1, 'button-name': 1 }), ESTRUTURA, 'index.html');
  check('categoria abaixo do mínimo reprova', abaixo.ok === false && abaixo.falhas.some((f) => /accessibility.*abaixo/.test(f)));

  const exatoNoMinimo = gate.avaliarLhr(lhrSintetico({ ...BOM, performance: 0.6 }, { label: 1, 'button-name': 1 }), ESTRUTURA, 'index.html');
  check('categoria exatamente no mínimo passa', exatoNoMinimo.ok === true, JSON.stringify(exatoNoMinimo.falhas));

  const semPontuacao = gate.avaliarLhr({ categories: { ...BOM, seo: undefined }, audits: {} }, ESTRUTURA, 'index.html');
  check('categoria sem pontuação reprova', semPontuacao.ok === false && semPontuacao.falhas.some((f) => /seo sem pontuação/.test(f)));

  const critica = gate.avaliarLhr(lhrSintetico(BOM, { label: 0, 'meta-viewport': 1, 'button-name': 1 }), ESTRUTURA, 'index.html');
  check('auditoria crítica reprovada sem exceção reprova', critica.ok === false && critica.falhas.includes('auditoria crítica reprovada: label'));

  const excecaoErrada = gate.avaliarLhr(lhrSintetico(BOM, { label: 1, 'meta-viewport': 0, 'button-name': 1 }), ESTRUTURA, 'index.html');
  check('exceção vale só para a página indicada (index sem exceção reprova)',
    excecaoErrada.ok === false && excecaoErrada.falhas.includes('auditoria crítica reprovada: meta-viewport'));

  const naoAplicavel = gate.avaliarLhr(lhrSintetico(BOM, { label: null, 'meta-viewport': 1, 'button-name': 1 }), ESTRUTURA, 'index.html');
  check('auditoria sem pontuação (não aplicável) não reprova', naoAplicavel.ok === true);

  const obsoleta = gate.avaliarLhr(lhrSintetico(BOM, { label: 1, 'meta-viewport': 1, 'button-name': 1 }), ESTRUTURA, 'dashboard.html');
  check('exceção que já passa vira aviso (não reprova)', obsoleta.ok === true && obsoleta.avisos.some((a) => /obsoleta: meta-viewport/.test(a)));

  const ausente = gate.avaliarLhr(lhrSintetico(BOM, { label: 1, 'meta-viewport': 1 }), ESTRUTURA, 'index.html');
  check('auditoria ausente do relatório vira aviso', ausente.ok === true && ausente.avisos.some((a) => /button-name ausente/.test(a)));
}

// ---------------------------------------------------------------------------
// 3. Servidor estático
// ---------------------------------------------------------------------------
async function testarServidor() {
  log('\n[3] Servidor estático do gate (sem sair da pasta publicada)');
  const base = pastaTemporaria('lh-dist-');
  const segredo = path.join(path.dirname(base), `segredo-${path.basename(base)}.txt`);
  fs.writeFileSync(segredo, 'não deve ser servido');
  temporarios.push(segredo);
  fs.writeFileSync(path.join(base, 'index.html'), '<html>inicio</html>');
  fs.writeFileSync(path.join(base, 'dashboard.html'), '<html>painel</html>');
  fs.mkdirSync(path.join(base, 'js'));
  fs.writeFileSync(path.join(base, 'js', 'x.js'), 'var x = 1;');

  check('/ resolve para index.html', gate.resolverArquivoDist(base, '/') === path.join(base, 'index.html'));
  check('URL limpa /dashboard resolve para dashboard.html',
    gate.resolverArquivoDist(base, '/dashboard') === path.join(base, 'dashboard.html'));
  check('caminho com ? ignora a query', gate.resolverArquivoDist(base, '/js/x.js?v=1') === path.join(base, 'js', 'x.js'));
  check('../ é recusado', gate.resolverArquivoDist(base, `/../${path.basename(segredo)}`) === null);
  check('../ codificado é recusado', gate.resolverArquivoDist(base, `/%2e%2e/${path.basename(segredo)}`) === null);
  check('caminho malformado não lança exceção', gate.resolverArquivoDist(base, '/%E0%A4%A') === null);
  check('arquivo inexistente retorna null', gate.resolverArquivoDist(base, '/nao-existe.html') === null);
  check('pasta sem index retorna null', gate.resolverArquivoDist(base, '/js/') === null);

  const { servidor, origem } = await gate.iniciarServidor(base);
  try {
    const resposta = async (caminho) => {
      const r = await fetch(`${origem}${caminho}`, { redirect: 'manual' });
      return { status: r.status, corpo: await r.text() };
    };
    const raiz = await resposta('/');
    check('servidor responde 200 em /', raiz.status === 200 && raiz.corpo.includes('inicio'), `${raiz.status}`);
    const fora = await resposta(`/../${path.basename(segredo)}`);
    check('servidor responde 404 para ../ (não vaza arquivo)',
      fora.status === 404 && !fora.corpo.includes('não deve ser servido'), `${fora.status}`);
    const js = await resposta('/js/x.js');
    check('servidor serve JS com o tipo correto', js.status === 200 && js.corpo.includes('var x'));
  } finally {
    servidor.close();
  }
}

// ---------------------------------------------------------------------------
// 4. Workflow do CI
// ---------------------------------------------------------------------------
function testarWorkflow() {
  log('\n[4] Workflow de pull request (.github/workflows/lighthouse.yml)');
  const arquivo = '.github/workflows/lighthouse.yml';
  check('workflow existe', fs.existsSync(path.join(ROOT, arquivo)));
  if (!fs.existsSync(path.join(ROOT, arquivo))) return;
  const yml = read(arquivo);
  check('dispara em pull_request', /^on:\s*\n\s+pull_request:/m.test(yml));
  check('não usa pull_request_target (sem segredos para código de PR)', !/pull_request_target/.test(yml));
  check('permissões mínimas (contents: read)', /permissions:\s*\n\s+contents:\s*read/.test(yml));
  check('instala com npm ci (lockfile)', /run:\s*npm ci/.test(yml));
  check('roda o gate com npm run lighthouse', /run:\s*npm run lighthouse/.test(yml));
  check('usa Node 22 (requisito do Lighthouse 13)', /node-version:\s*(22|'22'|"22")/.test(yml));
  check('não referencia segredos', !/secrets\./.test(yml));
  check('relatórios vão como artefato mesmo quando falha', /if:\s*always\(\)/.test(yml) && /upload-artifact/.test(yml));
  check('execuções antigas do mesmo PR são canceladas', /cancel-in-progress:\s*true/.test(yml));
}

// ---------------------------------------------------------------------------
// 5. package.json e git
// ---------------------------------------------------------------------------
function testarPacote() {
  log('\n[5] Scripts, dependências e relatórios fora do git');
  const pacote = JSON.parse(read('package.json'));
  check('script lighthouse aponta para o gate', pacote.scripts.lighthouse === 'node tools/lighthouse-check.js');
  check('script test:lighthouse existe', pacote.scripts['test:lighthouse'] === 'node tests/test_lighthouse.js');
  const dev = pacote.devDependencies || {};
  check('lighthouse, chrome-launcher e puppeteer-core são devDependencies',
    !!dev.lighthouse && !!dev['chrome-launcher'] && !!dev['puppeteer-core']);
  check('.gitignore ignora lighthouse-report/', /^lighthouse-report\/?$/m.test(read('.gitignore')));
}

// ---------------------------------------------------------------------------
// 6. Ponta a ponta (Chrome real)
// ---------------------------------------------------------------------------
async function testarPontaAPonta() {
  log('\n[6] Gate ponta a ponta com Chrome real');
  if (process.env.LIGHTHOUSE_E2E !== '1') {
    log('  ⏭  Pulado: defina LIGHTHOUSE_E2E=1 (e CHROME_PATH, se o Chrome não estiver no PATH).');
    return;
  }
  const { ok, resultados } = await gate.executar({ filtro: ['index.html'] });
  check('login medido pelo Lighthouse passa no gate', ok === true,
    resultados.map((r) => r.falhas.join('; ')).join(' | '));
  check('relatório JSON salvo em lighthouse-report/', fs.existsSync(path.join(gate.PASTA_RELATORIOS, 'index.json')));
}

(async function main() {
  log('\n=== Gate Lighthouse para PRs (Backlog 3 — H) ===');
  try {
    testarConfiguracao();
    testarAvaliacao();
    await testarServidor();
    testarWorkflow();
    testarPacote();
    await testarPontaAPonta();
  } finally {
    temporarios.forEach((p) => fs.rmSync(p, { recursive: true, force: true }));
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})().catch((erro) => {
  console.error('❌ Erro inesperado no teste:', erro);
  process.exit(1);
});
