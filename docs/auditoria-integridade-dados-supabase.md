# Auditoria de integridade de dados — Frontend NexusPort × Supabase

**Data:** 17/10/2026
**Repositório:** `SANTCC/Projeto-TCC` (branch `arena/f4ef262d-projeto-tcc`, HEAD original `b94ee3c`)
**Projeto Supabase auditado:** `loedodixvmadxqgykehh` (`TCC - Automação Para um Sistema de Cargas de um Porto`, us-west-2, PostgreSQL 17.6.1)
**Método:** inspeção do schema vivo pelas ferramentas MCP autenticadas do Supabase (somente leitura; nenhuma escrita, DDL ou alteração de RLS), leitura estática do repositório, execução da suíte local (`npm test`), `npm run build` e `npm run audit:xss`.

> Estado: **auditoria parcial com remediação aplicada**. Nenhum registro de produção foi criado, alterado ou removido; schema, RLS e Edge Functions não foram tocados. As correções seguem em PR para revisão (sem merge automático).

---

## 1. Schema inspecionado

Consultas executadas via `execute_query` (uma instrução por chamada), sempre em `information_schema` / `pg_catalog` / `pg_policies`, além de `select` de contagem e de linhas de referência:

- 26 tabelas em `public`; **nenhuma view**. 24 têm `id` (23 uuid; `bercos.id` é text no padrão `BERCO-NN`; `cargo_niveis` e `tentativas_login` não têm `id`). `created_at` existe em 23 das 26 tabelas (faltam em `cargo_niveis`, `panic_webhook_config` e `tentativas_login`).
- **14 tipos enum** (`cargo_enum`, `status_carga_enum`, `status_manutencao_enum`, `tipo_decisao_enum`, `tipo_alteracao_enum`, `tipo_entidade_enum`, `estado_carregamento_enum`, `estado_container_enum`, `estado_navio_enum`, `estado_guindaste_enum`, `localizacao_navio_enum`, `nivel_acesso_enum`, `referencia_tempo_enum`, `resultado_inspecao_enum`). `emergencias.estado` e `emergencias.origem` são `text` com CHECK (`ATIVA|RESOLVIDA`; `EDGE_FUNCTION|CLIENT_FALLBACK`).
- Constraints: PK/UNIQUE/FK/CHECK; `bercos.id ~ '^BERCO-[0-9]{2}$'`; `distancia_km > 0`; UNIQUE em `navios.numero_imo`, `containers.numero_identificacao`, `funcionarios.matricula/email/codigo_individual`, `tipos_carga.nome`, `checklist_modelos.tipo_carga_id`, `agendamentos.carga_id`, `rotas_maritimas(origem,destino)`; FKs RESTRICT em `cargas.tipo_carga_id`, `cargas.checklist_modelo_id`, `inspecao_itens.checklist_item_id`, `retificacoes_trail.trail_id`.
- Funções: `login_funcionario` (SECURITY DEFINER), `login_tentativas_relatorio` (SECURITY DEFINER), `fn_propagar_status_navio`, `fn_bercos_set_updated_at`.
- **67 políticas de RLS em 26 tabelas, todas com `qual = true` / `with_check = true`** (nenhum filtro por usuário, cargo ou inquilino). A maioria concede `SELECT/INSERT/UPDATE/DELETE` ao role `public`; `bercos` usa as roles `anon` e `authenticated`.
- Edge Functions publicadas: `sos-webhook`, `relatorio-pdf`, `despacho-embarcacao`, `kpis-calculo`, `scanner-qr`, `vpn-gate` — **todas com `verify_jwt = false`**.
- Histórico de migrações do projeto vivo: apenas `20260926232918 add_navio_id_to_cargas` (18 arquivos em `supabase/migrations/`, ou seja, **o repositório está à frente do banco**).

### 1.1 Contagens observadas (somente leitura)

`navios` 2 (Golden Star, Jaguar) · `containers` 2 (MSCU-1234567, MSCU-1234568) · `cargas` 3 criadas durante a sessão (14:47–15:11 UTC de 17/10) · `bercos` 15 (Berço 01/Jaguar e 02/Golden Star ocupados) · `funcionarios` 13, incluindo **MAT-1111 “Espectador”** · `tipos_carga` 7 · `rotas_maritimas` 2 · `agendamentos` 1 · `checklist_modelos` 7 / `checklist_itens` 42 · `logs_alteracoes` 21. Vazias: `manutencoes`, `historico_manutencoes`, `emergencias`, `inspecoes`, `inspecao_itens`, `visitantes`, `delegacoes_supervisor`, `trail_decisoes`, `estivador_cargas`, `leituras_qr_code`, `retificacoes_trail`.

> Observação: as 3 cargas apareceram **depois** do início da auditoria, sem nenhuma escrita nossa — o projeto vivo está em uso concorrente. Não foi possível atribuir autoria.

---

## 2. Objetos e relacionamentos (schema vivo)

