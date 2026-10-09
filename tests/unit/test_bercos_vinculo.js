/**
 * Teste de Verificação — Vínculo Navio × Berço (public.bercos)
 *
 * Cobre o erro relatado em produção:
 *   23514: new row for relation "bercos" violates check constraint
 *          "bercos_vinculo_navio_check"
 *   DETAIL: Failing row contains (BERCO-06, Berço 06, OCUPADO, null, null, null, ...)
 *
 * Causa: uma linha "OCUPADO com navio_* nulos" (cache local legado, berço
 * ocupado por carga em versões antigas) ia para o upsert em lote de 15 berços
 * em js/pages/embarcacoes.js e derrubava a instrução inteira — nenhum berço era
 * sincronizado.
 *
 * O teste executa os módulos reais em DOM (jsdom) com um cliente Supabase
 * dublê e verifica que:
 *   1. `NexusSupabaseUtils.normalizarBerco` respeita as constraints
 *      `bercos_vinculo_navio_check` e `bercos_id_formato_check`;
 *   2. o lote enviado pela tela de Embarcações nunca contém linha inválida
 *      (Berço 06 legado OCUPADO é gravado como LIVRE e o restante do lote segue);
 *   3. berço OCUPADO com navio real preserva nome/IMO e descarta navio_id
 *      que não seja UUID de public.navios;
 *   4. o cache local é corrigido junto com o banco.
 *
 * Executar: node tests/test_bercos_vinculo.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const SECURITY_SRC = read('js/security.js');
const SUPABASE_CLIENT_SRC = read('js/supabase-client.js');
const EMBARCACOES_SRC = read('js/pages/embarcacoes.js');

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM; // devDependency do projeto
} catch (e) {
  JSDOM = null;
}

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

/** Espelha a expressão de bercos_vinculo_navio_check da migração 001. */
function respeitaVinculo(linha) {
  const vazio = linha.navio_nome === null && linha.navio_imo === null && linha.navio_id === null;
  const identificado = linha.navio_nome !== null || linha.navio_imo !== null;
  if (linha.estado !== 'OCUPADO') return vazio;
  return identificado;
}

const UUID_VALIDO = '11111111-2222-3333-4444-555555555555';

/**
 * Cliente Supabase dublê: consultas resolvem com o conteúdo de `dadosPorTabela`
 * (lista vazia quando a tabela não é informada) e todo upsert é registrado.
 */
function criarClienteDuble(capturas, dadosPorTabela) {
  const dados = dadosPorTabela || {};
  function consulta(tabela) {
    const alvo = {
      select: () => alvo,
      order: () => alvo,
      limit: () => alvo,
      eq: () => alvo,
      single: () => alvo,
      maybeSingle: () => alvo,
      insert: (payload) => { capturas.push({ tabela, tipo: 'insert', payload }); return alvo; },
      update: (payload) => { capturas.push({ tabela, tipo: 'update', payload }); return alvo; },
      delete: () => { capturas.push({ tabela, tipo: 'delete' }); return alvo; },
      upsert: (payload, opcoes) => { capturas.push({ tabela, tipo: 'upsert', payload, opcoes }); return alvo; },
      then: (onOk, onErr) => Promise.resolve({ data: dados[tabela] || [], error: null, count: (dados[tabela] || []).length }).then(onOk, onErr)
    };
    return alvo;
  }
  return {
    from: consulta,
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) })
  };
}

