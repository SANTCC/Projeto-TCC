#!/usr/bin/env node
/**
 * GERADOR DO about.html — NexusPort.
 *
 * Escreve o `about.html` na raiz do projeto: uma página estática e autocontida que
 * explica o que é o NexusPort, como acontece o fluxo operacional das cargas e quais
 * são as funcionalidades de cada página do sistema, sem expor matrículas de
 * funcionários, capturas de tela ou instruções de teste.
 *
 * Uso:
 *   node tools/screenshots/gerar-about.js
 *
 * Opções: --manifest <arquivo> --saida <arquivo.html>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { PAGINAS_DO_ABOUT } = require('./paginas');
const { CARGO_META } = require('./demo-data');
const { MAPA_ICONES_FA } = require('../assets');

const faIcon = (nome, extraCls = '', extraAttr = '') => {
  const chave = String(nome || '').trim();
  const faCls = (MAPA_ICONES_FA && MAPA_ICONES_FA[chave]) || 'fa-circle-dot';
  const cls = ['material-symbols-outlined', 'fa-solid', faCls, extraCls].filter(Boolean).join(' ');
  return `<span class="${cls}"${extraAttr ? ` ${extraAttr}` : ''} data-icon="${esc(chave)}" aria-hidden="true"></span>`;
};

const RAIZ = path.join(__dirname, '..', '..');
const MANIFEST_PADRAO = path.join(RAIZ, 'docs', 'screenshots', 'manifest.json');
const SAIDA_PADRAO = path.join(RAIZ, 'about.html');

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------
const esc = (texto) => String(texto === null || texto === undefined ? '' : texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function analisarArgumentos(argv) {
  const opcoes = { manifest: MANIFEST_PADRAO, saida: SAIDA_PADRAO };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--manifest') opcoes.manifest = path.resolve(argv[++i]);
    else if (argv[i] === '--saida') opcoes.saida = path.resolve(argv[++i]);
  }
  return opcoes;
}

/** Nome de exibição curto do cargo (para tabelas e etiquetas). */
function nomeCurto(cargo) {
  return (CARGO_META[cargo] && CARGO_META[cargo].nome) || cargo;
}

// ---------------------------------------------------------------------------
// Trechos de conteúdo (conteúdo editorial da página)
// ---------------------------------------------------------------------------
const PILARES = [
  {
    icone: 'badge',
    undraw: 'authentication.svg',
    undrawAlt: 'Ícone unDraw de autenticação e acesso seguro com credencial',
    titulo: '1. Acesso e identidade',
    texto: 'Login pelo código individual institucional, confirmação obrigatória do cargo e sessão em cookie de 12 h (um turno). O cargo define a camada de visão: própria, operacional ou estratégica.'
  },
  {
    icone: 'event_available',
    undraw: 'deliveries.svg',
    undrawAlt: 'Ícone unDraw de agendamento de entrega e recebimento de cargas',
    titulo: '2. Agendamento e recebimento',
    texto: 'A carga entra em AGENDAMENTO com data prevista de entrega e destino; no recebimento é conferida contra o checklist do tipo de carga e recebe QR Code com etiqueta A4.'
  },
  {
    icone: 'fact_check',
    undraw: 'inspection.svg',
    undrawAlt: 'Ícone unDraw de inspeção técnica formal e conferência de itens',
    titulo: '3. Inspeção formal',
    texto: 'O inspetor executa o checklist item a item. A aprovação só é liberada quando 100% dos itens críticos estão conformes (RN 14); a recusa exige motivo formal, que vai para a auditoria.'
  },
  {
    icone: 'warehouse',
    undraw: 'logistics.svg',
    undrawAlt: 'Ícone unDraw de armazenagem e logística de contêineres no pátio',
    titulo: '4. Pátio e vínculo',
    texto: 'Aprovada, a carga é armazenada em baia e vinculada a contêiner e navio. O sistema mantém berços, guindastes e a localização das embarcações com ETA por rota a partir do Porto de Santos.'
  },
  {
    icone: 'verified_user',
    undraw: 'security.svg',
    undrawAlt: 'Ícone unDraw de despacho operacional supervisionado e liberação segura',
    titulo: '5. Despacho e liberação',
    texto: 'O supervisor (ou o substituto delegado) libera a saída, cancela entregas e responde por decisões que ficam registradas na trilha imutável com justificativa formal.'
  },
  {
    icone: 'monitoring',
    undraw: 'dashboard.svg',
    undrawAlt: 'Ícone unDraw de painel de controle executivo com gráficos e KPIs',
    titulo: '6. Comando e auditoria',
    texto: 'O painel consolida KPIs e gráficos por camada de visão; toda alteração relevante vai para logs_alteracoes e toda decisão crítica para trail_decisoes com retificações anexáveis.'
  },
  {
    icone: 'qr_code_scanner',
    undraw: 'qr-code-scan.svg',
    undrawAlt: 'Ícone unDraw de operação de campo e leitura de QR Code em smartphone',
    titulo: '7. Operação em campo',
    texto: 'O leitor de QR Code funciona no celular: leitura por câmera ou digitação, com registro da leitura. O botão de pânico é global e propaga o alerta em tempo real para todas as telas.'
  }
];

