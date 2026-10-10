---
id: paginas
title: Páginas do sistema
sidebar_label: Páginas
description: As 13 telas HTML — título, cargo com acesso, controlador, bibliotecas e o que cada uma faz.
---

# Páginas do sistema

O sistema tem **13 arquivos HTML** na raiz do repositório. Como não há roteador, a navegação é feita por
links diretos entre arquivos.

| Arquivo | Título | Acesso (cargos) | Controlador |
| --- | --- | --- | --- |
| `index.html` | Autenticação de Operador | público | `js/pages/login.js` |
| `confirm-role.html` | Confirmação de Cargo | público (com pendência) | `js/pages/confirm-role.js` |
| `dashboard.html` | Painel Geral | todos os 10 cargos | `js/pages/dashboard.js` + `charts.js` |
| `cargas.html` | Cargas & Pátio | todos menos Técnico em Portos | `js/pages/cargas.js` |
| `inspecao.html` | Inspeção & Checklist | Inspetor, Supervisor, Direção/Conselho | `js/pages/inspecao.js` |
| `scanner.html` | Scanner QR Code | todos os 10 cargos | `js/pages/scanner.js` |
| `embarcacoes.html` | Embarcações & GPS | Planejador, Supervisor, Inspetor, Direção/Conselho | `js/pages/embarcacoes.js` |
| `manutencao.html` | Manutenção & OS | Supervisor, Inspetor, Direção/Conselho | `js/pages/manutencao.js` |
| `delegacao.html` | Delegação de Supervisor | Supervisor, Direção/Conselho | `js/pages/delegacao.js` |
| `tecnico_portos.html` | Técnico em Portos | Técnico em Portos, Direção/Conselho | `js/pages/tecnico_portos.js` |
| `relatorios.html` | Relatórios & PDF | todos os 10 cargos | `js/pages/relatorios.js` |
| `teste-vibracao.html` | Teste de Vibração | público (diagnóstico) | `js/webmcp/webmcp-vibracao.js` |
| `about.html` | Como funciona o sistema | público | gerado por `tools/screenshots/gerar-about.js` |

---

## 1. `index.html` — Autenticação de Operador

- **RF atendido:** RF 1 · **Bibliotecas:** Tailwind, Lucide, supabase-js.
- Campo único de **código individual** (monoespaçado), máscara em caixa alta e mensagem **genérica** de
  credenciais inválidas (não revela se o código existe).
- Valida em `funcionarios` (ativo = true) e grava a pendência em cookie por 10 minutos.
- Fundo `#1E293B` com o logotipo centralizado e card branco de `radius: 16px`.
- Capturas: `about/screenshots/publico-login*.png`.

## 2. `confirm-role.html` — Confirmação de Cargo

- **RF atendido:** RF 1.
- Mostra cargo, nível de acesso e camada de visão que a sessão vai receber, com o campo **desabilitado** —
  o cargo não é escolhido pelo usuário.
- Converte `nexus_pending_auth` em `nexus_session` (12 h) e redireciona para `dashboard.html`.
- Capturas: `about/screenshots/MAT-*-confirmacao-cargo.png`.

## 3. `dashboard.html` — Painel de Comando

- **RF atendidos:** RF 7 (indicadores), RF 12 (log de alterações), RF 13 (trail), RF 16 (produtividade).
- Cards de KPI com ícone em círculo de 48 px, título Inter 500 14px e valor Montserrat 700 32px; cada card
  é clicável e abre o detalhamento.
- Gráficos do `charts.js` recortados pela **camada de visão** do cargo; atualização automática a cada 60 s
  (`#chartsRefreshBtn` para recarga manual sem cache).
- Seções de auditoria e trilha de decisões (imutável, com retificações anexadas).
- Captura de tema escuro disponível: `mat-0000-dashboard-tema-escuro.png`.

## 4. `cargas.html` — Cargas & Pátio

- **RF atendidos:** RF 2, RF 4, RF 6, RF 17 (QR/etiqueta), RN 1–6, 13, 16–18.
- O coração operacional: lista com busca/filtros, ficha da carga em abas (Dados · Vínculos · Inspeção ·
  Histórico · Relatório), ações por cargo e modais de confirmação.
- Agendamento exige **tipo de carga com checklist** cadastrado; atributos obrigatórios marcados com `*`
  (peso, volume, valor declarado, natureza, tipo, porto de descarga).
- QR Code gerado **em tempo real** na tela de confirmação (`qrcode.js`) com botão **Imprimir Etiqueta**
  (PDF 10×10 cm via jsPDF) e reimpressão auditada.
- Registro de movimentação do Estivador com `estado_carregamento_enum`
  (`EM_CARREGAMENTO`/`PARADO`/`CONCLUIDO`).

