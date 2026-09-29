# Backlog de Correções Adicionais NexusPort

---

## Embarcações & GPS

### Tarefa 1 – Corrigir a regra do "Liberar Saída"
- **Página:** Embarcações & GPS (`embarcacoes.html`)
- **Problema:** Ao liberar a saída de um navio cadastrado (`DENTRO_DO_PORTO`), aparecia a mensagem "Retorno Não Permitido" alegando que o navio só podia sair se estivesse no porto de destino, mesmo sem ter saído do porto de origem.
- **Solução Esperada:** O botão "Liberar Saída" autoriza a saída do navio do porto de origem. A regra que exige `NO_PORTO_DE_DESTINO` aplica-se exclusivamente ao botão "Autorizar Retorno".
- **Status:** Concluído

### Tarefa 2 – Salvar os berços no banco de dados (Supabase)
- **Página:** Embarcações & GPS (`embarcacoes.html`)
- **Problema:** Os berços eram salvos apenas localmente em `localStorage`, sem persistência na tabela `bercos` do Supabase.
- **Solução Esperada:** Conectar os berços ao Supabase: carregar os 15 berços do banco de dados na inicialização, salvar alterações/alocações/desvinculações no Supabase e manter o `localStorage` sincronizado.
- **Status:** Concluído

## Delegação Supervisor

### Tarefa 3 – Salvar as informações no Supabase
- **Página:** Delegação Supervisor (`delegacao.html`)
- **Problema:** As informações de delegação de supervisor não eram salvas/persistidas adequadamente no Supabase e o tratamento de erros não fornecia mensagens claras em falhas de conexão/gravação.
- **Solução Esperada:** Persistir inserções e revogações de delegações na tabela `delegacoes_supervisor` do Supabase, carregar a delegação ativa do Supabase na inicialização e exibir modais de erro claros via `mostrarFeedback` em caso de falha de rede/banco.
- **Status:** Concluído

## Cadastro de funcionários

### Tarefa 4 – Padronizar a matrícula de funcionários
- **Página:** Técnico em Portos / Gestão de Pessoas (`tecnico_portos.html`)
- **Problema:** Matrículas de funcionários podiam ser cadastradas fora do padrão estipulado.
- **Solução Esperada:** Validar a matrícula no padrão estrito `MAT-4 números` (`/^MAT-\d{4}$/`, ex: `MAT-1234`), bloqueando cadastros fora do padrão com modal explicativo.
- **Status:** Concluído

## Cadastros em geral

### Tarefa 5 – Permitir CPFs fictícios (estrutura obrigatória, CPF real não obrigatório)
- **Página:** Todas as páginas com cadastro/validação de CPF (Delegação, Visitantes, etc.)
- **Problema:** O validador de CPF exigia verificação matemática rigorosa de dígitos verificadores de pessoas reais, impedindo o uso de CPFs fictícios em testes.
- **Solução Esperada:** Exigir a estrutura e máscara de 11 dígitos numéricos do CPF (`XXX.XXX.XXX-XX`), sem rejeitar CPFs fictícios que sigam o tamanho/formato exigido.
- **Status:** Concluído

## Relatórios & PDF

### Tarefa 6 – Atualizar automaticamente o "Relatório de Produtividade por Cargo e Funcionários"
- **Página:** Relatórios & PDF (`relatorios.html`)
- **Problema:** O relatório de produtividade não atualizava automaticamente quando novas operações ou produtividades eram registradas.
- **Solução Esperada:** Conectar o relatório ao evento `nexus_data_changed` e implementar re-renderização automática e periódica sempre que houver alterações/operações registradas no sistema.
- **Status:** Concluído
