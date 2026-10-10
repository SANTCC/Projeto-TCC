---
id: webmcp-ferramentas
title: Catálogo das 72 ferramentas WebMCP
sidebar_label: Catálogo de ferramentas
description: Todas as ferramentas expostas a agentes de IA, por página, com tipo, permissão exigida e quem pode executar.
---

# Catálogo das 72 ferramentas WebMCP

Inventário gerado a partir do registro real das páginas (script de inventário, perfil de Diretor, sem
dados de produção). **72 nomes distintos:** 62 específicos de página, 9 globais e 1 público.

Legenda de **tipo**:

| Tipo | Significa |
| --- | --- |
| `leitura` | não altera nada (`readOnlyHint`) |
| `ação` | consequente: exige **confirmação humana** (`consequentialHint`) |
| `preenche formulário` | declarativa: preenche campos, valida e **não envia** |
| `escrita local` | afeta apenas o navegador do operador (preferência/registro local) |

---

## Global (todas as páginas autenticadas, conforme o cargo)

`obter_sessao` · `obter_estado_emergencia` · `acionar_emergencia` · `desativar_emergencia` ·
`ir_para_pagina` · `alternar_tema` · `sair_do_sistema` · `obter_resumo_pagina` · `obter_estado_webmcp`

Nas telas de acesso (`index.html`, `confirm-role.html`) expõem-se apenas `obter_etapa_acesso` e
`obter_estado_webmcp`.

---

## Dashboard

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `dashboard.html` | `obter_resumo_operacional` | leitura | todos |
| `dashboard.html` | `detalhar_indicador` | leitura | todos |
| `dashboard.html` | `listar_trilha_decisoes` | leitura | todos |
| `dashboard.html` | `listar_auditoria` | leitura | todos |
| `dashboard.html` | `calcular_chegada_navio` | leitura | todos |

## Cargas & Pátio

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `cargas.html` | `listar_cargas` | leitura | todos |
| `cargas.html` | `obter_carga` | leitura | todos |
| `cargas.html` | `exibir_etiqueta_qr` | leitura | todos |
| `cargas.html` | `listar_guindastes` | leitura | todos |
| `cargas.html` | `listar_containers` | leitura | todos |
| `cargas.html` | `listar_tipos_carga` | leitura | todos |
| `cargas.html` | `agendar_carga` | ação | Inspetor, Supervisor, Direção, Conselho |
| `cargas.html` | `receber_carga` | ação | Conferente + Direção/Conselho · `REGISTRAR_RECEBIMENTO` |
| `cargas.html` | `movimentar_carga` | ação | Estivador, Inspetor + Direção/Conselho · `MOVIMENTAR_CARGA` |
| `cargas.html` | `marcar_pronta_entrega` | ação | Arrumador, Inspetor + Direção/Conselho · `ALTERAR_PRONTA_ENTREGA` |
| `cargas.html` | `vincular_carga_container` | ação | Supervisor + Direção/Conselho |
| `cargas.html` | `liberar_carga_saida` | ação | Supervisor + Direção/Conselho · `LIBERAR_CARGA` |
| `cargas.html` | `cancelar_entrega` | ação | Supervisor + Direção/Conselho · `CANCELAR_ENTREGA` |

## Inspeção & Checklist

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `inspecao.html` | `listar_cargas_inspecao` | leitura | Inspetor, Supervisor, Direção, Conselho |
| `inspecao.html` | `obter_checklist` | leitura | Inspetor, Supervisor, Direção, Conselho |
| `inspecao.html` | `inspecionar_carga` | ação | Inspetor + Direção/Conselho · `INSPECIONAR_CARGA` |

## Scanner QR Code

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `scanner.html` | `ler_codigo_qr` | escrita local | todos |

## Embarcações & GPS

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `embarcacoes.html` | `listar_navios` · `obter_navio` · `listar_bercos` · `listar_containers` · `listar_guindastes` · `listar_tarefas_guindaste` · `listar_rotas` | leitura | Planejador, Inspetor, Supervisor, Direção, Conselho |
| `embarcacoes.html` | `cadastrar_navio` | ação | Inspetor + Direção/Conselho · `CADASTRAR_NAVIO` |
| `embarcacoes.html` | `cadastrar_container` | ação | Inspetor + Direção/Conselho · `CADASTRAR_CONTAINER` |
| `embarcacoes.html` | `cadastrar_guindaste` | ação | Inspetor + Direção/Conselho · `CADASTRAR_GUINDASTE` |
| `embarcacoes.html` | `cadastrar_rota` | ação | Supervisor + Direção/Conselho · `CADASTRAR_ROTA` |
| `embarcacoes.html` | `liberar_saida_navio` | ação | Supervisor + Direção/Conselho · `LIBERAR_NAVIO` |
| `embarcacoes.html` | `autorizar_retorno_navio` | ação | Supervisor + Direção/Conselho · `LIBERAR_NAVIO` |
| `embarcacoes.html` | `vincular_navio_berco` | ação | Planejador, Inspetor, Supervisor, Direção, Conselho |
| `embarcacoes.html` | `vincular_container_navio` | ação | Planejador, Inspetor, Supervisor, Direção, Conselho |
| `embarcacoes.html` | `excluir_navio` · `excluir_container` · `excluir_guindaste` | ação | Inspetor + Direção/Conselho (respectiva permissão de cadastro) |

