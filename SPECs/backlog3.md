# TODOs

## Área de gráficos (UI) — ✅ IMPLEMENTADO
Lugar simples aonde o Diretor de Operações pode observar comparações de dados do sistema, gráficos comparando informações como "% de berços operacionais".

> **Entregue:** painéis Chart.js por camada de visão no Painel Geral (`dashboard.html`) e em Relatórios (`relatorios.html`), incluindo "% de berços operacionais", fila de liberação, tempo médio de permanência, produtividade por cargo, embarcações mais utilizadas e valor declarado (exclusivo da Direção/Conselho). Módulo: `js/charts.js` · Teste: `node tests/test_graficos_por_cargo.js`.

## Auto-complete de - no login (UX) ✅ IMPLEMENTADO
Quando digitar um login, auotmaticamente insira um - quando o usuario pressionar um numero, de forma que se ele já digitou MAT e apertar 1, ele completa pra MAT-1.

> **Status:** Implementado. Em `js/login.js`, ao digitar o primeiro número logo após o prefixo alfabético o separador entra automaticamente (`MAT` + `1` → `MAT-1`, `NX8821` → `NX-8821`), sem alterar códigos já hifenizados nem matrículas numéricas. Teste: `node tests/test_backlog3_correcoes.js`.

## Botão de Pânico ser global ✅ IMPLEMENTADO
Quando o botão de pânco ser ativado, exibir uma mensagem no rodapé da tela informando que está ocorrendo uma emergência.

> **Status:** Implementado. O botão existente (`manutencao.html`) dispara a Edge Function `panic-alert` (`supabase/functions/panic-alert/index.ts`), que faz broadcast via WebSocket (Supabase Realtime, canal `nexus-emergency`) para todos os clientes conectados e dispara um webhook OPCIONAL (desativado por padrão, tabela `panic_webhook_config`). Todos os clientes exibem a mensagem de emergência fixa no rodapé da tela (`js/panic-realtime.js`). Deploy: `supabase db push` + `supabase functions deploy panic-alert --no-verify-jwt`.
>
> **Alerta no aparelho (vibração/som):** clientes compatíveis podem vibrar com o padrão SOS no acionamento e pulsos a cada 3s enquanto o alarme estiver ativo. A Vibration API exige contexto seguro, sticky user activation e documento visível; Safari/WebKit no iOS e Firefox 129+ não oferecem essa API. Não há workaround web confiável nesses navegadores, então o sistema usa alerta sonoro (quando o navegador permite) e banner visual. `js/haptics.js` valida e normaliza os padrões conforme a especificação, mostra o diagnóstico e oferece controles de preferência/teste em `manutencao.html`. Teste: `node tests/test_haptics.js`.

## Barra de Menu lateral não fica grudada na tela quando scrolla ✅ IMPLEMENTADO
Ela parece não ficar parada quando scroll, tanto no PC, quanto no celular.

> **Status:** Implementado. O contêiner principal agora é limitado à viewport no desktop (`js/layout.js`: `md:h-[calc(100vh-4rem)] md:overflow-hidden`), então apenas o `<main>` rola e a sidebar permanece fixa; no celular o menu continua como drawer `fixed` (com fundo escurecido que fecha ao tocar fora). Teste: `node tests/test_backlog3_correcoes.js`.

## Salvar o login com Cookies ao invés de SESSION_STORAGE
A não ser que haja problemas de segurança, usar Cookies parece mais prático para usuários.

## PDF renderizado no lado do servidor ao invés do lado do cliente + cache/armazenamento no supabase storage
Atualmente, PDFs são renderizados pelo lado do cliente toda a vez que requisistados.

## Popular cargos
Adicionar usuários "mock" pra cada cargo, cada um com nome no formato [CARGO] + "_mock" + [NUMERO (123 OU 321 OU 456)], cada cargo com 2 usuários mocks.

## Popular ações
Adicionar histórico de mudanças, novos cargas, novos navios, tudo pra fazer isso realmente parecer algo 100% polido.

## Nº de usuários on-line no momento
Número de usuários ativos naquele momento, atualizado a cada 30 segundos.

## Atualização em tempo real das tabelas e indicadores
Corrigir os dados exibidos pelas tabelas e indicadores do sistema quando ocorre uma alteração no Supabase, garantindo que todos os painéis sejam atualizados em tempo real e não apresentem dados antigos ou incorretos.

