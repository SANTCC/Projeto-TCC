---
id: lighthouse
title: Gate Lighthouse
sidebar_label: Gate Lighthouse
description: Como o gate de qualidade funciona em PRs — páginas medidas, limiares, rodadas, exceções declaradas e como rodar localmente.
---

# Gate Lighthouse

Toda PR aberta ou atualizada dispara `.github/workflows/lighthouse.yml` (já existente, **sem alterações
por esta documentação**), que builda o app e mede as páginas com o Lighthouse. O relatório é publicado como
artefato do workflow (`lighthouse-report/`, retenção de 14 dias).

```yaml
name: Lighthouse
on:
  pull_request:
    types: [opened, synchronize, reopened]   # não roda em push para main
permissions: { contents: read }
concurrency: { group: 'lighthouse-${{ github.event.pull_request.number }}', cancel-in-progress: true }
```

---

## 1. Como a medição acontece

| Item | Valor |
| --- | --- |
| Alvo | `dist/` (o **build de produção**, não o código-fonte) |
| Rede | hosts `*supabase.co*` **bloqueados** — a medição não lê nem escreve dados reais e não entra na contagem de usuários on-line |
| Rodadas | **3 por página**; a pontuação da categoria é a **mediana** |
| Auditoria crítica | reprova apenas se falhar na **maioria** das rodadas (o CI compartilhado é ruidoso) |
| Chrome | já vem instalado nas imagens `ubuntu-latest`; localmente use `CHROME_PATH` |

```bash
npm run lighthouse                                     # todas as páginas
CHROME_PATH=/usr/bin/chromium npm run lighthouse       # indicando o binário
npm run lighthouse -- --pagina index.html              # filtrar
npm run test:lighthouse                                # valida o próprio gate
```

---

## 2. Pontuações mínimas

| Categoria | Mínimo | Por quê |
| --- | --- | --- |
| `performance` | **0,60** | piso de regressão — o Tailwind CDN e os CDNs síncronos limitam o LCP (backlog 004) |
| `accessibility` | **0,75** | exigência do projeto; há exceções declaradas por página |
| `best-practices` | **0,90** | — |
| `seo` | **0,90** | — |

Os mínimos são **piso de regressão**, não meta: a dívida conhecida de performance está detalhada em
[Manutenção e backlog](/operacao/manutencao-e-backlog) e em `SPECs/backlog4.md`.

---

## 3. Páginas medidas (12)

| Arquivo | Tipo de sessão |
| --- | --- |
| `index.html` | pública |
| `confirm-role.html` | pendência (cookie `nexus_pending_auth`) |
| `dashboard.html` | sessão |
| `cargas.html` | sessão |
| `delegacao.html` | sessão |
| `embarcacoes.html` | sessão |
| `inspecao.html` | sessão |
| `manutencao.html` | sessão |
| `relatorios.html` | sessão |
| `scanner.html` | sessão |
| `tecnico_portos.html` | sessão |
| `about.html` | pública |

O `about.html` é medido **como página pública** (documentação ilustrada autocontida):
o gate injeta a sessão apropriada para cada tipo, e `teste-vibracao.html` (diagnóstico) não é medido.

---

## 4. Auditorias críticas

Reprovam o gate (fora das exceções por página) as auditorias de acessibilidade e de segurança estrutural,
entre elas:

```text
meta-viewport · label · select-name · aria-dialog-name · button-name · image-alt · link-name
document-title · html-has-lang · color-contrast · aria-required-attr · aria-valid-attr
aria-valid-attr-value · aria-allowed-attr · aria-hidden-focus · duplicate-id-aria · frame-title
input-image-alt · td-headers-attr · th-has-data-cells · tabindex · list · listitem
definition-list · dlitem · is-on-https · geolocation-on-start
```

---

## 5. Exceções declaradas (dívida conhecida)

Cada exceção traz páginas afetadas e **motivo**; devem ser removidas quando o item for corrigido:

| Auditoria | Páginas | Motivo (resumo) |
| --- | --- | --- |
| `meta-viewport` | 11 telas | `user-scalable=no` / `maximum-scale=1.0` impedem o zoom (WCAG 1.4.4) — **decisão de UX pendente** |
| `color-contrast` | 11 telas | texto secundário em cinza/slate abaixo de 4,5:1 sobre fundo claro, medido com Tailwind carregado |
| `label` | `delegacao.html`, `manutencao.html` | campos de formulário sem rótulo acessível |
| `select-name` | `cargas.html`, `inspecao.html`, `relatorios.html` | `<select>` sem nome acessível |
| `aria-dialog-name` | `manutencao.html` | diálogo sem `aria-labelledby`/`aria-label` |

:::note Exceção é dívida, não permissão
O próprio arquivo de limiares diz: *"exceções são dívida conhecida por página e devem ser removidas quando
corrigidas"*. Ao corrigir um item, remova a exceção **na mesma PR** — caso contrário o gate não protege
mais aquele ponto.
:::

---

## 6. Para bloquear o merge

Marque o check **"Lighthouse (PR)"** como obrigatório na proteção da branch `main`
(*Settings → Branches → Require status checks*). Sem isso, o gate informa, mas não impede o merge.

---

## 7. Arquivos do gate

| Arquivo | Papel |
| --- | --- |
| `.github/workflows/lighthouse.yml` | workflow do PR (artefato com os relatórios) |
| `lighthouse/limiares.json` | categorias, páginas, exceções, rede bloqueada |
| `tools/lighthouse-check.js` | executa o Lighthouse, avalia o LHR, aplica exceções e imprime a tabela |
| `tests/test_lighthouse.js` | valida o próprio gate (páginas existem, sessões válidas, exceções apontam para páginas medidas) |
| `lighthouse-report/` | saída local (no `.gitignore`) |
