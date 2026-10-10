---
id: diagnosticos
title: Diagnósticos de banco
sidebar_label: Diagnósticos
description: PGRST205, 22P02, 55P04 e 23514 — as causas, o que verificar e qual migração resolve cada erro conhecido.
---

# Diagnósticos de banco

Os quatro erros que este projeto já enfrentou em ambiente real, com causa, verificação e correção. As
fontes completas estão em `SPECs/diagnostico/` (2 documentos) e em `migrations/README.md`.

---

## 1. `PGRST205` — *Could not find the table 'public.x' in the schema cache*

**Sintoma:** a tela carrega, mas uma consulta específica falha com HTTP **404**:

```text
GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
→ 404  {"code":"PGRST205","message":"Could not find the table 'public.emergencias' in the schema cache"}
```

**As três causas usuais:**

| Causa | Como confirmar | Correção |
| --- | --- | --- |
| (a) a migração não foi aplicada | `select to_regclass('public.emergencias');` retorna `null` | aplicar a migração |
| (b) foi aplicada em outro schema | `select table_schema from information_schema.tables where table_name = 'emergencias';` | o PostgREST só expõe `public` — mover/criar em `public` |
| (c) o *schema cache* ainda não recarregou | `notify pgrst, 'reload schema';` seguido de nova consulta | aguardar ou *Settings → API → Restart server* |

**Correção canônica:** `supabase/migrations/20261008000000_emergencias_fix_404.sql` — versão idempotente e
reparadora que reconcilia estrutura parcial, normaliza dado legado, recria as políticas `nexus_*` para
`anon, authenticated`, recarrega o cache e termina com um `select` de verificação.

**Mitigação no front-end:** `js/supabase-client.js` reconhece o `PGRST205` e entrega `[]` em vez de
derrubar a tela, com aviso no console indicando a migração que resolve. O `js/net-debug.js` mostra a
consulta, os filtros e a dica.

---

## 2. `22P02` — *invalid input value for enum tipo_entidade_enum: "EMERGENCIA"*

**Sintoma:** aparece nos **logs do Postgres** (`Logs Explorer → postgres_logs`) quando o botão de pânico
tenta gravar a auditoria:

```text
ERROR  22P02  invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
parsed.query: WITH pgrst_source AS (INSERT INTO "public"."logs_alteracoes" ...)
```

**Causa:** o **valor** não existe no tipo. A tabela existe e as permissões estão certas — o `INSERT` chega
ao banco e é recusado na conversão para o enum. Diferente do `PGRST205`, aqui o PostgREST e o *schema
cache* não têm culpa: `NOTIFY` e *Restart server* **não** resolvem.

**Correção:** `ALTER TYPE … ADD VALUE` (migração `20261008010000_enum_emergencia_auditoria.sql`), que é
idempotente, avisa por `NOTICE` quando o tipo não existe em `public` (ou quando
`logs_alteracoes.entidade_tipo` não é desse enum), recarrega o cache e confere pelo catálogo `pg_enum`.

**Armadilha do PostgreSQL 12+:** o valor recém-adicionado **não pode ser usado na mesma transação**
(`ERROR 55P04: unsafe use of new value`). Como o SQL Editor do Supabase envia o arquivo inteiro como uma
transação, a migração **de propósito** deixa o teste com o valor novo como passo separado.

**Diagnóstico completo:** `SPECs/diagnostico/22P02-enum-emergencia.md`.
**Evidência:** `python3 tests/verify_enum_emergencia.py` (21 verificações em PostgreSQL real) e
`npm run test:enum` (regressão do front-end).

---

## 3. `23514` — violação de *check constraint* em `bercos`

**Sintoma:**

```text
ERROR: 23514: new row for relation "bercos" violates check constraint "bercos_vinculo_navio_check"
DETAIL: Failing row contains (BERCO-06, Berço 06, OCUPADO, null, null, null, ...).
```

**Causa:** berço `OCUPADO` precisa identificar o navio (`navio_nome` **ou** `navio_imo`). O comando tentou
gravar `estado = 'OCUPADO'` deixando as três colunas de vínculo nulas — exatamente o `null, null, null` do
`DETAIL`. O inverso também é barrado: berço `LIVRE`/`MANUTENCAO` não pode carregar resíduo de vínculo.

**Regra de negócio:** 1 navio por berço; o terminal STS-01 tem 15 posições.

```sql
-- ocupar com navio já cadastrado
update public.bercos b
   set estado = 'OCUPADO', navio_nome = n.nome, navio_imo = n.numero_imo, navio_id = n.id
  from public.navios n
 where b.id = 'BERCO-06' and n.numero_imo = 'IMO9999999';

-- liberar
update public.bercos
   set estado = 'LIVRE', navio_nome = null, navio_imo = null, navio_id = null
 where id = 'BERCO-06';

-- conferir (nenhuma linha pode ter OCUPADO sem nome/IMO, nem LIVRE/MANUTENCAO com navio_*)
select id, nome, estado, navio_nome, navio_imo, navio_id from public.bercos order by id;
```

Pela aplicação, o caminho equivalente é **Embarcações & GPS → cadastrar o navio → botão "Vincular"** (a
lista mostra apenas berços `LIVRE`). A tela normaliza cada berço antes de gravar
(`NexusSupabaseUtils.normalizarBerco`), então um cache local legado — por exemplo, berço marcado `OCUPADO`
por carga em versões antigas, sem navio — **não** derruba mais o *upsert* em lote dos 15 berços.

Regressão: `node tests/test_bercos_vinculo.js`.

**Se a intenção for ocupar sem identificar o navio** (não recomendado): o modelo precisa ser versionado em
migração, trocando a constraint por uma versão mais permissiva — o SQL está em `migrations/README.md`. O
painel exibe "Navio Alocado" quando o berço está `OCUPADO` sem nome/IMO, então a flexibilização não quebra
a interface, mas perde-se a rastreabilidade da embarcação.

---

## 4. Preflight CORS `401` nas Edge Functions

**Sintoma:** o navegador bloqueia a chamada com *"Response to preflight request doesn't pass access control
check"* e a aba Network mostra `401` no `OPTIONS`.

**Causa:** a função foi publicada com `verify_jwt` ligado. O gateway exige `Authorization` **também no
preflight**, e o `OPTIONS` não envia esse header.

**Correção:** republicar com `--no-verify-jwt` (o `supabase/config.toml` já declara isso para as 6 funções)
e garantir que o handler responda `OPTIONS` **antes** de qualquer validação:

```bash
supabase functions deploy panic-alert --no-verify-jwt
```

---

## 5. Roteiro de diagnóstico geral

```text
1. A tela abre?                      → auth-guard.js / cookie de sessão
2. Qual requisição falha?            → js/net-debug.js (console)
3. Qual o código do erro?
   ├── PGRST205 (404)                → migração não aplicada / schema cache
   ├── 22P02 (enum)                  → valor ausente no tipo
   ├── 23514 (check)                 → dado incoerente (berços)
   ├── 23505 (unique)                → identificador duplicado (IMO, matrícula)
   └── 401 no preflight              → verify_jwt na Edge Function
4. O Realtime não chega?             → publicação supabase_realtime
5. O contador mostra "—"?            → comportamento esperado sem Presence
```

Cada item corresponde a uma migração, um teste ou um comportamento documentado neste site — não há erro
conhecido sem causa identificada.
