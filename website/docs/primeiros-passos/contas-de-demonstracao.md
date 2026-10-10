---
id: contas-de-demonstracao
title: Contas de demonstração
sidebar_label: Contas de demonstração
description: Os 20 usuários mock do seed, as três contas das capturas de tela e as regras de uso desses dados.
---

# Contas de demonstração

O repositório inclui um **seed de demonstração** (`supabase/seed.sql`) que cria 20 usuários mock — 2 por
cargo — e um conjunto de dados operacionais fictícios. Ele existe para demonstração e desenvolvimento
local; **nunca deve ser aplicado em produção**.

---

## 1. Como aplicar

```bash
supabase db reset                                 # local: migrações + seed
psql "$DATABASE_URL" -f supabase/seed.sql         # projeto de demonstração
```

O script é **idempotente**: usa `on conflict do nothing` e ids determinísticos, então reexecutar não
duplica nada e não altera um usuário real que tenha a mesma matrícula.

Testes: `npm run test:seed` (estrutura, sem banco) e
`python tests/verify_seed_demo.py` (PostgreSQL real: contagens, idempotência e preservação de dados).

---

## 2. Nomes e códigos

| Cargo (`cargo_enum`) | Usuários | Código individual | Visão |
| --- | --- | --- | --- |
| `ESTIVADOR` | `ESTIVADOR_mock123`, `ESTIVADOR_mock321` | `MOCK-ESTIVADOR-123` / `-321` | Própria |
| `CONFERENTE_CARGA` | `CONFERENTE_CARGA_mock123` / `321` | `MOCK-CONFERENTE_CARGA-123` / `-321` | Própria |
| `ARRUMADOR_CONSERTADOR` | `ARRUMADOR_CONSERTADOR_mock123` / `321` | `MOCK-ARRUMADOR_CONSERTADOR-123` / `-321` | Própria |
| `PLANEJADOR_PATIO_NAVIOS` | `PLANEJADOR_PATIO_NAVIOS_mock123` / `321` | `MOCK-PLANEJADOR_PATIO_NAVIOS-123` / `-321` | Própria |
| `TECNICO_PORTOS` | `TECNICO_PORTOS_mock123` / `321` | `MOCK-TECNICO_PORTOS-123` / `-321` | Própria |
| `SUPERVISOR_GERENTE_OPERACOES` | `SUPERVISOR_GERENTE_OPERACOES_mock123` / `321` | `MOCK-SUPERVISOR_GERENTE_OPERACOES-123` / `-321` | Operacional |
| `INSPETOR` | `INSPETOR_mock123` / `321` | `MOCK-INSPETOR-123` / `-321` | Operacional |
| `DIRETOR_OPERACOES_LOGISTICA` | `DIRETOR_OPERACOES_LOGISTICA_mock123` / `321` | `MOCK-DIRETOR_OPERACOES_LOGISTICA-123` / `-321` | Estratégica |
| `DIRETOR_PRESIDENTE_SUPERINTENDENTE` | `DIRETOR_PRESIDENTE_SUPERINTENDENTE_mock123` / `321` | `MOCK-DIRETOR_PRESIDENTE_SUPERINTENDENTE-123` / `-321` | Estratégica |
| `CONSELHO_ADMINISTRACAO` | `CONSELHO_ADMINISTRACAO_mock123` / `321` | `MOCK-CONSELHO_ADMINISTRACAO-123` / `-321` | Estratégica |

Padrão: nome `[CARGO]_mock[123|321]`, código `MOCK-[CARGO]-[123|321]`.

---

## 3. Dados operacionais criados

| Entidade | Quantidade | Detalhe |
| --- | --- | --- |
| Navios | 4 | dois atracados (berços ocupados), um em trânsito (`FORA_DO_PORTO`), um no porto de destino; IMOs `9990001–9990004` (fictícios) |
| Contêineres | 6 | vinculados aos navios, com estado operacional variado |
| Cargas | 12 | cobrem os **9 status do fluxo**, com uma inspeção aprovada e uma recusada |
| Tipos de carga | 4 | com modelo de checklist |
| Rotas marítimas | 4 | a partir de Santos, com distância fixa usada no cálculo de ETA (33 km/h — RN 9) |
| Histórico de alterações | 27 | cadastros, edições de status, exportações de PDF e reimpressão de etiqueta |
| Funcionários | 20 | os usuários mock da tabela acima |

:::warning IMOs e distâncias são fictícios
`9990001–9990004` não existem como embarcações reais e as distâncias das rotas não correspondem a
cálculos de navegação. Não use esses valores como referência operacional.
:::

---

## 4. As três contas das capturas de tela

O `about.html` e a [Galeria](/galeria) usam três contas reais do sistema, escolhidas para cobrir as três
camadas de visão:

| Matrícula | Cargo | Visão | Papel nas capturas |
| --- | --- | --- | --- |
| `MAT-0000` | Diretor-Presidente / Superintendente | Estratégica | mostra dashboards, gráficos e exportação |
| `MAT-2011` | Supervisor / Gerente de Operações | Operacional | mostra liberação, manutenção, delegação e inspeção |
| `MAT-9999` | Técnico em Portos | Própria | mostra gestão de pessoas e telas operacionais |

Cada conta entra pelo fluxo **real** (login → confirmação de cargo) e navega apenas pelas telas liberadas
ao seu cargo — a matriz vem de `js/auth-guard.js`, a mesma usada em produção. Nada é gravado no banco: a
captura usa um **PostgREST simulado** com dados fictícios (`tools/screenshots/`). Detalhes em
[Documentação ilustrada](/operacao/documentacao-ilustrada).

---

## 5. Regras de uso dos dados mock

1. **Nunca** aplicar `supabase/seed.sql` em produção.
2. Os códigos `MOCK-*` são públicos no repositório: qualquer pessoa que os conheça entra com o cargo
   correspondente. Use-os só em ambiente de demonstração.
3. O seed não sobrescreve usuários reais: se a matrícula já existir, o mock é pulado.
4. As três matrículas `MAT-0000`, `MAT-2011` e `MAT-9999` pertencem ao catálogo das capturas
   (`tools/screenshots/demo-data.js`), não ao seed SQL.
