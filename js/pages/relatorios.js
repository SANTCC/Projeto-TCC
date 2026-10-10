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

  let cargas = [];
  let funcionariosList = [];
  let logsList = [];

  // Backlog 3 (7g): período de referência selecionado — os atalhos do topo
  // (Hoje / 7 dias / 30 dias / Este mês) e o select compartilham este estado e
  // filtram o histórico de operações da tabela de produtividade.
  let periodoRelatorioAtual = (document.getElementById('relatorioPeriodoSelect') || { value: '30D' }).value || '30D';

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
    if (!selectCarga) return;
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('cargas').select('*');
        if (!error && Array.isArray(data)) {
          cargas = data.map(c => ({
            id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : `CRG-${c.id}`,
            tipo: c.natureza || 'Não informado',
            status: c.status_fluxo || 'AGENDAMENTO',
            navio: c.navio || '',
            container: c.container_id || '',
            destino: c.destino || '',
            portoDescarga: c.porto_descarga || '',
            rawDbId: c.id
          }));
        }
      } catch (e) {
        console.warn('Erro ao carregar cargas para relatório:', e);
      }
    }
    if (cargas.length === 0 && window.NexusRepository) {
      try { cargas = await window.NexusRepository.getCargas(); } catch (e) {}
    }
    selectCarga.innerHTML = '<option value="">Selecione a Carga para Emitir PDF A4...</option>';
    if (cargas.length === 0) {
      selectCarga.innerHTML = '<option value="" disabled>Nenhuma carga cadastrada no sistema</option>';
      return;
    }
    cargas.forEach(c => {
      selectCarga.innerHTML += `<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.tipo)} (${esc(c.status)})</option>`;
    });
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

  const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const arquivo = await resposta.blob();
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
        matricula: func.matricula || 'MAT-0000',
        nome: func.nome || 'Colaborador',
        cargo: func.cargo || 'OPERACIONAL',
        volume: `${count} Operação(ões) Registrada(s)`,
        ultima: lastOpStr
      };
    });

    if (prodData.length === 0) {
      prodTableBody.innerHTML = `
        <tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Nenhum registro de produtividade localizado.</td></tr>
      `;
      return;
    }

    prodTableBody.innerHTML = prodData.map(item => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td class="p-3 font-mono font-bold text-nexus-500">${esc(item.matricula)}</td>
        <td class="p-3 font-bold">${esc(item.nome)}</td>
        <td class="p-3 text-slate-500">${esc(item.cargo)}</td>
        <td class="p-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">${esc(item.volume)}</td>
        <td class="p-3 text-slate-400 font-mono text-[11px]">${esc(item.ultima)}</td>
      </tr>
    `).join('');
  }

  renderProdutividadeTable();

  // Gráficos por camada de visão — página central única de gráficos do sistema
  // (RF 16 / RF 1 / Backlog 3: a análise gráfica saiu do Dashboard e foi
  // consolidada aqui).
  if (window.NexusCharts && typeof window.NexusCharts.initRelatorios === 'function') {
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

  // Sincronização viva e atualização automática ao registrar produtividade / alterar dados (Tarefa 6)
  window.addEventListener('nexus_data_changed', () => {
    popularCargas();
    renderProdutividadeTable();
  });

  // Sem intervalo próprio nesta tela: a atualização chega pelo evento nexus_data_changed
  // (Supabase Realtime) e pela sincronização de segurança de 60 s do repositório. Um polling
  // de página em paralelo duplicaria as leituras paginadas de logs_alteracoes.
});
