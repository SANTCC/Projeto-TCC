/**
 * Handler HTTP do relatório PDF (Backlog 3, item B). Ligado ao Deno em index.ts.
 *
 * POST { carga_id, codigo_individual } → application/pdf
 *   - Identidade: o app usa sessão própria (codigo_individual), não Supabase Auth. Como em panic-alert,
 *     a função valida o funcionário ativo e o cargo dentro da função (funcionarios, service role).
 *   - Dados: lidos no banco pelo servidor; o cliente não envia valores do relatório.
 *   - Cache: o arquivo é `<sha256 do modelo>.pdf` no bucket privado relatorios-pdf. Mesmo conteúdo,
 *     mesmo arquivo (X-Relatorio-Cache: HIT). Se a gravação falhar, o PDF é entregue assim mesmo.
 */
import { BUCKET, CARGOS_PERMITIDOS, ehUuid, hashModelo, montarModelo } from './relatorio.js';
import { gerarPdfRelatorio } from './pdf.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition, X-Relatorio-Cache, X-Relatorio-Hash, X-Relatorio-Versao'
};
const LIMITE_CORPO_BYTES = 4096;

const SELECAO_NAVIO = 'nome, numero_imo, porto_origem, porto_destino, data_saida';
const SELECAO_CONTAINER = [
  'numero_identificacao, material_carregado, estado, data_fabricacao,',
  `tempo_uso_referencia, navios:navio_id(${SELECAO_NAVIO})`
].join(' ');
const SELECAO_CARGA = [
  'id, qr_code_url, natureza, material, quantidade, peso, volume, valor_declarado, destino, porto_descarga,',
  'status_fluxo, resultado_inspecao, motivo_recusa, data_entrada, data_saida,',
  'navio_nome_historico, container_identificacao_historico,',
  `navios:navio_id(${SELECAO_NAVIO}),`,
  `containers:container_id(${SELECAO_CONTAINER}),`,
  'agendamentos(data_prevista_entrega)'
].join(' ');

async function enriquecerDadosHistoricosCarga(admin, linha) {
  if (!linha || !admin || typeof admin.from !== 'function') return linha;
  const enriquecida = { ...linha };
  if (!enriquecida.containers && enriquecida.container_identificacao_historico) {
    try {
      const ident = String(enriquecida.container_identificacao_historico).trim();
      if (ident) {
        const { data: contHist } = await admin
          .from('containers')
          .select(SELECAO_CONTAINER)
          .eq('numero_identificacao', ident)
          .maybeSingle();
        if (contHist) enriquecida.containers = contHist;
      }
    } catch (e) { /* consulta complementar opcional */ }
  }
  const navioDoContainer = enriquecida.containers && enriquecida.containers.navios;
  if (!enriquecida.navios && !navioDoContainer && enriquecida.navio_nome_historico) {
    try {
      const nomeNavio = String(enriquecida.navio_nome_historico).trim();
      if (nomeNavio) {
        const { data: navioHist } = await admin
          .from('navios')
          .select(SELECAO_NAVIO)
          .eq('nome', nomeNavio)
          .maybeSingle();
        if (navioHist) enriquecida.navios = navioHist;
      }
    } catch (e) { /* consulta complementar opcional */ }
  }
  return enriquecida;
}

function erro(status, mensagem) {
  return new Response(JSON.stringify({ erro: mensagem }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

/**
 * Cria o handler. `criarCliente(url, chave, opcoes)` é o createClient do supabase-js;
 * `lib` é { PDFDocument, StandardFonts, rgb } de pdf-lib; `env(nome)` lê variáveis de ambiente.
 */
export function criarHandler({ criarCliente, lib, env }) {
  return async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return erro(405, 'Método não permitido.');

    const url = env('SUPABASE_URL');
    const chave = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
    if (!url || !chave) return erro(500, 'Configuração do servidor ausente.');

    const texto = await req.text();
    if (texto.length > LIMITE_CORPO_BYTES) return erro(413, 'Requisição grande demais.');
    let corpo;
    try {
      corpo = JSON.parse(texto);
    } catch (e) {
      return erro(400, 'Corpo da requisição inválido.');
    }
    const cargaId = corpo && corpo.carga_id;
    const codigo = corpo && typeof corpo.codigo_individual === 'string' ? corpo.codigo_individual.trim() : '';
    if (!ehUuid(cargaId)) return erro(400, 'Identificador da carga inválido.');
    if (codigo.length < 1 || codigo.length > 64) return erro(400, 'Código individual inválido.');

    const admin = criarCliente(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: funcionario, error: erroFuncionario } = await admin
      .from('funcionarios')
      .select('id, cargo, ativo')
      .eq('codigo_individual', codigo)
      .maybeSingle();
    if (erroFuncionario) return erro(500, 'Falha ao validar o acesso.');
    if (!funcionario || funcionario.ativo !== true || !CARGOS_PERMITIDOS.includes(funcionario.cargo)) {
      return erro(403, 'Acesso negado para emitir este relatório.');
    }

    const { data: linhaBruta, error: erroCarga } = await admin
      .from('cargas')
      .select(SELECAO_CARGA)
      .eq('id', cargaId)
      .maybeSingle();
    if (erroCarga) return erro(500, 'Falha ao consultar a carga.');
    if (!linhaBruta) return erro(404, 'Carga não encontrada.');

    const linha = await enriquecerDadosHistoricosCarga(admin, linhaBruta);
    const modelo = montarModelo(linha);
    const hash = await hashModelo(modelo);
    const caminho = `${hash}.pdf`;
    const armazenamento = admin.storage.from(BUCKET);

    let bytes = null;
    let cache = 'MISS';
    const { data: emCache, error: erroLeitura } = await armazenamento.download(caminho);
    if (!erroLeitura && emCache) {
      bytes = new Uint8Array(await emCache.arrayBuffer());
      cache = 'HIT';
    }
    if (!bytes) {
      bytes = await gerarPdfRelatorio(modelo, hash, lib);
      const { error: erroGravacao } = await armazenamento.upload(caminho, bytes, {
        contentType: 'application/pdf',
        upsert: true
      });
      if (erroGravacao) console.warn('relatorio-pdf: cache não gravado:', erroGravacao.message || 'erro');
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Relatorio_A4_${cargaId}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Relatorio-Cache': cache,
        'X-Relatorio-Hash': hash,
        'X-Relatorio-Versao': '3'
      }
    });
  };
}
