# WebMCP no NexusPort — implementação, modelo de ameaças e conformidade

Este documento descreve a camada WebMCP do NexusPort: o que foi implementado, por que, como
é protegida e como é verificada. A visão rápida para operadores e desenvolvedores está em
`README.md` (seção *Agentes de IA (WebMCP)*).

## 1. Resumo

- **O que é:** cada tela do sistema expõe *ferramentas tipadas* que um agente de IA do navegador
  pode descobrir e chamar (leitura, ações com confirmação humana, preenchimento de formulários).
- **API:** `document.modelContext` (W3C Web Machine Learning CG / Chrome). Se o navegador não a
  oferece, o sistema instala um polyfill sem dependências. Também há adaptador para
  `navigator.modelContext` (versões preliminares) e camada JSON-RPC (MCP) para ferramentas,
  recursos e prompts.
- **Escopo:** 12 páginas e 10 módulos de página. São 72 nomes de ferramenta distintos: 62 específicos de
  página, 9 globais e 1 de acesso público (telas de login e de confirmação de cargo). Cada página
  registra só o que o cargo pode usar. A lista completa está na seção 6.
- **Prioridades declaradas:** segurança e saídas confiáveis. Isso se traduz em: mínimo privilégio por
  cargo, confirmação humana fail-closed, validação estrita, higienização de saídas, nenhuma
  credencial ou documento pessoal no canal do agente e verificação do efeito antes de responder "ok".
- **Verificação:** 223 verificações no núcleo e 102 nas páginas reais (seção 10). Todas as suítes
  Node existentes continuam passando.

## 2. Fontes e o que foi adotado

| Fonte | O que foi adotado | O que não foi adotado (e por quê) |
|---|---|---|
| W3C `webmachinelearning/webmcp` (README e `index.bs`) | IDL de `ModelContext` (`registerTool`, `getTools`, `executeTool`, `toolchange`), `ToolAnnotations`, regras de nome (ASCII, 1–128), descrição obrigatória, `signal` para cancelar o registro, erros por nome `DOMException`, resultado serializado em JSON, `Document.modelContext` apenas em contexto seguro | `exposedTo` e `allow="tools"` (não usamos iframes entre origens) |
| Chrome — *WebMCP* (pt-br), API imperativa | `annotations` (`readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging`), `execute(input, {signal})`, orçamentos de texto (500 / 150 / 30 / 1,5 K) | Origin trial e flag local: a camada usa a API nativa quando ela existe e não depende de flag |
| Chrome — API declarativa | Atributos `toolname`, `tooldescription`, `toolparamdescription`; ausência de `toolautosubmit`; pseudo-classes de estado | `toolautosubmit` é proibido por política (o envio é sempre do operador). Os atributos só são definidos com API nativa e só para cargos permitidos (seção 3.3) |
| `docs.mcp-b.ai` e `@mcp-b/webmcp-polyfill` | Polyfill de `document.modelContext` como referência de comportamento; `initialize`/`tools/*`/`resources/*`/`prompts/*` | Dependência npm (o projeto não tem bundler; o polyfill é próprio, sem dependências). Transportes postMessage/WebSocket (não há servidor próprio) |
| `webmcp.dev` | Conceito de prompts e recursos MCP | Widget e relay por token (exigem processo externo, fora da arquitetura do projeto) |
| `learn.chatgpt.com/docs/webmcp` | Registro apenas no documento de topo; confirmação de ações consequentes; respostas que permitem verificar o resultado | Declarativo (o ChatGPT não o suporta) |
| `agent-browser.dev/webmcp` | Dados de página são não confiáveis; `readOnlyHint` e `untrustedContentHint` não contornam a confirmação do host; limites de resumo | Nenhum |
| `docs.typo3.org neoblack/webmcp` | Degradação elegante; manifesto declarativo como ideia | Analytics externo (não enviamos telemetria a terceiros) |
| dev.to — polyfill de 3 KB | Cobertura dos nomes legados (`navigator.modelContext`) | Anotações de pagamento (fora de escopo) |

## 3. Arquitetura

