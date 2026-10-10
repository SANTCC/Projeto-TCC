---
id: rls-e-politicas
title: RLS e políticas
sidebar_label: RLS e políticas
description: Como o Row Level Security está configurado, o padrão das políticas nexus_*, as tabelas append-only e o risco aceito do modelo sem Supabase Auth.
---

# RLS e políticas

**Row Level Security está ligado em todas as tabelas** do schema, com políticas nomeadas no padrão
`nexus_<operacao>_<tabela>` concedidas às roles `anon` e `authenticated`.

---

## 1. Por que o padrão é permissivo

O NexusPort **não usa Supabase Auth**: o login é próprio, validado em `js/auth-guard.js`, e o front-end
acessa o PostgREST com a chave *publishable*/anon. Logo, **toda requisição chega como role `anon`** — nunca
como `authenticated`.

Consequência prática: uma política `... for all to authenticated ...` bloquearia **100%** do acesso da
aplicação. Por isso as políticas são concedidas a `anon, authenticated`, no mesmo padrão das demais
tabelas.

:::caution Risco aceito e documentado
Quem tiver a chave publishable pode ler e escrever nos dados, sujeito às políticas. Aceitável em protótipo
acadêmico com dados não sensíveis; **não** aceitável em produção. A autorização real do sistema acontece na
aplicação (RBAC por cargo) e dentro das Edge Functions.
:::

---

## 2. Padrão das políticas

Para cada tabela operacional existem até quatro políticas, criadas por tabela:

| Política | Operação | `USING` | `WITH CHECK` |
| --- | --- | --- | --- |
| `nexus_select_<tabela>` | `SELECT` | `true` | — |
| `nexus_insert_<tabela>` | `INSERT` | — | `true` |
| `nexus_update_<tabela>` | `UPDATE` | `true` | `true` |
| `nexus_delete_<tabela>` | `DELETE` | `true` | — |

Tabelas de **auditoria** (`logs_alteracoes`, `trail_decisoes`, `retificacoes_trail`) são
**append-only**: têm `select` e `insert`, e **não** têm `update`/`delete` para o cliente. É o que sustenta
a imutabilidade exigida no RF 13.

```sql
-- exemplo real (padrão do schema)
alter table public.trail_decisoes enable row level security;

create policy nexus_select_trail_decisoes on public.trail_decisoes
  for select to anon, authenticated using (true);

create policy nexus_insert_trail_decisoes on public.trail_decisoes
  for insert to anon, authenticated with check (true);

-- não existem: nexus_update_trail_decisoes / nexus_delete_trail_decisoes
```

---

## 3. O caso de `bercos`

`bercos` foi criada por migração (`001_create_bercos.sql`) e segue o mesmo padrão, com uma observação
relevante: a migração **detecta se as roles `anon`/`authenticated` existem**; em PostgreSQL local (onde não
existem), cria a política para `PUBLIC` em vez de falhar — o que mantém a portabilidade dos testes
(`tests/verify_*.py`).

A migração traz, **comentado**, o conjunto endurecido de políticas — leitura para autenticados e escrita
restrita a cargos operacionais via `funcionarios.user_id = auth.uid()` — pronto para quando (se) o login
migrar para Supabase Auth.

---

## 4. Onde a autorização realmente acontece

```text
1. NAVEGAÇÃO     js/auth-guard.js  → PAGE_PERMISSIONS (quem abre a tela)
2. AÇÃO (UI)     js/auth-guard.js  → ACTION_PERMISSIONS (20 chaves)
3. DADOS (tela)  js/vision-layer.js → recorte por camada de visão
4. AGENTE        js/webmcp/webmcp-core.js → revalida cargo, permissão e página na execução
5. SERVIDOR      Edge Functions → validam codigo_individual + cargo ativo em funcionarios
6. BANCO         RLS → barreira final por operação e tabela
```

O passo 6 é a **defesa em profundidade**: mesmo com a chave publishable em mãos, um `DELETE` em
`trail_decisoes` ou um `UPDATE` em `logs_alteracoes` é recusado pela ausência de política.

---

## 5. Gatilhos que completam o modelo

| Gatilho | Tabelas | Efeito |
| --- | --- | --- |
| `updated_at` | tabelas com timestamp | mantém o campo correto sem depender do cliente |
| propagação em cascata (RN 12) | `navios`, `containers` → `cargas` | estado/localização refletem nas cargas vinculadas |
| índice único parcial | `inspecoes` | uma inspeção ativa por carga |

```sql
-- garantia de uma inspeção ativa por carga (migração 20261008020000)
create unique index if not exists uq_inspecoes_carga_ativa
  on public.inspecoes (carga_id) where ativa;
```

---

## 6. Como auditar as políticas

```sql
-- RLS ligado? (todas devem ter relrowsecurity = true)
select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relrowsecurity, relname;

-- Quais políticas existem por tabela e operação?
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
 order by tablename, cmd;

-- As tabelas de auditoria NÃO podem ter update/delete:
select tablename, cmd from pg_policies
 where schemaname = 'public'
   and tablename in ('logs_alteracoes','trail_decisoes','retificacoes_trail')
   and cmd in ('UPDATE','DELETE');   -- resultado esperado: 0 linhas
```

---

## 7. Caminho de endurecimento (quando houver Supabase Auth)

1. Migrar o login para Supabase Auth, ligando `funcionarios.user_id` ao `auth.uid()`;
2. Trocar as políticas `to anon, authenticated using (true)` pelas versões com `auth.uid()`;
3. Publicar as Edge Functions **sem** `--no-verify-jwt` (passa a haver JWT válido);
4. Manter a verificação de cargo no servidor: RLS não substitui RBAC de cargo;
5. Atualizar `migrations/README.md` e esta página.

O conjunto de políticas endurecidas já está escrito e comentado em `migrations/001_create_bercos.sql`, e o
passo 4 é o que garante que a mudança **não** abra uma janela de escalada de privilégio.
