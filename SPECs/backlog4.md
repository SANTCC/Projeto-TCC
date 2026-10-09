# Backlog 004 — Performance, Acessibilidade e SEO (Lighthouse Audit)

> Este backlog detalha as pendências técnicas de performance, otimização de imagens, acessibilidade (a11y) e SEO identificadas na auditoria do Google Chrome Lighthouse no sistema NexusPort.

---

## ⚡ 1. Desempenho e Otimização de Recursos

### 1.1 Redimensionamento e Otimização da Imagem da Logomarca (`logo_porto.png`)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A imagem `design/logo_porto.png` possui 1.007 KiB e dimensões originais de 1254x1254px, mas é exibida na interface reduzida para 36x36px. O arquivo deve ser redimensionado para as dimensões reais de exibição e convertido para formatos modernos como WebP ou AVIF, reduzindo mais de 1 MB de consumo de rede por carregamento de página.

### 1.2 Atributos explícitos de largura e altura (`width` e `height`) nas imagens

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As tags `<img>` nas páginas HTML (ex.: logo no cabeçalho e avatares) não possuem atributos `width` e `height` definidos explicitamente, provocando deslocamentos bruscos de layout (Cumulative Layout Shift — CLS) durante a renderização.

### 1.3 Eliminação de recursos que bloqueiam a renderização (Render-Blocking)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Os scripts e folhas de estilo externos (Tailwind CDN, Google Fonts, Supabase client e scripts de inicialização) são carregados de forma síncrona, gerando um First Contentful Paint (FCP) e Largest Contentful Paint (LCP) elevados (superiores a 4 segundos em redes 4G simuladas).

### 1.4 Redução e Minificação do JavaScript / CSS Não Utilizado

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Grande parte das regras do Tailwind CDN (`cdn.tailwindcss.com`) e funções JS não utilizadas nos primeiros segundos de navegação são carregadas integralmente, gerando consumo de mais de 240 KiB de dados desnecessários na thread principal.

### 1.5 Estratégia de cache eficiente para recursos estáticos (Cache-Control TTL)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Os arquivos estáticos locais (módulos JS e imagens) não possuem cabeçalhos `Cache-Control` configurados com TTL longo (ex.: `max-age=31536000`), exigindo re-download em visitas subsequentes.

---

## ♿ 2. Acessibilidade (A11y) e Usabilidade

### 2.1 Liberação do Zoom e Escalonamento pelo Usuário no Viewport

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** As páginas HTML possuem a meta tag `<meta name="viewport">`, contudo incluem os parâmetros `maximum-scale=1.0` e `user-scalable=no`. Essa configuração impede que usuários com baixa visão ampliem a tela, ferindo as diretrizes WCAG e Lighthouse A11y.

### 2.2 Taxa de Contraste de Cores entre Texto e Fundo

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Diversos elementos de texto de apoio e badges de status utilizam tamanhos pequenos (`10px`/`11px`) com cores de baixo contraste (`text-slate-400`, `text-slate-500` sobre fundos `bg-slate-100`/`bg-slate-800`), dificultando a leitura para usuários com deficiência visual.

### 2.3 Ordem Hierárquica Sequencial dos Títulos (`<h1>` — `<h6>`)

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Em telas como o Painel Geral, ocorrem saltos de níveis de cabeçalhos (ex.: do `<h1>` direto para `<h3>`), o que prejudica a navegação semântica por leitores de tela e tecnologias assistivas.

---

## 🛡️ 3. Segurança e Práticas Recomendadas

### 3.1 Política de Segurança de Conteúdo (Content Security Policy — CSP)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Nenhuma das páginas HTML declara cabeçalhos HTTP ou meta tags `Content-Security-Policy` para prevenir ataques de Cross-Site Scripting (XSS) e injeções de scripts de terceiros.

### 3.2 Cabeçalhos HTTP de Proteção (HSTS, COOP, X-Frame-Options)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não estão configurados os cabeçalhos de proteção de origem como `Cross-Origin-Opener-Policy` (COOP), `Strict-Transport-Security` (HSTS) e `X-Frame-Options` para mitigação de clickjacking e isolamento de contexto.

---

## 🔍 4. Otimização para Mecanismos de Busca (SEO)

### 4.1 Inclusão de Meta Description em todas as páginas HTML

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As páginas do sistema não possuem a meta tag `<meta name="description" content="...">` com o resumo do conteúdo da aplicação.
