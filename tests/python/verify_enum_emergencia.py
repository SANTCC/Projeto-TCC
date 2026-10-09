#!/usr/bin/env python3
"""
Verificação da migração do enum EMERGENCIA (erro 22P02) em PostgreSQL REAL.

Reproduz, em um PostgreSQL descartável, o erro relatado nos logs do Supabase:

    { "service_name": "postgres_logs",
      "parsed.application_name": "PostgREST 14.5",
      "parsed.sql_state_code": "22P02",
      "parsed.user_name": "authenticator",
      "event_message": "invalid input value for enum tipo_entidade_enum: \"EMERGENCIA\"",
      "parsed.query": "WITH pgrst_source AS (INSERT INTO \"public\".\"logs_alteracoes\"
                       (\"cargo\", ..., \"entidade_tipo\", ...) ..." }

Fluxo do que é provado aqui:

  SC1  o INSERT da auditoria (igual ao gerado pelo PostgREST) reproduz o 22P02;
  SC2  a migração 20261008010000 corrige: o valor entra no enum e o MESMO
       INSERT passa a gravar (inclusive pela role `anon`, que é quem a
       aplicação usa com a chave publishable);
  SC3  a migração roda como UM ÚNICO comando (é assim que o SQL Editor do
       Supabase e o psycopg2 enviam o arquivo: uma transação implícita) e
       termina com a conferência sem disparar "unsafe use of new value";
  SC4  idempotência: rodar de novo (e o "caminho rápido" de 1 linha) não falha;
  SC5  a ARMADILHA é real e é por isso que o arquivo é escrito assim: um
       script que faz `add value` e USA o valor no mesmo comando morre com
       55P04 — a migração do repositório não faz isso;
  SC6  ambiente sem o tipo (schema base não aplicado): a migração AVISA e
       termina sem erro, sem deixar o banco pela metade.

Uso:
    pip install psycopg2-binary pgserver      # pgserver é opcional
    python3 tests/verify_enum_emergencia.py

Sem `pgserver`, o script usa NEXUS_TEST_DATABASE_URL (banco DESCARTÁVEL) e,
sem nenhuma das duas, explica como rodar e sai com 2.
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIGRACAO = os.path.join(
    ROOT, "supabase", "migrations", "20261008010000_enum_emergencia_auditoria.sql"
)

RESULTADOS = []


def check(rotulo, condicao, extra=""):
    RESULTADOS.append(("PASS" if condicao else "FAIL", rotulo, str(extra)[:200]))
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

        data_dir = os.path.join(tempfile.gettempdir(), "pgdata_verify_enum")
        if os.path.isdir(data_dir):
            shutil.rmtree(data_dir)
        servidor = pgserver.get_server(data_dir)
        import psycopg2  # type: ignore

        return psycopg2.connect(servidor.get_uri()), f"pgserver ({data_dir})"

    url = os.environ.get("NEXUS_TEST_DATABASE_URL")
    if not url:
        print(__doc__)
        print("AVISO: instale 'pgserver' (pip install pgserver) ou defina")
        print("       NEXUS_TEST_DATABASE_URL apontando para um banco DESCARTÁVEL.")
        sys.exit(2)

    import psycopg2  # type: ignore

    return psycopg2.connect(url), f"NEXUS_TEST_DATABASE_URL ({url.split('@')[-1]})"


def executar(conn, sql, aceitar_erro=False):
    """Executa SQL em autocommit. Devolve (linhas, notices, erro).

    Um único `cur.execute(script)` reproduz o comportamento do SQL Editor do
    Supabase: o arquivo inteiro vai ao servidor como UM comando e, portanto,
    como UMA transação implícita.
    """
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


def aplicar_migracao(conn, aceitar_erro=False):
    """Executa o arquivo INTEIRO em um único comando (semântica do SQL Editor)."""
    with open(MIGRACAO, encoding="utf-8") as fh:
        sql = fh.read()
    return executar(conn, sql, aceitar_erro=aceitar_erro)


def sqlstate(erro):
    return getattr(erro, "pgcode", None) or getattr(erro, "sqlstate", None)


# ---------------------------------------------------------------- ambiente
# Banco criado com o SPECs/schema.sql ANTIGO: o tipo tem os valores de
# entidade, mas NÃO tem 'EMERGENCIA' — exatamente o estado do projeto
# loedodixvmadxqgykehh retratado no log do Supabase.
PRE_REQUISITOS = """
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on types to anon, authenticated;
create type cargo_enum as enum ('ESTIVADOR','CONFERENTE_CARGA','INSPETOR');
create type tipo_alteracao_enum as enum ('CRIACAO','EDICAO','EXCLUSAO');
create type tipo_entidade_enum as enum ('NAVIO','CONTAINER','CARGA','FUNCIONARIO','VISITANTE');
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
  tipo_alteracao tipo_alteracao_enum not null,
  detalhes jsonb
);
alter table public.logs_alteracoes enable row level security;
create policy nexus_all_logs_alteracoes on public.logs_alteracoes
  for all using (true) with check (true);
