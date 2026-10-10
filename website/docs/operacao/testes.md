---
id: testes
title: Testes
sidebar_label: Testes
description: As suítes Node (47 arquivos), os verificadores Python (15), o que cada uma cobre e como rodar tudo.
---

# Testes

O projeto tem **47 arquivos de teste em Node** (executados com `jsdom`), **15 verificadores em Python**
(executados contra PostgreSQL real) e 10 imagens de evidência de fases anteriores em `tests/`.

```bash
npm test          # suíte completa (Node + auditoria XSS + Lighthouse dry + screenshots)
npm run test:build
node tests/test_haptics.js        # uma suíte isolada
```

---

## 1. Como a suíte é organizada

| Grupo | Scripts npm | Foco |
| --- | --- | --- |
| Gráficos | `test:graficos`, `test:refresh`, `test:autorefresh` | Chart.js por camada de visão, recarga manual e a cada 60 s |
| Fluxo de cargas | `test:bercos`, `test:cargas-loop`, `test:single-flight` | vínculo de berços, controle de requisições, uma requisição por conjunto |
| Pânico e emergências | `test:panic`, `test:enum`, `test:haptics`, `test:vlibras` | botão global, migração 404, enum, vibração/áudio, Libras |
| Sessão e RBAC | `test:sessao`, `test:backlog3`, `test:backlog3:restantes`, `test:pendentes` | cookies, permissões, correções do backlog 3 |
| Agentes de IA | `test:webmcp` | núcleo (223 verificações) + páginas reais (102) |
| Segurança | `audit:xss` | varredura estática + regressão anti-XSS |
| Dados e demonstração | `test:seed`, `test:screenshots`, `test:about` | seed, PostgREST simulado, catálogo de telas, `about.html` |
| Servidor | `test:edge-functions`, `test:relatorio-pdf`, `test:log-acesso` | handlers das Edge Functions em Node |
| Tempo real | `test:tempo-real`, `test:presenca` | sincronização e contador de usuários |
| Qualidade | `test:build`, `test:lighthouse` | build minificado e o próprio gate |
| Outros | `test:gravacao`, `test:funcionario-cpf`, `test:analytics`, `test:net-debug` | gravação de inspeção/login, CPF, GA4, console de rede |

---

## 2. Suítes em destaque

### `test:build` — o build não pode regredir

1. **Saída completa:** as 13 páginas e os 41 módulos existem em `dist/`;
2. **Minificação válida:** JS e CSS menores que a origem, sintaxe verificada (`new vm.Script`);
3. **Caminhos preservados:** todo `<script src>`/`<link href>`/`<img src>` local existe na saída;
4. **Estrutura preservada:** mesmos `id=` e mesmos blocos `<script>` inline;
5. **Nada de desenvolvimento na saída:** `tests`, `tools`, `SPECs`, `supabase`, `THEME`, `lighthouse`,
   `website`, `docs`, `.md`, `.py`;
6. **Proteção:** a saída não pode ser a raiz do projeto;
7. **Execução real:** a página `dashboard.html` do `dist/` monta cabeçalho e presença em `jsdom`;
8. **Configuração:** `vercel.json` e `package.json` apontam para o build;
9. **Determinismo:** dois builds seguidos geram arquivos idênticos.

### `test:webmcp` — agentes de IA

223 verificações no núcleo + 102 nas páginas reais, cobrindo registro por cargo, rejeição de argumentos
inválidos, confirmação fail-closed, limites de taxa, higienização de saída, ausência de dados pessoais em
parâmetros e marcação de autoria na trilha. Ver [WebMCP](/arquitetura/webmcp).

### `test:screenshots` + `test:about`

Validam os dados de demonstração, o PostgREST simulado (filtros, `or`, `not.in`), o catálogo de telas em
sincronia com a matriz de permissões, e o `about.html`: estrutura, conteúdo, imagens em disco, links
internos, rótulos acessíveis, tabelas com cabeçalho, alternância de tema, lightbox e **igualdade com o que
o gerador produz** (se você editar `about.html` à mão, o teste reprova).

### `test:edge-functions` + `test:relatorio-pdf`

Executam os handlers reais das Edge Functions em Node, com cliente Supabase falso: contratos, RBAC, rota
ausente, ETA, propagação de status, KPIs por camada, cache HIT/novo hash do PDF e exportação auditada.

---

## 3. Verificadores Python (PostgreSQL real)

Requerem `pip install pgserver psycopg2-binary`. O `pgserver` sobe um PostgreSQL descartável:

```bash
python3 -m unittest discover -s tests -p "test_python_suite.py"    # = npm run test:python
python tests/verify_seed_demo.py                                   # 22 verificações do seed
python tests/verify_migration_emergencias.py                       # 24 verificações da migração
python tests/verify_enum_emergencia.py                             # 21 verificações do enum
python tests/verify_backlog_002.py                                 # backlog 002
python tests/verify_phase3.py … verify_phase9.py                   # fases 3 a 9
python tests/verify_points_1_2_3.py, verify_t1_7.py, verify_t1_8.py
```

Esses scripts são a **evidência de execução** das migrações e do seed: eles aplicam os SQL de verdade e
conferem contagens, idempotência e preservação de dados.

---

## 4. Ferramentas de apoio nos testes

| Ferramenta | Papel |
| --- | --- |
| `tests/webmcp-harness.js` | cria janelas `jsdom`, injeta sessão, prepara DOM e espera condições |
| `tools/screenshots/mock-postgrest.js` | PostgREST simulado (filtros, `or`, `not.in`, ordenação, limites) |
| `tools/screenshots/demo-data.js` | dados fictícios determinísticos |
| `tests/test_suite_completa.js` | agrega a execução da suíte |
| imagens `verification_phase*.png` | evidência visual das fases 3 a 8 |

---

## 5. Convenções

- Um arquivo por assunto: `tests/test_<assunto>.js`;
- saída legível com marcas de **PASS**/**FAIL** e resumo final;
- sem dependência de rede: `jsdom` + clientes falsos;
- verificação em PostgreSQL só quando a mudança é de banco (pasta `verify_*.py`);
- quando um teste falha, a mensagem indica **o que fazer** (ex.: *"rode: node
  tools/screenshots/gerar-about.js"*).

---

## 6. Como rodar só o que interessa

```bash
npm run audit:xss                 # segurança de saída
npm run test:webmcp               # agentes de IA
npm run test:build                # build de produção
npm run test:panic                # pânico + migrações de emergência
npm run test:backlog3             # sessão + correções do backlog 3
npm run test:screenshots          # capturas e catálogo de telas
```

:::tip Antes de abrir um PR
`npm test` e `npm run test:build` cobrem a maior parte das regressões; o gate Lighthouse roda
automaticamente no PR (`.github/workflows/lighthouse.yml`).
:::
