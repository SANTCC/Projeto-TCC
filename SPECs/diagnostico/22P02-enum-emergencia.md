# Diagnóstico — `22P02` em `logs_alteracoes` (enum `tipo_entidade_enum`)

**Data:** 2026-10-08 · **Terminal:** STS-01 (Santos) · **Módulo:** Botão de Pânico Global / Auditoria

---

## 1. Relato

Registro capturado no **Logs Explorer** do Supabase (projeto `loedodixvmadxqgykehh`),
originado pelo PostgREST durante o POST da aplicação:

| Campo | Valor |
| --- | --- |
| `service_name` | `postgres_logs` |
| `parsed.application_name` | `PostgREST 14.5` |
| `parsed.user_name` | `authenticator` (role `anon` da aplicação) |
| `parsed.sql_state_code` | `22P02` |
| `event_message` | `invalid input value for enum tipo_entidade_enum: "EMERGENCIA"` |
| `parsed.timestamp` | `2026-10-08 16:59:01.933 UTC` |
| `parsed.query` | `WITH pgrst_source AS (INSERT INTO "public"."logs_alteracoes"("cargo", …, "entidade_tipo", …) …)` |

## 2. Diagnóstico

**Causa raiz:** o tipo `public.tipo_entidade_enum` do banco **não tem o valor
`EMERGENCIA`**. O `INSERT` é recusado pelo PostgreSQL *antes de gravar a linha*
(`enum_in` → `22P02 invalid_text_representation`), e o PostgREST devolve HTTP
`400` com esse código.

Não é cache, RLS, CORS ou chave:

- o `INSERT` **chegou** ao banco (a linha de log traz a query completa, com o payload `$1` convertido por `json_to_record`);
- `22P02` é erro de **valor** (`enum_in`), não de permissão — sem `INSERT`/RLS o erro seria `42501` ou `PGRST` de permissão;
- recarregar o *schema cache* não resolveria: o valor não existe no catálogo `pg_enum`.

**De onde vem o `INSERT`:** `js/panic-realtime.js` → `registrarAuditoria()`, que
grava `entidade_tipo: 'EMERGENCIA'` a cada acionamento/desativação do pânico
(o mesmo valor é usado por `js/dashboard.js` → `registrarLogAlteracao()` com a
entidade `emergencia`, no caminho legado de `manutencao.html`).

`logs_alteracoes.entidade_tipo` é do tipo `tipo_entidade_enum` (`SPECs/schema.sql`,
seção 8). O valor `EMERGENCIA` é criado na **seção 15** do schema completo
(`alter type tipo_entidade_enum add value if not exists 'EMERGENCIA';`) e na
migração do pânico. Banco provisionado a partir de uma versão do schema anterior
às duas ficou sem o valor — e a migração `20261008000000_emergencias_fix_404.sql`,
que também o adiciona, ainda não foi aplicada neste projeto.

**Por que ninguém viu na tela:** o insert era disparado com o resultado
descartado — `await sb.from('logs_alteracoes').insert(payload);` — e o
supabase-js devolve o erro do PostgREST no objeto de resposta (não lança). A
recusa do banco só existia no log do Postgres: **a emergência era declarada,
o alarme funcionava e a trilha de auditoria se perdia em silêncio**.

## 3. Impacto enquanto o valor não existir

| Recurso | Comportamento |
| --- | --- |
| Alarme global (WebSocket, canal `nexus-emergency`) | **Funciona** |
| Estado global em `emergencias` (clientes que conectam depois) | **Funciona** (não depende deste enum) |
| Bloqueio de operações do pátio com emergência ativa | **Funciona** |
| Auditoria em `logs_alteracoes` (`entidade_tipo = EMERGENCIA`) | **Perdida** — `22P02`, nenhuma linha gravada |
| Trilha de decisões / histórico de emergências nos relatórios | Sem os registros do pânico |

