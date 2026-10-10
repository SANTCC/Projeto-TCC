---
id: tempo-real-e-presenca
title: Tempo real, presença e pânico
sidebar_label: Tempo real e presença
description: Como o Supabase Realtime sincroniza as telas, conta usuários on-line e espalha o alarme de emergência para todos os clientes.
---

# Tempo real, presença e pânico

O NexusPort usa Supabase Realtime em **três frentes independentes**:

| Frente | Canal / mecanismo | Módulo | Efeito visível |
| --- | --- | --- | --- |
| Sincronização de dados | `postgres_changes` por tabela | `js/data-repository.js` | a tela recarrega quando um registro muda |
| Contador de usuários | Presence `nexus-online` | `js/online-presence.js` | número no cabeçalho, atualizado a cada 30 s |
| Emergência | Broadcast `nexus-emergency` + tabela `emergencias` | `js/panic-realtime.js` | banner fixo no rodapé de todas as telas + alerta tátil |

---

## 1. Sincronização de dados

```javascript
// js/data-repository.js (resumo)
NexusRepository.REALTIME_TABLES.forEach((tabela) => {
  channel.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, () => {
    if (this._realtimeDebounce) clearTimeout(this._realtimeDebounce);
    this._realtimeDebounce = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nexus_data_changed', {
        detail: { entity: tabela, origem: 'realtime' }
      }));
    }, 400);
  });
});
```

Decisões relevantes:

- **Debounce de 400 ms:** uma rajada de mudanças (ex.: liberar um navio com 12 cargas) vira **uma única**
  notificação;
- **Sem retransmissão por BroadcastChannel:** cada aba tem sua própria assinatura, o que evita loops e
  avisos duplicados entre abas do mesmo dispositivo;
- **Sincronização de segurança a cada 60 s:** mesmo sem evento (Realtime não publicado, rede instável), as
  telas voltam ao estado correto;
- **Sem notificação ao usuário** por causa de mudança de dados: o requisito 5 da Spec proíbe alertas
  instantâneos; a atualização é silenciosa.

:::warning Pré-requisito
A publicação `supabase_realtime` precisa incluir as tabelas operacionais —
`supabase db push` aplica `20261009000000_realtime_publication.sql`. Sem ela, o canal conecta mas não
recebe eventos. Teste: `npm run test:tempo-real`.
:::

---

## 2. Contador de usuários on-line (Presence)

- Canal **`nexus-online`**; a chave de presença é o **`codigo_individual`**, então o mesmo funcionário
  conta **uma vez**, mesmo com várias abas ou aparelhos;
- O payload leva apenas o instante de entrada — **sem nome e sem matrícula**;
- O número é lido na primeira sincronização e atualizado a cada **30 s**;
- O indicador `#headerOnlineCount` é criado pelo `js/layout.js`;
- Sem Supabase, sem sessão ou sem canal sincronizado, mostra **—**: nunca um número estimado ou fictício;
- Não exige tabela nem migração.

Teste: `npm run test:presenca`.

---

## 3. Botão de pânico global

```text
[ operador aciona o pânico em qualquer tela ]
              │
              ▼
   Edge Function "panic-alert"  (RBAC ACIONAR_EMERGENCIA + persistência)
              │
              ├── grava/atualiza `emergencias` (ATIVA → RESOLVIDA)   ← fonte da verdade
              ├── broadcast no canal Realtime "nexus-emergency"      ← entrega imediata
              └── webhook OPCIONAL (só se enabled = true e URL válida)
              │
              ▼
   TODOS os clientes conectados: banner fixo no RODAPÉ + vibração/áudio
```

- **Fallback:** se a Edge Function não estiver implantada ou o Supabase não responder, o próprio módulo
  faz o broadcast direto pelo canal Realtime (cliente → clientes) e mantém o estado localmente;
- **Estado global:** quem conecta **depois** do acionamento consulta `emergencias` e vê o alarme ativo do
  mesmo jeito;
- **Resolução:** o operador autorizado desativa a emergência, o estado passa a `RESOLVIDA` e o banner some
  em todas as telas;
- **Feedback tátil e sonoro** (`js/haptics.js`): vibração em padrão SOS e aviso sonoro quando o aparelho
  suporta; as limitações da Vibration API (HTTPS/localhost, página visível, interação prévia, ausência de
  suporte no Safari/iOS) estão documentadas no próprio módulo e na página de teste;
- **Sem webhook no cliente:** o painel que existia em `manutencao.html` foi removido. O disparo opcional
  permanece exclusivo da função, desativado por padrão em `panic_webhook_config`, e qualquer alteração é
  feita direto no banco (SQL Editor).

Página de diagnóstico: `teste-vibracao.html` ([captura](/#)). Testes: `npm run test:panic`,
`npm run test:haptics`, `npm run test:vlibras`.

---

## 4. Ferramentas de diagnóstico de rede

`js/net-debug.js` instrumenta o cliente para logar **todas** as conexões do app:

| Escopo | O que registra |
| --- | --- |
| HTTP (REST, Auth, Functions, Storage) | método, URL decodificada com filtros, headers, corpo, arquivo/linha que chamou, tempo, status, headers de resposta, prévia do corpo, contagem de linhas e **dicas** para os erros comuns |
| WebSocket (Realtime) | conexão, abertura, fechamento (com o significado do código), erros e mensagens |

É o primeiro lugar a olhar com `PGRST205`, `22P02`, `23514` ou preflight CORS. Teste:
`npm run test:net-debug`.

---

## 5. Limites conscientes do desenho

| Situação | Comportamento aceito |
| --- | --- |
| Realtime indisponível | telas atualizam pela sincronização de 60 s |
| Presença indisponível | contador mostra `—` |
| Pânico sem Edge Function | broadcast direto funciona; a persistência em `emergencias` fica local |
| Abas múltiplas do mesmo usuário | contam uma presença; recebem o mesmo evento de dados sem duplicar avisos |
| Sem conexão | o app permanece navegável; escritas falham com mensagem inline |