function montarEmbarcacoes() {
  const html = `<!doctype html><html><body>
    <table><tbody id="embarcacoesGpsTableBody"></tbody></table>
    <button id="toggleNavioFormBtn"></button>
    <form id="navioForm"></form>
    <button id="toggleContainerFormBtn"></button>
    <form id="containerForm"></form>
    <table><tbody id="containersTableBody"></tbody></table>
    <table><tbody id="rotasTableBody"></tbody></table>
    <button id="toggleRotaFormBtn"></button>
    <form id="rotaForm"></form>
    <button id="toggleGuindasteFormBtn"></button>
    <form id="guindasteForm"></form>
    <table><tbody id="guindastesTableBody"></tbody></table>
    <div id="bercosGrid"></div>
    <span id="bercosLivresCountTag"></span>
  </body></html>`;

  const dom = new JSDOM(html, { url: 'https://nexusport.example/embarcacoes.html', runScripts: 'dangerously' });
  const capturas = [];
  const navioNoBanco = {
    id: UUID_VALIDO,
    nome: 'Navio Teste',
    numero_imo: 'IMO9999999',
    localizacao: 'DENTRO_DO_PORTO',
    porto_origem: 'Porto de Santos',
    porto_destino: 'Porto de Roterdã'
  };
  dom.window.supabase = {
    createClient: () => criarClienteDuble(capturas, {
      bercos: [],                 // tabela "recém-criada": força o caminho de sincronização
      navios: [navioNoBanco],     // navio real que ocupa o Berço 07
      cargas: [],
      manutencoes: [],
      rotas_maritimas: [],
      containers: [],
      guindastes: []
    })
  };
  dom.window.NEXUS_CONFIG = { SUPABASE_URL: 'https://teste.supabase.co', SUPABASE_ANON_KEY: 'chave-de-teste' };
  // Inspetor: papel com permissão de cadastro (evita ruído dos formulários).
  dom.window.currentUserSession = { nome: 'Teste', cargo: 'INSPETOR' };
  // Navio real cadastrado: o berço ocupado por ele não deve ser liberado.
  dom.window.localStorage.setItem('nexus_navios_list', JSON.stringify([
    { id: UUID_VALIDO, nome: 'Navio Teste', imo: 'IMO9999999', localizacao: 'DENTRO_DO_PORTO' }
  ]));
  dom.window.localStorage.setItem('nexus_bercos_list', JSON.stringify([
    // Linha legada que gerava o erro 23514 (Berço 06 ocupado sem navio).
    { id: 'BERCO-6', nome: 'Berço 6', estado: 'OCUPADO', navio_nome: null, navio_imo: null, navio_id: null },
    { id: 'BERCO-07', nome: 'Berço 07', estado: 'OCUPADO', navio_nome: 'Navio Teste', navio_imo: 'IMO9999999', navio_id: UUID_VALIDO }
  ]));

  dom.window.eval(SECURITY_SRC);
  dom.window.eval(SUPABASE_CLIENT_SRC);
  dom.window.eval(EMBARCACOES_SRC);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return { dom, capturas };
}