### 3.1 Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `js/webmcp/webmcp-core.js` | Núcleo: API (nativa, legada ou polyfill), registro por página, RBAC, validação, confirmação, saídas, limites, fila, MCP e formulários declarativos |
| `js/webmcp/webmcp-ui.js` | Diálogo de confirmação e painel "Agentes IA" (chave de desligamento, ferramentas da página, atividade) |
| `js/webmcp/webmcp-dados.js` | Leitores compartilhados: cada um devolve só o necessário para a tarefa; grupos de cargos |
| `js/webmcp/webmcp-global.js` | Ferramentas em todas as telas; recursos `nexus://…`; prompts `resumo_turno` e `pendencias_inspecao` |
| `js/webmcp/webmcp-<página>.js` | Dez adaptadores de página: cargas, inspecao, embarcacoes, manutencao, delegacao, tecnico, relatorios, scanner, dashboard, vibracao |
| `tests/test_webmcp.js`, `tests/test_webmcp_paginas.js`, `tests/webmcp-harness.js` | Suítes de verificação (seção 10) |

As páginas existentes receberam pequenas mudanças compatíveis (ver seção 9.2): parâmetros
opcionais `opcoes` nas funções de ação, funções nomeadas para o que antes era um manipulador
de clique, e valores de retorno. Sem o agente, o comportamento da interface é o mesmo.

### 3.2 Fluxo de uma chamada

1. **Descoberta:** `getTools()` lista apenas o que o cargo pode usar nesta página.
2. **Entrada:** validação estrita (esquema, tipos, limites, `additionalProperties: false`, sem chaves
   proibidas, sem caracteres de controle, máximo de 4 KB).
3. **Autorização:** cargo (e permissão `NexusAuth.hasPermission`) e página (`canAccessPage`), de novo
   na execução. Chave de desligamento e emergência.
4. **Limite de taxa:** 30 chamadas/min por ferramenta; 6/min para ações consequentes; 120/min no total.
5. **Pré-condição:** estado da carga, do navio, do berço etc. (a mesma regra da tela), antes de
   qualquer pergunta ao operador.
6. **Confirmação (ações consequentes):** diálogo com o resumo do impacto. Revalidação após a
   confirmação, porque o estado pode ter mudado.
7. **Execução na fila serial** (uma por vez) com tempo limite de 20 s. A execução usa as funções
   da própria página (mesmas validações) e captura as mensagens de feedback da tela.
8. **Verificação:** o efeito é lido no estado salvo; só então a resposta é `ok: true`.
9. **Saída:** higienizada (chaves ocultas, padrões de token e CPF), limitada a 6 000 caracteres e
   marcada como não confiável quando traz dados de usuários.
10. **Registro de atividade:** código do resultado e se houve confirmação; **sem valores de argumentos**.

### 3.3 Declarativo

Para formulários de preenchimento (`formularioComoFerramenta`), a ferramenta preenche os campos
declarados, valida cada valor pelo próprio controle (o navegador descarta datas inválidas
silenciosamente, então o valor gravado é conferido), mostra o formulário e **não envia**. Os campos
pessoais (CPF, data de nascimento, documento) não são declarados e são listados em
`preencher_pelo_operador`.

Com API nativa, os atributos são definidos apenas para cargos que podem usar a ferramenta. Se o
navegador registrar a ferramenta a partir deles, o polyfill não a duplica; caso contrário, a ferramenta
imperativa equivalente é registrada. Atributos residuais são removidos quando a permissão some.

## 4. Contrato das ferramentas

- **Nomes:** `snake_case` ASCII em português, até 30 caracteres, verbos que descrevem o efeito.
- **Descrições:** pt-BR, até 500 caracteres, com efeito e pré-condições. Nenhum texto vindo do banco entra
  em descrição (é estático).
- **Parâmetros:** descrição até 150 caracteres e rótulo pt-BR (aparece no diálogo de confirmação).
- **Anotações:** `readOnlyHint` (leitura), `consequentialHint` (altera dados; exige confirmação),
  `untrustedContentHint` (traz texto de usuário ou externo), `debugging` (diagnóstico). Uma ferramenta
  não pode ser ao mesmo tempo somente leitura e consequente.
