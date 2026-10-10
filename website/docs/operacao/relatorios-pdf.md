---
id: relatorios-pdf
title: Relatórios em PDF
sidebar_label: Relatórios em PDF
description: Como o relatório A4 é gerado no servidor, o cache por SHA-256 no Storage, a auditoria de exportação e o teste da função.
---

# Relatórios em PDF

O relatório de carga (RF 11) é gerado **no servidor**, pela Edge Function `relatorio-pdf`, e não mais no
navegador. A mudança veio do backlog 3, item B — *"PDF renderizado no lado do servidor ao invés do lado do
cliente + cache/armazenamento no Supabase Storage"*.

---

## 1. Contrato

```text
POST /functions/v1/relatorio-pdf
Content-Type: application/json

{ "carga_id": "<uuid>", "codigo_individual": "<código>" }

→ 200 application/pdf   (binário do relatório A4)
→ 4xx JSON              { erro, codigo }
```

- O navegador envia **apenas o identificador** da carga e a identidade do operador;
- O servidor lê **todos os valores** no banco com a chave de serviço;
- A função valida **funcionário ativo** e **cargo** (o mesmo cargo que pode abrir `relatorios.html`);
- `window.nexusRelatorioGerarPdf` continua existindo no front-end e devolve `true` ou `false`;
- A ferramenta WebMCP `gerar_relatorio_carga` responde `FALHA_PDF` quando a emissão falha.

---

## 2. Estrutura do documento

Formato **A4** (margens de 20 mm), com as fontes embutidas e as **quatro seções sequenciais** do RF 11:

| Seção | Conteúdo |
| --- | --- |
| 1. Dados da Carga | tipo, quantidade, peso, volume, valor declarado, natureza |
| 2. Dados do Navio | nome, número IMO, porto de origem, porto de destino |
| 3. Dados do Contêiner | número de identificação, tipo de carga, estado |
| 4. Resumo do Fluxo | status, datas de entrada/saída, porto de descarga, motivo de recusa (se houver) |

- Cabeçalho: logotipo + "NexusPort — Relatório de Carga" + nº da carga;
- Rodapé: **código individual de quem gerou** + data/hora de geração + paginação;
- Títulos Montserrat 700 numerados com linha divisória `#E1E5ED`; dados em tabela Inter 400/500; selo de
  status colorido apenas na seção 4;
- Campo sem valor no banco aparece como **"Não informado"**.

---

## 3. Cache no Storage

| Item | Valor |
| --- | --- |
| Bucket | `relatorios-pdf` (**privado**) |
| Nome do arquivo | `<sha256 do modelo>.pdf` |
| Acerto de cache | resposta com header `X-Relatorio-Cache: HIT` |
| Conteúdo alterado | gera novo hash → novo arquivo (o antigo pode ser descartado) |
| Falha ao gravar | **não** impede a entrega do PDF ao operador |
| Migração | `supabase/migrations/20261009010000_relatorios_pdf_storage.sql` |

O hash é calculado sobre o **modelo de dados** que alimenta o PDF, não sobre o binário: dois pedidos do
mesmo conteúdo não re-geram nada, e qualquer alteração real (status, motivo de recusa, datas) produz hash
diferente.

---

## 4. Auditoria

A exportação é registrada em `logs_alteracoes` com `tipo_alteracao = 'EXPORTACAO'`
(`tipo_alteracao_enum`, migração `20261009020000`). A chamada anterior tinha a **ordem de argumentos
errada** e não auditava; isso foi corrigido junto com a migração do PDF para o servidor.

---

## 5. Dados fictícios removidos

Quando o PDF era gerado no cliente, valores de exemplo eram **hardcoded**. Foram removidos:

```text
peso 25 t · volume 40 m³ · valor R$ 100.000 · "Destino Internacional"
"Carga Geral" · estado fixo "OPERANTE" · "Validade da Auditoria"
```

Hoje cada campo vem do banco e, quando ausente, aparece como "Não informado".

O jsPDF continua em `cargas.html` para as **etiquetas** 10×10 cm; saiu de `relatorios.html`.

---

## 6. Implantação

```bash
supabase db push                                                # aplica as duas migrações
supabase functions deploy relatorio-pdf --no-verify-jwt
```

Ver [Configuração do Supabase](/primeiros-passos/configuracao-supabase) e
[Edge Functions](/arquitetura/edge-functions) para o motivo do `--no-verify-jwt`.

---

## 7. Testes

```bash
npm run test:relatorio-pdf      # node --disable-warning=... tests/test_relatorio_pdf.js
npm run test:edge-functions
```

Cobrem: geração do PDF a partir de um modelo, cache HIT para conteúdo repetido, novo hash para dado
alterado, código do funcionário inválido/inativo, cargo sem permissão, ausência de dados fictícios e
auditoria `EXPORTACAO`.

:::warning Ressalvas declaradas
A identidade vem do código informado (o app não usa Supabase Auth): quem conhece o código de um funcionário
ativo com cargo permitido consegue emitir o relatório. A função foi verificada com Deno (`deno check` e
execução com `npm:pdf-lib`) e com cliente falso em Node, **não** contra o projeto Supabase real — não havia
credenciais no ambiente de desenvolvimento.
:::
