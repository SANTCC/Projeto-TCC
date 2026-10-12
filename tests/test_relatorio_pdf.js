#!/usr/bin/env node
/**
 * TESTE — PDF DO RELATÓRIO NO SERVIDOR COM CACHE (Backlog 3, item B)
 * ------------------------------------------------------------
 *   1. Modelo e formatação: dados do banco; campo vazio vira "Não informado"; sem valores fictícios.
 *   2. Hash canônico: mesmo conteúdo, mesmo hash; qualquer mudança de dado muda o hash.
 *   3. As quatro seções do relatório, com títulos fixos.
 *   4. PDF A4 válido (pdf-lib), com paginação e texto que o banco não consegue codificar.
 *   5. Handler (Edge Function): validação, identidade, cache HIT/MISS, falhas e segredos.
 *   6. Consistência: cargos iguais aos de auth-guard.js; config.toml; migração do bucket privado; index.ts.
 *   7. Cliente (relatorios.html em jsdom): chama a função, baixa o arquivo e não gera PDF no navegador.
 *
 * Uso: node tests/test_relatorio_pdf.js
 */
const fs = require('fs');
const path = require('path');
const {
  ROOT, read, log, check, resumo, criarJanela, prontoDom, htmlDaPagina, sessao, aguardar
} = require('./webmcp-harness');

const PASTA = 'supabase/functions/relatorio-pdf';
const janelasAbertas = [];
const ID_CARGA = '7d1c2f3a-4b5c-4d6e-8f70-123456789abc';
const SEGREDO = 'chave-service-role-de-teste-nao-vazar';
const ANON = 'chave-anon-de-teste';

let relatorio;
let pdf;
let pdfLib;
let criarHandler;

function linhaCarga(extra) {
  return Object.assign({
    id: ID_CARGA,
    natureza: 'Carga geral',
    material: 'Madeira serrada',
    quantidade: '12.000',
    peso: '25.500',
    volume: '40.000',
    valor_declarado: '185000.50',
    destino: 'Hamburgo',
    porto_descarga: 'Hamburgo (DEHAM)',
    status_fluxo: 'ARMAZENAGEM',
    resultado_inspecao: 'APROVADA',
    motivo_recusa: null,
    data_entrada: '2026-10-08T12:30:00+00:00',
    data_saida: null,
    containers: {
      numero_identificacao: 'MSCU1234567',
      material_carregado: 'Madeira',
      estado: 'OPERANTE',
      data_fabricacao: '2019-03-15',
      tempo_uso_referencia: 'DATA_FABRICACAO',
      navios: {
        nome: 'Navio de teste Alfa',
        numero_imo: '9321483',
        porto_origem: 'Santos (BRSSZ)',
        porto_destino: 'Hamburgo (DEHAM)'
      }
    }
  }, extra || {});
}

/** Cliente Supabase falso: funcionarios, cargas e o bucket de cache (em memória). */
function criarClienteFalso(cenario) {
  const registro = { consultas: [], uploads: [], clientes: [] };
  const arquivos = new Map(Object.entries(cenario.arquivosIniciais || {}));
  const cliente = {
    registro,
    arquivos,
    from(tabela) {
      const consulta = { tabela, filtros: {}, select: null };
      const q = {
        select(campos) { consulta.select = campos; return q; },
        eq(coluna, valor) { consulta.filtros[coluna] = valor; return q; },
        async maybeSingle() {
          registro.consultas.push({ tabela, select: consulta.select, filtros: { ...consulta.filtros } });
          if (tabela === 'funcionarios') {
            if (cenario.erroFuncionarios) return { data: null, error: { message: 'connection refused: 10.0.0.5' } };
            const f = cenario.funcionarioPara ? cenario.funcionarioPara(consulta.filtros.codigo_individual) : null;
            return { data: f, error: null };
          }
          if (tabela === 'cargas') {
            const linha = cenario.cargaPara ? cenario.cargaPara(consulta.filtros.id) : null;
            return { data: linha, error: null };
          }
          return { data: null, error: { message: 'tabela desconhecida' } };
        }
      };
      return q;
    },
    storage: {
      from(bucket) {
        registro.bucket = bucket;
        return {
          async download(caminho) {
            if (arquivos.has(caminho)) {
              return { data: new Blob([arquivos.get(caminho)]), error: null };
            }
            return { data: null, error: { message: 'Object not found' } };
          },
          async upload(caminho, bytes, opcoes) {
            registro.uploads.push({ caminho, opcoes, tamanho: bytes.length });
            if (cenario.falhaUpload) return { data: null, error: { message: 'bucket indisponível' } };
            arquivos.set(caminho, bytes);
            return { data: { path: caminho }, error: null };
          }
        };
      }
    }
  };
  return cliente;
}

