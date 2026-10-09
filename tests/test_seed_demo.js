#!/usr/bin/env node
/**
 * TESTE — SEED DE DEMONSTRAÇÃO (Backlog 3, itens C e D): estrutura do supabase/seed.sql
 * ------------------------------------------------------------
 *   1. Configurado no supabase/config.toml ([db.seed]) e separado das migrações e do código.
 *   2. Aviso de uso: somente demonstração e desenvolvimento local; nunca produção.
 *   3. Só inserções: nenhum DELETE, UPDATE, TRUNCATE, DROP ou ALTER. Todo INSERT tem ON CONFLICT.
 *   4. Usuários mock: 2 por cargo do enum cargo_enum, nomes [CARGO]_mock123 e [CARGO]_mock321.
 *   5. Dados de demonstração com o prefixo/marcador DEMO e chaves estrangeiras resolvidas pelo banco.
 *   6. Cobertura: os 9 status do fluxo e os tipos de histórico usados existem no schema.
 *
 * A execução contra PostgreSQL (contagens, idempotência e dados preservados) fica em
 * tests/verify_seed_demo.py (requer pgserver).
 *
 * Uso: node tests/test_seed_demo.js
 */
const path = require('path');
const { ROOT, read, log, check, resumo } = require('./webmcp-harness');

const SEED = 'supabase/seed.sql';

function enumDoSchema(nome) {
  const schema = read('SPECs/schema.sql');
  const m = new RegExp(`create type ${nome} as enum \\(([\\s\\S]*?)\\);`, 'i').exec(schema);
  if (!m) return [];
  return Array.from(m[1].matchAll(/'([A-Z_]+)'/g)).map((x) => x[1]);
}

function testarConfiguracao(seed) {
  log('\n[1] Configuração e separação');
  const toml = read('supabase/config.toml');
  check('config.toml registra o seed em [db.seed]', /\[db\.seed\][\s\S]*?enabled\s*=\s*true[\s\S]*?sql_paths\s*=\s*\["\.\/seed\.sql"\]/.test(toml));
  const migracoes = require('fs').readdirSync(path.join(ROOT, 'supabase/migrations'));
  check('o seed não é uma migração (produção não recebe dados de demonstração)',
    !migracoes.some((f) => /seed/i.test(f)));
  check('o seed fica fora do código da aplicação (supabase/, não js/)', !require('fs').existsSync(path.join(ROOT, 'js', 'seed.sql')));
  check('o seed existe no caminho configurado', seed.length > 2000, `${seed.length} caracteres`);
}

function testarAviso(seed) {
  log('\n[2] Aviso de uso');
  const cabecalho = seed.split('\n').slice(0, 25).join('\n');
  check('cabeçalho diz que são dados fictícios de demonstração', /dados fictícios para demonstração/i.test(cabecalho));
  check('cabeçalho proíbe aplicar em produção', /NÃO aplicar em produção/.test(cabecalho));
  check('cabeçalho diz que o seed não apaga nem altera dados existentes', /não apaga, não altera e não trunca/.test(cabecalho));
  check('cabeçalho traz as duas formas de aplicar (local e remoto)', /supabase db reset/.test(cabecalho) && /psql/.test(cabecalho));
}

function testarSoInsercoes(seed) {
  log('\n[3] Só inserções, idempotentes');
  const semComentarios = seed.replace(/--[^\n]*/g, '');
  ['delete', 'truncate', 'drop', 'alter', 'update'].forEach((palavra) => {
    check(`sem comando ${palavra.toUpperCase()}`, !new RegExp(`\\b${palavra}\\b`, 'i').test(semComentarios));
  });
  const inserts = (semComentarios.match(/\binsert into\b/gi) || []).length;
  const conflitos = (semComentarios.match(/\bon conflict\b[^;]*do nothing/gi) || []).length;
  check(`todo INSERT tem ON CONFLICT ... DO NOTHING (${inserts} inserts, ${conflitos} cláusulas)`,
    inserts > 0 && inserts === conflitos);
  const idsNaoDeterministicos = (semComentarios.match(/gen_random_uuid\(\)/gi) || []).length;
  check('ids são determinísticos (md5), para a reexecução não duplicar', idsNaoDeterministicos === 0);
}

