/**
 * DADOS DE DEMONSTRAÇÃO PARA OS SCREENSHOTS — NexusPort.
 *
 * Este módulo monta o conjunto de dados usado pelo servidor PostgREST simulado
 * (tools/screenshots/mock-postgrest.js) quando as telas são capturadas fora do
 * Supabase de produção.
 *
 * As colunas seguem o esquema real do projeto:
 *   - SPECs/schema.sql        (DDL canônico);
 *   - TABLES.md               (estado do banco, inclui `cargas.navio_id`);
 *   - supabase/seed.sql       (dados de demonstração: navios, contêineres, cargas);
 *   - supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql (cpf/data_nascimento).
 *
 * Inclui as três contas de demonstração usadas nas capturas:
 *   MAT-0000 — Diretor-Presidente/Superintendente  (Visão Estratégica)
 *   MAT-2011 — Supervisor/Gerente de Operações     (Visão Operacional, gestão)
 *   MAT-9999 — Técnico em Portos                   (Visão Própria)
 *
 * Todos os dados são fictícios (IMO 999xxxx, nomes, CPFs e valores inventados).
 */
'use strict';

const crypto = require('crypto');

/** UUID determinístico (mesmo padrão do seed: md5 de uma descrição). */
function uuid(semente) {
  const h = crypto.createHash('md5').update(`nexus-demo-${semente}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const agora = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();
const horas = (n) => iso(agora() - n * HORA);
const dias = (n) => iso(agora() - n * DIA);
const dataDias = (n) => dias(n).slice(0, 10);

/** CPF fictício com dígitos verificadores válidos (o cadastro valida o formato). */
function cpfFicticio(sequencia) {
  const base = String(sequencia).padStart(9, '0').slice(-9).split('').map(Number);
  const digito = (numeros) => {
    const soma = numeros.reduce((acc, n, i) => acc + n * (numeros.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = digito(base);
  const d2 = digito(base.concat(d1));
  return base.join('') + String(d1) + String(d2);
}

// ---------------------------------------------------------------------------
// FUNCIONÁRIOS — contas de demonstração + equipe de apoio das telas
// ---------------------------------------------------------------------------
const CONTAS_DEMO = [
  {
    matricula: 'MAT-0000',
    codigo_individual: 'NX-0000-SP',
    nome: 'Helena Prado',
    cargo: 'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
    email: 'helena.prado@nexusport.demo',
    telefone: '(13) 3200-0000',
    cpf: cpfFicticio(1000),
    data_nascimento: '1974-03-12',
    descricao: 'Conta de diretoria: enxerga todos os indicadores, inclusive valor declarado e produtividade, além da trilha completa de decisões e da gestão de pessoas.'
  },
  {
    matricula: 'MAT-2011',
    codigo_individual: 'NX-2011-SP',
    nome: 'Marcos Tavares',
    cargo: 'SUPERVISOR_GERENTE_OPERACOES',
    email: 'marcos.tavares@nexusport.demo',
    telefone: '(13) 3200-2011',
    cpf: cpfFicticio(2011),
    data_nascimento: '1985-07-28',
    descricao: 'Conta de gestão operacional: libera saídas de carga, aprova manutenções, delega substituto com vigência e responde pela trilha de decisões do turno.'
  },
  {
    matricula: 'MAT-9999',
    codigo_individual: 'NX-9999-SP',
    nome: 'Juliana Reis',
    cargo: 'TECNICO_PORTOS',
    email: 'juliana.reis@nexusport.demo',
    telefone: '(13) 3200-9999',
    cpf: cpfFicticio(9999),
    data_nascimento: '1992-11-05',
    descricao: 'Conta da guarita: cadastra funcionários e visitantes, valida documentos e reemite credenciais (RN 15), com acesso apenas à própria operação.'
  }
];

const EQUIPE = [
  ['MAT-1040', 'NX-1040-SP', 'Carlos Menezes', 'ESTIVADOR', 1040],
  ['MAT-1041', 'NX-1041-SP', 'Bruno Alcântara', 'ESTIVADOR', 1041],
  ['MAT-2010', 'NX-2010-SP', 'Denise Faria', 'SUPERVISOR_GERENTE_OPERACOES', 2010],
  ['MAT-2050', 'NX-2050-SP', 'Fernanda Lima', 'CONFERENTE_CARGA', 2050],
  // Nome repetido de propósito: demonstra o desempate por telefone na busca de substituto.
  ['MAT-2051', 'NX-2051-SP', 'Patrícia Duarte', 'CONFERENTE_CARGA', 2051],
  ['MAT-3070', 'NX-3070-SP', 'Rogério Batista', 'ARRUMADOR_CONSERTADOR', 3070],
  ['MAT-3071', 'NX-3071-SP', 'Patrícia Duarte', 'ARRUMADOR_CONSERTADOR', 3071],
  ['MAT-4080', 'NX-4080-SP', 'Tiago Moreira', 'PLANEJADOR_PATIO_NAVIOS', 4080],
  ['MAT-6090', 'NX-6090-SP', 'Sandra Yamada', 'INSPETOR', 6090],
  ['MAT-6091', 'NX-6091-SP', 'Otávio Brandão', 'INSPETOR', 6091],
  ['MAT-7010', 'NX-7010-SP', 'Renata Coelho', 'DIRETOR_OPERACOES_LOGISTICA', 7010],
  ['MAT-8020', 'NX-8020-SP', 'Alberto Salles', 'CONSELHO_ADMINISTRACAO', 8020]
];

function funcionarios() {
  const linhas = CONTAS_DEMO.map((f, i) => ({
    id: uuid(`funcionario-${f.matricula}`),
    matricula: f.matricula,
    codigo_individual: f.codigo_individual,
    nome: f.nome,
    cargo: f.cargo,
    email: f.email,
    telefone: f.telefone,
    cpf: f.cpf,
    data_nascimento: f.data_nascimento,
    ativo: true,
    created_at: dias(120 - i),
    updated_at: dias(2)
  }));

  EQUIPE.forEach(([matricula, codigo, nome, cargo, sequencia], i) => {
    linhas.push({
      id: uuid(`funcionario-${matricula}`),
      matricula,
      codigo_individual: codigo,
      nome,
      cargo,
      email: `${nome.toLowerCase().split(' ')[0]}@nexusport.demo`,
      telefone: `(13) 3200-${String(1000 + i).slice(-4)}`,
      cpf: cpfFicticio(sequencia),
      data_nascimento: `19${70 + (i % 25)}-0${(i % 9) + 1}-1${i % 9}`,
      ativo: true,
      created_at: dias(180 - i),
      updated_at: dias(5)
    });
  });

  // Um funcionário inativo: a tela de Gestão de Pessoas mostra os dois estados.
  linhas.push({
    id: uuid('funcionario-MAT-1042'),
    matricula: 'MAT-1042',
    codigo_individual: 'NX-1042-SP',
    nome: 'Wellington Pires',
    cargo: 'ESTIVADOR',
    email: 'wellington.pires@nexusport.demo',
    telefone: '(13) 3200-1042',
    cpf: cpfFicticio(1042),
    data_nascimento: '1980-01-19',
    ativo: false,
    created_at: dias(400),
    updated_at: dias(30)
  });

  return linhas;
}

/** Índices derivados dos funcionários (preenchidos em criarTabelas). */
const FUNC_ID = {};
const FUNC_POR_MATRICULA = {};
function indexarFuncionarios(lista) {
  lista.forEach((f) => {
    FUNC_ID[f.matricula] = f.id;
    FUNC_POR_MATRICULA[f.matricula] = f;
  });
}

// ---------------------------------------------------------------------------
// CATÁLOGOS
// ---------------------------------------------------------------------------
// [chave, nome, categoria de risco, requisitos especiais]
const TIPOS_CARGA = [
  ['tipo-dry20', "Contêiner 20' Dry", null, null],
  ['tipo-dry40', "Contêiner 40' Dry", null, null],
  ['tipo-reefer', 'Reefer (Contêiner Refrigerado)', null, 'Monitorar temperatura durante a armazenagem'],
  ['tipo-granel', 'Granel sólido', 'Classe 4 — sólidos inflamáveis', 'Aterramento do equipamento antes da movimentação'],
  ['tipo-frigorificada', 'Carga frigorificada', null, 'Cadeia de frio ininterrupta (−18 °C)']
];

const tiposCarga = () => TIPOS_CARGA.map(([chave, nome, risco, requisitos]) => ({
  id: uuid(chave),
  nome,
  categoria_risco: risco,
  requisitos_especiais: requisitos,
  created_at: dias(300),
  updated_at: dias(300)
}));

const NOME_TIPO = {};
TIPOS_CARGA.forEach(([chave, nome]) => { NOME_TIPO[chave] = nome; });

const rotasMaritimas = () => [
  ['rota-santos-hamburgo', 'Santos (BRSSZ)', 'Hamburgo (DEHAM)', 9600],
  ['rota-santos-roterda', 'Santos (BRSSZ)', 'Roterdã (NLRTM)', 9400],
  ['rota-santos-nova-york', 'Santos (BRSSZ)', 'Nova York (USNYC)', 7700],
  ['rota-santos-xangai', 'Santos (BRSSZ)', 'Xangai (CNSHA)', 19600]
].map(([chave, origem, destino, distancia]) => ({
  id: uuid(chave),
  origem,
  destino,
  distancia_km: distancia,
  created_at: dias(300),
  updated_at: dias(300)
}));

const cargoNiveis = () => [
  ['ESTIVADOR', 'OPERACIONAL'],
  ['CONFERENTE_CARGA', 'OPERACIONAL'],
  ['ARRUMADOR_CONSERTADOR', 'OPERACIONAL'],
  ['PLANEJADOR_PATIO_NAVIOS', 'OPERACIONAL'],
  ['TECNICO_PORTOS', 'OPERACIONAL'],
  ['SUPERVISOR_GERENTE_OPERACOES', 'GESTAO'],
  ['INSPETOR', 'TATICO'],
  ['DIRETOR_OPERACOES_LOGISTICA', 'ESTRATEGICO'],
  ['DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'ESTRATEGICO'],
  ['CONSELHO_ADMINISTRACAO', 'ESTRATEGICO']
].map(([cargo, nivel]) => ({ cargo, nivel }));

// ---------------------------------------------------------------------------
// NAVIOS, BERÇOS, GUINDASTES E CONTÊINERES
// ---------------------------------------------------------------------------
// [chave, nome, IMO, estado, localização, porto de destino, cargas realizadas, berço]
const NAVIOS = [
  ['atlantico', 'Navio Atlântico Sul', '9990001', 'OPERANTE', 'DENTRO_DO_PORTO', 'Hamburgo (DEHAM)', 12, 'BERCO-01'],
  ['mar-aberto', 'Navio Mar Aberto', '9990002', 'OPERANTE', 'FORA_DO_PORTO', 'Roterdã (NLRTM)', 7, null],
  ['costa-leste', 'Navio Costa Leste', '9990003', 'OPERANTE', 'NO_PORTO_DE_DESTINO', 'Nova York (USNYC)', 21, null],
  ['porto-verde', 'Navio Porto Verde', '9990004', 'OPERANTE', 'DENTRO_DO_PORTO', 'Xangai (CNSHA)', 3, 'BERCO-05'],
  ['santa-clara', 'Navio Santa Clara', '9990005', 'EM_REFORMA', 'DENTRO_DO_PORTO', 'Santos (BRSSZ)', 15, 'BERCO-09'],
  ['iguacu', 'Navio Iguaçu', '9990006', 'AGENDADO_PARA_REFORMA', 'DENTRO_DO_PORTO', 'Hamburgo (DEHAM)', 9, 'BERCO-12']
];

function navios() {
  return NAVIOS.map(([, nome, imo, estado, localizacao, destino, cargasRealizadas]) => ({
    id: uuid(`navio-${imo}`),
    nome,
    numero_imo: imo,
    data_registro_sistema: dataDias(90),
    quantidade_cargas_realizadas: cargasRealizadas,
    estado_operacional: estado,
    coordenadas_gps: localizacao === 'DENTRO_DO_PORTO' ? '-23.9618,-46.3042' : '-24.5120,-45.1210',
    tempo_fora_do_porto: localizacao === 'FORA_DO_PORTO' ? '18:40:00' : null,
    porto_origem: 'Santos (BRSSZ)',
    porto_destino: destino,
    localizacao,
    data_chegada: localizacao === 'FORA_DO_PORTO' ? null : horas(36),
    data_saida: localizacao === 'FORA_DO_PORTO' ? horas(20) : null,
    qr_code_url: `QR-NAV-${imo}`,
    created_at: dias(60),
    updated_at: horas(4)
  }));
}

const NAVIO_ID = {};
function indexarNavios(lista) {
  lista.forEach((n) => { NAVIO_ID[n.numero_imo] = n.id; });
}

function bercos() {
  const lista = [];
  for (let i = 1; i <= 15; i += 1) {
    const id = `BERCO-${String(i).padStart(2, '0')}`;
    const ocupante = NAVIOS.find(([, , , , , , , berco]) => berco === id);
    lista.push({
      id,
      nome: `Berço ${String(i).padStart(2, '0')}`,
      estado: ocupante ? 'OCUPADO' : (i === 14 ? 'MANUTENCAO' : 'LIVRE'),
      navio_nome: ocupante ? ocupante[1] : null,
      navio_imo: ocupante ? ocupante[2] : null,
      navio_id: ocupante ? NAVIO_ID[ocupante[2]] : null,
      created_at: dias(200),
      updated_at: horas(6)
    });
  }
  return lista;
}

const GUINDASTES = [
  ['GND-01-STS', 'OPERANTE', 45],
  ['GND-02-STS', 'OPERANTE', 30],
  ['GND-03-STS', 'EM_MANUTENCAO', 12],
  ['GND-04-STS', 'OPERANTE', 88],
  ['GND-05-STS', 'OPERANTE', 21],
  ['GND-06-STS', 'EM_MANUTENCAO', 5]
];

const guindastes = () => GUINDASTES.map(([numero, estado, diasUltima]) => ({
  id: uuid(`guindaste-${numero}`),
  numero_identificacao: numero,
  estado,
  data_ultima_manutencao: dataDias(diasUltima),
  qr_code_url: `QR-${numero}`,
  created_at: dias(300),
  updated_at: dias(1)
}));

// [chave, número, tipo, material, IMO do navio, estado]
const CONTEINERES = [
  ['01', 'DEMO0000001', 'tipo-dry40', 'Café em grão', '9990001', 'OPERANTE'],
  ['02', 'DEMO0000002', 'tipo-reefer', 'Carne bovina congelada', '9990001', 'OPERANTE'],
  ['03', 'DEMO0000003', 'tipo-reefer', 'Suco de laranja concentrado', '9990004', 'OPERANTE'],
  ['04', 'DEMO0000004', 'tipo-dry20', 'Autopeças', '9990002', 'OPERANTE'],
  ['05', 'DEMO0000005', 'tipo-dry40', 'Madeira serrada', '9990003', 'OPERANTE'],
  ['06', 'DEMO0000006', 'tipo-dry40', 'Celulose', '9990003', 'OPERANTE'],
  ['07', 'DEMO0000007', 'tipo-dry20', 'Cerâmica esmaltada', '9990005', 'EM_REFORMA'],
  ['08', 'DEMO0000008', 'tipo-granel', 'Fertilizante a granel', '9990006', 'AGENDADO_PARA_REFORMA']
];

function containers() {
  return CONTEINERES.map(([, numero, tipo, material, imo, estado], i) => ({
    id: uuid(`container-${numero}`),
    numero_identificacao: numero,
    tipo_carga_id: uuid(tipo),
    material_carregado: material,
    data_fabricacao: `${2016 + (i % 8)}-0${(i % 9) + 1}-1${i % 9}`,
    data_ultima_manutencao: dataDias(20 + i * 11),
    tempo_uso_referencia: i % 2 === 0 ? 'DATA_FABRICACAO' : 'DATA_ULTIMA_MANUTENCAO',
    estado,
    navio_id: NAVIO_ID[imo] || null,
    qr_code_url: `QR-CNT-${numero}`,
    created_at: dias(80),
    updated_at: dias(3)
  }));
}

const CONTAINER_ID = {};
function indexarContainers(lista) {
  lista.forEach((c) => { CONTAINER_ID[c.numero_identificacao] = c.id; });
}

// ---------------------------------------------------------------------------
// CARGAS (os 9 status do fluxo), AGENDAMENTOS E VÍNCULO COM ESTIVADORES
// ---------------------------------------------------------------------------
// [chave, tipo, material, peso(t), volume(m³), valor(R$), natureza, status,
//  contêiner, IMO, resultado da inspeção, destino, porto de descarga, entrada(h), saída(h)]
const CARGAS = [
  ['01', 'tipo-dry40', 'Fardos de algodão', 18.4, 30, 120000, 'Carga geral', 'AGENDAMENTO', null, null, 'PENDENTE', 'Hamburgo', 'Hamburgo (DEHAM)', null, null],
  ['02', 'tipo-dry20', 'Máquinas industriais', 12.5, 22, 250000, 'Carga geral', 'RECEBIMENTO_INSPECAO', null, null, 'PENDENTE', 'Roterdã', 'Roterdã (NLRTM)', 3, null],
  ['03', 'tipo-dry40', 'Café em grão', 24.8, 38, 96000, 'Carga geral', 'ARMAZENAGEM', 'DEMO0000001', '9990001', 'APROVADA', 'Hamburgo', 'Hamburgo (DEHAM)', 40, null],
  ['04', 'tipo-reefer', 'Carne bovina congelada', 21.3, 33, 410000, 'Carga refrigerada', 'ARMAZENAGEM', 'DEMO0000002', '9990001', 'APROVADA', 'Xangai', 'Xangai (CNSHA)', 38, null],
  ['05', 'tipo-granel', 'Aço em bobinas', 26.0, 15, 87000, 'Carga geral', 'RECUSADA', null, null, 'RECUSADA', 'Nova York', 'Nova York (USNYC)', 30, null],
  ['06', 'tipo-reefer', 'Suco de laranja concentrado', 19.7, 31, 175000, 'Carga refrigerada', 'PRONTA_PARA_ENTREGA', 'DEMO0000003', '9990004', 'APROVADA', 'Roterdã', 'Roterdã (NLRTM)', 20, null],
  ['07', 'tipo-dry20', 'Autopeças', 14.2, 26, 320000, 'Carga geral', 'EM_TRANSITO', 'DEMO0000004', '9990002', 'APROVADA', 'Hamburgo', 'Hamburgo (DEHAM)', 18, null],
  ['08', 'tipo-dry40', 'Madeira serrada', 23.1, 36, 64000, 'Carga geral', 'ENTREGUE', 'DEMO0000005', '9990003', 'APROVADA', 'Xangai', 'Xangai (CNSHA)', 60, 4],
  ['09', 'tipo-granel', 'Fertilizante', 20.0, 28, 54000, 'Carga geral', 'CANCELADA', null, null, 'PENDENTE', 'Nova York', 'Nova York (USNYC)', null, null],
  ['10', 'tipo-dry40', 'Celulose', 25.4, 40, 150000, 'Carga geral', 'SAIDA', 'DEMO0000006', '9990003', 'APROVADA', 'Roterdã', 'Roterdã (NLRTM)', 70, null],
  ['11', 'tipo-granel', 'Açúcar a granel', 17.6, 29, 42000, 'Carga geral', 'ARMAZENAGEM', null, null, 'APROVADA', 'Hamburgo', 'Hamburgo (DEHAM)', 16, null],
  ['12', 'tipo-frigorificada', 'Polpa de fruta congelada', 11.0, 18, 36000, 'Carga refrigerada', 'AGENDAMENTO', null, null, 'PENDENTE', 'Xangai', 'Xangai (CNSHA)', null, null],
  ['13', 'tipo-dry20', 'Cerâmica esmaltada', 9.8, 16, 28000, 'Carga geral', 'RECEBIMENTO_INSPECAO', null, null, 'PENDENTE', 'Roterdã', 'Roterdã (NLRTM)', 6, null],
  ['14', 'tipo-dry40', 'Rolhas de cortiça', 13.2, 24, 71000, 'Carga geral', 'PRONTA_PARA_ENTREGA', 'DEMO0000008', '9990006', 'APROVADA', 'Nova York', 'Nova York (USNYC)', 26, null]
];

function cargas() {
  return CARGAS.map(([chave, tipo, material, peso, volume, valor, natureza, status, container, imo, resultado, destino, porto, entrada, saida]) => ({
    id: uuid(`carga-${chave}`),
    tipo_carga_id: uuid(tipo),
    quantidade: 1,
    material,
    peso,
    volume,
    valor_declarado: valor,
    natureza,
    data_entrada: entrada === null ? null : horas(entrada),
    data_saida: saida === null ? null : horas(saida),
    destino,
    porto_descarga: porto,
    status_fluxo: status,
    container_id: container ? CONTAINER_ID[container] : null,
    checklist_modelo_id: uuid(`checklist-${tipo}`),
    resultado_inspecao: resultado,
    motivo_recusa: status === 'RECUSADA' ? 'Embalagem avariada na inspeção de recebimento' : null,
    qr_code_url: `QR-DEMO-CRG-${String(chave).padStart(3, '0')}`,
    navio_id: imo ? NAVIO_ID[imo] : null,
    created_at: horas(entrada === null ? 12 : entrada + 2),
    updated_at: horas(2)
  }));
}

const CARGA_ID = {};
const CARGA_TIPO = {};
function indexarCargas(lista) {
  lista.forEach((c, i) => {
    CARGA_ID[CARGAS[i][0]] = c.id;
    CARGA_TIPO[c.id] = CARGAS[i][1];
  });
}

function agendamentos() {
  // Só as cargas em AGENDAMENTO têm agendamento futuro (uma linha por carga).
  return CARGAS
    .filter(([, , , , , , , status]) => status === 'AGENDAMENTO')
    .map((linha, i) => ({
      id: uuid(`agendamento-${linha[0]}`),
      carga_id: CARGA_ID[linha[0]],
      data_prevista_entrega: dataDias(-(i + 2)),
      agendado_por: FUNC_ID['MAT-2050'],
      created_at: horas(30)
    }));
}

function estivadorCargas() {
  return [
    ['01', 'MAT-1040'],
    ['03', 'MAT-1040'],
    ['06', 'MAT-1041'],
    ['07', 'MAT-1041'],
    ['08', 'MAT-1041'],
    ['10', 'MAT-1040']
  ].map(([chave, matricula], i) => ({
    id: uuid(`estivador-carga-${chave}-${matricula}`),
    estivador_id: FUNC_ID[matricula],
    carga_id: CARGA_ID[chave],
    estado_carregamento: i % 3 === 0 ? 'CONCLUIDO' : (i % 3 === 1 ? 'EM_CARREGAMENTO' : 'PARADO'),
    data_inicio: horas(24 - i),
    data_fim: i % 3 === 0 ? horas(12 - i) : null,
    created_at: horas(26 - i),
    updated_at: horas(3)
  }));
}

// ---------------------------------------------------------------------------
// CHECKLISTS, INSPEÇÕES E MANUTENÇÕES
// ---------------------------------------------------------------------------
const checklistModelos = () => TIPOS_CARGA.map(([chave, nome]) => ({
  id: uuid(`checklist-${chave}`),
  tipo_carga_id: uuid(chave),
  nome: `Checklist de recebimento — ${nome}`,
  descricao: `Verificação documental e física obrigatória para ${nome.toLowerCase()}.`,
  criado_por: FUNC_ID['MAT-6090'],
  created_at: dias(120),
  updated_at: dias(120)
}));

const CHECKLIST_ITENS = [
  ['Documentação de embarque confere com a carga física', true],
  ['Lacre e numeração do contêiner íntegros', true],
  ['Embalagem externa sem avarias', true],
  ['Temperatura dentro da faixa contratada', false],
  ['Peso aferido compatível com o manifesto', true],
  ['Içamento e fixação adequados para o pátio', false]
];

function checklistItens() {
  return checklistModelos().flatMap((modelo) =>
    CHECKLIST_ITENS.map(([descricao, critico], ordem) => ({
      id: uuid(`checklist-item-${modelo.tipo_carga_id}-${ordem}`),
      checklist_modelo_id: modelo.id,
      descricao,
      critico,
      ordem,
      created_at: dias(120)
    }))
  );
}

const INSPECIONADAS_APROVADAS = ['03', '04', '06', '07', '08', '10', '11', '14'];

function inspecoes() {
  const linhas = [];

  INSPECIONADAS_APROVADAS.forEach((chave, i) => {
    linhas.push({
      id: uuid(`inspecao-${chave}`),
      carga_id: CARGA_ID[chave],
      checklist_modelo_id: uuid(`checklist-${CARGA_TIPO[CARGA_ID[chave]]}`),
      inspetor_id: i % 2 === 0 ? FUNC_ID['MAT-6090'] : FUNC_ID['MAT-6091'],
      data_inspecao: horas(28 - i * 2),
      resultado: 'APROVADA',
      observacoes: 'Checklist completo conferido no recebimento; carga liberada para armazenagem.',
      ativa: true,
      created_at: horas(28 - i * 2)
    });
  });

  linhas.push({
    id: uuid('inspecao-05'),
    carga_id: CARGA_ID['05'],
    checklist_modelo_id: uuid('checklist-tipo-granel'),
    inspetor_id: FUNC_ID['MAT-6090'],
    data_inspecao: horas(30),
    resultado: 'RECUSADA',
    observacoes: 'Embalagem avariada na inspeção de recebimento; carga devolvida ao exportador.',
    ativa: true,
    created_at: horas(30)
  });

  // Inspeção anterior desativada da mesma carga (histórico preservado).
  linhas.push({
    id: uuid('inspecao-05-historico'),
    carga_id: CARGA_ID['05'],
    checklist_modelo_id: uuid('checklist-tipo-granel'),
    inspetor_id: FUNC_ID['MAT-6091'],
    data_inspecao: horas(34),
    resultado: 'PENDENTE',
    observacoes: 'Primeira conferência documental (substituída pela inspeção ativa).',
    ativa: false,
    created_at: horas(34)
  });

  return linhas;
}

function inspecaoItens() {
  const linhas = [];
  inspecoes().forEach((inspecao) => {
    const tipo = CARGA_TIPO[inspecao.carga_id];
    CHECKLIST_ITENS.forEach(([, critico], ordem) => {
      const conforme = inspecao.resultado === 'RECUSADA' ? ordem % 3 !== 0 : true;
      linhas.push({
        id: uuid(`inspecao-item-${inspecao.id}-${ordem}`),
        inspecao_id: inspecao.id,
        checklist_item_id: uuid(`checklist-item-${uuid(tipo)}-${ordem}`),
        conforme,
        observacao: conforme ? null : 'Item crítico reprovado na conferência física.',
        created_at: inspecao.created_at
      });
    });
  });
  return linhas;
}

function manutencoes() {
  return [
    ['NAVIO', '9990005', null, 'Troca de chapas do casco no dique seco', 'APROVADA', 'MAT-6090', 'MAT-2011', 72, 48, null],
    ['GUINDASTE', null, 'GND-03-STS', 'Substituição do cabo de içamento principal', 'SOLICITADA', 'MAT-6091', null, 20, null, null],
    ['CONTAINER', null, null, 'Reparo estrutural no piso do contêiner DEMO0000007', 'APROVADA', 'MAT-6090', 'MAT-2011', 40, 30, null],
    ['GUINDASTE', null, 'GND-06-STS', 'Revisão do sistema hidráulico', 'CONCLUIDA', 'MAT-6090', 'MAT-2011', 200, 180, 150],
    ['NAVIO', '9990006', null, 'Pintura anticorrosiva e revisão de válvulas', 'RECUSADA', 'MAT-6091', 'MAT-2011', 96, null, null]
  ].map(([entidade, imo, guindaste, descricao, status, solicitante, aprovador, solicitacao, aprovacao, conclusao], i) => ({
    id: uuid(`manutencao-${i}`),
    entidade_tipo: entidade,
    navio_id: imo ? NAVIO_ID[imo] : null,
    container_id: entidade === 'CONTAINER' ? CONTAINER_ID['DEMO0000007'] : null,
    guindaste_id: guindaste ? uuid(`guindaste-${guindaste}`) : null,
    data_solicitacao: horas(solicitacao),
    data_aprovacao: aprovacao === null ? null : horas(aprovacao),
    data_conclusao: conclusao === null ? null : horas(conclusao),
    descricao,
    status,
    solicitado_por: FUNC_ID[solicitante],
    aprovado_por: aprovador ? FUNC_ID[aprovador] : null,
    created_at: horas(solicitacao),
    updated_at: horas(2)
  }));
}

function historicoManutencoes() {
  return [
    ['GUINDASTE', 'GND-06-STS', 150, 'Revisão hidráulica concluída com troca de vedação e mangueiras.'],
    ['NAVIO', '9990001', 60, 'Inspeção de casco e limpeza de incrustação no porto de origem.'],
    ['CONTAINER', 'DEMO0000005', 45, 'Tratamento anticorrosivo e troca do piso de madeira.']
  ].map(([entidade, chave, diasAtras, descricao], i) => ({
    id: uuid(`historico-manutencao-${i}`),
    navio_id: entidade === 'NAVIO' ? NAVIO_ID[chave] : null,
    container_id: entidade === 'CONTAINER' ? CONTAINER_ID[chave] : null,
    guindaste_id: entidade === 'GUINDASTE' ? uuid(`guindaste-${chave}`) : null,
    data_manutencao: dataDias(diasAtras),
    descricao_servicos: descricao,
    registrado_por: FUNC_ID['MAT-6090'],
    created_at: dias(diasAtras)
  }));
}

// ---------------------------------------------------------------------------
// VISITANTES, AUDITORIA, DELEGAÇÃO E EMERGÊNCIAS
// ---------------------------------------------------------------------------
function visitantes() {
  return [
    ['Márcia Fontes', '32165498700', 'Reunião com o setor de operações', 5, null],
    ['Equipe SGS Inspeções', '12.345.678/0001-90', 'Auditoria de balanças do terminal', 26, null],
    ['Paulo Nogueira', '98765432100', 'Entrega de material de manutenção', 52, 48],
    ['Técnicos Hidroservice', '98.765.432/0001-10', 'Manutenção preventiva dos guindastes', 120, 96]
  ].map(([nome, documento, motivo, entrada, saida], i) => ({
    id: uuid(`visitante-${i}`),
    nome,
    documento,
    motivo,
    data_hora_entrada: horas(entrada),
    data_hora_saida: saida === null ? null : horas(saida),
    registrado_por: FUNC_ID['MAT-9999'],
    created_at: horas(entrada)
  }));
}

function logsAlteracoes() {
  return [
    ['MAT-2011', 'NAVIO', 'Navio Atlântico Sul', 'CRIACAO', { origem: 'cadastro de navio' }, 72],
    ['MAT-2011', 'NAVIO', 'Navio Porto Verde', 'CRIACAO', { origem: 'cadastro de navio' }, 8],
    ['MAT-4080', 'CONTAINER', 'DEMO0000001', 'CRIACAO', { origem: 'cadastro de contêiner' }, 70],
    ['MAT-4080', 'CONTAINER', 'DEMO0000005', 'CRIACAO', { origem: 'cadastro de contêiner' }, 7],
    ['MAT-2050', 'CARGA', 'DEMO-CRG-001', 'CRIACAO', { origem: 'agendamento de carga' }, 50],
    ['MAT-2051', 'CARGA', 'DEMO-CRG-002', 'CRIACAO', { origem: 'agendamento de carga' }, 48],
    ['MAT-6090', 'CARGA', 'DEMO-CRG-003', 'EDICAO', { campo: 'resultado_inspecao', de: 'PENDENTE', para: 'APROVADA' }, 40],
    ['MAT-6091', 'CARGA', 'DEMO-CRG-004', 'EDICAO', { campo: 'resultado_inspecao', de: 'PENDENTE', para: 'APROVADA' }, 38],
    ['MAT-6090', 'CARGA', 'DEMO-CRG-005', 'EDICAO', { campo: 'resultado_inspecao', de: 'PENDENTE', para: 'RECUSADA', motivo: 'Embalagem avariada na inspeção de recebimento' }, 30],
    ['MAT-2011', 'CARGA', 'DEMO-CRG-007', 'EDICAO', { campo: 'status_fluxo', de: 'PRONTA_PARA_ENTREGA', para: 'EM_TRANSITO' }, 12],
    ['MAT-2011', 'CARGA', 'DEMO-CRG-008', 'EDICAO', { campo: 'status_fluxo', de: 'SAIDA', para: 'ENTREGUE' }, 5],
    ['MAT-7010', 'CARGA', 'DEMO-CRG-010', 'EXPORTACAO', { tipo_exportacao: 'PDF_A4' }, 3],
    ['MAT-1040', 'CARGA', 'DEMO-CRG-003', 'REIMPRESSAO_ETIQUETA', { motivo: 'etiqueta danificada no manuseio' }, 1],
    ['MAT-9999', 'FUNCIONARIO', 'MAT-1042', 'EDICAO', { campo: 'ativo', de: true, para: false }, 6],
    ['MAT-9999', 'VISITANTE', 'Equipe SGS Inspeções', 'CRIACAO', { origem: 'registro de visitante' }, 26]
  ].map(([matricula, entidade, entidadeId, tipo, detalhes, horasAtras], i) => ({
    id: uuid(`log-${i}`),
    data_hora: horas(horasAtras),
    funcionario_id: FUNC_ID[matricula],
    cargo: FUNC_POR_MATRICULA[matricula].cargo,
    codigo_individual: FUNC_POR_MATRICULA[matricula].codigo_individual,
    entidade_tipo: entidade,
    entidade_id: entidadeId,
    tipo_alteracao: tipo,
    detalhes,
    created_at: horas(horasAtras)
  }));
}

function trailDecisoes() {
  return [
    ['MAT-6091', 'APROVOU_CARGA', 'CARGA', 'DEMO-CRG-003', 'Checklist completo e documentação regular.', 40],
    ['MAT-6090', 'RECUSOU_CARGA', 'CARGA', 'DEMO-CRG-005', 'Embalagem avariada: risco de perda da carga no transporte.', 30],
    ['MAT-2011', 'LIBEROU_NAVIO', 'NAVIO', 'Navio Porto Verde', 'Berço 05 liberado após conferência de atracação.', 9],
    ['MAT-2011', 'SOLICITOU_MANUTENCAO_GUINDASTE', 'GUINDASTE', 'GND-03-STS', 'Cabo de içamento fora do critério de segurança.', 20],
    ['MAT-2011', 'APROVOU_MANUTENCAO', 'NAVIO', 'Navio Santa Clara', 'Reforma aprovada no ciclo orçamentário do trimestre.', 48],
    ['MAT-7010', 'DESIGNOU_SUBSTITUTO', 'FUNCIONARIO', 'MAT-2011', 'Delegação durante ausência operacional.', 100]
  ].map(([matricula, tipo, entidade, entidadeId, motivo, horasAtras], i) => ({
    id: uuid(`trail-${i}`),
    data_hora: horas(horasAtras),
    funcionario_id: FUNC_ID[matricula],
    cargo: FUNC_POR_MATRICULA[matricula].cargo,
    codigo_individual: FUNC_POR_MATRICULA[matricula].codigo_individual,
    tipo_decisao: tipo,
    entidade_tipo: entidade,
    entidade_id: entidadeId,
    motivo,
    detalhes: { registro: `TRL-${String(i + 1).padStart(4, '0')}` },
    created_at: horas(horasAtras)
  }));
}

function retificacoesTrail() {
  const trail = trailDecisoes();
  return [
    {
      id: uuid('retificacao-1'),
      trail_id: trail[2].id,
      funcionario_id: FUNC_ID['MAT-2011'],
      retificacao: 'O berço informado anteriormente (BERCO-06) estava em manutenção; vínculo corrigido para BERCO-05.',
      data_hora: horas(7),
      created_at: horas(7)
    }
  ];
}

function delegacoesSupervisor() {
  return [
    {
      id: uuid('delegacao-1'),
      supervisor_titular_id: FUNC_ID['MAT-2010'],
      substituto_id: FUNC_ID['MAT-2051'],
      substituto_nome: 'Patrícia Duarte',
      substituto_cpf: cpfFicticio(2051),
      substituto_data_nascimento: '1988-09-14',
      data_inicio: horas(30),
      data_fim_previsto: iso(agora() + 18 * HORA),
      data_revogacao: null,
      ativo: true,
      created_at: horas(30),
      updated_at: horas(30)
    },
    {
      id: uuid('delegacao-2'),
      supervisor_titular_id: FUNC_ID['MAT-7010'],
      substituto_id: FUNC_ID['MAT-2011'],
      substituto_nome: 'Marcos Tavares',
      substituto_cpf: cpfFicticio(2011),
      substituto_data_nascimento: '1985-07-28',
      data_inicio: dias(20),
      data_fim_previsto: dias(15),
      data_revogacao: dias(16),
      ativo: false,
      created_at: dias(20),
      updated_at: dias(16)
    }
  ];
}

function emergencias() {
  return [
    {
      id: uuid('emergencia-1'),
      estado: 'RESOLVIDA',
      motivo: 'Simulado de emergência com a brigada do terminal (exercício trimestral).',
      funcionario_id: FUNC_ID['MAT-2011'],
      acionado_por_nome: 'Marcos Tavares',
      acionado_por_cargo: 'SUPERVISOR_GERENTE_OPERACOES',
      acionado_por_codigo: 'NX-2011-SP',
      data_hora: dias(6),
      resolvido_por_nome: 'Helena Prado',
      resolvido_por_cargo: 'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
      data_resolucao: dias(6),
      webhook_disparado: false,
      origem: 'EDGE_FUNCTION',
      created_at: dias(6)
    }
  ];
}

function leiturasQrCode() {
  return [
    ['MAT-1040', 'CARGA', 'DEMO-CRG-003', 3],
    ['MAT-4080', 'CONTAINER', 'DEMO0000001', 5],
    ['MAT-6090', 'CARGA', 'DEMO-CRG-005', 30],
    ['MAT-2050', 'CARGA', 'DEMO-CRG-006', 20]
  ].map(([matricula, entidade, entidadeId, horasAtras], i) => ({
    id: uuid(`leitura-${i}`),
    funcionario_id: FUNC_ID[matricula],
    entidade_tipo: entidade,
    entidade_id: entidadeId,
    data_hora: horas(horasAtras),
    created_at: horas(horasAtras)
  }));
}

// ---------------------------------------------------------------------------
// MONTAGEM
// ---------------------------------------------------------------------------

/** Contas de demonstração, na ordem usada pelas capturas. */
const CONTAS = CONTAS_DEMO.map((f) => ({
  matricula: f.matricula,
  codigo: f.codigo_individual,
  nome: f.nome,
  cargo: f.cargo,
  descricao: f.descricao
}));

/** Metadados de exibição por cargo (espelha js/pages/confirm-role.js). */
const CARGO_META = {
  DIRETOR_PRESIDENTE_SUPERINTENDENTE: { nome: 'Diretor-Presidente/Superintendente', nivel: 'Nível Estratégico', camada: 'Visão Estratégica' },
  DIRETOR_OPERACOES_LOGISTICA: { nome: 'Diretor de Operações e Logística', nivel: 'Nível Estratégico', camada: 'Visão Estratégica' },
  CONSELHO_ADMINISTRACAO: { nome: 'Conselho de Administração', nivel: 'Nível Estratégico', camada: 'Visão Estratégica' },
  SUPERVISOR_GERENTE_OPERACOES: { nome: 'Supervisor / Gerente de Operações', nivel: 'Nível Gestão', camada: 'Visão Operacional' },
  INSPETOR: { nome: 'Inspetor', nivel: 'Nível Tático', camada: 'Visão Operacional' },
  TECNICO_PORTOS: { nome: 'Técnico em Portos', nivel: 'Nível Operacional', camada: 'Visão Própria' },
  ESTIVADOR: { nome: 'Estivador', nivel: 'Nível Operacional', camada: 'Visão Própria' },
  CONFERENTE_CARGA: { nome: 'Conferente de Carga', nivel: 'Nível Operacional', camada: 'Visão Própria' },
  ARRUMADOR_CONSERTADOR: { nome: 'Arrumador e Consertador', nivel: 'Nível Operacional', camada: 'Visão Própria' },
  PLANEJADOR_PATIO_NAVIOS: { nome: 'Planejador de Pátio e de Navios', nivel: 'Nível Operacional', camada: 'Visão Própria' }
};

/** Cria o conjunto completo de tabelas (novo a cada chamada). */
function criarTabelas() {
  const funcs = funcionarios();
  indexarFuncionarios(funcs);
  const nav = navios();
  indexarNavios(nav);
  const cont = containers();
  indexarContainers(cont);
  const crg = cargas();
  indexarCargas(crg);

  return {
    cargo_niveis: cargoNiveis(),
    funcionarios: funcs,
    visitantes: visitantes(),
    tipos_carga: tiposCarga(),
    checklist_modelos: checklistModelos(),
    checklist_itens: checklistItens(),
    rotas_maritimas: rotasMaritimas(),
    navios: nav,
    bercos: bercos(),
    guindastes: guindastes(),
    containers: cont,
    cargas: crg,
    agendamentos: agendamentos(),
    estivador_cargas: estivadorCargas(),
    manutencoes: manutencoes(),
    historico_manutencoes: historicoManutencoes(),
    inspecoes: inspecoes(),
    inspecao_itens: inspecaoItens(),
    logs_alteracoes: logsAlteracoes(),
    trail_decisoes: trailDecisoes(),
    retificacoes_trail: retificacoesTrail(),
    delegacoes_supervisor: delegacoesSupervisor(),
    leituras_qr_code: leiturasQrCode(),
    emergencias: emergencias(),
    panic_webhook_config: [{ id: uuid('panic-webhook'), enabled: false, url: null, updated_at: dias(10) }]
  };
}

module.exports = {
  criarTabelas,
  CONTAS,
  CARGO_META,
  uuid
};
