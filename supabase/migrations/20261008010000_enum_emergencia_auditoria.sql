-- ============================================================
-- MIGRAÇÃO 20261008010000 — 22P02 NA AUDITORIA DO BOTÃO DE PÂNICO
--   invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
-- ------------------------------------------------------------
-- SINTOMA (log do Postgres capturado no Supabase — Logs Explorer):
--
--   { "service_name": "postgres_logs",
--     "parsed.application_name": "PostgREST 14.5",
--     "parsed.user_name": "authenticator",
--     "parsed.sql_state_code": "22P02",
--     "event_message": "invalid input value for enum tipo_entidade_enum: \"EMERGENCIA\"",
--     "parsed.query": "WITH pgrst_source AS (INSERT INTO \"public\".\"logs_alteracoes\"
--                      (\"cargo\", ..., \"entidade_tipo\", ...) ..." }
--
--   Ou seja: o front-end enviou
--     POST /rest/v1/logs_alteracoes   { "entidade_tipo": "EMERGENCIA", ... }
--   e o PostgreSQL recusou o INSERT antes mesmo de gravar a linha:
--     ERROR  22P02 (INVALID_TEXT_REPRESENTATION / enum_in)
--     invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
--
-- CAUSA: o tipo `public.tipo_entidade_enum` deste projeto NÃO tem o valor
-- 'EMERGENCIA'. O tipo veio do `SPECs/schema.sql` em uma versão anterior à
-- seção 15 (Botão de Pânico) — nesse arquivo o valor só é adicionado no fim
-- (`alter type tipo_entidade_enum add value if not exists 'EMERGENCIA';`).
-- Banco criado/atualizado antes disso ficou sem o valor, e a migração
-- `20261008000000_emergencias_fix_404.sql` (que também o adiciona) ainda não
-- foi aplicada neste projeto — ou foi aplicada e a sessão não foi recarregada.
--
-- QUEM ESCREVE 'EMERGENCIA':
--   * js/panic-realtime.js  -> registrarAuditoria()  (acionar/desativar o pânico);
--   * js/dashboard.js       -> registrarLogAlteracao() com entidade 'emergencia'
--                              (caminho legado de manutencao.html).
-- Nos dois casos a linha vai para `logs_alteracoes.entidade_tipo`.
--
-- IMPACTO: o alarme global CONTINUA funcionando (WebSocket/broadcast e a
-- tabela `emergencias` não usam este enum), mas a AUDITORIA da emergência é
-- perdida em silêncio — é exatamente o "Falha silenciosa se o valor não
-- existir em tipo_entidade_enum" já previsto em
-- SPECs/diagnostico/404-emergencias.md (seção 3).
--
-- ------------------------------------------------------------
-- POR QUE ESTE ARQUIVO NÃO TEM  begin; ... commit;
-- ------------------------------------------------------------
-- Em PostgreSQL 12+, `alter type ... add value` pode rodar dentro de uma
-- transação, MAS o valor novo não pode ser USADO (comparado, inserido,
-- convertido) na MESMA transação — o servidor responde
--   ERROR 55P04: unsafe use of new value "EMERGENCIA" of enum type
-- A pegadinha: o SQL Editor do Supabase e o psycopg2 enviam o arquivo
-- inteiro como UM único comando, logo como UMA transação implícita. Um
-- script que faz "add value" e depois testa `entidade_tipo = 'EMERGENCIA'`
-- FALHA, mesmo sem begin/commit explícito.
--
-- A proteção real aqui é dupla:
--   1. o valor é adicionado em um bloco `do $$ ... $$` isolado;
--   2. este script NUNCA usa 'EMERGENCIA' como valor do enum — a
--      verificação final lê apenas o catálogo (`pg_enum`), que é texto puro.
-- Por isso ele é seguro tanto colado no SQL Editor quanto pelo
-- `supabase db push`, e pode ser reexecutado quantas vezes for preciso.
--
-- COMO APLICAR (escolha um):
--   A) Painel do Supabase:
--        Dashboard > SQL Editor > New query > cole este arquivo > Run
--   B) Supabase CLI:
--        supabase link --project-ref <ref-do-projeto>
--        supabase db push
--
-- CAMINHO RÁPIDO (se você só quer desbloquear agora, esta linha basta —
-- é um comando único, seguro no SQL Editor):
--
--     alter type public.tipo_entidade_enum add value if not exists 'EMERGENCIA';
--
-- Este arquivo faz isso e ainda confere/relata o estado do banco.
-- ============================================================


-- ============================================================
-- 1. DIAGNÓSTICO E CORREÇÃO DO TIPO
-- ============================================================
do $mig_enum_emergencia$
declare
  v_schema text;
  v_coluna text;
