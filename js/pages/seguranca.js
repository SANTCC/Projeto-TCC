/**
 * Painel de Auditoria das Tentativas de Login (seguranca.html) - NexusPort
 * ---------------------------------------------------------------------------
 * Lê o log permanente gravado pela função `login_funcionario` (migration
 * `supabase/migrations/20261011000000_login_auditoria_tentativas.sql`) e mostra,
 * para a Direção/Conselho/Supervisor:
 *
 *   - indicadores: tentativas erradas (histórico), IPs distintos, IPs em alerta
 *     e IPs bloqueados na janela de 15 min;
 *   - IPs por total de tentativas erradas ("quantas vezes aquele IP errou
 *     QUALQUER código");
 *   - atividade por hora (IPs com tentativa errada em cada hora do período);
 *   - códigos mais tentados e a tabela completa por IP, com a data/hora.
 *
 * A tabela `tentativas_login` não tem policies: a leitura acontece só pela
 * função `login_tentativas_relatorio(p_limite, p_horas)`, que devolve o relatório
 * já agregado no servidor (nada de puxar o log inteiro para o navegador).
 *
 * A tela é restrita pelo auth-guard (cargos altos) — o banco não valida cargo,
 * porque o app não usa Supabase Auth (mesma ressalva das demais telas).
 *
 * Cadência: uma leitura na abertura, renovação a cada 60 s (como o painel de
 * gráficos de js/pages/charts.js) e o botão "Atualizar Log" sob demanda.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const session = window.currentUserSession || (window.NexusAuth && NexusAuth.getSession());
  if (!session) return;

  // Anti-XSS (js/security.js): IP, código e datas vêm do banco e nunca são
  // inseridos em HTML sem codificação.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);

  const el = {
    aviso: document.getElementById('segAviso'),
    avisoTexto: document.getElementById('segAvisoTexto'),
    status: document.getElementById('segStatus'),
    periodo: document.getElementById('segPeriodo'),
    btn: document.getElementById('segAtualizarBtn'),
    kpiTentativas: document.getElementById('kpiTentativas'),
    kpiIps: document.getElementById('kpiIps'),
    kpiIpsPeriodo: document.getElementById('kpiIpsPeriodo'),
    kpiAlerta: document.getElementById('kpiAlerta'),
    kpiBloqueados: document.getElementById('kpiBloqueados'),
    totalCodigos: document.getElementById('segTotalCodigos'),
    tabelaIps: document.getElementById('segTabelaIps'),
    tabelaCodigos: document.getElementById('segTabelaCodigos'),
    graficoIps: document.getElementById('segGraficoIps'),
    graficoHora: document.getElementById('segGraficoHora'),
    graficoCodigos: document.getElementById('segGraficoCodigos')
  };

  if (!el.btn) return; // página fora do formato esperado: não quebra nada

  // Paleta de Specs/design/design.md (mesma de js/pages/charts.js)
  const CORES = {
    primaria: '#445987',
    escura: '#1E293B',
    grade: '#E1E5ED',
    gradeEscura: '#334155',
    texto: '#475569',
    textoEscuro: '#CBD5E1',
    alerta: '#D97706',
    perigo: '#C62828',
    paleta: ['#445987', '#6366F1', '#0D9488', '#D97706', '#C62828', '#7E57C2', '#2E7D32', '#64748B']
  };

  const TOP_IP = 10;          // barras do gráfico de IPs
  const TOP_CODIGOS = 8;      // fatias da rosca
  const INTERVALO_MS = 60000; // renovação automática (1 minuto)

  const numero = new Intl.NumberFormat('pt-BR');
  const graficos = { ips: null, hora: null, codigos: null };
  let ultimoRelatorio = null;
  let carregando = false;

  // ------------------------------------------------------------------
  // Formatação
  // ------------------------------------------------------------------
  function ehNoite() {
    return document.documentElement.classList.contains('dark');
  }

  function corTexto() { return ehNoite() ? CORES.textoEscuro : CORES.texto; }
  function corGrade() { return ehNoite() ? CORES.gradeEscura : CORES.grade; }

  function dataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR');
  }

  /** "há 3 min" — a recência é a informação que decide se o ataque continua. */
  function tempoRelativo(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const minutos = Math.floor((Date.now() - d.getTime()) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return 'há ' + minutos + ' min';
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return 'há ' + horas + (horas === 1 ? ' hora' : ' horas');
    const dias = Math.floor(horas / 24);
    return 'há ' + dias + (dias === 1 ? ' dia' : ' dias');
  }

  const ROTULO_NIVEL = {
    critico: 'Crítico',
    alto: 'Alto',
    moderado: 'Moderado',
    baixo: 'Baixo',
    limpo: 'Sem falha ativa'
  };

  const CLASSE_NIVEL = {
    critico: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    alto: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    moderado: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    baixo: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    limpo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
  };

  function aviso(texto) {
    if (!el.aviso || !el.avisoTexto) return;
    if (!texto) {
      el.aviso.classList.add('hidden');
      el.avisoTexto.textContent = '';
      return;
    }
    el.avisoTexto.textContent = texto;
    el.aviso.classList.remove('hidden');
  }

  function status(texto) {
    if (el.status) el.status.textContent = texto;
  }

  // ------------------------------------------------------------------
  // Consulta
  // ------------------------------------------------------------------
  async function carregar() {
    if (carregando) return;
    carregando = true;
    if (el.btn) {
      el.btn.disabled = true;
      el.btn.innerHTML =
        '<span class="material-symbols-outlined fa-solid fa-spinner text-[18px] animate-spin" data-icon="progress_activity" aria-hidden="true"></span>' +
        '<span>Consultando…</span>';
    }
    status('Consultando o log…');

    const horas = Number(el.periodo && el.periodo.value) || 24;

    try {
      const client = window.nexusSupabase;
      if (!client || typeof client.rpc !== 'function') {
        throw new Error('Cliente Supabase indisponível (js/config.js ausente ou vazio).');
      }

      const { data, error } = await client.rpc('login_tentativas_relatorio', {
        p_limite: 15,
        p_horas: horas
      });
      if (error) throw error;
      if (!data) throw new Error('O servidor devolveu uma resposta vazia.');

      ultimoRelatorio = data;
      aviso('');
      desenhar(data);
      status('Atualizado às ' + new Date().toLocaleTimeString('pt-BR'));
    } catch (err) {
      console.error('[NexusPort Segurança] Falha ao consultar o log de tentativas:', err);
      const mensagem = (err && err.message) || String(err);
      aviso(
        'Não foi possível ler o log de tentativas (' + mensagem + '). ' +
        'Se a função ainda não existir no projeto, aplique a migração ' +
        'supabase/migrations/20261011000000_login_auditoria_tentativas.sql (supabase db push).'
      );
      status('Falha na consulta');
    } finally {
      carregando = false;
      if (el.btn) {
        el.btn.disabled = false;
        el.btn.innerHTML =
          '<span class="material-symbols-outlined fa-solid fa-arrows-rotate text-[18px]" data-icon="refresh" aria-hidden="true"></span>' +
          '<span>Atualizar Log</span>';
      }
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function desenhar(dados) {
    const resumo = dados.resumo || {};

    if (el.kpiTentativas) el.kpiTentativas.textContent = numero.format(resumo.tentativas || 0);
    if (el.kpiIps) el.kpiIps.textContent = numero.format(resumo.ips || 0);
    if (el.kpiIpsPeriodo) {
      el.kpiIpsPeriodo.textContent = numero.format(resumo.ips_periodo || 0) +
        ' com tentativa nas últimas ' + (dados.horas || 24) + ' h';
    }
    if (el.kpiAlerta) el.kpiAlerta.textContent = numero.format(resumo.em_alerta || 0);
    if (el.kpiBloqueados) el.kpiBloqueados.textContent = numero.format(resumo.bloqueados || 0);
    if (el.totalCodigos) {
      el.totalCodigos.textContent = numero.format(resumo.codigos || 0) + ' códigos distintos';
    }

    desenharTabelaIps(Array.isArray(dados.ips) ? dados.ips : []);
    desenharTabelaCodigos(Array.isArray(dados.codigos) ? dados.codigos : []);
    desenharGraficos(Array.isArray(dados.ips) ? dados.ips : [], Array.isArray(dados.codigos) ? dados.codigos : [], Array.isArray(dados.serie) ? dados.serie : []);
  }

  function linhaVazia(tabela, colunas, texto) {
    if (!tabela) return;
    tabela.innerHTML =
      '<tr><td colspan="' + colunas + '" class="p-4 text-center text-slate-500 dark:text-slate-400">' +
      esc(texto) + '</td></tr>';
  }

  function desenharTabelaIps(ips) {
    if (!el.tabelaIps) return;
    if (!ips.length) {
      linhaVazia(el.tabelaIps, 7, 'Nenhuma tentativa errada registrada no log.');
      return;
    }
    el.tabelaIps.innerHTML = ips.map(function (ip) {
      const nivel = ROTULO_NIVEL[ip.nivel] ? ip.nivel : 'baixo';
      const classe = CLASSE_NIVEL[nivel];
      return '<tr>' +
        '<td class="p-3 font-mono font-bold text-nexus-900 dark:text-white">' + esc(ip.ip) + '</td>' +
        '<td class="p-3"><span class="px-2.5 py-1 rounded-full font-mono text-[10px] font-bold uppercase ' + classe + '">' +
          esc(ROTULO_NIVEL[nivel]) + '</span></td>' +
        '<td class="p-3 text-right font-mono ' + (ip.falhas_janela >= 2 ? 'font-bold' : '') + '">' +
          numero.format(ip.falhas_janela || 0) + '</td>' +
        '<td class="p-3 text-right font-mono font-bold">' + numero.format(ip.total || 0) + '</td>' +
        '<td class="p-3 font-mono text-slate-600 dark:text-slate-400">' + esc(dataHora(ip.inicio)) + '</td>' +
        '<td class="p-3 font-mono">' + esc(dataHora(ip.ultima)) +
          '<span class="block text-[10px] text-slate-500 dark:text-slate-400">' + esc(tempoRelativo(ip.ultima)) + '</span></td>' +
        '<td class="p-3 font-mono ' + (ip.sucesso ? 'text-red-600 dark:text-red-400 font-bold' : 'text-slate-500 dark:text-slate-400') + '">' +
          (ip.sucesso ? esc(dataHora(ip.sucesso)) : 'não') + '</td>' +
        '</tr>';
    }).join('');
  }

  function desenharTabelaCodigos(codigos) {
    if (!el.tabelaCodigos) return;
    if (!codigos.length) {
      linhaVazia(el.tabelaCodigos, 3, 'Nenhum código foi tentado até agora.');
      return;
    }
    el.tabelaCodigos.innerHTML = codigos.map(function (c) {
      return '<tr>' +
        '<td class="p-3 font-mono font-bold text-nexus-900 dark:text-white">' + esc(c.codigo) + '</td>' +
        '<td class="p-3 text-right font-mono font-bold">' + numero.format(c.total || 0) + '</td>' +
        '<td class="p-3 text-right font-mono text-slate-600 dark:text-slate-400">' + esc(dataHora(c.ultima)) + '</td>' +
        '</tr>';
    }).join('');
  }

  // ------------------------------------------------------------------
  // Gráficos (Chart.js carregado sob demanda, como em js/pages/charts.js)
  // ------------------------------------------------------------------
  function destruirTodos() {
    ['ips', 'hora', 'codigos'].forEach(function (chave) {
      if (graficos[chave]) {
        try { graficos[chave].destroy(); } catch (e) { /* gráfico já removido */ }
        graficos[chave] = null;
      }
    });
  }

  function eixoComum() {
    return {
      grid: { color: corGrade(), drawBorder: false },
      ticks: { color: corTexto(), font: { size: 10, family: 'JetBrains Mono, monospace' } }
    };
  }

  function desenharGraficos(ips, codigos, serie) {
    destruirTodos();
    if (!window.Chart) return; // Chart.js ainda não carregou: a próxima renovação tenta de novo

    // 1) IPs por total de tentativas erradas
    const topIps = ips.slice(0, TOP_IP);
    if (el.graficoIps) {
      graficos.ips = new window.Chart(el.graficoIps.getContext('2d'), {
        type: 'bar',
        data: {
          labels: topIps.map(function (i) { return i.ip; }),
          datasets: [{
            label: 'Tentativas erradas',
            data: topIps.map(function (i) { return i.total || 0; }),
            backgroundColor: topIps.map(function (i) {
              return i.falhas_janela >= 3 ? CORES.perigo : i.falhas_janela >= 2 ? CORES.alerta : CORES.primaria;
            }),
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ...eixoComum() },
            y: eixoComum()
          }
        }
      });
    }

    // 2) Atividade por hora
    if (el.graficoHora) {
      graficos.hora = new window.Chart(el.graficoHora.getContext('2d'), {
        type: 'bar',
        data: {
          labels: serie.map(function (p) {
            const d = new Date(p.hora);
            return isNaN(d.getTime()) ? '--' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          }),
          datasets: [{
            label: 'IPs com tentativa errada',
            data: serie.map(function (p) { return p.ips || 0; }),
            backgroundColor: CORES.primaria,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: eixoComum(),
            y: { beginAtZero: true, ticks: { ...eixoComum().ticks, precision: 0 } }
          }
        }
      });
    }

    // 3) Códigos mais tentados
    const topCodigos = codigos.slice(0, TOP_CODIGOS);
    if (el.graficoCodigos) {
      graficos.codigos = new window.Chart(el.graficoCodigos.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: topCodigos.map(function (c) { return c.codigo; }),
          datasets: [{
            data: topCodigos.map(function (c) { return c.total || 0; }),
            backgroundColor: topCodigos.map(function (_c, i) { return CORES.paleta[i % CORES.paleta.length]; }),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: corTexto(), boxWidth: 10, font: { size: 10 } } }
          }
        }
      });
    }
  }

  async function garantirChartJs() {
    if (window.Chart) return true;
    if (!window.NexusAssets || typeof window.NexusAssets.carregar !== 'function') return false;
    try {
      await window.NexusAssets.carregar('chartjs');
    } catch (e) { /* bloqueado/offline: os números e as tabelas continuam */ }
    return typeof window.Chart !== 'undefined';
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  if (el.btn) el.btn.addEventListener('click', carregar);
  if (el.periodo) el.periodo.addEventListener('change', carregar);

  // Troca de tema: os gráficos precisam ser redesenhados com as cores do modo
  if (window.MutationObserver) {
    const observador = new MutationObserver(function () {
      if (ultimoRelatorio) {
        desenharTabelaIps(ultimoRelatorio.ips || []);
        desenharGraficos(ultimoRelatorio.ips || [], ultimoRelatorio.codigos || [], ultimoRelatorio.serie || []);
      }
    });
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  // Primeira carga + renovação automática
  (async function iniciar() {
    await garantirChartJs();
    await carregar();
    setInterval(function () {
      if (document.hidden) return; // aba em segundo plano: não gasta leitura
      carregar();
    }, INTERVALO_MS);
  })();
});