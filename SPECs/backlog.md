<!-- ===================== SESSÃO: BACKLOG 001 ===================== -->

# SESSÃO — BACKLOG 001

# Backlog 001 de Correções e Ajustes — Sistema de Gestão Portuária

> Implementação via Jules. Só dados reais do Supabase (sem fictícios nem armazenamento local). Toda alteração deve constar no relatório de execução do backlog.

## 🐞 Seção de Correções

- **C1 — "Movimentar" (Cargas e Pátio):** opções inúteis (Em Carregamento/Parado/Concluído) → mostrar os **berços**, disponíveis ou não, como destino.
- **C2 — Berço em Embarcações e GPS:** cargas sem berço → exibir o berço e permitir levar a carga do berço ao navio escolhido.
- **C3 — Contêiner em Embarcações e GPS:** contêiner vinculado não aparece → exibi-lo (só vínculos do banco).
- **C4 — Botão "Vincular":** usa `alert()` → modal centralizado com contêineres e navios (disponíveis e indisponíveis).
- **C5 — Liberação de navio:** Trail diz "liberado", Embarcações diz "dentro do Porto" → só o **Diretor de Operações e Logística** libera, com dados sincronizados.
- **C6 — ETA e tempo fora do Porto:** velocidade fixa e sem atualização → ligar ao **tempo real**.
- **C7 — Gráfico "Embarcações mais utilizadas":** dados fictícios → usar dados do banco.
- **C8 — Gráfico "Produtividade por Cargo":** não reflete a realidade → basear em mudanças feitas por cada cargo no mês.
- **C9 — Cargas canceladas:** ficam na tabela principal → voltam ao berço e vão para uma **tabela de canceladas**.
- **C10 — Status "Entregue":** marcado por botão → remover o botão; entrega **automática** na chegada do navio ao destino.
- **C11 — Dados fictícios e armazenamento local:** remover tudo (localStorage, arquivos estáticos); dados só do **Supabase**.
- **C12 — Dados de teste:** remover; manter só dados cadastrados, sem códigos repetidos.
- **C13 — Funcionários fora do CRUD:** manter só os cadastrados no banco; os demais devem ser cadastrados com **matrícula única**.
- **C14 — Documento de visitante repetido:** bloquear duplicidade (validação no banco).
- **C15 — Relatórios/PDF com data fixa:** período de referência segue a **data real**.
- **C16 — "Desocupar Berço":** libera o berço sem movimentação (`liberarBercoManualmente`) → remover; só a **movimentação física** libera.
- **C17 — Saída/trânsito sem vínculo:** bloquear "SAIDA"/"EM_TRANSITO" sem contêiner **e** navio (Regra A6, SPEC 6.4).
- **C18 — ETA estático (Embarcações e GPS):** relógio em tempo real (`setInterval`) com `data_saida`, `rotas_maritimas` e 33 km/h (RN 9).
- **C19 — 22 tabelas do `schema.sql`:** várias sem uso (`cargo_niveis`, `tipos_carga`, `checklist_modelos`, `checklist_itens`, `rotas_maritimas`, `estivador_cargas`, `inspecao_itens`) → conectar todas ao Supabase.
- **C20 — Inspeção por item:** só `inspecoes` é gravada → gravar conformidade e observações em `inspecao_itens`.
- **C21 — Leituras de QR Code:** logs no `localStorage` → gravar em `leituras_qr_code` e `logs_alteracoes`, com funcionário e data/hora.
- **C22 — Relatórios/PDF:** leem `localStorage` → usar Supabase, data real e 4 seções (SPEC 11): Carga, Navio, Contêiner, Resumo do Fluxo.
- **C23 — Indicadores do Painel Geral:** números incorretos (ex.: "3" navios fora do porto sem nenhum) → cada card com contagem real (`count exact` + filtro próprio).
- **C24 — Tempo real entre páginas:** alterações não refletem em outras telas → refetch após `INSERT`/`UPDATE` ou `supabase.channel().on('postgres_changes', ...)`.
- **C25 — Reemissão de códigos:** matrícula cadastrada "não encontrada" → corrigir a busca.
- **C26 — Matrícula duplicada:** `UNIQUE` no banco e validação no front com mensagem clara.
- **C27 — Visitante:** permitir mudar "aguardando autorização" para "em visita" sem novo registro.
- **C28 — `prompt`/`confirm` nativos:** trocar por modal customizado e centralizado.
- **C29 — Navbar sobrepõe o conteúdo:** `position: fixed; top: 0`, `z-index` alto e `padding-top` no conteúdo.
- **C30 — Matrículas e códigos:** salvar em CAIXA ALTA (`.toUpperCase()`, front e back-end).
- **C31 — Inspeção:** lista cargas não cadastradas → listar só as cadastradas e ativas.
- **C32 — Recusa de carga:** sem campo para o motivo → adicionar campo de texto.
- **C33 — IMO:** exigir "3 letras + 7 números" e bloquear duplicados.
- **C34 — Coordenadas GPS:** validar latitude/longitude reais e bloquear coordenada já usada ("já existe navio nesta localização").
- **C35 — Contêiner:** código único e `status` (disponível/em uso), bloqueando novo vínculo enquanto em uso.
- **C36 — Datas:** manutenção nunca anterior à fabricação (contêineres e guindastes).
- **C37 — Documento de visitante:** máscara de CPF (`999.999.999-99`) e validação dos dígitos.
- **C38 — Cargas:** peso, volume e valor declarado > 0 (`min` no front e validação no back-end).
- **C39 — Manutenção de navios:** criar solicitação com vários tipos; "manutenção geral" só com 3+ anos de uso ou da última geral.

