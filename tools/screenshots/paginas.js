/**
 * CATÁLOGO DE TELAS CAPTURADAS — NexusPort.
 *
 * Fonte única de metadados das páginas usadas pelo script de capturas
 * (tools/screenshots/capturar.js) e pelo gerador do about.html
 * (tools/screenshots/gerar-about.js): título, finalidade, papéis com acesso e
 * apontamentos de tela.
 *
 * A lista de papéis repete a matriz `PAGE_PERMISSIONS` de js/auth-guard.js
 * (Spec.md RF 1). Se a matriz mudar, este arquivo precisa acompanhar.
 */
'use strict';

const TODOS_OPERACIONAIS = [
  'ESTIVADOR', 'CONFERENTE_CARGA', 'ARRUMADOR_CONSERTADOR', 'PLANEJADOR_PATIO_NAVIOS',
  'TECNICO_PORTOS', 'SUPERVISOR_GERENTE_OPERACOES', 'INSPETOR',
  'DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'
];

const DIRETORIA = ['DIRETOR_OPERACOES_LOGISTICA', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'CONSELHO_ADMINISTRACAO'];
const GESTAO = ['SUPERVISOR_GERENTE_OPERACOES', ...DIRETORIA];

/**
 * Ordem de captura e de exibição. `chave` virou o nome do arquivo de imagem.
 * `publica` → capturada uma única vez, sem sessão.
 * `sempre`  → capturada para todas as contas com acesso (o próprio dashboard).
 */
