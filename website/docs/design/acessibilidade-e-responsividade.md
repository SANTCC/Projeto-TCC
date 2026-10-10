---
id: acessibilidade-e-responsividade
title: Acessibilidade e responsividade
sidebar_label: Acessibilidade e responsividade
description: Breakpoints, uso no pátio, requisitos de acessibilidade, VLibras, vibração e as pendências conhecidas do backlog 004.
---

# Acessibilidade e responsividade

O sistema é usado **no pátio** — sol, chuva, luvas, celular na mão — e também em estações de trabalho.
O Design System trata isso como requisito, não como refinamento.

---

## 1. Breakpoints e comportamento

| Breakpoint | Layout |
| --- | --- |
| **≥ 1440 px** | grid de 12 colunas, container máximo 1440 px, sidebar fixa de 240 px |
| **1024–1439 px** | sidebar fixa, tabelas completas |
| **768–1023 px** | sidebar fixa ou colapsada para 64 px |
| **< 768 px** (celular no pátio) | sidebar vira **drawer**; tabelas viram **cards empilhados**; ações do cargo **fixas na parte inferior**; alvos de toque ≥ 44 px |

Regras transversais:

- **Nada de hover obrigatório** — toda ação também é acessível por toque e por foco de teclado;
- **A rolagem é do conteúdo**, não da página: no desktop o contêiner principal é limitado à viewport
  (`md:h-[calc(100vh-4rem)] md:overflow-hidden`), então a sidebar permanece fixa;
- **No celular** o menu é `fixed` com fundo escurecido que fecha ao tocar fora.

---

## 2. Acessibilidade implementada

| Requisito | Como está atendido |
| --- | --- |
| Contraste | pares principais validados (6,94:1 a 14,82:1); `--nexus-border` nunca como texto; âmbar nunca com texto branco |
| Alvos de toque | botões com altura mínima de 44 px |
| Zoom do usuário | meta viewport sem `maximum-scale`/`user-scalable=no` |
| Hierarquia de títulos | ordem sequencial `h1 → h6` revisada (backlog 004, item 2.3) |
| Textos de apoio | tamanhos e contrastes revisados onde estavam em 10–11 px com `text-slate-400` |
| Rótulo acessível | botões de ícone com `aria-label`/`title` (verificado por `test_about_page.js` na documentação ilustrada) |
| Tabelas | `thead` + `th scope` |
| Tema | alternância claro/escuro com preferência persistida |
| Libras | widget **VLibras** integrado nas telas habilitadas; regressão em `npm run test:vlibras` |
| Alertas de emergência | banner visual + vibração (`navigator.vibrate`) + áudio — com fallback quando a API não existe |

:::warning Limite da Vibration API (documentado no código)
A vibração exige contexto seguro (HTTPS/localhost), página visível e uma interação prévia do usuário
(*sticky activation*). **Safari/WebKit no iOS/iPadOS não implementa `navigator.vibrate`** — nenhum
controle HTML contorna isso. Nesses aparelhos o alarme usa som e banner visual. A página
`teste-vibracao.html` testa e explica cada caso.
:::

---

## 3. O gate de acessibilidade

O Lighthouse mede a acessibilidade de **todas as 13 páginas** em cada PR, com pontuação mínima de **0,75**
e auditorias críticas obrigatórias, exceto pelas exceções declaradas em `lighthouse/limiares.json`
(dívida conhecida, por página). Detalhes em [Gate Lighthouse](/operacao/lighthouse).

---

## 4. Pendências conhecidas (backlog 004)

Do levantamento de performance, acessibilidade e SEO (`SPECs/backlog4.md`):

| Item | Status | Resumo |
| --- | --- | --- |
| 1.1 Logomarca com 1 MB / 1254×1254 exibida em 36×36 | 🔴 não implementado | redimensionar e converter para WebP/AVIF (>1 MB economizado por carregamento) |
| 1.2 `width`/`height` explícitos nas imagens | 🔴 não implementado | evita CLS no logo e nos avatares |
| 1.3 Recursos que bloqueiam a renderização | 🔴 não implementado | Tailwind CDN, Google Fonts e supabase-js carregados de forma síncrona (LCP > 4 s em 4G simulado) |
| 1.4 JS/CSS não utilizados | 🔴 não implementado | Tailwind CDN entrega mais do que a página usa (mais de 240 KiB) |
| 1.5 Cabeçalhos de cache para estáticos | 🔴 não implementado | `Cache-Control` com TTL longo nos módulos e imagens |
| 2.1 Zoom liberado | 🟡 parcial | verificado em parte das páginas |
| 2.2 Contraste em textos de apoio/badges | 🟡 parcial | pequenos tamanhos com cores de baixo contraste |
| 2.3 Ordem de títulos | 🟡 parcial | correções aplicadas nas telas revisadas |

Esses itens são o caminho natural para levantar a pontuação de `performance` acima do piso de regressão
hoje configurado (0,6).

---

## 5. Como verificar acessibilidade localmente

```bash
npm run lighthouse                       # mede dist/ (todas as páginas, 3 rodadas, mediana)
CHROME_PATH=/usr/bin/chromium npm run lighthouse -- --pagina index.html
npm run test:lighthouse                  # valida o próprio gate (limiares e exceções)
npm run test:vlibras                     # widget de Libras
npm run test:about                       # rótulos acessíveis e estrutura do about.html
```

Checklist manual rápido para telas novas:

- [ ] navegação completa por teclado (Tab/Shift+Tab) sem armadilhas de foco;
- [ ] todo botão de ícone tem rótulo acessível;
- [ ] contraste ≥ 4,5:1 em texto normal e ≥ 3:1 em texto grande e ícones;
- [ ] alvos de toque ≥ 44×44 px;
- [ ] estados de erro anunciados junto ao campo (não só por cor);
- [ ] `lang="pt-BR"` e títulos de página únicos.