Atualmente existem inconsistências como:
- No Painel Geral aparece que existem **2 equipamentos com manutenções agendadas**, quando na realidade não existe nenhum.
- A tabela de **alterações no sistema** mostra apenas o meu perfil como responsável pelas alterações, enquanto os demais usuários aparecem com **0 alterações**, mesmo quando existem alterações realizadas por eles.
- Verificar se os listeners do Supabase Realtime estão corretamente configurados e se os dados são recarregados após `INSERT`, `UPDATE` e `DELETE`.
- Garantir que os filtros, contadores, tabelas e cards derivados dos dados do Supabase sejam recalculados após cada atualização.
- Evitar inconsistências causadas por cache, estado local desatualizado ou consultas que não sejam refeitas após alterações.

## Remover gráficos duplicados do Painel Geral
Os gráficos atualmente aparecem tanto no **Painel Geral** quanto na página **Relatórios & PDF**, gerando duplicação de informações.

Os gráficos funcionam essencialmente como uma forma de relatório e, portanto, devem ficar concentrados na página **Relatórios & PDF**.

> **Objetivo:** remover os gráficos do `dashboard.html`/Painel Geral e manter a visualização gráfica na página `relatorios.html`, evitando duplicidade e deixando o Painel Geral focado em indicadores operacionais em tempo real.

## Impedir manutenção de navio fora do Porto de Santos
Não deve ser possível registrar ou executar uma manutenção para um navio que esteja atualmente **fora do Porto de Santos**.

> **Regra:** antes de permitir uma manutenção, verificar a localização/status operacional atual do navio. Caso ele esteja fora do porto, bloquear a operação e informar claramente ao usuário o motivo do bloqueio.

> **Status:** Implementado em `js/manutencao.js`. A "Solicitação de Manutenção de Embarcações (Navios)" lista apenas navios com `localizacao = DENTRO_DO_PORTO` (os demais ficam de fora, com o motivo no `title` do select) e o `submit` do formulário bloqueia novamente a operação caso o navio saia do porto entre a abertura e o envio. Teste: `node tests/test_backlog3_correcoes.js`.

## Impedir vinculação de carga a navio fora do Porto de Santos
Não deve ser possível vincular uma carga a um navio que esteja atualmente **fora do Porto de Santos**.

> **Regra:** a seleção de navios para vinculação de cargas deve considerar a localização/status atual da embarcação e disponibilizar somente navios que estejam no Porto de Santos e aptos para receber cargas.

## Impedir movimentação de carga em trânsito
Uma carga que já esteja **em trânsito** não pode ser movimentada pelo sistema.

> **Regra:** quando a carga estiver em trânsito, as ações de movimentação devem ficar bloqueadas/desabilitadas. O sistema deve informar que a carga não pode ser movimentada enquanto estiver em trânsito.

> **Status:** Implementado em `js/cargas.js`. A carga `EM_TRANSITO` renderiza o botão **Movimentar** desabilitado (com `title` explicando o bloqueio) e a função `executarAcaoCarga` também recusa a ação — nenhuma tarefa de guindaste é criada. Teste: `node tests/test_backlog3_correcoes.js`.

## Corrigir momento em que a carga entra em trânsito
Atualmente a carga passa a aparecer como **em trânsito** quando o botão **"Pronto para entrega"** é acionado, mas esse comportamento está incorreto.

> **Regra:** uma carga só deve entrar no estado **em trânsito quando o navio for efetivamente liberado**. O botão **"Pronto para entrega"** não deve alterar o status da carga para trânsito.
>
> **Fluxo esperado:** carga preparada → pronta para entrega → navio liberado → carga em trânsito.

> **Status:** Verificado (já correto no código atual). O botão **"Pronta"** grava `PRONTA_PARA_ENTREGA` (`js/cargas.js`) e a carga só vira `EM_TRANSITO` na liberação de saída (carga ou navio), com a chegada ao destino marcando `ENTREGUE`. Nenhuma alteração necessária.

## Seleção de rotas marítimas no cadastro de navios
No cadastro de navios deve existir uma caixa de seleção contendo **somente as rotas marítimas cadastradas no Supabase**.

> **Objetivo:** utilizar a rota selecionada como fonte oficial para calcular corretamente a **estimativa de chegada (ETA)** e a **distância da viagem**, evitando que esses valores sejam inseridos ou calculados incorretamente de forma manual.
>
> A lista de rotas deve ser carregada diretamente do Supabase e não deve conter rotas fictícias ou opções estáticas que não estejam cadastradas no banco.

## Scanner QR Code responsivo no celular
Ao acessar o sistema pelo celular, o scanner de QR Code atualmente fica em um formato **retangular**.

> **Objetivo:** o scanner deve manter uma área de leitura **quadrada**, independentemente do tamanho ou orientação da tela.
>
> Garantir que o elemento de câmera/preview e a área visual de leitura preservem proporção `1:1` em dispositivos móveis, sem distorcer a imagem da câmera.