const ARQUITETURA = [
  {
    icone: 'web',
    undraw: 'source-code.svg',
    undrawAlt: 'Ícone unDraw de front-end estático em JavaScript',
    titulo: 'Front-end estático e acessível',
    itens: [
      'HTML5 + Tailwind CSS + JavaScript ES6 (módulos por página em js/pages/).',
      'CSS compilado localmente (css/nexus.css) e fontes auto-hospedadas, sem dependência de CDNs externos.',
      'Bibliotecas locais sob demanda: Chart.js (gráficos), qrcode.js (etiquetas) e html5-qrcode (leitura por câmera).',
      'Layout compartilhado em js/layout.js (topbar, menu retrátil, tema claro/escuro, presença em tempo real e integração de acessibilidade VLibras).'
    ]
  },
  {
    icone: 'storage',
    undraw: 'server.svg',
    undrawAlt: 'Ícone unDraw de banco de dados e PostgREST Supabase',
    titulo: 'Supabase (PostgreSQL + PostgREST)',
    itens: [
      'Acesso direto ao PostgREST com políticas RLS que controlam o que cada consulta enxerga.',
      'Tabelas operacionais: funcionarios, cargas, containers, navios, bercos, guindastes, manutencoes, inspecoes, visitantes.',
      'Auditoria em logs_alteracoes (append-only) e decisões em trail_decisoes + retificacoes_trail.',
      'Realtime (WebSocket) sincroniza as telas quando um registro muda e sustenta o alarme do botão de pânico.'
    ]
  },
  {
    icone: 'functions',
    undraw: 'cloud-sync.svg',
    undrawAlt: 'Ícone unDraw de computação serverless com Edge Functions',
    titulo: 'Edge Functions (Deno)',
    itens: [
      'panic-alert: recebe o acionamento, grava a emergência e publica o alerta no Realtime.',
      'relatorio-pdf: gera o PDF A4 no servidor (pdf-lib) e guarda o arquivo em bucket privado com cache por hash.',
      'despacho-embarcacao e kpis-calculo: apoio ao despacho e aos indicadores consolidados.',
      'scanner-qr: valida leituras de QR Code dos ativos.'
    ]
  },
  {
    icone: 'shield',
    undraw: 'secure-server.svg',
    undrawAlt: 'Ícone unDraw de segurança, RBAC e trilha de auditoria',
    titulo: 'Segurança e conformidade',
    itens: [
      'RBAC por cargo: a matriz de ações (ACTION_PERMISSIONS) e a de páginas (PAGE_PERMISSIONS) ficam em js/auth-guard.js.',
      'Anti-XSS: toda saída de dado passa por nexusEsc/nexusJsArg (js/security.js).',
      'LGPD: o GA4 não recebe dados pessoais; eventos levam apenas categorias operacionais.',
      'Trilha imutável: correções são anexadas como retificação, nunca sobrescrevem a decisão original.'
    ]
  },
  {
    icone: 'groups',
    undraw: 'teamwork.svg',
    undrawAlt: 'Ícone unDraw de equipe com diferentes camadas de visão',
    titulo: 'Camadas de visão',
    itens: [
      'Visão Própria: Estivador, Conferente, Arrumador, Planejador e Técnico em Portos veem a própria operação.',
      'Visão Operacional: Inspetor e Supervisor enxergam o fluxo do terminal, inspeções e manutenções.',
      'Visão Estratégica: Diretor de Operações, Diretor-Presidente e Conselho acessam indicadores financeiros e de produtividade.'
    ]
  },
  {
    icone: 'smart_toy',
    undraw: 'ai-code-generation.svg',
    undrawAlt: 'Ícone unDraw de assistente inteligente e agentes de IA WebMCP',
    titulo: 'WebMCP (agentes de IA)',
    itens: [
      'Ferramentas expostas em document.modelContext com o mesmo RBAC das telas.',
      'Ações que mudam estado exigem confirmação humana explícita na tela.',
      'Integração nativa com os formulários e tabelas operacionais de cada página.'
    ]
  }
];

