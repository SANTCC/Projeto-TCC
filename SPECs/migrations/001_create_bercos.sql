-- ============================================================
-- MIGRAÇÃO 001 - CRIAÇÃO DA TABELA public.bercos
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
--   É idempotente: pode ser executado mais de uma vez com segurança.
-- ============================================================

-- 1. TABELA
-- Observação: `id` é TEXT porque o front-end gera identificadores
-- no formato 'BERCO-01' ... 'BERCO-15'.
create table if not exists public.bercos (
  id text primary key,
  nome text not null unique,
  estado text not null default 'LIVRE'
    check (estado in ('LIVRE', 'OCUPADO', 'MANUTENCAO')),
  navio_nome text,
  navio_imo text,
  navio_id uuid references public.navios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Garante a constraint única em `nome` (necessária para o
-- upsert com onConflict: 'nome' usado pelo front-end).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bercos_nome_key' and conrelid = 'public.bercos'::regclass
  ) then
    alter table public.bercos add constraint bercos_nome_key unique (nome);
  end if;
end $$;

create index if not exists idx_bercos_estado on public.bercos (estado);
create index if not exists idx_bercos_navio_id on public.bercos (navio_id);

-- 2. TRIGGER DE updated_at
create or replace function public.fn_bercos_set_updated_at()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_bercos_set_updated_at on public.bercos;
create trigger trg_bercos_set_updated_at
before update on public.bercos
for each row
execute function public.fn_bercos_set_updated_at();

-- 3. ROW LEVEL SECURITY
alter table public.bercos enable row level security;

drop policy if exists "Acesso geral para usuarios autenticados" on public.bercos;
create policy "Acesso geral para usuarios autenticados"
  on public.bercos for all using (true) with check (true);

-- 4. POPULAÇÃO INICIAL DOS 15 BERÇOS DO TERMINAL STS-01
insert into public.bercos (id, nome, estado)
select
  'BERCO-' || lpad(i::text, 2, '0'),
  'Berço ' || lpad(i::text, 2, '0'),
  'LIVRE'
from generate_series(1, 15) as i
on conflict (nome) do nothing;

-- 5. RECARREGA O CACHE DE SCHEMA DO PostgREST
-- (sem isso o PostgREST pode continuar respondendo PGRST205 por alguns segundos)
notify pgrst, 'reload schema';
