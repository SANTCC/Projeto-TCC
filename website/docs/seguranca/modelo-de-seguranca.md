---
id: modelo-de-seguranca
title: Modelo de segurança
sidebar_label: Modelo de segurança
description: Fronteiras de confiança, autenticação, autorização em seis camadas, auditoria, riscos aceitos e o que está fora de escopo.
---

# Modelo de segurança

O NexusPort é um sistema **interno** de um terminal portuário, com dados operacionais e dados pessoais
(CPF, documentos de visitantes, matrículas). O modelo de segurança tem quatro pilares: **identidade
funcional**, **RBAC em camadas**, **codificação de saída** e **trilha imutável**.

---

## 1. Fronteiras de confiança

```text
[ navegador do funcionário ]  ← confiável apenas para SI MESMO
        │  HTTPS + chave publishable (anon)
        ▼
[ PostgREST/PostgreSQL ]      ← confiável: valida RLS, constraints e gatilhos
        ▲
        │  service role (somente no servidor)
[ Edge Functions (Deno) ]     ← confiável: valida codigo_individual + cargo
```

Nada do navegador é considerado confiável: dados de sessão, retorno de consultas, texto lido de QR Code,
campos de formulário e payload de agente de IA passam por validação **e** codificação antes de qualquer
renderização.

---

## 2. Autenticação (por que é própria)

| Item | Decisão |
| --- | --- |
| Mecanismo | **código individual** vinculado à matrícula, validado em `funcionarios` (ativo) |
| Por que não Supabase Auth | o domínio não tem e-mail/senha; a credencial é funcional e reemitida pelo Técnico em Portos (RN 15) |
| Sessão | cookie `nexus_session` (12 h = turno), `path=/`, `SameSite=Lax`, `Secure` sob HTTPS |
| Pendência de confirmação | cookie `nexus_pending_auth` (10 min) com apenas id/matrícula/código/nome/cargo |
| Armazenamento | **somente cookies** — `sessionStorage`/`localStorage` não guardam mais a sessão |
| Erro de login | mensagem **genérica** (não revela se o código existe) |
| Reemissão | invalida o código anterior, gera novo para a mesma matrícula, mostra **só** na tela do Técnico |

Detalhes e limitações em [Sessão e cookies](/seguranca/sessao-e-cookies).

---

## 3. Autorização em seis camadas

| # | Camada | Arquivo/artefato | O que impede |
| --- | --- | --- | --- |
| 1 | Navegação | `PAGE_PERMISSIONS` (`auth-guard.js`) | abrir tela fora do cargo (redireciona com aviso) |
| 2 | Ação (UI) | `ACTION_PERMISSIONS` (20 chaves) | renderizar/expor botão de ação proibida |
| 3 | Dados | `vision-layer.js` + consultas filtradas | ver registro de outro funcionário/camada |
| 4 | Agente de IA | `webmcp-core.js` | chamar ferramenta sem cargo/permissão/página, sem confirmação humana real |
| 5 | Servidor | Edge Functions | emitir PDF, despachar navio, calcular KPIs ou registrar acesso sem identidade válida |
| 6 | Banco | RLS + constraints + gatilhos | operação destrutiva ou incoerente, mesmo com a chave publishable |

O princípio é **negar por padrão** (*fail-closed*): sem sessão, sem permissão mapeada, sem provedor de
confirmação ou em estado de emergência, a operação é negada com código explícito.

---

## 4. Auditoria e imutabilidade

| Registro | Tabela | Garantia |
| --- | --- | --- |
| Log geral (RF 12) | `logs_alteracoes` | registra data/hora, cargo, código individual, entidade, tipo e detalhes; **sem política de UPDATE/DELETE** |
| Trilha de decisões (RF 13) | `trail_decisoes` | imutável; retificações vão para `retificacoes_trail` |
| Leituras de QR (RN 19) | `leituras_qr_code` | cada leitura autenticada fica registrada |
| Acessos | `log_acessos_usuarios` | IP (de cabeçalho de proxy) e user agent truncado |
| Ações por agente | `logs_alteracoes` / `trail_decisoes` | recebem a marca `[Agente WebMCP: <ferramenta>]` |

A imutabilidade é **estrutural** (ausência de política) e **visual** (a timeline não tem hover de edição,
como manda o Design System).

---

## 5. Riscos aceitos e declarados

| Risco | Situação | Mitigação |
| --- | --- | --- |
| Chave publishable permite ler/escrever | **aceito** em protótipo acadêmico | RLS, constraints, RBAC na aplicação e Edge Functions; políticas endurecidas prontas e comentadas para quando houver Supabase Auth |
| Cookies de sessão não são `HttpOnly` | **limitação** de cookie gravado por JavaScript | codificação de saída obrigatória (`security.js`) contra XSS |
| Identidade vem do código informado | **aceito** (não há Supabase Auth) | quem conhece o código de um funcionário ativo com cargo permitido consegue agir; registrado na trilha com código e cargo |
| Agente de IA com execução de JS na página | **fora do alcance** dos controles internos | confirmação do próprio navegador/host é a barreira definitiva; painel e chave de desligamento dão transparência |
| Consentimento de cookies (LGPD) | **não implementado** | declarado no backlog; ver [Analytics e LGPD](/operacao/analytics-e-lgpd) |
| Webhook de pânico | desativado por padrão | só dispara com `enabled = true` e URL válida, configurado direto no banco |

---

## 6. Saídas e dados pessoais

- O sistema **não expõe** dados pessoais à Visão Operacional: documentação interna de funcionários e
  cadastro de visitantes são exclusivos do Técnico em Portos (e da Direção), conforme RF 1;
- O canal de agentes de IA **nunca** recebe código individual, CPF, documento ou matrícula de autoria
  (`webmcp-dados.js` + teste automatizado);
- Indicadores financeiros (valor declarado) são restritos à Visão Estratégica;
- O relatório PDF é entregue ao cliente externo **por meio externo** — o cliente não acessa o sistema.

---

## 7. Segurança no cliente

| Prática | Onde |
| --- | --- |
| Codificação de saída em todo `innerHTML` | `js/security.js` (`nexusEsc`, `nexusJsArg`, `nexusSafeUrl`) |
| Varredura estática de XSS no CI | `tools/xss-scan.js` (`npm run scan:xss`) |
| Teste de regressão anti-XSS | `tests/xss.test.js` (`npm run test:xss`) |
| Validação estrita de entrada em agentes | `webmcp-core.js` (esquema, tipos, limites, 4 KB) |
| QR tratado como dado não confiável | padrão `^[A-Za-z0-9._-]{3,80}$` |
| Sem telemetria a terceiros além do GA4 declarado | `js/analytics.js` |
| Sem `eval`, sem `document.write`, sem `innerHTML` com dado cru | verificados pelo scanner |

---

## 8. Checklist de PR de segurança

- [ ] toda nova interpolação passa por `nexusEsc`/`nexusJsArg`/`nexusSafeUrl`;
- [ ] toda nova ação tem chave em `ACTION_PERMISSIONS` (ou justificativa para não ter);
- [ ] toda nova tela entrou em `PAGE_PERMISSIONS`;
- [ ] se a ação grava dados, ela é auditada (e entra na trilha se for decisão crítica);
- [ ] nenhuma credencial foi adicionada ao repositório (`js/config.js` continua fora do Git);
- [ ] funções novas foram publicadas com `--no-verify-jwt` e validam identidade internamente;
- [ ] `npm run audit:xss` e `npm test` continuam verdes.
