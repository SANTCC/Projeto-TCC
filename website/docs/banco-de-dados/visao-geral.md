---
id: visao-geral
title: Visão geral do banco de dados
sidebar_label: Visão geral
description: Os 14 enums, 25 tabelas, políticas RLS, gatilhos de auditoria e o mapa de relacionamentos do schema NexusPort.
---

# Visão geral do banco de dados

Todo o estado do NexusPort vive no **PostgreSQL do Supabase**: 14 tipos (`enum`), 25 tabelas, RLS em todas
elas, gatilhos de auditoria e um gatilho de **propagação em cascata** (RN 12).

| Artefato | Arquivo | Uso |
| --- | --- | --- |
| DDL completo | `SPECs/schema.sql` (574 linhas) | bancos novos — cole no SQL Editor |
| Migrações incrementais | `supabase/migrations/*.sql` (9) + `migrations/001_create_bercos.sql` | bancos existentes — `supabase db push` |
| Dicionário de colunas | `TABLES.md` (633 linhas) | consulta rápida de tipos e constraints |
| Seed de demonstração | `supabase/seed.sql` | dados fictícios e 20 usuários mock |
| Diagnósticos | `SPECs/diagnostico/` | PGRST205 (404) e 22P02 (enum) |

---

## 1. Grupos de tabelas

| Grupo | Tabelas | Páginas desta documentação |
| --- | --- | --- |
| **Domínio e hierarquia** | `cargo_niveis`, `funcionarios`, `visitantes`, `tipos_carga`, `checklist_modelos`, `checklist_itens`, `rotas_maritimas` | [Tabelas](/banco-de-dados/tabelas) |
| **Equipamentos e embarcações** | `navios`, `bercos`, `guindastes`, `containers` | idem |
| **Cargas e fluxo** | `cargas`, `agendamentos`, `estivador_cargas` | [Fluxo da carga](/dominio/fluxo-da-carga) |
| **Manutenção** | `manutencoes`, `historico_manutencoes` | idem |
| **Inspeção** | `inspecoes`, `inspecao_itens` | [Telas-chave](/design/telas-chave) |
| **Auditoria e decisões** | `logs_alteracoes`, `trail_decisoes`, `retificacoes_trail` | [Modelo de segurança](/seguranca/modelo-de-seguranca) |
| **Delegação e leituras** | `delegacoes_supervisor`, `leituras_qr_code` | — |
| **Emergência** | `emergencias`, `panic_webhook_config` | [Tempo real e presença](/arquitetura/tempo-real-e-presenca) |
| **Acesso** | `log_acessos_usuarios` | [Edge Functions](/arquitetura/edge-functions) |

---

## 2. Relacionamentos principais

```text
cargo_niveis (cargo → nivel)
      ▲
      │ cargo
funcionarios ──< visitantes (registrado_por)
      │
      ├──< logs_alteracoes (codigo_individual, cargo)
      ├──< trail_decisoes (codigo_individual, cargo)
      ├──< delegacoes_supervisor (titular, substituto)
      └──< estivador_cargas >── cargas

tipos_carga ──< checklist_modelos ──< checklist_itens
      └──< cargas (tipo)   └──< containers (tipo de carga)

rotas_maritimas (origem, destino, distancia_km)

navios ──< containers ──< cargas
   │            │            │
   │            └──< inspecoes ──< inspecao_itens
   ├── bercos (navio_id, navio_nome, navio_imo)
   └──< manutencoes ──< historico_manutencoes

cargas ──< agendamentos
cargas ──< leituras_qr_code
cargas ──< retificacoes_trail (via trail_decisoes)
```

---

## 3. Regras garantidas pelo banco (não só pela aplicação)

| Garantia | Mecanismo |
| --- | --- |
| Vocabulário de estados fechado | 14 tipos `enum` (ex.: `status_carga_enum` com 9 valores) |
| Identificadores únicos | `unique` em `matricula`, `codigo_individual`, `bercos.nome`, `tipos_carga.nome` |
| Berço coerente | `bercos_vinculo_navio_check` — `OCUPADO` exige navio identificado; `LIVRE`/`MANUTENCAO` não pode ter vínculo |
| Formato do berço | `bercos_id_formato_check`: `id ~ '^BERCO-[0-9]{2}$'` |
| Berço não some com o navio | FK `bercos_navio_id_fkey … on delete set null` |
| Uma inspeção ativa por carga | índice único parcial (migração `20261008020000`) |
| Propagação para cargas vinculadas | gatilho de cascata (RN 12) |
| Trilha imutável | políticas *append-only* em `trail_decisoes` e `logs_alteracoes` |
| `updated_at` correto | gatilho em todas as tabelas com timestamp |

---

## 4. Convenções de modelagem

| Convenção | Exemplo |
| --- | --- |
| Nomes de tabela no **plural** | `cargas`, `navios`, `containers` (sem acento, como no código) |
| Nomes de coluna em **snake_case pt-BR** | `data_hora_entrada`, `motivo_recusa`, `codigo_individual` |
| Chaves primárias | `uuid` (exceto `bercos.id`, que é `text` no padrão `BERCO-NN`, porque o front-end usa esses identificadores) |
| Timestamps | `timestamptz` (`created_at`, `updated_at`, `data_hora_*`) |
| Referência ao autor | `codigo_individual` + `cargo` em vez de FK de usuário autenticado (não há Supabase Auth) |
| Estados | `enum` do Postgres, não strings livres |
| Percentuais e valores | numéricos (`numeric`), formatados na interface em pt-BR |

---

## 5. Consultas úteis de verificação

```sql
-- Quantas tabelas e enums existem no schema public?
select count(*) filter (where table_type = 'BASE TABLE') as tabelas
  from information_schema.tables where table_schema = 'public';

-- RLS está ligado em todas?
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relrowsecurity, relname;

-- Os 10 cargos e seus níveis
select c.cargo, c.nivel from cargo_niveis c order by c.nivel, c.cargo;

-- Os 15 berços e seus vínculos
select id, estado, navio_nome, navio_imo from bercos order by id;

-- Cargas por status (o "card" da ocupação do pátio)
select status, count(*) from cargas group by status order by 2 desc;

-- Últimas decisões da trilha
select tipo_decisao, cargo, codigo_individual, data_hora
  from trail_decisoes order by data_hora desc limit 10;
```

---

## 6. Próximas páginas

- [Tabelas](/banco-de-dados/tabelas) — todas as 25, com colunas e propósito;
- [Enums e tipos](/banco-de-dados/enums-e-tipos) — os 14 tipos com todos os valores;
- [RLS e políticas](/banco-de-dados/rls-e-politicas) — o modelo de segurança no banco;
- [Migrações](/banco-de-dados/migracoes) — as 10 migrações e quando aplicar cada uma;
- [Seed de demonstração](/banco-de-dados/seed-demo) — dados fictícios e usuários mock;
- [Diagnósticos](/banco-de-dados/diagnosticos) — PGRST205, 22P02, 23514 e 55P04.
