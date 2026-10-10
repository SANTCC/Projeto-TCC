---
id: visao-geral
title: Visão geral da arquitetura
sidebar_label: Visão geral
description: Como o NexusPort é montado — front-end estático, Supabase como back-end, Edge Functions, tempo real, camada de agentes e ferramentas de automação.
---

# Visão geral da arquitetura

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ NAVEGADOR (funcionário do terminal)                                          │
│                                                                              │
│  *.html (13 telas)  ──  Tailwind CDN + fonts + libs (Chart.js, QRCode,       │
│                          html5-qrcode, jsPDF)                                │
│      │                                                                       │
│      ├── js/pages/*.js         controlador de cada tela                      │
│      ├── js/auth-guard.js      sessão (cookie) + RBAC (páginas e ações)      │
│      ├── js/vision-layer.js    filtros por camada de visão                   │
│      ├── js/data-repository.js leitura/escrita + Realtime + cache local      │
│      ├── js/security.js        codificação de saída (anti-XSS)               │
│      ├── js/layout.js          sidebar, topbar, tema, modal, feedback        │
│      ├── js/panic-realtime.js  pânico global (WebSocket + fallback)          │
│      └── js/webmcp/*           14 módulos de ferramentas para agentes de IA   │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │  HTTPS (somente chave publishable/anon)
               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ SUPABASE                                                                     │
│  PostgREST  →  PostgreSQL (25 tabelas, RLS, gatilhos, auditoria)             │
│  Realtime   →  WebSocket (postgres_changes) + Presence (nexus-online)        │
│  Storage    →  bucket privado relatorios-pdf (cache por SHA-256)             │
│  Functions  →  6 Edge Functions Deno (service role, RBAC próprio)            │
└──────────────────────────────────────────────────────────────────────────────┘

        FERRAMENTAS (fora do runtime do app)
        tools/build.js · tools/lighthouse-check.js · tools/xss-scan.js
        tools/screenshots/* (Puppeteer + PostgREST simulado) · tests/* · website/
```

---

## 1. Decisões arquiteturais e por quê

| Decisão | Motivo | Consequência |
| --- | --- | --- |
| **Sem bundler** (sem React/Vue/Vite/Webpack/TS no app) | restrição explícita de `SPECs/agents.md`; o deploy é estático puro | páginas abrem direto, build é só minificação, zero etapa de compilação obrigatória |
| **Tailwind por CDN com tokens inline** | manter o Design System em um só lugar (config no `<head>`) | primeira pintura depende da rede; item do backlog 004 (1.3) |
| **Login próprio por código individual** (não Supabase Auth) | o domínio não tem e-mail/senha; a credencial é funcional | o PostgREST sempre vê a role `anon`; RLS precisa ser permissiva e a autorização real acontece na aplicação + Edge Functions |
| **RLS ligado em todas as tabelas** | exigência da Spec | defesa em profundidade: mesmo com a chave publishable, políticas restringem o que trafega |
| **Edge Functions com `verify_jwt = false`** | não há JWT de Supabase Auth | cada função valida o código individual internamente (RBAC no servidor) |
| **Repositório de dados central** (`data-repository.js`) | eliminar `fetch` espalhado e fallbacks fictícios | um ponto para Realtime, cache, auditoria e mensagens de erro |
| **Codificação de saída obrigatória** (`security.js`) | o app renderiza tabelas via `innerHTML` | anti-XSS consistente, varrido por `tools/xss-scan.js` e testes |
| **Sessão em cookie** (`session-cookies.js`) | praticidade para o operador (12 h de turno) | cookies de JS não são `HttpOnly`; mitigação é a codificação de saída (limitação declarada) |
| **WebMCP com confirmação fail-closed** | agentes de IA podem errar/sofrer injeção | ação consequente só executa com evento real de clique/toque do operador |

---

## 2. Camadas e responsabilidades

| Camada | Arquivos | Responsabilidade | Não faz |
| --- | --- | --- | --- |
| Apresentação | `*.html` | estrutura semântica, ids, formulários, modais | não contém regras de negócio |
| Controle de tela | `js/pages/*.js` | carregar dados, montar tabelas, validar entradas, chamar o repositório | não acessa o Supabase diretamente (passa pelo repositório) |
| Sessão e RBAC | `auth-guard.js`, `session-cookies.js` | validar sessão, cargo e permissões | não decide regra de negócio |
| Visão | `vision-layer.js` | recortar dados por camada (Própria/Operacional/Estratégica) | não grava |
| Dados | `data-repository.js`, `supabase-client.js` | CRUD, cache local, Realtime, tratamento de PGRST205 | não renderiza |
| Segurança | `security.js` | codificação de saída | não valida regra de negócio |
| Layout | `layout.js` | sidebar, topbar, presença, tema, modal, feedback inline | não carrega dados de domínio |
| Agentes | `js/webmcp/*` | expor/validar ferramentas e confirmar ações | não cria caminho alternativo de escrita |
| Servidor | `supabase/functions/*` | PDF, despacho, KPIs, QR, log de acesso, pânico | não serve HTML |

---

## 3. Fluxo de uma operação típica (registrar recebimento)

1. O Conferente entra (`index.html` → `confirm-role.html`) e ganha o cookie `nexus_session`.
2. Abre `cargas.html`; `auth-guard.js` valida que `CONFERENTE_CARGA` pode abrir a página.
3. `js/pages/cargas.js` pede a lista ao repositório, que filtra pela camada de visão e pelos vínculos
   do usuário (Visão Própria).
4. O botão **Registrar recebimento** só é renderizado se `hasPermission('REGISTRAR_RECEBIMENTO')`.
5. Ao gravar, o repositório envia a mutação com o **código individual** do autor; o RLS decide no banco e
   o gatilho de auditoria registra em `logs_alteracoes` (`CRIACAO`/`EDICAO`).
6. A mudança volta por Realtime para as outras abas conectadas (debounce de 400 ms) e as telas se
   recarregam; a sincronização de segurança roda a cada 60 s.
7. A tela mostra um **banner inline** de sucesso — nunca um toast flutuante (não-requisito 5).

---

## 4. Mapa de leitura

| Quero entender… | Página |
| --- | --- |
| A estrutura da pasta `js/` | [Módulos JavaScript](/arquitetura/modulos-javascript) |
| Cada tela do sistema | [Páginas](/arquitetura/paginas) |
| Como os dados são lidos e gravados | [Dados e repositório](/arquitetura/dados-e-repositorio) |
| O que roda no Supabase | [Back-end Supabase](/arquitetura/supabase) |
| As funções Deno | [Edge Functions](/arquitetura/edge-functions) |
| Realtime, Presence e pânico | [Tempo real e presença](/arquitetura/tempo-real-e-presenca) |
| Os agentes de IA | [WebMCP](/arquitetura/webmcp) |
