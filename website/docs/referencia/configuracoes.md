---
id: configuracoes
title: Configurações e variáveis
sidebar_label: Configurações e variáveis
description: Todos os arquivos de configuração do projeto e cada variável de ambiente, com valor padrão e efeito.
---

# Configurações e variáveis

Referência única dos arquivos de configuração e das variáveis de ambiente do repositório.

---

## 1. Mapa dos arquivos de configuração

| Arquivo | Escopo | Versionado? |
| --- | --- | --- |
| `js/config.js` | chave e URL do Supabase usadas pelo front-end | **não** (`.gitignore`) |
| `js/config.example.js` | modelo do anterior | sim |
| `supabase/config.toml` | CLI do Supabase: projeto, `verify_jwt` por função, seed | sim |
| `vercel.json` | deploy do app (`dist/`, `cleanUrls`) | sim — **não alterar sem necessidade** |
| `package.json` | 40 scripts do projeto | sim |
| `lighthouse/limiares.json` | categorias, páginas, exceções e rede bloqueada do gate | sim |
| `website/docusaurus.config.js` | site da documentação (URL, baseUrl, navbar, busca, prism) | sim |
| `website/sidebars.js` | ordem das 53 páginas da documentação | sim |
| `.gitignore` | ignora `js/config.js`, `dist/`, `lighthouse-report/`, `node_modules/` | sim |
| `tools/screenshots/package.json` | dependências do pipeline de capturas | sim |
| `vercel.json` / `.github/workflows/lighthouse.yml` | intocáveis por decisão do projeto | sim |

---

## 2. Front-end: `js/config.js`

Todo acesso ao banco passa por aqui — não há variável de ambiente no navegador:

```javascript
// js/config.js  (NÃO versionado)
window.NEXUS_CONFIG = {
  SUPABASE_URL: "https://<projeto>.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_<...>"
};
```

```bash
cp js/config.example.js js/config.js   # depois, preencha as credenciais
```

| Chave | Onde é lida | Observação |
| --- | --- | --- |
| `SUPABASE_URL` | `js/supabase-client.js` | também usada para montar as URLs das Edge Functions |
| `SUPABASE_ANON_KEY` | `js/supabase-client.js` | chave *publishable*; o front-end **não** usa `service_role` |

:::warning Chave publishable ≠ segurança
Ela vai para o navegador de qualquer forma. A proteção real é o RBAC nas telas + políticas RLS no banco, e
o risco aceito está em [RLS e políticas](/banco-de-dados/rls-e-politicas).
:::

---

## 3. `supabase/config.toml`

| Seção | Valor | Efeito |
| --- | --- | --- |
| `project_id` | `nexusport` | identificação local do projeto |
| `[functions.<nome>] verify_jwt` | `false` nas **6** funções | sem Supabase Auth; o gateway não exige JWT (evita 401 no preflight CORS) |
| `[db.seed] enabled` | `true` | `supabase db reset` aplica o seed localmente |
| `[db.seed] sql_paths` | `./seed.sql` | 20 usuários mock + dados de demonstração |

Funções com `verify_jwt = false`: `panic-alert`, `relatorio-pdf`, `kpis-calculo`, `despacho-embarcacao`,
`scanner-qr`, `log-acesso`.

---

## 4. Variáveis de ambiente

### 4.1 Build da documentação

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `DOCS_URL` | `https://santcc.github.io` | URL absoluta do site (sitemap, canonical, Open Graph) |
| `DOCS_BASE_URL` | `/docs/` | caminho onde o site é servido |
| `DOCS_EDIT_URL` | `https://github.com/SANTCC/Projeto-TCC/edit/main/` | prefixo dos links "edite esta página" |

```bash
DOCS_URL=https://docs.exemplo.com DOCS_BASE_URL=/ npm run docs:build
```

### 4.2 Capturas de tela e Lighthouse

| Variável | Usada por | Descrição |
| --- | --- | --- |
| `CHROME_PATH` | `tools/lighthouse-check.js` | caminho do binário do Chrome/Chromium |
| `CHROME_BIN` | `tools/lighthouse-check.js` | alternativa ao anterior |
| `LIGHTHOUSE_E…` | `tools/lighthouse-check.js` | variável interna do runner |
| `NEXUS_SCREENSHOT_VENDOR` | `tools/screenshots/vendor.js` | pasta de recursos vendorizados do pipeline de capturas |

### 4.3 Edge Functions (injetadas pelo Supabase, não definidas por você)

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | cliente administrativo dentro da função |
| `SUPABASE_SERVICE_ROLE_KEY` | chave de serviço (leitura completa no servidor) |
| `SUPABASE_SECRET_KEY` | nome novo da mesma credencial em projetos recentes |

As funções leem **as duas** formas da chave (`SERVICE_ROLE_KEY` ou `SECRET_KEY`) para funcionar nos dois
formatos de projeto.

---

## 5. Configurações fixas no código (o que não é variável)

| Item | Valor | Onde |
| --- | --- | --- |
| Porta de desenvolvimento | **3000** | `npm start` (`npx serve -l 3000 .`) |
| Duração da sessão | 12 h | `js/session-cookies.js` |
| Duração da pendência | 10 min | `js/session-cookies.js` |
| Sincronização de tempo real | 60 s + debounce de 400 ms | `js/data-repository.js` |
| Presença on-line | heartbeat de 30 s | `js/online-presence.js` |
| Velocidade das embarcações (ETA) | 33 km/h | `supabase/functions/despacho-embarcacao` |
| Limite de confirmação do WebMCP | 60 s | `js/webmcp/webmcp-core.js` |
| Máximo de chamadas WebMCP | 30 por minuto | `js/webmcp/webmcp-core.js` |
| Retenção do artefato Lighthouse | 14 dias | `.github/workflows/lighthouse.yml` |

---

## 6. Configuração do site da documentação

```javascript
// website/docusaurus.config.js (trecho)
url: process.env.DOCS_URL || 'https://santcc.github.io',
baseUrl: process.env.DOCS_BASE_URL || '/docs/',
onBrokenLinks: 'throw',
i18n: { defaultLocale: 'pt-BR', locales: ['pt-BR'] },
```

Pontos de atenção:

- `routeBasePath: '/'` — a documentação ocupa a raiz do site; a "home" é o painel de entrada em
  `src/pages/index.js`;
- `onBrokenLinks: 'throw'` — **link interno quebrado reprova o build**;
- busca local (`@easyops-cn/docusaurus-search-local`) em pt-BR;
- prism customizado em `src/theme/prism-nexus.js` (paleta do projeto);
- `trailingSlash` conforme o preset: as URLs geradas terminam em `/`.

---

## 7. Truques úteis

```bash
# instalar/atualizar dependências da documentação
npm run docs:install            # npm --prefix website ci

# subir app + documentação juntos (raiz do repositório na porta 3000)
npm start                       # app em / , documentação em /docs/

# servidor de desenvolvimento só da documentação (recarrega ao vivo)
npm run docs:start

# limpar cache do Docusaurus quando o conteúdo não atualiza
npm run docs:clear
```

| Sintoma | Causa provável | Ação |
| --- | --- | --- |
| Tela branca em `/docs/` | `baseUrl` diferente do caminho real | ajuste `DOCS_BASE_URL` e refaça o build |
| Build falha com `Docusaurus found broken links` | link interno para página inexistente | crie a página ou corrija o caminho |
| `Cannot find module 'terser'` | falta `npm ci` na raiz | instale as dependências |
| Capturas ausentes no site | `about/screenshots/` vazio | rode `npm run screenshots` |