const REGRAS = [
  ['RN 14 — Inspeção', 'Aprovar carga exige 100% dos itens críticos conformes; qualquer item não conforme bloqueia a aprovação e habilita a recusa com motivo.'],
  ['RN 15 — Credencial', 'Perda ou esquecimento invalida o código individual anterior, reemitido presencialmente pelo Técnico em Portos.'],
  ['RN 12 — Cascata de status', 'A mudança da localização do navio propaga o status das cargas vinculadas no banco: EM_TRANSITO ↔ ENTREGUE.'],
  ['RF 12/13 — Auditoria', 'Toda alteração entra em logs_alteracoes e toda decisão crítica em trail_decisoes, com retificações anexadas em vez de exclusão.'],
  ['RF 14 — Delegação', 'No máximo um substituto ativo por supervisor, com vigência explícita e revogação registrada.'],
  ['Emergência', 'Qualquer funcionário autenticado pode acionar o botão de pânico; o alerta chega a todas as telas conectadas e é registrado em emergencias.']
];

// ---------------------------------------------------------------------------
// Geração de blocos HTML
// ---------------------------------------------------------------------------
function blocoCabecalho() {
  return `  <!-- Topbar -->
  <header class="topo">
    <div class="topo-marca">
      <picture><source srcset="design/logo_porto.webp" type="image/webp" /><img src="design/logo_porto.png" alt="Logotipo do NexusPort" width="40" height="40" /></picture>
      <div>
        <strong>NexusPort</strong>
        <span>Terminal STS-01 • Como funciona o sistema</span>
      </div>
    </div>
    <nav class="topo-nav" aria-label="Seções desta página">
      <a href="#fluxo">Fluxo operacional</a>
      <a href="#arquitetura">Arquitetura</a>
      <a href="#perfis">Perfis e acessos</a>
      <a href="#telas">Funcionalidades por página</a>
      <a href="index.html">Acessar o sistema</a>
    </nav>
    <button id="botaoTema" type="button" class="botao-tema" aria-label="Alternar tema claro/escuro">
      ${faIcon('dark_mode', '', 'id="iconeTema"')}
    </button>
  </header>`;
}

function blocoHero() {
  return `  <!-- Hero -->
  <section class="hero" id="inicio">
    <div class="hero-grade">
      <div class="hero-conteudo">
        <p class="selo">Documentação Institucional • Terminal STS-01 • Ícones por <a href="https://undraw.co/" target="_blank" rel="noopener noreferrer">unDraw</a></p>
        <h1>Como funciona o sistema NexusPort</h1>
        <p class="hero-texto">
          O NexusPort é a plataforma de gestão operacional do <strong>Terminal STS-01 (Porto de Santos)</strong>.
          Ele acompanha a carga desde o agendamento até a entrega no porto de destino, formaliza a inspeção
          técnica de recebimento, controla o pátio, os equipamentos e as embarcações e mantém uma trilha
          auditável de todas as decisões críticas tomadas no terminal.
        </p>
        <ul class="hero-numeros">
          <li><strong>${PAGINAS_DO_ABOUT.length}</strong><span>páginas no sistema</span></li>
          <li><strong>10</strong><span>cargos com visões distintas</span></li>
          <li><strong>7</strong><span>pilares operacionais</span></li>
          <li><strong>9</strong><span>status no fluxo da carga</span></li>
        </ul>
        <p class="nota">
          ${faIcon('info')}
          <span>O acesso ao sistema é controlado por perfil funcional (RBAC), garantindo que cada cargo visualize e execute apenas as operações compatíveis com sua função no terminal.</span>
        </p>
      </div>
      <div class="hero-ilustracao">
        <img src="design/undraw/container-ship.svg" alt="Ilustração unDraw de navio porta-contêineres no Porto de Santos" width="480" height="270" class="undraw-hero" loading="lazy" />
      </div>
    </div>
  </section>`;
}

