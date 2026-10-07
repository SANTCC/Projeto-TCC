-- ============================================================
-- MIGRAÇÃO 001 - CRIAÇÃO DA TABELA public.bercos  (v2 - revisada)
-- ------------------------------------------------------------
-- Corrige o erro PGRST205:
--   "Could not find the table 'public.bercos' in the schema cache"
--
-- A aplicação (js/embarcacoes.js e js/data-repository.js) consulta
-- e grava na tabela `bercos` (15 berços do terminal STS-01), mas ela
-- nunca havia sido criada no banco.
--
-- COMO APLICAR:
--   Supabase Dashboard > SQL Editor > New query > cole este arquivo > Run.
--   É idempotente e transacional: pode ser executado mais de uma vez.
--   Qualquer falha de pré-requisito aborta tudo, sem deixar estado parcial.
--
-- ATENÇÃO - MODELO DE SEGURANÇA (leia a seção 4): este projeto NÃO usa
-- Supabase Auth. Todo acesso chega ao PostgREST como role `anon`.
-- ============================================================

begin;

-- ============================================================
-- 0. PRÉ-REQUISITOS (falha cedo, com mensagem clara)
-- ============================================================
do $$
declare
  v_tipo_id text;
begin
  -- 0.1 A tabela navios precisa existir (a FK depende dela)
  if to_regclass('public.navios') is null then
    raise exception
      'Pré-requisito ausente: a tabela public.navios não existe. Aplique SPECs/schema.sql antes desta migração.';
  end if;

  -- 0.2 navios.id precisa ser uuid (a coluna bercos.navio_id é uuid)
  select format_type(a.atttypid, a.atttypmod) into v_tipo_id
  from pg_attribute a
  where a.attrelid = 'public.navios'::regclass
    and a.attname = 'id'
    and a.attnum > 0
    and not a.attisdropped;

  if v_tipo_id is null then
    raise exception 'Pré-requisito ausente: public.navios não possui coluna "id".';
  elsif v_tipo_id <> 'uuid' then
    raise exception
      'Incompatibilidade de tipos: public.navios.id é % (esperado uuid). Ajuste o tipo antes de criar a FK de bercos.navio_id.',
      v_tipo_id;
  end if;
end $$;

-- ============================================================
-- 1. TABELA
-- ------------------------------------------------------------
-- `id` é TEXT porque o front-end gera identificadores no
-- formato 'BERCO-01' ... 'BERCO-15' (não são UUIDs).
-- ============================================================
create table if not exists public.bercos (
  id text primary key,
  nome text not null,
  estado text not null default 'LIVRE',
  navio_nome text,
  navio_imo text,
  navio_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.1 Reconciliação de estrutura
-- `create table if not exists` NÃO altera uma tabela pré-existente.
-- Se alguém já criou `bercos` com colunas faltando, os comandos abaixo
-- completam a estrutura em vez de deixar a migração falhar adiante.
alter table public.bercos add column if not exists nome       text;
alter table public.bercos add column if not exists estado     text;
alter table public.bercos add column if not exists navio_nome text;
alter table public.bercos add column if not exists navio_imo  text;
alter table public.bercos add column if not exists navio_id   uuid;
alter table public.bercos add column if not exists created_at timestamptz not null default now();
alter table public.bercos add column if not exists updated_at timestamptz not null default now();

-- 1.2 Validação da estrutura pré-existente (tipos que não dá para "consertar" às cegas)
do $$
declare
  r record;
begin
  for r in
    select a.attname, format_type(a.atttypid, a.atttypmod) as tipo
    from pg_attribute a
    where a.attrelid = 'public.bercos'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname in ('id', 'nome', 'estado', 'navio_nome', 'navio_imo', 'navio_id')
  loop
    if r.attname = 'navio_id' and r.tipo <> 'uuid' then
      raise exception 'public.bercos.navio_id é % (esperado uuid). Corrija manualmente antes de prosseguir.', r.tipo;
    elsif r.attname <> 'navio_id' and r.tipo not in ('text', 'character varying', 'character varying(255)') then
      raise exception 'public.bercos.% é % (esperado text). Corrija manualmente antes de prosseguir.', r.attname, r.tipo;
    end if;
  end loop;
end $$;

-- 1.3 Defaults / NOT NULL em colunas que podem ter vindo de uma criação anterior
update public.bercos set estado = 'LIVRE' where estado is null;
alter table public.bercos alter column estado set default 'LIVRE';

do $$
begin
  if not exists (select 1 from public.bercos where nome is null) then
    alter table public.bercos alter column nome set not null;
    alter table public.bercos alter column estado set not null;
  else
    raise notice 'Existem linhas com nome nulo em public.bercos; NOT NULL não aplicado. Limpe os dados e rode novamente.';
  end if;
end $$;

-- ============================================================
-- 2. CONSTRAINTS (aplicadas de forma condicional)
-- ------------------------------------------------------------
-- Cada constraint só é criada se (a) ainda não existir e (b) os dados
-- atuais a respeitarem — assim a migração nunca falha por dado legado,
-- apenas emite um NOTICE indicando o que precisa de limpeza manual.
-- ============================================================

-- 2.1 UNIQUE em `nome` — obrigatório: o front usa upsert com onConflict: 'nome'
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bercos'::regclass and contype = 'u'
      and conkey = array[(select attnum from pg_attribute
                          where attrelid = 'public.bercos'::regclass and attname = 'nome')]
  ) then
    if exists (select nome from public.bercos group by nome having count(*) > 1) then
      raise exception
        'Há nomes de berço duplicados em public.bercos. Remova as duplicatas: select nome, count(*) from bercos group by nome having count(*) > 1;';
    end if;
    alter table public.bercos add constraint bercos_nome_key unique (nome);
  end if;
