#!/usr/bin/env node
/**
 * GERADOR DO about.html — NexusPort.
 *
 * Lê as capturas e o manifest.json produzidos por tools/screenshots/capturar.js e
 * escreve o `about.html` na raiz do projeto: uma página estática, autocontida, que
 * explica como o sistema funciona (arquitetura, fluxo operacional, perfis, regras de
 * segurança) e mostra, tela por tela, as capturas de cada conta de demonstração.
 *
 * Uso:
 *   node tools/screenshots/capturar.js          # gera docs/screenshots/*.png + manifest.json
 *   node tools/screenshots/gerar-about.js       # gera about.html a partir do manifest
 *
 * Opções: --manifest <arquivo> --saida <arquivo.html>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { PAGINAS } = require('./paginas');
const { CONTAS, CARGO_META } = require('./demo-data');

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

const kb = (bytes) => `${Math.round(bytes / 1024)} kB`;

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
    texto: 'Login pelo código individual vinculado à matrícula, confirmação obrigatória do cargo e sessão em cookie de 12 h (um turno). O cargo define a camada de visão: própria, operacional ou estratégica.'
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
    texto: 'O inspetor executa o checklist item a item. A aprovação só é liberada quando 100% dos itens críticos estão conformes (RN 14); a recusa exige motivo, que vai para a auditoria.'
  },
  {
    icone: 'warehouse',
    undraw: 'logistics.svg',
    undrawAlt: 'Ícone unDraw de armazenagem e logística de contêineres no pátio',
    titulo: '4. Pátio e vínculo',
    texto: 'Aprovada, a carga é armazenada em baia e vinculada a contêiner e navio. O sistema mantém berços, guindastes e a localização das embarcações com ETA por rota.'
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
    texto: 'O scanner QR funciona no celular: leitura por câmera ou digitação, com registro da leitura. O botão de pânico é global e propaga o alerta em tempo real para todas as telas.'
  }
];

const ARQUITETURA = [
  {
    icone: 'web',
    undraw: 'source-code.svg',
    undrawAlt: 'Ícone unDraw de front-end estático em JavaScript',
    titulo: 'Front-end estático',
    itens: [
      'HTML5 + Tailwind CSS + JavaScript ES6 (módulos por página em js/pages/).',
      'Sem framework de build em tempo de execução: o Tailwind é carregado por CDN.',
      'Bibliotecas: Chart.js (gráficos), qrcode.js (etiquetas), html5-qrcode (leitura por câmera) e jsPDF (documentos no cliente).',
      'Layout compartilhado em js/layout.js (topbar, sidebar, tema e contadores).'
    ]
  },
  {
    icone: 'storage',
    undraw: 'server.svg',
    undrawAlt: 'Ícone unDraw de banco de dados e PostgREST Supabase',
    titulo: 'Supabase (PostgreSQL + PostgREST)',
    itens: [
      'Acesso direto ao PostgREST com a chave anônima; RLS e políticas controlam o que cada consulta enxerga.',
      'Tabelas operacionais: funcionarios, cargas, containers, navios, bercos, guindastes, manutencoes, inspecoes, visitantes.',
      'Auditoria em logs_alteracoes (append-only) e decisões em trail_decisoes + retificacoes_trail.',
      'Realtime (WebSocket) avisa as telas quando um registro muda e sustenta o alarme do botão de pânico.'
    ]
  },
  {
    icone: 'functions',
    undraw: 'cloud-sync.svg',
    undrawAlt: 'Ícone unDraw de computação serverless com Edge Functions',
    titulo: 'Edge Functions (Deno)',
    itens: [
      'panic-alert: recebe o acionamento, grava a emergência e publica o alerta no Realtime (com webhook opcional).',
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
      'Anti-XSS: toda saída de dado passa por nexusEsc/nexusJsArg (js/security.js); há teste de regressão estático.',
      'LGPD: o GA4 não recebe nome, matrícula nem código; eventos levam apenas categorias.',
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
      'Documentação completa em SPECs/webmcp.md.'
    ]
  }
];

const REGRAS = [
  ['RN 14 — Inspeção', 'Aprovar carga exige 100% dos itens críticos conformes; qualquer item não conforme bloqueia a aprovação e habilita a recusa com motivo.'],
  ['RN 15 — Credencial', 'Perda ou esquecimento invalida o código individual, reemitido presencialmente pelo Técnico em Portos mantendo a mesma matrícula.'],
  ['RN 12 — Cascata de status', 'A mudança da localização do navio propaga o status das cargas vinculadas (prompt no banco): EM_TRANSITO ↔ ENTREGUE.'],
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
      <a href="#contas">Contas de demonstração</a>
      <a href="#telas">Telas do sistema</a>
      <a href="index.html">Acessar o sistema</a>
    </nav>
    <button id="botaoTema" type="button" class="botao-tema" aria-label="Alternar tema claro/escuro">
      <span class="material-symbols-outlined" id="iconeTema" aria-hidden="true">dark_mode</span>
    </button>
  </header>`;
}

function blocoHero(manifest, totalCapturas) {
  const contas = manifest.contas || [];
  return `  <!-- Hero -->
  <section class="hero" id="inicio">
    <div class="hero-grade">
      <div class="hero-conteudo">
        <p class="selo">Documentação ilustrada • ${new Date(manifest.geradoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })} • Ícones por <a href="https://undraw.co/" target="_blank" rel="noopener noreferrer">unDraw</a></p>
        <h1>Como funciona o sistema NexusPort</h1>
        <p class="hero-texto">
          O NexusPort é a plataforma de gestão operacional do <strong>Terminal STS-01 (Porto de Santos)</strong>.
          Ele acompanha a carga do agendamento à entrega, formaliza a inspeção técnica, controla o pátio e as
          embarcações e mantém uma trilha auditável de todas as decisões críticas. Esta página explica o
          funcionamento de cada parte e mostra, com capturas reais, o que cada perfil vê ao entrar.
        </p>
        <ul class="hero-numeros">
          <li><strong>${contas.length}</strong><span>contas de demonstração</span></li>
          <li><strong>${totalCapturas}</strong><span>telas capturadas</span></li>
          <li><strong>10</strong><span>cargos com visões distintas</span></li>
          <li><strong>9</strong><span>status no fluxo da carga</span></li>
        </ul>
        <p class="nota">
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
          <span>As capturas desta página foram geradas em ambiente local com dados fictícios de demonstração
          (equivalente ao <code>supabase/seed.sql</code>) e sem credenciais de produção.</span>
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
          <span class="material-symbols-outlined pilar-icone" aria-hidden="true">${esc(p.icone)}</span>
          <h3>${esc(p.titulo)}</h3>
        </div>
        <p>${esc(p.texto)}</p>
      </article>`).join('\n');

  return `  <!-- Fluxo operacional -->
  <section id="fluxo">
    <h2><span class="material-symbols-outlined" aria-hidden="true">route</span> Fluxo operacional, do agendamento à auditoria</h2>
    <p class="secao-texto">
      Cada pilar abaixo corresponde a um conjunto de telas e regras do sistema. A ordem é a do uso
      diário no terminal: identidade, entrada da carga, inspeção, pátio, despacho, comando e campo.
    </p>
    <div class="grade-pilares">
${cards}
    </div>

    <h3 class="subtitulo">Esteira de status da carga</h3>
    <ol class="esteira">
      <li data-tom="neutro"><strong>AGENDAMENTO</strong><span>Data prevista de entrega e destino registrados.</span></li>
      <li data-tom="info"><strong>RECEBIMENTO_INSPECAO</strong><span>Carga na guarita, aguardando conferência.</span></li>
      <li data-tom="ok"><strong>ARMAZENAGEM</strong><span>Inspecionada e guardada na baia do pátio.</span></li>
      <li data-tom="ok"><strong>PRONTA_PARA_ENTREGA</strong><span>Arrumada e liberada para o cliente.</span></li>
      <li data-tom="info"><strong>SAIDA</strong><span>Em saída do terminal, com etiqueta e QR conferidos.</span></li>
      <li data-tom="info"><strong>EM_TRANSITO</strong><span>Embarcada e a caminho do porto de destino.</span></li>
      <li data-tom="ok"><strong>ENTREGUE</strong><span>Entrega confirmada no destino.</span></li>
      <li data-tom="aviso"><strong>CANCELADA</strong><span>Cancelamento autorizado e registrado.</span></li>
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
          <span class="material-symbols-outlined" aria-hidden="true">${esc(a.icone)}</span>
          <h3>${esc(a.titulo)}</h3>
        </header>
        <ul>
${a.itens.map((i) => `          <li>${esc(i)}</li>`).join('\n')}
        </ul>
      </article>`).join('\n');

  return `  <!-- Arquitetura -->
  <section id="arquitetura">
    <h2><span class="material-symbols-outlined" aria-hidden="true">account_tree</span> Como o sistema é construído</h2>
    <p class="secao-texto">
      O NexusPort é um front-end estático que conversa direto com o Supabase (PostgREST, Realtime e
      Edge Functions). Não há servidor de aplicação próprio: as regras vivem nas telas, nas políticas do
      banco e nas funções de borda.
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
    const telas = PAGINAS
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
    <h2><span class="material-symbols-outlined" aria-hidden="true">badge</span> Perfis, camadas de visão e acessos</h2>
    <p class="secao-texto">
      O cargo vem do cadastro funcional e não pode ser trocado na tela: ao confirmar, o operador assume a
      camada de visão correspondente. As telas abaixo são as liberadas para cada cargo pela matriz
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

function blocoContas(manifest) {
  const cartoes = (manifest.contas || []).map((conta) => {
    const primarias = conta.paginas.filter((p) => !p.sufixo);
    const capa = (primarias.find((p) => p.pagina === 'dashboard') || primarias[0] || {}).imagem;
    return `      <article class="cartao conta" id="conta-${esc(conta.matricula.toLowerCase())}">
        <header>
          <span class="avatar" aria-hidden="true">${esc(conta.nome.split(' ').map((n) => n[0]).slice(0, 2).join(''))}</span>
          <div>
            <h3>${esc(conta.nome)}</h3>
            <p class="conta-cargo">${esc(conta.cargoNome)}</p>
          </div>
        </header>
        <dl class="conta-dados">
          <div><dt>Matrícula</dt><dd><code>${esc(conta.matricula)}</code></dd></div>
          <div><dt>Código individual</dt><dd><code>${esc(conta.codigo)}</code></dd></div>
          <div><dt>Nível</dt><dd>${esc(conta.nivel)}</dd></div>
          <div><dt>Camada</dt><dd>${esc(conta.camada)}</dd></div>
        </dl>
        <p class="conta-texto">${esc(conta.descricao || '')}</p>
        <p class="conta-resumo">${primarias.length} telas capturadas nesta conta.</p>
        ${capa ? `<a class="miniatura" href="docs/screenshots/${esc(capa)}" data-ampliar="${esc(capa)}">
          <img src="docs/screenshots/${esc(capa)}" alt="Painel do sistema aberto com a conta ${esc(conta.matricula)} (${esc(conta.cargoNome)})" ${atributosTamanho(capa)}loading="lazy" />
          <span class="miniatura-rotulo">Ver as capturas desta conta</span>
        </a>` : ''}
        <a class="botao" href="#galeria-${esc(conta.matricula.toLowerCase())}">Ir para a galeria desta conta</a>
      </article>`;
  }).join('\n');

  return `  <!-- Contas de demonstração -->
  <section id="contas">
    <h2><span class="material-symbols-outlined" aria-hidden="true">key</span> Contas de demonstração usadas nas capturas</h2>
    <p class="secao-texto">
      Para mostrar as três camadas de visão, as capturas foram feitas entrando de verdade em três contas
      de demonstração — cada uma com um cargo diferente e, por consequência, um conjunto distinto de telas.
    </p>
    <div class="grade-contas">
${cartoes}
    </div>
  </section>`;
}

/** Cartão de uma tela, com todas as capturas (por conta) e variantes. */
function cartaoTela(pagina, manifest) {
  const publicas = (manifest.publicas || []).filter((p) => p.pagina === pagina.chave);
  const porConta = (manifest.contas || []).map((conta) => ({
    conta,
    capturas: conta.paginas.filter((p) => p.pagina === pagina.chave)
  })).filter((x) => x.capturas.length);

  const primeira = (publicas[0] || (porConta[0] && porConta[0].capturas[0]) || {});
  const cargos = pagina.cargos || [];
  const contasComAcesso = porConta.map((x) => x.conta.matricula);

  const galeria = [];
  publicas.filter((c) => !c.sufixo).forEach((captura) => {
    galeria.push(linhaCaptura(captura, 'Acesso público', 'sem sessão'));
  });
  porConta.forEach(({ conta, capturas }) => {
    capturas.filter((c) => !c.sufixo).forEach((captura) => {
      galeria.push(linhaCaptura(captura, conta.matricula, `${conta.nome} — ${conta.cargoNome}`));
    });
  });
  const extras = []
    .concat(publicas.filter((c) => c.sufixo), porConta.flatMap(({ conta, capturas }) => capturas
      .filter((c) => c.sufixo)
      .map((c) => ({ ...c, contaFixa: conta.matricula }))));

  const destaques = (pagina.destaques || []).map((d) => `            <li>${esc(d)}</li>`).join('\n');

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
        <ul class="tela-destaques">
${destaques}
        </ul>

        ${primeira.imagem ? `<a class="miniatura miniatura-principal" href="docs/screenshots/${esc(primeira.imagem)}" data-ampliar="${esc(primeira.imagem)}">
          <img src="docs/screenshots/${esc(primeira.imagem)}" alt="Captura da tela ${esc(pagina.titulo)}" ${atributosTamanho(primeira.imagem)}loading="lazy" />
          <span class="miniatura-rotulo">Ampliar imagem</span>
        </a>` : ''}

        <div class="tela-capturas">
          <h4>Capturas por conta</h4>
          <ul class="lista-capturas">
${galeria.join('\n')}
          </ul>
          ${extras.length ? `<h4>Estados adicionais</h4>
          <ul class="lista-capturas">
${extras.map((c) => linhaCaptura(c, c.contaFixa || 'público', c.descricao)).join('\n')}
          </ul>` : ''}
        </div>

        <p class="tela-acesso">
          <span class="material-symbols-outlined" aria-hidden="true">verified_user</span>
          ${contasComAcesso.length
    ? `Contas de demonstração com acesso: ${esc(contasComAcesso.join(', '))}`
    : 'Tela pública (não exige sessão)'}
        </p>
      </article>`;
}

/** Dimensões reais de um PNG (cabeçalho IHDR) — a caixa da imagem é reservada no HTML. */
const cacheDimensoes = new Map();
function dimensoesImagem(arquivo) {
  if (cacheDimensoes.has(arquivo)) return cacheDimensoes.get(arquivo);
  const caminho = path.join(RAIZ, 'docs', 'screenshots', arquivo);
  const buf = fs.readFileSync(caminho);
  const medidas = { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  cacheDimensoes.set(arquivo, medidas);
  return medidas;
}

/** Atributos width/height de uma captura (evita "imagem sem tamanho explícito" no Lighthouse). */
function atributosTamanho(arquivo) {
  const { largura, altura } = dimensoesImagem(arquivo);
  return `width="${largura}" height="${altura}" `;
}

function linhaCaptura(captura, rotulo, detalhe) {
  return `            <li>
              <a href="docs/screenshots/${esc(captura.imagem)}" data-ampliar="${esc(captura.imagem)}">
                <span class="captura-rotulo"><code>${esc(rotulo)}</code>${detalhe ? ` <span class="captura-detalhe">${esc(detalhe)}</span>` : ''}</span>
                <span class="captura-meta">${esc(captura.titulo)} • ${esc(kb(captura.bytes))}</span>
              </a>
            </li>`;
}

function blocoGaleria(manifest) {
  const comCapturas = PAGINAS.filter((pagina) => {
    const temPublica = (manifest.publicas || []).some((p) => p.pagina === pagina.chave);
    const temConta = (manifest.contas || []).some((c) => c.paginas.some((p) => p.pagina === pagina.chave));
    return temPublica || temConta;
  });

  const cartoes = comCapturas.map((pagina) => cartaoTela(pagina, manifest)).join('\n\n');

  // Índice por conta: cada conta com a lista de telas que ela acessa.
  const indices = (manifest.contas || []).map((conta) => {
    const telas = conta.paginas.filter((p) => !p.sufixo).map((p) => p.pagina);
    const links = [...new Set(telas)].map((chave) => {
      const pagina = PAGINAS.find((p) => p.chave === chave);
      return pagina ? `<a href="#tela-${esc(pagina.chave)}">${esc(pagina.titulo)}</a>` : '';
    }).filter(Boolean).join(', ');
    return `        <li id="galeria-${esc(conta.matricula.toLowerCase())}"><strong>${esc(conta.matricula)}</strong> — ${esc(conta.cargoNome)}: ${links}</li>`;
  }).join('\n');

  return `  <!-- Telas do sistema -->
  <section id="telas">
    <h2><span class="material-symbols-outlined" aria-hidden="true">screenshot_monitor</span> Telas do sistema, uma a uma</h2>
    <p class="secao-texto">
      Abaixo está cada tela capturada, com o que ela faz, as decisões registradas e as imagens de cada
      conta que tem acesso. Clique em qualquer imagem para ampliar.
    </p>
    <div class="indice-contas">
      <h3>Galeria por conta de demonstração</h3>
      <ul>
${indices}
      </ul>
    </div>

    <div class="lista-telas">
${cartoes}
    </div>
  </section>`;
}

function blocoComoFoiFeito(manifest) {
  return `  <!-- Como as capturas foram feitas -->
  <section id="capturas">
    <h2><span class="material-symbols-outlined" aria-hidden="true">photo_camera</span> Como estas capturas foram produzidas</h2>
    <p class="secao-texto">
      As imagens desta página não são montagens: cada uma é uma captura de página inteira feita por
      Chromium automatizado, entrando de verdade pelas três contas de demonstração.
    </p>
    <div class="grade-duas-colunas">
      <article class="cartao">
        <h3>Fluxo executado pelo script</h3>
        <ol class="lista-numerada">
          <li>Sobe um PostgREST simulado com os dados de demonstração (tools/screenshots/demo-data.js).</li>
          <li>Serve o repositório por HTTP local, com o Supabase apontando para esse servidor.</li>
          <li>Responde os CDNs com arquivos vendorizados: Tailwind, Inter/Montserrat/JetBrains Mono, Material Symbols, supabase-js, Chart.js, qrcode.js, jsPDF e html5-qrcode.</li>
          <li>Faz login com a matrícula, confirma o cargo e navega pelas telas liberadas ao perfil.</li>
          <li>Salva um PNG de página inteira por tela e atualiza <code>docs/screenshots/manifest.json</code>.</li>
        </ol>
        <pre><code>npm install --prefix tools/screenshots
CHROME_PATH=/usr/bin/chromium node tools/screenshots/capturar.js
node tools/screenshots/gerar-about.js</code></pre>
      </article>
      <article class="cartao">
        <h3>Limites do ambiente de captura</h3>
        <ul class="lista-limites">
          <li><strong>Widget VLibras:</strong> a janela de Libras não aparece nas imagens porque o serviço externo não é alcançado pelo ambiente. A integração segue no código de todas as páginas.</li>
          <li><strong>Realtime:</strong> os WebSockets estão desativados nas capturas; o app opera com a sincronização de 60 s já prevista no código.</li>
          <li><strong>GA4:</strong> a medição de uso não é executada nas capturas (nenhum evento é enviado).</li>
          <li><strong>Câmera e GPS:</strong> sem hardware no ambiente, os painéis de leitura e mapa aparecem no estado inicial das telas.</li>
          <li><strong>Dados:</strong> 100% fictícios, derivados do seed de demonstração. Nenhuma informação real de operador ou carga.</li>
        </ul>
      </article>
    </div>
  </section>`;
}

function blocoExecucao() {
  return `  <!-- Como executar -->
  <section id="executar">
    <h2><span class="material-symbols-outlined" aria-hidden="true">terminal</span> Como executar e conferir o sistema</h2>
    <div class="grade-duas-colunas">
      <article class="cartao">
        <h3>1. Configurar o Supabase</h3>
        <pre><code>cp js/config.example.js js/config.js   # informe URL e chave anônima
supabase db push                        # aplica as migrações
supabase functions deploy panic-alert --no-verify-jwt</code></pre>
        <p>Sem as chaves, o sistema abre em modo local/simulação — útil para demonstrar a navegação.</p>
      </article>
      <article class="cartao">
        <h3>2. Subir a interface</h3>
        <pre><code>npm start        # http://localhost:3000
npm run build    # dist/ minificado (o mesmo que a Vercel publica)</code></pre>
        <p>Entre com um código individual de demonstração, por exemplo <code>MOCK-INSPETOR-123</code>, ou com uma das três contas desta página.</p>
      </article>
      <article class="cartao">
        <h3>3. Conferir as garantias</h3>
        <pre><code>npm test                 # suíte completa (jsdom)
npm run audit:xss        # regressão anti-XSS
npm run test:webmcp      # ferramentas de agentes de IA
npm run lighthouse       # gate de qualidade por página</code></pre>
      </article>
      <article class="cartao">
        <h3>4. Documentação do projeto</h3>
        <ul>
          <li><code>README.md</code> — visão geral dos recursos e da implantação.</li>
          <li><code>SPECs/Spec.md</code> — requisitos funcionais e regras de negócio.</li>
          <li><code>SPECs/schema.sql</code> e <code>TABLES.md</code> — banco de dados.</li>
          <li><code>SPECs/webmcp.md</code> — arquitetura das ferramentas de IA.</li>
        </ul>
      </article>
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
    h4 { font-size: .95rem; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-suave); margin-top: 1.5rem; }
    p { margin: 0 0 1rem; }
    a { color: var(--nexus-500); }
    html.dark a { color: #A5B4FC; }
    code, pre { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace; }
    code { background: rgba(68, 89, 135, .12); padding: .1rem .35rem; border-radius: .35rem; font-size: .9em; }
    pre {
      background: var(--nexus-900); color: #E2E8F0; padding: 1rem 1.1rem; border-radius: .9rem;
      overflow-x: auto; font-size: .82rem; line-height: 1.5;
    }
    pre code { background: none; color: inherit; padding: 0; }
    .material-symbols-outlined {
      font-family: 'Material Symbols Outlined';
      font-weight: normal; font-style: normal; font-size: 24px; line-height: 1;
      letter-spacing: normal; text-transform: none; display: inline-block; white-space: nowrap;
      word-wrap: normal; direction: ltr; -webkit-font-feature-settings: 'liga'; font-feature-settings: 'liga';
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
    .hero-grade {
      display: flex; flex-direction: column; gap: 2rem;
    }
    @media (min-width: 900px) {
      .hero-grade {
        display: grid;
        grid-template-columns: 1.35fr 1fr;
        align-items: center;
        gap: 2.5rem;
      }
    }
    .hero-ilustracao {
      display: flex; align-items: center; justify-content: center;
    }
    .undraw-hero {
      width: 100%; max-width: 440px; height: auto; object-fit: contain;
      filter: drop-shadow(0 10px 25px rgba(30, 41, 59, 0.08));
    }
    html.dark .undraw-hero {
      filter: drop-shadow(0 10px 25px rgba(0, 0, 0, 0.45));
    }
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

    /* Contas */
    .grade-contas { display: grid; gap: 1.2rem; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
    .conta header { display: flex; align-items: center; gap: .8rem; margin-bottom: 1rem; }
    .conta h3 { margin: 0; }
    .conta-cargo { margin: 0; font-size: .86rem; color: var(--texto-suave); }
    .avatar {
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      width: 46px; height: 46px; border-radius: 50%; font-weight: 700; color: #fff;
      background: linear-gradient(135deg, var(--nexus-500), var(--nexus-900));
    }
    .conta-dados { display: grid; gap: .5rem; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin: 0 0 1rem; }
    .conta-dados dt { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-suave); }
    .conta-dados dd { margin: 0; font-size: .9rem; }
    .conta-texto, .conta-resumo { font-size: .86rem; color: var(--texto-suave); }
    .botao {
      display: inline-block; margin-top: .4rem; padding: .55rem .9rem; border-radius: .7rem;
      background: var(--nexus-500); color: #fff; text-decoration: none; font-size: .85rem; font-weight: 600;
    }
    .botao:hover { background: var(--nexus-900); }

    /* Miniaturas */
    .miniatura { position: relative; display: block; margin: .8rem 0; border-radius: .9rem; overflow: hidden; border: 1px solid var(--borda); }
    .miniatura img { display: block; width: 100%; height: auto; max-height: 340px; object-fit: cover; object-position: top center; }
    .miniatura-principal img { max-height: 620px; object-fit: contain; background: var(--bg); }
    .miniatura-rotulo {
      position: absolute; right: .6rem; bottom: .6rem; font-size: .72rem; font-weight: 600;
      background: rgba(15, 23, 42, .82); color: #fff; padding: .25rem .6rem; border-radius: 999px;
    }

    /* Telas */
    .lista-telas { display: grid; gap: 1.4rem; }
    .tela-topo { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: flex-start; }
    .tela-caminho { margin: 0 0 .35rem; font-size: .78rem; color: var(--texto-suave); }
    .tela-subtitulo { margin: .2rem 0 0; font-size: .88rem; color: var(--texto-suave); }
    .tela-etiquetas { display: flex; flex-wrap: wrap; gap: .3rem; max-width: 320px; justify-content: flex-end; }
    .tela-resumo { margin-top: .9rem; }
    .tela-destaques { margin: 0 0 1rem; padding-left: 1.1rem; font-size: .88rem; color: var(--texto-suave); }
    .tela-destaques li { margin-bottom: .3rem; }
    .lista-capturas { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; }
    .lista-capturas a {
      display: flex; flex-wrap: wrap; gap: .4rem 1rem; justify-content: space-between;
      padding: .55rem .7rem; border: 1px solid var(--borda); border-radius: .6rem;
      text-decoration: none; color: inherit; font-size: .84rem; background: var(--bg);
    }
    .lista-capturas a:hover { border-color: var(--nexus-500); }
    .captura-rotulo code { background: none; padding: 0; font-weight: 600; }
    .captura-detalhe { color: var(--texto-suave); }
    .captura-meta { color: var(--texto-suave); font-size: .78rem; }
    .tela-acesso {
      display: flex; align-items: center; gap: .5rem; margin: 1rem 0 0;
      font-size: .82rem; color: var(--texto-suave);
    }
    .tela-acesso .material-symbols-outlined { font-size: 18px; }
    .indice-contas { margin-bottom: 1.4rem; }
    .indice-contas ul { margin: 0; padding-left: 1.1rem; font-size: .88rem; color: var(--texto-suave); }
    .indice-contas li { margin-bottom: .3rem; }

    /* Blocos finais */
    .grade-duas-colunas { display: grid; gap: 1.1rem; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    .lista-numerada { margin: 0 0 1rem; padding-left: 1.2rem; font-size: .88rem; color: var(--texto-suave); }
    .lista-limites { margin: 0; padding-left: 1.1rem; font-size: .88rem; color: var(--texto-suave); }
    .lista-limites li { margin-bottom: .5rem; }

    /* Rodapé */
    footer {
      border-top: 1px solid var(--borda); background: var(--card); padding: 1.6rem 1.5rem;
      font-size: .82rem; color: var(--texto-suave);
    }
    footer .rodape-conteudo { max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: .6rem 1.2rem; justify-content: space-between; }

    /* Lightbox */
    dialog.lightbox {
      border: 0; padding: 0; background: transparent; max-width: 96vw; max-height: 96vh;
    }
    dialog.lightbox::backdrop { background: rgba(15, 23, 42, .85); }
    dialog.lightbox img { display: block; max-width: 96vw; max-height: 88vh; border-radius: .8rem; }
    .lightbox-fechar {
      position: absolute; top: -2.6rem; right: 0; background: #fff; color: #1E293B; border: 0;
      border-radius: .5rem; padding: .35rem .7rem; cursor: pointer; font-weight: 600;
    }
    .lightbox-legenda {
      color: #E2E8F0; font-size: .82rem; margin: .6rem 0 0; text-align: center;
    }
`;

const SCRIPT = `
    // Tema (mesma chave usada pelas telas do sistema) e lightbox das capturas.
    (function () {
      var raiz = document.documentElement;
      var salvo = null;
      try { salvo = localStorage.getItem('nexus_theme'); } catch (e) {}
      if (salvo === 'dark') raiz.classList.add('dark');

      var botao = document.getElementById('botaoTema');
      var icone = document.getElementById('iconeTema');
      function pintarIcone() {
        if (icone) icone.textContent = raiz.classList.contains('dark') ? 'light_mode' : 'dark_mode';
      }
      pintarIcone();
      if (botao) {
        botao.addEventListener('click', function () {
          var escuro = raiz.classList.toggle('dark');
          try { localStorage.setItem('nexus_theme', escuro ? 'dark' : 'light'); } catch (e) {}
          pintarIcone();
        });
      }

      var caixa = document.getElementById('lightbox');
      var imagem = document.getElementById('lightboxImagem');
      var legenda = document.getElementById('lightboxLegenda');
      document.querySelectorAll('[data-ampliar]').forEach(function (link) {
        link.addEventListener('click', function (evento) {
          if (!caixa || typeof caixa.showModal !== 'function') return;
          evento.preventDefault();
          var arquivo = link.getAttribute('data-ampliar');
          imagem.src = 'docs/screenshots/' + arquivo;
          imagem.alt = (link.querySelector('img') && link.querySelector('img').alt) || 'Captura da tela';
          legenda.textContent = arquivo;
          caixa.showModal();
        });
      });
      var fechar = document.getElementById('lightboxFechar');
      if (fechar) fechar.addEventListener('click', function () { caixa.close(); });
      if (caixa) caixa.addEventListener('click', function (evento) { if (evento.target === caixa) caixa.close(); });
    })();
`;

// ---------------------------------------------------------------------------
// Montagem do documento
// ---------------------------------------------------------------------------
function gerarHtml(manifest) {
  const totalCapturas = (manifest.publicas || []).length
    + (manifest.contas || []).reduce((acc, c) => acc + c.paginas.length, 0);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NexusPort — Como funciona o sistema (documentação ilustrada)</title>
  <meta name="description" content="Explicação do funcionamento do sistema NexusPort (Terminal STS-01, Porto de Santos) com capturas de tela de cada página acessada pelas contas de demonstração MAT-0000, MAT-2011 e MAT-9999." />
  <meta name="color-scheme" content="light dark" />
  <link rel="icon" href="favicon.ico" type="image/x-icon" />

  <!-- Tipografia e ícones locais (css/fonts.css, gerado por tools/assets.js): sem Google Fonts, a
       página não depende de terceiros para renderizar e fica igual às demais telas. -->
  <link rel="preload" href="fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="fonts/inter-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="css/fonts.css" />
  <style>${CSS}  </style>
</head>
<body>

${blocoCabecalho()}

  <main>
${blocoHero(manifest, totalCapturas)}

${blocoFluxo()}

${blocoArquitetura()}

${blocoPerfis()}

${blocoContas(manifest)}

${blocoGaleria(manifest)}

${blocoComoFoiFeito(manifest)}

${blocoExecucao()}
  </main>

  <footer>
    <div class="rodape-conteudo">
      <span>NexusPort © ${new Date().getFullYear()} — Terminal STS-01, Porto de Santos</span>
      <span>Documentação ilustrada gerada a partir de ${totalCapturas} capturas de tela</span>
      <span>Ícones e ilustrações por <a href="https://undraw.co/" target="_blank" rel="noopener noreferrer">unDraw</a></span>
      <span><a href="index.html">Acessar o sistema</a> · <a href="README.md">README</a></span>
    </div>
  </footer>

  <dialog id="lightbox" class="lightbox" aria-label="Captura de tela ampliada">
    <button type="button" id="lightboxFechar" class="lightbox-fechar">Fechar ✕</button>
    <img id="lightboxImagem" src="" alt="" />
    <p id="lightboxLegenda" class="lightbox-legenda"></p>
  </dialog>

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
  if (!fs.existsSync(opcoes.manifest)) {
    throw new Error(
      `Manifesto não encontrado em ${opcoes.manifest}.\n`
      + 'Rode primeiro: node tools/screenshots/capturar.js'
    );
  }

  const manifest = JSON.parse(fs.readFileSync(opcoes.manifest, 'utf-8'));
  const pastaImagens = path.join(path.dirname(opcoes.manifest));

  // Só publica capturas que existem no disco (evita imagem quebrada).
  const existe = (captura) => fs.existsSync(path.join(pastaImagens, captura.imagem));
  const antes = (manifest.publicas || []).length
    + (manifest.contas || []).reduce((acc, c) => acc + c.paginas.length, 0);
  manifest.publicas = (manifest.publicas || []).filter(existe);
  manifest.contas.forEach((conta) => {
    conta.paginas = conta.paginas.filter(existe);
  });
  const depois = manifest.publicas.length + manifest.contas.reduce((acc, c) => acc + c.paginas.length, 0);
  if (antes !== depois) console.warn(`Aviso: ${antes - depois} captura(s) do manifesto não existem em disco e foram ignoradas.`);

  const html = gerarHtml(manifest);
  fs.writeFileSync(opcoes.saida, html);
  console.log(`about.html gerado: ${path.relative(RAIZ, opcoes.saida)} (${(html.length / 1024).toFixed(0)} kB, ${depois} capturas)`);
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
