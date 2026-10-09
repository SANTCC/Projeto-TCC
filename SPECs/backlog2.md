# Backlog 002 — Arquitetura de Banco de Dados, Segurança e Integridade (Supabase)

> Este backlog documenta melhorias de arquitetura, integridade relacional, segurança RLS e triggers do PostgreSQL no Supabase.

---

## 🔴 Problemas de RLS, Triggers e Criptografia

### 1. RLS aberta para o mundo (`for all using (true)`)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As políticas RLS atuais em `SPECs/schema.sql` utilizam `for all using (true)` permitindo leitura e escrita pela role pública `anon` com a chave anônima do Supabase, sem restringir acessos por JWT ou perfil autenticado do usuário.

### 2. 12 tabelas com RLS ativada mas sem nenhuma política
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** `SPECs/schema.sql` executa `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em tabelas como `inspecoes`, `manutencoes`, `trail_decisoes`, `logs_alteracoes`, `agendamentos`, `checklist_modelos`, `checklist_itens`, `delegacoes_supervisor`, `leituras_qr_code`, `retificacoes_trail`, `historico_manutencoes` e `inspecao_itens`, mas não possui instruções `CREATE POLICY` específicas para liberação ou restrição das mesmas.

### 3. Trigger genérico `set_updated_at()` em todas as tabelas
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As tabelas possuem a coluna `updated_at timestamptz DEFAULT now()`, porém não existe a função de trigger `set_updated_at()` nem os triggers `BEFORE UPDATE` para atualizar o timestamp automaticamente quando uma linha for editada.

### 4. Otimização do trigger `trg_propagar_status_navio`
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O trigger em `SPECs/schema.sql` é executado em qualquer `UPDATE` na coluna `localizacao` sem a condição `WHEN (old.localizacao IS DISTINCT FROM new.localizacao)`. Além disso, a função `fn_propagar_status_navio()` propaga o status apenas para cargas vinculadas via `container_id`.

### 5. Uso da extensão `pgcrypto` para hash de credenciais
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A extensão `pgcrypto` é habilitada no início de `SPECs/schema.sql`, mas não é utilizada para criptografar ou gerar hash de `codigo_individual` (usado no login) ou outros dados sensíveis.

---

## 🟠 Integridade e Restrições SQL (Constraints & Índices)

### 6. Unicidade de navio por berço (`uq_bercos_navio`)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não foi criado o índice único parcial `CREATE UNIQUE INDEX uq_bercos_navio ON bercos(navio_id) WHERE navio_id IS NOT NULL;` no DDL de `schema.sql`.

### 7. Restrição de entidade única em manutenções (`num_nonnulls = 1`)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** As tabelas `manutencoes` e `historico_manutencoes` não possuem a trava `CHECK (num_nonnulls(navio_id, container_id, guindaste_id) = 1)` no banco.

### 8. Obrigatoriedade de motivo em cargas recusadas
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A validação do motivo de recusa ocorre no front-end JS, mas a restrição `CHECK (status_fluxo <> 'RECUSADA' OR motivo_recusa IS NOT NULL)` não foi adicionada no nível do PostgreSQL.

### 9. Apenas uma delegação ativa por supervisor titular (`uq_delegacao_ativa`)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** O limite de uma delegação ativa é validado via código no front-end/JS, porém o índice único condicional `CREATE UNIQUE INDEX uq_delegacao_ativa ON delegacoes_supervisor(supervisor_titular_id) WHERE ativo AND data_revogacao IS NULL;` não existe no banco de dados.

### 10. Validações de intervalo de datas e expressões regulares de formato no banco
- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Formatos (IMO, contêiner, matrícula) e intervalos de datas são validados no código JavaScript antes dos envios, mas faltam constraints `CHECK` no PostgreSQL para garantir integridade caso ocorram inserções diretas via API.

### 11. Índices em chaves estrangeiras (FKs)
- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Foram criados índices básicos em tabelas como `bercos(estado)`, `bercos(navio_id)` e `emergencias(estado, data_hora)`, mas faltam índices secundários em `cargas(container_id, status_fluxo)`, `containers(navio_id)`, `manutencoes(status, ...)` e `logs_alteracoes(entidade_tipo, entidade_id)`.

---

## 🟡 Modelagem e Estruturação de Dados

### 12. Normalização e eliminação de dados redundantes
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Atributos como `cargas.resultado_inspecao` duplicam dados da tabela `inspecoes`, e `delegacoes_supervisor.substituto_nome/cpf/data_nascimento` duplicam dados da tabela `funcionarios`.

### 13. Tabela de `portos` e vínculo relacional em `rotas_maritimas`
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** `rotas_maritimas` utiliza campos de texto livre (`origem`, `destino`) sem chaves estrangeiras apontando para uma tabela centralizada de portos (ex.: UN/LOCODE).

### 14. Histórico de `viagens` de embarcações
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A tabela `navios` armazena apenas o estado e localização atual do navio, sem uma tabela relacional de histórico de viagens (`navio_id`, `rota_id`, `data_saida`, `data_chegada_real`).

### 15. Tabela relacional de operações do pátio (Carga × Guindaste × Berço × Estivador)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não existe tabela unificada de registro de operação integrada conectando o histórico de movimentação do guindaste com berço, estivador e carga.

### 16. Fortalecimento de tipos de dados (`coordenadas_gps`, moeda, etc.)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** `coordenadas_gps` é armazenado como `TEXT` em vez de colunas numéricas de `latitude`/`longitude` ou tipo geográfico PostGIS. `valor_declarado` não possui especificação de moeda.

---

## 🟡 Auditoria, Segurança e RLS Avançada

### 17. Registro de auditoria nativo via triggers no PostgreSQL (`fn_audit`)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Os registros da tabela `logs_alteracoes` são gravados via código da aplicação (`window.registrarLogAlteracao`), e não por um trigger de auditoria genérico no banco de dados.

### 18. Tabelas append-only para auditoria e trail de decisões
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não há triggers ou revogação de privilégios no banco impedindo comandos `UPDATE` e `DELETE` nas tabelas `logs_alteracoes`, `trail_decisoes` e `retificacoes_trail`.

### 19. Autenticação JWT com claims de perfil para RLS
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** A aplicação gerencia a autenticação client-side via código individual de funcionário, sem emitir JWT com claims customizadas (`auth.jwt() -> 'cargo'`) para validação de RLS nativa no PostgreSQL.

### 20. Proteção de dados pessoais (LGPD)
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Campos sensíveis como CPF de visitantes e funcionários são armazenados em texto puro no banco de dados sem criptografia.

---

## 🟢 Operacional e DevOps

### 21. Migrações automatizadas e versionadas via Supabase CLI
- **Status:** 🟡 **IMPLEMENTADO PARCIALMENTE**
- **Detalhes:** Existem arquivos SQL em `supabase/migrations/` e `SPECs/migrations/`, porém as alterações no banco nem sempre são executadas por pipeline automatizado de migração do Supabase CLI.

### 22. Views para dashboards com `security_invoker = true`
- **Status:** 🔴 **NÃO IMPLEMENTADO**
- **Detalhes:** Não foram criadas views materializadas ou views SQL como `v_cargas_em_andamento` ou `v_bercos_ocupacao` para otimização das consultas dos painéis.
