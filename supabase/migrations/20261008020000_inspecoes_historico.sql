-- ============================================================
-- Histórico de inspeções (política C: manter histórico)
--
-- Antes: inspecoes.carga_id era UNIQUE, então só cabia UMA inspeção por carga.
-- Uma nova inspeção da mesma carga era recusada pelo banco (23505) e a tela
-- avisava falha de gravação.
--
-- Depois: uma carga pode ter várias inspeções, e no máximo UMA fica ativa
-- (ativa = true). Ao reinspecionar, a aplicação marca a inspeção ativa anterior
-- como ativa = false (histórico) e grava a nova como ativa. O índice parcial
-- garante no próprio banco que não existam duas inspeções ativas por carga.
--
-- Idempotente. Se a tabela ainda não existir, não faz nada: ela é criada
-- por SPECs/schema.sql.
-- ============================================================

do $$
begin
  if to_regclass('public.inspecoes') is null then
    raise notice 'public.inspecoes não existe; migração de histórico de inspeções ignorada.';
  else
    alter table public.inspecoes drop constraint if exists inspecoes_carga_id_key;

    -- Inspeções já existentes continuam ativas: antes só havia uma por carga.
    alter table public.inspecoes add column if not exists ativa boolean not null default true;

    create unique index if not exists uq_inspecoes_carga_ativa
      on public.inspecoes (carga_id)
      where ativa;
  end if;
end
$$;