## Manutenção & OS

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `manutencao.html` | `listar_ordens_servico` · `obter_ordem_servico` | leitura | Inspetor, Supervisor, Direção, Conselho |
| `manutencao.html` | `abrir_ordem_servico` | ação | Inspetor, Supervisor + Direção/Conselho · `SOLICITAR_MANUTENCAO` |
| `manutencao.html` | `executar_acao_os` | ação | Supervisor + Direção/Conselho · `APROVAR_MANUTENCAO` |
| `manutencao.html` | `solicitar_manutencao_guindaste` | ação | Supervisor + Direção/Conselho · `SOLICITAR_MANUTENCAO` |
| `manutencao.html` | `concluir_manutencao_guindaste` | ação | Supervisor + Direção/Conselho · `APROVAR_MANUTENCAO` |
| `manutencao.html` | `preparar_manutencao_navio` | preenche formulário | Inspetor, Supervisor + Direção/Conselho |

## Delegação de Supervisor

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `delegacao.html` | `obter_delegacao_ativa` | leitura | Supervisor + Direção/Conselho |
| `delegacao.html` | `revogar_delegacao` | ação | Supervisor + Direção/Conselho · `DESIGNAR_SUBSTITUTO` |
| `delegacao.html` | `preparar_designacao_substituto` | preenche formulário | Supervisor + Direção/Conselho · `DESIGNAR_SUBSTITUTO` |

:::note CPF e data de nascimento
O agente **não** preenche nem recebe esses campos: a ferramenta declarativa preenche nome, matrícula e
vigência, e o operador completa CPF e data de nascimento antes de enviar.
:::

## Gestão de Pessoas (Técnico em Portos)

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `tecnico_portos.html` | `pesquisar_funcionario` · `listar_funcionarios` | leitura | Técnico + Direção/Conselho |
| `tecnico_portos.html` | `listar_visitantes` | leitura | Técnico + Direção/Conselho |
| `tecnico_portos.html` | `reemitir_codigo_funcionario` | ação | Técnico + Direção/Conselho |
| `tecnico_portos.html` | `desativar_funcionario` | ação | Técnico + Direção/Conselho |
| `tecnico_portos.html` | `autorizar_entrada_visitante` | ação | Técnico + Direção/Conselho · `CADASTRAR_VISITANTE` |
| `tecnico_portos.html` | `registrar_saida_visitante` | ação | Técnico + Direção/Conselho · `CADASTRAR_VISITANTE` |
| `tecnico_portos.html` | `preparar_cadastro_visitante` | preenche formulário | Técnico + Direção/Conselho |
| `tecnico_portos.html` | `preparar_cadastro_funcionario` | preenche formulário | Técnico + Direção/Conselho |

## Relatórios & PDF

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `relatorios.html` | `atualizar_graficos` | leitura | todos |
| `relatorios.html` | `gerar_relatorio_carga` | leitura | todos (responde `FALHA_PDF` se a emissão falhar) |
| `relatorios.html` | `exportar_historico_csv` | ação | Direção e Conselho · `EXPORTAR_HISTORICO` |

O CSV é baixado **no navegador do operador**: o conteúdo nunca é devolvido ao agente.

## Teste de vibração (público)

| Página | Ferramenta | Tipo | Quem pode |
| --- | --- | --- | --- |
| `teste-vibracao.html` | `obter_estado_vibracao` | leitura | público |
| `teste-vibracao.html` | `definir_vibracao_ativa` | escrita local | público |

---

## Ferramentas que **não** existem por decisão de segurança

| Não existe | Motivo |
| --- | --- |
| Escrever na trilha de decisões | a trilha é imutável e só o operador registra decisões e retificações na tela |
| Receber ou preencher CPF, documento e data de nascimento | dados pessoais ficam fora do canal do agente |
| Devolver o código individual reemitido | o novo código aparece só na tela do Técnico |
| Enviar formulário em nome do operador | envio é sempre humano (sem `toolautosubmit`) |
| Configurar webhook de pânico | configuração é exclusiva do banco (Edge Function desativada por padrão) |
