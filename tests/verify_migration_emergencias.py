#!/usr/bin/env python3
"""
Verificação da migração do Botão de Pânico GLOBAL em PostgreSQL REAL.

Valida `supabase/migrations/20261008000000_emergencias_fix_404.sql`, que
corrige o erro relatado no navegador:

    GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
    -> HTTP 404 (PostgREST: PGRST205 — "Could not find the table
       'public.emergencias' in the schema cache")

A migração é aplicada de verdade em um PostgreSQL descartável, em cinco
cenários, provando que ela:

  SC1  projeto sem as tabelas do pânico (estado atual do erro 404) -> cria tudo;
  SC2  migração antiga (20261007000000) já aplicada                -> vira no-op;
  SC3  estado parcial (tabela criada pela metade + dado legado)    -> repara;
  SC4  tabela "emergencias" existente em OUTRO schema              -> avisa;
  SC5  pré-requisitos ausentes                                     -> aborta limpo;
  SC6  a role `anon` (chave publishable) lê e escreve com RLS.

Uso:
    pip install psycopg2-binary pgserver pglast   # pgserver é opcional
    python3 tests/verify_migration_emergencias.py

Sem `pgserver`, o script usa a conexão definida em NEXUS_TEST_DATABASE_URL
(banco descartável) e, sem nenhuma das duas, informa como rodar e sai com 2.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRACAO_NOVA = os.path.join(ROOT, "supabase", "migrations", "20261008000000_emergencias_fix_404.sql")
MIGRACAO_ANTIGA = os.path.join(ROOT, "supabase", "migrations", "20261007000000_panic_button_global.sql")

RESULTADOS = []


def check(rotulo, condicao, extra=""):
    RESULTADOS.append(("PASS" if condicao else "FAIL", rotulo, str(extra)[:220]))
    return bool(condicao)


def conectar():
    """Devolve (conexão psycopg2, descrição do servidor usado)."""
    try:
        import pgserver  # type: ignore
    except ImportError:
        pgserver = None

    if pgserver is not None:
        import shutil
        import tempfile

        data_dir = os.path.join(tempfile.gettempdir(), "pgdata_verify_migration")
        if os.path.isdir(data_dir):
            shutil.rmtree(data_dir)
        servidor = pgserver.get_server(data_dir)
        return servidor, f"pgserver (PostgreSQL descartável em {data_dir})"

    url = os.environ.get("NEXUS_TEST_DATABASE_URL")
    if not url:
        print(__doc__)
        print("AVISO: instale 'pgserver' (pip install pgserver) ou defina")
        print("       NEXUS_TEST_DATABASE_URL apontando para um banco DESCARTÁVEL.")
        sys.exit(2)

    import psycopg2  # type: ignore

    return psycopg2.connect(url), f"NEXUS_TEST_DATABASE_URL ({url.split('@')[-1]})"


def abrir_conexao(servidor):
    if hasattr(servidor, "get_uri"):  # pgserver.PostgresServer
        import psycopg2  # type: ignore

        return psycopg2.connect(servidor.get_uri())
    return servidor


def executar(conn, sql, aceitar_erro=False):
    """Executa SQL em autocommit. Devolve (linhas, notices, erro)."""
    import psycopg2  # type: ignore

    conn.autocommit = True
    try:
        conn.notices.clear()
    except Exception:  # noqa: BLE001
        pass
    linhas, erro = [], None
    with conn.cursor() as cur:
        try:
            cur.execute(sql)
            if cur.description:
                linhas = cur.fetchall()
        except psycopg2.Error as exc:
            erro = exc
    notices = list(conn.notices)
    if erro is not None:
        # A migração abre uma transação explícita (begin; ... commit;). Se ela
        # aborta no meio, a sessão fica em "current transaction is aborted" —
        # o ROLLBACK devolve a sessão ao estado limpo para a próxima verificação.
        try:
            with conn.cursor() as cur_rollback:
                cur_rollback.execute("rollback;")
        except psycopg2.Error:
            pass
        if not aceitar_erro:
            raise erro
    return linhas, notices, erro


def escalar(conn, sql):
    linhas, _, _ = executar(conn, sql)
    return linhas[0][0] if linhas else None


def aplicar_migracao(conn, caminho, aceitar_erro=False):
    with open(caminho, encoding="utf-8") as fh:
        sql = fh.read()
    return executar(conn, sql, aceitar_erro=aceitar_erro)


PRE_REQUISITOS = """
-- Mesmos privilégios padrão do Supabase para anon/authenticated
-- (precisam vir ANTES dos create table, pois valem para objetos futuros)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on types to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create type cargo_enum as enum ('ESTIVADOR','CONFERENTE_CARGA','INSPETOR','TECNICO_PORTOS',
  'SUPERVISOR_GERENTE_OPERACOES','DIRETOR_OPERACOES_LOGISTICA');
