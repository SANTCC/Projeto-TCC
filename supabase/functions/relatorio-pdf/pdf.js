/**
 * Desenho do relatório operacional de carga em A4 (Backlog 3, item B / V-14).
 *
 * A biblioteca PDF é injetada ({ PDFDocument, StandardFonts, rgb }): na Edge Function vem de
 * `npm:pdf-lib`; nos testes Node, de `pdf-lib`. O conteúdo vem de `secoesDoRelatorio` (relatorio.js)
 * e o logotipo oficial vem de `logo.js` (`design/logo_porto.png`).
 */
import { formatarCodigoCarga, secoesDoRelatorio } from './relatorio.js';
import { obterLogoBytes } from './logo.js';

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { esquerda: 40, direita: 40, topo: 40, inferior: 64 };
const LARGURA_UTIL = A4.largura - MARGEM.esquerda - MARGEM.direita;
const COLUNAS = { x: [MARGEM.esquerda + 8, MARGEM.esquerda + LARGURA_UTIL / 2 + 8], largura: LARGURA_UTIL / 2 - 16 };
const COR = {
  cabecalho: [26 / 255, 34 / 255, 52 / 255],
  destaque: [68 / 255, 89 / 255, 135 / 255],
  fundoSecao: [241 / 255, 245 / 255, 249 / 255],
  bordaSuave: [226 / 255, 232 / 255, 240 / 255],
  texto: [15 / 255, 23 / 255, 42 / 255],
  rotulo: [100 / 255, 116 / 255, 139 / 255],
  subtituloClaro: [203 / 255, 213 / 255, 225 / 255],
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
  const codigoCarga = (modelo.carga && (modelo.carga.codigo || formatarCodigoCarga(modelo.carga))) || '';
  const idCarga = (modelo.carga && modelo.carga.id) || '';
  doc.setTitle(`Relatório operacional de carga ${codigoCarga}${idCarga && idCarga !== codigoCarga ? ` (${idCarga})` : ''}`);
  doc.setAuthor('NexusPort — Terminal STS-01');
  doc.setSubject('Relatório operacional integrado de carga (formato A4)');
  doc.setKeywords([hash]);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const cor = (c) => rgb(c[0], c[1], c[2]);

  let logoImg = null;
  try {
    logoImg = await doc.embedPng(obterLogoBytes());
  } catch (e) {
    logoImg = null;
  }

  const paginas = [];
  let pagina = null;
  let y = 0;

  function novaPagina() {
    pagina = doc.addPage([A4.largura, A4.altura]);
    paginas.push(pagina);
    if (paginas.length === 1) {
      pagina.drawRectangle({ x: 0, y: A4.altura - 68, width: A4.largura, height: 68, color: cor(COR.cabecalho) });
      pagina.drawRectangle({ x: 0, y: A4.altura - 71, width: A4.largura, height: 3, color: cor(COR.destaque) });
      let xTexto = MARGEM.esquerda;
      if (logoImg) {
        pagina.drawRectangle({
          x: MARGEM.esquerda,
          y: A4.altura - 54,
          width: 40,
          height: 40,
          color: cor(COR.branco)
        });
        pagina.drawImage(logoImg, {
          x: MARGEM.esquerda + 2,
          y: A4.altura - 52,
          width: 36,
          height: 36
        });
        xTexto = MARGEM.esquerda + 50;
      }
      pagina.drawText('NEXUSPORT · TERMINAL STS-01', {
        x: xTexto, y: A4.altura - 30, size: 12.5, font: negrito, color: cor(COR.branco)
      });
      pagina.drawText('Relatório operacional integrado de carga (formato A4)', {
        x: xTexto, y: A4.altura - 47, size: 9.5, font: regular, color: cor(COR.subtituloClaro)
      });
      pagina.drawText('PADRÃO A4 · OFICIAL', {
        x: A4.largura - MARGEM.direita - 96, y: A4.altura - 29, size: 7.5, font: negrito, color: cor(COR.subtituloClaro)
      });
      y = A4.altura - 71 - 22;
    } else {
      let xCont = MARGEM.esquerda;
      if (logoImg) {
        pagina.drawImage(logoImg, {
          x: MARGEM.esquerda,
          y: A4.altura - 36,
          width: 16,
          height: 16
        });
        xCont = MARGEM.esquerda + 22;
      }
      pagina.drawText(sanitizar(`Relatório operacional de carga · ${codigoCarga || idCarga}`, regular), {
        x: xCont, y: A4.altura - 31, size: 8.5, font: negrito, color: cor(COR.rotulo)
      });
      pagina.drawLine({
        start: { x: MARGEM.esquerda, y: A4.altura - 40 },
        end: { x: A4.largura - MARGEM.direita, y: A4.altura - 40 },
        thickness: 0.5,
        color: cor(COR.bordaSuave)
      });
      y = A4.altura - MARGEM.topo - 18;
    }
  }

  function garantirEspaco(altura) {
    if (!pagina || y - altura < MARGEM.inferior) novaPagina();
  }

  function desenharSecao(titulo) {
    garantirEspaco(34);
    pagina.drawRectangle({ x: MARGEM.esquerda, y: y - 18, width: LARGURA_UTIL, height: 22, color: cor(COR.fundoSecao) });
    pagina.drawRectangle({ x: MARGEM.esquerda, y: y - 18, width: 3.5, height: 22, color: cor(COR.destaque) });
    pagina.drawText(sanitizar(titulo, negrito), {
      x: MARGEM.esquerda + 11, y: y - 11, size: 10.5, font: negrito, color: cor(COR.texto)
    });
    y -= 30;
  }

  /** Um campo: rótulo pequeno e valor embaixo (quebrado em linhas). Retorna a altura usada. */
  function alturaCampo(campo) {
    const valor = quebrar(sanitizar(campo[1], regular), regular, 9.5, COLUNAS.largura);
    return 11 + valor.length * 12.5;
  }

  function desenharCampo(campo, x, topo) {
    pagina.drawText(sanitizar(campo[0], negrito).toUpperCase(), {
      x, y: topo - 8, size: 7, font: negrito, color: cor(COR.rotulo)
    });
    const linhas = quebrar(sanitizar(campo[1], regular), regular, 9.5, COLUNAS.largura);
    linhas.forEach((linha, i) => {
      pagina.drawText(linha, { x, y: topo - 20.5 - i * 12.5, size: 9.5, font: regular, color: cor(COR.texto) });
    });
  }

  /** Campos em duas colunas, linha a linha, com separador visual sutil. */
  function desenharCampos(campos) {
    for (let i = 0; i < campos.length; i += 2) {
      const par = campos.slice(i, i + 2);
      const altura = Math.max(...par.map(alturaCampo));
      garantirEspaco(altura + 7);
      par.forEach((campo, j) => desenharCampo(campo, COLUNAS.x[j], y));
      pagina.drawLine({
        start: { x: MARGEM.esquerda + 4, y: y - altura - 3 },
        end: { x: A4.largura - MARGEM.direita - 4, y: y - altura - 3 },
        thickness: 0.4,
        color: cor(COR.bordaSuave)
      });
      y -= altura + 7;
    }
    y -= 6;
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
      thickness: 0.6, color: cor(COR.bordaSuave)
    });
    p.drawText(sanitizar(`Conteúdo SHA-256: ${hash}`, regular), {
      x: MARGEM.esquerda, y: 34, size: 7, font: regular, color: cor(COR.rotulo)
    });
    p.drawText(`Página ${indice + 1} de ${total}`, {
      x: A4.largura - MARGEM.direita - 60, y: 34, size: 7, font: negrito, color: cor(COR.rotulo)
    });
  });

  return doc.save();
}
