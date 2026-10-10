---
id: supabase
title: Back-end Supabase
sidebar_label: Back-end Supabase
description: O que o Supabase fornece ao NexusPort — PostgREST, PostgreSQL com RLS, Realtime, Presence, Storage e as Edge Functions.
---

# Back-end Supabase

O Supabase é o **único back-end** do sistema: não existe servidor próprio, API intermediária ou processo
Node em produção. O front-end fala com ele pelo SDK JavaScript usando a chave *publishable*/anon.

| Serviço | Uso no NexusPort | Configuração |
| --- | --- | --- |
| **PostgREST** | toda leitura/escrita das 25 tabelas | `js/data-repository.js` |
| **PostgreSQL + RLS** | regras de integridade, gatilhos de cascata, auditoria | `SPECs/schema.sql`, `supabase/migrations/` |
| **Realtime (broadcast/`postgres_changes`)** | sincronização das telas e canal `nexus-emergency` | migração `20261009000000` |
| **Realtime Presence** | contador de usuários on-line (`nexus-online`) | nenhuma migração necessária |
| **Storage** | bucket privado `relatorios-pdf` (cache de PDF por SHA-256) | migração `20261009010000` |
| **Edge Functions (Deno)** | pânico, PDF, despacho, KPIs, scanner, log de acesso | `supabase/functions/`, `supabase/config.toml` |
| **Auth** | **não usado** | o login é próprio (código individual) |

---

## 1. O modelo de identidade (importante)

O projeto **não usa Supabase Auth**. Consequências diretas:

1. Toda requisição chega ao PostgREST como role **`anon`** — nunca `authenticated`;
2. As políticas de RLS precisam conceder acesso a `anon, authenticated` (o padrão do schema), porque uma
   política `to authenticated` bloquearia 100% da aplicação;
3. A autorização **real** acontece na aplicação (`auth-guard.js`) e dentro das Edge Functions, que validam
   o `codigo_individual` em `funcionarios` antes de qualquer efeito;
4. As Edge Functions são publicadas com `verify_jwt = false` (ver [Edge Functions](/arquitetura/edge-functions)).

:::caution Risco aceito e documentado
Quem tiver a chave *publishable* pode ler e escrever nas tabelas (sujeito às políticas). Isso é aceitável
em protótipo acadêmico com dados não sensíveis e **não** é aceitável em produção. `migrations/README.md`
traz, comentado, o conjunto de políticas endurecidas (escrita restrita por `auth.uid()`), pronto para
quando o login migrar para Supabase Auth.
:::

---

## 2. `supabase/config.toml`

```toml
project_id = "nexusport"

# O gateway NÃO exige JWT: a autorização é feita dentro de cada função (RBAC por cargo).
[functions.panic-alert]        verify_jwt = false
[functions.relatorio-pdf]      verify_jwt = false
[functions.kpis-calculo]       verify_jwt = false
[functions.despacho-embarcacao] verify_jwt = false
[functions.scanner-qr]         verify_jwt = false
[functions.log-acesso]         verify_jwt = false

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

---

## 3. Persistência e integridade

| Mecanismo | Onde | Efeito |
| --- | --- | --- |
| `create type … as enum` | `schema.sql` (14 tipos) | vocabulário fechado de estados (cargas, navios, inspeções, decisões) |
| `check` constraints | `bercos`, `cargas`, `containers`, `funcionarios` | impede estados incoerentes (ex.: berço `OCUPADO` sem navio, `id` fora de `^BERCO-[0-9]{2}$`) |
| `unique` | `matricula`, `codigo_individual`, `bercos.nome`, `tipos_carga.nome` | evita duplicidade de identificadores |
| *trigger* de `updated_at` | tabelas com timestamp | mantém `updated_at` correto sem depender do cliente |
| **gatilho de cascata (RN 12)** | `navios`/`containers` → `cargas` | estado e localização propagam para as cargas vinculadas |
| índice único parcial | `inspecoes` (migração `20261008020000`) | no máximo **uma inspeção ativa** por carga |

---

## 4. Realtime, Presence e Storage

```text
Canal por tabela (postgres_changes)  →  nexus_data_changed  →  telas recarregam (debounce 400 ms)
Broadcast "nexus-emergency"          →  banner de pânico em todas as telas conectadas
Presence "nexus-online"              →  contador de usuários on-line no cabeçalho (30 s)
Storage bucket "relatorios-pdf"      →  cache de PDF: nome do arquivo é o SHA-256 do conteúdo
```

Os três primeiros são apresentados em detalhe em
[Tempo real e presença](/arquitetura/tempo-real-e-presenca); o cache de PDF, em
[Relatórios em PDF](/operacao/relatorios-pdf).

---

## 5. Boas práticas adotadas

- **Nada de credencial no cliente além da chave publishable.** A `service_role` existe apenas no
  `Deno.env` das Edge Functions.
- **Migrações idempotentes**: podem ser reaplicadas sem erro (as da pasta `supabase/migrations/` e a
  `001_create_bercos.sql`).
- **`notify pgrst, 'reload schema';`** no fim das migrações estruturais, para o PostgREST enxergar as
  mudanças sem reinício manual.
- **Sem escrita destrutiva silenciosa**: `delete` é restrito por política; operações de fluxo usam mudança
  de estado (cancelar, recusar) em vez de apagar registros.
- **Auditoria append-only**: `logs_alteracoes` e `trail_decisoes` não permitem `update`/`delete` pelo
  cliente.

---

## 6. Verificação rápida do ambiente

```bash
# a tabela de emergências responde?
curl "$SUPABASE_URL/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
     -H "apikey: $ANON_KEY"

# os cargos estão populados?
curl "$SUPABASE_URL/rest/v1/cargo_niveis?select=*" -H "apikey: $ANON_KEY"

# os 15 berços existem?
curl "$SUPABASE_URL/rest/v1/bercos?select=id,estado&order=id" -H "apikey: $ANON_KEY"
```

Um `404` com `PGRST205` indica migração não aplicada (ou *schema cache* desatualizado); um `401` no
preflight indica função publicada com `verify_jwt` ligado. Ver
[Diagnósticos](/banco-de-dados/diagnosticos).
