# NexusPort - Sistema de Gestão Operacional Portuária

**Terminal STS-01 Santos**

NexusPort é uma plataforma web para gestão operacional de fluxos de cargas, navios, inspeções, pátio e rastreamento em tempo real no Terminal STS-01 do Porto de Santos.

---

## 🚀 Recursos Principais

- **Autenticação & Controle de Acesso Baseado em Modos (RLS):**
  - **Técnico em Portos:** Gestão de funcionários, visitantes, cadastros operacionais e liberação.
  - **Supervisor de Operações:** Visão tática, delegação de substitutos e trilha de decisões.
  - **Gerente de Operações / Direção:** Visão estratégica global, aprovação de relatórios e trilha crítica.
- **Fluxo Core de Cargas & Pátio:** Agendamento, recebimento, checklist de avarias, armazenamento em baia, vinculação e trânsito.
- **QR Code & Etiquetas:** Geração de QR Code com canvas em tempo real, download de etiqueta A4/PDF 10x10cm e scanner via câmera/simulação.
- **Dashboards & Relatórios:** KPIs em tempo real, busca operacional com 5 filtros e emissão de relatório PDF A4 com logotipo.
- **Gráficos por Camada de Visão (Chart.js):** Painéis gráficos recortados por cargo (Visão Própria, Visão Operacional e Visão Estratégica).
- **Auditoria, Trail & Delegação:** Trilha imutável de decisões críticas com anexação de retificações e gestão de substituto ativo.
- **Localização & Tempos:** Posicionamento GPS dos navios, classificação automática de status e cálculo de ETA.
- **🚨 Botão de Pânico Global (Tempo Real):** Disparo de emergência via Supabase Realtime (WebSocket) com banner fixo em todas as telas conectadas, alerta tátil (vibração/áudio) e suporte a webhook.
- **🤖 Agentes de IA (WebMCP):** Interface para agentes de IA do navegador com controle humano e permissões por cargo.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, JavaScript (ES6 Modules)
- **Supabase Backend:** PostgreSQL com Row Level Security (RLS) e Auth Client (`@supabase/supabase-js`)
- **Supabase Edge Functions (Deno):** `panic-alert` (evento de servidor do botão de pânico)
- **Supabase Realtime (WebSocket):** Broadcast do alarme de emergência para todos os clientes conectados
- **Bibliotecas:** `Chart.js`, `qrcode.js`, `html5-qrcode`, `jsPDF`
- **Automação & Testes:** Node.js, `jsdom`, `Playwright`

---

## ⚙️ Configuração e Execução

### 1. Clonar o repositório
```bash
git clone <URL_DO_REPOSITORIO>
cd nexusport
```

### 2. Configurar o Supabase
Copie o arquivo de exemplo de configuração e insira as chaves do seu projeto Supabase:
```bash
cp js/config.example.js js/config.js
```
Edite `js/config.js`:
```javascript
window.NEXUS_CONFIG = {
  SUPABASE_URL: "https://seu-projeto.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-aqui"
};
```
*Nota: Caso o Supabase não esteja configurado, o sistema executa automaticamente em modo de simulação/offline.*

### 3. Executar Localmente
```bash
npm start
```
Acesse `http://localhost:3000` no seu navegador.

### 4. Executar Testes Automatizados
```bash
npm test              # Executa toda a suíte de testes (Node.js/jsdom)
npm run audit:xss    # Análise estática e regressão Anti-XSS
npm run test:panic   # Testes do módulo de pânico e resiliência de migração
npm run test:webmcp  # Testes de integração com agentes de IA (WebMCP)
```

---

## 📊 Gráficos e Camadas de Visão (js/charts.js)

Os gráficos são montados em tempo de execução recortados pela **camada de visão do cargo autenticado** (RF 1):

| Camada | Cargos | Indicadores exibidos |
|--------|--------|----------------------|
| **Visão Própria** | Estivador, Conferente, Arrumador, Planejador, Técnico em Portos | Operações próprias por dia, cargas/contêineres da própria atribuição e efetivo/visitantes (Técnico). |
| **Visão Operacional** | Inspetor, Supervisor | Inspeções técnicas, fluxo de cargas, manutenções, fila de liberação, ocupação de berços e trail de decisões. |
| **Visão Estratégica** | Diretor de Operações, Diretor-Presidente e Conselho | Aprovação/recusa, permanência média, embarcações utilizadas, produtividade, % de berços e valor declarado. |

