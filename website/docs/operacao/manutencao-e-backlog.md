---
id: manutencao-e-backlog
title: Manutenção e backlog
sidebar_label: Manutenção e backlog
description: O que está implementado, o que está pendente e quais são as dívidas técnicas declaradas do projeto.
---

# Manutenção e backlog

O projeto registra o trabalho em quatro arquivos de backlog mais o de relatórios
(`SPECs/backlog.md` … `backlog4.md`, `relatorios-backlog.md`). Esta página consolida **o que está feito**,
**o que está pendente** e **o que é dívida declarada**.

---

## 1. Implementado (amostra dos itens marcados ✅)

| Item | Onde está |
| --- | --- |
| Botão de pânico global em tempo real | `js/panic-realtime.js`, Edge `panic-alert`, `emergencias` |
| Alertas táteis e sonoros | `js/haptics.js`, `teste-vibracao.html` |
| Sidebar fixa no scroll (desktop e celular) | `js/layout.js` |
| Sessão em **cookies** (12 h) em vez de `sessionStorage` | `js/session-cookies.js` |
| PDF gerado no **servidor** com cache no Storage | Edge `relatorio-pdf` + bucket `relatorios-pdf` |
| Cargos populados com usuários mock | `supabase/seed.sql` (20 usuários) |
| Dados de demonstração (navios, contêineres, cargas, histórico) | `supabase/seed.sql` (12 cargas, 9 status) |
| Nº de usuários on-line no cabeçalho | `js/online-presence.js` (Presence, 30 s) |
| Identificador de aparelho para o GA4 | `js/analytics.js` (cookie `_ga`, sem fingerprinting) |
| Live preview / tempo real das tabelas | `js/data-repository.js` + migração de publicação |
| Gate Lighthouse em PRs | `.github/workflows/lighthouse.yml` |
| Build de produção minificado | `tools/build.js` → `dist/` |

---

## 2. Pendências em aberto

### 2.1 Performance, acessibilidade e SEO (`SPECs/backlog4.md`)

| Item | Status | Dívida |
| --- | --- | --- |
| 1.1 Logomarca de 1 MB exibida em 36×36 | 🔴 | redimensionar e converter para WebP/AVIF |
| 1.2 `width`/`height` em `<img>` | 🔴 | reduzir CLS |
| 1.3 Recursos que bloqueiam a renderização | 🔴 | Tailwind CDN, fontes e supabase-js síncronos (LCP > 4 s em 4G) |
| 1.4 JS/CSS não utilizados | 🔴 | Tailwind CDN entrega mais do que a página usa (> 240 KiB) |
| 1.5 Cache de estáticos | 🔴 | `Cache-Control` com TTL longo |
| 2.1 Zoom liberado | 🟡 | `user-scalable=no`/`maximum-scale` em 11 telas (exceção no gate) |
| 2.2 Contraste em textos de apoio | 🟡 | cinza/slate abaixo de 4,5:1 (exceção no gate) |
| 2.3 Ordem de títulos | 🟡 | corrigido em parte das telas |

Essas pendências são **exceções declaradas** no `lighthouse/limiares.json` — cada exceção deve ser
removida quando o item for corrigido. Ver [Gate Lighthouse](/operacao/lighthouse).

### 2.2 Outras pendências

| Item | Situação |
| --- | --- |
| **Consentimento de cookies (LGPD)** | não implementado (`SPECs/backlog3.md`, item F) |
| **Endurecimento do RLS** | políticas permissivas para `anon` (risco aceito); versão endurecida pronta e comentada |
| **Supabase Auth** | não usado; enquanto isso, a identidade é o `codigo_individual` |
| **Testes contra o Supabase real** | não executados por falta de credenciais no ambiente de desenvolvimento |
| **Política de retenção de dados** | não definida (dados pessoais de funcionários e visitantes) |

---

## 3. Dívidas técnicas estruturais (decisões conscientes)

| Dívida | Origem | Custo/benefício |
| --- | --- | --- |
| Tailwind por CDN (sem build de CSS) | restrição "sem bundler" | simples de manter; custa performance de primeira carga |
| Sem CSP estrita | configuração inline do Tailwind + CDNs | ganha flexibilidade; perde uma camada de defesa contra XSS (mitigada por codificação de saída) |
| Cookies de sessão não `HttpOnly` | sessão gravada por JavaScript | praticidade do turno de 12 h; mitigação pela codificação de saída |
| `docs/` versionado com a saída do Docusaurus | requisito do projeto (publicar em `/docs/`) | site publicável por branch; custa tamanho no repositório |
| Cópia de capturas para o site da documentação | Docusaurus só serve `static/` | build autocontido; custa ~7,8 MB na saída |
| Sem pipeline de i18n | decisão de escopo (pt-BR) | simples; inviabiliza versão em inglês sem trabalho |

---

## 4. Como propor uma mudança

```text
1. LER       SPECs/Spec.md (fonte primária) + a página desta documentação do assunto
2. REGISTRAR SPECs/backlog*.md  (item com contexto e critério de aceite)
3. IMPLEMENTAR no lugar certo:
     - regra de negócio      → js/pages/<tela>.js   (+ pré-condição no WebMCP, se houver ferramenta)
     - permissão             → js/auth-guard.js (PAGE_PERMISSIONS / ACTION_PERMISSIONS)
     - dado                  → js/data-repository.js
     - banco                 → supabase/migrations/<timestamp>_<assunto>.sql + SPECs/schema.sql + TABLES.md
     - visual                → SPECs/design/design.md (+ protótipo em THEME/, se for exploratório)
4. TESTAR    tests/test_<assunto>.js  e/ou tests/verify_<assunto>.py
5. ATUALIZAR about/ (capturas) e website/docs/ (esta documentação) quando a mudança for visível
6. RODAR     npm test && npm run test:build && npm run docs:build
```

---

## 5. Ritual de manutenção da documentação

| Quando | O que atualizar |
| --- | --- |
| Nova tela HTML | [Páginas](/arquitetura/paginas), [Protótipos](/design/prototipos-theme) (mapeamento), `about/screenshots` |
| Nova coluna/tabela | [Tabelas](/banco-de-dados/tabelas), `TABLES.md`, `SPECs/schema.sql` |
| Novo módulo JS | [Módulos JavaScript](/arquitetura/modulos-javascript) |
| Nova ferramenta WebMCP | [Catálogo](/arquitetura/webmcp-ferramentas) |
| Nova migração | [Migrações](/banco-de-dados/migracoes) + [Diagnósticos](/banco-de-dados/diagnosticos) se resolver erro conhecido |
| Novo teste | [Testes](/operacao/testes) |
| Mudança de regra | [Regras de negócio](/dominio/regras-de-negocio) e/ou [Requisitos](/dominio/requisitos-funcionais) |
| Nova cor/componente | [Design System](/design/design-system) / [Componentes](/design/componentes) |

Rode `npm run docs:build` antes do commit: links quebrados **reprovam** o build (`onBrokenLinks: 'throw'`).
