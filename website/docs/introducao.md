---
id: introducao
title: Introdução
sidebar_label: Introdução
description: O que é o NexusPort, qual problema resolve, como esta documentação está organizada e quais são as fontes de verdade do repositório.
slug: /introducao
---

# NexusPort — Documentação Técnica

<span className="nexus-tag-terminal">Terminal STS-01 · Porto de Santos · Sistema de automação de carregamentos</span>

**NexusPort** é uma plataforma web **interna** para automação de carregamentos em um porto. Ela é usada
exclusivamente por funcionários dentro do ambiente portuário — nunca por clientes externos, capitães ou
pessoas de fora do porto. O objetivo é dar **autonomia operacional** a cada profissional (registrar e
consultar os dados da sua área sem depender de comunicação verbal), mantendo as decisões críticas
(liberação de cargas e navios, aprovação de manutenções) sob hierarquia do **Supervisor**.

<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-kpi"><span className="nexus-kpi__valor">13</span><span className="nexus-kpi__rotulo">telas HTML, sem bundler</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__valor">41</span><span className="nexus-kpi__rotulo">módulos JavaScript</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__valor">25</span><span className="nexus-kpi__rotulo">tabelas PostgreSQL com RLS</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__valor">10</span><span className="nexus-kpi__rotulo">cargos em 4 níveis de acesso</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__valor">72</span><span className="nexus-kpi__rotulo">ferramentas WebMCP para agentes</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__valor">62</span><span className="nexus-kpi__rotulo">suítes de verificação</span></div>
</div>

---

## 1. O problema que o sistema resolve

A especificação (`SPECs/Spec.md`) lista seis problemas no cenário original do terminal:

1. Dificuldade de comunicação entre funcionários sobre dados de cargas e navios;
2. Dificuldade de identificação dos dados dos navios e do conteúdo dos contêineres;
3. Falta de comunicação sobre reformas e manutenções nos navios;
4. Necessidade de armazenamento digital das cargas para fiscalização e preservação de dados;
5. Problemas no registro de datas e horários de entrada e saída de navios e cargas;
6. Dificuldade na identificação da origem e destino dos navios.

O NexusPort responde a cada um deles com um fluxo auditável: cada operação é registrada com **cargo +
código individual**, os dados operacionais ficam legíveis para quem tem visão sobre eles, e as decisões
de alto impacto viram registros imutáveis na **trilha de decisões**.

---

## 2. Como o sistema está construído (resumo)

| Camada | Tecnologia | Onde vive |
| --- | --- | --- |
| Apresentação | HTML5 + Tailwind CSS (CDN) + JavaScript vanilla (ES6) | `*.html`, `js/` |
| Dados | Supabase / PostgreSQL com Row Level Security | `SPECs/schema.sql`, `supabase/migrations/` |
| Lógica de servidor | 6 Edge Functions (Deno) | `supabase/functions/` |
| Tempo real | Supabase Realtime (WebSocket + Presence) | `js/data-repository.js`, `js/panic-realtime.js`, `js/online-presence.js` |
| Agentes de IA | WebMCP (`document.modelContext`) | `js/webmcp/` |
| Automação | Node (testes, build, capturas), Python (verificação SQL) | `tests/`, `tools/`, `nexus_cli.py` |
| Documentação | Docusaurus 3 (**este site**) | `website/` → build em `docs/` |

:::note Sem bundler por decisão de projeto
O front-end não usa React, Next.js, Vue, Vite, Webpack ou TypeScript. Isso é uma **restrição obrigatória**
da especificação (`SPECs/agents.md`), não uma limitação técnica: qualquer página abre com `file://`-like
simplicidade, o deploy é estático e o Tailwind entra por CDN com os tokens do Design System configurados
inline. A única parte do repositório que usa Node/React no build é este site de documentação.
:::

---

## 3. Fontes de verdade do repositório

Quando qualquer informação desta documentação divergir de um arquivo do projeto, **vale o arquivo**, nesta
ordem de prioridade:

| Prioridade | Arquivo | O que é |
| --- | --- | --- |
| 1 — regras | `SPECs/Spec.md` | Especificação funcional: RF 1–18, RN 1–19, glossário, não-requisitos |
| 2 — plano | `SPECs/tasks.md` | Decomposição em 9 fases (T1.1 → T9.10) com dependências |
| 3 — dados | `SPECs/schema.sql` | DDL completo (25 tabelas, 14 enums, RLS, gatilhos) |
| 4 — design | `SPECs/design/design.md` | Design System v2.0: tokens, componentes, telas, status |
| 5 — visual | `THEME/*/code.html` | 8 protótipos estáticos de referência (identidade, não arquitetura) |
| 6 — instruções | `agents.md`, `SPECs/agents.md` | Manual do desenvolvedor e do agente de codificação |
| 7 — derivados | `README.md`, `TABLES.md`, `webmcp.md` | Visões rápidas: operação, tabelas do banco, camada de agentes |

<div className="nexus-citacao">
<strong>Regra de ouro.</strong> Os arquivos de <code>THEME/</code> são <em>apenas base visual</em>. Não copie
o código deles como arquitetura: são protótipos estáticos com Tailwind via CDN. Use-os para a identidade,
o layout e a linguagem de componentes.
</div>

---

## 4. Mapa desta documentação

| Bloco | Responde a | Páginas |
| --- | --- | --- |
| **Primeiros passos** | Como rodar o sistema na minha máquina? | Instalação, configuração do Supabase, execução local, estrutura do repositório, contas de demonstração |
| **Domínio e regras** | O que o sistema faz e por quê? | Visão geral, cargos e permissões, requisitos funcionais, regras de negócio, fluxo da carga, glossário |
| **Arquitetura** | Como o sistema é construído? | Front-end, módulos JS, páginas, repositório de dados, Supabase, Edge Functions, tempo real, WebMCP |
| **Design System** | Como o sistema se parece? | Tokens, componentes, telas-chave, protótipos `THEME/`, acessibilidade |
| **Banco de dados** | Como os dados são modelados? | Visão geral, tabelas, enums, RLS, migrações, seed, diagnósticos |
| **Segurança** | Quais são as proteções? | Modelo de segurança, anti-XSS, sessão e cookies |
| **Operação e qualidade** | Como publicar e verificar? | Build e deploy, testes, Lighthouse, PDF, QR Code, Analytics, API Python, galeria |
| **Referência** | Onde encontro cada coisa? | Índice de `SPECs/`, backlogs, tarefas, configurações, FAQ |

---

## 5. Fluxo completo em uma tela

<div className="nexus-fluxo">
  <span className="nexus-fluxo__etapa">Agendado</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Recebido</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Em inspeção</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Armazenado</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Pronto para entrega</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Liberado / Saída do porto</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">Em trânsito</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa nexus-fluxo__etapa--ativa">Entregue</span>
</div>

Caminhos alternativos: **Recusado** (inspeção reprovada, com motivo obrigatório) e **Cancelado**
(somente a partir de Agendado, Armazenado ou Pronto para entrega). O detalhamento das transições, dos
responsáveis e das cores de cada estado está em [Fluxo da carga](/dominio/fluxo-da-carga).

---

## 6. Próximos passos

- Quer **rodar agora**: [Instalação](/primeiros-passos/instalacao) → [Execução local](/primeiros-passos/execucao-local).
- Quer **entender as regras**: [Visão geral do domínio](/dominio/visao-geral).
- Quer **mexer no código**: [Arquitetura](/arquitetura/visao-geral) e [Módulos JavaScript](/arquitetura/modulos-javascript).
- Quer **publicar**: [Build e deploy](/operacao/build-e-deploy).
- Quer **ver as telas**: [Galeria](/galeria) e [Como funciona o sistema](https://github.com/SANTCC/Projeto-TCC/blob/main/about.html).