```
funcionarios ──< cargas? (não)            funcionarios ──< manutencoes.solicitado_por? (texto)
funcionarios ──< delegacoes_supervisor.supervisor_titular_id / substituto_id
funcionarios ──< inspecoes.inspetor_id · logs_alteracoes.funcionario_id
funcionarios ──< trail_decisoes.funcionario_id · leituras_qr_code.funcionario_id
funcionarios ──< emergencias.funcionario_id · estivador_cargas.estivador_id

tipos_carga ──< cargas.tipo_carga_id (RESTRICT) · containers.tipo_carga_id
tipos_carga ──1 checklist_modelos.tipo_carga_id (UNIQUE) ──< checklist_itens
checklist_modelos ──< inspecoes.checklist_modelo_id · cargas.checklist_modelo_id
inspecoes ──< inspecao_itens ──> checklist_itens

navios ──< cargas.navio_id · containers.navio_id · manutencoes.navio_id
       ──< historico_manutencoes.navio_id · bercos.navio_id · agendamentos? (não)
containers ──< cargas.container_id · manutencoes.container_id · historico_manutencoes.container_id
guindastes ──< manutencoes.guindaste_id · historico_manutencoes.guindaste_id
cargas ──< inspecoes.carga_id · estivador_cargas.carga_id · agendamentos.carga_id (UNIQUE)
rotas_maritimas (origem,destino UNIQUE) — sem FK com navios (destino é texto livre)
trail_decisoes ──< retificacoes_trail.trail_id (RESTRICT)
```

Enums relevantes: `status_carga_enum` (9 valores: AGENDAMENTO, RECEBIMENTO_INSPECAO, ARMAZENAGEM, PRONTA_PARA_ENTREGA, SAIDA, EM_TRANSITO, ENTREGUE, RECUSADA, CANCELADA); `status_manutencao_enum` (SOLICITADA, APROVADA, RECUSADA, CONCLUIDA); `tipo_alteracao_enum` (**CRIACAO, EDICAO, EXCLUSAO, REIMPRESSAO_ETIQUETA, EXPORTACAO** — não existe valor para “leitura”); `tipo_entidade_enum` (NAVIO, CONTAINER, CARGA, FUNCIONARIO, VISITANTE, GUINDASTE, MANUTENCAO, CHECKLIST, ROTA, TIPO_CARGA, EMERGENCIA); `localizacao_navio_enum` (3); `estado_container_enum`/`estado_navio_enum` (OPERANTE, AGENDADO_PARA_REFORMA, EM_REFORMA, APROVADO_PARA_REFORMA).

---

## 3. Mapa funcionalidade → tabela → UI

| Funcionalidade | Tabelas/objetos usados | Onde na UI | Situação verificada |
|---|---|---|---|
| Embarcações / navios | `navios`, `bercos`, `rotas_maritimas`, `logs_alteracoes`, `trail_decisoes` | `embarcacoes.html` + `js/pages/embarcacoes.js` | Cadastro agora exige confirmação do banco; ETA usa `rotas_maritimas.distancia_km` e 33 km/h (RN 9); berço vem do banco |
| Cargas / pátio | `cargas`, `containers`, `tipos_carga`, `agendamentos`, `inspecoes` | `cargas.html` + `js/pages/cargas.js` | Insert real com `tipo_carga_id`; sem carga local “fantasma”; limite de pátio é heurístico (AUD-11) |
| Manutenção | `manutencoes`, `historico_manutencoes`, `navios`, `containers`, `guindastes` | `manutencao.html` + `js/pages/manutencao.js` | FKs de equipamento e `solicitado_por`/`registrado_por` corrigidos |
| Dashboard / analytics | `cargas`, `containers`, `navios`, `manutencoes`, `logs_alteracoes`, `trail_decisoes`, `funcionarios` | `dashboard.html`, `js/pages/charts.js`, `js/data-repository.js` | Metas/tempos fictícios removidos; fallback de cache só em falha de leitura; gráficos calculados de dados reais |
| Funcionários | `funcionarios`, `delegacoes_supervisor` | `tecnico_portos.html` + `js/pages/tecnico_portos.js` | CRUD real; CPF/documento interno no schema; login por RPC |
| Emergências | `emergencias`, `logs_alteracoes`, Realtime broadcast | `js/panic-realtime.js` | Persistência real; Edge Function com slug divergente (AUD-04) |
| Rotas | `rotas_maritimas` | modal de rota e `listar_rotas` (WebMCP) | Sem catálogo estático; falha de gravação não cria rota na tela |
| Portos / berços | `bercos` | painel de berços | 15 berços reais; ocupação revalidada no banco antes de gravar |
| Autenticação | RPC `login_funcionario`, `tentativas_login`, cookies | `login.html`, `confirm-role.html`, `auth-guard.js` | RPC + bloqueio por tentativas; fallback local de login é risco (AUD-03) |
| Contêineres | `containers` | `embarcacoes.html` | Lista agora é somente o banco; cadastro exige confirmação |
| Inspeções | `inspecoes`, `inspecao_itens`, `checklist_modelos`, `checklist_itens`, `cargas` | `inspecao.html` + `js/pages/inspecao.js` | Modelo de checklist por tipo; itens não cruzam modelos |
| Visitantes | `visitantes` (sem coluna `status`) | `tecnico_portos.html` | Status derivado de `data_hora_saida`; escritas inválidas removidas |
| Delegações | `delegacoes_supervisor` | `delegacao.html`, WebMCP | CRUD real; revogação em massa (AUD-12) |

