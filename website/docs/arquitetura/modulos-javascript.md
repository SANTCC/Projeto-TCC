---
id: modulos-javascript
title: Módulos JavaScript
sidebar_label: Módulos JavaScript
description: Os 41 módulos de js/ — núcleo, controladores de tela e camada WebMCP — com responsabilidade, dependências e testes.
---

# Módulos JavaScript

`js/` tem **41 módulos**: 14 no núcleo, 13 controladores de tela em `js/pages/` e 14 na camada de agentes
em `js/webmcp/`. Todos são IIFEs que penduram uma API em `window` (`NexusAuth`, `NexusRepository`,
`NexusVision`, …) e não usam `import`/`export` — a integração é por ordem de carregamento e por eventos.

---

## 1. Núcleo (`js/`)

| Módulo | Linhas | Expõe | Responsabilidade |
| --- | --- | --- | --- |
| `security.js` | 188 | `nexusEsc`, `nexusJsArg`, `nexusSafeUrl`, `NexusSecurity` | Codificação de saída obrigatória antes de qualquer HTML/interpolação. Detalhes em [Anti-XSS](/seguranca/anti-xss) |
| `session-cookies.js` | 135 | `NexusSessionCookies` | Única porta de leitura/gravação dos cookies `nexus_session` (12 h) e `nexus_pending_auth` (10 min) |
| `supabase-client.js` | 643 | `NexusSupabase`, `NexusSupabaseUtils` | Cria o cliente (`@supabase/supabase-js`) com as credenciais de `js/config.js`; utilitários de resiliência para tabelas ausentes (PGRST205); `normalizarBerco` |
| `auth-guard.js` | 289 | `NexusAuth` | Sessão, `PAGE_PERMISSIONS` (9 páginas), `ACTION_PERMISSIONS` (20 ações), tema salvo, vigia de 60 s, elevação por delegação |
| `data-repository.js` | 898 | `NexusRepository` | CRUD centralizado, caches, `nexus_data_changed`, assinatura Realtime das 21 tabelas (`REALTIME_TABLES`) |
| `vision-layer.js` | 296 | `NexusVision` | Aplica as três camadas de visão nas consultas e nos indicadores |
| `layout.js` | 722 | — | Sidebar, topbar, contador de presença, alternância de tema, `nexusConfirm`, `mostrarFeedback`, botão de pânico |
| `panic-realtime.js` | 1187 | `NexusPanic` | Pânico global: Edge Function → broadcast → banner fixo no rodapé; fallback direto pelo Realtime; estado em `emergencias` |
| `haptics.js` | 555 | `NexusHaptics` | Vibração (Vibration API) e áudio do alerta; padrões validados (máx. 10 entradas, 10 000 ms) e preferências |
| `online-presence.js` | 154 | `NexusOnlinePresence` | Contador de usuários on-line no canal Presence `nexus-online`, atualizado a cada 30 s |
| `analytics.js` | 85 | `NexusAnalytics` | Eventos de uso (GA4) sem dados pessoais; cookie `_ga` como identificador de dispositivo |
| `net-debug.js` | 969 | `window.__nexusNet` | Console de diagnóstico de rede: loga HTTP (REST/Auth/Functions/Storage) e WebSocket com método, URL, filtros, status, corpo, contagem de linhas e dicas de erro |
| `config.example.js` | 9 | `window.NEXUS_CONFIG` | Modelo versionado de configuração (copiar para `config.js`) |
| `config.js` | 9 | `window.NEXUS_CONFIG` | Credenciais locais — **não versionado** (`.gitignore`) |

---

## 2. Controladores de tela (`js/pages/`)

| Módulo | Linhas | Tela | O que faz |
| --- | --- | --- | --- |
| `login.js` | — | `index.html` | valida o código individual em `funcionarios`, grava a pendência no cookie e encaminha para a confirmação |
| `confirm-role.js` | — | `confirm-role.html` | lê a pendência, exibe cargo/nível/camada (somente leitura) e converte a pendência em sessão |
| `dashboard.js` | — | `dashboard.html` | cards de KPI, detalhamento por card, auditoria recente e trilha de decisões |
| `charts.js` | 2052 | `dashboard.html` | Gráficos Chart.js recortados por camada de visão; atualização automática a 60 s e recarga manual |
| `cargas.js` | 1720 | `cargas.html` | Fluxo completo de 8 etapas, validação de pré-requisitos, geração de QR Code em tempo real, etiquetas A4/10×10, ações por cargo |
| `inspecao.js` | — | `inspecao.html` | Checklist por tipo de carga, itens críticos, progresso e decisão de aprovação/recusa |
| `embarcacoes.js` | — | `embarcacoes.html` | Navios, contêineres, guindastes, berços, rotas, GPS/ETA e estados operacionais |
| `manutencao.js` | — | `manutencao.html` | Ordens de serviço (solicitação, aprovação, recusa, conclusão), guindastes e botão de pânico |
| `delegacao.js` | — | `delegacao.html` | Designação do substituto (com CPF e nascimento), vigência e revogação |
| `tecnico_portos.js` | — | `tecnico_portos.html` | Funcionários, visitantes, documentos e reemissão de código individual (RN 15) |
| `relatorios.js` | — | `relatorios.html` | Busca com 5 filtros, exportação de histórico e emissão do PDF A4 no servidor |
| `scanner.js` | — | `scanner.html` | Leitura por câmera (`html5-qrcode`) ou entrada manual, com registro de leitura |
| `tipos-carga.js` | — | `tecnico_portos.html` / `cargas.html` | CRUD de tipos de carga e modelos de checklist |

