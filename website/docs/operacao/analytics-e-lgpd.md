---
id: analytics-e-lgpd
title: Analytics e LGPD
sidebar_label: Analytics e LGPD
description: Como o Google Analytics 4 é usado sem dados pessoais, quais são as garantias técnicas e qual é a pendência de consentimento.
---

# Analytics e LGPD

`js/analytics.js` (85 linhas, comum a todas as páginas) mede **uso do sistema** com Google Analytics 4 sem
transformar dado pessoal em telemetria.

---

## 1. Regras do módulo

| Regra | Implementação |
| --- | --- |
| Identificador de aparelho | o cookie **`_ga`**, gravado pelo próprio `gtag.js` — é o mecanismo nativo do GA4, então o Google reconhece as ações de um mesmo dispositivo sem artifícios |
| **Sem fingerprinting** | nada de canvas, áudio, fontes, plugins, bateria ou hardware |
| Cookies | `SameSite=Lax` e `Secure` quando a página é HTTPS (mesma política dos cookies de sessão) |
| **Sem sinais de publicidade** | Google Signals desligado, sem personalização de anúncios |
| Eventos sem dado pessoal | campos com nomes/códigos/matrícula/e-mail etc. são **descartados**; valores são categorias (ex.: `"tela"`), nunca nomes ou códigos de funcionário |
| Falha silenciosa | se o `gtag.js` estiver bloqueado (ad blocker, rede), `track` retorna `false` e **não** lança erro |
| Sem telemetria a terceiros além do GA4 | o WebMCP, por exemplo, não envia nada para fora |

```javascript
// uso
NexusAnalytics.track('gerar_pdf', { origem: 'tela' });
// → parâmetros com nome, codigo, matricula, email são removidos antes do envio
```

---

## 2. O que é medido

| Evento (categoria) | Contexto |
| --- | --- |
| Navegação de tela | qual tela foi aberta, pela camada de visão |
| Ações de fluxo | agendamento, recebimento, inspeção, liberação, cancelamento |
| Emissão de relatório | geração de PDF e exportação de histórico |
| Uso de QR Code | leitura registrada (sem conteúdo do código) |
| Uso de agentes | chamada de ferramenta WebMCP (sem valores de argumentos) |
| Emergência | acionamento e resolução (pelo evento de domínio) |

---

## 3. Pendência: consentimento de cookies (LGPD)

**Não implementado.** O próprio código registra a pendência (*"Consentimento de cookies (LGPD) não está
implementado aqui: ver SPECs/backlog3.md, item F"*).

O que existe hoje:

- Coleta com dados minimizados e sem identificação nominal;
- Cookies próprios de sessão (estritamente necessários) e o cookie `_ga` do GA4;
- Nenhum compartilhamento com terceiros além do Google Analytics.

O que falta para conformidade plena:

1. **Banner de consentimento** antes de carregar o `gtag.js`;
2. **Bloqueio por padrão** até o aceite (o GA4 não deve carregar sem consentimento);
3. **Preferências granulares** (analytics separado de estritamente necessários);
4. **Registro do consentimento** (data/hora e escolha) para auditoria;
5. **Política de privacidade** acessível a partir das telas.

---

## 4. Base legal e risco atual

| Item | Situação |
| --- | --- |
| Dados pessoais em telemetria | **não** (campos identificadores são descartados na origem) |
| Dados pessoais no banco | sim: funcionários (nome, CPF, data de nascimento, matrícula, código), visitantes (documento) |
| Acesso a esses dados | restrito ao Técnico em Portos e à Direção (RF 1) |
| Retenção | não há política de expurgo definida |
| Risco | baixo em contexto acadêmico; **não** adequado a produção sem consentimento e política de retenção |

---

## 5. Testes

```bash
npm run test:analytics
```

Cobrem: descarte de campos pessoais, ausência de sinais de publicidade e de fingerprinting, política de
cookies, comportamento com `gtag.js` bloqueado (retorno `false`, sem exceção) e a lista de eventos
permitidos.

---

## 6. Se você for implementar o consentimento

Roteiro sugerido, coerente com o resto do projeto (sem bundler, tudo em módulos IIFE):

1. Criar `js/consent.js` com a leitura/gravação do cookie `nexus_consent` (`analytics: true|false`);
2. Fazer `analytics.js` **não** injetar o `gtag.js` enquanto `analytics` não estiver `true`;
3. Adicionar o banner como componente do `js/layout.js` (mesmo padrão visual do feedback inline);
4. Registrar a decisão em `logs_alteracoes` (`tipo_alteracao = EDICAO`, entidade `FUNCIONARIO`) para
   auditoria;
5. Adicionar testes em `tests/test_analytics.js` e uma página de política de privacidade;
6. Remover o item F do `SPECs/backlog3.md` e atualizar esta página.
