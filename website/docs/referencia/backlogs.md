---
id: backlogs
title: Backlogs e relatórios
sidebar_label: Backlogs e relatórios
description: Os quatro backlogs do projeto, o que cada um tratou e onde está o relatório de execução de cada item.
---

# Backlogs e relatórios

O projeto trabalha por **sessões de backlog**: cada rodada de correções vira um arquivo em `SPECs/`, com os
itens marcados como implementados e um relatório de execução correspondente. Esta página é o índice
comentado desses arquivos.

| Arquivo | Linhas | Foco |
| --- | --- | --- |
| `SPECs/backlog.md` | 315 | Backlog 001 + 002 — correções de interface e comportamento por página |
| `SPECs/backlog2.md` | 133 | (Backlog 002 de banco) — arquitetura de banco, RLS, integridade |
| `SPECs/backlog3.md` | 280 | Backlog 003 — 12 melhorias de produto + anotações de correção |
| `SPECs/backlog4.md` | 74 | Backlog 004 — performance, acessibilidade e SEO (Lighthouse) |
| `SPECs/relatorios-backlog.md` | 778 | relatórios de execução de todos os itens |

---

## 1. `backlog.md` — correções por página (001 e 002)

Estrutura: **🐞 Correções** (9 itens vermelhos) + **⚙️ Ajustes** (3 itens) + **regra de relatório de
execução**, seguidos do **Backlog 002**, organizado por página:

| Seção | Páginas cobertas |
| --- | --- |
| 0 | Regras gerais de todas as páginas (feito primeiro) |
| 1–9 | Painel Geral, Cargas & Pátio, Inspeção e Checklist, Embarcações & GPS, Manutenção & OS, Delegação, Gestão de Pessoas, Relatórios & PDF, Navbar |
| 10 | Problemas prováveis sugeridos (prioridade baixa) |
| 12 | Relatório de auditoria técnica (STS-01 Santos) |

O padrão de item é: **sintoma → página → prioridade → comportamento esperado**. É a leitura obrigatória
antes de mexer em qualquer tela que já existia.

---

## 2. `backlog2.md` — banco, segurança e integridade

22 seções agrupadas em quatro blocos:

| Bloco | Itens |
| --- | --- |
| 🔴 RLS, gatilhos e criptografia | RLS aberta (`for all using (true)`), 12 tabelas sem política, `set_updated_at()` genérico, otimização do gatilho de propagação, `pgcrypto` para hash |
| 🟠 Integridade e restrições | unicidade de navio por berço, `num_nonnulls = 1` em manutenções, motivo obrigatório em carga recusada, uma delegação ativa, validação de datas e formatos, índices em FKs |
| 🟡 Modelagem | normalização, tabela `portos`, histórico de `viagens`, operações de pátio, tipos mais fortes (`coordenadas_gps`, moeda) |
| 🟢 Auditoria e DevOps | auditoria nativa por gatilhos, tabelas append-only, JWT com *claims* para RLS, LGPD, migrações versionadas, views de dashboard |

O que foi aplicado aparece em [RLS e políticas](/banco-de-dados/rls-e-politicas) e
[Tabelas](/banco-de-dados/tabelas); o que continua aberto, em
[Manutenção e backlog](/operacao/manutencao-e-backlog).

---

## 3. `backlog3.md` — melhorias de produto (o mais recente concluído)

Encabeçado por **TODOs** com marcação ✅ nos itens entregues — **12 itens** no total:

| Item | Tema |
| --- | --- |
| ✅ | Área de gráficos (UI) |
| ✅ | Autocomplete do código no login (UX) |
| ✅ | Botão de pânico global |
| ✅ | Barra lateral fixa ao rolar |
| ✅ | **Sessão em cookies** (em vez de `sessionStorage`) |
| ✅ | **PDF no servidor** + cache no Storage |
| ✅ | Popular cargos (20 usuários mock) |
| ✅ | Popular ações (histórico anterior) |
| ✅ | Nº de usuários on-line em tempo real |
| ✅ | Cookie de rastreamento de dispositivo no GA4 |
| ✅ | Compressão de JS/CSS antes do deploy |
| ✅ | Workflow do Lighthouse para PRs |
| ✅ | Reorganização da pasta `js/` |
| ✅ | Atualização em tempo real das tabelas e indicadores |
| ✅ | Remoção de gráficos duplicados do Painel Geral |

Itens em aberto registrados no mesmo arquivo: **impedir manutenção de navio fora de Santos**,
**impedir movimentação de carga em trânsito**, **corrigir o momento em que a carga entra em trânsito** e
**scanner QR responsivo no celular** (este último depende da câmera do dispositivo).

A segunda metade traz as **anotações** com o detalhamento de três correções:

1. Autorizar o retorno de navio com a ação bloqueada;
2. Botão de pânico não pode ser acionado com o alarme já ativo;
3. Organização de palavras, informações e formatação nos cards e campos de ação (inclui a tabela de Ordens
   de Serviço).

---

## 4. `backlog4.md` — performance, acessibilidade e SEO

Originado de uma **auditoria Lighthouse**, com 11 seções em quatro eixos:

| Eixo | Itens |
| --- | --- |
| ⚡ Desempenho | 1.1 logomarca de 1 MB → redimensionar; 1.2 `width`/`height` nas imagens; 1.3 recursos que bloqueiam a renderização; 1.4 JS/CSS não utilizados; 1.5 cache de estáticos (`Cache-Control`) |
| ♿ Acessibilidade | 2.1 liberar o zoom; 2.2 contraste de texto de apoio; 2.3 ordem hierárquica de títulos |
| 🛡️ Segurança | 3.1 CSP; 3.2 cabeçalhos (HSTS, COOP, X-Frame-Options) |
| 🔍 SEO | 4.1 `meta description` em todas as páginas |

Os itens **não** implementados estão declarados como **exceções** em `lighthouse/limiares.json` e
detalhados em [Gate Lighthouse](/operacao/lighthouse) e
[Manutenção e backlog](/operacao/manutencao-e-backlog).

---

## 5. `relatorios-backlog.md` — a prova de execução

778 linhas com o relatório de cada item: o que foi alterado, em quais arquivos, quais testes rodaram e qual
foi o resultado. É o documento que se consulta quando se quer saber **por que** algo está do jeito que está.

Padrão de cada relatório:

```text
## Item N — <título>
Arquivos alterados: …
Testes executados: … (resultado)
Observações / limitações: …
```

---

## 6. Convenção para um novo item

```markdown
### <n>. <Título curto>              ← agrupar por página ou por área
- **Sintoma:** o que se observa hoje
- **Esperado:** o comportamento correto
- **Prioridade:** 🔴 Alta | 🟠 Média | 🟡 Baixa
- **Teste:** `npm run test:<assunto>` (novo ou existente)
```

Depois de implementar: marque com ✅, escreva o relatório em `relatorios-backlog.md` e atualize a página
correspondente desta documentação ([como documentar](/referencia/como-documentar)).
