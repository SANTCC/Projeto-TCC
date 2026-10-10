-- ============================================================
-- Log de acessos de usuários autenticados (IP e user agent)
--
-- Gravado pela Edge Function `log-acesso`, somente para funcionários
-- autenticados (codigo_individual válido e ativo em `funcionarios`).
--
-- RLS ativado SEM policies: anon/authenticated não leem nem gravam.
-- Apenas a service role (usada pela Edge Function) acessa a tabela.
-- Idempotente.
-- ============================================================

create table if not exists public.log_acessos_usuarios (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  ip text,
  user_agent text,
  pagina text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_log_acessos_usuarios_funcionario
  on public.log_acessos_usuarios (funcionario_id, criado_em desc);

create index if not exists idx_log_acessos_usuarios_criado_em
  on public.log_acessos_usuarios (criado_em desc);

alter table public.log_acessos_usuarios enable row level security;