## ⚙️ Seção de Ajustes

- **A1:** renomear os cards para **"Indicadores operacionais no terminal"**, atualizados em tempo real.
- **A2:** remover "Indicadores Executivos Consolidados" do Painel Geral.
- **A3:** planilha consolidada por categoria atualizada automaticamente, sem dados fictícios.
- **A4:** Diretor registra o **horário de saída** do navio; o ETA parte dele, em tempo real.
- **A5:** navio fora do Porto: verificar disponibilidade e **autorizar retorno** à origem (ex.: *Atlantic Breeze*).
- **A6:** toda carga vinculada a contêiner e navio, com reflexo imediato.
- **A7:** contêiner com máx. **75 m³**; listar volume disponível/necessário e tipo de carga na vinculação e **impedir** vínculo no limite.
- **A8:** substituto **muda de cargo até o fim da vigência**, salvo no Supabase.
- **A9:** remover tudo que não estiver no **Supabase** (dados hardcoded/estáticos).
- **A10:** painel de Embarcações autoriza retorno de navios `FORA_DO_PORTO` ou `NO_PORTO_DE_DESTINO`.
- **A11:** delegação gravada só em `delegacoes_supervisor`, elevando cargo/permissões do substituto na vigência.
- **A12:** impedir visitante com documento duplicado (consulta e restrição em `visitantes`).
- **A13:** toda alteração exige **relatório de execução** (ex.: `relatorio-backlog-001.md`).

## 📋 Regra de Relatório de Execução

Ao fim de cada sessão, gerar/atualizar o relatório (`relatorio-backlog.md`) com: **(1)** código, título e seção; **(2)** status (✅ Concluído · 🟡 Parcial · 🔴 Pendente, com justificativa); **(3)** o que foi feito (arquivos, lógica, tabelas/colunas); **(4)** evidências de validação; **(5)** impactos e dependências; **(6)** pendências e próximos passos; **(7)** data e responsável (sessão do Jules).

---

<!-- ===================== SESSÃO: BACKLOG 002 ===================== -->

# SESSÃO — BACKLOG 002

# Backlog Consolidado NexusPort — Erros e Correções (Backlog 002)

> Junta funcionalidades/regras e bugs. Formato: **Página → Local → Erro → Solução**. Em divergência, vale a versão mais específica. Prioridades: **Alta** (bloqueante/corrompe dados), **Média** (funcionalidade/regra), **Baixa** (UI/validação pontual).

## 0. Regras Gerais (todas as páginas) — fazer primeiro