function criarRequisicao(corpo, metodo) {
  return new Request('https://projeto.supabase.co/functions/v1/relatorio-pdf', {
    method: metodo || 'POST',
    headers: { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
  });
}

function montarHandler(cenario, envExtra) {
  const cliente = criarClienteFalso(cenario);
  const env = Object.assign({
    SUPABASE_URL: 'https://projeto.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: SEGREDO
  }, envExtra || {});
  const handler = criarHandler({
    criarCliente(url, chave, opcoes) {
      cliente.registro.clientes.push({ url, chave, opcoes });
      return cliente;
    },
    lib: pdfLib,
    env: (nome) => env[nome] || ''
  });
  return { handler, cliente };
}

const FUNCIONARIO_OK = { id: 'f-1', cargo: 'DIRETOR_OPERACOES_LOGISTICA', ativo: true };

// ---------------------------------------------------------------------------
// 1 a 3. Modelo, hash e seções
// ---------------------------------------------------------------------------
function testarModeloEFormatacao() {
  log('\n[1] Modelo e formatação: só dados do banco');
  const m = relatorio.montarModelo(linhaCarga());
  check('valores numéricos do banco viram números', m.carga.peso_t === 25.5 && m.carga.valor_declarado_brl === 185000.5);
  check('navio vem pelo contêiner (cargas não tem navio_id)', m.navio && m.navio.numero_imo === '9321483');
  const secoes = relatorio.secoesDoRelatorio(m);
  const texto = JSON.stringify(secoes);
  check('peso formatado com a unidade', texto.includes('25,5 t'), texto.slice(0, 120));
  check('valor declarado em reais (pt-BR)', /R\$\s185\.000,50/.test(texto));
  check('data de entrada no fuso de Brasília', texto.includes('08/10/2026 09:30'));

  const vazia = relatorio.montarModelo(linhaCarga({
    quantidade: null, peso: null, volume: null, valor_declarado: null, destino: null,
    material: null, data_entrada: null, containers: null, motivo_recusa: null
  }));
  const textoVazio = JSON.stringify(relatorio.secoesDoRelatorio(vazia));
  const valorDoCampo = (secao, rotuloCampo) => {
    const campo = relatorio.secoesDoRelatorio(vazia)[secao].campos.find((c) => c[0] === rotuloCampo);
    return campo ? campo[1] : '(campo ausente)';
  };
  check('campo de texto vazio (Material) mostra exatamente "Não informado"', valorDoCampo(0, 'Material') === 'Não informado', valorDoCampo(0, 'Material'));
  check('campo de texto vazio (Destino) mostra exatamente "Não informado"', valorDoCampo(3, 'Destino') === 'Não informado', valorDoCampo(3, 'Destino'));
  check('campo vazio aparece como "Não informado"', textoVazio.includes('Não informado'));
  check('carga sem contêiner: seção de contêiner diz que não há vínculo',
    textoVazio.includes('Carga sem contêiner alocado'));
  check('carga sem contêiner: seção de navio diz que não há vínculo',
    textoVazio.includes('Carga sem navio vinculado por contêiner'));
  const proibidos = ['Destino Internacional', 'Carga Geral', '100.000', '25.0 t', '25 t', '40 m³', 'OPERANTE" ', 'Data de Fabricação', 'Validade da Auditoria', 'Porto de Santos (STS-01)'];
  const achados = proibidos.filter((p) => textoVazio.includes(p));
  check('nenhum valor padrão fictício no relatório de carga vazia', achados.length === 0, achados.join(', '));

  const estadoPadrao = relatorio.secoesDoRelatorio(relatorio.montarModelo(linhaCarga({ containers: { numero_identificacao: 'X', estado: null } })));
  check('estado do contêiner ausente vira "Não informado" (não "OPERANTE")',
    JSON.stringify(estadoPadrao).includes('"Estado operacional","Não informado"') || JSON.stringify(estadoPadrao).includes('["Estado operacional","Não informado"]'));

  check('rótulo de status vem do enum', relatorio.rotulo('status_fluxo', 'PRONTA_PARA_ENTREGA') === 'Pronta para entrega');
  check('valor de enum desconhecido aparece como está', relatorio.rotulo('status_fluxo', 'NOVO_STATUS') === 'NOVO_STATUS');
  check('datas puras não sofrem deslocamento de fuso', relatorio.formatarData('2026-10-09') === '09/10/2026');
  check('timestamp inválido vira "Não informado"', relatorio.formatarDataHora('não é data') === 'Não informado');
  check('UUID canônico é aceito, texto não', relatorio.ehUuid(ID_CARGA) && !relatorio.ehUuid('QR-123'));
}

async function testarHash() {
  log('\n[2] Hash canônico do modelo');
  const a = relatorio.montarModelo(linhaCarga());
  const b = relatorio.montarModelo(linhaCarga());
  const ha = await relatorio.hashModelo(a);
  const hb = await relatorio.hashModelo(b);
  check('hash tem 64 caracteres hexadecimais', /^[0-9a-f]{64}$/.test(ha));
  check('mesmo conteúdo, mesmo hash', ha === hb);
  check('ordem das chaves não altera o hash',
    relatorio.canonicalJson({ b: 1, a: { y: 2, x: 1 } }) === relatorio.canonicalJson({ a: { x: 1, y: 2 }, b: 1 }));
  check('campo undefined não entra no hash', relatorio.canonicalJson({ a: 1, b: undefined }) === '{"a":1}');
  const mudado = relatorio.montarModelo(linhaCarga({ status_fluxo: 'SAIDA' }));
  check('mudança de status muda o hash', (await relatorio.hashModelo(mudado)) !== ha);
  const outraCarga = relatorio.montarModelo(linhaCarga({ id: '00000000-0000-4000-8000-000000000001' }));
  check('outra carga, outro hash', (await relatorio.hashModelo(outraCarga)) !== ha);
}

function testarSecoes() {
  log('\n[3] As quatro seções, com títulos fixos');
  const secoes = relatorio.secoesDoRelatorio(relatorio.montarModelo(linhaCarga()));
  check('quatro seções', secoes.length === 4);
  check('títulos das seções',
    JSON.stringify(secoes.map((s) => s.titulo)) === JSON.stringify([
      '1. Dados da carga', '2. Dados do navio', '3. Dados do contêiner', '4. Resumo do fluxo operacional'
    ]));
  check('cada seção tem campos com rótulo e valor', secoes.every((s) => s.campos.length > 0
    && s.campos.every((c) => c.length === 2 && typeof c[0] === 'string' && typeof c[1] === 'string')));
}

// ---------------------------------------------------------------------------
// 4. PDF
// ---------------------------------------------------------------------------
async function testarPdf() {
  log('\n[4] PDF A4 válido');
  const modelo = relatorio.montarModelo(linhaCarga());
  const hash = await relatorio.hashModelo(modelo);
  const bytes = await pdf.gerarPdfRelatorio(modelo, hash, pdfLib);
  check('gera bytes', bytes instanceof Uint8Array && bytes.length > 1000, bytes && bytes.length);
  const cabecalho = Buffer.from(bytes.slice(0, 8)).toString('latin1');
  check('começa com a assinatura %PDF', cabecalho.startsWith('%PDF-'), cabecalho);
  check('termina com %%EOF', Buffer.from(bytes.slice(-16)).toString('latin1').includes('%%EOF'));
  const doc = await pdfLib.PDFDocument.load(bytes);
  check('carrega de volta e tem 1 página A4 (carga de tamanho normal)', doc.getPageCount() === 1, `${doc.getPageCount()}`);
  check('título e palavra-chave (hash) nos metadados',
    doc.getTitle().includes(ID_CARGA) && doc.getKeywords().includes(hash));

  const { gerarPdfRelatorio } = pdf;
  const longo = relatorio.montarModelo(linhaCarga({ natureza: 'Texto muito longo. '.repeat(400) }));
  const pdfLongo = await gerarPdfRelatorio(longo, await relatorio.hashModelo(longo), pdfLib);
  const docLongo = await pdfLib.PDFDocument.load(pdfLongo);
  check('texto longo quebra em páginas adicionais', docLongo.getPageCount() >= 2, `${docLongo.getPageCount()}`);

  const estranho = relatorio.montarModelo(linhaCarga({ natureza: 'Carga 🚢 com 货物 e “aspas” ~ ®', material: '\n\tquebras\nde linha' }));
  let bytesEstranho = null;
  let erroEstranho = null;
  try {
    bytesEstranho = await gerarPdfRelatorio(estranho, await relatorio.hashModelo(estranho), pdfLib);
  } catch (e) {
    erroEstranho = e;
  }
  check('caracteres fora do WinAnsi não quebram o PDF', !erroEstranho && bytesEstranho && bytesEstranho.length > 1000,
    erroEstranho && erroEstranho.message);
  if (bytesEstranho) {
    const docEstranho = await pdfLib.PDFDocument.load(bytesEstranho);
    check('PDF com texto estranho carrega', docEstranho.getPageCount() >= 1);
  }
}

// ---------------------------------------------------------------------------
// 5. Handler
// ---------------------------------------------------------------------------
async function testarHandler() {
  log('\n[5] Handler da Edge Function');
  const cenarioBase = {
    funcionarioPara: (codigo) => (codigo === 'NX-OK-1' ? FUNCIONARIO_OK : null),
    cargaPara: (id) => (id === ID_CARGA ? linhaCarga() : null)
  };
  const corpoOk = { carga_id: ID_CARGA, codigo_individual: 'NX-OK-1' };

  {
    const { handler } = montarHandler(cenarioBase);
    const r = await handler(criarRequisicao(undefined, 'OPTIONS'));
    check('OPTIONS responde 204 com CORS para authorization e apikey',
      r.status === 204 && /authorization/.test(r.headers.get('access-control-allow-headers'))
      && /apikey/.test(r.headers.get('access-control-allow-headers')));
    const g = await handler(criarRequisicao(undefined, 'GET'));
    check('GET responde 405', g.status === 405);
  }

  {
    const { handler, cliente } = montarHandler(cenarioBase);
    const r1 = await handler(criarRequisicao('isso não é json'));
    check('JSON inválido responde 400', r1.status === 400);
    const r2 = await handler(criarRequisicao({ carga_id: 'QR-123', codigo_individual: 'NX-OK-1' }));
    check('carga_id que não é UUID responde 400 (sem consulta ao banco)', r2.status === 400 && cliente.registro.consultas.length === 0);
    const r3 = await handler(criarRequisicao({ carga_id: ID_CARGA }));
    check('sem código individual responde 400', r3.status === 400);
    const r4 = await handler(criarRequisicao({ carga_id: ID_CARGA, codigo_individual: 'x'.repeat(65) }));
    check('código individual longo demais responde 400', r4.status === 400);
    const r5 = await handler(criarRequisicao('x'.repeat(5000)));
    check('corpo acima do limite responde 413', r5.status === 413);
  }

  {
    const { handler, cliente } = montarHandler({ ...cenarioBase, funcionarioPara: () => null });
    const r = await handler(criarRequisicao(corpoOk));
    check('código desconhecido responde 403', r.status === 403);
    check('código desconhecido não lê a carga', !cliente.registro.consultas.some((c) => c.tabela === 'cargas'));
  }
  {
    const { handler } = montarHandler({ ...cenarioBase, funcionarioPara: () => ({ ...FUNCIONARIO_OK, ativo: false }) });
    check('funcionário inativo responde 403', (await handler(criarRequisicao(corpoOk))).status === 403);
  }
  {
    const { handler } = montarHandler({ ...cenarioBase, funcionarioPara: () => ({ ...FUNCIONARIO_OK, cargo: 'VISITANTE' }) });
    check('cargo fora da lista de relatórios responde 403', (await handler(criarRequisicao(corpoOk))).status === 403);
  }
  {
    const { handler } = montarHandler({ ...cenarioBase, cargaPara: () => null });
    check('carga inexistente responde 404', (await handler(criarRequisicao(corpoOk))).status === 404);
  }
  {
    const { handler } = montarHandler({ ...cenarioBase, erroFuncionarios: true });
    const r = await handler(criarRequisicao(corpoOk));
    const corpo = await r.text();
    check('erro de banco responde 500 sem vazar o detalhe', r.status === 500 && !/10\.0\.0\.5|connection refused/.test(corpo), corpo);
  }
  {
    const { handler } = montarHandler(cenarioBase, { SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: '' });
    const r = await handler(criarRequisicao(corpoOk));
    check('sem chave de serviço responde 500 (configuração ausente)', r.status === 500
      && /Configuração do servidor ausente/.test(await r.text()));
  }

  log('\n  Cache no bucket privado');
  const { handler, cliente } = montarHandler(cenarioBase);
  const primeira = await handler(criarRequisicao(corpoOk));
  const bytes1 = new Uint8Array(await primeira.arrayBuffer());
  check('primeira emissão responde 200 application/pdf', primeira.status === 200
    && primeira.headers.get('content-type') === 'application/pdf');
  check('primeira emissão é MISS', primeira.headers.get('x-relatorio-cache') === 'MISS');
  const hashCabecalho = primeira.headers.get('x-relatorio-hash');
  check('cabeçalho traz o hash do conteúdo', /^[0-9a-f]{64}$/.test(hashCabecalho || ''));
  check('PDF devolvido é válido', Buffer.from(bytes1.slice(0, 5)).toString() === '%PDF-');
  check('nome do arquivo usa o código da carga', (primeira.headers.get('content-disposition') || '').includes(`Relatorio_A4_${ID_CARGA}.pdf`));
  check('arquivo gravado com o hash no bucket relatorios-pdf',
    cliente.registro.uploads.length === 1 && cliente.registro.uploads[0].caminho === `${hashCabecalho}.pdf`
    && cliente.registro.bucket === 'relatorios-pdf', JSON.stringify(cliente.registro.uploads.map((u) => u.caminho)));
  check('upload é privado e sem sobrescrever por engano (upsert só para o mesmo hash)',
    cliente.registro.uploads[0].opcoes.contentType === 'application/pdf' && cliente.registro.uploads[0].opcoes.upsert === true);

  const segunda = await handler(criarRequisicao(corpoOk));
  check('mesma carga e mesmos dados: HIT', segunda.headers.get('x-relatorio-cache') === 'HIT');
  check('HIT não grava de novo', cliente.registro.uploads.length === 1);
  check('HIT devolve o mesmo hash', segunda.headers.get('x-relatorio-hash') === hashCabecalho);
  check('HIT devolve o mesmo arquivo', Buffer.compare(Buffer.from(await segunda.arrayBuffer()), Buffer.from(bytes1)) === 0);

  // Cache com a versão antiga: a nova versão do dado (status SAIDA) tem outro hash e precisa de MISS.
  const { handler: handlerMudado } = montarHandler({
    ...cenarioBase,
    cargaPara: (id) => (id === ID_CARGA ? linhaCarga({ status_fluxo: 'SAIDA' }) : null),
    arquivosIniciais: { [`${hashCabecalho}.pdf`]: bytes1 }
  });
  const terceira = await handlerMudado(criarRequisicao(corpoOk));
  check('dado alterado: novo hash e MISS (o cache não serve versão velha)',
    terceira.headers.get('x-relatorio-cache') === 'MISS' && terceira.headers.get('x-relatorio-hash') !== hashCabecalho);

  const { handler: handlerFalhaGravacao, cliente: clienteFalha } = montarHandler({ ...cenarioBase, falhaUpload: true });
  const falha = await handlerFalhaGravacao(criarRequisicao(corpoOk));
  check('falha na gravação do cache não impede o PDF (200 MISS)',
    falha.status === 200 && falha.headers.get('x-relatorio-cache') === 'MISS');
  check('falha de gravação foi tentada', clienteFalha.registro.uploads.length === 1);

  {
    const { handler: h, cliente: c } = montarHandler(cenarioBase);
    await h(criarRequisicao(corpoOk));
    const opcoes = c.registro.clientes[0] && c.registro.clientes[0].opcoes;
    check('cliente criado sem sessão persistida e com a chave de serviço (só no servidor)',
      opcoes && opcoes.auth.persistSession === false && c.registro.clientes[0].chave === SEGREDO);
  }
}

// ---------------------------------------------------------------------------
// 6. Consistência e configuração
// ---------------------------------------------------------------------------
function testarConfiguracao() {
  log('\n[6] Consistência: cargos, configuração, migração e índice');
  const guard = read('js/auth-guard.js');
  const linha = guard.split('\n').find((l) => l.includes("'relatorios.html': ["));
  const doGuard = linha ? Array.from(linha.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]) : [];
  check('lista de cargos da função é igual à de relatorios.html (auth-guard.js)',
    JSON.stringify([...relatorio.CARGOS_PERMITIDOS].sort()) === JSON.stringify([...doGuard].sort()),
    doGuard.join(','));

  const config = read('supabase/config.toml');
  check('config.toml desativa JWT do gateway para relatorio-pdf (mesma razão de panic-alert)',
    /\[functions\.relatorio-pdf\][\s\S]*?verify_jwt\s*=\s*false/.test(config));

  const migracoes = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /relatorios_pdf/.test(f));
  check('migração do bucket existe', migracoes.length === 1, migracoes.join(','));
  const sql = migracoes.length ? read(`supabase/migrations/${migracoes[0]}`) : '';
  check('migração cria o bucket relatorios-pdf como privado (public = false)',
    /insert into storage\.buckets/i.test(sql) && /'relatorios-pdf'/.test(sql) && /public/i.test(sql)
    && /on conflict/i.test(sql) && !/public\s*,?\s*\n?[^)]*true/i.test(sql));
  check('migração não cria políticas de acesso público ao storage', !/create policy/i.test(sql));

  const indice = read(`${PASTA}/index.ts`);
  check('index.ts liga o handler ao Deno.serve', /Deno\.serve\(criarHandler\(/.test(indice)
    && /from '\.\/handler\.js'/.test(indice));
  check('index.ts não contém chave nem valor de exemplo', !/eyJ|SERVICE_ROLE_KEY\s*=/.test(indice));

  const logicaServidor = ['relatorio.js', 'pdf.js', 'handler.js', 'index.ts'].map((f) => read(`${PASTA}/${f}`)).join('\n');
  const fictcios = ['Destino Internacional', 'Carga Geral', "'25.0 t'", "'40 m³'", 'R$ 100.000', '100000', "'Porto de Santos'"];
  const achados = fictcios.filter((p) => logicaServidor.includes(p));
  check('nenhum valor fictício no código do servidor', achados.length === 0, achados.join(', '));
}

// ---------------------------------------------------------------------------
// 7. Cliente
// ---------------------------------------------------------------------------
async function testarCliente() {
  log('\n[7] Cliente: relatorios.html chama a função e baixa o arquivo');
  const html = read('relatorios.html');
  check('relatorios.html não carrega mais o jsPDF (o PDF é do servidor)', !/jspdf/i.test(html));
  const relatoriosJs = read('js/pages/relatorios.js');
  check('relatorios.js não usa jsPDF nem valores padrão fictícios',
    !/window\.jspdf|new jsPDF|Destino Internacional|Carga Geral|100000|'25\.0 t'/.test(relatoriosJs));
  check('relatorios.js chama a função relatorio-pdf', /functions\/v1\/relatorio-pdf/.test(relatoriosJs));

  const feedbacks = [];
  const downloads = [];
  const chamadas = [];
  const logs = [];
  let respostaFetch = null;
  const fetchFalso = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    if (respostaFetch instanceof Error) throw respostaFetch;
    return respostaFetch;
  };
  const cliente = { from() { return { select() { return this; }, order() { return this; }, eq() { return this; }, or() { return this; }, async maybeSingle() { return { data: null, error: null }; }, then(r) { return r({ data: [], error: null }); } }; }, channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {} };
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    html: htmlDaPagina('relatorios.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-SES-1', nome: 'Sessão de teste' }),
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js',
      'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js',
      (win) => {
        win.nexusSupabase = null;
        win.NEXUS_CONFIG = { SUPABASE_URL: 'https://teste.supabase.co', SUPABASE_ANON_KEY: ANON };
        win.fetch = fetchFalso;
        win.mostrarFeedback = (tipo, titulo, mensagem) => feedbacks.push({ tipo, titulo, mensagem });
        win.registrarLogAlteracao = async (entidade, tipo, detalhes) => logs.push({ entidade, tipo, detalhes });
        win.URL.createObjectURL = () => 'blob:teste';
        win.URL.revokeObjectURL = () => {};
        win.HTMLAnchorElement.prototype.click = function clique() { downloads.push(this.download); };
      },
      'js/data-repository.js', 'js/pages/relatorios.js'
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);
  await aguardar(150);

  const emitir = w.nexusRelatorioGerarPdf;
  check('relatorios expõe nexusRelatorioGerarPdf (WebMCP usa esta função)', typeof emitir === 'function');

  const semSupabase = await emitir(ID_CARGA, { origem: 'teste' });
  check('sem Supabase: não chama a função e avisa', semSupabase === false && chamadas.length === 0
    && feedbacks.some((f) => f.tipo === 'erro' && /conexão|Supabase/i.test(f.mensagem)), JSON.stringify(feedbacks.slice(-1)));

  w.nexusSupabase = cliente;
  const invalido = await emitir('QR-123');
  check('identificador que não é UUID: falha antes da rede', invalido === false && chamadas.length === 0);

  respostaFetch = new Response(new Uint8Array([37, 80, 68, 70, 45]), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'X-Relatorio-Cache': 'HIT' }
  });
  const ok = await emitir(ID_CARGA, { origem: 'tela' });
  const chamada = chamadas[0];
  check('chama a função com POST, JSON e a chave anon', ok === true && chamadas.length === 1
    && chamada.url === 'https://teste.supabase.co/functions/v1/relatorio-pdf'
    && chamada.opcoes.method === 'POST' && chamada.opcoes.headers.apikey === ANON,
    chamada && JSON.stringify(chamada.opcoes && chamada.opcoes.headers));
  const corpo = chamada && JSON.parse(chamada.opcoes.body);
  check('envia só carga_id e codigo_individual (sem valores do relatório)',
    corpo && corpo.carga_id === ID_CARGA && corpo.codigo_individual === 'NX-SES-1' && Object.keys(corpo).length === 2,
    JSON.stringify(corpo));
  check('baixa o arquivo com o nome do relatório', downloads.includes(`Relatorio_A4_${ID_CARGA}.pdf`), JSON.stringify(downloads));
  check('registra a exportação na auditoria: tipo EXPORTACAO, entidade = carga, código (não o nome da sessão)',
    logs.some((l) => l.tipo === 'EXPORTACAO' && l.entidade === ID_CARGA && l.detalhes
      && l.detalhes.exportado_por_codigo === 'NX-SES-1' && !JSON.stringify(l.detalhes).includes('Sessão de teste')),
    JSON.stringify(logs));

  respostaFetch = new Response(JSON.stringify({ erro: 'Acesso negado para emitir este relatório.' }), {
    status: 403, headers: { 'Content-Type': 'application/json' }
  });
  feedbacks.length = 0;
  const negado = await emitir(ID_CARGA);
  check('403 do servidor: retorna false e mostra a mensagem do servidor',
    negado === false && feedbacks.some((f) => f.tipo === 'erro' && /Acesso negado/.test(f.mensagem)), JSON.stringify(feedbacks));

  respostaFetch = new Error('Failed to fetch');
  feedbacks.length = 0;
  const rede = await emitir(ID_CARGA);
  check('falha de rede: retorna false com aviso', rede === false && feedbacks.some((f) => f.tipo === 'erro'));

  const webmcp = read('js/webmcp/webmcp-relatorios.js');
  check('ferramenta WebMCP trata falha do PDF (não diz "gerado" quando falhou)',
    /const\s+\w+\s*=\s*await\s+window\.nexusRelatorioGerarPdf/.test(webmcp) && /FALHA_PDF/.test(webmcp));
}

