/**
 * WebMCP — página Embarcações & GPS (js/webmcp/webmcp-embarcacoes.js) — NexusPort
 *
 * Navios, contêineres, guindastes, berços e rotas marítimas. Ações consequentes
 * validam o estado e a regra de negócio antes de pedir confirmação, pedem confirmação
 * do operador e verificam o resultado salvo antes de responder "ok".
 * Cadastros usam o próprio formulário da página (mesmas validações de IMO e padrões).
 * O navio não tem mais coordenadas GPS: a posição é a localização fictícia
 * (DENTRO_DO_PORTO, FORA_DO_PORTO, NO_PORTO_DE_DESTINO) + o berço ocupado.
 *
 * Carregamento: depois de webmcp-core, webmcp-ui, webmcp-dados e webmcp-global.
 */
(function (window, document) {
  'use strict';

  const W = window.NexusWebMCP;
  const D = window.NexusWebMCPDados;
  if (!W || !D) return;

  const G = D.GRUPOS;
  // Mesmos cargos que PAGE_PERMISSIONS['embarcacoes.html'].
  const CARGOS_PAGINA = ['PLANEJADOR_PATIO_NAVIOS'].concat(G.gestaoOperacional);
  const LOCALIZACOES = ['DENTRO_DO_PORTO', 'FORA_DO_PORTO', 'NO_PORTO_DE_DESTINO'];
  const ESQUEMA_IMO = {
    type: 'string', minLength: 9, maxLength: 12, pattern: '^\\s*[A-Za-z]{3}\\s?\\d{7}\\s*$',
    mensagemPadrao: 'deve ter 3 letras e 7 números (ex.: ABC1234567).',
    rotulo: 'IMO', description: 'Número IMO: 3 letras e 7 números, por exemplo ABC1234567.'
  };
  const ESQUEMA_CONTAINER = {
    type: 'string', minLength: 11, maxLength: 11, pattern: '^[A-Za-z]{4}\\d{7}$',
    mensagemPadrao: 'deve ter 4 letras e 7 números (ex.: MSCU1234567).',
    rotulo: 'Contêiner', description: 'Identificação ISO do contêiner: 4 letras e 7 números.'
  };
  const ESQUEMA_GUINDASTE = {
    type: 'string', minLength: 9, maxLength: 9, pattern: '^[A-Za-z]{3}\\d{3}[A-Za-z]{3}$',
    mensagemPadrao: 'deve seguir o padrão 3 letras, 3 números e 3 letras (ex.: ABC123DEF).',
    rotulo: 'Guindaste', description: 'Identificação do guindaste: 3 letras, 3 números e 3 letras.'
  };

  function imoNormalizado(valor) {
    return D.normalizarImo(valor);
  }

  async function navioPorImo(imo) {
    const alvo = imoNormalizado(imo);
    return (await D.navios()).find((n) => imoNormalizado(n.imo) === alvo) || null;
  }

  function naviosLocais() {
    return D.lerLista('nexus_navios_list');
  }

  function rotasDaPagina() {
    return typeof window.nexusEmbarcacoesRotas === 'function' ? window.nexusEmbarcacoesRotas() : [];
  }

  function falhaNaoConcluida(mensagem) {
    return { ok: false, codigo: 'NAO_CONCLUIDA', mensagem: mensagem || 'A ação não foi concluída. Veja a mensagem exibida ao operador.' };
  }

  function formularioOuErro(id) {
    const form = document.getElementById(id);
    if (!form) return { erro: { ok: false, codigo: 'INDISPONIVEL', mensagem: 'Formulário indisponível nesta página.' } };
    form.classList.remove('hidden');
    return { form };
  }

  function camposInvalidos(form) {
    if (form.checkValidity()) return null;
    const nomes = Array.from(form.querySelectorAll(':invalid')).map((c) => c.name || c.id);
    return { ok: false, codigo: 'FORMULARIO_INVALIDO', mensagem: `Campos inválidos: ${nomes.join(', ') || 'verifique o formulário'}.` };
  }

  function preencher(form, valores) {
    try {
      Object.keys(valores).forEach((nome) => {
        if (valores[nome] !== undefined) D.definirCampo(form, nome, valores[nome]);
      });
      return null;
    } catch (erro) {
      return { ok: false, codigo: 'ARGUMENTOS_INVALIDOS', mensagem: `Um valor não corresponde às opções da tela (${erro.message}).` };
    }
  }

  // ------------------------------------------------------------------
  // Leituras
  // ------------------------------------------------------------------
  const listarNavios = {
    nome: 'listar_navios',
    titulo: 'Listar navios',
    descricao: 'Lista os navios com localização, origem, destino e distância. Filtra por localização e nome.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        localizacao: { type: 'string', enum: LOCALIZACOES, rotulo: 'Localização', description: 'Situação do navio em relação ao porto.' },
        nome: { type: 'string', maxLength: 120, rotulo: 'Nome', description: 'Trecho do nome do navio.' },
        limite: { type: 'integer', minimum: 1, maximum: 25, rotulo: 'Limite', description: 'Quantidade máxima de itens (padrão 10).' }
      },
      additionalProperties: false
    },
    executar: async (args) => {
      let lista = await D.navios();
      if (args.localizacao) lista = lista.filter((n) => n.localizacao === args.localizacao);
      if (args.nome) lista = lista.filter((n) => D.contem(n.nome, args.nome));
      return {
        mensagem: `${lista.length} navio(s) encontrado(s).`,
        dados: { total: lista.length, itens: lista.slice(0, args.limite || 10).map((n) => D.resumirNavio(n)) }
      };
    }
  };

  const obterNavio = {
    nome: 'obter_navio',
    titulo: 'Detalhes do navio',
    descricao: 'Mostra os dados de um navio pelo IMO, o berço ocupado e a quantidade de contêineres e cargas vinculadas.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: { imo: ESQUEMA_IMO }, required: ['imo'], additionalProperties: false },
    executar: async (args) => {
      const navio = await navioPorImo(args.imo);
      if (!navio) return { ok: false, codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      const berco = D.bercos().find((b) => b.navio_imo === navio.imo) || null;
      const containers = D.containers().filter((c) => c.navio === navio.nome).length;
      const cargas = (await D.cargas()).filter((c) => c.navio === navio.nome && c.status !== 'CANCELADA').length;
      return {
        mensagem: `Navio ${navio.nome}.`,
        dados: Object.assign(D.resumirNavio(navio), {
          berco: berco ? D.resumirBerco(berco) : null,
          containers_vinculados: containers,
          cargas_vinculadas: cargas
        })
      };
    }
  };

  const listarBercos = {
    nome: 'listar_bercos',
    titulo: 'Listar berços',
    descricao: 'Lista os berços com estado (LIVRE ou OCUPADO) e o navio atracado, quando houver.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const itens = D.bercos().map((b) => D.resumirBerco(b));
      return { mensagem: `${itens.length} berço(s).`, dados: { livres: itens.filter((b) => b.estado === 'LIVRE').length, itens } };
    }
  };

  const listarContainers = {
    nome: 'listar_containers',
    titulo: 'Listar contêineres',
    descricao: 'Lista os contêineres com estado, navio vinculado e capacidade disponível (m³ de 75 m³).',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: async () => {
      const cargas = await D.cargas();
      const itens = D.containers().slice(0, 25).map((c) => Object.assign(D.resumirContainer(c), {
        disponivel_m3: D.disponibilidadeContainer(c.identificacao, cargas)
      }));
      return { mensagem: `${itens.length} contêiner(es).`, dados: { itens } };
    }
  };

  const listarGuindastes = {
    nome: 'listar_guindastes',
    titulo: 'Listar guindastes',
    descricao: 'Lista os guindastes e o estado de cada um (OPERANTE ou EM_MANUTENÇÃO).',
    anotacoes: { readOnlyHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const itens = D.guindastesEfetivos().map((g) => D.resumirGuindaste(g));
      return { mensagem: `${itens.length} guindaste(s).`, dados: { itens } };
    }
  };

  const listarTarefas = {
    nome: 'listar_tarefas_guindaste',
    titulo: 'Tarefas dos guindastes',
    descricao: 'Lista as tarefas de movimentação criadas para os guindastes (uma por carga movimentada).',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: {
      type: 'object',
      properties: {
        guindaste: { type: 'string', maxLength: 40, rotulo: 'Guindaste', description: 'Identificação do guindaste (opcional).' }
      },
      additionalProperties: false
    },
    executar: (args) => {
      let tarefas = D.tarefasGuindaste();
      if (args.guindaste) tarefas = tarefas.filter((t) => t.guindasteId === args.guindaste);
      const itens = tarefas.slice(0, 20).map((t) => ({
        guindaste: t.guindasteId || null, carga: t.cargaId || null, tipo: t.tipoCarga || null,
        destino: t.destino || null, criada_em: t.dataCriacao || null
      }));
      return { mensagem: `${itens.length} tarefa(s).`, dados: { itens } };
    }
  };

  const listarRotas = {
    nome: 'listar_rotas',
    titulo: 'Rotas marítimas',
    descricao: 'Lista as rotas marítimas cadastradas (origem, destino e distância). Saída de navio exige rota cadastrada.',
    anotacoes: { readOnlyHint: true, untrustedContentHint: true },
    cargos: CARGOS_PAGINA,
    esquema: { type: 'object', properties: {}, additionalProperties: false },
    executar: () => {
      const itens = rotasDaPagina().slice(0, 25).map((r) => ({ origem: r.origem || null, destino: r.destino || null, distancia_km: r.distancia_km || null }));
      return { mensagem: `${itens.length} rota(s).`, dados: { itens } };
    }
  };

  // ------------------------------------------------------------------
  // Cadastros (formulário da página + verificação salva)
  // ------------------------------------------------------------------
  const cadastrarNavio = {
    nome: 'cadastrar_navio',
    titulo: 'Cadastrar navio',
    descricao: 'Cadastra um navio pelo IMO único, com a localização (situação em relação ao porto; não há coordenadas GPS). Origem, destino e distância vêm da rota marítima cadastrada escolhida (não há distância manual). Navio DENTRO_DO_PORTO exige berço livre imediato (usa o primeiro livre se não informado). Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_NAVIO',
    esquema: {
      type: 'object',
      properties: {
        nome: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Nome', description: 'Nome do navio.' },
        imo: ESQUEMA_IMO,
        origem: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Origem', description: 'Porto de origem.' },
        destino: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Destino', description: 'Porto de destino.' },
        localizacao: { type: 'string', enum: LOCALIZACOES, rotulo: 'Localização', description: 'Situação inicial em relação ao porto.' },
        berco: { type: 'string', minLength: 2, maxLength: 40, rotulo: 'Berço', description: 'Berço de atracação imediata (obrigatório para DENTRO_DO_PORTO; omita para usar o primeiro berço livre).' }
      },
      required: ['nome', 'imo', 'origem', 'destino', 'localizacao'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.imo !== undefined && await navioPorImo(args.imo)) {
        return { codigo: 'IMO_DUPLICADO', mensagem: `Já existe navio com o IMO ${imoNormalizado(args.imo)}.` };
      }
      if (args.localizacao === 'DENTRO_DO_PORTO') {
        const bercos = D.bercos();
        if (args.berco !== undefined) {
          const alvo = bercos.find((b) => (b.nome || '') === args.berco);
          if (!alvo) return { codigo: 'BERCO_NAO_ENCONTRADO', mensagem: `Berço "${args.berco}" não existe no Terminal STS-01.` };
          if (alvo.estado === 'OCUPADO') return { codigo: 'BERCO_OCUPADO', mensagem: `O ${args.berco} já está ocupado pelo navio ${alvo.navio_nome || 'registrado'}.` };
        } else if (!bercos.some((b) => b.estado !== 'OCUPADO')) {
          return { codigo: 'BERCO_INDISPONIVEL', mensagem: 'Não há berço livre no Terminal STS-01 para um navio DENTRO_DO_PORTO.' };
        }
      }
      return null;
    },
    resumo: (args) => [
      `Cadastrar o navio ${args.nome} (IMO ${imoNormalizado(args.imo)}).`,
      `Rota ${args.origem} → ${args.destino} (distância da rota cadastrada) · situação ${args.localizacao}.`,
      args.localizacao === 'DENTRO_DO_PORTO' ? `Berço de atracação imediata: ${args.berco || 'primeiro livre'}.` : 'Sem berço (navio fora do porto).'
    ],
    executar: async (args) => {
      const f = formularioOuErro('navioForm');
      if (f.erro) return f.erro;
      const erroCampos = preencher(f.form, {
        navioNome: args.nome, navioImo: imoNormalizado(args.imo),
        navioLocalizacao: args.localizacao
      });
      if (erroCampos) return erroCampos;

      // Backlog 3 (rotas): origem, destino e distância vêm de uma rota marítima
      // já registrada — o agente escolhe, no select da tela, a rota que casa
      // com a origem/destino pedidos. A regra RN 9 é respeitada da mesma forma
      // que no uso humano do formulário.
      const rotaSel = f.form.querySelector('#navioRotaSelect');
      if (!rotaSel) {
        return { codigo: 'FORMULARIO_INCOMPLETO', mensagem: 'O formulário da página não expõe o select de rota marítima (#navioRotaSelect).' };
      }
      await D.esperar(() => rotaSel.options.length > 1, 4000);
      const origemAlvo = String(args.origem || '').trim().toLowerCase();
      const destinoAlvo = String(args.destino || '').trim().toLowerCase();
      const opcaoRota = Array.from(rotaSel.options).find((o, i) => {
        if (!o.value) return false;
        const rotulo = (o.textContent || '').toLowerCase();
        return rotulo.includes(origemAlvo) && rotulo.includes(destinoAlvo);
      });
      if (!opcaoRota) {
        return {
          codigo: 'ROTA_NAO_CADASTRADA',
          mensagem: `Não existe rota marítima registrada de "${args.origem}" para "${args.destino}". Peça à supervisão para cadastrar a rota na Gestão de Rotas Marítimas antes de registrar o navio.`
        };
      }
      rotaSel.value = opcaoRota.value;
      rotaSel.dispatchEvent(new Event('change', { bubbles: true }));

      // Berço OBRIGATÓRIO e imediato para DENTRO_DO_PORTO: a página exige o
      // select preenchido; o agente lista os berços livres (mesma fonte da
      // tela) e usa o pedido ou o primeiro livre.
      if (args.localizacao === 'DENTRO_DO_PORTO') {
        const bercoSel = f.form.querySelector('#navioBercoSelect');
        if (!bercoSel) {
          return { ok: false, codigo: 'FORMULARIO_INCOMPLETO', mensagem: 'O formulário da página não expõe o select de berço (#navioBercoSelect).' };
        }
        const livres = D.bercos().filter((b) => b.estado !== 'OCUPADO' && b.nome);
        if (livres.length === 0) {
          return { ok: false, codigo: 'BERCO_INDISPONIVEL', mensagem: 'Não há berço livre no Terminal STS-01 para um navio DENTRO_DO_PORTO.' };
        }
        while (bercoSel.firstChild) bercoSel.removeChild(bercoSel.firstChild);
        const vazio = document.createElement('option');
        vazio.value = '';
        vazio.textContent = 'Selecione o berço...';
        bercoSel.appendChild(vazio);
        livres.forEach((b) => {
          const opt = document.createElement('option');
          opt.value = b.nome;
          opt.textContent = b.nome;
          bercoSel.appendChild(opt);
        });
        const pedido = String(args.berco || '').trim();
        const escolhido = (pedido && livres.some((b) => b.nome === pedido)) ? pedido : livres[0].nome;
        bercoSel.disabled = false;
        bercoSel.value = escolhido;
        bercoSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const invalido = camposInvalidos(f.form);
      if (invalido) return invalido;
      const imo = imoNormalizado(args.imo);
      f.form.requestSubmit();
      const ok = await D.esperar(() => naviosLocais().some((n) => imoNormalizado(n.imo) === imo), 8000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Navio ${args.nome} cadastrado.`, dados: D.resumirNavio(naviosLocais().find((n) => imoNormalizado(n.imo) === imo)) };
    }
  };

  const cadastrarContainer = {
    nome: 'cadastrar_container',
    titulo: 'Cadastrar contêiner',
    descricao: 'Cadastra um contêiner pela identificação ISO (4 letras e 7 números), com tipo de carga e datas. Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_CONTAINER',
    esquema: {
      type: 'object',
      properties: {
        identificacao: ESQUEMA_CONTAINER,
        tipo: { type: 'string', minLength: 2, maxLength: 80, rotulo: 'Tipo de carga', description: 'Material ou tipo de carga do contêiner.' },
        data_fabricacao: { type: 'string', format: 'date', rotulo: 'Fabricação', description: 'Data de fabricação (AAAA-MM-DD).' },
        data_ultima_manutencao: { type: 'string', format: 'date', rotulo: 'Última manutenção', description: 'Data da última manutenção (AAAA-MM-DD), se houver.' },
        referencia_tempo: { type: 'string', enum: ['DATA_FABRICACAO', 'DATA_ULTIMA_MANUTENCAO'], rotulo: 'Referência', description: 'Data usada para calcular a manutenção preventiva.' }
      },
      required: ['identificacao', 'tipo', 'data_fabricacao', 'referencia_tempo'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.identificacao !== undefined && D.containers().some((c) => (c.identificacao || '').toUpperCase() === args.identificacao.toUpperCase())) {
        return { codigo: 'CONTAINER_DUPLICADO', mensagem: `O contêiner ${args.identificacao.toUpperCase()} já está cadastrado.` };
      }
      return null;
    },
    resumo: (args) => [`Cadastrar o contêiner ${args.identificacao.toUpperCase()} (${args.tipo}).`, `Referência de manutenção: ${args.referencia_tempo}.`],
    executar: async (args) => {
      const f = formularioOuErro('containerForm');
      if (f.erro) return f.erro;
      const erroCampos = preencher(f.form, {
        contIdentificacao: args.identificacao.toUpperCase(), contTipo: args.tipo, contFabricacao: args.data_fabricacao,
        contManutencao: args.data_ultima_manutencao, contRefTempo: args.referencia_tempo
      });
      if (erroCampos) return erroCampos;
      const invalido = camposInvalidos(f.form);
      if (invalido) return invalido;
      const id = args.identificacao.toUpperCase();
      f.form.requestSubmit();
      const ok = await D.esperar(() => D.containers().some((c) => (c.identificacao || '').toUpperCase() === id), 8000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Contêiner ${id} cadastrado.`, dados: D.resumirContainer(D.containers().find((c) => c.identificacao === id)) };
    }
  };

  const cadastrarGuindaste = {
    nome: 'cadastrar_guindaste',
    titulo: 'Cadastrar guindaste',
    descricao: 'Cadastra um guindaste ou pórtico pelo padrão ABC123DEF, com estado e data da última manutenção. Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_GUINDASTE',
    esquema: {
      type: 'object',
      properties: {
        identificacao: ESQUEMA_GUINDASTE,
        estado: { type: 'string', enum: ['OPERANTE', 'EM_MANUTENCAO'], rotulo: 'Estado', description: 'Estado inicial do guindaste.' },
        data_ultima_manutencao: { type: 'string', format: 'date', rotulo: 'Última manutenção', description: 'Data da última manutenção (AAAA-MM-DD).' }
      },
      required: ['identificacao', 'estado', 'data_ultima_manutencao'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.identificacao !== undefined && D.guindastes().some((g) => (g.identificacao || '').toUpperCase() === args.identificacao.toUpperCase())) {
        return { codigo: 'GUINDASTE_DUPLICADO', mensagem: `O guindaste ${args.identificacao.toUpperCase()} já está cadastrado.` };
      }
      return null;
    },
    resumo: (args) => [`Cadastrar o guindaste ${args.identificacao.toUpperCase()} em estado ${args.estado}.`],
    executar: async (args) => {
      const f = formularioOuErro('guindasteForm');
      if (f.erro) return f.erro;
      const erroCampos = preencher(f.form, {
        gndNumero: args.identificacao.toUpperCase(), gndDataManut: args.data_ultima_manutencao, gndEstado: args.estado
      });
      if (erroCampos) return erroCampos;
      const invalido = camposInvalidos(f.form);
      if (invalido) return invalido;
      const id = args.identificacao.toUpperCase();
      f.form.requestSubmit();
      const ok = await D.esperar(() => D.guindastes().some((g) => (g.identificacao || '').toUpperCase() === id), 8000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Guindaste ${id} cadastrado.`, dados: D.resumirGuindaste(D.guindastes().find((g) => g.identificacao === id)) };
    }
  };

  const cadastrarRota = {
    nome: 'cadastrar_rota',
    titulo: 'Cadastrar rota marítima',
    descricao: 'Cadastra uma rota marítima entre dois portos com distância em km. A saída de navios depende de rota cadastrada. Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    permissao: 'CADASTRAR_ROTA',
    esquema: {
      type: 'object',
      properties: {
        origem: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Origem', description: 'Porto de origem da rota.' },
        destino: { type: 'string', minLength: 2, maxLength: 120, rotulo: 'Destino', description: 'Porto de destino da rota.' },
        distancia_km: { type: 'number', minimum: 1, maximum: 50000, rotulo: 'Distância (km)', description: 'Distância em quilômetros.' }
      },
      required: ['origem', 'destino', 'distancia_km'],
      additionalProperties: false
    },
    precondicao: (args) => {
      if (args.origem !== undefined && args.destino !== undefined) {
        const existe = rotasDaPagina().some((r) => String(r.origem).toLowerCase() === args.origem.toLowerCase() && String(r.destino).toLowerCase() === args.destino.toLowerCase());
        if (existe) return { codigo: 'ROTA_DUPLICADA', mensagem: 'Já existe rota cadastrada entre estes portos.' };
      }
      return null;
    },
    resumo: (args) => [`Cadastrar rota ${args.origem} → ${args.destino} (${args.distancia_km} km).`],
    executar: async (args) => {
      const f = formularioOuErro('rotaForm');
      if (f.erro) return f.erro;
      const erroCampos = preencher(f.form, { rotaOrigem: args.origem, rotaDestino: args.destino, rotaDistancia: args.distancia_km });
      if (erroCampos) return erroCampos;
      const invalido = camposInvalidos(f.form);
      if (invalido) return invalido;
      f.form.requestSubmit();
      const ok = await D.esperar(() => rotasDaPagina().some((r) => r.origem === args.origem && r.destino === args.destino), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Rota ${args.origem} → ${args.destino} cadastrada.`, dados: { origem: args.origem, destino: args.destino, distancia_km: args.distancia_km } };
    }
  };

  // ------------------------------------------------------------------
  // Ações sobre navios, contêineres, guindastes e berços
  // ------------------------------------------------------------------
  const liberarSaida = {
    nome: 'liberar_saida_navio',
    titulo: 'Liberar saída de navio',
    descricao: 'Libera a saída de um navio atracado no porto, pela rota cadastrada (RN 9). Bloqueado em emergência. Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    permissao: 'LIBERAR_NAVIO',
    bloqueiaEmergencia: true,
    esquema: { type: 'object', properties: { imo: ESQUEMA_IMO }, required: ['imo'], additionalProperties: false },
    precondicao: async (args) => {
      if (args.imo === undefined) return null;
      const navio = await navioPorImo(args.imo);
      if (!navio) return { codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      if (navio.localizacao !== 'DENTRO_DO_PORTO') {
        return { codigo: 'ESTADO_INVALIDO', mensagem: `O navio ${navio.nome} não está no porto (situação: ${navio.localizacao}).` };
      }
      const origem = String(navio.origem || 'Porto de Santos').trim().toLowerCase();
      const destino = String(navio.destino || '').trim().toLowerCase();
      const rota = rotasDaPagina().find((r) => String(r.origem || '').trim().toLowerCase() === origem
        && String(r.destino || '').trim().toLowerCase() === destino);
      if (!rota) {
        return { codigo: 'ROTA_NAO_CADASTRADA', mensagem: `Não há rota cadastrada de ${navio.origem || 'Porto de Santos'} para ${navio.destino} (RN 9).` };
      }
      return null;
    },
    resumo: async (args) => {
      const navio = await navioPorImo(args.imo);
      if (!navio) return [];
      const rota = rotasDaPagina().find((r) => String(r.origem || '').toLowerCase() === String(navio.origem || 'Porto de Santos').toLowerCase()
        && String(r.destino || '').toLowerCase() === String(navio.destino || '').toLowerCase());
      return [
        `Liberar a saída do navio ${navio.nome} (IMO ${navio.imo}).`,
        `Rota cadastrada: ${navio.origem || 'Porto de Santos'} → ${navio.destino} (${rota ? rota.distancia_km : '?'} km).`,
        'Situação: DENTRO_DO_PORTO → FORA_DO_PORTO. O berço é liberado.'
      ];
    },
    executar: async (args) => {
      const imo = imoNormalizado(args.imo);
      await window.liberarNavioPeloDiretor(imo, { confirmado: true });
      const ok = await D.esperar(() => naviosLocais().some((n) => imoNormalizado(n.imo) === imo && n.localizacao === 'FORA_DO_PORTO'), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Saída do navio ${imo} liberada.`, dados: D.resumirNavio(naviosLocais().find((n) => imoNormalizado(n.imo) === imo)) };
    }
  };

  const autorizarRetorno = {
    nome: 'autorizar_retorno_navio',
    titulo: 'Autorizar retorno de navio',
    descricao: 'Autoriza o retorno de um navio que chegou ao porto de destino ao porto de origem. Bloqueado em emergência. Só Supervisor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.supervisao,
    permissao: 'LIBERAR_NAVIO',
    bloqueiaEmergencia: true,
    esquema: { type: 'object', properties: { imo: ESQUEMA_IMO }, required: ['imo'], additionalProperties: false },
    precondicao: async (args) => {
      if (args.imo === undefined) return null;
      const navio = await navioPorImo(args.imo);
      if (!navio) return { codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      if (navio.localizacao !== 'NO_PORTO_DE_DESTINO') {
        return { codigo: 'ESTADO_INVALIDO', mensagem: `O navio ${navio.nome} não está no porto de destino (situação: ${navio.localizacao}).` };
      }
      return null;
    },
    resumo: async (args) => {
      const navio = await navioPorImo(args.imo);
      return navio ? [`Autorizar o retorno do navio ${navio.nome} ao porto de origem (${navio.origem || '—'}).`] : [];
    },
    executar: async (args) => {
      const imo = imoNormalizado(args.imo);
      await window.autorizarRetornoNavio(imo, { confirmado: true });
      const ok = await D.esperar(() => naviosLocais().some((n) => imoNormalizado(n.imo) === imo && n.localizacao !== 'NO_PORTO_DE_DESTINO'), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Retorno do navio ${imo} autorizado.`, dados: D.resumirNavio(naviosLocais().find((n) => imoNormalizado(n.imo) === imo)) };
    }
  };

  const vincularBerco = {
    nome: 'vincular_navio_berco',
    titulo: 'Vincular navio a berço',
    descricao: 'Vincula um navio a um berço LIVRE. Se o navio já estava em outro berço, ele é liberado. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'ATUALIZAR_DADOS_NAVIO_CONTAINER',
    esquema: {
      type: 'object',
      properties: {
        imo: ESQUEMA_IMO,
        berco: { type: 'string', minLength: 1, maxLength: 60, rotulo: 'Berço', description: 'Nome de um berço livre (ver listar_bercos).' }
      },
      required: ['imo', 'berco'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.imo !== undefined) {
        if (!(await navioPorImo(args.imo))) return { codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      }
      if (args.berco !== undefined) {
        const berco = D.bercos().find((b) => b.nome === args.berco);
        if (!berco) return { codigo: 'BERCO_NAO_ENCONTRADO', mensagem: `Berço ${args.berco} não encontrado.` };
        if (berco.estado !== 'LIVRE') return { codigo: 'BERCO_OCUPADO', mensagem: `Berço ${args.berco} está ocupado.` };
      }
      return null;
    },
    resumo: async (args) => {
      const navio = await navioPorImo(args.imo);
      return [`Vincular o navio ${navio ? navio.nome : imoNormalizado(args.imo)} ao berço ${args.berco}.`, 'Berço passa a OCUPADO.'];
    },
    executar: async (args) => {
      const imo = imoNormalizado(args.imo);
      await window.vincularNavioABerco(imo, { confirmado: true, bercoNome: args.berco });
      const ok = await D.esperar(() => D.bercos().some((b) => b.nome === args.berco && b.navio_imo === imo), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Navio ${imo} vinculado ao berço ${args.berco}.`, dados: { imo, berco: args.berco } };
    }
  };

  const excluirNavio = {
    nome: 'excluir_navio',
    titulo: 'Excluir navio',
    descricao: 'Remove um navio do sistema pelo IMO e libera o berço ocupado. Ação destrutiva. Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_NAVIO',
    esquema: { type: 'object', properties: { imo: ESQUEMA_IMO }, required: ['imo'], additionalProperties: false },
    precondicao: async (args) => {
      if (args.imo !== undefined && !(await navioPorImo(args.imo))) {
        return { codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      }
      return null;
    },
    resumo: async (args) => {
      const navio = await navioPorImo(args.imo);
      const cargas = navio ? (await D.cargas()).filter((c) => c.navio === navio.nome && c.status !== 'CANCELADA').length : 0;
      return [
        `EXCLUIR o navio ${navio ? navio.nome : ''} (IMO ${imoNormalizado(args.imo)}).`,
        'O berço ocupado por ele será liberado. Esta ação não pode ser desfeita pelo agente.',
        `Cargas não canceladas vinculadas a este navio: ${cargas}.`
      ];
    },
    executar: async (args) => {
      const imo = imoNormalizado(args.imo);
      await window.excluirNavio(imo, { confirmado: true });
      const ok = await D.esperar(() => !naviosLocais().some((n) => imoNormalizado(n.imo) === imo), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Navio ${imo} excluído.`, dados: { imo } };
    }
  };

  const vincularContainer = {
    nome: 'vincular_container_navio',
    titulo: 'Vincular contêiner a navio',
    descricao: 'Vincula um contêiner a um navio cadastrado. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: CARGOS_PAGINA,
    permissao: 'ATUALIZAR_DADOS_NAVIO_CONTAINER',
    esquema: {
      type: 'object',
      properties: { identificacao: ESQUEMA_CONTAINER, imo: ESQUEMA_IMO },
      required: ['identificacao', 'imo'],
      additionalProperties: false
    },
    precondicao: async (args) => {
      if (args.identificacao !== undefined && !D.containers().some((c) => c.identificacao === args.identificacao.toUpperCase())) {
        return { codigo: 'CONTAINER_NAO_ENCONTRADO', mensagem: `Contêiner ${args.identificacao.toUpperCase()} não cadastrado.` };
      }
      if (args.imo !== undefined && !(await navioPorImo(args.imo))) {
        return { codigo: 'NAVIO_NAO_ENCONTRADO', mensagem: `Navio com IMO ${imoNormalizado(args.imo)} não encontrado.` };
      }
      return null;
    },
    resumo: async (args) => {
      const navio = await navioPorImo(args.imo);
      return [`Vincular o contêiner ${args.identificacao.toUpperCase()} ao navio ${navio ? navio.nome : imoNormalizado(args.imo)}.`, 'Verifica-se a capacidade do navio na tela.'];
    },
    executar: async (args) => {
      const id = args.identificacao.toUpperCase();
      const imo = imoNormalizado(args.imo);
      const navio = await navioPorImo(imo);
      await window.vincularContainerANavio(id, { confirmado: true, navioImo: imo });
      const ok = await D.esperar(() => D.containers().some((c) => c.identificacao === id && navio && c.navio === navio.nome), 4000);
      if (!ok) return falhaNaoConcluida('A vinculação não foi concluída (capacidade ou dados do navio). Veja a mensagem exibida ao operador.');
      return { mensagem: `Contêiner ${id} vinculado ao navio ${navio.nome}.`, dados: { identificacao: id, navio: navio.nome } };
    }
  };

  const excluirContainer = {
    nome: 'excluir_container',
    titulo: 'Excluir contêiner',
    descricao: 'Remove um contêiner do sistema. Ação destrutiva. Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_CONTAINER',
    esquema: { type: 'object', properties: { identificacao: ESQUEMA_CONTAINER }, required: ['identificacao'], additionalProperties: false },
    precondicao: (args) => {
      if (args.identificacao !== undefined && !D.containers().some((c) => c.identificacao === args.identificacao.toUpperCase())) {
        return { codigo: 'CONTAINER_NAO_ENCONTRADO', mensagem: `Contêiner ${args.identificacao.toUpperCase()} não cadastrado.` };
      }
      return null;
    },
    resumo: (args) => [`EXCLUIR o contêiner ${args.identificacao.toUpperCase()}.`, 'Esta ação não pode ser desfeita pelo agente.'],
    executar: async (args) => {
      const id = args.identificacao.toUpperCase();
      await window.excluirContainer(id, { confirmado: true });
      const ok = await D.esperar(() => !D.containers().some((c) => c.identificacao === id), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Contêiner ${id} excluído.`, dados: { identificacao: id } };
    }
  };

  const excluirGuindaste = {
    nome: 'excluir_guindaste',
    titulo: 'Excluir guindaste',
    descricao: 'Remove um guindaste do sistema. Ação destrutiva. Só Inspetor ou Direção. Exige confirmação.',
    anotacoes: { consequentialHint: true },
    cargos: G.inspecao,
    permissao: 'CADASTRAR_GUINDASTE',
    esquema: { type: 'object', properties: { identificacao: ESQUEMA_GUINDASTE }, required: ['identificacao'], additionalProperties: false },
    precondicao: (args) => {
      if (args.identificacao !== undefined && !D.guindastes().some((g) => (g.identificacao || '').toUpperCase() === args.identificacao.toUpperCase())) {
        return { codigo: 'GUINDASTE_NAO_ENCONTRADO', mensagem: `Guindaste ${args.identificacao.toUpperCase()} não cadastrado.` };
      }
      return null;
    },
    resumo: (args) => [`EXCLUIR o guindaste ${args.identificacao.toUpperCase()}.`, 'Esta ação não pode ser desfeita pelo agente.'],
    executar: async (args) => {
      const id = args.identificacao.toUpperCase();
      await window.excluirGuindaste(id, { confirmado: true });
      const ok = await D.esperar(() => !D.guindastes().some((g) => (g.identificacao || '').toUpperCase() === id), 4000);
      if (!ok) return falhaNaoConcluida();
      return { mensagem: `Guindaste ${id} excluído.`, dados: { identificacao: id } };
    }
  };

  const ferramentas = [
    listarNavios, obterNavio, listarBercos, listarContainers, listarGuindastes, listarTarefas, listarRotas,
    cadastrarNavio, cadastrarContainer, cadastrarGuindaste, cadastrarRota,
    liberarSaida, autorizarRetorno, vincularBerco, excluirNavio, vincularContainer, excluirContainer, excluirGuindaste
  ];

  D.quandoPronto(() => W.registrarPagina({ id: 'embarcacoes', arquivo: 'embarcacoes.html', ferramentas }));
})(window, document);