- **0.1 — Dados fantasmas [Alta]:** dados fictícios nas telas geram contagens conflitantes → remover todos e não criar novos para teste.
- **0.2 — Persistência real [Alta]:** operações que só mudam o estado local → persistir no Supabase e atualizar a UI a partir do banco.
- **0.3 — Alertas nativos [Média]:** `alert()`/`confirm()`/`prompt()` → modais estilizados.
- **0.4 — Integração entre páginas [Média]:** páginas isoladas → implementar navio→manutenção, carga→contêiner, carga→navio, contêiner→navio e auditar as demais.

## 1. Painel Geral

- **1.1 — Indicadores [Alta]:** "Cargas recusadas" (3 sem nenhuma), "Ocupação do pátio" (0% com berços ocupados), "Manutenção preventiva" e "Cargas em armazenagem" divergem; só "Navio fora do porto" está certo → remover fantasmas e validar cada card no Supabase.
- **1.2 — "Cargas Recusadas": card ≠ detalhe [Alta] (Erro 1):** card mostra 3, detalhe mostra nenhuma → função única (`buscarCargasRecusadas()`, `count: 'exact'`) para card e lista; replicar nos demais cards.
- **1.3 — Log Geral [Alta]:** registros e funcionários fictícios → remover; só ações reais, registradas automaticamente.
- **1.4 — Trail de Decisões [Alta]:** decisões de funcionários inexistentes → remover; só usuários reais, com FK válida.
- **1.5 — Planilha de Desempenho [Alta]:** "cargas gerais" mostra 6, há 1 real → usar só dados reais.
- **1.6 — Produtividade por Cargo [Alta]:** mostra inspetor/supervisor com só 1 funcionário cadastrado (diretor) → exibir só funcionários reais.
- **1.7 — Embarcações Mais Utilizadas [Média]:** o gráfico está certo; o defeito é a listagem de "Embarcações & GPS" (item 4.2).
- **1.8 — Preventiva Sugerida (>3 Anos) [Alta] (Erro 8):** card mostra 0, Manutenção & OS mostra 2 → função única (`buscarEquipamentosPreventivaSugerida()`, `data_ultima_manutencao < hoje - 3 anos`) nas duas telas.

## 2. Cargas & Pátio

- **2.1 — Carga em berço [Média]:** berço é de **navio** → cargas ficam no **pátio**.
- **2.2 — Ponto de descarga [Média]:** aparece como "berço" → trocar para pátio.
- **2.3 — Painel de Berços [Média]:** ocupado por carga fictícia e na página errada → mover para "Embarcações & GPS", só com navios (regras no 4.3).
- **2.4 — Carga fantasma [Alta]:** remover da tabela do fluxo operacional.
- **2.5 — Checklist no agendamento [Baixa]:** checklist é de **saída** → remover a exigência (fica em "Inspeção e Checklist").
- **2.6 — Canceladas [Baixa]:** não aparecem na tabela → ver se é efeito dos fantasmas; senão, persistir o status e listar por ele.
- **2.7 — Vínculo carga ↔ contêiner [Média]:** sem opção no agendamento → adicionar (máx. **75 m³**); se exceder, dividir entre 2+ contêineres.
- **2.8 — Destino final [Média]:** campo livre → **"porto de destino"** (Roterdã, Tóquio, Lisboa, Singapura) e bloquear vínculo com navio de destino diferente (front e banco).
- **2.9 — Área do pátio [Média]:** sem limite → máx. **100 ha (1.000.000 m²)**, bloqueando excesso com modal.
- **2.10 — Cadastro de guindaste [Baixa]:** está em "Manutenção & OS" → mover para "Cargas & Pátio".

## 3. Inspeção e Checklist

- **3.1 — Cargas fantasmas no select de vistoria [Baixa]:** listar só cargas reais e disponíveis, com FK válida.

## 4. Embarcações & GPS

