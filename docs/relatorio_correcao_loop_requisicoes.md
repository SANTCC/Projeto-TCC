# Relatório técnico — loop de requisições de cargas ao Supabase

**Data:** 10/10/2026

**Escopo:** diagnóstico e correção do carregamento de `public.cargas`, eventos de atualização e transições automáticas de status.

**Base examinada:** `4d7c1c15f42e80a93070fe9e10cb4f1c488952bc`.

## 1. Resumo executivo

A causa-raiz foi encontrada no fluxo da página de cargas: `renderTable()` fazia uma transição automática de status com base na localização local do navio, salvava somente no `localStorage` e chamava `NexusRepository.notifyChange('cargas')`. A notificação despachava `nexus_data_changed` sincronamente; o listener da própria página iniciava outra leitura. Como o status novo não havia sido persistido no banco, a consulta seguinte podia trazer o status anterior e repetir a transição. Para qualquer carga que atendesse à condição, isso criava uma sequência sem limite funcional de novos GETs — não era apenas a concorrência normal de várias leituras simultâneas.

A página do commit-base também foi executada em `jsdom` contra um repositório simulado que sempre devolvia o status antigo: observamos 7 chamadas a `getCargas()` e 7 notificações locais; a reprodução foi deliberadamente limitada após seis despachos para não deixar o teste rodar indefinidamente. A versão corrigida foi exercitada em `jsdom` em dois cenários complementares: repositório real com cliente Supabase simulado e página `cargas.js` real com repositório/cliente simulados. Não foi feita captura de tráfego contra o projeto remoto; a frequência/ocorrência em produção não foi medida.

A correção remove a mutação e a notificação de dentro da renderização, persiste transições automáticas elegíveis no Supabase com condição sobre o status anterior, deduplica leituras e atualizações em voo, descarta respostas antigas no fluxo da página e consolida eventos relevantes. Atualizações legítimas por ações do operador, eventos Realtime e sincronização periódica continuam ativos.

## 2. Diagnóstico e evidências

### 2.1 Cadeia causal comprovada no código original

| Etapa | Evidência no código-base | Consequência |
| --- | --- | --- |
| A página carregava cargas e depois renderizava | `js/pages/cargas.js:168-180`: `carregarCargasSupabase()` aguardava `NexusRepository.getCargas()` e chamava `renderTable()`. | Cada recarga completada alcançava a lógica de renderização. |
| A renderização relia o cache e avaliava o status do navio | `js/pages/cargas.js:345-386`; em particular, linhas 348 e 362-380. | O status calculado durante o desenho da tabela era tratado como alteração de dados. |
| A alteração era apenas local e emitia evento | `js/pages/cargas.js:381-385`: `localStorage.setItem(...)` seguido de `notifyChange('cargas')`. | O estado novo não era necessariamente o estado canônico do banco. |
| O listener da própria página reagia a todo evento | `js/pages/cargas.js:1551-1555`: qualquer `nexus_data_changed` chamava `carregarCargasSupabase()` sem filtro nem debounce. | O render iniciava outra leitura imediatamente. |
| A notificação fazia despacho local síncrono | `js/data-repository.js:752-760`, com o `dispatchEvent(...)` na linha 760. | O listener da página recebia o evento originado pelo mesmo render. |
| A leitura remota podia restaurar o status anterior | `js/data-repository.js:105-160`, especialmente o mapeamento e a gravação do resultado em `localStorage` nas linhas 127-160. | Se o banco ainda tivesse o status anterior, a renderização voltava a encontrar a condição e repetia o ciclo. |

O ciclo concreto era: **GET de `cargas` → render → transição local (`EM_TRANSITO` ou `ENTREGUE`) → `notifyChange('cargas')` → listener da página → novo GET**. O select relevante era `*, navios(id, nome), estivador_cargas(estivador_id, funcionarios(nome, matricula))`, que produz a consulta PostgREST observada como `/rest/v1/cargas?select=...`.

Havia também um caminho secundário de amplificação entre abas: `sincronizarNaviosHerdados()` gravava a projeção de navio herdado no cache durante o render (`js/pages/cargas.js` original, linhas 252-287). Uma gravação de `localStorage` pode disparar o evento `storage` em outras abas; o repositório transformava chaves `nexus_*` em `nexus_data_changed` (`js/data-repository.js` original, linhas 775-779), e o listener amplo da página recarregava cargas. Essa projeção também foi removida do cache canônico.

