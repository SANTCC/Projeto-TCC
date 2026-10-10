---
id: dados-e-repositorio
title: Dados e repositório central
sidebar_label: Dados e repositório
description: Como o js/data-repository.js centraliza leituras e escritas, caches, sincronização Realtime, tratamentos de erro e auditoria.
---

# Dados e repositório central

`js/data-repository.js` (898 linhas) existe para eliminar dois problemas históricos do projeto: **`fetch`
espalhado pelas telas** e **fallback com dados fictícios hardcoded**. Hoje há um único caminho para os
dados.

---

## 1. Regras do módulo

| Regra | Como aparece no código |
| --- | --- |
| Sem dados fictícios | `const ENABLE_MOCKS = false;` — a constante existe como trava explícita |
| Um ponto de escrita | todos os `insert`/`update`/`delete` passam por métodos do repositório |
| Sincronização por evento | mudanças disparam `nexus_data_changed` com `{ entity, origem }` |
| Sem retransmissão entre abas | cada aba tem assinatura Realtime própria (evita loops e avisos duplicados) |
| Debounce de rajadas | 400 ms entre a última mudança recebida e o evento emitido |
| Sincronização de segurança | recarga completa a cada 60 s, mesmo sem evento |

```javascript
// disparo do evento após mudança real no banco
window.dispatchEvent(new CustomEvent('nexus_data_changed', {
  detail: { entity: tabela, origem: 'realtime' }
}));
```

Nas telas, o consumo é sempre o mesmo:

```javascript
window.addEventListener('nexus_data_changed', (e) => {
  if (EVENTOS_QUE_INVALIDAM_CARGAS.has(e.detail.entity)) carregarCargas();
});
```

---

## 2. Tabelas assinadas no Realtime

`NexusRepository.REALTIME_TABLES` (21 entradas) — cada uma vira um listener `postgres_changes`
(`event: '*'`, `schema: 'public'`):

```text
cargas            containers         navios             guindastes
manutencoes       historico_manutencoes                funcionarios
visitantes        bercos             rotas_maritimas    delegacoes_supervisor
inspecoes         inspecao_itens     checklist_modelos  checklist_itens
tipos_carga       leituras_qr_code   estivador_cargas   agendamentos
logs_alteracoes   trail_decisoes
```

:::warning Pré-requisito no banco
Sem a migração `supabase/migrations/20261009000000_realtime_publication.sql`, o canal conecta mas **não
recebe eventos** — as telas passam a atualizar somente pela sincronização de 60 s. Ver
[Tempo real e presença](/arquitetura/tempo-real-e-presenca).
:::

---

## 3. Caches e invalidação

O repositório mantém caches em memória por entidade, porque as telas leem os mesmos conjuntos várias vezes
por render (tabelas + modais + seletores). O padrão é:

1. `carregarX()` consulta o banco e atualiza o cache;
2. qualquer escrita local invalida o cache da entidade;
3. um evento `nexus_data_changed` (Realtime **ou** local) reexecuta o carregamento da tela visível;
4. o conjunto `EVENTOS_QUE_INVALIDAM_CARGAS` define quais entidades afetam a lista de cargas
   (`cargas`, `navios`, `containers`, …), evitando recarregar o que não mudou.

---

## 4. Consultas e filtros

| Situação | Estratégia |
| --- | --- |
| Visão Própria (Estivador) | filtro pelas cargas vinculadas ao funcionário (`estivador_cargas`) |
| Visão Própria (Conferente) | filtro pelos registros lançados por ele |
| Visão Operacional | leitura completa dos dados operacionais, sem dados pessoais de funcionários/visitantes |
| Visão Estratégica | leitura total + indicadores consolidados + exportação |
| Busca de relatórios | os 5 filtros do RF 10 combinados com `or`/`not.in` do PostgREST |
| Controle de requisições | `test_single_flight.js` e `test_cargas_request_control.js` garantem uma requisição por vez por conjunto |

---

## 5. Tratamento de erros

`js/supabase-client.js` acrescenta `window.NexusSupabaseUtils`, que reconhece os erros reais enfrentados
em produção acadêmica e evita que a tela quebre:

| Erro | Significado | Reação |
| --- | --- | --- |
| `PGRST205` (HTTP 404) | a tabela não está no *schema cache* do PostgREST | devolve `[]`, registra aviso no console e informa a migração que cria a tabela |
| `22P02` | valor inválido para enum | aponta o valor e a migração que corrige |
| `23514` | violação de *check constraint* (ex.: berço `OCUPADO` sem navio) | normaliza antes de gravar (`normalizarBerco`) |
| `23505` | violação de unicidade (ex.: IMO duplicado) | mensagem de feedback na tela |
| Rede indisponível | sem Supabase | modo simulação com as telas navegáveis |

```javascript
// normalização aplicada antes do upsert em lote dos 15 berços
NexusSupabaseUtils.normalizarBerco(berco);   // limpa vínculo residual de cache local legado
```

---

## 6. Escritas, autoria e auditoria

Toda escrita leva o **código individual** de quem executou. A partir daí:

1. as políticas de RLS decidem se a operação é permitida para a role `anon`;
2. os gatilhos/tabelas de auditoria registram em `logs_alteracoes` (`CRIACAO`, `EDICAO`, `EXCLUSAO`,
   `REIMPRESSAO_ETIQUETA`, `EXPORTACAO`);
3. as ações críticas (liberar, cancelar, aprovar, recusar, designar substituto, inspecionar) também
   escrevem em `trail_decisoes`;
4. se a ação veio de um agente de IA, o registro recebe a marca `[Agente WebMCP: <ferramenta>]`.

---

## 7. Como adicionar uma nova consulta

```javascript
// 1) no repositório: um método por intenção de negócio (nunca SQL genérico solto na tela)
async function listarCargasDoOperador(codigoIndividual, filtros = {}) { /* ... */ }

// 2) aplicar a camada de visão antes de devolver
return NexusVision.filtrarCargas(dados, sessao);

// 3) expor no retorno do módulo
// 4) na tela, consumir o método e ouvir nexus_data_changed
// 5) cobrir com teste em tests/ (jsdom + cliente Supabase falso)
```

Checklist de PR para mudanças de dados:

- [ ] a consulta passa pelo repositório (não há `NexusSupabase.from(...)` na página);
- [ ] a camada de visão foi aplicada;
- [ ] o resultado não expõe dados pessoais fora da Visão Estratégica/Técnico;
- [ ] a escrita é auditada e, se crítica, entra na trilha;
- [ ] há teste em `tests/` e o `npm test` continua verde.