---

## 4. Achados (ID · severidade · status)

Legenda de status: **CONFIRMADO** (evidência direta no schema vivo ou no código executado), **PROVÁVEL** (evidência estática forte, sem reprodução em runtime), **RUNTIME** (depende de execução em ambiente real).

| ID | Sev. | Funcionalidade | Arquivo/Linhas | Achado | Evidência | Correção recomendada |
|---|---|---|---|---|---|---|
| AUD-01 | Crítica | Segurança / todas | `supabase/config.toml`; `pg_policies` | **67/67 políticas RLS com `true`**; qualquer portador da anon key lê/escreve/apaga tudo, inclusive `funcionarios.cpf`/`documentacao_interna`, `logs_alteracoes`, `trail_decisoes`, `emergencias` | `select count(*) … where qual='true'` → 67/67; `qual` das políticas de `funcionarios` = `true` | Autenticação real (Supabase Auth/JWT), políticas por cargo e inquilino; mover escritas sensíveis para RPC/Edge Functions; **não** aplicar sem autorização do dono |
| AUD-02 | Crítica | Auth / sessão | `js/session-cookies.js` (1–120); `js/auth-guard.js` | Sessão/cargo são gravados em cookie **não assinado** e localStorage; perfil “somente leitura” é imposto só no cliente | cookie `nexus_session` legível/alterável; `isReadOnly` em JS | Sessão assinada no servidor (HttpOnly/Secure) ou token JWT; nunca confiar em cargo do cliente |
| AUD-03 | Alta | Login | `js/pages/login.js:176–249` | Se a RPC falhar (rede) **ou não encontrar o código**, o login cai para `nexus_func_list` local — contorna bloqueio por tentativas do servidor | `catch { console.warn(... 'recorrendo aos dados locais') }`; busca em `localStorage` | Em produção, falha de RPC deve gerar erro; fallback local só em modo demonstração explícito |
| AUD-04 | Alta | Emergências | `js/panic-realtime.js:27,740` | Frontend invoca Edge Function **`panic-alert`**, mas a função publicada chama-se **`sos-webhook`** → caminho servidor sempre falha; resta fallback cliente + `origem=CLIENT_FALLBACK` | `list_edge_functions` (sos-webhook…); `FUNCTION_SLUG='panic-alert'` | Publicar/renomear a função para `panic-alert` (ou corrigir o slug) e validar o webhook; manter fallback apenas como contingência. ✅ Mitigação aplicada: quando o fallback não grava em `emergencias`, o alerta informa explicitamente que a emergência **não foi registrada no banco** |
| AUD-05 | Alta | Inspeções | `js/pages/inspecao.js:490–540,690–740` | `inspecao_itens` era gravado **sem escopo de modelo** (ou com itens escolhidos por índice entre todos os modelos), associando itens ao checklist errado | diff: consulta sem `.eq('checklist_modelo_id')`; payload sem `checklist_modelo_id` | ✅ Corrigido: modelo resolvido por tipo, consulta filtrada, `checklist_modelo_id` em `inspecoes`; sem modelo → pendência explícita |
| AUD-06 | Alta | Visitantes | `js/pages/tecnico_portos.js:1183,1287–1305,1470,1580` | A tabela **não tem `status`**; página lia `s.status`, fazia `update({status})` e `insert` com campos inexistentes (PGRST204 silencioso) | colunas de `visitantes` via MCP: `nome,documento,motivo,data_hora_entrada/saida,registrado_por` | ✅ Corrigido: situação derivada de `data_hora_saida`; updates/inserções alinhados ao schema |
| AUD-07 | Alta | Navios / contêineres / guindastes | `js/pages/embarcacoes.js:2330–2400,3010–3080,3360–3410` | Cadastro gravava no cache local **antes** de confirmar o banco; falha de insert era engolida e a UI dizia “sincronizado com sucesso” | diff mostra `naviosList.unshift` antes do insert; `catch` só com `console.warn` | ✅ Corrigido: `error` propagado, inserção local só após confirmação; sem conexão → erro explícito |
| AUD-08 | Média | Contêineres | `js/pages/embarcacoes.js:2426–2470` | Lista mesclava contêineres existentes **só no cache** (`supConts.push(local)`), exibindo cadastros nunca persistidos | diff removido; agora `containersList = supConts` e erro esvazia a lista | ✅ Corrigido |
| AUD-09 | Média | Manutenção | `js/pages/manutencao.js:342–370,400–415,834–870` | OS/histórico sem `guindaste_id`/`navio_id`/`container_id`, sem `solicitado_por`/`registrado_por` → OS órfã, sem vínculo com o ativo | schema: `guindaste_id`/`container_id`/`navio_id` são uuid FK; `solicitado_por` e `registrado_por` são **uuid FK → funcionarios(id)** (nullable, ON DELETE SET NULL) | ✅ Corrigido: FK resolvida por nome/identificação; autoria resolvida para o **UUID** do funcionário (nunca a matrícula) e `null` quando não resolvível |
| AUD-10 | Média | Tipos de carga / checklists | `js/pages/tipos-carga.js:203–262` | Ao encontrar catálogo vazio, o app **semeava** tipos/checklists estáticos no banco (dado de negócio mock vindo do frontend); sem vínculo explícito `modeloId` | diff: bloco de seed removido; `modeloId`/`ordem` adicionados | ✅ Corrigido: banco vazio → estado vazio real; seed é responsabilidade de migração/`supabase/seed.sql` |
| AUD-11 | Média | Pátio / dashboard | `js/pages/cargas.js:1616–1623`; `js/data-repository.js:1049–1066`; `js/pages/dashboard.js:376` | Capacidade “100 ha (1.000.000 m²)” é comparada ao **número de cargas** (`1 carga = 1 ha`), gerando taxa de ocupação sem base dimensional | `CAPACIDADE_MAXIMA_PATIO = 100` vs `cargasNoPatio.length` | ✅ Rótulo corrigido: a UI passou a dizer “limite operacional configurado de 100 cargas ativas” e não converte mais hectares em cargas. **PROVÁVEL**: o parâmetro 100 ainda precisa de justificativa na especificação |
| AUD-12 | Média | Delegação | `js/pages/delegacao.js:602–606` | Revogação faz `update({ativo:false}).eq('ativo', true)` — atinge **todas** as delegações ativas, não só a do usuário | trecho citado | Restringir por `id`/titular, com confirmação no servidor |
| AUD-13 | Média | Auditoria / trail | `js/auditoria.js:330–399` | Chamadas “legadas” de `registrarTrailDecisao` gravavam a decisão **só no localStorage** e retornavam `ok:true` quando o insert falhava (falso sucesso em decisão crítica) | diff: retorno agora `{ok:false}` e sem escrita local quando há cliente e insert falha | ✅ Corrigido (permanece comportamento offline sem cliente, documentado) |
| AUD-14 | Média | Logs de auditoria | `js/pages/scanner.js:294–305` | Leitura de QR é registrada em `logs_alteracoes` como **`REIMPRESSAO_ETIQUETA`** — o enum não tem valor de leitura; trilha imutável fica semanticamente errada | enum vivo; `tipo_alteracao: 'REIMPRESSAO_ETIQUETA'` | Usar apenas `leituras_qr_code` para leitura; se necessário, criar valor `LEITURA_QR` via migração autorizada |
| AUD-15 | Média | Seed / dados de demonstração | `supabase/seed.sql`; banco vivo | Seed cria 20 funcionários `MOCK-*` e dados `DEMO`, explicitamente “não aplicar em produção”; o banco vivo contém **MAT-1111 “Espectador”** (registro de demonstração) | `grep` seed; `select matricula,nome` em `funcionarios` | Remover MAT-1111 somente com autorização do dono; manter seed restrito a ambiente local |
| AUD-16 | Baixa | Indicadores | `js/data-repository.js:1003–1030` | Fallback para `localStorage` era usado também quando o banco retornava **zero linhas** legitimamente, mostrando dados antigos como atuais | diff: `falhaLeitura` | ✅ Corrigido: cache só em falha de leitura |
| AUD-17 | Baixa | Relatórios | `js/pages/relatorios.js:43–50,600–607` | Código sintético `CRG-2026-NNN` para carga sem código e linha fictícia de produtividade quando o usuário não estava em `funcionarios` | diff | ✅ Corrigido: “Não informado” e tabela vazia |
| AUD-18 | Baixa | Dashboard | `js/pages/dashboard.js:38–46,180–200` | Toast “Relatório PDF A4 emitido” sem gerar PDF; metas/tempos fixos (20/30/5/5 e 1,5/2,1/18,4/4,8 h) | diff | ✅ Corrigido |
| AUD-19 | Baixa | Camada de visão | `js/vision-layer.js` (removido) | Base mock de navios/cargas/funcionários e `getMockVisaoData`/`getEstratégicoMetrics` com métricas fabricadas | diff (−101 linhas) | ✅ Corrigido: só dados reais |
| AUD-20 | Baixa | Login | `js/pages/login.js` (removido) | `mockEmployees` e backdoor MAT-1111 “Espectador” no cliente | diff (−17 linhas) | ✅ Corrigido |
| AUD-21 | Baixa | IDs locais | `js/auditoria.js:374`, `cargas.js:1638`, `embarcacoes.js:3020`, `manutencao.js:199/326/827`, `tecnico_portos.js:256/1069/1568` | 9 pontos geram IDs de exibição com `Math.random` (colisão; ID muda a cada recarga) | grep | Derivar de UUID do banco ou sequência persistida; nunca usar como chave de negócio |
| AUD-22 | Baixa | Edge Function | `js/pages/embarcacoes.js:1055–1067` | `nexusDespacharEmbarcacaoEdgeFunction` não tem chamador e devolve `null` em erro (código morto) | grep sem consumidores | Remover ou integrar ao fluxo real com tratamento de erro |
| AUD-23 | Baixa | Dashboard | `js/pages/dashboard.js:154–164` | Quando `window.nexusSupabase` não existe, a planilha executiva lê `localStorage` sem avisar que os números são cache | trecho citado | Exibir estado “sem conexão” em vez de números não confirmados |
| AUD-24 | Baixa | Manutenção | `js/data-repository.js:1121` | OS antigas são casadas ao navio por regex `Navio:\s*(.+?)\s+-` na descrição — frágil a mudanças de texto | trecho citado | Persistir FK desde a criação (feito nas novas) e migrar legado |
| AUD-25 | Média | Agendamento de cargas | `js/pages/cargas.js:1646–1678`; `js/pages/tipos-carga.js:210–218` | Se o catálogo falhar (ou o tipo escolhido não existir no banco), o agendamento prosseguia e gravava a carga **sem `tipo_carga_id`/checklist**, deixando a carga órfã | `if (tipoCargaUuid) insertPayload.tipo_carga_id = ...` (antes) | ✅ Corrigido: sem UUID do tipo confirmado, o agendamento é recusado com erro e nada é gravado (mesma regra do WebMCP/RN 13) |
| AUD-26 | Alta | Guindastes / movimentação | `js/pages/cargas.js:2260–2306`; `js/webmcp/webmcp-dados.js:313,372` | Quando o cache estava vazio, o app **fabricava dois guindastes** (`GND-01-STS`, `GND-02-STS`), gravava-os no `localStorage` e os aceitava em tarefas de movimentação; `listar_guindastes` também devolvia essa frota fictícia | `guindastesDisponiveis()` criava o par padrão; `guindastesEfetivos()` devolvia `GUINDASTES_PADRAO`; a lista mesclava equipamentos só do cache mesmo com leitura do banco bem-sucedida | ✅ Corrigido: frota padrão removida; com leitura do banco OK a lista é exatamente a de `guindastes` (equipamento só no cache não aparece nem é aceito); lista vazia → estado vazio real |
| AUD-27 | Alta | WebMCP / catálogo de tipos | `js/webmcp/webmcp-dados.js:296–315`; `js/webmcp/webmcp-cargas.js:172–212`; `js/webmcp/webmcp-embarcacoes.js:352–358` | `listar_tipos_carga` expunha o catálogo **estático** como se fosse o cadastro do banco, e `agendar_carga`/`cadastrar_container` validavam o tipo por ele — um agente podia receber/“validar” tipos inexistentes em `tipos_carga` | `tiposCarga()` devolvia `window.NEXUS_TIPOS_CARGA` desde o primeiro carregamento; nenhuma verificação de origem | ✅ Corrigido: `NEXUS_TIPOS_CARGA_ORIGEM` (`estatico`/`db`/`vazio`/`indisponivel`); falha de leitura com cliente configurado limpa o catálogo exibido; WebMCP só aceita `db`/`vazio`, força a consulta antes de validar e **falha fechado** (`CATALOGO_INDISPONIVEL`) quando não consegue ler |
| AUD-28 | Média | Contêineres | `js/pages/embarcacoes.js:3021–3045` | Se o tipo escolhido não fosse encontrado em `tipos_carga`, o contêiner era gravado **sem `tipo_carga_id`** (FK nula), perdendo o vínculo com checklist/inspeção | `...(tipoCargaId ? { tipo_carga_id } : {})` | ✅ Corrigido: sem UUID confirmado no banco, o cadastro é recusado com erro e nada é gravado |
| AUD-29 | Média | Autorização / níveis | `js/auth-guard.js:55–105`; `js/vision-layer.js:33–85`; tabela `cargo_niveis` | A tabela `cargo_niveis` (10 cargos → `OPERACIONAL/GESTAO/TATICO/ESTRATEGICO`) existe e está preenchida, mas **nenhum código a consulta**: cargo→nível e permissões são listas estáticas duplicadas no JS | `grep` não encontra `from('cargo_niveis')`; mapa completo hardcoded | **PROVÁVEL (decisão de arquitetura)**: no médio prazo, derivar nível/permissões de `cargo_niveis` no servidor (RLS/RPC); no cliente, manter apenas como apresentação. Exige autorização e mudança de política |
| AUD-30 | Baixa | Status de carga | `js/pages/cargas.js:1360–1370`; `js/data-repository.js`; enum `status_carga_enum` | O enum do banco tem 9 valores, incluindo **`SAIDA`**, que não tem rótulo/cor/filtro na UI (`SAIDA` cairia no badge cinza e não aparece em `STATUS_CARGA` do WebMCP) | enum vivo vs. mapas do frontend | Mapear `SAIDA` (rótulo/cor/transição) ou confirmar que é estado legado e removê-lo por migração autorizada |
| AUD-31 | Baixa | Perfil somente leitura | `js/auth-guard.js:151–181`; `js/data-repository.js:232,277`; `js/layout.js:618,742–835` | O perfil “Espectador” é identificado por **matrícula hardcoded `MAT-1111`** (e nome `ESPECTADOR`), replicado em vários módulos; não há campo no schema que expresse esse perfil | `grep MAT-1111` em 6 arquivos | Representar o perfil no banco (ex.: coluna/flag em `funcionarios` ou `cargo_niveis`) e ler da sessão; remover a regra por matrícula |
| AUD-32 | Baixa | Inventário de equipamentos | `migrations/001_create_bercos.sql`; `js/pages/embarcacoes.js` | O repositório tem duas fontes de schema (`supabase/migrations` e `migrations/001_create_bercos.sql`) e o README legado não indica qual é aplicada; o banco vivo tem 15 berços com ids `BERCO-NN`, enquanto o JSON local usa `B1`/nomes | comparação schema vivo × migration legada | Consolidar em `supabase/migrations` e marcar a pasta `migrations/` como histórica; sem alterar o banco nesta auditoria |

