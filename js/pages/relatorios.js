/**
 * Lógica do Módulo Relatórios & PDF (relatorios.html) - NexusPort
 * Gera relatórios PDF A4 em 4 seções sequenciais (RF 11 & 16) e exibe
 * a tabela de produtividade operacional por cargo e funcionário (T6.9, T6.10).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  const selectCarga = document.getElementById('relatorioCargaSelect');
  const gerarPdfBtn = document.getElementById('gerarPdfBtn');
  const prodTableBody = document.getElementById('produtividadeTableBody');
  const mostrarMaisProdutividadeBtn = document.getElementById('mostrarMaisProdutividadeBtn');
  const produtividadeContador = document.getElementById('produtividadeContador');
  const PRODUTIVIDADE_LIMITE_INICIAL = 5;
  let produtividadeExpandida = false;
  let ultimoProdData = [];

  let cargas = [];
  let produtividadeLeituraRevision = 0;
  let cargasRelatorioRevision = 0;

  // Backlog 3 (7g): período de referência selecionado — os atalhos do topo
  // (Hoje / 7 dias / 30 dias / Este mês) e o select compartilham este estado e
  // filtram o histórico de operações da tabela de produtividade.
  let periodoRelatorioAtual = (document.getElementById('relatorioPeriodoSelect') || { value: '30D' }).value || '30D';

  const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function formatarCodigoCargaRelatorio(c) {
    if (!c) return 'Não informado';
    const candidato = c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/i, '') : (c.codigo || '');
    const limpo = String(candidato || '').trim();
    if (/^CRG-\d{4}-\d+$/i.test(limpo)) return limpo.toUpperCase();
    const mDemo = limpo.match(/^(?:DEMO-)?CRG-(\d+)$/i);
    if (mDemo) return `CRG-2026-${mDemo[1].padStart(3, '0')}`;
    if (limpo && !UUID_CANONICO.test(limpo.replace(/^CRG-/i, ''))) {
      return limpo.startsWith('CRG-') ? limpo : `CRG-${limpo}`;
    }
    const semente = String(c.id || c.rawDbId || limpo || '').trim();
    if (!semente) return 'CRG-2026-001';
    let acc = 0;
    for (let i = 0; i < semente.length; i += 1) {
      acc = ((acc * 31) + semente.charCodeAt(i)) >>> 0;
    }
    return `CRG-2026-${String((acc % 900) + 100).padStart(3, '0')}`;
  }

  function inicioDoPeriodo(periodo) {
    const agora = new Date();
    if (periodo === 'HOJE') {
      const d = new Date(agora); d.setHours(0, 0, 0, 0); return d;
    }
    if (periodo === '7D')  { const d = new Date(agora); d.setDate(d.getDate() - 7);  d.setHours(0, 0, 0, 0); return d; }
    if (periodo === '30D') { const d = new Date(agora); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0); return d; }
    if (periodo === 'MENSAL') { return new Date(agora.getFullYear(), agora.getMonth(), 1); }
    if (periodo === 'TRIMESTRAL') { return new Date(agora.getFullYear(), agora.getMonth() - 3, 1); }
    if (periodo === 'ANUAL') { return new Date(agora.getFullYear(), 0, 1); }
    return null; // 'TODOS' ou valor desconhecido: sem corte de data
  }

  function logDentroDoPeriodo(l, inicio) {
    if (!inicio) return true;
    const dataLog = new Date(l.created_at || l.data_hora || 0);
    return !Number.isNaN(dataLog.getTime()) && dataLog >= inicio;
  }

  async function popularCargas() {
    const revisao = ++cargasRelatorioRevision;
    if (!selectCarga) return;
    let cargasRaw = [];
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('cargas').select('*');
        if (!error && Array.isArray(data)) {
          cargasRaw = data;
        }
      } catch (e) {
        console.warn('Erro ao carregar cargas para relatório:', e);
      }
    }
    if (cargasRaw.length === 0 && window.NexusRepository) {
      try { cargasRaw = await window.NexusRepository.getCargas(); } catch (e) {}
    }

    if (revisao !== cargasRelatorioRevision) return;
    const selecaoAnterior = selectCarga.value;
    cargas = cargasRaw.map(c => ({
      id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : (c.codigo || `CRG-${c.id}`),
      tipo: c.natureza || c.tipo || 'Não informado',
      status: c.status_fluxo || c.status || 'AGENDAMENTO',
      navio: c.navio || '',
      navioNomeHistorico: c.navioNomeHistorico || c.navio_nome_historico || '',
      container: c.container_id || c.container || '',
      containerIdentificacaoHistorico: c.containerIdentificacaoHistorico || c.container_identificacao_historico || '',
      destino: c.destino || '',
      portoDescarga: c.porto_descarga || '',
      created_at: c.created_at || c.data_cadastro || c.dataCadastro || c.data_entrada || c.dataEntrada || c.data_agendamento || c.dataAgendamento || null,
      rawDbId: c.id
    }));

    const inicio = inicioDoPeriodo(periodoRelatorioAtual);
    const cargasFiltradas = cargas.filter(c => {
      if (!inicio) return true;
      if (!c.created_at) return true;
      const d = new Date(c.created_at);
      return !Number.isNaN(d.getTime()) && d >= inicio;
    });

    selectCarga.innerHTML = '<option value="">Selecione a Carga para Emitir PDF A4...</option>';
    if (cargasFiltradas.length === 0) {
      selectCarga.innerHTML = '<option value="" disabled>Nenhuma carga cadastrada neste período de referência</option>';
      return;
    }
    cargasFiltradas.forEach(c => {
      selectCarga.innerHTML += `<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.tipo)} (${esc(c.status)})</option>`;
    });
    if (cargasFiltradas.some(c => c.id === selecaoAnterior)) selectCarga.value = selecaoAnterior;
  }

  popularCargas();

  // Backlog 3 (7g): ligação dos atalhos de período com o select e a tabela
  (function ligarAtalhosPeriodo() {
    const periodoSelect = document.getElementById('relatorioPeriodoSelect');
    const chipsWrap = document.getElementById('relatorioPeriodoChips');
    if (!periodoSelect && !chipsWrap) return;

    function sincronizarChips() {
      if (!chipsWrap) return;
      chipsWrap.querySelectorAll('.periodo-chip').forEach(chip => {
        const ativo = chip.getAttribute('data-periodo') === periodoRelatorioAtual;
        chip.classList.toggle('bg-nexus-500', ativo);
        chip.classList.toggle('border-nexus-500', ativo);
        chip.classList.toggle('text-white', ativo);
        chip.classList.toggle('bg-white', !ativo);
        chip.classList.toggle('dark:bg-slate-900', !ativo);
        chip.classList.toggle('text-slate-600', !ativo);
        chip.classList.toggle('dark:text-slate-300', !ativo);
        chip.classList.toggle('border-nexus-border', !ativo);
        chip.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      });
    }

    function aplicarPeriodo(novoPeriodo) {
      periodoRelatorioAtual = novoPeriodo;
      if (periodoSelect && periodoSelect.value !== novoPeriodo) periodoSelect.value = novoPeriodo;
      sincronizarChips();
      renderProdutividadeTable();
      popularCargas();
      // O período filtra os GRÁFICOS de verdade (não só a tabela)
      if (window.NexusCharts && typeof window.NexusCharts.definirFiltros === 'function') {
        window.NexusCharts.definirFiltros({ periodo: novoPeriodo });
      }
    }

    if (chipsWrap) {
      chipsWrap.querySelectorAll('.periodo-chip').forEach(chip => {
        chip.addEventListener('click', () => aplicarPeriodo(chip.getAttribute('data-periodo')));
      });
    }
    if (periodoSelect) {
      periodoSelect.addEventListener('change', () => aplicarPeriodo(periodoSelect.value));
    }
    sincronizarChips();
  })();

  const loadingStatus = document.getElementById('pdfLoadingStatus');
  const idleStatus = document.getElementById('pdfIdleStatus');

  function avisarPdf(tipo, titulo, mensagem) {
    if (window.mostrarFeedback) window.mostrarFeedback(tipo, titulo, mensagem);
  }

  function baixarArquivo(blob, nomeArquivo) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function extrairLogoPngChunks() {
    try {
      const resp = await fetch('design/logo_porto.png');
      if (!resp.ok) return null;
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let off = 8;
      let width = 256;
      let height = 256;
      let plte = null;
      const idats = [];
      while (off + 8 <= bytes.length) {
        const len = view.getUint32(off, false);
        const tipo = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
        const chunk = bytes.subarray(off + 8, off + 8 + len);
        if (tipo === 'IHDR' && len >= 8) {
          width = view.getUint32(off + 8, false);
          height = view.getUint32(off + 12, false);
        } else if (tipo === 'PLTE') {
          plte = chunk;
        } else if (tipo === 'IDAT') {
          idats.push(chunk);
        }
        off += 12 + len;
      }
      if (!plte || idats.length === 0) return null;
      const total = idats.reduce((s, c) => s + c.length, 0);
      const idat = new Uint8Array(total);
      let pos = 0;
      idats.forEach((c) => { idat.set(c, pos); pos += c.length; });
      let plteHex = '';
      for (let i = 0; i < plte.length; i += 1) {
        plteHex += plte[i].toString(16).padStart(2, '0');
      }
      return { width, height, plteHex, idat };
    } catch (e) {
      return null;
    }
  }

  function escaparPdfWinAnsi(str) {
    const s = String(str == null ? '' : str).replace(/[\r\n\t]+/g, ' ');
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const code = s.charCodeAt(i);
      const ch = code <= 255 ? s[i] : '?';
      if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
      else out += ch;
    }
    return out;
  }

  async function gerarPdfAtualizadoLocal(cargaId, hashExistente) {
    if (!window.nexusSupabase) return null;
    const selecaoNavio = 'nome, numero_imo, porto_origem, porto_destino, data_saida';
    const selecaoContainer = [
      'numero_identificacao, material_carregado, estado, data_fabricacao,',
      `tempo_uso_referencia, navios:navio_id(${selecaoNavio})`
    ].join(' ');
    const selecao = [
      'id, qr_code_url, natureza, peso, volume, valor_declarado, destino, porto_descarga,',
      'status_fluxo, resultado_inspecao, motivo_recusa, data_entrada, data_saida,',
      'navio_nome_historico, container_identificacao_historico,',
      `navios:navio_id(${selecaoNavio}),`,
      `containers:container_id(${selecaoContainer}),`,
      'agendamentos(data_prevista_entrega)'
    ].join(' ');
    const { data: raw, error } = await window.nexusSupabase
      .from('cargas')
      .select(selecao)
      .eq('id', cargaId)
      .maybeSingle();
    const linha = Array.isArray(raw) ? raw[0] : raw;
    if (error || !linha) return null;

    if (!linha.containers && linha.container_identificacao_historico) {
      const ident = String(linha.container_identificacao_historico).trim();
      if (ident) {
        try {
          const { data: contRaw } = await window.nexusSupabase
            .from('containers')
            .select(selecaoContainer)
            .eq('numero_identificacao', ident)
            .maybeSingle();
          const contDb = Array.isArray(contRaw) ? contRaw[0] : contRaw;
          if (contDb) linha.containers = contDb;
        } catch (e) { /* fallback local abaixo */ }
        if (!linha.containers) {
          try {
            const listaContLocal = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]');
            const contLocal = listaContLocal.find((c) => c && String(c.identificacao || c.numero_identificacao || '').trim().toUpperCase() === ident.toUpperCase());
            if (contLocal) {
              linha.containers = {
                numero_identificacao: contLocal.identificacao || contLocal.numero_identificacao || ident,
                material_carregado: contLocal.tipo || contLocal.material_carregado || null,
                data_fabricacao: contLocal.dataFabr || contLocal.data_fabricacao || null,
                tempo_uso_referencia: contLocal.refTempo || contLocal.tempo_uso_referencia || null
              };
            }
          } catch (e) { /* sem cache local */ }
        }
      }
    }

    const navioDoCont = linha.containers && linha.containers.navios;
    if (!linha.navios && !navioDoCont && linha.navio_nome_historico) {
      const nomeNavio = String(linha.navio_nome_historico).trim();
      if (nomeNavio) {
        try {
          const { data: navioRaw } = await window.nexusSupabase
            .from('navios')
            .select(selecaoNavio)
            .eq('nome', nomeNavio)
            .maybeSingle();
          const navioDb = Array.isArray(navioRaw) ? navioRaw[0] : navioRaw;
          if (navioDb) linha.navios = navioDb;
        } catch (e) { /* fallback local abaixo */ }
        if (!linha.navios) {
          try {
            const listaNaviosLocal = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]');
            const navioLocal = listaNaviosLocal.find((n) => n && String(n.nome || '').trim().toLowerCase() === nomeNavio.toLowerCase());
            if (navioLocal) {
              linha.navios = {
                nome: navioLocal.nome || nomeNavio,
                numero_imo: navioLocal.imo || navioLocal.numero_imo || null,
                porto_origem: navioLocal.origem || navioLocal.porto_origem || null,
                porto_destino: navioLocal.destino || navioLocal.porto_destino || null,
                data_saida: navioLocal.dataSaida || navioLocal.data_saida || null
              };
            }
          } catch (e) { /* sem cache local */ }
        }
      }
    }

    const naoInf = 'Não informado';
    const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
    const txt = (v) => (vazio(v) ? naoInf : String(v).trim());
    const ehRefCont = (v) => !vazio(v) && /^\s*cont[eê]iner\b/i.test(String(v).trim());
    const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
    const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtDh = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    });
    const numTxt = (v, u) => {
      const n = v === null || v === undefined || v === '' ? null : Number(v);
      if (n === null || !Number.isFinite(n)) return naoInf;
      return u ? `${fmtNum.format(n)} ${u}` : fmtNum.format(n);
    };
    const moedaTxt = (v) => {
      const n = v === null || v === undefined || v === '' ? null : Number(v);
      return n === null || !Number.isFinite(n) ? naoInf : fmtMoeda.format(n);
    };
    const dataTxt = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : naoInf;
    };
    const dhTxt = (iso) => {
      if (vazio(iso)) return naoInf;
      const str = String(iso).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return dataTxt(str);
      const d = new Date(str);
      if (Number.isNaN(d.getTime())) return naoInf;
      const p = {};
      fmtDh.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
      return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
    };
    const rotulos = {
      status_fluxo: {
        AGENDAMENTO: 'Agendamento', RECEBIMENTO_INSPECAO: 'Recebimento e inspeção', ARMAZENAGEM: 'Armazenagem',
        PRONTA_PARA_ENTREGA: 'Pronta para entrega', SAIDA: 'Saída', EM_TRANSITO: 'Em trânsito',
        ENTREGUE: 'Entregue', RECUSADA: 'Recusada', CANCELADA: 'Cancelada'
      },
      resultado_inspecao: { APROVADA: 'Aprovada', RECUSADA: 'Recusada', PENDENTE: 'Pendente' },
      referencia_tempo: {
        DATA_FABRICACAO: 'Data de fabricação',
        DATA_ULTIMA_MANUTENCAO: 'Data da última manutenção',
        MENOS_1_ANO: 'Menos de 1 ano',
        ENTRE_1_E_2_ANOS: 'Entre 1 e 2 anos',
        MAIS_2_ANOS: 'Mais de 2 anos'
      }
    };
    const rotulo = (t, v) => (!v ? naoInf : ((rotulos[t] && rotulos[t][v]) || String(v)));

    const cont = linha.containers || (linha.container_identificacao_historico
      ? { numero_identificacao: linha.container_identificacao_historico }
      : null);
    const navioBruto = (cont && cont.navios) || linha.navios || (linha.navio_nome_historico
      ? { nome: linha.navio_nome_historico }
      : null);
    let navio = null;
    if (navioBruto) {
      let pOrig = navioBruto.porto_origem || null;
      let pDest = navioBruto.porto_destino || null;
      const destCarga = !vazio(linha.destino) ? String(linha.destino).trim() : null;
      if (
        destCarga
        && !vazio(pOrig)
        && !vazio(pDest)
        && String(pOrig).trim().toLowerCase() === destCarga.toLowerCase()
        && String(pDest).trim().toLowerCase() !== destCarga.toLowerCase()
      ) {
        pOrig = navioBruto.porto_destino;
        pDest = destCarga;
      } else if (destCarga && vazio(pDest) && !vazio(navioBruto.numero_imo)) {
        pDest = destCarga;
      }
      navio = {
        nome: navioBruto.nome || null,
        numero_imo: navioBruto.numero_imo || null,
        porto_origem: pOrig,
        porto_destino: pDest,
        data_saida: navioBruto.data_saida || null
      };
    }

    const ags = Array.isArray(linha.agendamentos)
      ? linha.agendamentos
      : (linha.agendamentos ? [linha.agendamentos] : []);
    const agComData = ags.find((a) => a && !vazio(a.data_prevista_entrega));
    const dataEntradaResolvida = !vazio(linha.data_entrada)
      ? linha.data_entrada
      : (agComData ? agComData.data_prevista_entrega : null);
    const dataSaidaResolvida = !vazio(linha.data_saida)
      ? linha.data_saida
      : (navio && !vazio(navio.data_saida) ? navio.data_saida : null);
    const portoDescargaResolvido = (!vazio(linha.porto_descarga) && !ehRefCont(linha.porto_descarga))
      ? linha.porto_descarga
      : (!vazio(linha.destino) ? linha.destino : (navio && !vazio(navio.porto_destino) ? navio.porto_destino : null));
    const codigoCarga = formatarCodigoCargaRelatorio(linha);

    const secoes = [
      {
        titulo: '1. Dados da carga',
        campos: [
          ['Código da carga', txt(codigoCarga)],
          ['Natureza', txt(linha.natureza)],
          ['Peso declarado', numTxt(linha.peso, 't')],
          ['Volume', numTxt(linha.volume, 'm³')],
          ['Valor declarado', moedaTxt(linha.valor_declarado)],
          ['Data de entrada', dhTxt(dataEntradaResolvida)],
          ['Data de saída', dhTxt(dataSaidaResolvida)]
        ]
      },
      {
        titulo: '2. Dados do navio',
        campos: navio
          ? [
            ['Nome da embarcação', txt(navio.nome)],
            ['Número IMO', txt(navio.numero_imo)],
            ['Porto de origem', txt(navio.porto_origem)],
            ['Porto de destino da viagem', txt(navio.porto_destino)]
          ]
          : [['Vínculo', 'Carga sem navio vinculado por contêiner']]
      },
      {
        titulo: '3. Dados do contêiner',
        campos: cont
          ? [
            ['Identificação', txt(cont.numero_identificacao)],
            ['Material carregado', txt(cont.material_carregado)],
            ['Data de fabricação', dataTxt(cont.data_fabricacao)],
            ['Referência de tempo de uso', rotulo('referencia_tempo', cont.tempo_uso_referencia)]
          ]
          : [['Vínculo', 'Carga sem contêiner alocado']]
      },
      {
        titulo: '4. Resumo do fluxo operacional',
        campos: [
          ['Status no fluxo', rotulo('status_fluxo', linha.status_fluxo)],
          ['Resultado da inspeção', rotulo('resultado_inspecao', linha.resultado_inspecao)],
          ['Porto de descarga', txt(portoDescargaResolvido)],
          ['Destino', txt(linha.destino)],
          ['Motivo da recusa', txt(linha.motivo_recusa)]
        ]
      }
    ];

    const logo = await extrairLogoPngChunks();
    const cmds = [];
    cmds.push('0.102 0.133 0.204 rg 0 773.89 595.28 68 re f');
    cmds.push('0.267 0.349 0.529 rg 0 770.89 595.28 3 re f');
    let xTitulo = 40;
    if (logo) {
      cmds.push('1 1 1 rg 40 787.89 40 40 re f');
      cmds.push('q 36 0 0 36 42 789.89 cm /ImLogo Do Q');
      xTitulo = 90;
    }
    cmds.push(`BT /F2 12.5 Tf 1 1 1 rg ${xTitulo} 811.89 Td (${escaparPdfWinAnsi('NEXUSPORT · TERMINAL STS-01')}) Tj ET`);
    cmds.push(`BT /F1 9.5 Tf 0.796 0.835 0.882 rg ${xTitulo} 794.89 Td (${escaparPdfWinAnsi('Relatório operacional integrado de carga (formato A4)')}) Tj ET`);
    cmds.push(`BT /F2 7.5 Tf 0.796 0.835 0.882 rg 459.28 812.89 Td (${escaparPdfWinAnsi('PADRÃO A4 · OFICIAL')}) Tj ET`);

    let y = 748.89;
    const colX = [48, 305.64];
    secoes.forEach((sec) => {
      cmds.push(`0.945 0.961 0.976 rg 40 ${(y - 18).toFixed(2)} 515.28 22 re f`);
      cmds.push(`0.267 0.349 0.529 rg 40 ${(y - 18).toFixed(2)} 3.5 22 re f`);
      cmds.push(`BT /F2 10.5 Tf 0.059 0.090 0.165 rg 51 ${(y - 11).toFixed(2)} Td (${escaparPdfWinAnsi(sec.titulo)}) Tj ET`);
      y -= 30;
      for (let i = 0; i < sec.campos.length; i += 2) {
        const par = sec.campos.slice(i, i + 2);
        par.forEach((c, idx) => {
          const cx = colX[idx];
          cmds.push(`BT /F2 7 Tf 0.392 0.455 0.545 rg ${cx} ${(y - 8).toFixed(2)} Td (${escaparPdfWinAnsi(String(c[0]).toUpperCase())}) Tj ET`);
          cmds.push(`BT /F1 9.5 Tf 0.059 0.090 0.165 rg ${cx} ${(y - 20.5).toFixed(2)} Td (${escaparPdfWinAnsi(String(c[1]).slice(0, 48))}) Tj ET`);
        });
        cmds.push(`0.886 0.910 0.941 RG 0.4 w 44 ${(y - 26.5).toFixed(2)} m 551.28 ${(y - 26.5).toFixed(2)} l S`);
        y -= 30.5;
      }
      y -= 6;
    });

    cmds.push('0.886 0.910 0.941 RG 0.6 w 40 46 m 555.28 46 l S');
    cmds.push(`BT /F1 7 Tf 0.392 0.455 0.545 rg 40 34 Td (${escaparPdfWinAnsi(`Conteúdo SHA-256: ${hashExistente || cargaId}`)}) Tj ET`);
    cmds.push(`BT /F2 7 Tf 0.392 0.455 0.545 rg 495.28 34 Td (${escaparPdfWinAnsi('Página 1 de 1')}) Tj ET`);

    const streamTxt = cmds.join('\n');
    const enc = (s) => {
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i += 1) b[i] = s.charCodeAt(i) & 0xff;
      return b;
    };
    const partes = [];
    const offsets = [0];
    let tamanhoTotal = 0;
    const pushBytes = (u8) => { partes.push(u8); tamanhoTotal += u8.length; };
    const pushStr = (s) => pushBytes(enc(s));
    const iniciarObj = (n) => { offsets[n] = tamanhoTotal; pushStr(`${n} 0 obj\n`); };
    const fimObj = () => pushStr('\nendobj\n');

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    iniciarObj(1); pushStr('<< /Type /Catalog /Pages 2 0 R >>'); fimObj();
    iniciarObj(2); pushStr('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'); fimObj();
    const xobjRef = logo ? '/XObject << /ImLogo 7 0 R >>' : '';
    iniciarObj(3);
    pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xobjRef} >> /Contents 6 0 R >>`);
    fimObj();
    iniciarObj(4); pushStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); fimObj();
    iniciarObj(5); pushStr('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); fimObj();
    const contentBytes = enc(streamTxt);
    iniciarObj(6);
    pushStr(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushStr('\nendstream');
    fimObj();
    let maxObj = 6;
    if (logo) {
      maxObj = 7;
      iniciarObj(7);
      pushStr(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /BitsPerComponent 8 /ColorSpace [ /Indexed /DeviceRGB 255 <${logo.plteHex}> ] /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${logo.width} >> /Length ${logo.idat.length} >>\nstream\n`);
      pushBytes(logo.idat);
      pushStr('\nendstream');
      fimObj();
    }
    const xrefPos = tamanhoTotal;
    pushStr(`xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`);
    for (let i = 1; i <= maxObj; i += 1) {
      pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    }
    pushStr(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    return new Blob(partes, { type: 'application/pdf' });
  }

  if (gerarPdfBtn) {
    gerarPdfBtn.addEventListener('click', async () => {
      const idCarga = selectCarga ? selectCarga.value : '';
      if (!idCarga) {
        avisarPdf('atencao', 'Seleção Necessária', 'Por favor, selecione uma carga operacional para gerar o relatório PDF A4.');
        return;
      }

      if (loadingStatus) loadingStatus.classList.remove('hidden');
      if (idleStatus) idleStatus.classList.add('hidden');
      gerarPdfBtn.disabled = true;
      try {
        await gerarRelatorioPdfA4(idCarga, { origem: 'tela' });
      } finally {
        if (loadingStatus) loadingStatus.classList.add('hidden');
        if (idleStatus) idleStatus.classList.remove('hidden');
        gerarPdfBtn.disabled = false;
      }
    });
  }

  /**
   * Emite o relatório PDF A4 pelo servidor (Edge Function relatorio-pdf, Backlog 3, item B).
   * O navegador não monta o PDF: envia só o identificador da carga e o código da sessão.
   * O servidor lê os dados no Supabase, devolve o arquivo e grava o cache por hash.
   * Retorna true quando o arquivo foi baixado; false quando não foi (com aviso ao operador).
   * opcoes.origem: 'tela' ou 'agente' (WebMCP), só para medição.
   */
  async function gerarRelatorioPdfA4(idCarga, opcoes) {
    const origem = opcoes && opcoes.origem === 'agente' ? 'agente' : 'tela';
    const carga = cargas.find((item) => item.id === idCarga) || null;
    const cargaId = carga && carga.rawDbId ? carga.rawDbId : idCarga;
    const config = window.NEXUS_CONFIG || {};
    const urlBase = config.SUPABASE_URL || '';
    const chave = config.SUPABASE_ANON_KEY || '';

    if (!window.nexusSupabase || !urlBase || !chave) {
      avisarPdf('erro', 'PDF indisponível', 'O relatório PDF é gerado pelo servidor e exige conexão com o Supabase.');
      return false;
    }
    if (!UUID_CANONICO.test(String(cargaId))) {
      avisarPdf('atencao', 'Carga sem registro no banco', 'Esta carga ainda não foi salva no Supabase. Salve a carga antes de emitir o PDF.');
      return false;
    }
    const codigo = session && session.codigo_individual;
    if (!codigo) {
      avisarPdf('erro', 'Sessão necessária', 'Faça login para emitir o relatório PDF.');
      return false;
    }

    let resposta;
    try {
      resposta = await fetch(`${urlBase}/functions/v1/relatorio-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: `Bearer ${chave}` },
        body: JSON.stringify({ carga_id: cargaId, codigo_individual: codigo })
      });
    } catch (erro) {
      avisarPdf('erro', 'Falha de conexão', 'Não foi possível gerar o PDF agora. Verifique a conexão e tente novamente.');
      return false;
    }

    if (!resposta.ok) {
      let mensagem = 'Não foi possível gerar o PDF.';
      try {
        const corpo = await resposta.json();
        if (corpo && corpo.erro) mensagem = corpo.erro;
      } catch (erro) { /* resposta sem corpo JSON: mantém a mensagem padrão */ }
      avisarPdf('erro', 'PDF não emitido', mensagem);
      return false;
    }

    let arquivo = await resposta.blob();
    const versaoServidor = resposta.headers.get('X-Relatorio-Versao') || '';
    if (arquivo && arquivo.size > 100 && versaoServidor !== '3') {
      try {
        const blobAtualizado = await gerarPdfAtualizadoLocal(cargaId, resposta.headers.get('X-Relatorio-Hash') || '');
        if (blobAtualizado) arquivo = blobAtualizado;
      } catch (e) {
        console.warn('Fallback de atualização local do PDF ignorado:', e);
      }
    }
    baixarArquivo(arquivo, `Relatorio_A4_${cargaId}.pdf`);
    const hash = resposta.headers.get('X-Relatorio-Hash') || null;
    const cache = resposta.headers.get('X-Relatorio-Cache') || 'MISS';

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao(carga ? carga.id : cargaId, 'EXPORTACAO', {
        tipo_exportacao: 'PDF_A4',
        carga_id: cargaId,
        hash_conteudo: hash,
        exportado_por_codigo: codigo
      });
    }
    if (window.NexusAnalytics) window.NexusAnalytics.track('gerar_pdf', { origem, cache: cache === 'HIT' ? 'hit' : 'miss' });
    avisarPdf('sucesso', 'PDF Emitido', `Relatório PDF A4 da carga ${carga ? carga.id : cargaId} gerado e baixado.`);
    return true;
  }

  // Uso do agente WebMCP: mesma geração de PDF do botão da página (retorna true/false).
  window.nexusRelatorioGerarPdf = gerarRelatorioPdfA4;

  // Função para calcular KPIs consolidados via Edge Function "kpis-calculo"
  window.nexusCalcularKpisEdgeFunction = async function(codigoIndividual) {
    if (!window.nexusSupabase || !window.nexusSupabase.functions) return null;
    try {
      const { data, error } = await window.nexusSupabase.functions.invoke('kpis-calculo', {
        body: { codigo_individual: codigoIndividual || (session && session.codigo_individual) }
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('kpis-calculo Edge Function:', e);
      return null;
    }
  };

  // Tabela de Produtividade Real (T6.9, T6.10, Tarefa 4.1)
  // Uso do agente WebMCP: mesma geração de PDF do botão da página.
  window.nexusRelatorioGerarPdf = gerarRelatorioPdfA4;

  async function renderProdutividadeTable() {
    const revisao = ++produtividadeLeituraRevision;
    let funcionariosList = [];
    let logsList = [];
    if (!prodTableBody) return;

    // Backlog 3 (tempo real): leitura COMPLETA e paginada. O PostgREST corta cada resposta em
    // 1000 linhas; sem paginar, os demais usuários apareciam com 0 operações.
    let funcsLoaded = false;
    let logsDoBanco = false;
    logsList = [];   // nunca reaproveitar leitura anterior: falha no banco cai no cache local
    if (window.nexusSupabase && window.NexusRepository) {
      try {
        const funcs = await window.NexusRepository.lerTodasAsLinhas(() => window.nexusSupabase
          .from('funcionarios').select('*').eq('ativo', true).order('id'));
        funcionariosList = funcs;
        funcsLoaded = true;
      } catch (e) {
        console.warn('Erro ao carregar funcionários para produtividade:', e);
      }
      try {
        logsList = await window.NexusRepository.lerTodasAsLinhas(() => window.nexusSupabase
          .from('logs_alteracoes').select('*').order('id'));
        logsDoBanco = true;
      } catch (e) {
        console.warn('Erro ao carregar logs de produtividade do Supabase:', e);
      }
    }

    if (!funcsLoaded) funcionariosList = [];
    if (!funcsLoaded && funcionariosList.length === 0) {
      funcionariosList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    }

    if (revisao !== produtividadeLeituraRevision) return;
    const isDiretor = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'].includes(session.cargo);
    const isInspetor = session.cargo === 'INSPETOR';

    let targetFuncs = funcionariosList;
    if (!isDiretor && !isInspetor) {
      targetFuncs = funcionariosList.filter(f => f.matricula === session.matricula || f.codigo_individual === session.codigo_individual);
      if (targetFuncs.length === 0) {
        targetFuncs = [{ matricula: session.matricula, nome: session.nome || 'Operador', cargo: session.cargo_nome || session.cargo, codigo_individual: session.codigo_individual }];
      }
    }

    // Com o banco disponível, a contagem vem SOMENTE dele: cada alteração também fica no cache
    // local e somá-la duas vezes inflava a produtividade. O cache local só é usado sem banco.
    const localLogs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');
    const inicioPeriodo = inicioDoPeriodo(periodoRelatorioAtual);
    const todosLogs = (logsDoBanco ? logsList : [...logsList, ...localLogs]).filter(l => logDentroDoPeriodo(l, inicioPeriodo));

    const prodData = targetFuncs.map(func => {
      const userLogs = todosLogs.filter(l => l.codigo_individual === func.codigo_individual || l.funcionario_id === func.id || l.codigo_usuario === func.codigo_individual || l.codigo_usuario === func.matricula);
      const count = userLogs.length;
      let lastOpStr = 'Sem operações no histórico';
      if (userLogs.length > 0) {
        const sorted = userLogs.sort((a, b) => new Date(b.created_at || b.data_hora || 0) - new Date(a.created_at || a.data_hora || 0));
        const lastDate = sorted[0].created_at || sorted[0].data_hora;
        if (lastDate) {
          lastOpStr = new Date(lastDate).toLocaleString('pt-BR');
        }
      }
      return {
        nome: func.nome || 'Colaborador',
        cargo: func.cargo || 'OPERACIONAL',
        volume: `${count} Operação(ões) Registrada(s)`,
        ultima: lastOpStr
      };
    });

    ultimoProdData = prodData;
    atualizarDomProdutividade(prodData);
  }

  function atualizarDomProdutividade(prodData) {
    if (!prodTableBody) return;
    const total = Array.isArray(prodData) ? prodData.length : 0;
    if (total === 0) {
      if (produtividadeContador) produtividadeContador.textContent = 'Exibindo 0 de 0 funcionários';
      if (mostrarMaisProdutividadeBtn) {
        mostrarMaisProdutividadeBtn.classList.add('hidden');
        mostrarMaisProdutividadeBtn.disabled = true;
        mostrarMaisProdutividadeBtn.setAttribute('aria-expanded', 'false');
        mostrarMaisProdutividadeBtn.textContent = 'Mostrar mais';
      }
      prodTableBody.innerHTML = `
        <tr><td colspan="4" class="p-4 text-center text-slate-600 italic">Nenhum registro de produtividade localizado.</td></tr>
      `;
      return;
    }

    const visiveis = (produtividadeExpandida || total <= PRODUTIVIDADE_LIMITE_INICIAL)
      ? prodData
      : prodData.slice(0, PRODUTIVIDADE_LIMITE_INICIAL);

    if (produtividadeContador) {
      produtividadeContador.textContent = `Exibindo ${visiveis.length} de ${total} funcionários`;
    }
    if (mostrarMaisProdutividadeBtn) {
      if (total > PRODUTIVIDADE_LIMITE_INICIAL) {
        mostrarMaisProdutividadeBtn.classList.remove('hidden');
        mostrarMaisProdutividadeBtn.disabled = false;
        mostrarMaisProdutividadeBtn.setAttribute('aria-expanded', String(produtividadeExpandida));
        mostrarMaisProdutividadeBtn.textContent = produtividadeExpandida ? 'Mostrar menos' : 'Mostrar mais';
      } else {
        mostrarMaisProdutividadeBtn.classList.add('hidden');
        mostrarMaisProdutividadeBtn.disabled = true;
        mostrarMaisProdutividadeBtn.setAttribute('aria-expanded', 'false');
        mostrarMaisProdutividadeBtn.textContent = 'Mostrar mais';
      }
    }

    prodTableBody.innerHTML = visiveis.map(item => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-3 font-bold">${esc(item.nome)}</td>
        <td class="p-3 text-slate-600">${esc(item.cargo)}</td>
        <td class="p-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">${esc(item.volume)}</td>
        <td class="p-3 text-slate-600 font-mono text-[11px]">${esc(item.ultima)}</td>
      </tr>
    `).join('');
  }

  if (mostrarMaisProdutividadeBtn) {
    mostrarMaisProdutividadeBtn.addEventListener('click', () => {
      produtividadeExpandida = !produtividadeExpandida;
      atualizarDomProdutividade(ultimoProdData);
    });
  }

  renderProdutividadeTable();

  // Filtros REAIS dos gráficos: status (geral ou específico), navio e contêiner
  // recortam os dados antes da construção de cada gráfico, junto com o
  // Período de Referência (que antes era apenas visual e não filtrava nada).
  function aplicarFiltrosAosGraficos(parcial) {
    if (window.NexusCharts && typeof window.NexusCharts.definirFiltros === 'function') {
      window.NexusCharts.definirFiltros(parcial);
    }
  }

  async function popularFiltrosGraficos() {
    const navioSel = document.getElementById('chartsFiltroNavio');
    const contSel = document.getElementById('chartsFiltroContainer');
    if (!navioSel && !contSel) return;
    let navios = [];
    let containers = [];
    if (window.NexusRepository) {
      try {
        if (typeof window.NexusRepository.getNavios === 'function') navios = await window.NexusRepository.getNavios();
        if (typeof window.NexusRepository.getContainers === 'function') containers = await window.NexusRepository.getContainers();
      } catch (e) { /* segue para o cache local */ }
    }
    if (navios.length === 0) {
      try { navios = JSON.parse(localStorage.getItem('nexus_navios_list') || '[]'); } catch (e) {}
    }
    if (containers.length === 0) {
      try { containers = JSON.parse(localStorage.getItem('nexus_containers_list') || '[]'); } catch (e) {}
    }
    if (navioSel) {
      const nomes = [...new Set((navios || []).map(n => String(n.nome || n.navio || '').trim()).filter(Boolean))].sort();
      navioSel.innerHTML = '<option value="GERAL">Geral (todos os navios)</option>' +
        nomes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    }
    if (contSel) {
      const ids = [...new Set((containers || []).map(c => String(c.identificacao || c.numero_identificacao || c.id || '').trim()).filter(Boolean))].sort();
      contSel.innerHTML = '<option value="GERAL">Geral (todos os contêineres)</option>' +
        ids.map(id => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
    }
  }

  (function ligarFiltrosGraficos() {
    const statusSel = document.getElementById('chartsFiltroStatus');
    const navioSel = document.getElementById('chartsFiltroNavio');
    const contSel = document.getElementById('chartsFiltroContainer');
    const limparBtn = document.getElementById('chartsLimparFiltrosBtn');
    if (statusSel) statusSel.addEventListener('change', () => aplicarFiltrosAosGraficos({ status: statusSel.value }));
    if (navioSel) navioSel.addEventListener('change', () => aplicarFiltrosAosGraficos({ navio: navioSel.value }));
    if (contSel) contSel.addEventListener('change', () => aplicarFiltrosAosGraficos({ container: contSel.value }));
    if (limparBtn) {
      limparBtn.addEventListener('click', () => {
        if (statusSel) statusSel.value = 'GERAL';
        if (navioSel) navioSel.value = 'GERAL';
        if (contSel) contSel.value = 'GERAL';
        aplicarFiltrosAosGraficos({ status: 'GERAL', navio: 'GERAL', container: 'GERAL' });
      });
    }
    popularFiltrosGraficos();
  })();

  // Gráficos por camada de visão — página central única de gráficos do sistema
  // (RF 16 / RF 1 / Backlog 3: a análise gráfica saiu do Dashboard e foi
  // consolidada aqui).
  if (window.NexusCharts && typeof window.NexusCharts.initRelatorios === 'function') {
    // Sincroniza o período inicial antes da primeira renderização
    aplicarFiltrosAosGraficos({ periodo: periodoRelatorioAtual });
    window.NexusCharts.initRelatorios();

    // Botão "Atualizar": reconsulta o SERVIDOR (ignora o cache em memória) e
    // informa o resultado. Sem esse retorno visual o operador não tinha como
    // saber se o clique trouxe dado novo ou apenas redesenhou o mesmo gráfico.
    const chartsRefreshBtn = document.getElementById('chartsRefreshBtn');
    if (chartsRefreshBtn) {
      const chartsSyncStatus = document.getElementById('chartsSyncStatus');
      const chartsRefreshIcon = chartsRefreshBtn.querySelector('.material-symbols-outlined');

      const informarSincronia = (texto) => {
        if (!chartsSyncStatus) return;
        chartsSyncStatus.textContent = texto;
        chartsSyncStatus.setAttribute('title', texto);
      };

      const horaDe = (iso) => {
        const data = iso ? new Date(iso) : new Date();
        return isNaN(data.getTime()) ? '--:--:--' : data.toLocaleTimeString('pt-BR');
      };

      chartsRefreshBtn.addEventListener('click', async () => {
        if (chartsRefreshBtn.disabled) return; // evita cliques concorrentes
        chartsRefreshBtn.disabled = true;
        chartsRefreshBtn.setAttribute('aria-busy', 'true');
        if (chartsRefreshIcon) chartsRefreshIcon.classList.add('animate-spin');
        informarSincronia('Consultando o servidor...');

        try {
          const resultado = (await window.NexusCharts.atualizar()) || {};
          const hora = horaDe(resultado.atualizadoEm);

          if (!resultado.ok && resultado.motivo === 'chartjs-indisponivel') {
            informarSincronia('Chart.js indisponível — não foi possível redesenhar os gráficos.');
          } else if (!resultado.ok) {
            informarSincronia('Não foi possível atualizar os gráficos agora.');
          } else if (resultado.origem === 'supabase') {
            informarSincronia(`Dados do servidor recebidos às ${hora}.`);
          } else if (resultado.origem === 'misto') {
            informarSincronia(`Atualizado parcialmente do servidor às ${hora} — fontes sem resposta usaram o cache local.`);
          } else {
            informarSincronia(`Servidor indisponível — gráficos exibidos a partir do cache local (${hora}).`);
          }
        } catch (erro) {
          console.warn('[NexusPort] Falha ao atualizar os gráficos:', erro);
          informarSincronia('Falha ao atualizar os gráficos — os dados anteriores foram mantidos.');
        } finally {
          chartsRefreshBtn.disabled = false;
          chartsRefreshBtn.removeAttribute('aria-busy');
          if (chartsRefreshIcon) chartsRefreshIcon.classList.remove('animate-spin');
        }
      });

      // Reatualização viva dos gráficos quando os dados mudam (inclusive via Realtime)
      if (typeof window.NexusCharts.ligarEventos === 'function') {
        window.NexusCharts.ligarEventos();
      }
    }
  }

  // Sincronização viva e atualização automática ao registrar produtividade / alterar dados (Tarefa 6 / L-06)
  const ENTIDADES_CARGAS_RELATORIO = new Set([
    'cargas', 'navios', 'containers', 'nexus_cargas_fluxo', 'nexus_navios_list', 'nexus_containers_list'
  ]);
  const ENTIDADES_PRODUTIVIDADE_RELATORIO = new Set([
    'funcionarios', 'logs_alteracoes', 'nexus_func_list', 'nexus_audit_logs'
  ]);
  const ENTIDADES_SYNC_GERAL_RELATORIO = new Set([
    'periodic_sync', 'window_focus', 'visibility_sync', 'online_sync', 'realtime_sync'
  ]);
  window.addEventListener('nexus_data_changed', (event) => {
    const entity = event && event.detail ? event.detail.entity : null;
    const geral = !entity || ENTIDADES_SYNC_GERAL_RELATORIO.has(entity);
    if (!geral && !ENTIDADES_CARGAS_RELATORIO.has(entity) && !ENTIDADES_PRODUTIVIDADE_RELATORIO.has(entity)) {
      return;
    }
    if (geral || ENTIDADES_CARGAS_RELATORIO.has(entity)) {
      popularCargas();
    }
    if (geral || ENTIDADES_PRODUTIVIDADE_RELATORIO.has(entity)) {
      renderProdutividadeTable();
    }
  });

  // Sem intervalo próprio nesta tela: a atualização chega pelo evento nexus_data_changed
  // (Supabase Realtime) e pela sincronização de segurança de 60 s do repositório. Um polling
  // de página em paralelo duplicaria as leituras paginadas de logs_alteracoes.
});
