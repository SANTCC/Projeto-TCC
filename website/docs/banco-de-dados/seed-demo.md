---
id: seed-demo
title: Seed de demonstração
sidebar_label: Seed de demonstração
description: O que o supabase/seed.sql cria, como aplicá-lo com segurança e como as capturas de tela usam dados simulados.
---

# Seed de demonstração

`supabase/seed.sql` cria o ambiente de demonstração: **20 usuários mock**, frota, cargas em todos os
status, checklists, rotas e histórico de alterações. É o que permite apresentar o sistema sem dados reais.

:::danger Nunca aplicar em produção
O arquivo é destinado a demonstração e desenvolvimento local. Os códigos `MOCK-*` são públicos no
repositório: quem os conhece entra com o cargo correspondente.
:::

---

## 1. Como aplicar

```bash
# local (aplica migrações + seed)
supabase db reset

# projeto de demonstração
psql "$DATABASE_URL" -f supabase/seed.sql
```

O arquivo está registrado em `supabase/config.toml`:

```toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

---

## 2. Idempotência e proteção do dado real

| Mecanismo | Efeito |
| --- | --- |
| ids determinísticos | os mesmos registros a cada execução |
| `on conflict do nothing` | reexecutar **não duplica** |
| checagem de matrícula | se já existir um usuário real com a mesma matrícula, o mock é **pulado** — o dado real não é alterado |
| fora do código e das migrações | nenhuma tela depende do seed para funcionar |

---

## 3. Conteúdo criado

| Entidade | Quantidade | Detalhe |
| --- | --- | --- |
| **Funcionários** | 20 | 2 por cargo do enum (10 cargos), nome `[CARGO]_mock123` / `_mock321`, código `MOCK-[CARGO]-123` / `-321` |
| **Navios** | 4 | dois atracados (berços ocupados), um em trânsito (`FORA_DO_PORTO`) e um em `NO_PORTO_DE_DESTINO`; IMOs `9990001`–`9990004` |
| **Contêineres** | 6 | ligados aos navios, com estados operacionais variados |
| **Cargas** | 12 | cobrem os **9 status** (`AGENDAMENTO`…`ENTREGUE`, mais `RECUSADA` e `CANCELADA`), com uma inspeção aprovada e uma recusada |
| **Tipos de carga** | 4 | cada um com modelo de checklist |
| **Rotas marítimas** | 4 | a partir de Santos, com distância fixa (base do ETA a 33 km/h) |
| **Histórico de alterações** | 27 | cadastros, edições de status, exportações de PDF e reimpressão de etiqueta, todos atribuídos a usuários mock |

:::warning Dados fictícios
Os IMOs `9990001`–`9990004` não existem como embarcações reais e as distâncias das rotas não correspondem a
cálculos de navegação. Não use como referência operacional.
:::

---

## 4. Verificação

```bash
npm run test:seed                     # estrutura do arquivo (sem banco)
python tests/verify_seed_demo.py      # PostgreSQL local: 22 verificações
```

O teste em PostgreSQL cobre contagens por tabela, **idempotência** (executar duas vezes) e **preservação de
dados reais** (um funcionário com matrícula coincidente não é sobrescrito). Requer
`pip install pgserver psycopg2-binary`.

---

## 5. Dados simulados nas capturas de tela

As capturas do `about.html` e desta documentação **não** usam o seed: elas usam um
**PostgREST simulado** (`tools/screenshots/mock-postgrest.js`) com os dados de
`tools/screenshots/demo-data.js`. Vantagens:

- nenhuma conexão com o Supabase (nada é gravado, nenhuma credencial real é usada);
- o conteúdo é estável entre execuções, então as capturas são reproduzíveis;
- o contador de usuários on-line, o Realtime e o VLibras são desligados durante a captura.

O catálogo de telas (`tools/screenshots/paginas.js`) define as 12 telas capturáveis, e as **3 contas** são
`MAT-0000` (Diretor-Presidente), `MAT-2011` (Supervisor) e `MAT-9999` (Técnico em Portos) — cada uma
entrando pelo fluxo real de login e confirmação de cargo e navegando apenas pelas telas liberadas ao seu
cargo.

```bash
npm install --prefix tools/screenshots       # dependências vendorizadas
CHROME_PATH=/usr/bin/chromium npm run screenshots   # 30 PNGs + manifest.json → about/screenshots/
npm run about                                # regenera about.html a partir do manifesto
npm run test:screenshots                     # valida dados, PostgREST simulado e matriz de permissões
```

Detalhes em [Documentação ilustrada](/operacao/documentacao-ilustrada).
