-- ============================================================
-- SISTEMA DE AUTOMAÇÃO DE CARREGAMENTOS PARA PORTO (NexusPort)
-- Esquema PostgreSQL (Supabase DDL Completo com RLS & Triggers)
-- ============================================================

-- 1. EXTENSÕES
-- ============================================================
create extension if not exists "pgcrypto";

-- 2. ENUMS
-- ============================================================
create type cargo_enum as enum (
  'ESTIVADOR',
  'CONFERENTE_CARGA',
  'ARRUMADOR_CONSERTADOR',
  'PLANEJADOR_PATIO_NAVIOS',
  'TECNICO_PORTOS',
  'SUPERVISOR_GERENTE_OPERACOES',
  'INSPETOR',
  'DIRETOR_OPERACOES_LOGISTICA',
  'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
  'CONSELHO_ADMINISTRACAO'
);

create type nivel_acesso_enum as enum ('OPERACIONAL', 'GESTAO', 'TATICO', 'ESTRATEGICO');

create type estado_navio_enum as enum (
  'OPERANTE',
  'AGENDADO_PARA_REFORMA',
  'EM_REFORMA',
  'APROVADO_PARA_REFORMA'
);

create type estado_container_enum as enum (
  'OPERANTE',
  'AGENDADO_PARA_REFORMA',
  'EM_REFORMA',
  'APROVADO_PARA_REFORMA'
);

create type estado_guindaste_enum as enum ('OPERANTE', 'EM_MANUTENCAO');

create type localizacao_navio_enum as enum (
  'DENTRO_DO_PORTO',
  'FORA_DO_PORTO',
  'NO_PORTO_DE_DESTINO'
);

create type status_carga_enum as enum (
  'AGENDAMENTO',
  'RECEBIMENTO_INSPECAO',
  'ARMAZENAGEM',
  'PRONTA_PARA_ENTREGA',
  'SAIDA',
  'EM_TRANSITO',
  'ENTREGUE',
  'CANCELADA',
  'RECUSADA'
);

create type tipo_decisao_enum as enum (
  'APROVOU_CARGA',
  'RECUSOU_CARGA',
  'SOLICITOU_MANUTENCAO_NAVIO',
  'SOLICITOU_MANUTENCAO_CONTAINER',
  'LIBEROU_NAVIO',
  'CANCELOU_ENTREGA',
  'APROVOU_MANUTENCAO',
  'RECUSOU_MANUTENCAO',
  'DESIGNOU_SUBSTITUTO'
);

create type tipo_entidade_enum as enum (
  'NAVIO',
  'CONTAINER',
  'CARGA',
  'FUNCIONARIO',
  'VISITANTE',
  'GUINDASTE',
  'MANUTENCAO',
  'CHECKLIST',
  'ROTA',
  'TIPO_CARGA'
);

create type tipo_alteracao_enum as enum (
  'CRIACAO',
  'EDICAO',
  'EXCLUSAO',
  'REIMPRESSAO_ETIQUETA'
);

create type referencia_tempo_enum as enum ('DATA_FABRICACAO', 'DATA_ULTIMA_MANUTENCAO');

create type resultado_inspecao_enum as enum ('PENDENTE', 'APROVADA', 'RECUSADA');

create type status_manutencao_enum as enum ('SOLICITADA', 'APROVADA', 'RECUSADA', 'CONCLUIDA');

create type estado_carregamento_enum as enum ('EM_CARREGAMENTO', 'PARADO', 'CONCLUIDO');

-- 3. TABELAS DE DOMÍNIO E HIERARQUIA
-- ============================================================

create table cargo_niveis (
  cargo cargo_enum primary key,
  nivel nivel_acesso_enum not null
);

