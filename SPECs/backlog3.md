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

## Salvar o login com Cookies ao invés de SESSION_STORAGE ✅ IMPLEMENTADO
A não ser que haja problemas de segurança, usar Cookies parece mais prático para usuários.

> **Status:** ✅ Implementado. A sessão (`nexus_session`) e a identificação pendente da confirmação de cargo (`nexus_pending_auth`) ficam **somente em cookies**, geridos por `js/session-cookies.js` (carregado antes do `auth-guard.js` em todas as telas, inclusive `index.html` e `confirm-role.html`). Atributos: `path=/`, `SameSite=Lax`, `max-age` de **12 h** (turno) para a sessão e **10 min** para a pendência, e `Secure` quando servido por HTTPS. Não há mais leitura nem gravação da sessão em `sessionStorage`/`localStorage`; cópias antigas são apagadas ao entrar e ao sair. A pendência grava só os campos da confirmação (id, matrícula, código, nome, cargo). O vigia do `auth-guard.js` (a cada 60 s) encerra sessões com mais de 12 h. **Decisão:** quem tinha sessão nas versões anteriores precisa fazer login de novo uma vez. **Limitação declarada:** cookies gravados por JavaScript não podem ser `HttpOnly`; a proteção contra XSS continua sendo a codificação de saída (`js/security.js`). Teste: `node tests/test_sessao_cookies.js` (também em `npm run test:backlog3`).

## PDF renderizado no lado do servidor ao invés do lado do cliente + cache/armazenamento no supabase storage ✅ IMPLEMENTADO
Atualmente, PDFs são renderizados pelo lado do cliente toda a vez que requisistados.

> **Status:** ✅ Implementado. A Edge Function `relatorio-pdf` (`supabase/functions/relatorio-pdf/`) gera o PDF A4 no servidor com `pdf-lib`, com as quatro seções do relatório: dados da carga, do navio, do contêiner e resumo do fluxo. O navegador envia só `carga_id` e `codigo_individual`. O servidor lê os dados no Supabase com a chave de serviço, valida funcionário ativo e cargo (o mesmo cargo de `relatorios.html`) e devolve o arquivo. O cache usa o SHA-256 do modelo como nome do arquivo (`<hash>.pdf`) no bucket privado `relatorios-pdf` (migração `20261009010000`): mesmo conteúdo reaproveita o arquivo (`X-Relatorio-Cache: HIT`), e dado alterado gera novo hash. Falha na gravação do cache não impede o PDF. **Dados fictícios removidos:** peso 25 t, volume 40 m³, valor R$ 100.000, "Destino Internacional", "Carga Geral", estado "OPERANTE" fixo e "Validade da Auditoria". Campo sem valor no banco aparece como "Não informado". O jsPDF saiu de `relatorios.html` (continua em `cargas.html`, para as etiquetas). A exportação agora é auditada com tipo `EXPORTACAO` (migração `20261009020000`); a chamada antiga tinha a ordem de argumentos errada. `window.nexusRelatorioGerarPdf` continua existindo e retorna `true` ou `false`. A ferramenta WebMCP `gerar_relatorio_carga` responde `FALHA_PDF` quando a emissão falha. **Deploy:** `supabase db push` (aplica as duas migrações) e `supabase functions deploy relatorio-pdf --no-verify-jwt`. **Ressalvas:** como no panic-alert, a identidade vem do código informado (o app não usa Supabase Auth); quem conhece o código de um funcionário ativo com cargo permitido consegue emitir o relatório. Não foi testado contra o projeto Supabase real (sem credenciais): a função foi verificada com Deno 2.9 (`deno check` e execução com `npm:pdf-lib`), o handler com cliente falso e as migrações no PostgreSQL local. Teste: `node tests/test_relatorio_pdf.js` (também em `npm run test:relatorio-pdf`).

