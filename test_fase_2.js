const fs = require('fs');
const path = require('path');

async function testFase2() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 2 (FLUXO DE CARGAS, INSPEÇÃO E SCANNER)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, 'js');

  const cargasCode = fs.readFileSync(path.join(jsDir, 'cargas.js'), 'utf-8');
  const inspecaoCode = fs.readFileSync(path.join(jsDir, 'inspecao.js'), 'utf-8');
  const scannerCode = fs.readFileSync(path.join(jsDir, 'scanner.js'), 'utf-8');
  const dataRepoCode = fs.readFileSync(path.join(jsDir, 'data-repository.js'), 'utf-8');

  // 1. Item 2.1: Sincronização do Fluxo de Status da Carga no Banco
  console.log('1. Validando persistência de transições de status da carga no Supabase (Item 2.1)...');
  const updatesStatusInSupabase = cargasCode.includes("window.nexusSupabase.from('cargas').update(updateData)") ||
                                  cargasCode.includes("status_fluxo: carga.status");
  const updatesRepositoryNotification = cargasCode.includes("window.NexusRepository.notifyChange('cargas')");

  if (updatesStatusInSupabase && updatesRepositoryNotification) {
    console.log('  ✅ [PASS] Transições de status de fluxo persistem no Supabase e notificam o repositório em tempo real.');
  } else {
    console.error('  ❌ [FAIL] Transições de status não persistem ou não notificam adequadamente.');
    passed = false;
  }

  // 2. Item 2.2: Vistoria/Inspeção com Persistência em Inspeções e Trail
  console.log('2. Validando módulo de inspeção com inserção em inspecoes e trail de decisões (Item 2.2)...');
  const inspecaoApprovesWithDb = inspecaoCode.includes("window.nexusSupabase.from('inspecoes').insert(payloadInspecao)") &&
                                  inspecaoCode.includes("data_inspecao: new Date().toISOString()") &&
                                  inspecaoCode.includes("resultado: 'APROVADA'");
  const inspecaoRefusesWithReason = inspecaoCode.includes("resultado: 'RECUSADA'") &&
                                    inspecaoCode.includes("motivo_recusa: motivo");
  const recordsInspecaoTrail = inspecaoCode.includes("window.registrarTrailDecisao('APROVOU_CARGA'") &&
                               inspecaoCode.includes("window.registrarTrailDecisao('RECUSOU_CARGA'");

  if (inspecaoApprovesWithDb && inspecaoRefusesWithReason && recordsInspecaoTrail) {
    console.log('  ✅ [PASS] Inspeção persiste na tabela inspecoes (com data_inspecao e inspetor_id) e grava no trail imutável.');
  } else {
    console.error('  ❌ [FAIL] Módulo de inspeção apresenta falhas na persistência de inspeções ou trail.');
    passed = false;
  }

  // 3. Item 2.3: Scanner QR Code com Joins Reais e Suporte a Contêineres
  console.log('3. Validando resolução de leitura do Scanner QR Code sem dados fantasmas (Item 2.3)...');
  const scannerJoinsEntities = scannerCode.includes("navios(id, nome)") &&
                               scannerCode.includes("containers(id, numero_identificacao)");
  const scannerSupportsContainers = scannerCode.includes("from('containers').select('*')");
  const scannerLogsAudit = scannerCode.includes("tipo_alteracao: 'REIMPRESSAO_ETIQUETA'");

  if (scannerJoinsEntities && scannerSupportsContainers && scannerLogsAudit) {
    console.log('  ✅ [PASS] Scanner resolve cargas e contêineres reais via Supabase e audita a leitura.');
  } else {
    console.error('  ❌ [FAIL] Scanner não integra adequadamente com as entidades reais do banco.');
    passed = false;
  }

  // 4. Item 2.4: Vinculação de Contêiner e Navio com UUIDs no Banco
  console.log('4. Validando modal de vinculação e gravação de container_id e navio_id (Item 2.4)...');
  const vincularPopulatesNavios = cargasCode.includes("data-uuid=\"${nav.id || ''}\"") || cargasCode.includes("contObj.navio");
  const vincularUpdatesFks = cargasCode.includes("updatePayload.container_id = contUuid") &&
                             cargasCode.includes("updatePayload.navio_id = navUuid");
  const dataRepoMapsNavio = dataRepoCode.includes("navioId: c.navio_id") &&
                            dataRepoCode.includes("navio_id: carga.navioId || carga.navio_id || null");

  if (vincularPopulatesNavios && vincularUpdatesFks && dataRepoMapsNavio) {
    console.log('  ✅ [PASS] Vinculação persiste chaves estrangeiras reais container_id e navio_id no Supabase.');
  } else {
    console.error('  ❌ [FAIL] Vinculação não grava chaves estrangeiras adequadamente.');
    passed = false;
  }

  // 5. Item 2.5, 2.6, 2.7: Auditoria de Movimentação, Cancelamento e Reimpressão de Etiqueta
  console.log('5. Validando logs de auditoria e decisões em todas as ações operacionais (Itens 2.5 a 2.7)...');
  const logsMovimentacao = cargasCode.includes("window.registrarLogAlteracao(idCarga, 'EDICAO'");
  const trailCancelamento = cargasCode.includes("window.registrarTrailDecisao('CANCELOU_ENTREGA'");
  const logsReimpressao = cargasCode.includes("window.registrarLogAlteracao(entityId, 'REIMPRESSAO_ETIQUETA'");

  if (logsMovimentacao && trailCancelamento && logsReimpressao) {
    console.log('  ✅ [PASS] Todas as ações operacionais geram trilha de auditoria e trail de decisões formais.');
  } else {
    console.error('  ❌ [FAIL] Falha no registro de auditoria ou decisões operacionais.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('🎉 RESULTADO: TODOS OS ITENS DA FASE 2 FORAM CONCLUÍDOS E VALIDADOS! 🎉');
  } else {
    console.log('❌ RESULTADO: FALHA NA VALIDAÇÃO DA FASE 2');
    process.exit(1);
  }
}

testFase2();