> **Status:** Implementado. `scanner.html` usa `aspect-square` + CSS `aspect-ratio: 1 / 1` (com `object-fit: cover` no vídeo, sem distorção) e `js/scanner.js` calcula o `qrbox` quadrado proporcional ao preview. Teste: `node tests/test_backlog3_correcoes.js`.

# Anotações

## 1) Correção — Autorizar retorno de navio com a ação bloqueada

* **Página:** Embarcações (`embarcacoes.html` / `js/embarcacoes.js`)
* **Local:** Tabela "Localização GPS Marítima & Cadastro de Navios", coluna Ações, botão **Autorizar Retorno** (cinza) de navios `FORA_DO_PORTO` (linha ~322) e a função `window.autorizarRetornoNavio` (linha ~565).
* **Causa:** o botão só *parece* bloqueado (`bg-slate-400 cursor-not-allowed`). Ele mantém o `onclick`, não tem `disabled`, e a função não confere a localização do navio.
* **Solução:**

```js
// 1) No botão: disabled de verdade e sem onclick
} else if (n.localizacao === 'FORA_DO_PORTO') {
  acoesHtml += `<button type="button" disabled aria-disabled="true"
      class="px-2.5 py-1 rounded bg-slate-300 dark:bg-slate-700 text-slate-500 font-bold cursor-not-allowed opacity-70"
      title="O navio precisa chegar ao porto de destino antes de autorizar o retorno">
      Autorizar Retorno</button>`;
}

// 2) Na função: trava de regra de negócio
window.autorizarRetornoNavio = async function (imo) {
  // ...checagem de cargo que já existe...
  const navio = naviosList.find(n => n.imo === imo);
  if (!navio) return;

  if (navio.localizacao !== 'NO_PORTO_DE_DESTINO') {
    window.mostrarFeedback?.('alerta', 'Retorno não permitido',
      `O navio ${navio.nome} ainda não chegou ao porto de destino.`);
    return;
  }
  // ...resto igual...
};
```

* **Extra:** aplicar a mesma checagem em **Liberar Saída** (`liberarNavioPeloDiretor`): `navio.localizacao === 'DENTRO_DO_PORTO'` dentro da função.

> **Status:** ✅ Implementado em `js/embarcacoes.js`. O botão de navios `FORA_DO_PORTO` agora tem `disabled`/`aria-disabled` de verdade e **sem** `onclick`; `autorizarRetornoNavio` exige `NO_PORTO_DE_DESTINO` e `liberarNavioPeloDiretor` exige `DENTRO_DO_PORTO` (com mensagem clara do motivo). Teste: `node tests/test_backlog3_correcoes.js`.

---

## 2) Correção — Botão de pânico pode ser acionado com o alarme já ativo

* **Página:** Manutenção & OS (`manutencao.html` / `js/manutencao.js`)
* **Local:** Faixa vermelha "Protocolo de Emergência / Botão de Pânico (Inspetor)" (HTML ~93–107) e listener do `panicButton` (JS ~664–680). Estado em `localStorage['nexus_emergency_active']`.
* **Causa:** o clique não verifica se a emergência já está ativa; pede confirmação, grava de novo e registra outro log. O botão nunca muda de aparência.
* **Solução:**

> **Status:** ✅ Implementado em `js/manutencao.js` (+ estado do botão): o acionamento com alarme já ativo é recusado com aviso e sem novo log, o botão passa a refletir o estado (`EMERGÊNCIA ATIVA`, `disabled`), o reset é desabilitado sem alarme e o estado é sincronizado entre abas via `storage`. Complemento do item 6 aplicado: com o alarme ativo, **Movimentar**, **Liberar** (carga), **Liberar Saída** e **Autorizar Retorno** ficam bloqueados (`window.nexusEmergenciaAtiva()` em `js/layout.js`).

```js
function aplicarEstadoEmergencia(ativa) {
  emergencyBanner?.classList.toggle('hidden', !ativa);
  if (!panicBtn) return;
  panicBtn.disabled = ativa;
  panicBtn.setAttribute('aria-disabled', String(ativa));
  panicBtn.classList.toggle('opacity-50', ativa);
  panicBtn.classList.toggle('cursor-not-allowed', ativa);
  panicBtn.querySelector('span:last-child').textContent =
    ativa ? 'EMERGÊNCIA ATIVA' : 'BOTÃO DE PÂNICO';
}

panicBtn?.addEventListener('click', async () => {
  if (localStorage.getItem('nexus_emergency_active') === 'true') return; // trava
  const ok = await window.nexusConfirm(/* ... */);
  if (!ok) return;
  localStorage.setItem('nexus_emergency_active', 'true');
  aplicarEstadoEmergencia(true);
  // ...log e feedback como já estão...
});

resetEmergencyBtn?.addEventListener('click', async () => {
  // ...confirmação...
  localStorage.removeItem('nexus_emergency_active');
  aplicarEstadoEmergencia(false);
});

// ao carregar a página
aplicarEstadoEmergencia(localStorage.getItem('nexus_emergency_active') === 'true');

// sincroniza entre abas abertas
window.addEventListener('storage', e => {
  if (e.key === 'nexus_emergency_active') aplicarEstadoEmergencia(e.newValue === 'true');
});
```