### 2.2 Hipóteses avaliadas — não confundir sintomas com causa

- **`net::ERR_INSUFFICIENT_RESOURCES` e `TypeError: Failed to fetch`:** por si sós não identificam a origem. Podem acompanhar saturação ou falha de rede. A origem do ciclo foi demonstrada pela sequência de chamadas acima, e não inferida dessas mensagens.
- **Single-flight no `fetch`:** já existia em `js/supabase-client.js:87-124`. Ele agrupa GETs idênticos enquanto estão simultaneamente em voo, mas remove a entrada quando a requisição termina. O ciclo da página iniciava o próximo GET depois de a leitura anterior ter sido consumida e renderizada; logo, deduplicação de concorrência não interrompia chamadas sequenciais.
- **Depuração de rede:** `js/net-debug.js:37` impede instalação duplicada, e `debugFetch()` chama o `nativeFetch` uma vez (`js/net-debug.js:656-680`). O módulo registra a requisição; não a repete. A depuração pode aumentar o custo de log sob tráfego alto, mas não é a origem do ciclo.
- **Realtime e sincronização:** o canal Realtime já agrupava rajadas em 400 ms (`js/data-repository.js:785-808`) e o polling de segurança já era de 60 s (`js/data-repository.js:877-886`). Esses mecanismos podem provocar recargas legítimas, mas não explicam a repetição imediata criada pelo próprio render. A busca no código JavaScript também não encontrou listener `auth.onAuthStateChange` como fonte de recargas.
- **Tela de embarcações:** `js/pages/embarcacoes.js:1271` chama `renderGpsTable()` a cada segundo. Essa função lê o cache e, quando detecta uma chegada ainda não refletida, pode gravar o cache e enviar um PATCH (`js/pages/embarcacoes.js:403-425`); ela não faz um GET de cargas a cada segundo, e a alteração local passa a impedir a repetição nos ticks seguintes. Esse caminho de status existente não foi alterado. Mudanças de `navios` também continuam provocando sincronização na página de cargas.

### 2.3 Retry secundário encontrado

No código original, qualquer erro no select composto fazia `getCargas()` tentar imediatamente outro select, sem o join de `estivador_cargas` (`js/data-repository.js:109-125`). Isso também ocorria com falhas transitórias, de rede ou autorização — situações em que a consulta simples não era um fallback justificado. Não era a causa do loop, mas podia duplicar o tráfego justamente durante falhas.

## 3. Alterações implementadas

### 3.1 Repositório (`js/data-repository.js`)

- `getCargas()` agora compartilha uma operação por revisão enquanto ela está em voo (`_cargasInFlight`, linhas 54-68 e 164-247). Chamadas simultâneas recebem listas/objetos próprios; uma chamada posterior à conclusão continua consultando o servidor — não foi criado cache permanente.
- Eventos que afetam cargas invalidam a revisão. A invalidação é feita em fase de captura (`js/data-repository.js:862-869`), antes de os listeners de página agendarem novas leituras.
- Uma resposta só grava `nexus_cargas_fluxo` se a revisão ainda for atual (`js/data-repository.js:228-232`).
- O select mantém as relações com `navios`, `estivador_cargas` e `funcionarios` (`js/data-repository.js:175-177`). O fallback sem o join opcional só é autorizado para erros de schema/relacionamento compatíveis (`js/data-repository.js:25-38 e 179-193`). Erros transitórios não geram um segundo GET imediato; a chamada retorna o cache existente e uma sincronização posterior pode recuperar os dados.

### 3.2 Ciclo e renderização da página (`js/pages/cargas.js`)

