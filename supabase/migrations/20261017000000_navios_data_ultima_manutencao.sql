-- ============================================================
-- Migração: Últimas correções (Tarefas 3 e 9)
-- 1. Tarefa 3: Coluna data_ultima_manutencao em public.navios
-- 2. Tarefa 9: Preservar vínculo de contêineres com o navio na chegada ao destino
-- Idempotente — pode ser executado no SQL Editor do Supabase com segurança.
-- ============================================================

begin;

-- 1. Tarefa 3: Data da última manutenção na tabela de navios
alter table public.navios
  add column if not exists data_ultima_manutencao date;

comment on column public.navios.data_ultima_manutencao is
  'Data da última manutenção realizada na embarcação (NULL quando ainda não houve manutenção registrada).';

-- 2. Tarefa 9: Garantir que apenas a carga se desvincule de ambos ao chegar no
-- destino, mantendo o contêiner vinculado ao navio (containers.navio_id).
create or replace function public.fn_propagar_status_navio()
returns trigger as $$
begin
  if NEW.localizacao = 'NO_PORTO_DE_DESTINO' then
    -- Garante que os contêineres com cargas do navio mantenham o vínculo com o
    -- navio antes de liberar container_id e navio_id da carga entregue.
    update public.containers k
       set navio_id = NEW.id
     where k.navio_id is null
       and exists (
         select 1
           from public.cargas c
          where c.container_id = k.id
            and c.navio_id = NEW.id
            and c.status_fluxo not in ('ENTREGUE', 'CANCELADA', 'RECUSADA')
       );

    update public.cargas c
       set status_fluxo = 'ENTREGUE',
           navio_nome_historico = coalesce(
             nullif(btrim(c.navio_nome_historico), ''),
             NEW.nome
           ),
           container_identificacao_historico = coalesce(
             nullif(btrim(c.container_identificacao_historico), ''),
             (select k.numero_identificacao
                from public.containers k
               where k.id = c.container_id)
           ),
           navio_id = null,
           container_id = null,
           updated_at = now()
     where c.status_fluxo not in ('ENTREGUE', 'CANCELADA', 'RECUSADA')
       and (
         c.navio_id = NEW.id
         or c.container_id in (
           select k.id from public.containers k where k.navio_id = NEW.id
         )
       );
  elsif NEW.localizacao = 'FORA_DO_PORTO' then
    -- Garante que os contêineres das cargas embarcadas estejam vinculados ao navio
    update public.containers k
       set navio_id = NEW.id
     where k.navio_id is null
       and exists (
         select 1
           from public.cargas c
          where c.container_id = k.id
            and c.navio_id = NEW.id
            and c.status_fluxo not in ('ENTREGUE', 'CANCELADA', 'RECUSADA')
       );

    update public.cargas
       set status_fluxo = 'EM_TRANSITO', updated_at = now()
     where status_fluxo not in ('EM_TRANSITO', 'ENTREGUE', 'CANCELADA', 'RECUSADA')
       and (
         navio_id = NEW.id
         or container_id in (select id from public.containers where navio_id = NEW.id)
       );
  end if;
  return NEW;
end;
$$ language plpgsql;

commit;

notify pgrst, 'reload schema';
