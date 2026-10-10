---
id: estrutura-do-repositorio
title: Estrutura do repositório
sidebar_label: Estrutura do repositório
description: Árvore comentada de todas as pastas e arquivos do repositório, com o papel de cada item.
---

# Estrutura do repositório

Árvore comentada do repositório (`main`), com o papel de cada item. Contagens na data desta documentação:
**13 páginas HTML**, **41 módulos JS**, **25 tabelas SQL**, **6 Edge Functions**, **47 testes Node**,
**15 verificadores Python**, **13 ferramentas/módulos auxiliares**.

```text
Projeto-TCC/
├── *.html                     13 telas do sistema (ver "Páginas")
├── favicon.ico                ícone do app (1 MB — item de otimização do backlog 004)
├── logo_porto.png             logotipo (raiz: usado pelas páginas que não referenciam design/)
├── package.json               scripts de teste/build/capturas/documentação
├── package-lock.json          trava de versões do Node
├── vercel.json                deploy do app (build → dist/)
├── README.md                  visão rápida: recursos, configuração, segurança, operação
├── TABLES.md                  dicionário do banco (colunas de cada tabela)
├── webmcp.md                  documento da camada de agentes de IA (modelo de ameaças + catálogo)
├── agents.md / ai.md / claude.md   manual do desenvolvedor e atalhos para agentes de IA
│
├── js/                        41 módulos JavaScript (14 raiz + 13 páginas + 14 WebMCP)
│   ├── auth-guard.js          guard de sessão + matriz RBAC (páginas e ações)
│   ├── session-cookies.js     única porta de leitura/gravação dos cookies de sessão
│   ├── supabase-client.js     criação do cliente + utilitários de resiliência (PGRST205)
│   ├── data-repository.js     repositório central de leitura/escrita + Realtime
│   ├── security.js            codificação de saída (anti-XSS)
│   ├── vision-layer.js        camadas Própria / Operacional / Estratégica
│   ├── layout.js              sidebar, topbar, tema, modal de confirmação, feedback inline
│   ├── panic-realtime.js      botão de pânico global (Edge Function + Realtime + fallback)
│   ├── haptics.js             alertas táteis e sonoros (Vibration API + áudio)
│   ├── online-presence.js     contador de usuários on-line (Realtime Presence)
│   ├── analytics.js           eventos de uso (GA4) sem dados pessoais
│   ├── net-debug.js           console de diagnóstico de rede (HTTP + WebSocket)
│   ├── config.js              credenciais locais (NÃO versionado)
│   ├── config.example.js      modelo de configuração (versionado)
│   ├── pages/                 13 controladores, um por tela
│   └── webmcp/                14 módulos da camada de agentes (núcleo, UI, dados, 10 páginas)
│
├── supabase/
│   ├── config.toml            verify_jwt=false por função + seed
│   ├── seed.sql               dados de demonstração (20 usuários mock, 12 cargas...)
│   ├── migrations/            9 migrações incrementais aplicáveis via `supabase db push`
│   └── functions/             6 Edge Functions (Deno): panic-alert, relatorio-pdf,
│                              despacho-embarcacao, kpis-calculo, scanner-qr, log-acesso
│
├── migrations/
│   ├── 001_create_bercos.sql  migração da tabela bercos (aplicação manual no SQL Editor)
│   └── README.md              como aplicar, garantias, erros 23514/PGRST205 e SQL de exemplo
│
├── SPECs/                     fontes de verdade
│   ├── Spec.md                RF 1–18, RN 1–19, glossário, não-requisitos  (fonte primária)
│   ├── tasks.md               9 fases / T1.1–T9.10 com dependências
│   ├── schema.sql             DDL completo (25 tabelas, 14 enums, RLS, gatilhos)
│   ├── design/
│   │   ├── design.md          Design System v2.0
│   │   └── logo_porto.png     logotipo oficial
│   ├── agents.md              instruções obrigatórias do agente de codificação
│   ├── backlog.md, backlog2.md, backlog3.md, backlog4.md   iterações de trabalho
│   ├── relatorios-backlog.md  backlog de relatórios (778 linhas)
│   ├── diagnostico/           PGRST205 (404) e 22P02 (enum)
│   └── migrations/            cópia de 001_create_bercos.sql + README
│
├── THEME/                     8 protótipos HTML estáticos (referência visual, não arquitetura)
│   ├── login_autentica_o_operacional_t2.1_t2.2/code.html
│   ├── pilar_1_acesso_identidade_camadas_de_vis_o_sidebar_retr_til/code.html
│   ├── pilar_2_agendamento_gate_in_rastreabilidade_qr_code/code.html
│   ├── pilar_3_inspe_o_t_cnica_formal_valida_o_de_conformidade/code.html
│   ├── pilar_4_p_tio_vincula_o_operacional_estado_das_embarca_es/code.html
│   ├── pilar_5_despacho_cr_tico_regula_o_de_sa_da_pelo_supervisor/code.html
│   ├── pilar_6_painel_de_comando_governan_a_auditoria_imut_vel/code.html
│   └── pilar_7_opera_o_de_p_tio_em_campo_leitura_mobile/code.html
│
├── tests/                     47 testes Node + 15 verificadores Python + 10 PNG de verificação
├── tools/
│   ├── build.js               build de produção (Terser + clean-css) → dist/
│   ├── lighthouse-check.js    gate Lighthouse (mede dist/, 3 rodadas, mediana)
│   ├── xss-scan.js            varredura estática anti-XSS
│   ├── nexus_api/             suíte Python (auth, cargas, embarcações, inspeções, KPIs, ...)
│   └── screenshots/           capturas do about.html (Puppeteer + PostgREST simulado)
│
├── about/                     material do about.html
│   ├── screenshots/           30 capturas PNG + manifest.json
│   └── relatorio_correcao_loop_requisicoes.md
│
├── docs/                      SAÍDA do site Docusaurus (publicada em /docs/)
├── website/                   FONTE do site Docusaurus (este documento vive aqui)
├── lighthouse/limiares.json   limiares e exceções do gate
├── design/logo_porto.png      logotipo canônico usado pelas páginas
├── diagnostico/               2 relatórios (espelho de SPECs/diagnostico)
├── .github/workflows/         lighthouse.yml (PRs) + docs.yml (GitHub Pages da documentação)
└── .jules/bolt.md             diário de otimizações (aprendizados de performance)
```

