# AGENTS.md — NexusPort: Sistema de Gestão Operacional Portuária

> Manual completo do desenvolvedor para agentes de IA e engenheiros de software. Leia este arquivo antes de modificar ou criar qualquer código no repositório.

---

## 1. Visão Geral do Projeto

**NexusPort** é uma plataforma web para gestão operacional de fluxos de cargas, navios, inspeções, pátio e rastreamento em tempo real no Terminal STS-01 do Porto de Santos.

O sistema foi desenvolvido para dar autonomia aos operadores no pátio e navios (registro e consulta de dados sem dependência de comunicação verbal), enquanto mantém decisões críticas (liberação de navios/cargas, aprovações de manutenção) sob hierarquia de supervisão e gerência.

---

## 2. Arquitetura e Stack Tecnológica

### Front-end
- **Tecnologias:** HTML5 puro, Tailwind CSS (via CDN) e JavaScript vanilla (ES6 Modules).
- **Sem Bundlers ou Frameworks JS:** Não utilizar React, Next.js, Vue, Angular, Svelte, TypeScript, Vite ou Webpack.
- **Navegação:** Páginas `.html` individuais (`index.html`, `dashboard.html`, `cargas.html`, `embarcacoes.html`, `manutencao.html`, `inspecao.html`, `relatorios.html`, `delegacao.html`, etc.).
- **Estado de Sessão:** `sessionStorage` e `localStorage` (chaves prefixadas por `nexus_`, como `nexus_session`).

### Back-end & Supabase
- **Serviço Principal:** Supabase (PostgreSQL + Row Level Security).
- **Acesso ao Banco:** Exclusivamente via cliente JavaScript SDK (`@supabase/supabase-js`) carregado no navegador (`js/supabase-client.js`).
- **Segurança no Banco (RLS):** Todas as tabelas do PostgreSQL possuem Row Level Security (RLS) ativado.
- **Supabase Realtime (WebSocket):** Transmissão de eventos de emergência (botão de pânico) e sincronização.
- **Edge Functions (Deno):** Função `panic-alert` para acionamento global e disparos de webhook.

### Bibliotecas do Client-Side (CDN / Local)
- **Gráficos:** Chart.js
- **QR Code:** `qrcode.js` (geração) e `html5-qrcode` (leitura por câmera)
- **PDF:** `jsPDF` (emissão de relatórios e etiquetas)

---

## 3. Estrutura do Repositório

```
nexusport/
├── index.html               # Tela de Login (autenticação por matrícula/código individual)
├── dashboard.html           # Painel Geral e KPIs
├── cargas.html              # Gestão de Cargas, Contêineres e Pátio
├── embarcacoes.html         # Gestão de Navios, Berços e Despacho
├── inspecao.html            # Checklists Técnicos e Avarias
├── manutencao.html          # Manutenções de Equipamentos e Botão de Pânico
├── relatorios.html          # Emissão de Relatórios em PDF
├── delegacao.html           # Delegação de Substitutos Operacionais
├── scanner.html             # Scanner de QR Code via câmera
├── cargas.html, etc.        # Outras telas de fluxo
├── js/                      # Módulos JavaScript
│   ├── config.example.js    # Exemplo de configuração do Supabase
│   ├── config.js            # Configuração local (não versionado)
│   ├── security.js          # Módulo de sanitização Anti-XSS (window.NexusSecurity)
│   ├── supabase-client.js   # Inicialização e wrapper do Supabase
│   ├── net-debug.js         # Módulo de depuração de rede / conexões
│   ├── auth-guard.js        # Proteção de rotas e RBAC
│   ├── charts.js            # Gráficos por camada de visão (Chart.js)
│   ├── panic-realtime.js    # Cliente do Botão de Pânico Global
│   ├── haptics.js           # Feedback tátil (vibração) e sonoro de emergência
│   └── webmcp-*.js          # Ferramentas e UI para Agentes de IA (WebMCP)
├── SPECs/                   # Documentação do projeto, DDLs e especificações
│   ├── Spec.md              # Especificação de requisitos (RFs e RNs)
│   ├── schema.sql           # DDL completo do banco de dados PostgreSQL
│   ├── tasks.md             # Tarefas e fases do projeto
│   └── webmcp.md            # Documentação da integração WebMCP
├── supabase/                # Migrações PostgreSQL e Edge Functions
│   ├── migrations/          # Migrações SQL numeradas
│   └── functions/           # Edge Functions em Deno (`panic-alert`)
├── tests/                   # Suítes de testes em Node.js / jsdom / Python
└── tools/                   # Ferramentas de desenvolvimento e scanners estáticos
```