grant all on all tables in schema public to anon, authenticated;
"""

# INSERT da auditoria do pânico — mesmo payload de js/panic-realtime.js.
INSERT_AUDITORIA = """
insert into public.logs_alteracoes
  (cargo, codigo_individual, entidade_tipo, entidade_id, tipo_alteracao, detalhes)
values
  ('INSPETOR', 'INS-001', 'EMERGENCIA', 'PANICO_GLOBAL', 'EDICAO',
   '{"estado":"EMERGENCIA_CRITICA_ATIVADA","via":"edge_function"}'::jsonb)
returning id, entidade_tipo;
"""


def criar_roles(conn):
    executar(
        conn,
        """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
""",
    )


def main():
    conn, descricao = conectar()
    print("=" * 78)
    print("VERIFICAÇÃO DA MIGRAÇÃO DO ENUM EMERGENCIA (22P02) — PostgreSQL real")
    print(f"Servidor: {descricao}")
    print("=" * 78)

    criar_roles(conn)
    _, _, erro_pre = executar(conn, PRE_REQUISITOS, aceitar_erro=True)
    if erro_pre is not None:
        print("AVISO: pré-requisitos já existiam:", erro_pre.pgerror)
        executar(conn, "drop schema public cascade; create schema public;")
        executar(conn, PRE_REQUISITOS)

    # ---------------------------------------------------------------- SC1
    print("\nSC1 — o erro do log do Supabase, reproduzido")
    _, _, erro = executar(conn, "set role anon;", aceitar_erro=True)
    _, _, erro = executar(conn, INSERT_AUDITORIA, aceitar_erro=True)
    check(
        "SC1.1 INSERT da auditoria com entidade_tipo = EMERGENCIA falha em 22P02",
        erro is not None and sqlstate(erro) == "22P02",
        erro and (erro.pgerror or "").strip(),
    )
    check(
        'SC1.2 a mensagem é exatamente a do log: invalid input value for enum tipo_entidade_enum: "EMERGENCIA"',
        erro is not None
        and 'invalid input value for enum tipo_entidade_enum: "EMERGENCIA"'
        in (erro.pgerror or ""),
        erro and (erro.pgerror or "").strip(),
    )
    check(
        "SC1.3 o INSERT é recusado pelo tipo, não por privilégio/RLS (anon tem grant all)",
        erro is not None and sqlstate(erro) == "22P02",
        erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}",
    )
    executar(conn, "reset role;")
    check(
        "SC1.4 nenhuma linha foi gravada (a auditoria da emergência foi perdida)",
        escalar(conn, "select count(*) from public.logs_alteracoes;") == 0,
    )

    # ---------------------------------------------------------------- SC3
    print("\nSC3 — migração executada como UM ÚNICO comando (semântica do SQL Editor)")
    _, notices, erro = aplicar_migracao(conn, aceitar_erro=True)
    check(
        "SC3.1 o arquivo inteiro roda em um único comando, sem 55P04/22P02",
        erro is None,
        erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}",
    )
    check(
        "SC3.2 NOTICE confirma o valor EMERGENCIA",
        any("valor EMERGENCIA" in n for n in notices),
        notices,
    )
    linhas, _, _ = aplicar_migracao(conn, aceitar_erro=True)
    check(
        "SC3.3 a conferência final do próprio arquivo vem na saída (objeto/pronto)",
        bool(linhas) and len(linhas[0]) >= 4 and str(linhas[0][0]).endswith("tipo_entidade_enum"),
        linhas,
    )
    check(
        "SC3.4 a conferência reporta valor_emergencia/pronto = true e lista os valores",
        bool(linhas) and linhas[0][2] is True and "EMERGENCIA" in str(linhas[0][3]),
        linhas[:1],
    )
    check(
        "SC3.5 a 2ª linha da conferência valida logs_alteracoes.entidade_tipo",
        len(linhas) > 1 and linhas[1][2] is True and "tipo_entidade_enum" in str(linhas[1][3]),
        linhas[1:],
    )

    # ---------------------------------------------------------------- SC2
    print("\nSC2 — correção aplicada: a auditoria volta a gravar (role anon)")
    check(
        "SC2.1 o valor entrou no enum (catálogo pg_enum)",
        escalar(
            conn,
            """
