#!/usr/bin/env node
/**
 * Regressão: exclusão de funcionário (NexusRepository.deleteFuncionario).
 *
 * Verifica, contra o banco simulado (tests/fake-supabase-db.js):
 *   - funcionário sem vínculos é excluído no banco e o retorno é ok:true;
 *   - estivador com carga ativa (estivador_cargas) bloqueia a exclusão, sem apagar nada;
 *   - Tarefa 1 (Backlog Parte 2): funcionário de OUTRO cargo (ex.: Técnico em
 *     Portos — o caso "João Técnico") com linha legada em estivador_cargas NÃO
 *     é bloqueado "como estivador": é excluído e o vínculo indevido é desfeito;
 *   - estivador só com cargas finalizadas (ENTREGUE) não fica bloqueado para
 *     sempre: é excluído, o vínculo operacional é desfeito e a carga fica;
 *   - quem agendou cargas (agendamentos.agendado_por, RESTRICT) é bloqueado
 *     com a justificativa correta (histórico), nunca "como estivador";
 *   - delegação de supervisão bloqueia a exclusão, sem apagar nada;
 *   - recusa do banco por vínculo RESTRICT (23503) vira erro e não remove nada;
 *   - falha de leitura ou de conexão vira erro (nunca "sucesso");
 *   - matrícula inexistente no banco é tratada como já removida;
 *   - origem (cargas.js): estivador_cargas só é gravado para responsável
 *     ESTIVADOR; o responsável continua em agendamentos.agendado_por.
 *
 * Executar: node tests/test_exclusao_funcionario.js
 */
const fs = require('fs');
const path = require('path');
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, criarJanela, prontoDom } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const FUNC1 = '33333333-0000-0000-0000-000000000001';
const FUNC2 = '33333333-0000-0000-0000-000000000002';
const FUNC3 = '33333333-0000-0000-0000-000000000003';
const FUNC4 = '33333333-0000-0000-0000-000000000004';
const FUNC5 = '33333333-0000-0000-0000-000000000005';
const FUNC6 = '33333333-0000-0000-0000-000000000006';
const FUNC7 = '33333333-0000-0000-0000-000000000007';

function bancoBase(opcoes, extras) {
  const tabelas = {
    funcionarios: [
      { id: FUNC1, matricula: 'MAT-0001', nome: 'Sem Vínculo', cargo: 'CONFERENTE_CARGA' },
      { id: FUNC2, matricula: 'MAT-0002', nome: 'Estivador', cargo: 'ESTIVADOR' },
      { id: FUNC3, matricula: 'MAT-0003', nome: 'Supervisor', cargo: 'SUPERVISOR_GERENTE_OPERACOES' },
      { id: FUNC4, matricula: 'MAT-0004', nome: 'Restrito', cargo: 'SUPERVISOR_GERENTE_OPERACOES' },
      // Caso "João Técnico": Técnico em Portos com atribuição legada em
      // estivador_cargas (era o responsável pelo agendamento, não estivador).
      { id: FUNC5, matricula: 'MAT-0005', nome: 'João Técnico', cargo: 'TECNICO_PORTOS' },
      { id: FUNC6, matricula: 'MAT-0006', nome: 'Estivador Histórico', cargo: 'ESTIVADOR' },
      { id: FUNC7, matricula: 'MAT-0007', nome: 'Técnico Agendador', cargo: 'TECNICO_PORTOS' }
    ],
    cargas: [
      { id: 'carga-ativa', qr_code_url: 'QR-CRG-ATIVA', status_fluxo: 'ARMAZENAGEM' },
      { id: 'carga-entregue', qr_code_url: 'QR-CRG-ENTREGUE', status_fluxo: 'ENTREGUE' }
    ],
    estivador_cargas: [
      { id: 'ec-1', estivador_id: FUNC2, carga_id: 'carga-ativa' },
      { id: 'ec-2', estivador_id: FUNC5, carga_id: 'carga-ativa' },
      { id: 'ec-3', estivador_id: FUNC6, carga_id: 'carga-entregue' }
    ],
    agendamentos: [
      { id: 'ag-1', carga_id: 'carga-ativa', agendado_por: FUNC7, data_prevista_entrega: '2026-10-20' }
    ],
    delegacoes_supervisor: [{ id: 'dg-1', supervisor_titular_id: FUNC3, substituto_id: null }],
    manutencoes: [],
    historico_manutencoes: []
  };
  if (extras) Object.keys(extras).forEach(k => { tabelas[k] = extras[k]; });
  return criarBancoFalso(tabelas, opcoes);
}