- **Atualização:** Atualização automática a cada 60 s e suporte a recarga manual sem cache local (`#chartsRefreshBtn`).
- **Privacidade:** Indicadores financeiros (valor declarado) são restritos à Visão Estratégica. Dados pessoais de funcionários/visitantes não são expostos a cargos táticos.

---

## 🔒 Modelo de Segurança

1. **Autenticação e Sessão Client-Side:** Validação por código individual vinculada ao perfil/cargo do funcionário (`nexus_session`).
2. **Proteção Anti-XSS (DOM-based):** Módulo `js/security.js` expõe sanitização contextual obrigatoriamente aplicada antes da renderização HTML (`nexusEsc`, `nexusJsArg`, `nexusSafeUrl`).
3. **Row Level Security (RLS) no Supabase:** Políticas *Append-Only* para tabelas de auditoria (`logs_alteracoes`, `trail_decisoes`) e restrição de comandos destrutivos (`DELETE`) nas tabelas operacionais.

---

## 🚨 Botão de Pânico Global

<<<<<<< HEAD
### 1. Modelo de Autenticação e Sessão Client-Side
O NexusPort foi desenvolvido no contexto de um protótipo operacional portuário (TCC). A verificação de credenciais e permissões (RBAC) é validada no frontend (`js/tecnico_portos.js`, `js/vision-layer.js`), armazenando a sessão ativa em `sessionStorage`/`localStorage` (`nexus_session`).

### 2. Codificação de Saída contra XSS (DOM-based)
Todo o front-end monta tabelas, cards e modais via `innerHTML`. Como os dados
exibidos vêm do Supabase, do `localStorage` (chaves `nexus_*`), da sessão
(`nexus_session`) e da leitura de QR Code, eles são tratados como
**não confiáveis** e nunca interpolados crus.

O módulo `js/security.js` (carregado em **todas** as páginas, antes dos demais
scripts) expõe `window.NexusSecurity` e os aliases globais `nexusEsc`,
`nexusJsArg` e `nexusSafeUrl`:

| Situação | Helper | Exemplo |
|---|---|---|
| Texto/atributo HTML | `nexusEsc(valor)` | `<td>${nexusEsc(c.nome)}</td>` |
| Argumento de `onclick`/`onchange` inline | `nexusJsArg(valor)` | `onclick="fn(${nexusJsArg(c.id)})"` |
| URL dinâmica (`href`/`src`) | `nexusSafeUrl(valor)` | `href="${nexusSafeUrl(u.url)}"` |

Regras obrigatórias ao contribuir:

1. Nunca interpole dados em `innerHTML` sem `nexusEsc`.
2. Em manipuladores inline, use **sempre** `nexusJsArg` — `nexusEsc` não impede
   o fechamento da string JavaScript (ex.: `id` = `');alert(1);//`).
3. Prefira `textContent` para dados puros; `innerHTML` fica restrito ao markup
   estrutural.
4. Rode `npm run scan:xss` antes de enviar alterações; o scanner deve reportar
   **0** interpolações não codificadas.

### 3. Camada de Segurança RLS (Row Level Security) no Supabase
Para proteger a integridade dos dados no banco de dados contra solicitações maliciosas via API REST (`anon` key):
- **Tabelas de Log e Auditoria (`logs_alteracoes`, `trail_decisoes`, `retificacoes_trail`):** Protegidas por políticas *Append-Only* (`SELECT` e `INSERT`). Operações de `UPDATE` e `DELETE` são totalmente bloqueadas no banco de dados.
- **Tabelas Operacionais (`cargas`, `navios`, `containers`, `manutencoes`, etc.):** Permitem `SELECT`, `INSERT` e `UPDATE`, porém o comando `DELETE` (deleção física de registros) é restrito no banco para evitar perda indevida de dados.
- **Tabelas de Configuração/Mestre (`cargo_niveis`, `tipos_carga`, etc.):** Acesso estritamente de leitura (`SELECT` apenas).
- **Isolamento de Credenciais:** O arquivo `js/config.js` contém a chave publicável do Supabase e é ignorado pelo Git (`.gitignore`), mantendo apenas `js/config.example.js` com valores genéricos no repositório.

---

## 🚨 Botão de Pânico Global (Edge Function + WebSocket + Webhook)

O botão de pânico existente (`manutencao.html`) foi elevado a **evento global de servidor**:

