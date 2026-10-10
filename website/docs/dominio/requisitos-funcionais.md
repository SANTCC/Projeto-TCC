---
id: requisitos-funcionais
title: Requisitos funcionais (RF 1–18)
sidebar_label: Requisitos funcionais
description: Os 18 requisitos funcionais da especificação, com o que cada um exige e onde está implementado no sistema.
---

# Requisitos funcionais (RF 1–18)

Transcrição organizada de `SPECs/Spec.md`, com a indicação de onde cada requisito está implementado. A
especificação é normativa; esta página é o mapa entre requisito → código → tela → tabela.

| RF | Assunto | Tela principal | Módulos |
| --- | --- | --- | --- |
| 1 | Acesso e permissões por cargo | `index.html`, `confirm-role.html` | `auth-guard.js`, `session-cookies.js`, `vision-layer.js` |
| 2 | Cadastro de navios, contêineres, cargas, rotas, tipos de carga e guindastes | `cargas.html`, `embarcacoes.html` | `pages/cargas.js`, `pages/embarcacoes.js`, `pages/tipos-carga.js` |
| 3 | Estados de navios, contêineres e manutenções | `embarcacoes.html`, `manutencao.html` | `pages/embarcacoes.js`, `pages/manutencao.js` |
| 4 | Tempo de carga e estimativas | `embarcacoes.html`, `dashboard.html` | `pages/embarcacoes.js`, `pages/charts.js` |
| 5 | Tempo do navio fora do porto | `embarcacoes.html` | `pages/embarcacoes.js` |
| 6 | Fluxo de cargas (8 etapas) | `cargas.html` | `pages/cargas.js` |
| 7 | Dashboards e indicadores | `dashboard.html` | `pages/dashboard.js`, `pages/charts.js` |
| 8 | Localização dos navios (GPS fictício) | `embarcacoes.html` | `pages/embarcacoes.js` |
| 9 | Checklist de carga | `inspecao.html` | `pages/inspecao.js` |
| 10 | Sistema de pesquisa (5 filtros) | `relatorios.html` | `pages/relatorios.js` |
| 11 | Relatório PDF A4 em 4 seções | `relatorios.html` (servidor) | Edge Function `relatorio-pdf` |
| 12 | Log de alterações | `dashboard.html` (aba de auditoria) | `data-repository.js` |
| 13 | Trail de decisões críticas | `dashboard.html` | `pages/dashboard.js` |
| 14 | Delegação de Supervisor | `delegacao.html` | `pages/delegacao.js` |
| 15 | Gestão de pessoas no porto | `tecnico_portos.html` | `pages/tecnico_portos.js` |
| 16 | Relatório de produtividade | `dashboard.html`, `relatorios.html` | `pages/charts.js` |
| 17 | QR Code na carga e no contêiner | `cargas.html`, `scanner.html` | `pages/cargas.js`, `pages/scanner.js`, `vision-layer.js` |
| 18 | Artefatos de modelagem e documentação visual | `about.html`, esta documentação | `tools/screenshots/`, `website/` |

---

## RF 1 — Sistema de acesso e permissões por cargo

- Login pelo **código individual único** vinculado à matrícula; o cargo é carregado automaticamente e
  apresentado apenas para **confirmação** (não é selecionável).
- Três camadas de visão: **Própria** (todos), **Operacional** (Inspetor e Supervisor), **Estratégica**
  (Diretores e Conselho).
- Hierarquia em quatro níveis (Estratégico, Tático, Gestão, Operacional).
- Ações detalhadas por cargo — ver [Cargos e permissões](/dominio/cargos-e-permissoes).

**Implementação:** `js/pages/login.js`, `js/pages/confirm-role.js`, `js/auth-guard.js` (matrizes
`PAGE_PERMISSIONS` e `ACTION_PERMISSIONS`), `js/vision-layer.js`, `js/session-cookies.js`.

## RF 2 — Cadastro e gestão de entidades

