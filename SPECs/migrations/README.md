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
