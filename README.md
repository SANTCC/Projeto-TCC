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
- **🚨 Botão de Pânico Global (Tempo Real):** Disparo de emergência via Supabase Realtime (WebSocket) com banner fixo em todas as telas conectadas e alerta tátil (vibração/áudio). O front-end não possui integração de webhook.
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
npm test                    # Executa toda a suíte de testes (Node.js/jsdom)
npm run audit:xss          # Análise estática e regressão Anti-XSS
npm run test:panic         # Testes do módulo de pânico e resiliência de migração
npm run test:webmcp        # Testes de integração com agentes de IA (WebMCP)
npm run test:screenshots   # Dados de demonstração, PostgREST simulado e catálogo de telas
npm run test:about         # Conteúdo, imagens e links do about.html
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
- **Sem webhook no cliente:** o front-end não configura, dispara nem testa webhooks (o painel que existia em `manutencao.html` foi removido). O disparo opcional permanece exclusivo da Edge Function, desativado por padrão na tabela `panic_webhook_config` — qualquer alteração nela é feita direto no banco (SQL Editor).
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
- **Carregamento:** o `gtag.js` (terceiro) só é baixado na primeira interação do visitante (ou no primeiro evento registrado), então a página abre sem depender de rede externa.
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

## 🚫 Bloqueio de IPs de VPN na borda (Vercel)

