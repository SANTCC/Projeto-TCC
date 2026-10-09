# Tables usadas no Banco de Dados


## Table `cargo_niveis`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `cargo` | `cargo_enum` | Primary |
| `nivel` | `nivel_acesso_enum` |  |

## Table `funcionarios`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `matricula` | `text` |  Unique |
| `codigo_individual` | `text` |  Unique |
| `nome` | `text` |  |
| `cargo` | `cargo_enum` |  |
| `email` | `text` |  Nullable Unique |
| `telefone` | `text` |  Nullable |
| `ativo` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `visitantes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `nome` | `text` |  |
| `documento` | `text` |  |
| `motivo` | `text` |  Nullable |
| `data_hora_entrada` | `timestamptz` |  |
| `data_hora_saida` | `timestamptz` |  Nullable |
| `registrado_por` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `tipos_carga`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `nome` | `text` |  Unique |
| `categoria_risco` | `text` |  Nullable |
| `requisitos_especiais` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `checklist_modelos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tipo_carga_id` | `uuid` |  Unique |
| `nome` | `text` |  |
| `descricao` | `text` |  Nullable |
| `criado_por` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `checklist_itens`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `checklist_modelo_id` | `uuid` |  |
| `descricao` | `text` |  |
| `critico` | `bool` |  |
| `ordem` | `int4` |  |
| `created_at` | `timestamptz` |  |

## Table `rotas_maritimas`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `origem` | `text` |  |
| `destino` | `text` |  |
| `distancia_km` | `numeric` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `navios`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `nome` | `text` |  |
| `numero_imo` | `text` |  Unique |
| `data_registro_sistema` | `date` |  |
| `quantidade_cargas_realizadas` | `int4` |  |
| `estado_operacional` | `estado_navio_enum` |  |
| `coordenadas_gps` | `text` |  Nullable |
| `tempo_fora_do_porto` | `timetz` |  Nullable |
| `porto_origem` | `text` |  Nullable |
| `porto_destino` | `text` |  Nullable |
| `localizacao` | `localizacao_navio_enum` |  |
| `data_chegada` | `timestamptz` |  Nullable |
| `data_saida` | `timestamptz` |  Nullable |
| `qr_code_url` | `text` |  Nullable Unique |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `guindastes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `numero_identificacao` | `text` |  Unique |
| `estado` | `estado_guindaste_enum` |  |
| `data_ultima_manutencao` | `date` |  Nullable |
| `qr_code_url` | `text` |  Nullable Unique |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `containers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `numero_identificacao` | `text` |  Unique |
| `tipo_carga_id` | `uuid` |  Nullable |
| `material_carregado` | `text` |  Nullable |
| `data_fabricacao` | `date` |  Nullable |
| `data_ultima_manutencao` | `date` |  Nullable |
| `tempo_uso_referencia` | `referencia_tempo_enum` |  Nullable |
| `estado` | `estado_container_enum` |  |
| `navio_id` | `uuid` |  Nullable |
| `qr_code_url` | `text` |  Nullable Unique |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `cargas`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `tipo_carga_id` | `uuid` |  Nullable |
| `quantidade` | `numeric` |  Nullable |
| `material` | `text` |  Nullable |
| `peso` | `numeric` |  |
| `volume` | `numeric` |  |
| `valor_declarado` | `numeric` |  |
| `natureza` | `text` |  |
| `data_entrada` | `timestamptz` |  Nullable |
| `data_saida` | `timestamptz` |  Nullable |
| `destino` | `text` |  Nullable |
| `porto_descarga` | `text` |  |
| `status_fluxo` | `status_carga_enum` |  |
| `container_id` | `uuid` |  Nullable |
| `checklist_modelo_id` | `uuid` |  Nullable |
| `resultado_inspecao` | `resultado_inspecao_enum` |  |
| `motivo_recusa` | `text` |  Nullable |
| `qr_code_url` | `text` |  Nullable Unique |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `navio_id` | `uuid` |  Nullable |

## Table `agendamentos`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `carga_id` | `uuid` |  Unique |
| `data_prevista_entrega` | `date` |  |
| `agendado_por` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `estivador_cargas`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `estivador_id` | `uuid` |  |
| `carga_id` | `uuid` |  |
| `estado_carregamento` | `estado_carregamento_enum` |  |
| `data_inicio` | `timestamptz` |  Nullable |
| `data_fim` | `timestamptz` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `manutencoes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `entidade_tipo` | `tipo_entidade_enum` |  |
| `navio_id` | `uuid` |  Nullable |
| `container_id` | `uuid` |  Nullable |
| `guindaste_id` | `uuid` |  Nullable |
| `data_solicitacao` | `timestamptz` |  |
| `data_aprovacao` | `timestamptz` |  Nullable |
| `data_conclusao` | `timestamptz` |  Nullable |
| `descricao` | `text` |  |
| `status` | `status_manutencao_enum` |  |
| `solicitado_por` | `uuid` |  Nullable |
| `aprovado_por` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |

## Table `historico_manutencoes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `navio_id` | `uuid` |  Nullable |
| `container_id` | `uuid` |  Nullable |
| `guindaste_id` | `uuid` |  Nullable |
| `data_manutencao` | `date` |  |
| `descricao_servicos` | `text` |  |
| `registrado_por` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `inspecoes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `carga_id` | `uuid` |  (não único: uma carga pode ter várias inspeções; ver `ativa`) |
| `checklist_modelo_id` | `uuid` |  Nullable |
| `inspetor_id` | `uuid` |  Nullable |
| `data_inspecao` | `timestamptz` |  |
| `resultado` | `resultado_inspecao_enum` |  |
| `observacoes` | `text` |  Nullable |
| `ativa` | `boolean` |  Default `true`; no máximo uma ativa por `carga_id` (índice parcial `uq_inspecoes_carga_ativa`). As anteriores ficam como histórico (`false`). |
| `created_at` | `timestamptz` |  |

## Table `inspecao_itens`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `inspecao_id` | `uuid` |  |
| `checklist_item_id` | `uuid` |  |
| `conforme` | `bool` |  Nullable |
| `observacao` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `logs_alteracoes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `data_hora` | `timestamptz` |  |
| `funcionario_id` | `uuid` |  Nullable |
| `cargo` | `cargo_enum` |  |
| `codigo_individual` | `text` |  |
| `entidade_tipo` | `tipo_entidade_enum` |  |
| `entidade_id` | `text` |  |
| `tipo_alteracao` | `tipo_alteracao_enum` |  |
| `detalhes` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `trail_decisoes`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `data_hora` | `timestamptz` |  |
| `funcionario_id` | `uuid` |  Nullable |
| `cargo` | `cargo_enum` |  |
| `codigo_individual` | `text` |  |
| `tipo_decisao` | `tipo_decisao_enum` |  |
| `entidade_tipo` | `tipo_entidade_enum` |  |
| `entidade_id` | `text` |  |
| `motivo` | `text` |  Nullable |
| `detalhes` | `jsonb` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `retificacoes_trail`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `trail_id` | `uuid` |  |
| `funcionario_id` | `uuid` |  Nullable |
| `retificacao` | `text` |  |
| `data_hora` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

## Table `delegacoes_supervisor`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `supervisor_titular_id` | `uuid` |  Nullable |
| `substituto_id` | `uuid` |  Nullable |
| `data_inicio` | `timestamptz` |  |
| `data_fim_previsto` | `timestamptz` |  |
| `data_revogacao` | `timestamptz` |  Nullable |
| `ativo` | `bool` |  |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  |
| `substituto_cpf` | `text` | Primary |
| `substituto_data_nascimento` | `date` |  Nullable |
| `substituto_nome` | `text` |  Nullable |

## Table `leituras_qr_code`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `funcionario_id` | `uuid` |  Nullable |
| `entidade_tipo` | `tipo_entidade_enum` |  |
| `entidade_id` | `text` |  |
| `data_hora` | `timestamptz` |  |
| `created_at` | `timestamptz` |  |

