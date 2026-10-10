---
id: sessao-e-cookies
title: Sessão e cookies
sidebar_label: Sessão e cookies
description: Como a sessão do NexusPort vive em cookies — atributos, tempos, vigia de expiração, limpeza de resquícios e as limitações declaradas.
---

# Sessão e cookies

A sessão do NexusPort é mantida **exclusivamente em cookies**, geridos por um único módulo
(`js/session-cookies.js`, 135 linhas) carregado antes de todos os outros em cada tela. Não há mais leitura
nem gravação de sessão em `sessionStorage`/`localStorage`.

> **Origem da decisão:** item do backlog 3 — *"Salvar o login com Cookies ao invés de SESSION_STORAGE"*.

---

## 1. Os dois cookies

| Cookie | Conteúdo | Validade | `SameSite` |
| --- | --- | --- | --- |
| `nexus_session` | sessão ativa (id, matrícula, código individual, nome, cargo, timestamps) | **12 h** (um turno) | `Lax` |
| `nexus_pending_auth` | identificação pendente até a confirmação de cargo (apenas id, matrícula, código, nome e cargo) | **10 min** | `Lax` |

Atributos comuns: `path=/` (navegação entre as telas) e `Secure` quando servido por HTTPS.

```javascript
// gravação (resumo do módulo)
document.cookie = `${nome}=${encodeURIComponent(valor)}; path=/; max-age=${segundos}; SameSite=Lax${
  location.protocol === 'https:' ? '; Secure' : ''
}`;
```

---

## 2. Quem usa cada cookie

| Módulo | Papel |
| --- | --- |
| `js/session-cookies.js` | única porta de leitura/gravação |
| `js/auth-guard.js` | lê a sessão ativa; aplica o vigia de expiração (a cada 60 s) e encerra sessões com mais de 12 h |
| `js/pages/login.js` *(index.html)* | grava a **pendência** — `index.html` não carrega o guard, então a pendência fica no módulo comum |
| `js/pages/confirm-role.js` | lê a pendência e a converte em sessão |

---

## 3. Ciclo de vida

```text
index.html            informa o código individual
      │ valida em funcionarios (ativo)
      ▼
nexus_pending_auth    cookie de 10 minutos (só os campos da confirmação)
      │
confirm-role.html     exibe cargo/nível/camada (somente leitura) e confirma
      ▼
nexus_session         cookie de 12 horas (turno)
      │
telas internas        auth-guard valida a cada carga de página
      │               + vigia de 60 s encerra sessão vencida
      ▼
sair                  limpeza imediata dos dois cookies
```

---

## 4. Regras e proteções

| Regra | Motivo |
| --- | --- |
| Cópias antigas em `sessionStorage`/`localStorage` são **apagadas** no login e no logout | migração limpa de versões anteriores |
| A pendência grava **só** os campos da confirmação | minimização de dados |
| Vigia de 60 s no `auth-guard.js` | encerra sessões com mais de 12 h mesmo com a aba aberta |
| Erro de login é genérico | não revela existência do código |
| Logout limpa os dois cookies | evita acesso residual |
| `Secure` sob HTTPS | impede envio em canal não cifrado |
| Sessão não entra em `localStorage` | reduz superfície de leitura por scripts de terceiros |

:::warning Limitação declarada
Cookies gravados por JavaScript **não podem ser `HttpOnly`**. A proteção contra XSS continua sendo a
codificação de saída ([Anti-XSS](/seguranca/anti-xss)), e essa limitação está registrada no próprio código
e no item de backlog.
:::

---

## 5. Decisão de migração (impacto para quem já usava o sistema)

Quem tinha sessão nas versões anteriores **precisa fazer login de novo uma vez** — as sessões antigas
viviam em `sessionStorage` e não são migradas. É uma decisão consciente: migrar sessão de um mecanismo
para outro exigiria confiar em dado potencialmente obsoleto.

---

## 6. Verificação

```bash
npm run test:sessao        # tests/test_sessao_cookies.js
npm run test:backlog3      # inclui a suíte de sessão + correções do backlog
```

Os testes cobrem: gravação e leitura dos dois cookies, expiração (12 h / 10 min), limpeza no logout,
ausência de escrita em `sessionStorage`/`localStorage`, vigia de expiração e o caminho
pendência → sessão.

---

## 7. Campos da sessão

| Campo | Uso |
| --- | --- |
| `id` / `matricula` | identificação do funcionário |
| `codigo_individual` | **autoria de toda escrita** (auditoria e trilha) |
| `nome` | exibição no cabeçalho/rodapé da sidebar |
| `cargo` | base do RBAC (`PAGE_PERMISSIONS`, `ACTION_PERMISSIONS`) |
| `cargo_nome` | rótulo legível (pode virar *"Supervisor Substituto (Delegação Ativa)"*) |
| `loginAt` / `expiraEm` | controle do vigia de expiração |

Os dados da sessão são **sempre codificados** ao serem renderizados (`js/layout.js` usa `nexusEsc`), porque
cookie é entrada controlável.
