---
id: fluxo-da-carga
title: Fluxo da carga e estados
sidebar_label: Fluxo da carga
description: As 8 etapas do fluxo (RF 6), os 9 valores de status_carga_enum, as transições permitidas e as cores de cada estado.
---

# Fluxo da carga e estados

O fluxo da carga (RF 6) tem **8 etapas** e é modelado pelo enum `status_carga_enum`, que tem **9 valores**
(o valor extra é `RECUSADA`, um desfecho alternativo da inspeção). Todos os estados são visíveis nas telas
como **badges** com as cores semânticas do Design System.

---

## 1. As 8 etapas

| # | Etapa | Valor em `status_carga_enum` | Quem age | O que o sistema faz |
| --- | --- | --- | --- | --- |
| 1 | **Agendamento** | `AGENDAMENTO` | Supervisor / Inspetor | registra a data prevista de entrega ao porto. Cargas sem agendamento prévio têm a **aceitação negada** na chegada. Exige que o tipo de carga já tenha checklist cadastrado |
| 2 | **Recebimento e Inspeção** | `RECEBIMENTO_INSPECAO` | Conferente (recebimento físico) e Inspetor (checklist) | registra data/hora, quantidade e estado geral; a inspeção técnica decide **Aprovada** → armazenagem ou **Recusada** (`RECUSADA`, com motivo livre e cargo responsável) |
| 3 | **Armazenagem** | `ARMAZENAGEM` | — | a carga fica em estoque no pátio |
| 4 | **Vinculação** | *(sem estado próprio)* | Supervisor / Planejador | a carga é alocada a um contêiner e o contêiner a um navio. É registrado, mas **não** constitui estado separado (não-requisito 15) |
| 5 | **Pronta para Entrega** | `PRONTA_PARA_ENTREGA` | Arrumador e Consertador | a mercadoria fica aguardando a liberação do Supervisor |
| 6 | **Saída do Porto** | `SAIDA` | Supervisor | libera o navio; a liberação implica **automaticamente** liberar todos os contêineres e cargas vinculados, registrando data, hora e destino. Cada carga mantém seu **porto de descarga** individual |
| 7 | **Em Trânsito** | `EM_TRANSITO` | — | a carga está fora do porto em direção ao destino |
| 8 | **Entregue** | `ENTREGUE` | Supervisor / sistema | quando o navio tem localização `NO_PORTO_DE_DESTINO` ou por confirmação do Supervisor |

**Transição de cancelamento:** `CANCELADA`, permitida pelo Supervisor apenas a partir de
`AGENDAMENTO`, `ARMAZENAGEM` ou `PRONTA_PARA_ENTREGA` (RN 16), **sempre com motivo obrigatório**.

---

## 2. Diagrama de estados

```text
                    ┌──────────────┐
                    │ AGENDAMENTO  │  (RF 6.1 — sem agendamento não há aceitação)
                    └──────┬───────┘
                           │ chegada + recebimento físico (Conferente)
                           ▼
                 ┌──────────────────────┐
                 │ RECEBIMENTO_INSPECAO │  checklist do Inspetor (RF 9 / RN 14)
                 └───┬──────────────┬───┘
      aprovada       │              │  recusada (motivo obrigatório)
                     ▼              ▼
              ┌─────────────┐   ┌───────────┐
              │ ARMAZENAGEM │   │ RECUSADA  │  sem gestão de destino (não-req. 9)
              └──────┬──────┘   └───────────┘
                     │ vínculo carga → contêiner → navio (sem estado próprio)
                     ▼
        ┌────────────────────────┐
        │ PRONTA_PARA_ENTREGA    │  Arrumador e Consertador
        └───────────┬────────────┘
                    │ liberação do Supervisor (libera navio + contêineres + cargas)
                    ▼
              ┌───────────┐
              │   SAIDA   │  data/hora e destino registrados
              └─────┬─────┘
                    ▼
             ┌─────────────┐
             │ EM_TRANSITO │
             └──────┬──────┘
                    │ NO_PORTO_DE_DESTINO ou confirmação do Supervisor
                    ▼
              ┌───────────┐
              │ ENTREGUE  │
              └───────────┘

  CANCELADA  ← a partir de AGENDAMENTO, ARMAZENAGEM ou PRONTA_PARA_ENTREGA (motivo obrigatório)
```

O RF 18.3 pede exatamente este diagrama como artefato de modelagem (máquina de estados UML); a versão
acima é o conteúdo normativo que ele deve representar.

---

## 3. Cores e badges dos estados

Especificado em `SPECs/design/design.md`, seção 4.1: fundo = cor a 12%, texto = cor sólida, `radius: 999px`,
Inter 600 12px, padding `4px 10px`, sempre em caixa normal (ex.: `Armazenado`).

