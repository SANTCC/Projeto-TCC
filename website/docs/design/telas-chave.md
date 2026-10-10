---
id: telas-chave
title: Telas-chave
sidebar_label: Telas-chave
description: Login, ficha da carga, checklist, liberação, pesquisa, PDF A4 e leitura de QR — o desenho de cada tela crítica da Spec.
---

# Telas-chave

Especificação de `SPECs/design/design.md`, seção 8, com as capturas reais de cada tela (abertas pelas
contas de demonstração) e o arquivo que implementa.

---

## Login

| Item | Especificação |
| --- | --- |
| Fundo | `#1E293B` com logotipo centralizado |
| Card | branco, radius 16px |
| Campo | **Código individual** (monoespaçado) |
| Após validação | campo **Cargo** desabilitado, apenas para confirmação (RF 1 — não é selecionável) |
| Botão | primário "Entrar" |
| Erro | mensagem **genérica** de credenciais inválidas |

<figure className="nexus-figura">
  <img src="/img/capturas/publico-login.png" alt="Tela de login do NexusPort com o campo de código individual" loading="lazy" />
  <figcaption>Tela de autenticação — <code>index.html</code>. Estados de reemissão e código reconhecido também foram capturados.</figcaption>
</figure>

Arquivos: `index.html`, `js/pages/login.js`. Capturas: `publico-login.png`,
`publico-login-reemissao.png`, `publico-login-reconhecida.png`.

---

## Confirmação de cargo

Mostra cargo, nível de acesso e camada de visão; o campo é **somente leitura**. É a última etapa antes de
a sessão existir.

<figure className="nexus-figura">
  <img src="/img/capturas/MAT-2011-confirmacao-cargo.png" alt="Tela de confirmação de cargo exibindo o cargo vindo do cadastro funcional" loading="lazy" />
  <figcaption>Confirmação de cargo com a conta MAT-2011. O cargo vem do cadastro, não do usuário.</figcaption>
</figure>

---

## Painel de comando (dashboard)

- Cards de KPI no padrão do Design System (ícone em círculo de 48px, valor Montserrat 700 32px);
- Gráficos recortados pela **camada de visão** do cargo, com atualização a cada 60 s;
- Seções de auditoria e trilha de decisões.

<figure className="nexus-figura">
  <img src="/img/capturas/mat-0000-dashboard.png" alt="Painel de comando com indicadores e gráficos da Visão Estratégica" loading="lazy" />
  <figcaption>Painel com a conta MAT-0000 (Diretor-Presidente/Superintendente) — Visão Estratégica.</figcaption>
</figure>

---

## Ficha da carga

Cabeçalho com **nº da carga** (monoespaçado), **badge de status** e as ações permitidas ao cargo. Corpo em
cinco abas: **Dados · Vínculos · Inspeção · Histórico · Relatório**.

<figure className="nexus-figura">
  <img src="/img/capturas/mat-0000-cargas.png" alt="Tela de cargas e operações de pátio, com lista, filtros e ações" loading="lazy" />
  <figcaption>Cargas &amp; Operações de Pátio — <code>cargas.html</code>. A lista é recortada pela camada de visão do cargo.</figcaption>
</figure>

---

## Checklist de inspeção (RF 9)

- Abre automaticamente ao escanear o QR da carga (RF 17.3);
- Itens agrupados; cada item: descrição + `Conforme` / `Não conforme` / `Não se aplica` + observação;
- **Itens críticos** com selo "Crítico" (danger) — bloqueiam a aprovação enquanto não conformes (RN 14);
- Barra de progresso com o percentual de itens respondidos;
- Rodapé fixo: **Aprovar carga** (primário, habilitado só sem críticos pendentes) e **Recusar carga**
  (perigo, com modal e motivo obrigatório em texto livre).

<figure className="nexus-figura">
  <img src="/img/capturas/mat-2011-inspecao-checklist-carregado.png" alt="Checklist de inspeção carregado, com itens críticos e progresso" loading="lazy" />
  <figcaption>Checklist técnico carregado, com a conta MAT-2011 (Visão Operacional).</figcaption>
</figure>

---

## Liberação pelo Supervisor

- Tela de fila **"Aguardando liberação"** (cargas `PRONTA_PARA_ENTREGA` + navios com cargas vinculadas);
- Cada linha **expande** para mostrar as cargas/contêineres afetados;
- Liberar navio exige modal informando que a ação libera **todos** os contêineres e cargas vinculados
  (RN 3) e é **bloqueada** se não houver rota cadastrada para origem/destino (RN 9).