(async function main() {
  console.log('\n=== Berços: vínculo navio × berço (js/pages/embarcacoes.js + js/supabase-client.js) ===\n');

  if (!JSDOM) {
    console.error('  ❌ [FAIL] jsdom indisponível — rode `npm install` antes deste teste.');
    process.exit(1);
  }

  console.log('1) Normalização dos payloads de public.bercos');
  const { dom, capturas } = montarEmbarcacoes();
  const normalizar = dom.window.NexusSupabaseUtils.normalizarBerco;

  const casoErro23514 = normalizar({ id: 'BERCO-06', nome: 'Berço 06', estado: 'OCUPADO', navio_nome: null, navio_imo: null, navio_id: null });
  check('OCUPADO sem navio_nome/navio_imo vira LIVRE (erro 23514)', casoErro23514.payload.estado === 'LIVRE', JSON.stringify(casoErro23514.payload));
  check('OCUPADO sem navio limpa o resíduo de vínculo',
    casoErro23514.payload.navio_nome === null && casoErro23514.payload.navio_imo === null && casoErro23514.payload.navio_id === null);
  check('a correção é sinalizada para log', casoErro23514.corrigido === true && Boolean(casoErro23514.motivo), casoErro23514.motivo);

  const casoValido = normalizar({ id: 'BERCO-07', nome: 'Berço 07', estado: 'OCUPADO', navio_nome: 'Navio Teste', navio_imo: 'IMO9999999', navio_id: UUID_VALIDO });
  check('OCUPADO com navio_nome é preservado', casoValido.payload.estado === 'OCUPADO' && casoValido.payload.navio_nome === 'Navio Teste');
  check('navio_id UUID do banco é preservado', casoValido.payload.navio_id === UUID_VALIDO);

  const casoSohImo = normalizar({ id: 'BERCO-08', nome: 'Berço 08', estado: 'OCUPADO', navio_imo: 'IMO1234567' });
  check('OCUPADO identificado apenas pelo IMO é válido', casoSohImo.payload.estado === 'OCUPADO' && casoSohImo.payload.navio_imo === 'IMO1234567');

  const casoIdLocal = normalizar({ id: 'ID-LOCAL', nome: 'Berço 9', estado: 'LIVRE' });
  check('id fora de BERCO-NN é derivado do nome com dois dígitos', casoIdLocal.payload.id === 'BERCO-09', casoIdLocal.payload.id);

  const casoResiduo = normalizar({ id: 'BERCO-10', nome: 'Berço 10', estado: 'LIVRE', navio_nome: 'Fantasma', navio_id: UUID_VALIDO });
  check('LIVRE com resíduo de vínculo é limpo', casoResiduo.payload.navio_nome === null && casoResiduo.payload.navio_id === null);

  const casoEstadoInvalido = normalizar({ id: 'BERCO-11', nome: 'Berço 11', estado: 'RESERVADO' });
  check('estado fora do domínio cai para LIVRE', casoEstadoInvalido.payload.estado === 'LIVRE', casoEstadoInvalido.payload.estado);

  const casoNavioIdNaoUuid = normalizar({ id: 'BERCO-12', nome: 'Berço 12', estado: 'OCUPADO', navio_nome: 'Navio Local', navio_id: 'IMO-999' });
  check('navio_id que não é UUID de public.navios é descartado', casoNavioIdNaoUuid.payload.navio_id === null && casoNavioIdNaoUuid.payload.navio_nome === 'Navio Local');

  const semNome = normalizar({ id: 'BERCO-13', estado: 'OCUPADO' });
  check('berço sem nome não gera payload', semNome.payload === null && Boolean(semNome.motivo));

  const amostras = [casoErro23514, casoValido, casoSohImo, casoIdLocal, casoResiduo, casoEstadoInvalido, casoNavioIdNaoUuid];
  check('todos os payloads satisfazem bercos_vinculo_navio_check',
    amostras.every(a => a.payload && respeitaVinculo(a.payload)));
  check('todos os payloads satisfazem bercos_id_formato_check (^BERCO-[0-9]{2}$)',
    amostras.every(a => a.payload && /^BERCO-[0-9]{2}$/.test(a.payload.id)));

  console.log('\n2) Sincronização da tela de Embarcações (lote de 15 berços)');
  await new Promise(resolve => setTimeout(resolve, 150)); // aguarda as promessas dos loaders

  const upsertsBercos = capturas.filter(c => c.tabela === 'bercos' && c.tipo === 'upsert');
  check('a tela enviou o lote de berços ao Supabase', upsertsBercos.length > 0, `${upsertsBercos.length} upsert(s)`);

  const lote = upsertsBercos.length ? upsertsBercos[0].payload : [];
  check('o lote tem os 15 berços do terminal STS-01', Array.isArray(lote) && lote.length === 15, `recebido: ${Array.isArray(lote) ? lote.length : 'não é lista'}`);
  check('o upsert continua usando onConflict: nome', upsertsBercos.length > 0 && upsertsBercos[0].opcoes && upsertsBercos[0].opcoes.onConflict === 'nome');
  check('nenhuma linha do lote viola bercos_vinculo_navio_check',
    Array.isArray(lote) && lote.every(respeitaVinculo),
    JSON.stringify(Array.isArray(lote) ? lote.filter(l => !respeitaVinculo(l)) : lote));

  const berco06 = Array.isArray(lote) ? lote.find(l => l.id === 'BERCO-06') : null;
  check('Berço 06 legado (OCUPADO sem navio) vai como LIVRE', Boolean(berco06) && berco06.estado === 'LIVRE', JSON.stringify(berco06));
  check('id do Berço 06 foi corrigido para BERCO-06', Boolean(berco06) && berco06.id === 'BERCO-06');

  const berco07 = Array.isArray(lote) ? lote.find(l => l.id === 'BERCO-07') : null;
  check('Berço 07 ocupado por navio real é preservado no lote',
    Boolean(berco07) && berco07.estado === 'OCUPADO' && berco07.navio_nome === 'Navio Teste' && berco07.navio_id === UUID_VALIDO,
    JSON.stringify(berco07));

  const cacheLocal = JSON.parse(dom.window.localStorage.getItem('nexus_bercos_list') || '[]');
  const berco06Local = cacheLocal.find(b => (b.id || '') === 'BERCO-06');
  check('o cache local também fica coerente com o banco',
    Boolean(berco06Local) && berco06Local.estado === 'LIVRE' && berco06Local.navio_nome === null,
    JSON.stringify(berco06Local));

  const grid = dom.window.document.getElementById('bercosGrid').innerHTML;
  check('painel renderiza os 15 berços', (grid.match(/Pronto para atracação/g) || []).length >= 14, `livres na tela: ${(grid.match(/Pronto para atracação/g) || []).length}`);
  check('painel mostra o navio do berço ocupado', grid.includes('Navio Teste'));
  check('contador de berços livres é exibido', dom.window.document.getElementById('bercosLivresCountTag').textContent.includes('Berço(s) Livre(s)'));

  dom.window.close();

  console.log(`\n${passed ? '✅' : '❌'} Teste de vínculo navio × berço ${passed ? 'concluído com sucesso' : 'apresentou falhas'}.\n`);
  process.exit(passed ? 0 : 1);
})();
