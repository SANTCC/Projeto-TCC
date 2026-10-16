-- =====================================================================
-- Tarefa 1: Limpeza integral de logs_alteracoes, trail_decisoes e retificacoes_trail
-- Idempotente: limpa a trilha de decisões, retificações vinculadas e o log geral
-- de alterações para iniciar a observação limpa entre banco e localStorage.
-- =====================================================================

TRUNCATE TABLE
  public.retificacoes_trail,
  public.trail_decisoes,
  public.logs_alteracoes
RESTART IDENTITY CASCADE;