## Table `emergencias`

> Botão de Pânico Global — estado da emergência (ATIVA/RESOLVIDA). Escrita feita pela Edge Function `panic-alert` (service role); leitura usada pelos clientes ao carregar a página. Tempo real via broadcast WebSocket no canal `nexus-emergency`.
>
> **Provisão:** aplicada por `supabase/migrations/20261007000000_panic_button_global.sql`; se o banco ainda não foi migrado (`HTTP 404` / `PGRST205` na consulta do rodapé), aplique `supabase/migrations/20261008000000_emergencias_fix_404.sql` (idempotente e reparadora) — ver `SPECs/diagnostico/404-emergencias.md`.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `estado` | `text` |  Default `'ATIVA'` (`ATIVA`/`RESOLVIDA`) |
| `motivo` | `text` |  Nullable |
| `funcionario_id` | `uuid` |  Nullable FK → `funcionarios.id` |
| `acionado_por_nome` | `text` |  Nullable |
| `acionado_por_cargo` | `cargo_enum` |  Nullable |
| `acionado_por_codigo` | `text` |  Nullable |
| `data_hora` | `timestamptz` |  |
| `resolvido_por_nome` | `text` |  Nullable |
| `resolvido_por_cargo` | `cargo_enum` |  Nullable |
| `data_resolucao` | `timestamptz` |  Nullable |
| `webhook_disparado` | `bool` |  Default `false` |
| `origem` | `text` |  Default `'EDGE_FUNCTION'` (`EDGE_FUNCTION`/`CLIENT_FALLBACK`) |
| `created_at` | `timestamptz` |  |

## Table `panic_webhook_config`

> Webhook OPCIONAL do botão de pânico — **desativado por padrão** (`enabled = false`). A Edge Function `panic-alert` só dispara o POST JSON se `enabled = true` e `url` estiver configurada.

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `enabled` | `bool` |  Default `false` |
| `url` | `text` |  Nullable |
| `updated_at` | `timestamptz` |  |

## Custom Types / Enums

### `cargo_enum`

`ESTIVADOR` | `CONFERENTE_CARGA` | `ARRUMADOR_CONSERTADOR` | `PLANEJADOR_PATIO_NAVIOS` | `TECNICO_PORTOS` | `SUPERVISOR_GERENTE_OPERACOES` | `INSPETOR` | `DIRETOR_OPERACOES_LOGISTICA` | `DIRETOR_PRESIDENTE_SUPERINTENDENTE` | `CONSELHO_ADMINISTRACAO`

### `nivel_acesso_enum`

`OPERACIONAL` | `GESTAO` | `TATICO` | `ESTRATEGICO`

### `estado_navio_enum`

`OPERANTE` | `AGENDADO_PARA_REFORMA` | `EM_REFORMA` | `APROVADO_PARA_REFORMA`

### `estado_container_enum`

`OPERANTE` | `AGENDADO_PARA_REFORMA` | `EM_REFORMA` | `APROVADO_PARA_REFORMA`

### `estado_guindaste_enum`

`OPERANTE` | `EM_MANUTENCAO`

### `localizacao_navio_enum`

`DENTRO_DO_PORTO` | `FORA_DO_PORTO` | `NO_PORTO_DE_DESTINO`

### `status_carga_enum`

`AGENDAMENTO` | `RECEBIMENTO_INSPECAO` | `ARMAZENAGEM` | `PRONTA_PARA_ENTREGA` | `SAIDA` | `EM_TRANSITO` | `ENTREGUE` | `CANCELADA` | `RECUSADA`

### `tipo_decisao_enum`

`APROVOU_CARGA` | `RECUSOU_CARGA` | `SOLICITOU_MANUTENCAO_NAVIO` | `SOLICITOU_MANUTENCAO_CONTAINER` | `LIBEROU_NAVIO` | `CANCELOU_ENTREGA` | `APROVOU_MANUTENCAO` | `RECUSOU_MANUTENCAO` | `DESIGNOU_SUBSTITUTO`