- **4.1 — Cadastro de navio [Média]:** localização sem berços, origem não fixa, destino livre, distância manual, GPS livre → berços disponíveis; origem **Santos**; destino Roterdã/Tóquio/Lisboa/Singapura com **distância automática**; GPS **travado em Santos**. *Teste:* cadastrar com berço e destino.
- **4.2 — Navios não aparecem [Alta]:** 5 no Supabase, 1 na tela; novo cadastro não entra → listar todos e atualizar sem recarregar.
- **4.3 — Painel de berços [Média]:** máx. **15 berços**, **1 navio por berço**; liberar ao liberar o navio. *Teste:* bloquear segundo navio no berço 01.
- **4.4 — Contêineres fantasmas [Alta]:** 8 na tela, 3 no Supabase → remover os 5.
- **4.5 — Identificação de contêiner [Baixa]:** 3 letras + 6 números + 1 dígito verificador, no front e com CHECK no banco.
- **4.6 — Datas futuras [Baixa] (Erro 7):** bloquear (`max` = hoje, front e back-end); incluir datas no cadastro de **navios** (aviso se +3 anos sem manutenção, via função do 1.8); contêiner novo com **"ainda não teve manutenção"** (nulo, sem alerta).
- **4.7 — Vínculos [Média]:** adicionar contêiner→navio; código da carga (2.7) aparece na Gestão de Contêineres (join por FK).
- **4.8 — Distância negativa [Baixa] (Erro 2):** superado pelo 4.1; resta `CHECK (distancia_rota >= 0)` no banco.
- **4.9 — Cargas vinculadas ao navio [Alta] (Erro 3):** sempre "nenhum navio com cargas" → preencher `navio_id` e listar pela FK (não por nome), com `not('cargas', 'is', null)`.

## 5. Manutenção & OS

- **5.1 — Fluxo solicitação → conclusão [Média]:** solicitações caem nas Ordens, misturadas ao histórico → solicitação em "Solicitação de Manutenção" com **"aceitar"** → **"concluir"**; replicar para **guindastes** e **contêineres**; aba **OS** só com histórico de concluídas. *Teste:* solicitar → aceitar → concluir.
- **5.2 — Cadastro de guindaste [Baixa]:** mover para "Cargas & Pátio" (2.10).

## 6. Delegação Supervisor

- **6.1 — Matrícula ambígua [Média] (Erro 9):** aceita matrículas inexistentes → matrícula do **substituído** + **CPF** do substituto, validados em `funcionarios` (dropdown/autocomplete); mostrar quem substitui quem.
- **6.2 — Vigência [Baixa] (Erro 4):** fim ≤ início → exigir fim **estritamente posterior** (front e back-end/RPC).
- **6.3 — Cargo e permissões [Alta]:** cargo não aparece e o substituto não recebe o acesso → exibir (ex.: "MAT-1914 — Cargo: Inspetor"), liberar telas/ações na vigência e reverter ao fim. **Atenção:** mexe em permissões; mapear antes o controle de acesso por cargo.
- **6.4 — Fim automático [Média]:** substituto não volta ao cargo → expiração automática (job/RPC ou checagem no carregamento) e mensagem **"nenhum supervisor ativo"**.

## 7. Gestão de Pessoas

- **7.1 — CPF [Baixa]:** validar formato **XXX.XXX.XXX-XX** e unicidade.
- **7.2 — Visitantes duplicados [Baixa] (Erro 6):** `UNIQUE (documento)` e checagem no front ("Visitante já cadastrado"); com histórico, avaliar reativar o registro.
- **7.3 — Saída de visitante [Média] (Erro 10):** volta "em visita" e aceita dupla saída → um par entrada/saída por linha com `status` (`em_visita`/`finalizada`); saída com `.eq('id', visitaId).eq('status', 'em_visita')`.
- **7.4 — Exclusão de funcionário [Alta]:** o excluído continua nas listas e buscas → remover de tudo; avaliar exclusão lógica (`deleted_at`/`ativo = false`) ou física conforme as FKs.

## 8. Relatórios & PDF

- **8.1 — PDF A4 [Alta]:** cargas fantasmas → listar só cargas cadastradas.
- **8.2 — Produtividade [Alta]:** funcionários inexistentes (ex.: "MAT-8821") → usar logs reais de funcionários reais.

## 9. Navbar

- **9.1 — Navbar cobre o conteúdo [Baixa] (Erro 5):** corrigir no CSS compartilhado (`position: fixed`, `z-index` ~1000, `padding-top` no conteúdo).

