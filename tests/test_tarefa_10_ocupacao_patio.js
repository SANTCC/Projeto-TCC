#!/usr/bin/env node
/**
 * Teste para a Tarefa 10:
 * Preenchimento automático do dashboard de ocupação do pátio.
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function bancoBase() {
  return criarBancoFalso({
    cargas: [
      { id: UUID(1), qr_code_url: 'QR-CRG-101', natureza: 'Geral', status_fluxo: 'ARMAZENAGEM', porto_descarga: 'Setor A' },
      { id: UUID(2), qr_code_url: 'QR-CRG-102', natureza: 'Grãos', status_fluxo: 'RECEBIMENTO_INSPECAO', porto_descarga: 'Setor B' },
      { id: UUID(3), qr_code_url: 'QR-CRG-103', natureza: 'Conteinerizada', status_fluxo: 'ENTREGUE', porto_descarga: 'Roterdã' }
    ],
    navios: [], containers: [], guindastes: [], manutencoes: []
  });
}

async function carregar(banco) {
  const janela = criarJanela({
    url: 'https://nexusport.test/dashboard.html',
    html: htmlDaPagina('dashboard.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: {},
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => {
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
      },
      'js/data-repository.js',
      'js/pages/dashboard.js'
    ]
  });
  await prontoDom(janela.w);
  await aguardar(100);
  return janela;
}

async function main() {
  log('\n[Tarefa 10] Verificando preenchimento do dashboard de ocupação do pátio');

  const banco = bancoBase();
  const { w } = await carregar(banco);

  const indic = await w.NexusRepository.buscarIndicadoresOperacionais();
  console.log('indic.ocupacaoPatio:', indic ? indic.ocupacaoPatio : null);

  log('1. Verificando cálculo de cargas ocupando o pátio...');
  check('Total de cargas no pátio é 2', indic && indic.ocupacaoPatio.ocupados === 2);
  check('Taxa de ocupação é 2%', indic && indic.ocupacaoPatio.taxa === 2);
  check('Lista de cargas no pátio possui 2 elementos', indic && indic.ocupacaoPatio.lista.length === 2);

  const elOcupacao = w.document.getElementById('cardOcupacaoPatioVal');
  check('Card de ocupação do pátio preenchido na interface', elOcupacao && elOcupacao.textContent.includes('2%'));

  log(`\nResultado: ${resumo().passaram}/${resumo().total} verificações aprovadas.`);
  if (resumo().falhas > 0) process.exit(1);

  console.log('✅ Tarefa 10 verificada com sucesso!');
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Erro fatal no teste da Tarefa 10:', err);
  process.exit(1);
});