### `tipo_entidade_enum`

`NAVIO` | `CONTAINER` | `CARGA` | `FUNCIONARIO` | `VISITANTE` | `GUINDASTE` | `MANUTENCAO` | `CHECKLIST` | `ROTA` | `TIPO_CARGA` | `EMERGENCIA`

### `tipo_alteracao_enum`

`CRIACAO` | `EDICAO` | `EXCLUSAO` | `REIMPRESSAO_ETIQUETA`

### `referencia_tempo_enum`

`DATA_FABRICACAO` | `DATA_ULTIMA_MANUTENCAO`

### `resultado_inspecao_enum`

`PENDENTE` | `APROVADA` | `RECUSADA`

### `status_manutencao_enum`

`SOLICITADA` | `APROVADA` | `RECUSADA` | `CONCLUIDA`

### `estado_carregamento_enum`

`EM_CARREGAMENTO` | `PARADO` | `CONCLUIDO`

## RLS Policies

### `funcionarios`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_funcionarios` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_funcionarios` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_funcionarios` | UPDATE | public | PERMISSIVE | `true` | `true` |
| `nexus_delete_funcionarios` | DELETE | public | PERMISSIVE | `true` | — |

### `visitantes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_visitantes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_visitantes` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_visitantes` | UPDATE | public | PERMISSIVE | `true` | `true` |
| `nexus_delete_visitantes` | DELETE | public | PERMISSIVE | `true` | — |

### `cargo_niveis`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_cargo_niveis` | SELECT | public | PERMISSIVE | `true` | — |

### `tipos_carga`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_tipos_carga` | SELECT | public | PERMISSIVE | `true` | — |

### `checklist_modelos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_checklist_modelos` | SELECT | public | PERMISSIVE | `true` | — |

### `checklist_itens`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_checklist_itens` | SELECT | public | PERMISSIVE | `true` | — |

### `logs_alteracoes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_logs_alteracoes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_logs_alteracoes` | INSERT | public | PERMISSIVE | — | `true` |

### `trail_decisoes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_trail_decisoes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_trail_decisoes` | INSERT | public | PERMISSIVE | — | `true` |

### `retificacoes_trail`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_retificacoes_trail` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_retificacoes_trail` | INSERT | public | PERMISSIVE | — | `true` |

### `cargas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_cargas` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_cargas` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_cargas` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `navios`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_navios` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_navios` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_navios` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `containers`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_containers` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_containers` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_containers` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `manutencoes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_manutencoes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_manutencoes` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_manutencoes` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `historico_manutencoes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_historico_manutencoes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_historico_manutencoes` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_historico_manutencoes` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `inspecoes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_inspecoes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_inspecoes` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_inspecoes` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `inspecao_itens`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_inspecao_itens` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_inspecao_itens` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_inspecao_itens` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `estivador_cargas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_estivador_cargas` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_estivador_cargas` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_estivador_cargas` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `agendamentos`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_agendamentos` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_agendamentos` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_agendamentos` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `rotas_maritimas`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_rotas_maritimas` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_rotas_maritimas` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_rotas_maritimas` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `leituras_qr_code`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_leituras_qr_code` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_leituras_qr_code` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_leituras_qr_code` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `delegacoes_supervisor`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_delegacoes_supervisor` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_delegacoes_supervisor` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_delegacoes_supervisor` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `guindastes`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_guindastes` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_guindastes` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_guindastes` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `emergencias`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_emergencias` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_emergencias` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_emergencias` | UPDATE | public | PERMISSIVE | `true` | `true` |

### `panic_webhook_config`

| Policy | Command | Roles | Action | USING | WITH CHECK |
|--------|---------|-------|--------|-------|------------|
| `nexus_select_panic_webhook_config` | SELECT | public | PERMISSIVE | `true` | — |
| `nexus_insert_panic_webhook_config` | INSERT | public | PERMISSIVE | — | `true` |
| `nexus_update_panic_webhook_config` | UPDATE | public | PERMISSIVE | `true` | `true` |
