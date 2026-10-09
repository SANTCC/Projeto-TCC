#!/usr/bin/env python3
"""
VERIFICAÇÃO EM POSTGRESQL — SEED DE DEMONSTRAÇÃO (Backlog 3, itens C e D)

Aplica SPECs/schema.sql e as migrações novas em um PostgreSQL local (pgserver) e depois o
supabase/seed.sql, duas vezes. Confere:
  1. Dois usuários mock por cargo (todos os cargos do enum), com nome [CARGO]_mock123/321.
  2. Contagens de tipos, rotas, navios, contêineres, cargas e histórico (logs).
  3. Cobertura: os 9 status do fluxo aparecem nas cargas de demonstração.
  4. Chaves estrangeiras e enums válidos (os INSERTs falhariam se não fossem).
  5. Idempotência: a segunda execução não muda nenhuma contagem.
  6. Não destrói dados existentes: um usuário real e uma carga real continuam intactos,
     e um código real que colide com um mock não impede a carga do seed.

Requisitos: pip install pgserver psycopg2-binary (num ambiente virtual).
Uso: <python-com-pgserver> tests/verify_seed_demo.py
"""
import os
import re
import sys
import tempfile
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PASSOU = 0
FALHOU = 0


def check(rotulo, condicao, extra=''):
    global PASSOU, FALHOU
    if condicao:
        PASSOU += 1
        print(f'  ✅ [PASS] {rotulo}')
    else:
        FALHOU += 1
        print(f'  ❌ [FAIL] {rotulo}' + (f' — {extra}' if extra else ''))