## Popular cargos ✅ IMPLEMENTADO
Adicionar usuários "mock" pra cada cargo, cada um com nome no formato [CARGO] + "_mock" + [NUMERO (123 OU 321 OU 456)], cada cargo com 2 usuários mocks.

> **Status:** ✅ Implementado. `supabase/seed.sql` cria 20 usuários de demonstração: 2 por cargo do enum `cargo_enum` (10 cargos), com nome `[CARGO]_mock123` e `[CARGO]_mock321`. O acesso é pelo código individual `MOCK-[CARGO]-123` e `MOCK-[CARGO]-321`. Os dados ficam fora do código e das migrações, com aviso de uso: demonstração e desenvolvimento local, nunca produção. É idempotente (`ON CONFLICT DO NOTHING` e ids determinísticos): reexecutar não duplica nada, e um usuário real com a mesma matrícula não é alterado (o mock é pulado). Local: `supabase db reset`. Projeto de demonstração: `psql "$DATABASE_URL" -f supabase/seed.sql`. Teste: `node tests/test_seed_demo.js` (estrutura, também em `npm run test:seed`) e `python tests/verify_seed_demo.py` (PostgreSQL: contagens, idempotência e dados preservados).

## Popular ações ✅ IMPLEMENTADO
Adicionar histórico de mudanças, novos cargas, novos navios, tudo pra fazer isso realmente parecer algo 100% polido.

> **Status:** ✅ Implementado no mesmo seed de demonstração. Inclui 4 navios (dois atracados, um em trânsito e um no porto de destino), 6 contêineres ligados aos navios, 12 cargas cobrindo os 9 status do fluxo (com inspeção aprovada e recusada), 4 tipos de carga, 4 rotas a partir de Santos e 27 registros de histórico (cadastros, edições de status, exportações de PDF e reimpressão de etiqueta), todos atribuídos a usuários mock. Os IMOs 9990001–9990004 e as distâncias das rotas são de demonstração, não de embarcações nem cálculos reais. Teste: `node tests/test_seed_demo.js` e `python tests/verify_seed_demo.py` (PostgreSQL local: 22 verificações).

## Nº de usuários on-line no momento ✅ IMPLEMENTADO
Número de usuários ativos naquele momento, atualizado a cada 30 segundos.

> **Status:** ✅ Implementado. O indicador `#headerOnlineCount` fica no cabeçalho (criado por `js/layout.js`). O módulo `js/online-presence.js` entra no canal Supabase Realtime Presence `nexus-online` com a chave `codigo_individual`, então um mesmo código conta uma vez, mesmo com várias abas ou aparelhos. O número é lido na primeira sincronização e atualizado a cada **30 s**. Sem Supabase, sem sessão ou sem canal sincronizado, mostra **"—"** (nunca um número fictício). O payload leva só o instante de entrada (sem nome nem matrícula). Não exige tabela nem migração. Teste: `node tests/test_presenca_online.js` (também em `npm run test:presenca`).

## Cookie para rastrear cada dispositivo no Google Analytics ✅ IMPLEMENTADO
Cookie para rastrear ações de um mesmo dispositivo usando Cookies, de forma que cuja implementação seja funcional e prática, e que o próprio Google Analytics reconheca nativamente. (sem truques)

> **Status:** ✅ Implementado. O identificador do aparelho é o cookie `_ga` do próprio GA4, gravado pelo gtag.js e reconhecido nativamente pelo Google. A configuração fica em `js/analytics.js` (comum às 12 páginas, que antes tinham snippet inline): `client_storage: 'cookie'`, `SameSite=Lax;Secure` em HTTPS, validade de 2 anos, sem Google Signals e sem personalização de anúncios. Não há fingerprinting (canvas, áudio, fontes, plugins, hardware). `NexusAnalytics.track(evento, parametros)` envia eventos de negócio: `login_confirmado`, `login_falha`, `logout`, `botao_panico_acionado`, `qr_lido`, `inspecao_aprovada` e `inspecao_recusada`. Parâmetros com nome, código, matrícula ou e-mail são descartados, e valores são limitados a 100 caracteres. Se o gtag.js estiver bloqueado, `track` retorna `false` sem erro. **Ressalva:** consentimento de cookies (LGPD) não está implementado; decidir antes da produção se é necessário um aviso. Teste: `node tests/test_analytics.js` (também em `npm run test:analytics`).