---

## 5. Dados mock / fabricados — inventário

**Removidos (working tree):**
- `js/vision-layer.js`: base mock inteira (`navios`, `cargas`, `funcionarios` fictícios), `getMockVisaoData`, `getEstratégicoMetrics`.
- `js/pages/login.js`: `mockEmployees`, MAT-1111 e o perfil “Espectador” embutido.
- `js/pages/dashboard.js`: metas (20/30/5/5), tempos médios (1,5/2,1/18,4/4,8 h), status IDEAL/ATENÇÃO/CRÍTICO derivados delas, toast de “PDF emitido”, stubs vazios (`initQrCodeEtiquetas` etc.).
- `js/pages/tipos-carga.js`: seed automático de `tipos_carga`, `checklist_modelos` e `checklist_itens` a partir do catálogo estático.
- `js/pages/relatorios.js`: código sintético de carga e linha fictícia de produtividade.
- `js/pages/inspecao.js`: associação de itens “por posição” entre modelos diferentes.
- `js/pages/cargas.js` e `js/webmcp/webmcp-dados.js`: frota padrão fictícia `GND-01-STS`/`GND-02-STS`, gravada no `localStorage` e aceita em movimentações.
- `js/webmcp/webmcp-dados.js`: catálogo estático exposto por `listar_tipos_carga` como se fosse o cadastro do banco.

