# Migrações SQL — NexusPort

Scripts incrementais para aplicar no banco Supabase **já existente**
(o arquivo `SPECs/schema.sql` é o schema completo, usado em bancos novos).

## Como aplicar

1. Acesse o painel do Supabase do projeto.
2. Vá em **SQL Editor → New query**.
3. Cole o conteúdo do arquivo da migração e clique em **Run**.
4. Se o erro `PGRST205` persistir por alguns segundos, use
   **Settings → API → Restart server** ou rode `notify pgrst, 'reload schema';`
   (já incluso nos scripts).

## Migrações

| Arquivo | Descrição |
| --- | --- |
| `001_create_bercos.sql` | Cria `public.bercos` (15 berços do terminal STS-01), índices, trigger de `updated_at`, RLS e carga inicial. Corrige o erro `Could not find the table 'public.bercos' in the schema cache` na tela de Embarcações. |