```
[Botão de Pânico] ──POST──▶ Edge Function "panic-alert" (Deno/Supabase)
                                   │  1. RBAC no servidor (cargo ACIONAR_EMERGENCIA,
                                   │     validado contra a tabela funcionarios)
                                   │  2. Persiste o estado em `emergencias`
                                   │     (ATIVA / RESOLVIDA)
                                   ├─ 3. Broadcast via WebSocket (Supabase Realtime,
                                   │     canal "nexus-emergency") ──▶ TODOS os clientes
                                   │     conectados exibem aviso fixo no RODAPÉ da tela
                                   └─ 4. Webhook OPCIONAL (padrão: DESATIVADO) — POST JSON
                                         para a URL de `panic_webhook_config` se enabled=true
```

- **Cliente global:** `js/panic-realtime.js` (carregado em todas as páginas internas) assina o canal Realtime, sincroniza o estado ao carregar a página (tabela `emergencias`) e renderiza o banner fixo no rodapé (`#nexusPanicFooter`).
- **Fallback resiliente:** se a Edge Function não estiver implantada, o módulo faz o broadcast direto pelo canal Realtime (cliente → clientes) e persiste em `emergencias` localmente; nesse modo o webhook não dispara (somente o servidor o dispara).
- **Webhook (opcional, OFF por padrão):** configurável no painel "Webhook de Emergência" em `manutencao.html` (interruptor + URL + botão de teste). Eventos enviados: `PANIC_ACTIVATED`, `PANIC_DEACTIVATED` e `PANIC_WEBHOOK_TEST`, com timeout de 5s.

### Alerta no aparelho (vibração / som) — `js/haptics.js`

A emergência também pode ser **sentida no próprio aparelho**, quando o navegador e o dispositivo permitem:

- **Acionamento (SOS):** após a confirmação, o aparelho de quem acionou recebe o padrão SOS antes da chamada de rede. Os demais clientes tentam reproduzir o padrão ao receber o broadcast.
- **Enquanto a emergência estiver ativa:** pulsos locais a cada 3s (`HAPTIC_INTERVAL_MS`). A página precisa estar visível; o navegador encerra a vibração ao ocultar o documento. Se um cliente recebeu o alerta antes de qualquer interação, o sistema tenta novamente no primeiro toque/clique/tecla.
- **Limites da plataforma:** `navigator.vibrate()` é uma API de disponibilidade limitada. Exige contexto seguro (normalmente **HTTPS**; `localhost` também é considerado seguro), sticky user activation e documento visível. Safari no iOS/iPadOS não expõe a Vibration API; Firefox removeu sua implementação no Firefox 129. Não há workaround web confiável para forçar vibração nesses navegadores. Mesmo um retorno `true` da API não garante que exista motor ou que as configurações do aparelho permitam vibrar.

| Aparelho / contexto | Comportamento esperado |
| --- | --- |
| Android com navegador compatível, HTTPS, página visível e interação prévia | `navigator.vibrate()` com padrões SOS/pulso |
| iPhone/iPad com Safari/WebKit | Sem Vibration API para páginas web; alerta sonoro (quando permitido) + banner |
| Firefox 129+ ou outro navegador sem a API | Alerta sonoro (quando permitido) + banner |
| Desktop ou dispositivo sem motor de vibração | A API pode não existir ou não produzir sensação física; use o alerta sonoro |
| Aba em segundo plano / tela apagada | A vibração é interrompida; o banner permanece e o ciclo local recomeça quando a página volta a ficar visível |

- **Diagnóstico:** o rodapé e o painel informam se falta HTTPS, interação, visibilidade, preferência local ou suporte do navegador.
- **Painel "Alerta no Aparelho"** (`manutencao.html`): permite testar a API e configurar vibração/som (preferências salvas por aparelho em `localStorage`).
- **Áudio também requer interação:** browsers podem bloquear WebAudio até o primeiro gesto do usuário; por isso, clientes que só recebem um alerta devem interagir com a página para liberar os canais locais.
- **Acessibilidade:** `prefers-reduced-motion` desliga apenas a animação do indicador de SOS; vibração/som são controlados pela preferência explícita do operador.
- **Teste rápido:** abra **`teste-vibracao.html`** no próprio aparelho. O teste informa o suporte e o motivo de uma chamada não ser aceita, mas a confirmação física depende do aparelho e das configurações do sistema.

#### Android — checklist quando não vibra

