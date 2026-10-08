-- ============================================================
-- MIGRAÇÃO 20261008000000 — CORREÇÃO DO 404 EM /rest/v1/emergencias
-- ------------------------------------------------------------
-- SINTOMA CORRIGIDO (relatado no painel Network do navegador):
--
--   GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
--   -> HTTP 404 Not Found
--
--   Corpo devolvido pelo PostgREST:
--   { "code": "PGRST205",
--     "message": "Could not find the table 'public.emergencias' in the schema cache",
--     "hint": "Perhaps you meant the table 'public.funcionarios'" }
--
-- CAUSA: as tabelas `emergencias` e `panic_webhook_config` (criadas pela
-- migração 20261007000000_panic_button_global.sql) NÃO existem neste
-- projeto Supabase. O PostgREST responde 404 a qualquer requisição de uma
-- tabela que não está no schema cache — por isso o 404 acontece mesmo com
-- a URL e a chave publishable corretas, e não é problema de CORS, RLS ou
-- de referrer policy.
--
-- ENQUANTO A MIGRAÇÃO NÃO É APLICADA, o botão de pânico opera em modo
-- degradado: alerta via WebSocket (broadcast direto cliente -> clientes)
-- continua funcionando, mas não há persistência do estado global (clientes
-- que conectam depois não veem a emergência) e o webhook nunca dispara.
--
-- ESTA MIGRAÇÃO É IDEMPOTENTE E REPARADORA:
--   * pode ser executada depois da 20261007000000 (vira no-op de verificação);
--   * pode ser executada sobre um estado parcial (tabela criada pela metade);
--   * pode ser executada duas vezes seguidas, sem erro e sem duplicar nada.
--
-- COMO APLICAR (escolha um):
--   A) Supabase CLI:
--        supabase link --project-ref <ref-do-projeto>
--        supabase db push
--   B) Painel do Supabase:
--        Dashboard > SQL Editor > New query > cole este arquivo > Run
--
-- VERIFICAR DEPOIS DO RUN (deve responder HTTP 200 com [] ou com 1 linha):
--   curl "<SUPABASE_URL>/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
--        -H "apikey: <ANON_OU_PUBLISHABLE_KEY>"
-- ============================================================

begin;

-- ============================================================
-- 0. PRÉ-REQUISITOS E DIAGNÓSTICO (falha cedo, com mensagem clara)
-- ============================================================
do $$
declare
  v_schema text;
  v_tabela_em_outro_schema text;
  v_enum_tipo text := to_regtype('tipo_entidade_enum')::text;
begin
  -- 0.1 funcionarios é pré-requisito: emergencias.funcionario_id tem FK para ela
  if to_regclass('public.funcionarios') is null then
    raise exception
      'Pré-requisito ausente: a tabela public.funcionarios não existe. Aplique SPECs/schema.sql antes desta migração.';
  end if;

  -- 0.2 cargo_enum é pré-requisito: emergencias.acionado_por_cargo usa esse tipo
  if to_regtype('public.cargo_enum') is null and to_regtype('cargo_enum') is null then
    raise exception
      'Pré-requisito ausente: o tipo cargo_enum não existe. Aplique SPECs/schema.sql antes desta migração.';
  end if;

  -- 0.3 Diagnóstico útil: a tabela existe em OUTRO schema?
  --     (explica 404 quando a tabela foi criada fora de `public`)
  if to_regclass('public.emergencias') is null then
    select n.nspname into v_schema
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'emergencias'
      and c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
    limit 1;

    if v_schema is not null then
      -- O nome qualificado é montado com quote_ident: RAISE não aceita %I
      -- (o placeholder de RAISE é apenas %; %I é do format(), usado no EXECUTE).
      v_tabela_em_outro_schema := quote_ident(v_schema) || '.emergencias';
      raise notice
        'ATENÇÃO: existe uma tabela "emergencias" no schema "%" — o PostgREST expõe apenas o schema "public". Mova-a (alter table % set schema public) ou remova-a antes de continuar.',
        v_schema, v_tabela_em_outro_schema;
    end if;
  end if;

  if v_enum_tipo is null then
    raise notice
      'Aviso: o tipo tipo_entidade_enum não existe neste banco; a auditoria do pânico (logs_alteracoes.entidade_tipo = EMERGENCIA) não será gravada. Aplique SPECs/schema.sql para criá-lo.';
  end if;
end $$;