## Comprimir JS/CSS antes do deploy ✅ IMPLEMENTADO
Minify.

> **Status:** ✅ Implementado. `npm run build` (`tools/build.js`) gera `dist/`. Os arquivos de `js/` e os blocos `<script>` inline das páginas passam pelo Terser; o CSS (`<style>` inline e arquivos `.css`) passa pelo clean-css. Os caminhos não mudam, então o HTML continua apontando para `js/xxx.js`. Resultado atual: JS 959 KB → 558 KB (−42%), CSS −25%, HTML −3%. `vercel.json` executa o build (`buildCommand`) e publica `dist/` (`outputDirectory`). Testes, ferramentas, SPECs, supabase, THEME (protótipos) e documentação ficam fora da saída. **Decisão:** o deploy passa a depender do build (`buildCommand`), e não do repositório cru. **Ressalvas:** o Tailwind continua carregado do CDN (sem compilação própria); o deploy no Vercel não foi testado (sem acesso ao projeto); e o `.name` de funções anônimas atribuídas a variáveis pode mudar na saída minificada, sem afetar a execução. Teste: `node tests/test_build.js` (também em `npm run test:build`).

## Usar o `GoogleChrome/lighthouse` como workflow pra PRs (localmente, com NodeJS) ✅ IMPLEMENTADO
Falha se for encontrado falhas críticas, roda em todo PR aberto, requisito mínimo de PR.

> **Status:** ✅ Implementado. `.github/workflows/lighthouse.yml` roda em todo PR aberto ou atualizado (`pull_request`, sem segredos, `npm ci` e `npm run lighthouse`) e publica os relatórios como artefato. O mesmo gate roda localmente com Node: `npm run lighthouse` (`tools/lighthouse-check.js`) gera o build de produção, serve `dist/` e mede as 11 páginas de `lighthouse/limiares.json` (desktop, Supabase bloqueado na rede), em 3 rodadas por página: a pontuação é a mediana, e uma auditoria crítica só reprova se falhar na maioria das rodadas, porque o CI compartilhado é ruidoso. Reprova se uma categoria ficar abaixo do mínimo (desempenho 0,60; acessibilidade 0,75; boas práticas 0,90; SEO 0,90) ou se uma das 27 auditorias críticas falhar fora das exceções. As exceções são dívida conhecida, por página: `meta-viewport` (viewport bloqueia o zoom, WCAG 1.4.4), `label`, `select-name` e `aria-dialog-name`. Exceção que já passa gera aviso para ser removida. **Pendência para torná-lo obrigatório:** marcar o check "Lighthouse (PR)" como requisito na proteção da branch `main` (configuração do GitHub, fora do repositório). **Ressalvas:** os mínimos foram calibrados com medição local, sem CDNs externos; recalibrar após as primeiras execuções no CI. O gate depende do Chrome do runner (o ubuntu-latest já traz o Google Chrome). **Calibração:** a primeira medição local foi feita sem os estilos do Tailwind (o CDN não estava acessível), e por isso não mediu o contraste. Com os estilos carregados (CSS do Tailwind compilado a partir das páginas, equivalente ao CDN), a auditoria `color-contrast` reprova nas 11 páginas. Essa dívida virou exceção explícita, e as exceções de label, select-name e aria-dialog-name foram ajustadas à medição estilizada. Medição estilizada: 11 de 11 páginas aprovadas com Chromium 153. O primeiro run do workflow no PR reprovou; confira o log do job no GitHub. Teste: `node tests/test_lighthouse.js` (também em `npm run test:lighthouse`). Com Chrome real: `LIGHTHOUSE_E2E=1 node tests/test_lighthouse.js`.