## 10. Outros problemas prováveis (sugeridos, todos [Baixa])

- **10.1 Fuso horário:** padronizar em UTC/ISO e exibir no fuso local (vigência, "3 anos sem manutenção").
- **10.2 Concorrência:** validar ocupação de berços e pátio no banco e na interface.
- **10.3 Dados obsoletos entre abas:** reconsultar ao receber `nexus_data_changed` e após cada escrita.
- **10.4 Integridade referencial:** definir FKs e validar antes de desativar/excluir.
- **10.5 RLS:** políticas de acesso e validação nas APIs.
- **10.6 Campos numéricos:** validar `> 0` e limites plausíveis (front e banco).
- **10.7 Cache vs Supabase:** Supabase como fonte única; limpar cache legado.
- **10.8 Performance:** `count: exact` e renderização otimizada.
- **10.9 Erros silenciosos:** tratar `error` de toda operação e exibir via `mostrarFeedback`.
- **10.10 CPF:** mascarar (`XXX.XXX.XXX-XX`) e validar dígitos.

## 12. Relatório Técnico de Auditoria (STS-01 Santos)

**Data:** 26/09/2026 · **Fonte:** `SPECs/Spec.md` e `SPECs/tasks.md` · **Ambiente:** `Projeto-TCC` (main) e Supabase (`loedodixvmadxqgykehh`)

- **Resumo (12.1):** conformidade de **100%** — 52 requisitos ✅; 0 parciais, errados, não implementados ou com bug. Evidências: 22 tabelas reais (mocks desativados, `ENABLE_MOCKS = false`); 60 políticas RLS (audit logs append-only, sem `DELETE` físico operacional); RBAC com 8 cargos e 3 camadas de visão; fluxo de cargas em 8 etapas com QR Code (10×10 cm) e leitor por câmera.
- **Matriz (12.2), todos ✅:**
  - **RF-01 (acesso):** login por código individual (01.1); visão própria, operacional e estratégica (01.2–01.4).
  - **RF-02/03 (cadastros):** IMO único, contêiner com trava temporal, atributos da carga, rotas, tipos/checklist, guindastes/OS e estados de navios e contêineres.
  - **RF-04/08 (tempo e GPS):** tempo no/fora do porto, ETA a 33 km/h, GPS e posicionamento.
  - **RF-06 (fluxo de cargas):** agendamento, inspeção técnica, vínculo duplo (75 m³), liberação do navio, "Entregue" automático, cancelamento (RN 16).
  - **RF-07, 09–13:** cards do Dashboard, checklist por tipo, 5 filtros, PDF A4 de 4 seções, log geral, trail imutável.
  - **RF-14–17:** delegação com vigência, funcionários e visitantes, produtividade, QR Code (único, etiqueta 10×10 cm, scanner autenticado).
  - **Regras (RN):** 01, 02, 03, 09, 11, 12, 14, 15, 16 e 18.
- **Parecer (12.3):** **SIM**, o sistema é funcional e conforme à SPEC (módulos sem erros, 22 tabelas íntegras, 60 políticas RLS).

---

<!-- ===================== SESSÃO: BACKLOG 003 ===================== -->

# SESSÃO — BACKLOG 003

# Backlog 003

Backlog consolidado do NexusPort. **Conteúdo:** 1. Correções Funcionais · 2. Tarefas Técnicas para o Jules · 3. Auditoria Técnica das 9 Páginas.

## 1. Correções Funcionais do Sistema