---

## 3) Organização de palavras, informações e formatação nos cards e campos de ação

### 3.1 Manutenção & OS — tabela de Ordens de Serviço

* **Local:** `renderOsTable()` (`js/manutencao.js` ~391–421), colunas Status e Ação.
* **Problemas:** status cru do banco (`EM_MANUTENCAO`, `PENDENTE_APROVACAO`); botões Aprovar/Reprovar com `mr-1` em vez de `gap`; "Concluir Manutenção" longo; prioridade `BAIXA` sem cor própria.
* **Solução:**

```js
const STATUS_OS = {
  PENDENTE_APROVACAO: { txt: 'Aguardando aprovação', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' },
  EM_MANUTENCAO:      { txt: 'Em manutenção',        cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' },
  CONCLUIDA:          { txt: 'Concluída',            cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' },
  REPROVADA:          { txt: 'Reprovada',            cls: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' },
};

const PRIORIDADE_OS = {
  ALTA:  'bg-red-100 text-red-800',
  MEDIA: 'bg-amber-100 text-amber-800',
  BAIXA: 'bg-emerald-100 text-emerald-800',
};

const badge = (cls, txt) =>
  `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap ${cls}">${txt}</span>`;
```

* **Coluna Ação:** utilizar grupo com `gap` e largura mínima:

```html
<div class="flex items-center justify-end gap-1.5 flex-wrap min-w-[150px]">
  <button class="px-2.5 py-1 rounded bg-emerald-600 text-white font-bold">Aprovar</button>
  <button class="px-2.5 py-1 rounded bg-red-600 text-white font-bold">Reprovar</button>
</div>
```

* Trocar **"Concluir Manutenção"** por **"Concluir"**, utilizando o ícone `task_alt` e `title="Concluir manutenção"`.

> **Status:** ✅ Implementado em `js/manutencao.js` (`renderOsTable`): status traduzidos ("Aguardando aprovação", "Em manutenção", "Concluída", "Reprovada"), prioridade com cor própria (incluindo BAIXA), ações em `flex` com `gap`/`min-w` e botão "Concluir" com ícone. As datas da coluna passaram a `dd/mm/aaaa` (item 8.8). Teste: `node tests/test_backlog3_correcoes.js`.

### 3.2 Manutenção & OS — "Alerta de Manutenção Preventiva Sugerida"

* **Local:** `#alertaPreventivaList` (`js/manutencao.js` ~485).
* **Problema:** cada item é uma linha corrida `1. [TIPO] ID: motivo`.
* **Solução:**

> **Status:** ✅ Implementado em `js/manutencao.js` (`carregarEquipamentosEAlertas`): cada equipamento aparece em bloco próprio, com etiqueta do tipo, identificação e motivo.

```js
alertaList.innerHTML = equipamentos.map(e => `
  <div class="flex items-start gap-2 py-1.5 border-b last:border-0 border-amber-200/60">
    <span class="shrink-0 px-1.5 py-0.5 rounded bg-amber-200/70 text-[10px] font-bold uppercase">${e.tipo}</span>
    <div>
      <strong class="block">${e.identificacao}</strong>
      <span class="text-amber-800/80 dark:text-amber-300/80">${e.motivo}</span>
    </div>
  </div>`).join('');
```

### 3.3 Cargas — tabela e botões de ação

> **Status:** ✅ Implementado em `js/cargas.js` (`renderTable`): ícones ampliados (`text-[18px]`), alvos de toque generosos (`min-w-[44px] min-h-[40px] justify-center`), rótulos ocultos no mobile (`hidden sm:inline`) com `title` + `aria-label` em todas as ações (Movimentar/Receber/Inspecionar/Pronta/Vincular/Liberar/Cancelar/QR), e a coluna Contêiner / Navio já separava os dois valores em duas linhas com *fallback* "não vinculado". Teste: `node tests/test_backlog3_restantes.js`.