end $$;

-- 2.2 Domínio de `estado`
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bercos'::regclass and conname = 'bercos_estado_check') then
    if exists (select 1 from public.bercos where estado not in ('LIVRE', 'OCUPADO', 'MANUTENCAO')) then
      raise notice 'Valores de `estado` fora do domínio esperado; constraint bercos_estado_check não aplicada.';
    else
      alter table public.bercos add constraint bercos_estado_check
        check (estado in ('LIVRE', 'OCUPADO', 'MANUTENCAO'));
    end if;
  end if;
end $$;

-- 2.3 Formato do identificador: 'BERCO-01' .. 'BERCO-99'
-- Evita IDs arbitrários ('ABC', 'TESTE') vindos de chamadas manuais à API.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bercos'::regclass and conname = 'bercos_id_formato_check') then
    if exists (select 1 from public.bercos where id !~ '^BERCO-[0-9]{2}$') then
      raise notice 'Existem ids fora do padrão BERCO-NN; constraint bercos_id_formato_check não aplicada.';
    else
      alter table public.bercos add constraint bercos_id_formato_check
        check (id ~ '^BERCO-[0-9]{2}$');
    end if;
  end if;
end $$;

-- 2.4 Coerência entre `estado` e os dados do navio
-- Berço não-OCUPADO não pode carregar resíduo de vínculo; berço OCUPADO
-- precisa identificar o navio por nome ou IMO. Impede o caso levantado
-- na revisão (estado LIVRE com navio preenchido / OCUPADO sem navio).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bercos'::regclass and conname = 'bercos_vinculo_navio_check') then
    if exists (
      select 1 from public.bercos
      where (estado <> 'OCUPADO' and (navio_nome is not null or navio_imo is not null or navio_id is not null))
         or (estado = 'OCUPADO' and navio_nome is null and navio_imo is null)
    ) then
      raise notice 'Dados incoerentes entre estado e navio_*; constraint bercos_vinculo_navio_check não aplicada.';
    else
      alter table public.bercos add constraint bercos_vinculo_navio_check check (
        (estado <> 'OCUPADO' and navio_nome is null and navio_imo is null and navio_id is null)
        or
        (estado = 'OCUPADO' and (navio_nome is not null or navio_imo is not null))
      );
    end if;
  end if;
end $$;

-- 2.5 FK para navios (ON DELETE SET NULL: apagar um navio libera a referência,
-- nunca apaga o berço). navio_nome / navio_imo são mantidos de propósito:
-- são um snapshot histórico e o front-end grava navio_id = null quando o
-- id local do navio ainda não é um UUID do banco.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bercos'::regclass and conname = 'bercos_navio_id_fkey') then
    if exists (
      select 1 from public.bercos b
      where b.navio_id is not null
        and not exists (select 1 from public.navios n where n.id = b.navio_id)
    ) then
      raise notice 'Há navio_id órfão em public.bercos; FK não aplicada. Limpe as referências e rode novamente.';
    else
      alter table public.bercos
        add constraint bercos_navio_id_fkey
        foreign key (navio_id) references public.navios(id) on delete set null;
    end if;
  end if;
end $$;

create index if not exists idx_bercos_estado   on public.bercos (estado);
create index if not exists idx_bercos_navio_id on public.bercos (navio_id);

-- ============================================================
-- 3. TRIGGER DE updated_at
-- ------------------------------------------------------------
-- Nome namespaced por tabela (fn_bercos_...) para reduzir o risco de
-- colidir com alguma função homônima pré-existente. O par
-- drop trigger / create trigger é intencional: garante que o trigger
-- reflita exatamente a definição abaixo.
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_bercos_set_updated_at'
  ) then
    raise notice 'A função public.fn_bercos_set_updated_at() já existe e será substituída.';
  end if;
end $$;

