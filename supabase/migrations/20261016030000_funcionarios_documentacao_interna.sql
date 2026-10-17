-- ============================================================================
-- MIGRAÇÃO: 20261016030000_funcionarios_documentacao_interna.sql
-- Tarefa 7: Coluna documentacao_interna na tabela public.funcionarios para
-- permitir cadastro e edição da documentação interna restrita ao Diretor e
-- ao Técnico em Portos.
-- ============================================================================

ALTER TABLE public.funcionarios
  ADD COLUMN IF NOT EXISTS documentacao_interna text;

COMMENT ON COLUMN public.funcionarios.documentacao_interna IS
  'Documentação interna do funcionário (ex.: Livro/Ficha de Registro). Edição restrita ao Diretor e ao Técnico em Portos.';
