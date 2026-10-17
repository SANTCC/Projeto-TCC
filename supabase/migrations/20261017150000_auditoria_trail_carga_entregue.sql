-- Migração: Registrar cargas marcadas como ENTREGUE no Log de Alterações (logs_alteracoes)
-- e no Trail de Decisões Críticas (trail_decisoes), incluir ENTREGOU_CARGA em tipo_decisao_enum
-- e fazer backfill idempotente para cargas já entregues no banco (sem alterar triggers existentes).

ALTER TYPE public.tipo_decisao_enum ADD VALUE IF NOT EXISTS 'ENTREGOU_CARGA';

-- Backfill idempotente em logs_alteracoes para cargas que já foram marcadas como ENTREGUE
INSERT INTO public.logs_alteracoes (
  data_hora, cargo, codigo_individual, entidade_tipo, entidade_id, tipo_alteracao, detalhes
)
SELECT
  coalesce(c.updated_at, c.created_at, now()),
  'SUPERVISOR_GERENTE_OPERACOES',
  'SISTEMA',
  'CARGA',
  coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
  'EDICAO',
  jsonb_build_object(
    'referencia_id', c.id,
    'codigo', coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
    'acao_exibicao', 'ENTREGOU_CARGA',
    'status_fluxo', 'ENTREGUE',
    'navio', c.navio_nome_historico,
    'container', c.container_identificacao_historico,
    'destino', c.destino,
    'descricao', format(
      'Carga %s marcada como ENTREGUE no porto de destino (destino: %s%s%s)',
      coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
      coalesce(nullif(btrim(c.destino), ''), 'Destino Final'),
      case when nullif(btrim(c.navio_nome_historico), '') is not null then ' · navio: ' || btrim(c.navio_nome_historico) else '' end,
      case when nullif(btrim(c.container_identificacao_historico), '') is not null then ' · contêiner: ' || btrim(c.container_identificacao_historico) else '' end
    )
  )
FROM public.cargas c
WHERE c.status_fluxo = 'ENTREGUE'
  AND coalesce(c.qr_code_url, '') NOT LIKE 'QR-DEMO-%'
  AND NOT EXISTS (
    SELECT 1 FROM public.logs_alteracoes la
    WHERE la.entidade_tipo = 'CARGA'
      AND la.entidade_id = coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text)
      AND (
        la.detalhes->>'acao_exibicao' = 'ENTREGOU_CARGA'
        OR la.detalhes->>'status_fluxo' = 'ENTREGUE'
        OR coalesce(la.detalhes->>'descricao', '') ILIKE '%marcada como ENTREGUE%'
      )
  );

-- Backfill idempotente em trail_decisoes para cargas que já foram marcadas como ENTREGUE
INSERT INTO public.trail_decisoes (
  data_hora, cargo, codigo_individual, tipo_decisao, entidade_tipo, entidade_id, motivo, detalhes
)
SELECT
  coalesce(c.updated_at, c.created_at, now()),
  'SUPERVISOR_GERENTE_OPERACOES',
  'SISTEMA',
  'ENTREGOU_CARGA',
  'CARGA',
  coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
  format(
    'Carga %s marcada como ENTREGUE no porto de destino (destino: %s%s%s)',
    coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
    coalesce(nullif(btrim(c.destino), ''), 'Destino Final'),
    case when nullif(btrim(c.navio_nome_historico), '') is not null then ' · navio: ' || btrim(c.navio_nome_historico) else '' end,
    case when nullif(btrim(c.container_identificacao_historico), '') is not null then ' · contêiner: ' || btrim(c.container_identificacao_historico) else '' end
  ),
  jsonb_build_object(
    'referencia_id', c.id,
    'rotulo', 'Carga ' || coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text),
    'acao_exibicao', 'ENTREGOU_CARGA',
    'status_fluxo', 'ENTREGUE'
  )
FROM public.cargas c
WHERE c.status_fluxo = 'ENTREGUE'
  AND coalesce(c.qr_code_url, '') NOT LIKE 'QR-DEMO-%'
  AND NOT EXISTS (
    SELECT 1 FROM public.trail_decisoes td
    WHERE td.entidade_tipo = 'CARGA'
      AND td.entidade_id = coalesce(nullif(regexp_replace(c.qr_code_url, '^QR-', '', 'i'), ''), c.id::text)
      AND (
        td.tipo_decisao = 'ENTREGOU_CARGA'
        OR td.detalhes->>'acao_exibicao' = 'ENTREGOU_CARGA'
        OR coalesce(td.motivo, '') ILIKE '%marcada como ENTREGUE%'
      )
  );