- **1.1 — Agendamento (checklist):** exige checklist de carga que ainda não existe → não obrigatório (ele prepara a carga antes do contêiner/navio).
- **1.2 — Botão Movimentar:** leva a carga a um berço (só de navios) → levar à sala de contêiner, escolhendo antes o **guindaste**; a tarefa aparece em "Embarcações & GPS" (guindastes, botão **"Tarefas"**) e some quando a carga é recebida.
- **1.3 — Vinculação ao navio:** remover a escolha de navio ao vincular a contêiner (o navio vem do contêiner).
- **1.4 — Cancelamento:** a carga cancelada some → enviar à "Tabela de cargas canceladas".
- **1.5 — Cadastro de contêiner (Embarcações & GPS):** o contêiner some → deve aparecer e ficar cadastrado.
- **1.6 — Guindastes e Pórticos:** adicionar botão de exclusão.
- **1.7 — Manutenção de guindastes duplicada:** retirar "Solicitações de Manutenção de Guindastes e Pórticos"; manter a de "Ordens de Serviço".
- **1.8 — Delegação:** criar no Supabase nome, CPF e nascimento do substituto.
- **1.9 — Trail de Decisões Críticas:** criar a opção de registrar trail/decisão.
- **1.10 — Gráficos do Painel Geral:** não aparecem → corrigir.
- **1.11 — Cargas somem ao reiniciar:** só voltam em "Limpar Filtros" → carga cadastrada não some e, sem filtro solicitado, a tabela não muda.
- **1.12 — Sincronização entre aparelhos:** alterações do aparelho A não aparecem no B → valer para todos.
- **1.13 — Tarefa do guindaste:** não some após "Receber" → remover a tarefa da carga recebida.
- **1.14 — Botão "Pronta":** funciona sem contêiner → permitir só com carga vinculada a contêiner.
- **1.15 — Log Geral:** não registra nem exibe → toda alteração aparece automaticamente.
- **1.16 — Gráfico de Pizza:** mostra navios com nenhum cadastrado → atualizar automaticamente; navio excluído sai.
- **1.17 — Berço de navio excluído:** berço 1 ocupado sem navio → liberar ao excluir o navio.
- **1.18 — Manutenção & OS:** "Botão de Pânico" e "Nova Ordem de Serviço" não funcionam → corrigir.

## 2. Tarefas Técnicas para o Jules

- **2.1 — Cargas não registradas e sumindo no F5.** *Contexto:* `ReferenceError: tipoCompartilhado is not defined` (`js/cargas.js`, ~linha 324, `agendamentoCargaForm`) impede o `insert` em `cargas`; a carga fica só no `localStorage` e `carregarCargasSupabase()` a apaga no F5. *Tarefas:* (1) definir a origem de `tipoCompartilhado` (ou ajustar `tipoCargaUuid`) mantendo `isUuid`; (2) garantir o `insert` e a compatibilidade dos campos; (3) tratar o `catch` com mensagem clara, sem deixar a carga só no `localStorage` (`nexus_cargas_fluxo`); (4) revisar `carregarCargasSupabase()` e `NexusRepository.getCargas()` (`js/data-repository.js`); (5) buscar variáveis não declaradas e revisar vincular, movimentar e cancelar. *Validação:* agendar, conferir no Supabase e após F5.
- **2.2 — Carga sumiu do Celular A e apareceu no B.** *Contexto:* mesmo erro da 2.1; a carga some no A ao trocar de página e apareceu no B por gravação em outro caminho; a Visão por Cargo (`NexusVision.filterCargasForUser`, `js/vision-layer.js`) limita perfis operacionais, enquanto Supervisor/Inspetor/Diretor veem tudo. *Tarefas:* (1) confirmar a correção da 2.1; (2) descobrir onde a carga foi persistida e se há retry; (3) confirmar o filtro (Estivador → `ARMAZENAGEM`; Arrumador → `PRONTA_PARA_ENTREGA`) e avaliar aviso ao perfil operacional. *Validação:* cadastrar como Estivador, conferir no Supabase e como Supervisor/Inspetor/Diretor em outro aparelho; trocar de página sem sumir.
- **2.3 — Delegação salva só localmente.** *Contexto:* `js/delegacao.js` salva em `nexus_active_delegation`, mas o `insert` em `delegacoes_supervisor` falha: com nome, CPF e nascimento livres, `substitutoId` fica `null` e a FK rejeita. *Tarefas:* (1) exibir `insErr` no `delegForm` (~linhas 130–165) e conferir `NOT NULL`/FKs e as colunas `substituto_nome`, `substituto_cpf`, `substituto_data_nascimento`; (2) tornar `substituto_id` opcional, garantir as colunas (1.8) e revisar RLS; (3) revisar a busca do titular em `funcionarios` e avisar se a matrícula não existir; (4) avisar falhas no `catch`, sem manter só no `localStorage`; (5) `carregarDelegacaoAtiva()` (`ativo = true`) traz os nomes e mantém até `data_fim_previsto`, também em outros navegadores. *Validação:* conferir no Supabase, F5 e outro navegador.
- **2.4 — Validação final:** rodar a suíte de testes (Fases 0 a 11) e garantir a consistência funcional do sistema.

