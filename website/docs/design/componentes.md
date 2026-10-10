---
id: componentes
title: Componentes
sidebar_label: Componentes
description: Botões, formulários, cards, tabelas, badges, mensagens inline, modais, timeline e empty states com as especificações do Design System.
---

# Componentes

Especificação de `SPECs/design/design.md`, seções 6 a 8, com a correspondência no código.

---

## Botões

| Variante | Fundo | Borda | Texto | Uso |
| --- | --- | --- | --- | --- |
| **Primário** | `#445987` | — | `#FFFFFF` | ação principal da tela |
| **Secundário** | `#FFFFFF` | 1px `#E1E5ED` | `#1E293B` | ações alternativas |
| **Fantasma** | transparente | — | `#445987` | ações terciárias |
| **Perigo** | `#C62828` | — | `#FFFFFF` | cancelar entrega, recusar — **sempre com modal de confirmação** |
| **Desabilitado** | `#F5F7FA` | 1px `#E1E5ED` | `#445987` @ 50% | não interativo |

`radius: 8px` · padding `10px 20px` · Inter 600 14–16px · **altura mínima 44 px** (toque no pátio).

<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-card" style={{display:'flex', gap:'.5rem', flexWrap:'wrap'}}>
    <span className="nexus-botao nexus-botao--primario" style={{background:'#445987',color:'#fff'}}>Primário</span>
    <span className="nexus-botao nexus-botao--secundario" style={{border:'1px solid #E1E5ED', color:'#1E293B'}}>Secundário</span>
  </div>
  <div className="nexus-card" style={{display:'flex', gap:'.5rem', flexWrap:'wrap'}}>
    <span className="nexus-botao" style={{color:'#445987'}}>Fantasma</span>
    <span className="nexus-botao" style={{background:'#C62828',color:'#fff'}}>Perigo</span>
  </div>
  <div className="nexus-card">
    <span className="nexus-botao" style={{background:'#F5F7FA',border:'1px solid #E1E5ED',color:'rgba(68,89,135,.5)'}}>Desabilitado</span>
  </div>
</div>

No código, os botões usam as classes Tailwind com os tokens inline (`bg-[#445987]`, `h-11` para 44 px) e a
renderização é condicionada pelo cargo:

```javascript
if (NexusAuth.hasPermission('LIBERAR_CARGA')) botaoLiberar.classList.remove('hidden');
```

---

## Formulários

| Elemento | Especificação |
| --- | --- |
| **Input** | fundo `#FFFFFF`, borda `#E1E5ED`, radius 8px; foco com borda `#445987` + anel 2px @ 20% |
| **Erro** | borda `#C62828` e mensagem Inter 12px na mesma cor |
| **Label** | Inter 500 14px `#222222` |
| **Placeholder** | `#1E293B` @ 55% |
| **Data/hora** | picker nativo + máscara `dd/mm/aaaa hh:mm` (RF 5) |
| **Obrigatórios** | marcados com `*` — peso, volume, valor declarado, natureza, tipo, porto de descarga (RN 13) |

Validações específicas do projeto:

- **CPF** (delegação e cadastro de funcionário): validação de dígitos verificadores —
  `npm run test:funcionario-cpf`;
- **IMO**: padrão de 7 dígitos, unicidade verificada antes de gravar (`IMO_DUPLICADO`);
- **GPS**: faixa válida de latitude/longitude antes de aceitar coordenadas;
- **Datas**: o navegador descarta datas inválidas em silêncio, então o valor gravado é **conferido** depois
  de atribuído (é o mesmo cuidado que as ferramentas WebMCP tomam).

---

## Cards

Fundo `#FFFFFF`, borda 1px `#E1E5ED`, radius 12px, sombra opcional `0 1px 3px rgba(30,41,59,.08)`, título
Montserrat 600 18px `#1E293B`.

**Card de dashboard:** ícone 24px dentro de um círculo de 48px (fundo = cor semântica @ 12%), título
Inter 500 14px e **valor principal Montserrat 700 32px**. O card inteiro é clicável e leva à página de
detalhe.

<div className="nexus-grid nexus-grid--tres">
  <div className="nexus-kpi"><span className="nexus-kpi__rotulo">Navios em manutenção</span><span className="nexus-kpi__valor">3</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__rotulo">Cargas em armazenagem</span><span className="nexus-kpi__valor">128</span></div>
  <div className="nexus-kpi"><span className="nexus-kpi__rotulo">Aguardando liberação</span><span className="nexus-kpi__valor">12</span></div>
</div>

- **Tom neutro e informativo** — os cards **não** são alarmes: a cor base é azul/info; cores semânticas
  aparecem apenas quando o indicador já é, por natureza, um status (ex.: cargas recusadas em `danger`);
- Cards da Spec: navios em manutenção · navios fora do porto · cargas em armazenagem · cargas prontas para
  entrega aguardando liberação · cargas recusadas · ocupação do pátio · navios com preventiva sugerida
  (> 3 anos);
- Atualização diária ou horária, **nunca** em tempo real;
- **Diretor:** além dos cards, seção de gráficos — barras em `#445987`, linhas em `#1E293B`, grade
  `#E1E5ED`.

---

## Tabelas