1. **HTTPS:** a API é um recurso de contexto seguro. `localhost` funciona para teste no mesmo aparelho; acessar o servidor por um IP local usando HTTP não é equivalente.
2. **Interação:** faça pelo menos um toque/clique/tecla na página. Alertas recebidos antes dessa interação não podem contornar o bloqueio do navegador.
3. **Página visível:** mantenha o NexusPort em primeiro plano; a Vibration API não é um mecanismo de notificação em segundo plano.
4. **Configurações do aparelho:** habilite a vibração/intensidade nas configurações. Alguns aparelhos também silenciam vibração em modo silencioso, Não Perturbe ou economia de energia.
5. **Navegador compatível e hardware:** use uma versão atual de Chrome/Edge/Samsung Internet num aparelho com motor de vibração. Firefox 129+ não oferece a API.

Os padrões usam pulsos de **300 ms** e respeitam os limites de 10 entradas e 10.000 ms por entrada da especificação.

- **Teste automatizado:** `node tests/unit/test_haptics.js` (simula Android, iOS sem API, Firefox, falta de interação, HTTP, visibilidade e normalização dos padrões).

### Implantação (backend)

```bash
# 1. Aplicar a migração (tabelas emergencias + panic_webhook_config + RLS)
supabase link --project-ref <ref-do-projeto>
supabase db push
#    (ou executar supabase/migrations/20261008000000_emergencias_fix_404.sql
#     manualmente no SQL Editor do Supabase)

# 2. Implantar a Edge Function
#    --no-verify-jwt: o app usa sessão própria (codigo_individual), não Supabase Auth;
#    a identidade/RBAC é validada DENTRO da função contra a tabela funcionarios.
supabase functions deploy panic-alert --no-verify-jwt
```

#### ❗ HTTP 404 / PGRST205 em `/rest/v1/emergencias` (e em `panic_webhook_config`)

**Sintoma.** O painel *Network* do navegador mostra, em toda tela interna:

```
GET /rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1
→ 404 Not Found
{ "code": "PGRST205",
  "message": "Could not find the table 'public.emergencias' in the schema cache",
  "hint": "Perhaps you meant the table 'public.funcionarios'" }
```

**Causa.** As tabelas do botão de pânico (`emergencias` e `panic_webhook_config`)
não existem no projeto Supabase — a migração `20261007000000_panic_button_global.sql`
nunca foi aplicada. O PostgREST devolve **404** para qualquer requisição a uma
tabela que não está no *schema cache*. O 404 não é CORS, não é RLS e não é
política de referenciador: com a mesma URL e a mesma chave, o erro se repete.

**Correção.** Aplique a migração reparadora (idempotente — pode ser executada
sobre um banco já parcialmente migrado e mais de uma vez):

```
supabase/migrations/20261008000000_emergencias_fix_404.sql
```

```bash
supabase link --project-ref <ref-do-projeto> && supabase db push
#   ou: Dashboard → SQL Editor → New query → colar o arquivo → Run
```

Ela cria/repara as duas tabelas (colunas, `CHECK`, FK, índice), recria as
políticas `nexus_*` para `anon, authenticated`, garante a linha única de
configuração do webhook **desativada** e termina com `notify pgrst,
'reload schema'` — sem isso o PostgREST pode continuar respondendo 404 por
alguns segundos (alternativa no painel: *Settings → API → Restart server*).

**Verificação** (deve responder `200` com `[]` ou com uma linha):

```bash
curl "<SUPABASE_URL>/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
     -H "apikey: <ANON_OU_PUBLISHABLE_KEY>"
```

No app, o painel **Manutenção → Webhook de Emergência → Banco de dados** tem o
botão **Verificar**, que testa as duas tabelas e diz exatamente o que falta.
Também é possível rodar no console do navegador:

```js
await NexusPanic.diagnose()      // { disponivel, migracao, estado_local, retry_agendado }
await NexusPanic.verificarTabelas()
```

**Comportamento durante a pendência.** O módulo não quebra: a tabela ausente é
detectada uma única vez (aviso no console apontando a migração), o alerta segue
funcionando via WebSocket (canal `nexus-emergency`) e o rodapé de emergência cai
para o flag local. Ao aplicar a migração, clientes já abertos fazem uma
rechecagem automática (backoff de 5 s → 15 s → 45 s → 2 min, e também ao voltar
para a aba ou reconectar) e passam a ler o estado global sem recarregar a página.

| Verificação | Como rodar |
| --- | --- |
| Migração contra PostgreSQL real (5 cenários, RLS, idempotência) | `python3 tests/python/verify_migration_emergencias.py` (requer `pip install psycopg2-binary pgserver`) |
| Regressão do 404 no front-end (jsdom) | `npm run test:migracao` |
| Suíte do pânico | `npm run test:panic` |