| Entidade | Campos exigidos | Quem cadastra | Quem atualiza |
| --- | --- | --- | --- |
| **Navios** | nome, IMO, data de registro, quantidade de cargas realizadas, estado, coordenadas, tempo fora do porto, porto de origem e destino | Inspetor | Planejador (dados operacionais) |
| **Contêineres** | número, tipo de carga vinculada, material, data de fabricação, última manutenção, tempo de uso, estado, navio vinculado | Inspetor | Planejador |
| **Cargas** | tipo, quantidade, material, peso, volume, valor declarado, natureza, data de entrada, data de saída, destino, **porto de descarga**, status, contêiner, checklist, motivo de recusa | Conferente/Supervisor no fluxo | cargos conforme a etapa |
| **Rotas marítimas** | origem, destino, distância fixa | Supervisor | — |
| **Tipos de carga** | nome, categoria de risco, requisitos especiais, modelo de checklist | Supervisor | — |
| **Guindastes** | número, estado, data da última manutenção | Inspetor | Supervisor (solicita manutenção) |

O sistema mantém **histórico de manutenções** de navios, contêineres e guindastes com data e descrição dos
serviços, inseridos manualmente pelo responsável (`historico_manutencoes`).

## RF 3 — Estados de navios, contêineres e manutenções

Estados: `OPERANTE`, `AGENDADO_PARA_REFORMA`, `EM_REFORMA`, `APROVADO_PARA_REFORMA` (navios e
contêineres) e `OPERANTE` / `EM_MANUTENCAO` (guindastes). O Inspetor registra o estado atual do navio,
visível aos Supervisores; **somente o Supervisor aprova manutenções**.

## RF 4 — Tempo de carga e estimativas

O sistema calcula e exibe: tempo que a carga permanece no porto; tempo que a carga está fora do porto para
entrega; estimativa de tempo até a chegada ao destino final (distância da rota ÷ 33 km/h — RN 9).

## RF 5 — Tempo do navio fora do porto

Registro e cálculo do tempo total em que o navio permanece fora do porto, com base nas mudanças de
localização (`DENTRO_DO_PORTO` → `FORA_DO_PORTO` → `NO_PORTO_DE_DESTINO`).

## RF 6 — Fluxo de cargas

Oito etapas: **Agendamento → Recebimento/Inspeção → Armazenagem → Vinculação → Pronta para Entrega →
Saída do Porto → Em Trânsito → Entregue**, com os caminhos alternativos **Recusada** e **Cancelada**.
Cargas sem agendamento prévio têm a aceitação negada na chegada. O detalhamento das transições está em
[Fluxo da carga](/dominio/fluxo-da-carga).

## RF 7 — Dashboards e indicadores

Cards (ícone, título, quantidade) para Supervisores e cargos superiores, como **visão geral operacional**
(não é painel de alarmes). Indicadores: navios em manutenção; navios fora do porto; cargas em armazenagem;
cargas prontas para entrega aguardando liberação; cargas recusadas; ocupação do pátio; navios com
manutenção preventiva sugerida (> 3 anos). Clicar em um card abre a página de detalhe. Atualização diária
ou por hora.

## RF 8 — Localização dos navios

Coordenadas GPS marítimo **fictícias**, classificadas como `DENTRO_DO_PORTO`, `FORA_DO_PORTO` ou
`NO_PORTO_DE_DESTINO`. A finalidade é registrar posição e calcular ETA — não há mapeamento visual nem
rastreamento em tempo real (não-requisito 3 e 8).

## RF 9 — Checklist de carga

O modelo de checklist é criado pelo **Supervisor** para cada tipo de carga na primeira vez que este for
processado; nas próximas, o sistema sugere o mesmo modelo. O **Inspetor** usa o checklist na inspeção.
O Inspetor só pode aprovar se **todos os itens críticos** estiverem "Conforme"; itens não críticos podem
gerar observação sem bloqueio (RN 14).

## RF 10 — Sistema de pesquisa

Cinco filtros, exatamente: **nome do navio**, **número do contêiner**, **tipo de carga**, **período
(data inicial–final)** e **status do fluxo**. Sem filtros avançados adicionais (não-requisito 14).

## RF 11 — Geração de relatório PDF

