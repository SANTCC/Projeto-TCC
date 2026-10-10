import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

/**
 * Home da documentação do NexusPort.
 * ----------------------------------------------------------------------------
 * A paleta, a tipografia e os componentes seguem SPECs/design/design.md (v2.0) e os
 * protótipos de THEME/ — herdando do app: sidebar/topbar em #1E293B, ação primária
 * #445987, superfícies #FFFFFF/#F5F7FA, bordas #E1E5ED e status #2E7D32/#D97706/#C62828.
 */

const CARTOES = [
  {
    titulo: 'Primeiros passos',
    texto: 'Clonar, configurar o Supabase, subir o servidor local e entrar com as contas de demonstração.',
    to: '/primeiros-passos/instalacao',
    meta: 'instalação · configuração'
  },
  {
    titulo: 'Domínio e regras',
    texto: 'Os 18 requisitos funcionais, as 19 regras de negócio, os 10 cargos e as três camadas de visão.',
    to: '/dominio/visao-geral',
    meta: 'RF 1–18 · RN 1–19'
  },
  {
    titulo: 'Arquitetura',
    texto: 'Front-end HTML + Tailwind + JS vanilla com 41 módulos, repositório de dados, Edge Functions e WebMCP.',
    to: '/arquitetura/visao-geral',
    meta: 'front-end · supabase · webmcp'
  },
  {
    titulo: 'Design System',
    texto: 'Tokens de cor, tipografia, componentes, badges de status, telas-chave e responsividade de pátio.',
    to: '/design/design-system',
    meta: 'tokens · componentes'
  },
  {
    titulo: 'Banco de dados',
    texto: '25 tabelas, 14 enums, políticas RLS, gatilhos de propagação em cascata e 10 scripts de migração.',
    to: '/banco-de-dados/visao-geral',
    meta: 'postgresql · rls'
  },
  {
    titulo: 'Segurança',
    texto: 'Modelo de ameaças, codificação de saída (anti-XSS), política de sessão em cookies e matriz RBAC.',
    to: '/seguranca/modelo-de-seguranca',
    meta: 'rbac · anti-xss'
  },
  {
    titulo: 'Operação e qualidade',
    texto: 'Build minificado, deploy no GitHub Pages/Vercel, 47 testes Node + 15 verificadores Python, gate Lighthouse e GA4.',
    to: '/operacao/build-e-deploy',
    meta: 'build · testes · deploy'
  },
  {
    titulo: 'Galeria de telas',
    texto: 'As 30 capturas reais das 13 telas, abertas pelas três contas de demonstração.',
    to: '/galeria',
    meta: '13 telas · 30 capturas'
  }
];

const PILARES = [
  { nome: 'Pilar 1 — Acesso & RBAC', desc: 'Login por código individual, confirmação de cargo e três camadas de visão.', arquivo: 'THEME/pilar_1_acesso_identidade_camadas_de_vis_o_sidebar_retr_til' },
  { nome: 'Pilar 2 — Agendamento & QR', desc: 'Gate-in com agendamento prévio obrigatório e rastreabilidade por QR Code.', arquivo: 'THEME/pilar_2_agendamento_gate_in_rastreabilidade_qr_code' },
  { nome: 'Pilar 3 — Inspeção formal', desc: 'Checklist por tipo de carga, itens críticos e decisão auditável.', arquivo: 'THEME/pilar_3_inspe_o_t_cnica_formal_valida_o_de_conformidade' },
  { nome: 'Pilar 4 — Pátio & vinculação', desc: 'Carga → contêiner → navio, berços do terminal e estado das embarcações.', arquivo: 'THEME/pilar_4_p_tio_vincula_o_operacional_estado_das_embarca_es' },
  { nome: 'Pilar 5 — Despacho do supervisor', desc: 'Liberação de navios e cargas, cancelamentos e delegação de substituto.', arquivo: 'THEME/pilar_5_despacho_cr_tico_regula_o_de_sa_da_pelo_supervisor' },
  { nome: 'Pilar 6 — Painel & auditoria', desc: 'KPIs por camada de visão, gráficos e trail de decisões imutável.', arquivo: 'THEME/pilar_6_painel_de_comando_governan_a_auditoria_imut_vel' },
  { nome: 'Pilar 7 — Operação em campo', desc: 'Leitura mobile no pátio, alvos de toque de 44 px e leitura por câmera.', arquivo: 'THEME/pilar_7_opera_o_de_p_tio_em_campo_leitura_mobile' }
];

