---
id: tarefas
title: Tarefas e fases
sidebar_label: Tarefas e fases
description: As 9 fases e as 90 tarefas da decomposição do projeto (SPECs/tasks.md), com dependências críticas e onde cada uma está no código.
---

# Tarefas e fases

`SPECs/tasks.md` decompõe o projeto em **9 fases** e **90 tarefas** (`T1.1` … `T9.10`), todas marcadas como
concluídas. É o documento que responde *"o que precisa existir para o sistema estar pronto"*.

| Fase | Tema | Tarefas | Códigos |
| --- | --- | --- | --- |
| 1 | Autenticação e controle de acesso | 8 | `T1.1`–`T1.8` |
| 2 | Cadastros base (CRUDs) | 10 | `T2.1`–`T2.10` |
| 3 | Fluxo de cargas (*core business*) | 24 | `T3.1`–`T3.24` |
| 4 | Manutenções e emergências | 6 | `T4.1`–`T4.6` |
| 5 | QR Code e etiquetas | 9 | `T5.1`–`T5.9` |
| 6 | Dashboards, pesquisa e relatórios | 10 | `T6.1`–`T6.10` |
| 7 | Logs, trail e auditoria | 9 | `T7.1`–`T7.9` |
| 8 | Localização e tempos | 6 | `T8.1`–`T8.6` |
| 9 | Testes, integração e implantação | 8 | `T9.1`–`T9.10` (sem `T9.7`/`T9.8`) |

---

## Fase 1 — Autenticação e controle de acesso

| Tarefa | Entrega |
| --- | --- |
| `T1.1` | tela de login com **código individual** vinculado à matrícula |
| `T1.2` | cargo carregado automaticamente e exibido para confirmação |
| `T1.3` | *guard* de autenticação validando código ativo |
| `T1.4` | **Visão Própria** — filtro automático pelos dados do funcionário |
| `T1.5` | **Visão Operacional** — tudo exceto documentação interna de pessoas |
| `T1.6` | **Visão Estratégica** — leitura total + dashboards exclusivos + exportação |
| `T1.7` | controle de acesso por cargo (8 cargos citados na especificação) |
| `T1.8` | Técnico em Portos invalida código perdido e gera novo para a mesma matrícula |

Onde está: `js/auth-guard.js`, `js/session-cookies.js`, `js/vision-layer.js`, `index.html`,
`confirm-role.html`. Ver [Cargos e permissões](/dominio/cargos-e-permissoes).

---

## Fase 2 — Cadastros base

| Grupo | Tarefas | Responsável (spec) |
| --- | --- | --- |
| Funcionários e visitantes | `T2.1`, `T2.2` | Técnico em Portos |
| Tipos de carga e rotas | `T2.3`, `T2.4` | Supervisor |
| Navios, contêineres, guindastes | `T2.5`, `T2.6`, `T2.7` | Inspetor (cadastro inicial) |
| Atualizações operacionais | `T2.8`, `T2.9`, `T2.10` | Planejador / Supervisor |

Destaque de `T2.6`: a **referência de tempo de uso** do contêiner (data de fabricação **ou** data da última
manutenção) é definida pelo **Supervisor** e virou o enum `referencia_tempo_enum`.

Onde está: `tecnico_portos.html`, `embarcacoes.html`, `manutencao.html` + `js/pages/*`.

---

## Fase 3 — Fluxo de cargas (24 tarefas)

| Sub-fase | Tarefas | Conteúdo |
| --- | --- | --- |
| 3.1 Cadastro e agendamento | `T3.1`–`T3.5` | atributos obrigatórios, exigência de tipo com checklist, recusa de carga sem agendamento, QR de carga e de contêiner |
| 3.2 Recebimento e inspeção | `T3.6`–`T3.10` | recebimento físico, checklist dinâmico, **todos os itens críticos conformes**, caminhos de aprovação e recusa |
| 3.3 Armazenagem e vinculação | `T3.11`–`T3.13` | status de armazenagem, vínculo carga → contêiner → navio, bloqueio de navio em reforma |
| 3.4 Preparação e liberação | `T3.14`–`T3.19` | pronta para entrega, liberação individual e de navio, registro de destino, **ETA = distância ÷ 33 km/h**, bloqueio sem rota cadastrada |
| 3.5 Trânsito e entrega | `T3.20`–`T3.22` | `EM_TRANSITO`, `ENTREGUE` por localização ou confirmação, propagação automática em cascata |
| 3.6 Cancelamento | `T3.23`, `T3.24` | cancelamento só em Agendamento/Armazenagem/Pronta para Entrega, com motivo obrigatório |

É a fase mais densa e a que mais gerou testes (`test:cargas-loop`, `test:single-flight`, `test:bercos`, entre
outros). Ver [Fluxo da carga](/dominio/fluxo-da-carga).

---

## Fase 4 — Manutenções e emergências

