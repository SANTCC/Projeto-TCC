#!/usr/bin/env node
/**
 * TESTE — LOCALIZAÇÃO DE BLOCOS INLINE NO BUILD (tools/build.js)
 * --------------------------------------------------------------
 * O build minifica o conteúdo dos blocos <script> e <style> inline e injeta o
 * gate de VPN antes de </head> e de </body>. Até aqui esses pontos eram
 * achados com expressão regular, e regex não entende HTML. Três casos reais
 * que a regex errava, e que este teste trava:
 *
 *   1. um "<script>" dentro de comentário HTML (frequente em rascunho de
 *      página) era tratado como bloco de verdade e ia para o compressor;
 *   2. um atributo com ">" no valor, como <script data-x="a>b">, fazia a
 *      regex capturar `b">var y = 1;` como se fosse código — o build quebrava
 *      com "erro de sintaxe em <script> inline" num HTML perfeitamente válido;
 *   3. uma string com "</script>" cortava o bloco no meio.
 *
 * O build agora localiza esses pontos com o parse5 (parser do WHATWG, o mesmo
 * do jsdom), mas continua reescrevendo o arquivo por recorte a partir dos
 * deslocamentos: o HTML nunca é re-serializado, então nada além do trecho
 * alterado muda um byte.
 *
 * Uso: node tests/test_build_html.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo } = H;
const { internos } = require('../tools/build.js');
const { analisarHtml, minificarScriptsInline, minificarEstilosInline, aplicarVpnGate } = internos;

/** Envolve um trecho no mínimo de documento que o parse5 precisa. */
const pagina = (corpo, cabeca = '') =>
  `<!DOCTYPE html>\n<html lang="pt-BR">\n<head>${cabeca}</head>\n<body>\n${corpo}\n</body>\n</html>\n`;

/** Blocos de um HTML, no formato "tag:conteúdo" para comparar com facilidade. */
const blocosDe = (html) =>
  analisarHtml(html).blocos.map((b) => `${b.tag}:${b.conteudo}`);

