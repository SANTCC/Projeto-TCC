#!/usr/bin/env node
/**
 * Regressão: exclusão de funcionário (NexusRepository.deleteFuncionario).
 *
 * Verifica, contra o banco simulado (tests/fake-supabase-db.js):
 *   - funcionário sem vínculos é excluído no banco e o retorno é ok:true;
 *   - vínculo de estivador (estivador_cargas, CASCADE) bloqueia a exclusão, sem apagar nada;
 *   - delegação de supervisão (CASCADE) bloqueia a exclusão, sem apagar nada;
 *   - recusa do banco por vínculo RESTRICT (23503) vira erro e não remove nada;
 *   - falha de leitura ou de conexão vira erro (nunca "sucesso");
 *   - matrícula inexistente no banco é tratada como já removida.
 *
 * Executar: node tests/test_exclusao_funcionario.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, criarJanela, prontoDom } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const FUNC1 = '33333333-0000-0000-0000-000000000001';
const FUNC2 = '33333333-0000-0000-0000-000000000002';
const FUNC3 = '33333333-0000-0000-0000-000000000003';
const FUNC4 = '33333333-0000-0000-0000-000000000004';

function bancoBase(opcoes, extras) {
  const tabelas = {
    funcionarios: [
      { id: FUNC1, matricula: 'MAT-0001', nome: 'Sem Vínculo' },
      { id: FUNC2, matricula: 'MAT-0002', nome: 'Estivador' },
      { id: FUNC3, matricula: 'MAT-0003', nome: 'Supervisor' },
      { id: FUNC4, matricula: 'MAT-0004', nome: 'Restrito' }
    ],
    estivador_cargas: [{ id: 'ec-1', estivador_id: FUNC2, carga_id: 'carga-1' }],
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
    storage: { nexus_func_list: [{ matricula: 'MAT-0001' }, { matricula: 'MAT-0002' }] },
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

  log('\n2. Vínculo de estivador: bloqueado com justificativa, nada apagado');
  banco = bancoBase();
  w = await repositorio(banco);
  r = await w.NexusRepository.deleteFuncionario('MAT-0002');
  check('retorna erro com bloqueio', r.ok === false && r.bloqueio === true, JSON.stringify(r));
  check('mensagem cita cargas', /carga/.test(r.erro || ''), r.erro);
  check('funcionário preservado', existe(banco, 'MAT-0002'));
  check('vínculo de carga preservado', banco.tabelas.estivador_cargas.length === 1);

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
    return { ...b, select: b.select, eq: b.eq, delete: () => ({ eq: async () => ({ data: null, error: { code: '23503', message: 'update or delete violates foreign key constraint' } }) }) };
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

  process.exit(resumo().falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
