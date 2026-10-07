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

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, Tailwind CSS, JavaScript (ES6 Modules)
- **Supabase Backend:** PostgreSQL com Row Level Security (RLS) e Auth Client (`@supabase/supabase-js`)
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

## 🔒 Banco de Dados e Schemas
O script DDL com as tabelas, funções RLS e políticas de acesso está disponível em `SPECs/schema.sql`.
