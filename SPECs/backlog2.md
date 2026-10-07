## 🔴 Problemas confirmados

1. **RLS aberta para o mundo.** `for all using (true)` sem `to ...` vale para `public`, então qualquer pessoa com a anon key lê e altera `funcionarios` (incluindo `codigo_individual`, que é a credencial de login), `cargas`, `navios` etc.
2. **12 tabelas com RLS ligada e sem nenhuma policy** (`inspecoes`, `manutencoes`, `trail_decisoes`, `logs_alteracoes`, `agendamentos`, `checklist_*`, `delegacoes_supervisor`, `leituras_qr_code`, `retificacoes_trail`, `historico_manutencoes`, `inspecao_itens`). Via anon/authenticated, elas ficam totalmente bloqueadas. Ou o front usa a service key (pior) ou essas telas não funcionam.
3. **`updated_at` nunca é atualizado.** Só tem `default now()`. Falta um trigger genérico `set_updated_at()` em todas as tabelas.
4. **Trigger `trg_propagar_status_navio`** dispara em qualquer `UPDATE` que cite `localizacao`, mesmo sem mudança de valor. Adicione `when (old.localizacao is distinct from new.localizacao)`. Cargas sem `container_id` nunca propagam.
5. **`pgcrypto` ativada mas não usada** (`gen_random_uuid()` já é nativo no PG13+). Ou use `crypt()` para hash do `codigo_individual`, ou remova.

## 🟠 Integridade (alto valor, baixo esforço)

```sql
-- navio não pode ocupar 2 berços
create unique index uq_bercos_navio on bercos(navio_id) where navio_id is not null;

-- manutenção aponta para exatamente 1 entidade
alter table manutencoes add check (num_nonnulls(navio_id, container_id, guindaste_id) = 1);
alter table historico_manutencoes add check (num_nonnulls(navio_id, container_id, guindaste_id) = 1);

-- recusa exige motivo
alter table cargas add check (status_fluxo <> 'RECUSADA' or motivo_recusa is not null);

-- uma delegação ativa por titular
create unique index uq_delegacao_ativa on delegacoes_supervisor(supervisor_titular_id) where ativo and data_revogacao is null;
```

- Checks de datas: `data_saida >= data_chegada` (navios), `data_fim >= data_inicio` (estivador_cargas), `data_fim_previsto > data_inicio` (delegações), saída ≥ entrada (visitantes, cargas).
- Formato: IMO `^[0-9]{7}$`; contêiner ISO 6346 `^[A-Z]{4}[0-9]{7}$`.
- `manutencoes.entidade_tipo` aceita `FUNCIONARIO`, `VISITANTE`, etc. Troque por checagem coerente com a FK preenchida, ou remova a coluna.
- **Índices em FKs** (Postgres não cria sozinho): `cargas(container_id, status_fluxo)`, `containers(navio_id)`, `manutencoes(status, navio_id/container_id/guindaste_id)`, `logs_alteracoes(entidade_tipo, entidade_id, data_hora)`, `trail_decisoes(entidade_tipo, entidade_id)`.

## 🟡 Modelagem

- **Redundância que pode divergir:** `cargas.resultado_inspecao`/`checklist_modelo_id` duplicam `inspecoes`; `delegacoes_supervisor.substituto_nome/cpf/data_nascimento` duplicam `funcionarios`; `cargas.destino` vs `porto_descarga`; `cargas.material` vs `containers.material_carregado`.
- **`rotas_maritimas` está órfã** (ninguém referencia). Crie `portos` (UN/LOCODE) e use FK em `navios.porto_origem/destino`, `cargas.porto_descarga` e rotas.
- **Falta `viagens`** (navio × rota × saída/chegada). Hoje `navios` guarda só o estado atual, sem histórico.
- **Falta tabela de operação** (carga × guindaste × berço × estivador × início/fim). Guindaste hoje não se liga a nada.
- **Tipos fracos:** `coordenadas_gps text` → `numeric lat/lng` ou PostGIS `geography`; `tempo_fora_do_porto text` → calcular de `data_saida`; `quantidade_cargas_realizadas` → derivar/trigger.
- Unidades e moeda: renomeie para `peso_kg`, `volume_m3` e adicione `moeda` em `valor_declarado`.
- `estado_navio_enum` e `estado_container_enum` são idênticos; uma coisa só, ou diferencie de fato.
- Capacidade do contêiner (tara, carga máx.) para validar `sum(cargas.peso)`. *(Especulativo, depende da regra de negócio.)*

## 🟡 Auditoria e segurança

- **Auditoria por trigger** (função genérica `fn_audit()`), não pelo app. Hoje o app pode esquecer de gravar em `logs_alteracoes`.
- **Tabelas append-only:** `logs_alteracoes`, `trail_decisoes`, `retificacoes_trail` devem bloquear `UPDATE/DELETE` (trigger com `raise exception` ou `revoke`).
- **Login:** use uma Edge Function que valida o código e emite JWT com claim `cargo`. Aí a RLS usa `auth.jwt()->>'cargo'` + `cargo_niveis`, e o hardening de `bercos` deixa de ser só comentário.
- **LGPD:** CPF e documento de visitante em texto puro. Considere criptografar ou restringir colunas via view.
- `delegacoes_supervisor` com `on delete cascade` apaga histórico de delegação ao remover funcionário. Prefira `restrict`.
- **Máquina de estados** de `status_fluxo`: trigger que só permite transições válidas (ex.: `ENTREGUE` não volta para `ARMAZENAGEM`).

## 🟢 Operacional

- Use **migrations versionadas** (Supabase CLI). `create type` sem `if not exists` quebra ao reexecutar.
- **Supabase Realtime** em `bercos`/`navios` para painel ao vivo.
- **Views** para dashboard (`v_cargas_em_andamento`, `v_berços_ocupacao`) e `security_invoker = true` para respeitar RLS.
- Função do trigger de propagação como `security definer` se você endurecer a RLS, senão ela pode falhar.
