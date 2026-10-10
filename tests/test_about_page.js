#!/usr/bin/env node
/**
 * TESTE — about.html (documentação ilustrada do sistema)
 * ------------------------------------------------------------
 * Valida o arquivo publicado na raiz do projeto sem abrir navegador:
 *
 *   1. Documento: idioma, título, meta description, viewport acessível e um único H1.
 *   2. Conteúdo: explica o fluxo, a arquitetura, os perfis, as regras de negócio e como
 *      as capturas foram produzidas.
 *   3. Contas: as três contas de demonstração (MAT-0000, MAT-2011, MAT-9999) aparecem
 *      com nome, cargo, camada de visão e código individual.
 *   4. Telas: cada tela do catálogo (tools/screenshots/paginas.js) tem seu cartão, e
 *      todas as capturas do manifesto estão referenciadas e existem em disco.
 *   5. Navegação e acessibilidade: links internos resolvem, imagens têm alt, botões
 *      têm rótulo e a página não depende de CDN além das fontes.
 *   6. Atualização: o arquivo em disco é exatamente o que o gerador produz hoje
 *      (detecta about.html desatualizado em relação ao manifesto/capturas).
 *
 * Uso: node tests/test_about_page.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, read, log, check, resumo } = require('./webmcp-harness');

const { gerarHtml } = require('../tools/screenshots/gerar-about');
const { PAGINAS } = require('../tools/screenshots/paginas');
const { CONTAS } = require('../tools/screenshots/demo-data');

const MANIFEST = path.join(ROOT, 'docs', 'screenshots', 'manifest.json');

// ---------------------------------------------------------------------------
// 1. Documento
// ---------------------------------------------------------------------------
function testarDocumento(html) {
  log('\n[1] Documento HTML');
  check('declara idioma pt-BR', /<html lang="pt-BR">/.test(html));
  check('define charset UTF-8 e viewport', /<meta charset="utf-8"\s*\/?>/.test(html) && /name="viewport"/.test(html));
  check('viewport não bloqueia o zoom (WCAG 1.4.4)',
    !/user-scalable\s*=\s*no/.test(html) && !/maximum-scale\s*=\s*1/.test(html));
  check('título identifica a página do sistema', /<title>NexusPort — Como funciona o sistema/.test(html));
  check('tem meta description', /<meta name="description" content="[^"]{40,}"/.test(html));
  check('exatamente um H1', (html.match(/<h1[\s>]/g) || []).length === 1);
  const secoes = ['inicio', 'fluxo', 'arquitetura', 'perfis', 'contas', 'telas', 'capturas', 'executar'];
  const faltando = secoes.filter((id) => !new RegExp(`id="${id}"`).test(html));
  check('tem as seções principais', faltando.length === 0, faltando.join(', '));
  check('não carrega scripts de CDN (só as fontes são externas)',
    !/<script[^>]+src="https?:\/\//.test(html),
    (html.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || []).join(', '));
}

// ---------------------------------------------------------------------------
// 2. Conteúdo explicativo
// ---------------------------------------------------------------------------
function testarConteudo(html) {
  log('\n[2] Conteúdo: como o sistema funciona');
  const fluxo = ['AGENDAMENTO', 'RECEBIMENTO_INSPECAO', 'ARMAZENAGEM', 'PRONTA_PARA_ENTREGA',
    'SAIDA', 'EM_TRANSITO', 'ENTREGUE', 'CANCELADA', 'RECUSADA'];
  const faltando = fluxo.filter((s) => !html.includes(s));
  check('descreve os 9 status da carga', faltando.length === 0, faltando.join(', '));

  const temas = [
    ['PostgREST/Supabase', /Supabase/],
    ['Edge Functions', /Edge Function/],
    ['RBAC por cargo', /(RBAC|matriz de ações|ACTION_PERMISSIONS)/],
    ['anti-XSS', /anti-XSS|nexusEsc/i],
    ['trilha imutável', /trilha (imutável|auditável)|trail_decisoes/],
    ['camadas de visão', /Visão (Própria|Operacional|Estratégica)/],
    ['WebMCP (agentes de IA)', /WebMCP/],
    ['botão de pânico', /p[âa]nico/i],
    ['LGPD/GA4', /LGPD|GA4/],
    ['VLibras', /VLibras/]
  ];
  const semTema = temas.filter(([, padrao]) => !padrao.test(html)).map(([nome]) => nome);
  check('explica arquitetura, segurança e recursos', semTema.length === 0, semTema.join(', '));

  check('documenta as regras de negócio (RN 14, RN 15, delegação)',
    /RN 14/.test(html) && /RN 15/.test(html) && /Delegação/.test(html));
  check('explica como as capturas foram feitas', /Como estas capturas foram produzidas/.test(html)
    && /tools\/screenshots\/capturar\.js/.test(html));
  check('declara os limites do ambiente de captura (VLibras, Realtime, GA4, dados fictícios)',
    /Widget VLibras/.test(html) && /Realtime/.test(html) && /fictícios/.test(html));
  check('traz os comandos de execução do projeto',
    /npm start/.test(html) && /npm test/.test(html) && /supabase db push/.test(html));
}

// ---------------------------------------------------------------------------
// 3. Contas de demonstração
// ---------------------------------------------------------------------------
function testarContas(html, manifest) {
  log('\n[3] Contas de demonstração');
  const contas = manifest.contas || [];
  check('as três contas do manifesto estão na página',
    contas.length === 3 && contas.every((c) => html.includes(c.matricula) && html.includes(c.nome)),
    contas.map((c) => c.matricula).join(', '));
  check('mostra código individual e camada de visão de cada conta',
    contas.every((c) => html.includes(c.codigo) && html.includes(c.camada)),
    contas.map((c) => `${c.matricula}:${c.camada}`).join(' | '));
  check('cada conta tem uma galeria própria na página',
    contas.every((c) => new RegExp(`id="galeria-${c.matricula.toLowerCase()}"`).test(html)));
  check('as três contas cobrem camadas de visão diferentes',
    new Set(contas.map((c) => c.camada)).size === 3);

  const [primeira] = CONTAS;
  check('a página usa as mesmas matrículas do catálogo de dados',
    CONTAS.every((c) => html.includes(c.matricula)),
    `${primeira.matricula}…`);
}

// ---------------------------------------------------------------------------
// 4. Telas e capturas
// ---------------------------------------------------------------------------
function testarTelas(html, manifest) {
  log('\n[4] Telas e capturas');
  const imagensDoManifesto = [
    ...(manifest.publicas || []).map((c) => c.imagem),
    ...(manifest.contas || []).flatMap((c) => c.paginas.map((p) => p.imagem))
  ];
  const referenciadas = new Set(html.match(/docs\/screenshots\/[A-Za-z0-9_.-]+\.png/g) || []);
  const faltandoNoHtml = imagensDoManifesto.filter((i) => !referenciadas.has(`docs/screenshots/${i}`));
  check(`todas as ${imagensDoManifesto.length} capturas do manifesto aparecem na página`,
    faltandoNoHtml.length === 0, faltandoNoHtml.slice(0, 3).join(', '));

  const ausentesNoDisco = [...referenciadas].filter((r) => !fs.existsSync(path.join(ROOT, r)));
  check('toda imagem referenciada existe em disco', ausentesNoDisco.length === 0, ausentesNoDisco.slice(0, 3).join(', '));

  const telasComCaptura = PAGINAS.filter((pagina) => (manifest.publicas || []).some((p) => p.pagina === pagina.chave)
    || manifest.contas.some((c) => c.paginas.some((p) => p.pagina === pagina.chave)));
  const semCartao = telasComCaptura.filter((pagina) => !new RegExp(`id="tela-${pagina.chave}"`).test(html)
    || !html.includes(pagina.arquivo) || !html.includes(pagina.resumo));
  check(`cada uma das ${telasComCaptura.length} telas tem cartão próprio com arquivo, resumo e objetivo`,
    semCartao.length === 0, semCartao.map((p) => p.arquivo).join(', '));

  check('a página informa quais contas têm acesso a cada tela',
    /Contas de demonstração com acesso:/.test(html) && /Tela pública \(não exige sessão\)/.test(html));

  const extras = manifest.contas.flatMap((c) => c.paginas.filter((p) => p.sufixo));
  check('estados adicionais capturados (checklist carregado, tema escuro) são exibidos',
    extras.length === 0 || /Estados adicionais/.test(html),
    `${extras.length} extra(s)`);
}

// ---------------------------------------------------------------------------
// 5. Links, acessibilidade e coerência
// ---------------------------------------------------------------------------
function testarLinksEAcessibilidade(html) {
  log('\n[5] Links e acessibilidade');

  const ids = new Set((html.match(/id="([^"]+)"/g) || []).map((m) => m.slice(4, -1)));
  const ancoras = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  const ancorasQuebradas = ancoras.filter((a) => !ids.has(a));
  check(`âncoras internas resolvem (${ancoras.length} links)`, ancorasQuebradas.length === 0, ancorasQuebradas.slice(0, 3).join(', '));

  const locais = [...html.matchAll(/href="(?!http|#|mailto)([^"#?]+)(?:#[^"]*)?"/g)]
    .map((m) => m[1])
    .filter((h) => !h.endsWith('.md'));
  const arquivosAusentes = locais.filter((h) => !fs.existsSync(path.join(ROOT, h)));
  check(`links para arquivos do projeto existem (${locais.length})`, arquivosAusentes.length === 0, arquivosAusentes.slice(0, 3).join(', '));

  const imagensSemAlt = (html.match(/<img(?![^>]*\balt=)[^>]*>/g) || []);
  check(`todas as ${(html.match(/<img/g) || []).length} imagens têm atributo alt`, imagensSemAlt.length === 0, imagensSemAlt.slice(0, 2).join(', '));

  const botoesSemNome = (html.match(/<button(?![^>]*aria-label)[^>]*>\s*<span class="material-symbols-outlined"[^>]*>[a-z_]+<\/span>/g) || []);
  check('botões com ícone têm rótulo acessível', botoesSemNome.length === 0);

  const tabelasSemCabecalho = (html.match(/<table>/g) || []).length - (html.match(/<thead>/g) || []).length;
  check('tabelas têm cabeçalho (thead) e célula de título (th scope)',
    tabelasSemCabecalho === 0 && /<th scope="col">/.test(html) && /<th scope="row">/.test(html));

  check('há alternância de tema claro/escuro', /id="botaoTema"/.test(html) && /nexus_theme/.test(html));
  check('as capturas abrem em visualização ampliada (lightbox acessível)',
    /<dialog id="lightbox"/.test(html) && /aria-label="Captura de tela ampliada"/.test(html));
  check('não há marcadores de template esquecidos',
    !/\$\{/.test(html) && !/undefined|NaN|\[object Object\]/.test(html));
}

// ---------------------------------------------------------------------------
// 6. Atualização em relação ao gerador
// ---------------------------------------------------------------------------
function testarAtualizacao(html) {
  log('\n[6] about.html está atualizado');
  if (!fs.existsSync(MANIFEST)) {
    check('manifesto das capturas existe', false, MANIFEST);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const esperado = gerarHtml(manifest);
  check('o arquivo corresponde ao que o gerador produz com o manifesto atual',
    html === esperado,
    html === esperado ? '' : 'rode: node tools/screenshots/gerar-about.js');
}

// ---------------------------------------------------------------------------
(async function principal() {
  console.log('\n=== about.html — documentação ilustrada do sistema ===');
  const caminho = path.join(ROOT, 'about.html');
  if (!fs.existsSync(caminho)) {
    process.stdout.write('❌ [FAIL] about.html não existe na raiz do projeto\n');
    process.exit(1);
  }
  const html = read('about.html');
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')) : { publicas: [], contas: [] };

  testarDocumento(html);
  testarConteudo(html);
  testarContas(html, manifest);
  testarTelas(html, manifest);
  testarLinksEAcessibilidade(html);
  testarAtualizacao(html);

  const { total, falhas } = resumo();
  process.stdout.write(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).\n`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  process.stdout.write(`Falha inesperada: ${erro && erro.stack ? erro.stack : erro}\n`);
  process.exit(1);
});