create type tipo_entidade_enum as enum ('CARGA','CONTAINER','NAVIO','FUNCIONARIO');
create table public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cargo cargo_enum not null
);
create table public.logs_alteracoes (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  cargo cargo_enum not null,
  codigo_individual text not null,
  entidade_tipo tipo_entidade_enum not null,
  entidade_id text not null,
  tipo_alteracao text not null,
  detalhes jsonb
);
"""


def criar_roles(conn):
    executar(conn, """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
""")


def main():
    servidor, descricao = conectar()
    conn = abrir_conexao(servidor)
    print("=" * 78)
    print("VERIFICAÇÃO DA MIGRAÇÃO DO PÂNICO GLOBAL — PostgreSQL real")
    print(f"Servidor: {descricao}")
    print("=" * 78)

    criar_roles(conn)
    executar(conn, PRE_REQUISITOS)

    # ---------------------------------------------------------------- SC1
    print("\nSC1 — projeto SEM as tabelas do pânico (o cenário do erro 404)")
    _, notices, _ = aplicar_migracao(conn, MIGRACAO_NOVA)
    check("SC1.1 migração nova aplicada na 1ª execução", True)
    aplicar_migracao(conn, MIGRACAO_NOVA)
    check("SC1.2 migração nova aplicada na 2ª execução (idempotência)", True)

    ok = escalar(conn, """
select
  (to_regclass('public.emergencias') is not null)
  and (to_regclass('public.panic_webhook_config') is not null)
  and (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'idx_emergencias_estado_data') = 1
  and (select count(*) from pg_constraint where conrelid = 'public.emergencias'::regclass
        and conname in ('emergencias_estado_check','emergencias_origem_check',
                        'emergencias_funcionario_id_fkey')) = 3
  and (select relrowsecurity from pg_class where oid = 'public.emergencias'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.panic_webhook_config'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public'
        and tablename = 'emergencias') = 3
  and (select count(*) from pg_policies where schemaname = 'public'
        and tablename = 'panic_webhook_config') = 3
  and (select count(*) from public.panic_webhook_config) = 1
  and (select bool_and(not enabled) from public.panic_webhook_config);
""")
    check("SC1.3 tabelas, índice, constraints, RLS, políticas e seed do webhook (OFF)", ok)

    check("SC1.4 valor EMERGENCIA disponível no tipo_entidade_enum",
          escalar(conn, """
select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'tipo_entidade_enum' and e.enumlabel = 'EMERGENCIA');
"""))

    executar(conn, """
insert into public.funcionarios (nome, cargo) values ('Ana Souza','INSPETOR');
insert into public.emergencias (estado, motivo, acionado_por_nome, acionado_por_cargo,
  acionado_por_codigo, origem)