async function repositorio(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/tecnico_portos.html',
    html: '<!doctype html><html><head></head><body></body></html>',
    storage: { nexus_func_list: [{ matricula: 'MAT-0001' }, { matricula: 'MAT-0002' }, { matricula: 'MAT-0005' }] },
    scripts: [
      (win) => { win.nexusSupabase = banco; },
      'js/data-repository.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(50);
  return janela.w;
}

const existe = (banco, mat) => banco.tabelas.funcionarios.some(f => f.matricula === mat);

async function main() {
  log('1. Funcionário sem vínculos: excluído no banco');
  let banco = bancoBase();
  let w = await repositorio(banco);
  let r = await w.NexusRepository.deleteFuncionario('MAT-0001');
  check('retorna ok', r && r.ok === true, JSON.stringify(r));
  check('linha removida do banco', !existe(banco, 'MAT-0001'));
  check('cache local limpo', !JSON.parse(w.localStorage.getItem('nexus_func_list')).some(f => f.matricula === 'MAT-0001'));

  log('\n2. Estivador com carga ativa: bloqueado com justificativa, nada apagado');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0002');
  check('retorna erro com bloqueio', r.ok === false && r.bloqueio === true, JSON.stringify(r));
  check('mensagem cita cargas ativas como estivador', /carga\(s\) ativa\(s\) como estivador/.test(r.erro || ''), r.erro);
  check('funcionário preservado', existe(banco, 'MAT-0002'));
  check('vínculos de carga preservados', banco.tabelas.estivador_cargas.length === 3);

  log('\n3. Delegação de supervisão: bloqueada, nada apagado');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0003');
  check('retorna erro com bloqueio', r.ok === false && r.bloqueio === true, JSON.stringify(r));
  check('funcionário preservado', existe(banco, 'MAT-0003'));
  check('delegação preservada', banco.tabelas.delegacoes_supervisor.length === 1);

  log('\n4. Banco recusa por vínculo RESTRICT (23503): erro, nada removido localmente');
  banco = bancoBase(undefined, undefined);
  w = await repositorio(banco);
  const origFrom = banco.from.bind(banco);
  banco.from = (tabela) => {
    const b = origFrom(tabela);
    if (tabela !== 'funcionarios') return b;
    return { ...b, select: b.select, eq: b.eq, delete: () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: '23503', message: 'update or delete violates foreign key constraint' } }) }) }) };
  };
  r = await w.NexusRepository.deleteFuncionario('MAT-0004');
  check('retorna erro com bloqueio', r.ok === false && r.bloqueio === true, JSON.stringify(r));
  check('mensagem informa registros vinculados', /vinculad/.test(r.erro || ''), r.erro);

  log('\n5. Falhas de conexão/leitura: erro, nunca sucesso');
  banco = bancoBase({ falharOp: { funcionarios: ['delete'] } });
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0001');
  check('falha de DELETE retorna erro', r.ok === false && r.bloqueio !== true, JSON.stringify(r));
  check('funcionário segue no banco', existe(banco, 'MAT-0001'));
  banco = bancoBase({ falhar: ['funcionarios'] });
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0001');
  check('falha de leitura retorna erro', r.ok === false, JSON.stringify(r));
  w.nexusSupabase = null;
  r = await w.NexusRepository.deleteFuncionario('MAT-0001');
  check('sem conexão retorna erro', r.ok === false && /Sem conexão/.test(r.erro || ''), JSON.stringify(r));

  log('\n6. Matrícula inexistente no banco: tratada como já removida');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-9999');
  check('retorna ok com removido 0', r.ok === true && r.removido === 0, JSON.stringify(r));

  log('\n7. Tarefa 1 — "João Técnico" (TECNICO_PORTOS) com vínculo legado em estivador_cargas: NÃO bloqueia como estivador');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0005');
  check('retorna ok (excluído)', r && r.ok === true && r.removido === 1, JSON.stringify(r));
  check('funcionário removido do banco', !existe(banco, 'MAT-0005'));
  check('vínculo indevido em estivador_cargas desfeito', !banco.tabelas.estivador_cargas.some(v => v.estivador_id === FUNC5));
  check('demais vínculos preservados', banco.tabelas.estivador_cargas.length === 2);
  check('carga NÃO foi apagada junto', banco.tabelas.cargas.some(c => c.id === 'carga-ativa'));

  log('\n8. Estivador só com carga finalizada (ENTREGUE): não fica bloqueado para sempre');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0006');
  check('retorna ok (excluído)', r && r.ok === true && r.removido === 1, JSON.stringify(r));
  check('funcionário removido do banco', !existe(banco, 'MAT-0006'));
  check('vínculo operacional desfeito', !banco.tabelas.estivador_cargas.some(v => v.estivador_id === FUNC6));
  check('carga entregue (histórico) preservada', banco.tabelas.cargas.some(c => c.id === 'carga-entregue' && c.status_fluxo === 'ENTREGUE'));

  log('\n9. Quem agendou cargas: bloqueio correto é o histórico (agendado_por), não "estivador"');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0007');
  check('retorna erro com bloqueio', r.ok === false && r.bloqueio === true, JSON.stringify(r));
  check('mensagem cita agendamento/histórico', /agendamento/.test(r.erro || ''), r.erro);
  check('mensagem NÃO o chama de estivador', !/como estivador/.test(r.erro || ''), r.erro);
  check('funcionário preservado', existe(banco, 'MAT-0007'));
  check('agendamento preservado', banco.tabelas.agendamentos.length === 1);

  log('\n10. Origem (cargas.js): estivador_cargas só para responsável ESTIVADOR');
  const cargasJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'cargas.js'), 'utf8');
  check('existe o guarda de cargo ehCargoEstivador', /function ehCargoEstivador/.test(cargasJs));
  check('upsert em estivador_cargas exige responsavelEhEstivador', /responsavelEhEstivador && estivadorResp/.test(cargasJs));
  check('responsável continua registrado em agendamentos.agendado_por', /agendado_por: estivadorResp/.test(cargasJs));
  check('carga local só expõe estivador se for ESTIVADOR', /estivador: responsavelEhEstivador && estivadorResp/.test(cargasJs));

  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
