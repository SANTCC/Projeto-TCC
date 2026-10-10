---
id: instalacao
title: Instalação
sidebar_label: Instalação
description: Pré-requisitos, clonagem do repositório, instalação das dependências Node e Python e verificação do ambiente.
---

# Instalação

O NexusPort **não tem etapa de build para rodar**: o app é HTML + Tailwind CDN + módulos JS servidos
estaticamente. As dependências Node existem para **testes, build de produção, capturas de tela e esta
documentação**; as dependências Python, para **verificação das migrações SQL em PostgreSQL real**.

---

## 1. Pré-requisitos

| Ferramenta | Versão usada no projeto | Para quê |
| --- | --- | --- |
| **Git** | qualquer recente | clonar o repositório |
| **Node.js** | 22.x (o CI usa Node 22) | testes (`jsdom`), build (Terser/clean-css), capturas (Puppeteer), Docusaurus |
| **npm** | 10.x | instalação das dependências |
| **Python 3** | 3.10+ | `tests/verify_*.py`, suíte `tests/test_python_suite.py`, CLI `nexus_cli.py` |
| **Chromium/Chrome** | recente (opcional) | `npm run lighthouse` e `npm run screenshots` (via `CHROME_PATH`) |
| **Supabase CLI** | 2.x (opcional) | `supabase db push`, `supabase functions deploy`, `supabase db reset` |

O sistema roda **sem Supabase configurado**: nesse caso o cliente entra em modo de simulação/offline e
as telas continuam navegáveis (ver [Configuração do Supabase](/primeiros-passos/configuracao-supabase)).

---

## 2. Clonar e entrar no repositório

```bash
git clone https://github.com/SANTCC/Projeto-TCC.git
cd Projeto-TCC
```

A raiz do projeto é a raiz do site: `index.html` responde em `/`, e todas as telas são arquivos `.html`
na mesma pasta, com caminhos relativos entre si.

---

## 3. Dependências do app e dos testes (raiz)

```bash
npm ci          # instala exatamente o package-lock.json versionado
```

O que entra na raiz (`devDependencies`, 7 pacotes):

| Pacote | Versão | Uso |
| --- | --- | --- |
| `jsdom` | ^30 | ambiente DOM para os 47 testes Node |
| `terser` | ^5.51 | minificação de JS (e dos `<script>` inline) no build |
| `clean-css` | ^5.3 | minificação de CSS no build |
| `lighthouse` | ^13.5 | gate de qualidade em PRs |
| `chrome-launcher` | ^1.2 | localiza/abre o Chrome para o Lighthouse |
| `puppeteer-core` | ^25.13 | capturas de tela do `about.html` |
| `pdf-lib` | ^1.17 | teste da Edge Function `relatorio-pdf` em Node |

---

## 4. Dependências das capturas de tela (opcional)

As capturas usam Tailwind, fontes e bibliotecas **vendorizadas** (sem depender de CDN) na pasta
`tools/screenshots/`, que tem o próprio `package.json`:

```bash
npm install --prefix tools/screenshots
```

---

## 5. Dependências Python (opcional)

Para as verificações que rodam em PostgreSQL real (migrações, enums, seed):

```bash
pip install pgserver psycopg2-binary
python3 -m unittest discover -s tests -p "test_python_suite.py"   # = npm run test:python
```

`pgserver` sobe um PostgreSQL local descartável; `psycopg2-binary` é o driver usado pelos scripts
`tests/verify_*.py`.

---

## 6. Dependências da documentação (este site)

O site vive em `website/` e tem o seu próprio `package.json` (Docusaurus 3 + busca local):

```bash
npm ci --prefix website        # ou: cd website && npm ci
npm run docs:start             # servidor de desenvolvimento em http://localhost:3000/docs/
npm run docs:build             # build de produção → grava em docs/
```

Detalhes de URL, `baseUrl` e deploy estão em [Build e deploy](/operacao/build-e-deploy).

---

## 7. Verificação do ambiente

```bash
npm test                # suíte completa (Node + audit XSS + Lighthouse dry + screenshots)
npm run test:build      # confere que o build de produção continua íntegro
npm start               # servidor estático em http://localhost:3000
```

:::tip Se algo falhar por falta de dependência
Os testes Node falham com `Cannot find module 'terser'` (ou `jsdom`, `clean-css`) quando a raiz não
passou por `npm ci`. É o erro mais comum em clone novo.
:::

---

## 8. Estrutura mínima para trabalhar

| Quero… | Preciso instalar |
| --- | --- |
| Abrir o app e navegar pelas telas | nada além de `npm start` (ou qualquer servidor estático) |
| Rodar os testes Node | `npm ci` na raiz |
| Build de produção (`dist/`) | `npm ci` na raiz |
| Capturas de tela / `about.html` | `npm ci` na raiz + `npm install --prefix tools/screenshots` + Chromium |
| Lighthouse | `npm ci` na raiz + Chrome/Chromium |
| Verificações SQL | `pip install pgserver psycopg2-binary` |
| Documentação (este site) | `npm ci --prefix website` |

Continua em [Configuração do Supabase](/primeiros-passos/configuracao-supabase).
