---
id: enums-e-tipos
title: Enums e tipos
sidebar_label: Enums e tipos
description: Os 14 tipos enum do schema, com todos os valores e a regra de negócio que cada um expressa.
---

# Enums e tipos

O schema usa **14 tipos `enum`** do PostgreSQL. Eles fecham o vocabulário de estados do domínio: nenhuma
tabela aceita texto livre onde há um conjunto finito de valores.

| # | Tipo | Valores | Onde é usado |
| --- | --- | --- | --- |
| 1 | `cargo_enum` | ver abaixo (10 cargos) | `funcionarios.cargo`, `cargo_niveis.cargo`, logs e trilha |
| 2 | `nivel_acesso_enum` | `OPERACIONAL`, `GESTAO`, `TATICO`, `ESTRATEGICO` | `cargo_niveis.nivel` |
| 3 | `estado_navio_enum` | `OPERANTE`, `AGENDADO_PARA_REFORMA`, `EM_REFORMA`, `APROVADO_PARA_REFORMA` | `navios.estado_operacional` |
| 4 | `estado_container_enum` | idem acima | `containers.estado` |
| 5 | `estado_guindaste_enum` | `OPERANTE`, `EM_MANUTENCAO` | `guindastes.estado` |
| 6 | `localizacao_navio_enum` | `DENTRO_DO_PORTO`, `FORA_DO_PORTO`, `NO_PORTO_DE_DESTINO` | `navios.localizacao` |
| 7 | `status_carga_enum` | 9 valores (ver abaixo) | `cargas.status_fluxo` |
| 8 | `tipo_decisao_enum` | 9 valores (ver abaixo) | `trail_decisoes.tipo_decisao` |
| 9 | `tipo_entidade_enum` | 10 valores (ver abaixo) | `logs_alteracoes`, `trail_decisoes`, `leituras_qr_code`, `manutencoes` |
| 10 | `tipo_alteracao_enum` | `CRIACAO`, `EDICAO`, `EXCLUSAO`, `REIMPRESSAO_ETIQUETA`, `EXPORTACAO` | `logs_alteracoes.tipo_alteracao` |
| 11 | `referencia_tempo_enum` | `DATA_FABRICACAO`, `DATA_ULTIMA_MANUTENCAO` | `containers.tempo_uso_referencia` (RN 7) |
| 12 | `resultado_inspecao_enum` | `PENDENTE`, `APROVADA`, `RECUSADA` | `inspecoes.resultado`, `cargas.resultado_inspecao` |
| 13 | `status_manutencao_enum` | `SOLICITADA`, `APROVADA`, `RECUSADA`, `CONCLUIDA` | `manutencoes.status` |
| 14 | `estado_carregamento_enum` | `EM_CARREGAMENTO`, `PARADO`, `CONCLUIDO` | `estivador_cargas.estado_carregamento` |

---

## `cargo_enum` (10 cargos)

```text
ESTIVADOR
CONFERENTE_CARGA
ARRUMADOR_CONSERTADOR
PLANEJADOR_PATIO_NAVIOS
TECNICO_PORTOS
SUPERVISOR_GERENTE_OPERACOES
INSPETOR
DIRETOR_OPERACOES_LOGISTICA
DIRETOR_PRESIDENTE_SUPERINTENDENTE
CONSELHO_ADMINISTRACAO
```

:::note Cargo fora do enum
A matriz de permissões menciona `SUPERVISOR_SUBSTITUTO` como cargo efetivo durante uma delegação ativa.
Esse valor **não** existe no enum: a elevação é aplicada em memória, na sessão
(`NexusAuth.getSession()`), sem gravar cargo novo no banco.
:::

---

## `status_carga_enum` (9 valores para 8 etapas)

