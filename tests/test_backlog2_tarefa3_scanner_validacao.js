#!/usr/bin/env node
/**
 * Regressão — Tarefa 3 (Backlog Parte 2): validação no Scan QR Code.
 *
 * Na simulação manual (e na câmera, que usa a mesma função), o sistema só
 * pode indicar leitura bem-sucedida para QR Code válido/existente:
 *   - código inexistente: feedback de erro, cartão de resultado oculto,
 *     NENHUM registro em leituras_qr_code/logs/auditoria local, campo manual
 *     preservado para correção e retorno estruturado encontrado:false;
 *   - código de carga existente no Supabase: sucesso, cartão visível e
 *     leitura registrada uma única vez;
 *   - código existente só no cache local de cargas: também é sucesso
 *     (mesma fonte de fallback que a tela já usava);
 *   - um scan inválido depois de um válido esconde o cartão anterior
 *     (não "herda" o sucesso da leitura anterior).
 *
 * Executar: node tests/test_backlog2_tarefa3_scanner_validacao.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const CARGA_DB_ID = '77777777-0000-0000-0000-000000000001';

/** Supabase falso mínimo do scanner: cargas/contêineres + insert de leituras/logs. */
function clienteSupabase(estado) {
  const from = (tabela) => {
    let op = 'select';
    let payload = null;
    let executouInsert = false;
    const filtrosOr = [];
    const executar = () => {
      if (op === 'insert') {
        if (!executouInsert) {
          executouInsert = true;
          (estado.insercoes[tabela] || (estado.insercoes[tabela] = [])).push(payload);
        }
        return { data: null, error: null };
      }
      const linhas = estado[tabela] || [];
      const codigos = filtrosOr.flatMap(s => Array.from(String(s).matchAll(/eq\.([^,)]+)/g)).map(m => m[1]));
      if (codigos.length === 0) return { data: linhas.slice(), error: null };
      const encontrada = linhas.find(r =>
        codigos.includes(r.qr_code_url) || codigos.includes(r.id) ||
        codigos.includes(r.numero_identificacao) || codigos.includes(`QR-${r.id}`));
      return { data: encontrada || null, error: null };
    };
    const b = {
      select() { return b; },
      or(s) { filtrosOr.push(s); return b; },
      eq() { return b; },
      insert(p) { op = 'insert'; payload = p; return b; },
      maybeSingle() { const r = executar(); return Promise.resolve({ data: r.data || null, error: null }); },
      then(res, rej) { return Promise.resolve(executar()).then(res, rej); }
    };
    return b;
  };
  return { from };
}

async function carregarPagina() {
  const estado = {
    cargas: [{
      id: CARGA_DB_ID, qr_code_url: 'QR-CRG-2026-001', natureza: 'Carga Geral', peso: 12, volume: 20,
      valor_declarado: 1500, porto_descarga: 'Pátio STS-01 (Setor B)', destino: 'Hamburgo',
      status_fluxo: 'ARMAZENAGEM', container_id: null,
      navios: { id: 'n1', nome: 'Navio Teste' }, containers: { id: 'c1', numero_identificacao: 'CONT-TESTE-01' }
    }],
    containers: [],
    insercoes: {},
    feedbacks: []
  };
  const janela = criarJanela({
    url: 'https://nexusport.test/scanner.html',
    html: htmlDaPagina('scanner.html'),
    session: sessao('ESTIVADOR', { matricula: 'MAT-9101', nome: 'Estivador de Teste' }),
    storage: {
      nexus_cargas_fluxo: [{
        id: 'CRG-2026-777', qrCode: 'QR-CRG-2026-777', tipo: 'Carga Local', natureza: 'Geral',
        peso: '8 t', volume: '10 m³', valor: 'R$ 900,00', portoDescarga: 'Pátio STS-01 (Setor C)',
        destino: 'Roterdã', status: 'ARMAZENAGEM', container: '', navio: ''
      }],
      nexus_audit_logs: [],
      nexus_func_list: []
    },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = clienteSupabase(estado);
        win.mostrarFeedback = (tipo, titulo, mensagem) => estado.feedbacks.push({ tipo, titulo, mensagem });
        win.console.warn = () => {};
      },
      'js/pages/scanner.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(80);
  return { janela, w: janela.w, estado };
}

async function esperar(condicao, limiteMs = 1500) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (condicao()) return true;
    await aguardar(10);
  }
  return Boolean(condicao());
}

const titulos = (estado, titulo) => estado.feedbacks.filter(f => f.titulo === titulo);
const totalInsercoes = (estado) => Object.values(estado.insercoes).reduce((s, lista) => s + lista.length, 0);

