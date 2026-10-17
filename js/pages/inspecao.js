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

  // Modelo de checklist efetivamente usado na inspeção em curso. É gravado em
  // `inspecoes.checklist_modelo_id` e limita a busca de itens ao modelo certo.
  let checklistModeloIdAtual = null;

  // Obtém modelo de checklist técnico ampliado via módulo compartilhado ou fallback.
  // O vínculo por `tipo_carga_id` tem precedência sobre o nome (que pode variar).
  function getChecklistTemplate(tipoNome, tipoCargaId) {
    checklistModeloIdAtual = null;
    if (window.getNexusTipoCarga) {
      const tipoObj = (tipoCargaId && window.getNexusTipoCarga(tipoCargaId))
        || window.getNexusTipoCarga(tipoNome);
      if (tipoObj && tipoObj.checklist && tipoObj.checklist.length > 0) {
        checklistModeloIdAtual = tipoObj.modeloId || null;
        return tipoObj.checklist;
      }
    }
    // Sem modelo cadastrado: checklist genérico de contingência. Nesse caso não
    // há como mapear itens para o banco, então `inspecao_itens` não é gravado.
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

    // Cargas entregues, canceladas ou em trânsito não são inspecionáveis: não
    // entram na lista. EM_TRANSITO = a carga já saiu do porto com o navio
    // liberado; a inspeção formal pertence às etapas anteriores do fluxo
    // (recebimento/inspeção e armazenagem — SPEC §6).
    const cargasAtivas = cargas.filter(c => !['CANCELADA', 'ENTREGUE', 'EM_TRANSITO'].includes(c.status) && Boolean(c.id));

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

  // Leitura de QR Code na mesma página de checklist (RN 17).
  // Uma única sessão de câmera por vez: o botão abre/fecha, e fechar sempre libera a câmera.
  if (scanChecklistBtn && checklistQrViewport) {
    const qrStatusEl = document.getElementById('inspecaoQrStatus');
    const rotuloBotaoQr = scanChecklistBtn.querySelector('span:last-child');
    let scannerQr = null;
    let iniciandoQr = false;
    let leitorDesejado = false; // intenção do usuário: aberto ou fechado

    const mostrarStatusQr = (msg) => { if (qrStatusEl) qrStatusEl.textContent = msg || ''; };
    const atualizarBotaoQr = (aberto) => {
      scanChecklistBtn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      if (rotuloBotaoQr) rotuloBotaoQr.textContent = aberto ? 'Fechar leitor' : 'Escanear QR Code';
    };

    async function pararLeitorQr() {
      leitorDesejado = false;
      const atual = scannerQr;
      scannerQr = null;
      if (atual) {
        try { await atual.stop(); } catch (e) { /* já parado */ }
        try { atual.clear(); } catch (e) { /* área já limpa */ }
      }
      checklistQrViewport.classList.add('hidden');
      atualizarBotaoQr(false);
    }

    async function abrirLeitorQr() {
      leitorDesejado = true;
      checklistQrViewport.classList.remove('hidden');
      atualizarBotaoQr(true);
      mostrarStatusQr('Carregando leitor de QR Code...');

      // A biblioteca é local (vendor/) e só é baixada ao abrir a câmera (js/asset-loader.js).
      const disponivel = window.NexusAssets
        ? await window.NexusAssets.carregar('html5-qrcode')
        : typeof Html5Qrcode !== 'undefined';
      if (!disponivel || typeof Html5Qrcode === 'undefined') {
        mostrarStatusQr('Não foi possível carregar o leitor de QR Code. Selecione a carga manualmente abaixo.');
        return;
      }
      // O usuário pode ter fechado enquanto a biblioteca carregava: nesse caso a câmera não é ligada.
      if (!leitorDesejado || scannerQr || iniciandoQr) return;

      iniciandoQr = true;
      const scanner = new Html5Qrcode('inspecaoQrReader');
      scannerQr = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            // Quadro de leitura proporcional à área disponível (funciona em telas estreitas)
            qrbox: (largura, altura) => {
              const lado = Math.max(120, Math.floor(Math.min(largura, altura) * 0.7));
              return { width: lado, height: lado };
            }
          },
          (decodedText) => {
            let rawCode = String(decodedText || '');
            if (rawCode.includes('?carga=')) {
              try {
                const url = new URL(rawCode, window.location.origin);
                rawCode = url.searchParams.get('carga') || rawCode;
              } catch (e) { /* mantém o texto lido */ }
            }
            rawCode = rawCode.replace('QR-', '');
            selectCarga.value = rawCode;
            carregarChecklistParaCarga(rawCode);
            pararLeitorQr();
          },
          () => {}
        );
        if (!leitorDesejado || scannerQr !== scanner) {
          // Usuário fechou o leitor enquanto a câmera iniciava: libera a câmera agora.
          if (scannerQr === scanner) scannerQr = null;
          try { await scanner.stop(); } catch (e) { /* já parado */ }
        } else {
          mostrarStatusQr('Aponte a câmera para a etiqueta da carga.');
        }
      } catch (err) {
        console.warn('Câmera indisponível no checklist:', err);
        if (scannerQr === scanner) scannerQr = null;
        mostrarStatusQr('Câmera indisponível. Verifique a permissão do navegador ou selecione a carga manualmente abaixo.');
      } finally {
        iniciandoQr = false;
      }
    }

    scanChecklistBtn.addEventListener('click', () => {
      if (checklistQrViewport.classList.contains('hidden')) abrirLeitorQr();
      else pararLeitorQr();
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

  function carregarChecklistParaCarga(idCarga) {
    // Usa a lista já carregada do Supabase por popularSeletor(). Só recorre ao
    // cache local quando ele está vazio (ex.: abertura direta por QR antes da
    // primeira leitura) — nunca sobrescreve dados frescos do banco.
    if (!Array.isArray(cargas) || cargas.length === 0) {
      cargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    }
    const cargasCanceladas = JSON.parse(localStorage.getItem('nexus_cargas_canceladas') || '[]');
    cargaAtual = cargas.find(c => c.id === idCarga || c.qrCode === idCarga)
      || cargasCanceladas.find(c => c.id === idCarga || c.qrCode === idCarga);
    if (cargaAtual && cargasCanceladas.some(c => c.id === cargaAtual.id)) {
      cargaAtual = { ...cargaAtual, status: 'CANCELADA' };
    }

    if (!cargaAtual) {
      if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Carga Não Localizada', `Carga "${idCarga}" não foi localizada.`);
      return;
    }

    if (cargaAtual.status === 'ENTREGUE') {
      const idEntregue = cargaAtual.id;
      cargaAtual = null;
      if (formContainer) formContainer.classList.add('hidden');
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Carga Entregue', `A carga ${idEntregue} já foi entregue e não pode mais ser inspecionada.`);
      return;
    }

    if (cargaAtual.status === 'CANCELADA') {
      const idCancelada = cargaAtual.id;
      cargaAtual = null;
      if (formContainer) formContainer.classList.add('hidden');
      avisoCargaCancelada(idCancelada);
      return;
    }

    // Carga em trânsito já saiu do porto: o checklist nem chega a ser aberto
    // (vale para seleção manual, ?carga= na URL e leitura de QR Code). A tela
    // fica sem nenhuma carga em inspeção (cargaAtual nulo).
    if (cargaAtual.status === 'EM_TRANSITO') {
      const idEmTransito = cargaAtual.id;
      cargaAtual = null;
      if (formContainer) formContainer.classList.add('hidden');
      avisoCargaEmTransito(idEmTransito);
      return;
    }

    if (cargaTag) cargaTag.textContent = `${cargaAtual.id} • ${cargaAtual.tipo} • Porto: ${cargaAtual.portoDescarga}`;

    const items = getChecklistTemplate(cargaAtual.tipo, cargaAtual.tipo_carga_id);

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
              ${item.critico ? '<span class="px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-300 font-mono text-[10px] font-bold uppercase mt-1 inline-block">Item Crítico (100% Requerido)</span>' : '<span class="text-[10px] text-slate-600 font-mono mt-0.5 inline-block">Item Operacional Secundário</span>'}
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
        <div class="font-mono text-slate-600">
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

  // Bloqueio de carga EM_TRANSITO (já saiu do porto): mensagem única usada na
  // abertura do checklist e na recusa da gravação, em qualquer canal.
  function avisoCargaEmTransito(idCarga) {
    if (window.mostrarFeedback) {
      window.mostrarFeedback('atencao', 'Carga em Trânsito', `A carga ${idCarga} está EM TRÂNSITO (já saiu do porto) e não pode ser inspecionada. A inspeção formal só é permitida antes da saída, nas etapas de recebimento/inspeção e armazenagem do fluxo.`);
    }
  }

  function avisoCargaCancelada(idCarga) {
    if (window.mostrarFeedback) {
      window.mostrarFeedback('atencao', 'Carga Cancelada', `A carga ${idCarga} foi CANCELADA e não pode realizar ou refazer o checklist de inspeção, pois não retorna ao fluxo normal.`);
    }
  }

  // Conferência no banco no momento da gravação: o navio pode ter sido liberado
  // (carga → EM_TRANSITO) enquanto o checklist estava aberto nesta tela.
  // Retorna true somente quando o banco confirma o status EM_TRANSITO; falha de
  // consulta não bloqueia (o fluxo normal reporta seus próprios erros adiante).
  async function cargaEmTransitoNoBanco() {
    if (!window.nexusSupabase || !cargaAtual) return false;
    try {
      const targetDbId = cargaAtual.rawDbId || cargaAtual.id;
      let consulta = window.nexusSupabase.from('cargas').select('id, status_fluxo');
      consulta = isUUID(targetDbId)
        ? consulta.eq('id', targetDbId)
        : consulta.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
      const { data, error } = await consulta.maybeSingle();
      return !error && Boolean(data) && String(data.status_fluxo || '').toUpperCase() === 'EM_TRANSITO';
    } catch (e) {
      return false;
    }
  }

  async function cargaCanceladaNoBanco() {
    if (!window.nexusSupabase || !cargaAtual) return false;
    try {
      const targetDbId = cargaAtual.rawDbId || cargaAtual.id;
      let consulta = window.nexusSupabase.from('cargas').select('id, status_fluxo');
      consulta = isUUID(targetDbId)
        ? consulta.eq('id', targetDbId)
        : consulta.eq('qr_code_url', cargaAtual.qrCode || `QR-${cargaAtual.id}`);
      const { data, error } = await consulta.maybeSingle();
      return !error && Boolean(data) && String(data.status_fluxo || '').toUpperCase() === 'CANCELADA';
    } catch (e) {
      return false;
    }
  }

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

  // Aprovar Carga (RN 14)
  async function aprovarCargaAtual() {
    if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly(session)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Modo Somente Leitura (Espectador)', 'O perfil Espectador (MAT-1111) possui acesso exclusivo de visualização e não pode realizar alterações no sistema.');
      }
      return false;
    }
    if (cargaAtual && cargaAtual.status === 'ENTREGUE') {
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Carga Entregue', 'Cargas entregues não podem ter a inspeção alterada.');
      return;
    }
    if (!cargaAtual) return false;

    if (cargaAtual.status === 'CANCELADA' || await cargaCanceladaNoBanco()) {
      avisoCargaCancelada(cargaAtual.id);
      return false;
    }

    // Recusa na gravação: carga em trânsito não pode ser inspecionada — nem
    // pelo estado local, nem pelo status confirmado no banco (corrida com a
    // liberação do navio enquanto o checklist estava aberto).
    if (cargaAtual.status === 'EM_TRANSITO' || await cargaEmTransitoNoBanco()) {
      avisoCargaEmTransito(cargaAtual.id);
      return false;
    }

      cargaAtual.status = 'ARMAZENAGEM';
      cargaAtual.resultadoInspecao = 'APROVADA';

      // Falhas de gravação no Supabase. Se houver alguma, a tela não mostra "concluída".
      const pendencias = [];

      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));

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
            if (checklistModeloIdAtual) payloadInspecao.checklist_modelo_id = checklistModeloIdAtual;

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
              const itemRows = [];
              const keys = Object.keys(itemsEstado);
              // Itens sempre limitados ao modelo da inspeção. Quando o modelo não
              // foi resolvido pelo tipo, só grava se houver um único modelo na
              // resposta ou se a lista tiver exatamente os itens do checklist —
              // nunca mistura itens de modelos diferentes.
              let consultaItens = window.nexusSupabase
                .from('checklist_itens')
                .select('id, ordem, checklist_modelo_id');
              if (checklistModeloIdAtual) {
                consultaItens = consultaItens.eq('checklist_modelo_id', checklistModeloIdAtual).order('ordem');
              }
              const { data: dbChecklistItens } = await consultaItens;
              const itensBanco = Array.isArray(dbChecklistItens) ? dbChecklistItens : [];
              let modeloResolvido = checklistModeloIdAtual;
              if (!modeloResolvido) {
                const modelos = [...new Set(itensBanco.map(ci => ci.checklist_modelo_id).filter(Boolean))];
                if (modelos.length === 1) modeloResolvido = modelos[0];
              }
              const listaItens = modeloResolvido
                ? itensBanco.filter(ci => ci.checklist_modelo_id === modeloResolvido)
                : itensBanco;
              if (!modeloResolvido && listaItens.length !== keys.length) {
                pendencias.push('Os itens do checklist não foram gravados: a carga não possui modelo de checklist vinculado no banco.');
              } else {
                for (let idx = 0; idx < keys.length; idx++) {
                  const k = keys[idx];
                  let realItemUuid = isUUID(k) ? k : null;
                  if (!realItemUuid && listaItens.length > 0) {
                    const match = listaItens.find(ci => ci.ordem === idx + 1) || listaItens[idx];
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
        // Sem redirecionamento: o aviso precisa ser lido antes de sair da tela.
        // Retorna false: o banco não confirmou a gravação completa.
        console.warn('[NexusPort] Aprovação com pendências de gravação:', pendencias);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Gravação Incompleta', `Carga ${cargaAtual.id}: ${pendencias.join(' ')} Verifique com o supervisor antes de seguir.`);
        }
        return false;
      }

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Inspeção Concluída', `Sucesso! Carga ${cargaAtual.id} APROVADA na inspeção técnica. Status atualizado para ARMAZENAGEM no pátio.`);
      }
      if (window.NexusAnalytics) window.NexusAnalytics.track('inspecao_aprovada');
      setTimeout(() => { window.location.href = 'cargas.html'; }, 1000);
      return true;
  }

  window.nexusInspecaoAprovar = aprovarCargaAtual;
  if (aprovarBtn) {
    aprovarBtn.addEventListener('click', () => aprovarCargaAtual());
  }

  // Recusar Carga (RN 14 & Item 10: campo obrigatório de motivo de recusa)
  async function recusarCargaAtual(opcoes) {
    if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly(session)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('alerta', 'Modo Somente Leitura (Espectador)', 'O perfil Espectador (MAT-1111) possui acesso exclusivo de visualização e não pode realizar alterações no sistema.');
      }
      return false;
    }
    if (cargaAtual && cargaAtual.status === 'ENTREGUE') {
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Carga Entregue', 'Cargas entregues não podem ter a inspeção alterada.');
      return;
    }
    if (!cargaAtual) return false;

    if (cargaAtual.status === 'CANCELADA' || await cargaCanceladaNoBanco()) {
      avisoCargaCancelada(cargaAtual.id);
      return false;
    }

    // Recusa na gravação: carga em trânsito já saiu do porto — a inspeção
    // (aprovação ou recusa) não pode mais ser registrada (estado local e banco).
    if (cargaAtual.status === 'EM_TRANSITO' || await cargaEmTransitoNoBanco()) {
      avisoCargaEmTransito(cargaAtual.id);
      return false;
    }

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

      cargaAtual.status = 'RECUSADA';
      cargaAtual.resultadoInspecao = 'RECUSADA';
      cargaAtual.motivoRecusa = motivo;
      cargaAtual.motivo_recusa = motivo;

      // Falhas de gravação no Supabase. Se houver alguma, a tela não mostra "registrada".
      const pendencias = [];

      localStorage.setItem('nexus_cargas_fluxo', JSON.stringify(cargas));

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
            if (checklistModeloIdAtual) payloadInspecao.checklist_modelo_id = checklistModeloIdAtual;

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
              const itemRows = [];
              const keys = Object.keys(itemsEstado);
              // Itens sempre limitados ao modelo da inspeção. Quando o modelo não
              // foi resolvido pelo tipo, só grava se houver um único modelo na
              // resposta ou se a lista tiver exatamente os itens do checklist —
              // nunca mistura itens de modelos diferentes.
              let consultaItens = window.nexusSupabase
                .from('checklist_itens')
                .select('id, ordem, checklist_modelo_id');
              if (checklistModeloIdAtual) {
                consultaItens = consultaItens.eq('checklist_modelo_id', checklistModeloIdAtual).order('ordem');
              }
              const { data: dbChecklistItens } = await consultaItens;
              const itensBanco = Array.isArray(dbChecklistItens) ? dbChecklistItens : [];
              let modeloResolvido = checklistModeloIdAtual;
              if (!modeloResolvido) {
                const modelos = [...new Set(itensBanco.map(ci => ci.checklist_modelo_id).filter(Boolean))];
                if (modelos.length === 1) modeloResolvido = modelos[0];
              }
              const listaItens = modeloResolvido
                ? itensBanco.filter(ci => ci.checklist_modelo_id === modeloResolvido)
                : itensBanco;
              if (!modeloResolvido && listaItens.length !== keys.length) {
                pendencias.push('Os itens do checklist não foram gravados: a carga não possui modelo de checklist vinculado no banco.');
              } else {
                for (let idx = 0; idx < keys.length; idx++) {
                  const k = keys[idx];
                  let realItemUuid = isUUID(k) ? k : null;
                  if (!realItemUuid && listaItens.length > 0) {
                    const match = listaItens.find(ci => ci.ordem === idx + 1) || listaItens[idx];
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
        // Sem redirecionamento: o aviso precisa ser lido antes de sair da tela.
        // Retorna false: o banco não confirmou a gravação completa.
        console.warn('[NexusPort] Recusa com pendências de gravação:', pendencias);
        if (window.mostrarFeedback) {
          window.mostrarFeedback('alerta', 'Gravação Incompleta', `Carga ${cargaAtual.id}: ${pendencias.join(' ')} Verifique com o supervisor antes de seguir.`);
        }
        return false;
      }

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Inspeção Registrada', `Carga ${cargaAtual.id} RECUSADA na inspeção técnica. Motivo registrado: "${motivo}". Status mantido em RECUSADA.`);
      }
      if (window.NexusAnalytics) window.NexusAnalytics.track('inspecao_recusada');
      setTimeout(() => { window.location.href = 'cargas.html'; }, 1000);
      return true;
  }

  window.nexusInspecaoRecusar = recusarCargaAtual;
  if (recusarBtn) {
    recusarBtn.addEventListener('click', () => recusarCargaAtual({}));
  }

  // Sincronização viva em tempo real (Item 2 / L-06)
  const ENTIDADES_QUE_AFETAM_INSPECAO = new Set([
    'cargas', 'inspecoes', 'inspecao_itens', 'checklist_modelos', 'checklist_itens',
    'tipos_carga', 'nexus_cargas_fluxo',
    'periodic_sync', 'window_focus', 'visibility_sync', 'online_sync', 'realtime_sync'
  ]);
  window.addEventListener('nexus_data_changed', (event) => {
    const entity = event && event.detail ? event.detail.entity : null;
    if (entity && !ENTIDADES_QUE_AFETAM_INSPECAO.has(entity)) return;
    popularSeletor();
  });
});