---

## Pastas que **não** vão para produção

`tools/build.js` monta `dist/` a partir da raiz e exclui, em qualquer nível:

```text
node_modules  .git  .github  .vercel  dist  tests  tools  SPECs  supabase  THEME
lighthouse  lighthouse-report  docs  website
```

Além disso, são descartados **todos os arquivos `.md` e `.py`** e, na raiz, `package.json`,
`package-lock.json`, `vercel.json`, `.gitignore` e `.vercelignore`. O que sobra é exatamente o que o
navegador precisa: HTML, `js/`, imagens e assets estáticos. Detalhes em
[Build e deploy](/operacao/build-e-deploy).

---

## Convenções de nomes

| Padrão | Significado | Exemplo |
| --- | --- | --- |
| `js/pages/<tela>.js` | controlador de uma tela (`jsdom` testa cada um) | `js/pages/cargas.js` |
| `js/webmcp/webmcp-<assunto>.js` | ferramentas WebMCP de uma página | `js/webmcp/webmcp-inspecao.js` |
| `tests/test_<assunto>.js` | suíte Node executável por `node tests/...` | `tests/test_haptics.js` |
| `tests/verify_<assunto>.py` | verificação em PostgreSQL real | `tests/verify_seed_demo.py` |
| `supabase/migrations/<timestamp>_<assunto>.sql` | migração incremental idempotente | `20261009000000_realtime_publication.sql` |
| `SPECs/<assunto>.md` | fonte de verdade | `SPECs/Spec.md` |
| `about/screenshots/<conta>-<tela>.png` | captura de tela por conta de demonstração | `mat-2011-cargas.png` |

---

## Onde cada coisa é documentada

| Pasta | Página desta documentação |
| --- | --- |
| `js/` | [Módulos JavaScript](/arquitetura/modulos-javascript) |
| `js/webmcp/` | [WebMCP](/arquitetura/webmcp) e [Catálogo de ferramentas](/arquitetura/webmcp-ferramentas) |
| `*.html` | [Páginas](/arquitetura/paginas) e [Telas-chave](/design/telas-chave) |
| `SPECs/` | [Specs e fontes de verdade](/referencia/specs) |
| `supabase/` | [Banco de dados](/banco-de-dados/visao-geral) e [Edge Functions](/arquitetura/edge-functions) |
| `tests/`, `tools/` | [Testes](/operacao/testes) |
| `THEME/` | [Protótipos visuais](/design/prototipos-theme) |
| `website/` | [Como documentar](/referencia/como-documentar) |