#### ❗ `ERROR 22P02 invalid input value for enum tipo_entidade_enum: "EMERGENCIA"` (auditoria)

**Sintoma.** Nos logs do Postgres do Supabase (Logs Explorer → `postgres_logs`),
a cada acionamento/desativação do botão de pânico:

```
parsed.sql_state_code: "22P02"
event_message: invalid input value for enum tipo_entidade_enum: "EMERGENCIA"
parsed.query : WITH pgrst_source AS (INSERT INTO "public"."logs_alteracoes"
               ("cargo", ..., "entidade_tipo", ...) ...
```

**Causa.** O tipo `public.tipo_entidade_enum` **não tem o valor `EMERGENCIA`**
(banco provisionado antes da seção 15 do `SPECs/schema.sql`; o valor é criado no
fim daquele arquivo e também pela migração do pânico). O `INSERT` da auditoria é
recusado pelo banco na conversão do valor — **o alarme funciona**, mas a trilha
de auditoria da emergência se perde. Antes desta correção o erro não aparecia na
tela: o resultado do `insert` era descartado pelo front-end (o supabase-js
devolve a falha em `{ error }`, sem lançar exceção).

**Correção.**

```
supabase/migrations/20261008010000_enum_emergencia_auditoria.sql
```

```bash
supabase link --project-ref <ref-do-projeto> && supabase db push
#   ou: Dashboard → SQL Editor → New query → colar o arquivo → Run
```

Idempotente, avisa por `NOTICE` quando o tipo não existe em `public` (ou quando
`logs_alteracoes.entidade_tipo` não é desse enum) e termina com uma conferência
pelo catálogo `pg_enum`. Caminho rápido, se preferir uma linha:

```sql
alter type public.tipo_entidade_enum add value if not exists 'EMERGENCIA';
```

> Não junte o `ADD VALUE` e um `INSERT` de teste no **mesmo** script: o
> PostgreSQL recusa o uso do valor na mesma transação
> (`55P04 unsafe use of new value`), e o SQL Editor envia o script inteiro como
> uma transação. A migração traz o teste como passo separado (seção 4).

**Verificação.** `select e.enumlabel from pg_enum e join pg_type t on t.oid =
e.enumtypid where t.typname = 'tipo_entidade_enum';` deve listar `EMERGENCIA`;
no app, **Manutenção → Webhook de Emergência → Banco de dados → Verificar** passa
a sondar também o valor do enum (select com `limit(0)`, sem escrever nada), e o
feedback do pânico avisa na hora se a auditoria não gravou.

| Verificação | Como rodar |
| --- | --- |
| `22P02` reproduzido e corrigido em PostgreSQL real (enum, role `anon`, idempotência, armadilha `55P04`) | `python3 tests/python/verify_enum_emergencia.py` |
| Regressão do `22P02` no front-end (jsdom: pânico com auditoria pendente → migração aplicada) | `npm run test:enum` |

Diagnóstico completo: `SPECs/diagnostico/22P02-enum-emergencia.md`.
=======
- **Mecanismo:** O acionamento via `manutencao.html` ou módulo global dispara a Edge Function `panic-alert` e transmite o alerta via WebSocket para todos os navegadores abertos.
- **Feedback Tátil & Sonoro (`js/haptics.js`):** Em dispositivos móveis e navegadores suportados, o alerta ativa vibração em padrão SOS e aviso sonoro.
- **Resiliência:** Se o banco ou a Edge Function estiverem indisponíveis, o front-end utiliza broadcast direto Realtime como fallback.
- **Implantação da Edge Function:**
  ```bash
  supabase functions deploy panic-alert --no-verify-jwt
  ```
- **Diagnóstico de Banco (404 / PGRST205):** Caso a tabela `emergencias` não esteja provisionada (erro PGRST205), aplique a migração `supabase/migrations/20261008000000_emergencias_fix_404.sql` e verifique:
  ```bash
  curl "<SUPABASE_URL>/rest/v1/emergencias?select=*&estado=eq.ATIVA&order=data_hora.desc&limit=1" \
       -H "apikey: <ANON_KEY>"
  ```
  Detalhes de solução de problemas e migrações de banco estão documentados em `SPECs/diagnostico/`.
>>>>>>> origin/main

---

## 🤖 Agentes de IA (WebMCP)

