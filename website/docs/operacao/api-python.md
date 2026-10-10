---
id: api-python
title: API e CLI em Python
sidebar_label: API e CLI (Python)
description: A suíte tools/nexus_api/ e o executável nexus_cli.py — comandos, módulos e como usar no terminal.
---

# API e CLI em Python

Além da interface web, o projeto tem uma **suíte Python** (`tools/nexus_api/`) com um CLI
(`nexus_cli.py`) para operar e verificar o sistema pelo terminal. Ela é útil para scriptar rotinas,
demonstrar o domínio em ambiente controlado e alimentar as verificações em PostgreSQL real.

---

## 1. Módulos

| Módulo | Responsabilidade |
| --- | --- |
| `tools/nexus_api/__init__.py` | pacote e `NexusPortApp` (fachada usada pelo CLI) |
| `auth.py` | autenticação por matrícula ou código individual |
| `cargas.py` | listar, obter, agendar, receber, movimentar, marcar pronta, liberar, cancelar |
| `embarcacoes.py` | navios, berços, contêineres, guindastes, rotas |
| `inspecoes.py` | listar, inspecionar e recusar cargas |
| `manutencao.py` | ordens de serviço (solicitar, aprovar, recusar, concluir) e preventiva |
| `delegacao.py` | designar/revogar substituto |
| `tecnico.py` | funcionários e visitantes |
| `panic.py` | emergência: status, disparo e resolução |
| `kpis.py` | indicadores operacionais e estratégicos |
| `auditoria.py` | log de alterações e trilha de decisões |
| `client.py` | camada HTTP/PostgREST usada pelos demais módulos |
| `config.py` | credenciais e configuração (mesmo padrão de `js/config.js`) |
| `uuid_utils.py` | utilitários de identificadores |
| `cli.py` | parser de argumentos e comandos |

---

## 2. Executável

```bash
python3 nexus_cli.py --help
python3 nexus_cli.py login <matrícula-ou-código>
```

O `nexus_cli.py` na raiz é um atalho de 5 linhas que chama `tools.nexus_api.cli.main()` — a lógica fica
toda no pacote.

---

## 3. Comandos

| Comando | `--action` disponíveis |
| --- | --- |
| `login <identificador>` | — (autentica por matrícula ou código individual) |
| `cargas` | `list`, `get`, `schedule`, `receive`, `move`, `ready`, `release`, `cancel` |
| `navios` | `list`, `get`, `save`, `release`, `return`, `delete` |
| `bercos` | `list`, `save`, `link` |
| `inspecoes` | `list`, `inspect`, `reject` |
| `manutencao` | `list`, `request`, `approve`, `reject`, `complete`, `preventive` |
| `emergencia` | `status`, `trigger`, `resolve` |
| `indicadores` | KPIs operacionais (e estratégicos, conforme o cargo) |
| `delegacao`, `tecnico` | designação de substituto, funcionários e visitantes |

Exemplos:

```bash
# autenticação (a mesma do sistema: código individual ou matrícula)
python3 nexus_cli.py login SUP-2001

# cargas
python3 nexus_cli.py cargas --action list
python3 nexus_cli.py cargas --action get --id NX-2026-0042
python3 nexus_cli.py cargas --action schedule --tipo "Grãos" --peso 25 --volume 40
python3 nexus_cli.py cargas --action cancel --id NX-2026-0042 --motivo "Avaria no pátio"

# inspeção (aprovar ou recusar)
python3 nexus_cli.py inspecoes --action inspect --id NX-2026-0042 --resultado APROVADA
python3 nexus_cli.py inspecoes --action reject  --id NX-2026-0042 --motivo "Lacre rompido"

# manutenção e preventiva
python3 nexus_cli.py manutencao --action request --entidade NAVIO --id IMO9990001 --descricao "Casco"
python3 nexus_cli.py manutencao --action preventive

# emergência
python3 nexus_cli.py emergencia --action status
python3 nexus_cli.py emergencia --action trigger
```

Os parâmetros aceitos incluem `--id`, `--tipo`, `--peso`, `--volume`, `--motivo`, `--resultado`,
`--entidade` (`NAVIO`/`CONTAINER`/`GUINDASTE`) e `--descricao`.

---

## 4. Relação com os testes Python

Os verificadores de banco (`tests/verify_*.py`) não usam o pacote para operar — eles aplicam SQL real em
um PostgreSQL descartável (`pgserver`) e conferem o resultado. A suíte do CLI é verificada por
`tests/test_python_suite.py`:

```bash
npm run test:python        # python3 -m unittest discover -s tests -p "test_python_suite.py"
```

---

## 5. Quando usar o CLI

| Cenário | Por que o CLI ajuda |
| --- | --- |
| Demonstração rápida em banca | mostra o domínio sem depender de navegador |
| Rotina de verificação | conferir status de cargas, KPIs e emergência |
| Scripts de carga | semear/checar cenários antes de uma apresentação |
| Diagnóstico | ver o retorno bruto de uma operação que falhou na tela |

:::warning Escopo e segurança
O CLI fala com o mesmo PostgREST usando a chave *publishable*, e a identidade é o `codigo_individual` —
exatamente como o front-end. Portanto ele **herda os mesmos riscos aceitos** documentados em
[RLS e políticas](/banco-de-dados/rls-e-politicas): não há privilégio extra, e nenhuma credencial de
serviço é usada.
:::

---

## 6. Testes e arquivos relacionados

| Arquivo | Papel |
| --- | --- |
| `nexus_cli.py` | atalho executável |
| `tools/nexus_api/` | 15 módulos do pacote |
| `tests/test_python_suite.py` | suíte do pacote |
| `tests/verify_*.py` | verificações em PostgreSQL real (15 arquivos) |
| `npm run test:python` | executa a suíte do pacote |
