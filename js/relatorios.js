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

  async function popularCargas() {
    if (!selectCarga) return;
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('cargas').select('*');
        if (!error && Array.isArray(data)) {
          cargas = data.map(c => ({
            id: c.qr_code_url ? c.qr_code_url.replace('QR-', '') : `CRG-${c.id}`,
            tipo: c.natureza || 'Carga Geral',
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

  const loadingStatus = document.getElementById('pdfLoadingStatus');
  const idleStatus = document.getElementById('pdfIdleStatus');

  if (gerarPdfBtn) {
    gerarPdfBtn.addEventListener('click', () => {
      const idCarga = selectCarga ? selectCarga.value : '';
      if (!idCarga) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Seleção Necessária', 'Por favor, selecione uma carga operacional para gerar o relatório PDF A4.');
        }
        return;
      }

      if (loadingStatus) loadingStatus.classList.remove('hidden');
      if (idleStatus) idleStatus.classList.add('hidden');
      gerarPdfBtn.disabled = true;

      setTimeout(() => {
        gerarRelatorioPdfA4(idCarga);
        if (loadingStatus) loadingStatus.classList.add('hidden');
        if (idleStatus) idleStatus.classList.remove('hidden');
        gerarPdfBtn.disabled = false;
      }, 600);
    });
  }

  async function gerarRelatorioPdfA4(idCarga) {
    let c = cargas.find(item => item.id === idCarga);

    if (window.nexusSupabase) {
      try {
        const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        let query = window.nexusSupabase
          .from('cargas')
          .select('*, navios:navio_id(id, nome, numero_imo, porto_origem, porto_destino), containers:container_id(id, numero_identificacao, material_carregado, estado)');

        if (isUuid(idCarga)) {
          query = query.eq('id', idCarga);
        } else {
          query = query.or(`qr_code_url.eq.QR-${idCarga},qr_code_url.eq.${idCarga}`);
        }

        const { data: dbCarga } = await query.maybeSingle();

        if (dbCarga) {
          let navioNome = dbCarga.navios?.nome || (c ? c.navio : 'Não Vinculado');
          let navioImo = dbCarga.navios?.numero_imo || 'Não Informado';
          let containerIdent = dbCarga.containers?.numero_identificacao || (c ? c.container : 'Não Alocado');

          if (!dbCarga.navios && dbCarga.navio_id) {
            const { data: nDb } = await window.nexusSupabase.from('navios').select('nome, numero_imo').eq('id', dbCarga.navio_id).maybeSingle();
            if (nDb) {
              navioNome = nDb.nome;
              navioImo = nDb.numero_imo;
            }
          }

          if (!dbCarga.containers && dbCarga.container_id) {
            const { data: cDb } = await window.nexusSupabase.from('containers').select('numero_identificacao').eq('id', dbCarga.container_id).maybeSingle();
            if (cDb) {
              containerIdent = cDb.numero_identificacao;
            }
          }

          c = {
            id: idCarga,
            tipo: dbCarga.natureza || dbCarga.containers?.material_carregado || (c ? c.tipo : 'Carga Geral'),
            peso: `${dbCarga.peso || dbCarga.peso_toneladas || 25} t`,
            volume: `${dbCarga.volume || 40} m³`,
            valor: `R$ ${(dbCarga.valor_declarado || 100000).toLocaleString('pt-BR')}`,
            natureza: dbCarga.natureza || 'Geral',
            portoDescarga: dbCarga.porto_descarga || (c ? c.portoDescarga : 'Porto de Santos'),
            destino: dbCarga.destino || dbCarga.navios?.porto_destino || (c ? c.destino : 'Destino Internacional'),
            status: dbCarga.status_fluxo || (c ? c.status : 'ARMAZENAGEM'),
            container: containerIdent,
            navio: navioNome,
            imo: navioImo
          };
        }
      } catch (err) { console.warn('Erro ao carregar carga no Supabase para PDF:', err); }
    }

    if (!c) {
      c = {
        id: idCarga, tipo: 'Carga Geral', peso: '25.0 t', volume: '40 m³', valor: 'R$ 100.000', natureza: 'Geral',
        portoDescarga: 'Porto de Santos', destino: 'Destino Internacional', status: 'ARMAZENAGEM', container: 'Não Alocado', navio: 'Não Vinculado', imo: 'Não Informado'
      };
    }

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXPORTACAO', 'cargas', null, { carga_id: c.id, tipo_exportacao: 'PDF_A4', exportado_por: session.nome || session.cargo });
    }

    if (window.jspdf && window.jspdf.jsPDF) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ format: 'a4' });

      // Cabeçalho Institucional
      doc.setFillColor(30, 41, 59);
      doc.rect(0, 0, 210, 25, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('NEXUSPORT - SISTEMA DE AUTOMAÇÃO PORTUÁRIA', 14, 12);
      doc.setFontSize(10);
      doc.text('RELATÓRIO OPERACIONAL INTEGRADO DE CARGA (FORMATO A4)', 14, 18);

      let y = 35;

      // Seção 1: Dados da Carga
      doc.setFillColor(245, 247, 250);
      doc.rect(14, y, 182, 8, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.text('1. DADOS DA CARGA', 16, y + 6);
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Código da Carga: ${c.id}`, 16, y);
      doc.text(`Tipo de Carga: ${c.tipo}`, 110, y);
      y += 6;
      doc.text(`Peso Declarado: ${c.peso}`, 16, y);
      doc.text(`Volume: ${c.volume}`, 110, y);
      y += 6;
      doc.text(`Valor Declarado: ${c.valor || 'R$ 0,00'}`, 16, y);
      doc.text(`Natureza da Mercadoria: ${c.natureza || 'Geral'}`, 110, y);
      y += 12;

      // Seção 2: Dados do Navio
      doc.setFillColor(245, 247, 250);
      doc.rect(14, y, 182, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('2. DADOS DO NAVIO', 16, y + 6);
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Nome da Embarcação: ${c.navio || 'Não Vinculado'}`, 16, y);
      doc.text(`Número IMO: ${c.imo || 'Não Informado'}`, 110, y);
      y += 6;
      doc.text(`Porto de Origem: Porto de Santos (STS-01)`, 16, y);
      doc.text(`Porto de Destino da Viagem: ${c.destino || 'Destino Internacional'}`, 110, y);
      y += 12;

      // Seção 3: Dados do Contêiner
      doc.setFillColor(245, 247, 250);
      doc.rect(14, y, 182, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('3. DADOS DO CONTÊINER', 16, y + 6);
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Identificação do Contêiner: ${c.container || 'Não Alocado'}`, 16, y);
      doc.text(`Tipo de Carga Vinculada: ${c.tipo}`, 110, y);
      y += 6;
      doc.text(`Estado Operacional: OPERANTE`, 16, y);
      doc.text(`Referência Temp. Uso: Data de Fabricação`, 110, y);
      y += 12;

      // Seção 4: Resumo do Fluxo
      doc.setFillColor(245, 247, 250);
      doc.rect(14, y, 182, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('4. RESUMO DO FLUXO OPERACIONAL', 16, y + 6);
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Status Atual no Fluxo: ${c.status}`, 16, y);
      doc.text(`Porto de Descarga Individual: ${c.portoDescarga}`, 110, y);
      y += 6;
      // C15: Data e hora do relatório em tempo real
      const dataAtualReal = new Date();
      doc.text(`Data/Hora de Emissão: ${dataAtualReal.toLocaleString('pt-BR')}`, 16, y);
      doc.text(`Validade da Auditoria: ${dataAtualReal.toLocaleDateString('pt-BR')} 23:59:59`, 110, y);

      doc.save(`Relatorio_A4_${c.id}.pdf`);
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'PDF Emitido', `Relatório PDF A4 em 4 seções gerado com sucesso para a carga ${c.id}!`);
      }
    } else {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('info', 'Relatório Gerado', `Relatório da Carga ${c.id}:\n• Navio: ${c.navio}\n• Contêiner: ${c.container}\n• Status: ${c.status}`);
      }
    }
  }

  // Tabela de Produtividade Real (T6.9, T6.10, Tarefa 4.1)
  async function renderProdutividadeTable() {
    if (!prodTableBody) return;

    let funcsLoaded = false;
    if (window.nexusSupabase) {
      try {
        const { data: funcs, error: fErr } = await window.nexusSupabase.from('funcionarios').select('*').eq('ativo', true);
        if (!fErr && Array.isArray(funcs)) {
          funcionariosList = funcs;
          funcsLoaded = true;
        }

        const { data: logs } = await window.nexusSupabase.from('logs_alteracoes').select('*');
        if (logs) logsList = logs;
      } catch (e) {
        console.warn('Erro ao carregar dados de produtividade do Supabase:', e);
      }
    }

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

    const localLogs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');
    const todosLogs = [...logsList, ...localLogs];

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

  // Sincronização viva e atualização automática ao registrar produtividade / alterar dados (Tarefa 6)
  window.addEventListener('nexus_data_changed', () => {
    popularCargas();
    renderProdutividadeTable();
  });

  // Atualização periódica a cada 5 segundos para garantir atualização viva do relatório
  setInterval(() => {
    renderProdutividadeTable();
  }, 5000);
});
