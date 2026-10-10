---
id: edge-functions
title: Edge Functions (Deno)
sidebar_label: Edge Functions
description: As 6 funções de servidor do NexusPort — contrato, RBAC interno, variáveis de ambiente, deploy e testes.
---

# Edge Functions (Deno)

O NexusPort tem **6 Edge Functions**, todas em Deno, em `supabase/functions/`. Elas existem para o que
**não** pode (ou não deve) rodar no navegador: gerar PDF, calcular indicadores com autoridade de servidor,
validar despacho, registrar IP de acesso ou carimbar a hora do pânico.

| Função | Arquivo principal | Método | Efeito |
| --- | --- | --- | --- |
| `panic-alert` | `index.ts` (única) | POST | RBAC + persistência da emergência + broadcast WebSocket + webhook opcional |
| `relatorio-pdf` | `index.ts` + `handler.js` + `relatorio.js` + `pdf.js` | POST | gera o PDF A4 (4 seções) com `pdf-lib` e faz cache no Storage |
| `despacho-embarcacao` | `index.ts` + `handler.js` | POST | libera navio com validação de rota, ETA, desocupação de berço e propagação de status |
| `kpis-calculo` | `index.ts` + `handler.js` | GET/POST | indicadores consolidados com RBAC por camada de visão |
| `scanner-qr` | `index.ts` + `handler.js` | POST | valida a leitura de QR, aplica a matriz por cargo e registra a leitura |
| `log-acesso` | `index.ts` + `handler.js` | POST | registra IP e user agent do usuário autenticado |

---

## 1. Padrão comum

Todas seguem a mesma estrutura, o que permite testá-las em Node sem Deno:

```text
supabase/functions/<nome>/
├── index.ts      Deno.serve(criarHandler({ criarCliente, ... }))     ← só o "cabeamento"
└── handler.js    criarHandler(deps) → (request) => Response          ← lógica testável
```

- **Injeção de dependência:** `criarCliente` (supabase-js), `env()` e, no caso do PDF, a `lib` do
  `pdf-lib`. Os testes Node passam dublês (`tests/test_edge_functions.js`, `tests/test_relatorio_pdf.js`).
- **CORS:** `Access-Control-Allow-Origin: *`, headers `authorization, x-client-info, apikey, content-type`,
  métodos conforme a função, e `OPTIONS` sempre respondido **antes** de qualquer validação — é o que exige
  `verify_jwt = false`.
- **RBAC no servidor:** a identidade é o `codigo_individual`; a função valida em `funcionarios` se o
  funcionário está **ativo** e se o **cargo** tem a permissão (mesma matriz de `js/auth-guard.js`).
- **Variáveis de ambiente:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (aceita também
  `SUPABASE_SECRET_KEY` como nome novo). A service role **nunca** chega ao navegador.
- **Erros:** sempre JSON com código e mensagem, sem *stack trace* para o cliente.

```javascript title="Esqueleto de um handler"
export function criarHandler({ criarCliente, env }) {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    const corpo = await request.json().catch(() => ({}));
    const cliente = criarCliente(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    // 1) identidade  2) cargo  3) regra de negócio  4) efeito  5) auditoria
  };
}
```

---

## 2. `panic-alert`

**Responsabilidades** (conforme o cabeçalho do arquivo):

1. **RBAC no servidor** — valida quem acionou contra `funcionarios` (o cargo precisa ter permissão
   `ACIONAR_EMERGENCIA`, a mesma matriz do front-end);
2. **Persistência** — registra/resolve a emergência em `emergencias` (`ATIVA`/`RESOLVIDA`), para que quem
   conectar depois também veja o alarme;
3. **Broadcast** — publica no canal Realtime `nexus-emergency`, que faz o banner fixo aparecer em **todos**
   os clientes conectados;
4. **Webhook opcional** — só dispara se `panic_webhook_config.enabled = true` **e** a URL for válida.
   Desativado por padrão; a configuração é feita direto no banco (SQL Editor) — o front-end não configura,
   dispara nem testa webhooks.

**Resiliência:** se a função não estiver implantada, `js/panic-realtime.js` faz o broadcast direto pelo
Realtime (cliente → clientes) e persiste o estado localmente, garantindo que o alarme não dependa de um
único caminho.

## 3. `relatorio-pdf`

```text
POST { carga_id, codigo_individual }  →  application/pdf
```

- O navegador envia **apenas o identificador**; todos os valores do relatório são lidos no servidor;
- Valida funcionário ativo e cargo (o mesmo `relatorios.html`);
- Gera o PDF A4 com `pdf-lib`, nas quatro seções do RF 11 — Dados da Carga · Dados do Navio · Dados do
  Contêiner · Resumo do Fluxo;