<figure className="nexus-figura">
  <img src="/img/capturas/mat-2011-embarcacoes.png" alt="Painel de embarcações com berços e ações de liberação" loading="lazy" />
  <figcaption>Embarcações &amp; GPS: berços, estados, rota e o caminho da liberação.</figcaption>
</figure>

---

## Pesquisa (RF 10)

Barra de filtros única com **exatamente** cinco campos: nome do navio, nº do contêiner, tipo de carga,
período (data inicial–final) e status do fluxo. **Sem filtros avançados extras** (não-requisito 14).
Resultados em tabela com badge de status.

<figure className="nexus-figura">
  <img src="/img/capturas/mat-0000-relatorios.png" alt="Tela de relatórios com os cinco filtros de busca" loading="lazy" />
  <figcaption>Relatórios &amp; PDF — busca operacional e emissão do relatório A4.</figcaption>
</figure>

---

## Relatório PDF A4 (RF 11)

| Item | Especificação |
| --- | --- |
| Papel | A4, margens de 20 mm, fontes Montserrat/Inter embutidas |
| Cabeçalho | logotipo + "NexusPort — Relatório de Carga" + nº da carga |
| Rodapé | código individual de quem gerou + data/hora de geração + paginação |
| Seções (sequenciais) | 1) Dados da Carga · 2) Dados do Navio (nome, IMO, origem, destino) · 3) Dados do Contêiner · 4) Resumo do Fluxo (status, datas, porto de descarga, motivo de recusa) |
| Estilo | títulos Montserrat 700 numerados com linha `#E1E5ED`; dados em tabela Inter 400/500; selo de status colorido **apenas** na seção 4 |

A geração acontece no **servidor** (Edge Function `relatorio-pdf`) com cache por SHA-256 — ver
[Relatórios em PDF](/operacao/relatorios-pdf).

---

## Etiqueta de QR Code (RF 17)

| Item | Especificação |
| --- | --- |
| Tela | após o cadastro de carga/contêiner, o QR é exibido em tempo real com o botão **Imprimir Etiqueta**; a reimpressão fica disponível na ficha e registra "Reimpressão de etiqueta" (RN 18) |
| Etiqueta | 10×10 cm (ou 10×15): QR centralizado, **sempre monocromático**, para impressora térmica |
| Texto | nº da carga/contêiner em Inter 700 28–32px; opcionalmente tipo de carga + data de recebimento em Inter 500 12px |
| Segurança | a leitura exige **sessão autenticada** (RN 19); cada scan é registrado com cargo + código + data/hora |

---

## Leitura de QR no pátio

Na área logada existe o botão flutuante **"Escanear"** (abre a câmera pelo navegador). Ao ler, o sistema
abre **direto a ficha da entidade** com as ações do cargo em destaque:

| Cargo | O que a leitura abre |
| --- | --- |
| Estivador | registro de início/fim da movimentação |
| Conferente | registro de recebimento físico ou condições de saída |
| Inspetor | checklist de inspeção do tipo de carga |
| Arrumador e Consertador | alteração para "pronta para entrega" |
| Supervisor | status de todas as cargas vinculadas ao contêiner |

<figure className="nexus-figura">
  <img src="/img/capturas/mat-9999-scanner.png" alt="Tela do scanner de QR Code com leitura por câmera e entrada manual" loading="lazy" />
  <figcaption>Scanner QR Code — câmera do dispositivo ou digitação do código.</figcaption>
</figure>

---

## Outras telas especificadas

| Tela | O que define | Captura |
| --- | --- | --- |
| **Manutenção & OS** | ciclo `SOLICITADA → APROVADA/RECUSADA → CONCLUIDA`, histórico de serviços e card de preventiva | `mat-2011-manutencao.png` |
| **Delegação** | designação com vigência, requalificação do cargo do substituto e revogação | `mat-0000-delegacao.png` |
| **Gestão de Pessoas** | funcionários, visitantes, documentos e reemissão de credencial (RN 15) | `mat-9999-tecnico_portos.png` |
| **Tema escuro** | fundo `#0F172A`, superfícies `#1E293B`, primário `#5B70A3` | `mat-0000-dashboard-tema-escuro.png` |

A galeria completa, com as 30 capturas por conta e por tela, está em [Galeria](/galeria).