**Mantidos por serem configuração legítima (não são dados de negócio):** rótulos/categorias de checklist de referência em `NEXUS_TIPOS_CARGA` (usados apenas quando **não há cliente Supabase**, isto é, no modo offline/demonstração documentado no README; com cliente configurado e leitura falhando, a lista é limpa e o WebMCP falha fechado), labels de cargo/status, ícones, menus e setores de pátio, capacidade nominal de contêiner (75 m³) e constantes da spec (33 km/h RN 9, 15.000 t, 300 m). A área de 100 ha existe na spec, mas **não** sustenta a equivalência 1 carga = 1 ha usada em AUD-11.

**Fixtures de teste:** `tests/fake-supabase-db.js`, `tests/webmcp-harness.js` e os dublês em `tests/*.js` (incluindo `supabaseRotasFalso`) — isolados, nunca carregados por `*.html` de produção.

**Ainda no banco vivo (não removido — exige autorização):** MAT-1111 “Espectador”; navios “Golden Star”/“Jaguar” e contêineres `MSCU-1234567/8` (aparência de demonstração, origem não comprovada). O seed `MOCK-*` **não** está aplicado no banco vivo (as 13 matrículas reais foram conferidas).

---

## 6. Fluxos quebrados e correções aplicadas (working tree, sem commit)

