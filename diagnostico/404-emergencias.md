# Diagnóstico — HTTP 404 em `/rest/v1/emergencias` (PGRST205)

**Data:** 2026-10-08 · **Terminal:** STS-01 (Santos) · **Módulo:** Botão de Pânico Global

---

## 1. Relato

Requisição capturada no painel *Network* do navegador (toda tela interna do NexusPort):

| Campo | Valor |
| --- | --- |
| **URL** | `https://loedodixvmadxqgykehh.supabase.co/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1` |
| **Método** | `GET` |
| **Status** | `404 Not Found` |
| **Endereço remoto** | `172.64.149.246:443` (edge do Supabase) |
| **Referrer policy** | `strict-origin-when-cross-origin` |

## 2. Diagnóstico

**Causa raiz:** a tabela `public.emergencias` **não existe** no projeto Supabase
`loedodixvmadxqgykehh`. O PostgREST responde `404` (corpo `PGRST205 — Could not
find the table 'public.emergencias' in the schema cache`) para qualquer
requisição a uma tabela que não está no seu *schema cache*.

É um **erro de provisionamento de banco**, não um bug de front-end:

- a URL está correta (`https://<ref>.supabase.co/rest/v1/<tabela>`);
- a *publishable key* está correta — com chave inválida o PostgREST responderia `401`, não `404`;
- o RLS não é o problema — política ausente/negada gera `200` com `[]` ou `403`, nunca `404`;
- CORS/referrer policy não são o problema — o `404` **é** a resposta do servidor (a requisição chegou).

A consulta vem de `js/panic-realtime.js` → `loadStateFromDb()` (estado inicial do
rodapé de emergência, para clientes que conectam durante uma emergência ativa).
A mesma origem dispara a consulta a `panic_webhook_config` (painel de webhook em
`manutencao.html`), que sofria do mesmo `404`.

**Proveniência das tabelas:** `supabase/migrations/20261007000000_panic_button_global.sql`
(mais `SPECs/schema.sql`, seção 15, e `TABLES.md`). O arquivo sempre existiu no
repositório, mas **nunca foi aplicado ao projeto Supabase** — não havia registro
em `supabase_migrations.schema_migrations`, e `SPECs/migrations/README.md` não o
listava, o que escondia a pendência de quem operava o banco.

## 3. Impacto enquanto a tabela estiver ausente

| Recurso | Comportamento no modo degradado |
| --- | --- |
| Alerta em tempo real (WebSocket, canal `nexus-emergency`) | **Funciona** (broadcast direto cliente → clientes) |
| Rodapé de emergência | Funciona, mas só pelo flag local (`nexus_emergency_active`) |
| Cliente que conecta **depois** do acionamento | **Não vê** a emergência (não há estado global persistido) |
| Webhook externo opcional | **Nunca dispara** (a integração vive no servidor/Edge Function) |
| Auditoria em `logs_alteracoes` (`entidade_tipo = EMERGENCIA`) | Falha silenciosa se o valor não existir em `tipo_entidade_enum` — **ocorreu em produção** (erro `22P02`): ver [`22P02-enum-emergencia.md`](22P02-enum-emergencia.md) |

## 4. Correção aplicada

### 4.1 Migração reparadora (ação obrigatória no projeto Supabase)

**Arquivo:** `supabase/migrations/20261008000000_emergencias_fix_404.sql`

Idempotente e reparadora — pode ser executada em banco virgem, sobre um banco já
migrado pela `20261007000000` (vira verificação) ou sobre uma tabela criada pela
metade:

1. checa pré-requisitos (`public.funcionarios`, `cargo_enum`) e **avisa** quando já existe uma `emergencias` em outro schema (causa comum de `PGRST205`);
2. cria/reconcilia `public.emergencias` (colunas, defaults, `NOT NULL`, `CHECK` de `estado`/`origem`, FK para `funcionarios`, índice `(estado, data_hora desc)`);
3. cria/reconcilia `public.panic_webhook_config` e garante a **linha única com o webhook desativado**;
4. adiciona o valor `EMERGENCIA` ao `tipo_entidade_enum` (auditoria) — se o projeto só precisa desse valor, a migração focada é `20261008010000_enum_emergencia_auditoria.sql` (ver [`22P02-enum-emergencia.md`](22P02-enum-emergencia.md));
5. habilita RLS e **recria as políticas `nexus_*` para `anon, authenticated`** (o projeto não usa Supabase Auth — ver `SPECs/migrations/README.md`), com *fallback* para `PUBLIC` em PostgreSQL local;
6. termina com `notify pgrst, 'reload schema'` (fora da transação) e um `select` de conferência visível no SQL Editor.

