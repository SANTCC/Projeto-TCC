---
id: visao-geral
title: Visão geral do domínio
sidebar_label: Visão geral
description: Cenário, problema, escopo, atores e as três camadas de visão do NexusPort conforme a Spec.
---

# Visão geral do domínio

> Fonte: `SPECs/Spec.md` (a fonte primária do projeto). Esta página resume; os detalhes normativos estão em
> [Requisitos funcionais](/dominio/requisitos-funcionais) e [Regras de negócio](/dominio/regras-de-negocio).

## 1. Cenário

O sistema monitora e facilita o **carregamento de objetos em embarcações** no porto, promovendo
autonomia operacional aos funcionários. Autonomia significa: cada profissional registra e consulta
informações da sua área **sem depender de comunicação verbal** com outros setores. Decisões críticas —
liberação de cargas e navios — permanecem sob aprovação hierárquica do **Supervisor**.

## 2. Problema

| # | Problema no cenário atual | Como o sistema responde |
| --- | --- | --- |
| 1 | Comunicação falha entre funcionários sobre cargas e navios | dados operacionais legíveis para Inspetor e Supervisor (Visão Operacional) |
| 2 | Dificuldade de identificar dados de navios e conteúdo dos contêineres | fichas de navio/contêiner/carga com IMO, número e material em monoespaçada |
| 3 | Falta de comunicação sobre reformas e manutenções | estados `AGENDADO_PARA_REFORMA`, `EM_REFORMA`, `APROVADO_PARA_REFORMA` + histórico de manutenções |
| 4 | Necessidade de armazenamento digital para fiscalização | persistência em PostgreSQL + logs de alterações e trilha imutável |
| 5 | Registro incorreto de datas/horas de entrada e saída | datas com picker nativo e máscara `dd/mm/aaaa hh:mm`, gravadas com o autor |
| 6 | Dificuldade de identificar origem e destino dos navios | rotas marítimas cadastradas, porto de descarga por carga e ETA calculado |

## 3. Escopo

Sistema **web interno** para automação de carregamentos. Acessado **exclusivamente por funcionários no
ambiente do porto** — não é destinado a clientes externos, capitães de navio ou pessoas que trabalham
fora do porto.

O que **não** faz parte do escopo (não-requisitos, seleção):

- Sem alertas de atraso, sem notificações instantâneas e sem comunicação entre usuários;
- Sem mapa interativo ou rastreamento real (coordenadas GPS fictícias, uso de registro e ETA);
- Sem integração com sistemas legados e sem app nativo (a leitura de QR é pelo navegador);
- Sem módulo financeiro de contas, sem controle de capacidade física/lotação;
- Sem gestão de escalas, férias ou folgas (exceto a delegação temporária de Supervisor).

## 4. Atores (cargos)

Dez cargos, em quatro níveis hierárquicos:

| Nível | Cargos |
| --- | --- |
| **Estratégico** | Diretor de Operações e Logística · Diretor-Presidente / Superintendente · Conselho de Administração |
| **Tático** | Inspetor |
| **Gestão** | Supervisor / Gerente de Operações |
| **Operacional** | Técnico em Portos · Planejador de Pátio e de Navios · Conferente de Carga · Arrumador e Consertador · Estivador |

## 5. As três camadas de visão (RF 1)

<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-card">
    <span className="nexus-card__titulo">Visão Própria</span>
    <span className="nexus-card__texto">Todos os cargos. Cada funcionário vê e interage apenas com as entidades ligadas às suas atribuições: o Estivador vê as cargas que selecionou; o Conferente, os recebimentos que lançou.</span>
  </div>
  <div className="nexus-card">
    <span className="nexus-card__titulo">Visão Operacional</span>
    <span className="nexus-card__texto">Inspetor e Supervisor. Leitura de <strong>todos</strong> os dados operacionais dos cargos inferiores (cargas, navios, contêineres, manutenções, checklists, logs e trail). <strong>Sem</strong> acesso à documentação interna de funcionários e visitantes; sem editar dados de outros cargos.</span>
  </div>
  <div className="nexus-card">
    <span className="nexus-card__titulo">Visão Estratégica</span>
    <span className="nexus-card__texto">Diretores e Conselho. Acesso total de <strong>leitura</strong> a todas as funcionalidades e dados, incluindo dashboards exclusivos, relatórios de produtividade e exportação de dados históricos.</span>
  </div>
</div>

A implementação dessas camadas tem três pontos de aplicação:

1. **Menu e rotas** — `PAGE_PERMISSIONS` em `js/auth-guard.js` (quem abre cada `.html`);
2. **Ações** — `ACTION_PERMISSIONS` em `js/auth-guard.js` (20 chaves: `LIBERAR_NAVIO`, `INSPECIONAR_CARGA`, ...);
3. **Consultas e filtros** — `js/vision-layer.js` + consultas do `js/data-repository.js` filtradas pelo
   cargo/sessão, replicadas no banco pelas políticas de RLS.

Detalhamento completo (matriz página × cargo e ação × cargo) em
[Cargos e permissões](/dominio/cargos-e-permissoes).

## 6. Entidades de domínio

| Entidade | Tabela | Pontos-chave |
| --- | --- | --- |
| Funcionário | `funcionarios` | matrícula, código individual único, cargo, ativo |
| Visitante | `visitantes` | nome, documento, motivo, entrada/saída |
| Tipo de carga | `tipos_carga` | categoria de risco, requisitos especiais, checklist vinculado |
| Checklist | `checklist_modelos` + `checklist_itens` | modelo por tipo de carga, itens críticos |
| Carga | `cargas` | 9 status, atributos obrigatórios (peso, volume, valor, natureza, tipo, porto de descarga) |
| Contêiner | `containers` | número, material, datas, estado, navio vinculado |
| Navio | `navios` | nome, IMO, estado, localização, origem/destino, tempos |
| Berço | `bercos` | 15 posições do STS-01, estado `LIVRE`/`OCUPADO`/`MANUTENCAO` |
| Guindaste | `guindastes` | número, estado, última manutenção |
| Rota marítima | `rotas_maritimas` | origem, destino, distância (ETA a 33 km/h) |
| Manutenção | `manutencoes` + `historico_manutencoes` | fluxo de aprovação do Supervisor |
| Inspeção | `inspecoes` + `inspecao_itens` | resultado, respostas, uma ativa por carga |
| Auditoria | `logs_alteracoes` | data/hora, cargo, código, entidade, tipo (inclui `EXPORTACAO`) |
| Trail | `trail_decisoes` + `retificacoes_trail` | imutável, com retificação anexada |
| Delegação | `delegacoes_supervisor` | substituto, vigência, revogação |
| Leitura de QR | `leituras_qr_code` | código, entidade, autor, data/hora |
| Emergência | `emergencias` + `panic_webhook_config` | estado global do pânico e webhook opcional |

## 7. Restrições transversais

| Restrição | Onde aparece |
| --- | --- |
| **Tudo é auditável** | `logs_alteracoes` (toda escrita) e `trail_decisoes` (ações de alto impacto, imutável) |
| **Sem notificações** | feedback é banner inline na tela; dashboards são visão geral, não painel de alarmes |
| **Terminologia do glossário** | a interface usa exclusivamente os termos da Spec ([Glossário](/dominio/glossario)) |
| **Idioma e formato** | pt-BR; datas `dd/mm/aaaa hh:mm`; moeda `R$ 1.234.567,89`; peso `t`; volume `m³` |
| **Uso em pátio** | telas operacionais funcionam em celular/tablet, alvos de toque ≥ 44 px, leitura de QR pelo navegador |
