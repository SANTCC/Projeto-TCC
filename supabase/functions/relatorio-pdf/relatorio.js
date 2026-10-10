/**
 * Relatório operacional de carga (Backlog 3, item B): modelo de dados, rótulos, formatação e hash.
 *
 * Este módulo é JavaScript puro (sem Deno nem navegador): roda na Edge Function e nos testes Node.
 *
 * Regra de dados: o relatório mostra só o que está gravado no banco. Campo vazio aparece como
 * "Não informado"; nada de valor padrão (peso, volume, valor, destino ou navio fictícios).
 */

export const VERSAO_MODELO = 1;
export const BUCKET = 'relatorios-pdf';
export const NAO_INFORMADO = 'Não informado';

/** Cargos que podem emitir o relatório. Deve coincidir com js/auth-guard.js (relatorios.html). */
export const CARGOS_PERMITIDOS = [
  'ESTIVADOR',
  'CONFERENTE_CARGA',
  'ARRUMADOR_CONSERTADOR',
  'PLANEJADOR_PATIO_NAVIOS',
  'TECNICO_PORTOS',
  'SUPERVISOR_GERENTE_OPERACOES',
  'INSPETOR',
  'DIRETOR_OPERACOES_LOGISTICA',
  'DIRETOR_PRESIDENTE_SUPERINTENDENTE',
  'CONSELHO_ADMINISTRACAO'
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rótulos dos enums do banco (SPECs/schema.sql). Valor desconhecido aparece como está. */
const ROTULOS = {
  status_fluxo: {
    AGENDAMENTO: 'Agendamento',
    RECEBIMENTO_INSPECAO: 'Recebimento e inspeção',
    ARMAZENAGEM: 'Armazenagem',
    PRONTA_PARA_ENTREGA: 'Pronta para entrega',
    SAIDA: 'Saída',
    EM_TRANSITO: 'Em trânsito',
    ENTREGUE: 'Entregue',
    CANCELADA: 'Cancelada',
    RECUSADA: 'Recusada'
  },
  resultado_inspecao: { PENDENTE: 'Pendente', APROVADA: 'Aprovada', RECUSADA: 'Recusada' },
  estado_container: {
    OPERANTE: 'Operante',
    AGENDADO_PARA_REFORMA: 'Agendado para reforma',
    EM_REFORMA: 'Em reforma',
    APROVADO_PARA_REFORMA: 'Aprovado para reforma'
  },
  referencia_tempo: {
    DATA_FABRICACAO: 'Data de fabricação',
    DATA_ULTIMA_MANUTENCAO: 'Data da última manutenção'
  }
};

const FMT_NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const FMT_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const FMT_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

/** true para UUID no formato canônico (qualquer versão). */
export function ehUuid(valor) {
  return typeof valor === 'string' && UUID.test(valor);
}

function vazio(valor) {
  return valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');
}

function textoOu(valor) {
  return vazio(valor) ? NAO_INFORMADO : String(valor);
}

/** Número do banco (o PostgREST devolve numeric como texto). Não numérico vira null. */
function numeroOuNulo(valor) {
  if (vazio(valor)) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function rotulo(grupo, valor) {
  if (vazio(valor)) return NAO_INFORMADO;
  const tabela = ROTULOS[grupo] || {};
  return Object.prototype.hasOwnProperty.call(tabela, valor) ? tabela[valor] : String(valor);
}

/**
 * Converte a linha de `cargas` (com `containers` e, dentro dele, `navios`) em um modelo estável.
 * O navio chega pelo contêiner: `cargas` não tem navio_id.
 */
export function montarModelo(linha) {
  const cont = linha.containers || null;
  const navio = cont && cont.navios ? cont.navios : null;
  return {
    versao: VERSAO_MODELO,
    carga: {
      id: linha.id,
      natureza: linha.natureza ?? null,
      material: linha.material ?? null,
      quantidade: numeroOuNulo(linha.quantidade),
      peso_t: numeroOuNulo(linha.peso),
      volume_m3: numeroOuNulo(linha.volume),
      valor_declarado_brl: numeroOuNulo(linha.valor_declarado),
      destino: linha.destino ?? null,
      porto_descarga: linha.porto_descarga ?? null,
      status_fluxo: linha.status_fluxo ?? null,
      resultado_inspecao: linha.resultado_inspecao ?? null,
      motivo_recusa: linha.motivo_recusa ?? null,
      data_entrada: linha.data_entrada ?? null,
      data_saida: linha.data_saida ?? null
    },
    container: cont
      ? {
        numero_identificacao: cont.numero_identificacao ?? null,
        material_carregado: cont.material_carregado ?? null,
        estado: cont.estado ?? null,
        data_fabricacao: cont.data_fabricacao ?? null,
        tempo_uso_referencia: cont.tempo_uso_referencia ?? null
      }
      : null,
    navio: navio
      ? {
        nome: navio.nome ?? null,
        numero_imo: navio.numero_imo ?? null,
        porto_origem: navio.porto_origem ?? null,
        porto_destino: navio.porto_destino ?? null
      }
      : null
  };
}

/** JSON com chaves ordenadas: o mesmo modelo gera sempre a mesma string (base do hash). */
export function canonicalJson(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonicalJson).join(',')}]`;
  const chaves = Object.keys(valor).filter((k) => valor[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonicalJson(valor[k])}`).join(',')}}`;
}

/** SHA-256 (hex) do modelo canônico. Igual conteúdo → mesmo hash → mesmo arquivo no cache. */
export async function hashModelo(modelo) {
  const bytes = new TextEncoder().encode(canonicalJson(modelo));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatarNumero(valor, unidade) {
  if (valor === null || valor === undefined) return NAO_INFORMADO;
  return unidade ? `${FMT_NUMERO.format(valor)} ${unidade}` : FMT_NUMERO.format(valor);
}

export function formatarMoeda(valor) {
  return valor === null || valor === undefined ? NAO_INFORMADO : FMT_MOEDA.format(valor);
}

/** Data e hora de um timestamp, no fuso de Brasília (America/Sao_Paulo). */
export function formatarDataHora(iso) {
  if (vazio(iso)) return NAO_INFORMADO;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return NAO_INFORMADO;
  const partes = {};
  FMT_DATA_HORA.formatToParts(data).forEach((p) => { partes[p.type] = p.value; });
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/** Data pura (AAAA-MM-DD) sem deslocamento de fuso. */
export function formatarData(dataIso) {
  if (vazio(dataIso)) return NAO_INFORMADO;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataIso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : NAO_INFORMADO;
}

/**
 * As quatro seções do relatório, com rótulos e valores já formatados.
 * Retorna [{ titulo, campos: [[rotulo, valor], ...] }].
 */
export function secoesDoRelatorio(modelo) {
  const c = modelo.carga;
  const k = modelo.container;
  const n = modelo.navio;
  return [
    {
      titulo: '1. Dados da carga',
      campos: [
        ['Código da carga', textoOu(c.id)],
        ['Natureza', textoOu(c.natureza)],
        ['Material', textoOu(c.material)],
        ['Quantidade', c.quantidade === null ? NAO_INFORMADO : FMT_NUMERO.format(c.quantidade)],
        ['Peso declarado', formatarNumero(c.peso_t, 't')],
        ['Volume', formatarNumero(c.volume_m3, 'm³')],
        ['Valor declarado', formatarMoeda(c.valor_declarado_brl)],
        ['Data de entrada', formatarDataHora(c.data_entrada)],
        ['Data de saída', formatarDataHora(c.data_saida)]
      ]
    },
    {
      titulo: '2. Dados do navio',
      campos: n
        ? [
          ['Nome da embarcação', textoOu(n.nome)],
          ['Número IMO', textoOu(n.numero_imo)],
          ['Porto de origem', textoOu(n.porto_origem)],
          ['Porto de destino da viagem', textoOu(n.porto_destino)]
        ]
        : [['Vínculo', 'Carga sem navio vinculado por contêiner']]
    },
    {
      titulo: '3. Dados do contêiner',
      campos: k
        ? [
          ['Identificação', textoOu(k.numero_identificacao)],
          ['Material carregado', textoOu(k.material_carregado)],
          ['Estado operacional', rotulo('estado_container', k.estado)],
          ['Data de fabricação', formatarData(k.data_fabricacao)],
          ['Referência de tempo de uso', rotulo('referencia_tempo', k.tempo_uso_referencia)]
        ]
        : [['Vínculo', 'Carga sem contêiner alocado']]
    },
    {
      titulo: '4. Resumo do fluxo operacional',
      campos: [
        ['Status no fluxo', rotulo('status_fluxo', c.status_fluxo)],
        ['Resultado da inspeção', rotulo('resultado_inspecao', c.resultado_inspecao)],
        ['Porto de descarga', textoOu(c.porto_descarga)],
        ['Destino', textoOu(c.destino)],
        ['Motivo da recusa', textoOu(c.motivo_recusa)]
      ]
    }
  ];
}
