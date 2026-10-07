-- ============================================================
-- NexusPort — Botão de Pânico GLOBAL
-- (Edge Function panic-alert + Realtime Broadcast + Webhook opcional)
-- ------------------------------------------------------------
-- Cria:
--   1. Valor 'EMERGENCIA' no enum de auditoria (tipo_entidade_enum)
--   2. Tabela `emergencias`      -> estado global da emergência (ATIVA/RESOLVIDA)
--   3. Tabela `panic_webhook_config` -> webhook OPCIONAL (DESLIGADO POR PADRÃO)
--   4. Políticas RLS (padrão do projeto: acesso operacional aberto,
--      escrita sensível feita pela Edge Function com service role)
--
-- Aplicar com:  supabase db push
--    (ou executar manualmente no SQL Editor do projeto Supabase)
-- ============================================================

-- 1) NOVO TIPO DE ENTIDADE PARA AUDITORIA DE EMERGÊNCIAS
-- (PG12+ permite ADD VALUE em transação, desde que o valor não seja
--  usado na mesma transação — não usamos aqui.)
alter type tipo_entidade_enum add value if not exists 'EMERGENCIA';

-- 2) ESTADO GLOBAL DA EMERGÊNCIA (fonte da verdade para clientes
--    que conectam DEPOIS do acionamento; o tempo real vem do canal
--    de broadcast "nexus-emergency" via WebSocket)
create table if not exists emergencias (
  id uuid primary key default gen_random_uuid(),
  estado text not null default 'ATIVA' check (estado in ('ATIVA', 'RESOLVIDA')),
  motivo text,
  funcionario_id uuid references funcionarios(id) on delete set null,
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

create index if not exists idx_emergencias_estado_data
  on emergencias (estado, data_hora desc);

-- 3) CONFIGURAÇÃO DO WEBHOOK OPCIONAL — DESATIVADO POR PADRÃO.
--    A Edge Function `panic-alert` só dispara o POST se
--    enabled = true E url estiver preenchida.
create table if not exists panic_webhook_config (
  id uuid primary key default gen_random_uuid(),
  enabled boolean not null default false,
  url text,
  updated_at timestamptz not null default now()
);

-- Garante a linha única de configuração com o webhook DESLIGADO
insert into panic_webhook_config (enabled, url)
select false, null
where not exists (select 1 from panic_webhook_config);

-- 4) ROW LEVEL SECURITY (convenção `nexus_*` documentada em TABLES.md)
alter table emergencias enable row level security;
alter table panic_webhook_config enable row level security;

create policy nexus_select_emergencias
  on emergencias for select
  using (true);

create policy nexus_insert_emergencias
  on emergencias for insert
  with check (true);

create policy nexus_update_emergencias
  on emergencias for update
  using (true) with check (true);

create policy nexus_select_panic_webhook_config
  on panic_webhook_config for select
  using (true);

create policy nexus_insert_panic_webhook_config
  on panic_webhook_config for insert
  with check (true);

create policy nexus_update_panic_webhook_config
  on panic_webhook_config for update
  using (true) with check (true);

-- 5) REALTIME — habilita replicação apenas informativa (o broadcast do
--    botão de pânico NÃO depende disto; usa o canal "nexus-emergency").
--    Mantido desativado de propósito para não duplicar eventos.
