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

## 🔒 Banco de Dados e Schemas

- **DDL Completo:** `SPECs/schema.sql`
- **Migrações Incrementais:** `supabase/migrations/`
- **Diagnósticos de banco:** `SPECs/diagnostico/`
