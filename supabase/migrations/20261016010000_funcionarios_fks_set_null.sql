-- =============================================================================
-- MIGRAÇÃO: 20261016010000_funcionarios_fks_set_null.sql
-- Tarefa 7: Permitir exclusão de funcionários com histórico passivo
--           (agendamentos.agendado_por e demais tabelas históricas) usando
--           ON DELETE SET NULL, preservando integralmente cargas, agendamentos
--           e trilhas de auditoria.
-- =============================================================================

DO $$
DECLARE
  v_alvo record;
  v_con record;
BEGIN
  FOR v_alvo IN
    SELECT * FROM (VALUES
      ('agendamentos',          'agendado_por',    'fk_agendamentos_agendado_por'),
      ('visitantes',            'registrado_por',  'fk_visitantes_registrado_por'),
      ('manutencoes',           'solicitado_por',  'fk_manutencoes_solicitado_por'),
      ('manutencoes',           'aprovado_por',    'fk_manutencoes_aprovado_por'),
      ('historico_manutencoes', 'registrado_por',  'fk_hist_manut_registrado_por'),
      ('inspecoes',             'inspetor_id',     'fk_inspecoes_inspetor_id'),
      ('logs_alteracoes',       'funcionario_id',  'fk_logs_alt_funcionario_id'),
      ('trail_decisoes',        'funcionario_id',  'fk_trail_dec_funcionario_id'),
      ('retificacoes_trail',    'funcionario_id',  'fk_retif_trail_funcionario_id'),
      ('leituras_qr_code',      'funcionario_id',  'fk_leituras_qr_funcionario_id')
    ) AS t(tabela, coluna, nome_fk)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = v_alvo.tabela
        AND column_name  = v_alvo.coluna
    ) THEN
      -- Remove necessidade de NOT NULL caso exista em coluna histórica passiva
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', v_alvo.tabela, v_alvo.coluna);

      -- Remove qualquer FK existente nessa coluna que aponte para public.funcionarios
      FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(c.conkey)
        WHERE nsp.nspname = 'public'
          AND rel.relname = v_alvo.tabela
          AND att.attname = v_alvo.coluna
          AND c.contype = 'f'
          AND c.confrelid = 'public.funcionarios'::regclass
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v_alvo.tabela, v_con.conname);
      END LOOP;

      -- Recria a FK com ON DELETE SET NULL
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.funcionarios(id) ON DELETE SET NULL',
        v_alvo.tabela, v_alvo.nome_fk, v_alvo.coluna
      );
    END IF;
  END LOOP;
END $$;