function testarUsuariosMock(seed) {
  log('\n[4] Usuários mock: 2 por cargo');
  const cargos = enumDoSchema('cargo_enum');
  check('o schema tem os 10 cargos', cargos.length === 10, `${cargos.length}`);
  // Seção C do seed: só os INSERTs de funcionarios (os logs citam os mesmos códigos e não entram aqui).
  const secaoC = seed.slice(seed.indexOf('insert into funcionarios'), seed.indexOf('insert into tipos_carga'));
  const linhas = secaoC.split('\n').filter((l) => /md5\('demo-func-/.test(l));
  check('20 linhas de usuário mock no INSERT de funcionarios', linhas.length === 20, `${linhas.length}`);
  const nomes = Array.from(secaoC.matchAll(/'([A-Z_]+)_mock(\d+)'/g)).map((m) => ({ cargo: m[1], numero: m[2] }));
  check('nomes seguem [CARGO]_mock123 ou [CARGO]_mock321', nomes.length === 20 && nomes.every((n) => n.numero === '123' || n.numero === '321'));
  const semCargo = cargos.filter((c) => nomes.filter((n) => n.cargo === c).length !== 2);
  check('cada cargo do enum tem exatamente 2 usuários mock', semCargo.length === 0, semCargo.join(', '));
  const codigos = new Set(Array.from(secaoC.matchAll(/'MOCK-([A-Z_]+)-(\d+)'/g)).map((m) => m[0]));
  check('20 códigos individuais distintos no formato MOCK-[CARGO]-[NUMERO]', codigos.size === 20, `${codigos.size}`);
  check('usuários mock entram ativos (último campo = true)', linhas.every((l) => /, true\),?$/.test(l.trim())));
  check('a tabela de usuários recebe só os campos sem e-mail ou telefone',
    /insert into funcionarios \(id, matricula, codigo_individual, nome, cargo, ativo\)/.test(seed));
}

function testarDadosDeDemonstracao(seed) {
  log('\n[5] Dados de demonstração identificáveis');
  check('navios com IMO de demonstração (9990001–9990004)', /'9990001'/.test(seed) && /'9990004'/.test(seed));
  const secaoContainers = seed.slice(seed.indexOf('insert into containers'), seed.indexOf('insert into cargas'));
  check('6 contêineres com número DEMO (ISO-like, 7 dígitos)', (secaoContainers.match(/'DEMO\d{7}'/g) || []).length === 6);
  check('cargas com QR de demonstração (QR-DEMO-CRG-001…012)', /'QR-DEMO-CRG-001'/.test(seed) && /'QR-DEMO-CRG-012'/.test(seed));
  check('navios com QR de demonstração', (seed.match(/'QR-DEMO-NAV-00\d'/g) || []).length === 4);
  check('distâncias das rotas declaradas como aproximadas (demonstração)', /aproximadas, apenas para demonstração/.test(seed));
  check('histórico de demonstração usa usuários mock (MOCK-)', (seed.match(/'MOCK-[A-Z_]+-\d+'/g) || []).length >= 27);
  const estadosUsados = Array.from(seed.matchAll(/'(OPERANTE|AGENDADO_PARA_REFORMA|EM_REFORMA|APROVADO_PARA_REFORMA)'/g)).map((m) => m[1]);
  check('estados de contêiner usados existem no enum', estadosUsados.every((e) => enumDoSchema('estado_container_enum').includes(e)));
  const statusUsados = new Set(Array.from(seed.matchAll(/'(AGENDAMENTO|RECEBIMENTO_INSPECAO|ARMAZENAGEM|PRONTA_PARA_ENTREGA|SAIDA|EM_TRANSITO|ENTREGUE|CANCELADA|RECUSADA)'/g)).map((m) => m[1]));
  const statusEnum = enumDoSchema('status_carga_enum');
  check('os 9 status do fluxo aparecem no seed', statusEnum.every((s) => statusUsados.has(s)),
    statusEnum.filter((s) => !statusUsados.has(s)).join(', '));
  check('tipos de alteração do histórico existem no enum', ['CRIACAO', 'EDICAO', 'EXPORTACAO', 'REIMPRESSAO_ETIQUETA']
    .every((t) => enumDoSchema('tipo_alteracao_enum').includes(t)));
  check('tipos de entidade do histórico existem no enum', ['NAVIO', 'CONTAINER', 'CARGA']
    .every((t) => enumDoSchema('tipo_entidade_enum').includes(t)));
  check('rotas e navios usam o mesmo nome de porto de origem (Santos (BRSSZ))', (seed.match(/'Santos \(BRSSZ\)'/g) || []).length >= 4);
}

function testarDocumentacao() {
  log('\n[6] Documentação');
  const readme = read('README.md');
  check('README explica o seed e os códigos de acesso dos mocks', /MOCK-\[CARGO\]/.test(readme) || /supabase\/seed\.sql/.test(readme));
  check('README avisa que o seed não é para produção', /seed[\s\S]{0,300}produ/i.test(readme));
  const backlog = read('SPECs/backlog3.md');
  check('backlog3 registra o status de C e D', /## Popular cargos ✅ IMPLEMENTADO/.test(backlog) && /## Popular ações ✅ IMPLEMENTADO/.test(backlog));
  check('verificação em PostgreSQL existe', require('fs').existsSync(path.join(ROOT, 'tests', 'verify_seed_demo.py')));
}

(function main() {
  log('\n=== Seed de demonstração (Backlog 3 — C e D) ===');
  const seed = read(SEED);
  testarConfiguracao(seed);
  testarAviso(seed);
  testarSoInsercoes(seed);
  testarUsuariosMock(seed);
  testarDadosDeDemonstracao(seed);
  testarDocumentacao();
  const { total, falhas } = resumo();
  log(`\nResultado: ${total - falhas} aprovado(s), ${falhas} falha(s).`);
  process.exit(falhas > 0 ? 1 : 0);
})();
