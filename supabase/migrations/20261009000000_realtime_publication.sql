-- ============================================================
-- MIGRAÇÃO 20261009000000 — TEMPO REAL: PUBLICAÇÃO DO SUPABASE REALTIME
-- ------------------------------------------------------------
-- Backlog 3 (J). O front-end assina as mudanças das tabelas operacionais
-- (js/data-repository.js → NexusRepository.REALTIME_TABLES) e recarrega as
-- telas abertas quando alguém altera um registro (ex.: o scanner de QR).
--
-- Uma tabela só envia eventos de INSERT/UPDATE/DELETE ao Realtime se
-- pertencer à publicação `supabase_realtime`. Nenhuma migração anterior
-- adicionava as tabelas a ela, então o canal conectava mas não recebia nada.
--
-- Sem esta migração, o polling de segurança de 60 s
-- (NexusRepository.POLLING_SEGURANCA_MS) continua atualizando as telas, só
-- que com atraso.
--
-- Efeitos:
--   - não altera linhas, colunas, índices nem políticas RLS;
--   - é idempotente: pode ser reaplicada sem erro e sem duplicar tabelas;
--   - tabela que ainda não existe é ignorada com aviso (NOTICE), não aborta.
-- A lista abaixo DEVE coincidir com REALTIME_TABLES (tests/test_tempo_real.js
-- confere essa igualdade).
-- ============================================================

-- Em projetos Supabase a publicação já existe; em bancos locais ela é criada aqui.
-- (CREATE PUBLICATION não aceita IF NOT EXISTS, por isso a checagem em pg_publication.)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  tabela text;
  tabelas_tempo_real text[] := array[
    'cargas',
    'containers',
    'navios',
    'guindastes',
    'manutencoes',
    'historico_manutencoes',
    'funcionarios',
    'visitantes',
    'bercos',
    'rotas_maritimas',
    'delegacoes_supervisor',
    'inspecoes',
    'inspecao_itens',
    'checklist_modelos',
    'checklist_itens',
    'tipos_carga',
    'leituras_qr_code',
    'estivador_cargas',
    'agendamentos',
    'logs_alteracoes',
    'trail_decisoes',
    'retificacoes_trail',
    'emergencias'
  ];
begin
  foreach tabela in array tabelas_tempo_real loop
    if to_regclass(format('public.%I', tabela)) is null then
      raise notice 'Tempo real: public.% ainda não existe; ignorada na publicação.', tabela;
    elsif not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end $$;
