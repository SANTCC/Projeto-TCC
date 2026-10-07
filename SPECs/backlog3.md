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
> **Alerta no aparelho (vibração/som):** o celular também vibra — padrão SOS no acionamento e pulsos a cada 3s enquanto o alarme estiver ativo. Como `navigator.vibrate()` não existe em nenhum navegador do iPhone, exige https://, exige interação do usuário e aba visível, o módulo `js/haptics.js` trata cada caso: overlay do switch nativo do Safari no botão SOS (haptics reais no iOS, inclusive 26.5+), switch acionado por script no iOS 17.4–26.4, e alerta sonoro sempre que a vibração for impossível. O rodapé informa o motivo quando o aparelho não vibra e o painel "Alerta no Aparelho" (`manutencao.html`) traz diagnóstico + botão de teste. Teste: `node tests/test_haptics.js`.
