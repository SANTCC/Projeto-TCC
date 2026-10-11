/**
 * Teste de Verificação — Correções Adicionais (NexusPort)
 *
 *  2.2 Exclusões verificadas no banco (FK → desativação; DELETE silencioso → erro).
 *  3   Máscaras de código por campo (js/mascaras-codigo.js): hífen automático
 *      na digitação/colagem, normalização para comparação e validação.
 *  4   Trilha de auditoria: entidade escolhida por tipo + registro e gravada no
 *      formato existente (entidade_tipo enum + entidade_id texto); chamadas
 *      (decisao, 'tabela', id, motivo) não gravam mais 'navios' como entidade.
 *  6.1 Leitor de QR do checklist: uma única instância (sem <video> empilhado).
 *  6.2 Cargas ENTREGUE não aparecem para inspeção nem abrem o checklist.
 *  7   Relatórios: o Período de Referência filtra as cargas pela data de cadastro.
 *
 * Executar: node tests/test_correcoes_adicionais.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }

let passed = true;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✅ [PASS] ${label}`);
  } else {
    console.error(`  ❌ [FAIL] ${label}${extra ? ` — ${extra}` : ''}`);
    passed = false;
  }
}

const SECURITY_SRC = read('js/security.js');
const MASCARAS_SRC = read('js/mascaras-codigo.js');

function criarDom(html, url) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    url: url || 'http://localhost/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.console = console;
  w.eval(SECURITY_SRC);
  return { dom, w };
}

/** Dispara DOMContentLoaded uma única vez (o jsdom já o dispara se ainda estiver carregando). */
function dispararCarregamento(w) {
  if (w.document.readyState !== 'loading') w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
}

async function esperar(ms) { return new Promise(r => setTimeout(r, ms || 0)); }