/** Ferramenta WebMCP gerar_relatorio_carga: tem de dizer "falhou" quando o PDF não foi emitido. */
async function testarFerramentaWebMCP() {
  log('\n[8] Ferramenta WebMCP: falha de emissão não vira sucesso');
  const chamadas = [];
  const cliente = { from() { const q = { select() { return q; }, order() { return q; }, eq() { return q; }, or() { return q; }, async maybeSingle() { return { data: null, error: null }; }, then(r) { return r({ data: [], error: null }); } }; return q; }, channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {} };
  const { dom, w } = criarJanela({
    url: 'https://nexusport.test/relatorios.html',
    html: htmlDaPagina('relatorios.html'),
    session: sessao('DIRETOR_OPERACOES_LOGISTICA', { codigo_individual: 'NX-SES-2', nome: 'Sessão WebMCP' }),
    storage: { nexus_cargas_fluxo: [{ id: 'CRG-A', tipo: 'Geral', peso: '12 t', volume: '20 m³', valor: 'R$ 1.000,00', natureza: 'Geral', status: 'ARMAZENAGEM', portoDescarga: 'Pátio STS-01 (Setor B)', container: '', navio: '', destino: '', rawDbId: undefined }] },
    scripts: [
      'js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/pages/tipos-carga.js',
      'js/vision-layer.js', 'js/layout.js', 'js/supabase-client.js',
      (win) => {
        win.nexusSupabase = null;
        win.NEXUS_CONFIG = { SUPABASE_URL: 'https://teste.supabase.co', SUPABASE_ANON_KEY: ANON };
        win.fetch = async (url) => { chamadas.push(String(url)); return new Response('{}', { status: 500 }); };
        win.mostrarFeedback = () => {};
      },
      'js/data-repository.js', 'js/pages/relatorios.js',
      'js/webmcp/webmcp-core.js',
      (win) => { win.NexusWebMCP.iniciar({ confirmar: async () => true }); },
      'js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js',
      'js/webmcp/webmcp-relatorios.js'
    ]
  });
  janelasAbertas.push(dom.window);
  await prontoDom(w);
  await aguardar(120);
  const r = await w.NexusWebMCP.executar('gerar_relatorio_carga', { id: 'CRG-A' });
  check('carga sem registro no banco: a ferramenta responde ok=false com FALHA_PDF',
    r && r.ok === false && r.codigo === 'FALHA_PDF', JSON.stringify(r).slice(0, 200));
  check('sem UUID, nenhuma chamada ao servidor do PDF', chamadas.length === 0, chamadas.join(', '));
}

(async function main() {
  log('\n=== PDF do relatório no servidor com cache (Backlog 3 — B) ===');
  // Módulos da função são ES modules (também rodam no Deno); pdf-lib é a mesma versão da função.
  relatorio = await import(path.join(ROOT, PASTA, 'relatorio.js'));
  pdf = await import(path.join(ROOT, PASTA, 'pdf.js'));
  ({ criarHandler } = await import(path.join(ROOT, PASTA, 'handler.js')));
  pdfLib = require('pdf-lib');
  try {
    testarModeloEFormatacao();
    await testarHash();
    testarSecoes();
    await testarPdf();
    await testarHandler();
    testarConfiguracao();
    await testarCliente();
    await testarFerramentaWebMCP();
  } catch (erro) {
    check('execução sem exceções', false, erro && erro.stack ? erro.stack.split('\n').slice(0, 3).join(' | ') : String(erro));
  } finally {
    janelasAbertas.forEach((janela) => { try { janela.close(); } catch (e) { /* já fechada */ } });
  }
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})();
