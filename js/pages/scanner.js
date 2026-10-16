/**
 * Lógica do Módulo Scanner QR Code (scanner.html) - NexusPort
 * Integra leitura via câmera (html5-qrcode) ou simulação e redireciona
 * para a ação específica do cargo do usuário logado (RF 17.3 / RN 19 / T5.7 / T5.8).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  const iniciarCameraBtn = document.getElementById('iniciarCameraBtn');
  const stopScannerBtn = document.getElementById('stopScannerBtn');
  const simulatedInput = document.getElementById('simulatedQrInput');
  const simulateBtn = document.getElementById('simulateScanBtn');

  const resultCard = document.getElementById('qrResultCard');
  const resultCodeTag = document.getElementById('resultCodeTag');
  const resEntityId = document.getElementById('resEntityId');
  const resTipo = document.getElementById('resTipo');
  const resNatureza = document.getElementById('resNatureza');
  const resPeso = document.getElementById('resPeso');
  const resValor = document.getElementById('resValor');
  const resPorto = document.getElementById('resPorto');
  const resDestino = document.getElementById('resDestino');
  const resContainer = document.getElementById('resContainer');
  const resNavio = document.getElementById('resNavio');
  const resStatus = document.getElementById('resStatus');
  const resRoleTitle = document.getElementById('resRoleTitle');
  const resRoleMsg = document.getElementById('resRoleMsg');
  const executarBtn = document.getElementById('executarAcaoScanBtn');
  const irChecklistBtn = document.getElementById('irChecklistBtn');

  let html5QrCodeScanner = null;
  let targetRedirectUrl = 'cargas.html';
  let targetChecklistUrl = 'inspecao.html';

  function restaurarPlaceholderCamera() {
    const elem = document.getElementById('qrReader');
    if (elem) {
      elem.innerHTML = `
        <div class="p-6 text-center text-slate-300 flex flex-col items-center gap-2">
          <span class="material-symbols-outlined text-4xl text-slate-400">camera_alt</span>
          <span>Clique no botão acima para iniciar a câmera do dispositivo móvel.</span>
        </div>
      `;
    }
    if (stopScannerBtn) stopScannerBtn.classList.add('hidden');
    if (iniciarCameraBtn) iniciarCameraBtn.classList.remove('hidden');
  }

  async function pararCamera() {
    if (html5QrCodeScanner) {
      try {
        await html5QrCodeScanner.stop();
      } catch (e) {}
      try {
        if (typeof html5QrCodeScanner.clear === 'function') html5QrCodeScanner.clear();
      } catch (e) {}
      html5QrCodeScanner = null;
    }
    restaurarPlaceholderCamera();
  }

  if (iniciarCameraBtn) {
    iniciarCameraBtn.addEventListener('click', () => {
      iniciarCamera();
    });
  }

  if (stopScannerBtn) {
    stopScannerBtn.addEventListener('click', () => {
      pararCamera();
    });
  }

  async function iniciarCamera() {
    // A biblioteca de leitura é local (vendor/) e só é baixada ao ligar a câmera (js/asset-loader.js).
    const disponivel = window.NexusAssets
      ? await window.NexusAssets.carregar('html5-qrcode')
      : typeof Html5Qrcode !== 'undefined';
    if (disponivel && typeof Html5Qrcode !== 'undefined') {
      const elem = document.getElementById('qrReader');
      if (elem) elem.innerHTML = '';

      // Área de leitura quadrada (1:1) proporcional ao tamanho do preview —
      // garante enquadramento correto tanto no desktop quanto no celular.
      const ladoPreview = (elem && elem.clientWidth) ? elem.clientWidth : 260;
      const ladoLeitura = Math.max(160, Math.min(240, Math.round(ladoPreview * 0.8)));

      html5QrCodeScanner = new Html5Qrcode("qrReader");
      html5QrCodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: ladoLeitura, height: ladoLeitura } },
        (decodedText) => {
          processarScan(decodedText);
          pararCamera();
        },
        () => {}
      ).then(() => {
        if (iniciarCameraBtn) iniciarCameraBtn.classList.add('hidden');
        if (stopScannerBtn) stopScannerBtn.classList.remove('hidden');
      }).catch(err => {
        console.warn("Câmera indisponível ou permissão negada:", err);
        restaurarPlaceholderCamera();
        if (window.mostrarFeedback) window.mostrarFeedback('info', 'Câmera Indisponível', "Câmera indisponível. Utilize o campo de simulação manual abaixo para testar a leitura de QR Code.");
      });
    }
  }

  if (simulateBtn && simulatedInput) {
    simulateBtn.addEventListener('click', async () => {
      const val = simulatedInput.value.trim();
      if (!val) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campo Obrigatório', 'Informe o texto do QR Code para simular.');
        return;
      }
      const resultado = await processarScan(val);
      // Só limpa o campo após uma leitura válida: código não localizado fica
      // visível para o operador corrigir a digitação e tentar de novo.
      if (resultado && resultado.encontrado) simulatedInput.value = '';
    });
  }

  async function processarScan(qrCodeText) {
    let rawCode = String(qrCodeText || '').trim();
    if (!rawCode) {
      if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campo Obrigatório', 'Informe o texto do QR Code para simular.');
      return { encontrado: false, codigo_lido: '', status: 'NAO_LOCALIZADO' };
    }
    if (rawCode.includes('?scan=') || rawCode.includes('?qr=')) {
      try {
        const url = new URL(rawCode, window.location.origin);
        rawCode = url.searchParams.get('scan') || url.searchParams.get('qr') || rawCode;
      } catch (e) {}
    }

    let match = null;
    if (window.nexusSupabase) {
      try {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCode);
        let q = window.nexusSupabase.from('cargas').select('*, navios(id, nome), containers(id, numero_identificacao)');
        if (isUuid) {
          q = q.or(`id.eq.${rawCode},qr_code_url.eq.${rawCode},qr_code_url.eq.QR-${rawCode}`);
        } else {
          q = q.or(`qr_code_url.eq.${rawCode},qr_code_url.eq.QR-${rawCode}`);
        }
        const { data: cDb } = await q.maybeSingle();

        if (cDb) {
          match = {
            id: cDb.qr_code_url ? cDb.qr_code_url.replace('QR-', '') : `CRG-${cDb.id}`,
            tipo: cDb.natureza || 'Carga Geral',
            natureza: cDb.natureza || 'Geral',
            peso: `${cDb.peso || 0} t`,
            volume: `${cDb.volume || 0} m³`,
            valor: `R$ ${(cDb.valor_declarado || 0).toLocaleString('pt-BR')}`,
            portoDescarga: cDb.porto_descarga || 'Terminal STS-01',
            destino: cDb.destino || 'Destino Geral',
            status: cDb.status_fluxo || 'AGENDAMENTO',
            container: cDb.containers ? cDb.containers.numero_identificacao : (cDb.container_id || ''),
            navio: cDb.navios ? cDb.navios.nome : '',
            containerIdentificacaoHistorico: cDb.container_identificacao_historico || '',
            navioNomeHistorico: cDb.navio_nome_historico || ''
          };
        } else if (rawCode.toUpperCase().includes('CONT') || rawCode.toUpperCase().includes('GND')) {
          const { data: contDb } = await window.nexusSupabase.from('containers').select('*').or(`numero_identificacao.eq.${rawCode},numero_identificacao.eq.${rawCode.replace('CONT-', '')}`).maybeSingle();
          if (contDb) {
            match = {
              id: contDb.numero_identificacao,
              tipo: contDb.material_carregado || 'Contêiner Padrão',
              natureza: `Status: ${contDb.estado || 'OPERANTE'}`,
              peso: `${contDb.capacidade_peso || 30} t`,
              volume: `${contDb.capacidade_volume || 75} m³`,
              valor: 'Ativo Operacional',
              portoDescarga: 'Pátio STS-01',
              destino: 'Pátio / Berço',
              status: contDb.estado || 'OPERANTE',
              container: contDb.numero_identificacao,
              navio: ''
            };
          }
        }
      } catch (err) { console.warn('Erro ao consultar scanner no Supabase:', err); }
    }

    const localCargas = JSON.parse(localStorage.getItem('nexus_cargas_fluxo') || '[]');
    const localCanceladas = JSON.parse(localStorage.getItem('nexus_cargas_canceladas') || '[]');
    if (!match) {
      match = localCargas.find(c => c.id === rawCode || c.qrCode === rawCode || c.id === rawCode.replace('QR-', ''));
    }
    if (!match) {
      match = localCanceladas.find(c => c.id === rawCode || c.qrCode === rawCode || c.id === rawCode.replace('QR-', ''));
    } else if (match && match.status !== 'CANCELADA' && localCanceladas.some(c => c.id === match.id || c.qrCode === rawCode)) {
      match = { ...match, status: 'CANCELADA' };
    }

    // Tarefa 3 (Backlog Parte 2): leitura bem-sucedida SÓ para código válido/
    // existente (banco ou cache). Qualquer outro texto — inclusive na
    // simulação manual — é leitura não realizada: sem cartão de resultado,
    // sem registro em leituras_qr_code/auditoria e sem redirecionamento.
    // Vale para câmera e simulação, pois os dois caminhos usam processarScan.
    if (!match) {
      if (resultCard) resultCard.classList.add('hidden');
      targetRedirectUrl = 'cargas.html';
      targetChecklistUrl = 'inspecao.html';
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'QR Code Não Localizado', `O código "${rawCode}" não corresponde a nenhuma carga ou contêiner cadastrado. Verifique o código e tente novamente — a leitura não foi registrada.`);
      }
      return {
        encontrado: false,
        codigo_lido: rawCode,
        id: rawCode,
        status: 'NAO_LOCALIZADO',
        acao_sugerida: 'Nenhuma ação disponível: código não cadastrado no sistema.'
      };
    }

    if (window.NexusAnalytics) window.NexusAnalytics.track('qr_lido');

    const displayId = match ? match.id : rawCode;
    const displayTipo = match ? match.tipo : 'Não identificado';
    const displayNatureza = match ? (match.natureza || 'Geral') : 'Não informada';
    const displayPeso = match ? `${match.peso || '--'} / ${match.volume || '--'}` : '-- / --';
    const displayValor = match ? (match.valor || 'R$ 0,00') : 'R$ 0,00';
    const displayPorto = match ? (match.portoDescarga || 'Não informado') : 'Não informado';
    const displayDestino = match ? (match.destino || 'Não informado') : 'Não informado';
    const displayStatus = match ? (match.status || 'NÃO_LOCALIZADO') : 'NÃO_LOCALIZADO';
    const containerHistorico = match
      ? (match.containerIdentificacaoHistorico || match.container_identificacao_historico || match.containerHistorico || '')
      : '';
    const navioHistorico = match
      ? (match.navioNomeHistorico || match.navio_nome_historico || match.navioHistorico || '')
      : '';
    const displayContainer = match
      ? (match.container || (displayStatus === 'ENTREGUE' && containerHistorico ? `${containerHistorico} (histórico)` : 'Não vinculado'))
      : 'Não vinculado';
    const displayNavio = match
      ? (match.navio || (displayStatus === 'ENTREGUE' && navioHistorico ? `${navioHistorico} (histórico)` : 'Não vinculado'))
      : 'Não vinculado';

    const displayIdParam = encodeURIComponent(String(displayId));
    const semChecklist = displayStatus === 'ENTREGUE' || displayStatus === 'CANCELADA';
    targetChecklistUrl = semChecklist
      ? `cargas.html?carga=${displayIdParam}`
      : `inspecao.html?carga=${displayIdParam}`;
    if (irChecklistBtn) {
      irChecklistBtn.classList.toggle('hidden', semChecklist);
    }

    // Grava log de leitura QR Code no pátio (T5.8 & Supabase leituras_qr_code)
    const isSomenteLeitura = !!(window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly(session));
    const nowIso = new Date().toISOString();
    const entidadeTipoScan = displayId.startsWith('CONT') ? 'CONTAINER' : 'CARGA';
    if (!isSomenteLeitura) {
      const logs = JSON.parse(localStorage.getItem('nexus_audit_logs') || '[]');
      logs.unshift({
        data_hora: nowIso,
        cargo: session.cargo_nome || session.cargo,
        codigo_usuario: session.codigo_individual || session.codigo,
        entidade: displayId,
        entidade_tipo: entidadeTipoScan,
        entidade_id: displayId,
        tipo_alteracao: 'Leitura QR Code no Pátio (Scan)',
        descricao: `Leitura QR Code no Pátio (${displayId})`
      });
      localStorage.setItem('nexus_audit_logs', JSON.stringify(logs));
    }

    if (!isSomenteLeitura && window.nexusSupabase) {
      try {
        const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
        let funcId = isUuid(session.id) ? session.id : null;
        if (!funcId) {
          const list = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
          const match = list.find(f => f.codigo_individual === session.codigo_individual || f.matricula === session.matricula);
          if (match && isUuid(match.id)) funcId = match.id;
        }

        const leituraPayload = {
          entidade_tipo: entidadeTipoScan,
          entidade_id: displayId,
          data_hora: nowIso
        };
        if (funcId) leituraPayload.funcionario_id = funcId;

        const { error: errL } = await window.nexusSupabase.from('leituras_qr_code').insert(leituraPayload);
        if (errL && leituraPayload.funcionario_id) {
          delete leituraPayload.funcionario_id;
          await window.nexusSupabase.from('leituras_qr_code').insert(leituraPayload);
        }

        const logPayload = {
          data_hora: nowIso,
          cargo: session.cargo || 'ESTIVADOR',
          codigo_individual: session.codigo_individual || session.codigo || '--',
          entidade_tipo: entidadeTipoScan,
          entidade_id: displayId,
          tipo_alteracao: 'REIMPRESSAO_ETIQUETA',
          detalhes: { acao: 'Leitura QR Code no Pátio', descricao: `Leitura QR Code no Pátio (${displayId})` }
        };
        if (funcId) logPayload.funcionario_id = funcId;

        const { error: errLog } = await window.nexusSupabase.from('logs_alteracoes').insert(logPayload);
        if (errLog && logPayload.funcionario_id) {
          delete logPayload.funcionario_id;
          await window.nexusSupabase.from('logs_alteracoes').insert(logPayload);
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao registrar leitura QR Code no Supabase:', err);
      }
    }

    // Define direcionamento por cargo (T5.7)
    const cargo = session.cargo;
    let msgAcao = '';

    if (cargo === 'ESTIVADOR') {
      msgAcao = 'Redirecionamento para a Ficha de Movimentação no Pátio.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'CONFERENTE_CARGA') {
      msgAcao = 'Redirecionamento para Ficha de Recebimento Físico e Condições de Saída.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'INSPETOR' && displayStatus === 'ENTREGUE') {
      // Carga entregue não tem mais inspeção: o inspetor vê a ficha da carga, sem checklist.
      msgAcao = 'Carga entregue: inspeção não disponível. Redirecionamento para a ficha da carga.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'INSPETOR' && displayStatus === 'CANCELADA') {
      // Carga cancelada não possui checklist nem retorna ao fluxo normal.
      msgAcao = 'Carga cancelada: inspeção não disponível (não retorna ao fluxo normal). Redirecionamento para a ficha da carga.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'INSPETOR') {
      msgAcao = 'Redirecionamento para o Checklist Técnico de Inspeção.';
      targetRedirectUrl = `inspecao.html?carga=${displayIdParam}`;
    } else if (cargo === 'ARRUMADOR_CONSERTADOR') {
      msgAcao = 'Redirecionamento para Alteração do Status "Pronta para Entrega".';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'SUPERVISOR_GERENTE_OPERACOES') {
      msgAcao = 'Redirecionamento para o Painel de Cargas Vinculadas do Contêiner.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else {
      msgAcao = 'Redirecionamento para o Painel Geral de Cargas.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    }

    if (resultCodeTag) resultCodeTag.textContent = `Código Lido: ${rawCode}`;
    if (resEntityId) resEntityId.textContent = displayId;
    if (resTipo) resTipo.textContent = displayTipo;
    if (resNatureza) resNatureza.textContent = displayNatureza;
    if (resPeso) resPeso.textContent = displayPeso;
    if (resValor) resValor.textContent = displayValor;
    if (resPorto) resPorto.textContent = displayPorto;
    if (resDestino) resDestino.textContent = displayDestino;
    if (resContainer) resContainer.textContent = displayContainer;
    if (resNavio) resNavio.textContent = displayNavio;
    if (resStatus) resStatus.textContent = displayStatus;
    if (resRoleTitle) resRoleTitle.textContent = `Direcionamento para ${session.cargo_nome || session.cargo}:`;
    if (resRoleMsg) resRoleMsg.textContent = msgAcao;

    if (resultCard) resultCard.classList.remove('hidden');
    // Resultado estruturado (usado pelo agente WebMCP; a interface não depende do retorno).
    return {
      encontrado: Boolean(match),
      codigo_lido: rawCode,
      id: displayId,
      tipo: displayTipo,
      natureza: displayNatureza,
      peso_volume: displayPeso,
      porto_descarga: displayPorto,
      destino: displayDestino,
      container: displayContainer,
      navio: displayNavio,
      container_historico: containerHistorico || null,
      navio_historico: navioHistorico || null,
      status: displayStatus,
      acao_sugerida: msgAcao
    };
  }
  window.nexusScannerProcessar = processarScan;

  if (irChecklistBtn) {
    irChecklistBtn.addEventListener('click', () => {
      const statusAtual = (resStatus && resStatus.textContent || '').trim().toUpperCase();
      if (statusAtual === 'CANCELADA') {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Carga Cancelada', 'Esta carga foi cancelada e não pode realizar ou refazer o checklist de inspeção.');
        }
        return;
      }
      if (statusAtual === 'ENTREGUE') {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Carga Entregue', 'Esta carga já foi entregue e não pode mais ser inspecionada.');
        }
        return;
      }
      window.location.href = targetChecklistUrl;
    });
  }

  if (executarBtn) {
    executarBtn.addEventListener('click', () => {
      window.location.href = targetRedirectUrl;
    });
  }

  // Backlog 3 (7i): impressão da etiqueta da carga identificada no scan.
  // O CSS @media print da página isola o cartão de resultado no papel.
  const imprimirEtiquetaBtn = document.getElementById('imprimirEtiquetaScanBtn');
  if (imprimirEtiquetaBtn) {
    imprimirEtiquetaBtn.addEventListener('click', () => {
      const codeTag = document.getElementById('resultCodeTag');
      if (codeTag && codeTag.textContent && codeTag.textContent !== '--') {
        if (window.registrarLogAlteracao) {
          window.registrarLogAlteracao('REIMPRESSAO_ETIQUETA', 'cargas', null, `Reimpressão de etiqueta via Scanner para ${codeTag.textContent}`);
        }
      }
      window.print();
    });
  }
});
