---
id: frontend
title: Front-end
sidebar_label: Front-end
description: HTML + Tailwind CDN + JavaScript vanilla — organização, layout persistente, tema, feedback e as convenções obrigatórias do projeto.
---

# Front-end

O front-end é **HTML5 + Tailwind CSS (CDN) + JavaScript vanilla (ES6)**, sem bundler e sem framework. Cada
tela é um arquivo `.html` na raiz do repositório, com o comportamento em um módulo de `js/pages/`.

---

## 1. Anatomia de uma página

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NexusPort — Cargas &amp; Pátio</title>

  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: {
          nexus: { 900: '#1E293B', 800: '#2A3B53', 500: '#445987', 400: '#5C74A8',
                   100: '#E8EDF5', 50: '#F5F7FA', border: '#E1E5ED' },
          status: { success: '#2E7D32', warning: '#D97706', danger: '#C62828' }
        },
        fontFamily: {
          sans: ['Inter', 'sans-serif'],
          display: ['Montserrat', 'sans-serif'],
          mono: ['JetBrains Mono', 'monospace']
        }
      } }
    };
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="bg-[#F5F7FA] text-[#222222] font-sans antialiased">
  <!-- conteúdo -->
  <script src="js/security.js"></script>
  <script src="js/session-cookies.js"></script>
  <script src="js/supabase-client.js"></script>
  <script src="js/auth-guard.js"></script>
  <script src="js/layout.js"></script>
  <script src="js/data-repository.js"></script>
  <script src="js/vision-layer.js"></script>
  <script src="js/pages/cargas.js"></script>
</body>
</html>
```

O Tailwind é configurado **inline** com os tokens do Design System exatamente como nos protótipos de
`THEME/` — é o que mantém a identidade consistente entre protótipo e sistema.

---

## 2. ordem de carregamento dos scripts

A ordem importa: cada módulo depende do anterior.

```
security.js         → nexusEsc / nexusJsArg / nexusSafeUrl (usado por todos)
session-cookies.js  → leitura/gravação dos cookies de sessão
supabase-client.js  → cria o cliente e os utilitários de resiliência
auth-guard.js       → sessão, RBAC, tema salvo, vigia de 60 s
layout.js           → monta sidebar/topbar, modal, feedback, presença
data-repository.js  → repositório central + assinatura Realtime
vision-layer.js     → filtros por camada de visão
pages/<tela>.js     → controlador específico
webmcp/*            → depois dos anteriores (tools da página)
```

As telas públicas (`index.html`, `confirm-role.html`) carregam apenas `security`, `session-cookies`,
`supabase-client` e o respectivo controlador — elas **não** carregam o guard (não há sessão ainda).

---

## 3. Layout persistente

`js/layout.js` injeta a mesma moldura em todas as páginas internas:

- **Sidebar** (240 px, colapsável para 64 px): fundo `#1E293B`, itens em branco a 70%, item ativo com fundo
  `#445987`, menu **filtrado por cargo** (cada um vê só as funcionalidades da sua camada) e o bloco do
  usuário no rodapé (nome + `CARGO #CÓDIGO` em monoespaçada);
- **Topbar** (64 px): fundo branco, borda inferior `#E1E5ED`, contexto da tela em Montserrat 600 e, à
  direita, cargo + código individual, contador de usuários on-line, alternância de tema e sair;
- **Botão de pânico** acessível em todas as telas;
- **Modal de confirmação** (`nexusConfirm`) e **feedback inline** (`mostrarFeedback`).

No desktop, o contêiner principal é limitado à viewport (`md:h-[calc(100vh-4rem)] md:overflow-hidden`), de
modo que só o `<main>` rola e a sidebar fica grudada. No celular, a sidebar vira **drawer** com fundo
escurecido que fecha ao tocar fora.

---

## 4. Tema claro/escuro

- A preferência vive em `localStorage.nexus_theme` (`light` | `dark`).
- O `auth-guard.js` aplica a classe `dark` em `document.documentElement` **antes** do render, evitando o
  "flash" de tema errado.
- Tokens do modo escuro (fase 2 do Design System): fundo `#0F172A`, superfícies `#1E293B`, texto `#F5F7FA`,
  primário clareado `#5B70A3`.

---

## 5. Bibliotecas de terceiros (todas por CDN)

| Biblioteca | Uso | Onde |
| --- | --- | --- |
| **Tailwind CSS** | estilos utilitários | todas as páginas |
| **Lucide** | ícones (âncora, caixa, guindaste, checklist, QR, escudo, gráficos) | todas as páginas |
| **Chart.js** | gráficos dos dashboards | `dashboard.html` |
| **qrcode.js** | geração do QR Code em tempo real | `cargas.html` |
| **html5-qrcode** | leitura por câmera | `scanner.html` |
| **jsPDF** | etiquetas 10×10 cm e PDF no cliente | `cargas.html` (o relatório A4 migrou para o servidor) |
| **VLibras** | acessibilidade em Libras | telas com o widget habilitado |
| **@supabase/supabase-js** | banco, realtime, storage, funções | todas as telas internas |

Nenhuma dessas dependências é *bundled*: são carregadas do CDN em tempo de execução (nas capturas de tela
elas são **vendorizadas** por `tools/screenshots/vendor.js`).

---

## 6. Convenções obrigatórias

1. **Sempre codificar saída antes de `innerHTML`:**

   ```javascript
   const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
   tabela.innerHTML = linhas.map((c) => `<td>${esc(c.nome)}</td>`).join('');
   ```

2. **Sempre validar permissão pelo guard**, nunca por `if (cargo === ...)` escrito à mão:
   `NexusAuth.hasPermission('LIBERAR_CARGO')`.
3. **Sempre filtrar por camada de visão** ao montar dados para telas de cargo operacional
   (`NexusVision`), para não vazar dados de outro funcionário.
4. **Datas e números no padrão do projeto**: `dd/mm/aaaa hh:mm`, `R$ 1.234.567,89`, `t`, `m³`,
   coordenadas `-23.9812°, -46.2978°` em monoespaçada.
5. **Nada de dados fictícios hardcoded** em telas: o módulo `data-repository.js` tem `ENABLE_MOCKS = false`
   exatamente para impedir fallback inventado.
6. **Feedback por banner inline**; nunca `alert()` para fluxo normal, nunca toast persistente.

---

## 7. Acessibilidade e uso no pátio

| Requisito | Como é atendido |
| --- | --- |
| Alvos de toque ≥ 44 px | botões com altura mínima de 44 px |
| Sem hover obrigatório | toda ação também acessível por toque/foco |
| Contraste | paleta validada no Design System (razões de 6,9:1 a 14,8:1 nos pares principais) |
| Zoom liberado | meta viewport sem `user-scalable=no` (corrigido no backlog 004, item 2.1) |
| Títulos em ordem | hierarquia `h1 → h6` revisada no backlog 004 (item 2.3) |
| Libras | widget VLibras testado em `npm run test:vlibras` |

Pendências conhecidas de performance e a11y estão listadas em
[Manutenção e backlog](/operacao/manutencao-e-backlog) e no gate Lighthouse
([página dedicada](/operacao/lighthouse)).