- **Resultado:** `{ ok, codigo, mensagem, dados?, feedback?, aviso?, truncado? }`. Falhas esperadas
  **não lançam exceção** (a especificação reduz exceções a `OperationError` sem detalhes); o agente
  recebe um código e uma mensagem para corrigir a chamada.

Códigos de resultado: `OK`, `ARGUMENTOS_INVALIDOS`, `PERMISSAO_NEGADA`, `PAGINA_NAO_PERMITIDA`,
`SEM_SESSAO`, `DESATIVADO`, `EMERGENCIA_ATIVA`, `LIMITE_EXCEDIDO`, `CONFIRMACAO_PENDENTE`,
`CANCELADO_PELO_OPERADOR`, `CANCELADO`, `TEMPO_ESGOTADO`, `ERRO_EXECUCAO`, `NAO_CONCLUIDA`,
`SAIDA_EXCEDIDA`, `FERRAMENTA_INDISPONIVEL`, além dos códigos de pré-condição da página
(`ESTADO_INVALIDO`, `CARGA_NAO_ENCONTRADA`, `ROTA_NAO_CADASTRADA`, `IMO_DUPLICADO` etc.).

**Limites:** entrada 4 KB · saída 6 KB · texto por campo 500 caracteres · confirmação 60 s (o botão
Confirmar só fica ativo após 1,5 s) · execução 20 s · histórico de atividade 50 entradas.

## 5. Segurança: controles e modelo de ameaças

| Ameaça | Controle |
|---|---|
| Agente executa ação que o operador não pediu (injeção de instruções em dados) | Toda ação consequente passa por diálogo com o resumo; dados de usuários são marcados como não confiáveis e vêm com aviso; descrições são estáticas |
| Confirmação forjada por script (`click()`, evento sintético) | O botão só confirma com evento confiável (`isTrusted`) e após 1,5 s; Esc, fundo e prazo cancelam; sem provedor a ação é negada (fail-closed). `nexusConfirm` **não** é usado (confirma sozinho em navegadores headless) |
| Escalada de privilégio | Ferramenta registrada só para o cargo; execução revalida cargo, permissão e página; os cargos seguem a RBAC das telas |
| Estado mudou entre a pergunta e a execução | Revalidação da pré-condição depois da confirmação |
| Vazamento de credencial (código de acesso, token, chave de serviço) | Chaves ocultas na saída, padrões de token/JWT/chave/CPF e padrão `NX-…-####` redigidos; reemissão de código tem captura de mensagens desligada; o código só aparece na tela do Técnico |
| Vazamento de dado pessoal | Nenhum parâmetro pede CPF/documento/senha (teste automatizado); documentos de visitante e funcionário são preenchidos pelo operador; trilha de decisões mostra só nome e cargo do responsável |
| Injeção em consultas (PostgREST `or()`) | O leitor de QR aceita apenas identificadores (`^[A-Za-z0-9._-]{3,80}$`) |
| Loop ou abuso de ferramenta | Limites de taxa por ferramenta e no total; ações consequentes mais restritas; fila serial; tempo limite |
| Ação em emergência | Ações marcadas bloqueiam com `EMERGENCIA_ATIVA`; leituras continuam disponíveis |
| Agente desligado ou mal comportado | Chave de desligamento por navegador (painel) remove todas as ferramentas da página |
| Auditoria apagada ou forjada pelo agente | Trilha e logs são **somente leitura** para agentes; ações feitas por agente recebem a marca `[Agente WebMCP: <ferramenta>]` na trilha e na auditoria |
| Dados fora da origem | Nada sai da origem; sem telemetria externa; sem iframes entre origens |
| Página sem HTTPS | Sem polyfill (contexto inseguro), conforme a especificação; o painel informa a condição |

**Limites do modelo (declarados):** um agente com execução de JavaScript dentro da página pode chamar
diretamente qualquer função, inclusive a de confirmação. Essa classe de agente está fora do que
controles dentro da página conseguem impedir; a proteção definitiva é a confirmação do próprio
navegador/host (como no Chrome e no ChatGPT). O painel e a chave de desligamento são, portanto, a
camada de transparência e controle do operador, não a única barreira.

