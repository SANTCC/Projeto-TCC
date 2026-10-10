---
id: design-system
title: Design System
sidebar_label: Visão geral
description: Tokens de cor, tipografia, escala, contraste WCAG e as regras de aplicação do Design System NexusPort v2.0.
---

# Design System NexusPort v2.0

> Fonte: `SPECs/design/design.md` (297 linhas). Esta página reproduz os tokens e as regras; os componentes
> estão em [Componentes](/design/componentes) e as telas em [Telas-chave](/design/telas-chave).

**Contexto de uso que condiciona o design:** sistema **web interno**, acessado só por funcionários no
porto. Implicações diretas:

- **Uso em pátio com celular/tablet** — telas operacionais precisam funcionar em telas pequenas, com alvos
  de toque grandes, sem app nativo (a leitura de QR é pelo navegador);
- **Sem notificações instantâneas** (não-requisito 5) — o retorno é **mensagem inline**; os dashboards são
  visão geral operacional, **não** painel de alarmes;
- **Tudo é auditável** — toda ação crítica exige confirmação explícita e identifica cargo + código;
- **Terminologia** — usar exclusivamente os termos do glossário da Spec.

---

## 1. Tipografia

| Papel | Fonte | Peso | Uso |
| --- | --- | --- | --- |
| Títulos | **Montserrat** | 700 | títulos de página, seções, cards de dashboard |
| Subtítulos | **Montserrat** | 600 | hierarquia intermediária, nomes de entidades |
| Texto corrido | **Inter** | 400 | parágrafos, descrições, labels |
| Dados | **Inter** | 500 | tabelas, valores, metadados |
| Ênfase | **Inter** | 600–700 | negrito em texto, ações em lista |
| Monoespaçada | **JetBrains Mono** | 500 | códigos individuais, número de contêiner, IMO, coordenadas GPS, timestamps de log |

**Escala (base 16 px):**

| Token | Fonte | Tamanho | Peso | Uso |
| --- | --- | --- | --- | --- |
| `display` | Montserrat | 32px | 700 | valores grandes de dashboard |
| `h1` | Montserrat | 28px | 700 | título de página |
| `h2` | Montserrat | 24px | 700 | título de seção |
| `h3` | Montserrat | 20px | 600 | título de card/bloco |
| `h4` | Montserrat | 18px | 600 | subseção |
| `body` | Inter | 16px | 400 | texto padrão |
| `body-sm` | Inter | 14px | 400 | texto secundário |
| `caption` | Inter | 12px | 500 | metadados, timestamps, ajuda |

Line-height **1,5** no texto e **1,2** nos títulos. Montserrat **só** em títulos; Inter **nunca** em
título de página.

---

## 2. Paleta de cores

### 2.1 Cores principais (identidade)

<div className="nexus-paleta">
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#1E293B'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-900</span><span className="nexus-swatch__hex">#1E293B</span><span className="nexus-swatch__uso">Sidebar, fundo de login, cabeçalho de tabela, rodapé de relatórios</span></div></div>
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#445987'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-500</span><span className="nexus-swatch__hex">#445987</span><span className="nexus-swatch__uso">Botões primários, links, abas ativas, gráficos primários</span></div></div>
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#E1E5ED'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-border</span><span className="nexus-swatch__hex">#E1E5ED</span><span className="nexus-swatch__uso">Bordas, divisores, linhas de tabela, estados inativos — nunca texto</span></div></div>
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#F5F7FA'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-bg</span><span className="nexus-swatch__hex">#F5F7FA</span><span className="nexus-swatch__uso">Fundo de página, linhas zebradas, seções de respiro</span></div></div>
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#222222'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-text</span><span className="nexus-swatch__hex">#222222</span><span className="nexus-swatch__uso">Texto principal sobre fundos claros</span></div></div>
  <div className="nexus-swatch"><div className="nexus-swatch__cor" style={{background: '#FFFFFF'}}></div><div className="nexus-swatch__info"><span className="nexus-swatch__token">--nexus-white</span><span className="nexus-swatch__hex">#FFFFFF</span><span className="nexus-swatch__uso">Cards, modais, inputs; texto sobre superfícies escuras</span></div></div>
</div>

| Token | Hex | Papel |
| --- | --- | --- |
| `--nexus-500-hover` | `#3A4A73` | hover de botões/links primários |
| `--nexus-500-active` | `#30405F` | estado pressionado |
| `--nexus-900-soft` | `#1E293B` @ 8% | hover de linhas, fundo de seleção sutil |
| `--nexus-800` | `#2A3B53` | hover da sidebar, bordas sobre fundo escuro (usado nos protótipos `THEME/`) |
| `--nexus-400` | `#5C74A8` | azul de apoio |
| `--nexus-100` / `--nexus-50` | `#E8EDF5` / `#F5F7FA` | superfícies suaves |

### 2.2 Cores semânticas

| Token | Hex | Significado operacional |
| --- | --- | --- |
| `--success` | `#2E7D32` | concluído, operante, aprovado, entregue |
| `--warning` | `#D97706` | em andamento, aguardando, agendado, atenção |
| `--danger` | `#C62828` | recusado, cancelado, bloqueado, crítico não conforme |
| `--info` | `#445987` | neutro informativo (reutiliza o azul primário) |
| `--warning-strong` | `#B45309` | diferencia "em reforma" de "agendado" |
| `--success-escuro` | `#1B5E20` | `NO_PORTO_DE_DESTINO` |