**Aplicar** (escolha um caminho):

```bash
# A) CLI
supabase link --project-ref loedodixvmadxqgykehh
supabase db push

# B) Painel: Dashboard → SQL Editor → New query → colar o arquivo → Run
```

### 4.2 Verificação

```bash
curl "https://loedodixvmadxqgykehh.supabase.co/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
     -H "apikey: sb_publishable_roaEDGaeGQplCE9qWs4vuQ_8xrbQ"
# esperado: 200 ([] quando não há emergência ativa, ou a linha da emergência ATIVA)
```

No app: **Manutenção → Webhook de Emergência → Banco de dados → Verificar**
(testa `emergencias` e `panic_webhook_config` e diz o que falta) ou, no console:

```js
await NexusPanic.diagnose()        // { disponivel: true, migracao, retry_agendado, estado_local }
await NexusPanic.verificarTabelas()
```

Se o `404`/`PGRST205` persistir alguns segundos após o `Run`, use
*Settings → API → Restart server* (recarga do *schema cache* do PostgREST).

### 4.3 Resiliência do front-end (para não repetir o susto)

| Arquivo | Mudança |
| --- | --- |
| `js/supabase-client.js` | `isTabelaAusenteError` reconhece `PGRST205`, `PGRST202`, `42P01`, HTTP `404` e a mensagem *Could not find the table*; novo `diagnosticar(tabela)` (HEAD barato) + `liberarTabela`/`tabelasIndisponiveis`; a mensagem de aviso aponta **a migração exata** de cada tabela (`emergencias` → `20261008000000...`, `bercos` → `001_create_bercos.sql`) |
| `js/panic-realtime.js` | Consulta só com `clientePara('emergencias')`; aviso único por sessão (sem enxurrada de erros); fallback local preservado; **rechecagem com backoff** (5 s → 15 s → 45 s → 2 min, além de `visibilitychange` e `online`) que reativa o estado global sem recarregar a página; `NexusPanic.diagnose()` e `NexusPanic.verificarTabelas()`; o feedback do fallback informa a migração pendente ao operador |
| `manutencao.html` | Painel **Banco de dados (tabelas do pânico)** com botão **Verificar** e status em uma linha |

### 4.4 Evidência automatizada

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Migração em PostgreSQL **real** (virgem, já migrado, parcial, outro schema, pré-requisito ausente + role `anon`) | `python3 tests/verify_migration_emergencias.py` | **24/24 ✅** |
| Regressão do 404 no front-end (estático + jsdom com cliente falso: 404 → fallback → auto-cura) | `npm run test:migracao` | **✅** |
| Suíte do pânico (Edge Function, WebSocket, webhook, haptics) | `npm run test:panic` | **✅** |

Para a verificação em PostgreSQL real: `pip install psycopg2-binary pgserver pglast`
(o script sobe um cluster descartável em `/tmp`; sem `pgserver`, usa
`NEXUS_TEST_DATABASE_URL`).

## 5. Prevenção

1. **Toda tabela usada pelo front-end precisa de migração numerada** em `supabase/migrations/` — e a lista em `SPECs/migrations/README.md` deve acompanhá-la (feito).
2. **`npm run test:panic` agora roda a regressão do 404** — qualquer remoção da resiliência ou das mensagens de diagnóstico quebra a suíte.
3. **Diagnóstico visível ao operador**, não apenas no console: o botão *Verificar* no painel de manutenção.
4. **Antes de liberar uma versão**, rode a verificação `curl` da seção 4.2 nas tabelas citadas pelo módulo de emergência.

## 6. Checklist de encerramento

- [ ] `supabase db push` (ou SQL Editor) aplicado com a migração `20261008000000_emergencias_fix_404.sql`
- [ ] `curl` da seção 4.2 respondendo `200`
- [ ] **Manutenção → Banco de dados → Verificar** mostrando `✔ Tabelas do botão de pânico provisionadas`
- [ ] Edge Function implantada: `supabase functions deploy panic-alert --no-verify-jwt`
- [ ] Teste real do botão de pânico em dois aparelhos (um recebendo sem recarregar a página) e desativação por cargo autorizado