-- ============================================================
-- 1. TIPO DE ENTIDADE PARA A AUDITORIA DE EMERGÊNCIAS
-- ------------------------------------------------------------
-- logs_alteracoes.entidade_tipo é do tipo tipo_entidade_enum e o front-end
-- grava 'EMERGENCIA' a cada acionamento/desativação do pânico. O valor é
-- adicionado aqui (idempotente) e NÃO é usado como dado nesta mesma
-- transação — exigência do PostgreSQL para ALTER TYPE ... ADD VALUE.
-- ============================================================
do $$
begin
  if to_regtype('tipo_entidade_enum') is not null then
    alter type tipo_entidade_enum add value if not exists 'EMERGENCIA';
    raise notice 'tipo_entidade_enum: valor EMERGENCIA disponível para auditoria.';
  end if;
end $$;

-- ============================================================
-- 2. TABELA public.emergencias — estado global da emergência
-- ------------------------------------------------------------
-- É a FONTE DA VERDADE para quem conecta DEPOIS do acionamento
-- (o tempo real vem do canal de broadcast "nexus-emergency").
-- ============================================================
create table if not exists public.emergencias (
  id uuid primary key default gen_random_uuid(),
  estado text not null default 'ATIVA' check (estado in ('ATIVA', 'RESOLVIDA')),
  motivo text,
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  acionado_por_nome text,
  acionado_por_cargo cargo_enum,
  acionado_por_codigo text,
  data_hora timestamptz not null default now(),
  resolvido_por_nome text,
  resolvido_por_cargo cargo_enum,
  data_resolucao timestamptz,
  webhook_disparado boolean not null default false,
  origem text not null default 'EDGE_FUNCTION' check (origem in ('EDGE_FUNCTION', 'CLIENT_FALLBACK')),
  created_at timestamptz not null default now()
);

-- 2.1 Reconciliação de estrutura (create table if not exists NÃO altera
--     uma tabela pré-existente: se a tabela foi criada pela metade, os
--     comandos abaixo completam a estrutura em vez de falhar adiante).
alter table public.emergencias add column if not exists estado text;
alter table public.emergencias add column if not exists motivo text;
alter table public.emergencias add column if not exists funcionario_id uuid;
alter table public.emergencias add column if not exists acionado_por_nome text;
alter table public.emergencias add column if not exists acionado_por_cargo cargo_enum;
alter table public.emergencias add column if not exists acionado_por_codigo text;
alter table public.emergencias add column if not exists data_hora timestamptz;
alter table public.emergencias add column if not exists resolvido_por_nome text;
alter table public.emergencias add column if not exists resolvido_por_cargo cargo_enum;
alter table public.emergencias add column if not exists data_resolucao timestamptz;
alter table public.emergencias add column if not exists webhook_disparado boolean;
alter table public.emergencias add column if not exists origem text;
alter table public.emergencias add column if not exists created_at timestamptz;

-- 2.2 Dados legados / colunas recém-criadas: preenche antes de aplicar
--     defaults e NOT NULL (a migração nunca aborta por dado antigo).
update public.emergencias set estado = 'RESOLVIDA'
  where estado is null or estado not in ('ATIVA', 'RESOLVIDA');
update public.emergencias set origem = 'EDGE_FUNCTION'
  where origem is null or origem not in ('EDGE_FUNCTION', 'CLIENT_FALLBACK');
update public.emergencias set data_hora = now() where data_hora is null;
update public.emergencias set created_at = coalesce(data_hora, now()) where created_at is null;
update public.emergencias set webhook_disparado = false where webhook_disparado is null;

alter table public.emergencias alter column estado set default 'ATIVA';
alter table public.emergencias alter column estado set not null;
alter table public.emergencias alter column origem set default 'EDGE_FUNCTION';
alter table public.emergencias alter column origem set not null;
alter table public.emergencias alter column data_hora set default now();
alter table public.emergencias alter column data_hora set not null;
alter table public.emergencias alter column webhook_disparado set default false;
alter table public.emergencias alter column webhook_disparado set not null;
alter table public.emergencias alter column created_at set default now();
alter table public.emergencias alter column created_at set not null;

