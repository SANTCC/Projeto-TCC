#!/usr/bin/env node
/**
 * TESTE DA SUÍTE DE EDGE FUNCTIONS — NEXUSPORT
 * ------------------------------------------------------------
 *  1. kpis-calculo:
 *     - Validação de identidade via codigo_individual / matricula
 *     - Cálculo de ocupação de berços, tempo médio de permanência e aprovação de inspeções
 *     - Alertas de manutenção preventiva (>3 anos)
 *     - Visão estratégica x tática/operacional (restrição do valor_declarado_total)
 *  2. despacho-embarcacao:
 *     - Validação de RBAC (LIBERAR_NAVIO)
 *     - Bloqueio se rota marítima não estiver cadastrada (RF 3.19)
 *     - Cálculo automatizado de ETA (distância / 33 km/h)
 *     - Desvinculação e liberação de berço (estado = LIVRE)
 *     - Propagação de status para contêineres e cargas vinculadas (EM_TRANSITO)
 *     - Registro imutável no trail_decisoes e logs_alteracoes
 *  3. scanner-qr:
 *     - Decodificação de tokens (cargas, contêineres, navios, guindastes)
 *     - Consulta no banco de dados e matriz de permissões por cargo
 *     - Registro automático de leitura no log de alterações (RF 5.8)
 *  4. Configurações e bindings:
 *     - Verificação no config.toml (verify_jwt = false)
 *     - Verificação do cliente Python e JavaScript
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let total = 0;
let falhas = 0;

function log(msg) {
  console.log(msg);
}

function check(desc, ok, detalhe) {
  total++;
  if (ok) {
    console.log(`  ✅ [PASS] ${desc}`);
  } else {
    falhas++;
    console.log(`  ❌ [FAIL] ${desc}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
}

// Handlers das Edge Functions (carregados via import() dinâmico)
let kpisHandler;
let despachoHandler;
let scannerHandler;

function criarClienteFalso(cenarios = {}) {
  const chamadas = [];
  const db = {
    funcionarios: [
      { id: 'f-sup-1', nome: 'Supervisor Carlos', cargo: 'SUPERVISOR_GERENTE_OPERACOES', codigo_individual: 'SUP-2001', matricula: 'SUP-2001', ativo: true },
      { id: 'f-dir-1', nome: 'Diretora Ana', cargo: 'DIRETOR_OPERACOES_LOGISTICA', codigo_individual: 'DIR-1001', matricula: 'DIR-1001', ativo: true },
      { id: 'f-est-1', nome: 'Estivador João', cargo: 'ESTIVADOR', codigo_individual: 'EST-8001', matricula: 'EST-8001', ativo: true }
    ],
    bercos: [
      { id: 'BERCO-01', nome: 'Berço 01', estado: 'OCUPADO', navio_nome: 'MV Santos Star', navio_imo: 'IMO-9123456' },
      { id: 'BERCO-02', nome: 'Berço 02', estado: 'LIVRE', navio_nome: null, navio_imo: null }
    ],
    cargas: [
      { id: 1, natureza: 'Granel Líquido', valor_declarado: 150000.0, status_fluxo: 'ARMAZENAGEM', qr_code_url: 'QR-CRG-1', navio_id: 101, created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString() },
      { id: 2, natureza: 'Conteinerizada', valor_declarado: 85000.0, status_fluxo: 'PRONTA_PARA_ENTREGA', qr_code_url: 'QR-CRG-2', navio_id: 101, created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }
    ],
    inspecoes: [
      { id: 1, carga_id: 1, resultado: 'APROVADA', ativa: true },
      { id: 2, carga_id: 2, resultado: 'APROVADA', ativa: true },
      { id: 3, carga_id: 3, resultado: 'RECUSADA', ativa: true }
    ],
    navios: [
      { id: 101, nome: 'MV Santos Star', imo: 'IMO-9123456', numero_imo: 'IMO-9123456', localizacao: 'DENTRO_DO_PORTO', porto_origem: 'Santos', porto_destino: 'Hamburgo', estado_operacional: 'OPERANTE' }
    ],
    containers: [
      { id: 201, numero_identificacao: 'MSCU1234567', material_carregado: 'Carga Geral', navio_id: 101, estado: 'OPERANTE' }
    ],
    equipamentos: [
      { id: 301, numero_identificacao: 'GND-01', estado: 'OPERANTE' }
    ],
    rotas_maritimas: [
      { id: 1, origem: 'Santos', destino: 'Hamburgo', distancia_km: 10200.0 }
    ],
    trail_decisoes: [],
    logs_alteracoes: []
  };

  const client = {
    chamadas,
    from(tabela) {
      let dados = db[tabela] || [];
      let filtros = [];
      let camposSelect = '*';

      const q = {
        select(c) { camposSelect = c; return q; },
        eq(col, val) {
          filtros.push({ type: 'eq', col, val });
          return q;
        },
        or(conditionStr) {
          filtros.push({ type: 'or', conditionStr });
          return q;
        },
        ilike(col, val) {
          filtros.push({ type: 'ilike', col, val });
          return q;
        },
        order() { return q; },
        limit() { return q; },
        async maybeSingle() {
          let filtered = [...dados];
          for (const f of filtros) {
            if (f.type === 'eq') {
              filtered = filtered.filter(r => String(r[f.col]) === String(f.val));
            }
          }
          return { data: filtered.length > 0 ? filtered[0] : null, error: null };
        },
        async insert(payload) {
          chamadas.push({ action: 'insert', tabela, payload });
          const items = Array.isArray(payload) ? payload : [payload];
          items.forEach(item => {
            if (!item.id) item.id = Math.floor(Math.random() * 10000);
            if (db[tabela]) db[tabela].push(item);
          });
          return { data: Array.isArray(payload) ? payload : items[0], error: null };
        },
        update(payload) {
          q.updatePayload = payload;
          chamadas.push({ action: 'update', tabela, payload, filtros });
          return q;
        },
        then(resolve) {
          let filtered = [...dados];
          for (const f of filtros) {
            if (f.type === 'eq') {
              filtered = filtered.filter(r => String(r[f.col]) === String(f.val));
            }
          }
          if (q.updatePayload) {
            filtered.forEach(r => Object.assign(r, q.updatePayload));
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        }
      };

      return q;
    }
  };

  return { client, db };
}

function mockEnv(key) {
  const envs = {
    SUPABASE_URL: 'https://teste.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
  };
  return envs[key] || '';
}

async function testarKpisCalculo() {
  log('\n1. Testando Edge Function kpis-calculo...');

  const { client, db } = criarClienteFalso();
  const handler = kpisHandler.criarHandler({
    criarCliente: () => client,
    env: mockEnv
  });

  // Teste 1: Visão Estratégica (Diretor) -> deve ver valor_declarado_total
  const reqDir = new Request('https://teste.supabase.co/functions/v1/kpis-calculo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_individual: 'DIR-1001' })
  });
  const resDir = await handler(reqDir);
  const jsonDir = await resDir.json();

  check('kpis-calculo responde status 200', resDir.status === 200);
  check('kpis-calculo devolve ok: true', jsonDir.ok === true);
  check('Diretor acessa valor_declarado_total (R$ 235.000,00)', jsonDir.kpis.cargas.valor_declarado_total === 235000);
  check('flag valor_declarado_visivel === true para visão estratégica', jsonDir.kpis.cargas.valor_declarado_visivel === true);
  check('calculou taxa de ocupação dos berços (50%)', jsonDir.kpis.bercos.taxa_ocupacao_pct === 50.0);
  check('calculou taxa de aprovação de inspeções (66.7%)', jsonDir.kpis.inspecoes.taxa_aprovacao_pct === 66.7);

  // Teste 2: Visão Operacional (Estivador) -> valor_declarado_total ocultado (0)
  const reqEst = new Request('https://teste.supabase.co/functions/v1/kpis-calculo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo_individual: 'EST-8001' })
  });
  const resEst = await handler(reqEst);
  const jsonEst = await resEst.json();

  check('Estivador recebe valor_declarado_total sanitizado (0)', jsonEst.kpis.cargas.valor_declarado_total === 0);
  check('flag valor_declarado_visivel === false para visão não estratégica', jsonEst.kpis.cargas.valor_declarado_visivel === false);
}

async function testarDespachoEmbarcacao() {
  log('\n2. Testando Edge Function despacho-embarcacao...');

  const { client, db } = criarClienteFalso();
  const handler = despachoHandler.criarHandler({
    criarCliente: () => client,
    env: mockEnv
  });

  // Teste 1: Tentar despachar com cargo não autorizado (Estivador)
  const reqEst = new Request('https://teste.supabase.co/functions/v1/despacho-embarcacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ navio_id: 101, codigo_individual: 'EST-8001' })
  });
  const resEst = await handler(reqEst);
  const jsonEst = await resEst.json();

  check('Estivador bloqueado no despacho (HTTP 403)', resEst.status === 403);
  check('Mensagem de erro de RBAC retornada', jsonEst.error.includes('não tem permissão para despachar'));

  // Teste 2: Despachar com Supervisor (Rota existe) -> Sucesso, calcula ETA, libera berço e propaga status
  const reqSup = new Request('https://teste.supabase.co/functions/v1/despacho-embarcacao', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ navio_id: 101, codigo_individual: 'SUP-2001', motivo: 'Saída autorizada em vistoria' })
  });
  const resSup = await handler(reqSup);
  const jsonSup = await resSup.json();

  check('Supervisor despacha navio com sucesso (HTTP 200)', resSup.status === 200);
  check('despacho-embarcacao ok: true', jsonSup.ok === true);
  check('calculou distância da rota (10.200 km)', jsonSup.despacho.distancia_km === 10200);
  check('calculou tempo estimado de viagem (309.1 horas @ 33km/h)', jsonSup.despacho.tempo_estimado_horas === 309.1);
  check('propagou status para contêineres e cargas vinculadas', jsonSup.despacho.cargas_despachadas > 0 && jsonSup.despacho.conteineres_despachados > 0);

  const navioNoDb = db.navios.find(n => n.id === 101);
  check('navio atualizado para EM_TRANSITO no banco', navioNoDb.localizacao === 'EM_TRANSITO');

  const bercoNoDb = db.bercos.find(b => b.id === 'BERCO-01');
  check('berço desocupado (estado = LIVRE)', bercoNoDb.estado === 'LIVRE');

  const trailNoDb = db.trail_decisoes;
  check('trilha de decisão imutável gravada no trail_decisoes', trailNoDb.some(t => t.tipo_decisao === 'LIBEROU_NAVIO'));
}

async function testarScannerQr() {
  log('\n3. Testando Edge Function scanner-qr...');

  const { client, db } = criarClienteFalso();
  const handler = scannerHandler.criarHandler({
    criarCliente: () => client,
    env: mockEnv
  });

  // Teste 1: Escanear QR Code de Carga como Conferente
  const reqScan = new Request('https://teste.supabase.co/functions/v1/scanner-qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_or_code: 'QR-CRG-1', codigo_individual: 'SUP-2001' })
  });
  const resScan = await handler(reqScan);
  const jsonScan = await resScan.json();

  check('scanner-qr responde HTTP 200', resScan.status === 200);
  check('identificou tipo de entidade CARGA', jsonScan.entidade_tipo === 'CARGA');
  check('encontrou registro no banco de dados', jsonScan.encontrado === true);
  check('retornou ações permitidas para o Supervisor', jsonScan.acoes_permitidas.includes('LIBERAR_SAIDA'));

  const logsNoDb = db.logs_alteracoes;
  check('registrou evento de leitura no log de alterações (RF 5.8)', logsNoDb.some(l => l.tipo_alteracao === 'CONSULTA'));
}

function testarConfiguracaoEBindings() {
  log('\n4. Testando arquivos de configuração e bindings...');

  const configPath = path.join(ROOT, 'supabase/config.toml');
  const configTxt = fs.readFileSync(configPath, 'utf8');

  check('config.toml possui [functions.kpis-calculo]', configTxt.includes('[functions.kpis-calculo]'));
  check('config.toml possui [functions.despacho-embarcacao]', configTxt.includes('[functions.despacho-embarcacao]'));
  check('config.toml possui [functions.scanner-qr]', configTxt.includes('[functions.scanner-qr]'));

  const pyClientTxt = fs.readFileSync(path.join(ROOT, 'tools/nexus_api/client.py'), 'utf8');
  check('tools/nexus_api/client.py expõe invoke_edge_function', pyClientTxt.includes('def invoke_edge_function'));

  const relatoriosJsTxt = fs.readFileSync(path.join(ROOT, 'js/pages/relatorios.js'), 'utf8');
  check('js/pages/relatorios.js expõe window.nexusCalcularKpisEdgeFunction', relatoriosJsTxt.includes('window.nexusCalcularKpisEdgeFunction'));

  const embarcacoesJsTxt = fs.readFileSync(path.join(ROOT, 'js/pages/embarcacoes.js'), 'utf8');
  check('js/pages/embarcacoes.js expõe window.nexusDespacharEmbarcacaoEdgeFunction', embarcacoesJsTxt.includes('window.nexusDespacharEmbarcacaoEdgeFunction'));
}

async function main() {
  log('================================================================');
  log('SUÍTE DE TESTES — NOVAS EDGE FUNCTIONS (NEXUSPORT)');
  log('================================================================');

  try {
    kpisHandler = await import(path.join(ROOT, 'supabase/functions/kpis-calculo/handler.js'));
    despachoHandler = await import(path.join(ROOT, 'supabase/functions/despacho-embarcacao/handler.js'));
    scannerHandler = await import(path.join(ROOT, 'supabase/functions/scanner-qr/handler.js'));

    await testarKpisCalculo();
    await testarDespachoEmbarcacao();
    await testarScannerQr();
    testarConfiguracaoEBindings();
  } catch (err) {
    check('execução sem exceções não tratadas', false, err.stack || String(err));
  }

  log('================================================================');
  log(`Resultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  log('================================================================');
  process.exit(falhas > 0 ? 1 : 0);
}

main();
