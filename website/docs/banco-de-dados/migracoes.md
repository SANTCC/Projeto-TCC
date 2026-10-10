---
id: migracoes
title: Migrações
sidebar_label: Migrações
description: As 10 migrações SQL do projeto — o que cada uma faz, quando aplicar, garantias de idempotência e como reverter o rumo.
---

# Migrações

O projeto tem **10 scripts de migração** em dois lugares:

| Local | Uso |
| --- | --- |
| `supabase/migrations/` (9 arquivos) | aplicados por `supabase db push` (ou colados no SQL Editor) |
| `migrations/001_create_bercos.sql` | migração especial, aplicada manualmente pelo SQL Editor |

O schema completo (`SPECs/schema.sql`) é para **bancos novos**; migrações são para **bancos que já
existem**.

---

## 1. Lista completa

| Arquivo | O que faz | Ordem |
| --- | --- | --- |
| `migrations/001_create_bercos.sql` | cria `public.bercos` (15 posições do STS-01), constraints, índice, trigger de `updated_at`, RLS e carga inicial | independente (aplicar quando faltar a tabela) |
| `supabase/migrations/20261007000000_panic_button_global.sql` | migração **canônica** do pânico: tabelas `emergencias` e `panic_webhook_config`, RLS, políticas `nexus_*` e valor `EMERGENCIA` no `tipo_entidade_enum` | 1ª |
| `20261008000000_emergencias_fix_404.sql` | **reparo** do 404 / PGRST205 em `/rest/v1/emergencias`: versão idempotente que reconcilia estrutura parcial, normaliza dado legado, recria as políticas para `anon, authenticated`, recarrega o schema cache e termina com um `select` de verificação | 2ª |
| `20261008010000_enum_emergencia_auditoria.sql` | corrige `22P02` (`invalid input value for enum tipo_entidade_enum: "EMERGENCIA"`): garante o valor no enum, avisa por `NOTICE` quando o tipo não existe em `public` ou quando `logs_alteracoes.entidade_tipo` não é desse enum, recarrega o cache e confere pelo catálogo `pg_enum` | 3ª |
| `20261008020000_inspecoes_historico.sql` | histórico de inspeções: adiciona `ativa` e cria o índice único parcial `uq_inspecoes_carga_ativa` | 4ª |
| `20261009000000_realtime_publication.sql` | adiciona as tabelas operacionais à publicação `supabase_realtime` | 5ª |
| `20261009010000_relatorios_pdf_storage.sql` | cria o bucket privado `relatorios-pdf` (cache de PDF por SHA-256) | 6ª |
| `20261009020000_auditoria_exportacao.sql` | acrescenta `EXPORTACAO` ao `tipo_alteracao_enum` (exportações auditadas) | 7ª |
| `20261010000000_funcionarios_cpf_nascimento.sql` | adiciona CPF e data de nascimento a `funcionarios` (necessários à delegação — RF 14) | 8ª |
| `20261010010000_log_acessos_usuarios.sql` | tabela de log de acessos (IP + user agent) para a Edge Function `log-acesso` | 9ª |

---

## 2. Como aplicar

```bash
# projeto Supabase linkado
supabase link --project-ref <ref-do-projeto>
supabase db push

# sem a CLI (SQL Editor do painel)
# cole o conteúdo de cada arquivo, na ordem da tabela acima, e clique em Run
```

`migrations/README.md` descreve o passo a passo manual e destaca: **leia os `NOTICE`** da saída (eles
informam o que foi criado e o que ficou pendente de limpeza manual), e use **Settings → API → Restart
server** se um `PGRST205` persistir por alguns segundos (o `notify pgrst, 'reload schema';` já está no fim
de cada script).

---

## 3. Garantias das migrações