* **Local:** `renderTable()` (`js/cargas.js` ~162–236), coluna Ações (`min-w-[200px]`, até 5–6 botões).
* **Problemas:** todos os botões têm o mesmo peso visual; a coluna "Contêiner / Navio" junta os dois valores com " / " e repete "Não vinculado".
* **Solução:** ação principal do status em botão cheio, secundárias em ícones com tooltip; contêiner e navio em duas linhas.

```js
const btnSec = (icone, titulo, acao, cor = 'slate') =>
  `<button type="button" title="${titulo}" aria-label="${titulo}"
     onclick="window.executarAcaoCarga('${c.id}','${acao}')"
     class="p-1.5 rounded-lg bg-${cor}-100 hover:bg-${cor}-200 text-${cor}-700">
     <span class="material-symbols-outlined text-[16px]">${icone}</span>
   </button>`;

`<td class="p-3 text-xs">
  <span class="block font-mono">${c.container || '<em class="text-slate-400">Contêiner: não vinculado</em>'}</span>
  <span class="block text-[10px] text-slate-400">${c.navio || 'Navio: não vinculado'}</span>
</td>`
```

### 3.4 Cargas — formulário "Agendamento de Nova Carga"

> **Status:** ✅ Implementado. Concordância corrigida (**"Agendar Nova Carga"**), campos agrupados por assunto em `<fieldset>` ("Dados da carga" / "Destino e prazo"), botão de confirmação encurtado para **"Agendar e gerar QR"**, botão **Cancelar** adicionado (limpa e fecha o formulário, `js/cargas.js`) — e o formulário ganhou o campo **Funcionário Responsável** (`#agEstivadorResponsavel`): gestores escolhem um funcionário ativo em escala, operadores têm a carga auto-atribuída à própria sessão (campo travado), com vínculo persistido em `estivador_cargas` (RF de atribuição). Teste: `node tests/test_backlog3_restantes.js`.

* **Local:** `cargas.html` ~77–139.
* **Problemas:**

  * Botão superior com erro de concordância: **"Agendar Nova Cargas"** → **"Agendar Nova Carga"**.
  * Botão de confirmar longo: **"Confirmar Agendamento & Gerar QR Code"**.
  * 8 campos soltos em 4 colunas, sem separação por assunto.
  * Falta botão **Cancelar**.
* **Solução:**

```html
<button id="toggleAgendamentoFormBtn" ...>
  <span>Agendar Nova Carga</span>
</button>

<fieldset class="sm:col-span-2 md:col-span-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
  <legend class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Dados da carga</legend>
  <!-- Tipo, Peso, Volume, Valor, Natureza -->
</fieldset>

<fieldset class="sm:col-span-2 md:col-span-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
  <legend class="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Destino e prazo</legend>
  <!-- Setor do pátio, Destino final, Data prevista -->
</fieldset>

<div class="sm:col-span-2 md:col-span-4 flex justify-end gap-2 pt-2">
  <button type="button" id="cancelAgendamentoBtn"
    class="px-4 py-2.5 rounded-xl border border-nexus-border text-slate-600 font-semibold text-xs">
    Cancelar
  </button>

  <button type="submit"
    class="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold text-xs">
    Agendar e gerar QR
  </button>
</div>
```

### 3.5 Embarcações — coluna Ações da tabela de navios

* **Local:** `js/embarcacoes.js` ~311–329.
* **Problema:** três botões coloridos lado a lado (Vincular, Liberar/Autorizar, Excluir), todos em `font-mono`.
* **Solução:** manter **Vincular** e **Liberar Saída / Autorizar Retorno** com texto; **Excluir** vira botão somente de ícone, separado por um divisor.

> **Status:** ✅ Implementado em `js/embarcacoes.js` (coluna Ações sem `font-mono`, divisor + botão **Excluir** só de ícone com `aria-label`, `title` e foco visível).

```js
acoesHtml += `<span class="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1"></span>
  <button type="button"
    title="Excluir navio"
    aria-label="Excluir navio ${n.nome}"
    onclick="window.excluirNavio('${n.imo}')"
    class="p-1.5 rounded bg-red-50 hover:bg-red-600 text-red-600 hover:text-white">
    <span class="material-symbols-outlined text-[16px]">delete</span>
  </button>`;
```

### 3.6 Embarcações — etiqueta de localização com nome técnico

* **Local:** `js/embarcacoes.js` ~340–344.
* **Problema:** mostra diretamente os estados técnicos `DENTRO_DO_PORTO`, `FORA_DO_PORTO`, `NO_PORTO_DE_DESTINO`.
* **Solução:**

