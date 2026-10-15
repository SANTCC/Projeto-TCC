/**
 * Lógica do Módulo Delegação de Supervisor (delegacao.html) - NexusPort
 * Gerencia a substituição temporária do Supervisor Titular garantindo o limite
 * rígido de apenas 1 substituto ativo por vez e suporte a revogação (RF 14 / T7.6 - T7.9).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.NexusAuth?.getSession();
  let acessoBloqueado = false;
  function autorizado(acao = 'DESIGNAR_SUBSTITUTO') {
    const atual = window.NexusAuth?.getSession();
    return !!session && !!atual && atual.codigo_individual === session.codigo_individual
      && NexusAuth.canAccessPage('delegacao.html') && NexusAuth.hasPermission(acao);
  }
  function verificarAcesso(acao) {
    if (autorizado(acao)) return true;
    if (!acessoBloqueado) {
      acessoBloqueado = true;
      window.dispatchEvent(new Event('nexus_permissions_changed'));
    }
    const main = document.querySelector('main');
    if (main) main.innerHTML = '<p role="alert" class="p-6 text-slate-600">Acesso restrito: esta sessão não pode criar ou revogar delegações. Retorne ao Painel Geral.</p>';
    return false;
  }
  if (!verificarAcesso()) return;
  window.addEventListener('focus', () => verificarAcesso());
  window.addEventListener('storage', event => {
    if (event.key === 'nexus_active_delegation' || event.key === null) verificarAcesso();
  });

  // Utilitário Anti-XSS (js/security.js) — codifica dados não confiáveis
  // antes de qualquer inserção em HTML.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);

  // Validador de estrutura de CPF (permite CPFs fictícios de 11 dígitos - Tarefa 5)
  function validarCPF(cpfStr) {
    if (!cpfStr) return false;
    const clean = String(cpfStr).replace(/\D/g, '');
    if (clean.length !== 11) return false;

    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(clean.charAt(i)) * (10 - i);
    let resto = 11 - (soma % 11);
    return true;
  }

  function aplicarMascaraCPF(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  // Aplicação da máscara preservando o cursor: reescrever o valor sem
  // reposicionar a seleção joga o cursor para o fim do campo e faz a correção
  // de um dígito no meio do CPF inserir os números no lugar errado.
  function aplicarMascaraCPFPreservandoCursor(input) {
    const anterior = input.value;
    const cursor = (input.selectionStart == null) ? anterior.length : input.selectionStart;
    const digitosAntes = anterior.slice(0, cursor).replace(/\D/g, '').length;
    const mascarado = aplicarMascaraCPF(anterior);
    if (mascarado === anterior) return; // nada mudou: não mexe na seleção

    input.value = mascarado;

    let novaPos = mascarado.length;
    if (digitosAntes === 0) {
      novaPos = 0;
    } else {
      let vistos = 0;
      for (let i = 0; i < mascarado.length; i++) {
        if (/\d/.test(mascarado[i])) {
          vistos += 1;
          if (vistos === digitosAntes) { novaPos = i + 1; break; }
        }
      }
    }
    try {
      input.setSelectionRange(novaPos, novaPos);
    } catch (err) { /* tipo de campo sem suporte a seleção */ }
  }

  const delegCpfInput = document.getElementById('delegSubstitutoCpf');
  if (delegCpfInput) {
    delegCpfInput.addEventListener('input', (e) => {
      aplicarMascaraCPFPreservandoCursor(e.target);
    });
  }

  const titularSelect = document.getElementById('delegSubstituidoNome');
  const titularAviso = document.getElementById('delegSubstituidoAviso');
  let titulares = [];
  let titularesRevisao = 0;
  const chavesTitularesLocais = new Map();

  async function carregarTitulares() {
    if (!verificarAcesso()) return;
    if (!titularSelect) return;
    const revisao = ++titularesRevisao;
    const selecionado = titularSelect.value;
    titularSelect.disabled = true;
    let lista = null;
    let local = true;
    if (window.nexusSupabase) {
      try {
        const consulta = () => window.nexusSupabase.from('funcionarios')
          .select('id, nome, cargo, matricula, ativo').eq('ativo', true)
          .order('nome', { ascending: true }).order('id');
        if (window.NexusRepository?.lerTodasAsLinhas) {
          lista = await window.NexusRepository.lerTodasAsLinhas(consulta);
        } else {
          const resultado = await consulta();
          if (!resultado.error && Array.isArray(resultado.data)) lista = resultado.data;
        }
        if (Array.isArray(lista)) local = false;
      } catch (e) { /* Sem banco: os nomes do cache ainda podem ser consultados. */ }
    }
    if (revisao !== titularesRevisao || !verificarAcesso()) return;
    if (!Array.isArray(lista)) {
      try { lista = JSON.parse(localStorage.getItem('nexus_func_list') || '[]'); } catch (e) { lista = []; }
    }
    titulares = (Array.isArray(lista) ? lista : []).filter(f => f.ativo !== false && f.nome && (f.id || f.matricula))
      .map(f => {
        if (!f.id && !chavesTitularesLocais.has(f.matricula)) chavesTitularesLocais.set(f.matricula, `local-${chavesTitularesLocais.size}`);
        return Object.assign({}, f, { chave: String(f.id || chavesTitularesLocais.get(f.matricula)) });
      })
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR') || a.chave.localeCompare(b.chave));
    const contagem = new Map();
    titulares.forEach(f => { const nome = normalizarNomeBusca(f.nome); contagem.set(nome, (contagem.get(nome) || 0) + 1); });
    titularSelect.replaceChildren();
    const vazio = document.createElement('option');
    vazio.value = ''; vazio.textContent = titulares.length ? 'Selecione o nome do funcionário' : 'Nenhum funcionário disponível';
    titularSelect.appendChild(vazio);
    titulares.forEach(f => {
      const opcao = document.createElement('option');
      opcao.value = f.chave;
      const homonimo = contagem.get(normalizarNomeBusca(f.nome)) > 1;
      opcao.textContent = `${f.nome} · ${f.cargo || 'Funcionário'}${homonimo ? ` · Referência ${f.chave}` : ''}`;
      titularSelect.appendChild(opcao);
    });
    if (titulares.some(f => f.chave === selecionado)) titularSelect.value = selecionado;
    titularSelect.disabled = titulares.length === 0;
    if (titularAviso) titularAviso.textContent = local
      ? 'Nomes do cache local. A gravação on-line confirmará o cadastro no servidor.'
      : 'Selecione o nome no cadastro. Nomes iguais têm referências distintas.';
  }

  // Autopreenchimento do substituto pelo NOME COMPLETO: ao digitar o nome, o
  // sistema sugere funcionários cadastrados (Supabase + cache local) e, ao
  // escolher um, preenche CPF e data de nascimento automaticamente.
  const delegNomeInput = document.getElementById('delegSubstitutoNome');
  const delegDataNascInput = document.getElementById('delegSubstitutoDataNasc');
  let delegNomesCache = null;
  let delegSugestTimer = null;

  function normalizarNomeBusca(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  async function carregarFuncionariosParaAutofill() {
    if (Array.isArray(delegNomesCache)) return delegNomesCache;
    const lista = [];
    const vistos = new Set();
    const push = (f) => {
      const nome = String(f.nome || '').trim();
      if (!nome) return;
      const chave = normalizarNomeBusca(nome) + '|' + String(f.matricula || f.cpf || '');
      if (vistos.has(chave)) return;
      vistos.add(chave);
      lista.push({
        nome,
        matricula: f.matricula || '',
        cargo: f.cargo_nome || f.cargo || '',
        cpf: String(f.cpf || f.documento || '').replace(/\D/g, ''),
        data_nascimento: f.data_nascimento || f.dataNascimento || ''
      });
    };
    try {
      const locais = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      locais.forEach(push);
    } catch (e) {}
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase.from('funcionarios').select('*').eq('ativo', true).order('nome', { ascending: true }).limit(200);
        if (!error && Array.isArray(data)) data.forEach(push);
      } catch (e) {
        console.warn('[NexusPort] Autofill de delegação: Supabase indisponível, usando cache local.', e);
      }
    }
    delegNomesCache = lista;
    return lista;
  }

  function formatarCpfDeleg(digitos) {
    const d = String(digitos || '').replace(/\D/g, '').slice(0, 11);
    if (d.length !== 11) return digitos || '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  if (delegNomeInput) {
    const wrapper = delegNomeInput.parentElement;
    if (wrapper) wrapper.classList.add('relative');
    const sugBox = document.createElement('div');
    sugBox.id = 'delegNomeSuggest';
    sugBox.className = 'hidden absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-900 border border-nexus-border dark:border-slate-700 rounded-xl shadow-xl text-xs';
    if (wrapper) wrapper.appendChild(sugBox);
    const esconder = () => sugBox.classList.add('hidden');

    async function montarSugestoesDeleg() {
      const termo = normalizarNomeBusca(delegNomeInput.value);
      if (termo.length < 2) { esconder(); return; }
      const lista = await carregarFuncionariosParaAutofill();
      const matches = lista
        .map(f => {
          const nomeN = normalizarNomeBusca(f.nome);
          let pontos = 0;
          if (nomeN === termo) pontos = 100;
          else if (nomeN.startsWith(termo)) pontos = 80;
          else if (nomeN.includes(termo)) pontos = 60;
          else if (termo.split(/\s+/).filter(Boolean).every(p => nomeN.includes(p))) pontos = 40;
          return { f, pontos };
        })
        .filter(m => m.pontos > 0)
        .sort((a, b) => b.pontos - a.pontos)
        .slice(0, 8);
      if (matches.length === 0) { esconder(); return; }
      sugBox.innerHTML = matches.map(({ f }, idx) => {
        const detalhe = [f.cargo].filter(Boolean).join(' • ') || 'Funcionário cadastrado';
        return `<button type="button" data-idx="${idx}" class="w-full text-left px-3 py-2 hover:bg-nexus-bg dark:hover:bg-slate-800 flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
          <span class="font-bold text-nexus-900 dark:text-white">${esc(f.nome)}</span>
          <span class="font-mono text-slate-600 dark:text-slate-400">${esc(detalhe)}</span>
        </button>`;
      }).join('');
      sugBox.classList.remove('hidden');
      sugBox.querySelectorAll('[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
          const escolhido = matches[parseInt(btn.getAttribute('data-idx'), 10)].f;
          delegNomeInput.value = escolhido.nome;
          if (delegCpfInput && escolhido.cpf) delegCpfInput.value = formatarCpfDeleg(escolhido.cpf);
          if (delegDataNascInput && escolhido.data_nascimento) {
            const iso = String(escolhido.data_nascimento).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) delegDataNascInput.value = iso;
          }
          esconder();
          if (window.mostrarFeedback) {
            window.mostrarFeedback('sucesso', 'Substituto Identificado', `CPF e data de nascimento preenchidos a partir do cadastro de ${escolhido.nome}. Confira a vigência e confirme a designação.`);
          }
        });
      });
    }

    delegNomeInput.addEventListener('input', () => {
      clearTimeout(delegSugestTimer);
      delegSugestTimer = setTimeout(montarSugestoesDeleg, 150);
    });
    delegNomeInput.addEventListener('blur', () => setTimeout(esconder, 150));
    delegNomeInput.addEventListener('focus', () => { if (delegNomeInput.value.trim().length >= 2) montarSugestoesDeleg(); });
  }

  const substitutoNome = document.getElementById('substitutoNome');
  const substitutoVigencia = document.getElementById('substitutoVigencia');
  const revogarBtn = document.getElementById('revogarDelegacaoBtn');
  const delegForm = document.getElementById('delegacaoForm');

  async function carregarDelegacaoAtiva() {
    if (!verificarAcesso()) return;
    let activeDeleg = null;

    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('delegacoes_supervisor')
          .select('*, supervisor:supervisor_titular_id(nome, matricula), substituto:substituto_id(nome, matricula)')
          .eq('ativo', true)
          .order('data_inicio', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!verificarAcesso()) return;
        if (error) {
          console.warn('[NexusPort] Erro ao buscar delegação ativa no Supabase:', error);
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Erro de Conexão Supabase', 'Não foi possível carregar as delegações do banco de dados: ' + error.message);
          }
        } else if (data) {
          const now = new Date();
          const fimDate = new Date(data.data_fim_previsto || data.data_fim);
          if (now <= fimDate) {
            const salvo = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
            const cadastros = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
            const funcionario = cadastros.find(f => f.id === data.supervisor_titular_id);
            const cadastroSubstituto = cadastros.find(f => f.id && f.id === data.substituto_id);
            const mesmoTitular = salvo?.referenciaFuncionario?.id === data.supervisor_titular_id;
            const nomeTitular = data.supervisor?.nome || (mesmoTitular && salvo.substituidoNome) || funcionario?.nome || 'Funcionário Substituído';
            const matriculaTitular = data.supervisor?.matricula || funcionario?.matricula || (mesmoTitular && salvo.substituidoMatricula) || '';
            activeDeleg = {
              id: data.id,
              supervisor: nomeTitular,
              substituidoNome: nomeTitular,
              substituidoMatricula: matriculaTitular,
              referenciaFuncionario: {tipo:'FUNCIONARIO', id:data.supervisor_titular_id || null, codigo:matriculaTitular || data.supervisor_titular_id, rotulo:nomeTitular, legado:true},
              substituidoId: data.supervisor_titular_id || null,
              substitutoId: data.substituto_id || null,
              substitutoMatricula: data.substituto?.matricula || cadastroSubstituto?.matricula
                || (salvo?.substitutoId && salvo.substitutoId === data.substituto_id ? salvo.substitutoMatricula : null),
              substitutoNome: data.substituto_nome || data.substituto?.nome || 'Substituto',
              substitutoCpf: data.substituto_cpf || '',
              substitutoDataNasc: data.substituto_data_nascimento || '',
              inicio: data.data_inicio,
              fim: data.data_fim_previsto || data.data_fim,
              rawDbId: data.id
            };
            localStorage.setItem('nexus_active_delegation', JSON.stringify(activeDeleg));
          } else {
            localStorage.removeItem('nexus_active_delegation');
            activeDeleg = null;
            await window.nexusSupabase.from('delegacoes_supervisor').update({ ativo: false }).eq('id', data.id);
          }
        } else {
          localStorage.removeItem('nexus_active_delegation');
          activeDeleg = null;
        }
      } catch (e) {
        console.warn('[NexusPort] Exceção ao buscar delegação ativa no Supabase:', e);
      }
    }

    if (!activeDeleg) {
      activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
      if (activeDeleg && activeDeleg.fim) {
        const now = new Date();
        if (now > new Date(activeDeleg.fim)) {
          localStorage.removeItem('nexus_active_delegation');
          activeDeleg = null;
        }
      }
    }

    if (!verificarAcesso()) return;
    updateDelegacaoUI(activeDeleg);
  }

  function updateDelegacaoUI(activeDeleg) {
    if (activeDeleg) {
      const substituidoTxt = activeDeleg.substituidoNome || activeDeleg.supervisor || 'Funcionário Substituído';
      const substitutoTxt = activeDeleg.substitutoNome || 'Funcionário Substituto';
      const cpfTxt = activeDeleg.substitutoCpf ? ` | CPF: ${activeDeleg.substitutoCpf}` : '';

      if (substitutoNome) {
        substitutoNome.textContent = `Substituído: ${substituidoTxt} ➔ Substituto: ${substitutoTxt}${cpfTxt}`;
      }
      if (substitutoVigencia) {
        substitutoVigencia.textContent = `Vigência: de ${new Date(activeDeleg.inicio).toLocaleString('pt-BR')} até ${new Date(activeDeleg.fim).toLocaleString('pt-BR')}`;
      }
      if (revogarBtn) revogarBtn.classList.remove('hidden');
    } else {
      if (substitutoNome) substitutoNome.textContent = 'Nenhum Substituto Ativo';
      if (substitutoVigencia) substitutoVigencia.textContent = 'Cada Supervisor Titular pode ter no máximo 1 substituto ativo por vez (RF 14).';
      if (revogarBtn) revogarBtn.classList.add('hidden');
    }
  }

  carregarDelegacaoAtiva();
  carregarTitulares();

  if (delegForm) {
    delegForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!verificarAcesso()) return;
      const activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
      if (activeDeleg) {
        const msg = 'REGRA DE NEGÓCIO (RF 14): Apenas 1 substituto ativo por Supervisor é permitido! Revogue a delegação atual antes de designar um novo.';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Limite de Substitutos', msg);
        return;
      }

      const titular = titulares.find(f => f.chave === titularSelect?.value);
      let substituidoMatricula = titular?.matricula || '';
      const substitutoNomeInput = document.getElementById('delegSubstitutoNome').value.trim();
      const substitutoCpf = document.getElementById('delegSubstitutoCpf').value.trim();
      const substitutoDataNasc = document.getElementById('delegSubstitutoDataNasc').value;
      const inicio = document.getElementById('delegDataInicio').value;
      const fim = document.getElementById('delegDataFim').value;

      if (!titular || titularSelect.disabled || !substitutoNomeInput || !substitutoCpf || !inicio || !fim) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Selecione o nome do funcionário substituído, os dados do substituto e a vigência.');
        return;
      }

      // Validação da estrutura de 11 dígitos do CPF do substituto (permite CPFs fictícios)
      if (!validarCPF(substitutoCpf)) {
        const msg = 'CPF INVÁLIDO: Informe um CPF válido no padrão XXX.XXX.XXX-XX com 11 dígitos (são permitidos CPFs fictícios)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Inválido', msg);
        return;
      }

      const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

      let supervisorId = isUUID(titular.id) ? titular.id : null;
      const cpfSubstituto = substitutoCpf.replace(/\D/g, '');
      const substitutoLocal = JSON.parse(localStorage.getItem('nexus_func_list') || '[]')
        .find(f => f.ativo !== false && String(f.cpf || f.documento || '').replace(/\D/g, '') === cpfSubstituto);
      let substitutoId = isUUID(substitutoLocal?.id) ? substitutoLocal.id : null;
      let substitutoMatricula = substitutoLocal?.matricula || null;
      let substituidoNomeStr = titular.nome;

      if (window.nexusSupabase) {
        // Nunca usar o ID da sessão como fallback para o funcionário escolhido.
        try {
          if (!supervisorId) throw new Error('Cadastro selecionado sem referência válida no servidor.');
          const { data: supData, error: supErro } = await window.nexusSupabase.from('funcionarios')
            .select('id, nome, matricula, ativo').eq('id', supervisorId).maybeSingle();
          if (!verificarAcesso()) return;
          if (supErro || !supData || supData.id !== supervisorId || supData.ativo === false || !supData.nome) {
            throw new Error('O funcionário selecionado não está disponível. Atualize a seleção.');
          }
          substituidoNomeStr = supData.nome;
          substituidoMatricula = supData.matricula || substituidoMatricula;
        } catch (erro) {
          if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Funcionário Não Confirmado', 'Não foi possível confirmar o funcionário selecionado no servidor. Atualize a seleção e tente novamente.');
          carregarTitulares();
          return;
        }
        try {
          substitutoId = null;
          substitutoMatricula = null;
          // CPF cadastrado identifica o substituto; nomes parciais/homônimos não são identidade.
          const { data: subData } = await window.nexusSupabase.from('funcionarios')
            .select('id, matricula').eq('cpf', cpfSubstituto).eq('ativo', true).maybeSingle();
          if (subData && subData.id) {
            substitutoId = subData.id;
            substitutoMatricula = subData.matricula || null;
          }
        } catch (e) {
          console.warn('Erro ao resolver IDs de funcionários para delegação:', e);
        }
      }

      if (!verificarAcesso()) return;
      const newDeleg = {
        substituidoMatricula,
        referenciaFuncionario: {tipo:'FUNCIONARIO', id:supervisorId, codigo:substituidoMatricula || supervisorId, rotulo:substituidoNomeStr, legado:true},
        substituidoNome: substituidoNomeStr,
        substitutoNome: substitutoNomeInput,
        substitutoCpf,
        substitutoDataNasc,
        substituidoId: supervisorId,
        substitutoId,
        substitutoMatricula,
        supervisor: substituidoNomeStr,
        inicio, fim, dataDesignacao: new Date().toISOString()
      };

      let insertedDelegId = null;
      if (window.nexusSupabase) {
        try {
          const payload = {
            data_inicio: new Date(inicio).toISOString(),
            data_fim_previsto: new Date(fim).toISOString(),
            substituto_nome: substitutoNomeInput,
            substituto_cpf: substitutoCpf,
            substituto_data_nascimento: substitutoDataNasc || null,
            ativo: true
          };
          if (supervisorId) payload.supervisor_titular_id = supervisorId;
          if (substitutoId) payload.substituto_id = substitutoId;

          const { data: insData, error: insErr } = await window.nexusSupabase.from('delegacoes_supervisor').insert(payload).select('id').single();

          if (insErr) {
            console.error('[NexusPort] Erro ao inserir delegação no Supabase:', insErr);
            if (window.mostrarFeedback) {
              window.mostrarFeedback('erro', 'Erro ao Salvar no Supabase', `Não foi possível registrar a delegação no banco de dados: ${insErr.message}`);
            }
            return;
          }

          if (insData && insData.id) {
            insertedDelegId = insData.id;
            newDeleg.rawDbId = insData.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao(substituidoMatricula, 'CRIACAO', { substituto: substitutoNomeInput, delegacao_id: insertedDelegId, inicio, fim }, newDeleg.referenciaFuncionario);
          }
        } catch (err) {
          console.error('[NexusPort] Exceção ao sincronizar delegação com Supabase:', err);
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Falha de Conexão', `Ocorreu uma falha ao comunicar com o Supabase: ${err.message || err}`);
          }
          return;
        }
      }

      localStorage.setItem('nexus_active_delegation', JSON.stringify(newDeleg));
      updateDelegacaoUI(newDeleg);

      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('DESIGNOU_SUBSTITUTO', substituidoMatricula, `Designou ${substitutoNomeInput} como substituto de ${substituidoNomeStr} para o período de ${inicio} até ${fim}`, newDeleg.referenciaFuncionario);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('delegacoes_supervisor');
      }

      delegForm.reset();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Substituto Designado', `Funcionário ${substitutoNomeInput} designado temporariamente como substituto de ${substituidoNomeStr} com poderes operacionais.`);
      }
    });
  }

  // opcoes (uso do agente WebMCP): { confirmado? } — a interface chama sem opções.
  async function revogarDelegacaoAtiva(opcoes) {
      if (!verificarAcesso('REVOGAR_DELEGACAO')) return false;
      const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Revogar Delegação', 'ATENÇÃO: Deseja REVOGAR IMEDIATAMENTE os poderes do substituto temporário?') : true;
      if (confirmou) {
        if (!verificarAcesso('REVOGAR_DELEGACAO')) return false;
        const activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || '{}');

        if (window.nexusSupabase) {
          try {
            const { error: revErr } = await window.nexusSupabase.from('delegacoes_supervisor')
              .update({ ativo: false, data_revogacao: new Date().toISOString() })
              .eq('ativo', true);

            if (revErr) {
              console.warn('[NexusPort] Erro ao revogar delegação no Supabase:', revErr);
              if (window.mostrarFeedback) {
                window.mostrarFeedback('erro', 'Erro ao Revogar no Banco', `Falha ao revogar delegação no Supabase: ${revErr.message}`);
              }
              return;
            }

            if (window.registrarLogAlteracao) {
              await window.registrarLogAlteracao(activeDeleg.substituidoMatricula, 'EDICAO', { ativo: false, delegacao_id: activeDeleg.rawDbId || null, data_revogacao: new Date().toISOString() }, activeDeleg.referenciaFuncionario || {tipo:'FUNCIONARIO',codigo:activeDeleg.substituidoMatricula,legado:true});
            }
          } catch (err) {
            console.warn('[NexusPort] Exceção ao revogar delegação no Supabase:', err);
            if (window.mostrarFeedback) {
              window.mostrarFeedback('erro', 'Falha de Conexão', `Ocorreu um erro ao revogar a delegação no Supabase: ${err.message || err}`);
            }
            return;
          }
        }

        localStorage.removeItem('nexus_active_delegation');
        updateDelegacaoUI(null);

        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao('DESIGNOU_SUBSTITUTO', activeDeleg.substituidoMatricula, `Revogou antecipadamente a delegação de ${activeDeleg.substitutoNome || activeDeleg.substitutoMatricula || ''}`, activeDeleg.referenciaFuncionario || {tipo:'FUNCIONARIO',codigo:activeDeleg.substituidoMatricula,legado:true});
        }

        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('delegacoes_supervisor');
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Delegação Revogada', 'Delegação revogada com sucesso! Poderes operacionais do substituto encerrados imediatamente.');
        }
      }
      return confirmou === true;
  }

  window.nexusRevogarDelegacao = revogarDelegacaoAtiva;
  if (revogarBtn) {
    revogarBtn.addEventListener('click', () => revogarDelegacaoAtiva({}));
  }
  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    carregarDelegacaoAtiva();
    carregarTitulares();
  });
});
