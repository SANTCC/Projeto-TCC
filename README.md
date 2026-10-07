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
- **Auditoria, Trail & Delegação:** Trilha imutável de decisões críticas com anexação de retificações e gestão de substituto ativo.
- **Localização & Tempos:** Posicionamento GPS dos navios, classificação automática de status e cálculo de ETA com velocidade fixa de 33 km/h (RN 9).
- **🚨 Botão de Pânico Global (Tempo Real):** O botão de emergência dispara a Edge Function `panic-alert`, que transmite o alerta via WebSocket (Supabase Realtime) para **todos os clientes conectados** — exibindo aviso fixo no rodapé de cada tela — e dispara um **webhook opcional (desativado por padrão)**.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, JavaScript (ES6 Modules)
- **Supabase Backend:** PostgreSQL com Row Level Security (RLS) e Auth Client (`@supabase/supabase-js`)
- **Supabase Edge Functions (Deno):** `panic-alert` — evento de servidor do botão de pânico global
- **Supabase Realtime (WebSocket):** Broadcast do alarme de emergência para todos os clientes conectados
- **Bibliotecas:** `qrcode.js`, `html5-qrcode`, `jsPDF`
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
npm test
```

## 🔒 Modelo de Segurança e Limitações da Arquitetura

### 1. Modelo de Autenticação e Sessão Client-Side
O NexusPort foi desenvolvido no contexto de um protótipo operacional portuário (TCC). A verificação de credenciais e permissões (RBAC) é validada no frontend (`js/tecnico_portos.js`, `js/vision-layer.js`), armazenando a sessão ativa em `sessionStorage`/`localStorage` (`nexus_session`).

### 2. Camada de Segurança RLS (Row Level Security) no Supabase
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