| Status | Cor | Lógica |
| --- | --- | --- |
| <span className="nexus-badge nexus-badge--info">Agendado</span> | info `#445987` | aguardando chegada ao porto |
| <span className="nexus-badge nexus-badge--neutro">Recebido</span> | `#1E293B` | recebimento físico lançado pelo Conferente |
| <span className="nexus-badge nexus-badge--warning">Em inspeção</span> | warning `#D97706` | Inspetor preenchendo o checklist |
| <span className="nexus-badge nexus-badge--danger">Recusado</span> | danger `#C62828` | com motivo obrigatório; sem gestão de destino |
| <span className="nexus-badge nexus-badge--neutro">Armazenado</span> | fundo `#E1E5ED`, texto `#1E293B` | em estoque no pátio |
| <span className="nexus-badge nexus-badge--destaque">Pronto para entrega</span> | `#1E293B` sólido, texto branco | aguardando liberação do Supervisor |
| <span className="nexus-badge nexus-badge--success">Liberado / Saída do porto</span> | success `#2E7D32` | navio liberado; data/hora e destino registrados |
| <span className="nexus-badge nexus-badge--warning">Em trânsito</span> | warning `#D97706` | fora do porto em direção ao destino |
| <span className="nexus-badge nexus-badge--success">Entregue</span> | success `#2E7D32` | `NO_PORTO_DE_DESTINO` ou confirmação do Supervisor |
| <span className="nexus-badge nexus-badge--danger">Cancelado</span> | danger `#C62828` | com motivo; só a partir de Agendado, Armazenado ou Pronto para entrega |

:::note Vínculos não geram badge
Os estados transitórios de vinculação (carga → contêiner → navio) **não** viram badge de status: aparecem
como uma **linha de vínculo** na ficha da carga (não-requisito 15).
:::

---

## 4. Estados de navio e contêiner

| Estado | Cor | Efeito |
| --- | --- | --- |
| `OPERANTE` | success `#2E7D32` | opera normalmente |
| `APROVADO_PARA_REFORMA` | info `#445987` | reforma aprovada, ainda operando |
| `AGENDADO_PARA_REFORMA` | warning `#D97706` | **não** pode receber carga, sair do porto nem ser liberado (RN 2) |
| `EM_REFORMA` | warning-strong `#B45309` | não pode receber carga (RN 1) e não contém cargas |

Navio em reforma ou agendado exibe o selo discreto **"Não pode receber carga"** na ficha. Guindastes usam
`OPERANTE` / `EM_MANUTENCAO`.

### Localização do navio (RF 8)

| Valor | Cor | Significado |
| --- | --- | --- |
| `DENTRO_DO_PORTO` | success `#2E7D32` | atracado/no terminal |
| `FORA_DO_PORTO` | info `#445987` | em viagem |
| `NO_PORTO_DE_DESTINO` | success escuro `#1B5E20` | chegou ao destino |

Exibida com ícone de âncora e coordenadas em monoespaçada (`-23.9812°, -46.2978°`), **sem mapa**
(não-requisito 3).

---

## 5. Estados do processo de inspeção e manutenção

| Enum | Valores | Onde aparece |
| --- | --- | --- |
| `resultado_inspecao_enum` | `PENDENTE`, `APROVADA`, `RECUSADA` | `inspecoes.resultado` |
| `status_manutencao_enum` | `SOLICITADA`, `APROVADA`, `RECUSADA`, `CONCLUIDA` | `manutencoes.status` |
| `estado_carregamento_enum` | `EM_CARREGAMENTO`, `PARADO`, `CONCLUIDO` | registro de movimentação do Estivador |
| `estado_guindaste_enum` | `OPERANTE`, `EM_MANUTENCAO` | `guindastes.estado` |

---

## 6. Regras de transição aplicadas no código

```text
PERMITIDO
  AGENDAMENTO            → RECEBIMENTO_INSPECAO | CANCELADA
  RECEBIMENTO_INSPECAO    → ARMAZENAGEM (aprovada) | RECUSADA (recusada)
  ARMAZENAGEM             → PRONTA_PARA_ENTREGA | CANCELADA
  PRONTA_PARA_ENTREGA     → SAIDA | CANCELADA
  SAIDA                   → EM_TRANSITO
  EM_TRANSITO             → ENTREGUE
  RECUSADA / ENTREGUE / CANCELADA → (fim do fluxo)

BLOQUEADO
  RECEBIMENTO_INSPECAO sem agendamento prévio        (RF 6.1)
  SAIDA sem rota cadastrada                          (RN 9)
  SAIDA sem permissão LIBERAR_NAVIO/LIBERAR_CARGA    (RN 3)
  CANCELADA fora de AGENDAMENTO/ARMAZENAGEM/PRONTA   (RN 16)
  CANCELADA sem motivo                               (RF 6 — transição de cancelamento)
  Aprovação com item crítico não conforme            (RN 14)
```

Essas pré-condições são verificadas **antes** de pedir confirmação ao operador e **de novo** na execução —
tanto na interface quanto nas ferramentas WebMCP correspondentes
(`agendar_carga`, `receber_carga`, `movimentar_carga`, `marcar_pronta_entrega`, `vincular_carga_container`,
`liberar_carga_saida`, `cancelar_entrega`). Ver
[Catálogo de ferramentas WebMCP](/arquitetura/webmcp-ferramentas).