| Arquivo | Correção |
|---|---|
| `js/pages/inspecao.js` | `checklist_modelo_id` enviado em `inspecoes` (2 blocos); itens gravados apenas do modelo correto; sem modelo → pendência visível; não sobrescreve mais o cache local com estado inventado |
| `js/pages/embarcacoes.js` | Inserts de navio/contêiner/guindaste com `error` propagado e retorno antecipado; lista de contêineres só do banco; `data_saida` persistida no cadastro do navio; contêiner exige `tipo_carga_id` confirmado |
| `js/pages/manutencao.js` | FKs de equipamento nas OS/histórico + `solicitado_por`/`registrado_por` como UUID de `funcionarios` (helper `resolverFuncionarioId`) |
| `js/pages/tecnico_portos.js` | Remove leitura/escrita de `visitantes.status`; `registrado_por` recebe o UUID do funcionário (FK), não a matrícula; confirmação de insert com erro |
| `js/pages/cargas.js` | Agendamento exige `tipo_carga_id` resolvido no banco; sem ele, erro e nenhuma gravação; frota fictícia de guindastes removida (lista = banco); capacidade rotulada como limite operacional, sem converter hectares em cargas |
| `js/webmcp/webmcp-dados.js` | Catálogo de tipos só é exposto após leitura do banco (`NEXUS_TIPOS_CARGA_ORIGEM`); `guindastesEfetivos()` não fabrica frota |
| `js/webmcp/webmcp-cargas.js` / `webmcp-embarcacoes.js` | Validação de tipo exige catálogo do banco e falha fechada (`CATALOGO_INDISPONIVEL`) |
| `js/panic-realtime.js` | Fallback sem persistência avisa que a emergência não foi registrada no banco |
| `tests/test_webmcp_paginas.js` | Dublê passa a modelar `tipos_carga`/`checklist_modelos`/`checklist_itens` e o `insert` de `navios` |
| `js/pages/tipos-carga.js` | Sem auto-seed no banco; estado vazio real; `modeloId` explícito e `ordem` do checklist; origem do catálogo (`estatico`/`db`/`vazio`) exposta para os validadores |
| `js/pages/dashboard.js` | Sem metas/tempos/PDF fictícios; escaping uniforme das células; ocupação do pátio sem equivalência hectare↔carga |
| `js/pages/relatorios.js` | Sem código sintético nem linha fictícia de produtividade |
| `js/data-repository.js` | Cache de indicadores só quando a leitura falha |
| `js/auditoria.js` | Trail não retorna sucesso sem linha no banco |
| `js/vision-layer.js`, `js/pages/login.js` | Remoção da infraestrutura mock |
| `about.html` | Regenerado pelo gerador oficial (estava dessincronizado) |
| `tests/test_visitante_mesmo_cpf_nome.js` | Conecta banco falso após a carga para os cenários sem `nexusSupabase` |
| `tests/test_backlog_tipos_container.js` | Pré-condição assíncrona aguardada (o catálogo do banco é consultado antes de validar) |
| `tests/test_backlog2_tarefa7_volume_container_entrega.js` | Contêiner existe no banco falso (a página não lê mais cache como fonte) |