```js
const LOCAL = {
  DENTRO_DO_PORTO:     { txt: 'No porto',          cls: 'bg-emerald-100 text-emerald-800' },
  FORA_DO_PORTO:       { txt: 'Em trânsito',       cls: 'bg-blue-100 text-blue-800' },
  NO_PORTO_DE_DESTINO: { txt: 'Chegou ao destino', cls: 'bg-purple-100 text-purple-800' },
};
```

> **Status:** ✅ Implementado em `js/embarcacoes.js` (`LOCALIZACAO_NAVIO` / `localizacaoBadgeHtml`): a coluna mostra "No porto", "Em trânsito" ou "Chegou ao destino", mantendo o código técnico no `title` para rastreabilidade. Teste: `node tests/test_backlog3_correcoes.js`.

---

## 4) Adição — Gráfico de rosca: navios dentro × fora do porto

* **Página:** Painel Geral (`dashboard.html`)
* **Local:** abaixo do bloco "Indicadores operacionais no terminal", ou ao lado do card "Navios fora do porto".
* **Dados:** `dashboard.js` já carrega `navios` (~290–315) com o campo `localizacao`.
* **Solução:** CSS puro, sem biblioteca.

```html
<div class="bg-white dark:bg-slate-900 rounded-2xl border border-nexus-border dark:border-nexus-dark-border p-6 shadow-sm">
  <h3 class="font-display font-bold text-sm mb-3">Navios dentro × fora do porto</h3>

  <div class="flex items-center gap-6">
    <div id="donutNavios" class="w-32 h-32 rounded-full relative"></div>
    <ul id="donutLegenda" class="text-xs space-y-1"></ul>
  </div>
</div>
```

```js
function renderDonutNavios(navios) {
  const total = navios.length || 1;
  const dentro = navios.filter(n => n.localizacao === 'DENTRO_DO_PORTO').length;
  const destino = navios.filter(n => n.localizacao === 'NO_PORTO_DE_DESTINO').length;
  const fora = navios.length - dentro - destino;

  const pct = v => Math.round((v / total) * 100);
  const a = pct(dentro);
  const b = a + pct(destino);

  const el = document.getElementById('donutNavios');

  el.style.background =
    `conic-gradient(#10b981 0 ${a}%, #8b5cf6 ${a}% ${b}%, #3b82f6 ${b}% 100%)`;

  el.innerHTML = `
    <div class="absolute inset-4 rounded-full bg-white dark:bg-slate-900
      flex items-center justify-center font-bold">
      ${pct(dentro)}%
    </div>`;

  document.getElementById('donutLegenda').innerHTML = `
    <li>
      <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>
      No porto: ${dentro} (${pct(dentro)}%)
    </li>
    <li>
      <span class="inline-block w-2 h-2 rounded-full bg-violet-500 mr-2"></span>
      No destino: ${destino} (${pct(destino)}%)
    </li>
    <li>
      <span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2"></span>
      Em trânsito: ${fora} (${pct(fora)}%)
    </li>`;
}
```

* **Alternativa:** utilizar Chart.js (`https://cdn.jsdelivr.net/npm/chart.js`) caso a implementação com CSS puro seja substituída pela biblioteca de gráficos já utilizada pelo sistema.

---

## 5) Adição — Gráfico de barras: navios mais utilizados

* **Página:** Painel Geral ou Relatórios.
* **Local:** ao lado da rosca, utilizando grid de 2 colunas em telas grandes.
* **Dados:** contagem de cargas por navio (`cargas.navio`, já utilizado em `embarcacoes.js` ~296).
* **Solução:**

```js
function renderTopNavios(cargas) {
  const cont = {};

  cargas
    .filter(c => c.navio)
    .forEach(c => {
      cont[c.navio] = (cont[c.navio] || 0) + 1;
    });

  const top = Object.entries(cont)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const max = top[0]?.[1] || 1;

  document.getElementById('topNavios').innerHTML =
    top.map(([nome, qtd]) => `
      <div class="mb-2">
        <div class="flex justify-between text-xs mb-0.5">
          <span>${nome}</span>
          <strong>${qtd}</strong>
        </div>

        <div class="h-2 rounded bg-slate-100 dark:bg-slate-800">
          <div
            class="h-2 rounded bg-nexus-500"
            style="width:${(qtd / max) * 100}%">
          </div>
        </div>
      </div>
    `).join('') ||
    '<p class="text-xs text-slate-400 italic">Sem cargas vinculadas ainda.</p>';
}
```

---

## 6) Adição — Faixa de alarme global (continuação do item 2)

* **Página:** todas, via `js/layout.js`.
* **Local:** topo do `<main>`, abaixo do cabeçalho.
* **Problema:** `nexus_emergency_active` só é lido na tela de Manutenção, embora a mensagem diga que as operações do pátio estão bloqueadas.
* **Solução:**

