---
id: como-documentar
title: Como manter esta documentação
sidebar_label: Como manter a documentação
description: Convenções de escrita, front matter, componentes disponíveis, imagens, build e publicação deste site Docusaurus.
---

# Como manter esta documentação

Esta página é o manual de quem vai **escrever ou atualizar** a documentação técnica publicada em `/docs/`.

---

## 1. Onde ficam as coisas

```text
website/                       ← fonte do site (Docusaurus)
├── docusaurus.config.js       ← URL, baseUrl, navbar, rodapé, busca
├── sidebars.js                ← ordem das 53 páginas
├── docs/                      ← os arquivos .md (é aqui que você escreve)
│   ├── introducao.md
│   ├── primeiros-passos/  dominio/  arquitetura/  design/
│   ├── banco-de-dados/  seguranca/  operacao/  referencia/
│   └── galeria.md
├── src/css/custom.css         ← tokens e classes .nexus-* (paleta do projeto)
├── src/pages/index.js         ← home da documentação
├── static/                    ← robots.txt, imagens da documentação
└── scripts/                   ← copiar-capturas.js (prebuild) e relatorio-build.js (postbuild)
docs/                          ← SAÍDA do build (não edite à mão!)
```

:::danger `docs/` é gerado
O conteúdo de `docs/` é substituído a cada `npm run docs:build`. Nunca edite nem versione alterações
manuais lá — o que você escrever será perdido.
:::

---

## 2. Front matter

Todo arquivo começa com:

```markdown
---
id: nome-do-arquivo
title: Título completo da página
sidebar_label: Título na barra lateral
description: Uma frase para SEO e para o resumo de busca.
---
```

| Campo | Regra |
| --- | --- |
| `id` | **igual ao caminho sem `.md`** e igual ao registrado em `sidebars.js` |
| `title` | aparece no `<h1>`, no título da aba e nas buscas |
| `sidebar_label` | versão curta exibida na lateral |
| `description` | uma frase, sem ponto final obrigatório; usada em metadados |

Páginas cujo caminho na URL difere do nome do arquivo declaram `slug` (ex.: `introducao.md` usa
`slug: /introducao`).

---

## 3. Barra lateral

`sidebars.js` lista **53 IDs**. Ao criar uma página:

1. crie o `.md` com o `id` correto;
2. acrescente o ID em `sidebars.js` na categoria certa;
3. rode o build — ID fora da barra lateral **não reprova**, mas fica invisível para o leitor.

```javascript
{ type: 'category', label: 'Operação e qualidade',
  link: { type: 'doc', id: 'operacao/build-e-deploy' },
  items: [ 'operacao/build-e-deploy', 'operacao/testes', /* ... */ ] }
```

---

## 4. Componentes e classes disponíveis

O site **não usa MDX com imports** — as páginas são Markdown com HTML puro. As classes do projeto estão em
`src/css/custom.css`:

| Classe | Para quê |
| --- | --- |
| `nexus-card` / `nexus-card__titulo` / `nexus-card__texto` | cartão de destaque |
| `nexus-grid` `nexus-grid--duas` `nexus-grid--tres` | grades responsivas |
| `nexus-kpi` + `nexus-kpi__valor` / `nexus-kpi__rotulo` | número em destaque |
| `nexus-badge` `nexus-badge--success|warning|danger|info|neutro` | etiqueta de estado |
| `nexus-paleta` + `nexus-swatch*` | amostras de cor |
| `nexus-fluxo` + `nexus-fluxo__etapa(--ativa)` / `nexus-fluxo__seta` | linha de etapas |
| `nexus-figura` | figura com legenda |
| `nexus-galeria` | grade de capturas de tela |
| `nexus-timeline` | linha do tempo |
| `nexus-botao` `nexus-botao--primario` / `nexus-botao--secundario` | botão |
| `nexus-mono` | trecho monoespaçado |
| `nexus-citacao` | citação da especificação |

Exemplo real:

```html
<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-kpi">
    <div className="nexus-kpi__valor">25</div>
    <div className="nexus-kpi__rotulo">tabelas</div>
  </div>
</div>
```

