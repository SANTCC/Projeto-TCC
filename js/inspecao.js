/**
 * Lógica do Módulo de Inspeção & Checklist (inspecao.html) - NexusPort
 * Trata o checklist técnico formal e garante a trava de pré-requisito RN 14:
 * O botão "Aprovar Carga" só é liberado se 100% dos itens críticos estiverem "Conforme".
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  const selectCarga = document.getElementById('inspecaoCargaSelect');
  const carregarBtn = document.getElementById('carregarChecklistBtn');
  const formContainer = document.getElementById('checklistFormContainer');
  const scanChecklistBtn = document.getElementById('scanChecklistBtn');
  const checklistQrViewport = document.getElementById('checklistQrViewport');
  const cargaTag = document.getElementById('cargaInspecionadaTag');
  const checklistItemsList = document.getElementById('checklistItemsList');
  const aprovarBtn = document.getElementById('aprovarCargaBtn');
  const recusarBtn = document.getElementById('recusarCargaBtn');
  const motivoBox = document.getElementById('motivoRecusaBox');
  const motivoInput = document.getElementById('motivoRecusaInput');

  // Obtém modelo de checklist técnico ampliado via módulo compartilhado ou fallback
  function getChecklistTemplate(tipoNome) {
    if (window.getNexusTipoCarga) {
      const tipoObj = window.getNexusTipoCarga(tipoNome);
      if (tipoObj && tipoObj.checklist && tipoObj.checklist.length > 0) {
        return tipoObj.checklist;
      }
    }
    return [
      { id: 'i1', desc: 'Conferência de Documentação Fiscal, Manifesto e BL', critico: true, categoria: 'Documentação' },
      { id: 'i2', desc: 'Conferência de Lacre de Segurança e Placas de Identificação', critico: true, categoria: 'Identificação' },
      { id: 'i3', desc: 'Inspeção Visual de Embalagem e Integridade Física do Lote', critico: true, categoria: 'Condições Físicas' },
      { id: 'i4', desc: 'Verificação de Requisitos Ambientais e EPIs da Equipe', critico: false, categoria: 'Segurança' },
      { id: 'i5', desc: 'Aferição de Peso Bruto e Volume com Declaração do Cliente', critico: true, categoria: 'Conformidade' }
    ];
  }

  let cargas = [];
  let cargaAtual = null;
  let itemsEstado = {};

  // Pontos de uso pelo agente WebMCP (mesma lógica da interface; não alteram a tela por si).
  window.nexusInspecaoModeloChecklist = getChecklistTemplate;
  window.nexusInspecaoEstado = function () {
    return {
      cargaId: cargaAtual ? cargaAtual.id : null,
      carga_status: cargaAtual ? cargaAtual.status : null,
      itens: Object.keys(itemsEstado).map((id) => ({ id, critico: itemsEstado[id].critico, conforme: itemsEstado[id].conforme })),
      aprovarHabilitado: aprovarBtn ? !aprovarBtn.disabled : false
    };
  };

  // Item 9: Popula seletor apenas com cargas cadastradas e ativas na tabela de cargas
  async function popularSeletor() {
    if (!selectCarga) return;

    if (window.NexusRepository) {
      try {
        cargas = await window.NexusRepository.getCargas();
      } catch (e) {
        cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
      }
    } else {
      cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    }

    const cargasAtivas = cargas.filter(c => c.status !== 'CANCELADA' && Boolean(c.id));

    selectCarga.innerHTML = '<option value="">Selecione uma Carga para Vistoria...</option>';
    cargasAtivas.forEach(c => {
      selectCarga.innerHTML += `<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.tipo)} (${esc(c.status)})</option>`;
    });

    // Se a URL passar ?carga=CRG-2026-001, seleciona automaticamente
    const params = new URLSearchParams(window.location.search);
    const queryCarga = params.get('carga');
    if (queryCarga) {
      selectCarga.value = queryCarga;
      carregarChecklistParaCarga(queryCarga);
    }
  }

  popularSeletor();

  // Leitura de QR Code na mesma página de checklist (RN 17)
  if (scanChecklistBtn && checklistQrViewport) {
    scanChecklistBtn.addEventListener('click', () => {
      checklistQrViewport.classList.toggle('hidden');
      if (!checklistQrViewport.classList.contains('hidden') && typeof Html5Qrcode !== 'undefined') {
        const scanner = new Html5Qrcode("inspecaoQrReader");
        scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 200, height: 200 } },
          (decodedText) => {
            let rawCode = decodedText;
            if (rawCode.includes('?carga=')) {
              try {
                const url = new URL(rawCode, window.location.origin);
                rawCode = url.searchParams.get('carga') || rawCode;
              } catch (e) {}
            }
            rawCode = rawCode.replace('QR-', '');
            selectCarga.value = rawCode;
            carregarChecklistParaCarga(rawCode);
            scanner.stop();
            checklistQrViewport.classList.add('hidden');
          },
          () => {}
        ).catch(err => {
          console.warn("Câmera indisponível no checklist:", err);
        });
      }
    });
  }

  if (carregarBtn) {
    carregarBtn.addEventListener('click', () => {
      const val = selectCarga.value;
      if (!val) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Seleção Obrigatória', 'Por favor, selecione uma carga para carregar o checklist.');
        return;
      }
      carregarChecklistParaCarga(val);
    });
  }

  window.carregarChecklistParaCarga = carregarChecklistParaCarga;
  async function carregarChecklistParaCarga(idCarga) {
    const listLocal = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    if (window.NexusRepository) {
      try {
        const repCargas = await window.NexusRepository.getCargas();
        if (repCargas && repCargas.length > 0) cargas = repCargas;
      } catch (e) {
        cargas = listLocal;
      }
    } else {
      cargas = listLocal;
    }

    cargaAtual = cargas.find(c => c.id === idCarga) || listLocal.find(c => c.id === idCarga);

    if (!cargaAtual) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Carga Não Localizada', `Carga "${idCarga}" não foi localizada.`);
      return;
    }

    // Validação de estado operacional (BL-002)
    const statusFinais = ['CANCELADA', 'ENTREGUE', 'SAIDA'];
    if (statusFinais.includes(String(cargaAtual.status).toUpperCase())) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Vistoria Bloqueada', `Cargas com status "${cargaAtual.status}" não podem ser inspecionadas.`);
      }
      if (formContainer) formContainer.classList.add('hidden');
      return;
    }

    // Alerta de re-inspeção para manter histórico auditável (BL-002)
    const resAnterior = cargaAtual.resultadoInspecao || cargaAtual.resultado_inspecao || (cargaAtual.status === 'RECUSADA' ? 'RECUSADA' : (cargaAtual.status === 'ARMAZENAGEM' ? 'APROVADA' : null));
    if (resAnterior && resAnterior !== 'PENDENTE') {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Re-inspeção Registrada', `Atenção: A carga ${cargaAtual.id} possui histórico de vistoria (${resAnterior}). Esta nova inspeção gerará um novo registro sem sobrescrever o histórico.`);
      }
    }

    if (cargaTag) cargaTag.textContent = `${cargaAtual.id} • ${cargaAtual.tipo} • Porto: ${cargaAtual.portoDescarga}`;

    const items = getChecklistTemplate(cargaAtual.tipo);

    itemsEstado = {};
    checklistItemsList.innerHTML = items.map((item, index) => {
      itemsEstado[item.id] = { conforme: null, critico: item.critico };
      return `
        <div class="p-4 rounded-xl border border-nexus-border dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div class="flex items-start gap-2.5">
            <span class="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">${index + 1}</span>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-xs text-nexus-900 dark:text-white block">${esc(item.desc)}</span>
                ${item.categoria ? `<span class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[9px] font-semibold">${esc(item.categoria)}</span>` : ''}
              </div>
              ${item.critico ? '<span class="px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300 font-mono text-[10px] font-bold uppercase mt-1 inline-block">Item Crítico (100% Requerido)</span>' : '<span class="text-[10px] text-slate-400 font-mono mt-0.5 inline-block">Item Operacional Secundário</span>'}
            </div>
          </div>

          <div class="flex items-center gap-3 shrink-0 self-end sm:self-center">
            <label class="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 cursor-pointer bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <input type="radio" name="chk_${esc(item.id)}" value="CONFORME" onchange="window.atualizarChecklistItem(${jsArg(item.id)}, true)" class="accent-emerald-600 w-4 h-4" />
              <span>Conforme</span>
            </label>
            <label class="flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400 cursor-pointer bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <input type="radio" name="chk_${esc(item.id)}" value="NAO_CONFORME" onchange="window.atualizarChecklistItem(${jsArg(item.id)}, false)" class="accent-red-600 w-4 h-4" />
              <span>Não Conforme</span>
            </label>
          </div>
        </div>
      `;
    }).join('') + `
      <div class="mt-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 font-mono">
          <span class="material-symbols-outlined text-nexus-500">draw</span>
          <span><strong>Inspetor Responsável:</strong> ${esc(session.nome || 'Inspetor')} (${esc(session.codigo_individual || session.codigo || 'INS-6090')})</span>
        </div>
        <div class="font-mono text-slate-500">
          <span>Data/Hora: ${esc(new Date().toLocaleString('pt-BR'))}</span>
        </div>
      </div>
    `;

    formContainer.classList.remove('hidden');
    avaliarConformidadeCritica();
  }

  // Atualiza estado e valida a regra dos 100% de itens críticos conforme (RN 14)
  window.atualizarChecklistItem = function(itemId, isConforme) {
    if (itemsEstado[itemId]) {
      itemsEstado[itemId].conforme = isConforme;
    }
    avaliarConformidadeCritica();
  };

  function avaliarConformidadeCritica() {
    let todosCriticosConformes = true;
    let algumItemAvaliado = false;

    Object.values(itemsEstado).forEach(item => {
      if (item.conforme !== null) algumItemAvaliado = true;
      if (item.critico && item.conforme !== true) {
        todosCriticosConformes = false;
      }
    });

    if (todosCriticosConformes && algumItemAvaliado) {
      aprovarBtn.disabled = false;
      motivoBox.classList.add('hidden');
    } else {
      aprovarBtn.disabled = true;
      if (algumItemAvaliado) {
        motivoBox.classList.remove('hidden');
      }
    }
  }

  const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  // Motivo (em português) da recusa do banco ao gravar a inspeção formal.
  // 23505 = violação do índice uq_inspecoes_carga_ativa (só UMA inspeção ativa por carga).
  // Com o histórico de inspeções, isso só ocorre se outra gravação da mesma carga
  // aconteceu ao mesmo tempo, ou se a inspeção anterior não pôde ser desativada.
  function motivoFalhaGravacao(erro) {
    if (erro && erro.code === '23505') {
      return 'esta carga já tem uma inspeção ativa no banco (outra gravação ocorreu ao mesmo tempo). Atualize a tela antes de tentar de novo.';
    }
    return `o banco recusou a gravação (${(erro && erro.message) || 'erro desconhecido'}).`;
  }

  // Aprovar Carga (RN 14 & BL-002)
  async function aprovarCargaAtual() {
      if (!cargaAtual) return false;

      const statusAnterior = cargaAtual.status;
      const resultadoAnterior = cargaAtual.resultadoInspecao || cargaAtual.resultado_inspecao;
      const motivoAnterior = cargaAtual.motivoRecusa || cargaAtual.motivo_recusa;

      const novoStatus = 'ARMAZENAGEM';
      const novoResultado = 'APROVADA';

      // Falhas de gravação no Supabase. Se houver alguma, a tela não altera o estado local.
      const pendencias = [];

      let inspetorId = isUUID(session.id) ? session.id : null;
      if (!inspetorId) {
        const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
        const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
        if (match && isUUID(match.id)) inspetorId = match.id;
      }

      if (window.nexusSupabase) {
        try {
          const targetDbId = cargaAtual.rawDbId || cargaAtual.id;
          const targetIsUuid = isUUID(targetDbId);

          let updateQuery = window.nexusSupabase.from('cargas')
            .update({ status_fluxo: 'ARMAZENAGEM', resultado_inspecao: 'APROVADA' });
          if (targetIsUuid) {
            updateQuery = updateQuery.eq('id', targetDbId);
          } else {
            updateQuery = updateQuery.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
          }
          const { error: cargaErr } = await updateQuery;
          if (cargaErr) pendencias.push(`A situação da carga não foi atualizada no banco (${cargaErr.message}).`);

          // Busca carga id no Supabase para salvar na tabela inspecoes
          let selectQuery = window.nexusSupabase.from('cargas').select('id');
          if (targetIsUuid) {
            selectQuery = selectQuery.eq('id', targetDbId);
          } else {
            selectQuery = selectQuery.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
          }
          const { data: cargaDb, error: cargaSelErr } = await selectQuery.maybeSingle();
          if (cargaSelErr) pendencias.push(`Não foi possível consultar a carga no banco (${cargaSelErr.message}).`);
          else if (!cargaDb) pendencias.push('A carga não foi localizada no banco, então a inspeção não foi gravada.');

          if (cargaDb) {
            const payloadInspecao = {
              carga_id: cargaDb.id,
              data_inspecao: new Date().toISOString(),
              resultado: 'APROVADA',
              ativa: true,
              observacoes: '100% dos itens críticos do checklist verificados em CONFORME'
            };
            if (inspetorId) payloadInspecao.inspetor_id = inspetorId;

            // Histórico: a inspeção ativa anterior desta carga (se houver) deixa de ser ativa.
            const { error: desativarErr } = await window.nexusSupabase.from('inspecoes')
              .update({ ativa: false })
              .eq('carga_id', cargaDb.id)
              .eq('ativa', true);
            if (desativarErr) {
              pendencias.push(`A inspeção anterior desta carga não pôde ser marcada como histórico (${desativarErr.message}).`);
            }

            const { data: inspDb, error: inspErr } = await window.nexusSupabase.from('inspecoes').insert(payloadInspecao).select().maybeSingle();
            if (inspErr) {
              pendencias.push(`O registro formal desta inspeção não foi gravado: ${motivoFalhaGravacao(inspErr)}`);
              console.warn('[NexusPort] Inspeção não gravada no Supabase:', inspErr);
            }

            if (inspDb) {
              const { data: dbChecklistItens } = await window.nexusSupabase.from('checklist_itens').select('id, ordem');
              const itemRows = [];
              const keys = Object.keys(itemsEstado);
              for (let idx = 0; idx < keys.length; idx++) {
                const k = keys[idx];
                let realItemUuid = isUUID(k) ? k : null;
                if (!realItemUuid && dbChecklistItens && dbChecklistItens.length > 0) {
                  const match = dbChecklistItens.find(ci => ci.ordem === idx + 1) || dbChecklistItens[idx];
                  if (match) realItemUuid = match.id;
                }
                if (realItemUuid) {
                  itemRows.push({
                    inspecao_id: inspDb.id,
                    checklist_item_id: realItemUuid,
                    conforme: itemsEstado[k].conforme,
                    observacao: itemsEstado[k].conforme ? 'Conforme' : 'Não Conforme'
                  });
                }
              }
              if (itemRows.length > 0) {
                const { error: itensErr } = await window.nexusSupabase.from('inspecao_itens').insert(itemRows);
                if (itensErr) {
                  pendencias.push(`Os itens do checklist não foram gravados (${itensErr.message || 'erro desconhecido'}).`);
                  console.warn('[NexusPort] Itens do checklist não gravados:', itensErr);
                }
              }
            }
          }
        } catch (err) {
          pendencias.push(`Falha de comunicação com o banco (${(err && err.message) || 'erro desconhecido'}).`);
          console.warn('[NexusPort] Erro ao sincronizar aprovação no Supabase:', err);
        }
      }

      // Grava no Trail de Decisões Imutável (T7.3)
      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('APROVOU_CARGA', cargaAtual.id, '100% dos itens críticos do checklist verificados em CONFORME');
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('cargas');
      }

      if (pendencias.length > 0) {
        // Reverte alteração em memória para manter consistência atômica entre interface e Supabase (BL-002)
        cargaAtual.status = statusAnterior;
        cargaAtual.resultadoInspecao = resultadoAnterior;
        cargaAtual.resultado_inspecao = resultadoAnterior;
        cargaAtual.motivoRecusa = motivoAnterior;
        cargaAtual.motivo_recusa = motivoAnterior;

        console.warn('[NexusPort] Aprovação cancelada por falha no Supabase:', pendencias);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Falha na Gravação', `Operação cancelada para manter a consistência do banco: ${pendencias.join(' ')}`);
        }
        return false;
      }

      // Aplica e persiste localmente somente após confirmação do Supabase
      cargaAtual.status = novoStatus;
      cargaAtual.resultadoInspecao = novoResultado;
      cargaAtual.resultado_inspecao = novoResultado;
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Inspeção Concluída', `Sucesso! Carga ${cargaAtual.id} APROVADA na inspeção técnica. Status atualizado para ARMAZENAGEM no pátio.`);
      }
      setTimeout(() => { window.location.href = 'cargas.html'; }, 1000);
      return true;
  }

  window.nexusInspecaoAprovar = aprovarCargaAtual;
  if (aprovarBtn) {
    aprovarBtn.addEventListener('click', () => aprovarCargaAtual());
  }

  // Recusar Carga (RN 14 & BL-002 & Item 10: campo obrigatório de motivo de recusa)
  async function recusarCargaAtual(opcoes) {
      if (!cargaAtual) return false;

      if (motivoBox) motivoBox.classList.remove('hidden');

      let motivo = (opcoes && opcoes.motivo) ? String(opcoes.motivo).trim() : (motivoInput ? motivoInput.value.trim() : '');
      if (motivoInput && motivo) motivoInput.value = motivo;
      if (!motivo) {
        motivo = await window.nexusPrompt('Motivo de Recusa da Carga', 'Informe obrigatoriamente o MOTIVO FORMAL do cancelamento/recusa da carga:');
        if (motivoInput && motivo) motivoInput.value = motivo;
      }

      if (!motivo) {
        if (window.mostrarFeedback) window.mostrarFeedback('alerta', 'Motivo Obrigatório', 'ATENÇÃO: É obrigatório informar o MOTIVO FORMAL da recusa.');
        if (motivoInput) motivoInput.focus();
        return;
      }

      const statusAnterior = cargaAtual.status;
      const resultadoAnterior = cargaAtual.resultadoInspecao || cargaAtual.resultado_inspecao;
      const motivoAnterior = cargaAtual.motivoRecusa || cargaAtual.motivo_recusa;

      const novoStatus = 'RECUSADA';
      const novoResultado = 'RECUSADA';

      // Falhas de gravação no Supabase. Se houver alguma, a tela não altera o estado local.
      const pendencias = [];

      let inspetorId = isUUID(session.id) ? session.id : null;
      if (!inspetorId) {
        const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
        const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
        if (match && isUUID(match.id)) inspetorId = match.id;
      }

      if (window.nexusSupabase) {
        try {
          const targetDbId = cargaAtual.rawDbId || cargaAtual.id;
          const targetIsUuid = isUUID(targetDbId);

          let updateQuery = window.nexusSupabase.from('cargas')
            .update({ status_fluxo: 'RECUSADA', resultado_inspecao: 'RECUSADA', motivo_recusa: motivo });
          if (targetIsUuid) {
            updateQuery = updateQuery.eq('id', targetDbId);
          } else {
            updateQuery = updateQuery.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
          }
          const { error: cargaErr } = await updateQuery;
          if (cargaErr) pendencias.push(`A situação da carga não foi atualizada no banco (${cargaErr.message}).`);

          let selectQuery = window.nexusSupabase.from('cargas').select('id');
          if (targetIsUuid) {
            selectQuery = selectQuery.eq('id', targetDbId);
          } else {
            selectQuery = selectQuery.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
          }
          const { data: cargaDb, error: cargaSelErr } = await selectQuery.maybeSingle();
          if (cargaSelErr) pendencias.push(`Não foi possível consultar a carga no banco (${cargaSelErr.message}).`);
          else if (!cargaDb) pendencias.push('A carga não foi localizada no banco, então a recusa não foi gravada.');

          if (cargaDb) {
            const payloadInspecao = {
              carga_id: cargaDb.id,
              data_inspecao: new Date().toISOString(),
              resultado: 'RECUSADA',
              ativa: true,
              observacoes: motivo
            };
            if (inspetorId) payloadInspecao.inspetor_id = inspetorId;

            // Histórico: a inspeção ativa anterior desta carga (se houver) deixa de ser ativa.
            const { error: desativarErr } = await window.nexusSupabase.from('inspecoes')
              .update({ ativa: false })
              .eq('carga_id', cargaDb.id)
              .eq('ativa', true);
            if (desativarErr) {
              pendencias.push(`A inspeção anterior desta carga não pôde ser marcada como histórico (${desativarErr.message}).`);
            }

            const { data: inspDb, error: inspErr } = await window.nexusSupabase.from('inspecoes').insert(payloadInspecao).select().maybeSingle();
            if (inspErr) {
              pendencias.push(`O registro formal desta recusa não foi gravado: ${motivoFalhaGravacao(inspErr)}`);
              console.warn('[NexusPort] Recusa não gravada no Supabase:', inspErr);
            }

            if (inspDb) {
              const { data: dbChecklistItens } = await window.nexusSupabase.from('checklist_itens').select('id, ordem');
              const itemRows = [];
              const keys = Object.keys(itemsEstado);
              for (let idx = 0; idx < keys.length; idx++) {
                const k = keys[idx];
                let realItemUuid = isUUID(k) ? k : null;
                if (!realItemUuid && dbChecklistItens && dbChecklistItens.length > 0) {
                  const match = dbChecklistItens.find(ci => ci.ordem === idx + 1) || dbChecklistItens[idx];
                  if (match) realItemUuid = match.id;
                }
                if (realItemUuid) {
                  itemRows.push({
                    inspecao_id: inspDb.id,
                    checklist_item_id: realItemUuid,
                    conforme: itemsEstado[k].conforme,
                    observacao: itemsEstado[k].conforme ? 'Conforme' : 'Não Conforme'
                  });
                }
              }
              if (itemRows.length > 0) {
                const { error: itensErr } = await window.nexusSupabase.from('inspecao_itens').insert(itemRows);
                if (itensErr) {
                  pendencias.push(`Os itens do checklist não foram gravados (${itensErr.message || 'erro desconhecido'}).`);
                  console.warn('[NexusPort] Itens do checklist não gravados:', itensErr);
                }
              }
            }
          }
        } catch (err) {
          pendencias.push(`Falha de comunicação com o banco (${(err && err.message) || 'erro desconhecido'}).`);
          console.warn('[NexusPort] Erro ao sincronizar recusa no Supabase:', err);
        }
      }

      // Grava no Trail de Decisões Imutável (T7.3)
      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('RECUSOU_CARGA', cargaAtual.id, motivo);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('cargas');
      }

      if (pendencias.length > 0) {
        // Reverte alteração em memória para manter consistência atômica entre interface e Supabase (BL-002)
        cargaAtual.status = statusAnterior;
        cargaAtual.resultadoInspecao = resultadoAnterior;
        cargaAtual.resultado_inspecao = resultadoAnterior;
        cargaAtual.motivoRecusa = motivoAnterior;
        cargaAtual.motivo_recusa = motivoAnterior;

        console.warn('[NexusPort] Recusa cancelada por falha no Supabase:', pendencias);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Falha na Gravação', `Operação cancelada para manter a consistência do banco: ${pendencias.join(' ')}`);
        }
        return false;
      }

      // Aplica e persiste localmente somente após confirmação do Supabase
      cargaAtual.status = novoStatus;
      cargaAtual.resultadoInspecao = novoResultado;
      cargaAtual.resultado_inspecao = novoResultado;
      cargaAtual.motivoRecusa = motivo;
      cargaAtual.motivo_recusa = motivo;
      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Inspeção Registrada', `Carga ${cargaAtual.id} RECUSADA na inspeção técnica. Motivo registrado: "${motivo}". Status mantido em RECUSADA.`);
      }
      setTimeout(() => { window.location.href = 'cargas.html'; }, 1000);
      return true;
  }

  window.nexusInspecaoRecusar = recusarCargaAtual;
  if (recusarBtn) {
    recusarBtn.addEventListener('click', () => recusarCargaAtual({}));
  }

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    popularSeletor();
  });
});