## 6. Catálogo de ferramentas

Gerado a partir do registro real das páginas (script de inventário, perfil de Diretor, sem dados de produção).

| Página | Ferramenta | Tipo | Quem pode (cargos · permissão) |
|---|---|---|---|
| `dashboard.html` | `obter_resumo_operacional` | leitura | todos |
| `dashboard.html` | `detalhar_indicador` | leitura | todos |
| `dashboard.html` | `listar_trilha_decisoes` | leitura | todos |
| `dashboard.html` | `listar_auditoria` | leitura | todos |
| `dashboard.html` | `calcular_chegada_navio` | leitura | todos |
| `cargas.html` | `listar_cargas` | leitura | todos |
| `cargas.html` | `obter_carga` | leitura | todos |
| `cargas.html` | `exibir_etiqueta_qr` | leitura | todos |
| `cargas.html` | `listar_guindastes` | leitura | todos |
| `cargas.html` | `listar_containers` | leitura | todos |
| `cargas.html` | `listar_tipos_carga` | leitura | todos |
| `cargas.html` | `agendar_carga` | ação (confirmação) | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `cargas.html` | `receber_carga` | ação (confirmação) | Conferente, Dir.Oper, Dir.Pres, Conselho · REGISTRAR_RECEBIMENTO |
| `cargas.html` | `movimentar_carga` | ação (confirmação) | Estivador, Inspetor, Dir.Oper, Dir.Pres, Conselho · MOVIMENTAR_CARGA |
| `cargas.html` | `marcar_pronta_entrega` | ação (confirmação) | Arrumador, Inspetor, Dir.Oper, Dir.Pres, Conselho · ALTERAR_PRONTA_ENTREGA |
| `cargas.html` | `vincular_carga_container` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `cargas.html` | `liberar_carga_saida` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · LIBERAR_CARGA |
| `cargas.html` | `cancelar_entrega` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · CANCELAR_ENTREGA |
| `inspecao.html` | `listar_cargas_inspecao` | leitura | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `inspecao.html` | `obter_checklist` | leitura | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `inspecao.html` | `inspecionar_carga` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · INSPECIONAR_CARGA |
| `scanner.html` | `ler_codigo_qr` | escrita local | todos |
| `embarcacoes.html` | `listar_navios` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `obter_navio` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `listar_bercos` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `listar_containers` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `listar_guindastes` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `listar_tarefas_guindaste` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `listar_rotas` | leitura | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `embarcacoes.html` | `cadastrar_navio` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_NAVIO |
| `embarcacoes.html` | `cadastrar_container` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_CONTAINER |
| `embarcacoes.html` | `cadastrar_guindaste` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_GUINDASTE |
| `embarcacoes.html` | `cadastrar_rota` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_ROTA |
| `embarcacoes.html` | `liberar_saida_navio` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · LIBERAR_NAVIO |
| `embarcacoes.html` | `autorizar_retorno_navio` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · LIBERAR_NAVIO |
| `embarcacoes.html` | `vincular_navio_berco` | ação (confirmação) | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho · ATUALIZAR_DADOS_NAVIO_CONTAINER |
| `embarcacoes.html` | `excluir_navio` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_NAVIO |
| `embarcacoes.html` | `vincular_container_navio` | ação (confirmação) | Planejador, Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho · ATUALIZAR_DADOS_NAVIO_CONTAINER |
| `embarcacoes.html` | `excluir_container` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_CONTAINER |
| `embarcacoes.html` | `excluir_guindaste` | ação (confirmação) | Inspetor, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_GUINDASTE |
| `manutencao.html` | `listar_ordens_servico` | leitura | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `manutencao.html` | `obter_ordem_servico` | leitura | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `manutencao.html` | `abrir_ordem_servico` | ação (confirmação) | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho · SOLICITAR_MANUTENCAO |
| `manutencao.html` | `executar_acao_os` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · APROVAR_MANUTENCAO |
| `manutencao.html` | `solicitar_manutencao_guindaste` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · SOLICITAR_MANUTENCAO |
| `manutencao.html` | `concluir_manutencao_guindaste` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · APROVAR_MANUTENCAO |
| `manutencao.html` | `preparar_manutencao_navio` | preenche formulário | Inspetor, Supervisor, Dir.Oper, Dir.Pres, Conselho · SOLICITAR_MANUTENCAO |
| `delegacao.html` | `obter_delegacao_ativa` | leitura | Supervisor, Dir.Oper, Dir.Pres, Conselho |
| `delegacao.html` | `revogar_delegacao` | ação (confirmação) | Supervisor, Dir.Oper, Dir.Pres, Conselho · DESIGNAR_SUBSTITUTO |
| `delegacao.html` | `preparar_designacao_substituto` | preenche formulário | Supervisor, Dir.Oper, Dir.Pres, Conselho · DESIGNAR_SUBSTITUTO |
| `tecnico_portos.html` | `pesquisar_funcionario` | leitura | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `tecnico_portos.html` | `listar_funcionarios` | leitura | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `tecnico_portos.html` | `reemitir_codigo_funcionario` | ação (confirmação) | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `tecnico_portos.html` | `desativar_funcionario` | ação (confirmação) | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `tecnico_portos.html` | `listar_visitantes` | leitura | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `tecnico_portos.html` | `autorizar_entrada_visitante` | ação (confirmação) | Técnico, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_VISITANTE |
| `tecnico_portos.html` | `registrar_saida_visitante` | ação (confirmação) | Técnico, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_VISITANTE |
| `tecnico_portos.html` | `preparar_cadastro_visitante` | preenche formulário | Técnico, Dir.Oper, Dir.Pres, Conselho · CADASTRAR_VISITANTE |
| `tecnico_portos.html` | `preparar_cadastro_funcionario` | preenche formulário | Técnico, Dir.Oper, Dir.Pres, Conselho |
| `relatorios.html` | `atualizar_graficos` | leitura | todos |
| `relatorios.html` | `gerar_relatorio_carga` | leitura | todos |
| `relatorios.html` | `exportar_historico_csv` | ação (confirmação) | Dir.Oper, Dir.Pres, Conselho · EXPORTAR_HISTORICO |
| `teste-vibracao.html` | `obter_estado_vibracao` | leitura | público |
| `teste-vibracao.html` | `definir_vibracao_ativa` | escrita local | público |