---

## 7. Autenticação / RLS — análise

- **A anon key está no frontend** (`js/config.js`) e é suficiente para ler/escrever todas as tabelas: RLS não protege nada (AUD-01).
- **Perfil somente leitura** é decidido por **matrícula fixa `MAT-1111`** no cliente (AUD-31); não existe no schema e a restrição de servidor nunca existiu. O backdoor de login que citava esse perfil foi removido, mas a regra de leitura permanece em `auth-guard.js`, `data-repository.js` e `layout.js`.
- **Login** usa RPC `login_funcionario` com bloqueio por tentativas — porém há fallback local (AUD-03).
- **Sessão** em cookie sem assinatura (AUD-02) permite forjar `cargo` e `nivel_acesso`.
- **Escritas diretas** (insert/update/delete) em `funcionarios` (CPF/documentação interna), `logs_alteracoes` e `trail_decisoes` são permitidas a qualquer cliente. A trilha “imutável” não é imutável no banco.
- **Edge Functions** com `verify_jwt=false`: `relatorio-pdf`, `scanner-qr`, `vpn-gate`, `sos-webhook`, `despacho-embarcacao`, `kpis-calculo`.
- Correção mínima recomendada (sem alterar nada agora): exigir JWT nas funções, criar políticas por cargo, mover login/escritas sensíveis para RPC com `auth.uid()`, e assinar a sessão. **Qualquer mudança de RLS exige autorização do dono do projeto.**

---

## 8. Validação de runtime / build

| Verificação | Comando | Resultado |
|---|---|---|
| Suíte completa | `npm test` (73 scripts + `audit:xss`) | **EXIT 0** — todas as verificações passaram; `test_webmcp_paginas` 127/127; `test:gravacao` e `test:inspecao-em-transito` verdes; `test:about` 25/25 |
| Build de produção | `npm run build` | **EXIT 0** — 77 JS (2.659.299 → 2.046.660 B, −23%), 11 CSS (−22%), 14 HTML; sem erros |
| Varredura XSS | `npm run audit:xss` | **EXIT 0** — 0 interpolações não codificadas; payloads renderizados como texto |
| Sintaxe | `node --check` em todos os arquivos tocados | OK |
| Banco vivo | consultas MCP somente leitura | schema, colunas, enums (14), políticas (67) e contagens acima |
| Colunas referenciadas | script de extração de `select/eq/order/insert/update` × schema vivo | 23 tabelas usadas pelo frontend; **nenhuma coluna inexistente** (8 achados do script eram falsos positivos de relações aninhadas/payloads) |

**Não foi executado:** teste de escrita real no banco (proibido sem autorização), teste de RLS com usuário anônimo real, execução das Edge Functions, teste em navegador real/dispositivo móvel.

---

## 9. Áreas não verificáveis nesta rodada / cobertura parcial

