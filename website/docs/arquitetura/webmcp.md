---
id: webmcp
title: WebMCP — agentes de IA (arquitetura)
sidebar_label: WebMCP (arquitetura)
description: Como o NexusPort expõe ferramentas tipadas a agentes de IA, com confirmação humana, RBAC, validação estrita e modelo de ameaças.
---

# WebMCP — agentes de IA

> Documento completo de origem: `webmcp.md` na raiz do repositório (313 linhas). Esta página é a versão
> de referência dentro da documentação; o catálogo das **72 ferramentas** está em
> [Catálogo de ferramentas](/arquitetura/webmcp-ferramentas).

## 1. O que é

Cada tela do sistema expõe **ferramentas tipadas** que um agente de IA do navegador pode descobrir e
chamar: leitura, ações com confirmação humana e preenchimento de formulários. A API é
**`document.modelContext`** (W3C Web Machine Learning CG / Chrome); se o navegador não a oferece, o sistema
instala um **polyfill próprio, sem dependências**. Há também adaptador para `navigator.modelContext`
(versões preliminares) e uma camada **JSON-RPC (MCP)** para ferramentas, recursos e prompts.

| Métrica | Valor |
| --- | --- |
| Páginas com ferramentas | 12 (10 autenticadas + login/confirmação de cargo + teste de vibração) |
| Módulos de página | 10 dedicados + núcleo, UI, dados e global |
| Nomes de ferramenta distintos | **72** (62 específicos de página, 9 globais, 1 público) |
| Verificações automatizadas | **223** no núcleo e **102** nas páginas reais |
| Prioridades declaradas | segurança e saídas confiáveis |

## 2. Fundamentos adotados (e recusados)

| Fonte | Adotado | Não adotado |
| --- | --- | --- |
| W3C `webmachinelearning/webmcp` | IDL de `ModelContext` (`registerTool`, `getTools`, `executeTool`, `toolchange`), `ToolAnnotations`, regras de nome, descrição obrigatória, `signal` para cancelar registro, erros por nome, `Document.modelContext` só em contexto seguro | `exposedTo` e `allow="tools"` (não há iframes entre origens) |
| Chrome — WebMCP (API imperativa) | `annotations` (`readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`), `execute(input, { signal })`, orçamentos de texto (500 / 150 / 30 / 1,5 K) | *origin trial* e flags: a camada usa a API nativa quando existe e não depende de flag |
| Chrome — API declarativa | atributos `toolname`, `tooldescription`, `toolparamdescription` | `toolautosubmit` é **proibido** por política (o envio é sempre do operador) |
| `@mcp-b/webmcp-polyfill` | comportamento do polyfill como referência | dependência npm (o projeto não tem bundler) e transportes postMessage/WebSocket |
| ChatGPT / `learn.chatgpt.com` | registro só no documento de topo; confirmação de ações consequentes; respostas verificáveis | camada declarativa (não suportada) |
| `agent-browser.dev/webmcp` | dados de página são **não confiáveis**; `readOnlyHint` não contorna a confirmação do host | — |
| `docs.typo3.org neoblack/webmcp` | degradação elegante | analytics externo (não enviamos telemetria a terceiros) |

## 3. Arquitetura

### 3.1 Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `webmcp-core.js` | API (nativa/legada/polyfill), registro por página, RBAC, validação, confirmação, saídas, limites, fila, MCP e formulários declarativos |
| `webmcp-ui.js` | diálogo de confirmação e painel "Agentes IA" (chave de desligamento, ferramentas da página, atividade) |
| `webmcp-dados.js` | leitores compartilhados: cada um devolve só o necessário para a tarefa |
| `webmcp-global.js` | ferramentas de todas as telas, recursos `nexus://…` e prompts `resumo_turno` / `pendencias_inspecao` |
| `webmcp-<página>.js` | dez adaptadores: cargas, inspeção, embarcações, manutenção, delegação, técnico, relatórios, scanner, dashboard, vibração |
| `tests/test_webmcp*.js`, `tests/webmcp-harness.js` | suítes de verificação |

As páginas sofreram apenas mudanças compatíveis: parâmetros opcionais `opcoes` nas funções de ação,
funções nomeadas no lugar de manipuladores anônimos e valores de retorno. **Sem agente, a interface se
comporta igual.**

### 3.2 Fluxo de uma chamada

```text
1. Descoberta   getTools() lista apenas o que o cargo pode usar nesta página
2. Entrada      validação estrita: esquema, tipos, limites, additionalProperties:false,
                sem chaves proibidas, sem caracteres de controle, máximo 4 KB
3. Autorização  cargo (hasPermission) e página (canAccessPage), revalidados na execução;
                chave de desligamento e estado de emergência
4. Limite      30 chamadas/min por ferramenta · 6/min para ações consequentes · 120/min no total
5. Pré-condição estado da carga/navio/berço (a mesma regra da tela), ANTES de perguntar ao operador
6. Confirmação  diálogo com o resumo do impacto + revalidação após a confirmação
7. Execução     fila serial (uma por vez), tempo limite de 20 s, usando as funções da própria página
8. Verificação  o efeito é lido no estado salvo; só então a resposta é ok: true
9. Saída        higienizada, limitada a 6 000 caracteres, marcada como não confiável quando traz dados de usuário
10. Atividade   registra o código do resultado e se houve confirmação — SEM valores de argumentos
```

### 3.3 Formulários declarativos

Para formulários de preenchimento (`formularioComoFerramenta`), a ferramenta preenche os campos
declarados, **valida cada valor pelo próprio controle** (o navegador descarta datas inválidas em
silêncio, então o valor gravado é conferido), mostra o formulário e **não envia**. Campos pessoais (CPF,
data de nascimento, documento) **não** são declarados e aparecem na lista `preencher_pelo_operador`.