const PAGINAS = [
  {
    chave: 'login',
    arquivo: 'index.html',
    titulo: 'Autenticação de Funcionário',
    subtitulo: 'Código individual único (matrícula)',
    publica: true,
    resumo: 'Porta de entrada do sistema. O operador informa o código individual vinculado à matrícula; o sistema valida no cadastro do terminal e encaminha para a confirmação de cargo.',
    destaques: [
      'Validação por código individual ou matrícula (nexus_code_overrides cobre códigos reemitidos).',
      'Contingência RN 15: pedido de reemissão de credencial com o procedimento presencial na Guarita Central.',
      'Tema claro/escuro e feedback inline (credencial reconhecida, código invalidado, credencial inexistente).'
    ],
    cargos: TODOS_OPERACIONAIS
  },
  {
    chave: 'confirmacao-cargo',
    arquivo: 'confirm-role.html',
    titulo: 'Confirmação de Cargo',
    subtitulo: 'Etapa obrigatória antes do painel',
    publica: false,
    sempre: true,
    resumo: 'Mostra o cargo, o nível de acesso e a camada de visão que a sessão receberá. O cargo não é editável: vem do cadastro funcional, conforme o RF 1.',
    destaques: [
      'Sessão gravada em cookie de 12 h (turno operacional) somente após a confirmação.',
      'Metadados por cargo definem a camada de visão: Própria, Operacional ou Estratégica.',
      'Tentativa de troca manual de cargo é bloqueada pela guarda de autenticação.'
    ],
    cargos: TODOS_OPERACIONAIS
  },
  {
    chave: 'dashboard',
    arquivo: 'dashboard.html',
    titulo: 'Painel de Comando',
    subtitulo: 'KPIs, gráficos por camada de visão e trilha de decisões',
    publica: false,
    sempre: true,
    resumo: 'Visão geral do terminal: indicadores, gráficos recortados pela camada de visão do cargo, atividade recente da auditoria e trilha imutável de decisões.',
    destaques: [
      'Indicadores calculados a partir das cargas, contêineres, navios e manutenções reais.',
      'Gráficos (Chart.js) mudam conforme o cargo: própria, operacional ou estratégica.',
      'Valor declarado é restrito à Visão Estratégica; dados pessoais não aparecem para cargos táticos.'
    ],
    cargos: TODOS_OPERACIONAIS
  },
  {
    chave: 'cargas',
    arquivo: 'cargas.html',
    titulo: 'Cargas & Operações de Pátio',
    subtitulo: 'Agendamento, recebimento, armazenagem e vínculo com navio/contêiner',
    publica: false,
    resumo: 'Coração do fluxo operacional: cadastro e acompanhamento das cargas nos 9 status, do agendamento à entrega, com checklist de avarias, QR Code e etiqueta A4.',
    destaques: [
      'Esteira de status: AGENDAMENTO → RECEBIMENTO_INSPECAO → ARMAZENAGEM → PRONTA_PARA_ENTREGA → SAIDA → EM_TRANSITO → ENTREGUE (e CANCELADA/RECUSADA).',
      'Vínculo com contêiner, navio e estivador responsável; QR Code gerado em canvas e etiqueta 10×10 cm para impressão.',
      'Busca com filtros combinados e contadores por status.'
    ],
    cargos: TODOS_OPERACIONAIS.filter((c) => c !== 'TECNICO_PORTOS')
  },
  {
    chave: 'inspecao',
    arquivo: 'inspecao.html',
    titulo: 'Inspeção & Checklist',
    subtitulo: 'Conformidade técnica com resultado auditável',
    publica: false,
    resumo: 'Execução do checklist técnico de recebimento: cada item é marcado como conforme ou não conforme e a inspeção é concluída como aprovada ou recusada.',
    destaques: [
      'Checklist por tipo de carga (checklist_modelos/checklist_itens) com itens críticos.',
      'Inspeção ativa única por carga: as anteriores permanecem como histórico.',
      'Leitura do QR Code da carga direto na tela para abrir a inspeção correspondente.'
    ],
    cargos: ['INSPETOR', ...GESTAO]
  },
  {
    chave: 'scanner',
    arquivo: 'scanner.html',
    titulo: 'Scanner QR Code',
    subtitulo: 'Leitura móvel por câmera ou entrada manual',
    publica: false,
    resumo: 'Leitura de etiquetas QR das cargas, contêineres e guindastes. Aceita câmera do dispositivo ou digitação do código, com registro da leitura e histórico.',
    destaques: [
      'Aceita o código impresso (QR-DEMO-CRG-003), o identificador (DEMO-CRG-003) e o QR da etiqueta.',
      'Fallback de digitação manual para ambientes sem câmera.',
      'Cada leitura é registrada em leituras_qr_code para rastreabilidade.'
    ],
    cargos: TODOS_OPERACIONAIS
  },
  {
    chave: 'embarcacoes',
    arquivo: 'embarcacoes.html',
    titulo: 'Embarcações, Contêineres & GPS',
    subtitulo: 'Atracação, berços, rotas e posição dos navios',
    publica: false,
    resumo: 'Gestão das embarcações e do pátio: cadastro de navios e contêineres, estado operacional, berços do terminal, rotas marítimas e posicionamento GPS com ETA.',
    destaques: [
      '15 berços do STS-01 com estado LIVRE / OCUPADO / MANUTENCAO e vínculo com o navio atracado.',
      'Localização (dentro do porto, fora do porto, no porto de destino) atualiza o status das cargas vinculadas por gatilho no banco.',
      'Distância da rota e tempo de trânsito alimentam o cálculo de ETA.'
    ],
    cargos: ['PLANEJADOR_PATIO_NAVIOS', 'INSPETOR', ...GESTAO]
  },
  {
    chave: 'manutencao',
    arquivo: 'manutencao.html',
    titulo: 'Manutenção & Ordens de Serviço',
    subtitulo: 'Abertura, aprovação e conclusão de OS',
    publica: false,
    resumo: 'Ciclo de manutenção de navios, contêineres e guindastes: solicitação, aprovação ou recusa e conclusão, com histórico de serviços e o botão de pânico global no cabeçalho.',
    destaques: [
      'Ordens de serviço por entidade (NAVIO, CONTAINER, GUINDASTE) com trilha de solicitação e aprovação.',
      'Conclusão de OS devolve o equipamento ao estado OPERANTE e grava o histórico.',
      '🚨 Botão de pânico global disponível em todas as telas autenticadas.'
    ],
    cargos: ['INSPETOR', ...GESTAO]
  },
  {
    chave: 'delegacao',
    arquivo: 'delegacao.html',
    titulo: 'Delegação de Supervisor',
    subtitulo: 'Substituto temporário com vigência e revogação',
    publica: false,
    resumo: 'Designa um substituto para o supervisor titular durante uma ausência, com janela de vigência, requalificação do cargo do substituto e revogação registrada na trilha.',
    destaques: [
      'Enquanto a delegação está ativa, o substituto recebe as permissões do cargo de supervisor.',
      'Revogação imediata devolve o acesso original e grava a decisão na trilha imutável.',
      'Exige identificação do substituto (nome, CPF e data de nascimento) para auditoria.'
    ],
    cargos: GESTAO
  },
  {
    chave: 'tecnico_portos',
    arquivo: 'tecnico_portos.html',
    titulo: 'Gestão de Pessoas (Técnico em Portos)',
    subtitulo: 'Funcionários, visitantes, documentos e reemissão de credencial',
    publica: false,
    resumo: 'Cadastro e manutenção do quadro funcional e dos visitantes, emissão de códigos individuais, controle de documentos e reemissão de credenciais (RN 15).',
    destaques: [
      'Cadastro no padrão MAT-4 dígitos com CPF validado e bloqueio de duplicidade.',
      'Registro de entrada e saída de visitantes com motivo da visita.',
      'Reemissão de código invalida o anterior e mantém a mesma matrícula.'
    ],
    cargos: ['TECNICO_PORTOS', ...DIRETORIA]
  },
  {
    chave: 'relatorios',
    arquivo: 'relatorios.html',
    titulo: 'Relatórios & PDF',
    subtitulo: 'Busca operacional com 5 filtros e emissão de PDF A4',
    publica: false,
    resumo: 'Busca operacional sobre as cargas com cinco filtros combinados, exportação de histórico e geração de relatório PDF A4 com o logotipo do terminal.',
    destaques: [
      'Cinco filtros: identificador, status, natureza, período e porto de descarga.',
      'Relatório PDF A4 gerado no servidor (Edge Function relatorio-pdf) com cache por hash do conteúdo.',
      'Exportação de histórico com registro de auditoria da operação.'
    ],
    cargos: TODOS_OPERACIONAIS
  },
  {
    chave: 'teste-vibracao',
    arquivo: 'teste-vibracao.html',
    titulo: 'Teste de Vibração do Pânico',
    subtitulo: 'Diagnóstico do alerta tátil',
    publica: true,
    resumo: 'Página de diagnóstico que testa a vibração e o áudio do alerta de emergência no dispositivo do operador.',
    destaques: [
      'Verifica suporte a navigator.vibrate e reprodução de áudio no navegador.',
      'Útil no credenciamento de aparelhos antes do turno.',
      'Não altera dados: é apenas um teste local.'
    ],
    cargos: TODOS_OPERACIONAIS
  }
];

/** Páginas exibidas no about.html (a de diagnóstico fica só no material de apoio). */
const PAGINAS_DO_ABOUT = PAGINAS;

/**
 * Páginas capturadas para uma conta, na ordem do catálogo.
 * Páginas públicas (login e diagnóstico) são capturadas uma única vez, sem sessão.
 */
function paginasParaCargo(cargo) {
  return PAGINAS.filter((p) => !p.publica && (p.sempre || p.cargos.includes(cargo)));
}

module.exports = { PAGINAS, PAGINAS_DO_ABOUT, paginasParaCargo, TODOS_OPERACIONAIS, DIRETORIA, GESTAO };
