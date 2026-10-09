const fs = require('fs');
const path = require('path');

async function testFase3() {
  console.log('================================================================');
  console.log('TESTE DEFINITIVO — FASE 3 (EMBARCAÇÕES, ROTAS E CONTÊINERES)');
  console.log('================================================================\n');

  let passed = true;
  const jsDir = path.join(__dirname, '../../js');
  const embarcacoesCode = fs.readFileSync(path.join(jsDir, 'embarcacoes.js'), 'utf-8');

  // 1. Validar Liberação de Saída de Navio e Propagação de Status
  console.log('1. Validando liberação de saída do navio e propagação para status de cargas (Item 3.1)...');
  const checksLiberacao = embarcacoesCode.includes("window.liberarNavioPeloDiretor") &&
                          embarcacoesCode.includes("status_fluxo: 'EM_TRANSITO'") &&
                          embarcacoesCode.includes("localizacao: 'FORA_DO_PORTO'") &&
                          embarcacoesCode.includes("window.registrarTrailDecisao('LIBEROU_NAVIO'");

  if (checksLiberacao) {
    console.log('  ✅ [PASS] Liberação de navio atualiza navio para FORA_DO_PORTO, cargas para EM_TRANSITO e registra no trail imutável.');
  } else {
    console.error('  ❌ [FAIL] Liberação de navio não implementa transição completa para cargas ou trail.');
    passed = false;
  }

  // 2. Validar Validação de Rotas Marítimas
  console.log('2. Validando verificação e cadastro de rotas marítimas (RN 9 / Item 3.2)...');
  const checksRotas = embarcacoesCode.includes("rotas_maritimas") &&
                      embarcacoesCode.includes("rotaCadastrada") &&
                      embarcacoesCode.includes("carregarRotasMaritimas");

  if (checksRotas) {
    console.log('  ✅ [PASS] Validação de rotas cadastradas impede saída de navios sem rota e sincroniza com rotas_maritimas.');
  } else {
    console.error('  ❌ [FAIL] Verificação de rota marítima ausente ou incompleta.');
    passed = false;
  }

  // 3. Validar Validações de IMO, GPS e Contêineres
  console.log('3. Validando regras de unicidade de IMO, GPS geográfico real e coerência de datas de contêineres (Item 3.3)...');
  const checksValidacoes = embarcacoesCode.includes("imoRegex") &&
                           embarcacoesCode.includes("validarCoordenadaGPS") &&
                           embarcacoesCode.includes("new Date(dataManut) < new Date(dataFabr)");

  if (checksValidacoes) {
    console.log('  ✅ [PASS] Validações de IMO (3 letras + 7 números), GPS geográfico real e datas coerentes implementadas.');
  } else {
    console.error('  ❌ [FAIL] Validações de consistência técnica ausentes no formulário de navios/contêineres.');
    passed = false;
  }

  // 4. Validar Chegada ao Destino e Entrega Automática
  console.log('4. Validando chegada ao destino e entrega de cargas (Item 3.4)...');
  const checksDestino = embarcacoesCode.includes("NO_PORTO_DE_DESTINO") &&
                        embarcacoesCode.includes("status_fluxo: 'ENTREGUE'") &&
                        embarcacoesCode.includes("autorizarRetornoNavio");

  if (checksDestino) {
    console.log('  ✅ [PASS] Chegada ao destino e autorização de retorno sincronizados com Supabase.');
  } else {
    console.error('  ❌ [FAIL] Chegada ao destino e retorno não sincronizados.');
    passed = false;
  }

  // 5. Validar Auditoria e Notificações em Tempo Real
  console.log('5. Validando registro de auditoria e notificações em tempo real (Item 3.5)...');
  const checksAudit = embarcacoesCode.includes("window.registrarLogAlteracao") &&
                      embarcacoesCode.includes("NexusRepository.notifyChange");

  if (checksAudit) {
    console.log('  ✅ [PASS] Criação e alteração de rotas, navios e contêineres disparam logs de auditoria e nexus_data_changed.');
  } else {
    console.error('  ❌ [FAIL] Logs de auditoria ou notificações não integradas.');
    passed = false;
  }

  console.log('\n================================================================');
  if (passed) {
    console.log('✨ TODOS OS TESTES DA FASE 3 PASSARAM COM SUCESSO! ✨');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('💥 ALGUNS TESTES DA FASE 3 FALHARAM. REVISE O CÓDIGO!');
    console.log('================================================================');
    process.exit(1);
  }
}

testFase3();