## 5. `inspecao.html` — Inspeção & Checklist

- **RF atendidos:** RF 9, RN 14.
- Abre automaticamente ao escanear o QR da carga (RF 17.3).
- Itens agrupados; cada item tem `Conforme` / `Não conforme` / `Não se aplica` + observação; itens
  **críticos** trazem selo de perigo e bloqueiam a aprovação enquanto não conformes.
- Barra de progresso com o percentual respondido; rodapé fixo com **Aprovar carga** (habilitado só sem
  críticos pendentes) e **Recusar carga** (modal com motivo obrigatório).

## 6. `scanner.html` — Scanner QR Code

- **RF atendidos:** RF 17.3, RF 17.4, RN 19.
- Leitura pela **câmera** do dispositivo (`html5-qrcode`) ou digitação manual do código.
- Exige sessão autenticada; cada leitura é registrada em `leituras_qr_code` com cargo, código e data/hora,
  além de auditoria. Oferece um botão de "simular leitura" para demonstração e testes.
- Ao ler, encaminha direto para a tela da entidade com as ações do cargo em destaque.

## 7. `embarcacoes.html` — Embarcações & GPS

- **RF atendidos:** RF 2, RF 3, RF 4, RF 5, RF 8, RF 17.1 (QR de contêiner).
- Cadastro/edição de navios (nome, IMO, origem, destino, estado, coordenadas), contêineres (número, tipo de
  carga, material, datas, `referencia_tempo`), guindastes e rotas marítimas.
- Painel dos **15 berços** do STS-01 com estados `LIVRE`/`OCUPADO`/`MANUTENCAO` e vínculo ao navio.
- Posição GPS com ícone de âncora e ETA (distância ÷ 33 km/h), com bloqueio de liberação sem rota.

## 8. `manutencao.html` — Manutenção & OS

- **RF atendidos:** RF 2 (guindastes), RF 3, RN 11.
- Ciclo da OS: `SOLICITADA` → `APROVADA` / `RECUSADA` → `CONCLUIDA`; histórico de serviços
  (`historico_manutencoes`) com data e descrição.
- Card de **preventiva sugerida** (> 3 anos desde o cadastro ou a última manutenção) — informativo, nunca
  alarme.
- O painel de webhook que existia nesta tela foi **removido**: o disparo opcional é exclusivo da Edge
  Function `panic-alert` e fica desativado por padrão em `panic_webhook_config`.

## 9. `delegacao.html` — Delegação de Supervisor

- **RF atendido:** RF 14.
- Designa o substituto (nome, matrícula, CPF e data de nascimento — usados para requalificar a sessão
  quando o substituto entra), com janela de vigência e revogação registrada na trilha.
- Um substituto ativo por supervisor; a vigência eleva o cargo efetivo nas verificações de permissão.

## 10. `tecnico_portos.html` — Gestão de Pessoas

- **RF atendidos:** RF 15, RN 15.
- Cadastro de funcionários (dados pessoais, cargo, código individual, documentação interna) e de
  visitantes (nome, documento, motivo, entrada/saída), em entidades separadas.
- **Reemissão de código individual**: invalida o anterior e gera um novo para a mesma matrícula, mostrando
  o novo código **apenas** na tela do operador.

## 11. `relatorios.html` — Relatórios & PDF

- **RF atendidos:** RF 10 (busca), RF 11 (PDF), RF 16 (produtividade), RN 9.
- Busca com **exatamente cinco filtros**: nome do navio, número do contêiner, tipo de carga, período e
  status do fluxo.
- Emissão do **PDF A4** pela Edge Function `relatorio-pdf` (o navegador envia só `carga_id` +
  `codigo_individual`); exportação de histórico auditada como `EXPORTACAO`, restrita à Direção.

## 12. `teste-vibracao.html` — Teste de Vibração

- Página pública de diagnóstico: testa padrões de vibração e o áudio do alerta de emergência no aparelho,
  explica as limitações da Vibration API (iOS/Safari não implementam) e salva a preferência.

## 13. `about.html` — Como funciona o sistema

- Documentação ilustrada autocontida (79 kB) com as **30 capturas** das 13 telas, a matriz de permissões, o
  fluxo operacional e o passo a passo de implantação.
- É **gerada** por `tools/screenshots/gerar-about.js` a partir do manifesto de capturas — não edite à mão,
  regenere. Detalhes em [Documentação ilustrada](/operacao/documentacao-ilustrada).

---

## Matriz de acesso

A tabela completa página × cargo (com ✔) está em
[Cargos e permissões](/dominio/cargos-e-permissoes#3-matriz-real-de-páginas-page_permissions).