---

## 4. Configuração e Execução Local

### 1. Configurar Variáveis de Ambiente do Supabase
Copie o arquivo de configuração de exemplo:
```bash
cp js/config.example.js js/config.js
```
Edite `js/config.js` com as credenciais do seu projeto Supabase:
```javascript
window.NEXUS_CONFIG = {
  SUPABASE_URL: "https://seu-projeto.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-aqui"
};
```
*Nota: Se o Supabase não estiver configurado ou estiver inacessível, o sistema continuará operando com simulador/fallback local.*

### 2. Executar o Servidor de Desenvolvimento
```bash
npm start
```
O servidor será iniciado em `http://localhost:3000`.

---

## 5. Padrões de Segurança e Anti-XSS (Obrigatório)

Todo o front-end renderiza componentes, tabelas e modais dinamicamente manipulando o DOM. Dados provenientes do Supabase, `localStorage`, formulários ou leituras de QR Code são considerados **não confiáveis**.

O módulo `js/security.js` expõe o namespace `window.NexusSecurity` e aliases globais que **devem** ser utilizados ao montar HTML dinâmico:

| Mapeamento | Função Helper | Exemplo de Uso |
|---|---|---|
| Interpolação de texto/atributo | `nexusEsc(valor)` | `<td>${nexusEsc(carga.codigo)}</td>` |
| Argumentos em manipuladores inline | `nexusJsArg(valor)` | `onclick="detalhar(${nexusJsArg(carga.id)})"` |
| URLs dinâmicas (`href`, `src`) | `nexusSafeUrl(valor)` | `<a href="${nexusSafeUrl(url)}">` |

### Regras Anti-XSS
1. **Nunca** interpole variáveis puras dentro de `innerHTML` sem usar `nexusEsc`.
2. Em eventos inline (ex.: `onclick="..."`), use sempre `nexusJsArg`.
3. Para textos puros, dê preferência a `element.textContent = valor`.
4. Antes de submeter código, execute a verificação estática Anti-XSS:
   ```bash
   npm run scan:xss
   ```

---

## 6. Modelo de Permissões e Camadas de Visão (RBAC)

O sistema possui 3 Camadas de Visão principais:

1. **Visão Própria (Cargos Operacionais):**
   - Estivador, Conferente, Arrumador, Consertador, Planejador de Pátio/Navio, Técnico em Portos.
   - Acesso restrito aos registros atribuídos diretamente ao funcionário autenticado.
2. **Visão Operacional (Tático / Gestão):**
   - Inspetor, Supervisor / Gerente de Operações.
   - Visão ampla das operações, manutenções, inspeções e fila de liberação.
   - *Restrição:* Não possuem acesso a dados sensíveis de pessoas (visitantes e documentos pessoais de funcionários).
3. **Visão Estratégica (Direção e Conselho):**
   - Diretor de Operações, Diretor-Presidente, Conselho de Administração.
   - Visão consolidada de KPIs, produtividade, valor declarado e relatórios estratégicos.

---

## 7. Testes e Validação

Execute os testes automatizados do projeto antes de finalizar alterações:

```bash
# Executa a suíte de testes em Python (verificação de fases)
npm test

# Suítes específicas em Node.js / jsdom:
npm run test:graficos      # Painéis e gráficos por camada de visão
npm run test:refresh       # Atualização de gráficos e estado de sincronização
npm run test:bercos        # Vínculos e regras de berços operacionais
npm run test:panic         # Sistema de pânico global e resiliência a 404/PGRST205
npm run test:webmcp        # Ferramentas WebMCP para agentes de IA
npm run test:gravacao      # Gravações no Supabase e login por código
npm run audit:xss          # Análise estática + testes de regressão Anti-XSS
```

---

## 8. Diretrizes de Codificação para Agentes

1. **Vanilla JavaScript:** Não adicione dependências de build (Babel, Webpack, SASS, TypeScript).
2. **Modularidade:** Mantenha a lógica de UI separada dos clientes de dados. Use ES Modules (`import`/`export`) onde apropriado.
3. **Confirmação de Ações Críticas:** Operações como cancelamento, liberação de navios/cargas e aprovações devem solicitar confirmação do usuário com modal explicativo.
4. **Mensagens de Feedback:** Utilize banners inline para notificações ao operador. Evite o uso de `alert()` ou `toast` desalinhados da identidade visual.
5. **Idioma:** Todas as telas, comentários de código e mensagens ao usuário devem estar em **pt-BR**.
6. **Integridade de Testes:** Garanta que todas as suítes de teste (`npm test`, `npm run audit:xss`, etc.) passem com 100% de sucesso.