## Reorganizar arquivos `.JS` ✅ IMPLEMENTADO
WebMCP vai ter sua própria subpasta, arquivos comuns (usados em todas as páginas) ficam no root da pasta, e específicos de subpastas ficam em pages/. (ainda sim dentro do js/)

> **Status:** ✅ Implementado. Os 14 módulos WebMCP estão em `js/webmcp/`; os 13 módulos de página, em `js/pages/`; a raiz de `js/` mantém só os comuns (segurança, guard, sessão em cookies, repositório, cliente Supabase, layout, haptics, vision-layer, net-debug, panic-realtime). Todas as referências `<script src>` dos HTML foram atualizadas e conferidas. Teste: `node tests/test_backlog3_pendentes.js` (seção I).

## Atualização em tempo real das tabelas e indicadores ✅ IMPLEMENTADO
Corrigir os dados exibidos pelas tabelas e indicadores do sistema quando ocorre uma alteração no Supabase, garantindo que todos os painéis sejam atualizados em tempo real e não apresentem dados antigos ou incorretos.

Atualmente existem inconsistências como:
- No Painel Geral aparece que existem **2 equipamentos com manutenções agendadas**, quando na realidade não existe nenhum.
- A tabela de **alterações no sistema** mostra apenas o meu perfil como responsável pelas alterações, enquanto os demais usuários aparecem com **0 alterações**, mesmo quando existem alterações realizadas por eles.
- Verificar se os listeners do Supabase Realtime estão corretamente configurados e se os dados são recarregados após `INSERT`, `UPDATE` e `DELETE`.
- Garantir que os filtros, contadores, tabelas e cards derivados dos dados do Supabase sejam recalculados após cada atualização.
- Evitar inconsistências causadas por cache, estado local desatualizado ou consultas que não sejam refeitas após alterações.

