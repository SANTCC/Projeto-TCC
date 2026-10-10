---
id: configuracao-supabase
title: Configuração do Supabase
sidebar_label: Configuração do Supabase
description: Como criar js/config.js, entender as chaves do Supabase, aplicar o schema, as migrações e publicar as Edge Functions.
---

# Configuração do Supabase

Todo o back-end do NexusPort é o Supabase: **PostgreSQL com Row Level Security**, **Realtime** (WebSocket
+ Presence), **Storage** (PDFs) e **Edge Functions** (Deno). O front-end fala com ele apenas pelo SDK
JavaScript, no navegador — não existe servidor próprio.

---

## 1. Criar o arquivo de configuração

O repositório versiona **apenas o exemplo**; as credenciais ficam fora do Git (`js/config.js` está no
`.gitignore`).

```bash
cp js/config.example.js js/config.js
```

```javascript title="js/config.js"
window.NEXUS_CONFIG = {
  SUPABASE_URL: "https://seudominio.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-aqui"
};
```

| Chave | Onde encontrar | Observação |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase → *Project Settings → API → Project URL* | ex.: `https://abcd.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase → *Project Settings → API → anon/publishable key* | **pública por natureza**; a segurança vem do RLS |

:::danger Nunca comite credenciais
`js/config.js` está no `.gitignore`. A chave *anon/publishable* é pública, mas ainda assim só deve ser
usada com autorização explícita do responsável pelo projeto — a regra está em `SPECs/agents.md`.
A `service_role`/secret **nunca** entra no front-end: ela é usada apenas dentro das Edge Functions, pelo
`Deno.env` (`SUPABASE_SERVICE_ROLE_KEY`).
:::

---

## 2. O que acontece sem configuração

`js/supabase-client.js` trata a ausência de credenciais como **modo simulação**:

- As páginas continuam carregando, com o cabeçalho e a navegação do terminal;
- As consultas que falham por tabela inexistente (erro `PGRST205` — *Could not find the table 'public.x'
  in the schema cache*) são interpretadas por `window.NexusSupabaseUtils`, que entrega `[]` em vez de
  derrubar a tela;
- O indicador de usuários on-line mostra **—** (nunca um número fictício);
- O banner de emergência continua funcionando apenas se houver Realtime configurado.

Esse desenho é o que permite testar o front-end inteiro no `jsdom`, sem banco.

---

## 3. Aplicar o schema

Duas rotas possíveis:

### 3.1 Banco novo — schema completo

Cole o conteúdo de `SPECs/schema.sql` no **SQL Editor** do Supabase e execute. O arquivo é o DDL canônico:

- 14 tipos (`create type`) e 25 tabelas;
- Row Level Security ligado em todas as tabelas com políticas `nexus_*` para as roles `anon, authenticated`;
- Gatilho de propagação em cascata (RN 12) para refletir estado/localização de navio e contêiner nas cargas;
- População inicial de `cargo_niveis` (10 cargos × 4 níveis) e dos 15 berços do terminal STS-01.

### 3.2 Banco existente — migrações incrementais

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push        # aplica supabase/migrations/* em ordem
```

As 10 migrações estão descritas em [Migrações](/banco-de-dados/migracoes). Um resumo:

| Migração | Efeito |
| --- | --- |
| `001_create_bercos.sql` (`migrations/`) | Tabela `bercos` (15 posições), constraints e RLS |
| `20261007000000_panic_button_global.sql` | Botão de pânico global: `emergencias`, `panic_webhook_config`, valor `EMERGENCIA` no enum |
| `20261008000000_emergencias_fix_404.sql` | Reparo idempotente do 404/PGRST205 em `/rest/v1/emergencias` |
| `20261008010000_enum_emergencia_auditoria.sql` | Corrige `22P02` do enum `tipo_entidade_enum` |
| `20261008020000_inspecoes_historico.sql` | Uma inspeção ativa por carga (histórico de inspeções) |
| `20261009000000_realtime_publication.sql` | Publicação `supabase_realtime` para as tabelas operacionais |
| `20261009010000_relatorios_pdf_storage.sql` | Bucket privado `relatorios-pdf` (cache de PDF por SHA-256) |
| `20261009020000_auditoria_exportacao.sql` | Tipo de alteração `EXPORTACAO` na auditoria |
| `20261010000000_funcionarios_cpf_nascimento.sql` | CPF e data de nascimento em `funcionarios` (delegação) |
| `20261010010000_log_acessos_usuarios.sql` | Tabela de log de acessos (IP e user agent) |

---

## 4. Publicar as Edge Functions

```bash
supabase functions deploy panic-alert --no-verify-jwt
supabase functions deploy relatorio-pdf --no-verify-jwt
supabase functions deploy despacho-embarcacao --no-verify-jwt
supabase functions deploy kpis-calculo --no-verify-jwt
supabase functions deploy scanner-qr --no-verify-jwt
supabase functions deploy log-acesso --no-verify-jwt
```

O `--no-verify-jwt` é **obrigatório** neste projeto porque o app não usa Supabase Auth: a identidade é o
**código individual** validado dentro de cada função. Com JWT obrigatório, o gateway responderia `401` no
preflight CORS (`OPTIONS` não envia `Authorization`) e o navegador bloquearia a chamada com
*"Response to preflight request doesn't pass access control check"*.

As funções e suas variáveis de ambiente estão em [Edge Functions](/arquitetura/edge-functions).

---

## 5. Realtime, Storage e Presence

| Recurso | Onde configurar | Para quê |
| --- | --- | --- |
| **Realtime publication** | migração `20261009000000` | sincronizar as telas quando um registro muda |
| **Presence** | nenhuma configuração | contador de usuários on-line (`nexus-online`), sem tabela |
| **Storage (bucket privado)** | migração `20261009010000` | cache dos PDFs gerados no servidor |
| **Broadcast** | nenhuma configuração | canal `nexus-emergency` do botão de pânico |

Sem a migração de Realtime, o canal conecta mas não recebe eventos: as telas passam a atualizar apenas
pela sincronização de segurança de 60 s. Ver [Tempo real e presença](/arquitetura/tempo-real-e-presenca).

---

## 6. Seed de demonstração (nunca em produção)

```bash
supabase db reset          # local: aplica migrações + supabase/seed.sql
# ou, num projeto de demonstração:
psql "$DATABASE_URL" -f supabase/seed.sql
```

O seed cria 20 usuários mock (2 por cargo), 4 navios, 6 contêineres, 12 cargas cobrindo os 9 status, tipos
de carga, rotas e histórico. É **idempotente** (`on conflict do nothing` + ids determinísticos). Detalhes
em [Seed de demonstração](/banco-de-dados/seed-demo).

---

## 7. Checklist de configuração

```bash
# 1. credenciais
cp js/config.example.js js/config.js && $EDITOR js/config.js

# 2. banco
supabase link --project-ref <ref> && supabase db push

# 3. funções
supabase functions deploy panic-alert relatorio-pdf despacho-embarcacao kpis-calculo scanner-qr log-acesso --no-verify-jwt

# 4. verificação (a tabela emergencias precisa responder 200)
curl "<SUPABASE_URL>/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
     -H "apikey: <ANON_KEY>"
```

Se o `curl` devolver `404 / PGRST205`, aplique `supabase/migrations/20261008000000_emergencias_fix_404.sql`
e veja [Diagnósticos](/banco-de-dados/diagnosticos).
