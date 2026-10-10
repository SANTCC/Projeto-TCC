---
id: specs
title: A pasta SPECs
sidebar_label: A pasta SPECs
description: O que há em cada arquivo da pasta SPECs — a especificação, o design system, o schema SQL, as migrações e os diagnósticos de erro.
---

# A pasta `SPECs`

`SPECs/` é a **fonte primária** do projeto: tudo o que o sistema deve fazer, como deve parecer e como o
banco é estruturado. Documentação, testes e código devem concordar com ela.

```text
SPECs/
├── Spec.md                      ← especificação funcional (RF, RN, escopo)
├── agents.md                    ← guia de trabalho para agentes/colaboradores
├── tasks.md                     ← decomposição em 9 fases (90 tarefas)
├── backlog.md … backlog4.md     ← correções e melhorias por sessão
├── relatorios-backlog.md        ← relatórios de execução dos backlogs
├── schema.sql                   ← schema completo do banco (574 linhas)
├── design/design.md             ← design system v2.0 (297 linhas)
├── migrations/                  ← migração 001 + README
└── diagnostico/                 ← dois erros reais analisados a fundo
```

---

## 1. `Spec.md` — a especificação

| Conteúdo | Detalhe |
| --- | --- |
| Glossário do domínio | carga, contêiner, berço, viagem, pátio, vinculação, camada de visão |
| Requisitos funcionais | **RF 1 a RF 18** |
| Regras de negócio | **RN 1 a RN 19** |
| Não-requisitos | o que o sistema **não** faz (app nativo, i18n, integrações externas…) |
| Camadas de visão | Própria, Operacional, Estratégica |
| Perfis | 10 cargos em 4 níveis |

As páginas [Requisitos funcionais](/dominio/requisitos-funcionais), [Regras de negócio](/dominio/regras-de-negocio)
e [Glossário](/dominio/glossario) transcrevem e explicam esse conteúdo, ligando cada item ao código.

---

## 2. `design/design.md` — o design system v2.0

| Conteúdo | Detalhe |
| --- | --- |
| Paleta | `#1E293B`, `#445987`, `#5C74A8`, `#E8EDF5`/`#F5F7FA`, `#E1E5ED`, `#222222` |
| Cores semânticas | sucesso `#2E7D32`, alerta `#D97706`, erro `#C62828` |
| Tipografia | Montserrat (títulos), Inter (interface), JetBrains Mono (código/QR) |
| Grid e espaçamento | 12 colunas, 24 px de base, largura de referência 1440 px |
| Componentes | botões, formulários, cards, tabelas, badges, modal, timeline, mensagens |
| Regras | contraste, estados, ícones Lucide, formato de dados, modo escuro |

Transcrito e comentado em [Design System](/design/design-system) e [Componentes](/design/componentes).

---

## 3. `schema.sql` — o banco

574 linhas que descrevem **25 tabelas**, **14 enums**, índices, restrições, políticas RLS, gatilhos,
views de indicadores e os 15 berços (`BERCO-01` a `BERCO-15`).

Ele é a fonte de verdade do banco junto com as migrações. Comparações feitas nesta documentação:

| Verificação | Resultado |
| --- | --- |
| `create table` no arquivo | 25 |
| `create type … as enum` | 14 |
| Berços | 15, com `check (id ~ '^BERCO-[0-9]{2}$')` |
| Políticas para `anon` | uma por operação e tabela — ver [RLS e políticas](/banco-de-dados/rls-e-politicas) |

---

## 4. `migrations/`

| Arquivo | Papel |
| --- | --- |
| `migrations/001_create_bercos.sql` | migração numerada da tabela `bercos` (espelhada em `supabase/migrations/`) |
| `migrations/README.md` | 196 linhas explicando o histórico e a convenção de nomes |

A pasta `supabase/migrations/` é a que a CLI aplica de fato (9 migrações com timestamp); a de `SPECs/`
guarda o histórico e a explicação. Ver [Migrações](/banco-de-dados/migracoes).

---

## 5. `diagnostico/` — dois erros investigados a fundo

| Arquivo | Erro | Resumo |
| --- | --- | --- |
| `404-emergencias.md` (134 l.) | **PGRST205** — tabela não encontrada no cache do PostgREST | sintoma, causa (cache de schema) e solução (`notify pgrst, 'reload schema'`) |
| `22P02-enum-emergencia.md` (185 l.) | **22P02** — valor inválido para enum | `EMERGENCIA` ausente em `tipo_entidade_enum`; migração que adiciona o valor em transação separada |

Ambos são transcritos com o passo a passo de correção em
[Diagnósticos](/banco-de-dados/diagnosticos) — é o melhor exemplo de como o projeto trata erro de banco.

---

## 6. `agents.md` — o contrato de trabalho

195 linhas que definem o que **deve** e o que **não deve** ser feito:

| Regra | Conteúdo |
| --- | --- |
| Hospedagem | GitHub Pages (sem Vercel/Netlify *na especificação original*) |
| Estrutura | proibido mover arquivos de página para subpastas |
| `utils.js` | pode crescer, mas cada tela mantém seu próprio `<script>` |
| THEME/ | usar **apenas como referência visual** — nunca copiar o código |
| Login | matrícula **ou** código individual; cargo preenchido automaticamente |
| Escopo | sem app nativo, sem i18n, sem integrações de terceiros |
| Backlog | toda mudança passa por item de backlog, com relatório de execução |

---

## 7. `tasks.md` — 9 fases, 90 tarefas

Todas as tarefas estão marcadas como concluídas (`[x]`). A decomposição completa, com dependências e o
glossário de códigos, está em [Tarefas e fases](/referencia/tarefas).

---

## 8. Como usar a pasta

| Se você precisa… | Vá para |
| --- | --- |
| saber **o que** o sistema deve fazer | `Spec.md` (RF) |
| saber **o que é proibido/permitido** | `Spec.md` (RN) + `agents.md` |
| saber **como** algo deve parecer | `design/design.md` + `THEME/` |
| saber **como** o dado é modelado | `schema.sql` + `migrations/` |
| entender um erro de banco | `diagnostico/` |
| ver o que mudou e quando | `backlog*.md` + `relatorios-backlog.md` |
| acompanhar a sequência de implementação | `tasks.md` |

:::tip Regra de ouro do repositório
Código que contradiz `Spec.md` está **errado** — ou o código, ou a especificação precisa mudar de forma
explícita (com item de backlog). Nunca deixe os dois divergirem em silêncio.
:::
