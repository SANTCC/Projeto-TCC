/**
 * NexusPort — Período de Referência dos relatórios (vanilla JS, sem dependências).
 *
 * O "Período de Referência" (relatorios.html) recorta a tabela de produtividade e os
 * gráficos do sistema. Antes, a mesma janela era calculada com contas DIFERENTES em duas
 * telas (tabela × gráficos) e o HTML trazia rótulos com data FIXA ("3º Trimestre de 2026",
 * "Ano Atual (2026)") que deixavam de valer a cada virada de trimestre/ano — Backlog 001, C15.
 *
 * Aqui existe UMA fonte: a janela e os rótulos saem do relógio real do operador, nunca de
 * uma data escrita no código. O parâmetro `agora` é opcional e existe para os testes.
 *
 * Expõe window.NexusPeriodo.
 */
(function (global) {
  'use strict';

  /** Períodos oferecidos na tela, na ordem do select. */
  const PERIODOS = ['HOJE', '7D', '30D', 'MENSAL', 'TRIMESTRAL', 'ANUAL'];

  /** Relógio de referência: o informado (testes) ou o real. */
  function referencia(agora) {
    return (agora instanceof Date && !Number.isNaN(agora.getTime())) ? agora : new Date();
  }

  function inicioDoDia(data) {
    const d = new Date(data.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Mesmo dia, N dias antes (a aritmética de datas do JS já trata virada de mês/ano). */
  function diasAtras(data, dias) {
    return inicioDoDia(new Date(data.getFullYear(), data.getMonth(), data.getDate() - dias));
  }

  /** Trimestre CIVIL do mês (1 a 4): jan-mar = 1, abr-jun = 2, jul-set = 3, out-dez = 4. */
  function trimestreDoMes(mes) {
    return Math.floor(mes / 3) + 1;
  }

  /** Primeiro mês (0-11) do trimestre civil que contém o mês informado. */
  function primeiroMesDoTrimestre(mes) {
    return Math.floor(mes / 3) * 3;
  }

  function periodoValido(periodo) {
    return PERIODOS.indexOf(String(periodo || '').toUpperCase()) !== -1;
  }

  /**
   * Início REAL do período, sempre calculado a partir do relógio.
   * Devolve `null` quando não há recorte de data (todo o histórico): valor desconhecido
   * NÃO inventa uma janela — era justamente o rótulo fixo que parecia valer para sempre.
   */
  function inicioDoPeriodo(periodo, agora) {
    const ref = referencia(agora);
    switch (String(periodo || '').toUpperCase()) {
      case 'HOJE': return inicioDoDia(ref);
      case '7D': return diasAtras(ref, 7);
      case '30D': return diasAtras(ref, 30);
      case 'MENSAL': return new Date(ref.getFullYear(), ref.getMonth(), 1);
      case 'TRIMESTRAL': return new Date(ref.getFullYear(), primeiroMesDoTrimestre(ref.getMonth()), 1);
      case 'ANUAL': return new Date(ref.getFullYear(), 0, 1);
      default: return null;
    }
  }

  /**
   * Fim REAL do recorte: o dia de hoje.
   *
   * O sistema recorta pelo INÍCIO do período (tudo o que veio depois entra), então a janela
   * efetiva termina no dia corrente — nunca no fim do mês/trimestre/ano, que ainda não chegou.
   * É essa a data mostrada ao operador, para ele saber exatamente o que está vendo.
   */
  function fimDoPeriodo(agora) {
    return inicioDoDia(referencia(agora));
  }

  function formatarDia(data) {
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  /** Rótulo do período com a data REAL (substitui os rótulos fixos que existiam no HTML). */
  function rotuloPeriodo(periodo, agora) {
    const ref = referencia(agora);
    switch (String(periodo || '').toUpperCase()) {
      case 'HOJE': return 'Hoje';
      case '7D': return 'Últimos 7 dias';
      case '30D': return 'Últimos 30 dias';
      case 'MENSAL': return `Este mês (${ref.toLocaleDateString('pt-BR', { month: 'long' })} de ${ref.getFullYear()})`;
      case 'TRIMESTRAL': return `${trimestreDoMes(ref.getMonth())}º trimestre de ${ref.getFullYear()}`;
      case 'ANUAL': return `Ano atual (${ref.getFullYear()})`;
      default: return 'Todo o histórico';
    }
  }

  /**
   * Intervalo REAL do período em pt-BR: { inicio, fim, texto }.
   * Ex.: 01/10/2026 até 11/10/2026. Sem recorte, informa todo o histórico até hoje.
   */
  function intervaloPeriodo(periodo, agora) {
    const ref = referencia(agora);
    const inicio = inicioDoPeriodo(periodo, ref);
    const fim = fimDoPeriodo(ref);
    if (!inicio) return { inicio: null, fim: fim, texto: `todo o histórico até ${formatarDia(fim)}` };
    if (inicio.getTime() === fim.getTime()) return { inicio: inicio, fim: fim, texto: formatarDia(fim) };
    return { inicio: inicio, fim: fim, texto: `${formatarDia(inicio)} até ${formatarDia(fim)}` };
  }

  /**
   * Escreve nos <option> do select os rótulos reais do dia (o HTML guarda só valores).
   * Opções com valor fora da lista são preservadas como estão.
   */
  function aplicarRotulosAoSelect(select, agora) {
    if (!select || !select.options) return false;
    let alterou = false;
    Array.prototype.forEach.call(select.options, (opcao) => {
      if (!periodoValido(opcao.value)) return;
      const rotulo = rotuloPeriodo(opcao.value, agora);
      if (opcao.textContent !== rotulo) {
        opcao.textContent = rotulo;
        alterou = true;
      }
    });
    return alterou;
  }

  global.NexusPeriodo = {
    PERIODOS: PERIODOS,
    periodoValido: periodoValido,
    trimestreDoMes: trimestreDoMes,
    inicioDoPeriodo: inicioDoPeriodo,
    fimDoPeriodo: fimDoPeriodo,
    rotuloPeriodo: rotuloPeriodo,
    intervaloPeriodo: intervaloPeriodo,
    formatarDia: formatarDia,
    aplicarRotulosAoSelect: aplicarRotulosAoSelect
  };
})(typeof window !== 'undefined' ? window : globalThis);
