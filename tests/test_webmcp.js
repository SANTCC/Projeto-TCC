/**
 * Teste de Verificação — WebMCP: núcleo, polyfill, segurança, painel e catálogo.
 *
 * Cobre (sem depender de rede nem de Supabase):
 *   - catálogo estático de todas as páginas (nomes, limites de texto, anotações, cargos);
 *   - API nativa preferida, adaptador legado, polyfill e contexto inseguro;
 *   - validação da API (nomes, duplicidade, cancelamento, executeTool, getTools, eventos);
 *   - RBAC no registro e na execução, chave de desligamento, emergência;
 *   - validação estrita de argumentos, confirmação humana (fail-closed), revalidação;
 *   - higienização de saídas (sem códigos/tokens/CPF), limite de tamanho, taxa, falhas;
 *   - painel e diálogo de confirmação (eventos sintéticos NÃO confirmam);
 *   - servidor MCP (JSON-RPC) e formulários declarativos (sem envio automático).
 *
 * Executar: node tests/test_webmcp.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, read, htmlDaPagina } = H;

const SCRIPTS_NUCLEO = ['js/security.js', 'js/session-cookies.js', 'js/auth-guard.js', 'js/webmcp/webmcp-core.js'];
const PAGINAS = [
  'cargas.html', 'dashboard.html', 'embarcacoes.html', 'inspecao.html', 'manutencao.html', 'delegacao.html',
  'tecnico_portos.html', 'relatorios.html', 'scanner.html', 'index.html', 'confirm-role.html', 'teste-vibracao.html'
];

// Silencia avisos esperados das validações negativas (os testes verificam o resultado).
async function silenciar(fn) {
  const originais = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originais.warn;
    console.error = originais.error;
    console.info = originais.info;
    console.log = originais.log;
  }
}

/**
 * Janela com núcleo carregado. Por padrão injeta um provedor de confirmação que responde
 * `resposta` (booleano ou função). Com `semProvedor: true`, inicializa SEM provedor.
 */
function janelaNucleo(opcoes) {
  const o = opcoes || {};
  const registro = { pedidos: [], resposta: o.resposta === undefined ? true : o.resposta };
  const janela = criarJanela({
    url: o.url || 'https://nexusport.test/dashboard.html',
    session: o.session === undefined ? sessao('SUPERVISOR_GERENTE_OPERACOES') : o.session,
    storage: o.storage || {},
    native: o.native,
    secure: o.secure,
    scripts: SCRIPTS_NUCLEO.concat(o.extras || []).concat([(w) => {
      if (o.semProvedor) {
        w.NexusWebMCP.iniciar({});
        return;
      }
      w.NexusWebMCP.iniciar({
        confirmar: async (pedido) => {
          registro.pedidos.push(pedido);
          return typeof registro.resposta === 'function' ? registro.resposta(pedido) : registro.resposta;
        }
      });
    }])
  });
  return { w: janela.w, registro };
}

function pagina(w, id, ferramentas, arquivo) {
  w.NexusWebMCP.registrarPagina({ id, arquivo: arquivo === undefined ? 'dashboard.html' : arquivo, ferramentas });
}

const ESQ_TEXTO = { type: 'object', properties: { texto: { type: 'string', maxLength: 50, rotulo: 'Texto', description: 'Texto de teste.' } }, additionalProperties: false };

function adaptadorDaPagina(pag) {
  const mapa = {
    'cargas.html': 'cargas', 'dashboard.html': 'dashboard', 'embarcacoes.html': 'embarcacoes', 'inspecao.html': 'inspecao',
    'manutencao.html': 'manutencao', 'delegacao.html': 'delegacao', 'tecnico_portos.html': 'tecnico',
    'relatorios.html': 'relatorios', 'scanner.html': 'scanner'
  };
  if (pag === 'teste-vibracao.html') return ['js/webmcp/webmcp-vibracao.js'];
  if (mapa[pag]) return ['js/webmcp/webmcp-' + mapa[pag] + '.js'];
  return [];
}

