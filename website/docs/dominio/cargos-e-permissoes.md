---
id: cargos-e-permissoes
title: Cargos e permissões (RBAC)
sidebar_label: Cargos e permissões
description: Os 10 cargos, os 4 níveis, as ações por cargo da Spec e as matrizes reais de páginas e ações do sistema.
---

# Cargos e permissões (RBAC)

O controle de acesso do NexusPort é **baseado em cargo** (role-based). Há três pontos de aplicação
complementares:

| Camada | Onde | O que controla |
| --- | --- | --- |
| Navegação e rotas | `PAGE_PERMISSIONS` (`js/auth-guard.js`) | qual `.html` cada cargo pode abrir |
| Ações | `ACTION_PERMISSIONS` (`js/auth-guard.js`, 20 chaves) | botões e operações sensíveis |
| Dados | `js/vision-layer.js` + consultas filtradas + políticas RLS | quais registros cada camada enxerga |

---

## 1. Hierarquia de cargo e nível de acesso

| Cargo (`cargo_enum`) | Nome na interface | Nível (`nivel_acesso_enum`) | Camada de visão |
| --- | --- | --- | --- |
| `ESTIVADOR` | Estivador | `OPERACIONAL` | Própria |
| `CONFERENTE_CARGA` | Conferente de Carga | `OPERACIONAL` | Própria |
| `ARRUMADOR_CONSERTADOR` | Arrumador e Consertador | `OPERACIONAL` | Própria |
| `PLANEJADOR_PATIO_NAVIOS` | Planejador de Pátio e de Navios | `OPERACIONAL` | Própria |
| `TECNICO_PORTOS` | Técnico em Portos | `OPERACIONAL` | Própria |
| `SUPERVISOR_GERENTE_OPERACOES` | Supervisor / Gerente de Operações | `GESTAO` | Operacional |
| `INSPETOR` | Inspetor | `TATICO` | Operacional |
| `DIRETOR_OPERACOES_LOGISTICA` | Diretor de Operações e Logística | `ESTRATEGICO` | Estratégica |
| `DIRETOR_PRESIDENTE_SUPERINTENDENTE` | Diretor-Presidente / Superintendente | `ESTRATEGICO` | Estratégica |
| `CONSELHO_ADMINISTRACAO` | Conselho de Administração | `ESTRATEGICO` | Estratégica |

A tabela `cargo_niveis` guarda o mapeamento cargo → nível, e é populada na carga inicial do schema.
O cargo **nunca** é escolhido pelo usuário: vem do cadastro funcional e é apenas confirmado na tela
`confirm-role.html` (RF 1).

---

## 2. Ações por cargo na Spec (RF 1)

| Cargo | Ações descritas na especificação |
| --- | --- |
| **Estivador** | selecionar a carga que vai movimentar; registrar o estado do carregamento (`EM_CARREGAMENTO`, `PARADO`, `CONCLUIDO`) e identificar o objeto carregado. Vê apenas as cargas que selecionou e seu histórico |
| **Conferente de Carga** | registrar o **recebimento físico** (data/hora, quantidade, estado geral) e as condições na saída |
| **Arrumador e Consertador** | alterar o status da mercadoria para "pronta para entrega" |
| **Planejador de Pátio e de Navios** | registrar estado e informações de contêineres e navios |
| **Técnico em Portos** | cadastrar documentação interna dos funcionários e registrar visitantes temporários |
| **Supervisor / Gerente** | registrar chegada de navios; definir atributos da carga, destino e porto de descarga; solicitar manutenção de navios e guindastes; cancelar entregas com motivo; liberar/bloquear saída de cargas e navios; aprovar manutenções; designar substituto temporário; cadastrar rotas marítimas; cadastrar tipos de carga |
| **Inspetor** | coordenar emergências; cadastrar navios, contêineres e guindastes; realizar a inspeção técnica formal com checklist e decidir aprovação ou recusa; acessar todas as funcionalidades dos cargos operacionais |
| **Diretores e Conselho** | todas as funcionalidades dos cargos inferiores + dashboards exclusivos (taxa de aprovação/recusa, tempo médio de permanência, navios mais utilizados, produtividade por cargo) + exportação de dados históricos |

---

## 3. Matriz real de páginas (`PAGE_PERMISSIONS`)

Esta é a matriz implementada em `js/auth-guard.js` e usada por `NexusAuth.requireAuth()` e
`NexusAuth.canAccessPage()`. Também é o que as ferramentas WebMCP revalidam antes de executar.

| Página | Est | Conf | Arru | Plan | Téc | Sup | Insp | Dir.Op | Dir.Pres | Cons |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `dashboard.html` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `cargas.html` | ✔ | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `inspecao.html` |  |  |  |  |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `scanner.html` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `embarcacoes.html` |  |  |  | ✔ |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `manutencao.html` |  |  |  |  |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `delegacao.html` |  |  |  |  |  | ✔ |  | ✔ | ✔ | ✔ |
| `tecnico_portos.html` |  |  |  |  | ✔ |  |  | ✔ | ✔ | ✔ |
| `relatorios.html` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Páginas fora da matriz (`index.html`, `confirm-role.html`, `about.html`, `teste-vibracao.html`) são de
acesso livre por natureza: login, confirmação de cargo, documentação ilustrada e diagnóstico de vibração.