async function main() {
  const janelas = [];
  try {
    log('1. Simulação manual com código inexistente: erro, sem sucesso e sem registro');
    let p = await carregarPagina(); janelas.push(p.janela);
    const input = p.w.document.getElementById('simulatedQrInput');
    input.value = 'QUALQUER-TEXTO-123';
    p.w.document.getElementById('simulateScanBtn').click();
    await esperar(() => titulos(p.estado, 'QR Code Não Localizado').length === 1);
    check('feedback de erro "QR Code Não Localizado"', titulos(p.estado, 'QR Code Não Localizado').length === 1, JSON.stringify(p.estado.feedbacks));
    check('mensagem avisa que a leitura não foi registrada',
      /não foi registrada/.test((titulos(p.estado, 'QR Code Não Localizado')[0] || {}).mensagem || ''));
    check('cartão de resultado permanece oculto', p.w.document.getElementById('qrResultCard').classList.contains('hidden'));
    check('nenhuma leitura/log gravado no Supabase', totalInsercoes(p.estado) === 0, JSON.stringify(p.estado.insercoes));
    check('auditoria local não ganhou leitura', JSON.parse(p.w.localStorage.getItem('nexus_audit_logs') || '[]').length === 0);
    check('campo manual preserva o código para correção', input.value === 'QUALQUER-TEXTO-123', input.value);

    log('\n2. Retorno estruturado (WebMCP) também é encontrado:false');
    const retorno = await p.w.nexusScannerProcessar('CODIGO-INEXISTENTE-XYZ');
    check('encontrado é false', retorno && retorno.encontrado === false, JSON.stringify(retorno));
    check('status é NAO_LOCALIZADO', retorno && retorno.status === 'NAO_LOCALIZADO', JSON.stringify(retorno));
    check('continua sem gravar leitura', totalInsercoes(p.estado) === 0);

    log('\n3. Código de carga existente no Supabase: sucesso e leitura registrada');
    const ok = await p.w.nexusScannerProcessar('QR-CRG-2026-001');
    await esperar(() => (p.estado.insercoes.leituras_qr_code || []).length === 1);
    check('encontrado é true', ok && ok.encontrado === true, JSON.stringify(ok));
    check('cartão de resultado visível', !p.w.document.getElementById('qrResultCard').classList.contains('hidden'));
    check('identificação exibida sem o prefixo QR-', p.w.document.getElementById('resEntityId').textContent === 'CRG-2026-001',
      p.w.document.getElementById('resEntityId').textContent);
    check('leitura registrada uma vez em leituras_qr_code', (p.estado.insercoes.leituras_qr_code || []).length === 1, JSON.stringify(p.estado.insercoes));
    check('auditoria local registrou a leitura válida', JSON.parse(p.w.localStorage.getItem('nexus_audit_logs') || '[]').length === 1);

    log('\n4. Código existente só no cache local também é sucesso');
    const local = await p.w.nexusScannerProcessar('CRG-2026-777');
    check('encontrado é true pelo cache local', local && local.encontrado === true, JSON.stringify(local));
    check('cartão mostra a carga local', p.w.document.getElementById('resEntityId').textContent === 'CRG-2026-777');

    log('\n5. Inválido depois de válido: não herda o sucesso anterior');
    const leiturasAntes = (p.estado.insercoes.leituras_qr_code || []).length;
    const invalido = await p.w.nexusScannerProcessar('QR-CRG-9999-INEXISTENTE');
    check('encontrado é false', invalido && invalido.encontrado === false, JSON.stringify(invalido));
    check('cartão volta a ficar oculto', p.w.document.getElementById('qrResultCard').classList.contains('hidden'));
    check('nenhuma leitura nova gravada', (p.estado.insercoes.leituras_qr_code || []).length === leiturasAntes);

    log('\n6. Campo vazio na simulação manual continua sendo só aviso de obrigatoriedade');
    p = await carregarPagina(); janelas.push(p.janela);
    p.w.document.getElementById('simulatedQrInput').value = '   ';
    p.w.document.getElementById('simulateScanBtn').click();
    await esperar(() => titulos(p.estado, 'Campo Obrigatório').length === 1);
    check('aviso de campo obrigatório (sem tratar como scan)', titulos(p.estado, 'Campo Obrigatório').length === 1, JSON.stringify(p.estado.feedbacks));
    check('nenhum registro gravado', totalInsercoes(p.estado) === 0);
  } catch (erro) {
    log(`\n❌ Erro inesperado: ${erro && erro.stack ? erro.stack : erro}`);
    process.exitCode = 1;
  } finally {
    janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
}

main();