```js
if (localStorage.getItem('nexus_emergency_active') === 'true') {
  document.querySelector('main')?.insertAdjacentHTML(
    'afterbegin',
    `<div
      role="alert"
      class="mb-4 p-3 rounded-xl bg-red-600 text-white text-xs font-bold flex items-center gap-2">
      <span class="material-symbols-outlined text-[18px]">warning</span>
      EMERGÊNCIA ATIVA — operações do pátio bloqueadas temporariamente.
    </div>`
  );
}
```

* **Complemento:** desabilitar **Liberar Saída**, **Autorizar Retorno** e **Movimentar** enquanto o alarme estiver ativo.

> **Status:** ✅ Implementado (a faixa global já existia em `js/panic-realtime.js`, fixa no rodapé de todas as telas). O complemento foi aplicado: `window.nexusEmergenciaAtiva()` (`js/layout.js`) bloqueia **Movimentar**/**Liberar** (`js/cargas.js`) e **Liberar Saída**/**Autorizar Retorno** (`js/embarcacoes.js`), que aparecem desabilitados com o motivo no `title`. Teste: `node tests/test_backlog3_correcoes.js`.

---

## 7) Adições simples

| # | Página           | Local                  | O que adicionar                                                                                                            |
| - | ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| a | Cargas           | Acima da tabela        | Chips de resumo por status (`Agendamento 4 · Armazenagem 3 · Prontas 2…`) que filtram a tabela. Já existe `#filterStatus`. ✅ IMPLEMENTADO (`#cargasStatusChips` em `cargas.html` + `sincronizarCargasChips()`/`atualizarCargasChips` em `js/cargas.js`) |
| b | Todas as tabelas | Acima de cada tabela   | Campo de busca rápida (nome / IMO / ID) e contador **"Exibindo X de Y"**. ✅ IMPLEMENTADO (`#filterBusca`/`#cargasCounter` cargas, `#buscarNavioInput`/`#embarcacoesCounter` embarcações, `#buscarOsInput`/`#osCounter` OS, `#buscarAuditLogInput`/`#auditLogCounter` auditoria) |
| c | Todas as tabelas | Quando vazia           | Estado vazio com ícone e frase útil, por exemplo: **"Nenhuma OS cadastrada. Use + Nova Ordem de Serviço"**. ✅ IMPLEMENTADO (estados vazios com ícone + frase útil em embarcações e OS, incluindo `search_off` quando a busca zera resultados) |
| d | Embarcações      | Coluna ETA             | Barra de progresso da viagem (tempo decorrido ÷ previsto, já calculados em ~273–292). ✅ IMPLEMENTADO (`calcularProgressoViagem()` + barra com `role="progressbar"` na coluna ETA, `js/embarcacoes.js`) |
| e | Painel Geral     | Cabeçalho              | Hora da última atualização, por exemplo **"Atualizado às 14:32"**. ✅ IMPLEMENTADO (`#cardsLastUpdate` em `dashboard.html` + `registrarUltimaAtualizacao()` em `js/dashboard.js`) |
| f | Painel Geral     | Planilha de desempenho | Botão **Exportar CSV**. ✅ IMPLEMENTADO (`#exportIndicadoresCsvBtn` em `dashboard.html` + exportação `;`/BOM em `js/dashboard.js` com trilha `EXPORTACAO_CSV`) |
| g | Relatórios       | Topo                   | Atalhos de período (**Hoje · 7 dias · 30 dias · Este mês**). ✅ IMPLEMENTADO (`#relatorioPeriodoChips` em `relatorios.html` + `aplicarPeriodo()`/`inicioDoPeriodo()` filtram a produtividade em `js/relatorios.js`) |
| h | Manutenção       | Tabela de OS           | Filtro por status (**Todas · Pendentes · Em manutenção · Concluídas**). ✅ IMPLEMENTADO (`#osStatusChips` em `manutencao.html` + toggle `filtroStatusOsAtual` em `js/manutencao.js`, com re-clique limpando o filtro) |
| i | Cargas / Scanner | Etiqueta QR            | Botão **Imprimir etiqueta** (`window.print()` + CSS `@media print`). ✅ IMPLEMENTADO (`#imprimirEtiquetaScanBtn` + `@media print` isolando `#qrResultCard` no scanner; `@media print` isolando `#qrModal` nas cargas; trilha `REIMPRESSAO_ETIQUETA`) |

---

## 8) Ajustes visuais (sem mudar o que já existe)