-- 2.3 Constraints de validação (aplicadas só se ainda não existirem)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.emergencias'::regclass
      and conname = 'emergencias_estado_check'
  ) then
    alter table public.emergencias
      add constraint emergencias_estado_check check (estado in ('ATIVA', 'RESOLVIDA'));
    raise notice 'Constraint emergencias_estado_check criada.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.emergencias'::regclass
      and conname = 'emergencias_origem_check'
  ) then
    alter table public.emergencias
      add constraint emergencias_origem_check check (origem in ('EDGE_FUNCTION', 'CLIENT_FALLBACK'));
    raise notice 'Constraint emergencias_origem_check criada.';
  end if;

  -- FK para funcionarios (criada só se a coluna ficou sem vínculo)
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.emergencias'::regclass
      and conname = 'emergencias_funcionario_id_fkey'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'emergencias'
        and column_name = 'funcionario_id'
    ) and not exists (
      select 1 from public.emergencias e
      where e.funcionario_id is not null
        and not exists (select 1 from public.funcionarios f where f.id = e.funcionario_id)
    ) then
      alter table public.emergencias
        add constraint emergencias_funcionario_id_fkey
        foreign key (funcionario_id) references public.funcionarios(id) on delete set null;
      raise notice 'Constraint emergencias_funcionario_id_fkey criada.';
    else
      raise notice 'Aviso: não foi possível criar emergencias_funcionario_id_fkey (existem funcionario_id órfãos). Limpe os dados e rode novamente.';
    end if;
  end if;
end $$;

-- 2.4 Índice exigido pela consulta do rodapé de emergência:
--     where estado = 'ATIVA' order by data_hora desc limit 1
create index if not exists idx_emergencias_estado_data
  on public.emergencias (estado, data_hora desc);

-- ============================================================
-- 3. TABELA public.panic_webhook_config — webhook OPCIONAL (OFF por padrão)
-- ============================================================
create table if not exists public.panic_webhook_config (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  url text,
  updated_at timestamptz not null default now()
);

alter table public.panic_webhook_config add column if not exists enabled boolean;
alter table public.panic_webhook_config add column if not exists url text;
alter table public.panic_webhook_config add column if not exists updated_at timestamptz;

update public.panic_webhook_config set enabled = false where enabled is null;
update public.panic_webhook_config set updated_at = now() where updated_at is null;

alter table public.panic_webhook_config alter column enabled set default false;
alter table public.panic_webhook_config alter column enabled set not null;
alter table public.panic_webhook_config alter column updated_at set default now();
alter table public.panic_webhook_config alter column updated_at set not null;

-- 3.1 Garante a LINHA ÚNICA de configuração, sempre com o webhook DESLIGADO
insert into public.panic_webhook_config (enabled, url)
select false, null
where not exists (select 1 from public.panic_webhook_config);

-- ============================================================
-- 4. ROW LEVEL SECURITY E POLÍTICAS
-- ------------------------------------------------------------
-- MODELO DE SEGURANÇA DO PROJETO (ver SPECs/migrations/README.md):
-- o NexusPort NÃO usa Supabase Auth — o login é próprio e o front-end
-- acessa o PostgREST com a chave publishable/anon, portanto TODA
-- requisição chega com a role `anon` (nunca `authenticated`).
-- As políticas são concedidas explicitamente a `anon, authenticated`
-- (as roles são detectadas: em PostgreSQL local a política vai para
-- PUBLIC, pois nomear uma role inexistente invalidaria o comando).
--
-- Dropa e recria as políticas `nexus_*` para garantir resultado
-- determinístico nos dois caminhos (migração nova ou já aplicada).
-- ============================================================
alter table public.emergencias enable row level security;
alter table public.panic_webhook_config enable row level security;

drop policy if exists nexus_select_emergencias on public.emergencias;
drop policy if exists nexus_insert_emergencias on public.emergencias;
drop policy if exists nexus_update_emergencias on public.emergencias;
drop policy if exists nexus_select_panic_webhook_config on public.panic_webhook_config;
drop policy if exists nexus_insert_panic_webhook_config on public.panic_webhook_config;
drop policy if exists nexus_update_panic_webhook_config on public.panic_webhook_config;

do $$
declare
  v_roles text;