Com API nativa, os atributos só são definidos para cargos que podem usar a ferramenta; se o navegador
registrar a ferramenta a partir deles, o polyfill não a duplica.

## 4. Contrato das ferramentas

| Item | Regra |
| --- | --- |
| **Nomes** | `snake_case` ASCII em português, até 30 caracteres, verbo descrevendo o efeito |
| **Descrições** | pt-BR, até 500 caracteres, com efeito e pré-condições — **sempre estáticas** (nada vindo do banco) |
| **Parâmetros** | descrição até 150 caracteres e rótulo pt-BR (aparece no diálogo de confirmação) |
| **Anotações** | `readOnlyHint`, `consequentialHint`, `untrustedContentHint`, `debugging`; leitura e consequente são mutuamente exclusivas |
| **Resultado** | `{ ok, codigo, mensagem, dados?, feedback?, aviso?, truncado? }` — falhas esperadas **não** lançam exceção |

**Códigos de resultado:** `OK`, `ARGUMENTOS_INVALIDOS`, `PERMISSAO_NEGADA`, `PAGINA_NAO_PERMITIDA`,
`SEM_SESSAO`, `DESATIVADO`, `EMERGENCIA_ATIVA`, `LIMITE_EXCEDIDO`, `CONFIRMACAO_PENDENTE`,
`CANCELADO_PELO_OPERADOR`, `CANCELADO`, `TEMPO_ESGOTADO`, `ERRO_EXECUCAO`, `NAO_CONCLUIDA`,
`SAIDA_EXCEDIDA`, `FERRAMENTA_INDISPONIVEL`, além dos códigos de pré-condição de cada página
(`ESTADO_INVALIDO`, `CARGA_NAO_ENCONTRADA`, `ROTA_NAO_CADASTRADA`, `IMO_DUPLICADO`, …).

**Limites:** entrada 4 KB · saída 6 KB · texto por campo 500 caracteres · confirmação 60 s (botão
Confirmar só ativa após 1,5 s) · execução 20 s · histórico de atividade 50 entradas.

## 5. Segurança: controles e modelo de ameaças

| Ameaça | Controle |
| --- | --- |
| Agente executa ação que o operador não pediu (injeção em dados) | toda ação consequente passa por diálogo com resumo; dados de usuário são marcados como não confiáveis; descrições são estáticas |
| Confirmação forjada por script (`click()`, evento sintético) | o botão só confirma com evento **confiável** (`isTrusted`) e após 1,5 s; Esc, fundo e prazo cancelam; sem provedor de confirmação a ação é **negada** (fail-closed). `nexusConfirm` **não** é usado (confirma sozinho em navegador *headless*) |
| Escalada de privilégio | ferramenta registrada só para o cargo; execução revalida cargo, permissão e página |
| Estado mudou entre a pergunta e a execução | revalidação da pré-condição depois da confirmação |
| Vazamento de credencial | chaves ocultas na saída; padrões de token/JWT/chave/CPF e o padrão `NX-…-####` redigidos; reemissão de código com captura de mensagens desligada |
| Vazamento de dado pessoal | nenhum parâmetro pede CPF/documento/senha (teste automatizado); documentos são preenchidos pelo operador; a trilha mostra só nome e cargo do responsável |
| Injeção em consultas (PostgREST `or()`) | o leitor de QR aceita apenas identificadores (`^[A-Za-z0-9._-]{3,80}$`) |
| Loop ou abuso | limites de taxa por ferramenta e no total; ações mais restritas; fila serial; tempo limite |
| Ação durante emergência | ações marcadas bloqueiam com `EMERGENCIA_ATIVA`; leituras continuam disponíveis |
| Agente desligado ou mal comportado | chave de desligamento por navegador (painel) remove todas as ferramentas da página |
| Auditoria apagada ou forjada pelo agente | trilha e logs são **somente leitura** para agentes; ações feitas por agente recebem a marca `[Agente WebMCP: <ferramenta>]` |
| Dados fora da origem | nada sai da origem; sem telemetria externa; sem iframes entre origens |
| Página sem HTTPS | sem polyfill (contexto inseguro), conforme a especificação; o painel informa a condição |

:::warning Limites do modelo (declarados)
Um agente com execução de JavaScript dentro da página pode chamar diretamente qualquer função, inclusive a
de confirmação. Essa classe de agente está fora do que controles dentro da página conseguem impedir; a
proteção definitiva é a confirmação do próprio navegador/host. O painel e a chave de desligamento são a
camada de **transparência e controle do operador**, não a única barreira.
:::

## 6. Como habilitar/desabilitar

- O painel **Agentes IA** (canto da tela, `webmcp-ui.js`) mostra as ferramentas da página, o histórico de
  atividade e a **chave de desligamento** por navegador;
- Desligado, o núcleo remove todas as ferramentas da página e responde `DESATIVADO`;
- Atributos declarativos residuais são removidos quando a permissão deixa de existir;
- Sem API nativa, sem HTTPS ou sem Supabase, a degradação é elegante: o app funciona normalmente e o
  painel informa a condição.

## 7. Verificação

```bash
npm run test:webmcp      # núcleo (223 verificações) + páginas reais (102 verificações)
```

Cobrem: registro por cargo, rejeição de argumentos inválidos, confirmação fail-closed, limites de taxa,
higienização de saída, ausência de dados pessoais em parâmetros, marcação de autoria na trilha e paridade
com as páginas de acesso.