**Ferramentas globais** (em todas as páginas autenticadas, conforme o cargo): `obter_sessao`, `obter_estado_emergencia`, `acionar_emergencia`, `desativar_emergencia`, `ir_para_pagina`, `alternar_tema`, `sair_do_sistema`, `obter_resumo_pagina`, `obter_estado_webmcp`. Telas de acesso (`index.html`, `confirm-role.html`) expõem apenas `obter_etapa_acesso` e `obter_estado_webmcp`.

## 7. Matriz de conformidade (resumo)

| Requisito | Situação |
|---|---|
| `document.modelContext` com `registerTool`, `getTools`, `executeTool`, `toolchange` | Atendido (nativo ou polyfill) |
| Eventos `toolactivated` / `toolcancel` | Disparados pelo polyfill e pelo adaptador legado; no nativo, o navegador os controla |
| `signal` no registro (`AbortError` e remoção ao abortar) | Atendido |
| Nomes ASCII 1–128; descrição obrigatória; duplicidade (`InvalidStateError`) | Atendido no polyfill |
| `exposedTo` / `allow="tools"` / cross-origin | `exposedTo` é validado (apenas origens `https:`, mais restritivo que a especificação; `SecurityError`); a exposição é sempre ao próprio documento, pois não usamos iframes entre origens. Sem modelo de permissão `tools` (o documento principal já é o único consumidor) |
| Contexto seguro | Atendido (sem polyfill em HTTP) |
| Anotações W3C e Chrome | Atendido |
| Declarativo (`toolname`, `tooldescription`, `toolparamdescription`), sem `toolautosubmit` | Atendido (condicional ao navegador; sem envio pelo agente) |
| MCP: `initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`, `ping` | Atendido na camada JSON-RPC. **Transporte não incluído** (nenhum transporte está ativo; `NexusWebMCP.mcp.tratar` é agnóstico) |
| MCP: `sampling` | **Não implementado** (requer cliente com modelo; não cabe em página estática) |
| `Permissions-Policy: tools=()` | **Não configurável** no GitHub Pages; mitigado pelo registro restrito à página principal |

