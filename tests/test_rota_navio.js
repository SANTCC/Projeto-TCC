#!/usr/bin/env node
/**
 * Regressão (A2 — Backlog NexusPort): rota marítima da PRÓXIMA viagem por navio.
 *
 * Usa embarcacoes.html + js/pages/embarcacoes.js em jsdom, com o dublê de banco
 * (tests/fake-supabase-db.js):
 *   - cada embarcação tem o botão "Rota", que abre o seletor com origem E destino;
 *   - origem e destino vêm das rotas cadastradas no Supabase e nada é pré-selecionado;
 *   - a "próxima rota" nunca mostra origem = porto onde o navio está sem escolha
 *     (o trecho já concluído, ex.: Paranaguá ➔ Santos, não vale como próxima viagem);
 *   - a escolha é gravada em public.navios (porto_origem / porto_destino) antes da tela;
 *   - navio em trânsito não troca de rota e rota não cadastrada é recusada (RN 9);
 *   - A3: "Liberar Saída" sem destino definido abre o seletor e mantém a saída bloqueada;
 *     com a rota definida, "Liberar Saída" funciona.
 *
 * Executar: node tests/test_rota_navio.js
 */
const H = require('./webmcp-harness');
const { log, check, resumo, aguardar, sessao, criarJanela, prontoDom, htmlDaPagina } = H;
const { criarBancoFalso } = require('./fake-supabase-db');

const UUID = (n) => `11111111-0000-0000-0000-00000000000${n}`;