// ------------------------------------------------------------------
// 1. Catálogo estático e higiene do código
// ------------------------------------------------------------------
async function secaoEstatica() {
  log('\n[1] Catálogo e higiene estática');
  const fs = require('fs');
  const arquivos = fs.readdirSync(H.ROOT + '/js/webmcp').filter((f) => f.startsWith('webmcp-') && f.endsWith('.js')).map((f) => 'js/webmcp/' + f);
  check('há módulos WebMCP em js/webmcp/ (núcleo, UI, dados, global e adaptadores)', arquivos.length >= 13, `encontrados: ${arquivos.length}`);

  let semInner = true;
  let semEval = true;
  let semLocal = true;
  let semHttp = true;
  let semCodigoIndividual = true;
  arquivos.forEach((f) => {
    const src = read(f);
    if (/\.innerHTML\s*[+]?=|insertAdjacentHTML|outerHTML\s*=/.test(src)) semInner = false;
    if (/\beval\s*\(|new\s+Function\s*\(/.test(src)) semEval = false;
    if (/localhost|127\.0\.0\.1/.test(src)) semLocal = false;
    if (/http:\/\//.test(src)) semHttp = false;
    // O identificador do código individual só pode aparecer na lista de ocultação do núcleo.
    if (f !== 'js/webmcp/webmcp-core.js' && /codigo_individual/.test(src)) semCodigoIndividual = false;
  });
  check('módulos WebMCP não usam innerHTML/insertAdjacentHTML (DOM API e textContent)', semInner);
  check('módulos WebMCP não usam eval nem new Function', semEval);
  check('módulos WebMCP não chamam localhost/127.0.0.1 (regra do projeto)', semLocal);
  check('módulos WebMCP não usam http:// (apenas HTTPS)', semHttp);
  check('código individual só é citado no núcleo (lista de ocultação), nunca nos adaptadores', semCodigoIndividual);

  const nucleo = read('js/webmcp/webmcp-core.js');
  check('núcleo não faz requisições de rede (sem fetch/XMLHttpRequest)', !/\bfetch\s*\(|XMLHttpRequest/.test(nucleo));
  check('polyfill sem dependências externas (sem require/import/CDN no núcleo)', !/\brequire\s*\(|^import\s/m.test(nucleo) && !/cdn\./i.test(nucleo));

  const nomesDistintos = new Set();
  for (const pag of PAGINAS) {
    const janela = criarJanela({
      url: `https://nexusport.test/${pag}`,
      html: htmlDaPagina(pag),
      session: sessao('DIRETOR_PRESIDENTE_SUPERINTENDENTE'),
      storage: {},
      scripts: SCRIPTS_NUCLEO.concat(['js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js'], adaptadorDaPagina(pag))
    });
    const w = janela.w;
    w.NexusWebMCP.iniciar({});
    await prontoDom(w);
    await aguardar(40);
    const itens = w.NexusWebMCP.ferramentas();
    const nomes = itens.map((t) => t.nome);
    check(`[${pag}] nomes de ferramenta únicos na página`, new Set(nomes).size === nomes.length);
    check(`[${pag}] há ferramentas declaradas no catálogo`, itens.length >= 1, `itens: ${itens.length}`);
    let nomesOk = true;
    let descOk = true;
    let paramOk = true;
    let anotOk = true;
    let privOk = true;
    let cargoOk = true;
    itens.forEach((t) => {
      nomesDistintos.add(t.nome);
      if (!/^[a-z][a-z0-9_]{1,29}$/.test(t.nome)) nomesOk = false;
      if (!t.titulo || t.titulo.length > 80 || !t.descricao || t.descricao.length > 500) descOk = false;
      if (t.anotacoes.readOnlyHint && t.anotacoes.consequentialHint) anotOk = false;
      if (t.anotacoes.consequentialHint && (!t.cargos || t.cargos.length === 0) && !t.permissao) cargoOk = false;
      Object.keys((t.esquema && t.esquema.properties) || {}).forEach((k) => {
        const prop = t.esquema.properties[k];
        if (prop.description && prop.description.length > 150) paramOk = false;
        if (/^(cpf|documento|codigo_individual|senha|token|data_nascimento|rg)$/i.test(k)) privOk = false;
      });
    });
    check(`[${pag}] nomes em snake_case ASCII de até 30 caracteres`, nomesOk);
    check(`[${pag}] títulos ≤ 80 e descrições ≤ 500 caracteres`, descOk);
    check(`[${pag}] descrições de parâmetros ≤ 150 caracteres`, paramOk);
    check(`[${pag}] nenhuma ferramenta é ao mesmo tempo somente leitura e consequente`, anotOk);
    check(`[${pag}] ações consequentes têm cargos ou permissão definidos`, cargoOk);
    check(`[${pag}] nenhum parâmetro pede dado pessoal (CPF, documento, senha, código)`, privOk);
    w.close();
  }
  check('catálogo completo tem ao menos 50 ferramentas distintas', nomesDistintos.size >= 50, `nomes distintos: ${nomesDistintos.size}`);
}

// ------------------------------------------------------------------
// 2. Núcleo: modos de API, RBAC, desligamento, validação, confirmação
// ------------------------------------------------------------------
async function secaoNucleo() {
  log('\n[2] Núcleo: modo da API, registro, RBAC e chave de desligamento');

  // 2.1 Polyfill quando não há API nativa
  let { w, registro } = janelaNucleo();
  check('sem API nativa: modo "polyfill"', w.NexusWebMCP.modo() === 'polyfill', w.NexusWebMCP.modo());
  check('polyfill expõe document.modelContext, navigator.modelContext e window.modelContext',
    typeof w.document.modelContext.registerTool === 'function' && typeof w.navigator.modelContext.registerTool === 'function'
    && typeof w.modelContext.registerTool === 'function');
  check('document.modelContext, navigator.modelContext e window.modelContext apontam para o mesmo motor',
    w.document.modelContext === w.navigator.modelContext && w.navigator.modelContext === w.modelContext);
  w.close();

  // 2.2 API nativa tem precedência (não é sobrescrita)
  const nativa = { registros: [] };
  const nativoFn = (win) => {
    win.__nativa = { marca: 'nativa' };
    win.document.modelContext = {
      marca: 'nativa',
      registerTool(tool) { nativa.registros.push(tool.name); return Promise.resolve(); },
      getTools() { return Promise.resolve([]); },
      executeTool() { return Promise.resolve('"nativo"'); }
    };
  };
  ({ w, registro } = janelaNucleo({ native: nativoFn }));
  check('API nativa presente: modo "nativo"', w.NexusWebMCP.modo() === 'nativo', w.NexusWebMCP.modo());
  check('API nativa não é sobrescrita pelo polyfill', w.document.modelContext.marca === 'nativa');
  pagina(w, 'nat', [{ nome: 'nativa_teste', titulo: 'Nativa', descricao: 'Registro na API nativa.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) }]);
  await aguardar(10);
  check('ferramentas são registradas na API nativa', nativa.registros.includes('nativa_teste'), `registradas: ${nativa.registros.join(',')}`);
  w.close();

  // 2.3 API legada (navigator.modelContext)
  const legado = { registros: [] };
  const legadoFn = (win) => {
    Object.defineProperty(win.navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool) { legado.registros.push(tool.name); },
        unregisterTool() {}
      }
    });
  };
  ({ w } = janelaNucleo({ native: legadoFn }));
  check('navigator.modelContext legado: modo "legado" (adaptador)', w.NexusWebMCP.modo() === 'legado', w.NexusWebMCP.modo());
  pagina(w, 'leg', [{ nome: 'legado_teste', titulo: 'Legado', descricao: 'Registro legado.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) }]);
  await aguardar(10);
  check('adaptador legado encaminha o registro ao navegador', legado.registros.includes('legado_teste'), `encaminhadas: ${legado.registros.join(',')}`);
  w.close();

  // 2.4 Contexto inseguro (HTTP): indisponível, sem polyfill
  ({ w } = janelaNucleo({ secure: false }));
  check('contexto não seguro: modo "indisponivel" e sem document.modelContext',
    w.NexusWebMCP.modo() === 'indisponivel' && typeof w.document.modelContext === 'undefined');
  w.close();

  // 2.5 Registro com RBAC
  ({ w, registro } = janelaNucleo({ session: sessao('ESTIVADOR') }));
  pagina(w, 'teste', [
    { nome: 'so_inspetor', titulo: 'Só inspetor', descricao: 'Teste de cargo.', anotacoes: { readOnlyHint: true }, cargos: ['INSPETOR'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) },
    { nome: 'so_estivador', titulo: 'Só estivador', descricao: 'Teste de cargo.', anotacoes: { readOnlyHint: true }, cargos: ['ESTIVADOR'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) },
    { nome: 'ler_publica', titulo: 'Pública', descricao: 'Sem sessão.', anotacoes: { readOnlyHint: true }, publica: true, esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'pública' }) }
  ]);
  const ativasEstivador = w.NexusWebMCP.ativas();
  check('RBAC: ferramenta do estivador aparece para o estivador', ativasEstivador.includes('so_estivador'));
  check('RBAC: ferramenta do inspetor NÃO aparece para o estivador', !ativasEstivador.includes('so_inspetor'));
  check('ferramenta pública aparece mesmo sem cargo', ativasEstivador.includes('ler_publica'));

  // 2.6 Troca de sessão + sincronização retira ferramentas sem permissão
  w.document.cookie = 'nexus_session=' + encodeURIComponent(JSON.stringify(sessao('INSPETOR'))) + '; path=/';
  w.NexusWebMCP.sincronizar();
  await aguardar(20);
  check('após mudança de sessão: ferramenta do estivador é retirada', !w.NexusWebMCP.ativas().includes('so_estivador'));
  check('após mudança de sessão: ferramenta do inspetor é registrada', w.NexusWebMCP.ativas().includes('so_inspetor'));

  // 2.7 Execução também é recusada (defesa em profundidade)
  const r1 = await w.NexusWebMCP.executar('so_estivador', { texto: 'x' });
  check('execução revalida o cargo: ferramenta fora do cargo é negada', r1.ok === false && r1.codigo === 'PERMISSAO_NEGADA', JSON.stringify(r1));

  // 2.8 Chave de desligamento (por navegador)
  w.NexusWebMCP.definirAtivo(false);
  await aguardar(20);
  check('chave de desligamento: nenhuma ferramenta registrada', w.NexusWebMCP.ativas().length === 0, `ativas: ${w.NexusWebMCP.ativas().join(',')}`);
  const r2 = await w.NexusWebMCP.executar('ler_publica', { texto: 'x' });
  check('chave desligada: execução devolve DESATIVADO', r2.codigo === 'DESATIVADO', JSON.stringify(r2));
  w.NexusWebMCP.definirAtivo(true);
  await aguardar(20);
  check('chave religada: ferramentas voltam', w.NexusWebMCP.ativas().includes('ler_publica'));
  w.close();

  // 2.9 Validação estrita de argumentos
  ({ w } = janelaNucleo());
  pagina(w, 'val', [{
    nome: 'validar_teste', titulo: 'Validar', descricao: 'Valida entradas.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'],
    esquema: {
      type: 'object',
      properties: {
        nome: { type: 'string', minLength: 2, maxLength: 10, rotulo: 'Nome', description: 'Nome.' },
        numero: { type: 'integer', minimum: 1, maximum: 5, rotulo: 'Número', description: 'Número.' },
        modo: { type: 'string', enum: ['A', 'B'], rotulo: 'Modo', description: 'Modo.' },
        data: { type: 'string', format: 'date', rotulo: 'Data', description: 'Data.' },
        lista: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 5 }, rotulo: 'Lista', description: 'Lista.' }
      },
      required: ['nome'],
      additionalProperties: false
    },
    executar: (args) => ({ mensagem: 'ok', dados: args })
  }]);
  const casos = [
    ['campo extra é recusado', { nome: 'ab', extra: 1 }, false],
    ['campo obrigatório ausente é recusado', { numero: 2 }, false],
    ['texto curto demais é recusado', { nome: 'a' }, false],
    ['texto acima do limite é recusado', { nome: 'abcdefghijk' }, false],
    ['número fora do intervalo é recusado', { nome: 'ab', numero: 9 }, false],
    ['número como texto válido é aceito (coerção segura)', { nome: 'ab', numero: '3' }, true],
    ['texto que não é número é recusado', { nome: 'ab', numero: 'três' }, false],
    ['valor fora do enum é recusado', { nome: 'ab', modo: 'C' }, false],
    ['data inválida (30 de fevereiro) é recusada', { nome: 'ab', data: '2026-02-30' }, false],
    ['data válida é aceita', { nome: 'ab', data: '2026-10-08' }, true],
    ['caractere de controle é recusado', { nome: 'a\u0007b' }, false],
    ['lista acima de maxItems é recusada', { nome: 'ab', lista: ['a', 'b', 'c'] }, false],
    ['chave __proto__ é recusada', JSON.parse('{"nome":"ab","__proto__":{"x":1}}'), false],
    ['payload acima de 4 KB é recusado', { nome: 'ab', texto: 'z'.repeat(5000) }, false]
  ];
  for (const [rotulo, entrada, esperado] of casos) {
    const r = await silenciar(() => w.NexusWebMCP.executar('validar_teste', entrada));
    check(`validação: ${rotulo}`, (r.ok === true) === esperado, JSON.stringify(r).slice(0, 160));
  }
  const rBrancos = await w.NexusWebMCP.executar('validar_teste', { nome: '  ab  ' });
  check('texto com espaços nas bordas é normalizado (trim)', rBrancos.ok && rBrancos.dados.nome === 'ab', JSON.stringify(rBrancos));
  w.close();

  // 2.10 Confirmação humana: fail-closed, recusa, aceite e revalidação
  let execucoes = 0;
  ({ w, registro } = janelaNucleo({ resposta: false }));
  pagina(w, 'conf', [{
    nome: 'acao_teste', titulo: 'Ação de teste', descricao: 'Consequente.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'],
    esquema: ESQ_TEXTO,
    resumo: (args) => [`Executar com ${args.texto}`],
    executar: () => { execucoes += 1; return { mensagem: 'feito' }; }
  }]);
  let r = await w.NexusWebMCP.executar('acao_teste', { texto: 'alfa' });
  check('confirmação recusada: CANCELADO_PELO_OPERADOR e nada executado', r.codigo === 'CANCELADO_PELO_OPERADOR' && execucoes === 0, JSON.stringify(r));
  check('pedido de confirmação traz o resumo e os argumentos',
    registro.pedidos.length === 1 && registro.pedidos[0].resumo[0] === 'Executar com alfa' && registro.pedidos[0].argumentos[0].valor === 'alfa');
  registro.resposta = true;
  r = await w.NexusWebMCP.executar('acao_teste', { texto: 'beta' });
  check('confirmação aceita: executa exatamente uma vez', r.ok === true && execucoes === 1, JSON.stringify(r));
  w.close();

  ({ w } = janelaNucleo({ semProvedor: true }));
  let semProvedor = 0;
  pagina(w, 'conf2', [{
    nome: 'acao_sem_provedor', titulo: 'Sem provedor', descricao: 'Consequente.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'],
    esquema: ESQ_TEXTO, executar: () => { semProvedor += 1; return { mensagem: 'x' }; }
  }]);
  r = await w.NexusWebMCP.executar('acao_sem_provedor', { texto: 'x' });
  check('sem provedor de confirmação: NEGA (fail-closed)', r.codigo === 'CANCELADO_PELO_OPERADOR' && semProvedor === 0, JSON.stringify(r));
  w.close();

  ({ w, registro } = janelaNucleo({ resposta: true }));
  pagina(w, 'pre', [{
    nome: 'acao_precondicao', titulo: 'Pré-condição', descricao: 'Consequente.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'],
    esquema: ESQ_TEXTO,
    precondicao: () => ({ codigo: 'ESTADO_INVALIDO', mensagem: 'Estado não permite.' }),
    executar: () => ({ mensagem: 'não deveria' })
  }]);
  r = await w.NexusWebMCP.executar('acao_precondicao', { texto: 'x' });
  check('pré-condição falha: não pede confirmação e informa o motivo', r.codigo === 'ESTADO_INVALIDO' && registro.pedidos.length === 0, JSON.stringify(r));
  w.close();

  // Revalidação: o estado muda durante a confirmação
  let estado = 'ABERTO';
  ({ w } = janelaNucleo({ resposta: () => { estado = 'FECHADO'; return true; } }));
  let rodou = 0;
  pagina(w, 'reval', [{
    nome: 'acao_reval', titulo: 'Revalidação', descricao: 'Consequente.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'],
    esquema: ESQ_TEXTO,
    precondicao: () => (estado === 'ABERTO' ? null : { codigo: 'ESTADO_INVALIDO', mensagem: 'Mudou durante a confirmação.' }),
    executar: () => { rodou += 1; return { mensagem: 'x' }; }
  }]);
  r = await w.NexusWebMCP.executar('acao_reval', { texto: 'x' });
  check('estado muda durante a confirmação: revalida e NÃO executa', r.codigo === 'ESTADO_INVALIDO' && rodou === 0, JSON.stringify(r));
  w.close();

  // 2.11 Emergência bloqueia ações marcadas e não bloqueia leituras
  ({ w } = janelaNucleo({ resposta: true }));
  w.nexusEmergenciaAtiva = () => true;
  pagina(w, 'emerg', [
    { nome: 'acao_bloqueada', titulo: 'Bloqueada', descricao: 'Bloqueia em emergência.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], bloqueiaEmergencia: true, esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'x' }) },
    { nome: 'leitura_ok', titulo: 'Leitura', descricao: 'Permitida.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'lido' }) }
  ]);
  r = await w.NexusWebMCP.executar('acao_bloqueada', { texto: 'x' });
  check('emergência ativa: ação bloqueada devolve EMERGENCIA_ATIVA', r.codigo === 'EMERGENCIA_ATIVA', JSON.stringify(r));
  r = await w.NexusWebMCP.executar('leitura_ok', { texto: 'x' });
  check('emergência ativa: leituras continuam disponíveis', r.ok === true);
  w.close();

  // 2.12 Saídas: higienização, limite, falhas, feedback e marca de auditoria
  ({ w } = janelaNucleo());
  w.mostrarFeedback = () => {};
  let marcaDentro = null;
  pagina(w, 'saida', [
    {
      nome: 'saida_suja', titulo: 'Saída suja', descricao: 'Retorna dados sensíveis.', anotacoes: { readOnlyHint: true, untrustedContentHint: true },
      cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO,
      executar: () => ({
        mensagem: 'ok',
        dados: {
          nome: 'Ana', codigo_individual: 'NX-1234-SP', token: 'segredo', senha: '1234',
          texto: 'chave eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123xyz_-0 e CPF 123.456.789-09 aqui',
          aninhado: { codigo: 'XYZ', documento: '999' }
        }
      })
    },
    {
      nome: 'saida_grande', titulo: 'Saída grande', descricao: 'Lista longa.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO,
      executar: () => ({ mensagem: 'muitos', dados: { itens: Array.from({ length: 300 }, (_, i) => ({ id: `CRG-${i}`, descricao: 'x'.repeat(120) })) } })
    },
    {
      nome: 'saida_erro', titulo: 'Erro', descricao: 'Lança exceção.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO,
      executar: () => { throw new Error('detalhe interno secreto NX-9999-SP'); }
    },
    {
      nome: 'saida_feedback', titulo: 'Feedback', descricao: 'Mostra mensagem.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO,
      executar: () => { w.mostrarFeedback('sucesso', 'Título', 'Mensagem capturada'); return { mensagem: 'ok' }; }
    },
    {
      nome: 'saida_marca', titulo: 'Marca', descricao: 'Verifica marca de auditoria.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO,
      resumo: () => ['marca'],
      executar: () => { marcaDentro = w.NexusWebMCP.marcaAuditoria(); return { mensagem: 'marca' }; }
    }
  ]);
  r = await w.NexusWebMCP.executar('saida_suja', { texto: 'x' });
  const json = JSON.stringify(r);
  check('saída: códigos e tokens são removidos', !/NX-1234-SP|segredo|"senha"|codigo_individual|"token"|"documento"/.test(json), json.slice(0, 300));
  check('saída: CPF formatado é mascarado', !/123\.456\.789-09/.test(json) && /\*\*\*\.\*\*\*\.\*\*\*-\*\*/.test(json));
  check('saída: token JWT é ocultado no texto', !/eyJhbGciOiJIUzI1NiJ9/.test(json) && /\[token ocultado\]/.test(json));
  check('saída de conteúdo externo traz aviso de conteúdo não confiável', typeof r.aviso === 'string' && r.aviso.length > 10);
  r = await w.NexusWebMCP.executar('saida_grande', { texto: 'x' });
  check('saída grande: limitada a 6000 caracteres e marcada como truncada', JSON.stringify(r).length <= 6000 && r.truncado === true, `tamanho: ${JSON.stringify(r).length}`);
  r = await silenciar(() => w.NexusWebMCP.executar('saida_erro', { texto: 'x' }));
  check('exceção do handler vira ERRO_EXECUCAO sem vazar o detalhe interno',
    r.codigo === 'ERRO_EXECUCAO' && !/secreto|NX-9999/.test(JSON.stringify(r)), JSON.stringify(r));
  r = await w.NexusWebMCP.executar('saida_feedback', { texto: 'x' });
  check('mensagens de feedback da página voltam no resultado da ferramenta',
    Array.isArray(r.feedback) && r.feedback[0].mensagem === 'Mensagem capturada', JSON.stringify(r.feedback));
  check('marca de auditoria vazia fora de uma execução', w.NexusWebMCP.marcaAuditoria() === '');
  await w.NexusWebMCP.executar('saida_marca', { texto: 'x' });
  check('marca de auditoria durante ação consequente identifica a ferramenta',
    marcaDentro === '[Agente WebMCP: saida_marca] ', `marca: ${marcaDentro}`);
  w.close();

  // 2.13 Taxa de chamadas
  ({ w } = janelaNucleo());
  pagina(w, 'taxa', [
    { nome: 'taxa_leitura', titulo: 'Taxa', descricao: 'Leitura.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) },
    { nome: 'taxa_acao', titulo: 'Taxa ação', descricao: 'Ação.', anotacoes: { consequentialHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) }
  ]);
  let limitou = false;
  for (let i = 0; i < 32; i += 1) {
    const rr = await w.NexusWebMCP.executar('taxa_leitura', { texto: 'x' });
    if (rr.codigo === 'LIMITE_EXCEDIDO') limitou = true;
  }
  check('taxa: a partir de 31 chamadas por minuto a ferramenta é limitada', limitou);
  let limitouAcao = false;
  for (let i = 0; i < 8; i += 1) {
    const rr = await w.NexusWebMCP.executar('taxa_acao', { texto: 'x' });
    if (rr.codigo === 'LIMITE_EXCEDIDO') limitouAcao = true;
  }
  check('taxa: ações consequentes têm limite mais baixo (6 por minuto)', limitouAcao);
  w.close();

  // 2.14 Atividade sem valores de argumentos
  ({ w } = janelaNucleo());
  pagina(w, 'ativ', [{ nome: 'ativ_teste', titulo: 'Atividade', descricao: 'Teste.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'ok' }) }]);
  await w.NexusWebMCP.executar('ativ_teste', { texto: 'VALOR-SENSIVEL-12345' });
  const atividade = w.NexusWebMCP.atividade();
  check('atividade registra a ferramenta e o código do resultado', atividade[0].ferramenta === 'ativ_teste' && atividade[0].codigo === 'OK');
  check('atividade não guarda valores de argumentos', !JSON.stringify(atividade).includes('VALOR-SENSIVEL'));
  w.close();
}

// ------------------------------------------------------------------
// 3. Polyfill da API (contrato W3C) e eventos
// ------------------------------------------------------------------
async function secaoPolyfill() {
  log('\n[3] Polyfill da API (document.modelContext)');
  const { w } = janelaNucleo({ session: sessao('SUPERVISOR_GERENTE_OPERACOES') });
  const mc = w.document.modelContext;
  const tool = (nome, extra) => Object.assign({ name: nome, description: 'Ferramenta de teste.', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ ok: 1 }) }, extra || {});

  const nomesInvalidos = ['com espaco', 'acentuação', 'x'.repeat(129), ''];
  for (const nome of nomesInvalidos) {
    const erro = await mc.registerTool(tool(nome)).then(() => null, (e) => e);
    check(`nome inválido recusado (${nome.length > 20 ? nome.slice(0, 12) + '…' : (nome || '(vazio)')})`, Boolean(erro) && erro.name === 'TypeError');
  }
  let erro = await mc.registerTool(tool('ok_descricao', { description: '   ' })).then(() => null, (e) => e);
  check('descrição vazia é recusada', Boolean(erro) && erro.name === 'TypeError');
  erro = await mc.registerTool(tool('ok_sem_execute', { execute: undefined })).then(() => null, (e) => e);
  check('execute ausente é recusado', Boolean(erro) && erro.name === 'TypeError');

  const controle = new w.AbortController();
  await mc.registerTool(tool('alfa.beta-1', { title: 'Alfa' }), { signal: controle.signal });
  erro = await mc.registerTool(tool('alfa.beta-1')).then(() => null, (e) => e);
  check('nome duplicado: InvalidStateError', erro && erro.name === 'InvalidStateError');
  const abortado = new w.AbortController();
  abortado.abort();
  erro = await mc.registerTool(tool('gama'), { signal: abortado.signal }).then(() => null, (e) => e);
  check('sinal já abortado: AbortError', erro && erro.name === 'AbortError');
  erro = await mc.registerTool(tool('delta'), { exposedTo: ['http://exemplo.invalido'] }).then(() => null, (e) => e);
  check('exposedTo com origem não segura: SecurityError', Boolean(erro) && erro.name === 'SecurityError');
  erro = await mc.registerTool(tool('epsilon'), { exposedTo: ['https://app.exemplo.invalido'] }).then(() => null, (e) => e);
  check('exposedTo com origem segura é aceito', erro === null);

  let mudancas = 0;
  mc.addEventListener('toolchange', () => { mudancas += 1; });
  await aguardar(5);
  const lista = await mc.getTools();
  check('getTools devolve as ferramentas com nome, descrição e esquema', lista.some((t) => t.name === 'alfa.beta-1' && t.description && t.inputSchema));
  check('getTools inclui window, origin e annotations', lista[0].window === w && typeof lista[0].origin === 'string' && typeof lista[0].annotations === 'object');
  controle.abort();
  await aguardar(5);
  const depois = await mc.getTools();
  check('abort do sinal remove a ferramenta', !depois.some((t) => t.name === 'alfa.beta-1'));
  check('remoção dispara o evento toolchange', mudancas >= 1, `mudanças: ${mudancas}`);

  mc.registerTool(tool('eco_teste', { execute: async (entrada) => ({ eco: entrada.msg }) }));
  const texto = await mc.executeTool('eco_teste', { msg: 'oi' });
  check('executeTool devolve o resultado serializado como texto JSON', typeof texto === 'string' && JSON.parse(texto).eco === 'oi');
  const naoEncontrada = await mc.executeTool('nao_existe', {}).then(() => null, (e) => e);
  check('executeTool de ferramenta inexistente: NotFoundError', naoEncontrada && naoEncontrada.name === 'NotFoundError');
  const dadoInvalido = await mc.executeTool('eco_teste', []).then(() => null, (e) => e);
  check('entrada que não é objeto: DataError', dadoInvalido && dadoInvalido.name === 'DataError');
  mc.registerTool(tool('quebra_teste', { execute: async () => { throw new Error('interno'); } }));
  const opError = await mc.executeTool('quebra_teste', {}).then(() => null, (e) => e);
  check('falha interna da ferramenta: OperationError sem detalhes', opError && opError.name === 'OperationError');
  check('ModelContext é um EventTarget (addEventListener/dispatchEvent)', typeof mc.addEventListener === 'function' && typeof mc.dispatchEvent === 'function');
  w.close();
}

// ------------------------------------------------------------------
// 4. Painel e diálogo de confirmação (eventos sintéticos não confirmam)
// ------------------------------------------------------------------
async function secaoUI() {
  log('\n[4] Painel "Agentes IA" e diálogo de confirmação');
  const janela = criarJanela({
    url: 'https://nexusport.test/cargas.html',
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {},
    scripts: SCRIPTS_NUCLEO.concat(['js/webmcp/webmcp-ui.js', 'js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js'])
  });
  const w = janela.w;
  await prontoDom(w);
  await aguardar(40);
  const botao = w.document.getElementById('nxmBotao');
  check('painel: botão "Agentes IA" montado com aria-controls', botao && botao.getAttribute('aria-controls') === 'nxmPainel');
  const painel = w.document.getElementById('nxmPainel');
  check('painel: começa fechado (hidden) e com role dialog', painel && painel.hidden === true && painel.getAttribute('role') === 'dialog');
  botao.click();
  check('painel: abre ao clicar no botão', painel.hidden === false && botao.getAttribute('aria-expanded') === 'true');
  check('painel: chave de desligamento reflete o estado atual', w.document.getElementById('nxmAtivo').checked === true);
  w.document.getElementById('nxmAtivo').click();
  check('painel: desligar pela chave remove as ferramentas da página', w.NexusWebMCP.ativo() === false && w.NexusWebMCP.ativas().length === 0);
  w.document.getElementById('nxmAtivo').click();
  check('painel: religar pela chave reativa as ferramentas', w.NexusWebMCP.ativo() === true && w.NexusWebMCP.ativas().length > 0);
  check('painel: mostra o modo da API em texto pt-BR', /Modo:/.test(w.document.getElementById('nxmModo').textContent));
  check('painel: lista ferramentas com estado (disponível ou motivo)', w.document.querySelectorAll('#nxmLista li').length > 1);
  painel.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check('painel: Esc fecha o painel', painel.hidden === true);

  // Diálogo de confirmação
  const UI = w.NexusWebMCPUI;
  const pedido = {
    ferramenta: { nome: 'acao_x', titulo: 'Ação X', descricao: 'Descrição', dadosNaoConfiaveis: true },
    pagina: 'cargas.html',
    argumentos: [{ rotulo: 'Texto', valor: '<img src=x onerror="alert(1)">' }],
    resumo: ['Linha 1'],
    prazoMs: 60000
  };
  let decidido = null;
  const p1 = UI.confirmar(pedido).then((v) => { decidido = v; });
  const caixa = w.document.querySelector('#nxmConfirmacao .nxm-caixa');
  check('confirmação: diálogo alertdialog modal com rótulos ligados', caixa && caixa.getAttribute('role') === 'alertdialog' && caixa.getAttribute('aria-modal') === 'true');
  check('confirmação: foco inicial no botão Cancelar', w.document.activeElement === w.document.getElementById('nxmConfCancelar'));
  check('confirmação: argumentos aparecem como texto (sem HTML injetado)',
    w.document.querySelector('#nxmConfirmacao dd').textContent === '<img src=x onerror="alert(1)">' && w.document.querySelector('#nxmConfirmacao img') === null);
  check('confirmação: aviso de dados não confiáveis exibido', /origem não confiável/.test(caixa.textContent));
  const confirmarBtn = w.document.getElementById('nxmConfConfirmar');
  check('confirmação: botão Confirmar começa desabilitado', confirmarBtn.disabled === true);
  confirmarBtn.click();
  await aguardar(20);
  check('clique sintético (script) NÃO confirma a ação', w.document.getElementById('nxmConfirmacao') !== null && decidido === null);
  await aguardar(1600);
  check('após o intervalo mínimo o botão Confirmar fica habilitado', confirmarBtn.disabled === false);
  confirmarBtn.click();
  await aguardar(20);
  check('clique sintético com botão habilitado ainda NÃO confirma (isTrusted false)', decidido === null);
  w.document.getElementById('nxmConfCancelar').click();
  await p1;
  check('cancelar resolve false e remove o diálogo', decidido === false && w.document.getElementById('nxmConfirmacao') === null);

  decidido = null;
  const p2 = UI.confirmar(pedido).then((v) => { decidido = v; });
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await p2;
  check('Esc cancela a confirmação', decidido === false);

  decidido = null;
  const p3 = UI.confirmar(Object.assign({}, pedido, { prazoMs: 1000 })).then((v) => { decidido = v; });
  await p3;
  check('prazo esgotado cancela automaticamente', decidido === false);

  const p4 = UI.confirmar(pedido);
  const p5 = UI.confirmar(pedido);
  check('segundo pedido enquanto há diálogo aberto é recusado', (await p5) === false);
  w.document.getElementById('nxmConfCancelar').click();
  await p4;

  const controle = new w.AbortController();
  decidido = null;
  const p6 = UI.confirmar(Object.assign({}, pedido, { signal: controle.signal })).then((v) => { decidido = v; });
  controle.abort();
  await p6;
  check('chamada abortada pelo agente fecha o diálogo sem confirmar', decidido === false && w.document.getElementById('nxmConfirmacao') === null);
  w.close();
}

// ------------------------------------------------------------------
// 5. Servidor MCP (JSON-RPC 2.0)
// ------------------------------------------------------------------
async function secaoMCP() {
  log('\n[5] Camada MCP (JSON-RPC: ferramentas, recursos e prompts)');
  const { w } = janelaNucleo({
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    extras: ['js/webmcp/webmcp-dados.js', 'js/webmcp/webmcp-global.js']
  });
  pagina(w, 'mcp', [
    { nome: 'mcp_leitura', titulo: 'Leitura MCP', descricao: 'Leitura.', anotacoes: { readOnlyHint: true }, cargos: ['SUPERVISOR_GERENTE_OPERACOES'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'lido', dados: { n: 1 } }) },
    { nome: 'mcp_so_inspetor', titulo: 'Só inspetor', descricao: 'Restrita.', anotacoes: { readOnlyHint: true }, cargos: ['INSPETOR'], esquema: ESQ_TEXTO, executar: () => ({ mensagem: 'x' }) }
  ]);
  await aguardar(20);
  const ini = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  check('initialize: versão de protocolo e capacidades de ferramentas', ini.result.protocolVersion === '2025-06-18' && ini.result.capabilities.tools !== undefined);
  const lista = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const nomes = lista.result.tools.map((t) => t.name);
  check('tools/list: mostra apenas as ferramentas permitidas ao cargo', nomes.includes('mcp_leitura') && !nomes.includes('mcp_so_inspetor'));
  const chamada = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mcp_leitura', arguments: { texto: 'x' } } });
  const conteudo = JSON.parse(chamada.result.content[0].text);
  check('tools/call: conteúdo texto com o resultado e isError=false', chamada.result.isError === false && conteudo.ok === true && conteudo.dados.n === 1);
  const negada = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mcp_so_inspetor', arguments: {} } });
  check('tools/call de ferramenta não permitida: erro JSON-RPC -32602', negada.error && negada.error.code === -32602);
  const semResposta = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('notificações não recebem resposta', semResposta === null);
  const metodo = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 5, method: 'metodo/inexistente' });
  check('método desconhecido: erro -32601', metodo.error && metodo.error.code === -32601);
  const invalida = await w.NexusWebMCP.mcp.tratar({ method: 'ping', id: 6 });
  check('mensagem sem jsonrpc 2.0: erro -32600', invalida.error && invalida.error.code === -32600);
  const recursos = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  check('resources/list: recursos nexus:// do projeto', recursos.result.resources.some((r) => r.uri === 'nexus://sessao'));
  const lido = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'nexus://sessao' } });
  check('resources/read: sessão sem código individual', lido.result && !/codigo_individual|NX-9001/.test(lido.result.contents[0].text));
  const desconhecido = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'nexus://nada' } });
  check('resources/read de recurso inexistente: erro -32002', desconhecido.error && desconhecido.error.code === -32002);
  const prompts = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 10, method: 'prompts/list' });
  check('prompts/list: prompts do projeto', prompts.result.prompts.some((p) => p.name === 'resumo_turno'));
  const prompt = await w.NexusWebMCP.mcp.tratar({ jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'resumo_turno' } });
  check('prompts/get: mensagem de usuário em texto', prompt.result.messages[0].content.type === 'text');
  w.close();
}