| # | Página           | Local                                     | Ajuste                                                                                                                                                                                   | Exemplo                                                                                                      |
| - | ---------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1 | Todas (menu)     | Menu lateral no celular                   | O menu abre por cima do conteúdo e esconde o título; adicionar fundo escurecido que fecha ao tocar fora.                                                                                 | `<div id="navOverlay" class="fixed inset-0 bg-black/40 z-30 hidden"></div>` + `overlay.onclick = fecharMenu` ✅ IMPLEMENTADO (drawer do menu com fundo escurecido que fecha ao tocar fora — ver nota da Seção 1 "Visão Geral da Tela") |
| 2 | Todas as tabelas | Container das tabelas                     | No celular a tabela rola para o lado sem aviso; incluir dica de rolagem.                                                                                                                 | `<p class="sm:hidden text-[10px] text-slate-400">Deslize para ver mais →</p>` ✅ IMPLEMENTADO (`aplicarHintDeRolagemTabelas()` em `js/layout.js`: distintivo "Deslize" sobre `.overflow-x-auto` no mobile, some após o primeiro scroll, `MutationObserver` cobre renders tardios) |
| 3 | Painel Geral     | Cards de indicadores                      | Os cards são `<div onclick>` e não funcionam com teclado nem leitor de tela; trocar por `<button>`.                                                                                      | `<button type="button" onclick="..." class="text-left ...">` ✅ IMPLEMENTADO (os 7 cartões viraram `<button type="button">` com `focus-visible:ring-2`, `title` descritivo e valor inicial `--` até a primeira consulta ao banco) |
| 4 | Todas            | Botões só com ícone                       | Falta `aria-label` e foco visível.                                                                                                                                                       | `focus-visible:ring-2 focus-visible:ring-nexus-500 focus-visible:outline-none` ✅ IMPLEMENTADO (`aria-label` + `focus-visible:ring-2` nos componentes compartilhados — modais de feedback/confirm em `js/layout.js` e botões-ícone de ações nas tabelas, itens 3.3/3.5) |
| 5 | Todas            | Textos de 10–11 px                        | Muito pequenos; subir rótulos de status e textos de apoio para 12 px.                                                                                                                    | `text-xs` no lugar de `text-[10px]` ✅ IMPLEMENTADO (badges de status/etiquetas dinâmicos subiram de `text-[10px]` para `text-xs` em cargas, embarcações, contêineres, guindastes, OS e auditoria) |
| 6 | Manutenção       | Select "Equipamento / Ativo"              | O código faz `innerHTML += '<optgroup>'` e depois `+= '</optgroup>'`; o navegador fecha o grupo sozinho e as opções ficam fora dele (grupos aparecem vazios). Montar o grupo de uma vez. | —                                                                                                            |
| 7 | Todas            | Mensagens de feedback (`mostrarFeedback`) | Padronizar tempo na tela (4–5 s), botão fechar e ícone por tipo.                                                                                                                         | — ✅ IMPLEMENTADO (feedbacks `sucesso`/`info` auto-fecham em 5 s via `__nexusFeedbackTimer` em `js/layout.js`; erros/alertas exigem reconhecimento; modal já tinha ícone por tipo e botão fechar) |
| 8 | Todas            | Datas                                     | Padronizar `dd/mm/aaaa` (a tabela de OS mostra `2026-09-27` ou "N/A").                                                                                                                   | `new Date(os.data).toLocaleDateString('pt-BR')` ✅ IMPLEMENTADO (datas padronizadas `dd/mm/aaaa` na tabela de OS — ver item 3.1/8.8) |

### Código do ajuste 6 — `carregarEquipamentosEAlertas` (`js/manutencao.js`)

> **Status:** ✅ Implementado em `js/manutencao.js`: cada `<optgroup>` é montado de uma só vez (`optGroup()`), então as opções voltam a aparecer dentro dos grupos "Guindastes & Pórticos" e "Contêineres".

```js
const optGroup = (label, itens) =>
  itens.length
    ? `<optgroup label="${label}">
        ${itens.map(i =>
          `<option value="${i.valor}">${i.rotulo}</option>`
        ).join('')}
       </optgroup>`
    : '';

osSelect.innerHTML =
  '<option value="">Selecione o Equipamento / Ativo...</option>' +
  optGroup(
    'Guindastes & Pórticos',
    gnds.map(g => ({
      valor: `Guindaste ${g.identificacao || g.id}`,
      rotulo: `Guindaste ${g.identificacao || g.id}`
    }))
  ) +
  optGroup(
    'Contêineres',
    conts.map(c => ({
      valor: `Contêiner ${c.identificacao}`,
      rotulo: `Contêiner ${c.identificacao}`
    }))
  );
```
