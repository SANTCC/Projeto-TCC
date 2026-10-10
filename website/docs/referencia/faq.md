---
id: faq
title: Perguntas frequentes
sidebar_label: FAQ
description: Respostas curtas para as dúvidas mais comuns sobre o NexusPort — instalação, login, dados, segurança, agentes de IA e deploy.
---

# Perguntas frequentes

Respostas curtas, com o link para a página onde o assunto está detalhado.

---

## Instalação e ambiente

**O sistema precisa de bundler (webpack, Vite)?**
Não. As páginas usam Tailwind por CDN e módulos IIFE comuns (`<script>` + `window.NexusX`). O único build é
a minificação de `tools/build.js` para `dist/`. Ver [Frontend](/arquitetura/frontend).

**Preciso do Supabase para abrir as telas?**
Para navegar, não: há modo de demonstração com dados fictícios. Para gravar, sim. Ver
[Configuração do Supabase](/primeiros-passos/configuracao-supabase).

**`Cannot find module 'terser'` ao rodar os testes?**
Falta instalar as dependências na raiz: `npm ci`. Ver [Instalação](/primeiros-passos/instalacao).

**Onde eu coloco minhas credenciais do Supabase?**
Em `js/config.js`, copiado de `js/config.example.js`. Esse arquivo está no `.gitignore` e **não** deve ser
commitado. Ver [Configurações e variáveis](/referencia/configuracoes).

---

## Login, sessão e permissões

**Como faço login?**
Informe a **matrícula** ou o **código individual**, confirme o cargo na tela seguinte e a sessão começa
(12 h). Ver [Sessão e cookies](/seguranca/sessao-e-cookies).

**Por que a sessão acaba mesmo com a aba aberta?**
O `auth-guard.js` verifica a cada 60 s e encerra sessões com mais de 12 h. Basta entrar de novo.

**Posso usar localStorage para guardar a sessão?**
Não — a decisão é cookie (`nexus_session`), e o projeto **apaga** resquícios antigos em
`sessionStorage`/`localStorage`.

**Por que o link da página não aparece no menu para o meu cargo?**
`PAGE_PERMISSIONS` bloqueia por cargo (9 páginas). Ver
[Cargos e permissões](/dominio/cargos-e-permissoes).

**O Supervisor pode entrar como substituto?**
A delegação dá **poderes de liberação** ao substituto durante a vigência e muda o rótulo do cargo na sessão;
o cargo de origem continua sendo o registrado. Um substituto ativo por titular.

---

## Cargas, inspeção e regras

**A carga pulou de "Armazenagem" para "Pronta para Entrega". Falta status?**
Não. A **vinculação é a 4ª etapa e não tem estado próprio** (não-requisito 15). Ver
[Fluxo da carga](/dominio/fluxo-da-carga).

**Quando uma carga pode ser cancelada?**
Só em `AGENDAMENTO`, `ARMAZENAGEM` e `PRONTA_PARA_ENTREGA`, **com motivo** (RN 16). `EM_TRANSITO` não pode
ser cancelada.

**Como o ETA é calculado?**
Distância da rota cadastrada ÷ **33 km/h**. Sem rota cadastrada, a liberação é bloqueada (`T3.19`). Ver
[Edge Functions](/arquitetura/edge-functions).

**Uma inspeção pode ser refeita?**
Sim, desde que não exista outra **ativa** para a mesma carga — há índice parcial de unicidade
(`uq_inspecoes_carga_ativa`). Ver [Tabelas](/banco-de-dados/tabelas).

**Por que o navio não aceita carga?**
Navio `EM_REFORMA` ou `AGENDADO_PARA_REFORMA` não recebe carga (`T3.13`). O berço também precisa estar
livre e coerente (restrição `bercos_vinculo_navio_check`).

---

## Banco de dados

**Por que toda requisição é tratada como `anon`?**
Porque o projeto **não usa Supabase Auth**: a identidade é o `codigo_individual`. Por isso as políticas RLS
são escritas para `anon, authenticated`. Ver [RLS e políticas](/banco-de-dados/rls-e-politicas).

**PGRST205 / "tabela não encontrada" logo após uma migração?**
É o cache de schema do PostgREST. As migrações terminam com `notify pgrst, 'reload schema'`. Ver
[Diagnósticos](/banco-de-dados/diagnosticos).

**22P02 ao usar um valor novo de enum?**
O valor não existe no enum, ou foi usado na **mesma transação** em que foi criado (`55P04`). Separe em duas
execuções. Ver [Diagnósticos](/banco-de-dados/diagnosticos).

