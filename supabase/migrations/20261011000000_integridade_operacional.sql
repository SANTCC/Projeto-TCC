-- ============================================================
-- Integridade operacional — exclusões, berços e manutenção
--
-- Causas-raiz corrigidas (ver js/integridade-operacional.js):
--
-- 1. EXCLUSÃO "FANTASMA": navios, guindastes, contêineres e cargas não tinham
--    política RLS de DELETE. O PostgREST respondia 204 com 0 linhas removidas,
--    o front-end tratava como sucesso e o registro "voltava" no recarregamento.
--    -> políticas nexus_delete_* (mesmo modelo das demais: o app não usa
--       Supabase Auth; todo acesso chega como anon).
--
-- 2. HISTÓRICO APAGADO EM CASCATA: manutencoes/historico_manutencoes tinham
--    FK ON DELETE CASCADE para navios/containers/guindastes — excluir um
--    equipamento apagaria todo o histórico de manutenção dele.
--    -> FKs recriadas como ON DELETE SET NULL (o histórico é preservado; a
--       descrição da OS continua identificando o equipamento).
--
-- 3. BERÇOS: a ocupação era decidida pelo cache local do navegador e dois
--    navios podiam ocupar o mesmo berço em acessos concorrentes.
--    -> índices únicos parciais (um navio por berço OCUPADO), RPC
--       nexus_ocupar_berco (transacional, com FOR UPDATE) e gatilho que libera
--       o berço quando o navio sai do porto ou é excluído.
--
-- 4. EQUIPAMENTO EM MANUTENÇÃO EM USO: nada no banco impedia vincular carga a
--    contêiner/navio em reforma por chamada direta à API.
--    -> gatilhos de validação em cargas e containers.
--
-- 5. EXCLUSÃO DE NAVIO EM VÁRIAS ETAPAS sem transação.
--    -> RPC nexus_excluir_navio (bloqueios justificados + desvínculo + delete
--       numa única transação).
--
-- Idempotente: pode ser executada mais de uma vez.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Políticas de DELETE
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['navios', 'guindastes', 'containers', 'cargas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'nexus_delete_' || t, t);
      execute format('create policy %I on public.%I for delete to public using (true)', 'nexus_delete_' || t, t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. FKs de manutenção: CASCADE -> SET NULL (preserva o histórico)
-- ------------------------------------------------------------
do $$
declare
  r record;
  alvo record;
begin
  for alvo in
    select * from (values
      ('manutencoes', 'navio_id', 'navios'),
      ('manutencoes', 'container_id', 'containers'),
      ('manutencoes', 'guindaste_id', 'guindastes'),
      ('historico_manutencoes', 'navio_id', 'navios'),
      ('historico_manutencoes', 'container_id', 'containers'),
      ('historico_manutencoes', 'guindaste_id', 'guindastes')
    ) as v(tabela, coluna, referencia)
  loop
    if to_regclass('public.' || alvo.tabela) is null or to_regclass('public.' || alvo.referencia) is null then
      continue;
    end if;
    -- Remove a(s) FK(s) existente(s) da coluna, qualquer que seja o nome
    for r in
      select c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = ('public.' || alvo.tabela)::regclass
        and c.contype = 'f'
        and a.attname = alvo.coluna
    loop
      execute format('alter table public.%I drop constraint %I', alvo.tabela, r.conname);
    end loop;
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete set null',
      alvo.tabela, alvo.tabela || '_' || alvo.coluna || '_fkey', alvo.coluna, alvo.referencia
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. Berços: unicidade da ocupação + liberação automática
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.bercos') is null then
    raise notice 'public.bercos não existe; aplique migrations/001_create_bercos.sql e rode esta migração novamente.';
    return;
  end if;

  -- Um navio não pode ocupar dois berços ao mesmo tempo (por id e por IMO).
  if exists (
    select navio_id from public.bercos
    where estado = 'OCUPADO' and navio_id is not null
    group by navio_id having count(*) > 1
  ) then
    raise notice 'Há navio ocupando mais de um berço; índice uq_bercos_navio_id_ocupado não aplicado. Corrija os dados e rode novamente.';
  else
    create unique index if not exists uq_bercos_navio_id_ocupado
      on public.bercos (navio_id) where estado = 'OCUPADO' and navio_id is not null;
  end if;

  if exists (
    select upper(navio_imo) from public.bercos
    where estado = 'OCUPADO' and navio_imo is not null
    group by upper(navio_imo) having count(*) > 1
  ) then
    raise notice 'Há IMO ocupando mais de um berço; índice uq_bercos_navio_imo_ocupado não aplicado. Corrija os dados e rode novamente.';
  else
    create unique index if not exists uq_bercos_navio_imo_ocupado
      on public.bercos (upper(navio_imo)) where estado = 'OCUPADO' and navio_imo is not null;
  end if;
end $$;

-- Libera o(s) berço(s) do navio quando ele deixa o Porto de Santos ou é
-- excluído. Antes, a FK ON DELETE SET NULL deixava o berço OCUPADO com o
-- nome do navio apagado, e o front-end "consertava" isso pelo cache local.
create or replace function public.fn_navios_liberar_bercos()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_imo text;
begin
  if to_regclass('public.bercos') is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_id := old.id;
    v_imo := old.numero_imo;
  elsif new.localizacao is distinct from old.localizacao and new.localizacao <> 'DENTRO_DO_PORTO' then
    v_id := new.id;
    v_imo := new.numero_imo;
  else
    return new;
  end if;

  update public.bercos
     set estado = 'LIVRE', navio_nome = null, navio_imo = null, navio_id = null
   where estado = 'OCUPADO'
     and (navio_id = v_id or (v_imo is not null and upper(navio_imo) = upper(v_imo)));

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_navios_liberar_bercos_delete on public.navios;
create trigger trg_navios_liberar_bercos_delete
before delete on public.navios
for each row execute function public.fn_navios_liberar_bercos();

drop trigger if exists trg_navios_liberar_bercos_saida on public.navios;
create trigger trg_navios_liberar_bercos_saida
after update of localizacao on public.navios
for each row execute function public.fn_navios_liberar_bercos();

-- Vínculo navio × berço transacional. O berço e o navio são travados
-- (FOR UPDATE): duas requisições simultâneas para o mesmo berço nunca
-- resultam em dois navios — a segunda recebe BERCO_OCUPADO.
create or replace function public.nexus_ocupar_berco(
  p_berco_id text,
  p_navio_id uuid default null,
  p_navio_imo text default null
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_navio public.navios%rowtype;
  v_berco public.bercos%rowtype;
begin
  if p_navio_id is not null then
    select * into v_navio from public.navios where id = p_navio_id for update;
  end if;
  if v_navio.id is null and p_navio_imo is not null then
    select * into v_navio from public.navios where upper(numero_imo) = upper(p_navio_imo) for update;
  end if;
  if v_navio.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'NAVIO_NAO_ENCONTRADO',
      'mensagem', 'O navio não foi encontrado no banco de dados.');
  end if;
  if v_navio.localizacao <> 'DENTRO_DO_PORTO' then
    return jsonb_build_object('ok', false, 'codigo', 'NAVIO_FORA_DO_PORTO',
      'mensagem', format('O navio %s não está no Porto de Santos (%s) e não pode ocupar berço.', v_navio.nome, v_navio.localizacao));
  end if;

  select * into v_berco from public.bercos where id = p_berco_id for update;
  if v_berco.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'BERCO_NAO_ENCONTRADO',
      'mensagem', 'O berço selecionado não existe no banco de dados.');
  end if;

  if v_berco.estado = 'OCUPADO' and (v_berco.navio_id = v_navio.id
      or (v_berco.navio_imo is not null and upper(v_berco.navio_imo) = upper(v_navio.numero_imo))) then
    return jsonb_build_object('ok', true, 'codigo', 'JA_VINCULADO', 'berco_id', v_berco.id, 'berco_nome', v_berco.nome);
  end if;

  if v_berco.estado <> 'LIVRE' then
    return jsonb_build_object('ok', false, 'codigo', 'BERCO_INDISPONIVEL',
      'estado', v_berco.estado, 'navio_nome', v_berco.navio_nome,
      'mensagem', case when v_berco.estado = 'OCUPADO'
        then format('O %s já está ocupado pelo navio %s.', v_berco.nome, coalesce(v_berco.navio_nome, v_berco.navio_imo, '(sem nome)'))
        else format('O %s está indisponível (%s).', v_berco.nome, v_berco.estado) end);
  end if;

  -- Transferência: libera o berço anterior do navio na MESMA transação.
  update public.bercos
     set estado = 'LIVRE', navio_nome = null, navio_imo = null, navio_id = null
   where id <> v_berco.id and estado = 'OCUPADO'
     and (navio_id = v_navio.id or (navio_imo is not null and upper(navio_imo) = upper(v_navio.numero_imo)));

  update public.bercos
     set estado = 'OCUPADO', navio_id = v_navio.id, navio_nome = v_navio.nome, navio_imo = v_navio.numero_imo
   where id = v_berco.id;

  return jsonb_build_object('ok', true, 'codigo', 'VINCULADO', 'berco_id', v_berco.id, 'berco_nome', v_berco.nome);
end;
$$;

grant execute on function public.nexus_ocupar_berco(text, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Equipamento em manutenção não entra em novas operações
-- ------------------------------------------------------------
create or replace function public.fn_validar_equipamentos_operantes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_estado text;
  v_nome text;
begin
  if tg_table_name = 'cargas' then
    if new.container_id is not null and (tg_op = 'INSERT' or new.container_id is distinct from old.container_id) then
      select estado::text, numero_identificacao into v_estado, v_nome from public.containers where id = new.container_id;
      if v_estado is not null and v_estado <> 'OPERANTE' then
        raise exception 'Contêiner % indisponível: está em manutenção (%).', v_nome, v_estado
          using errcode = 'P0001', hint = 'Aguarde a conclusão da manutenção do contêiner.';
      end if;
    end if;
    if new.navio_id is not null and (tg_op = 'INSERT' or new.navio_id is distinct from old.navio_id) then
      select estado_operacional::text, nome into v_estado, v_nome from public.navios where id = new.navio_id;
      if v_estado is not null and v_estado <> 'OPERANTE' then
        raise exception 'Navio % indisponível: está em manutenção (%).', v_nome, v_estado
          using errcode = 'P0001', hint = 'Aguarde a conclusão da manutenção do navio.';
      end if;
    end if;
  elsif tg_table_name = 'containers' then
    if new.navio_id is not null and (tg_op = 'INSERT' or new.navio_id is distinct from old.navio_id) then
      if new.estado::text <> 'OPERANTE' then
        raise exception 'Contêiner % indisponível: está em manutenção (%).', new.numero_identificacao, new.estado
          using errcode = 'P0001';
      end if;
      select estado_operacional::text, nome into v_estado, v_nome from public.navios where id = new.navio_id;
      if v_estado is not null and v_estado <> 'OPERANTE' then
        raise exception 'Navio % indisponível: está em manutenção (%).', v_nome, v_estado
          using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cargas_equipamentos_operantes on public.cargas;
create trigger trg_cargas_equipamentos_operantes
before insert or update of container_id, navio_id on public.cargas
for each row execute function public.fn_validar_equipamentos_operantes();

drop trigger if exists trg_containers_equipamentos_operantes on public.containers;
create trigger trg_containers_equipamentos_operantes
before insert or update of navio_id on public.containers
for each row execute function public.fn_validar_equipamentos_operantes();

-- ------------------------------------------------------------
-- 5. Exclusão transacional de navio
-- ------------------------------------------------------------
-- Regras:
--   * bloqueia navio em viagem com cargas a bordo (EM_TRANSITO);
--   * bloqueia navio com ordem de serviço ativa (SOLICITADA/APROVADA);
--   * contêineres e cargas são DESVINCULADOS (nunca apagados);
--   * o berço é liberado pelo gatilho trg_navios_liberar_bercos_delete;
--   * o histórico de manutenção é preservado (FK SET NULL, seção 2).
create or replace function public.nexus_excluir_navio(p_navio_id uuid)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_navio public.navios%rowtype;
  v_em_transito int;
  v_os_ativas int;
  v_containers int;
  v_cargas int;
begin
  select * into v_navio from public.navios where id = p_navio_id for update;
  if v_navio.id is null then
    return jsonb_build_object('ok', true, 'codigo', 'JA_EXCLUIDO', 'mensagem', 'O navio já não existe no banco de dados.');
  end if;

  select count(*) into v_em_transito from public.cargas
   where navio_id = v_navio.id and status_fluxo = 'EM_TRANSITO';
  if v_em_transito > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'CARGAS_A_BORDO',
      'mensagem', format('O navio %s está em viagem com %s carga(s) a bordo (EM_TRANSITO). Aguarde a entrega antes de excluí-lo.', v_navio.nome, v_em_transito));
  end if;

  select count(*) into v_os_ativas from public.manutencoes
   where navio_id = v_navio.id and status in ('SOLICITADA', 'APROVADA');
  if v_os_ativas > 0 then
    return jsonb_build_object('ok', false, 'codigo', 'OS_ATIVA',
      'mensagem', format('O navio %s possui %s ordem(ns) de serviço de manutenção ativa(s). Conclua ou recuse a OS antes de excluí-lo.', v_navio.nome, v_os_ativas));
  end if;

  update public.containers set navio_id = null where navio_id = v_navio.id;
  get diagnostics v_containers = row_count;
  update public.cargas set navio_id = null where navio_id = v_navio.id;
  get diagnostics v_cargas = row_count;

  delete from public.navios where id = v_navio.id;

  return jsonb_build_object('ok', true, 'codigo', 'EXCLUIDO',
    'containers_desvinculados', v_containers, 'cargas_desvinculadas', v_cargas);
end;
$$;

grant execute on function public.nexus_excluir_navio(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