function blocoFluxo() {
  const cards = PILARES.map((p) => `      <article class="cartao pilar">
        <div class="pilar-ilustracao">
          <img src="design/undraw/${esc(p.undraw)}" alt="${esc(p.undrawAlt)}" class="undraw-pilar-img" loading="lazy" />
        </div>
        <div class="pilar-cabecalho">
          ${faIcon(p.icone, 'pilar-icone')}
          <h3>${esc(p.titulo)}</h3>
        </div>
        <p>${esc(p.texto)}</p>
      </article>`).join('\n');

  return `  <!-- Fluxo operacional -->
  <section id="fluxo">
    <h2>${faIcon('route')} Fluxo operacional, do agendamento à auditoria</h2>
    <p class="secao-texto">
      Cada pilar abaixo corresponde a uma etapa da operação portuária no terminal: identidade, entrada da carga,
      inspeção técnica, armazenagem no pátio, despacho marítimo, comando executivo e operação em campo.
    </p>
    <div class="grade-pilares">
${cards}
    </div>

    <h3 class="subtitulo">Esteira de status da carga</h3>
    <ol class="esteira">
      <li data-tom="neutro"><strong>AGENDAMENTO</strong><span>Data prevista de entrega e destino registrados.</span></li>
      <li data-tom="info"><strong>RECEBIMENTO_INSPECAO</strong><span>Carga na guarita, aguardando conferência.</span></li>
      <li data-tom="ok"><strong>ARMAZENAGEM</strong><span>Inspecionada e guardada na baia do pátio.</span></li>
      <li data-tom="ok"><strong>PRONTA_PARA_ENTREGA</strong><span>Arrumada e liberada para embarque.</span></li>
      <li data-tom="info"><strong>SAIDA</strong><span>Em saída do terminal, com etiqueta e QR conferidos.</span></li>
      <li data-tom="info"><strong>EM_TRANSITO</strong><span>Embarcada e a caminho do porto de destino.</span></li>
      <li data-tom="ok"><strong>ENTREGUE</strong><span>Entrega confirmada no destino.</span></li>
      <li data-tom="aviso"><strong>CANCELADA</strong><span>Cancelamento autorizado e registrado (sem retorno ao fluxo).</span></li>
      <li data-tom="erro"><strong>RECUSADA</strong><span>Reprovada na inspeção, com motivo formal.</span></li>
    </ol>
  </section>`;
}

