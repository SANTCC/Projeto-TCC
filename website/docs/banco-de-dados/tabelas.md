---
id: tabelas
title: Tabelas
sidebar_label: Tabelas
description: As 25 tabelas do schema NexusPort, agrupadas por área, com colunas, chaves e o papel de cada uma.
---

# Tabelas

Dicionário das **25 tabelas** de `public`, agrupadas por área. Tipos entre parênteses; `PK` = chave
primária, `FK` = chave estrangeira, `U` = único. A versão com todas as colunas e constraints está em
`TABLES.md`.

---

## 1. Domínio e hierarquia

### `cargo_niveis`
Mapa cargo → nível de acesso (populado na instalação com os 10 cargos).

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `cargo` | `cargo_enum` | PK |
| `nivel` | `nivel_acesso_enum` | `OPERACIONAL`/`GESTAO`/`TATICO`/`ESTRATEGICO` |

### `funcionarios`
Cadastro funcional — é a tabela de identidade do sistema (não há Supabase Auth).

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `matricula` | `text` | U — login principal |
| `codigo_individual` | `text` | U — credencial reemitível (RN 15) |
| `nome` | `text` | — |
| `cargo` | `cargo_enum` | define permissões e camada de visão |
| `email` / `telefone` | `text` | nuláveis |
| `ativo` | `bool` | inativo não entra |
| `cpf`, `data_nascimento` | — | adicionados na migração `20261010000000` (delegação) |
| `created_at`, `updated_at` | `timestamptz` | — |

### `visitantes`
Pessoas temporárias no porto (RF 15) — separadas de funcionários.

| Coluna | Tipo |
| --- | --- |
| `id` (PK), `nome`, `documento`, `motivo` (nulável) | `uuid`, `text`, `text`, `text` |
| `data_hora_entrada`, `data_hora_saida` (nulável) | `timestamptz` |
| `registrado_por` (FK `funcionarios.id`) | `uuid` |
| `created_at` | `timestamptz` |

### `tipos_carga`
Classificação que determina o checklist (RF 2, RN 14).

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` (PK) | `uuid` | — |
| `nome` | `text` | U |
| `categoria_risco`, `requisitos_especiais` | `text` | nuláveis |
| `created_at`, `updated_at` | `timestamptz` | — |

### `checklist_modelos`
Um modelo por tipo de carga (`tipo_carga_id` é **único**).

| Coluna | Tipo |
| --- | --- |
| `id` (PK), `tipo_carga_id` (U, FK), `nome`, `descricao`, `criado_por` (FK) | `uuid`/`text` |
| `created_at`, `updated_at` | `timestamptz` |

### `checklist_itens`
Os itens de cada modelo — `critico` é o que bloqueia a aprovação (RN 14).

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` (PK), `checklist_modelo_id` (FK) | `uuid` | — |
| `descricao` | `text` | — |
| `critico` | `bool` | item crítico exige "Conforme" |
| `ordem` | `int4` | ordem de exibição |
| `created_at` | `timestamptz` | — |

### `rotas_maritimas`
Origem → destino com distância fixa; base do ETA (RN 9).

| Coluna | Tipo |
| --- | --- |
| `id` (PK), `origem`, `destino` | `uuid`, `text` |
| `distancia_km` | `numeric` |
| `created_at`, `updated_at` | `timestamptz` |

---

## 2. Equipamentos e embarcações

### `navios`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` (PK) | `uuid` | — |
| `nome` | `text` | — |
| `numero_imo` | `text` | U |
| `data_registro_sistema` | `date` | base da preventiva de 3 anos (RN 11) |
| `quantidade_cargas_realizadas` | `int4` | contador |
| `estado_operacional` | `estado_navio_enum` | `OPERANTE`, `AGENDADO_PARA_REFORMA`, `EM_REFORMA`, `APROVADO_PARA_REFORMA` |
| `coordenadas_gps` | `text` | fictícias (RF 8) |
| `tempo_fora_do_porto` | `timetz` | RF 5 |
| `porto_origem`, `porto_destino` | `text` | — |
| `localizacao` | `localizacao_navio_enum` | `DENTRO_DO_PORTO`, `FORA_DO_PORTO`, `NO_PORTO_DE_DESTINO` |
| `data_chegada`, `data_saida` | `timestamptz` | — |
| `qr_code_url` | `text` | U |
| `created_at`, `updated_at` | `timestamptz` | — |