(async () => {
  log('TESTE — localização de blocos inline no build (parse5)\n');

  log('[1] <script> dentro de comentário HTML é ignorado');
  {
    const html = pagina('<!-- <script>var fantasma = 1;</script> -->\n<script>var real = 2;</script>');
    check(
      'só o bloco de verdade é encontrado',
      JSON.stringify(blocosDe(html)) === JSON.stringify(['script:var real = 2;']),
      JSON.stringify(blocosDe(html))
    );
    const registro = { js: [], css: [] };
    const saida = await minificarScriptsInline(html, registro, 'teste');
    check('o bloco comentado continua intacto no arquivo', saida.includes('<!-- <script>var fantasma = 1;</script> -->'));
    check('o bloco comentado não é minificado', !saida.includes('fantasma=1'));
    check('o bloco de verdade é minificado', saida.includes('var real=2'), saida);
    check('nenhum outro byte do arquivo mudou', saida.split('\n').length === html.split('\n').length);
  }

  log('\n[2] atributo com ">" no valor não engana o parser');
  {
    const html = pagina('<script data-x="a>b">var y = 1;</script>');
    // A regex antiga capturava `b">var y = 1;` aqui e o build falhava com
    // "erro de sintaxe em <script> inline" num HTML válido.
    check(
      'o conteúdo capturado é só o código',
      JSON.stringify(blocosDe(html)) === JSON.stringify(['script:var y = 1;']),
      JSON.stringify(blocosDe(html))
    );
    const registro = { js: [], css: [] };
    const saida = await minificarScriptsInline(html, registro, 'teste');
    check('o atributo original é preservado', saida.includes('<script data-x="a>b">var y=1;</script>'), saida);
    check('o script é contabilizado no relatório de tamanho', registro.js.length === 1);
  }

  log('\n[3] <style> dentro de comentário também é ignorado');
  {
    const html = pagina('<!-- <style>.fantasma{color:red}</style> -->\n<style>.real{color:blue}</style>');
    check(
      'só o bloco de verdade é encontrado',
      JSON.stringify(blocosDe(html)) === JSON.stringify(['style:.real{color:blue}']),
      JSON.stringify(blocosDe(html))
    );
    const registro = { js: [], css: [] };
    const saida = minificarEstilosInline(html, registro, 'teste');
    check('o comentário continua intacto', saida.includes('<!-- <style>.fantasma{color:red}</style> -->'));
    check('o CSS de verdade é minificado', saida.includes('.real{color:#00f}'), saida);
  }

  log('\n[4] os deslocamentos apontam exatamente para o conteúdo');
  {
    const html = pagina('<script>var a = 1;</script>\n<style>.b{color:red}</style>\n<script type="application/json">{"c":3}</script>');
    const analise = analisarHtml(html);
    check(
      'recortar por offset devolve o mesmo texto do nó',
      analise.blocos.every((b) => html.slice(b.inicio, b.fim) === b.conteudo)
    );
    check('os três blocos são encontrados', analise.blocos.length === 3, String(analise.blocos.length));
    check('tipos não-JavaScript são localizados (o filtro é do compressor)',
      analise.blocos.some((b) => b.conteudo === '{"c":3}'));
    const registro = { js: [], css: [] };
    const saida = await minificarScriptsInline(html, registro, 'teste');
    check('o JSON não é tocado', saida.includes('<script type="application/json">{"c":3}</script>'), saida);
    check('só o script JavaScript entra no relatório', registro.js.length === 1);
  }

  log('\n[5] o gate de VPN é injetado nos pontos certos');
  {
    const html = [
      '<!DOCTYPE html>',
      '<html lang="pt-BR">',
      '<head>',
      '<title>T</title>',
      '</head>',
      '<body><p>oi</p></body>',
      '</html>',
      ''
    ].join('\n');
    const esperado = [
      '<!DOCTYPE html>',
      '<html lang="pt-BR" class="nexus-vpn-gate-checking">',
      '<head>',
      '<title>T</title>',
      '  <link rel="stylesheet" href="css/vpn-gate.css?v=20261011" />',
      '  <script defer src="js/vpn-gate.js?v=20261011"></script>',
      '</head>',
      '<body><p>oi</p>  <script src="js/config.example.js"></script>',
      '  <script src="js/config.js" onerror="this.remove()"></script>',
      '</body>',
      '</html>',
      ''
    ].join('\n');
    const saida = aplicarVpnGate(html, 'teste');
    check('a saída é exatamente a esperada, byte a byte', saida === esperado, JSON.stringify(saida));
    check('aplicar de novo não duplica nada', aplicarVpnGate(saida, 'teste') === saida);
  }

  log('\n[6] o gate preserva classes existentes e não duplica');
  {
    const comClasse = aplicarVpnGate(pagina('<p>x</p>').replace('<html lang="pt-BR">', '<html lang="pt-BR" class="dark tema">'), 'teste');
    check('acrescenta à lista de classes sem apagar as anteriores',
      comClasse.includes('<html lang="pt-BR" class="dark tema nexus-vpn-gate-checking">'), comClasse);
    check('não duplica a classe do gate na segunda passada', aplicarVpnGate(comClasse, 'teste') === comClasse);
    const aspasSimples = aplicarVpnGate(pagina('<p>x</p>').replace('<html lang="pt-BR">', "<html lang='pt-BR' class='dark'>"), 'teste');
    check('preserva a formatação original do atributo', aspasSimples.includes("class='dark nexus-vpn-gate-checking'"), aspasSimples);
  }

  log('\n[7] documento sem <html> continua sendo recusado');
  {
    let mensagem = '';
    try {
      aplicarVpnGate('<p>sem html</p>\n', 'teste');
    } catch (erro) {
      mensagem = erro.message;
    }
    check('o build falha com a mensagem de sempre', mensagem === 'teste: tag <html> não encontrada para instalar o gate VPN.', mensagem);
  }

  log('\n[8] as funções toleram documento sem analisar (nada a minificar)');
  {
    const registro = { js: [], css: [] };
    const html = '<p>sem html</p>\n';
    check('minificarScriptsInline devolve o HTML intacto', (await minificarScriptsInline(html, registro, 't')) === html);
    check('minificarEstilosInline devolve o HTML intacto', minificarEstilosInline(html, registro, 't') === html);
    check('nada é contabilizado', registro.js.length === 0 && registro.css.length === 0);
  }

  const resultado = resumo();
  log(`\nResultado: ${resultado.total - resultado.falhas}/${resultado.total} verificações aprovadas.`);
  if (resultado.falhas > 0) process.exitCode = 1;
})();