:::note Cargo sem permissão em uma página
`requireAuth()` mostra um feedback de "Acesso Restrito" e redireciona para `dashboard.html` — nunca deixa
a tela protegida renderizar dados.
:::

---

## 4. Matriz real de ações (`ACTION_PERMISSIONS`)

As 20 chaves de ação e quem pode executá-las (Est = Estivador, Conf = Conferente, Arru = Arrumador,
Plan = Planejador, Téc = Técnico em Portos, Sup = Supervisor, Insp = Inspetor, **D** = os três cargos de
direção/Conselho):

| Ação | Est | Conf | Arru | Plan | Téc | Sup | Insp | D | Regra relacionada |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| `MOVIMENTAR_CARGA` | ✔ |  |  |  |  |  | ✔ | ✔ | RF 1 (Estivador) |
| `REGISTRAR_RECEBIMENTO` |  | ✔ |  |  |  |  | ✔ | ✔ | RF 6.2 |
| `ALTERAR_PRONTA_ENTREGA` |  |  | ✔ |  |  |  | ✔ | ✔ | RF 6.5 |
| `ATUALIZAR_DADOS_NAVIO_CONTAINER` |  |  |  | ✔ |  | ✔ | ✔ | ✔ | RF 2 |
| `CADASTRAR_VISITANTE` |  |  |  |  | ✔ |  |  | ✔ | RF 15 |
| `CADASTRAR_DOCUMENTO_FUNCIONARIO` |  |  |  |  | ✔ |  |  | ✔ | RF 15 / RN 15 |
| `CADASTRAR_NAVIO` |  |  |  |  |  |  | ✔ | ✔ | RF 2 |
| `CADASTRAR_CONTAINER` |  |  |  |  |  |  | ✔ | ✔ | RF 2 |
| `CADASTRAR_GUINDASTE` |  |  |  |  |  |  | ✔ | ✔ | RF 2 |
| `INSPECIONAR_CARGA` |  |  |  |  |  |  | ✔ | ✔ | RF 9 / RN 14 |
| `ACIONAR_EMERGENCIA` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | *(qualquer funcionário autenticado)* |
| `LIBERAR_NAVIO` |  |  |  |  |  | ✔ |  | ✔ | RN 3 / RN 9 |
| `LIBERAR_CARGA` |  |  |  |  |  | ✔ |  | ✔ | RN 3 |
| `CANCELAR_ENTREGA` |  |  |  |  |  | ✔ |  | ✔ | RN 16 |
| `SOLICITAR_MANUTENCAO` |  |  |  |  |  | ✔ | ✔ | ✔ | RF 2 |
| `APROVAR_MANUTENCAO` |  |  |  |  |  | ✔ |  | ✔ | RF 3 |
| `DESIGNAR_SUBSTITUTO` |  |  |  |  |  | ✔ |  | ✔ | RF 14 |
| `CADASTRAR_ROTA` |  |  |  |  |  | ✔ |  | ✔ | RN 9 |
| `CADASTRAR_TIPO_CARGA` |  |  |  |  |  | ✔ |  | ✔ | RF 2 / RN 14 |
| `EXPORTAR_HISTORICO` |  |  |  |  |  |  |  | ✔ | RF 8 (Visão Estratégica) |
| `VER_DASHBOARD_ESTRATEGICO` |  |  |  |  |  |  |  | ✔ | RF 7 / RF 8 |

:::caution Acionamento de emergência é universal
O pânico pode ser acionado por **qualquer funcionário autenticado**, independentemente do cargo — o botão
fica na sidebar de todas as telas. Isso é intencional na matriz (`ACIONAR_EMERGENCIA`).
:::

---

## 5. Elevação temporária: Supervisor Substituto (RF 14)

`NexusAuth.getSession()` aplica a **delegação ativa** lida de `nexus_active_delegation`: se a matrícula da
sessão for a do substituto designado, o cargo efetivo passa a `SUPERVISOR_GERENTE_OPERACOES` com o rótulo
*"Supervisor Substituto (Delegação Ativa)"*. Regras:

- Cada Supervisor tem **um substituto ativo por vez**;
- O substituto ganha os **mesmos poderes de liberação** enquanto a vigência estiver aberta;
- O titular pode **revogar** a qualquer momento antes do fim da vigência, encerrando os poderes
  imediatamente;
- A designação e a revogação entram na trilha de decisões.

Página: `delegacao.html` — [telas-chave](/design/telas-chave#liberação-pelo-supervisor).

---

## 6. Onde a permissão é verificada (fluxo de uma escrita)

```text
[ UI ]  botão só é renderizado se NexusAuth.hasPermission('LIBERAR_CARGA')
   ↓
[ Controlador ]  js/pages/cargas.js revalida antes de gravar
   ↓
[ Guard ]  requireAuth(allowedRoles) na carga da página; canAccessPage() nas ferramentas WebMCP
   ↓
[ Dados ]  js/data-repository.js envia a escrita com o código individual do autor
   ↓
[ Banco ]  políticas RLS (anon/authenticated) + triggers de auditoria
   ↓
[ Auditoria ]  logs_alteracoes (e trail_decisoes nas ações críticas)
```

O mesmo caminho é seguido quando a ação vem de um **agente de IA** (WebMCP): o núcleo revalida cargo,
permissão e página **na execução**, além de exigir confirmação humana para ações consequentes. Ver
[WebMCP](/arquitetura/webmcp).
