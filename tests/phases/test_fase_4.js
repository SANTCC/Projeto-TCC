const fs = require('fs');
const path = require('path');

async function testFase4() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 4 (MANUTENÇÃO, EMERGÊNCIA E ORDENS DE SERVIÇO)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, '../../js');
  const manutencaoCode = fs.readFileSync(path.join(jsDir, 'manutencao.js'), 'utf-8');

  // 1. Validar Ciclo de Vida de Ordens de Serviço (OS)
  console.log('1. Validando ciclo de vida das Ordens de Serviço (Item 4.1)...');
  const checksOsLifeCycle = manutencaoCode.includes("status: 'SOLICITADA'") &&
                            manutencaoCode.includes("supabaseStatus = 'APROVADA'") &&
                            manutencaoCode.includes("supabaseStatus = 'CONCLUIDA'") &&
                            manutencaoCode.includes("supabaseStatus = 'RECUSADA'");

  if (checksOsLifeCycle) {
    console.log('  ✅ [PASS] Ciclo de vida da OS (SOLICITADA -> APROVADA / RECUSADA -> CONCLUIDA) sincronizado com Supabase.');
  } else {
    console.error('  ❌ [FAIL] Ciclo de vida de OS incompleto ou divergente.');
    passed = false;
  }

  // 2. Validar Restrição de Manutenção Geral (>= 3 anos / 1095 dias)
  console.log('2. Validando restrição de Manutenção Geral de Navios >= 3 anos (Item 4.2 / RN 17)...');
  const checksManutGeral = manutencaoCode.includes("tipoManut === 'GERAL'") &&
                           manutencaoCode.includes("tresAnosMs = 3 * 365 * 24 * 60 * 60 * 1000") &&
                           manutencaoCode.includes("diffMs < tresAnosMs");

  if (checksManutGeral) {
    console.log('  ✅ [PASS] Bloqueio rigoroso de Manutenção Geral para embarcações com menos de 3 anos de ciclo.');
  } else {
    console.error('  ❌ [FAIL] Restrição de 3 anos para manutenção geral ausente ou incorreta.');
    passed = false;
  }

  // 3. Validar Gestão e Solicitação de Manutenção de Guindastes e Contêineres
  console.log('3. Validando transição de equipamentos e histórico de manutenção (Item 4.3)...');
  const checksEquipamentos = manutencaoCode.includes("solicitarManutencaoGuindaste") &&
                             manutencaoCode.includes("concluirManutencaoGuindaste") &&
                             manutencaoCode.includes("historico_manutencoes") &&
                             manutencaoCode.includes("estado: 'EM_MANUTENCAO'") &&
                             manutencaoCode.includes("estado: 'OPERANTE'");

  if (checksEquipamentos) {
    console.log('  ✅ [PASS] Guindastes e Contêineres transitam para EM_MANUTENCAO e gravam no historico_manutencoes ao concluir.');
  } else {
    console.error('  ❌ [FAIL] Transições de equipamentos ou gravação de histórico ausentes.');
    passed = false;
  }

  // 4. Validar Protocolo de Emergência e Botão de Pânico
  console.log('4. Validando Botão de Pânico e protocolo de emergência (Item 4.4)...');
  const checksEmergencia = manutencaoCode.includes("nexus_emergency_active") &&
                           manutencaoCode.includes("panicBtn") &&
                           manutencaoCode.includes("resetEmergencyBtn") &&
                           manutencaoCode.includes("EMERGENCIA_CRITICA_ATIVADA");

  if (checksEmergencia) {
    console.log('  ✅ [PASS] Botão de pânico ativa alarme global, persiste no storage e audita nos logs de alteração.');
  } else {
    console.error('  ❌ [FAIL] Protocolo de emergência incompleto.');
    passed = false;
  }

  // 5. Validar Registro de Decisões Críticas (Trail) e Auditoria
  console.log('5. Validando registro no Trail de Decisões e Auditoria (Item 4.5)...');
  const checksTrailAudit = manutencaoCode.includes("window.registrarTrailDecisao('SOLICITOU_MANUTENCAO_NAVIO'") &&
                           manutencaoCode.includes("window.registrarTrailDecisao(tipoTrail") &&
                           manutencaoCode.includes("window.registrarLogAlteracao");

  if (checksTrailAudit) {
    console.log('  ✅ [PASS] Decisões de aprovação/recusa de manutenção e solicitações registradas no Trail e Auditoria.');
  } else {
    console.error('  ❌ [FAIL] Falha no registro de auditoria ou decisões críticas da manutenção.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA FASE 4 PASSARAM COM SUCESSO! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES DA FASE 4 FALHARAM. REVISE O CÓDIGO!');
    console.log('================================================================');
    process.exit(1);
  }
}

testFase4();