PDF em **A4**, com quatro seções sequenciais: 1) Dados da Carga; 2) Dados do Navio (nome, IMO, origem,
destino); 3) Dados do Contêiner; 4) Resumo do Fluxo (status, datas de entrada/saída, porto de descarga,
motivo de recusa). O funcionário gera o documento e o repassa externamente — o cliente **não** acessa o
sistema. Implementado **no servidor** (Edge Function `relatorio-pdf`) com cache em Storage.

## RF 12 — Log de alterações

Registro com **cargo e código individual** do responsável, exibindo data/hora, cargo, código, entidade
alterada e tipo (criação, edição, exclusão — e `EXPORTACAO` para exportações auditadas).

## RF 13 — Trail de decisões críticas

Registro detalhado e **imutável** das decisões de alto impacto. O autor pode **anexar uma retificação**
enquanto a entidade não avançou de estado, mas o registro original permanece inalterado.

Decisões padronizadas:

| Cargo | Decisões |
| --- | --- |
| Inspetor | Aprovou Carga · Recusou Carga · Solicitou Manutenção de Navio/Contêiner |
| Supervisor | Liberou Navio · Cancelou Entrega · Aprovou Manutenção · Recusou Manutenção · Designou Substituto |

O trail é consultado em página separada do sistema e **complementa** o log geral.

## RF 14 — Delegação de Supervisor

Um Supervisor oficial designa um substituto temporário com os **mesmos poderes de liberação**, registrando
o período de vigência. Um substituto ativo por vez; revogação a qualquer momento antes do fim da vigência,
encerrando os poderes imediatamente.

## RF 15 — Gestão de pessoas no porto

O **Técnico em Portos** é responsável por: cadastro de funcionários (dados pessoais, cargo, código
individual, documentação interna) e cadastro de visitantes (nome, documento, motivo, data/hora de entrada).
As duas entidades são mantidas **separadas**.

## RF 16 — Relatório de produtividade

Relatório interno por cargo e funcionário, com volume de operações (quantas cargas cada Conferente
processou, quantas inspeções cada Inspetor realizou). Acessível ao **Diretor**, ao **Inspetor** e ao
**próprio funcionário** (vendo apenas seus dados).

## RF 17 — QR Code na carga e no contêiner

| Sub-requisito | Exigência |
| --- | --- |
| 17.1 Geração | QR Code único gerado automaticamente no **primeiro cadastro** de cada carga e de cada contêiner; a tela de confirmação exibe o QR em tempo real, vinculado ao identificador no banco |
| 17.2 Impressão | botão **"Imprimir Etiqueta"** em PDF padronizado (10×10 cm ou 10×15 cm), com QR centralizado, número da carga/contêiner em texto legível e, opcionalmente, tipo de carga e data de recebimento; impressão em impressora térmica; **reimpressão** registrada no log |
| 17.3 Leitura no pátio | leitura pela **câmera do dispositivo** (celular/tablet); ao escanear, o sistema abre **diretamente a tela da entidade**, sem digitação; exemplos por cargo: Estivador (início/fim da movimentação), Conferente (recebimento/condições de saída), Inspetor (abre o checklist), Arrumador (muda para pronta para entrega), Supervisor (vê as cargas do contêiner) |
| 17.4 Segurança | a URL do QR exige **autenticação**; cada leitura é registrada com código do funcionário, data/hora e entidade; cada carga e cada contêiner têm QR independente, mantendo o vínculo lógico sem juntar as etiquetas físicas |

## RF 18 — Artefatos de modelagem e documentação visual

1. **Diagrama de casos de uso (UML)** — atores (cargos) e suas interações;
2. **Diagrama de classes (UML)** — entidades e relacionamentos;
3. **Diagrama de estados da carga** — as 8 etapas com aprovação, recusa e cancelamento;
4. **Protótipos de tela (wireframes)** — login, dashboard por cargo, formulários de cadastro, inspeção
   com checklist, liberação pelo Supervisor, consulta da trilha e **tela de etiqueta com QR Code**.

Os protótipos visuais desta entrega estão em `THEME/` e descritos em
[Protótipos visuais](/design/prototipos-theme); a documentação ilustrada é o `about.html`
([página dedicada](/operacao/documentacao-ilustrada)) e este site.
