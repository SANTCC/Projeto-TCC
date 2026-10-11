#!/usr/bin/env node
/**
 * Regressão: botão "Escanear QR Code" da Inspeção & Checklist (RN 17).
 *
 * Verifica, com um leitor simulado (html5-qrcode):
 *  - abrir e fechar alterna a área e o rótulo do botão (aria-expanded);
 *  - no máximo uma câmera ativa por vez, mesmo com cliques rápidos;
 *  - fechar durante a inicialização libera a câmera;
 *  - falha de câmera ou de carregamento da biblioteca aparece na própria área (sem alert);
 *  - leitura de QR seleciona a carga e fecha a câmera.
 *
 * Executar: node tests/test_inspecao_qr.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;

const CARGA = { id: 'CRG-2026-303', rawDbId: '00000000-0000-4000-8000-000000000001', navio: 'Jaguar', status: 'ARMAZENAGEM', natureza: 'Geral', qrCode: 'QR-CRG-2026-303' };

function criarMockLeitor(estado, opcoes) {
  return class HtmlQrMock {
    constructor(elementoId) {
      this.elementoId = elementoId;
      this.ativo = false;
      this.aoLer = null;
      estado.instancias.push(this);
      estado.ultimo = this;
    }
    start(config, formato, aoLer) {
      estado.starts += 1;
      this.aoLer = aoLer;
      if (opcoes.falharStart) return Promise.reject(new Error('Permissão de câmera negada'));
      return new Promise((resolve) => setTimeout(() => {
        this.ativo = true;
        estado.ativos += 1;
        estado.maxAtivos = Math.max(estado.maxAtivos, estado.ativos);
        resolve();
      }, 30));
    }
    stop() {
      estado.stops += 1;
      if (this.ativo) { this.ativo = false; estado.ativos -= 1; }
      return Promise.resolve();
    }
    clear() {}
  };
}

async function abrir(opcoes) {
  const o = opcoes || {};
  const estado = { instancias: [], ultimo: null, starts: 0, stops: 0, ativos: 0, maxAtivos: 0 };
  const janela = criarJanela({
    url: 'https://nexusport.test/inspecao.html',
    html: htmlDaPagina('inspecao.html'),
    session: sessao('INSPETOR'),
    storage: { nexus_cargas_fluxo: [CARGA], nexus_ghost_clean_v1: 'true' },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/auth-guard.js',
      (w) => {
        w.NexusAssets = { carregar: async () => o.bibliotecaIndisponivel !== true };
        w.Html5Qrcode = criarMockLeitor(estado, o);
        w.mostrarFeedback = (tipo, titulo, msg) => { w.__feedbacks = (w.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
      },
      'js/pages/inspecao.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(60);
  return { w: janela.w, estado, erros: janela.erros };
}

const doc = (w) => w.document;
const botao = (w) => doc(w).getElementById('scanChecklistBtn');
const area = (w) => doc(w).getElementById('checklistQrViewport');
const status = (w) => doc(w).getElementById('inspecaoQrStatus').textContent;

async function main() {
  log('\n[1] Abrir e fechar');
  {
    const { w, estado } = await abrir();
    check('começa fechado (aria-expanded=false)', area(w).classList.contains('hidden') && botao(w).getAttribute('aria-expanded') === 'false');
    botao(w).click();
    await aguardar(120);
    check('clique abre a área e o rótulo vira "Fechar leitor"',
      !area(w).classList.contains('hidden') && botao(w).textContent.indexOf('Fechar leitor') >= 0 && botao(w).getAttribute('aria-expanded') === 'true');
    check('abre uma única câmera', estado.starts === 1, `starts=${estado.starts}`);
    botao(w).click();
    await aguardar(60);
    check('segundo clique fecha a área e libera a câmera', area(w).classList.contains('hidden') && estado.ativos === 0, `ativos=${estado.ativos}`);
    w.close();
  }

  log('\n[2] Cliques rápidos não deixam câmeras ativas');
  {
    const { w, estado } = await abrir();
    botao(w).click();
    botao(w).click();
    await aguardar(150);
    check('abrir e fechar em sequência rápida termina fechado', area(w).classList.contains('hidden'));
    check('nenhuma câmera ficou ligada após fechar durante a inicialização', estado.ativos === 0, `ativos=${estado.ativos}`);
    botao(w).click();
    await aguardar(120);
    botao(w).click();
    await aguardar(60);
    botao(w).click();
    await aguardar(120);
    check('ciclos repetidos nunca têm mais de uma câmera ativa', estado.maxAtivos === 1, `maxAtivos=${estado.maxAtivos}`);
    check('estado final: aberto e com uma câmera', !area(w).classList.contains('hidden') && estado.ativos === 1, `ativos=${estado.ativos}`);
    w.close();
  }

  log('\n[3] Falha de câmera ou da biblioteca aparece na própria área');
  {
    const { w } = await abrir({ falharStart: true });
    botao(w).click();
    await aguardar(120);
    check('câmera negada: mensagem na área do leitor', /Câmera indisponível/.test(status(w)), status(w));
    check('câmera negada: nenhum alert/toast de erro', (w.__feedbacks || []).length === 0);
    w.close();
  }
  {
    const { w } = await abrir({ bibliotecaIndisponivel: true });
    botao(w).click();
    await aguardar(120);
    check('biblioteca indisponível: mensagem para seleção manual', /Selecione a carga manualmente/.test(status(w)), status(w));
    w.close();
  }

  log('\n[4] Leitura de QR seleciona a carga e fecha a câmera');
  {
    const { w, estado } = await abrir();
    botao(w).click();
    await aguardar(120);
    estado.ultimo.aoLer('QR-CRG-2026-303');
    await aguardar(120);
    check('leitura seleciona a carga no seletor', doc(w).getElementById('inspecaoCargaSelect').value === 'CRG-2026-303',
      doc(w).getElementById('inspecaoCargaSelect').value);
    check('leitura fecha a área e libera a câmera', area(w).classList.contains('hidden') && estado.ativos === 0);
    w.close();
  }

  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações do leitor de QR passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
