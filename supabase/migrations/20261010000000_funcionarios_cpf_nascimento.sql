-- NexusPort — Gestão de Pessoas: CPF + data de nascimento do funcionário.
--
-- COMO APLICAR (escolha UMA opção):
--   1) Supabase CLI (recomendado):  supabase db push
--      (aplica todas as migrações pendentes, incluindo esta)
--   2) Dashboard do Supabase: SQL Editor > New query > cole este arquivo > Run
--
-- EFEITO: adiciona as colunas `cpf` (texto, 11 dígitos) e `data_nascimento`
-- (data) à tabela `funcionarios`, com índice único de CPF. O cadastro do
-- Técnico em Portos (tecnico_portos.html) envia esses campos; se a migração
-- ainda não foi aplicada, o app salva o funcionário sem eles e exibe um aviso.

alter table public.funcionarios
  add column if not exists cpf text;

alter table public.funcionarios
  add column if not exists data_nascimento date;

-- Um CPF pertence a no máximo um funcionário (bloqueio de duplicidade no banco)
create unique index if not exists funcionarios_cpf_unique
  on public.funcionarios (cpf)
  where cpf is not null;

comment on column public.funcionarios.cpf is 'CPF do funcionário (11 dígitos, sem máscara). Preenchido no cadastro do Técnico em Portos.';
comment on column public.funcionarios.data_nascimento is 'Data de nascimento do funcionário (AAAA-MM-DD). Cadastro exige 18 anos ou mais.';
