# Backlog 003 — Tarefas Pendentes (TODOs)

> Este documento contém exclusivamente as tarefas pendentes de implementação no sistema NexusPort. Todos os itens anteriormente concluídos foram verificados e removidos do backlog.

---

## 📋 Lista de Tarefas Não Implementadas (TODOs)

### 1. Salvar o login com Cookies ao invés de SESSION_STORAGE / LOCAL_STORAGE

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O gerenciamento de sessão da aplicação é realizado no client-side armazenando as informações do funcionário logado em `sessionStorage` e `localStorage` (`js/auth-guard.js` e `js/login.js`). Não foi implementado o armazenamento seguro de autenticação via cookies HTTP-only / SameSite.

### 2. Renderizar PDF no lado do servidor com armazenamento no Supabase Storage

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A geração de relatórios operacionais em PDF continua ocorrendo 100% no navegador do usuário utilizando a biblioteca `jspdf` em `js/relatorios.js`. Não há função server-side (Edge Function / Node) nem integração com buckets de armazenamento do Supabase Storage.

### 3. Popular cargos com usuários mock estáticos

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O sistema opera com os funcionários cadastrados diretamente na tabela `funcionarios` do Supabase. Não foi criado script de população automática com usuários de teste no padrão `[CARGO]_mock[123/321/456]`.

### 4. Popular histórico de ações e movimentações anteriores

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O histórico de auditoria (`logs_alteracoes`) e trail de decisões (`trail_decisoes`) reflete apenas as ações reais realizadas durante a utilização do sistema. Não há rotina de população de histórico prévio simulado de cargas e embarcações.

### 5. Contador de usuários online em tempo real

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O sistema não exibe indicador ou contador de usuários ativos no momento com atualização periódica (ex.: polling a cada 30s ou Supabase Presence).

### 6. Cookie de rastreamento de dispositivo para Google Analytics

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não foi implementada a configuração de cookie próprio/nativo para identificar e rastrear ações por dispositivo no Google Analytics.

### 7. Comprimir / minificar arquivos JS e CSS antes do deploy

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Todos os arquivos em `js/` e arquivos de estilo CSS no repositório permanecem sem etapa de minificação/bundle (ex.: via Terser, UglifyJS ou CleanCSS) no fluxo de deploy.

### 8. Workflow automatizado do Google Chrome Lighthouse para Pull Requests

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não existe pipeline de CI/CD (GitHub Actions) ou script Node.js local que execute o Lighthouse CLI e bloqueie PRs em caso de falhas nas métricas de performance e acessibilidade.

### 9. Reorganizar estrutura da pasta `js/`

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Todos os arquivos JavaScript do projeto estão localizados diretamente na raiz do diretório `js/`. Não foi criada a divisão em subpastas (`js/webmcp/`, `js/common/` e `js/pages/`).
