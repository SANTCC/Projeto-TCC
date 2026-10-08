# NexusPort - Sistema de Gestão Operacional Portuária

**Terminal STS-01 Santos**

NexusPort é uma plataforma web para gestão operacional de fluxos de cargas, navios, inspeções, pátio e rastreamento em tempo real no Terminal STS-01 do Porto de Santos.

---

## 🚀 Recursos Principais

- **Autenticação & Controle de Acesso Baseado em Modos (RLS):**
  - **Técnico em Portos:** Gestão de funcionários, visitantes, cadastros operacionais e liberação.
  - **Supervisor de Operações:** Visão tática, delegação de substitutos e trilha de decisões.
  - **Gerente de Operações:** Visão estratégica global, aprovação de relatórios e trilha crítica.
- **Fluxo Core de Cargas & Pátio:** Agendamento, recebimento, checklist de avarias, armazenamento em baia, vinculação e trânsito.
- **QR Code & Etiquetas:** Geração de QR Code com canvas em tempo real, download de etiqueta A4/PDF 10x10cm e scanner via câmera/simulação.
- **Dashboards & Relatórios:** KPIs em tempo real, busca operacional com 5 filtros e emissão de relatório PDF A4 com logotipo.
- **Gráficos por Camada de Visão (Chart.js):** painéis gráficos recortados por cargo — Visão Própria (operações do próprio funcionário), Visão Operacional (inspeções, fila de liberação, manutenções, berços e trail) e Visão Estratégica (aprovação/recusa, permanência, frota, produtividade por cargo, % de berços e valor declarado).
- **Auditoria, Trail & Delegação:** Trilha imutável de decisões críticas com anexação de retificações e gestão de substituto ativo.
- **Localização & Tempos:** Posicionamento GPS dos navios, classificação automática de status e cálculo de ETA com velocidade fixa de 33 km/h (RN 9).
- **🚨 Botão de Pânico Global (Tempo Real):** O botão de emergência dispara a Edge Function `panic-alert`, que transmite o alerta via WebSocket (Supabase Realtime) para **todos os clientes conectados** — exibindo aviso fixo no rodapé de cada tela — e dispara um **webhook opcional (desativado por padrão)**.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, JavaScript (ES6 Modules)
- **Supabase Backend:** PostgreSQL com Row Level Security (RLS) e Auth Client (`@supabase/supabase-js`)
- **Supabase Edge Functions (Deno):** `panic-alert` — evento de servidor do botão de pânico global
- **Supabase Realtime (WebSocket):** Broadcast do alarme de emergência para todos os clientes conectados
- **Bibliotecas:** `Chart.js`, `qrcode.js`, `html5-qrcode`, `jsPDF`
- **Automação & Testes:** Python 3 (Scripts de verificação `verify_phase*.py`)

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
npm test              # suite Playwright (fluxos ponta a ponta)
npm run test:graficos # gráficos por camada de visão (Node, sem dependências)
npm run test:bercos   # vínculo navio × berço: constraints de public.bercos (jsdom)
```

---

## 📊 Gráficos por Cargo (js/charts.js)

Os gráficos são montados em tempo de execução pelo módulo `js/charts.js` (Chart.js via CDN),
sempre recortados pela **camada de visão do cargo autenticado** (RF 1):

| Camada | Cargos | Indicadores exibidos |
|--------|--------|----------------------|
| **Visão Própria** | Estivador, Conferente, Arrumador, Planejador, Técnico em Portos | Operações próprias por dia, cargas/contêineres da própria atribuição e, para o Técnico, visitantes/efetivo (RF 15) |
| **Visão Operacional** | Inspetor, Supervisor | Inspeções técnicas, fluxo de cargas, manutenções, fila de liberação, ocupação de berços e trail de decisões |
| **Visão Estratégica** | Diretor de Operações, Diretor-Presidente e Conselho | Aprovação/recusa, tempo médio de permanência, embarcações mais utilizadas, produtividade por cargo, % de berços operacionais e **valor declarado** |

Regras de privacidade aplicadas no próprio módulo:

- O **valor declarado** (indicador financeiro) só é carregado para a Direção/Conselho — funcionários e supervisão recebem o campo sanitizado.
- Dados de pessoas (`visitantes` e documentação de funcionários) **nunca** são carregados para Inspetor/Supervisor (restrição obrigatória do RF 1), mesmo que existam no banco.
- Cargos operacionais enxergam apenas os próprios registros de auditoria e as cargas ligadas à sua atribuição (Vision Layer).

Os painéis são exibidos no Painel Geral (`dashboard.html`) e no módulo de Relatórios (`relatorios.html`),
com atualização automática a cada 60 s, re-renderização ao alternar o tema claro/escuro e estado vazio
explícito quando ainda não há dados (nunca dados fictícios).

### 5. Verificações de Segurança (Anti-XSS)
```bash
npm install          # instala o jsdom (devDependency)
npm run audit:xss    # roda o scanner estático + a suíte de regressão XSS
```
- `npm run scan:xss` — análise estática: percorre todos os módulos `js/*.js` e
  falha (exit code 1) se encontrar interpolação `${...}` não codificada dentro
  de templates que geram HTML.
- `npm run test:xss` — suíte de regressão: executa as páginas reais em jsdom,
  injeta payloads de ataque (quebra de tag, quebra de atributo, quebra de string
  JavaScript, entidades HTML, backslash) via `localStorage`, sessão e QR Code, e
  confirma que nada é executado e que tudo é renderizado como texto.

---

## 🔒 Modelo de Segurança e Limitações da Arquitetura

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

- **Teste automatizado:** `node tests/test_haptics.js` (simula Android, iOS sem API, Firefox, falta de interação, HTTP, visibilidade e normalização dos padrões).

### Implantação (backend)

```bash
# 1. Aplicar a migração (tabelas emergencias + panic_webhook_config + RLS)
supabase link --project-ref <ref-do-projeto>
supabase db push
#    (ou executar supabase/migrations/20261007000000_panic_button_global.sql
#     manualmente no SQL Editor do Supabase)

# 2. Implantar a Edge Function
#    --no-verify-jwt: o app usa sessão própria (codigo_individual), não Supabase Auth;
#    a identidade/RBAC é validada DENTRO da função contra a tabela funcionarios.
supabase functions deploy panic-alert --no-verify-jwt
```

---

## 🔒 Banco de Dados e Schemas
O script DDL com as tabelas, funções RLS e políticas de acesso está disponível em `SPECs/schema.sql`. As migrações incrementais aplicáveis via Supabase CLI estão em `supabase/migrations/`.