function bancoBase() {
  return criarBancoFalso({
    rotas_maritimas: [
      { id: 'r1', origem: 'Porto de Santos', destino: 'Porto de Paranaguá', distancia_km: 100 },
      { id: 'r2', origem: 'Porto de Santos', destino: 'Porto de Roterdã', distancia_km: 10200 },
      { id: 'r3', origem: 'Porto de Paranaguá', destino: 'Porto de Roterdã', distancia_km: 9000 }
    ],
    navios: [
      // Voltou de Paranaguá (trecho concluído) e está atracado em Santos: sem próxima viagem
      { id: UUID(1), nome: 'Navio Santos', numero_imo: 'IMO6000001', porto_origem: 'Porto de Paranaguá', porto_destino: 'Porto de Santos', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' },
      // Atracado em Santos com a rota do cadastro: próxima viagem já definida
      { id: UUID(2), nome: 'Navio Pronto', numero_imo: 'IMO6000002', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã', localizacao: 'DENTRO_DO_PORTO', estado_operacional: 'OPERANTE' },
      // Chegou ao porto de destino (Paranaguá): a próxima viagem parte de Paranaguá
      { id: UUID(3), nome: 'Navio Destino', numero_imo: 'IMO6000003', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Paranaguá', localizacao: 'NO_PORTO_DE_DESTINO', estado_operacional: 'OPERANTE' },
      // Em trânsito: a viagem atual está em andamento
      { id: UUID(4), nome: 'Navio Trânsito', numero_imo: 'IMO6000004', porto_origem: 'Porto de Santos', porto_destino: 'Porto de Roterdã', localizacao: 'FORA_DO_PORTO', data_saida: new Date(Date.now() - 3600 * 1000).toISOString(), estado_operacional: 'OPERANTE' }
    ],
    bercos: [], containers: [], cargas: [], guindastes: [], manutencoes: [], historico_manutencoes: []
  });
}

const janelas = [];

async function carregar(banco) {
  let w;
  const janela = criarJanela({
    url: 'https://nexusport.test/embarcacoes.html',
    html: htmlDaPagina('embarcacoes.html'),
    session: sessao('SUPERVISOR_GERENTE_OPERACOES'),
    storage: { nexus_navios_list: [], nexus_bercos_list: [], nexus_containers_list: [], nexus_guindastes_list: [], nexus_cargas_fluxo: [] },
    scripts: [
      'js/security.js',
      'js/session-cookies.js',
      'js/supabase-client.js',
      'js/auth-guard.js',
      (win) => {
        w = win;
        win.currentUserSession = win.NexusAuth.getSession();
        win.nexusSupabase = banco;
        win.NexusRepository = {
          getNavios: async () => [], getContainers: async () => [], getGuindastes: async () => [],
          getSupabase: () => banco, notifyChange() {}, invalidarLeiturasCargas() {}
        };
        win.nexusConfirm = async () => true;
      },
      'js/vision-layer.js',
      'js/layout.js',
      (win) => {
        win.mostrarFeedback = (tipo, titulo, msg) => { win.__feedbacks = (win.__feedbacks || []).concat([{ tipo, titulo, msg }]); };
        win.nexusConfirm = async () => true;
      },
      'js/padronizacao-codigos.js',
      'js/pages/embarcacoes.js'
    ]
  });
  w = janela.w;
  janelas.push(janela);
  await prontoDom(w);
  await aguardar(400);
  return { janela, w };
}

const ultimo = (w) => (w.__feedbacks || []).slice(-1)[0] || {};
const porImo = (banco, imo) => banco.tabelas.navios.find(n => n.numero_imo === imo) || {};
const linhaDoNavio = (w, nome) => Array.from(w.document.querySelectorAll('#embarcacoesGpsTableBody tr'))
  .find((tr) => tr.textContent.includes(nome)) || null;
const modalAberto = (w) => !w.document.getElementById('definirRotaModal').classList.contains('hidden');
const valoresDoSelect = (sel) => Array.from(sel.options).map((o) => o.value);
const trocarSelecao = (w, sel, valor) => { sel.value = valor; sel.dispatchEvent(new w.Event('change', { bubbles: true })); };

async function main() {
  const banco = bancoBase();
  const { w } = await carregar(banco);

  log('\n1. Botão "Rota" por navio e coluna da próxima viagem');
  const botoesRota = Array.from(w.document.querySelectorAll('#embarcacoesGpsTableBody button'))
    .filter((b) => /Rota/.test(b.textContent));
  check('cada embarcação tem o botão "Rota" (seletor por navio)', botoesRota.length === 4, `botões: ${botoesRota.length}`);
  const habilitados = botoesRota.filter((b) => !b.disabled);
  check('navio atracado no terminal tem o botão habilitado, chamando o seletor da página',
    habilitados.length === 2 && habilitados.every((b) => /window\.definirRotaNavio\(/.test(b.getAttribute('onclick') || '')),
    `habilitados: ${habilitados.length}`);
  const desabilitados = botoesRota.filter((b) => b.disabled);
  check('navio em viagem / no porto de destino fica com o botão desabilitado e com motivo',
    desabilitados.length === 2 && desabilitados.every((b) => b.getAttribute('aria-disabled') === 'true' && /atracada/.test(b.getAttribute('title') || '')),
    `desabilitados: ${desabilitados.length}`);

  const linhaSantos = linhaDoNavio(w, 'Navio Santos');
  const textoSantos = linhaSantos ? linhaSantos.textContent : '';
  check('navio atracado em Santos (trecho concluído) mostra "Próxima rota não definida"', /Próxima rota não definida/.test(textoSantos), textoSantos.slice(0, 160));
  check('a próxima rota desse navio NÃO exibe o porto onde ele está como origem sem escolha', !/Paranaguá/.test(textoSantos), textoSantos.slice(0, 160));
  check('navio com rota escolhida mostra a próxima viagem e a distância',
    /Próxima viagem/.test(linhaDoNavio(w, 'Navio Pronto').textContent) && /10200/.test(linhaDoNavio(w, 'Navio Pronto').textContent), linhaDoNavio(w, 'Navio Pronto').textContent.slice(0, 160));

  log('\n2. Seletor: origem e destino vêm do Supabase, nada pré-selecionado');
  await w.definirRotaNavio('IMO6000001');
  await aguardar(50);
  check('modal do seletor de rota abre', modalAberto(w));
  const origemSel = w.document.getElementById('definirRotaOrigemSelect');
  const destinoSel = w.document.getElementById('definirRotaDestinoSelect');
  check('opções de origem são os portos das rotas cadastradas',
    valoresDoSelect(origemSel).join('|') === '|Porto de Paranaguá|Porto de Roterdã|Porto de Santos', valoresDoSelect(origemSel).join('|'));
  check('origem começa SEM seleção (o sistema não presume o porto atual)', origemSel.value === '');
  check('destino começa desabilitado e sem opções', destinoSel.disabled === true && valoresDoSelect(destinoSel).length === 1);

  trocarSelecao(w, origemSel, 'Porto de Santos');
  check('destino lista só portos com rota a partir da origem escolhida',
    valoresDoSelect(destinoSel).join('|') === '|Porto de Paranaguá|Porto de Roterdã', valoresDoSelect(destinoSel).join('|'));
  check('destino fica habilitado depois da origem', destinoSel.disabled === false);

  log('\n3. Destino sem rota cadastrada é recusado (RN 9)');
  const forjada = w.document.createElement('option');
  forjada.value = 'Porto de Nárnia';
  destinoSel.appendChild(forjada);
  trocarSelecao(w, destinoSel, 'Porto de Nárnia');
  w.document.getElementById('confirmarDefinirRotaBtn').click();
  await aguardar(80);
  check('rota sem cadastro não altera o navio no banco', porImo(banco, 'IMO6000001').porto_destino === 'Porto de Santos', JSON.stringify(porImo(banco, 'IMO6000001')));
  check('usuário é informado que a rota não existe', ultimo(w).titulo === 'Rota Não Cadastrada', JSON.stringify(ultimo(w)));
  check('modal continua aberto para corrigir a escolha', modalAberto(w));

  log('\n3b. Origem diferente do porto onde a embarcação está é recusada');
  const antesOrigem = JSON.stringify(porImo(banco, 'IMO6000001'));
  trocarSelecao(w, origemSel, 'Porto de Paranaguá');
  trocarSelecao(w, destinoSel, 'Porto de Roterdã');
  w.document.getElementById('confirmarDefinirRotaBtn').click();
  await aguardar(80);
  check('navio atracado em Santos não aceita origem em outro porto', JSON.stringify(porImo(banco, 'IMO6000001')) === antesOrigem, JSON.stringify(porImo(banco, 'IMO6000001')));
  check('usuário é informado da origem inválida', ultimo(w).titulo === 'Origem Inválida', JSON.stringify(ultimo(w)));
  check('aviso do modal orienta a escolher a origem correta', /parte do porto atual/.test(w.document.getElementById('definirRotaAviso').textContent), w.document.getElementById('definirRotaAviso').textContent);
  trocarSelecao(w, origemSel, 'Porto de Santos');

  log('\n4. Escolha de rota válida é gravada no Supabase (banco antes da tela)');
  trocarSelecao(w, destinoSel, 'Porto de Paranaguá');
  w.document.getElementById('confirmarDefinirRotaBtn').click();
  await aguardar(120);
  const noBanco = porImo(banco, 'IMO6000001');
  check('banco: porto_origem/porto_destino atualizados', noBanco.porto_origem === 'Porto de Santos' && noBanco.porto_destino === 'Porto de Paranaguá', JSON.stringify(noBanco));
  const noCache = JSON.parse(w.localStorage.getItem('nexus_navios_list')).find(n => n.imo === 'IMO6000001') || {};
  check('cache local reflete a rota escolhida', noCache.origem === 'Porto de Santos' && noCache.destino === 'Porto de Paranaguá', JSON.stringify(noCache));
  check('modal fecha após gravar', !modalAberto(w));
  check('feedback de sucesso informa a próxima viagem', ultimo(w).titulo === 'Rota Definida', JSON.stringify(ultimo(w)));
  const textoSantosDepois = linhaDoNavio(w, 'Navio Santos').textContent;
  check('tabela passa a mostrar a próxima viagem escolhida', /Próxima viagem/.test(textoSantosDepois) && /Porto de Paranaguá/.test(textoSantosDepois), textoSantosDepois.slice(0, 160));

  log('\n5. Com a rota definida, "Liberar Saída" funciona (e sem ela ficava bloqueado)');
  await w.liberarNavioPeloDiretor('IMO6000001', { confirmado: true });
  await aguardar(150);
  check('navio sai do porto após a rota escolhida', porImo(banco, 'IMO6000001').localizacao === 'FORA_DO_PORTO', JSON.stringify(porImo(banco, 'IMO6000001')));
  check('feedback de liberação', ultimo(w).titulo === 'Navio Liberado', JSON.stringify(ultimo(w)));

  log('\n6. Navio fora do terminal não troca de rota (viagem em curso / porto de destino)');
  await w.definirRotaNavio('IMO6000004');
  await aguardar(50);
  check('navio em viagem tem a troca recusada', ultimo(w).titulo === 'Embarcação em Viagem', JSON.stringify(ultimo(w)));
  check('modal não abre para navio em viagem', !modalAberto(w));

  const antesDestino = JSON.stringify(porImo(banco, 'IMO6000003'));
  await w.definirRotaNavio('IMO6000003');
  await aguardar(50);
  check('navio no porto de destino tem a troca recusada', ultimo(w).titulo === 'Embarcação no Porto de Destino', JSON.stringify(ultimo(w)));
  check('mensagem indica autorizar o retorno ao porto de origem', /Autorize o retorno/.test(ultimo(w).msg || ''), JSON.stringify(ultimo(w)));
  check('rota do navio no porto de destino não é alterada', JSON.stringify(porImo(banco, 'IMO6000003')) === antesDestino);
  check('modal não abre para navio no porto de destino', !modalAberto(w));

  log('\n7. A3 — "Liberar Saída" sem destino definido abre a definição e mantém a saída bloqueada');
  const banco2 = bancoBase();
  banco2.tabelas.navios = banco2.tabelas.navios.filter(n => n.numero_imo === 'IMO6000001');
  const { w: w2 } = await carregar(banco2);
  await w2.liberarNavioPeloDiretor('IMO6000001', { confirmado: true });
  await aguardar(150);
  check('saída bloqueada com "Próximo Destino Não Definido"', ultimo(w2).titulo === 'Próximo Destino Não Definido', JSON.stringify(ultimo(w2)));
  check('o seletor de rota abre no próprio fluxo de liberação (definir o destino ANTES de sair)', modalAberto(w2));
  check('mensagem indica o botão "Rota" e como retomar a liberação',
    /botão "Rota"/.test(ultimo(w2).msg || '') && /Liberar Saída" novamente/.test(ultimo(w2).msg || ''), JSON.stringify(ultimo(w2)));
  const origemA3 = w2.document.getElementById('definirRotaOrigemSelect');
  const destinoA3 = w2.document.getElementById('definirRotaDestinoSelect');
  check('seletor aberto pelo fluxo de saída também não pré-seleciona a origem', origemA3.value === '' && destinoA3.value === '');
  check('navio continua atracado em Santos depois da recusa', porImo(banco2, 'IMO6000001').localizacao === 'DENTRO_DO_PORTO');

  trocarSelecao(w2, origemA3, 'Porto de Santos');
  trocarSelecao(w2, destinoA3, 'Porto de Paranaguá');
  w2.document.getElementById('confirmarDefinirRotaBtn').click();
  await aguardar(150);
  check('destino escolhido no fluxo é gravado no Supabase', porImo(banco2, 'IMO6000001').porto_destino === 'Porto de Paranaguá', JSON.stringify(porImo(banco2, 'IMO6000001')));
  check('a liberação não acontece sozinha: definir a rota não libera a saída', porImo(banco2, 'IMO6000001').localizacao === 'DENTRO_DO_PORTO');
  await w2.liberarNavioPeloDiretor('IMO6000001', { confirmado: true });
  await aguardar(150);
  check('com o destino definido, "Liberar Saída" conclui a liberação', porImo(banco2, 'IMO6000001').localizacao === 'FORA_DO_PORTO' && ultimo(w2).titulo === 'Navio Liberado', JSON.stringify(ultimo(w2)));

  log('\n8. Destino definido sem rota cadastrada: bloqueio da RN 9 sem abrir o seletor');
  const banco3 = bancoBase();
  banco3.tabelas.navios = banco3.tabelas.navios.filter(n => n.numero_imo === 'IMO6000002');
  banco3.tabelas.rotas_maritimas = banco3.tabelas.rotas_maritimas.filter(r => r.id !== 'r2');
  const { w: w3 } = await carregar(banco3);
  await w3.liberarNavioPeloDiretor('IMO6000002', { confirmado: true });
  await aguardar(150);
  check('saída recusada com a regra de negócio RN 9', ultimo(w3).titulo === 'Rota Não Encontrada' && /RN 9/.test(ultimo(w3).msg || ''), JSON.stringify(ultimo(w3)));
  check('seletor não abre quando o destino já está definido e só falta cadastrar a rota', !modalAberto(w3));
  check('navio continua atracado em Santos', porImo(banco3, 'IMO6000002').localizacao === 'DENTRO_DO_PORTO');

  log('\n9. Sem nenhuma rota marítima no Supabase a saída fica bloqueada com o motivo');
  const banco4 = bancoBase();
  banco4.tabelas.navios = banco4.tabelas.navios.filter(n => n.numero_imo === 'IMO6000001');
  banco4.tabelas.rotas_maritimas = [];
  const { w: w4 } = await carregar(banco4);
  await w4.liberarNavioPeloDiretor('IMO6000001', { confirmado: true });
  await aguardar(150);
  check('usuário é informado de que não há rota cadastrada', ultimo(w4).titulo === 'Sem Rotas Cadastradas', JSON.stringify(ultimo(w4)));
  check('sem rotas o seletor não abre (não há o que escolher)', !modalAberto(w4));
  check('navio continua atracado em Santos', porImo(banco4, 'IMO6000001').localizacao === 'DENTRO_DO_PORTO');

  janelas.forEach(j => { try { j.w.close(); } catch (e) { /* já fechada */ } });
  const r = resumo();
  log(`\nResultado: ${r.total - r.falhas}/${r.total} verificações aprovadas.`);
  if (r.falhas > 0) {
    process.stdout.write(`❌ ${r.falhas} verificação(ões) falharam.\n`);
    process.exit(1);
  }
  log('✅ Todas as verificações da rota da próxima viagem passaram.');
  process.exit(0);
}

main().catch((e) => {
  process.stdout.write(`❌ Erro no teste: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