## 8. Decisões e alternativas descartadas

- **Agentes não escrevem na trilha de decisões nem nos logs.** A integridade da auditoria tem prioridade.
- **CPF, documento e data de nascimento nunca são parâmetros.** O operador completa esses campos.
- **Ativação de emergência é permitida** para quem já pode fazê-la na tela (`ACIONAR_EMERGENCIA`), com
  confirmação e sem contornar `NexusPanic` (`triggerPanic({confirmar:false})` depois da confirmação
  da camada, para que a regra de cargo do módulo continue valendo).
- **Reemissão de código de acesso é permitida**, mas o novo código nunca volta ao agente e a captura
  de mensagens dessa ferramenta é desligada.
- **Agendamento de carga** segue o handler da tela: só Supervisor, Inspetor e Direção (a tela mostra o
  botão a todos; isso é um achado, seção 9.1).
- **Sem dependência npm para o polyfill** (o projeto é HTML/JS puro e não usa bundler).
- **Sem relay do webmcp.dev** (exige um processo externo).
- **Sem pagamentos/anotações de preço** (fora do escopo do projeto).
- **Sem telemetria externa** (a especificação do TYPO3 propõe analytics; aqui isso seria exfiltração).

## 9. Achados em código existente

### 9.1 Corrigidos nesta entrega

1. **Movimentação de carga não era salva** (`js/pages/cargas.js`): o evento `nexus_data_changed` era
   disparado antes de gravar; o listener relia o cache antigo e a gravação seguinte sobrescrevia a
   designação do guindaste. Removido o disparo prematuro (a atualização já ocorre no fim da ação).
2. **Contêiner só local não podia ser vinculado** (`js/pages/cargas.js`): o modal usava `rawDbId || id` como
   valor da opção; sem `id`, o valor ficava vazio. Agora usa a identificação como último recurso.
3. **Erro ao concluir/solicitar manutenção de guindaste** (`js/pages/manutencao.js`): `renderGuindastesTable()`
   era chamada sem guarda (a função só existe em `embarcacoes.js`), gerando `ReferenceError` depois de
   gravar. Agora tem a mesma guarda já usada na linha anterior.

### 9.2 Mudanças de compatibilidade (sem alterar a interface)

- `executarAcaoCarga(id, acao, opcoes)`, `liberarNavioPeloDiretor`, `autorizarRetornoNavio`,
  `vincularNavioABerco`, `excluirNavio`, `vincularContainerANavio`, `excluirContainer`,
  `excluirGuindaste`, `solicitarManutencaoGuindaste`, `concluirManutencaoGuindaste`,
  `excluirFuncionarioReal`, `registrarSaidaVisitante` aceitam `opcoes` opcional (`confirmado`,
  `motivo`, `guindasteIdentificacao`, `bercoNome`, `navioImo`, `descricao`, `dataSaida`, `parecer`).
  Sem `opcoes`, o diálogo original é usado.
- Funções nomeadas expostas: `nexusInspecaoAprovar/Recusar/Estado/ModeloChecklist`,
  `nexusTecnicoBuscar/Reemitir`, `nexusRevogarDelegacao`, `nexusRelatorioGerarPdf`,
  `nexusScannerProcessar` (retorna o resultado), `nexusEmbarcacoesRotas`.
- Trilha e log: quando a ação vem de um agente, o texto recebe a marca `[Agente WebMCP: …]`.

### 9.3 Achados não corrigidos (recomendação)

4. **Código de acesso gravado na trilha** (`js/pages/dashboard.js`, `registrarTrailDecisao`): o campo
   `responsavel` recebe `session.codigo_individual` em texto puro (`Nome (Cargo) - CÓDIGO`). É uma
   credencial em registro de auditoria. A leitura pelo WebMCP redige o código, mas a gravação deve
   deixar de incluí-lo.
