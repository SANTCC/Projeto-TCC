---
id: glossario
title: Glossário do domínio portuário
sidebar_label: Glossário
description: Termos do domínio portuário e do sistema, com a referência para o código e para a documentação.
---

# Glossário do domínio portuário

Termos definidos em `SPECs/Spec.md` (a interface **deve** usar exatamente esta terminologia) mais os
termos técnicos usados na documentação.

## 1. Papéis e pessoas

| Termo | Definição |
| --- | --- |
| **Estivador** | Operário responsável por movimentar cargas no pátio e registrar o estado do carregamento no sistema. |
| **Conferente de Carga** | Profissional que registra o recebimento físico das mercadorias no porto e avalia as condições na saída. |
| **Arrumador e Consertador** | Responsável por organizar, acondicionar e alterar o status da carga para "pronta para entrega". |
| **Planejador de Pátio e de Navios** | Responsável por registrar o estado e as informações operacionais de contêineres e navios. |
| **Técnico em Portos** | Responsável pela documentação interna dos funcionários e pelo registro de visitantes temporários. |
| **Supervisor / Gerente de Operações** | Responsável por decisões críticas: liberação de cargas e navios, aprovação de manutenções, cancelamentos e cadastros estratégicos. |
| **Inspetor** | Responsável por inspeções técnicas de cargas, cadastro de navios e contêineres, coordenação de emergências e supervisão operacional. |
| **Diretor** | Nível estratégico com acesso total de leitura, dashboards consolidados e exportação de dados históricos. |
| **Substituto (delegação)** | Supervisor temporário designado por um titular, com os mesmos poderes de liberação durante a vigência. |
| **Visitante** | Pessoa temporária registrada no porto pelo Técnico em Portos (nome, documento, motivo, data/hora de entrada). |

## 2. Cargas, contêineres e embarcações

| Termo | Definição |
| --- | --- |
| **Contêiner** | Caixa metálica padronizada para transporte de cargas, identificada por um número único no sistema. |
| **Navio** | Embarcação que transporta apenas contêineres, identificada pelo número IMO e monitorada por estado operacional. |
| **IMO** | Número de identificação marítima único atribuído a cada navio (*International Maritime Organization*). |
| **Guindaste** | Equipamento de movimentação de contêineres; a manutenção é solicitada pelo Supervisor. |
| **Porto de Descarga** | Porto específico onde uma carga individual deve ser desembarcada, podendo diferir do destino final da viagem do navio. |
| **Tipo de Carga** | Classificação das mercadorias (ex.: grãos, líquidos, eletrônicos) que determina o modelo de checklist de inspeção. |
| **Checklist** | Lista de verificação criada pelo Supervisor para um Tipo de Carga, usada pelo Inspetor durante a inspeção. |
| **Trail de Decisões** | Registro imutável das decisões críticas tomadas no sistema (aprovações, recusas, liberações). |
| **Etiqueta de QR Code** | Etiqueta física adesiva gerada pelo sistema com o QR Code de identificação de uma carga ou contêiner, para leitura por câmera no pátio. |
| **Berço** | Posição de atracação do terminal. O STS-01 tem **15 berços** (`BERCO-01` … `BERCO-15`). |
| **Rota marítima** | Par origem → destino com distância fixa cadastrada pelo Supervisor, usada para estimar a chegada (33 km/h). |
| **Ocupação do pátio** | Quantidade de cargas/contêineres em armazenagem; indicador do dashboard. |
| **Manutenção preventiva sugerida** | Sugestão do sistema em ciclos de 3 anos (RN 11), exibida como card — nunca como alarme. |

## 3. Estados e status

