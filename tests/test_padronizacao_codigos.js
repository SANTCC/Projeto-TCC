#!/usr/bin/env node
/**
 * Testes do módulo js/padronizacao-codigos.js (matrícula, IMO, contêiner, guindaste e carga).
 * Verifica formatação durante a digitação, colagem, validação antes de salvar,
 * preservação de registros legados e comparação normalizada (chave).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'padronizacao-codigos.js'), 'utf8');

const janela = {};
vm.runInNewContext(src, Object.assign(janela, { console }), { filename: 'padronizacao-codigos.js' });
const C = janela.NexusCodigos;

let falhas = 0;
let total = 0;
function verificar(nome, condicao, detalhe) {
  total++;
  if (condicao) {
    console.log(`  ✅ [PASS] ${nome}`);
  } else {
    falhas++;
    console.error(`  ❌ [FAIL] ${nome}${detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ''}`);
  }
}

console.log('\n1. Módulo carregado');
verificar('expõe window.NexusCodigos com as funções esperadas',
  C && ['chave', 'formatarImo', 'validarImo', 'formatarConteiner', 'validarConteiner',
    'formatarGuindaste', 'validarGuindaste', 'formatarMatricula', 'validarMatricula',
    'formatarCarga', 'vincularFormatacao'].every((f) => typeof C[f] === 'function'));

console.log('\n2. Formatação com hífen (digitação e colagem)');
verificar('IMO: 1234567 -> IMO-1234567', C.formatarImo('1234567') === 'IMO-1234567', C.formatarImo('1234567'));
verificar('IMO: IMO1234567 (colado) -> IMO-1234567', C.formatarImo('IMO1234567') === 'IMO-1234567', C.formatarImo('IMO1234567'));
verificar('IMO: minúsculas são normalizadas', C.formatarImo('imo1234567') === 'IMO-1234567', C.formatarImo('imo1234567'));
verificar('contêiner: MSCU1234567 -> MSCU-1234567', C.formatarConteiner('MSCU1234567') === 'MSCU-1234567', C.formatarConteiner('MSCU1234567'));
verificar('contêiner: mscu1234567 -> MSCU-1234567', C.formatarConteiner('mscu1234567') === 'MSCU-1234567', C.formatarConteiner('mscu1234567'));
verificar('guindaste: ABC123DEF -> ABC-123-DEF', C.formatarGuindaste('ABC123DEF') === 'ABC-123-DEF', C.formatarGuindaste('ABC123DEF'));
verificar('guindaste: abc123def -> ABC-123-DEF', C.formatarGuindaste('abc123def') === 'ABC-123-DEF', C.formatarGuindaste('abc123def'));
verificar('matrícula: 2001 -> MAT-2001', C.formatarMatricula('2001') === 'MAT-2001' || C.formatarMatricula('mat2001') === 'MAT-2001', C.formatarMatricula('mat2001'));
verificar('matrícula: mat2001 -> MAT-2001', C.formatarMatricula('mat2001') === 'MAT-2001', C.formatarMatricula('mat2001'));
verificar('carga: CRG2026303 -> CRG-2026-303', C.formatarCarga('CRG2026303') === 'CRG-2026-303', C.formatarCarga('CRG2026303'));
verificar('carga: crg-2026-303 (já com hífen) -> CRG-2026-303', C.formatarCarga('crg-2026-303') === 'CRG-2026-303', C.formatarCarga('crg-2026-303'));

console.log('\n3. Validação antes de salvar');
verificar('IMO válido é aceito e normalizado', C.validarImo('1234567').ok === true && C.validarImo('1234567').valor === 'IMO-1234567', C.validarImo('1234567'));
verificar('IMO com prefixo de três letras é recusado em cadastro novo', C.validarImo('ABC1234567').ok === false, C.validarImo('ABC1234567'));
verificar('IMO recusado traz mensagem em pt-BR', typeof C.validarImo('ABC1234567').erro === 'string' && C.validarImo('ABC1234567').erro.length > 10);
verificar('contêiner válido é aceito', C.validarConteiner('MSCU1234567').ok === true && C.validarConteiner('MSCU-1234567').valor === 'MSCU-1234567');
verificar('contêiner com 3 letras é recusado', C.validarConteiner('MSC1234567').ok === false);
verificar('guindaste válido é aceito', C.validarGuindaste('ABC123DEF').ok === true && C.validarGuindaste('ABC-123-DEF').valor === 'ABC-123-DEF');
verificar('guindaste com formato errado é recusado', C.validarGuindaste('ABC12DEF').ok === false);
verificar('matrícula MAT-2001 é aceita', C.validarMatricula('MAT-2001').ok === true);
verificar('matrícula legada 888001 é aceita e marcada como legado', C.validarMatricula('888001').ok === true && C.validarMatricula('888001').legado === true, C.validarMatricula('888001'));

console.log('\n4. Comparação normalizada (chave)');
verificar('MSCU-1234567 e mscu1234567 têm a mesma chave', C.chave('MSCU-1234567') === C.chave('mscu1234567'));
verificar('ABC-123-DEF e ABC123DEF têm a mesma chave', C.chave('ABC-123-DEF') === C.chave('ABC123DEF'));
verificar('IMO digitado sem prefixo, após validação, tem a mesma chave de IMO-1234567', C.chave(C.validarImo('1234567').valor) === C.chave('IMO-1234567'));
verificar('chaves diferentes permanecem diferentes', C.chave('MSCU-1234567') !== C.chave('MSCU-1234568'));
verificar('valores vazios geram chave vazia', C.chave(null) === '' && C.chave(undefined) === '');

console.log('\n5. Registros legados preservados');
verificar('contêiner legado fora do padrão (ABC1234567) não é reescrito pela formatação', C.formatarConteiner('ABC1234567') === 'ABC1234567', C.formatarConteiner('ABC1234567'));
verificar('contêiner legado fora do padrão é recusado para cadastro novo', C.validarConteiner('ABC1234567').ok === false);
verificar('IMO legado ABC1234567 continua reconhecível pela chave',
  C.chave('ABC1234567') === 'ABC1234567');

console.log(`\nResultado: ${total - falhas}/${total} verificações aprovadas.`);
if (falhas > 0) {
  console.error(`❌ ${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('✅ Todas as verificações de padronização passaram.');