select 'ATIVA','Incêndio no pátio','Ana Souza','INSPETOR','INS-001','CLIENT_FALLBACK';
""")
    # Consulta EXATA de js/panic-realtime.js (loadStateFromDb)
    app_query = ("select id, motivo, origem from public.emergencias "
                 "where estado = 'ATIVA' order by data_hora desc limit 1;")
    linhas, _, _ = executar(conn, app_query)
    check("SC1.5 consulta do rodapé (estado=ATIVA, order data_hora desc, limit 1) devolve a linha",
          bool(linhas) and linhas[0][2] == "CLIENT_FALLBACK", linhas)

    plano_txt = " ".join(str(r[0]) for r in executar(conn, "explain " + app_query)[0])
    check("SC1.6 consulta usa o índice idx_emergencias_estado_data",
          "idx_emergencias_estado_data" in plano_txt, plano_txt[:120])

    executar(conn, """
insert into public.logs_alteracoes (cargo, codigo_individual, entidade_tipo, entidade_id,
  tipo_alteracao, detalhes)
values ('INSPETOR','INS-001','EMERGENCIA','PANICO_GLOBAL','EDICAO',
        '{"estado":"EMERGENCIA_CRITICA_ATIVADA"}'::jsonb);
""")
    check("SC1.7 auditoria grava entidade_tipo = EMERGENCIA (novo valor do enum)",
          escalar(conn, "select count(*) from public.logs_alteracoes where entidade_tipo = 'EMERGENCIA';") == 1)

    # ---------------------------------------------------------------- SC6
    print("\nSC6 — a role `anon` (chave publishable) e o RLS")
    # O SET ROLE vale para a sessão inteira; por isso ele é executado em uma
    # chamada própria (e não junto do SELECT, cujo resultado se quer ler).
    try:
        executar(conn, "set role anon;")
        check("SC6.1 role anon LÊ emergencias (RLS permissiva + privilégios de tabela)",
              escalar(conn, "select count(*) from public.emergencias;") == 1)
        executar(conn, """
insert into public.emergencias (estado, motivo, origem) values ('ATIVA','via anon','CLIENT_FALLBACK');
update public.emergencias set estado = 'RESOLVIDA', data_resolucao = now() where estado = 'ATIVA';
""")
        check("SC6.2 role anon ESCREVE e RESOLVE emergencias (fallback do cliente)",
              escalar(conn, "select count(*) from public.emergencias where estado = 'ATIVA';") == 0)
        check("SC6.3 role anon usa panic_webhook_config (painel de configuração)",
              escalar(conn, "select count(*) from public.panic_webhook_config;") == 1)
        executar(conn, """
insert into public.logs_alteracoes (cargo, codigo_individual, entidade_tipo, entidade_id,
  tipo_alteracao, detalhes)
values ('ESTIVADOR','EST-002','EMERGENCIA','PANICO_GLOBAL','EDICAO','{"via":"client_fallback"}'::jsonb);
""")
        check("SC6.4 role anon registra auditoria com entidade_tipo = EMERGENCIA",
              escalar(conn, """
select count(*) from public.logs_alteracoes
where entidade_tipo = 'EMERGENCIA' and codigo_individual = 'EST-002';
""") == 1)
    finally:
        executar(conn, "reset role;")

    # ---------------------------------------------------------------- SC2
    print("\nSC2 — migração antiga (20261007000000) já aplicada no projeto")
    executar(conn, "drop table public.emergencias; drop table public.panic_webhook_config;")
    aplicar_migracao(conn, MIGRACAO_ANTIGA)
    check("SC2.1 migração antiga aplicada isoladamente (como o supabase db push faria)", True)
    _, _, erro = aplicar_migracao(conn, MIGRACAO_NOVA, aceitar_erro=True)
    check("SC2.2 migração nova por cima da antiga (no-op sem erro)", erro is None,
          erro and getattr(erro, "pgerror", str(erro)))
    _, _, erro = aplicar_migracao(conn, MIGRACAO_NOVA, aceitar_erro=True)
    check("SC2.3 migração nova repetida (idempotente)", erro is None,
          erro and getattr(erro, "pgerror", str(erro)))
    check("SC2.4 seed do webhook não duplicou a linha de configuração",
          escalar(conn, "select count(*) from public.panic_webhook_config;") == 1)

    # ---------------------------------------------------------------- SC3
    print("\nSC3 — estado parcial: tabela criada pela metade + dado legado")
    executar(conn, """
