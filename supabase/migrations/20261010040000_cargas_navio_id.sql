-- ============================================================
-- Migração: coluna cargas.navio_id (vínculo carga -> navio)
--
-- CONTEXTO
--   O front-end grava/lê cargas.navio_id (cadastro e vinculação de cargas, liberação de
--   navio, entrega automática ao chegar ao destino), mas a tabela `cargas` do schema
--   não tinha essa coluna. Os updates falhavam em silêncio no banco real.
--
-- O QUE ESTE SCRIPT FAZ
--   1. Adiciona cargas.navio_id (uuid, FK para navios, ON DELETE SET NULL).
--      Excluir um navio NÃO apaga cargas: apenas desvincula.
--   2. Cria índice para as consultas por navio.
--   3. Preenche o vínculo das cargas que já estão em contêiner de navio
--      (cargas.container_id -> containers.navio_id). Só altera linhas com navio_id nulo.
--
-- SEGURANÇA
--   - Idempotente: pode ser executado mais de uma vez.
--   - Não altera status, peso, valores ou demais colunas.
--   - Não altera políticas de acesso (RLS) existentes.
--
-- COMO APLICAR
--   Supabase > SQL Editor > colar este arquivo inteiro > Run.
-- ============================================================

begin;

alter table public.cargas
  add column if not exists navio_id uuid
  references public.navios(id) on delete set null;

create index if not exists idx_cargas_navio_id on public.cargas (navio_id);

-- Preenchimento a partir do contêiner (somente onde ainda não há vínculo)
update public.cargas c
   set navio_id = k.navio_id
  from public.containers k
 where c.container_id = k.id
   and k.navio_id is not null
   and c.navio_id is null;

commit;

-- Verificação (opcional): deve retornar a coluna com tipo uuid
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'cargas' and column_name = 'navio_id';

-- Não recarregue o PostgREST manualmente: a API reconhece a nova coluna automaticamente.
-- Se o app ainda reclamar, execute: notify pgrst, 'reload schema';
