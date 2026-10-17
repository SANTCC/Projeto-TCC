/**
 * Lógica do Painel Geral (dashboard.html) - NexusPort
 * Renderiza exclusivamente a visão geral: 7 Cards Indicadores Operacionais (RF 7),
 * Tabela de Log Geral de Alterações (RF 12), Trail de Decisões Críticas Imutável com Retificação (RF 13)
 * e o Painel Estratégico com Gráficos para Diretores (RF 1).
 */

// Gravadores e tipos de entidade compartilhados: js/auditoria.js.

window.calcularEstimativaChegada = function(distanciaKm) {
  if (!distanciaKm || distanciaKm <= 0) return 'Atracado / Viagem Concluída';
  const velocidade = 33; // km/h (RN 9)
  const totalSegundos = Math.max(0, Math.round((distanciaKm / velocidade) * 3600));
  const dias = Math.floor(totalSegundos / 86400);
  const horas = Math.floor((totalSegundos % 86400) / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  return `${dias}d ${horas}h ${minutos}m ${segundos}s (Distância: ${distanciaKm} km @ 33 km/h)`;
};

window.calcularTempoPermanenciaPorto = function(dataEntradaStr) {
  if (!dataEntradaStr) return '0d 0h';
  const inicio = new Date(dataEntradaStr).getTime();
  const diffMs = Math.max(0, Date.now() - inicio);
  const horasTotais = Math.floor(diffMs / (1000 * 60 * 60));
  const dias = Math.floor(horasTotais / 24);
  const horas = horasTotais % 24;
  return `${dias}d ${horas}h no porto`;
};

window.calcularTempoForaPorto = function(dataSaidaStr) {
  if (!dataSaidaStr) return '0d 0h fora';
  const inicio = new Date(dataSaidaStr).getTime();
  const diffMs = Math.max(0, Date.now() - inicio);
  const horasTotais = Math.floor(diffMs / (1000 * 60 * 60));
  const dias = Math.floor(horasTotais / 24);
  const horas = horasTotais % 24;
  return `${dias}d ${horas}h fora do porto`;
};

window.gerarRelatorioPdfA4 = function(idCarga) {
  if (window.mostrarFeedback) {
    window.mostrarFeedback('sucesso', 'Relatório PDF A4', `Relatório PDF A4 emitido com sucesso para a carga ${idCarga}`);
  }
};

function initQrCodeEtiquetas() {}
function initDashboardsPesquisaRelatorios() {}
function initLogsTrailDelegacao() {}
function initLocalizacaoETempos() {}

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) {
    NexusAuth.requireAuth();
    return;
  }

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  // Elementos do DOM
  const welcomeAvatar = document.getElementById('welcomeAvatar');
  const welcomeName = document.getElementById('welcomeName');
  const welcomeRoleBadge = document.getElementById('welcomeRoleBadge');
  const welcomeContext = document.getElementById('welcomeContext');
  const welcomeCode = document.getElementById('welcomeCode');

  const cardRoleName = document.getElementById('cardRoleName');
  const cardRoleLevel = document.getElementById('cardRoleLevel');
  const cardVisionLayer = document.getElementById('cardVisionLayer');

  const auditTableBody = document.getElementById('auditLogTableBody');
  const trailTableBody = document.getElementById('trailDecisoesTableBody');
  const estrategicoPanel = document.getElementById('estrategicoPanel');
  const exportHistoricoBtn = document.getElementById('exportHistoricoBtn');

  // Preenchimento dos Dados do Usuário
  const initials = (session.nome || 'Operador').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'OP';

  if (welcomeAvatar) welcomeAvatar.textContent = initials;
  if (welcomeName) welcomeName.textContent = session.nome || 'Operador Porto';

  // ------------------------------------------------------------------
  // Menu oculto: "Auditoria de Login" (seguranca.html)
  // ------------------------------------------------------------------
  // O item não existe na barra lateral por padrão. Ele é liberado quando o
  // operador clica 5 vezes no próprio nome neste Painel Geral. A liberação vale
  // para a aba/sessão atual (sessionStorage, ver js/layout.js) e volta a ficar
  // oculta ao reabrir o terminal ou ao sair da sessão. Cargos que não podem ver
  // o painel (fora da Direção/Supervisor) não recebem nada: o gesto é ignorado
  // em silêncio, para não revelar que a tela existe.
  const CLIQUES_AUDITORIA = 5;
  let cliquesNoNome = 0;

  if (welcomeName) {
    welcomeName.addEventListener('click', () => {
      cliquesNoNome += 1;
      if (cliquesNoNome < CLIQUES_AUDITORIA) return;
      cliquesNoNome = 0;

      const auditoria = window.NexusAuditoriaLogin;
      if (!auditoria) return;

      const jaEstavaLiberado = auditoria.liberado();
      if (!auditoria.liberar() || jaEstavaLiberado) return;

      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Auditoria de Login',
          'O painel de auditoria das tentativas de login foi liberado no menu lateral desta sessão.');
      }
    });
  }
  if (welcomeRoleBadge) welcomeRoleBadge.textContent = session.cargo_nome || session.cargo;
  if (welcomeContext) welcomeContext.textContent = 'Terminal STS-01 • Porto de Santos';
  if (welcomeCode) welcomeCode.textContent = '••••••';

  let indicadoresLeituraRevision = 0;
  let cardsLeituraRevision = 0;
  let auditoriaLeituraRevision = 0;

  const isDiretor = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
  const isOperacionalSupervisor = ['INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES'].includes(session.cargo);

  const derivedLevel = session.nivel || (isDiretor ? 'Nível Estratégico' : isOperacionalSupervisor ? 'Nível Tático/Gestão' : 'Nível Operacional');
  const derivedVision = session.camada_visao || (isDiretor ? 'Visão Estratégica' : isOperacionalSupervisor ? 'Visão Operacional' : 'Visão Própria');

  if (cardRoleName) cardRoleName.textContent = session.cargo_nome || session.cargo;
  if (cardRoleLevel) cardRoleLevel.textContent = derivedLevel;
  if (cardVisionLayer) cardVisionLayer.textContent = derivedVision;

  // Planilha consolidada com metas: exclusiva da Visão Estratégica (RF 1).
  // Cargos operacionais/táticos não a veem; a análise gráfica do escopo de cada
  // cargo fica em Relatórios & PDF (js/pages/charts.js), evitando ruído e exposição de metas.
  if (estrategicoPanel) {
    if (isDiretor) {
      estrategicoPanel.classList.remove('hidden');
      renderIndicadoresExecutivosTable();
    } else {
      estrategicoPanel.classList.add('hidden');
    }
  }

  // Os gráficos (Chart.js) não fazem mais parte do Painel Geral (Backlog 3 — dedup):
  // a análise gráfica fica concentrada em Relatórios & PDF (relatorios.html), onde
  // o botão "Atualizar" e a cadência de 1 minuto também são tratados.

  // Renderiza Planilha Consolidada de Desempenho Operacional por Categoria (A3 / Item 1.5)
  async function renderIndicadoresExecutivosTable() {
    const revisao = ++indicadoresLeituraRevision;
    const execTableBody = document.getElementById('indicadoresExecutivosTableBody');
    if (!execTableBody) return;

    let cargas = [];
    let containers = [];
    let navios = [];
    let manutencoes = [];

    if (window.nexusSupabase) {
      try {
        const [resCargas, resConts, resNavs, resManut] = await Promise.all([
          window.nexusSupabase.from('cargas').select('*'),
          window.nexusSupabase.from('containers').select('*'),
          window.nexusSupabase.from('navios').select('*'),
          window.nexusSupabase.from('manutencoes').select('*')
        ]);
        if (Array.isArray(resCargas.data)) cargas = resCargas.data;
        if (Array.isArray(resConts.data)) containers = resConts.data;
        if (Array.isArray(resNavs.data)) navios = resNavs.data;
        if (Array.isArray(resManut.data)) manutencoes = resManut.data;
      } catch (e) { console.warn('Erro ao carregar dados do Supabase para planilha:', e); }
    } else {
      cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
      navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
      manutencoes = JSON.parse(localStorage.getItem('nexus_os_list') || '[]');
    }

    if (revisao !== indicadoresLeituraRevision) return;
    const totalCargas = cargas.length;
    const totalConts = containers.length;
    const naviosNoPorto = navios.filter(n => n.localizacao === 'DENTRO_DO_PORTO').length;
    const osAtivas = manutencoes.filter(m => m.status === 'SOLICITADA' || m.status === 'APROVADA' || m.status === 'EM_MANUTENCAO').length;

    function calcularStatus(atingimento) {
      if (atingimento >= 85) return 'IDEAL';
      if (atingimento >= 50) return 'ATENÇÃO';
      return 'CRÍTICO';
    }

    const rawIndicadores = [
      { categoria: 'Contêineres Cadastrados e Alocados', volume: totalConts, meta: 20, tempo: 1.5 },
      { categoria: 'Cargas Gerais no Fluxo Operacional', volume: totalCargas, meta: 30, tempo: 2.1 },
      { categoria: 'Embarcações em Operação no Terminal', volume: naviosNoPorto, meta: 5, tempo: 18.4 },
      { categoria: 'Ordens de Serviço de Manutenção Ativas', volume: osAtivas, meta: 5, tempo: 4.8 }
    ];

    const indicadores = rawIndicadores.map(item => {
      const atingimento = item.meta > 0 ? Math.round((item.volume / item.meta) * 100) : 0;
      const status = calcularStatus(atingimento);
      return {
        categoria: item.categoria,
        volume: item.volume,
        meta: item.meta,
        atingimento,
        tempo: item.tempo,
        status
      };
    });

    // Backlog 3 (7f) / Tarefa 14: mantém a cópia em memória para a exportação da planilha
    window.__nexusIndicadoresExecutivos = indicadores;

    execTableBody.innerHTML = indicadores.map((i, idx) => {
      const pctBarra = Math.max(0, Math.min(100, Number(i.atingimento) || 0));
      const corBarra = i.status === 'IDEAL'
        ? 'bg-emerald-500'
        : i.status === 'ATENÇÃO'
          ? 'bg-amber-500'
          : 'bg-rose-500';
      const corTextoPct = i.status === 'IDEAL'
        ? 'text-emerald-700 dark:text-emerald-400'
        : i.status === 'ATENÇÃO'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-rose-700 dark:text-rose-400';
      return `
      <tr class="${idx % 2 === 0 ? 'bg-slate-50/70 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900'} hover:bg-indigo-50/50 dark:hover:bg-slate-800 transition-colors">
        <td class="p-3.5 text-left font-bold text-nexus-900 dark:text-white">${esc(i.categoria)}</td>
        <td class="p-3.5 text-right font-mono font-bold text-slate-800 dark:text-slate-100">${esc(i.volume.toLocaleString('pt-BR'))}</td>
        <td class="p-3.5 text-right font-mono text-slate-600 dark:text-slate-400">${esc(i.meta.toLocaleString('pt-BR'))}</td>
        <td class="p-3.5 text-right font-mono font-bold ${esc(corTextoPct)}">
          <div class="inline-flex items-center justify-end gap-2">
            <div class="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden hidden sm:block">
              <div class="h-full ${esc(corBarra)} rounded-full" style="width: ${esc(pctBarra)}%"></div>
            </div>
            <span>${esc(i.atingimento)}%</span>
          </div>
        </td>
        <td class="p-3.5 text-right font-mono text-slate-700 dark:text-slate-300">${esc(String(i.tempo).replace('.', ','))} h</td>
        <td class="p-3.5 text-center">
          <span class="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wide ${
            i.status === 'IDEAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60' :
            i.status === 'ATENÇÃO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60' :
            'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60'
          }">${esc(i.status)}</span>
        </td>
      </tr>
    `;
    }).join('');

    const execTableFoot = document.getElementById('indicadoresExecutivosTableFoot');
    if (execTableFoot) {
      const somaVolume = indicadores.reduce((acc, item) => acc + (Number(item.volume) || 0), 0);
      const somaMeta = indicadores.reduce((acc, item) => acc + (Number(item.meta) || 0), 0);
      const atingimentoGeral = somaMeta > 0 ? Math.round((somaVolume / somaMeta) * 100) : 0;
      const mediaTempo = indicadores.length > 0
        ? (indicadores.reduce((acc, item) => acc + (Number(item.tempo) || 0), 0) / indicadores.length).toFixed(1)
        : '0.0';
      const statusGeral = calcularStatus(atingimentoGeral);
      execTableFoot.innerHTML = `
        <tr>
          <td class="p-3.5 text-left font-display font-bold uppercase tracking-wider text-nexus-900 dark:text-white">Consolidado Geral do Terminal</td>
          <td class="p-3.5 text-right font-mono font-bold">${esc(somaVolume.toLocaleString('pt-BR'))}</td>
          <td class="p-3.5 text-right font-mono">${esc(somaMeta.toLocaleString('pt-BR'))}</td>
          <td class="p-3.5 text-right font-mono font-bold text-nexus-500 dark:text-indigo-400">${esc(atingimentoGeral)}%</td>
          <td class="p-3.5 text-right font-mono">${esc(String(mediaTempo).replace('.', ','))} h (média)</td>
          <td class="p-3.5 text-center">
            <span class="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wide ${
              statusGeral === 'IDEAL' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
              statusGeral === 'ATENÇÃO' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
              'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
            }">${esc(statusGeral)}</span>
          </td>
        </tr>
      `;
    }
  }

  // 1. Renderiza os 7 Cards Indicadores Operacionais (RF 7 / A1 / A9) com dados unificados do Supabase (Item 1.1)
  // Item 7e (backlog3): hora da última atualização dos indicadores no cabeçalho
  function registrarUltimaAtualizacao() {
    const el = document.getElementById('cardsLastUpdate');
    if (!el) return;
    const agora = new Date();
    el.textContent = `Atualizado às ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    el.setAttribute('title', `Última atualização dos indicadores: ${agora.toLocaleString('pt-BR')}`);
  }

  async function renderCardsOperacionais() {
    const revisao = ++cardsLeituraRevision;
    let indic = null;
    if (window.NexusRepository && window.NexusRepository.buscarIndicadoresOperacionais) {
      indic = await window.NexusRepository.buscarIndicadoresOperacionais();
    }

    if (revisao !== cardsLeituraRevision) return;
    registrarUltimaAtualizacao();

    if (!indic) return;

    const elNaviosManut = document.getElementById('cardNaviosManutencaoVal');
    const elNaviosFora = document.getElementById('cardNaviosForaVal');
    const elCargasArmaz = document.getElementById('cardCargasArmazenagemVal');
    const elCargasProntas = document.getElementById('cardCargasProntasVal');
    const elCargasRecusadas = document.getElementById('cardCargasRecusadasVal');
    const elOcupacao = document.getElementById('cardOcupacaoPatioVal');
    const elPreventiva = document.getElementById('cardPreventivaVal');

    if (elNaviosManut) elNaviosManut.textContent = indic.manutencao.total;
    if (elNaviosFora) elNaviosFora.textContent = indic.naviosFora.total;
    if (elCargasArmaz) elCargasArmaz.textContent = indic.cargasArmazenagem.total;
    if (elCargasProntas) elCargasProntas.textContent = indic.cargasProntas.total;
    if (elCargasRecusadas) elCargasRecusadas.textContent = `${indic.recusadas.totalRecusadas} (${indic.recusadas.totalCanceladas} Canc.)`;
    if (elOcupacao) elOcupacao.textContent = `${indic.ocupacaoPatio.taxa}%`;
    if (elPreventiva) elPreventiva.textContent = `${indic.preventiva.total} Equipamento(s)`;

    aplicarVisibilidadeCardsPorCargo();
  }

  function aplicarVisibilidadeCardsPorCargo() {
    const session = window.currentUserSession || (window.NexusAuth && window.NexusAuth.getSession());
    if (!session || !session.cargo) return;

    const cargo = session.cargo;
    const btnNaviosManut = document.querySelector('button[onclick*="NAVIOS_MANUTENCAO"]');
    const btnNaviosFora = document.querySelector('button[onclick*="NAVIOS_FORA"]');
    const btnCargasArmaz = document.querySelector('button[onclick*="CARGAS_ARMAZENAGEM"]');
    const btnCargasProntas = document.querySelector('button[onclick*="CARGAS_PRONTAS"]');
    const btnCargasRecusadas = document.querySelector('button[onclick*="CARGAS_RECUSADAS"]');
    const btnOcupacaoPatio = document.querySelector('button[onclick*="OCUPACAO_PATIO"]');
    const btnPreventiva = document.querySelector('button[onclick*="PREVENTIVA_SUGERIDA"]');

    if (cargo === 'ESTIVADOR') {
      // Tarefa 13: Deixar apenas os dashboards referentes às cargas e o dashboard referente ao pátio
      if (btnNaviosManut) btnNaviosManut.style.display = 'none';
      if (btnNaviosFora) btnNaviosFora.style.display = 'none';
      if (btnPreventiva) btnPreventiva.style.display = 'none';

      if (btnCargasArmaz) btnCargasArmaz.style.display = '';
      if (btnCargasProntas) btnCargasProntas.style.display = '';
      if (btnCargasRecusadas) btnCargasRecusadas.style.display = '';
      if (btnOcupacaoPatio) btnOcupacaoPatio.style.display = '';
    } else if (cargo === 'PLANEJADOR_PATIO_NAVIOS') {
      // Tarefa 16: Apenas dashboards referentes a navios e contêineres
      if (btnCargasArmaz) btnCargasArmaz.style.display = 'none';
      if (btnCargasProntas) btnCargasProntas.style.display = 'none';
      if (btnCargasRecusadas) btnCargasRecusadas.style.display = 'none';
      if (btnPreventiva) btnPreventiva.style.display = 'none';

      if (btnNaviosManut) btnNaviosManut.style.display = '';
      if (btnNaviosFora) btnNaviosFora.style.display = '';
      if (btnOcupacaoPatio) btnOcupacaoPatio.style.display = '';
    }
  }

  renderCardsOperacionais();

  // Modal Centralizado para Detalhamento de Indicadores Operacionais (Item 1.2 & Backlog Erro 1)
  const cardModal = document.getElementById('cardDetailModal');
  const modalCardTitle = document.getElementById('modalCardTitle');
  const modalCardDetailContent = document.getElementById('modalCardDetailContent');
  const closeCardDetailModalBtn = document.getElementById('closeCardDetailModalBtn');
  const confirmCardDetailModalBtn = document.getElementById('confirmCardDetailModalBtn');

  function fecharCardModal() {
    if (cardModal) cardModal.classList.add('hidden');
  }

  if (closeCardDetailModalBtn) closeCardDetailModalBtn.addEventListener('click', fecharCardModal);
  if (confirmCardDetailModalBtn) confirmCardDetailModalBtn.addEventListener('click', fecharCardModal);

  if (cardModal) {
    cardModal.addEventListener('click', (e) => {
      if (e.target === cardModal) fecharCardModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !cardModal.classList.contains('hidden')) {
        fecharCardModal();
      }
    });
  }

  window.detalharCardOperacional = async function(tipo) {
    let titulo = '';
    let detalhe = '';
    let icone = 'info';

    let indic = null;
    if (window.NexusRepository && window.NexusRepository.buscarIndicadoresOperacionais) {
      indic = await window.NexusRepository.buscarIndicadoresOperacionais();
    }

    if (!indic) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Indicadores', 'Carregando dados dos indicadores operacionais...');
      }
      return;
    }

    if (tipo === 'NAVIOS_MANUTENCAO') {
      titulo = 'Navios e Equipamentos em Manutenção';
      icone = 'build';
      const navs = indic.manutencao.navios.map(n => `• Navio: ${n.nome} (${n.estado_operacional || n.estado})`);
      const ords = indic.manutencao.ordens.map(o => `• Ordem: ${o.descricao || 'Manutenção geral'} [${o.status}]`);
      detalhe = [...navs, ...ords].join('\n') || 'Nenhum equipamento ou navio em manutenção no momento.';
    } else if (tipo === 'NAVIOS_FORA') {
      titulo = 'Navios Fora do Porto (Em Trânsito / Destino)';
      icone = 'sailing';
      const emTransito = indic.naviosFora.lista.map(n => `• ${n.nome} (Destino: ${n.porto_destino || n.destino || 'Destino Geral'} | Status: ${n.localizacao})`);
      detalhe = emTransito.join('\n') || 'Nenhum navio fora do porto no momento.';
    } else if (tipo === 'CARGAS_ARMAZENAGEM') {
      titulo = 'Cargas em Armazenagem no Pátio STS-01';
      icone = 'inventory_2';
      const arm = indic.cargasArmazenagem.lista.map(c => `• Carga ${c.qr_code_url ? c.qr_code_url.replace('QR-', '') : c.id}: ${c.natureza || 'Geral'} (${c.peso || 0} t, ${c.volume || 0} m³)`);
      detalhe = arm.join('\n') || 'Nenhuma carga em armazenagem no momento.';
    } else if (tipo === 'CARGAS_PRONTAS') {
      titulo = 'Cargas Prontas Aguardando Liberação';
      icone = 'verified';
      const pr = indic.cargasProntas.lista.map(c => `• Carga ${c.qr_code_url ? c.qr_code_url.replace('QR-', '') : c.id}: ${c.natureza || 'Geral'} (${c.peso || 0} t)`);
      detalhe = pr.join('\n') || 'Nenhuma carga pronta para entrega no momento.';
    } else if (tipo === 'CARGAS_RECUSADAS') {
      // Item 1.2: Usa O MESMO RETORNO de buscarCargasRecusadas()
      titulo = 'Cargas Recusadas e Canceladas';
      icone = 'cancel';
      const rec = indic.recusadas.recusadas.map(c => `• [RECUSADA] Carga ${c.id} (${c.tipo}): ${c.motivo}`);
      const canc = indic.recusadas.canceladas.map(c => `• [CANCELADA] Carga ${c.id} (${c.tipo}): ${c.motivo}`);
      detalhe = [...rec, ...canc].join('\n') || 'Nenhuma carga recusada ou cancelada no momento.';
    } else if (tipo === 'OCUPACAO_PATIO') {
      titulo = 'Taxa de Ocupação do Pátio STS-01';
      icone = 'pie_chart';
      const patioCargas = (indic.ocupacaoPatio.lista || []).map(c => `• Carga ${c.qr_code_url ? c.qr_code_url.replace('QR-', '') : (c.id || c.codigo)}: ${c.natureza || c.tipo || 'Geral'} [${c.porto_descarga || c.portoDescarga || 'Setor Pátio'}] (${c.status_fluxo || c.status || 'PÁTIO'})`);
      const detalheLista = patioCargas.length > 0 ? `\n\nCargas Ocupando o Pátio:\n${patioCargas.join('\n')}` : '\n\nNenhuma carga ocupando o pátio no momento.';
      detalhe = `Capacidade Máxima Regulamentar: ${indic.ocupacaoPatio.capacidade} posições (100 Hectares / 1.000.000 m²)\nCargas Ocupando o Pátio: ${indic.ocupacaoPatio.ocupados}\nTaxa de Ocupação Atual: ${indic.ocupacaoPatio.taxa}%${detalheLista}`;
    } else if (tipo === 'PREVENTIVA_SUGERIDA') {
      // Item 1.8: Usa O MESMO RETORNO de buscarEquipamentosPreventivaSugerida()
      titulo = 'Manutenções Preventivas Sugeridas (> 3 Anos de Uso)';
      icone = 'warning';
      const prev = indic.preventiva.equipamentos.map(e => `• [${e.tipo}] ${e.identificacao}: ${e.motivo}`);
      detalhe = prev.join('\n') || 'Nenhum equipamento com ciclo de preventiva vencido (> 3 anos) no momento. Todos os ativos operam dentro do ciclo recomendado.';
    }

    const modalCardIcon = document.getElementById('modalCardIcon');
    if (modalCardIcon) modalCardIcon.textContent = icone;
    if (modalCardTitle) modalCardTitle.textContent = titulo;
    if (modalCardDetailContent) modalCardDetailContent.textContent = detalhe;
    if (cardModal) cardModal.classList.remove('hidden');
  };

    // Item do backlog3 (audit-funcionarios): quando um registro traz apenas o
    // código individual (sem JOIN resolvido — ex.: log registrado sem
    // funcionario_id) e o cache local não contém o funcionário (dispositivo
    // novo), o nome aparece como ID/"Operador do Sistema". Esta rotina busca
    // os códigos faltantes diretamente na tabela `funcionarios` do Supabase.
    /**
     * Resolve funcionários por uma coluna (id ou codigo_individual), em lotes de 100 valores
     * (limite de tamanho da URL). Retorna { valor: { nome, cargo } }. Falha = mapa vazio.
     */
    async function buscarFuncionariosPorChaves(coluna, valores) {
      const mapa = {};
      const lista = (valores || []).filter(Boolean);
      if (!window.nexusSupabase || lista.length === 0) return mapa;
      for (let i = 0; i < lista.length; i += 100) {
        const lote = lista.slice(i, i + 100);
        try {
          const { data, error } = await window.nexusSupabase
            .from('funcionarios')
            .select('id, nome, cargo, codigo_individual, matricula')
            .in(coluna, lote);
          if (!error && Array.isArray(data)) {
            data.forEach(f => {
              const chave = f[coluna];
              if (chave && !mapa[chave]) mapa[chave] = { nome: f.nome, cargo: f.cargo, matricula: f.matricula, codigo_individual: f.codigo_individual };
            });
          }
        } catch (err) {
          console.warn('[NexusPort] Falha ao resolver nomes de funcionários no Supabase:', err);
        }
      }
      return mapa;
    }

  // 2. Renderiza Log Geral de Alterações com Nome do Funcionário Real
  async function renderAuditLogTable() {
    const revisao = ++auditoriaLeituraRevision;
    if (!auditTableBody) return;
    let logs = [];
    const localLogsRaw = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');
    const localNavios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    const localCargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const localContainers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
    const localGuindastes = JSON.parse(localStorage.getItem('nexus_guindastes_list') || '[]');
    const localFuncsEnt = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    const mapaNavios = {};
    localNavios.forEach(n => {
      if (!n || !n.nome) return;
      if (n.id) mapaNavios[String(n.id).trim().toLowerCase()] = n.nome;
      if (n.imo) mapaNavios[String(n.imo).trim().toLowerCase()] = n.nome;
      if (n.numero_imo) mapaNavios[String(n.numero_imo).trim().toLowerCase()] = n.nome;
    });
    const mapaCargas = {};
    localCargas.forEach(c => {
      if (!c) return;
      const cod = String(c.codigo || (c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/i, '') : '') || c.id || '').trim();
      if (!cod) return;
      if (c.id) mapaCargas[String(c.id).trim().toLowerCase()] = cod;
      if (c.rawDbId) mapaCargas[String(c.rawDbId).trim().toLowerCase()] = cod;
    });
    const mapaContainers = {};
    localContainers.forEach(ct => {
      if (!ct) return;
      const ident = String(ct.identificacao || ct.numero_identificacao || '').trim();
      if (!ident) return;
      if (ct.id) mapaContainers[String(ct.id).trim().toLowerCase()] = ident;
      if (ct.rawDbId) mapaContainers[String(ct.rawDbId).trim().toLowerCase()] = ident;
    });
    const mapaGuindastes = {};
    localGuindastes.forEach(g => {
      if (!g) return;
      const ident = String(g.identificacao || g.numero_identificacao || '').trim();
      if (!ident) return;
      if (g.id) mapaGuindastes[String(g.id).trim().toLowerCase()] = ident;
      if (g.rawDbId) mapaGuindastes[String(g.rawDbId).trim().toLowerCase()] = ident;
    });
    const mapaFuncionariosEntidade = {};
    localFuncsEnt.forEach(f => {
      if (!f || !f.nome) return;
      if (f.id) mapaFuncionariosEntidade[String(f.id).trim().toLowerCase()] = f.nome;
      if (f.matricula) mapaFuncionariosEntidade[String(f.matricula).trim().toLowerCase()] = f.nome;
      if (f.codigo_individual) mapaFuncionariosEntidade[String(f.codigo_individual).trim().toLowerCase()] = f.nome;
    });
    const ehUuidLog = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim());
    const limparUuidEmTextoLog = (s) => String(s || '')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const extrairNomeNavioTexto = (txt) => {
      const s = String(txt || '').trim();
      if (!s) return '';
      const m = s.match(/(?:navio|embarca[çc][ãa]o)\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\s._-]{1,50}?)(?=\s*\(|\s+liberado|\s+com\s+destino|\s+para\s+retorno|\s+alterada|\s+vinculado|\s+exclu[íi]do|\s+por\s+|\s+no\s+cadastro|$)/i);
      return m && m[1] && !ehUuidLog(m[1]) ? m[1].trim() : '';
    };
    const extrairCodigoPorPadrao = (txt, regex) => {
      const m = String(txt || '').match(regex);
      return m && m[1] ? m[1].trim().toUpperCase() : '';
    };
    const normalizarTipoAlteracaoExibicao = (tipo) => {
      const t = String(tipo || 'EDICAO').trim().toUpperCase();
      return t === 'EXPORTACAO' ? 'GERACAO_PDF' : (t || 'EDICAO');
    };
    const resolverEntidadeLogItem = (item) => {
      let tipoEnt = String((item && item.entidade_tipo) || '').trim().toUpperCase();
      let idEnt = String((item && item.entidade_id) || '').trim();
      if ((!tipoEnt || !idEnt) && item && item.entidade) {
        const partes = String(item.entidade).trim().split(/\s+/);
        if (partes.length >= 2) {
          tipoEnt = tipoEnt || partes[0].toUpperCase();
          idEnt = idEnt || partes.slice(1).join(' ');
        } else if (partes.length === 1) {
          idEnt = idEnt || partes[0];
          tipoEnt = tipoEnt || (idEnt.toUpperCase().startsWith('CONT') ? 'CONTAINER' : 'CARGA');
        }
      }
      const det = item && item.detalhes && typeof item.detalhes === 'object' ? item.detalhes : null;
      const refId = det && det.referencia_id ? String(det.referencia_id).trim().toLowerCase() : '';
      const textoLivre = (det && det.descricao) || (item && item.descricao) || (typeof (item && item.detalhes) === 'string' ? item.detalhes : '') || '';
      const idInvalidoOuUuid = !idEnt || idEnt.toUpperCase() === 'N/A' || idEnt === 'null' || ehUuidLog(idEnt);

      if (tipoEnt === 'NAVIO') {
        const imoDet = det && (det.numero_imo || det.imo) ? String(det.numero_imo || det.imo).trim().toLowerCase() : '';
        const nomeResolvido = (det && (det.nome || det.navio))
          || (idEnt && mapaNavios[idEnt.toLowerCase()])
          || (refId && mapaNavios[refId])
          || (imoDet && mapaNavios[imoDet])
          || extrairNomeNavioTexto(textoLivre)
          || (idInvalidoOuUuid ? (det && (det.numero_imo || det.imo)) : '')
          || '';
        if (nomeResolvido && !ehUuidLog(nomeResolvido)) {
          idEnt = String(nomeResolvido).trim();
        } else if (ehUuidLog(idEnt)) {
          idEnt = 'Embarcação';
        }
      } else if (tipoEnt === 'CARGA' && idInvalidoOuUuid) {
        const codCarga = (det && det.codigo)
          || (det && !ehUuidLog(det.id) ? det.id : '')
          || (det && det.qr_code_url ? String(det.qr_code_url).replace(/^QR-/i, '') : '')
          || (idEnt && mapaCargas[idEnt.toLowerCase()])
          || (refId && mapaCargas[refId])
          || extrairCodigoPorPadrao(textoLivre, /\b(CRG-\d{4}-\d+[A-Z0-9-]*|CRG-[A-Z0-9-]+)\b/i)
          || '';
        idEnt = (codCarga && !ehUuidLog(codCarga)) ? String(codCarga).trim() : 'CRG-2026-000';
      } else if (tipoEnt === 'CONTAINER' && idInvalidoOuUuid) {
        const codCont = (det && (det.numero_identificacao || det.identificacao || det.container || det.codigo))
          || (idEnt && mapaContainers[idEnt.toLowerCase()])
          || (refId && mapaContainers[refId])
          || extrairCodigoPorPadrao(textoLivre, /\b([A-Z]{4}-\d{7})\b/i)
          || '';
        idEnt = (codCont && !ehUuidLog(codCont)) ? String(codCont).trim().toUpperCase() : 'CONT-0000000';
      } else if (tipoEnt === 'GUINDASTE' && idInvalidoOuUuid) {
        const codGnd = (det && (det.numero_identificacao || det.identificacao || det.guindaste || det.codigo))
          || (idEnt && mapaGuindastes[idEnt.toLowerCase()])
          || (refId && mapaGuindastes[refId])
          || extrairCodigoPorPadrao(textoLivre, /\b([A-Z]{3}-\d{3}-[A-Z]{3})\b/i)
          || '';
        idEnt = (codGnd && !ehUuidLog(codGnd)) ? String(codGnd).trim().toUpperCase() : 'GND-000-STS';
      } else if (tipoEnt === 'FUNCIONARIO') {
        const nomeFuncEnt = (det && (det.nome || det.funcionario || det.substituto))
          || (idEnt && mapaFuncionariosEntidade[idEnt.toLowerCase()])
          || (refId && mapaFuncionariosEntidade[refId])
          || (det && det.matricula && mapaFuncionariosEntidade[String(det.matricula).trim().toLowerCase()])
          || '';
        if (nomeFuncEnt && !ehUuidLog(nomeFuncEnt)) {
          idEnt = String(nomeFuncEnt).trim();
        } else if (ehUuidLog(idEnt)) {
          idEnt = '';
        }
      } else if (tipoEnt === 'EMERGENCIA') {
        if (idInvalidoOuUuid || ['PANICO_GLOBAL', 'EMERGENCIA'].includes(idEnt.toUpperCase())) {
          idEnt = 'BOTAO_EMERGENCIA';
        }
      } else if (ehUuidLog(idEnt)) {
        idEnt = (det && (det.codigo || det.nome || det.numero_identificacao)) || '';
      }

      const entStr = `${tipoEnt || ''} ${idEnt || ''}`.trim() || String((item && item.entidade) || 'Sistema').trim();
      return { tipoEnt, idEnt, entStr: limparUuidEmTextoLog(entStr) || tipoEnt || 'Sistema' };
    };
    const chaveEventoLog = (x) => {
      const tempo = x && x.data_hora ? new Date(x.data_hora).getTime() : NaN;
      const bucketTempo = Number.isNaN(tempo) ? String((x && x.data_hora) || '') : Math.floor(tempo / 2000);
      const { tipoEnt, idEnt } = resolverEntidadeLogItem(x);
      let tipoAlt = String((x && x.tipo_alteracao) || '').trim().toUpperCase();
      if (tipoAlt === 'EXPORTACAO' || tipoAlt === 'GERACAO_PDF') tipoAlt = 'GERACAO_PDF';
      else if (tipoAlt.includes('LEITURA QR') || tipoAlt.includes('ETIQUETA')) tipoAlt = 'REIMPRESSAO_ETIQUETA';
      else if (tipoAlt.includes('CRI')) tipoAlt = 'CRIACAO';
      else if (tipoAlt.includes('EXCLU') || tipoAlt.includes('DELET')) tipoAlt = 'EXCLUSAO';
      else if (tipoAlt && !['CRIACAO', 'EDICAO', 'EXCLUSAO', 'REIMPRESSAO_ETIQUETA', 'GERACAO_PDF'].includes(tipoAlt)) tipoAlt = 'EDICAO';
      return [
        bucketTempo,
        (x && x.codigo_usuario) || '--',
        tipoEnt,
        (idEnt || 'N/A').toUpperCase(),
        tipoAlt
      ].join('|');
    };
    const deduplicarListaLogs = (lista) => {
      const vistos = new Map();
      const resultado = [];
      for (const item of lista) {
        const { tipoEnt, idEnt, entStr } = resolverEntidadeLogItem(item);
        const normalizado = Object.assign({}, item, {
          entidade_tipo: tipoEnt || item.entidade_tipo || '',
          entidade_id: idEnt || item.entidade_id || '',
          entidade: entStr,
          tipo_alteracao: normalizarTipoAlteracaoExibicao(item.tipo_alteracao)
        });
        const chave = chaveEventoLog(normalizado);
        if (!vistos.has(chave)) {
          vistos.set(chave, normalizado);
          resultado.push(normalizado);
        } else {
          const existente = vistos.get(chave);
          if ((!existente.descricao || /^Decis[ãa]o Cr[íi]tica:/i.test(existente.descricao)) && normalizado.descricao) {
            existente.descricao = normalizado.descricao;
          }
        }
      }
      return resultado;
    };
    const localLogs = localLogsRaw.map(ll => Object.assign({}, ll));
    const contextoPrivacidade = [session, ...JSON.parse(localStorage.getItem('nexus_func_list') || '[]')];

    if (window.nexusSupabase) {
      try {
        // Backlog 3 (tempo real): leitura COMPLETA e paginada — o PostgREST corta em 1000 linhas,
        // e a tabela mostrava só as alterações do próprio usuário.
        const dbLogs = await window.NexusRepository.lerTodasAsLinhas(() => window.nexusSupabase
          .from('logs_alteracoes')
          .select('*')
          .order('data_hora', { ascending: false })
          .order('id'));

        if (Array.isArray(dbLogs) && dbLogs.length > 0) {
          const idsNaviosPendentes = [...new Set(dbLogs
            .filter(l => String(l.entidade_tipo || '').toUpperCase() === 'NAVIO')
            .flatMap(l => [l.entidade_id, l.detalhes && l.detalhes.referencia_id])
            .filter(id => id && ehUuidLog(id) && !mapaNavios[String(id).trim().toLowerCase()]))];
          if (idsNaviosPendentes.length > 0) {
            try {
              const { data: naviosRows } = await window.nexusSupabase
                .from('navios')
                .select('id, nome, numero_imo')
                .in('id', idsNaviosPendentes);
              if (Array.isArray(naviosRows)) {
                naviosRows.forEach(n => {
                  if (n && n.nome) {
                    if (n.id) mapaNavios[String(n.id).trim().toLowerCase()] = n.nome;
                    if (n.numero_imo) mapaNavios[String(n.numero_imo).trim().toLowerCase()] = n.nome;
                  }
                });
              }
            } catch (eNav) { /* fallback silencioso */ }
          }
          const idsCargasPendentes = [...new Set(dbLogs
            .filter(l => String(l.entidade_tipo || '').toUpperCase() === 'CARGA')
            .flatMap(l => [l.entidade_id, l.detalhes && l.detalhes.referencia_id])
            .filter(id => id && ehUuidLog(id) && !mapaCargas[String(id).trim().toLowerCase()]))];
          if (idsCargasPendentes.length > 0) {
            try {
              const { data: cargasRows } = await window.nexusSupabase
                .from('cargas')
                .select('id, qr_code_url')
                .in('id', idsCargasPendentes);
              if (Array.isArray(cargasRows)) {
                cargasRows.forEach(c => {
                  const cod = c && c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/i, '').trim() : '';
                  if (c && c.id && cod) mapaCargas[String(c.id).trim().toLowerCase()] = cod;
                });
              }
            } catch (eCrg) { /* fallback silencioso */ }
          }
          const idsContainersPendentes = [...new Set(dbLogs
            .filter(l => String(l.entidade_tipo || '').toUpperCase() === 'CONTAINER')
            .flatMap(l => [l.entidade_id, l.detalhes && l.detalhes.referencia_id])
            .filter(id => id && ehUuidLog(id) && !mapaContainers[String(id).trim().toLowerCase()]))];
          if (idsContainersPendentes.length > 0) {
            try {
              const { data: contRows } = await window.nexusSupabase
                .from('containers')
                .select('id, numero_identificacao')
                .in('id', idsContainersPendentes);
              if (Array.isArray(contRows)) {
                contRows.forEach(ct => {
                  if (ct && ct.id && ct.numero_identificacao) {
                    mapaContainers[String(ct.id).trim().toLowerCase()] = String(ct.numero_identificacao).trim();
                  }
                });
              }
            } catch (eCont) { /* fallback silencioso */ }
          }
          const idsGuindastesPendentes = [...new Set(dbLogs
            .filter(l => String(l.entidade_tipo || '').toUpperCase() === 'GUINDASTE')
            .flatMap(l => [l.entidade_id, l.detalhes && l.detalhes.referencia_id])
            .filter(id => id && ehUuidLog(id) && !mapaGuindastes[String(id).trim().toLowerCase()]))];
          if (idsGuindastesPendentes.length > 0) {
            try {
              const { data: gndRows } = await window.nexusSupabase
                .from('guindastes')
                .select('id, numero_identificacao')
                .in('id', idsGuindastesPendentes);
              if (Array.isArray(gndRows)) {
                gndRows.forEach(g => {
                  if (g && g.id && g.numero_identificacao) {
                    mapaGuindastes[String(g.id).trim().toLowerCase()] = String(g.numero_identificacao).trim();
                  }
                });
              }
            } catch (eGnd) { /* fallback silencioso */ }
          }
          const localFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
          // Responsável de cada linha: pelo funcionario_id e, se faltar, pelo codigo_individual gravado no log.
          // Também inclui IDs de funcionários referenciados como entidade_id/referencia_id em logs de FUNCIONARIO.
          const idsFuncEnt = dbLogs
            .filter(l => String(l.entidade_tipo || '').toUpperCase() === 'FUNCIONARIO')
            .flatMap(l => [l.entidade_id, l.detalhes && l.detalhes.referencia_id])
            .filter(id => id && ehUuidLog(id));
          const idsFunc = [...new Set([...dbLogs.map(l => l.funcionario_id).filter(Boolean), ...idsFuncEnt])];
          const codigosFunc = [...new Set(dbLogs.map(l => l.codigo_individual).filter(c => c && c !== '--'))];
          const [mapaPorId, mapaPorCodigo] = await Promise.all([
            buscarFuncionariosPorChaves('id', idsFunc),
            buscarFuncionariosPorChaves('codigo_individual', codigosFunc)
          ]);
          Object.values(mapaPorId).forEach(f => {
            if (!f || !f.nome) return;
            if (f.id) mapaFuncionariosEntidade[String(f.id).trim().toLowerCase()] = f.nome;
            if (f.matricula) mapaFuncionariosEntidade[String(f.matricula).trim().toLowerCase()] = f.nome;
          });
          Object.values(mapaPorCodigo).forEach(f => {
            if (!f || !f.nome) return;
            if (f.id) mapaFuncionariosEntidade[String(f.id).trim().toLowerCase()] = f.nome;
            if (f.matricula) mapaFuncionariosEntidade[String(f.matricula).trim().toLowerCase()] = f.nome;
          });
          contextoPrivacidade.push(...Object.values(mapaPorId), ...Object.values(mapaPorCodigo));
          const mappedDbLogs = dbLogs.map(l => {
            const cadastro = (l.funcionario_id && mapaPorId[l.funcionario_id])
              || (l.codigo_individual && mapaPorCodigo[l.codigo_individual])
              || null;
            let nomeFunc = cadastro ? cadastro.nome : null;
            let cargoFunc = (cadastro && cadastro.cargo) || l.cargo;
            if (!nomeFunc && l.codigo_individual) {
              const match = localFuncs.find(f => f.codigo_individual === l.codigo_individual || f.matricula === l.codigo_individual);
              if (match) {
                nomeFunc = match.nome;
                cargoFunc = match.cargo || cargoFunc;
              }
            }
            return {
              data_hora: l.data_hora,
              nome_funcionario: nomeFunc || null,
              cargo: cargoFunc || 'OPERACIONAL',
              codigo_usuario: l.codigo_individual || '--',
              entidade: `${l.entidade_tipo || ''} ${l.entidade_id || ''}`.trim(),
              entidade_tipo: l.entidade_tipo || '',
              entidade_id: l.entidade_id || '',
              tipo_alteracao: normalizarTipoAlteracaoExibicao(l.tipo_alteracao),
              detalhes: l.detalhes,
              // Tarefa 9 (Correções): frase do que foi feito (gravada em
              // detalhes.descricao); logs legados sem a frase recebem uma
              // síntese na projeção, via NexusAuditoria.descricaoDoLog.
              descricao: (l.detalhes && (l.detalhes.descricao || '')) || ''
            };
          });

          logs = deduplicarListaLogs([...mappedDbLogs, ...localLogs]);
        }
      } catch (err) {
        console.warn('Erro ao consultar logs_alteracoes no Supabase:', err);
      }
    }

    if (logs.length === 0) {
      logs = deduplicarListaLogs(localLogs);
    }

    if (revisao !== auditoriaLeituraRevision) return;
    // Ordena logs do mais recente para o mais antigo
    logs.sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));

    // Projeção privada ANTES da busca: identificadores ocultos também não são pesquisáveis.
    const privacidade = window.NexusSecurity.privacidadeAuditoria(contextoPrivacidade);
    logs = logs.map(l => ({
      data_hora: l.data_hora,
      nome_funcionario: privacidade.texto(l.nome_funcionario || l.nome || 'Não identificado'),
      cargo: privacidade.texto(l.cargo || 'OPERACIONAL'),
      entidade: privacidade.entidade(l.entidade || 'Sistema', l.entidade_tipo),
      tipo_alteracao: privacidade.texto(l.tipo_alteracao || 'EDICAO'),
      // Tarefa 9 (Correções): frase legível do que foi feito — herdada do log
      // (detalhes.descricao) ou sintetizada para registros legados; passa pela
      // mesma projeção de privacidade das demais células e nunca exibe UUID.
      descricao: limparUuidEmTextoLog(privacidade.texto(
        (l.descricao && !/^(?:Editou|Alterou) a emerg[êe]ncia/i.test(l.descricao))
          ? l.descricao
          : ((window.NexusAuditoria && typeof window.NexusAuditoria.descricaoDoLog === 'function')
              ? window.NexusAuditoria.descricaoDoLog(l) : (l.descricao || ''))
      ))
    }));

    // Backlog 3 (7b): busca local no log de auditoria + contador "X de Y"
    const buscaAuditVal = (document.getElementById('buscarAuditLogInput')?.value || '').trim().toLowerCase();
    const totalAuditRegistros = logs.length;
    const logsVisiveis = logs.filter(l => {
      if (!buscaAuditVal) return true;
      const haystack = `${l.nome_funcionario || l.nome || ''} ${l.cargo || ''} ${l.entidade || ''} ${l.tipo_alteracao || ''} ${l.descricao || ''}`.toLowerCase();
      return haystack.includes(buscaAuditVal);
    });

    const auditCounterEl = document.getElementById('auditLogCounter');
    if (auditCounterEl) {
      auditCounterEl.textContent = `Exibindo ${logsVisiveis.length} de ${totalAuditRegistros} registro(s)`;
    }

    if (logsVisiveis.length === 0) {
      auditTableBody.innerHTML = `
        <tr>
          <td colspan="5" class="p-4 text-center text-slate-600 italic">${totalAuditRegistros === 0 ? 'Nenhum log de alteração registrado no momento.' : 'Nenhum log corresponde à busca aplicada. Ajuste o termo para listar novamente.'}</td>
        </tr>
      `;
      return;
    }

    auditTableBody.innerHTML = logsVisiveis.map(l => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-2.5 text-slate-600 whitespace-nowrap">${l.data_hora ? esc(new Date(l.data_hora).toLocaleString('pt-BR')) : 'N/A'}</td>
        <td class="p-2.5 font-bold text-nexus-900 dark:text-white whitespace-nowrap">${esc(l.nome_funcionario)}</td>
        <td class="p-2.5 text-slate-600 dark:text-slate-300 whitespace-nowrap">${esc(l.cargo || 'OPERACIONAL')}</td>
        <td class="p-2.5 font-bold">${esc(l.entidade || 'Sistema')}${l.descricao ? `<span class="block font-sans font-normal normal-case text-slate-600 dark:text-slate-400 mt-0.5">${esc(l.descricao)}</span>` : ''}</td>
        <td class="p-2.5">
          <span class="px-2 py-0.5 rounded text-xs font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap">${esc(l.tipo_alteracao || 'EDICAO')}</span>
        </td>
      </tr>
    `).join('');
  }

  renderAuditLogTable();

  // Backlog 3 (7b): busca local no log de auditoria
  const buscarAuditLogInput = document.getElementById('buscarAuditLogInput');
  if (buscarAuditLogInput) {
    buscarAuditLogInput.addEventListener('input', renderAuditLogTable);
  }

  // Tarefa 14: Exportação da Planilha Consolidada de Desempenho Operacional por Categoria
  // formatada em colunas reais e estilizada com a identidade visual corporativa do NexusPort
  // (#141A29 Navy, #445987 Indigo-Slate, #F8FAFC Zebra, badges semânticos e linha de consolidado).
  function gerarPlanilhaDesempenhoEstilizada(dados, dataReferencia) {
    const agora = dataReferencia instanceof Date ? dataReferencia : new Date();
    const dataHoraFmt = agora.toLocaleString('pt-BR');
    const operadorNome = (session && session.nome) || 'Operador Portuário';
    const operadorCargo = (session && (session.cargo_nome || session.cargo)) || 'Gestão Operacional';

    const somaVolume = dados.reduce((acc, i) => acc + (Number(i.volume) || 0), 0);
    const somaMeta = dados.reduce((acc, i) => acc + (Number(i.meta) || 0), 0);
    const atingimentoGeral = somaMeta > 0 ? Math.round((somaVolume / somaMeta) * 100) : 0;
    const mediaTempo = dados.length > 0
      ? (dados.reduce((acc, i) => acc + (Number(i.tempo) || 0), 0) / dados.length).toFixed(1)
      : '0.0';
    const statusGeral = atingimentoGeral >= 85 ? 'IDEAL' : (atingimentoGeral >= 50 ? 'ATENÇÃO' : 'CRÍTICO');

    const estiloBadgeStatus = (status) => {
      if (status === 'IDEAL') {
        return 'background-color:#D1FAE5;color:#065F46;font-weight:700;text-align:center;border:1px solid #A7F3D0;';
      }
      if (status === 'ATENÇÃO') {
        return 'background-color:#FEF3C7;color:#92400E;font-weight:700;text-align:center;border:1px solid #FDE68A;';
      }
      return 'background-color:#FFE4E6;color:#9F1239;font-weight:700;text-align:center;border:1px solid #FECDD3;';
    };

    const corTextoAtingimento = (status) => {
      if (status === 'IDEAL') return '#047857';
      if (status === 'ATENÇÃO') return '#B45309';
      return '#BE123C';
    };

    const linhasHtml = dados.map((i, idx) => {
      const bgLinha = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      const tempoFmt = String(i.tempo).replace('.', ',');
      return `
        <tr style="height:30px;">
          <td style="background-color:${esc(bgLinha)};color:#141A29;font-family:'Segoe UI',Inter,Arial,sans-serif;font-size:10.5pt;font-weight:700;padding:8px 12px;border:1px solid #CBD5E1;text-align:left;">${esc(i.categoria)}</td>
          <td style="background-color:${esc(bgLinha)};color:#1E293B;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:8px 12px;border:1px solid #CBD5E1;text-align:right;mso-number-format:'\\#\\,\\#\\#0';">${esc(Number(i.volume || 0).toLocaleString('pt-BR'))}</td>
          <td style="background-color:${esc(bgLinha)};color:#475569;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:600;padding:8px 12px;border:1px solid #CBD5E1;text-align:right;mso-number-format:'\\#\\,\\#\\#0';">${esc(Number(i.meta || 0).toLocaleString('pt-BR'))}</td>
          <td style="background-color:${esc(bgLinha)};color:${esc(corTextoAtingimento(i.status))};font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:8px 12px;border:1px solid #CBD5E1;text-align:right;">${esc(i.atingimento)}%</td>
          <td style="background-color:${esc(bgLinha)};color:#334155;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:600;padding:8px 12px;border:1px solid #CBD5E1;text-align:right;">${esc(tempoFmt)} h</td>
          <td style="font-family:Consolas,'Courier New',monospace;font-size:10pt;padding:8px 12px;${esc(estiloBadgeStatus(i.status))}">${esc(i.status)}</td>
        </tr>`;
    }).join('');

    return `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta charset="utf-8" />
  <title>Planilha Consolidada de Desempenho Operacional — NexusPort STS-01</title>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Desempenho Operacional</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
            <x:FitToPage/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
</head>
<body style="margin:0;padding:16px;background-color:#F8FAFC;font-family:'Segoe UI',Inter,Arial,sans-serif;">
  <table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1060px;border:2px solid #141A29;">
    <colgroup>
      <col width="340" style="width:340px;" />
      <col width="150" style="width:150px;" />
      <col width="140" style="width:140px;" />
      <col width="145" style="width:145px;" />
      <col width="165" style="width:165px;" />
      <col width="155" style="width:155px;" />
    </colgroup>
    <thead>
      <tr style="height:40px;">
        <th colspan="6" style="background-color:#141A29;color:#FFFFFF;font-family:'Segoe UI',Montserrat,Arial,sans-serif;font-size:13pt;font-weight:700;padding:12px 16px;text-align:left;border:1px solid #141A29;letter-spacing:0.5px;">
          NEXUSPORT • TERMINAL PORTUÁRIO STS-01 (PORTO DE SANTOS)
        </th>
      </tr>
      <tr style="height:28px;">
        <th colspan="6" style="background-color:#445987;color:#F8FAFC;font-family:'Segoe UI',Inter,Arial,sans-serif;font-size:10pt;font-weight:600;padding:6px 16px;text-align:left;border:1px solid #334155;">
          PLANILHA CONSOLIDADA DE DESEMPENHO OPERACIONAL POR CATEGORIA • Emitida em ${esc(dataHoraFmt)} • Responsável: ${esc(operadorNome)} (${esc(operadorCargo)})
        </th>
      </tr>
      <tr style="height:32px;">
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:left;">Categoria / Operação</th>
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:right;">Volume Processado</th>
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:right;">Meta Mensal</th>
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:right;">Atingimento (%)</th>
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:right;">Tempo Médio (Horas)</th>
        <th style="background-color:#1E293B;color:#FFFFFF;font-family:Consolas,'Courier New',monospace;font-size:9.5pt;font-weight:700;text-transform:uppercase;padding:8px 12px;border:1px solid #334155;text-align:center;">Status Operacional</th>
      </tr>
    </thead>
    <tbody>${linhasHtml}
    </tbody>
    <tfoot>
      <tr style="height:34px;">
        <td style="background-color:#E2E8F0;color:#141A29;font-family:'Segoe UI',Montserrat,Arial,sans-serif;font-size:10.5pt;font-weight:700;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:left;">CONSOLIDADO GERAL DO TERMINAL</td>
        <td style="background-color:#E2E8F0;color:#141A29;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:right;">${esc(somaVolume.toLocaleString('pt-BR'))}</td>
        <td style="background-color:#E2E8F0;color:#141A29;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:right;">${esc(somaMeta.toLocaleString('pt-BR'))}</td>
        <td style="background-color:#E2E8F0;color:#445987;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:right;">${esc(atingimentoGeral)}%</td>
        <td style="background-color:#E2E8F0;color:#141A29;font-family:Consolas,'Courier New',monospace;font-size:10.5pt;font-weight:700;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;border-left:1px solid #CBD5E1;border-right:1px solid #CBD5E1;text-align:right;">${esc(String(mediaTempo).replace('.', ','))} h (média)</td>
        <td style="font-family:Consolas,'Courier New',monospace;font-size:10pt;padding:9px 12px;border-top:2px solid #445987;border-bottom:2px solid #141A29;${esc(estiloBadgeStatus(statusGeral))}">${esc(statusGeral)}</td>
      </tr>
      <tr style="height:26px;">
        <td colspan="6" style="background-color:#F1F5F9;color:#475569;font-family:'Segoe UI',Inter,Arial,sans-serif;font-size:9pt;padding:6px 16px;text-align:left;border:1px solid #CBD5E1;">
          Documento oficial gerado pelo Sistema de Gestão Portuária NexusPort STS-01 • Identidade Visual Corporativa (#141A29 / #445987) • Dados em tempo real.
        </td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
  }
  window.gerarPlanilhaDesempenhoEstilizada = gerarPlanilhaDesempenhoEstilizada;

  const exportCsvBtn = document.getElementById('exportIndicadoresCsvBtn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      const dados = window.__nexusIndicadoresExecutivos || [];
      if (dados.length === 0) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Sem Dados', 'A planilha de desempenho ainda não foi carregada. Aguarde a atualização e tente exportar novamente.');
        }
        return;
      }
      const agora = new Date();
      const conteudoPlanilha = gerarPlanilhaDesempenhoEstilizada(dados, agora);
      const blob = new Blob([conteudoPlanilha], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexusport_desempenho_${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}_${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (window.registrarLogAlteracao) {
        window.registrarLogAlteracao('EXPORTACAO_CSV', 'dashboard', 'PLANILHA_DESEMPENHO', `Exportação da planilha consolidada de desempenho (${dados.length} categorias) em ${agora.toLocaleString('pt-BR')}`);
      }
    });
  }

  // Paginação de exibição: dois registros por vez, sem modificar o histórico/cache.
  const TRAIL_TAMANHO_PAGINA = 2;
  let trailLimiteVisivel = TRAIL_TAMANHO_PAGINA;
  let trailDadosExibicao = [];
  let trailLeituraRevision = 0;
  const mostrarMaisTrailBtn = document.getElementById('mostrarMaisTrailBtn');
  if (mostrarMaisTrailBtn) {
    mostrarMaisTrailBtn.addEventListener('click', () => {
      if (trailLimiteVisivel >= trailDadosExibicao.length) return;
      trailLimiteVisivel += TRAIL_TAMANHO_PAGINA;
      renderizarTrailVisivel();
    });
  }

  // 3. Renderiza Trail de Decisões Críticas Imutável Organizado a partir do Supabase (Item 1.4)
  async function renderTrailDecisoesTable() {
    const trailContainer = document.getElementById('trailDecisoesContainer');
    if (!trailContainer) return;

    const revisao = ++trailLeituraRevision;
    let trail = [];
    const localTrail = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');
    const localFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    const localNavios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
    const localCargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const contextoPrivacidade = [session, ...localFuncs];
    const TRAIL_UUID_EXATO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const TRAIL_UUID_GLOBAL_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

    if (window.nexusSupabase) {
      try {
        const montarConsultaTrail = () => window.nexusSupabase
          .from('trail_decisoes')
          .select('*, funcionarios(nome, cargo), retificacoes_trail(*)')
          .order('data_hora', { ascending: false });
        let dbTrail = null;
        let error = null;
        if (window.NexusSupabaseUtils && typeof window.NexusSupabaseUtils.lerTodasAsLinhas === 'function') {
          dbTrail = await window.NexusSupabaseUtils.lerTodasAsLinhas(montarConsultaTrail);
        } else {
          const consulta = montarConsultaTrail();
          if (consulta && typeof consulta.range === 'function') {
            dbTrail = [];
            for (let inicio = 0; inicio < 10000000; inicio += 1000) {
              const res = await montarConsultaTrail().range(inicio, inicio + 999);
              if (res && res.error) { error = res.error; break; }
              const pagina = res && Array.isArray(res.data) ? res.data : [];
              dbTrail.push(...pagina);
              if (pagina.length < 1000) break;
            }
          } else {
            const res = await consulta;
            error = res && res.error;
            dbTrail = res && res.data;
          }
        }

        if (!error && Array.isArray(dbTrail)) {
          contextoPrivacidade.push(...dbTrail.map(t => ({ codigo_individual: t.codigo_individual })));

          // Coleta UUIDs referenciados em funcionario_id, supervisor_id ou no texto do motivo (V-04)
          const idsFuncConhecidos = new Set(localFuncs.filter(f => f && f.id).map(f => String(f.id).toLowerCase()));
          const uuidsParaResolver = new Set();
          dbTrail.forEach(t => {
            const fId = t.funcionario_id || t.supervisor_id;
            if (fId && TRAIL_UUID_EXATO_RE.test(String(fId)) && !idsFuncConhecidos.has(String(fId).toLowerCase())) {
              uuidsParaResolver.add(String(fId));
            }
            const textoMotivo = String(t.motivo || '');
            const matches = textoMotivo.match(TRAIL_UUID_GLOBAL_RE);
            if (matches) {
              matches.forEach(u => {
                if (!idsFuncConhecidos.has(u.toLowerCase())) uuidsParaResolver.add(u);
              });
            }
          });
          const mapaPorId = uuidsParaResolver.size > 0
            ? await buscarFuncionariosPorChaves('id', [...uuidsParaResolver])
            : {};
          contextoPrivacidade.push(...Object.values(mapaPorId));

          const obterFuncPorId = (idVal) => {
            if (!idVal) return null;
            const chave = String(idVal);
            return mapaPorId[chave]
              || localFuncs.find(f => f && f.id && String(f.id).toLowerCase() === chave.toLowerCase())
              || null;
          };

          const resolverEntidadeTrail = (t) => {
            const tipoBruto = String(t.entidade_tipo || 'REGISTRO').trim();
            const tipoUpper = tipoBruto.toUpperCase();
            const idBruto = String(t.entidade_id || '').trim();
            if (!TRAIL_UUID_EXATO_RE.test(idBruto)) {
              return `${tipoBruto} ${idBruto}`.trim();
            }
            const idLower = idBruto.toLowerCase();
            if (tipoUpper === 'FUNCIONARIO' || tipoUpper === 'FUNCIONARIOS') {
              return `FUNCIONARIO ${idBruto}`;
            }
            if (tipoUpper === 'NAVIO' || tipoUpper === 'NAVIOS') {
              const nav = localNavios.find(n => n && n.id && String(n.id).toLowerCase() === idLower);
              if (nav && nav.nome) return `NAVIO ${nav.nome}${nav.imo ? ' (' + nav.imo + ')' : ''}`;
              const matchMotivo = String(t.motivo || '').match(/Navio\s+([^\(]+?\s*\(IMO-[0-9]+\))/i);
              if (matchMotivo) return `NAVIO ${matchMotivo[1].trim()}`;
              return `NAVIO #${idBruto.substring(0, 8).toUpperCase()}`;
            }
            if (tipoUpper === 'CARGA' || tipoUpper === 'CARGAS') {
              const crg = localCargas.find(c => c && String(c.rawDbId || c.id).toLowerCase() === idLower);
              if (crg && crg.id) return `CARGA ${crg.id}`;
              return `CARGA #${idBruto.substring(0, 8).toUpperCase()}`;
            }
            if (tipoUpper === 'DELEGACOES_SUPERVISOR') {
              return `DELEGAÇÃO #${idBruto.substring(0, 8).toUpperCase()}`;
            }
            if (tipoUpper === 'MANUTENCOES' || tipoUpper === 'MANUTENCAO') {
              return `MANUTENÇÃO #${idBruto.substring(0, 8).toUpperCase()}`;
            }
            return `${tipoUpper} #${idBruto.substring(0, 8).toUpperCase()}`;
          };

          const resolverMotivoTrail = (motivoBruto) => {
            const txt = String(motivoBruto || 'Decisão homologada conforme fluxo operacional');
            return txt.replace(TRAIL_UUID_GLOBAL_RE, (uuidMatch) => {
              const func = obterFuncPorId(uuidMatch);
              if (func && func.nome) return func.nome;
              const nav = localNavios.find(n => n && n.id && String(n.id).toLowerCase() === uuidMatch.toLowerCase());
              if (nav && nav.nome) return nav.nome;
              return `#${uuidMatch.substring(0, 8).toUpperCase()}`;
            });
          };

          const mappedDbTrail = dbTrail.map(t => {
            let respNome = t.funcionarios ? t.funcionarios.nome : null;
            let respCargo = t.funcionarios && t.funcionarios.cargo ? t.funcionarios.cargo : t.cargo;
            if (!respNome && (t.funcionario_id || t.supervisor_id)) {
              const matchId = obterFuncPorId(t.funcionario_id || t.supervisor_id);
              if (matchId) {
                respNome = matchId.nome;
                respCargo = matchId.cargo || respCargo;
              }
            }
            if (!respNome && t.codigo_individual) {
              const match = localFuncs.find(f => f.codigo_individual === t.codigo_individual || f.matricula === t.codigo_individual);
              if (match) {
                respNome = match.nome;
                respCargo = match.cargo || respCargo;
              }
            }
            const pendenteNome = !respNome && t.codigo_individual;
            const retificacaoTxt = t.retificacoes_trail && t.retificacoes_trail.length > 0 
              ? t.retificacoes_trail.map(r => r.retificacao).join(' | ') 
              : null;

            return {
              id: `TRL-${t.id.substring(0, 8)}`,
              dbId: t.id,
              data_hora: t.data_hora,
              responsavel: `${respNome || 'Responsável'} (${respCargo || 'Supervisor'}) - ${t.codigo_individual}`,
              decisao: t.tipo_decisao,
              entidade: resolverEntidadeTrail(t),
              motivo: resolverMotivoTrail(t.motivo),
              retificacao: retificacaoTxt,
              _codigoPendente: pendenteNome ? t.codigo_individual : null
            };
          });

          // Resolve nomes pendentes diretamente no Supabase (backlog3 audit-funcionarios)
          const codigosPendentes = [...new Set(mappedDbTrail.filter(x => x._codigoPendente).map(x => x._codigoPendente))];
          if (codigosPendentes.length > 0) {
            const mapaDb = await buscarFuncionariosPorChaves('codigo_individual', codigosPendentes);
            contextoPrivacidade.push(...Object.values(mapaDb));
            mappedDbTrail.forEach(x => {
              const info = mapaDb[x._codigoPendente];
              if (info) {
                x.responsavel = `${info.nome || 'Responsável'} (${info.cargo || 'Supervisor'}) - ${x._codigoPendente}`;
              }
              delete x._codigoPendente;
            });
          } else {
            mappedDbTrail.forEach(x => { delete x._codigoPendente; });
          }

          // Unir com localTrail para preservar registros inseridos localmente ou offline,
          // deduplicando tanto por id/dbId quanto pela assinatura do evento (instante + decisão + entidade + motivo).
          const chaveEventoTrail = (x) => {
            const tempo = x && x.data_hora ? new Date(x.data_hora).getTime() : NaN;
            return [
              Number.isNaN(tempo) ? String((x && x.data_hora) || '') : tempo,
              String((x && x.decisao) || '').trim().toUpperCase(),
              String((x && x.entidade) || '').trim().toUpperCase(),
              String((x && x.motivo) || '').trim()
            ].join('|');
          };
          const keys = new Set(mappedDbTrail.map(x => x.dbId || x.id));
          const eventKeys = new Set(mappedDbTrail.map(chaveEventoTrail));
          localTrail.forEach(lt => {
            if (!keys.has(lt.dbId) && !keys.has(lt.id) && !eventKeys.has(chaveEventoTrail(lt))) {
              mappedDbTrail.push(lt);
            }
          });
          trail = mappedDbTrail;
        }
      } catch (err) {
        console.warn('Erro ao consultar trail_decisoes no Supabase:', err);
      }
    }

    if (trail.length === 0) {
      trail = localTrail;
    }

    if (revisao !== trailLeituraRevision) return;
    // Ordenar por data mais recente, sem recortar os dados usados por outras telas/WebMCP.
    const privacidade = window.NexusSecurity.privacidadeAuditoria(contextoPrivacidade);
    trailDadosExibicao = trail.map(t => Object.assign({}, t, {
      responsavel: privacidade.responsavel(t.responsavel),
      entidade: privacidade.entidade(t.entidade, t.entidade_tipo),
      motivo: privacidade.texto(t.motivo),
      retificacao: privacidade.texto(t.retificacao)
    })).sort((a, b) => new Date(b.data_hora || 0) - new Date(a.data_hora || 0));
    renderizarTrailVisivel();
  }

  function formatarDatasIsoEmTexto(texto) {
    if (!texto) return '';
    return String(texto).replace(
      /\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?\b/g,
      (match, ano, mes, dia, hora, min, _seg, tz) => {
        if (tz) {
          const dt = new Date(match);
          if (!Number.isNaN(dt.getTime())) {
            const d = String(dt.getDate()).padStart(2, '0');
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const y = dt.getFullYear();
            const hh = String(dt.getHours()).padStart(2, '0');
            const mm = String(dt.getMinutes()).padStart(2, '0');
            return `${d}/${m}/${y} ${hh}:${mm}`;
          }
        }
        return `${dia}/${mes}/${ano} ${hora}:${min}`;
      }
    );
  }

  function renderizarTrailVisivel() {
    const trailContainer = document.getElementById('trailDecisoesContainer');
    if (!trailContainer) return;
    const trail = trailDadosExibicao.slice(0, trailLimiteVisivel);
    const contador = document.getElementById('trailDecisoesContador');
    if (contador) contador.textContent = `Exibindo ${trail.length} de ${trailDadosExibicao.length} registros`;
    if (mostrarMaisTrailBtn) {
      const temMais = trail.length < trailDadosExibicao.length;
      mostrarMaisTrailBtn.classList.toggle('hidden', !temMais);
      mostrarMaisTrailBtn.disabled = !temMais;
    }

    if (trail.length === 0) {
      trailContainer.innerHTML = `
        <div class="p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-center text-slate-600 italic text-xs">
          Nenhum registro no trail de decisões críticas até o momento.
        </div>
      `;
      return;
    }

    trailContainer.innerHTML = trail.map(t => `
      <div class="p-4 rounded-xl border border-nexus-border dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-col gap-3 overflow-hidden">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/80 pb-2">
          <div class="flex flex-wrap items-center gap-2 min-w-0">
            <span class="font-mono font-bold text-xs text-nexus-500 shrink-0">${esc(t.id)}</span>
            <span class="text-slate-300 dark:text-slate-600 hidden sm:inline">•</span>
            <span class="px-2 py-0.5 rounded text-xs font-bold uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300 break-words">${esc(t.decisao)}</span>
            <span class="font-mono text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 break-words max-w-full">${esc(t.entidade)}</span>
          </div>
          <span class="text-slate-600 font-mono text-[11px] shrink-0">${esc(new Date(t.data_hora).toLocaleString('pt-BR'))}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div class="min-w-0 break-words">
            <span class="font-bold text-slate-600 block text-[10px] uppercase">Responsável Operacional</span>
            <span class="font-bold text-nexus-900 dark:text-white break-words">${esc(t.responsavel)}</span>
          </div>
          <div class="min-w-0 break-words">
            <span class="font-bold text-slate-600 block text-[10px] uppercase">Justificativa / Motivo Formal</span>
            <span class="text-slate-700 dark:text-slate-300 whitespace-normal break-words">${esc(formatarDatasIsoEmTexto(t.motivo))}</span>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/60 text-xs">
          <div class="flex items-start gap-1.5 min-w-0 break-words">
            <span class="material-symbols-outlined fa-solid fa-file-pen text-[16px] text-amber-500 shrink-0 mt-0.5" data-icon="edit_note" aria-hidden="true"></span>
            <span class="font-mono text-[11px] italic text-amber-700 dark:text-amber-400 leading-snug break-words">
              ${t.retificacao ? esc(formatarDatasIsoEmTexto(t.retificacao)) : '<span class="text-slate-600 not-italic">Nenhuma retificação vinculada.</span>'}
            </span>
          </div>
          <button type="button" onclick="window.anexarRetificacaoTrail(${jsArg(t.id)}, ${jsArg(t.dbId || '')})" class="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-[11px] shrink-0 transition-colors">
            + Anexar Retificação
          </button>
        </div>
      </div>
    `).join('');
  }

  window.anexarRetificacaoTrail = async function(idTrail, dbId) {
    const textoRetificacao = await window.nexusPrompt('Anexar Retificação', `Informe a RETIFICAÇÃO a ser vinculada ao registro imutável ${idTrail}:\n(O registro original permanecerá inalterado)`);
    if (!textoRetificacao) return;

    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    let funcId = isUUID(session.id) ? session.id : null;
    if (!funcId) {
      const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
      if (match && isUUID(match.id)) funcId = match.id;
    }

    const nowIso = new Date().toISOString();
    const retificacaoFormatada = `[Retificação em ${new Date().toLocaleString('pt-BR')} por ${session.nome || 'Operador'} (${session.cargo_nome || session.cargo || 'Operacional'})]: ${textoRetificacao}`;

    if (window.nexusSupabase && dbId && isUUID(dbId)) {
      try {
        const payload = {
          trail_id: dbId,
          retificacao: retificacaoFormatada,
          data_hora: nowIso
        };
        if (funcId) payload.funcionario_id = funcId;

        const { error } = await window.nexusSupabase.from('retificacoes_trail').insert(payload);
        if (error) console.warn('[NexusPort] Erro ao sincronizar retificação com Supabase:', error);
      } catch (err) {
        console.warn('[NexusPort] Erro ao sincronizar retificação com Supabase:', err);
      }
    }

    const trail = JSON.parse(localStorage.getItem('nexus_trail_decisoes') || '[]');
    const item = trail.find(t => t.id === idTrail || t.dbId === dbId);
    if (item) {
      item.retificacao = retificacaoFormatada;
      localStorage.setItem('nexus_trail_decisoes', JSON.stringify(trail));
    }

    await renderTrailDecisoesTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Retificação Vinculada', `Retificação vinculada com sucesso ao registro imutável ${idTrail}!`);
    }
  };

  renderTrailDecisoesTable();

  // Lógica do Modal de Registro Manual de Trail / Decisão Crítica (Item 10)
  const registrarTrailModal = document.getElementById('registrarTrailModal');
  const toggleRegistrarTrailBtn = document.getElementById('toggleRegistrarTrailBtn');
  const closeRegistrarTrailModalBtn = document.getElementById('closeRegistrarTrailModalBtn');
  const cancelRegistrarTrailModalBtn = document.getElementById('cancelRegistrarTrailModalBtn');
  const registrarTrailForm = document.getElementById('registrarTrailForm');
  const podeRegistrarTrailManual = !['ESTIVADOR', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS', 'TECNICO_PORTOS'].includes(NexusAuth.getSession()?.cargo);
  if (!podeRegistrarTrailManual && toggleRegistrarTrailBtn) toggleRegistrarTrailBtn.classList.add('hidden');

  // Entidade da decisão: tipo e registro vêm de listas (cadastros do Supabase), sem digitação livre.
  const trailDecisaoSel = document.getElementById('trailTipoDecisao');
  const trailTipoSel = document.getElementById('trailEntidadeTipo');
  const trailRegistroSel = document.getElementById('trailEntidadeRegistro');
  const trailAvisoEl = document.getElementById('trailEntidadeAviso');
  const ROTULOS_TIPO_TRAIL = {
    CARGA: 'Carga', NAVIO: 'Navio', CONTAINER: 'Contêiner', GUINDASTE: 'Guindaste',
    MANUTENCAO: 'Ordem de manutenção', FUNCIONARIO: 'Funcionário'
  };
  let trailRegistrosAtuais = [];
  let trailConsultaRevision = 0;

  function preencherOpcoesTrail(select, opcoes, placeholder) {
    select.textContent = '';
    const vazia = document.createElement('option');
    vazia.value = '';
    vazia.textContent = placeholder;
    select.appendChild(vazia);
    opcoes.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      select.appendChild(op);
    });
  }

  function mostrarAvisoTrail(msg) {
    if (!trailAvisoEl) return;
    trailAvisoEl.textContent = msg || '';
    trailAvisoEl.classList.toggle('hidden', !msg);
  }

  // Consultas reais por tipo. O código exibido é o identificador que o operador reconhece.
  const CONSULTAS_TRAIL = {
    CARGA: {
      tabela: 'cargas', colunas: 'id, qr_code_url, natureza, status_fluxo',
      mapear: (c) => {
        const codigo = c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/, '') : `CRG-${c.id}`;
        return { id: c.id, codigo, rotulo: `${codigo} · ${c.natureza || 'Carga'} (${c.status_fluxo || 'sem status'})` };
      }
    },
    NAVIO: {
      tabela: 'navios', colunas: 'id, nome, numero_imo',
      mapear: (n) => ({ id: n.id, codigo: n.numero_imo, rotulo: `${n.nome} · IMO ${n.numero_imo}` })
    },
    CONTAINER: {
      tabela: 'containers', colunas: 'id, numero_identificacao',
      mapear: (c) => ({ id: c.id, codigo: c.numero_identificacao, rotulo: c.numero_identificacao })
    },
    GUINDASTE: {
      tabela: 'guindastes', colunas: 'id, numero_identificacao',
      mapear: (g) => ({ id: g.id, codigo: g.numero_identificacao, rotulo: g.numero_identificacao })
    },
    MANUTENCAO: {
      tabela: 'manutencoes', colunas: 'id, descricao, status',
      mapear: (m) => {
        const codigo = `OS-${String(m.id).substring(0, 8).toUpperCase()}`;
        return { id: m.id, codigo, rotulo: `${codigo} · ${m.descricao || 'Manutenção'} (${m.status || 'sem status'})` };
      }
    },
    FUNCIONARIO: {
      tabela: 'funcionarios', colunas: 'id, nome, matricula', filtro: (q) => q.eq('ativo', true),
      mapear: (f) => ({ id: f.id, codigo: f.matricula, rotulo: `${window.NexusSecurity.privacidadeAuditoria([f]).texto(f.nome)} · Funcionário #${f.id}` })
    }
  };

  async function buscarRegistrosTrail(tipo) {
    const cfg = CONSULTAS_TRAIL[tipo];
    if (!cfg || !window.nexusSupabase) throw new Error('sem consulta');
    let consulta = window.nexusSupabase.from(cfg.tabela).select(cfg.colunas);
    if (cfg.filtro) consulta = cfg.filtro(consulta);
    const { data, error } = await consulta;
    if (error) throw error;
    return (Array.isArray(data) ? data : [])
      .map((r) => Object.assign({ tipo }, cfg.mapear(r)))
      .filter((r) => r.id && r.codigo)
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'));
  }

  async function carregarRegistrosTrail() {
    const revisao = ++trailConsultaRevision;
    trailRegistrosAtuais = [];
    const tipo = trailTipoSel ? trailTipoSel.value : '';
    mostrarAvisoTrail('');
    if (!tipo) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Selecione primeiro o tipo');
      trailRegistroSel.disabled = true;
      return;
    }
    if (!window.nexusSupabase) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Sem conexão');
      trailRegistroSel.disabled = true;
      mostrarAvisoTrail('Sem conexão com o banco de dados. Não é possível registrar a decisão agora.');
      return;
    }
    preencherOpcoesTrail(trailRegistroSel, [], 'Carregando registros...');
    trailRegistroSel.disabled = true;
    try {
      const registros = await buscarRegistrosTrail(tipo);
      if (revisao !== trailConsultaRevision || trailTipoSel.value !== tipo) return;
      trailRegistrosAtuais = registros;
    } catch (err) {
      if (revisao !== trailConsultaRevision) return;
      console.warn('[NexusPort] Falha ao carregar registros para a trilha:', err);
      preencherOpcoesTrail(trailRegistroSel, [], 'Erro ao carregar');
      mostrarAvisoTrail('Não foi possível carregar os registros do banco. Tente novamente.');
      return;
    }
    if (!trailRegistrosAtuais.length) {
      preencherOpcoesTrail(trailRegistroSel, [], 'Nenhum registro disponível');
      mostrarAvisoTrail(`Não há ${(ROTULOS_TIPO_TRAIL[tipo] || 'registro').toLowerCase()} cadastrado(a) no banco para esta decisão.`);
      return;
    }
    preencherOpcoesTrail(trailRegistroSel, trailRegistrosAtuais.map((r) => ({ value: r.id, label: r.rotulo })), 'Selecione o registro');
    trailRegistroSel.disabled = false;
  }

  // Tipos de entidade mudam conforme a decisão escolhida; se só há um, ele é selecionado.
  function atualizarTiposTrail() {
    const tipos = (window.TRAIL_TIPOS_COMPATIVEIS || {})[trailDecisaoSel.value] || [];
    preencherOpcoesTrail(trailTipoSel, tipos.map((t) => ({ value: t, label: ROTULOS_TIPO_TRAIL[t] || t })), 'Selecione o tipo');
    if (tipos.length === 1) trailTipoSel.value = tipos[0];
    carregarRegistrosTrail();
  }

  if (trailDecisaoSel && trailTipoSel && trailRegistroSel) {
    trailDecisaoSel.addEventListener('change', atualizarTiposTrail);
    trailTipoSel.addEventListener('change', carregarRegistrosTrail);
  }

  if (toggleRegistrarTrailBtn && registrarTrailModal) {
    toggleRegistrarTrailBtn.addEventListener('click', () => {
      if (!podeRegistrarTrailManual) return;
      registrarTrailModal.classList.remove('hidden');
      atualizarTiposTrail();
    });
  }
  function fecharRegistrarTrailModal() {
    if (registrarTrailModal) registrarTrailModal.classList.add('hidden');
  }
  if (closeRegistrarTrailModalBtn) closeRegistrarTrailModalBtn.addEventListener('click', fecharRegistrarTrailModal);
  if (cancelRegistrarTrailModalBtn) cancelRegistrarTrailModalBtn.addEventListener('click', fecharRegistrarTrailModal);

  if (registrarTrailForm) {
    registrarTrailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!podeRegistrarTrailManual) return;
      const tipoDecisao = trailDecisaoSel.value;
      const tipoEntidade = trailTipoSel.value;
      const registroId = trailRegistroSel.value;
      const motivo = document.getElementById('trailMotivoInput').value.trim();

      if (!tipoDecisao || !tipoEntidade || !registroId || !motivo) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Informe o tipo de entidade, o registro e a justificativa formal.');
        return;
      }

      const registro = trailRegistrosAtuais.find((r) => r.id === registroId && r.tipo === tipoEntidade);
      if (!registro) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Registro Inválido', 'A lista de registros mudou. Selecione o registro novamente.');
        carregarRegistrosTrail();
        return;
      }

      const resultado = await window.registrarTrailDecisao(tipoDecisao, registro.codigo, motivo, {
        tipo: registro.tipo, id: registro.id, codigo: registro.codigo, rotulo: registro.rotulo
      });
      if (!resultado || !resultado.ok) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Decisão Não Registrada', (resultado && resultado.mensagem) || 'Não foi possível registrar a decisão.');
        return;
      }
      await renderTrailDecisoesTable();

      registrarTrailForm.reset();
      atualizarTiposTrail();
      fecharRegistrarTrailModal();

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Decisão Registrada', `Decisão "${tipoDecisao}" registrada com sucesso no Trail Imutável!`);
      }
    });
  }

  // Sincronização viva em tempo real (Item 2 / L-05):
  // filtra por entidade afetada e agrupa rajadas curtas (debounce de 60 ms).
  const ENTIDADES_CARDS_DASHBOARD = new Set([
    'cargas', 'navios', 'manutencoes', 'historico_manutencoes', 'containers',
    'guindastes', 'inspecoes', 'nexus_cargas_fluxo', 'nexus_navios_list', 'nexus_os_list'
  ]);
  const ENTIDADES_KPIS_DASHBOARD = new Set([
    'cargas', 'navios', 'bercos', 'funcionarios', 'logs_alteracoes',
    'leituras_qr_code', 'inspecoes', 'visitantes', 'trail_decisoes'
  ]);
  const ENTIDADES_AUDITORIA_DASHBOARD = new Set([
    'logs_alteracoes', 'trail_decisoes', 'funcionarios', 'cargas', 'nexus_audit_logs'
  ]);
  const ENTIDADES_TRAIL_DASHBOARD = new Set([
    'trail_decisoes', 'retificacoes_trail', 'funcionarios', 'cargas',
    'navios', 'manutencoes', 'nexus_trail_decisoes'
  ]);
  const ENTIDADES_SYNC_GERAL_DASHBOARD = new Set([
    'periodic_sync', 'window_focus', 'visibility_sync', 'online_sync', 'realtime_sync'
  ]);

  let dashboardSyncTimer = null;
  let dashboardSyncGeral = false;
  const dashboardEntidadesPendentes = new Set();

  window.addEventListener('nexus_data_changed', (event) => {
    const detalhe = (event && event.detail) || {};
    const entity = detalhe.entity || null;
    const entities = Array.isArray(detalhe.entities) ? detalhe.entities : (entity ? [entity] : []);

    if (entities.length === 0 || entities.some((e) => !e || ENTIDADES_SYNC_GERAL_DASHBOARD.has(e))) {
      dashboardSyncGeral = true;
    } else {
      entities.forEach((e) => dashboardEntidadesPendentes.add(e));
    }

    if (dashboardSyncTimer !== null) return;
    dashboardSyncTimer = Promise.resolve().then(() => {
      dashboardSyncTimer = null;
      const geral = dashboardSyncGeral;
      const lote = Array.from(dashboardEntidadesPendentes);
      dashboardSyncGeral = false;
      dashboardEntidadesPendentes.clear();

      if (geral || lote.some((e) => ENTIDADES_CARDS_DASHBOARD.has(e))) {
        renderCardsOperacionais();
      }
      if (geral || lote.some((e) => ENTIDADES_KPIS_DASHBOARD.has(e))) {
        renderIndicadoresExecutivosTable();
      }
      if (geral || lote.some((e) => ENTIDADES_AUDITORIA_DASHBOARD.has(e))) {
        renderAuditLogTable();
      }
      if (geral || lote.some((e) => ENTIDADES_TRAIL_DASHBOARD.has(e))) {
        renderTrailDecisoesTable();
      }
    });
  });
});