function blocoArquitetura() {
  const cards = ARQUITETURA.map((a) => `      <article class="cartao arq">
        <div class="arq-ilustracao">
          <img src="design/undraw/${esc(a.undraw)}" alt="${esc(a.undrawAlt)}" class="undraw-arq-img" loading="lazy" />
        </div>
        <header>
          ${faIcon(a.icone)}
          <h3>${esc(a.titulo)}</h3>
        </header>
        <ul>
${a.itens.map((i) => `          <li>${esc(i)}</li>`).join('\n')}
        </ul>
      </article>`).join('\n');

  return `  <!-- Arquitetura -->
  <section id="arquitetura">
    <h2>${faIcon('account_tree')} Como o sistema é construído</h2>
    <p class="secao-texto">
      O NexusPort é um front-end estático que conversa diretamente com o Supabase (PostgREST, Realtime e
      Edge Functions). As regras de negócio são aplicadas nas telas, nas políticas do banco e nas funções de borda.
    </p>
    <div class="grade-arquitetura">
${cards}
    </div>

    <h3 class="subtitulo">Regras de negócio que sustentam o fluxo</h3>
    <div class="tabela-envolucro">
      <table>
        <caption class="visualmente-oculto">Regras de negócio e seus efeitos no sistema</caption>
        <thead>
          <tr><th scope="col">Regra</th><th scope="col">Como aparece no sistema</th></tr>
        </thead>
        <tbody>
${REGRAS.map(([regra, efeito]) => `          <tr><th scope="row">${esc(regra)}</th><td>${esc(efeito)}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </section>`;
}

function blocoPerfis() {
  const cargos = Object.keys(CARGO_META);
  const linhas = cargos.map((cargo) => {
    const meta = CARGO_META[cargo];
    const telas = PAGINAS_DO_ABOUT
      .filter((p) => p.cargos && p.cargos.includes(cargo) && !p.publica)
      .map((p) => p.titulo);
    return `          <tr>
            <th scope="row">${esc(meta.nome)}</th>
            <td>${esc(meta.nivel)}</td>
            <td><span class="etiqueta">${esc(meta.camada)}</span></td>
            <td class="telas-perfil">${telas.length ? esc(telas.join(' · ')) : '—'}</td>
          </tr>`;
  }).join('\n');

  return `  <!-- Perfis -->
  <section id="perfis">
    <h2>${faIcon('badge')} Perfis, camadas de visão e acessos</h2>
    <p class="secao-texto">
      O cargo vem do cadastro funcional e não pode ser trocado na tela: ao confirmar, o operador assume a
      camada de visão correspondente. As páginas abaixo são as liberadas para cada cargo pela matriz
      <code>PAGE_PERMISSIONS</code> de <code>js/auth-guard.js</code>.
    </p>
    <div class="tabela-envolucro">
      <table>
        <caption class="visualmente-oculto">Cargos, níveis de acesso, camadas de visão e telas liberadas</caption>
        <thead>
          <tr>
            <th scope="col">Cargo</th>
            <th scope="col">Nível</th>
            <th scope="col">Camada de visão</th>
            <th scope="col">Telas liberadas</th>
          </tr>
        </thead>
        <tbody>
${linhas}
        </tbody>
      </table>
    </div>
  </section>`;
}

/** Cartão descritivo das funcionalidades de uma página do sistema. */
function cartaoTela(pagina) {
  const cargos = pagina.cargos || [];
  const destaques = (pagina.destaques || []).map((d) => `            <li>${esc(d)}</li>`).join('\n');
  const nomesCargos = cargos.map((c) => nomeCurto(c));

  return `      <article class="cartao tela" id="tela-${esc(pagina.chave)}">
        <div class="tela-topo">
          <div>
            <p class="tela-caminho"><code>${esc(pagina.arquivo)}</code></p>
            <h3>${esc(pagina.titulo)}</h3>
            <p class="tela-subtitulo">${esc(pagina.subtitulo)}</p>
          </div>
          <div class="tela-etiquetas">
${cargos.slice(0, 4).map((c) => `            <span class="etiqueta">${esc(nomeCurto(c))}</span>`).join('\n')}
${cargos.length > 4 ? `            <span class="etiqueta">+${cargos.length - 4}</span>` : ''}
          </div>
        </div>

        <p class="tela-resumo">${esc(pagina.resumo)}</p>
        <h4>Funcionalidades principais</h4>
        <ul class="tela-destaques">
${destaques}
        </ul>

        <p class="tela-acesso">
          ${faIcon('verified_user')}
          ${pagina.publica
    ? 'Tela pública (etapa de autenticação — não exige sessão prévia)'
    : `Cargos com acesso: ${esc(nomesCargos.join(', '))}`}
        </p>
      </article>`;
}

function blocoTelas() {
  const cartoes = PAGINAS_DO_ABOUT.map((pagina) => cartaoTela(pagina)).join('\n\n');

  return `  <!-- Funcionalidades por página -->
  <section id="telas">
    <h2>${faIcon('apps')} Funcionalidades de cada página do sistema</h2>
    <p class="secao-texto">
      Abaixo está cada página do NexusPort com sua finalidade operacional, suas funcionalidades principais
      e os cargos que possuem permissão de acesso.
    </p>
    <div class="lista-telas">
${cartoes}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// CSS e JS embutidos
// ---------------------------------------------------------------------------
const CSS = `
    :root {
      --nexus-900: #1E293B;
      --nexus-500: #445987;
      --bg: #F5F7FA;
      --card: #FFFFFF;
      --texto: #222222;
      --texto-suave: #55606F;
      --borda: #E1E5ED;
      --ok: #2E7D32;
      --aviso: #B45309;
      --erro: #C62828;
      --sombra: 0 10px 30px rgba(30, 41, 59, 0.08);
    }
    html.dark {
      --bg: #0F172A;
      --card: #1E293B;
      --texto: #F1F5F9;
      --texto-suave: #A8B3C4;
      --borda: #334155;
      --sombra: 0 10px 30px rgba(2, 6, 23, 0.5);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--texto);
      font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.6;
    }
    h1, h2, h3, h4 { font-family: Montserrat, Inter, sans-serif; line-height: 1.25; margin: 0 0 .5rem; }
    h1 { font-size: clamp(1.9rem, 4vw, 2.8rem); }
    h2 { font-size: clamp(1.4rem, 2.6vw, 2rem); display: flex; align-items: center; gap: .6rem; }
    h3 { font-size: 1.15rem; }
    h4 { font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-suave); margin-top: 1rem; }
    p { margin: 0 0 1rem; }
    a { color: var(--nexus-500); }
    html.dark a { color: #A5B4FC; }
    code { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; background: rgba(68, 89, 135, .12); padding: .1rem .35rem; border-radius: .35rem; font-size: .9em; }
    .material-symbols-outlined {
      font-family: 'Font Awesome 6 Free' !important;
      font-weight: 900; font-style: normal; font-size: 20px; line-height: 1;
      letter-spacing: normal; text-transform: none; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;
      word-wrap: normal; direction: ltr;
    }
    .visualmente-oculto {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    /* Topbar */
    .topo {
      position: sticky; top: 0; z-index: 40;
      display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
      padding: .75rem 1.5rem;
      background: color-mix(in srgb, var(--card) 92%, transparent);
      border-bottom: 1px solid var(--borda);
      backdrop-filter: blur(10px);
    }
    .topo-marca { display: flex; align-items: center; gap: .75rem; }
    .topo-marca img { width: 40px; height: 40px; object-fit: contain; border-radius: .6rem; }
    .topo-marca strong { display: block; font-family: Montserrat, Inter, sans-serif; font-size: 1.05rem; }
    .topo-marca span { display: block; font-size: .75rem; color: var(--texto-suave); }
    .topo-nav { display: flex; flex-wrap: wrap; gap: .25rem .9rem; font-size: .85rem; }
    .topo-nav a { text-decoration: none; padding: .3rem .1rem; border-bottom: 2px solid transparent; }
    .topo-nav a:hover, .topo-nav a:focus-visible { border-color: var(--nexus-500); }
    .botao-tema {
      display: inline-flex; align-items: center; justify-content: center;
      width: 40px; height: 40px; border-radius: .7rem; cursor: pointer;
      background: var(--bg); color: var(--texto); border: 1px solid var(--borda);
    }
    .botao-tema:hover { background: var(--card); }

    main { max-width: 1180px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
    section { margin-bottom: 3.5rem; scroll-margin-top: 5rem; }
    .secao-texto { color: var(--texto-suave); max-width: 70ch; }

    /* Hero */
    .hero {
      background: linear-gradient(135deg, rgba(68, 89, 135, .12), rgba(68, 89, 135, .02));
      border: 1px solid var(--borda); border-radius: 1.4rem; padding: 2.2rem; box-shadow: var(--sombra);
    }
    .hero-grade { display: flex; flex-direction: column; gap: 2rem; }
    @media (min-width: 900px) {
      .hero-grade {
        display: grid;
        grid-template-columns: 1.35fr 1fr;
        align-items: center;
        gap: 2.5rem;
      }
    }
    .hero-ilustracao { display: flex; align-items: center; justify-content: center; }
    .undraw-hero {
      width: 100%; max-width: 440px; height: auto; object-fit: contain;
      filter: drop-shadow(0 10px 25px rgba(30, 41, 59, 0.08));
    }
    html.dark .undraw-hero { filter: drop-shadow(0 10px 25px rgba(0, 0, 0, 0.45)); }
    .selo {
      display: inline-block; font-size: .72rem; letter-spacing: .12em; text-transform: uppercase;
      font-weight: 700; color: var(--nexus-500); margin-bottom: .6rem;
    }
    html.dark .selo { color: #A5B4FC; }
    .hero-texto { max-width: 78ch; }
    .hero-numeros { display: flex; flex-wrap: wrap; gap: 1.6rem; list-style: none; padding: 0; margin: 1.4rem 0; }
    .hero-numeros li { display: flex; flex-direction: column; }
    .hero-numeros strong { font-family: Montserrat, Inter, sans-serif; font-size: 1.9rem; color: var(--nexus-500); }
    html.dark .hero-numeros strong { color: #A5B4FC; }
    .hero-numeros span { font-size: .82rem; color: var(--texto-suave); }
    .nota {
      display: flex; align-items: flex-start; gap: .6rem; font-size: .86rem; color: var(--texto-suave);
      background: rgba(68, 89, 135, .08); border-left: 3px solid var(--nexus-500);
      padding: .8rem 1rem; border-radius: 0 .7rem .7rem 0; margin: 0;
    }
    .nota .material-symbols-outlined { font-size: 20px; }

    /* Cartões e grades */
    .cartao {
      background: var(--card); border: 1px solid var(--borda); border-radius: 1.1rem;
      padding: 1.35rem; box-shadow: var(--sombra);
    }
    .grade-pilares { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .pilar { display: flex; flex-direction: column; }
    .pilar-ilustracao {
      display: flex; align-items: center; justify-content: center;
      background: rgba(68, 89, 135, .05); border-radius: .8rem;
      padding: .75rem; margin-bottom: .9rem; height: 110px;
    }
    html.dark .pilar-ilustracao { background: rgba(15, 23, 42, .45); }
    .undraw-pilar-img { width: 100%; height: 100%; max-height: 95px; object-fit: contain; }
    .pilar-cabecalho { display: flex; align-items: center; gap: .5rem; margin-bottom: .35rem; }
    .pilar-icone { color: var(--nexus-500); }
    html.dark .pilar-icone { color: #A5B4FC; }
    .pilar h3 { font-size: 1.02rem; margin: 0; }
    .pilar p { margin: 0; font-size: .9rem; color: var(--texto-suave); }

    .grade-arquitetura { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .arq-ilustracao {
      display: flex; align-items: center; justify-content: center;
      background: rgba(68, 89, 135, .04); border-radius: .7rem;
      padding: .6rem; margin-bottom: .8rem; height: 90px;
    }
    html.dark .arq-ilustracao { background: rgba(15, 23, 42, .4); }
    .undraw-arq-img { width: 100%; height: 100%; max-height: 80px; object-fit: contain; }
    .arq header { display: flex; align-items: center; gap: .6rem; margin-bottom: .6rem; }
    .arq header .material-symbols-outlined { color: var(--nexus-500); }
    html.dark .arq header .material-symbols-outlined { color: #A5B4FC; }
    .arq h3 { margin: 0; font-size: 1.05rem; }
    .arq ul { margin: 0; padding-left: 1.1rem; font-size: .88rem; color: var(--texto-suave); }
    .arq li { margin-bottom: .4rem; }

    /* Esteira de status */
    .subtitulo { margin-top: 2.4rem; }
    .esteira { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: .7rem; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); counter-reset: etapa; }
    .esteira li {
      counter-increment: etapa;
      background: var(--card); border: 1px solid var(--borda); border-left-width: 5px;
      border-radius: .8rem; padding: .8rem .9rem; font-size: .82rem;
    }
    .esteira li::before {
      content: counter(etapa);
      display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 50%; margin-right: .45rem;
      background: var(--nexus-500); color: #fff; font-size: .7rem; font-weight: 700;
    }
    .esteira strong { font-family: 'JetBrains Mono', monospace; font-size: .78rem; display: inline; }
    .esteira span { display: block; color: var(--texto-suave); margin-top: .25rem; }
    .esteira li[data-tom="ok"] { border-left-color: var(--ok); }
    .esteira li[data-tom="info"] { border-left-color: var(--nexus-500); }
    .esteira li[data-tom="aviso"] { border-left-color: var(--aviso); }
    .esteira li[data-tom="erro"] { border-left-color: var(--erro); }
    .esteira li[data-tom="neutro"] { border-left-color: #94A3B8; }

    /* Tabelas */
    .tabela-envolucro { overflow-x: auto; border: 1px solid var(--borda); border-radius: 1rem; background: var(--card); }
    table { border-collapse: collapse; width: 100%; font-size: .88rem; min-width: 620px; }
    caption { text-align: left; }
    th, td { text-align: left; padding: .7rem .9rem; border-bottom: 1px solid var(--borda); vertical-align: top; }
    thead th { background: rgba(68, 89, 135, .08); font-size: .78rem; text-transform: uppercase; letter-spacing: .05em; }
    tbody th { font-weight: 600; }
    tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
    .telas-perfil { color: var(--texto-suave); font-size: .82rem; }

    /* Etiquetas */
    .etiqueta {
      display: inline-block; font-size: .72rem; font-weight: 600; padding: .18rem .5rem;
      border-radius: 999px; background: rgba(68, 89, 135, .14); color: var(--nexus-500); white-space: nowrap;
    }
    html.dark .etiqueta { background: rgba(165, 180, 252, .16); color: #C7D2FE; }

    /* Telas */
    .lista-telas { display: grid; gap: 1.4rem; }
    .tela-topo { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-start; }
    .tela-caminho { margin: 0 0 .35rem; font-size: .78rem; color: var(--texto-suave); }
    .tela-subtitulo { margin: .2rem 0 0; font-size: .88rem; color: var(--texto-suave); }
    .tela-etiquetas { display: flex; flex-wrap: wrap; gap: .3rem; max-width: 320px; justify-content: flex-end; }
    .tela-resumo { margin-top: .9rem; }
    .tela-destaques { margin: 0 0 1rem; padding-left: 1.1rem; font-size: .88rem; color: var(--texto-suave); }
    .tela-destaques li { margin-bottom: .3rem; }
    .tela-acesso {
      display: flex; align-items: center; gap: .5rem; margin: 1rem 0 0;
      font-size: .82rem; color: var(--texto-suave);
    }
    .tela-acesso .material-symbols-outlined { font-size: 18px; }

    /* Rodapé */
    footer {
      border-top: 1px solid var(--borda); background: var(--card); padding: 1.6rem 1.5rem;
      font-size: .82rem; color: var(--texto-suave);
    }
    footer .rodape-conteudo { max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: .6rem 1.2rem; justify-content: space-between; }
    footer a[aria-current="page"] { font-weight: 700; text-decoration: none; }
`;

const SCRIPT = `
    // Tema claro/escuro (mesma chave usada pelas páginas do sistema).
    (function () {
      var raiz = document.documentElement;
      var salvo = null;
      try { salvo = localStorage.getItem('nexus_theme'); } catch (e) {}
      if (salvo === 'dark') raiz.classList.add('dark');

      var botao = document.getElementById('botaoTema');
      var icone = document.getElementById('iconeTema');
      function pintarIcone() {
        if (!icone) return;
        var escuro = raiz.classList.contains('dark');
        icone.setAttribute('data-icon', escuro ? 'light_mode' : 'dark_mode');
        icone.classList.toggle('fa-sun', escuro);
        icone.classList.toggle('fa-moon', !escuro);
      }
      pintarIcone();
      if (botao) {
        botao.addEventListener('click', function () {
          var escuro = raiz.classList.toggle('dark');
          try { localStorage.setItem('nexus_theme', escuro ? 'dark' : 'light'); } catch (e) {}
          pintarIcone();
        });
      }
    })();
`;

// ---------------------------------------------------------------------------
// Montagem do documento
// ---------------------------------------------------------------------------
function gerarHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NexusPort — Como funciona o sistema</title>
  <meta name="description" content="Explicação institucional do funcionamento do sistema NexusPort (Terminal STS-01, Porto de Santos), do fluxo operacional das cargas e das funcionalidades de cada página." />
  <meta name="color-scheme" content="light dark" />
  <link rel="icon" href="favicon.ico" type="image/x-icon" />

  <!-- Tipografia e ícones locais (css/fonts.css, gerado por tools/assets.js): sem Google Fonts, a
       página não depende de terceiros para renderizar e fica igual às demais telas. -->
  <link rel="preload" href="fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="fonts/inter-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="css/fonts.css?v=20261012-icons" />
  <style>${CSS}  </style>
</head>
<body>

${blocoCabecalho()}

  <main>
${blocoHero()}

${blocoFluxo()}

${blocoArquitetura()}

${blocoPerfis()}

${blocoTelas()}
  </main>

  <footer>
    <div class="rodape-conteudo">
      <span>NexusPort © ${new Date().getFullYear()} — Terminal STS-01, Porto de Santos</span>
      <span>Documentação institucional do fluxo operacional e das funcionalidades por página</span>
      <span>Ícones e ilustrações por <a href="https://undraw.co/" target="_blank" rel="noopener noreferrer">unDraw</a></span>
      <span><a href="about.html" aria-current="page">Como funciona o sistema</a> · <a href="index.html">Acessar o sistema</a></span>
    </div>
  </footer>

  <script>${SCRIPT}  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------
function principal() {
  const opcoes = analisarArgumentos(process.argv.slice(2));
  const html = gerarHtml();
  fs.writeFileSync(opcoes.saida, html);
  console.log(`about.html gerado: ${path.relative(RAIZ, opcoes.saida)} (${(html.length / 1024).toFixed(0)} kB, ${PAGINAS_DO_ABOUT.length} páginas documentadas)`);
}

if (require.main === module) {
  try {
    principal();
  } catch (erro) {
    console.error(`Falha ao gerar o about.html: ${erro.message}`);
    process.exit(1);
  }
}

module.exports = { gerarHtml, CSS, SCRIPT };
