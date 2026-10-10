---
id: regras-de-negocio
title: Regras de negócio (RN 1–19)
sidebar_label: Regras de negócio
description: As 19 regras de negócio do sistema, onde cada uma é aplicada e os 17 não-requisitos do escopo.
---

# Regras de negócio (RN 1–19)

> Fonte: `SPECs/Spec.md`. Cada regra traz **onde é aplicada** no código e **como é verificada** pelos testes.

| RN | Regra | Aplicação | Verificação |
| --- | --- | --- | --- |
| 1 | Navio em reforma não pode receber carga | `pages/cargas.js`, `pages/embarcacoes.js`, WebMCP `vincular_carga_container` | `test_bercos_vinculo.js`, `test_webmcp_paginas.js` |
| 2 | Navio agendado para reforma não pode receber carga, sair do porto nem ser liberado até concluir a reforma | `pages/embarcacoes.js`, `pages/cargas.js` | `test_webmcp_paginas.js` |
| 3 | Só o Supervisor permite saída de carga e liberação de navio; liberar o navio libera **todos** os contêineres e cargas vinculados | `pages/cargas.js`, `pages/embarcacoes.js`, Edge `despacho-embarcacao` | `test_edge_functions.js`, `test_webmcp_paginas.js` |
| 4 | A carga pode estar em armazenagem e em um contêiner simultaneamente | `pages/cargas.js` (não bloqueia o vínculo) | `test_fase_*.js` |
| 5 | Um contêiner tem apenas um tipo de carga | `pages/embarcacoes.js`, `pages/cargas.js` | `test_webmcp_paginas.js` |
| 6 | O navio carrega apenas contêineres | modelo de dados (`containers.navio_id`) | `schema.sql` / `TABLES.md` |
| 7 | Tempo de uso do contêiner medido desde a **data de fabricação** ou da **última manutenção**, conforme indicação do Supervisor (`referencia_tempo_enum`) | `containers.referencia_tempo`, `pages/embarcacoes.js` | `test_charts_*.js` |
| 8 | Localização do navio é `DENTRO_DO_PORTO`, `FORA_DO_PORTO` ou `NO_PORTO_DE_DESTINO` | `localizacao_navio_enum`, `pages/embarcacoes.js` | `test_enum_emergencia.js` (enums), painel |
| 9 | ETA = distância da rota ÷ **33 km/h**; sem rota cadastrada, a liberação do navio é **bloqueada** até o Supervisor cadastrá-la | `pages/embarcacoes.js`, Edge `despacho-embarcacao` | `test_edge_functions.js` |
| 10 | A fiscalização é do Supervisor; não exige assinatura digital nem imutabilidade de logs gerais | `logs_alteracoes` (append-only por política) | `SPECs/schema.sql` (RLS) |
| 11 | Preventivas sugeridas em ciclos de **3 em 3 anos**, contados da data de cadastro do navio e, depois, da última manutenção | `pages/manutencao.js`, `pages/dashboard.js` | `test_charts_autorefresh.js` |
| 12 | Estado/localização de navio ou contêiner **propaga** para as cargas vinculadas; alterações cadastrais não propagam; em manutenção não há cargas dentro | gatilho de cascata em `SPECs/schema.sql` | `test_bercos_vinculo.js`, verificação SQL |
| 13 | Atributos obrigatórios da carga: peso, volume, valor declarado, natureza, tipo e porto de descarga | `pages/cargas.js` (formulário), `cargas` (constraints) | `test_cargas_request_control.js` |
| 14 | Checklist é criado pelo Supervisor e usado pelo Inspetor; aprovação exige **100% dos itens críticos** conformes | `pages/inspecao.js`, WebMCP `inspecionar_carga` | `test_webmcp_paginas.js` |
| 15 | Todo acesso exige código individual vinculado ao cargo; em caso de perda, o Técnico invalida o código anterior e gera um novo para a mesma matrícula | `pages/tecnico_portos.js`, `session-cookies.js` | `test_backlog3_*.js` |
| 16 | Cancelamento de entrega só em `Agendado`, `Armazenado` ou `Pronto para entrega` | `pages/cargas.js` (pré-condição), WebMCP `cancelar_entrega` | `test_webmcp_paginas.js` |
| 17 | QR Code é gerado **automaticamente e unicamente** no primeiro cadastro; não pode ser alterado nem reutilizado; a leitura fica dentro do sistema, na mesma página da área de checklist | `pages/cargas.js` (`qrcode.js`), `leituras_qr_code` | `test_gravacao_inspecao_login.js` |
| 18 | Reimpressão **não** gera novo código: reproduz a mesma etiqueta e registra a ação no log | `pages/cargas.js` | `test_about_page.js` (catálogo), `test_webmcp_paginas.js` |
| 19 | Leitura de QR exige dispositivo **autenticado**; leituras externas ou de usuários não logados são negadas | `pages/scanner.js`, `auth-guard.js` | `test_webmcp_paginas.js`, `test_gravacao_inspecao_login.js` |