## 3. Relatório de Auditoria Técnica das 9 Páginas

Auditoria código a código dos 9 módulos JS, sem alterar arquivos.

- **3.1 Painel Geral (`dashboard.js`):** `registrarLogAlteracao` falha se o `id` da sessão não for UUID válido em `funcionarios`; `chartProdutividade` descarta logs de códigos de teste ou matrículas sem UUID; o Trail usa o `localStorage` se `trail_decisoes` falhar por rede e pode desordenar retificações.
- **3.2 Cargas & Pátio (`cargas.js`):** `tipoCompartilhado is not defined` (linha 324) interrompe o script antes do `insert`, e a carga some no F5; `cargas.update({ container_id, navio_id })` falha (`invalid input syntax for type uuid`) com strings como `CONT-2001`.
- **3.3 Inspeção (`inspecao.js`):** `filter(itemId => isUUID(itemId))` descarta todos os itens (IDs `'i1'`, `'i2'`…), então `inspecao_itens` fica vazia; `eq('qr_code_url', cargaAtual.qrCode)` afeta 0 linhas se o QR for nulo ou diferente.
- **3.4 Scanner (`scanner.js`):** `processarScan()` envia `entidade_id: displayId` (ex.: "CRG-2026-123") e falha em silêncio onde a coluna exige UUID; `cargas.html?carga=...` não filtra se o campo de pesquisa não ler a query string.
- **3.5 Embarcações & GPS (`embarcacoes.js`):** `NO_PORTO_DE_DESTINO` é rejeitado se o campo for ENUM restrito (ex.: `'NO_PORTO'`); `data_saida` em ISO incompatível gera `NaN` e zera a distância no F5.
- **3.6 Manutenção & OS (`manutencao.js`):** `.ilike('descricao', '%OS-2026-123%')` não acha OS criadas sem colchetes ou com ID auto-incremento/UUID; `.eq('nome', limpaNome)` falha se a caixa do nome diferir ("Navio Alfa" vs "NAVIO ALFA") e a embarcação segue "OPERANTE".
- **3.7 Delegação (`delegacao.js`):** substituto em texto livre deixa `substitutoId` nulo; a FK rejeita o insert e o registro fica só no `localStorage`.
- **3.8 Gestão de Pessoas (`tecnico_portos.js`):** `.eq('matricula', ...)` falha se a matrícula estiver sem "MAT-" e o código `NX-1914-XXXX` fica só em `nexus_code_overrides`; o parecer concatenado em `motivo` pode estourar o VARCHAR e a saída do visitante falha.
- **3.9 Relatórios & PDF (`relatorios.js`):** o join `navios:navio_id(...)`/`containers:container_id(...)` não traz dados se `navio_id`/`container_id` forem nulos ou inexistentes (PDF com "Não Vinculado"/"Não Alocado"); a produtividade fica em 0 porque `logs_alteracoes` é gravada sem `funcionario_id` ou com código desalinhado.
- **3.10 Diagnóstico geral:** três causas explicam a maioria das perdas no F5: **(1)** erros de runtime JS (ex.: `tipoCompartilhado`) antes do insert; **(2)** UUID vs texto (códigos como "CRG-2026-001" ou "MAT-1914" em colunas UUID); **(3)** o `DOMContentLoaded` sobrescreve o `localStorage` com o Supabase e apaga o que falhou ao gravar.


<!-- ===================== SESSÃO: BACKLOG 004 ===================== -->

# SESSÃO — BACKLOG 004

# Backlog 004 — Performance, Acessibilidade e SEO (Lighthouse Audit)

