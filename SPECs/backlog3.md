# TODOs

## Área de gráficos (UI) — ✅ IMPLEMENTADO
Lugar simples aonde o Diretor de Operações pode observar comparações de dados do sistema, gráficos comparando informações como "% de berços operacionais".

> **Entregue:** painéis Chart.js por camada de visão no Painel Geral (`dashboard.html`) e em Relatórios (`relatorios.html`), incluindo "% de berços operacionais", fila de liberação, tempo médio de permanência, produtividade por cargo, embarcações mais utilizadas e valor declarado (exclusivo da Direção/Conselho). Módulo: `js/charts.js` · Teste: `node tests/test_graficos_por_cargo.js`.

## Auto-complete de - no login (UX)
Quando digitar um login, auotmaticamente insira um - quando o usuario pressionar um numero, de forma que se ele já digitou MAT e apertar 1, ele completa pra MAT-1.

## Botão de Pânico ser global ✅ IMPLEMENTADO
Quando o botão de pânco ser ativado, exibir uma mensagem no rodapé da tela informando que está ocorrendo uma emergência.

> **Status:** Implementado. O botão existente (`manutencao.html`) dispara a Edge Function `panic-alert` (`supabase/functions/panic-alert/index.ts`), que faz broadcast via WebSocket (Supabase Realtime, canal `nexus-emergency`) para todos os clientes conectados e dispara um webhook OPCIONAL (desativado por padrão, tabela `panic_webhook_config`). Todos os clientes exibem a mensagem de emergência fixa no rodapé da tela (`js/panic-realtime.js`). Deploy: `supabase db push` + `supabase functions deploy panic-alert --no-verify-jwt`.
>
> **Alerta no aparelho (vibração/som):** clientes compatíveis podem vibrar com o padrão SOS no acionamento e pulsos a cada 3s enquanto o alarme estiver ativo. A Vibration API exige contexto seguro, sticky user activation e documento visível; Safari/WebKit no iOS e Firefox 129+ não oferecem essa API. Não há workaround web confiável nesses navegadores, então o sistema usa alerta sonoro (quando o navegador permite) e banner visual. `js/haptics.js` valida e normaliza os padrões conforme a especificação, mostra o diagnóstico e oferece controles de preferência/teste em `manutencao.html`. Teste: `node tests/test_haptics.js`.

## Barra de Menu lateral não fica grudada na tela quando scrolla
Ela parece não ficar parada quando scroll, tanto no PC, quanto no celular.

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

## Impedir vinculação de carga a navio fora do Porto de Santos
Não deve ser possível vincular uma carga a um navio que esteja atualmente **fora do Porto de Santos**.

> **Regra:** a seleção de navios para vinculação de cargas deve considerar a localização/status atual da embarcação e disponibilizar somente navios que estejam no Porto de Santos e aptos para receber cargas.

## Impedir movimentação de carga em trânsito
Uma carga que já esteja **em trânsito** não pode ser movimentada pelo sistema.

> **Regra:** quando a carga estiver em trânsito, as ações de movimentação devem ficar bloqueadas/desabilitadas. O sistema deve informar que a carga não pode ser movimentada enquanto estiver em trânsito.

## Corrigir momento em que a carga entra em trânsito
Atualmente a carga passa a aparecer como **em trânsito** quando o botão **"Pronto para entrega"** é acionado, mas esse comportamento está incorreto.

> **Regra:** uma carga só deve entrar no estado **em trânsito quando o navio for efetivamente liberado**. O botão **"Pronto para entrega"** não deve alterar o status da carga para trânsito.
>
> **Fluxo esperado:** carga preparada → pronta para entrega → navio liberado → carga em trânsito.

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
