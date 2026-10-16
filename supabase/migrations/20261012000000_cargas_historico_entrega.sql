-- ============================================================
-- Migração: histórico da entrega em cargas (Backlog Parte 2 — Tarefa 5)
--
-- CONTEXTO
--   Ao chegar ao porto de destino, a carga deve deixar de ocupar o navio e o
--   contêiner (navio_id/container_id ativos = null), mas o nome do navio e a
--   identificação do contêiner precisam continuar disponíveis para tabelas,
--   gráficos e relatórios. Antes, o fluxo só apagava navio_id: o histórico se
--   perdia; em outros caminhos, os vínculos ativos permaneciam e o volume do
--   contêiner nunca era liberado.
--
-- O QUE ESTE SCRIPT FAZ
--   1. Adiciona os snapshots textuais `navio_nome_historico` e
--      `container_identificacao_historico` em public.cargas.
--   2. Preenche os snapshots das cargas já ENTREGUE a partir dos vínculos
--      ainda existentes (navio direto ou navio do contêiner).
--   3. Libera os vínculos ativos somente das cargas ENTREGUE.
--   4. Atualiza fn_propagar_status_navio() para, nas próximas entregas
--      disparadas pela localização do navio, gravar os snapshots e liberar
--      os vínculos na mesma atualização.
--
-- SEGURANÇA
--   - Aditiva e idempotente: pode ser executada mais de uma vez.
--   - Não apaga cargas nem altera cargas em qualquer outro status.
--   - Não altera políticas de acesso (RLS) existentes.
--
-- COMO APLICAR
--   Supabase CLI: supabase db push
--   ou Supabase > SQL Editor > colar este arquivo inteiro > Run.
-- ============================================================

begin;

alter table public.cargas
  add column if not exists navio_nome_historico text,
  add column if not exists container_identificacao_historico text;

comment on column public.cargas.navio_nome_historico is
  'Snapshot do nome do navio que transportou a carga. Preenchido na entrega, quando navio_id ativo é liberado.';
comment on column public.cargas.container_identificacao_historico is
  'Snapshot da identificação do contêiner que alocou a carga. Preenchido na entrega, quando container_id ativo é liberado.';

-- Backfill das entregas já registradas: primeiro pelo navio ainda vinculado
-- diretamente à carga; se não houver, pelo navio do contêiner ainda vinculado.
update public.cargas c
   set navio_nome_historico = coalesce(
         nullif(btrim(c.navio_nome_historico), ''),
         (select n.nome from public.navios n where n.id = c.navio_id),
         (select n.nome
            from public.containers k
            join public.navios n on n.id = k.navio_id
           where k.id = c.container_id)
       ),
       container_identificacao_historico = coalesce(
         nullif(btrim(c.container_identificacao_historico), ''),
         (select k.numero_identificacao
            from public.containers k
           where k.id = c.container_id)
       )
 where c.status_fluxo = 'ENTREGUE';

-- Com o snapshot preservado, nenhuma carga entregue mantém vínculo ativo.
update public.cargas
   set navio_id = null,
       container_id = null,
       updated_at = now()
 where status_fluxo = 'ENTREGUE'
   and (navio_id is not null or container_id is not null);

-- Entregas futuras disparadas no banco seguem a mesma regra: snapshot +
-- liberação dos vínculos ativos, atomicamente, na transição para ENTREGUE.
create or replace function public.fn_propagar_status_navio()
returns trigger as $$
begin
  if NEW.localizacao = 'NO_PORTO_DE_DESTINO' then
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

-- Verificação (opcional): cargas entregues devem ter vínculos ativos nulos;
-- quando havia navio/contêiner identificável, os snapshots ficam preenchidos.
-- select qr_code_url, navio_id, container_id,
--        navio_nome_historico, container_identificacao_historico
--   from public.cargas
--  where status_fluxo = 'ENTREGUE'
--  order by created_at desc
--  limit 20;

-- Não recarregue o PostgREST manualmente: a API reconhece as novas colunas
-- automaticamente. Se o app ainda reclamar, execute:
-- notify pgrst, 'reload schema';
