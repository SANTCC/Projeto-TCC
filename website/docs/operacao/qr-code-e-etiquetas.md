---
id: qr-code-e-etiquetas
title: QR Code e etiquetas
sidebar_label: QR Code e etiquetas
description: Geração, impressão, reimpressão e leitura de QR Code no pátio — as regras do RF 17 e as RN 17, 18 e 19.
---

# QR Code e etiquetas

O QR Code é a ponte entre o **objeto físico** no pátio e o **registro digital** (RF 17). O ciclo completo
tem quatro partes: gerar, imprimir, reler e escanear.

---

## 1. Geração (RF 17.1)

| Regra | Detalhe |
| --- | --- |
| Quando | **automaticamente**, no primeiro cadastro da carga ou do contêiner |
| Onde aparece | tela de confirmação do cadastro, em tempo real (`qrcode.js`) |
| Unicidade | um QR por carga e um por contêiner, gravado em `qr_code_url` (**coluna `unique`**) |
| Alteração | **não pode** ser alterado nem reutilizado em outra entidade (RN 17) |
| Conteúdo | URL interna (`porto.interno/carga?id=ABC-2026-0042`) ou o identificador cru, conforme a estratégia de leitura |

```javascript
// js/pages/cargas.js (visão de alto nível)
const url = `${location.origin}/scanner.html?codigo=${encodeURIComponent(codigoCarga)}`;
QRCode.toCanvas(canvas, url, { margin: 1, width: 320 });
// depois de confirmado o cadastro, `qr_code_url` é gravado e nunca mais muda
```

---

## 2. Impressão da etiqueta (RF 17.2)

| Item | Especificação |
| --- | --- |
| Formato | PDF padronizado, **10×10 cm** (ou 10×15 cm) |
| QR | centralizado, com tamanho adequado para leitura à distância |
| Texto | número da carga/contêiner em **Inter 700 28–32px** |
| Opcional | tipo de carga + data de recebimento em Inter 500 12px (conferência visual rápida) |
| Impressora | térmica de etiquetas do pátio |
| Cor | **monocromático** — módulo preto `#222222` puro sobre branco (exigência de impressora térmica) |
| Botão | **"Imprimir Etiqueta"**, ao lado do QR exibido |

---

## 3. Reimpressão (RN 18)

- A reimpressão **não** gera novo código: reproduz a mesma etiqueta;
- O motivo típico é etiqueta danificada, perdida ou suja;
- A ação é registrada no log de alterações como **"Reimpressão de etiqueta"**
  (`tipo_alteracao = REIMPRESSAO_ETIQUETA`), com cargo e código individual;
- A reimpressão fica disponível na própria **ficha** da carga/contêiner.

---

## 4. Leitura no pátio (RF 17.3 e 17.4)

| Regra | Detalhe |
| --- | --- |
| Dispositivo | celular/tablet, pela **câmera do navegador** (`html5-qrcode`) — sem app nativo (não-requisito 17) |
| Autenticação | **exige sessão** (RN 19); leituras externas ou de visitante não logado são negadas |
| Registro | cada leitura grava em `leituras_qr_code` com código do funcionário, data/hora e entidade |
| Resultado | abre **direto a tela da entidade**, com as ações do cargo em destaque |

O que cada cargo vê ao escanear:

| Cargo | Resultado |
| --- | --- |
| Estivador | registra o início/fim da movimentação (`EM_CARREGAMENTO` / `CONCLUIDO`) |
| Conferente | registra o recebimento físico ou as condições de saída |
| Inspetor | abre **automaticamente** o checklist do tipo de carga |
| Arrumador e Consertador | altera o status para "pronta para entrega" |
| Supervisor | vê o status de todas as cargas vinculadas ao contêiner |

:::note Entrada manual e simulação
A tela `scanner.html` aceita **digitação do código** (útil quando a etiqueta está ilegível) e oferece um
botão de **simular leitura** para demonstração e testes automatizados. O texto lido é tratado como
**entrada não confiável**: o sistema aceita apenas identificadores no padrão `^[A-Za-z0-9._-]{3,80}$`,
porque o campo entra em consultas ao PostgREST.
:::

---

## 5. Vínculo lógico entre etiquetas

Cada carga e cada contêiner têm **QR independente**. No momento da vinculação (carga → contêiner → navio),
o sistema mantém o **vínculo lógico** entre os códigos, mas as **etiquetas físicas permanecem separadas** —
é o que permite, por exemplo, escanear um contêiner e ver todas as cargas dentro dele sem reetiquetar nada.

---

## 6. Onde está implementado

| Arquivo | Papel |
| --- | --- |
| `js/pages/cargas.js` | geração em tempo real, impressão, reimpressão e movimentação |
| `js/pages/embarcacoes.js` | QR de contêiner |
| `js/pages/scanner.js` | leitura por câmera/entrada manual e encaminhamento |
| `js/webmcp/webmcp-scanner.js` | ferramenta `ler_codigo_qr` (mesma validação de padrão) |
| `js/webmcp/webmcp-cargas.js` | ferramenta `exibir_etiqueta_qr` (somente leitura) |
| `supabase/functions/scanner-qr/` | validação no servidor, matriz por cargo e registro da leitura |
| `leituras_qr_code` | tabela de registro das leituras |

---

## 7. Testes

```bash
npm run test:gravacao           # gravação de inspeção e fluxo de login (inclui QR)
npm run test:webmcp             # ferramentas de scanner e de etiqueta
npm run test:screenshots        # catálogo de telas inclui o scanner
npm run test:about              # o about.html documenta o passo a passo de QR
```

---

## 8. Limitações conhecidas

| Limitação | Situação |
| --- | --- |
| Câmera exige contexto seguro | `https://` ou `localhost`; em HTTP simples a leitura por câmera não abre (a entrada manual continua) |
| Leitura externa | bloqueada por definição (RN 19) — não há modo "convidado" |
| Sem app nativo | decisão de escopo (não-requisito 17): o navegador resolve |
| Etiqueta depende da impressora térmica | o PDF é padronizado em 10×10 cm para esse equipamento |