---

## 3. Camada WebMCP (`js/webmcp/`)

| Módulo | Linhas | Papel |
| --- | --- | --- |
| `webmcp-core.js` | 1414 | Núcleo: API nativa (`document.modelContext`), adaptador legado (`navigator.modelContext`) e polyfill próprio; registro por página, RBAC, validação estrita, confirmação, saída higienizada, limites, fila serial, JSON-RPC (MCP) e formulários declarativos |
| `webmcp-ui.js` | 361 | Diálogo de confirmação (fail-closed, `isTrusted`, expira em 60 s) e painel "Agentes IA" (chave de desligamento, ferramentas da página, atividade) |
| `webmcp-dados.js` | 455 | Leitores compartilhados: devolvem só os campos necessários, formatados como na interface; nunca expõem código individual, CPF, documentos ou matrícula de autoria |
| `webmcp-global.js` | 288 | Ferramentas de todas as telas (`obter_sessao`, `ir_para_pagina`, `alternar_tema`, `sair_do_sistema`…), recursos `nexus://…` e prompts MCP (`resumo_turno`, `pendencias_inspecao`) |
| `webmcp-cargas.js` | 544 | Cargas & Pátio: leitura + agendar, receber, movimentar, pronta para entrega, vincular, liberar, cancelar |
| `webmcp-inspecao.js` | 236 | Checklist técnico: aplica respostas pelos mesmos controles da tela e só então aprova/recusa |
| `webmcp-embarcacoes.js` | 703 | Navios, contêineres, guindastes, berços e rotas, com validação de IMO/GPS |
| `webmcp-manutencao.js` | 237 | Ordens de serviço; o formulário de manutenção de navio é apenas **preenchido** pelo agente |
| `webmcp-delegacao.js` | 104 | Designação de substituto **sem** CPF/nascimento (o operador completa) e revogação com confirmação |
| `webmcp-tecnico.js` | 290 | Gestão de pessoas: cadastros preenchidos sem documento; reemissão de código só na tela do operador |
| `webmcp-relatorios.js` | 88 | Geração de PDF (leitura) e exportação CSV restrita à Direção (consequente) |
| `webmcp-scanner.js` | 48 | Interpreta a leitura de QR aceitando apenas identificadores (`^[A-Za-z0-9._-]{3,80}$`) |
| `webmcp-dashboard.js` | 164 | Indicadores, trilha e auditoria — tudo somente leitura |
| `webmcp-vibracao.js` | 63 | Página pública de teste de vibração (`teste-vibracao.html`) |

Documentação completa da camada: [WebMCP](/arquitetura/webmcp) ·
[Catálogo das 72 ferramentas](/arquitetura/webmcp-ferramentas).

---

## 4. Como os módulos conversam

```text
                       ┌───────────────────────┐
   clique do operador  │  js/pages/<tela>.js   │
   ───────────────────▶│  (controlador)        │
                       └───────┬───────────────┘
                               │ lê/grava
                               ▼
                     ┌─────────────────────────┐
                     │  NexusRepository        │  ← cache local + Realtime
                     │  (data-repository.js)   │
                     └───────┬─────────────────┘
                             │ supabase-js (anon key)
                             ▼
                        PostgREST / PostgreSQL

   evento de domínio:  window.addEventListener('nexus_data_changed', ...)
   evento global:      'nexus_emergency_update'  (panic-realtime.js)
```

Toda escrita relevante também dispara **auditoria** e, nas ações críticas, **trilha de decisões** — o
caminho é o mesmo, venha a chamada do operador ou de um agente de IA.

---

## 5. Testes por módulo

| Módulo | Teste |
| --- | --- |
| `security.js` | `npm run audit:xss` (`tools/xss-scan.js` + `tests/xss.test.js`) |
| `auth-guard.js`, `session-cookies.js` | `npm run test:sessao`, `test_backlog3_*` |
| `data-repository.js` | `npm run test:single-flight`, `test:cargas-loop`, `test:tempo-real` |
| `layout.js` | `npm run test:backlog3`, `test:screenshots` |
| `panic-realtime.js` + `haptics.js` | `npm run test:panic`, `test:haptics` |
| `charts.js` | `npm run test:graficos`, `test:refresh`, `test:autorefresh` |
| `analytics.js` | `npm run test:analytics` |
| `online-presence.js` | `npm run test:presenca` |
| `net-debug.js` | `npm run test:net-debug` |
| `webmcp/*` | `npm run test:webmcp` (223 + 102 verificações) |
| Todos | `tests/test_suite_completa.js` |

Ver [Testes](/operacao/testes).