É o cenário já previsto na tabela da seção 3 de
[`404-emergencias.md`](404-emergencias.md) e agora **observado em produção**.

## 4. Correção aplicada

### 4.1 Migração (ação obrigatória no projeto Supabase)

**Arquivo:** `supabase/migrations/20261008010000_enum_emergencia_auditoria.sql`

Idempotente, segura no SQL Editor e no `supabase db push`:

1. adiciona `EMERGENCIA` ao tipo `public.tipo_entidade_enum` (`add value if not exists`);
2. avisa (por `NOTICE`) quando o tipo não existe em `public` — inclusive quando há um homônimo em outro schema, que o PostgREST não expõe;
3. avisa quando `logs_alteracoes.entidade_tipo` não é desse enum (banco legado);
4. recarrega o *schema cache* do PostgREST (`notify pgrst, 'reload schema'`);
5. termina com um `select` de conferência visível no SQL Editor.

**Caminho rápido** (uma linha, desbloqueia na hora):

```sql
alter type public.tipo_entidade_enum add value if not exists 'EMERGENCIA';
```

> **Armadilha (documentada na própria migração):** `alter type … add value` não
> pode ser seguido do **uso** do valor na mesma transação — o PostgreSQL responde
> `55P04 unsafe use of new value`. O SQL Editor do Supabase envia o script inteiro
> como **uma** transação, então um arquivo que faz "adiciona e testa" falha. Por
> isso a migração confere o valor apenas no catálogo (`pg_enum`) e deixa o teste
> de `INSERT` como passo separado (seção 4 do arquivo).

**Aplicar:**

```bash
# A) CLI
supabase link --project-ref loedodixvmadxqgykehh
supabase db push

# B) Painel: Dashboard → SQL Editor → New query → colar o arquivo → Run
```

> Se o projeto for novo e nada mais foi aplicado, a migração
> `20261008000000_emergencias_fix_404.sql` já cobre este valor **e** cria as
> tabelas do pânico — nesse caso ela é a escolha certa (esta aqui é o remédio
> focado e continua funcionando depois dela, como no-op).

### 4.2 Verificação

No SQL Editor (deve listar `EMERGENCIA` entre os valores):

```sql
select e.enumlabel
  from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'tipo_entidade_enum'
 order by e.enumsortorder;
```

Teste de ponta a ponta — em um **passo separado** (nova query), porque o valor
passa a ser usado:

```sql
insert into public.logs_alteracoes
  (cargo, codigo_individual, entidade_tipo, entidade_id, tipo_alteracao, detalhes)
values
  ('INSPETOR', 'INS-000', 'EMERGENCIA', 'TESTE_MIGRACAO', 'EDICAO',
   '{"teste":"20261008010000_enum_emergencia_auditoria"}'::jsonb)
returning id, data_hora, entidade_tipo;
```

```
-- esperado: INSERT 0 1   (sem ERROR 22P02)
-- limpeza opcional:
delete from public.logs_alteracoes where entidade_id = 'TESTE_MIGRACAO';
```

No app: **Manutenção → Webhook de Emergência → Banco de dados → Verificar**
(a partir desta correção o painel também sonda o valor do enum e diz qual
arquivo aplicar) ou, no console:

```js
await NexusPanic.verificarTabelas()   // { ok, mensagem, tabelas, auditoria, migracao }
await NexusPanic.diagnose()           // inclui auditoria_enum { valor, tipo, disponivel, migracao }
```

Depois do `Run`, acione o botão de pânico: o feedback do operador não deve conter
`⚠️ Auditoria NÃO gravada` e a linha deve aparecer em `logs_alteracoes`.

### 4.3 Resiliência do front-end (para não repetir o susto)