**Cobertura estática concluída (leitura integral ou substancial):** `js/data-repository.js`, `js/vision-layer.js`, `js/pages/login.js`, `js/pages/tipos-carga.js`, `js/auditoria.js` (1–470), `js/pages/relatorios.js` (20–740), `js/pages/inspecao.js` (1–760), `js/pages/manutencao.js` (195–520, 780–900), `js/pages/tecnico_portos.js` (trechos de visitantes/funcionários), `js/pages/scanner.js` (120–330), `js/pages/embarcacoes.js` (cadastros, berços, contêineres e guindastes), `js/pages/cargas.js` (agendamento, transições, guindastes e capacidade), `js/pages/dashboard.js` (1–300, 400–560, 1080–1215), `js/panic-realtime.js` (590–930), `js/webmcp/webmcp-dados.js` (1–330), `js/webmcp/webmcp-cargas.js` (definições de tipos e movimentação), `js/webmcp/webmcp-embarcacoes.js` (cadastros), `tests/test_webmcp_paginas.js`. **Cruzamento automatizado** de todas as chamadas `from/select/eq/order/insert/update/upsert` do `js/` contra as colunas do schema vivo (23 tabelas efetivamente usadas).

**Não concluído (requer leitura adicional):**
- `js/pages/charts.js` 1–850 e 1560–2106 (construtores restantes; o caminho de dados 760–1100 foi lido).
- `js/layout.js` (menus/modais; trechos de sessão lidos), `js/supabase-client.js` 420–663.
- `js/panic-realtime.js` 1–590 e 930–1195.
- `js/webmcp/webmcp-core.js` (1.418 linhas), `-global.js`, `-inspecao.js`, `-manutencao.js`, `-tecnico.js`, `-delegacao.js` (além dos trechos lidos).
- Scripts inline de `*.html`, `js/security.js`, `js/analytics.js`, `js/online-presence.js`, `js/net-debug.js`, `js/vpn-gate.js`, `js/haptics.js`.
- Testes de runtime em navegador com Supabase real (o ambiente de testes injeta dublês).
- Comportamento efetivo das Edge Functions publicadas (nenhuma foi invocada).

**Limitações de ferramenta:** o conector MCP do Supabase disponível expõe SQL e metadados, mas **não** expõe introspecção de políticas por role nem execução de funções; `get_edge_function` retornou 404 para `panic-alert` e ESZIP ilegível para `sos-webhook`. Não foi possível verificar autoria das 3 cargas criadas durante a sessão.

---

## 10. Plano de remediação priorizado

1. **P0 — RLS/Auth (AUD-01, AUD-02, AUD-03):** políticas por cargo, JWT nas funções, sessão assinada, remover fallback de login em produção. Exige autorização do dono do projeto; não executado.
2. **P0 — Pânico (AUD-04):** alinhar `FUNCTION_SLUG` à função publicada e validar o webhook; manter contingência apenas como fallback.
3. **P1 — Integridade de escrita:** já corrigidos AUD-05…AUD-10, AUD-13, AUD-25…AUD-28; falta teste de escrita real autorizado.
4. **P1 — Semântica de auditoria (AUD-14, AUD-15):** decidir valor de enum para leitura de QR (migração) e remover MAT-1111/dados demo com autorização.
5. **P2 — Métricas (AUD-11, AUD-16, AUD-17, AUD-18, AUD-23):** definir na spec o limite do pátio; exibir “sem conexão” em vez de cache no dashboard.
6. **P3 — Higiene (AUD-12, AUD-19…AUD-22, AUD-24, AUD-30, AUD-32):** revogação de delegação por id, remover código morto, eliminar IDs aleatórios, mapear/remover `SAIDA`, consolidar as duas pastas de schema.
7. **P2 — Governança de autorização (AUD-29, AUD-31):** derivar nível de `cargo_niveis` e o perfil somente leitura de uma coluna real; hoje ambos são listas estáticas no cliente.

---

## 11. Conclusão

A camada de dados do frontend foi reconectada ao schema real: os fluxos de inspeção, visitantes, navios, contêineres, guindastes, manutenção, tipos de carga, relatórios, agendamento, contêineres e dashboard agora falham de forma explícita e exibem estado vazio quando o banco está vazio, em vez de inventar sucesso ou dados. A infraestrutura mock de produção foi removida — incluindo a frota fictícia de guindastes e o catálogo estático exposto a agentes.

**Balanço:** 32 achados (2 críticos, 7 altos, 11 médios, 12 baixos). **17 corrigidos** no working tree (AUD-05…AUD-11, AUD-13, AUD-16…AUD-20, AUD-25…AUD-28), 1 mitigado parcialmente (AUD-04) e 14 permanecem abertos por exigirem autorização, decisão de arquitetura ou migração de banco.

**O que permanece crítico e fora do escopo autorizado:** RLS permissiva em 67 políticas, autenticação/sessão no cliente, fallback local de login, divergência da Edge Function de pânico e registros de demonstração no banco (MAT-1111). A auditoria estática é **parcial** — as áreas listadas na seção 9 ainda precisam de leitura e de um teste de runtime com o Supabase real (com autorização explícita para escrita).