def ler(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def preparar_banco(psycopg2, host, nome):
    """Cria um banco limpo com o esquema base e as migrações novas (o seed não depende das outras)."""
    admin = psycopg2.connect(host=host, dbname='postgres', user='postgres')
    admin.autocommit = True
    cur_admin = admin.cursor()
    cur_admin.execute('drop database if exists ' + nome)
    cur_admin.execute('create database ' + nome)
    admin.close()
    c = psycopg2.connect(host=host, dbname=nome, user='postgres')
    c.autocommit = True
    cur = c.cursor()
    # Esquema base: a extensão pgcrypto não existe no pgserver; gen_random_uuid() é nativo.
    schema = re.sub(r'(?im)^\s*create extension[^;]*;', '-- extensão ignorada na verificação local', ler('SPECs/schema.sql'))
    cur.execute('create schema if not exists storage')
    cur.execute("""create table if not exists storage.buckets (
      id text primary key, name text not null, owner uuid, created_at timestamptz default now(),
      updated_at timestamptz default now(), public boolean default false,
      avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[])""")
    cur.execute(schema)
    for mig in ['20261009010000_relatorios_pdf_storage.sql', '20261009020000_auditoria_exportacao.sql']:
        cur.execute(ler(f'supabase/migrations/{mig}'))
    return c, cur


def aplicar_seed(cur):
    """Executa o seed; devolve o erro (ou None)."""
    try:
        cur.execute(ler('supabase/seed.sql'))
        return None
    except Exception as e:  # noqa: BLE001 - reporta a falha ao usuário
        return str(e).splitlines()[0]


def contagens(cur):
    cur.execute("select count(*) from funcionarios where codigo_individual like 'MOCK-%'")
    mock = cur.fetchone()[0]
    cur.execute("select count(*) from tipos_carga where nome like 'Contêiner%' or nome like 'Reefer%' or nome like 'Granel%'")
    tipos = cur.fetchone()[0]
    cur.execute("select count(*) from rotas_maritimas where origem='Santos (BRSSZ)'")
    rotas = cur.fetchone()[0]
    cur.execute("select count(*) from navios where qr_code_url like 'QR-DEMO-NAV-%'")
    navios = cur.fetchone()[0]
    cur.execute("select count(*) from containers where numero_identificacao like 'DEMO%'")
    conts = cur.fetchone()[0]
    cur.execute("select count(*) from cargas where qr_code_url like 'QR-DEMO-CRG-%'")
    cargas = cur.fetchone()[0]
    cur.execute("select count(*) from logs_alteracoes where entidade_id like 'DEMO%' or entidade_id in "
                "('Navio Atlântico Sul','Navio Mar Aberto','Navio Costa Leste','Navio Porto Verde')")
    logs = cur.fetchone()[0]
    return {'mock': mock, 'tipos': tipos, 'rotas': rotas, 'navios': navios,
            'containers': conts, 'cargas': cargas, 'logs': logs}


def main():
    try:
        import pgserver
        import psycopg2
    except ImportError:
        print('pgserver/psycopg2 não instalados: pip install pgserver psycopg2-binary')
        return 2

    pasta = tempfile.mkdtemp(prefix='nexus-seed-')
    pg = pgserver.get_server(pasta, cleanup_mode='stop')
    uri = pg.get_uri()
    host = uri.split('?host=')[1] if '?host=' in uri else pasta
    admin = psycopg2.connect(host=host, dbname='postgres', user='postgres')
    admin.autocommit = True
    cur_admin = admin.cursor()
    for papel in ['anon', 'authenticated', 'service_role']:
        cur_admin.execute('select 1 from pg_roles where rolname=%s', (papel,))
        if not cur_admin.fetchone():
            cur_admin.execute('create role ' + papel + ' nologin')
    admin.close()
    print('\n=== Seed de demonstração no PostgreSQL (Backlog 3 — C e D) ===')

    # ---- Banco limpo: contagens, cobertura, integridade e idempotência ----
    c, cur = preparar_banco(psycopg2, host, 'nexus_seed')
    print('esquema e migrações aplicados (banco limpo)')
    erro_primeira = aplicar_seed(cur)
    check('primeira execução do seed roda sem erro', erro_primeira is None, erro_primeira or '')

    print('\n[1] Usuários mock: 2 por cargo')
    cur.execute("select unnest(enum_range(null::cargo_enum))::text")
    cargos = [r[0] for r in cur.fetchall()]
    check(f'enum tem {len(cargos)} cargos e o seed cobre todos', len(cargos) == 10)
    faltando = []
    for cargo in cargos:
        cur.execute("select nome from funcionarios where cargo = %s and codigo_individual like 'MOCK-%%' order by nome", (cargo,))
        nomes = [r[0] for r in cur.fetchall()]
        esperados = [f'{cargo}_mock123', f'{cargo}_mock321']
        if sorted(nomes) != sorted(esperados):
            faltando.append(f'{cargo}: {nomes}')
    check('cada cargo tem exatamente os usuários CARGO_mock123 e CARGO_mock321', not faltando, '; '.join(faltando[:3]))

    print('\n[2] Contagens da demonstração')
    primeira = contagens(cur)
    check('20 usuários mock (2 por cargo)', primeira['mock'] == 20, str(primeira))
    check('4 tipos de carga de demonstração', primeira['tipos'] == 4, str(primeira))
    check('4 rotas a partir de Santos', primeira['rotas'] == 4, str(primeira))
    check('4 navios de demonstração', primeira['navios'] == 4, str(primeira))
    check('6 contêineres de demonstração', primeira['containers'] == 6, str(primeira))
    check('12 cargas de demonstração', primeira['cargas'] == 12, str(primeira))
    check('27 registros de histórico de alterações', primeira['logs'] == 27, str(primeira))

    print('\n[3] Cobertura do fluxo e integridade')
    cur.execute("select count(distinct status_fluxo) from cargas where qr_code_url like 'QR-DEMO-CRG-%'")
    distintos = cur.fetchone()[0]
    check('os 9 status do fluxo aparecem nas cargas de demonstração', distintos == 9, str(distintos))
    cur.execute("select count(*) from logs_alteracoes l join funcionarios f on f.id = l.funcionario_id "
                "where f.codigo_individual like 'MOCK-%' and l.cargo = f.cargo and l.codigo_individual = f.codigo_individual")
    check('todo histórico de demonstração aponta para um usuário mock e cargo coerente', cur.fetchone()[0] == 27)
    cur.execute("select count(*) from containers ct join navios n on n.id = ct.navio_id where ct.numero_identificacao like 'DEMO%'")
    check('contêineres de demonstração estão ligados a navios', cur.fetchone()[0] == 6)
    cur.execute("select count(*) from cargas ca join containers ct on ct.id = ca.container_id where ca.qr_code_url like 'QR-DEMO-CRG-%'")
    check('cargas ligadas a contêiner pelo vínculo do schema', cur.fetchone()[0] == 6)
    cur.execute("select count(*) from logs_alteracoes where tipo_alteracao = 'EXPORTACAO'")
    check('exportações de PDF no histórico usam o tipo EXPORTACAO', cur.fetchone()[0] == 2)

    print('\n[4] Idempotência: segunda execução')
    erro_segunda = aplicar_seed(cur)
    check('segunda execução roda sem erro', erro_segunda is None, erro_segunda or '')
    segunda = contagens(cur)
    check('segunda execução não duplica nem remove nada', segunda == primeira, f'{primeira} vs {segunda}')
    c.close()

    # ---- Banco com dados reais, inclusive uma colisão de matrícula: nada pode ser alterado ----
    print('\n[5] Dados existentes preservados')
    c2, cur2 = preparar_banco(psycopg2, host, 'nexus_seed_real')
    cur2.execute("insert into funcionarios (id, matricula, codigo_individual, nome, cargo, ativo) values "
                 "(gen_random_uuid(), 'MAT-REAL-1', 'NX-REAL-1', 'Operador real', 'INSPETOR', true)")
    cur2.execute("insert into funcionarios (id, matricula, codigo_individual, nome, cargo, ativo) values "
                 "(gen_random_uuid(), 'MOCK-123-ESTIVADOR', 'NX-COLIDE-1', 'Colisão de matrícula', 'ESTIVADOR', true)")
    cur2.execute("insert into cargas (id, peso, volume, valor_declarado, natureza, porto_descarga, qr_code_url) values "
                 "(gen_random_uuid(), 1, 1, 1, 'Real', 'Porto real', 'QR-REAL-1')")
    erro_real = aplicar_seed(cur2)
    check('seed roda sobre dados reais sem erro (colisão é ignorada, não falha)', erro_real is None, erro_real or '')
    cur2.execute("select count(*) from funcionarios where codigo_individual = 'NX-REAL-1'")
    check('usuário real continua existindo', cur2.fetchone()[0] == 1)
    cur2.execute("select count(*) from cargas where qr_code_url = 'QR-REAL-1'")
    check('carga real continua existindo', cur2.fetchone()[0] == 1)
    cur2.execute("select nome from funcionarios where codigo_individual = 'NX-COLIDE-1'")
    check('usuário real com matrícula igual a um mock não é alterado', cur2.fetchone() == ('Colisão de matrícula',))
    cur2.execute("select count(*) from funcionarios where codigo_individual = 'MOCK-ESTIVADOR-123'")
    check('com a colisão, o mock de mesma matrícula é pulado (o usuário real tem prioridade)', cur2.fetchone()[0] == 0)
    c2.close()

    print(f'\nResultado: {PASSOU} aprovado(s), {FALHOU} falha(s).')
    return 0 if FALHOU == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