| Termo | Onde vive | Observação |
| --- | --- | --- |
| `AGENDAMENTO`, `RECEBIMENTO_INSPECAO`, `ARMAZENAGEM`, `PRONTA_PARA_ENTREGA`, `SAIDA`, `EM_TRANSITO`, `ENTREGUE`, `CANCELADA`, `RECUSADA` | `status_carga_enum` | 9 valores para as 8 etapas + recusa |
| `OPERANTE`, `AGENDADO_PARA_REFORMA`, `EM_REFORMA`, `APROVADO_PARA_REFORMA` | `estado_navio_enum`, `estado_container_enum` | estados operacionais |
| `OPERANTE`, `EM_MANUTENCAO` | `estado_guindaste_enum` | guindastes |
| `DENTRO_DO_PORTO`, `FORA_DO_PORTO`, `NO_PORTO_DE_DESTINO` | `localizacao_navio_enum` | localização (RF 8) |
| `PENDENTE`, `APROVADA`, `RECUSADA` | `resultado_inspecao_enum` | resultado da inspeção |
| `SOLICITADA`, `APROVADA`, `RECUSADA`, `CONCLUIDA` | `status_manutencao_enum` | ordem de serviço |
| `EM_CARREGAMENTO`, `PARADO`, `CONCLUIDO` | `estado_carregamento_enum` | movimentação do Estivador |
| `LIVRE`, `OCUPADO`, `MANUTENCAO` | `bercos.estado` (check constraint) | painel de atracação |
| `CRIACAO`, `EDICAO`, `EXCLUSAO`, `REIMPRESSAO_ETIQUETA`, `EXPORTACAO` | `tipo_alteracao_enum` | tipo de registro na auditoria |
| `APROVOU_CARGA`, `RECUSOU_CARGA`, `SOLICITOU_MANUTENCAO_NAVIO`, `SOLICITOU_MANUTENCAO_CONTAINER`, `LIBEROU_NAVIO`, `CANCELOU_ENTREGA`, `APROVOU_MANUTENCAO`, `RECUSOU_MANUTENCAO`, `DESIGNOU_SUBSTITUTO` | `tipo_decisao_enum` | decisões da trilha |

## 4. Termos técnicos do projeto

| Termo | Significado |
| --- | --- |
| **Camada de visão** | Uma das três formas de enxergar os dados: Própria, Operacional, Estratégica (RF 1). |
| **Código individual** | Credencial do funcionário (`codigo_individual`), vinculada à matrícula. Em caso de perda, é invalidado e reemitido (RN 15). |
| **Matrícula** | Identificador funcional (`matricula`), único, usado como login principal. |
| **Guard** | `js/auth-guard.js`: valida a sessão e a permissão da rota antes de a página renderizar. |
| **Repositório de dados** | `js/data-repository.js`: ponto único de leitura/escrita no Supabase, com Realtime e cache local. |
| **RLS** | *Row Level Security* do PostgreSQL: políticas por tabela (`anon, authenticated` neste projeto). |
| **PGRST205** | Erro do PostgREST quando a tabela não está no *schema cache* (404). Ver [Diagnósticos](/banco-de-dados/diagnosticos). |
| **Trail** | Abreviação usada no projeto para a trilha de decisões (`trail_decisoes`). |
| **Retificação** | Registro anexado a uma decisão do trail, sem alterar o original (`retificacoes_trail`). |
| **WebMCP** | Camada que expõe ferramentas tipadas a agentes de IA do navegador (`document.modelContext`). Ver [WebMCP](/arquitetura/webmcp). |
| **Fail-closed** | Postura de segurança: na dúvida (sem provedor de confirmação, sem permissão), **nega** a ação. |
| **Gate Lighthouse** | Verificação automática de qualidade em PRs (`.github/workflows/lighthouse.yml`). |
| **Dist** | Saída do build de produção (`npm run build`), publicada pelo Vercel. |
| **Vendorização** | Cópia local de CDNs (Tailwind, fontes, bibliotecas) usada nas capturas de tela, para não depender de rede. |
| **Seed** | `supabase/seed.sql`: usuários mock e dados fictícios de demonstração. |