// ------------------------------------------------------------------
// 6. Formulários declarativos (sem envio automático)
// ------------------------------------------------------------------
async function secaoDeclarativo() {
  log('\n[6] API declarativa: formulário preenchido, nunca enviado pelo agente');
  const HTML = '<!doctype html><html><body><form id="f" class="hidden">'
    + '<input name="nome" required maxlength="40">'
    + '<input name="cpf" required>'
    + '<select name="cargo"><option value="">Selecione</option><option value="A">Alfa</option><option value="B">Beta</option></select>'
    + '<input name="inicio" type="datetime-local" required>'
    + '<button type="submit">Enviar</button></form></body></html>';
  let envios = 0;
  const shimPadrao = (win) => {
    win.document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); envios += 1; });
  };
  const janela = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: HTML,
    session: sessao('TECNICO_PORTOS'),
    storage: {},
    scripts: SCRIPTS_NUCLEO.concat([shimPadrao, (win) => win.NexusWebMCP.iniciar({})])
  });
  const w = janela.w;
  const form = w.document.getElementById('f');
  const def = w.NexusWebMCP.formularioComoFerramenta({
    nome: 'preencher_teste', titulo: 'Preencher', descricao: 'Preenche o formulário.', cargos: ['TECNICO_PORTOS'],
    elemento: form,
    campos: {
      nome: { descricao: 'Nome.', rotulo: 'Nome' },
      cargo: { descricao: 'Cargo.', rotulo: 'Cargo' },
      inicio: { descricao: 'Início.', rotulo: 'Início' }
    }
  });
  w.NexusWebMCP.registrarPagina({ id: 'decl', arquivo: 'tecnico_portos.html', ferramentas: [def] });
  check('formulário: ferramenta registrada para o cargo', w.NexusWebMCP.ativas().includes('preencher_teste'));
  const r = await w.NexusWebMCP.executar('preencher_teste', { nome: 'Carla', cargo: 'B', inicio: '2026-10-08T14:30' });
  check('formulário: preenche os campos declarados',
    r.ok === true && form.querySelector('[name="nome"]').value === 'Carla' && form.querySelector('[name="cargo"]').value === 'B'
    && form.querySelector('[name="inicio"]').value === '2026-10-08T14:30', JSON.stringify(r));
  check('formulário: CPF (não declarado) continua vazio', form.querySelector('[name="cpf"]').value === '');
  check('formulário: informa os campos que o operador deve completar',
    Array.isArray(r.dados.preencher_pelo_operador) && r.dados.preencher_pelo_operador.includes('cpf'), JSON.stringify(r.dados));
  check('formulário: NÃO envia o formulário', envios === 0, `envios: ${envios}`);
  check('formulário: ao preencher, o formulário fica visível', !form.classList.contains('hidden'));
  const inv = await w.NexusWebMCP.executar('preencher_teste', { nome: 'Carla', cargo: 'Gama' });
  check('formulário: valor fora das opções da tela é recusado', inv.ok === false && inv.codigo === 'ARGUMENTOS_INVALIDOS', JSON.stringify(inv));
  const dataInvalida = await w.NexusWebMCP.executar('preencher_teste', { nome: 'Carla', inicio: '2026-10-08 14:30' });
  check('formulário: data-hora fora do formato AAAA-MM-DDTHH:MM é recusada', dataInvalida.ok === false, JSON.stringify(dataInvalida));
  w.close();

  // API declarativa nativa: atributos apenas para quem pode usar; sem duplicação com o polyfill
  const nativa = { registrosImperativos: [] };
  const comNativa = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: HTML,
    session: sessao('TECNICO_PORTOS'),
    storage: {},
    native: (win) => {
      win.document.modelContext = {
        registerTool(tool) { nativa.registrosImperativos.push(tool.name); return Promise.resolve(); },
        // Simula o navegador: ferramentas declaradas por atributos já aparecem em getTools().
        getTools() {
          return Promise.resolve(Array.from(win.document.querySelectorAll('[toolname]')).map((el) => ({ name: el.getAttribute('toolname') })));
        },
        executeTool() { return Promise.resolve('null'); }
      };
    },
    scripts: SCRIPTS_NUCLEO.concat([(win) => {
      win.NexusWebMCP.iniciar({});
      const f = win.document.getElementById('f');
      const d = win.NexusWebMCP.formularioComoFerramenta({ nome: 'decl_nativa', titulo: 'T', descricao: 'D', cargos: ['TECNICO_PORTOS'], elemento: f, campos: { nome: { descricao: 'Nome.', rotulo: 'Nome' } } });
      win.NexusWebMCP.registrarPagina({ id: 'dn', arquivo: 'tecnico_portos.html', ferramentas: [d] });
    }])
  });
  await aguardar(40);
  const wn = comNativa.w;
  const formN = wn.document.getElementById('f');
  check('nativo: atributo toolname definido para quem pode usar', formN.getAttribute('toolname') === 'decl_nativa');
  check('nativo: nunca define toolautosubmit (o envio é sempre humano)', !formN.hasAttribute('toolautosubmit'));
  check('nativo: com suporte declarativo do navegador, não há registro imperativo duplicado',
    !nativa.registrosImperativos.includes('decl_nativa') && !wn.NexusWebMCP.ativas().includes('decl_nativa'),
    `imperativos: ${nativa.registrosImperativos.join(',')}`);
  wn.close();

  const semPermissao = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: HTML,
    session: sessao('DIRETOR_OPERACOES_LOGISTICA'),
    storage: {},
    native: (win) => { win.document.modelContext = { registerTool() { return Promise.resolve(); }, getTools() { return Promise.resolve([]); }, executeTool() { return Promise.resolve('null'); } }; },
    scripts: SCRIPTS_NUCLEO.concat([(win) => {
      win.NexusWebMCP.iniciar({});
      const f = win.document.getElementById('f');
      f.setAttribute('toolname', 'residuo');
      const d = win.NexusWebMCP.formularioComoFerramenta({ nome: 'decl_restrita', titulo: 'T', descricao: 'D', cargos: ['TECNICO_PORTOS'], elemento: f, campos: { nome: { descricao: 'Nome.', rotulo: 'Nome' } } });
      win.NexusWebMCP.registrarPagina({ id: 'dr', arquivo: 'tecnico_portos.html', ferramentas: [d] });
    }])
  });
  await aguardar(30);
  check('nativo: cargo sem permissão não recebe atributos declarativos (resíduo removido)',
    !semPermissao.w.document.getElementById('f').hasAttribute('toolname'));
  semPermissao.w.close();
}

async function principal() {
  log('=== WebMCP — núcleo, polyfill, segurança, painel e catálogo ===');
  await silenciar(async () => {
    await secaoEstatica();
    await secaoNucleo();
    await secaoPolyfill();
    await secaoUI();
    await secaoMCP();
    await secaoDeclarativo();
  });
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações WebMCP (núcleo) passaram.');
}

principal().catch((erro) => {
  process.stdout.write(`Erro inesperado no teste: ${erro && erro.stack ? erro.stack : erro}\n`);
  process.exit(1);
});
