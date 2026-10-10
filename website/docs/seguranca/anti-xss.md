---
id: anti-xss
title: Anti-XSS (codificação de saída)
sidebar_label: Anti-XSS
description: Como o js/security.js centraliza a codificação de saída, as regras de uso obrigatórias e as ferramentas de verificação.
---

# Anti-XSS (codificação de saída)

O risco real deste projeto é **XSS baseado em DOM**: as telas montam tabelas, listas e cards com
`innerHTML` a partir de dados que vêm do Supabase, de cookies/localStorage e da **leitura de QR Code** —
todos controláveis por terceiros. Sem codificação, esses valores permitem injetar HTML/JavaScript
arbitrário, **inclusive dentro de manipuladores inline `onclick="…"`**.

`js/security.js` (188 linhas) centraliza a codificação. É o primeiro script carregado em toda página.

---

## 1. As três funções

| Função | Uso | O que faz |
| --- | --- | --- |
| `nexusEsc(valor)` | interpolação em HTML, texto e atributo | escapa `&`, `<`, `>`, `"`, `'`, `` ` `` e `=` |
| `nexusJsArg(valor)` | valor dentro de `onclick="fn('…')"` | serializa para literal JavaScript seguro |
| `nexusSafeUrl(valor)` | `href`/`src` | bloqueia esquemas perigosos (`javascript:`, `data:` fora de imagem, …) |

```javascript
const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

// HTML/texto/atributo
tabela.innerHTML = cargas.map((c) => `
  <tr>
    <td class="font-mono">${esc(c.codigo)}</td>
    <td>${esc(c.natureza)}</td>
    <td><button onclick="selecionarCarga(${jsArg(c.id)})">Abrir</button></td>
  </tr>`).join('');

// URL vinda de dado externo
link.href = nexusSafeUrl(registro.qr_code_url);
```

---

## 2. Regras de uso obrigatórias

1. **Nunca** interpolar dado não confiável em `innerHTML` sem `esc()`;
2. **Nunca** montar string de manipulador inline sem `jsArg()`;
3. **Nunca** atribuir URL vinda do banco/QR direto em `href`/`src` — use `nexusSafeUrl()`;
4. Dados de sessão (nome, cargo, código, matrícula) **são** controláveis: vêm de cookie e aparecem no
   cabeçalho, no rodapé da sidebar e em mensagens — sempre codificados (`js/layout.js` faz isso);
5. Preferir **DOM API** (`createElement`, `textContent`) em componentes novos — é o caminho usado nos
   diálogos do WebMCP, que não usam `innerHTML` com dado externo;
6. Conteúdo de agente de IA é **não confiável** por definição: as saídas passam por higienização no núcleo
   (chaves ocultas, padrões de token/CPF redigidos e limite de 6 000 caracteres).

---

## 3. Otimização conhecida (hot path)

`.jules/bolt.md` registra o aprendizado de performance aplicado em `nexusEsc`: antes de rodar as
substituições, há um teste rápido de regex.

```javascript
// caminho rápido: a maioria dos valores não tem caractere especial algum
if (!/[&<>"'`=]/.test(str)) return str;
```

Isso mais que dobra a taxa de escape em telas com milhares de células, sem perder cobertura: qualquer
string que contenha um dos caracteres tratados cai no caminho completo.

---

## 4. Verificação automatizada

| Ferramenta | Comando | O que faz |
| --- | --- | --- |
| Varredura estática | `npm run scan:xss` (`tools/xss-scan.js`) | procura interpolações cruas em `innerHTML`, manipuladores inline sem escape e usos de API perigosa |
| Testes de regressão | `npm run test:xss` (`tests/xss.test.js`) | executa payloads conhecidos contra as funções e contra as telas em `jsdom` |
| Auditoria combinada | `npm run audit:xss` | roda a varredura **e** os testes (é uma etapa de `npm test`) |

```bash
npm run audit:xss
# → varredura estática: nenhuma interpolação crua encontrada
# → testes anti-XSS: OK
```

---

## 5. Casos já tratados no projeto

| Caso | Tratamento |
| --- | --- |
| Nome de funcionário vindo de `funcionarios` | `esc()` no cabeçalho, no rodapé da sidebar e nas listas |
| Texto lido de QR Code | validado por padrão de identificador **e** codificado antes de aparecer na tela |
| URL de QR (`qr_code_url`) | `nexusSafeUrl()` ao montar links |
| Argumentos em `onclick` | `jsArg()` |
| Saída para agentes de IA | higienização no núcleo + aviso de conteúdo não confiável |
| Relatório PDF | gerado no **servidor** com dados lidos do banco (o cliente envia só o id) |
| Mensagens de erro do banco | exibidas como texto (`textContent`/escape), nunca como HTML |

---

## 6. Limites declarados

- **Cookies de sessão não são `HttpOnly`** (são gravados por JavaScript): a proteção contra XSS é
  exatamente esta codificação de saída — por isso ela é obrigatória, não opcional;
- **Amenização de CSP**: o projeto carrega Tailwind, fontes e bibliotecas por CDN e usa configuração
  inline do Tailwind, o que impede uma CSP estrita sem etapa de build. É um trade-off explícito da
  restrição "sem bundler";
- **Dependência de disciplina**: a varredura estática reduz, mas não elimina, a chance de alguém esquecer
  um `esc()`. Por isso o scanner roda em `npm test` e em PR.