| Arquivo | Mudança |
| --- | --- |
| `js/supabase-client.js` | `enumDesconhecido()` / `isEnumDesconhecidoError()` reconhecem `22P02` pelo corpo do PostgREST **e** pelo registro de log do Postgres (`event_message`/`sql_state_code`); `registrarEnumDesconhecido()` avisa **uma única vez** por tipo/valor, com o arquivo `.sql` exato; `avisoEnum()` monta a mensagem de UI; `verificarEnumAuditoria()` sonda o valor com `select … eq(coluna, valor).limit(0)` — **read-only**; a mesma mensagem de erro de tabela ausente (`PGRST205`) continua valendo |
| `js/panic-realtime.js` | `registrarAuditoria()` **lê o erro** do insert (antes descartava), classifica e devolve `{ ok: false, motivo: 'enum_desconhecido', migracao }`; o feedback do pânico passou a incluir a nota `⚠️ Auditoria NÃO gravada: … aplique <migração>`; `verificarTabelas()`/`diagnose()` passaram a reportar o valor do enum (`auditoria` / `auditoria_enum`) |
| `js/dashboard.js` | `registrarLogAlteracao()` mapeia a entidade `emergencia` para `entidade_tipo = 'EMERGENCIA'` **e** trata o erro do insert (antes só repetia sem a FK e seguia em silêncio) |
| `js/manutencao.js` | Caminho legado do pânico chamava `registrarLogAlteracao('EDICAO', 'emergencia', null, {…})` — argumentos fora de ordem, o que gravava `CARGA`/`EDICAO` e **descartava** os detalhes. Corrigido para `('emergencia', 'EDICAO', {…})` |
| `manutencao.html` | O painel **Banco de dados (tabelas do pânico)** já existia; o texto do diagnóstico agora cobre também a auditoria |

### 4.4 Evidência automatizada

| Verificação | Comando | Resultado |
| --- | --- | --- |
| 22P02 reproduzido e corrigido em PostgreSQL **real** (enum, role `anon`, idempotência, armadilha 55P04, banco sem o tipo) | `python3 tests/verify_enum_emergencia.py` | **21/21 ✅** |
| Regressão do 22P02 no front-end (estático + jsdom com cliente falso: pânico com auditoria pendente → migração aplicada → auditoria grava) | `npm run test:enum` | **✅** |
| Regressão do 404 (`PGRST205`) — continua válida | `npm run test:migracao` | **✅** |
| Suíte do pânico (Edge Function, WebSocket, webhook, haptics) | `npm run test:panic` | **✅** |

Para a verificação em PostgreSQL real: `pip install psycopg2-binary pgserver`
(o script sobe um cluster descartável em `/tmp`; sem `pgserver`, usa
`NEXUS_TEST_DATABASE_URL`).

## 5. Prevenção

1. **Valor de enum é provisionamento de banco**: toda coluna `*_enum` usada pelo front-end precisa ter o valor criado por migração — e a lista em `SPECs/migrations/README.md` deve acompanhá-la (feito).
2. **Nunca descartar o retorno do supabase-js**: o erro chega em `{ error }`, não como exceção. Insert sem leitura de `error` é auditoria que pode sumir calada (revisado nos módulos do pânico; vale como regra geral).
3. **Diagnóstico visível ao operador**: o botão *Verificar* do painel de manutenção passou a sondar o valor do enum, não apenas a existência das tabelas.
4. **Teste de ponta a ponta antes de liberar**: acionar o pânico e conferir a linha em `logs_alteracoes` (a migração traz esse `INSERT` pronto na seção 4).

## 6. Checklist de encerramento

- [ ] Migração `20261008010000_enum_emergencia_auditoria.sql` aplicada (`supabase db push` ou SQL Editor)
- [ ] `select e.enumlabel from pg_enum …` listando `EMERGENCIA`
- [ ] **Manutenção → Banco de dados → Verificar** sem o aviso de auditoria pendente
- [ ] `INSERT` de teste da seção 4.2 respondendo `INSERT 0 1`
- [ ] Pânico acionado e desativado com as duas linhas em `logs_alteracoes` (`entidade_tipo = 'EMERGENCIA'`)
