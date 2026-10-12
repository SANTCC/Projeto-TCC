/**
 * Desenho do relatório operacional de carga em A4 (Backlog 3, item B).
 *
 * A biblioteca PDF é injetada ({ PDFDocument, StandardFonts, rgb }): na Edge Function vem de
 * `npm:pdf-lib`; nos testes Node, de `pdf-lib`. O conteúdo vem de `secoesDoRelatorio` (relatorio.js).
 */
import { secoesDoRelatorio } from './relatorio.js';

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { esquerda: 40, direita: 40, topo: 40, inferior: 64 };
const LARGURA_UTIL = A4.largura - MARGEM.esquerda - MARGEM.direita;
const COLUNAS = { x: [MARGEM.esquerda, MARGEM.esquerda + LARGURA_UTIL / 2 + 8], largura: LARGURA_UTIL / 2 - 8 };
const COR = {
  cabecalho: [30 / 255, 41 / 255, 59 / 255],
  fundoSecao: [245 / 255, 247 / 255, 250 / 255],
  texto: [30 / 255, 41 / 255, 59 / 255],
  rotulo: [100 / 255, 116 / 255, 139 / 255],
  branco: [1, 1, 1]
};

/** Troca caracteres que a fonte padrão (WinAnsi) não codifica por "?", para o PDF nunca falhar por texto do banco. */
function sanitizar(texto, fonte) {
  const limpo = String(texto).replace(/[\r\n\t]+/g, ' ');
  return Array.from(limpo, (ch) => {
    try {
      fonte.encodeText(ch);
      return ch;
    } catch (erro) {
      return '?';
    }
  }).join('');
}

/** Quebra o texto em linhas que cabem na largura (palavras; palavra longa é cortada). */
function quebrar(texto, fonte, tamanho, largura) {
  const palavras = texto.split(' ').filter((p) => p.length > 0);
  if (palavras.length === 0) return [''];
  const linhas = [];
  let atual = '';
  palavras.forEach((palavra) => {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(teste, tamanho) <= largura) {
      atual = teste;
      return;
    }
    if (atual) linhas.push(atual);
    let resto = palavra;
    while (fonte.widthOfTextAtSize(resto, tamanho) > largura && resto.length > 1) {
      let corte = resto.length - 1;
      while (corte > 1 && fonte.widthOfTextAtSize(resto.slice(0, corte), tamanho) > largura) corte -= 1;
      linhas.push(resto.slice(0, corte));
      resto = resto.slice(corte);
    }
    atual = resto;
  });
  if (atual) linhas.push(atual);
  return linhas;
}

/**
 * Gera o PDF (Uint8Array). `hash` é impresso no rodapé de cada página: conferência do conteúdo.
 */
export async function gerarPdfRelatorio(modelo, hash, lib) {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(`Relatório operacional de carga ${modelo.carga.id}`);
  doc.setAuthor('NexusPort — Terminal STS-01');
  doc.setSubject('Relatório operacional integrado de carga (formato A4)');
  doc.setKeywords([hash]);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const cor = (c) => rgb(c[0], c[1], c[2]);

  const paginas = [];
  let pagina = null;
  let y = 0;

  function novaPagina() {
    pagina = doc.addPage([A4.largura, A4.altura]);
    paginas.push(pagina);
    if (paginas.length === 1) {
      pagina.drawRectangle({ x: 0, y: A4.altura - 62, width: A4.largura, height: 62, color: cor(COR.cabecalho) });
      pagina.drawText('NEXUSPORT · TERMINAL STS-01 · PORTO DE SANTOS', {
        x: MARGEM.esquerda, y: A4.altura - 28, size: 12, font: negrito, color: cor(COR.branco)
      });
      pagina.drawText('Relatório operacional integrado de carga (formato A4)', {
        x: MARGEM.esquerda, y: A4.altura - 46, size: 9.5, font: regular, color: cor(COR.branco)
      });
      y = A4.altura - 62 - 26;
    } else {
      pagina.drawText(sanitizar(`Relatório operacional de carga · ${modelo.carga.id}`, regular), {
        x: MARGEM.esquerda, y: A4.altura - 28, size: 8.5, font: regular, color: cor(COR.rotulo)
      });
      y = A4.altura - MARGEM.topo - 16;
    }
  }

  function garantirEspaco(altura) {
    if (!pagina || y - altura < MARGEM.inferior) novaPagina();
  }

  function desenharSecao(titulo) {
    garantirEspaco(34);
    pagina.drawRectangle({ x: MARGEM.esquerda, y: y - 16, width: LARGURA_UTIL, height: 20, color: cor(COR.fundoSecao) });
    pagina.drawText(sanitizar(titulo, negrito), {
      x: MARGEM.esquerda + 8, y: y - 10, size: 11, font: negrito, color: cor(COR.texto)
    });
    y -= 32;
  }

  /** Um campo: rótulo pequeno e valor embaixo (quebrado em linhas). Retorna a altura usada. */
  function alturaCampo(campo) {
    const valor = quebrar(sanitizar(campo[1], regular), regular, 10, COLUNAS.largura);
    return 11 + valor.length * 13;
  }

  function desenharCampo(campo, x, topo) {
    pagina.drawText(sanitizar(campo[0], regular).toUpperCase(), {
      x, y: topo - 8, size: 7, font: regular, color: cor(COR.rotulo)
    });
    const linhas = quebrar(sanitizar(campo[1], regular), regular, 10, COLUNAS.largura);
    linhas.forEach((linha, i) => {
      pagina.drawText(linha, { x, y: topo - 21 - i * 13, size: 10, font: regular, color: cor(COR.texto) });
    });
  }

  /** Campos em duas colunas, linha a linha. */
  function desenharCampos(campos) {
    for (let i = 0; i < campos.length; i += 2) {
      const par = campos.slice(i, i + 2);
      const altura = Math.max(...par.map(alturaCampo));
      garantirEspaco(altura + 6);
      par.forEach((campo, j) => desenharCampo(campo, COLUNAS.x[j], y));
      y -= altura + 6;
    }
    y -= 8;
  }

  novaPagina();
  secoesDoRelatorio(modelo).forEach((secao) => {
    desenharSecao(secao.titulo);
    desenharCampos(secao.campos);
  });

  const total = paginas.length;
  paginas.forEach((p, indice) => {
    p.drawLine({
      start: { x: MARGEM.esquerda, y: 46 }, end: { x: A4.largura - MARGEM.direita, y: 46 },
      thickness: 0.5, color: cor(COR.rotulo)
    });
    p.drawText(sanitizar(`Conteúdo SHA-256: ${hash}`, regular), {
      x: MARGEM.esquerda, y: 34, size: 7, font: regular, color: cor(COR.rotulo)
    });
    p.drawText(`Página ${indice + 1} de ${total}`, {
      x: A4.largura - MARGEM.direita - 60, y: 34, size: 7, font: regular, color: cor(COR.rotulo)
    });
  });

  return doc.save();
}
