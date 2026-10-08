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
| `../supabase/migrations/20261007000000_panic_button_global.sql` | Migração canônica do Botão de Pânico GLOBAL: tabelas `emergencias` e `panic_webhook_config`, RLS, políticas `nexus_*` e valor `EMERGENCIA` no `tipo_entidade_enum`. |
| `../supabase/migrations/20261008000000_emergencias_fix_404.sql` | **Correção do 404 / PGRST205 em `/rest/v1/emergencias`**: versão idempotente e reparadora da migração acima (reconcilia estrutura parcial, normaliza dado legado, recria as políticas `nexus_*` para `anon, authenticated`, recarrega o *schema cache* com `notify pgrst, 'reload schema'` e termina com um `select` de verificação). Pode ser aplicada depois da `20261007000000` sem erro. |

### Migrações do botão de pânico: qual aplicar?

| Estado do banco | O que fazer |
| --- | --- |
| Nunca migrado (é o caso do erro 404 em `/rest/v1/emergencias`) | Aplique **`20261008000000_emergencias_fix_404.sql`**. Ela cria tudo o que a `20261007000000` criaria e ainda deixa o banco verificável. |
| Já migrado com a `20261007000000` | A `20261008000000` vira um *no-op* de verificação — segura para rodar, útil para recarregar o *schema cache*. |
| Tabela criada pela metade / alterada manualmente | A `20261008000000` reconcilia colunas, defaults, `NOT NULL`, `CHECK`s e a FK antes de seguir. |

O erro `PGRST205` (`Could not find the table 'public.x' in the schema cache`)
significa apenas que o PostgREST não conhece a tabela: as três causas usuais são
(a) a migração não foi aplicada, (b) ela foi aplicada em outro schema (o
PostgREST expõe só `public`) ou (c) o *schema cache* ainda não recarregou. A
migração `20261008000000` detecta e informa os três casos por `NOTICE`.

**Prova de execução:** `python3 tests/verify_migration_emergencias.py` aplica a
migração em um PostgreSQL real e cobre cinco cenários (banco virgem, migração
antiga aplicada, estado parcial, tabela em outro schema, pré-requisito ausente)
e o acesso pela role `anon` — 24 verificações, todas cobertas por asserção.

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