### `bercos` (migração `001_create_bercos.sql`)
15 posições de atracação do STS-01. `id` é `text` no padrão `BERCO-NN` porque o front-end usa esses
identificadores.

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | `text` | PK, `~ '^BERCO-[0-9]{2}$'` |
| `nome` | `text` | U |
| `estado` | `text` | `LIVRE` / `OCUPADO` / `MANUTENCAO` |
| `navio_id` | `uuid` | FK `navios(id)` `on delete set null` |
| `navio_nome`, `navio_imo` | `text` | snapshot do navio atracado |

**Constraint `bercos_vinculo_navio_check`:** `OCUPADO` exige `navio_nome` **ou** `navio_imo`;
`LIVRE`/`MANUTENCAO` não pode ter resíduo de vínculo.

### `guindastes`

| Coluna | Tipo |
| --- | --- |
| `id` (PK), `numero_identificacao` (U) | `uuid`, `text` |
| `estado` | `estado_guindaste_enum` (`OPERANTE`/`EM_MANUTENCAO`) |
| `data_ultima_manutencao` | `date` |
| `qr_code_url` (U) | `text` |
| `created_at`, `updated_at` | `timestamptz` |

### `containers`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` (PK), `numero_identificacao` (U) | `uuid`, `text` | — |
| `tipo_carga_id` | `uuid` | **um** tipo de carga por contêiner (RN 5) |
| `material_carregado` | `text` | — |
| `data_fabricacao`, `data_ultima_manutencao` | `date` | base do tempo de uso |
| `tempo_uso_referencia` | `referencia_tempo_enum` | `DATA_FABRICACAO` ou `DATA_ULTIMA_MANUTENCAO` (RN 7) |
| `estado` | `estado_container_enum` | — |
| `navio_id` | `uuid` | navio vinculado (RN 6: navio carrega só contêineres) |
| `qr_code_url` (U) | `text` | — |
| `created_at`, `updated_at` | `timestamptz` | — |

---

## 3. Cargas e fluxo

### `cargas`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` (PK) | `uuid` | — |
| `tipo_carga_id` | `uuid` | FK `tipos_carga` |
| `quantidade`, `material` | `numeric`, `text` | — |
| `peso`, `volume`, `valor_declarado` | `numeric` | **obrigatórios** (RN 13) |
| `natureza` | `text` | obrigatório |
| `porto_descarga` | `text` | obrigatório (individual por carga) |
| `data_entrada`, `data_saida` | `timestamptz` | base dos cálculos do RF 4 |
| `destino` | `text` | — |
| `status_fluxo` | `status_carga_enum` | 9 valores (RF 6) |
| `container_id`, `navio_id` | `uuid` | vínculos (não são estado — não-requisito 15) |
| `checklist_modelo_id` | `uuid` | modelo aplicado |
| `resultado_inspecao` | `resultado_inspecao_enum` | `PENDENTE`/`APROVADA`/`RECUSADA` |
| `motivo_recusa` | `text` | obrigatório quando recusada |
| `qr_code_url` (U) | `text` | gerado uma única vez (RN 17) |
| `created_at`, `updated_at` | `timestamptz` | — |

### `agendamentos`
Um agendamento por carga (`carga_id` é **único**): `data_prevista_entrega` (date), `agendado_por`,
`created_at`. É o que autoriza a aceitação na chegada (RF 6.1).

### `estivador_cargas`
Vínculo operador ↔ carga com `estado_carregamento_enum` (`EM_CARREGAMENTO`/`PARADO`/`CONCLUIDO`) e as datas
de início/fim. É a base da **Visão Própria** do Estivador.

---

## 4. Manutenção