create or replace function public.fn_bercos_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_bercos_set_updated_at on public.bercos;
create trigger trg_bercos_set_updated_at
before update on public.bercos
for each row
execute function public.fn_bercos_set_updated_at();

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- MODELO ATUAL DO PROJETO (importante):
-- O NexusPort NÃO utiliza Supabase Auth. O login é próprio
-- (código individual validado em js/auth-guard.js, sessão em
-- sessionStorage) e todas as requisições usam a chave publishable/anon.
-- Portanto o PostgREST enxerga a role `anon`, nunca `authenticated`.
--
-- Consequência: uma política `to authenticated` bloquearia 100% do
-- acesso aos berços na aplicação atual. Por isso a política abaixo é
-- explicitamente concedida a `anon, authenticated`, igual ao restante
-- do schema (navios, cargas, containers...).
--
-- RISCO ACEITO E DOCUMENTADO: qualquer portador da chave publishable
-- pode ler e escrever nos berços. Isso é adequado a um protótipo
-- acadêmico com dados não sensíveis, mas NÃO é aceitável em produção.
-- Mitigação recomendada antes de um uso real: migrar o login para
-- Supabase Auth e trocar pelas políticas do bloco comentado no fim
-- desta seção (leitura para autenticados, escrita só para perfis
-- operacionais).
-- ============================================================
alter table public.bercos enable row level security;

drop policy if exists "Acesso geral para usuarios autenticados" on public.bercos;
drop policy if exists "bercos_acesso_total_chave_anon" on public.bercos;

-- As roles `anon` e `authenticated` existem no Supabase, mas não em um
-- PostgreSQL local/self-hosted. Por isso a lista de roles é montada
-- dinamicamente: nomear uma role inexistente abortaria a migração inteira.
do $$
declare
  v_roles text;
begin
  select string_agg(quote_ident(rolname), ', ' order by rolname)
    into v_roles
  from pg_roles
  where rolname in ('anon', 'authenticated');

  if v_roles is null then
    raise notice 'Roles anon/authenticated não encontradas (ambiente não-Supabase): política criada para PUBLIC.';
    execute 'create policy "bercos_acesso_total_chave_anon" on public.bercos
               for all using (true) with check (true)';
  else
    execute format(
      'create policy "bercos_acesso_total_chave_anon" on public.bercos
         for all to %s using (true) with check (true)', v_roles);
    raise notice 'Política bercos_acesso_total_chave_anon criada para: %.', v_roles;
  end if;
end $$;

comment on table public.bercos is
  'Berços do terminal STS-01. RLS permissiva (roles anon/authenticated) porque o projeto autentica fora do Supabase Auth. Reavaliar antes de produção.';

-- ------------------------------------------------------------
-- POLÍTICAS ENDURECIDAS - habilitar quando o login migrar para
-- Supabase Auth. Substituem a política permissiva acima.
-- ------------------------------------------------------------
-- drop policy if exists "bercos_acesso_total_chave_anon" on public.bercos;
--
-- create policy "bercos_leitura_autenticados"
--   on public.bercos for select
--   to authenticated
--   using (true);
--
-- create policy "bercos_escrita_operacional"
--   on public.bercos for all
--   to authenticated
--   using (
--     exists (
--       select 1 from public.funcionarios f
--       where f.user_id = auth.uid()
--         and f.cargo in ('PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES',
--                         'DIRETOR_OPERACOES_LOGISTICA')
--     )
--   )
--   with check (
--     exists (
--       select 1 from public.funcionarios f
--       where f.user_id = auth.uid()
--         and f.cargo in ('PLANEJADOR_PATIO_NAVIOS', 'SUPERVISOR_GERENTE_OPERACOES',
--                         'DIRETOR_OPERACOES_LOGISTICA')
--     )
--   );

-- ============================================================
-- 5. POPULAÇÃO INICIAL DOS 15 BERÇOS DO TERMINAL STS-01
-- ------------------------------------------------------------
-- `do nothing` é proposital: NÃO sobrescreve berços já existentes
-- (um berço OCUPADO continua OCUPADO após rodar a migração).
-- Para forçar o reset completo do painel, use o bloco comentado logo
-- abaixo — ele descarta vínculos reais, então rode de forma consciente.
-- ============================================================
insert into public.bercos (id, nome, estado)
select
  'BERCO-' || lpad(i::text, 2, '0'),
  'Berço ' || lpad(i::text, 2, '0'),
  'LIVRE'
from generate_series(1, 15) as i
on conflict (nome) do nothing;

-- RESET OPCIONAL (destrutivo - libera TODOS os berços):
-- update public.bercos
--    set estado = 'LIVRE', navio_nome = null, navio_imo = null, navio_id = null;

-- 5.1 Relatório pós-carga
do $$
declare
  v_total int;
  v_ocupados int;
begin
  select count(*), count(*) filter (where estado = 'OCUPADO') into v_total, v_ocupados from public.bercos;
  raise notice 'public.bercos pronta: % berço(s), % ocupado(s).', v_total, v_ocupados;
  if v_total < 15 then
    raise notice 'Atenção: esperados 15 berços, encontrados %.', v_total;
  end if;
end $$;

commit;

-- ============================================================
-- 6. RECARREGA O CACHE DE SCHEMA DO PostgREST
-- ------------------------------------------------------------
-- Executado FORA da transação de propósito: o NOTIFY só é entregue no
-- commit, e aqui garantimos que o reload ocorra com a tabela já visível.
-- Sem isso o PostgREST pode continuar respondendo PGRST205 por alguns
-- segundos. Alternativa pelo painel: Settings > API > Restart server.
-- ============================================================
notify pgrst, 'reload schema';