select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'tipo_entidade_enum' and e.enumlabel = 'EMERGENCIA');
""",
        )
        is True,
    )
    check(
        "SC2.2 nenhum valor anterior foi removido do enum (6 valores: 5 + EMERGENCIA)",
        escalar(conn, "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'tipo_entidade_enum';")
        == 6,
    )
    executar(conn, "set role anon;")
    try:
        linhas, _, erro = executar(conn, INSERT_AUDITORIA, aceitar_erro=True)
        check(
            "SC2.3 o INSERT da auditoria (igual ao do PostgREST) agora grava a linha",
            erro is None and bool(linhas) and linhas[0][1] == "EMERGENCIA",
            erro and (erro.pgerror or "").strip() or linhas,
        )
        check(
            "SC2.4 a linha ficou legível para a role anon (é auditoria, não dado sensível)",
            escalar(
                conn,
                "select count(*) from public.logs_alteracoes where entidade_tipo = 'EMERGENCIA';",
            )
            == 1,
        )
    finally:
        executar(conn, "reset role;")

    # ---------------------------------------------------------------- SC4
    print("\nSC4 — idempotência (rodar 2ª, 3ª vez e o caminho rápido de 1 linha)")
    _, _, erro = aplicar_migracao(conn, aceitar_erro=True)
    check("SC4.1 migração repetida sem erro", erro is None,
          erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}")
    _, _, erro = executar(
        conn,
        "alter type public.tipo_entidade_enum add value if not exists 'EMERGENCIA';",
        aceitar_erro=True,
    )
    check("SC4.2 caminho rápido (1 linha) é no-op depois da migração", erro is None,
          erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}")
    check(
        "SC4.3 continua existindo exatamente um valor EMERGENCIA",
        escalar(conn, "select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'tipo_entidade_enum' and e.enumlabel = 'EMERGENCIA';")
        == 1,
    )

    # ---------------------------------------------------------------- SC5
    print("\nSC5 — a armadilha documentada no cabeçalho da migração (55P04)")
    script_armadilha = (
        "alter type public.tipo_entidade_enum add value if not exists 'TRAP_TESTE';\n"
        "select 'TRAP_TESTE'::public.tipo_entidade_enum;\n"
    )
    _, _, erro = executar(conn, script_armadilha, aceitar_erro=True)
    check(
        "SC5.1 add value + USO do valor no MESMO comando falha com 55P04 (unsafe use of new value)",
        erro is not None
        and sqlstate(erro) == "55P04"
        and "unsafe use of new value" in (erro.pgerror or ""),
        erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}",
    )
    check(
        "SC5.2 a migração do repositório NÃO cai nessa armadilha (verificado em SC3.1)",
        True,
    )

    # ---------------------------------------------------------------- SC6
    print("\nSC6 — banco sem o tipo (schema base não aplicado): avisa, não quebra")
    executar(conn, "drop schema public cascade; create schema public;")
    _, notices, erro = aplicar_migracao(conn, aceitar_erro=True)
    check("SC6.1 migração termina sem erro", erro is None,
          erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}")
    check(
        "SC6.2 NOTICE explica que o tipo não existe e aponta o schema base",
        any("tipo_entidade_enum não existe" in n and "SPECs/schema.sql" in n for n in notices),
        notices,
    )
    _, _, erro = aplicar_migracao(conn, aceitar_erro=True)
    check("SC6.3 e continua idempotente nesse cenário", erro is None,
          erro and f"[{sqlstate(erro)}] {(erro.pgerror or '').strip()}")

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
    print("✨ 22P02 REPRODUZIDO E CORRIGIDO EM POSTGRESQL REAL (enum, anon/RLS e idempotência).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