drop table public.emergencias cascade;
drop table public.panic_webhook_config cascade;
create table public.emergencias (id uuid primary key default gen_random_uuid(), estado text);
insert into public.emergencias (estado) values (''), (null);
""")
    _, notices, erro = aplicar_migracao(conn, MIGRACAO_NOVA, aceitar_erro=True)
    check("SC3.1 migração repara a tabela parcial sem abortar", erro is None,
          erro and getattr(erro, "pgerror", str(erro)))
    colunas = escalar(conn, """
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'emergencias'
  and column_name in ('motivo','funcionario_id','acionado_por_nome','acionado_por_cargo',
                      'acionado_por_codigo','data_hora','resolvido_por_nome','resolvido_por_cargo',
                      'data_resolucao','webhook_disparado','origem','created_at');
""")
    check("SC3.2 todas as colunas faltantes foram criadas (12)", colunas == 12, f"colunas={colunas}")
    check("SC3.3 dado legado normalizado e CHECK aplicado (0 linhas inválidas)",
          escalar(conn, """
select count(*) from public.emergencias
where estado is null or estado not in ('ATIVA','RESOLVIDA');
""") == 0 and escalar(conn, """
select count(*) from pg_constraint where conrelid = 'public.emergencias'::regclass
  and conname = 'emergencias_estado_check';
""") == 1)
    check("SC3.4 NOTICE informa a criação das constraints durante o reparo",
          any("emergencias_estado_check" in n for n in notices), notices[-3:])

    # ---------------------------------------------------------------- SC4
    print("\nSC4 — tabela `emergencias` existente em OUTRO schema")
    executar(conn, """
drop table public.emergencias cascade;
create schema if not exists legado;
drop table if exists legado.emergencias;
create table legado.emergencias (id int);
""")
    _, notices, erro = aplicar_migracao(conn, MIGRACAO_NOVA, aceitar_erro=True)
    check("SC4.1 migração conclui mesmo com a tabela homônima em outro schema", erro is None,
          erro and getattr(erro, "pgerror", str(erro)))
    aviso = [n for n in notices if "legado" in n]
    check("SC4.2 NOTICE explica que o PostgREST só expõe o schema `public`",
          bool(aviso) and "legado.emergencias" in aviso[0], aviso[:1])
    check("SC4.3 public.emergencias criada normalmente",
          escalar(conn, "select to_regclass('public.emergencias') is not null;") is True)

    # ---------------------------------------------------------------- SC5
    print("\nSC5 — pré-requisitos ausentes (aborta antes de criar qualquer coisa)")
    executar(conn, """
drop schema public cascade;
create schema public;
""")
    _, _, erro = aplicar_migracao(conn, MIGRACAO_NOVA, aceitar_erro=True)
    check("SC5.1 aborta com mensagem clara quando public.funcionarios não existe",
          erro is not None and "Pré-requisito ausente" in (erro.pgerror or ""),
          erro and (erro.pgerror or "").strip()[:160])
    check("SC5.2 nada é criado quando a migração aborta (transação íntegra)",
          escalar(conn, "select to_regclass('public.emergencias') is null;") is True)

    # ---------------------------------------------------------------- resumo
    falhas = [r for r in RESULTADOS if r[0] == "FAIL"]
    print("\n" + "=" * 78)
    for status, rotulo, extra in RESULTADOS:
        icone = "✅" if status == "PASS" else "❌"
        sufixo = f"  — {extra}" if status == "FAIL" and extra else ""
        print(f"{icone} {rotulo}{sufixo}")
    print("=" * 78)
    print(f"{len(RESULTADOS) - len(falhas)}/{len(RESULTADOS)} verificações OK")
    if falhas:
        print("💥 A MIGRAÇÃO PRECISA DE AJUSTES.")
        return 1
    print("✨ MIGRAÇÃO VALIDADA EM POSTGRESQL REAL (criação, idempotência, reparo e RLS).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