| Tarefa | Entrega |
| --- | --- |
| `T4.1` | estados de navio/contêiner: Operante, Agendado para reforma, Em reforma, Aprovado para reforma |
| `T4.2` | solicitação de manutenção (Supervisor) |
| `T4.3` | aprovação e recusa de manutenções |
| `T4.4` | histórico de manutenções de navios, contêineres e guindastes |
| `T4.5` | coordenação de emergências e acionamento de alarmes |
| `T4.6` | **manutenção preventiva** sugerida em ciclos de 3 anos |

Onde está: `manutencao.html`, `js/panic-realtime.js`, `supabase/functions/panic-alert`, tabela `emergencias`.

---

## Fase 5 — QR Code e etiquetas

| Tarefa | Entrega |
| --- | --- |
| `T5.1`–`T5.2` | QR único no cadastro (carga e contêiner) + exibição em tempo real |
| `T5.3`–`T5.5` | etiqueta PDF 10×10/10×15 cm, botão "Imprimir Etiqueta" e reimpressão sem novo código |
| `T5.6`–`T5.9` | leitura pela câmera do navegador, redirecionamento por cargo, registro no log e **autenticação obrigatória** |

Detalhes em [QR Code e etiquetas](/operacao/qr-code-e-etiquetas).

---

## Fase 6 — Dashboards, pesquisa e relatórios

| Tarefa | Entrega |
| --- | --- |
| `T6.1`–`T6.4` | cards operacionais (navios em manutenção, cargas em armazenagem, ocupação do pátio, preventiva sugerida), acesso de Supervisor/Inspetor e superiores, card → detalhe, atualização periódica |
| `T6.5`–`T6.6` | dashboards estratégicos (aprovação/recusa, permanência média, navios mais usados, produtividade por cargo) e exportação |
| `T6.7` | pesquisa com cinco filtros (navio, contêiner, tipo de carga, período, status) |
| `T6.8`–`T6.10` | PDF A4 em 4 seções, relatório de produtividade e acesso restrito (Diretor, Inspetor e o próprio funcionário) |

Onde está: `dashboard.html`, `relatorios.html`, `js/charts.js` (2052 linhas), Edge `relatorio-pdf` e
`kpis-calculo`.

---

## Fase 7 — Logs, trail e auditoria

| Tarefa | Entrega |
| --- | --- |
| `T7.1`–`T7.2` | log automático de alterações (quem, quando, o quê) e tela de consulta |
| `T7.3` | **trail de decisões** críticas — 8 decisões nomeadas na especificação |
| `T7.4`–`T7.5` | retificação vinculada ao registro original e tela do trail |
| `T7.6`–`T7.9` | delegação de supervisor: designação, vigência, **um substituto ativo** e revogação |

Onde está: tabelas `logs_alteracoes`, `trail_decisoes`, `retificacoes_trail`,
`js/delegacao.html`/`js/pages/delegacao.js`.

---

## Fase 8 — Localização e tempos

| Tarefa | Entrega |
| --- | --- |
| `T8.1`–`T8.3` | coordenadas GPS fictícias, classificação `DENTRO`/`NO_PORTO_DE_DESTINO`/`FORA` e ETA pela rota |
| `T8.4`–`T8.6` | permanência da carga no porto, tempo de carga fora do porto e tempo total do navio fora |

Onde está: `js/pages/embarcacoes.js`, `despacho-embarcacao`, `kpis-calculo`.

---

## Fase 9 — Testes, integração e implantação

| Tarefa | Entrega | Estado |
| --- | --- | --- |
| `T9.1`–`T9.5` | unitários de regra de negócio, integração do fluxo completo, segurança, QR Code e PDF | ✅ 47 suítes Node + 15 verificadores Python |
| `T9.6` | manual de usuário por cargo | ✅ `about.html` (documentação ilustrada) |
| `T9.7`, `T9.8` | *(não existem na lista)* | — |
| `T9.9` | ambiente de produção interno, sem clientes externos | ✅ GitHub Pages/Vercel |
| `T9.10` | treinamento por perfil de cargo | ✅ material ilustrado |

---

## Dependências críticas

```text
T1.x (Autenticação) ──▶ T2.x (Cadastros base)
                            │
                            ▼
        T2.3 (Tipo de Carga) ──▶ T3.2 (Agendamento) ──▶ T3.x (Fluxo de Cargas)
                            │
                            ▼
   T2.5 (Navio) + T2.6 (Contêiner) ──▶ T3.12 (Vinculação) ──▶ T3.16 (Liberação)
                            │
                            ▼
              T3.1 (Carga) ──▶ T5.1 (QR Code) ──▶ T5.6 (Leitura QR)
                            │
                            ▼
            T7.1 (Log) + T7.3 (Trail) ──▶ T9.2 (Testes de integração)
```

:::tip Como usar esta página
Para saber **onde** uma tarefa está implementada, comece pela página de arquitetura correspondente
([Páginas](/arquitetura/paginas), [Módulos JavaScript](/arquitetura/modulos-javascript),
[Tabelas](/banco-de-dados/tabelas)) e use `Ctrl+F` pelo código da tarefa nos arquivos citados.
:::
