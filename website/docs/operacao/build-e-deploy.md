---
id: build-e-deploy
title: Build e deploy
sidebar_label: Build e deploy
description: O build de produção (Terser + clean-css), o deploy no Vercel e no GitHub Pages, e o build desta documentação para /docs/.
---

# Build e deploy

O projeto tem **dois builds independentes**: o do **app** (minificação para `dist/`) e o desta
**documentação** (Docusaurus para `docs/`).

---

## 1. Build do app (`npm run build`)

`tools/build.js` gera `dist/` a partir da raiz:

| Etapa | Ferramenta | Detalhe |
| --- | --- | --- |
| JS (`js/**/*.js` e `<script>` inline das páginas) | **Terser** | `compress.passes: 2`, `mangle.keep_fnames`, `keep_fnames`, sem comentários |
| CSS (`*.css` e `<style>` inline) | **clean-css** | nível 1 — sem reescrever regras |
| HTML, imagens e demais estáticos | cópia | **os caminhos não mudam**: `js/xxx.js` continua válido |
| Tailwind | — | continua vindo do CDN em tempo de execução (sem etapa de build) |

**Nunca vão para a saída** (em qualquer nível):

```text
node_modules  .git  .github  .vercel  dist  tests  tools  SPECs  supabase  THEME
lighthouse  lighthouse-report  docs  website
```

Além disso, todos os arquivos `.md` e `.py` são descartados e, na raiz, `package.json`,
`package-lock.json`, `vercel.json`, `.gitignore`, `.vercelignore`.

```bash
npm run build     # gera dist/ e mostra o tamanho antes/depois
npm run test:build
```

O `test:build` verifica: saída completa (13 páginas + 41 módulos), JS/CSS menores que a origem e com
sintaxe válida, nenhuma referência local quebrada, mesmos `id=` e mesmos blocos inline, ausência de arquivos
de desenvolvimento, proteção contra saída igual à raiz, execução real do código minificado (página
`dashboard.html` monta cabeçalho e presença) e **determinismo** (dois builds seguidos geram arquivos
idênticos).

---

## 2. Deploy do app

### Vercel (`vercel.json`)

```json
{
  "version": 2,
  "name": "nexusport",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "routes": [{ "src": "/(.*)", "dest": "/$1" }]
}
```

O projeto **já existente** de Vercel não foi alterado: ele publica `dist/` gerado pelo mesmo comando do
build local.

### GitHub Pages

O app é estático e serve diretamente do repositório (`SPECs/agents.md` exige GitHub Pages como hospedagem,
sem Vercel/Netlify *na especificação original* — o `vercel.json` é a alternativa usada em desenvolvimento).
Publicar a raiz do repositório entrega o app em `/` e a documentação em `/docs/`.

### Desenvolvimento local

```bash
npm start        # npx serve -l 3000 .   → app em / , documentação em /docs/
```

---

## 3. Build da documentação (`npm run docs:build`)

O site vive em `website/` (fonte) e é publicado em `docs/` (saída) com `baseUrl: /docs/`:

```bash
npm ci --prefix website       # instala Docusaurus (primeira vez)
npm run docs:start            # servidor de desenvolvimento (recarrega ao vivo)
npm run docs:build            # build de produção → grava em docs/
npm run docs:serve            # serve a saída já construída
```

O que `npm run docs:build` faz por baixo:

```bash
npm --prefix website run build
  ├─ prebuild  → node scripts/copiar-capturas.js   (about/screenshots/ → website/static/img/capturas/)
  ├─ build     → docusaurus build --out-dir ../docs
  └─ postbuild → node scripts/relatorio-build.js   (resumo do que foi gerado)
```

### URL e `baseUrl`

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `DOCS_URL` | `https://santcc.github.io` | URL absoluta (sitemap, canonical, OG) |
| `DOCS_BASE_URL` | `/docs/` | caminho do site dentro do host |
| `DOCS_EDIT_URL` | `https://github.com/SANTCC/Projeto-TCC/edit/main/` | links "edite esta página" |

```bash
# publicar em um project page do GitHub Pages (https://org.github.io/Projeto-TCC/docs/)
DOCS_URL=https://santcc.github.io DOCS_BASE_URL=/Projeto-TCC/docs/ npm run docs:build

# publicar em um domínio próprio, na raiz
DOCS_URL=https://docs.nexusport.exemplo DOCS_BASE_URL=/ npm run docs:build
```

:::tip Por que o padrão é `/docs/`
O build versionado em `docs/` é coerente para quem serve a **raiz do repositório** por HTTP — o mesmo
caminho usado por `npm start` e pelo deploy de branch do GitHub Pages. Em um *project page* (site
publicado sob `/nome-do-repo/`), ajuste `DOCS_BASE_URL` como no exemplo acima.
:::

---

## 4. Publicação da documentação no GitHub Pages (workflow isolado)

`.github/workflows/docs.yml` — **novo**, exclusivo da documentação. Ele **não** toca em `lighthouse.yml`,
`vercel.json` nem em qualquer deploy existente:

```yaml
name: Docs
on:
  push:
    branches: [main]
    paths: ['website/**', 'about/screenshots/**', 'about.html', '.github/workflows/docs.yml']
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: docs-pages, cancel-in-progress: true }
jobs:
  build:
    steps: checkout → setup-node 22 → npm ci --prefix website
           → DOCS_BASE_URL=/${repo}/docs/ npm run docs:build
           → monta _site/ com docs/ + index.html de redirecionamento
           → actions/upload-pages-artifact (path: _site)
  deploy:
    needs: build
    steps: actions/deploy-pages@v4
```

Como funciona o caminho `/docs/` no Pages: o artefato publicado contém `_site/docs/**` (o site) e um
`_site/index.html` mínimo que redireciona para `./docs/`. Assim a URL final é
`https://<org>.github.io/<repo>/docs/`, independentemente do nome do repositório — a variável
`DOCS_BASE_URL` é calculada no próprio workflow.

---

## 5. Gate Lighthouse (PRs)

`.github/workflows/lighthouse.yml` (já existente, **intocado**) roda `npm ci` e `npm run lighthouse` em
todo PR, publicando o relatório como artefato. Detalhes em [Gate Lighthouse](/operacao/lighthouse).

---

## 6. Resumo de comandos

| Comando | O que faz | Saída |
| --- | --- | --- |
| `npm start` | serve o repositório na porta 3000 | app + docs |
| `npm run build` | minifica o app | `dist/` |
| `npm run docs:start` | Docusaurus em modo desenvolvimento | — |
| `npm run docs:build` | build da documentação | `docs/` |
| `npm run docs:serve` | serve a documentação já construída | — |
| `npm test` | suíte completa de testes | console |
| `npm run lighthouse` | gate de qualidade | `lighthouse-report/` |