### `manutencoes`
`entidade_tipo` (`tipo_entidade_enum`) define qual das FKs (`navio_id`, `container_id`, `guindaste_id`) é
usada; `status` (`SOLICITADA`/`APROVADA`/`RECUSADA`/`CONCLUIDA`) com `data_solicitacao`,
`data_aprovacao`, `data_conclusao`, `descricao`, `solicitado_por`, `aprovado_por`.

### `historico_manutencoes`
Serviços já realizados: `data_manutencao`, `descricao_servicos`, `registrado_por` (RF 2). Alimenta o ciclo
de preventiva de 3 anos (RN 11).

---

## 5. Inspeção e checklist

### `inspecoes`
`carga_id`, `checklist_modelo_id`, `inspetor_id`, `data_inspecao`, `resultado`,
`observacoes` e **`ativa`** (`boolean`, padrão `true`). O índice parcial **`uq_inspecoes_carga_ativa`**
garante no máximo **uma inspeção ativa por carga**; as anteriores ficam como histórico (`ativa = false`) —
é o que permite reinspecionar sem perder o registro.

### `inspecao_itens`
Resposta de cada item: `inspecao_id`, `checklist_item_id`, `conforme` (nulo = não respondido) e
`observacao`.

---

## 6. Auditoria e decisões

### `logs_alteracoes`
Log geral (RF 12): `data_hora`, `funcionario_id`, `cargo`, `codigo_individual`, `entidade_tipo`,
`entidade_id`, `tipo_alteracao` (`CRIACAO`/`EDICAO`/`EXCLUSAO`/`REIMPRESSAO_ETIQUETA`/`EXPORTACAO`) e
`detalhes` (`jsonb`). Política **append-only**.

### `trail_decisoes`
Trilha imutável (RF 13): `data_hora`, `funcionario_id`, `cargo`, `codigo_individual`, `tipo_decisao`,
`entidade_tipo`, `entidade_id`, `motivo` e `detalhes`. Nunca é editado nem apagado pelo cliente.

### `retificacoes_trail`
Retificação anexada a um registro da trilha: `trail_id`, `funcionario_id`, `retificacao`, `data_hora`. O
registro original permanece intacto.

---

## 7. Delegação, leituras e emergência

### `delegacoes_supervisor`
`supervisor_titular_id`, `substituto_id`, `substituto_nome`, `substituto_cpf`,
`substituto_data_nascimento`, `data_inicio`, `data_fim_previsto`, `data_revogacao` (nulável) e `ativo`
(bool). Um substituto ativo por supervisor (RF 14).

### `leituras_qr_code`
`funcionario_id`, `entidade_tipo`, `entidade_id`, `data_hora` — cada leitura de QR autenticada (RF 17.4,
RN 19).

### `emergencias`
Estado global do botão de pânico: `estado` (`ATIVA`/`RESOLVIDA`), `motivo`, `funcionario_id`,
`acionado_por_nome`, `acionado_por_cargo`, `acionado_por_codigo`, `data_hora`, `resolvido_por_nome`,
`resolvido_por_cargo`, `data_resolucao`, `webhook_disparado` (bool) e `origem`
(`EDGE_FUNCTION`/`CLIENT_FALLBACK`).

### `panic_webhook_config`
`enabled` (padrão **false**), `url` (nulável), `updated_at`. Só a Edge Function lê esta tabela; o disparo
ocorre apenas se `enabled = true` **e** a URL for válida.

### `log_acessos_usuarios`
Criada na migração `20261010010000`: registra IP (de cabeçalhos de proxy) e user agent truncado em 512
caracteres, por acesso autenticado.

---

## 8. Resumo por contagem

| Grupo | Tabelas |
| --- | --- |
| Domínio e hierarquia | 7 |
| Equipamentos e embarcações | 4 |
| Cargas e fluxo | 3 |
| Manutenção | 2 |
| Inspeção | 2 |
| Auditoria e decisões | 3 |
| Delegação, leituras e emergência | 4 |
| **Total** | **25** |
