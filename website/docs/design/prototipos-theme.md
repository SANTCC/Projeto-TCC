---
id: prototipos-theme
title: Protótipos visuais (THEME/)
sidebar_label: Protótipos (THEME/)
description: Os 8 protótipos HTML estáticos que definem a identidade visual, o mapeamento pilar → telas → módulos e as regras de uso dessa pasta.
---

# Protótipos visuais (`THEME/`)

`THEME/` guarda **8 protótipos HTML estáticos**, um para o login/T2.1-T2.2 e sete para os **pilares
operacionais**. Eles são a **referência de identidade visual** do projeto — layout, hierarquia, linguagem
de componentes e paleta.

:::danger Regra de uso (de `SPECs/agents.md`)
Os arquivos de `THEME/` são **APENAS** uma base visual de referência. **Não** copie o código deles
literalmente como arquitetura do sistema: são protótipos estáticos com Tailwind via CDN, sem persistência,
sem RBAC real e com dados de exemplo. Use-os para entender identidade, layout e componentes, e replique
isso no sistema real (`js/` + `*.html`).
:::

---

## 1. Os 8 protótipos

| Pasta | Tema | Pilar |
| --- | --- | --- |
| `login_autentica_o_operacional_t2.1_t2.2` | Login e autenticação operacional (T2.1–T2.2) | acesso |
| `pilar_1_acesso_identidade_camadas_de_vis_o_sidebar_retr_til` | Acesso, identidade e camadas de visão com sidebar retrátil | 1 |
| `pilar_2_agendamento_gate_in_rastreabilidade_qr_code` | Agendamento, *gate-in* e rastreabilidade por QR Code | 2 |
| `pilar_3_inspe_o_t_cnica_formal_valida_o_de_conformidade` | Inspeção técnica formal e validação de conformidade | 3 |
| `pilar_4_p_tio_vincula_o_operacional_estado_das_embarca_es` | Pátio, vinculação operacional e estado das embarcações | 4 |
| `pilar_5_despacho_cr_tico_regula_o_de_sa_da_pelo_supervisor` | Despacho crítico e regulação de saída pelo Supervisor | 5 |
| `pilar_6_painel_de_comando_governan_a_auditoria_imut_vel` | Painel de comando, governança e auditoria imutável | 6 |
| `pilar_7_opera_o_de_p_tio_em_campo_leitura_mobile` | Operação de pátio em campo (leitura mobile) | 7 |

Cada pasta contém um único `code.html` autocontido (de 293 a 929 linhas) que carrega Tailwind, fontes
(Inter, Montserrat, JetBrains Mono) e Lucide por CDN.

---

## 2. O que é comum a todos os protótipos

```javascript
// tailwind.config inline, igual em todos os 8 arquivos
tailwind.config = {
  theme: { extend: {
    colors: {
      nexus: { 900:'#1E293B', 800:'#2A3B53', 500:'#445987', 400:'#5C74A8',
               100:'#E8EDF5', 50:'#F5F7FA', border:'#E1E5ED' },
      status: { success:'#2E7D32', warning:'#D97706', danger:'#C62828' }
    },
    fontFamily: { sans:['Inter','sans-serif'], display:['Montserrat','sans-serif'], mono:['JetBrains Mono','monospace'] }
  } }
};
```

- **Sidebar retrátil** de 256 px → 72 px (`w-64` → `sidebar-collapsed`), com transição
  `width .25s cubic-bezier(.4,0,.2,1)`, logo “NexusPort” + subtítulo mono `TERMINAL STS-01`;
- **Navegação dos 7 pilares** com ícones Lucide coloridos (`shield-check`, `qr-code`, `clipboard-check`,
  `container`, `ship`, `layout-dashboard`, `smartphone`);
- **Rodapé da sidebar** com o usuário autenticado (avatar de iniciais, nome, `CARGO #CÓDIGO` em mono);
- Conteúdo sobre `#F5F7FA`, cards brancos com borda `#E1E5ED` e radius 12 px.

---

## 3. Mapeamento pilar → telas → módulos → tabelas → requisitos