begin
  -- 1.1 O tipo existe no schema exposto pelo PostgREST (`public`)?
  if to_regtype('public.tipo_entidade_enum') is null then
    -- Pode existir em outro schema: o PostgREST só expõe `public`, então o
    -- valor adicionado ali não resolveria o 22P02 da aplicação.
    select n.nspname
      into v_schema
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'tipo_entidade_enum'
      and n.nspname not in ('pg_catalog', 'information_schema')
    limit 1;

    if v_schema is not null then
      raise notice
        'ATENÇÃO: tipo_entidade_enum existe no schema "%" (não em public). O PostgREST expõe apenas o schema public — mova-o (alter type %.tipo_entidade_enum set schema public) ou aplique SPECs/schema.sql.',
        v_schema, v_schema;
    else
      raise notice
        'AVISO: o tipo tipo_entidade_enum não existe neste banco — o schema base (SPECs/schema.sql) não foi aplicado. A auditoria do pânico não tem onde ser gravada. Aplique SPECs/schema.sql e depois supabase/migrations/20261008000000_emergencias_fix_404.sql.';
    end if;

    return;
  end if;

  -- 1.2 Adiciona o valor (idempotente). Nenhum uso do valor aqui.
  alter type public.tipo_entidade_enum add value if not exists 'EMERGENCIA';
  raise notice 'tipo_entidade_enum: valor EMERGENCIA disponível para logs_alteracoes.entidade_tipo.';

  -- 1.3 Conferência informativa: avisa se `logs_alteracoes.entidade_tipo`
  --     não for deste enum (ex.: coluna text em banco legado).
  if to_regclass('public.logs_alteracoes') is not null then
    select format_type(a.atttypid, a.atttypmod)
      into v_coluna
    from pg_attribute a
    where a.attrelid = 'public.logs_alteracoes'::regclass
      and a.attname = 'entidade_tipo'
      and a.attnum > 0
      and not a.attisdropped;

    if v_coluna is null then
      raise notice
        'AVISO: public.logs_alteracoes não tem a coluna entidade_tipo — aplique SPECs/schema.sql.';
    elsif v_coluna not like '%tipo_entidade_enum%' then
      raise notice
        'ATENÇÃO: logs_alteracoes.entidade_tipo é do tipo "%" (esperado: tipo_entidade_enum). O 22P02 vem desse outro caminho — revise o schema.',
        v_coluna;
    end if;
  else
    raise notice
      'AVISO: public.logs_alteracoes não existe — aplique SPECs/schema.sql (é a tabela onde a auditoria é gravada).';
  end if;
end $mig_enum_emergencia$;

-- ============================================================
-- 2. RECARREGA O CACHE DE SCHEMA DO PostgREST
-- ------------------------------------------------------------
-- O 22P02 é levantado pelo PostgreSQL, não pelo PostgREST — mas recarregar
-- o cache mantém o valor novo visível também nas descrições/planos do
-- PostgREST e é inofensivo. Se algo ainda parecer desatualizado:
-- Settings > API > Restart server.
-- ============================================================
notify pgrst, 'reload schema';

-- ============================================================
-- 3. VERIFICAÇÃO (resultado visível no SQL Editor)
-- ------------------------------------------------------------
-- Esperado na 1ª linha: tipo_existe = true, valor_emergencia = true.
-- Leitura de CATÁLOGO apenas — de propósito, para não usar o valor novo do
-- enum nesta mesma transação (ver o cabeçalho: erro 55P04).
-- ============================================================
with alvo as (
  select to_regtype('public.tipo_entidade_enum') as tipo
)
select
  'public.tipo_entidade_enum' as objeto,
  (t.tipo is not null) as existe,
  exists (
    select 1 from pg_enum e
    where e.enumtypid = t.tipo
      and e.enumlabel = 'EMERGENCIA'
  ) as pronto,
  (
    select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
    from pg_enum e
    where e.enumtypid = t.tipo
  ) as detalhe
from alvo t
union all
select
  'logs_alteracoes.entidade_tipo' as objeto,
  to_regclass('public.logs_alteracoes') is not null as existe,
  coalesce(
    (
      select format_type(a.atttypid, a.atttypmod) like '%tipo_entidade_enum%'
      from pg_attribute a
      where a.attrelid = to_regclass('public.logs_alteracoes')
        and a.attname = 'entidade_tipo'
        and a.attnum > 0
        and not a.attisdropped
    ),
    false
  ) as pronto,
  coalesce(
    (
      select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
      where a.attrelid = to_regclass('public.logs_alteracoes')
        and a.attname = 'entidade_tipo'
        and a.attnum > 0
        and not a.attisdropped
    ),
    'coluna/ tabela ausente — aplique SPECs/schema.sql'
  ) as detalhe;

-- ============================================================
-- 4. TESTE DE PONTA A PONTA (OPCIONAL — escreve uma linha de auditoria)
-- ------------------------------------------------------------
-- Só execute em um passo SEPARADO (nova query), depois do Run acima: aqui o
-- valor 'EMERGENCIA' passa a ser USADO, o que é proibido na mesma transação
-- em que ele foi criado. Rode uma vez; a linha de teste fica registrada na
-- auditoria (é uma tabela de log, sem delete no app):
--
--   insert into public.logs_alteracoes
--     (cargo, codigo_individual, entidade_tipo, entidade_id, tipo_alteracao, detalhes)
--   values
--     ('INSPETOR', 'INS-000', 'EMERGENCIA', 'TESTE_MIGRACAO', 'EDICAO',
--      '{"teste":"20261008010000_enum_emergencia_auditoria"}'::jsonb)
--   returning id, data_hora, entidade_tipo;
--
-- Esperado: INSERT 0 1, sem 22P02. Limpeza (se desejado):
--   delete from public.logs_alteracoes where entidade_id = 'TESTE_MIGRACAO';
-- ============================================================