- **Cache:** o arquivo é `<sha256 do modelo>.pdf` no bucket privado `relatorios-pdf`; conteúdo igual
  reaproveita o arquivo e a resposta traz `X-Relatorio-Cache: HIT`; dado alterado gera novo hash. Falha ao
  gravar o cache **não** impede a entrega do PDF;
- A exportação é auditada como `EXPORTACAO` na auditoria (migração `20261009020000`);
- Campo sem valor aparece como **"Não informado"**, nunca com dado fictício.

Detalhes de layout, seções e teste em [Relatórios em PDF](/operacao/relatorios-pdf).

## 4. `despacho-embarcacao`

Executa o despacho de navios com validações **atômicas** (documentadas no handler):

1. **RBAC** — exige `LIBERAR_NAVIO` (Supervisor, Direção, Conselho);
2. **Trava de rota (RN 9)** — bloqueia se não existir rota cadastrada entre origem e destino;
3. **ETA** — calcula distância ÷ 33 km/h;
4. **Desocupação de berço** — o berço do navio volta para `LIVRE`;
5. **Propagação de status** — contêineres e cargas vinculados passam a `EM_TRANSITO` (RN 3);
6. **Trilha** — registra a decisão em `trail_decisoes` e a alteração em `logs_alteracoes`.

## 5. `kpis-calculo`

Suporta `GET` e `POST`, valida identidade por `codigo_individual` **ou** `matricula` e calcula com
autoridade de servidor:

| Indicador | Restrição |
| --- | --- |
| Ocupação de berços (% e quantidade) | operacional |
| Tempo médio de permanência das cargas no pátio (horas) | operacional |
| Taxa de aprovação/recusa das inspeções técnicas | operacional |
| Alertas de preventiva (navios/contêineres sem manutenção há > 3 anos) | operacional |
| **Valor total declarado das cargas no pátio** | **somente cargos estratégicos** (Direção e Conselho) |

O mesmo recorte aparece no front-end (`js/pages/charts.js`): indicadores financeiros são exclusivos da
Visão Estratégica.

## 6. `scanner-qr`

Valida a leitura de um QR Code, aplica a **matriz de ações por cargo** e registra automaticamente a
leitura (`leituras_qr_code`) e a auditoria. O texto lido é tratado como **não confiável**: só são aceitos
identificadores no padrão `^[A-Za-z0-9._-]{3,80}$`, porque o campo entra em consultas ao PostgREST.

## 7. `log-acesso`

```text
POST { codigo_individual, pagina? }  →  204
```

- Sem `codigo_individual` válido e ativo em `funcionarios`, **nada** é gravado (401);
- **IP**: vem dos cabeçalhos de proxy (`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`) — nunca do corpo
  enviado pelo cliente;
- **User agent**: truncado em 512 caracteres;
- Persiste em `log_acessos_usuarios` com a service role (migração `20261010010000`).

---

## 8. Implantação

```bash
supabase link --project-ref <ref-do-projeto>

supabase functions deploy panic-alert --no-verify-jwt
supabase functions deploy relatorio-pdf --no-verify-jwt
supabase functions deploy despacho-embarcacao --no-verify-jwt
supabase functions deploy kpis-calculo --no-verify-jwt
supabase functions deploy scanner-qr --no-verify-jwt
supabase functions deploy log-acesso --no-verify-jwt
```

:::danger Por que `--no-verify-jwt`
O gateway, com `verify_jwt` ligado, responde `401` ao **preflight CORS** (o `OPTIONS` não envia
`Authorization`) e o navegador bloqueia a chamada com *"Response to preflight request doesn't pass access
control check"*. A autorização real é feita **dentro** da função. O `supabase/config.toml` já declara
`verify_jwt = false` para as seis.
:::

---

## 9. Testes

| Suíte | O que cobre |
| --- | --- |
| `npm run test:edge-functions` (`tests/test_edge_functions.js`) | contratos, RBAC, rota ausente, ETA, propagação, KPIs, scanner, log de acesso |
| `npm run test:relatorio-pdf` (`tests/test_relatorio_pdf.js`) | geração do PDF, cache HIT/novo hash, exportação auditada |
| `npm run test:panic` | pânico global + migração de emergências (404 e enum) |
| `npm run test:log-acesso` | trilha de IP/user agent |

As funções são verificadas com Deno (`deno check` + execução com `npm:pdf-lib`) e com PostgreSQL local nos
scripts `tests/verify_*.py`. O projeto **não** foi testado contra o Supabase real por falta de credenciais —
as funções validam tudo o que é possível validar fora do ambiente hospedado.