5. **Confirmação automática em headless** (`js/layout.js`, `nexusConfirm`): confirma após 50 ms quando o
   User-Agent contém `Headless` ou `Playwright`. Não é usado pelo WebMCP, mas é um risco de contorno
   em automações.
6. **Ações sem checagem de cargo dentro da função** (`js/pages/embarcacoes.js`): `excluirNavio`,
   `excluirContainer`, `excluirGuindaste` e `vincularNavioABerco` não verificam o cargo; a tela mostra
   o botão a todos os cargos da página. O WebMCP exige o cargo de cadastro.
7. **Agendamento visível a todos** (`js/pages/cargas.js`): o botão "Agendar Nova Cargas" aparece a todos os
   cargos da página, mas o envio só é aceito para Supervisor, Inspetor e Direção.
8. **Exportação sem checagem interna** (`js/vision-layer.js`, `exportDadosHistoricos`): não verifica o
   cargo e não tem botão na interface. O WebMCP só a expõe a `EXPORTAR_HISTORICO`.
9. **Filtro com texto livre** (`js/pages/scanner.js`): o código lido é interpolado em filtros PostgREST
   (`or(...)`). O WebMCP aceita só identificadores; a tela deveria validar do mesmo modo.
10. **Validação de CPF ineficaz** (`js/pages/delegacao.js`, `validarCPF`): calcula o dígito verificador e
    devolve `true` em qualquer caso.
11. **Arquivo `js/config.js` versionado** apesar de listado em `.gitignore` (já assinalado antes;
    não alterado).
12. **`tests/test_suite_completa.js`** procura `test_fase_*.js` na raiz, mas os arquivos estão em
    `tests/`; a suíte falha antes de executar qualquer teste (pré-existente, não alterada).

## 10. Verificação

| Comando | O que cobre | Resultado |
|---|---|---|
| `npm run test:webmcp` | `tests/test_webmcp.js` (223 verificações: catálogo e higiene, API nativa/legada/polyfill/inseguro, RBAC, desligamento, validação, confirmação, revalidação, emergência, saídas, taxa, painel, diálogo, MCP, declarativo) e `tests/test_webmcp_paginas.js` (102 verificações nas páginas reais, com os scripts de cada tela e o cache local, sem Supabase) | Aprovado |
| `npm run scan:xss` e `npm run test:xss` | Interpolações não codificadas em todo `js/*.js` (inclui os módulos WebMCP) | Aprovado |
| `npm run test:graficos`, `test:refresh`, `test:autorefresh`, `test:bercos`, `test:haptics`, `test:migracao`, `test:panic`, `test:enum`, `test:net-debug`, `test:backlog3` | Regressão das funcionalidades existentes | Aprovado |
| `npm test` (Playwright, Python) | Fluxos ponta a ponta | **Não executado**: o ambiente de desenvolvimento não tem navegador/Playwright disponível |

Os testes de página usam jsdom com os **scripts reais** de cada página e um cache local semeado. Não
substituem a verificação em navegador real: recomenda-se conferir no Chrome com
`chrome://flags/#enable-webmcp-testing` (seção 11).

## 11. Limitações e próximos passos

- **Navegador:** a API nativa depende de versão e de flag/origin trial do Chrome. Enquanto isso, o
  polyfill cobre o caso (HTTPS). Em HTTP local (`localhost` é contexto seguro), a API funciona.
- **Verificação em navegador:** executar com o *Model Context Tool Inspector* e, opcionalmente, o
  `agent-browser --webmcp`, em cada perfil de cargo.
- **Transporte MCP:** não há transporte ativo. Um transporte postMessage (mesma origem) pode ser
  adicionado chamando `NexusWebMCP.mcp.tratar` sem alterar o núcleo.
- **Sampling:** não implementado.
- **Confirmação no host:** o diálogo é da página. A confirmação pelo navegador (ou pelo agente hospedeiro)
  é a barreira recomendada para a próxima versão da API.
- **Achados da seção 9.3:** priorizar o item 4 (código de acesso na trilha) e o item 6 (checagem de
  cargo nas funções de cadastro).