| Valor | Etapa | Transições de saída |
| --- | --- | --- |
| `AGENDAMENTO` | 1 — agendamento | `RECEBIMENTO_INSPECAO`, `CANCELADA` |
| `RECEBIMENTO_INSPECAO` | 2 — recebimento e inspeção | `ARMAZENAGEM` (aprovada), `RECUSADA` |
| `ARMAZENAGEM` | 3 — armazenagem | `PRONTA_PARA_ENTREGA`, `CANCELADA` |
| `PRONTA_PARA_ENTREGA` | 5 — pronta para entrega | `SAIDA`, `CANCELADA` |
| `SAIDA` | 6 — saída do porto | `EM_TRANSITO` |
| `EM_TRANSITO` | 7 — em trânsito | `ENTREGUE` |
| `ENTREGUE` | 8 — entregue | *(fim)* |
| `CANCELADA` | transição especial | *(fim)* — só a partir de 1, 3 ou 5 |
| `RECUSADA` | desfecho da inspeção | *(fim)* — sem gestão de destino (não-requisito 9) |

A ordem dos valores no enum **não** é a ordem cronológica do fluxo; a tela usa um mapa explícito de rótulos
e cores (ver [Fluxo da carga](/dominio/fluxo-da-carga)).

---

## `tipo_decisao_enum` (9 decisões)

| Valor | Cargo responsável | Requisito |
| --- | --- | --- |
| `APROVOU_CARGA` | Inspetor | RF 13 |
| `RECUSOU_CARGA` | Inspetor | RF 13 |
| `SOLICITOU_MANUTENCAO_NAVIO` | Inspetor | RF 13 |
| `SOLICITOU_MANUTENCAO_CONTAINER` | Inspetor | RF 13 |
| `LIBEROU_NAVIO` | Supervisor | RN 3 |
| `CANCELOU_ENTREGA` | Supervisor | RN 16 |
| `APROVOU_MANUTENCAO` | Supervisor | RF 3 |
| `RECUSOU_MANUTENCAO` | Supervisor | RF 3 |
| `DESIGNOU_SUBSTITUTO` | Supervisor | RF 14 |

---

## `tipo_entidade_enum` (10 valores)

`NAVIO`, `CONTAINER`, `CARGA`, `FUNCIONARIO`, `VISITANTE`, `GUINDASTE`, `MANUTENCAO`, `CHECKLIST`, `ROTA`,
`TIPO_CARGA` — e o valor **`EMERGENCIA`**, acrescentado pela migração do botão de pânico
(`20261007000000` / `20261008010000`) para permitir auditar o acionamento de emergência.

:::danger Armadilha do PostgreSQL (erro 55P04)
No PostgreSQL 12+, um valor recém-adicionado com `ALTER TYPE … ADD VALUE` **não pode ser usado na mesma
transação**. Como o SQL Editor do Supabase envia o arquivo inteiro como uma transação, a migração
`20261008010000` **de propósito** não insere nem seleciona com o valor novo — deixa esse teste para um
passo separado. Ignorar isso produz
`ERROR 55P04: unsafe use of new value "EMERGENCIA" of enum type tipo_entidade_enum`.
:::

---

## Como evoluir um enum com segurança

```sql
-- 1) adicionar o valor (idempotente)
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'status_carga_enum' and e.enumlabel = 'EM_CONFERENCIA'
  ) then
    alter type status_carga_enum add value 'EM_CONFERENCIA';
  end if;
end $$;

-- 2) recarregar o schema cache do PostgREST
notify pgrst, 'reload schema';

-- 3) SÓ DEPOIS, em outra transação, usar o valor:
-- update cargas set status_fluxo = 'EM_CONFERENCIA' where id = '...';
```

Checklist ao mexer em enum:

- [ ] a migração é **idempotente** (checa `pg_enum` antes de `alter type`);
- [ ] termina com `notify pgrst, 'reload schema'`;
- [ ] não usa o valor novo na mesma transação;
- [ ] o front-end, os relatórios e o `test_enum_emergencia.js` conhecem o novo valor;
- [ ] `SPECs/schema.sql` e `TABLES.md` foram atualizados para refletir o estado final.
