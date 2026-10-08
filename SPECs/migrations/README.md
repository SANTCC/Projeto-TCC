# Migrações SQL — NexusPort

Scripts incrementais para aplicar no banco Supabase **já existente**
(o arquivo `SPECs/schema.sql` é o schema completo, usado em bancos novos).

## Como aplicar

1. Acesse o painel do Supabase do projeto.
2. Vá em **SQL Editor → New query**.
3. Cole o conteúdo do arquivo da migração e clique em **Run**.
4. Leia os `NOTICE` da saída: eles informam o que foi criado e o que ficou
   pendente de limpeza manual de dados.
5. Se o erro `PGRST205` persistir por alguns segundos, use
   **Settings → API → Restart server** (o `notify pgrst, 'reload schema';`
   já está no fim do script).

## Migrações

| Arquivo | Descrição |
| --- | --- |
| `001_create_bercos.sql` | Cria `public.bercos` (15 berços do terminal STS-01), constraints, índices, trigger de `updated_at`, RLS e carga inicial. Corrige `Could not find the table 'public.bercos' in the schema cache` (PGRST205) na tela de Embarcações. |

## Modelo de segurança (importante)

O NexusPort **não usa Supabase Auth**: o login é próprio (código individual
validado em `js/auth-guard.js`, sessão em `sessionStorage`) e o front-end
acessa o PostgREST com a chave *publishable*/anon. Logo, **toda requisição
chega como role `anon`** — nunca como `authenticated`.

Consequência prática: uma política `... for all to authenticated ...` em
`bercos` bloquearia 100% do acesso da aplicação. Por isso a política é
concedida a `anon, authenticated`, no mesmo padrão permissivo das demais
tabelas do schema (`navios`, `cargas`, `containers`...).

**Risco aceito e documentado:** quem tiver a chave publishable pode ler e
escrever nos berços. Aceitável em protótipo acadêmico com dados não
sensíveis; **não** aceitável em produção. A migração `001` traz, comentado,
o conjunto de políticas endurecidas (leitura para autenticados + escrita
restrita a cargos operacionais via `funcionarios.user_id = auth.uid()`),
prontas para quando o login migrar para Supabase Auth.

## Garantias da migração 001 (verificadas em PostgreSQL real)

- **Transacional**: tudo dentro de `begin/commit`; falha de pré-requisito
  aborta sem deixar tabela pela metade.
- **Idempotente**: executada duas vezes seguidas, sem erros e sem duplicar
  berços.
- **Pré-requisitos checados**: aborta com mensagem clara se `public.navios`
  não existir ou se `navios.id` não for `uuid`.
- **Portátil**: detecta se as roles `anon`/`authenticated` existem; em
  PostgreSQL local cria a política para `PUBLIC` em vez de falhar.
- **Tolerante a base legada**: se `bercos` já existir com colunas faltando,
  completa a estrutura; se houver dados que violem uma constraint, emite
  `NOTICE` e segue, em vez de abortar.
- **Não destrutiva**: `on conflict (nome) do nothing` preserva berços já
  ocupados. Há um bloco comentado para reset total, se desejado.

### Constraints criadas

| Constraint | Efeito |
| --- | --- |
| `bercos_nome_key` | `unique (nome)` — exigida pelo `upsert ... onConflict: 'nome'` do front-end. |
| `bercos_estado_check` | `estado in ('LIVRE','OCUPADO','MANUTENCAO')`. |
| `bercos_id_formato_check` | `id ~ '^BERCO-[0-9]{2}$'` — bloqueia ids arbitrários como `TESTE`. |
| `bercos_vinculo_navio_check` | Impede `LIVRE` com navio preenchido e `OCUPADO` sem identificação do navio. |
| `bercos_navio_id_fkey` | FK para `navios(id)` com `on delete set null` (apagar navio nunca apaga o berço). |

## Erro 23514 em `bercos` (constraint `bercos_vinculo_navio_check`)

Mensagem típica no SQL Editor / API:

```
ERROR: 23514: new row for relation "bercos" violates check constraint "bercos_vinculo_navio_check"
DETAIL: Failing row contains (BERCO-06, Berço 06, OCUPADO, null, null, null, ...).
```

**Causa:** berço `OCUPADO` precisa identificar o navio (`navio_nome` **ou**
`navio_imo`). O comando tentou gravar `estado = 'OCUPADO'` deixando as três
colunas de vínculo nulas — exatamente o `null, null, null` do `DETAIL`. O
inverso também é barrado: berço `LIVRE`/`MANUTENCAO` não pode carregar resíduo
de vínculo.

A regra de negócio é **1 navio por berço** (15 posições do terminal STS-01).

### Ocupar um berço (SQL correto)

```sql
-- A) Navio já cadastrado em public.navios: grava nome, IMO e a FK
update public.bercos b
   set estado     = 'OCUPADO',
       navio_nome = n.nome,
       navio_imo  = n.numero_imo,
       navio_id   = n.id
  from public.navios n
 where b.id = 'BERCO-06'
   and n.numero_imo = 'IMO9999999';   -- ajuste para o numero_imo real

-- B) Teste/demonstração sem navio no banco: snapshot por nome + IMO
--    (navio_id fica null, pois a FK só aceita uuid de public.navios)
update public.bercos
   set estado     = 'OCUPADO',
       navio_nome = 'Navio Demonstração',
       navio_imo  = 'IMO0000000',
       navio_id   = null
 where id = 'BERCO-06';
```

### Liberar o berço

```sql
update public.bercos
   set estado = 'LIVRE', navio_nome = null, navio_imo = null, navio_id = null
 where id = 'BERCO-06';
```

### Conferir o estado do painel

```sql
select id, nome, estado, navio_nome, navio_imo, navio_id
  from public.bercos
 order by id;
-- Nenhuma linha pode ter OCUPADO sem nome/IMO, nem LIVRE/MANUTENCAO com navio_*.
```

Pela aplicação o caminho equivalente é **Embarcações & GPS → cadastrar o navio
→ botão “Vincular”** (a lista mostra apenas berços `LIVRE`). A tela normaliza
cada berço antes de gravar (`NexusSupabaseUtils.normalizarBerco`, em
`js/supabase-client.js`), então um cache local legado — por exemplo berço
marcado `OCUPADO` por carga em versões antigas, sem navio — não derruba mais o
upsert em lote dos 15 berços. Regressão coberta por
`node tests/test_bercos_vinculo.js`.

### Se a intenção for ocupar sem identificar o navio (opcional, não recomendado)

O ajuste correto é decidir o modelo e versioná-lo em migração — trocar a
constraint por uma versão mais permissiva:

```sql
alter table public.bercos drop constraint bercos_vinculo_navio_check;
alter table public.bercos add constraint bercos_vinculo_navio_check check (
  (estado <> 'OCUPADO' and navio_nome is null and navio_imo is null and navio_id is null)
  or
  (estado = 'OCUPADO')  -- passa a aceitar OCUPADO sem identificação (reserva/demonstração)
);
```

Observação: o painel de Embarcações exibe “Navio Alocado” quando o berço está
`OCUPADO` sem nome/IMO, então a flexibilização não quebra a interface — mas
perde-se a garantia de rastrear qual embarcação ocupa a posição.