Avisos usam os *admonitions* nativos do Docusaurus: `:::note`, `:::tip`, `:::info`, `:::warning`,
`:::danger`.

---

## 5. Links internos

```markdown
[Fluxo da carga](/dominio/fluxo-da-carga)          ✅ absoluto, começando por /
[Fluxo](./fluxo-da-carga.md)                       ✅ relativo
```

O build está com **`onBrokenLinks: 'throw'`**: link para página que não existe **falha o build**. Ao
renomear um arquivo, atualize todas as referências (o erro do build aponta o arquivo e a linha).

---

## 6. Imagens

| Tipo | Onde colocar | Como referenciar |
| --- | --- | --- |
| Logo, ícones, cartão social | `website/static/img/` | `/img/arquivo.png` |
| Capturas de tela das 13 telas | `about/screenshots/` (fonte única) | `/img/capturas/<arquivo>.png` |

As capturas **não** são copiadas à mão: `scripts/copiar-capturas.js` roda no `prebuild` e espelha
`about/screenshots/` em `website/static/img/capturas/`. Ao adicionar uma captura nova, rode
`npm run screenshots` antes do build.

---

## 7. Build e verificação

```bash
npm run docs:install        # dependências (npm --prefix website ci)
npm run docs:start          # servidor de desenvolvimento com recarga ao vivo
npm run docs:build          # build de produção → docs/
npm run docs:serve          # serve a saída construída
npm run docs:clear          # limpa o cache (use quando algo não atualizar)
```

O `postbuild` imprime um resumo (documentos de origem, páginas geradas, assets, tamanho de `docs/`).

Antes de publicar, confira:

| Item | Como |
| --- | --- |
| Sem links quebrados | `npm run docs:build` sem erro |
| Front matter completo | todas as páginas com `id`, `title`, `sidebar_label`, `description` |
| Página na barra lateral | ID presente em `sidebars.js` |
| Imagens existindo | abra a página e veja se as capturas carregam |
| Contagens corretas | compare com os números canônicos abaixo |

---

## 8. Números canônicos (não invente nem "arredonde")

| Grandeza | Valor |
| --- | --- |
| Páginas HTML da aplicação | **13** |
| Módulos JavaScript | **41** (14 na raiz de `js/` + 13 em `js/pages/` + 14 em `js/webmcp/`) |
| Testes Node / verificadores Python | **47** / **15** |
| Tabelas / enums / migrações | **25** / **14** / **10** |
| Ferramentas WebMCP | **72** |
| Cargos / níveis de acesso | 10 / 4 |
| Requisitos funcionais / regras de negócio | 18 / 19 |
| Capturas de tela | 30 |
| Páginas desta documentação | **53** |
| Scripts npm | 45 (40 do projeto + 5 de documentação) |

---

## 9. Publicação

O workflow `.github/workflows/docs.yml` (**exclusivo da documentação**) reconstrói e publica o site no
GitHub Pages a cada mudança em `website/**`, `about/screenshots/**` ou `about.html`:

```text
push em main → npm ci (website) → npm run docs:build com DOCS_BASE_URL calculado
             → artefato com docs/ + index.html de redirecionamento → deploy-pages
```

Ele **não** interfere em `lighthouse.yml` nem no deploy do app no Vercel. As variáveis `DOCS_URL`,
`DOCS_BASE_URL` e `DOCS_EDIT_URL` permitem publicar o mesmo site em outro domínio sem editar arquivos:
ver [Configurações e variáveis](/referencia/configuracoes).

---

## 10. Checklist de uma nova página

- [ ] Arquivo em `website/docs/<categoria>/<id>.md`
- [ ] Front matter com `id`, `title`, `sidebar_label`, `description`
- [ ] Conteúdo em **português**, com caminhos de arquivo e nomes de função **em código**
- [ ] Números conferidos com a tabela acima
- [ ] Links internos testados (`npm run docs:build`)
- [ ] ID adicionado em `sidebars.js`
- [ ] Menção no [índice de manutenção](/operacao/manutencao-e-backlog) se a página for de um assunto novo
