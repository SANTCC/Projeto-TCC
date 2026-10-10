---
id: documentacao-ilustrada
title: Documentação ilustrada (about.html)
sidebar_label: Documentação ilustrada
description: O about.html gerado a partir de capturas reais, o PostgREST simulado, as três contas de demonstração e como regerar tudo.
---

# Documentação ilustrada (`about.html`)

`about.html` é uma página **autocontida** (82 kB) que explica como o sistema funciona — fluxo operacional,
arquitetura, perfis e camadas de visão, regras de negócio e o passo a passo de implantação — **com capturas
de tela reais** de todas as páginas, abertas pelas contas de demonstração, e **ilustrações unDraw** nos
pilares e na seção de arquitetura.

:::danger Não edite `about.html` à mão
O arquivo é **gerado** por `tools/screenshots/gerar-about.js`. O teste `npm run test:about` compara o
arquivo com o que o gerador produz e reprova qualquer edição manual.
:::

---

## 1. Como as capturas são produzidas

```text
npm install --prefix tools/screenshots          # Tailwind, fontes e libs vendorizadas
CHROME_PATH=/usr/bin/chromium npm run screenshots   # → about/screenshots/*.png + manifest.json
npm run about                                    # → about.html
```

O Chromium é dirigido por `tools/screenshots/capturar.js`, que:

1. sobe um **servidor HTTP local** com a raiz do repositório;
2. substitui `js/config.js` (em memória) pelo endereço de um **PostgREST simulado**
   (`tools/screenshots/mock-postgrest.js`) alimentado por dados fictícios
   (`tools/screenshots/demo-data.js`);
3. responde os **CDNs** (Tailwind, fontes, supabase-js, Chart.js, QRCode, jsPDF, html5-qrcode, VLibras) com
   arquivos **vendorizados** (`tools/screenshots/vendor.js`), sem depender de rede;
4. percorre o catálogo de telas (`tools/screenshots/paginas.js`) e, para **cada conta**, faz o fluxo real:
   login → confirmação de cargo → navegação apenas pelas telas liberadas ao cargo (matriz de
   `js/auth-guard.js`), salvando um PNG de **página inteira** por tela.

**Nada é gravado no banco e nenhuma credencial real é usada.**

---

## 1.1 Ilustrações unDraw

O `about.html` usa **14 ilustrações SVG** da biblioteca [unDraw](https://undraw.co/) (licença livre, uso
comercial permitido, sem atribuição obrigatória — os créditos aparecem no selo do topo da página):

| Pasta | Conteúdo |
| --- | --- |
| `design/undraw/` | `authentication`, `deliveries`, `inspection`, `logistics`, `dashboard`, `security`, `qr-code-scan`, `container-ship`, `teamwork`, `server`, `secure-server`, `cloud-sync`, `ai-code-generation`, `source-code` |

São referenciadas como **`<img src="design/undraw/<arquivo>.svg">`** (não inline), com `alt` descritivo,
`width`/`height` explícitos e `loading="lazy"` — coerente com o backlog 004 (1.2). O gerador recebe cada
pilar da página com seu ícone e texto alternativo, o que mantém o `about.html` sempre reproduzível a partir
do código: nada é colado à mão.

---

## 2. As três contas

| Matrícula | Cargo | Visão | O que ilustra |
| --- | --- | --- | --- |
| `MAT-0000` | Diretor-Presidente / Superintendente | Estratégica | dashboards, gráficos, exportação, tema escuro |
| `MAT-2011` | Supervisor / Gerente de Operações | Operacional | liberação, manutenção, delegação, checklist carregado |
| `MAT-9999` | Técnico em Portos | Própria | gestão de pessoas, telas operacionais |

---

## 3. O que é capturado

| Grupo | Arquivos |
| --- | --- |
| Telas públicas | `publico-login*.png` (3 estados), `publico-teste-vibracao.png` |
| Confirmação de cargo | `MAT-0000-`, `MAT-2011-`, `MAT-9999-confirmacao-cargo.png` |
| Por conta (10 telas) | dashboard, cargas, inspeção, scanner, embarcações, manutenção, delegação, técnico, relatórios (+ estados extras) |
| Estado extra | `mat-2011-inspecao-checklist-carregado.png`, `mat-0000-dashboard-tema-escuro.png` |
| Total | **30 PNGs** + `manifest.json` |

Tamanho padrão: 1440×900, tema claro, página inteira. O `manifest.json` registra a origem de cada captura
(ambiente, dados, conta, tela, arquivo HTML).

---

## 4. O manifesto

```json
{
  "geradoEm": "2026-10-10T21:43:59.806Z",
  "descricao": "Capturas de tela do NexusPort por conta de demonstração...",
  "ambiente": {
    "servidor": "HTTP local (raiz do repositório) + PostgREST simulado",
    "supabase": "nenhuma conexão com o Supabase",
    "recursos": "Tailwind, fontes e bibliotecas vendorizados; VLibras e Realtime não carregados",
    "dados": "fictícios, derivados do seed de demonstração"
  },
  "tamanho": { "largura": 1440, "altura": 900, "tema": "claro" },
  "publicas": [ … ],
  "contas": [ … ]
}
```

---

## 5. Onde ficam os arquivos

| Caminho | Papel |
| --- | --- |
| `about/screenshots/*.png` + `manifest.json` | **fonte única** das capturas (versionada) |
| `about/relatorio_correcao_loop_requisicoes.md` | relatório técnico movido para cá com o restante do material do `about.html` |
| `about.html` | página gerada |
| `website/static/img/capturas/` | espelho usado pelo **site da documentação** (criado por `scripts/copiar-capturas.js`, fora do Git) |
| `docs/img/capturas/` | cópias publicadas com a documentação |

:::note Por que as capturas saíram de `docs/`
A pasta `docs/` passou a ser a **saída do site Docusaurus**. Para não misturar material de documentação
ilustrada com a saída do gerador, todo o conteúdo antigo de `docs/` foi movido para `about/`, com os
caminhos atualizados em `about.html`, `tools/screenshots/*` e `tests/test_about_page.js`.
:::

---

## 6. Testes

| Suíte | O que valida |
| --- | --- |
| `npm run test:screenshots` | dados de demonstração, PostgREST simulado (filtros, `or`, `not.in`), catálogo de telas em sincronia com a matriz de permissões |
| `npm run test:about` | estrutura, conteúdo, imagens em disco, links internos, rótulos acessíveis, tabelas com cabeçalho, alternância de tema, lightbox e **igualdade com o gerador** |

Estados atuais: **33 verificações, todas aprovadas**.

---

## 7. Quando regerar

- Mudou uma tela (`*.html` ou `js/pages/*.js`)? Regenere as capturas e o `about.html`;
- Mudou o conjunto de telas ou as permissões? Atualize `tools/screenshots/paginas.js` e rode
  `npm run test:screenshots`;
- Mudou o visual? As capturas do site da documentação são atualizadas automaticamente no próximo
  `npm run docs:build` (o script `copiar-capturas.js` roda no `prebuild`).