**Dá para reverter uma migração?**
Não há `down`. O padrão é **idempotência** (`if not exists`, `do $$ ... $$`) e migração corretiva seguinte.
Ver [Migrações](/banco-de-dados/migracoes).

**Por que existe `bercos` em dois lugares?**
`SPECs/migrations/001_create_bercos.sql` é o registro numerado; `supabase/migrations/` é o que a CLI aplica.
Ver [Migrações](/banco-de-dados/migracoes).

---

## Segurança

**O sistema é seguro?**
Há um modelo documentado, com riscos **aceitos e declarados** ([Modelo de segurança](/seguranca/modelo-de-seguranca)):
chave *publishable* no navegador, RLS permissivo para `anon`, cookies não `HttpOnly` e ausência de
consentimento LGPD. Como trabalho acadêmico, é adequado; para produção, siga a lista de endurecimento.

**Como os dados dinâmicos são protegidos contra XSS?**
Com codificação de saída (`nexusEsc`, `nexusJsArg`) — nunca confiando em `innerHTML` cru. Há varredura
automática: `npm run scan:xss` e `npm run audit:xss`. Ver [Anti-XSS](/seguranca/anti-xss).

**Onde ficam as camadas de autorização?**
São **seis**: `PAGE_PERMISSIONS` → `ACTION_PERMISSIONS` → camada de visão → escrita do WebMCP → Edge
Functions → RLS. Ver [Modelo de segurança](/seguranca/modelo-de-seguranca).

---

## Agentes de IA (WebMCP)

**O que é o WebMCP?**
Uma camada que expõe **72 ferramentas** a agentes por `document.modelContext`, com confirmação, limites e
trilha de auditoria. Ver [WebMCP](/arquitetura/webmcp) e
[catálogo das ferramentas](/arquitetura/webmcp-ferramentas).

**O agente pode liberar um navio sozinho?**
Não. A ação exige **confirmação humana** e o mesmo RBAC do servidor; sem confirmação, a execução falha
(*fail-closed*).

**O agente pode ler dados pessoais?**
Não: existem ferramentas bloqueadas por segurança (CPF, documentos, dados de visitantes) e os argumentos
das ferramentas são filtrados.

---

## Relatórios, QR Code e capturas

**O PDF é gerado no navegador?**
Hoje, **no servidor** (Edge `relatorio-pdf`), com cache por hash no bucket privado `relatorios-pdf`. Ver
[Relatórios em PDF](/operacao/relatorios-pdf).

**Posso editar `about.html` à mão?**
Não — ele é gerado por `tools/screenshots/gerar-about.js` e o teste `npm run test:about` reprova edições
manuais. Ver [Documentação ilustrada](/operacao/documentacao-ilustrada).

**Onde estão as capturas de tela?**
Em `about/screenshots/` (fonte única, 30 PNGs). O site da documentação as espelha automaticamente.

**A câmera do QR Code não abre. Por quê?**
Ela exige contexto seguro (`https://` ou `localhost`). Em HTTP simples, use a digitação do código.

---

## Testes, build e deploy

**Como rodo tudo antes de abrir um PR?**

```bash
npm test && npm run test:build
```

**O que o gate Lighthouse reprova?**
Performance < 0,60, acessibilidade < 0,75, boas práticas < 0,90, SEO < 0,90, ou auditoria crítica falhando na
maioria das 3 rodadas — com as exceções declaradas por página. Ver [Gate Lighthouse](/operacao/lighthouse).

**Onde a documentação é publicada?**
Em `/docs/` (saída do Docusaurus). O workflow `.github/workflows/docs.yml` publica no GitHub Pages;
`lighthouse.yml` e `vercel.json` **não** são tocados.

**Como faço o site funcionar sob o caminho `/nome-do-repo/docs/`?**

```bash
DOCS_URL=https://santcc.github.io DOCS_BASE_URL=/Projeto-TCC/docs/ npm run docs:build
```

**Renomeei um arquivo e o build quebrou com "broken links".**
`onBrokenLinks: 'throw'` está ligado de propósito. Corrija os links que o erro apontar. Ver
[Como manter a documentação](/referencia/como-documentar).

---

## Ainda com dúvida?

| Assunto | Página |
| --- | --- |
| Visão geral do produto | [Introdução](/introducao) |
| Vocabulário do domínio | [Glossário](/dominio/glossario) |
| Estrutura de pastas | [Estrutura do repositório](/primeiros-passos/estrutura-do-repositorio) |
| O que está pendente | [Manutenção e backlog](/operacao/manutencao-e-backlog) |
| Especificação original | [A pasta SPECs](/referencia/specs) |
