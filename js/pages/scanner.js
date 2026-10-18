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
  const gerarPdfScanBtn = document.getElementById('gerarPdfScanBtn');

  let html5QrCodeScanner = null;
  let targetRedirectUrl = 'cargas.html';
  let targetChecklistUrl = 'inspecao.html';
  let ultimaCargaEscaneada = null;

  function restaurarPlaceholderCamera() {
    const elem = document.getElementById('qrReader');
    if (elem) {
      elem.innerHTML = `
        <div class="p-6 text-center text-slate-300 flex flex-col items-center gap-2">
          <span class="material-symbols-outlined fa-solid fa-camera text-4xl text-slate-400" data-icon="camera_alt" aria-hidden="true"></span>
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
            rawDbId: cDb.id,
            rawDbRow: cDb,
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
      ultimaCargaEscaneada = null;
      if (resultCard) resultCard.classList.add('hidden');
      targetRedirectUrl = 'cargas.html';
      targetChecklistUrl = 'inspecao.html';
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'QR Code Não Localizado', `O código "${rawCode}" não corresponde a nenhuma carga cadastrada. Verifique o código e tente novamente — a leitura não foi registrada.`);
      }
      return {
        encontrado: false,
        codigo_lido: rawCode,
        id: rawCode,
        status: 'NAO_LOCALIZADO',
        acao_sugerida: 'Nenhuma ação disponível: código não cadastrado no sistema.'
      };
    }

    ultimaCargaEscaneada = match;
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
    const statusUpper = String(displayStatus || '').trim().toUpperCase();
    const semChecklist = !['RECEBIMENTO_INSPECAO', 'RECUSADA'].includes(statusUpper);
    targetChecklistUrl = semChecklist
      ? ''
      : `inspecao.html?carga=${displayIdParam}`;
    if (irChecklistBtn) {
      irChecklistBtn.classList.toggle('hidden', semChecklist);
      irChecklistBtn.disabled = semChecklist;
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
    // Tarefa 2: cargas com status ENTREGUE, CANCELADA ou RECUSADA não permitem ir para a tela de ação do cargo.
    const cargo = session.cargo;
    const semAcaoCargo = ['ENTREGUE', 'CANCELADA', 'RECUSADA'].includes(statusUpper);
    let msgAcao = '';

    if (semAcaoCargo) {
      targetRedirectUrl = '';
      if (statusUpper === 'ENTREGUE') {
        msgAcao = 'Carga entregue: não é possível ir para a tela de ação do cargo.';
      } else if (statusUpper === 'CANCELADA') {
        msgAcao = 'Carga cancelada: não é possível ir para a tela de ação do cargo (não retorna ao fluxo normal).';
      } else {
        msgAcao = 'Carga recusada: não é possível ir para a tela de ação do cargo.';
      }
    } else if (cargo === 'ESTIVADOR') {
      msgAcao = 'Redirecionamento para a Ficha de Movimentação no Pátio.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'CONFERENTE_CARGA') {
      msgAcao = 'Redirecionamento para Ficha de Recebimento Físico e Condições de Saída.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
    } else if (cargo === 'INSPETOR' && statusUpper === 'RECEBIMENTO_INSPECAO') {
      msgAcao = 'Redirecionamento para o Checklist Técnico de Inspeção.';
      targetRedirectUrl = `inspecao.html?carga=${displayIdParam}`;
    } else if (cargo === 'INSPETOR') {
      msgAcao = 'Redirecionamento para o Painel Geral de Cargas.';
      targetRedirectUrl = `cargas.html?carga=${displayIdParam}`;
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

    if (executarBtn) {
      executarBtn.classList.toggle('hidden', semAcaoCargo);
      executarBtn.disabled = semAcaoCargo;
    }

    if (gerarPdfScanBtn) {
      const semPdf = entidadeTipoScan !== 'CARGA';
      gerarPdfScanBtn.classList.toggle('hidden', semPdf);
      gerarPdfScanBtn.disabled = semPdf;
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
      if (!['RECEBIMENTO_INSPECAO', 'RECUSADA'].includes(statusAtual) || !targetChecklistUrl) {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Inspeção Indisponível', 'Somente cargas em RECEBIMENTO_INSPECAO ou RECUSADA podem realizar o checklist de inspeção.');
        }
        return;
      }
      window.location.href = targetChecklistUrl;
    });
  }

  if (executarBtn) {
    executarBtn.addEventListener('click', () => {
      const statusAtual = (resStatus && resStatus.textContent || '').trim().toUpperCase();
      if (['ENTREGUE', 'CANCELADA', 'RECUSADA'].includes(statusAtual) || !targetRedirectUrl) {
        if (window.mostrarFeedback) {
          const rotulo = statusAtual === 'ENTREGUE'
            ? 'entregue'
            : (statusAtual === 'CANCELADA' ? 'cancelada' : 'recusada');
          window.mostrarFeedback('atencao', 'Ação do Cargo Indisponível', `A carga está com status ${statusAtual} (${rotulo}) e não permite ir para a tela de ação do cargo.`);
        }
        return;
      }
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

  // Tarefa 3 ("Últimas alterações"): geração do relatório PDF A4 da carga escaneada na página de QR Code.
  const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function formatarCodigoCargaRelatorio(c) {
    if (!c) return 'Não informado';
    const candidato = c.qr_code_url ? String(c.qr_code_url).replace(/^QR-/i, '') : (c.codigo || c.id || '');
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

  function extrairNumeroTexto(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    const limpo = String(val)
      .replace(/[^\d,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }

  function normalizarLinhaDeMatch(m) {
    if (!m) return null;
    if (m.rawDbRow && typeof m.rawDbRow === 'object') {
      return { ...m.rawDbRow };
    }
    const st = String(m.status || m.status_fluxo || 'AGENDAMENTO').toUpperCase();
    return {
      id: m.rawDbId || m.id || '',
      qr_code_url: m.qrCode || m.qr_code_url || (m.id ? `QR-${String(m.id).replace(/^QR-/i, '')}` : ''),
      natureza: m.natureza || m.tipo || null,
      peso: extrairNumeroTexto(m.peso),
      volume: extrairNumeroTexto(m.volume),
      valor_declarado: extrairNumeroTexto(m.valor || m.valor_declarado),
      destino: m.destino || null,
      porto_descarga: m.portoDescarga || m.porto_descarga || null,
      status_fluxo: st,
      resultado_inspecao: m.resultado_inspecao || (st === 'RECUSADA'
        ? 'RECUSADA'
        : (['ARMAZENAGEM', 'PRONTA_PARA_ENTREGA', 'EM_TRANSITO', 'ENTREGUE'].includes(st) ? 'APROVADA' : 'PENDENTE')),
      motivo_recusa: m.motivo_recusa || m.motivoRecusa || null,
      data_entrada: m.data_entrada || m.dataEntrada || m.created_at || null,
      data_saida: m.data_saida || m.dataSaida || null,
      navio_nome_historico: m.navioNomeHistorico || m.navio_nome_historico || m.navio || null,
      container_identificacao_historico: m.containerIdentificacaoHistorico || m.container_identificacao_historico || m.container || null,
      navios: m.navios || null,
      containers: m.containers || null,
      agendamentos: m.agendamentos || []
    };
  }

  async function gerarPdfCargaEscaneadaLocal(cargaId, matchFallback, hashExistente) {
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

    let linha = null;
    if (window.nexusSupabase && cargaId) {
      try {
        let q = window.nexusSupabase.from('cargas').select(selecao);
        if (UUID_CANONICO.test(String(cargaId))) {
          q = q.eq('id', cargaId);
        } else {
          const codSemQr = String(cargaId).replace(/^QR-/i, '');
          q = q.or(`qr_code_url.eq.${codSemQr},qr_code_url.eq.QR-${codSemQr}`);
        }
        const { data: raw, error } = await q.maybeSingle();
        const item = Array.isArray(raw) ? raw[0] : raw;
        if (!error && item) linha = { ...item };
      } catch (e) { /* usa fallback de match abaixo */ }
    }
    if (!linha) {
      linha = normalizarLinhaDeMatch(matchFallback);
    }
    if (!linha) return null;

    if (!linha.containers && (linha.container_identificacao_historico || (matchFallback && matchFallback.container))) {
      const ident = String(linha.container_identificacao_historico || (matchFallback && matchFallback.container) || '').trim();
      if (ident && window.nexusSupabase) {
        try {
          const { data: contRaw } = await window.nexusSupabase
            .from('containers')
            .select(selecaoContainer)
            .eq('numero_identificacao', ident)
            .maybeSingle();
          const contDb = Array.isArray(contRaw) ? contRaw[0] : contRaw;
          if (contDb) linha.containers = contDb;
        } catch (e) { /* fallback local abaixo */ }
      }
      if (ident && !linha.containers) {
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

    const navioDoCont = linha.containers && linha.containers.navios;
    if (!linha.navios && !navioDoCont && (linha.navio_nome_historico || (matchFallback && matchFallback.navio))) {
      const nomeNavio = String(linha.navio_nome_historico || (matchFallback && matchFallback.navio) || '').trim();
      if (nomeNavio && window.nexusSupabase) {
        try {
          const { data: navioRaw } = await window.nexusSupabase
            .from('navios')
            .select(selecaoNavio)
            .eq('nome', nomeNavio)
            .maybeSingle();
          const navioDb = Array.isArray(navioRaw) ? navioRaw[0] : navioRaw;
          if (navioDb) linha.navios = navioDb;
        } catch (e) { /* fallback local abaixo */ }
      }
      if (nomeNavio && !linha.navios) {
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
    cmds.push(`BT /F1 7 Tf 0.392 0.455 0.545 rg 40 34 Td (${escaparPdfWinAnsi(`Conteúdo SHA-256: ${hashExistente || cargaId || codigoCarga}`)}) Tj ET`);
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

  async function gerarRelatorioPdfCargaEscaneada() {
    if (!ultimaCargaEscaneada || String(ultimaCargaEscaneada.id || '').startsWith('CONT')) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Carga Necessária', 'Escaneie uma carga antes de gerar o relatório PDF A4.');
      }
      return false;
    }

    const displayId = ultimaCargaEscaneada.id;
    let cargaId = ultimaCargaEscaneada.rawDbId || '';
    if (!UUID_CANONICO.test(String(cargaId)) && window.nexusSupabase) {
      try {
        const codSemQr = String(displayId).replace(/^QR-/i, '');
        const { data: cDb } = await window.nexusSupabase
          .from('cargas')
          .select('id, qr_code_url')
          .or(`qr_code_url.eq.${codSemQr},qr_code_url.eq.QR-${codSemQr}`)
          .maybeSingle();
        const item = Array.isArray(cDb) ? cDb[0] : cDb;
        if (item && item.id) {
          cargaId = item.id;
          ultimaCargaEscaneada.rawDbId = item.id;
        }
      } catch (e) { /* segue com geração local */ }
    }

    const config = window.NEXUS_CONFIG || {};
    const urlBase = config.SUPABASE_URL || '';
    const chave = config.SUPABASE_ANON_KEY || '';
    const codigo = session && session.codigo_individual;

    let arquivo = null;
    let hash = null;
    let cache = 'MISS';

    if (window.nexusSupabase && urlBase && chave && codigo && UUID_CANONICO.test(String(cargaId))) {
      try {
        const resposta = await fetch(`${urlBase}/functions/v1/relatorio-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: `Bearer ${chave}` },
          body: JSON.stringify({ carga_id: cargaId, codigo_individual: codigo })
        });
        if (resposta && resposta.ok) {
          arquivo = await resposta.blob();
          hash = resposta.headers.get('X-Relatorio-Hash') || null;
          cache = resposta.headers.get('X-Relatorio-Cache') || 'MISS';
          const versaoServidor = resposta.headers.get('X-Relatorio-Versao') || '';
          if (arquivo && arquivo.size > 100 && versaoServidor !== '3') {
            const blobAtualizado = await gerarPdfCargaEscaneadaLocal(cargaId, ultimaCargaEscaneada, hash || '');
            if (blobAtualizado) arquivo = blobAtualizado;
          }
        }
      } catch (e) {
        console.warn('Fallback para geração local do PDF no scanner:', e);
      }
    }

    if (!arquivo) {
      try {
        arquivo = await gerarPdfCargaEscaneadaLocal(cargaId || displayId, ultimaCargaEscaneada, hash || '');
      } catch (e) {
        console.warn('Erro ao montar PDF local da carga escaneada:', e);
      }
    }

    if (!arquivo) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'PDF não emitido', 'Não foi possível gerar o relatório PDF A4 da carga escaneada.');
      }
      return false;
    }

    const idArquivo = cargaId || displayId;
    baixarArquivo(arquivo, `Relatorio_A4_${idArquivo}.pdf`);

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao(displayId, 'EXPORTACAO', {
        tipo_exportacao: 'PDF_A4',
        carga_id: idArquivo,
        hash_conteudo: hash,
        exportado_por_codigo: codigo || '--'
      });
    }
    if (window.NexusAnalytics) {
      window.NexusAnalytics.track('gerar_pdf', { origem: 'scanner', cache: cache === 'HIT' ? 'hit' : 'miss' });
    }
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'PDF Emitido', `Relatório PDF A4 da carga ${displayId} gerado e baixado.`);
    }
    return true;
  }

  window.nexusScannerGerarPdf = gerarRelatorioPdfCargaEscaneada;

  if (gerarPdfScanBtn) {
    gerarPdfScanBtn.addEventListener('click', async () => {
      gerarPdfScanBtn.disabled = true;
      try {
        await gerarRelatorioPdfCargaEscaneada();
      } finally {
        const semPdf = !ultimaCargaEscaneada || String(ultimaCargaEscaneada.id || '').startsWith('CONT');
        gerarPdfScanBtn.disabled = semPdf;
      }
    });
  }
});
