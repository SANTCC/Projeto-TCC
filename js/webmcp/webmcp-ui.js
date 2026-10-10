/**
 * WebMCP — interface do operador (js/webmcp/webmcp-ui.js) — NexusPort
 *
 * Dois componentes, ambos construídos com DOM API (sem innerHTML com dados externos):
 *   1. Diálogo de confirmação humana para ações consequentes solicitadas por agentes.
 *      - Padrão: CANCELAR (foco inicial no cancelar, Esc cancela, fechar por fundo cancela).
 *      - "Confirmar" só funciona com clique/toque/tecla REAIS (event.isTrusted) e só
 *        depois de um intervalo mínimo — scripts não conseguem confirmar sozinhos.
 *      - Expira sozinho (padrão 60 s) e cancela se a chamada do agente for abortada.
 *      - Não reutiliza nexusConfirm (js/layout.js), que confirma automaticamente em
 *        navegadores headless: aqui não há confirmação automática.
 *   2. Painel "Agentes IA": estado da API, chave de desligamento por navegador,
 *      ferramentas disponíveis nesta página (com motivo de bloqueio) e atividade recente.
 *
 * Carregamento: depois de js/webmcp/webmcp-core.js.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  if (!W) return;

  const PRAZO_PADRAO_MS = 60000;
  const ATRASO_CONFIRMACAO_MS = 1500;
  const ROTULO_MODO = {
    nativo: 'API nativa do navegador (document.modelContext)',
    legado: 'API legada do navegador (navigator.modelContext)',
    polyfill: 'Polyfill do NexusPort (o navegador não oferece WebMCP)',
    indisponivel: 'Indisponível: a página precisa de HTTPS ou de um contexto seguro'
  };
  const ROTULO_ANOTACAO = {
    readOnlyHint: 'Somente leitura',
    consequentialHint: 'Pede sua confirmação',
    untrustedContentHint: 'Dados não confiáveis',
    debugging: 'Diagnóstico'
  };

  let dialogoAtivo = false;
  let painelAberto = false;

  function criar(tag, atributos, filhos) {
    const el = document.createElement(tag);
    Object.keys(atributos || {}).forEach((chave) => {
      if (chave === 'class') el.className = atributos[chave];
      else if (chave === 'text') el.textContent = atributos[chave];
      else el.setAttribute(chave, atributos[chave]);
    });
    (filhos || []).forEach((f) => { if (f) el.appendChild(f); });
    return el;
  }

  function txt(valor) {
    return document.createTextNode(valor === undefined || valor === null ? '' : String(valor));
  }

  function paginaAtual() {
    return (window.location.pathname.split('/').pop() || 'dashboard.html');
  }

  // ------------------------------------------------------------------
  // Estilos (classes próprias; compatíveis com o modo escuro do projeto)
  // ------------------------------------------------------------------
  const CSS = `
.nxm-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,.6);backdrop-filter:blur(3px);font-family:Inter,system-ui,sans-serif}
.nxm-caixa{width:min(560px,100%);max-height:90vh;overflow:auto;border-radius:1rem;background:#fff;color:#0f172a;box-shadow:0 25px 50px -12px rgba(0,0,0,.35);border:1px solid #e2e8f0;padding:1.25rem}
.nxm-badge{display:inline-block;font:700 10px/1 monospace;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .5rem;border-radius:.375rem;background:#e0e7ff;color:#3730a3}
.nxm-caixa h2{margin:.6rem 0 .25rem;font-size:1.05rem;font-weight:700}
.nxm-caixa p{margin:.35rem 0;font-size:.8rem;line-height:1.45}
.nxm-caixa code{font:600 11px monospace;background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem}
.nxm-caixa ul,.nxm-caixa ol{margin:.4rem 0;padding-left:1.1rem;font-size:.78rem}
.nxm-caixa dl{display:grid;grid-template-columns:auto 1fr;gap:.2rem .6rem;font-size:.78rem;margin:.5rem 0}
.nxm-caixa dt{font-weight:700;color:#334155}
.nxm-caixa dd{margin:0;word-break:break-word}
.nxm-aviso{background:#fffbeb;border:1px solid #fde68a;border-radius:.5rem;padding:.5rem .6rem;color:#78350f}
.nxm-acoes{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem;flex-wrap:wrap}
.nxm-btn{font:700 12px/1 Inter,system-ui,sans-serif;padding:.6rem .9rem;border-radius:.6rem;border:1px solid #cbd5e1;background:#f1f5f9;color:#0f172a;cursor:pointer}
.nxm-btn:focus-visible{outline:3px solid #6366f1;outline-offset:2px}
.nxm-btn-primario{background:#4338ca;border-color:#4338ca;color:#fff}
.nxm-btn[disabled]{opacity:.45;cursor:not-allowed}
.nxm-contador{font:600 11px monospace;color:#64748b}
#nxmBotao{position:fixed;right:1rem;bottom:1rem;z-index:35;display:inline-flex;align-items:center;gap:.4rem;padding:.55rem .8rem;border-radius:999px;border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;font:700 12px/1 Inter,system-ui,sans-serif;box-shadow:0 6px 18px rgba(15,23,42,.18);cursor:pointer}
#nxmBotao:focus-visible{outline:3px solid #6366f1;outline-offset:2px}
#nxmBotao .nxm-n{background:#4338ca;color:#fff;border-radius:999px;padding:.1rem .4rem;font-size:10px}
#nxmPainel{position:fixed;right:1rem;bottom:4.25rem;z-index:36;width:min(380px,calc(100vw - 2rem));max-height:70vh;overflow:auto;border-radius:1rem;background:#fff;color:#0f172a;border:1px solid #e2e8f0;box-shadow:0 20px 40px -12px rgba(15,23,42,.35);padding:1rem;font-family:Inter,system-ui,sans-serif}
#nxmPainel[hidden]{display:none}
#nxmPainel h2{font-size:.95rem;margin:0 0 .35rem;font-weight:700}
#nxmPainel h3{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#475569;margin:.9rem 0 .3rem}
#nxmPainel p,#nxmPainel li{font-size:.75rem;line-height:1.4}
#nxmPainel ul,#nxmPainel ol{list-style:none;padding:0;margin:0}
#nxmPainel li{border-top:1px solid #f1f5f9;padding:.4rem 0}
#nxmPainel .nxm-tag{display:inline-block;font:600 9px/1 monospace;padding:.2rem .35rem;border-radius:.3rem;background:#f1f5f9;color:#334155;margin:.15rem .15rem 0 0}
#nxmPainel .nxm-bloq{color:#b45309}
#nxmPainel .nxm-livre{color:#047857}
.nxm-switch{display:flex;align-items:center;gap:.5rem;font-size:.78rem;font-weight:600;margin-top:.5rem}
html.dark .nxm-caixa,html.dark #nxmPainel{background:#0f172a;color:#e2e8f0;border-color:#1e293b}
html.dark .nxm-caixa code{background:#1e293b}
html.dark .nxm-caixa dt{color:#cbd5e1}
html.dark .nxm-aviso{background:#422006;border-color:#854d0e;color:#fde68a}
html.dark .nxm-btn{background:#1e293b;color:#e2e8f0;border-color:#334155}
html.dark #nxmPainel li{border-color:#1e293b}
html.dark #nxmPainel .nxm-tag{background:#1e293b;color:#cbd5e1}
html.dark #nxmBotao{background:#1e1b4b;color:#c7d2fe;border-color:#3730a3}
`;

  function instalarEstilos() {
    if (document.getElementById('nexusWebmcpEstilo')) return;
    const style = criar('style', { id: 'nexusWebmcpEstilo' });
    style.appendChild(txt(CSS));
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // Diálogo de confirmação
  // ------------------------------------------------------------------
  /**
   * Pede confirmação humana. Resolve true somente após clique/tecla real em "Confirmar ação".
   * @param {Object} pedido - { ferramenta:{nome,titulo,descricao,dadosNaoConfiaveis}, pagina, argumentos:[{rotulo,valor}], resumo:[], prazoMs, signal }
   * @returns {Promise<boolean>}
   */
  function confirmar(pedido) {
    if (dialogoAtivo) return Promise.resolve(false);
    dialogoAtivo = true;
    instalarEstilos();
    const pedidoSeguro = pedido || {};
    const ferramenta = pedidoSeguro.ferramenta || {};
    const prazo = Number.isFinite(pedidoSeguro.prazoMs) ? pedidoSeguro.prazoMs : PRAZO_PADRAO_MS;

    return new Promise((resolve) => {
      const focoAnterior = document.activeElement;
      let finalizado = false;
      let restante = Math.max(1, Math.round(prazo / 1000));
      let relogio = null;
      let habilitacao = null;

      const contador = criar('p', { class: 'nxm-contador', 'aria-live': 'off', id: 'nxmConfContador' },
        [txt(`Cancelamento automático em ${restante} s.`)]);
      const cancelar = criar('button', { type: 'button', class: 'nxm-btn', id: 'nxmConfCancelar' }, [txt('Cancelar')]);
      const confirmarBtn = criar('button', {
        type: 'button', class: 'nxm-btn nxm-btn-primario', id: 'nxmConfConfirmar', disabled: 'disabled'
      }, [txt('Confirmar ação')]);

      const titulo = criar('h2', { id: 'nxmConfTitulo', text: ferramenta.titulo || 'Confirmar ação' });
      const descricao = criar('p', { id: 'nxmConfDescricao', text: `Um agente de IA solicitou esta ação na página ${pedidoSeguro.pagina || 'atual'}. Confirme somente se você a solicitou.` });

      const blocoFerramenta = criar('p', null, [txt('Ferramenta: '), criar('code', { text: ferramenta.nome || '' })]);
      const listaResumo = criar('ul', null, (pedidoSeguro.resumo || []).map((linha) => criar('li', { text: linha })));
      const listaArgumentos = criar('dl', null, [].concat(...(pedidoSeguro.argumentos || []).map((a) => [
        criar('dt', { text: a.rotulo }),
        criar('dd', { text: a.valor })
      ])));
      const avisos = [
        criar('p', { class: 'nxm-aviso' }, [txt('Esta ação altera dados do sistema e fica registrada na trilha com a marca do agente de IA.')])
      ];
      if (ferramenta.dadosNaoConfiaveis) {
        avisos.push(criar('p', { class: 'nxm-aviso' }, [txt('Esta ação usa dados de origem não confiável. Confira os valores antes de confirmar.')]));
      }

      const acoes = criar('div', { class: 'nxm-acoes' }, [cancelar, confirmarBtn]);
      const caixa = criar('div', {
        class: 'nxm-caixa', role: 'alertdialog', 'aria-modal': 'true',
        'aria-labelledby': 'nxmConfTitulo', 'aria-describedby': 'nxmConfDescricao'
      }, [
        criar('span', { class: 'nxm-badge', text: 'Agente de IA' }),
        titulo,
        descricao,
        blocoFerramenta,
        listaResumo,
        listaArgumentos,
        ...avisos,
        contador,
        acoes
      ]);
      const overlay = criar('div', { class: 'nxm-overlay', id: 'nxmConfirmacao' }, [caixa]);

      function finalizar(valor) {
        if (finalizado) return;
        finalizado = true;
        if (relogio) clearInterval(relogio);
        if (habilitacao) clearTimeout(habilitacao);
        document.removeEventListener('keydown', aoTecla, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        dialogoAtivo = false;
        if (focoAnterior && typeof focoAnterior.focus === 'function') {
          try { focoAnterior.focus(); } catch (e) { /* elemento removido */ }
        }
        resolve(valor === true);
      }

      function aoConfirmar(evento) {
        // Somente interação real do operador; eventos sintéticos (script) são ignorados.
        if (!evento || evento.isTrusted !== true) return;
        finalizar(true);
      }

      function aoTecla(evento) {
        if (evento.key === 'Escape') {
          evento.preventDefault();
          finalizar(false);
          return;
        }
        if (evento.key === 'Tab') {
          const ordem = [cancelar, confirmarBtn];
          const i = ordem.indexOf(document.activeElement);
          const proximo = evento.shiftKey ? (i <= 0 ? ordem[1] : ordem[i - 1]) : (i === -1 || i === ordem.length - 1 ? ordem[0] : ordem[i + 1]);
          evento.preventDefault();
          if (proximo.disabled) cancelar.focus(); else proximo.focus();
        }
      }

      relogio = setInterval(() => {
        restante -= 1;
        if (restante <= 0) {
          finalizar(false);
          return;
        }
        contador.textContent = `Cancelamento automático em ${restante} s.`;
      }, 1000);
      habilitacao = setTimeout(() => { confirmarBtn.disabled = false; }, ATRASO_CONFIRMACAO_MS);

      cancelar.addEventListener('click', () => finalizar(false));
      confirmarBtn.addEventListener('click', aoConfirmar);
      overlay.addEventListener('click', (evento) => { if (evento.target === overlay) finalizar(false); });
      document.addEventListener('keydown', aoTecla, true);
      document.body.appendChild(overlay);
      cancelar.focus();

      if (pedidoSeguro.signal) {
        if (pedidoSeguro.signal.aborted) finalizar(false);
        else pedidoSeguro.signal.addEventListener('abort', () => finalizar(false), { once: true });
      }
    });
  }

  // ------------------------------------------------------------------
  // Painel "Agentes IA"
  // ------------------------------------------------------------------
  let refs = null;

  function renderPainel() {
    if (!refs) return;
    const modo = W.modo();
    refs.modo.textContent = `Modo: ${ROTULO_MODO[modo] || modo}`;
    refs.chave.checked = W.ativo();
    const pagina = paginaAtual();
    const ferramentas = W.ferramentas().filter((f) => !f.pagina || f.pagina === pagina);
    const liberadas = ferramentas.filter((f) => f.liberada).length;
    refs.contador.textContent = String(liberadas);
    refs.contador.setAttribute('aria-label', `${liberadas} ferramentas disponíveis nesta página`);
    // O nome acessível precisa conter o texto visível do botão (contador incluído).
    refs.botao.setAttribute('aria-label', `Agentes IA ${liberadas} — abrir painel`);

    refs.lista.replaceChildren();
    if (!ferramentas.length) {
      refs.lista.appendChild(criar('li', { text: 'Nenhuma ferramenta registrada nesta página.' }));
    }
    ferramentas.forEach((f) => {
      const tags = Object.keys(ROTULO_ANOTACAO)
        .filter((k) => f.anotacoes && f.anotacoes[k])
        .map((k) => criar('span', { class: 'nxm-tag', text: ROTULO_ANOTACAO[k] }));
      refs.lista.appendChild(criar('li', null, [
        criar('div', null, [criar('code', { text: f.nome }), txt(` — ${f.titulo}`)]),
        criar('div', { class: f.liberada ? 'nxm-livre' : 'nxm-bloq', text: f.liberada ? 'Disponível para o seu cargo' : (f.motivoBloqueio || 'Indisponível') }),
        criar('div', null, tags)
      ]));
    });

    refs.atividade.replaceChildren();
    const atividades = W.atividade().slice(0, 12);
    if (!atividades.length) {
      refs.atividade.appendChild(criar('li', { text: 'Nenhuma chamada registrada nesta sessão.' }));
    }
    atividades.forEach((a) => {
      const hora = a.quando ? new Date(a.quando).toLocaleTimeString('pt-BR') : '--:--:--';
      const confirmacao = a.confirmada === 'sim' ? ' · confirmada pelo operador' : (a.confirmada === 'nao' ? ' · não confirmada' : '');
      refs.atividade.appendChild(criar('li', { text: `${hora} · ${a.ferramenta} · ${a.codigo}${confirmacao}` }));
    });
  }

  function abrirPainel() {
    if (!refs) return;
    painelAberto = true;
    refs.painel.hidden = false;
    refs.botao.setAttribute('aria-expanded', 'true');
    renderPainel();
    refs.chave.focus();
  }

  function fecharPainel() {
    if (!refs) return;
    painelAberto = false;
    refs.painel.hidden = true;
    refs.botao.setAttribute('aria-expanded', 'false');
    refs.botao.focus();
  }

  function montarPainel() {
    if (refs || !document.body) return;
    instalarEstilos();
    const botao = criar('button', {
      type: 'button', id: 'nxmBotao', 'aria-expanded': 'false', 'aria-controls': 'nxmPainel',
      'aria-label': 'Agentes IA 0 — abrir painel'
    }, [
      criar('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: 'smart_toy', style: 'font-size:16px' }),
      // O espaço no fim do rótulo é intencional: o texto visível lido pelas ferramentas de auditoria
      // vira "Agentes IA 14" (mesmos termos do aria-label) em vez de "Agentes IA14".
      criar('span', { text: 'Agentes IA ' }),
      criar('span', { class: 'nxm-n', id: 'nxmContador', text: '0' })
    ]);
    const chave = criar('input', { type: 'checkbox', role: 'switch', id: 'nxmAtivo' });
    const modo = criar('p', { id: 'nxmModo' });
    const lista = criar('ul', { id: 'nxmLista' });
    const atividade = criar('ol', { id: 'nxmAtividade' });
    const fechar = criar('button', { type: 'button', class: 'nxm-btn', id: 'nxmFechar' }, [txt('Fechar')]);
    const painel = criar('section', { id: 'nxmPainel', role: 'dialog', 'aria-label': 'Agentes de IA', hidden: 'hidden' }, [
      criar('h2', { text: 'Agentes de IA (WebMCP)' }),
      modo,
      criar('label', { class: 'nxm-switch' }, [
        chave,
        txt('Permitir que agentes usem as ferramentas deste navegador')
      ]),
      criar('p', { text: 'Ações que alteram dados sempre pedem a sua confirmação. Nenhuma credencial é exposta.' }),
      criar('h3', { text: 'Ferramentas nesta página' }),
      lista,
      criar('h3', { text: 'Atividade recente' }),
      atividade,
      criar('div', { class: 'nxm-acoes' }, [fechar])
    ]);
    document.body.appendChild(botao);
    document.body.appendChild(painel);
    refs = { botao, painel, chave, modo, lista, atividade, contador: botao.querySelector('#nxmContador') };

    botao.addEventListener('click', () => (painelAberto ? fecharPainel() : abrirPainel()));
    fechar.addEventListener('click', fecharPainel);
    chave.addEventListener('change', () => { W.definirAtivo(chave.checked); renderPainel(); });
    painel.addEventListener('keydown', (evento) => { if (evento.key === 'Escape') fecharPainel(); });
    W.ouvir(renderPainel);
    renderPainel();
  }

  // Mudanças de sessão ou da chave em outras abas refletem nas ferramentas desta aba.
  window.addEventListener('storage', (evento) => {
    if (['nexus_session', 'nexus_active_delegation', 'nexus_webmcp_ativo'].includes(evento.key)) {
      W.sincronizar();
      renderPainel();
    }
  });

  window.NexusWebMCPUI = Object.freeze({
    confirmar,
    montarPainel,
    abrirPainel,
    fecharPainel,
    estaAberto: () => painelAberto,
    PRAZO_PADRAO_MS
  });

  // O provedor de confirmação é fixado aqui (o núcleo ignora novas chamadas a iniciar()).
  W.iniciar({ confirmar });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montarPainel);
  } else {
    montarPainel();
  }
})(window, document);