- A detecção das transições automáticas está separada do desenho da tabela (`js/pages/cargas.js:172-203 e 205-313`). `renderTable()` não altera mais status nem chama `notifyChange()`; também não relê o cache no meio da renderização (`js/pages/cargas.js:521-529`).
- Para registros com UUID do banco, as mudanças são agrupadas por status de origem/destino, deduplicadas em voo e persistidas com `UPDATE ... WHERE id IN (...) AND status_fluxo = statusAnterior` (`js/pages/cargas.js:220-267`). A condição sobre o status anterior impede que uma transição calculada com dados velhos sobrescreva, por exemplo, uma carga que foi cancelada em paralelo. Só IDs confirmados pela resposta são tratados como atualizados (`js/pages/cargas.js:275-300`).
- A resposta da página é verificada antes e depois da leitura e da transição (`js/pages/cargas.js:315-337`). Um evento novo ou `pagehide` invalida a revisão; timers pendentes são cancelados ao sair (`js/pages/cargas.js:339-357`). A escrita no cache compartilhado é permitida apenas à revisão atual.
- A projeção de navio herdado continua sendo usada na apresentação, mas não grava o snapshot projetado no cache canônico (`js/pages/cargas.js:428-463`).
- O listener mantém atualização por `cargas`, `navios`, `containers`, vínculos de estivador, funcionários, chaves de cache relevantes, `periodic_sync` e `window_focus`, consolidando rajadas em 100 ms (`js/pages/cargas.js:1700-1716`). Eventos sem relação com a tela, como `logs_alteracoes`, são ignorados. Os listeners Realtime, foco e polling do repositório não foram desligados.
- Se uma escrita automática falhar, o erro continua sendo registrado. A transição pode permanecer visível somente na memória desta tela, sem gravar um status não confirmado no cache compartilhado; não há retry em loop. Um evento ou sincronização posterior pode tentar novamente (`js/pages/cargas.js:260-310`).

### 3.3 Aviso da migração de funcionário

Em `js/pages/tecnico_portos.js:560`, corrigi o caminho exibido no aviso para o nome real `supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql`.

Não foram alterados credenciais, configuração de Supabase, autenticação, políticas RLS, schema remoto ou publicação Realtime.

## 4. Testes e resultados

Dependências instaladas localmente com `npm ci --no-audit --no-fund` (164 pacotes adicionados). `node_modules` não é parte do diff.

| Comando | Resultado |
| --- | --- |
| `npm run test:cargas-loop` | **32/32 verificações aprovadas.** Usa a página e o repositório reais em `jsdom`, com Supabase simulado. Cobre single-flight, relações da carga, fallback de schema, falha de rede, recuperação em evento posterior, cache após invalidação, render inicial, filtro/debounce de eventos, transições para `EM_TRANSITO` e `ENTREGUE` (inclusive navio herdado do contêiner), persistência única, corrida com cancelamento concorrente, navegação durante gravação e migração CPF/nascimento. |
| `npm run test:single-flight` | Todas as verificações existentes aprovadas; inclui 9 GETs concorrentes → 1 requisição, leituras concluídas sem cache e erro sem entrada presa. |
| `npm run test:net-debug` | **151 aprovados, 0 falhas.** |
| `npm run test:tempo-real` | **49 aprovados, 0 falhas.** |
| `npm run test:backlog3` | Suítes de backlog, sincronização e cookies concluídas sem falha (inclui 38 verificações na suíte de cookies). |
| `npm run test:webmcp` | **224/224** e **126/126** verificações aprovadas. |
| `npm run test:gravacao` | Testes de gravação de inspeção/login aprovados. |
| `npm run audit:xss` | Scanner: **0 interpolações não codificadas**; testes dos 10 payloads concluídos sem vulnerabilidade. |
| `npm run test:haptics` e `npm run test:vlibras` | Aprovados quando executados na suíte completa. |
| `npm run test:build` | **26 aprovados, 0 falhas.** Build/minificação determinísticos; 12 páginas e 41 módulos JS verificados. |
| `node --check` nos três JS alterados e no teste novo; `git diff --check` | Todos concluíram com código de saída zero. |

### Resultado da suíte geral

`npm test` **não termina verde**: chega a `test:python` e a suíte Python termina com **3 falhas e 2 erros em 13 testes**. Os casos são:

1. `test_cargas_lifecycle`: esperava `RECEBIMENTO_INSPECAO`, obteve `AGENDAMENTO`.
2. `test_embarcacoes_crud`: esperava `FORA_DO_PORTO`, obteve `DENTRO_DO_PORTO`.
3. `test_inspecoes_active_history`: esperava `ARMAZENAGEM`, obteve `AGENDAMENTO`.
4. `test_delegacao_substituto`: `KeyError: 'id'` ao revogar a delegação.
5. `test_panic_trigger_and_resolve`: `KeyError: 'id'` ao resolver a emergência.

Esses mesmos **3 failures + 2 errors** foram reproduzidos extraindo e executando a suíte sobre a base original limpa `4d7c1c15f42e80a93070fe9e10cb4f1c488952bc`. Os arquivos/módulos Python correspondentes não foram alterados; portanto, são falhas preexistentes, não corrigidas neste escopo. Como o comando termina nesse ponto, o segundo `test:vlibras` duplicado no final da receita npm não foi executado depois da falha Python; a execução anterior de `test:vlibras` dentro da mesma receita foi aprovada.

## 5. Colunas Supabase para CPF e nascimento

A migração existente `supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql` define:

| Tabela/coluna | Tipo | Nulabilidade/configuração |
| --- | --- | --- |
| `public.funcionarios.cpf` | `text` | Nullable; armazene os 11 dígitos sem pontuação. Há índice único parcial `funcionarios_cpf_unique` somente para `cpf IS NOT NULL` (linhas 13-22). |
| `public.funcionarios.data_nascimento` | `date` | Nullable; envie no formato ISO `AAAA-MM-DD`, sem horário/fuso (linhas 16-17 e comentário na linha 25). |

A migração não adiciona `NOT NULL`, `CHECK` de formato/idade nem política RLS: a nulabilidade é permitida e as regras de formato/idade são descrições/validações da aplicação, não constraints SQL criadas por esse arquivo. A presença do arquivo no repositório **não confirma que foi aplicado no projeto Supabase remoto**. Se ainda estiver pendente, aplique pelo procedimento documentado em `migrations/README.md` (`supabase db push`, ou SQL Editor do dashboard executando o arquivo). Enquanto as colunas não existirem, a tela tenta salvar o cadastro básico e avisa que CPF/nascimento não foram sincronizados.

**Privacidade:** CPF e data de nascimento são dados pessoais. A migração acima não altera RLS. O schema local `SPECs/schema.sql` contém uma política ampla para `funcionarios` (`for all using (true)`, linha 456), e a documentação de migrações alerta que a aplicação usa chave publishable/role `anon`. Antes de armazenar dados reais, revise no projeto remoto as políticas, grants e quais cargos/clientes podem consultar esses campos. Essa revisão não foi aplicada aqui, e o estado remoto não foi inspecionado.

## 6. Validação operacional pendente

Não foi possível concluir validação manual em navegador real, inspeção de DevTools/Network contra o projeto remoto, teste com múltiplas abas reais ou confirmação da aplicação da migração neste trabalho: não houve acesso confirmado ao Supabase remoto nem sessão manual autenticada; a disponibilidade de Chromium também não foi confirmada. Essas verificações ficam **pendentes/não aprovadas**. Os testes automatizados simulam o PostgREST e não provam conectividade, RLS ou schema do projeto Supabase.

Após implantação, valide sem compartilhar HARs ou capturas que exponham `apikey`/`Authorization`:

1. Na tela **Cargas**, filtre a requisição `/rest/v1/cargas` e confirme uma leitura inicial, uma leitura por rajada real de alterações e a sincronização de segurança configurada para 60 s — não uma cadeia imediata sem novos eventos.
2. Para uma transição automática legítima, confirme uma atualização de status e, se o Realtime entregar o evento, no máximo a leitura de atualização correspondente; o status já persistido não deve gerar novas atualizações repetidas.
3. Observe avisos de erro de atualização/RLS no console e os códigos HTTP no painel do projeto. Em falha transitória, não deve haver fallback GET duplicado imediato; uma sincronização posterior deve poder recuperar.
4. Teste navegação/retorno e outra aba: eventos de `cargas`, navios e vínculos devem atualizar a lista; eventos irrelevantes não devem disparar consulta de cargas.

`NexusNetDebug.summary()` e `NexusNetDebug.history()` podem ajudar a contar requisições no navegador, sem divulgar os cabeçalhos ou tokens.