> **Status:** ✅ Implementado.
> - **Equipamentos em manutenção:** o card conta cada equipamento uma única vez e só com ordem de serviço ativa (`SOLICITADA` ou `APROVADA`). Estado de reforma sem OS não conta (era resíduo de fluxo anterior). Regra em `NexusRepository.derivarEquipamentosEmManutencao` (`js/data-repository.js`). A OS de navio passa a gravar `navio_id`, e a manutenção de contêiner grava `EM_REFORMA`, valor válido de `estado_container_enum` (`EM_MANUTENCAO` não existe nesse enum).
> - **Log de alterações:** lido por completo, em páginas. O responsável vem do cadastro (pelo `funcionario_id` ou pelo `codigo_individual` gravado no log). Sem cadastro aparece `Sem cadastro (código)`; sem identificação, `Não identificado`. O nome da sessão deixou de ser usado como fallback.
> - **Produtividade (Relatórios):** funcionários e logs são lidos com paginação (`NexusSupabaseUtils.lerTodasAsLinhas`). O PostgREST corta cada resposta em 1000 linhas; antes disso, os demais usuários apareciam com 0.
> - **Realtime:** `REALTIME_TABLES` cobre as 23 tabelas operacionais, e a migração `supabase/migrations/20261009000000_realtime_publication.sql` as adiciona à publicação `supabase_realtime` (idempotente). Rajadas de mudanças viram uma única notificação `nexus_data_changed` (debounce de 400 ms). Manutenção e Embarcações recarregam do Supabase ao receber o evento.
> - **Atualização de segurança:** polling de **60 s** (`POLLING_SEGURANCA_MS`), com Realtime como mecanismo principal. A documentação antiga citava 10 s; o código já usava 60 s e foi mantido.
> - **Decisão:** o intervalo de 30 s de Relatórios (introduzido no PR #70) foi removido, para não haver dois mecanismos de atualização. A tela é atualizada pelo evento e pela sincronização de 60 s.
> - **Ressalva de implantação:** aplicar a migração no projeto Supabase (`supabase db push`). O Realtime entrega a mudança somente se a role do cliente puder ler a linha (RLS); tabela sem leitura liberada continua coberta pelo polling de 60 s.
> - **Teste:** `node tests/test_tempo_real.js` (também `npm run test:tempo-real`): derivação, leitura paginada com 1158 logs de quatro origens, assinaturas e debounce do Realtime, Painel Geral, Relatórios, Manutenção e Embarcações em páginas reais (inclusive o recarregamento pelo evento `nexus_data_changed`), e conferência da migração contra `REALTIME_TABLES`. Teste de mutação: reintroduzir cada defeito corrigido faz o teste falhar. A migração foi validada à parte em PostgreSQL local (aplicação, aviso para tabela ausente, reaplicação idempotente).

## Remover gráficos duplicados do Painel Geral ✅ IMPLEMENTADO
Os gráficos atualmente aparecem tanto no **Painel Geral** quanto na página **Relatórios & PDF**, gerando duplicação de informações.

Os gráficos funcionam essencialmente como uma forma de relatório e, portanto, devem ficar concentrados na página **Relatórios & PDF**.

> **Objetivo:** remover os gráficos do `dashboard.html`/Painel Geral e manter a visualização gráfica na página `relatorios.html`, evitando duplicidade e deixando o Painel Geral focado em indicadores operacionais em tempo real.

> **Status:** ✅ Implementado. `dashboard.html` não tem mais o painel `#chartsRolePanel`, o botão de atualização nem a biblioteca Chart.js; `dashboard.js` deixou de chamar `NexusCharts`, e `NexusCharts.initDashboard` foi removido de `js/pages/charts.js`. Os gráficos permanecem em `relatorios.html` (`initRelatorios`, grade `#relatoriosChartsGrid`, botão Atualizar). A ferramenta WebMCP `atualizar_graficos` foi movida para a página de Relatórios. Teste: `node tests/test_backlog3_pendentes.js` (seção K), `node tests/test_charts_refresh.js`, `node tests/test_charts_autorefresh.js`.

## Impedir manutenção de navio fora do Porto de Santos
Não deve ser possível registrar ou executar uma manutenção para um navio que esteja atualmente **fora do Porto de Santos**.

> **Regra:** antes de permitir uma manutenção, verificar a localização/status operacional atual do navio. Caso ele esteja fora do porto, bloquear a operação e informar claramente ao usuário o motivo do bloqueio.

> **Status:** Implementado em `js/manutencao.js`. A "Solicitação de Manutenção de Embarcações (Navios)" lista apenas navios com `localizacao = DENTRO_DO_PORTO` (os demais ficam de fora, com o motivo no `title` do select) e o `submit` do formulário bloqueia novamente a operação caso o navio saia do porto entre a abertura e o envio. Teste: `node tests/test_backlog3_correcoes.js`.

## Impedir vinculação de carga a navio fora do Porto de Santos ✅ IMPLEMENTADO
Não deve ser possível vincular uma carga a um navio que esteja atualmente **fora do Porto de Santos**.

> **Regra:** a seleção de navios para vinculação de cargas deve considerar a localização/status atual da embarcação e disponibilizar somente navios que estejam no Porto de Santos e aptos para receber cargas.

> **Status:** ✅ Implementado em `js/pages/cargas.js` e `cargas.html`. O modal de vinculação ganhou o seletor `#vincularNavioSelect`, que lista apenas navios `DENTRO_DO_PORTO` com estado `OPERANTE` (fora de reforma agendada ou em curso). Sem escolha, a carga herda o navio do contêiner. Contêineres de navio inapto, ou de outro navio que não o escolhido, ficam indisponíveis, com o motivo na opção. A confirmação revalida o navio com dados frescos e bloqueia com "Vinculação Bloqueada", inclusive quando o navio sai do porto com o modal aberto. Testes: `node tests/test_webmcp_paginas.js` (bloco L) e `node tests/test_backlog3_pendentes.js` (seção L).

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

## Seleção de rotas marítimas no cadastro de navios ✅ IMPLEMENTADO
No cadastro de navios deve existir uma caixa de seleção contendo **somente as rotas marítimas cadastradas no Supabase**.

> **Objetivo:** utilizar a rota selecionada como fonte oficial para calcular corretamente a **estimativa de chegada (ETA)** e a **distância da viagem**, evitando que esses valores sejam inseridos ou calculados incorretamente de forma manual.
>
> A lista de rotas deve ser carregada diretamente do Supabase e não deve conter rotas fictícias ou opções estáticas que não estejam cadastradas no banco.

> **Status:** ✅ Implementado. Removidas as rotas estáticas (Roterdã, Xangai, Hamburgo) de `js/pages/embarcacoes.js`: o select e a tabela usam somente `rotas_maritimas` do Supabase e exibem mensagem quando estão vazios ou indisponíveis. A distância e o ETA vêm da rota cadastrada (o padrão fixo de 10200 km foi retirado; sem rota, o ETA aparece como indisponível). Uma rota só aparece na tela depois de gravada no Supabase. O WebMCP `cadastrar_navio` deixou de aceitar distância manual, e o destino padrão da liberação de carga em `js/pages/cargas.js` foi removido. Testes: `node tests/test_backlog3_pendentes.js` (seção M) e `node tests/test_webmcp_paginas.js` (rotas marítimas).

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

### 1. Salvar o login com Cookies ao invés de SESSION_STORAGE / LOCAL_STORAGE

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O gerenciamento de sessão da aplicação é realizado no client-side armazenando as informações do funcionário logado em `sessionStorage` e `localStorage` (`js/auth-guard.js` e `js/login.js`). Não foi implementado o armazenamento seguro de autenticação via cookies HTTP-only / SameSite.

### 2. Renderizar PDF no lado do servidor com armazenamento no Supabase Storage

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A geração de relatórios operacionais em PDF continua ocorrendo 100% no navegador do usuário utilizando a biblioteca `jspdf` em `js/relatorios.js`. Não há função server-side (Edge Function / Node) nem integração com buckets de armazenamento do Supabase Storage.

### 3. Popular cargos com usuários mock estáticos

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O sistema opera com os funcionários cadastrados diretamente na tabela `funcionarios` do Supabase. Não foi criado script de população automática com usuários de teste no padrão `[CARGO]_mock[123/321/456]`.

### 4. Popular histórico de ações e movimentações anteriores

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O histórico de auditoria (`logs_alteracoes`) e trail de decisões (`trail_decisoes`) reflete apenas as ações reais realizadas durante a utilização do sistema. Não há rotina de população de histórico prévio simulado de cargas e embarcações.

### 5. Contador de usuários online em tempo real

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O sistema não exibe indicador ou contador de usuários ativos no momento com atualização periódica (ex.: polling a cada 30s ou Supabase Presence).

### 6. Cookie de rastreamento de dispositivo para Google Analytics

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não foi implementada a configuração de cookie próprio/nativo para identificar e rastrear ações por dispositivo no Google Analytics.

### 7. Comprimir / minificar arquivos JS e CSS antes do deploy

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Todos os arquivos em `js/` e arquivos de estilo CSS no repositório permanecem sem etapa de minificação/bundle (ex.: via Terser, UglifyJS ou CleanCSS) no fluxo de deploy.

### 8. Workflow automatizado do Google Chrome Lighthouse para Pull Requests

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não existe pipeline de CI/CD (GitHub Actions) ou script Node.js local que execute o Lighthouse CLI e bloqueie PRs em caso de falhas nas métricas de performance e acessibilidade.

### 9. Reorganizar estrutura da pasta `js/`

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Todos os arquivos JavaScript do projeto estão localizados diretamente na raiz do diretório `js/`. Não foi criada a divisão em subpastas (`js/webmcp/`, `js/common/` e `js/pages/`).