---

## Detalhamento das regras com maior impacto no código

### RN 3 + RN 9 — Liberação de navio em cascata

Liberar um navio (`LIBERAR_NAVIO`) dispara, em uma única operação:

1. verificação de **rota cadastrada** entre porto de origem e destino (senão bloqueia);
2. cálculo do ETA pela distância ÷ 33 km/h;
3. transição do navio e de **todos** os contêineres e cargas vinculados para o estado de saída;
4. registro na trilha de decisões e no log de alterações;
5. modal de confirmação informando o impacto exato (ex.: *"Esta ação libera automaticamente 12 cargas vinculadas"*).

```javascript title="Pré-condições verificadas antes de liberar (visão de alto nível)"
// js/pages/cargas.js — liberação de carga/navio
if (!NexusAuth.hasPermission('LIBERAR_NAVIO')) return negar('PERMISSAO_NEGADA');
if (navio.estado === 'AGENDADO_PARA_REFORMA' || navio.estado === 'EM_REFORMA')
  return negar('ESTADO_INVALIDO');                       // RN 1 e RN 2
if (!rotaExiste(navio.porto_origem, navio.porto_destino))
  return negar('ROTA_NAO_CADASTRADA');                   // RN 9
// após confirmação do operador → cascata para cargas e contêineres (RN 3)
```

### RN 12 — Propagação em cascata

O gatilho SQL em `SPECs/schema.sql` (seção 12) garante que, quando o **estado operacional** ou a
**localização** de um navio/contêiner muda, as cargas vinculadas refletem a mudança automaticamente.
Alterações de **nome** ou de dados cadastrais **não** propagam. Quando um contêiner ou navio entra em
manutenção, não há cargas dentro dele.

### RN 14 — Aprovação condicionada a itens críticos

A barra de progresso do checklist mostra o percentual respondido e o botão **Aprovar carga** só habilita
quando **todos os itens críticos** estão `Conforme`. Itens não críticos podem ficar não conformes com
observação, sem bloquear a aprovação. A recusa exige motivo em texto livre.

### RN 17 e RN 18 — QR Code único

- Gerado **uma única vez**, no primeiro cadastro da carga/contêiner;
- Nunca reutilizado em outra entidade (constraint e verificação na tela);
- A reimpressão reaproveita o mesmo payload e grava *"Reimpressão de etiqueta"* no log;
- O payload é uma URL interna (`porto.interno/carga?id=…`) ou o identificador cru da entidade.

---

## Não-requisitos (escopo negativo)

Os 17 não-requisitos da especificação — úteis para argumentar em banca que uma funcionalidade **não** é
falta:

1. Sem cálculos ou alertas sobre atrasos de entrada/chegada/saída — apenas registro de datas e horas;
2. Sem integração com sistemas legados;
3. Sem mapa visual ou interativo — localização por coordenadas e texto;
4. Armazenamento de cargas = guardar dados em histórico digital;
5. Sem sistema de notificações, alertas ou comunicação instantânea entre usuários;
6. A espera para entrar/sair do navio não é gerenciada;
7. Sem inspeção técnica periódica obrigatória por lei;
8. Dados de GPS são fictícios, sem integração com rastreamento real;
9. O destino físico da carga recusada após a inspeção não é gerenciado;
10. Sem gestão de substitutos, férias, folgas ou escalas (exceto a delegação de Supervisor);
11. O Supervisor não registra manualmente o andamento dos cargos operacionais — é inferido pelos status;
12. Sem módulo financeiro de contas de gastos e ganhos;
13. Sem controle de lotação máxima, capacidade de peso/quantidade por navio ou vagas de berço;
14. A pesquisa não tem filtros avançados além dos cinco campos do RF 10;
15. Não existe o estado "Embarcada" como etapa separada do fluxo;
16. Sem validações automáticas de compatibilidade de peso/lotação na vinculação;
17. Não exige app nativo para ler QR Code — a leitura é pelo navegador.

:::info Não-requisito 5 na prática
"Sem notificações" não significa "sem retorno visual": todo feedback é um **banner inline** no topo do
conteúdo (fechável, desaparece ao trocar de tela), nunca um toast flutuante persistente. Ver
[Componentes](/design/componentes#mensagens-de-feedback).
:::