| Pilar | Telas do sistema | Módulos | Tabelas | RF/RN |
| --- | --- | --- | --- | --- |
| **P1 — Acesso & RBAC** | `index.html`, `confirm-role.html`, `dashboard.html` | `auth-guard.js`, `session-cookies.js`, `vision-layer.js`, `pages/login.js`, `pages/confirm-role.js` | `funcionarios`, `cargo_niveis`, `log_acessos_usuarios` | RF 1, RN 15, RN 19 |
| **P2 — Agendamento & QR** | `cargas.html`, `scanner.html` | `pages/cargas.js`, `pages/scanner.js` | `cargas`, `agendamentos`, `tipos_carga`, `leituras_qr_code`, `checklist_modelos` | RF 6.1, RF 17, RN 17, RN 18 |
| **P3 — Inspeção formal** | `inspecao.html` | `pages/inspecao.js`, `webmcp-inspecao.js` | `inspecoes`, `inspecao_itens`, `checklist_itens` | RF 9, RN 14, RF 6.2 |
| **P4 — Pátio & vinculação** | `embarcacoes.html`, `cargas.html` | `pages/embarcacoes.js`, `pages/cargas.js` | `containers`, `navios`, `bercos`, `rotas_maritimas`, `estivador_cargas` | RF 2, RF 3, RF 8, RN 1, RN 4–7, RN 12 |
| **P5 — Despacho do Supervisor** | `manutencao.html`, `delegacao.html`, `cargas.html` | `pages/manutencao.js`, `pages/delegacao.js`, Edge `despacho-embarcacao` | `trail_decisoes`, `retificacoes_trail`, `delegacoes_supervisor`, `manutencoes`, `historico_manutencoes` | RF 3, RF 13, RF 14, RN 3, RN 9, RN 16 |
| **P6 — Painel & auditoria** | `dashboard.html`, `relatorios.html` | `pages/dashboard.js`, `pages/charts.js`, `pages/relatorios.js`, Edge `kpis-calculo` | `logs_alteracoes`, `trail_decisoes`, `emergencias` | RF 7, RF 11, RF 12, RF 16 |
| **P7 — Operação em campo** | `scanner.html`, `teste-vibracao.html` | `pages/scanner.js`, `haptics.js`, `webmcp-scanner.js`, `webmcp-vibracao.js` | `leituras_qr_code`, `estivador_cargas` | RF 17.3, RF 17.4, não-requisito 17 |

---

## 4. O que os protótipos definem (e o sistema herdou)

| Elemento | Valor no protótipo | Onde está no sistema |
| --- | --- | --- |
| Paleta `nexus`/`status` | `#1E293B`, `#445987`, `#E1E5ED`, `#F5F7FA`, `#2E7D32`, `#D97706`, `#C62828` | `tailwind.config` inline em cada página; tokens em `custom.css` deste site |
| Sidebar escura + topbar clara | `bg-[#1E293B]` + `bg-white` | `js/layout.js` |
| Item de menu ativo | fundo `#445987`, texto branco | `js/layout.js` |
| Badges de status | cor @ 12% de fundo, texto sólido | `cargas.html`, `dashboard.html` |
| Alvos de toque | botões `h-11` (44 px) | todas as telas operacionais |
| Drawer no celular | `fixed` + overlay | `js/layout.js` |
| Ícones Lucide | `data-lucide="…"` | todas as páginas |

---

## 5. Como usar os protótipos

```bash
# abrir um protótipo (não precisa de servidor, mas há CDN externo)
xdg-open "THEME/pilar_1_acesso_identidade_camadas_de_vis_o_sidebar_retr_til/code.html"
```

- Para **comparar** com a tela real, use a [Galeria](/galeria): as capturas são do sistema implementado;
- Para **propor** uma mudança visual, altere primeiro o protótipo e só depois o sistema — é o caminho que o
  projeto seguiu entre a especificação e a implementação;
- Nunca importe CSS/JS dos protótipos para o sistema: replique os tokens.

:::note Por que as pastas têm nomes "quebrados"
Os nomes vêm da geração automática dos protótipos (acentos e símbolos foram sanitizados:
`inspe_o_t_cnica`, `embarca_es`). Eles são mantidos como estão para preservar a rastreabilidade com o
material original.
:::