- `middleware.js` roda no Vercel Edge antes de responder páginas, APIs e arquivos estáticos. Usa o IP de origem (`x-real-ip`, via `@vercel/edge`) e compara o endereço com CIDRs IPv4/IPv6; não depende de JavaScript no navegador nem de um serviço externo de consulta de IP.
- A lista vem do GitHub [`X4BNet/lists_vpn`](https://github.com/X4BNet/lists_vpn), incluindo a lista agregada de VPNs e a fonte específica [`input/vpn/ips/protonvpn.txt`](https://github.com/X4BNet/lists_vpn/blob/main/input/vpn/ips/protonvpn.txt). A lista upstream declara licença MIT (aviso incluído em `licenses/X4BNet-lists-vpn-MIT.txt`); a atualização usa a API do GitHub na instalação (`prepare`) e no `prebuild`; também pode ser executada manualmente com `npm run vpn:update`. A snapshot versionada em `edge/vpn-cidrs.mjs` continua disponível se o GitHub estiver fora do ar.
- IP encontrado recebe redirect para `/vpn-blocked.txt`, servido como `text/plain; charset=utf-8` com o texto `AQUI NÃO!! TICO-TICO!!!!!!!!`. O próprio TXT é a única rota isenta para evitar um loop de redirect.
- **Limite importante:** nenhuma lista pública identifica todos os VPNs; provedores criam e removem IPs e há risco de falso positivo. Esta fonte se propõe a cobrir os provedores comuns, não a garantir 100%. A atualização da lista acontece em cada build/deploy, não em tempo real entre deploys.
- O gate atua no domínio servido pela Vercel. `npm start` é um servidor estático local e não executa middleware; chamadas diretas a domínios externos (como Supabase) também não passam por esse gate.
- **Testes:** `npm run test:vpn-blocklist`.

---

## 🎨 Recursos Locais (fontes, CSS e bibliotecas)

- **Comando:** `npm run assets` gera `css/nexus.css` (Tailwind compilado a partir de `tailwind.config.js`), `css/fonts.css`, as fontes `fonts/*.woff2` e copia as bibliotecas para `vendor/`.
- **Sem CDN:** as páginas não carregam Tailwind, Google Fonts, Chart.js, QRCode, jsPDF ou Supabase de terceiros. Os ícones usam um subconjunto da Material Symbols (`npm run assets:icones`, que exige `pip install fonttools brotli`).
- **Bibliotecas sob demanda:** `js/asset-loader.js` (`NexusAssets.carregar`) baixa Chart.js, QRCode, html5-qrcode, jsPDF e o cliente do Supabase só quando a tela precisa delas.
- **Terceiros fora do caminho crítico:** o `gtag.js` (Analytics) e o plugin do VLibras entram na primeira interação do visitante.
- **Cabeçalhos:** `dist/_headers` (gerado pelo build) e `vercel.json` publicam cache longo para estáticos, `no-cache` para HTML e a política de segurança (CSP). O gate Lighthouse mede a mesma política.
- **Verificação:** `node tools/assets.js --check` acusa arquivos gerados fora de sincronia.

---

## 📦 Build de Produção (minificação)

- **CI:** `.github/workflows/lighthouse.yml` roda em todo PR. Os relatórios vão como artefato.
- **Local:** `npm run lighthouse` (precisa de Google Chrome ou Chromium; use `CHROME_PATH` se não estiver no PATH). Gera `lighthouse-report/`.
- **Limiares:** `lighthouse/limiares.json`. Cada página é medida em 3 rodadas (mediana). Não há mais exceções de dívida conhecida: `meta-viewport`, `color-contrast`, `label`, `select-name` e `aria-dialog-name` passam em todas as páginas. O `about.html` é medido como página pública (documentação ilustrada).
- **Rede:** o gate bloqueia o host do backend (`lighthouse.rede.bloquearHosts`) para não ler nem escrever dados reais. Falhas de rede desse host são do ambiente de medição, não da aplicação: só elas (e as já ignoradas pelo Lighthouse) entram em `lighthouse.rede.ignorarErrosDeConsole`. Erros de JavaScript continuam reprovando o gate.
- **Testes:** `npm run test:lighthouse`.

---

## 📄 Relatório PDF no Servidor

- **Função:** `supabase/functions/relatorio-pdf` gera o PDF A4 (pdf-lib). O navegador envia só o identificador da carga e recebe o arquivo do servidor.
- **Cache:** bucket privado `relatorios-pdf`. O nome do arquivo é o SHA-256 do conteúdo, então dados iguais reaproveitam o PDF.
- **Implantação:** `supabase db push` (migrações `20261009010000` e `20261009020000`) e `supabase functions deploy relatorio-pdf --no-verify-jwt`.
- **Testes:** `npm run test:relatorio-pdf`.

---

## 🖼️ Documentação Ilustrada (about.html)

- **Página:** `about.html` explica como o sistema funciona — fluxo operacional, arquitetura, perfis/camadas de visão, regras de negócio e o passo a passo de implantação — com **capturas de tela de todas as páginas**, abertas pelas contas de demonstração.
- **Contas usadas nas capturas:** `MAT-0000` (Diretor-Presidente/Superintendente — Visão Estratégica), `MAT-2011` (Supervisor/Gerente de Operações — Visão Operacional) e `MAT-9999` (Técnico em Portos — Visão Própria). Cada conta entra pelo fluxo real (login → confirmação de cargo) e navega apenas pelas telas liberadas ao seu cargo.
- **Imagens e manifesto:** `docs/screenshots/` (PNG de página inteira + `manifest.json` com a origem de cada captura).
- **Gerar novamente:**
  ```bash
  npm install --prefix tools/screenshots   # Tailwind, fontes e bibliotecas vendorizadas
  CHROME_PATH=/usr/bin/chromium npm run screenshots   # capturas → docs/screenshots/
  npm run about                                       # regenera o about.html
  ```
- **Como funciona:** o Chromium é dirigido por `tools/screenshots/capturar.js`, que sobe um **PostgREST simulado** (`tools/screenshots/mock-postgrest.js`) com os dados de `tools/screenshots/demo-data.js`, substitui os CDNs por arquivos locais (`tools/screenshots/vendor.js`) e percorre `tools/screenshots/paginas.js`. Nada é gravado no banco e nenhuma credencial real é usada.
- **Testes:** `npm run test:screenshots` (dados, PostgREST simulado e matriz de permissões) e `npm run test:about` (estrutura, conteúdo e imagens do `about.html`).

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
