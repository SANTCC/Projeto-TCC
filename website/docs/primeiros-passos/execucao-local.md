---
id: execucao-local
title: Execução local
sidebar_label: Execução local
description: Como subir o servidor estático, entrar no sistema, percorrer o fluxo de login e resolver os problemas mais comuns.
---

# Execução local

---

## 1. Subir o servidor

```bash
npm start          # npx serve -l 3000 .  →  http://localhost:3000
```

Qualquer servidor estático serve; o único requisito é que a raiz do repositório seja a raiz do site
(os caminhos são relativos, então também funciona abrir `index.html` direto no navegador — com ressalvas
para as APIs de câmera, que exigem `https://` ou `localhost`).

:::tip Documentação no mesmo servidor
Como o site desta documentação é publicado em `docs/`, ele fica disponível em
`http://localhost:3000/docs/` quando o servidor roda na raiz. Para o modo de desenvolvimento com recarga
ao vivo, use `npm run docs:start` (porta 3000 do próprio Docusaurus).
:::

---

## 2. Fluxo de acesso (RF 1)

O login é próprio do sistema — **não usa Supabase Auth**:

<div className="nexus-fluxo">
  <span className="nexus-fluxo__etapa">index.html</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">código individual</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">validação em funcionarios</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">cookie nexus_pending_auth (10 min)</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa nexus-fluxo__etapa--ativa">confirm-role.html</span><span className="nexus-fluxo__seta">→</span>
  <span className="nexus-fluxo__etapa">cookie nexus_session (12 h)</span>
</div>

1. **`index.html`** — o operador digita o **código individual** vinculado à matrícula.
2. O sistema consulta `funcionarios` e guarda a identificação pendente no cookie
   `nexus_pending_auth` (10 minutos, apenas id/matrícula/código/nome/cargo).
3. **`confirm-role.html`** — mostra o **cargo** e o **nível de acesso**. O campo é **somente leitura**:
   o cargo vem do cadastro funcional, não é escolhido na tela.
4. Confirmado, nasce a sessão no cookie `nexus_session` (12 h — um turno). Todas as páginas passam pelo
   guard `js/auth-guard.js`, que valida cargo **e** página.

Detalhes de cookie, expiração e decisões de segurança: [Sessão e cookies](/seguranca/sessao-e-cookies).

---

## 3. Entrar com as contas de demonstração

Sem banco configurado, o sistema não inventa credenciais — é preciso ter o seed aplicado
(`supabase/seed.sql`) ou usar as contas do projeto de demonstração.

| Código individual | Cargo | Visão | O que consegue fazer |
| --- | --- | --- | --- |
| `MOCK-ESTIVADOR-123` | Estivador | Própria | movimentar as cargas que ele mesmo selecionou |
| `MOCK-CONFERENTE_CARGA-123` | Conferente de Carga | Própria | registrar recebimento físico e condições de saída |
| `MOCK-ARRUMADOR_CONSERTADOR-123` | Arrumador e Consertador | Própria | marcar "pronta para entrega" |
| `MOCK-PLANEJADOR_PATIO_NAVIOS-123` | Planejador de Pátio e de Navios | Própria | atualizar estado/posição de navios e contêineres |
| `MOCK-TECNICO_PORTOS-123` | Técnico em Portos | Própria | funcionários, visitantes, reemissão de credencial |
| `MOCK-SUPERVISOR_GERENTE_OPERACOES-123` | Supervisor / Gerente de Operações | Operacional | liberar, cancelar, aprovar manutenção, delegar |
| `MOCK-INSPETOR-123` | Inspetor | Operacional | inspeção técnica, cadastros de navio/contêiner/guindaste |
| `MOCK-DIRETOR_OPERACOES_LOGISTICA-123` | Diretor de Operações e Logística | Estratégica | dashboards e exportação de histórico |
| `MOCK-DIRETOR_PRESIDENTE_SUPERINTENDENTE-123` | Diretor-Presidente / Superintendente | Estratégica | idem + visão consolidada |
| `MOCK-CONSELHO_ADMINISTRACAO-123` | Conselho de Administração | Estratégica | idem |

Cada cargo tem ainda a variante `…-321`. As três contas usadas nas capturas de tela do `about.html` são
`MAT-0000` (Diretor-Presidente), `MAT-2011` (Supervisor) e `MAT-9999` (Técnico em Portos).

---

## 4. Roteiro sugerido para conhecer o sistema

1. Entre como **Estivador** → `cargas.html`: veja a lista restrita às cargas que ele selecionou.
2. Entre como **Conferente** → registre o recebimento físico de uma carga agendada.
3. Entre como **Inspetor** → `inspecao.html`: preencha o checklist e aprove ou recuse (a recusa exige
   motivo em texto livre).
4. Entre como **Supervisor** → `delegacao.html` (delegue um substituto) e depois a fila de liberação.
5. Entre como **Diretor** → `dashboard.html`: cards, gráficos por camada de visão e exportação.
6. Em qualquer tela, use `scanner.html` para simular a leitura de um QR Code.

---

## 5. Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| `Cannot find module 'terser'` ao rodar testes | raiz sem `npm ci` | `npm ci` na raiz |
| Telas vazias, console com `PGRST205` | schema não aplicado | aplicar `SPECs/schema.sql` ou as migrações |
| Banner de emergência não chega nas outras abas | Realtime não publicado | migração `20261009000000_realtime_publication.sql` |
| `401` na função de pânico / erro de CORS no preflight | função publicada com `verify_jwt` ligado | republicar com `--no-verify-jwt` |
| Contador de usuários on-line mostra `—` | sem Supabase/sessão/canal sincronizado | comportamento esperado; nunca exibe número fictício |
| Câmera do scanner não abre | contexto não seguro | servir por `https://` ou `localhost` |
| `npm start` sem resposta | porta 3000 ocupada | `npx serve -l 3001 .` |

O catálogo completo de erros de banco (PGRST205, 22P02, 23514, 55P04) está em
[Diagnósticos](/banco-de-dados/diagnosticos).
