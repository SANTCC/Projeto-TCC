#!/usr/bin/env node
/** Regressões da saída do navio: persistência remota antes do cache e sem entrega indevida. */
const fs = require('fs');
const path = require('path');
const fonte = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'embarcacoes.js'), 'utf8');
let falhas = 0;
function check(nome, ok) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas += 1; console.error(`❌ ${nome}`); }
}
const inicio = fonte.indexOf('window.liberarNavioPeloDiretor = async function');
const fim = fonte.indexOf('// Autorização de retorno do navio ao porto de origem', inicio);
const liberar = inicio >= 0 && fim > inicio ? fonte.slice(inicio, fim) : '';
const posUpdate = liberar.indexOf(".from('navios')");
const posEstadoLocal = liberar.indexOf("navio.localizacao = navioAtualizado.localizacao");
const posCache = liberar.indexOf("localStorage.setItem('nexus_navios_list'");

check('função de liberação existe', Boolean(liberar));
check('operação sem Supabase é bloqueada', liberar.includes('if (!window.nexusSupabase)'));
check('UUID do navio é validado', liberar.includes('UUID_NAVIO_RE.test(String(navio.id))'));
check('update usa a chave primária do navio', liberar.includes(".eq('id', navio.id)"));
check('compare-and-set exige navio ainda dentro do porto', liberar.includes(".eq('localizacao', 'DENTRO_DO_PORTO')"));
check('resposta do update é solicitada e validada', liberar.includes(".select('id, localizacao, data_saida')") && liberar.includes('if (error) throw error'));
check('estado local muda somente depois do update remoto', posUpdate >= 0 && posEstadoLocal > posUpdate);
check('cache muda somente depois do update remoto', posUpdate >= 0 && posCache > posUpdate);
check('saída não marca cargas como ENTREGUE', !liberar.includes("c.status = 'ENTREGUE'"));
check('saída não remove vínculo da carga', !liberar.includes("c.navio = ''") && !liberar.includes('c.navio_id = null'));
check('cargas elegíveis passam para EM_TRANSITO', liberar.includes("status_fluxo: 'EM_TRANSITO'") && liberar.includes("c.status = 'EM_TRANSITO'"));
check('falha de berço tenta reverter o navio', liberar.includes("localizacao: 'DENTRO_DO_PORTO', data_saida: null"));
check('carregamento não inventa saída de dois dias atrás', !fonte.includes('Date.now() - 86400000 * 2'));
const inicioRetorno = fonte.indexOf('window.autorizarRetornoNavio = async function');
const fimRetorno = fonte.indexOf('// Selecionar próxima rota', inicioRetorno);
const retorno = inicioRetorno >= 0 && fimRetorno > inicioRetorno ? fonte.slice(inicioRetorno, fimRetorno) : '';
check('retorno não usa a variável removida idsCargasDesvinc', !retorno.includes('idsCargasDesvinc'));
check('ETA sem data persistida é explicitamente indisponível', fonte.includes('ETA indisponível: horário de saída não registrado'));
check('chegada usa UUID e compare-and-set no Supabase', fonte.includes('async function confirmarChegadaNavio') && fonte.includes(".eq('localizacao', 'FORA_DO_PORTO')"));
check('chegada local só ocorre após confirmação remota', fonte.includes('if (!registro || registro.localizacao !== novaLocalizacao) return;') && fonte.includes('navio.localizacao = registro.localizacao'));

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('\n17 verificações passaram.');