// ---------------------------------------------------------------------------
// 3. Máscaras por campo
// ---------------------------------------------------------------------------
function testarMascaras() {
  console.log('\n[3] Máscaras de código por campo');
  const { w } = criarDom(`
    <input id="mat" data-mascara="MATRICULA" />
    <input id="cod" data-mascara="CODIGO_INDIVIDUAL" />
    <input id="imo" data-mascara="IMO" />
    <input id="cont" data-mascara="CONTAINER" />
    <input id="busca" data-mascara="CODIGO_CARGA" data-mascara-busca />
  `);
  w.eval(MASCARAS_SRC);
  const M = w.NexusMascaras;
  check('NexusMascaras exposto', M && typeof M.formatar === 'function');
  if (!M) return;
  M.ligarTodos();

  check('matrícula "1234" → MAT-1234', M.formatar('MATRICULA', '1234') === 'MAT-1234');
  check('código individual "nx10405823" → NX-1040-5823', M.formatar('CODIGO_INDIVIDUAL', 'nx10405823') === 'NX-1040-5823');
  check('carga "crg2026303" → CRG-2026-303', M.formatar('CODIGO_CARGA', 'crg2026303') === 'CRG-2026-303');
  check('IMO exibido com hífen e canônico sem hífen', M.formatar('IMO', 'IMO 9821034') === 'IMO-9821034' && M.canonico('IMO', 'IMO-9821034') === 'IMO9821034');
  check('contêiner canônico sem hífen (compatível com registros existentes)', M.canonico('CONTAINER', 'mscu 123456-7') === 'MSCU1234567');
  check('comparação normalizada ignora hífen/espaço/caixa', M.mesmoCodigo('mat 1234', 'MAT-1234') && !M.mesmoCodigo('MAT-1234', 'MAT-1235'));
  check('validação por campo (MAT-12 inválida, MAT-1234 válida)', !M.valido('MATRICULA', 'MAT-12') && M.valido('MATRICULA', 'MAT-1234'));

  // Digitação: evento input formata no próprio campo
  const mat = w.document.getElementById('mat');
  mat.value = 'mat12';
  mat.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('digitação parcial vira "MAT-12"', mat.value === 'MAT-12', mat.value);
  mat.value = 'MAT-1234';
  mat.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('matrícula completa mantém "MAT-1234"', mat.value === 'MAT-1234', mat.value);

  // Colagem: o valor colado é normalizado
  const cont = w.document.getElementById('cont');
  cont.value = ' mscu 123456 7 ';
  cont.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('colagem em contêiner vira "MSCU-1234567"', cont.value === 'MSCU-1234567', cont.value);

  // Busca: não força prefixo em consulta parcial
  const busca = w.document.getElementById('busca');
  busca.value = '303';
  busca.dispatchEvent(new w.Event('input', { bubbles: true }));
  check('campo de busca não força prefixo ("303" permanece)', busca.value === '303', busca.value);

  // Páginas carregam o script antes dos módulos e marcam os campos
  const paginas = [
    ['index.html', 'operatorCode', 'CODIGO_INDIVIDUAL'],
    ['tecnico_portos.html', 'funcMatricula', 'MATRICULA'],
    ['delegacao.html', 'delegSubstituidoMatricula', 'MATRICULA'],
    ['embarcacoes.html', 'navioImo', 'IMO'],
    ['embarcacoes.html', 'contIdentificacao', 'CONTAINER'],
    ['embarcacoes.html', 'gndNumero', 'GUINDASTE']
  ];
  paginas.forEach(([arq, id, tipo]) => {
    const html = read(arq);
    const tag = (html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`)) || [''])[0];
    check(`${arq} #${id} usa data-mascara="${tipo}"`, tag.includes(`data-mascara="${tipo}"`));
    check(`${arq} carrega js/mascaras-codigo.js`, html.includes('<script src="js/mascaras-codigo.js"></script>'));
  });

  const emb = read('js/pages/embarcacoes.js');
  check('IMO lido sem hífen da máscara antes de validar/gravar', emb.includes(".value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')"));
  const tec = read('js/pages/tecnico_portos.js');
  check('duplicidade de matrícula comparada sem separadores', tec.includes('chaveMatricula(f.matricula) === chaveMatricula(formattedMatricula)'));
}

// ---------------------------------------------------------------------------
// 4. Trilha de auditoria (Painel Geral)
// ---------------------------------------------------------------------------
async function testarTrail() {
  console.log('\n[4] Trilha de auditoria — entidade por tipo + registro');
  const html = read('dashboard.html');
  check('campo de texto livre da entidade removido', !html.includes('id="trailEntidadeInput"'));
  check('select de tipo de entidade presente', html.includes('id="trailEntidadeTipoSelect"'));
  check('select de registro presente (inicia desabilitado)', /id="trailEntidadeRegistroSelect"[^>]*disabled/.test(html));

  const { w } = criarDom('');
  const inserts = [];
  w.nexusSupabase = {
    from(tabela) {
      return {
        insert(payload) {
          inserts.push({ tabela, payload });
          return { select() { return { maybeSingle: async () => ({ data: { id: '11111111-2222-3333-4444-555555555555' }, error: null }) }; } };
        }
      };
    }
  };
  w.currentUserSession = { nome: 'Sup', cargo: 'SUPERVISOR_GERENTE_OPERACOES', codigo_individual: 'SUP-2001' };
  w.eval(read('js/pages/dashboard.js'));
  check('registrarTrailDecisao exposto', typeof w.registrarTrailDecisao === 'function');

  const r1 = await w.registrarTrailDecisao('LIBEROU_NAVIO', { tipo: 'NAVIO', id: 'IMO9821034' }, 'Liberação formal');
  const p1 = inserts.filter(i => i.tabela === 'trail_decisoes').pop();
  check('tipo explícito grava entidade_tipo NAVIO e entidade_id = registro', p1 && p1.payload.entidade_tipo === 'NAVIO' && p1.payload.entidade_id === 'IMO9821034');
  check('retorno indica confirmação do banco', r1 && r1.ok === true && r1.dbId);

  await w.registrarTrailDecisao('SOLICITOU_MANUTENCAO_CONTAINER', 'guindastes', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Solicitou manutenção do Guindaste GND-01');
  const p2 = inserts.filter(i => i.tabela === 'trail_decisoes').pop();
  check('forma (decisao, tabela, id, motivo): entidade_tipo GUINDASTE', p2 && p2.payload.entidade_tipo === 'GUINDASTE', p2 && p2.payload.entidade_tipo);
  check('forma (decisao, tabela, id, motivo): entidade_id é o id (não "guindastes")', p2 && p2.payload.entidade_id === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  check('forma (decisao, tabela, id, motivo): motivo preservado', p2 && p2.payload.motivo === 'Solicitou manutenção do Guindaste GND-01');

  await w.registrarTrailDecisao('CANCELOU_ENTREGA', 'CRG-2026-303', 'Cliente desistiu');
  const p3 = inserts.filter(i => i.tabela === 'trail_decisoes').pop();
  check('forma antiga (texto) segue gravando CARGA + código', p3 && p3.payload.entidade_tipo === 'CARGA' && p3.payload.entidade_id === 'CRG-2026-303');

  const tiposEnum = ['NAVIO', 'CONTAINER', 'CARGA', 'FUNCIONARIO', 'GUINDASTE', 'MANUTENCAO'];
  const src = read('js/pages/dashboard.js');
  check('tipos oferecidos pertencem ao tipo_entidade_enum', tiposEnum.every(t => src.includes(`${t}: {`)));
  check('registro revalidado no banco antes de gravar', src.includes('const atual = await carregarRegistrosEntidade(tipoEntidade);'));
}

// ---------------------------------------------------------------------------
// 6. Inspeção & Checklist
// ---------------------------------------------------------------------------
async function testarInspecao() {
  console.log('\n[6] Inspeção & Checklist');
  const html = read('inspecao.html');
  check('6.1 cabeçalho do leitor quebra linha em telas estreitas (flex-wrap)', html.includes('flex flex-wrap items-center justify-between gap-3 border-b'));
  check('6.1 área do leitor sem altura fixa (aspect-square + overflow-hidden)', /id="inspecaoQrReader" class="[^"]*aspect-square[^"]*overflow-hidden/.test(html) && !/id="inspecaoQrReader" class="[^"]*h-48/.test(html));
  check('6.1 vídeo injetado limitado ao contêiner', html.includes('#inspecaoQrReader video'));

  const cargas = [
    { id: 'CRG-2026-301', tipo: 'Geral', status: 'RECEBIMENTO_INSPECAO', portoDescarga: 'STS' },
    { id: 'CRG-2026-303', tipo: 'Geral', status: 'ENTREGUE', portoDescarga: 'STS' },
    { id: 'CRG-2026-304', tipo: 'Geral', status: 'CANCELADA', portoDescarga: 'STS' }
  ];
  const domHtml = `
    <button id="scanChecklistBtn"><span id="scanChecklistBtnLabel">Escanear QR Code</span></button>
    <div id="checklistQrViewport" class="hidden"><div id="inspecaoQrReader"></div><span id="inspecaoQrStatus"></span></div>
    <select id="inspecaoCargaSelect"></select><button id="carregarChecklistBtn"></button>
    <div id="checklistFormContainer" class="hidden"><span id="cargaInspecionadaTag"></span><div id="checklistItemsList"></div></div>
    <button id="aprovarCargaBtn"></button><button id="recusarCargaBtn"></button>
    <div id="motivoRecusaBox"></div><textarea id="motivoRecusaInput"></textarea>`;

  // Seletor: ENTREGUE/CANCELADA fora
  {
    const { w } = criarDom(domHtml, 'http://localhost/inspecao.html');
    w.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));
    w.currentUserSession = { nome: 'Insp', cargo: 'INSPETOR', codigo_individual: 'INS-6090' };
    w.mostrarFeedback = () => {};
    let instancias = 0;
    w.Html5Qrcode = function () {
      instancias += 1;
      this.start = async () => {};
      this.stop = async () => {};
      this.clear = () => {};
    };
    w.eval(read('js/pages/inspecao.js'));
    dispararCarregamento(w);
    await esperar(20);
    const valores = Array.from(w.document.querySelectorAll('#inspecaoCargaSelect option')).map(o => o.value);
    check('6.2 carga ENTREGUE não aparece no seletor de inspeção', !valores.includes('CRG-2026-303'), valores.join(','));
    check('6.2 carga em RECEBIMENTO_INSPECAO continua disponível', valores.includes('CRG-2026-301'));

    const btn = w.document.getElementById('scanChecklistBtn');
    const vp = w.document.getElementById('checklistQrViewport');
    btn.click(); await esperar(10);
    check('6.1 abrir o leitor mostra o painel', !vp.classList.contains('hidden'));
    btn.click(); await esperar(10);
    check('6.1 segundo clique fecha o leitor (não cria outra instância)', vp.classList.contains('hidden') && instancias === 1, `instâncias=${instancias}`);
    btn.click(); await esperar(10);
    check('6.1 reabrir usa nova instância somente após parar a anterior', instancias === 2 && w.document.getElementById('inspecaoQrReader').children.length <= 1);
  }

  // ?carga= de uma carga ENTREGUE não abre o checklist
  {
    const { w } = criarDom(domHtml, 'http://localhost/inspecao.html?carga=CRG-2026-303');
    w.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));
    w.currentUserSession = { nome: 'Insp', cargo: 'INSPETOR', codigo_individual: 'INS-6090' };
    const avisos = [];
    w.mostrarFeedback = (tipo, titulo) => avisos.push(titulo);
    w.eval(read('js/pages/inspecao.js'));
    dispararCarregamento(w);
    await esperar(20);
    check('6.2 link direto para carga ENTREGUE não abre o checklist', w.document.getElementById('checklistFormContainer').classList.contains('hidden'));
    check('6.2 operador é avisado de que a inspeção está indisponível', avisos.includes('Inspeção Indisponível'), avisos.join(','));
  }
}

// ---------------------------------------------------------------------------
// 7. Relatórios — Período de Referência
// ---------------------------------------------------------------------------
async function testarRelatorios() {
  console.log('\n[7] Relatórios — Período de Referência por data de cadastro');
  const agora = new Date();
  const diasAtras = (n) => { const d = new Date(agora); d.setDate(d.getDate() - n); return d.toISOString(); };
  const linhas = [
    { id: 'u1', qr_code_url: 'QR-CRG-2026-001', natureza: 'Grãos', status_fluxo: 'ARMAZENAGEM', created_at: diasAtras(0) },
    { id: 'u2', qr_code_url: 'QR-CRG-2026-002', natureza: 'Aço', status_fluxo: 'ARMAZENAGEM', created_at: diasAtras(10) },
    { id: 'u3', qr_code_url: 'QR-CRG-2026-003', natureza: 'Café', status_fluxo: 'ENTREGUE', created_at: diasAtras(90) }
  ];
  const { w } = criarDom(`
    <select id="relatorioPeriodoSelect">
      <option value="HOJE">Hoje</option><option value="7D">Últimos 7 dias</option>
      <option value="30D" selected>Últimos 30 dias</option><option value="TODOS">Todo o período</option>
    </select>
    <div id="relatorioPeriodoChips"><button class="periodo-chip" data-periodo="HOJE">Hoje</button></div>
    <select id="relatorioCargaSelect"></select><p id="relatorioCargaPeriodoInfo"></p>
    <button id="gerarPdfBtn"></button>`, 'http://localhost/relatorios.html');
  w.currentUserSession = { nome: 'Dir', cargo: 'DIRETOR_OPERACOES_LOGISTICA', codigo_individual: 'DIR-1' };
  w.nexusSupabase = { from: () => ({ select: async () => ({ data: linhas, error: null }) }) };
  w.eval(read('js/pages/relatorios.js'));
  dispararCarregamento(w);
  await esperar(30);

  const opcoes = () => Array.from(w.document.querySelectorAll('#relatorioCargaSelect option')).map(o => o.value).filter(Boolean);
  const periodo = w.document.getElementById('relatorioPeriodoSelect');
  check('30 dias: só cargas cadastradas nos últimos 30 dias', JSON.stringify(opcoes().sort()) === JSON.stringify(['CRG-2026-001', 'CRG-2026-002']), opcoes().join(','));

  periodo.value = 'HOJE';
  periodo.dispatchEvent(new w.Event('change'));
  await esperar(10);
  check('Hoje: só a carga cadastrada hoje', JSON.stringify(opcoes()) === JSON.stringify(['CRG-2026-001']), opcoes().join(','));

  periodo.value = 'TODOS';
  periodo.dispatchEvent(new w.Event('change'));
  await esperar(10);
  check('Todo o período: todas as cargas', opcoes().length === 3, opcoes().join(','));

  const rotulo = (w.document.querySelector('#relatorioCargaSelect option[value="CRG-2026-003"]') || {}).textContent || '';
  check('opção mostra a data real de cadastro (não a de hoje)', rotulo.includes(new Date(linhas[2].created_at).toLocaleDateString('pt-BR')), rotulo);
  check('contador do período informado', /3 de 3 carga/.test(w.document.getElementById('relatorioCargaPeriodoInfo').textContent));

  const charts = read('js/pages/charts.js');
  check('gráficos filtram cargas pela data de cadastro', charts.includes('dataDentroDoPeriodo(c.dataCadastro, inicio, false)'));
  check('CSV histórico não inventa a data de hoje', !read('js/vision-layer.js').includes("c.dataChegada || new Date().toISOString()"));
}


// ---------------------------------------------------------------------------
// 2.2 Exclusões verificadas (NexusRepository)
// ---------------------------------------------------------------------------
/** Cliente dublê: cada consulta é resolvida por `responder(tabela, operacao)`. */
function clienteProgramavel(responder) {
  const chamadas = [];
  return {
    chamadas,
    from(tabela) {
      const estado = { tabela, op: 'select', payload: null, filtros: [] };
      const b = {
        select() { if (estado.op === 'select') estado.op = 'select'; return b; },
        delete() { estado.op = 'delete'; return b; },
        update(p) { estado.op = 'update'; estado.payload = p; return b; },
        eq(c, v) { estado.filtros.push([c, v]); return b; },
        limit() { return b; },
        then(ok, erro) { chamadas.push(Object.assign({}, estado)); return Promise.resolve(responder(estado)).then(ok, erro); }
      };
      return b;
    }
  };
}

async function testarExclusoes() {
  console.log('\n[2.2] Exclusões verificadas no banco');
  const src = read('js/data-repository.js');
  const prepararRepo = (cliente) => {
    const { w } = criarDom('');
    w.nexusSupabase = cliente;
    w.eval(src);
    return w;
  };

  // Funcionário com vínculos (FK 23503) → desativado, não apagado
  {
    const cliente = clienteProgramavel((e) => {
      if (e.op === 'delete') return { data: null, error: { code: '23503', message: 'violates foreign key' } };
      if (e.op === 'update') return { data: [{ id: 'f1' }], error: null };
      return { data: [], error: null };
    });
    const w = prepararRepo(cliente);
    w.localStorage.setItem('nexus_func_list', JSON.stringify([{ matricula: 'MAT-1234', ativo: true }]));
    const r = await w.NexusRepository.deleteFuncionario('MAT-1234');
    check('funcionário com vínculos é desativado (modo DESATIVADO)', r && r.ok === true && r.modo === 'DESATIVADO', JSON.stringify(r));
    check('desativação grava ativo=false no banco', cliente.chamadas.some(c => c.op === 'update' && c.payload && c.payload.ativo === false));
    const local = JSON.parse(w.localStorage.getItem('nexus_func_list'));
    check('funcionário permanece no espelho local como inativo', local.length === 1 && local[0].ativo === false);
  }

  // DELETE recusado em silêncio (0 linhas, registro ainda existe) → erro
  {
    const cliente = clienteProgramavel((e) => {
      if (e.op === 'delete') return { data: [], error: null };
      return { data: [{ id: 'c1' }], error: null }; // ainda existe
    });
    const w = prepararRepo(cliente);
    w.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([{ id: 'CRG-2026-303' }]));
    const r = await w.NexusRepository.deleteCarga('CRG-2026-303');
    check('exclusão de carga não confirmada retorna ok=false com mensagem', r && r.ok === false && /não autorizou/.test(r.mensagem || ''), JSON.stringify(r));
    check('carga não some da tela quando o banco não excluiu', JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')).length === 1);
  }

  // DELETE confirmado → some do espelho local
  {
    const cliente = clienteProgramavel((e) => (e.op === 'delete' ? { data: [{ id: 'c1' }], error: null } : { data: [], error: null }));
    const w = prepararRepo(cliente);
    w.localStorage.setItem('nexus_cargas_fluxo', JSON.stringify([{ id: 'CRG-2026-303' }, { id: 'CRG-2026-304' }]));
    const r = await w.NexusRepository.deleteCarga('CRG-2026-303');
    const ids = JSON.parse(w.localStorage.getItem('nexus_cargas_fluxo')).map(c => c.id);
    check('exclusão confirmada remove só a carga excluída', r && r.ok !== false && JSON.stringify(ids) === JSON.stringify(['CRG-2026-304']), JSON.stringify({ r, ids }));
  }

  const mig = read('supabase/migrations/20261011000000_integridade_operacional.sql').replace(/--.*$/gm, '');
  check('migração não usa ON DELETE CASCADE em históricos de manutenção', !/on delete cascade/i.test(mig) && /on delete set null/i.test(mig));
}

(async () => {
  console.log('=== Teste: Correções Adicionais (máscaras, trilha, inspeção, relatórios) ===');
  if (!JSDOM) {
    console.error('jsdom indisponível — execute npm ci');
    process.exit(1);
  }
  try {
    testarMascaras();
    await testarExclusoes();
    await testarTrail();
    await testarInspecao();
    await testarRelatorios();
  } catch (err) {
    console.error('Erro inesperado:', err);
    passed = false;
  }
  console.log(passed ? '\n✅ Todos os testes passaram.' : '\n❌ Há falhas.');
  process.exit(passed ? 0 : 1);
})();