| Item | Especificação |
| --- | --- |
| Cabeçalho | fundo `#F5F7FA`, Inter 600 13px `#1E293B` |
| Linhas | separadores 1px `#E1E5ED` |
| Hover | `#1E293B` @ 5% |
| Linha selecionada | `#445987` @ 10% |
| Coluna mono | código individual, IMO e nº de contêiner em fonte monoespaçada |
| Paginação e busca | sempre visíveis quando houver mais de 10 registros |

No celular (< 768 px) as tabelas viram **cards empilhados**.

---

## Badges

Ver [Design System → badges de status](/design/design-system#4-badges-de-status) para a lista completa com
cores e regras. Pontos de atenção:

- Texto em caixa normal (não uppercase);
- Não usar âmbar com texto branco (contraste 3,31:1);
- Vínculos carga → contêiner → navio **não** geram badge: são uma linha de encadeamento na ficha.

---

## Mensagens de feedback

Como o sistema **não** tem notificações (não-requisito 5), todo retorno é um **banner inline** no topo do
conteúdo:

- Fundo = cor semântica @ 8%, borda esquerda de 3 px, texto `#222222`, título Montserrat 600;
- Fechável e desaparece ao trocar de tela;
- **Nunca** toast flutuante persistente.

```javascript
window.mostrarFeedback('sucesso', 'Recebimento registrado',
  'Carga NX-2026-0042 recebida em 07/10/2026 14:35.');
// tipos: 'sucesso' | 'erro' | 'aviso' | 'info'
```

---

## Modal de confirmação

Obrigatório para: **liberação de navio**, **cancelamento de entrega**, **aprovação/recusa de manutenção**,
**recusa de carga** e **designação de substituto**.

Estrutura: título Montserrat 700 → resumo do impacto (ex.: *"Esta ação libera automaticamente 12 cargas
vinculadas"*, RN 3) → campo de **motivo** quando a Spec exige → botões `Confirmar` (primário/perigo) e
`Voltar` (secundário).

```javascript
const ok = await window.nexusConfirm({
  titulo: 'Liberar navio',
  mensagem: 'Esta ação libera automaticamente 12 cargas vinculadas.',
  motivo: false,                       // true quando o motivo é obrigatório
  confirmar: 'Liberar', variante: 'primario'
});
```

:::warning WebMCP não usa `nexusConfirm`
As ferramentas de agente usam o diálogo próprio (`webmcp-ui.js`), porque o `nexusConfirm` confirma sozinho
em navegador *headless*. O diálogo do agente é **fail-closed**: exige evento real (`isTrusted`), foco
inicial em Cancelar, Esc/fundo cancelam e expira em 60 s.
:::

---

## Timeline (Trail de Decisões)

- Lista vertical com linha `#E1E5ED` e nó circular na cor do cargo ou da decisão;
- Cada entrada: **decisão** (Montserrat 600), **quem** (cargo + código individual, monoespaçado),
  **data/hora** e **entidade afetada**;
- **Retificações** aparecem anexadas abaixo do registro original, que **nunca** é editado;
- Registros são visualmente marcados como imutáveis (sem hover de edição).

<ul className="nexus-timeline">
  <li><strong>Liberou Navio</strong> — Supervisor / Gerente de Operações <span className="nexus-mono">#OP-8821</span> · 07/10/2026 14:35 · <span className="nexus-mono">IMO9990001</span></li>
  <li><strong>Aprovou Carga</strong> — Inspetor <span className="nexus-mono">#IN-4410</span> · 07/10/2026 13:02 · <span className="nexus-mono">NX-2026-0042</span></li>
  <li><strong>Designou Substituto</strong> — Supervisor / Gerente de Operações <span className="nexus-mono">#OP-8821</span> · 07/10/2026 08:10 <br /><span className="nexus-badge nexus-badge--info">retificação anexada em 07/10/2026 09:00</span></li>
</ul>

---

## Empty states e carregamento

| Situação | Comportamento |
| --- | --- |
| **Sem dados** | ilustração neutra em `#E1E5ED`, título Montserrat 600 16px e uma **ação sugerida** (ex.: "Nenhuma carga agendada — Agendar carga") |
| **Carregando** | *skeletons* em `#E1E5ED` sobre `#FFFFFF` |
| **Erro de banco** | mensagem inline com a causa provável e a migração que resolve (ex.: `PGRST205`) |
| **Sem Supabase** | telas navegáveis; indicadores mostram `—` em vez de valores fictícios |

---

## Ficha da carga (composição)

Cabeçalho: **nº da carga** (monoespaçado) + **badge de status** + ações permitidas ao cargo atual.

Corpo em abas:

| Aba | Conteúdo |
| --- | --- |
| **Dados** | tipo, quantidade, peso, volume, valor declarado, natureza, porto de descarga |
| **Vínculos** | contêiner → navio, como linha de encadeamento (sem badge, RN 15) |
| **Inspeção** | checklist + decisão |
| **Histórico** | log de alterações + trail filtrado desta carga |
| **Relatório** | geração do PDF A4 |

---

## Etiqueta de QR Code (impressa)

| Item | Especificação |
| --- | --- |
| Dimensão | 10×10 cm ou 10×15 cm |
| QR | centralizado, **monocromático** (módulo preto `#222222` puro sobre branco), pensado para impressora térmica |
| Texto | nº da carga/contêiner em Inter 700 28–32px |
| Opcional | tipo de carga + data de recebimento em Inter 500 12px |

Detalhes de geração, reimpressão e leitura em [QR Code e etiquetas](/operacao/qr-code-e-etiquetas).