> Este backlog detalha as pendências técnicas de performance, otimização de imagens, acessibilidade (a11y) e SEO identificadas na auditoria do Google Chrome Lighthouse no sistema NexusPort.

---

## ⚡ 1. Desempenho e Otimização de Recursos

### 1.1 Redimensionamento e Otimização da Imagem da Logomarca (`logo_porto.png`)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A imagem `design/logo_porto.png` possui 1.007 KiB e dimensões originais de 1254x1254px, mas é exibida na interface reduzida para 36x36px. O arquivo deve ser redimensionado para as dimensões reais de exibição e convertido para formatos modernos como WebP ou AVIF, reduzindo mais de 1 MB de consumo de rede por carregamento de página.

### 1.2 Atributos explícitos de largura e altura (`width` e `height`) nas imagens

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As tags `<img>` nas páginas HTML (ex.: logo no cabeçalho e avatares) não possuem atributos `width` e `height` definidos explicitamente, provocando deslocamentos bruscos de layout (Cumulative Layout Shift — CLS) durante a renderização.

### 1.3 Eliminação de recursos que bloqueiam a renderização (Render-Blocking)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Os scripts e folhas de estilo externos (Tailwind CDN, Google Fonts, Supabase client e scripts de inicialização) são carregados de forma síncrona, gerando um First Contentful Paint (FCP) e Largest Contentful Paint (LCP) elevados (superiores a 4 segundos em redes 4G simuladas).

### 1.4 Redução e Minificação do JavaScript / CSS Não Utilizado

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Grande parte das regras do Tailwind CDN (`cdn.tailwindcss.com`) e funções JS não utilizadas nos primeiros segundos de navegação são carregadas integralmente, gerando consumo de mais de 240 KiB de dados desnecessários na thread principal.

### 1.5 Estratégia de cache eficiente para recursos estáticos (Cache-Control TTL)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Os arquivos estáticos locais (módulos JS e imagens) não possuem cabeçalhos `Cache-Control` configurados com TTL longo (ex.: `max-age=31536000`), exigindo re-download em visitas subsequentes.

---

## ♿ 2. Acessibilidade (A11y) e Usabilidade

### 2.1 Liberação do Zoom e Escalonamento pelo Usuário no Viewport

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** As páginas HTML possuem a meta tag `<meta name="viewport">`, contudo incluem os parâmetros `maximum-scale=1.0` e `user-scalable=no`. Essa configuração impede que usuários com baixa visão ampliem a tela, ferindo as diretrizes WCAG e Lighthouse A11y.

### 2.2 Taxa de Contraste de Cores entre Texto e Fundo

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Diversos elementos de texto de apoio e badges de status utilizam tamanhos pequenos (`10px`/`11px`) com cores de baixo contraste (`text-slate-400`, `text-slate-500` sobre fundos `bg-slate-100`/`bg-slate-800`), dificultando a leitura para usuários com deficiência visual.

### 2.3 Ordem Hierárquica Sequencial dos Títulos (`<h1>` — `<h6>`)

- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Em telas como o Painel Geral, ocorrem saltos de níveis de cabeçalhos (ex.: do `<h1>` direto para `<h3>`), o que prejudica a navegação semântica por leitores de tela e tecnologias assistivas.

---

## 🛡️ 3. Segurança e Práticas Recomendadas

### 3.1 Política de Segurança de Conteúdo (Content Security Policy — CSP)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Nenhuma das páginas HTML declara cabeçalhos HTTP ou meta tags `Content-Security-Policy` para prevenir ataques de Cross-Site Scripting (XSS) e injeções de scripts de terceiros.

### 3.2 Cabeçalhos HTTP de Proteção (HSTS, COOP, X-Frame-Options)

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não estão configurados os cabeçalhos de proteção de origem como `Cross-Origin-Opener-Policy` (COOP), `Strict-Transport-Security` (HSTS) e `X-Frame-Options` para mitigação de clickjacking e isolamento de contexto.

---

## 🔍 4. Otimização para Mecanismos de Busca (SEO)

### 4.1 Inclusão de Meta Description em todas as páginas HTML

- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As páginas do sistema não possuem a meta tag `<meta name="description" content="...">` com o resumo do conteúdo da aplicação.
