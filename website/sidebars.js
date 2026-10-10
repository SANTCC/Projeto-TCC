/**
 * Barra lateral da documentação do NexusPort.
 * A ordem segue a leitura recomendada: entender o domínio → instalar → arquitetura →
 * design → banco → segurança → operação → referências.
 */
/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  principal: [
    'introducao',
    {
      type: 'category',
      label: 'Primeiros passos',
      link: { type: 'doc', id: 'primeiros-passos/instalacao' },
      items: [
        'primeiros-passos/instalacao',
        'primeiros-passos/configuracao-supabase',
        'primeiros-passos/execucao-local',
        'primeiros-passos/estrutura-do-repositorio',
        'primeiros-passos/contas-de-demonstracao'
      ]
    },
    {
      type: 'category',
      label: 'Domínio e regras',
      link: { type: 'doc', id: 'dominio/visao-geral' },
      items: [
        'dominio/visao-geral',
        'dominio/cargos-e-permissoes',
        'dominio/requisitos-funcionais',
        'dominio/regras-de-negocio',
        'dominio/fluxo-da-carga',
        'dominio/glossario'
      ]
    },
    {
      type: 'category',
      label: 'Arquitetura',
      link: { type: 'doc', id: 'arquitetura/visao-geral' },
      items: [
        'arquitetura/visao-geral',
        'arquitetura/frontend',
        'arquitetura/modulos-javascript',
        'arquitetura/paginas',
        'arquitetura/dados-e-repositorio',
        'arquitetura/supabase',
        'arquitetura/edge-functions',
        'arquitetura/tempo-real-e-presenca',
        {
          type: 'category',
          label: 'Camada WebMCP (agentes de IA)',
          link: { type: 'doc', id: 'arquitetura/webmcp' },
          items: [
            'arquitetura/webmcp',
            'arquitetura/webmcp-ferramentas'
          ]
        }
      ]
    },
    {
      type: 'category',
      label: 'Design System',
      link: { type: 'doc', id: 'design/design-system' },
      items: [
        'design/design-system',
        'design/componentes',
        'design/telas-chave',
        'design/prototipos-theme',
        'design/acessibilidade-e-responsividade'
      ]
    },
    {
      type: 'category',
      label: 'Banco de dados',
      link: { type: 'doc', id: 'banco-de-dados/visao-geral' },
      items: [
        'banco-de-dados/visao-geral',
        'banco-de-dados/tabelas',
        'banco-de-dados/enums-e-tipos',
        'banco-de-dados/rls-e-politicas',
        'banco-de-dados/migracoes',
        'banco-de-dados/seed-demo',
        'banco-de-dados/diagnosticos'
      ]
    },
    {
      type: 'category',
      label: 'Segurança',
      link: { type: 'doc', id: 'seguranca/modelo-de-seguranca' },
      items: [
        'seguranca/modelo-de-seguranca',
        'seguranca/anti-xss',
        'seguranca/sessao-e-cookies'
      ]
    },
    {
      type: 'category',
      label: 'Operação e qualidade',
      link: { type: 'doc', id: 'operacao/build-e-deploy' },
      items: [
        'operacao/build-e-deploy',
        'operacao/testes',
        'operacao/lighthouse',
        'operacao/relatorios-pdf',
        'operacao/qr-code-e-etiquetas',
        'operacao/analytics-e-lgpd',
        'operacao/api-python',
        'operacao/documentacao-ilustrada',
        'operacao/manutencao-e-backlog',
        'galeria'
      ]
    },
    {
      type: 'category',
      label: 'Referência',
      link: { type: 'doc', id: 'referencia/specs' },
      items: [
        'referencia/specs',
        'referencia/backlogs',
        'referencia/tarefas',
        'referencia/configuracoes',
        'referencia/como-documentar',
        'referencia/faq'
      ]
    }
  ]
};

module.exports = sidebars;