const FICHA_TECNICA = [
  ['Terminal', 'STS-01 · Porto de Santos'],
  ['Front-end', 'HTML5 · Tailwind CSS (CDN) · JS vanilla'],
  ['Back-end', 'Supabase (PostgreSQL + RLS + Realtime)'],
  ['Servidor', '6 Edge Functions (Deno)'],
  ['Agentes de IA', 'WebMCP — 72 ferramentas'],
  ['Banco', '25 tabelas · 14 enums · 10 migrações'],
  ['Qualidade', '47 testes Node · gate Lighthouse'],
  ['Publicação', 'GitHub Pages · Vercel (dist/)']
];

export default function Home() {
  const logo = useBaseUrl('/img/logo_porto.png');
  return (
    <Layout
      title="Documentação técnica do NexusPort"
      description="Documentação completa do NexusPort: arquitetura, domínio portuário, design system, banco de dados, segurança, WebMCP, testes e implantação."
    >
      <header className="nexus-hero">
        <div className="nexus-hero__inner">
          <div>
            <div className="nexus-hero__marca">
              <img src={logo} alt="Logotipo do NexusPort" className="nexus-hero__logo" width="54" height="54" />
              <div>
                <div style={{ fontFamily: 'var(--nexus-font-titulos)', fontWeight: 700, fontSize: '1.15rem' }}>
                  NexusPort
                </div>
                <div className="nexus-tag-terminal" style={{ color: 'rgba(255,255,255,.6)' }}>
                  Terminal STS-01 · Porto de Santos
                </div>
              </div>
            </div>
            <h1 className="nexus-hero__titulo">
              Documentação técnica <span>de ponta a ponta</span>
            </h1>
            <p className="nexus-hero__texto">
              Tudo o que existe no NexusPort — sistema de gestão operacional portuária para automação de
              carregamentos: domínio e regras de negócio, arquitetura do front-end e do Supabase, design
              system, banco de dados com RLS, camada de agentes (WebMCP), segurança, testes automatizados,
              build de produção e implantação.
            </p>
            <div className="nexus-hero__acoes">
              <Link className="nexus-botao nexus-botao--primario" to="/introducao">
                Começar pela introdução
              </Link>
              <Link className="nexus-botao nexus-botao--secundario" to="/primeiros-passos/instalacao">
                Rodar localmente
              </Link>
              <Link className="nexus-botao nexus-botao--secundario" to="/design/design-system">
                Design System
              </Link>
            </div>
          </div>
          <aside className="nexus-hero__painel" aria-label="Ficha técnica do sistema">
            <h3>Ficha técnica</h3>
            <dl>
              {FICHA_TECNICA.map(([chave, valor]) => (
                <div key={chave} style={{ display: 'contents' }}>
                  <dt>{chave}</dt>
                  <dd>{valor}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </header>

      <main>
        <section className="nexus-secao">
          <div className="nexus-secao__inner">
            <h2 className="nexus-secao__titulo">Por onde começar</h2>
            <p className="nexus-secao__texto">
              A documentação está organizada na mesma ordem das fontes de verdade do repositório
              (<code>SPECs/Spec.md</code> → <code>SPECs/tasks.md</code> → <code>SPECs/schema.sql</code> →{' '}
              <code>SPECs/design/design.md</code>). Cada página cita o arquivo do projeto que detalha.
            </p>
            <div className="nexus-grid">
              {CARTOES.map((c) => (
                <Link className="nexus-card" to={c.to} key={c.titulo}>
                  <span className="nexus-card__titulo">{c.titulo}</span>
                  <span className="nexus-card__texto">{c.texto}</span>
                  <span className="nexus-card__meta">{c.meta}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="nexus-secao nexus-secao--alt">
          <div className="nexus-secao__inner">
            <h2 className="nexus-secao__titulo">Os 7 pilares operacionais</h2>
            <p className="nexus-secao__texto">
              Os protótipos visuais de <code>THEME/</code> definem a identidade de cada pilar. A implementação
              final vive em <code>js/</code> e nas páginas HTML; os protótipos são referência de layout,
              nunca de arquitetura.
            </p>
            <div className="nexus-grid nexus-grid--tres">
              {PILARES.map((p) => (
                <div className="nexus-card" key={p.nome}>
                  <span className="nexus-card__titulo">{p.nome}</span>
                  <span className="nexus-card__texto">{p.desc}</span>
                  <span className="nexus-card__meta">{p.arquivo.split('/').slice(-1)[0].slice(0, 28)}</span>
                </div>
              ))}
            </div>
            <p>
              <Link to="/design/prototipos-theme">Ver o mapeamento pilar → telas → módulos → tabelas → RF/RN →</Link>
            </p>
          </div>
        </section>
      </main>
    </Layout>
  );
}
