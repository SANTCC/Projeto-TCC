#!/usr/bin/env node
/**
 * TESTE — about.html (documentação institucional do sistema)
 * ------------------------------------------------------------
 * Valida o arquivo publicado na raiz do projeto sem abrir navegador:
 *
 *   1. Documento: idioma, título, meta description, viewport acessível e um único H1.
 *   2. Conteúdo: explica o que é o NexusPort, o fluxo operacional, a arquitetura, os
 *      perfis e as regras de negócio.
 *   3. Higienização: garante que a página NÃO atribui matrículas ou códigos a
 *      funcionários, NÃO exibe capturas de tela e NÃO exibe instruções de teste/execução.
 *   4. Funcionalidades por página: cada página operacional (PAGINAS_DO_ABOUT) tem seu
 *      cartão com arquivo, resumo, funcionalidades principais e cargos com acesso.
 *   5. Navegação e acessibilidade: links internos resolvem, imagens têm alt, botões
 *      têm rótulo e a página não depende de CDN além das fontes.
 *   6. Atualização: o arquivo em disco é exatamente o que o gerador produz hoje.
 *
 * Uso: node tests/test_about_page.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, read, log, check, resumo } = require('./webmcp-harness');

const { gerarHtml } = require('../tools/screenshots/gerar-about');
const { PAGINAS_DO_ABOUT } = require('../tools/screenshots/paginas');
const { CONTAS } = require('../tools/screenshots/demo-data');

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
  const secoes = ['inicio', 'fluxo', 'arquitetura', 'perfis', 'telas'];
  const faltando = secoes.filter((id) => !new RegExp(`id="${id}"`).test(html));
  check('tem as seções principais (inicio, fluxo, arquitetura, perfis, telas)', faltando.length === 0, faltando.join(', '));
  check('não carrega scripts de CDN (só as fontes são locais)',
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
}

// ---------------------------------------------------------------------------
// 3. Higienização (sem matrículas, sem capturas de tela e sem instruções de teste)
// ---------------------------------------------------------------------------
function testarHigienizacao(html) {
  log('\n[3] Higienização: sem matrículas, sem capturas de tela e sem instruções de teste');
  check('não atribui matrícula ou código individual a nenhum funcionário',
    !/\bMAT-\d+/i.test(html)
    && !/\bNX-\d+-SP\b/i.test(html)
    && !/\bMOCK-[A-Z0-9-]+/i.test(html)
    && CONTAS.every((c) => !html.includes(c.matricula) && !html.includes(c.codigo) && !html.includes(c.nome)));

  check('não possui seção de contas de demonstração (#contas)',
    !/id="contas"/.test(html) && !/href="#contas"/.test(html));

  check('não exibe capturas de tela (docs/screenshots/*.png) nem lightbox',
    !/docs\/screenshots\//i.test(html)
    && !/id="capturas"/.test(html)
    && !/id="lightbox"/.test(html));

  check('não exibe comandos ou instruções de como testar ou executar o sistema',
    !/id="executar"/.test(html)
    && !/\bnpm\s+(test|start|run)\b/.test(html)
    && !/\bsupabase\s+db\s+push\b/.test(html)
    && !/tools\/screenshots\/capturar\.js/.test(html)
    && !/teste-vibracao\.html/.test(html));
}

// ---------------------------------------------------------------------------
// 4. Funcionalidades por página
// ---------------------------------------------------------------------------
function testarTelas(html) {
  log('\n[4] Funcionalidades por página');
  const semCartao = PAGINAS_DO_ABOUT.filter((pagina) => !new RegExp(`id="tela-${pagina.chave}"`).test(html)
    || !html.includes(pagina.arquivo)
    || !html.includes(pagina.resumo));
  check(`cada uma das ${PAGINAS_DO_ABOUT.length} páginas tem cartão próprio com arquivo, resumo e funcionalidades`,
    semCartao.length === 0, semCartao.map((p) => p.arquivo).join(', '));

  check('informa os cargos com acesso a cada página e identifica telas públicas',
    /Cargos com acesso:/.test(html) && /Tela pública/.test(html));
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
  check(`todas as ${(html.match(/<img/g) || []).length} ilustrações têm atributo alt`, imagensSemAlt.length === 0, imagensSemAlt.slice(0, 2).join(', '));

  const botoesSemNome = (html.match(/<button(?![^>]*aria-label)[^>]*>\s*<span class="material-symbols-outlined"[^>]*>[a-z_]+<\/span>/g) || []);
  check('botões com ícone têm rótulo acessível', botoesSemNome.length === 0);

  const tabelasSemCabecalho = (html.match(/<table>/g) || []).length - (html.match(/<thead>/g) || []).length;
  check('tabelas têm cabeçalho (thead) e célula de título (th scope)',
    tabelasSemCabecalho === 0 && /<th scope="col">/.test(html) && /<th scope="row">/.test(html));

  check('há alternância de tema claro/escuro', /id="botaoTema"/.test(html) && /nexus_theme/.test(html));
  check('não há marcadores de template esquecidos',
    !/\$\{/.test(html) && !/undefined|NaN|\[object Object\]/.test(html));
}

// ---------------------------------------------------------------------------
// 6. Atualização em relação ao gerador
// ---------------------------------------------------------------------------
function testarAtualizacao(html) {
  log('\n[6] about.html está atualizado');
  const esperado = gerarHtml();
  check('o arquivo corresponde ao que o gerador produz',
    html === esperado,
    html === esperado ? '' : 'rode: node tools/screenshots/gerar-about.js');
}

// ---------------------------------------------------------------------------
(async function principal() {
  console.log('\n=== about.html — documentação institucional do sistema ===');
  const caminho = path.join(ROOT, 'about.html');
  if (!fs.existsSync(caminho)) {
    process.stdout.write('❌ [FAIL] about.html não existe na raiz do projeto\n');
    process.exit(1);
  }
  const html = read('about.html');

  testarDocumento(html);
  testarConteudo(html);
  testarHigienizacao(html);
  testarTelas(html);
  testarLinksEAcessibilidade(html);
  testarAtualizacao(html);

  const { total, falhas } = resumo();
  process.stdout.write(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).\n`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  process.stdout.write(`Falha inesperada: ${erro && erro.stack ? erro.stack : erro}\n`);
  process.exit(1);
});