Derivações permitidas: tons a **8–12%** de opacidade para fundos de badges e alertas.

### 2.3 Contraste (WCAG)

| Combinação | Razão | Nível |
| --- | --- | --- |
| `#222222` sobre `#F5F7FA` | 14,82:1 | AAA |
| `#1E293B` sobre `#FFFFFF` | 14,63:1 | AAA |
| branco sobre `#1E293B` | 14,63:1 | AAA |
| branco sobre `#445987` | 6,94:1 | AA |
| branco sobre `--success` | 5,22:1 | AA |
| branco sobre `--warning` | 3,31:1 | ⚠️ usar texto `#222222` em badges âmbar, ou âmbar só em ícones/bordas |
| branco sobre `--danger` | 6,12:1 | AA |
| `--nexus-border` como texto | 1,26:1 | ❌ **nunca usar como texto** |

---

## 3. Formas, espaço e sombra

| Item | Valor |
| --- | --- |
| **Grid** | 12 colunas, gutter 24 px, container máximo 1440 px |
| **Espaçamento** | múltiplos de 4 px (4, 8, 12, 16, 24, 32, 48, 64) |
| **Radius** | 4 px (tags) · 8 px (botões, inputs) · 12 px (cards, modais) · 16 px (painéis) |
| **Sombra de card** | `0 1px 3px rgba(30, 41, 59, .08)` (opcional) |
| **Breakpoints** | 576 / 768 / 1024 / 1440 px |

---

## 4. Badges de status

Padrão: fundo = cor @ 12%, texto = cor sólida, `radius: 999px`, Inter 600 12px, padding `4px 10px`, texto
sempre em caixa normal (ex.: `Armazenado`, `Em trânsito`).

<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-card"><span className="nexus-badge nexus-badge--info">Agendado</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--neutro">Recebido</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--warning">Em inspeção</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--danger">Recusado</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--neutro">Armazenado</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--destaque">Pronto para entrega</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--success">Liberado / Saída do porto</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--warning">Em trânsito</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--success">Entregue</span></div>
  <div className="nexus-card"><span className="nexus-badge nexus-badge--danger">Cancelado</span></div>
</div>

Os tokens de status completos (carga, navio/contêiner, localização, manutenção) estão em
[Fluxo da carga](/dominio/fluxo-da-carga#3-cores-e-badges-dos-estados).

---

## 5. Navegação e layout

- **Sidebar** — 240 px, colapsável para 64 px; fundo `#1E293B`; itens em branco @ 70%; item ativo com fundo
  `#445987` e texto branco; **menu filtrado por cargo** (cada funcionário vê apenas as funcionalidades da
  sua visão);
- **Topbar** — 64 px, fundo branco, borda inferior `#E1E5ED`; à esquerda o contexto da tela (Montserrat 600,
  `#1E293B`); à direita, cargo + código individual (monoespaçado, caption) e sair;
- **Conteúdo** — fundo `#F5F7FA`, páginas com título `h1` e a ação principal no canto superior direito.

---

## 6. Ícones

Família **Lucide** ou **Phosphor**, traço de 1,5–2 px: âncora (navio), caixa/contêiner, guindaste,
guindaste-com-aviso (manutenção), checklist, QR Code, usuário-tie (visitantes), escudo (inspetor),
gráficos (diretor). Cor padrão `#1E293B` sobre claro; branco sobre `#1E293B`.

O sistema usa **Lucide** por CDN (`unpkg.com/lucide`) com `<i data-lucide="nome">`.

---

## 7. Formatação de dados

| Tipo | Formato | Exemplo |
| --- | --- | --- |
| Data/hora | `dd/mm/aaaa hh:mm` no fuso local do porto | `07/10/2026 14:35` |
| Duração | `Xd Xh` | `3d 4h` |
| Dinheiro | `R$ 1.234.567,89` | — |
| Peso | toneladas | `25 t` |
| Volume | metros cúbicos | `40 m³` |
| Coordenadas | monoespaçada | `-23.9812°, -46.2978°` |
| IMO e nº de contêiner | monoespaçado, sempre visível em fichas e tabelas | `IMO9990001`, `NX-2026-0042` |

---

## 8. Modo escuro (fase 2)

Fora do escopo inicial, mas implementado e testado:

| Papel | Cor |
| --- | --- |
| Fundo | `#0F172A` |
| Superfícies | `#1E293B` |
| Texto | `#F5F7FA` |
| Primário clareado | `#5B70A3` |

A preferência fica em `localStorage.nexus_theme` e é aplicada **antes do render** pelo `auth-guard.js`.
Captura disponível: `about/screenshots/mat-0000-dashboard-tema-escuro.png`.

---

## 9. Validações já respondidas

O documento original deixou quatro pontos em aberto; o sistema implementado resolve assim:

| Pendência original | Situação atual |
| --- | --- |
| Papéis das cores principais | aplicados como especificado (sidebar/login `#1E293B`, ação primária `#445987`) |
| Cores semânticas | adotadas as propostas (`#2E7D32` / `#D97706` / `#C62828`) e usadas nos badges |
| Modo escuro | implementado como fase 2, com os tokens acima |
| Família de ícones | **Lucide**, via CDN |