begin
  select string_agg(quote_ident(rolname), ', ' order by rolname)
    into v_roles
  from pg_roles
  where rolname in ('anon', 'authenticated');

  if v_roles is null then
    v_roles := 'public';
    raise notice 'Roles anon/authenticated não encontradas (ambiente não-Supabase): políticas criadas para PUBLIC.';
  end if;

  execute format(
    'create policy nexus_select_emergencias on public.emergencias
       for select to %s using (true)', v_roles);
  execute format(
    'create policy nexus_insert_emergencias on public.emergencias
       for insert to %s with check (true)', v_roles);
  execute format(
    'create policy nexus_update_emergencias on public.emergencias
       for update to %s using (true) with check (true)', v_roles);
  execute format(
    'create policy nexus_select_panic_webhook_config on public.panic_webhook_config
       for select to %s using (true)', v_roles);
  execute format(
    'create policy nexus_insert_panic_webhook_config on public.panic_webhook_config
       for insert to %s with check (true)', v_roles);
  execute format(
    'create policy nexus_update_panic_webhook_config on public.panic_webhook_config
       for update to %s using (true) with check (true)', v_roles);

  raise notice 'Políticas nexus_* criadas para: %.', v_roles;
end $$;

-- 4.1 Privilégios de tabela
-- O Supabase concede privilégios padrão em `public`, mas reforçar aqui
-- torna a migração correta também em projetos com defaults alterados.
-- A autorização real continua sendo feita pelas políticas acima.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select, insert, update on public.emergencias to anon;
    grant select, insert, update on public.panic_webhook_config to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update on public.emergencias to authenticated;
    grant select, insert, update on public.panic_webhook_config to authenticated;
  end if;
end $$;

-- 4.2 Documentação embutida no banco
comment on table public.emergencias is
  'Botão de Pânico Global — estado da emergência (ATIVA/RESOLVIDA). Escrita pela Edge Function panic-alert (service role) e, em modo degradado, pelo próprio cliente (origem CLIENT_FALLBACK). RLS permissiva (anon/authenticated) porque o projeto autentica fora do Supabase Auth.';
comment on table public.panic_webhook_config is
  'Webhook OPCIONAL do botão de pânico — DESATIVADO por padrão (enabled = false). A Edge Function panic-alert só dispara o POST JSON se enabled = true E url estiver configurada.';

-- ------------------------------------------------------------
-- POLÍTICAS ENDURECIDAS — habilitar quando o login migrar para
-- Supabase Auth (mesmo racional documentado em 001_create_bercos.sql).
-- ------------------------------------------------------------
-- drop policy if exists nexus_select_emergencias on public.emergencias;
-- drop policy if exists nexus_insert_emergencias on public.emergencias;
-- drop policy if exists nexus_update_emergencias on public.emergencias;
--
-- create policy nexus_leitura_emergencias on public.emergencias
--   for select to authenticated using (true);
-- create policy nexus_escrita_emergencias on public.emergencias
--   for insert to authenticated
--   with check (
--     exists (
--       select 1 from public.funcionarios f
--       where f.user_id = auth.uid()
--         and f.cargo in ('INSPETOR', 'SUPERVISOR_GERENTE_OPERACOES',
--                         'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
--                         'CONSELHO_ADMINISTRACAO')
--     )
--   );

commit;

-- ============================================================
-- 5. RECARREGA O CACHE DE SCHEMA DO PostgREST
-- ------------------------------------------------------------
-- Executado FORA da transação de propósito (o NOTIFY só é entregue no
-- commit). Sem isso o PostgREST pode continuar devolvendo PGRST205/404
-- por alguns segundos depois de a tabela ter sido criada. Alternativa
-- pelo painel: Settings > API > Restart server.
-- ============================================================
notify pgrst, 'reload schema';

-- ============================================================
-- 6. VERIFICAÇÃO (resultado visível no SQL Editor)
-- ------------------------------------------------------------
-- Esperado: `existe = true` nas duas tabelas, uma emergência no máximo
-- em `total_ativa` e as políticas listadas na última coluna.
-- ============================================================
select
  'public.emergencias' as tabela,
  to_regclass('public.emergencias') is not null as existe,
  (select count(*) from public.emergencias) as total_linhas,
  (select count(*) from public.emergencias where estado = 'ATIVA') as total_ativa,
  (
    select string_agg(p.polname, ', ' order by p.polname)
    from pg_policy p
    where p.polrelid = 'public.emergencias'::regclass
  ) as politicas
union all
select
  'public.panic_webhook_config' as tabela,
  to_regclass('public.panic_webhook_config') is not null as existe,
  (select count(*) from public.panic_webhook_config) as total_linhas,
  (select count(*) from public.panic_webhook_config where enabled is true) as total_ativa,
  (
    select string_agg(p.polname, ', ' order by p.polname)
    from pg_policy p
    where p.polrelid = 'public.panic_webhook_config'::regclass
  ) as politicas;