create table funcionarios (
  id uuid primary key default gen_random_uuid(),
  matricula text not null unique,
  codigo_individual text not null unique,
  nome text not null,
  cargo cargo_enum not null,
  email text unique,
  telefone text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table visitantes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text not null,
  motivo text,
  data_hora_entrada timestamptz not null default now(),
  data_hora_saida timestamptz,
  registrado_por uuid references funcionarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table tipos_carga (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  categoria_risco text,
  requisitos_especiais text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table checklist_modelos (
  id uuid primary key default gen_random_uuid(),
  tipo_carga_id uuid not null references tipos_carga(id) on delete restrict,
  nome text not null,
  descricao text,
  criado_por uuid references funcionarios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_checklist_modelo_tipo_carga unique (tipo_carga_id)
);

create table checklist_itens (
  id uuid primary key default gen_random_uuid(),
  checklist_modelo_id uuid not null references checklist_modelos(id) on delete cascade,
  descricao text not null,
  critico boolean not null default false,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create table rotas_maritimas (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  destino text not null,
  distancia_km numeric(12, 2) not null check (distancia_km > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_rota_origem_destino unique (origem, destino)
);

-- 4. TABELAS DE EQUIPAMENTOS E EMBARCAÇÕES
-- ============================================================

create table navios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  numero_imo text not null unique,
  data_registro_sistema date not null default current_date,
  quantidade_cargas_realizadas int not null default 0 check (quantidade_cargas_realizadas >= 0),
  estado_operacional estado_navio_enum not null default 'OPERANTE',
  coordenadas_gps text,
  tempo_fora_do_porto text,
  porto_origem text,
  porto_destino text,
  localizacao localizacao_navio_enum not null default 'DENTRO_DO_PORTO',
  data_chegada timestamptz,
  data_saida timestamptz,
  qr_code_url text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table guindastes (
  id uuid primary key default gen_random_uuid(),
  numero_identificacao text not null unique,
  estado estado_guindaste_enum not null default 'OPERANTE',
  data_ultima_manutencao date,
  qr_code_url text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table containers (
  id uuid primary key default gen_random_uuid(),
  numero_identificacao text not null unique,
  tipo_carga_id uuid references tipos_carga(id) on delete restrict,
  material_carregado text,
  data_fabricacao date,
  data_ultima_manutencao date,
  tempo_uso_referencia referencia_tempo_enum default 'DATA_FABRICACAO',
  estado estado_container_enum not null default 'OPERANTE',
  navio_id uuid references navios(id) on delete set null,
  qr_code_url text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. TABELAS DE CARGAS E FLUXO
-- ============================================================

create table cargas (
  id uuid primary key default gen_random_uuid(),
  tipo_carga_id uuid references tipos_carga(id) on delete restrict,
  quantidade numeric(15, 3) default 1 check (quantidade >= 0),
  material text,
  peso numeric(15, 3) not null check (peso >= 0),
  volume numeric(15, 3) not null check (volume >= 0),
  valor_declarado numeric(15, 2) not null check (valor_declarado >= 0),
  natureza text not null,
  data_entrada timestamptz,
  data_saida timestamptz,
  destino text,
  porto_descarga text not null,
  status_fluxo status_carga_enum not null default 'AGENDAMENTO',
  container_id uuid references containers(id) on delete set null,
  checklist_modelo_id uuid references checklist_modelos(id) on delete restrict,
  resultado_inspecao resultado_inspecao_enum not null default 'PENDENTE',
  motivo_recusa text,
  qr_code_url text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table agendamentos (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null unique references cargas(id) on delete cascade,
  data_prevista_entrega date not null,
  agendado_por uuid references funcionarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table estivador_cargas (
  id uuid primary key default gen_random_uuid(),
  estivador_id uuid not null references funcionarios(id) on delete cascade,
  carga_id uuid not null references cargas(id) on delete cascade,
  estado_carregamento estado_carregamento_enum not null default 'EM_CARREGAMENTO',
  data_inicio timestamptz,
  data_fim timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_estivador_carga unique (estivador_id, carga_id)
);

-- 6. TABELAS DE MANUTENÇÃO
-- ============================================================

create table manutencoes (
  id uuid primary key default gen_random_uuid(),
  entidade_tipo tipo_entidade_enum not null,
  navio_id uuid references navios(id) on delete cascade,
  container_id uuid references containers(id) on delete cascade,
  guindaste_id uuid references guindastes(id) on delete cascade,
  data_solicitacao timestamptz not null default now(),
  data_aprovacao timestamptz,
  data_conclusao timestamptz,
  descricao text not null,
  status status_manutencao_enum not null default 'SOLICITADA',
  solicitado_por uuid references funcionarios(id) on delete restrict,
  aprovado_por uuid references funcionarios(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table historico_manutencoes (
  id uuid primary key default gen_random_uuid(),
  navio_id uuid references navios(id) on delete cascade,
  container_id uuid references containers(id) on delete cascade,
  guindaste_id uuid references guindastes(id) on delete cascade,
  data_manutencao date not null,
  descricao_servicos text not null,
  registrado_por uuid references funcionarios(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- 7. TABELAS DE INSPEÇÃO E CHECKLIST
-- ============================================================

create table inspecoes (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null unique references cargas(id) on delete cascade,
  checklist_modelo_id uuid references checklist_modelos(id) on delete restrict,
  inspetor_id uuid references funcionarios(id) on delete restrict,
  data_inspecao timestamptz not null default now(),
  resultado resultado_inspecao_enum not null default 'PENDENTE',
  observacoes text,
  created_at timestamptz not null default now()
);

create table inspecao_itens (
  id uuid primary key default gen_random_uuid(),
  inspecao_id uuid not null references inspecoes(id) on delete cascade,
  checklist_item_id uuid not null references checklist_itens(id) on delete restrict,
  conforme boolean,
  observacao text,
  created_at timestamptz not null default now(),
  constraint uq_inspecao_item unique (inspecao_id, checklist_item_id)
);

-- 8. TABELAS DE AUDITORIA E DECISÕES
-- ============================================================

create table logs_alteracoes (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  funcionario_id uuid references funcionarios(id) on delete restrict,
  cargo cargo_enum not null,
  codigo_individual text not null,
  entidade_tipo tipo_entidade_enum not null,
  entidade_id text not null,
  tipo_alteracao tipo_alteracao_enum not null,
  detalhes jsonb,
  created_at timestamptz not null default now()
);

create table trail_decisoes (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  funcionario_id uuid references funcionarios(id) on delete restrict,
  cargo cargo_enum not null,
  codigo_individual text not null,
  tipo_decisao tipo_decisao_enum not null,
  entidade_tipo tipo_entidade_enum not null,
  entidade_id text not null,
  motivo text,
  detalhes jsonb,
  created_at timestamptz not null default now()
);

create table retificacoes_trail (
  id uuid primary key default gen_random_uuid(),
  trail_id uuid not null references trail_decisoes(id) on delete restrict,
  funcionario_id uuid references funcionarios(id) on delete restrict,
  retificacao text not null,
  data_hora timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 9. DELEGAÇÃO DE SUPERVISOR
-- ============================================================

create table delegacoes_supervisor (
  id uuid primary key default gen_random_uuid(),
  supervisor_titular_id uuid references funcionarios(id) on delete cascade,
  substituto_id uuid references funcionarios(id) on delete cascade,
  substituto_nome text,
  substituto_cpf text,
  substituto_data_nascimento date,
  data_inicio timestamptz not null,
  data_fim_previsto timestamptz not null,
  data_revogacao timestamptz,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 10. LEITURAS DE QR CODE
-- ============================================================

create table leituras_qr_code (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid references funcionarios(id) on delete restrict,
  entidade_tipo tipo_entidade_enum not null,
  entidade_id text not null,
  data_hora timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 11. ROW LEVEL SECURITY (RLS) - ATIVAÇÃO E POLÍTICAS
-- ============================================================

alter table funcionarios enable row level security;
alter table visitantes enable row level security;
alter table tipos_carga enable row level security;
alter table checklist_modelos enable row level security;
alter table checklist_itens enable row level security;
alter table rotas_maritimas enable row level security;
alter table navios enable row level security;
alter table guindastes enable row level security;
alter table containers enable row level security;
alter table cargas enable row level security;
alter table agendamentos enable row level security;
alter table manutencoes enable row level security;
alter table historico_manutencoes enable row level security;
alter table inspecoes enable row level security;
alter table inspecao_itens enable row level security;
alter table logs_alteracoes enable row level security;
alter table trail_decisoes enable row level security;
alter table retificacoes_trail enable row level security;
alter table delegacoes_supervisor enable row level security;
alter table leituras_qr_code enable row level security;

-- Permissão de leitura publica/autenticada para operacoes generales
create policy "Acesso geral para usuarios autenticados" on cargas for all using (true);
create policy "Acesso geral para usuarios autenticados" on navios for all using (true);
create policy "Acesso geral para usuarios autenticados" on containers for all using (true);
create policy "Acesso geral para usuarios autenticados" on guindastes for all using (true);
create policy "Acesso geral para usuarios autenticados" on tipos_carga for all using (true);
create policy "Acesso geral para usuarios autenticados" on rotas_maritimas for all using (true);
create policy "Acesso geral para usuarios autenticados" on funcionarios for all using (true);
create policy "Acesso geral para usuarios autenticados" on visitantes for all using (true);

-- 12. TRIGGER DE PROPAGAÇÃO EM CASCATA (RN 12)
-- ============================================================

create or replace function fn_propagar_status_navio()
returns trigger as $$
begin
  -- Se a localização do navio mudar para NO_PORTO_DE_DESTINO
  if NEW.localizacao = 'NO_PORTO_DE_DESTINO' then
    -- Atualiza status das cargas vinculadas via contêiner para ENTREGUE
    update cargas
    set status_fluxo = 'ENTREGUE', updated_at = now()
    where container_id in (select id from containers where navio_id = NEW.id)
      and status_fluxo = 'EM_TRANSITO';
  elsif NEW.localizacao = 'FORA_DO_PORTO' then
    -- Atualiza status das cargas para EM_TRANSITO
    update cargas
    set status_fluxo = 'EM_TRANSITO', updated_at = now()
    where container_id in (select id from containers where navio_id = NEW.id)
      and status_fluxo = 'PRONTA_PARA_ENTREGA';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_propagar_status_navio
after update of localizacao on navios
for each row
execute function fn_propagar_status_navio();

-- 13. POPULAÇÃO INICIAL DE CARGOS E NÍVEIS
-- ============================================================

insert into cargo_niveis (cargo, nivel) values
  ('ESTIVADOR', 'OPERACIONAL'),
  ('CONFERENTE_CARGA', 'OPERACIONAL'),
  ('ARRUMADOR_CONSERTADOR', 'OPERACIONAL'),
  ('PLANEJADOR_PATIO_NAVIOS', 'OPERACIONAL'),
  ('TECNICO_PORTOS', 'OPERACIONAL'),
  ('SUPERVISOR_GERENTE_OPERACOES', 'GESTAO'),
  ('INSPETOR', 'TATICO'),
  ('DIRETOR_OPERACOES_LOGISTICA', 'ESTRATEGICO'),
  ('DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'ESTRATEGICO'),
  ('CONSELHO_ADMINISTRACAO', 'ESTRATEGICO')
on conflict (cargo) do nothing;