O NexusPort disponibiliza ferramentas seguras para agentes de IA via padrão WebMCP (`document.modelContext`).
- **Confirmação Humana:** Ações que alteram estado exigem confirmação explícita do operador na tela.
- **Controle de Acesso:** Ferramentas respeitam estritamente as permissões do cargo autenticado.
- **Documentação Detalhada:** Consulte `SPECs/webmcp.md` para a arquitetura completa e especificação de ferramentas.

---

## 🔄 Tempo Real das Tabelas

- **Mecanismo:** as telas assinam o Supabase Realtime das tabelas operacionais listadas em `NexusRepository.REALTIME_TABLES` (`js/data-repository.js`) e se recarregam quando um registro muda. Há também uma sincronização de segurança a cada 60 s.
- **Implantação:** aplique a migração `supabase/migrations/20261009000000_realtime_publication.sql` (`supabase db push`). Sem ela, o canal conecta mas não recebe eventos, e as telas atualizam só pela sincronização de 60 s.
- **Testes:** `npm run test:tempo-real`.

- **Usuários on-line:** o cabeçalho mostra quantos códigos de funcionário estão conectados (Supabase Realtime Presence, canal `nexus-online`), atualizado a cada 30 s. Sem Supabase, mostra "—". Teste: `npm run test:presenca`.

---

## 📈 Medição de Uso (Google Analytics 4)

- **Configuração:** `js/analytics.js` (comum a todas as páginas). O identificador do aparelho é o cookie `_ga` do próprio GA4; não há fingerprinting.
- **Eventos:** `NexusAnalytics.track(evento, parametros)`. Nunca envie nome, código ou matrícula: esses campos são descartados.
- **Pendência:** consentimento de cookies (LGPD) não implementado.
- **Testes:** `npm run test:analytics`.

---

## 📦 Build de Produção (minificação)

- **Comando:** `npm run build` gera `dist/` com JS (Terser) e CSS (clean-css) minificados. Os caminhos não mudam.
- **Deploy:** o `vercel.json` executa o mesmo comando (`buildCommand`) e publica `dist/` (`outputDirectory`).
- **Desenvolvimento:** `npm start` continua servindo o código-fonte.
- **Testes:** `npm run test:build`.

---

## 🚦 Gate Lighthouse (Pull Requests)

- **CI:** `.github/workflows/lighthouse.yml` roda em todo PR. Os relatórios vão como artefato.
- **Local:** `npm run lighthouse` (precisa de Google Chrome ou Chromium; use `CHROME_PATH` se não estiver no PATH). Gera `lighthouse-report/`.
- **Limiares e exceções:** `lighthouse/limiares.json`. Cada página é medida em 3 rodadas (mediana). Exceções são dívida conhecida por página e devem ser removidas quando corrigidas.
- **Testes:** `npm run test:lighthouse`.

---

## 📄 Relatório PDF no Servidor

- **Função:** `supabase/functions/relatorio-pdf` gera o PDF A4 (pdf-lib). O navegador envia só o identificador da carga e recebe o arquivo do servidor.
- **Cache:** bucket privado `relatorios-pdf`. O nome do arquivo é o SHA-256 do conteúdo, então dados iguais reaproveitam o PDF.
- **Implantação:** `supabase db push` (migrações `20261009010000` e `20261009020000`) e `supabase functions deploy relatorio-pdf --no-verify-jwt`.
- **Testes:** `npm run test:relatorio-pdf`.

---

## 🧪 Dados de Demonstração (seed)

- **Arquivo:** `supabase/seed.sql`. Só para demonstração e desenvolvimento local. **Não aplicar em produção.**
- **Usuários de teste:** 2 por cargo, com nome `[CARGO]_mock123` e `[CARGO]_mock321`. Acesso pelo código individual `MOCK-[CARGO]-123` e `MOCK-[CARGO]-321`.
- **Dados:** 4 navios, 6 contêineres, 12 cargas (os 9 status do fluxo), tipos de carga, rotas a partir de Santos e histórico de alterações. IMOs e distâncias são fictícios.
- **Aplicar:** local com `supabase db reset`; projeto de demonstração com `psql "$DATABASE_URL" -f supabase/seed.sql`. Reexecutar não duplica nada.
- **Testes:** `npm run test:seed` (estrutura) e `python tests/verify_seed_demo.py` (PostgreSQL local; requer `pip install pgserver psycopg2-binary`).

---

## 🔒 Banco de Dados e Schemas

- **DDL Completo:** `SPECs/schema.sql`
- **Migrações Incrementais:** `supabase/migrations/`
- **Diagnósticos de banco:** `SPECs/diagnostico/`