| Garantia | Como é obtida |
| --- | --- |
| **Transacional** | tudo dentro de `begin`/`commit`; falha de pré-requisito aborta sem deixar tabela pela metade |
| **Idempotente** | `if not exists`, `on conflict do nothing`, checagem em `pg_enum`/catálogo; executar duas vezes não quebra nem duplica |
| **Pré-requisitos checados** | a 001 aborta com mensagem clara se `public.navios` não existir ou se `navios.id` não for `uuid` |
| **Portátil** | detecta se as roles `anon`/`authenticated` existem; em PostgreSQL local cria a política para `PUBLIC` |
| **Tolerante a base legada** | se `bercos` já existir com colunas faltando, completa; se houver dados que violem constraint, emite `NOTICE` e segue |
| **Não destrutiva** | `on conflict (nome) do nothing` preserva berços ocupados; há bloco comentado para reset total, se desejado |
| **Cache do PostgREST** | `notify pgrst, 'reload schema';` no fim |

---

## 4. Erros clássicos e o que fazer

| Erro | Causa | Ação |
| --- | --- | --- |
| `PGRST205` — *Could not find the table 'public.x' in the schema cache* | (a) migração não aplicada, (b) aplicada em outro schema (o PostgREST só expõe `public`), (c) cache não recarregou | aplicar a migração correspondente; a `20261008000000` detecta e informa os três casos por `NOTICE` |
| `22P02` — *invalid input value for enum* | o **valor** não existe no tipo (a tabela existe e as permissões estão certas) | `ALTER TYPE … ADD VALUE` (migração `20261008010000`); `NOTIFY` e *Restart server* **não** resolvem |
| `55P04` — *unsafe use of new value* | o valor do enum foi usado na **mesma transação** em que foi criado | separar em dois scripts/execuções |
| `23514` — violação de *check* em `bercos` | berço `OCUPADO` sem navio identificado (ou `LIVRE` com resíduo) | usar o SQL de ocupação/liberação de `migrations/README.md` ou o caminho pela interface |

---

## 5. Qual migração aplicar? (fluxograma das emergências)

| Estado do banco | O que fazer |
| --- | --- |
| Nunca migrado (é o caso do 404 em `/rest/v1/emergencias`) | aplicar **`20261008000000_emergencias_fix_404.sql`** — cria tudo o que a `20261007000000` criaria e ainda deixa o banco verificável |
| Já migrado com a `20261007000000` | a `20261008000000` vira *no-op* de verificação — segura para rodar e útil para recarregar o cache |
| Tabela criada pela metade ou alterada manualmente | a `20261008000000` reconcilia colunas, defaults, `NOT NULL`, `CHECK`s e a FK antes de seguir |
| Auditoria do pânico falha com `22P02` | aplicar `20261008010000_enum_emergencia_auditoria.sql` |

---

## 6. Evidência de execução (testes)

| Verificação | O que cobre |
| --- | --- |
| `python3 tests/verify_migration_emergencias.py` | aplica a migração em PostgreSQL real e cobre 5 cenários (banco virgem, migração antiga aplicada, estado parcial, tabela em outro schema, pré-requisito ausente) + acesso pela role `anon` — 24 verificações |
| `python3 tests/verify_enum_emergencia.py` | 21 verificações do enum `EMERGENCIA` em PostgreSQL real |
| `python3 tests/verify_backlog_002.py`, `verify_phase*.py` | fases de implementação (inclui a criação de `bercos`) |
| `npm run test:pendentes`, `test:backlog3`, `test:seed` | regressões de front-end ligadas às migrações |
| `python3 tests/verify_seed_demo.py` | o seed roda sobre o schema migrado (22 verificações) |

---

## 7. Convenção para novas migrações

```text
supabase/migrations/<YYYYMMDDHHMMSS>_<assunto_em_snake_case>.sql
```

Checklist:

- [ ] `begin` / `commit` e idempotência (`if not exists`, checagem de catálogo);
- [ ] pré-requisitos verificados com mensagem clara em caso de ausência;
- [ ] nenhum dado destruído sem `NOTICE` explícito;
- [ ] `notify pgrst, 'reload schema';` no fim;
- [ ] `SPECs/schema.sql` atualizado para refletir o estado final (fonte de verdade dos bancos novos);
- [ ] `TABLES.md` atualizado quando há coluna nova;
- [ ] verificação em PostgreSQL local (`tests/verify_*.py`) quando a mudança for estrutural.
