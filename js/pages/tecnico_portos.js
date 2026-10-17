/**
 * Lógica do Módulo do Técnico em Portos (tecnico_portos.html) - NexusPort
 * Gerencia invalidação/reemissão de códigos (RN 15 / T1.8), CRUD de funcionários (T2.1)
 * e livro de visitantes (T2.2).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  // Utilitários Anti-XSS (js/security.js) — codificam dados não confiáveis
  // antes de qualquer inserção em HTML ou em manipuladores inline.
  const esc = window.nexusEsc || (window.NexusSecurity && window.NexusSecurity.escapeHtml);
  const jsArg = window.nexusJsArg || (window.NexusSecurity && window.NexusSecurity.jsString);

  // ── Autoria (FK → funcionarios.id) ────────────────────────────────
  // `solicitado_por` e `registrado_por` são uuid com FK para funcionarios(id).
  // Sessões antigas podem trazer a matrícula em `session.id`; gravar texto ali
  // fazia o insert falhar (22P02) e a operação não era registrada.
  const UUID_FUNCIONARIO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function resolverFuncionarioId() {
    if (UUID_FUNCIONARIO_RE.test(String(session.id || ''))) return session.id;
    const chave = session.matricula || session.codigo_individual || session.codigo || '';
    if (!chave) return null;
    if (window.nexusSupabase) {
      try {
        for (const campo of ['matricula', 'codigo_individual']) {
          const { data } = await window.nexusSupabase
            .from('funcionarios')
            .select('id')
            .eq(campo, chave)
            .maybeSingle();
          if (data && UUID_FUNCIONARIO_RE.test(String(data.id || ''))) return data.id;
        }
      } catch (e) {
        console.warn('[NexusPort] Não foi possível resolver o funcionário da sessão:', e);
      }
    }
    try {
      const locais = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      const achado = (Array.isArray(locais) ? locais : []).find(f => f
        && (f.matricula === chave || f.codigo_individual === chave || f.codigo === chave));
      if (achado && UUID_FUNCIONARIO_RE.test(String(achado.id || ''))) return achado.id;
    } catch (e) { /* cache local inválido */ }
    return null;
  }


  const searchInput = document.getElementById('empMatriculaSearch');
  const searchBtn = document.getElementById('searchEmpBtn');
  const regenBtn = document.getElementById('regenCodeBtn');
  const resultBox = document.getElementById('empSearchResultBox');
  const regenNotice = document.getElementById('codeRegenNotice');

  const resNome = document.getElementById('resEmpNome');
  const resCargo = document.getElementById('resEmpCargo');
  const resCodigo = document.getElementById('resEmpCodigo');
  const newGenCode = document.getElementById('newGeneratedCode');

  let selectedEmp = null;
  const employeeList = [];

  // Normalização para busca fuzzy: minúsculas, sem acento, espaços únicos
  function normalizarBuscaFuzzy(texto) {
    return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // Pontuação fuzzy simples: substring direta vale mais; subsequência em ordem
  // (letras do termo aparecendo na ordem no alvo) vale menos. 0 = sem match.
  function pontuarFuzzy(termoNorm, alvoNorm) {
    if (!termoNorm || !alvoNorm) return 0;
    if (alvoNorm === termoNorm) return 100;
    if (alvoNorm.startsWith(termoNorm)) return 80;
    if (alvoNorm.includes(termoNorm)) return 60;
    let pos = 0;
    let acertos = 0;
    for (const ch of termoNorm) {
      if (ch === ' ') continue;
      const idx = alvoNorm.indexOf(ch, pos);
      if (idx === -1) return 0;
      pos = idx + 1;
      acertos++;
    }
    const letrasTermo = termoNorm.replace(/ /g, '').length;
    if (letrasTermo < 2 || acertos < letrasTermo) return 0;
    return Math.max(5, 40 - Math.max(0, alvoNorm.length - letrasTermo));
  }

  function fatiarCpfSomenteDigitos(cpf) {
    return String(cpf || '').replace(/\D/g, '');
  }

  // Formata 11 dígitos como 000.000.000-00 para exibição
  function formatarCpfExibicao(cpf) {
    const d = fatiarCpfSomenteDigitos(cpf);
    if (d.length !== 11) return cpf || '—';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  // Converte data ISO (AAAA-MM-DD) para DD/MM/AAAA
  function formatarDataNascExibicao(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso ? String(iso) : '—';
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  // Validação de CPF do funcionário: a regra do produto aceita CPF fictício.
  // Exige apenas 11 dígitos e recusa sequências com todos os dígitos iguais
  // (ex.: 111.111.111-11). Os dígitos verificadores (módulo 11) NÃO são
  // conferidos de propósito. A unicidade é garantida à parte (cache local e
  // Supabase, na gravação do cadastro).
  function validarCpf(cpf) {
    const d = fatiarCpfSomenteDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    return true;
  }

  // Busca por matrícula (usada pela interface e pelas ferramentas WebMCP).
  async function buscarFuncionarioPorMatricula(q) {
      if (!q) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Obrigatória', 'Informe a matrícula para buscar.');
        return null;
      }

      const formattedMatricula = q.startsWith('MAT-') ? q : `MAT-${q}`;
      let found = null;

      // 1. Busca assíncrona na tabela 'funcionarios' do Supabase
      if (window.nexusSupabase) {
        try {
          const { data, error } = await window.nexusSupabase
            .from('funcionarios')
            .select('*')
            .or(`matricula.eq.${q},matricula.eq.${formattedMatricula}`)
            .maybeSingle();

          if (!error && data) {
            found = {
              codigo: data.codigo_individual || `NX-${data.matricula.replace('MAT-', '')}-SP`,
              matricula: data.matricula,
              nome: data.nome,
              cargo: data.cargo,
              cargo_nome: data.cargo_nome || data.cargo
            };
          }
        } catch (err) {
          console.warn('[NexusPort Técnico] Falha na consulta de funcionário no Supabase:', err);
        }
      }

      // 2. Busca por CPF no Supabase (coluna nova: falha silenciosa se a migração
      // ainda não foi aplicada — nunca quebra a busca por matrícula).
      const digitosBusca = fatiarCpfSomenteDigitos(q);
      if (!found && digitosBusca.length >= 3 && window.nexusSupabase) {
        try {
          const { data: porCpf, error: errCpf } = await window.nexusSupabase
            .from('funcionarios')
            .select('*')
            .or(`cpf.eq.${digitosBusca},cpf.ilike.%${digitosBusca}%`)
            .limit(5);
          if (!errCpf && Array.isArray(porCpf) && porCpf.length === 1) {
            const data = porCpf[0];
            found = {
              codigo: data.codigo_individual || `NX-${String(data.matricula || '').replace('MAT-', '')}-SP`,
              matricula: data.matricula,
              nome: data.nome,
              cargo: data.cargo,
              cargo_nome: data.cargo_nome || data.cargo
            };
          }
        } catch (err) { /* coluna cpf ausente ou sem conexão: segue para o cache */ }
      }

      // 3. Consulta no cache local de funcionários reais se Supabase indisponível
      if (!found) {
        const dynamicFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
        const qNorm = normalizarBuscaFuzzy(q);
        const dyn = dynamicFuncs.find(f => {
          if (f.matricula && (f.matricula.toUpperCase() === q || f.matricula.toUpperCase() === formattedMatricula)) return true;
          if (digitosBusca.length >= 3 && fatiarCpfSomenteDigitos(f.cpf || f.documento || '') === digitosBusca) return true;
          if (qNorm.length >= 3 && normalizarBuscaFuzzy(f.nome) === qNorm) return true;
          return false;
        });
        if (dyn) {
          found = {
            codigo: dyn.codigo || dyn.codigo_individual,
            matricula: dyn.matricula,
            nome: dyn.nome,
            cargo: dyn.cargo,
            cargo_nome: dyn.cargo_nome || dyn.cargo
          };
        }
      }

      selectedEmp = found;

      if (selectedEmp) {
        if (resultBox) resultBox.classList.remove('hidden');
        if (resNome) resNome.textContent = selectedEmp.nome;
        if (resCargo) resCargo.textContent = selectedEmp.cargo_nome || selectedEmp.cargo;

        if (resCodigo) resCodigo.textContent = 'Protegido';

        if (regenBtn) regenBtn.disabled = false;
        if (regenNotice) regenNotice.classList.add('hidden');
      } else {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Não Encontrado', 'Funcionário não localizado no banco de dados.');
        }
        if (resultBox) resultBox.classList.add('hidden');
        if (regenBtn) regenBtn.disabled = true;
      }
      return selectedEmp;
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => buscarFuncionarioPorMatricula(searchInput.value.trim().toUpperCase()));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); buscarFuncionarioPorMatricula(searchInput.value.trim().toUpperCase()); }
    });

    // Sugestões com BUSCA FUZZY (RN15): digitar parte do nome, matrícula ou CPF
    // sugere os funcionários mais prováveis sem exigir a grafia exata.
    const suggestBox = document.getElementById('empSearchSuggest');
    let suggestTimer = null;
    let sugestoesFuncionarios = [];
    const esconderSugestoes = () => { if (suggestBox) suggestBox.classList.add('hidden'); };
    function montarSugestoes(termo) {
      if (!suggestBox) return;
      const termoNorm = normalizarBuscaFuzzy(termo);
      const digitos = fatiarCpfSomenteDigitos(termo);
      if (termoNorm.length < 2 && digitos.length < 3) {
        esconderSugestoes();
        return;
      }
      const candidatos = [];
      (mergedFuncList || []).forEach(f => {
        const nomeNorm = normalizarBuscaFuzzy(f.nome);
        const matNorm = normalizarBuscaFuzzy(f.matricula);
        let pontos = Math.max(pontuarFuzzy(termoNorm, nomeNorm), pontuarFuzzy(termoNorm, matNorm));
        const cpfF = fatiarCpfSomenteDigitos(f.cpf || f.documento || '');
        if (digitos.length >= 3 && cpfF.includes(digitos)) {
          pontos = Math.max(pontos, cpfF === digitos ? 90 : 70);
        }
        if (pontos > 0) candidatos.push({ f, pontos });
      });
      candidatos.sort((a, b) => b.pontos - a.pontos);
      const top = candidatos.slice(0, 8);
      if (top.length === 0) {
        esconderSugestoes();
        return;
      }
      sugestoesFuncionarios = top.map(({ f }) => f);
      suggestBox.innerHTML = top.map(({ f }, indice) => {
        const nome = String(f.nome || 'Sem nome');
        const cargo = String(f.cargo_nome || f.cargo || '');
        return `<button type="button" data-func-indice="${esc(indice)}" class="w-full text-left px-3 py-2 hover:bg-nexus-bg dark:hover:bg-slate-800 flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
          <span class="font-mono font-bold text-nexus-900 dark:text-white">${esc(nome)}</span>
          <span class="font-mono text-slate-600 dark:text-slate-400">${esc(cargo)}</span>
        </button>`;
      }).join('');
      suggestBox.classList.remove('hidden');
    }
    searchInput.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(() => montarSugestoes(searchInput.value), 120);
    });
    searchInput.addEventListener('blur', () => setTimeout(esconderSugestoes, 150));
    if (suggestBox) {
      suggestBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-func-indice]');
        if (!btn) return;
        const funcionario = sugestoesFuncionarios[Number(btn.getAttribute('data-func-indice'))];
        if (!funcionario) return;
        searchInput.value = funcionario.nome || '';
        esconderSugestoes();
        buscarFuncionarioPorMatricula(String(funcionario.matricula || '').trim().toUpperCase());
      });
    }
  }

  // Reemissão de código (RN 15). Só a interface do Técnico exibe o novo código; ele nunca volta para o agente.
  async function reemitirCodigoSelecionado(opcoes) {
      if (!selectedEmp) return false;

      const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Invalidar Código', `Confirma a INVALIDAÇÃO do código atual para ${selectedEmp.nome}?`) : true;

      if (confirmou) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const newCode = `NX-${selectedEmp.matricula.replace('MAT-', '')}-${suffix}`;

        const storedOverrides = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');
        storedOverrides[selectedEmp.matricula] = {
          old_codigo: storedOverrides[selectedEmp.matricula]?.codigo || selectedEmp.codigo,
          codigo: newCode,
          gerado_por: session.matricula,
          data_geracao: new Date().toISOString()
        };

        localStorage.setItem('nexus_code_overrides', JSON.stringify(storedOverrides));

        if (window.nexusSupabase) {
          try {
            const rawMat = selectedEmp.matricula;
            const formattedMat = rawMat.startsWith('MAT-') ? rawMat : `MAT-${rawMat}`;
            const unformattedMat = rawMat.replace('MAT-', '');

            await window.nexusSupabase.from('funcionarios')
              .update({ codigo_individual: newCode })
              .or(`matricula.eq.${rawMat},matricula.eq.${formattedMat},matricula.eq.${unformattedMat}`);

            if (window.registrarLogAlteracao) {
              await window.registrarLogAlteracao('EDICAO', 'funcionarios', null, { matricula: selectedEmp.matricula, novo_codigo: newCode, motivo: 'Reemissão de código pelo Técnico em Portos' });
            }
          } catch (err) {
            console.warn('[NexusPort] Erro ao atualizar código no Supabase:', err);
          }
        }

        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('funcionarios');
        }

        if (resCodigo) resCodigo.textContent = newCode;
        if (newGenCode) newGenCode.textContent = newCode;
        if (regenNotice) regenNotice.classList.remove('hidden');

        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Código Reemitido', `Código antigo invalidado com sucesso. O novo código de acesso é: ${newCode}`);
        }
      }
      return confirmou === true;
  }

  // Pontos de uso pelo agente WebMCP (mesma lógica da interface).
  window.nexusTecnicoBuscar = buscarFuncionarioPorMatricula;
  window.nexusTecnicoReemitir = async function (matricula, opcoes) {
    if (matricula !== undefined) {
      const achado = await buscarFuncionarioPorMatricula(String(matricula).trim().toUpperCase());
      if (!achado) return false;
    }
    return reemitirCodigoSelecionado(opcoes);
  };

  if (regenBtn) {
    regenBtn.addEventListener('click', () => reemitirCodigoSelecionado({}));
  }

  // T21 (escopo autorizado): ocultação de saída; banco/cache continuam contendo os campos.
  // A exclusividade do titular exige autenticação/políticas no servidor e permanece pendente.
  // CRUD Funcionários (T2.1 & Conexão Supabase)
  const toggleFuncBtn = document.getElementById('toggleFuncFormBtn');
  const funcForm = document.getElementById('funcCrudForm');
  const funcTableBody = document.getElementById('funcCrudTableBody');
  const mostrarMaisFuncionariosBtn = document.getElementById('mostrarMaisFuncionariosBtn');
  const funcCrudContador = document.getElementById('funcCrudContador');
  const FUNCIONARIOS_LIMITE_INICIAL = 5;
  let funcionariosExpandidos = false;

  let mergedFuncList = [];

  const DOCS_PLACEHOLDER_PADRAO = new Set([
    'Ativo no Supabase',
    'Inativo no Supabase',
    'Cadastrado no Sistema',
    'Cadastrado'
  ]);

  function ehDocPlaceholderPadrao(valor) {
    const v = String(valor || '').trim();
    return !v || DOCS_PLACEHOLDER_PADRAO.has(v);
  }

  function lerMapaDocsLocais() {
    try {
      return JSON.parse(localStorage.getItem('nexus_func_docs') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function salvarDocLocalFuncionario(matricula, id, doc) {
    const texto = String(doc || '').trim();
    if (!texto || ehDocPlaceholderPadrao(texto)) return;
    try {
      const mapa = lerMapaDocsLocais();
      if (matricula) mapa[String(matricula).trim().toUpperCase()] = texto;
      if (id) mapa[String(id).trim()] = texto;
      localStorage.setItem('nexus_func_docs', JSON.stringify(mapa));
    } catch (e) {}
  }

  const CARGOS_EDICAO_DOCUMENTACAO_FUNCIONARIO = new Set([
    'TECNICO_PORTOS',
    'DIRETOR_OPERACOES_LOGISTICA',
    'DIRETOR_PRESIDENTE_SUPERINTENDENTE'
  ]);

  function ehSessaoSomenteLeitura(sessaoAtual = session) {
    if (!sessaoAtual) return false;
    if (window.NexusAuth && typeof window.NexusAuth.isReadOnly === 'function' && window.NexusAuth.isReadOnly(sessaoAtual)) {
      return true;
    }
    return sessaoAtual.somente_leitura === true || sessaoAtual.perfil_espectador === true;
  }

  function podeEditarDocumentacaoFuncionario(sessaoAtual = session) {
    if (!sessaoAtual || !sessaoAtual.cargo) return false;
    if (ehSessaoSomenteLeitura(sessaoAtual)) return false;
    const cargo = String(sessaoAtual.cargo || '').trim().toUpperCase();
    return CARGOS_EDICAO_DOCUMENTACAO_FUNCIONARIO.has(cargo);
  }

  async function carregarFuncionariosCompleto() {
    let funcs = [];
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('funcionarios')
          .select('*')
          .order('nome', { ascending: true });
        if (!error && Array.isArray(data)) {
          const mapaDocs = lerMapaDocsLocais();
          const prevList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
          funcs = data.map(s => {
            const matKey = String(s.matricula || '').trim().toUpperCase();
            const prev = prevList.find(p =>
              (s.id && p.id === s.id) ||
              (matKey && String(p.matricula || '').trim().toUpperCase() === matKey)
            );
            const docRemoto = String(s.documentacao_interna || s.documentacao || s.doc || '').trim();
            const docLocal = String(
              mapaDocs[matKey] ||
              (s.id ? mapaDocs[String(s.id)] : '') ||
              (prev && !ehDocPlaceholderPadrao(prev.doc) ? prev.doc : '') ||
              ''
            ).trim();
            const docPersonalizado = docRemoto || docLocal;
            if (docPersonalizado) salvarDocLocalFuncionario(s.matricula, s.id, docPersonalizado);
            return {
              matricula: s.matricula,
              nome: s.nome,
              cargo: s.cargo_nome || s.cargo,
              codigo: s.codigo_individual || `NX-${String(s.matricula || '').replace('MAT-', '')}-SP`,
              cpf: s.cpf || '',
              data_nascimento: s.data_nascimento || '',
              doc: docPersonalizado || (s.ativo ? 'Ativo no Supabase' : 'Inativo no Supabase'),
              documentacao_interna: docPersonalizado || '',
              ativo: s.ativo,
              id: s.id
            };
          });
          mergedFuncList = funcs;
          localStorage.setItem('nexus_func_list', JSON.stringify(mergedFuncList));
          renderFuncTable();
          return;
        }
      } catch (err) {
        console.warn('[NexusPort] Falha ao carregar funcionários do Supabase:', err);
      }
    }

    const localList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
    const mapaDocs = lerMapaDocsLocais();
    mergedFuncList = localList.map(f => {
      const matKey = String(f.matricula || '').trim().toUpperCase();
      const docPersonalizado = String(
        f.documentacao_interna ||
        mapaDocs[matKey] ||
        (f.id ? mapaDocs[String(f.id)] : '') ||
        (!ehDocPlaceholderPadrao(f.doc) ? f.doc : '') ||
        ''
      ).trim();
      return {
        ...f,
        doc: docPersonalizado || f.doc || 'Cadastrado',
        documentacao_interna: docPersonalizado
      };
    });
    renderFuncTable();
  }

  function nomeResponsavelRegistro(valor) {
    if (valor === session.matricula) return session.nome || 'Titular da sessão';
    const funcionario = mergedFuncList.find(f => f.matricula === valor || f.codigo === valor);
    if (funcionario) return funcionario.nome || 'Funcionário';
    return 'Funcionário não identificado';
  }

  function renderFuncTable() {
    if (!funcTableBody) return;
    const total = Array.isArray(mergedFuncList) ? mergedFuncList.length : 0;
    const visiveis = (funcionariosExpandidos || total <= FUNCIONARIOS_LIMITE_INICIAL)
      ? mergedFuncList
      : mergedFuncList.slice(0, FUNCIONARIOS_LIMITE_INICIAL);

    if (funcCrudContador) {
      funcCrudContador.textContent = `Exibindo ${visiveis.length} de ${total} funcionários`;
    }
    if (mostrarMaisFuncionariosBtn) {
      if (total > FUNCIONARIOS_LIMITE_INICIAL) {
        mostrarMaisFuncionariosBtn.classList.remove('hidden');
        mostrarMaisFuncionariosBtn.disabled = false;
        mostrarMaisFuncionariosBtn.setAttribute('aria-expanded', String(funcionariosExpandidos));
        mostrarMaisFuncionariosBtn.textContent = funcionariosExpandidos ? 'Mostrar menos' : 'Mostrar mais';
      } else {
        mostrarMaisFuncionariosBtn.classList.add('hidden');
        mostrarMaisFuncionariosBtn.disabled = true;
        mostrarMaisFuncionariosBtn.setAttribute('aria-expanded', 'false');
        mostrarMaisFuncionariosBtn.textContent = 'Mostrar mais';
      }
    }

    funcTableBody.innerHTML = visiveis.map((f, indice) => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="p-3 font-bold">${esc(f.nome)}</td>
        <td class="p-3 text-slate-600 font-semibold">${esc(f.cargo)}</td>
        <td class="p-3 font-mono text-slate-600 dark:text-slate-300">${esc(formatarCpfExibicao(f.cpf))}</td>
        <td class="p-3 font-mono text-slate-600">${esc(formatarDataNascExibicao(f.data_nascimento))}</td>
        <td class="p-3 text-slate-600 font-mono text-xs flex items-center justify-between gap-2">
          <span class="${f.ativo ? 'text-emerald-700 font-bold' : 'text-slate-600'}">${esc(f.doc || 'Cadastrado')}</span>
          <span class="flex items-center gap-1.5 shrink-0">
            <button type="button" onclick="window.editarFuncionarioPorIndice(${jsArg(indice)})" class="px-2 py-1 bg-nexus-500 hover:bg-nexus-900 text-white rounded font-bold text-xs">Editar</button>
            <button type="button" onclick="window.excluirFuncionarioPorIndice(${jsArg(indice)})" class="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-xs">Excluir</button>
          </span>
        </td>
      </tr>
    `).join('');
  }

  if (mostrarMaisFuncionariosBtn) {
    mostrarMaisFuncionariosBtn.addEventListener('click', () => {
      funcionariosExpandidos = !funcionariosExpandidos;
      renderFuncTable();
    });
  }

  // O DOM recebe só um índice de apresentação, nunca matrícula em onclick/data-*.
  window.excluirFuncionarioPorIndice = function(indice) {
    const funcionario = mergedFuncList[Number(indice)];
    if (funcionario) return window.excluirFuncionarioReal(funcionario.matricula);
  };

  // ------------------------------------------------------------------------
  // Tarefa 2 (Backlog Parte 2) & Tarefa 7: edição de CPF, data de nascimento
  // e documentação interna do funcionário (restrita ao Diretor e ao Técnico em Portos).
  // O mesmo formulário do cadastro entra em "modo edição": matrícula, nome e
  // cargo ficam travados (são a identidade do cadastro), enquanto CPF, data de
  // nascimento e documentação interna (#funcDoc) podem ser atualizados.
  // ------------------------------------------------------------------------
  let funcionarioEmEdicao = null; // { matricula, id, nome, cpfOriginalDigits, dataNascOriginal, docOriginal } ou null (cadastro)

  const camposIdentidadeFuncionario = () => ['funcMatricula', 'funcNome', 'funcCargo']
    .map(id => document.getElementById(id)).filter(Boolean);

  function mascararMatriculaEdicao(matricula) {
    const val = String(matricula || '').trim();
    if (!val) return '';
    return 'MAT-••••';
  }

  function sairModoEdicaoFuncionario(opcoes) {
    const limpar = !opcoes || opcoes.limpar !== false;
    funcionarioEmEdicao = null;
    camposIdentidadeFuncionario().forEach(campo => {
      campo.disabled = false;
      campo.readOnly = false;
      campo.title = '';
      campo.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
    });
    const cpfCampo = document.getElementById('funcCpf');
    if (cpfCampo) {
      cpfCampo.readOnly = false;
      cpfCampo.disabled = false;
      cpfCampo.required = true;
      cpfCampo.title = '';
      cpfCampo.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
    }
    const dataNascCampo = document.getElementById('funcDataNasc');
    if (dataNascCampo) {
      dataNascCampo.required = true;
    }
    const docCampo = document.getElementById('funcDoc');
    if (docCampo) {
      const podeDoc = podeEditarDocumentacaoFuncionario(session);
      docCampo.disabled = !podeDoc;
      docCampo.readOnly = !podeDoc;
      docCampo.title = podeDoc ? '' : 'Alteração de documentação interna restrita ao Diretor e ao Técnico em Portos';
      docCampo.classList.toggle('bg-slate-100', !podeDoc);
      docCampo.classList.toggle('dark:bg-slate-800/80', !podeDoc);
      docCampo.classList.toggle('cursor-not-allowed', !podeDoc);
      docCampo.classList.toggle('opacity-75', !podeDoc);
    }
    const label = document.getElementById('funcFormSubmitLabel');
    if (label) label.textContent = 'Salvar Funcionário';
    const cancelar = document.getElementById('cancelarEdicaoFuncionarioBtn');
    if (cancelar) cancelar.classList.add('hidden');
    const avisoEdicao = document.getElementById('funcEdicaoAviso');
    if (avisoEdicao) avisoEdicao.classList.add('hidden');
    if (limpar && funcForm) funcForm.reset();
    if (opcoes && opcoes.fechar && funcForm) funcForm.classList.add('hidden');
  }

  function cargoEnumDoFuncionario(f) {
    const select = document.getElementById('funcCargo');
    const candidatos = [f.cargo_enum, f.cargo].filter(Boolean).map(String);
    if (select) {
      for (const candidato of candidatos) {
        const porValor = Array.from(select.options).find(o => o.value === candidato);
        if (porValor) return porValor.value;
        const porTexto = Array.from(select.options).find(o => o.text === candidato);
        if (porTexto) return porTexto.value;
      }
    }
    return candidatos[0] || 'ESTIVADOR';
  }

  function iniciarEdicaoFuncionario(funcionario) {
    if (!funcionario || !funcForm) return null;
    if (ehSessaoSomenteLeitura(session)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('atencao', 'Modo Somente Leitura (Espectador)', 'O perfil Espectador possui acesso exclusivo de visualização e não pode editar informações ou documentação de funcionários.');
      }
      return null;
    }
    if (!podeEditarDocumentacaoFuncionario(session)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Restrito', 'A edição das informações e da documentação interna do funcionário é restrita apenas ao Diretor e ao Técnico em Portos.');
      }
      return null;
    }
    const cpfExistenteDigits = fatiarCpfSomenteDigitos(funcionario.cpf);
    const cpfJaDefinido = cpfExistenteDigits.length === 11;
    const docAtualPersonalizado = !ehDocPlaceholderPadrao(funcionario.doc)
      ? String(funcionario.doc || '').trim()
      : String(funcionario.documentacao_interna || '').trim();
    const dataNascAtual = String(funcionario.data_nascimento || '').slice(0, 10);
    funcionarioEmEdicao = {
      matricula: funcionario.matricula,
      id: funcionario.id || null,
      nome: funcionario.nome || '',
      cpfOriginalDigits: cpfJaDefinido ? cpfExistenteDigits : null,
      dataNascOriginal: dataNascAtual || null,
      docOriginal: funcionario.doc || 'Cadastrado',
      docPersonalizadoOriginal: docAtualPersonalizado
    };
    const setValor = (id, valor) => {
      const campo = document.getElementById(id);
      if (campo) campo.value = valor == null ? '' : String(valor);
    };
    setValor('funcMatricula', mascararMatriculaEdicao(funcionario.matricula));
    const matCampo = document.getElementById('funcMatricula');
    if (matCampo) {
      matCampo.readOnly = true;
      matCampo.title = 'Matrícula protegida e bloqueada para alteração';
      matCampo.classList.add('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
    }
    setValor('funcNome', funcionario.nome || '');
    setValor('funcCargo', cargoEnumDoFuncionario(funcionario));
    setValor('funcDoc', docAtualPersonalizado);
    const docCampo = document.getElementById('funcDoc');
    if (docCampo) {
      docCampo.disabled = false;
      docCampo.readOnly = false;
      docCampo.title = 'Documentação interna do funcionário (editável pelo Diretor e pelo Técnico em Portos)';
      docCampo.classList.remove('bg-slate-100', 'dark:bg-slate-800/80', 'cursor-not-allowed', 'opacity-75');
    }
    const cpfCampo = document.getElementById('funcCpf');
    if (cpfCampo) {
      cpfCampo.value = funcionario.cpf ? formatarCpfExibicao(funcionario.cpf) : '';
      cpfCampo.readOnly = cpfJaDefinido;
      cpfCampo.required = false;
      cpfCampo.title = cpfJaDefinido ? 'CPF já cadastrado para este funcionário (bloqueado para alteração)' : '';
      cpfCampo.classList.toggle('bg-slate-100', cpfJaDefinido);
      cpfCampo.classList.toggle('dark:bg-slate-800/80', cpfJaDefinido);
      cpfCampo.classList.toggle('cursor-not-allowed', cpfJaDefinido);
      cpfCampo.classList.toggle('opacity-75', cpfJaDefinido);
    }
    setValor('funcDataNasc', dataNascAtual);
    const dataNascCampo = document.getElementById('funcDataNasc');
    if (dataNascCampo) {
      dataNascCampo.required = false;
    }

    camposIdentidadeFuncionario().forEach(campo => { campo.disabled = true; });
    const label = document.getElementById('funcFormSubmitLabel');
    if (label) label.textContent = 'Salvar Alterações';
    const cancelar = document.getElementById('cancelarEdicaoFuncionarioBtn');
    if (cancelar) cancelar.classList.remove('hidden');
    const avisoEdicao = document.getElementById('funcEdicaoAviso');
    if (avisoEdicao) avisoEdicao.classList.remove('hidden');

    funcForm.classList.remove('hidden');
    if (window.mostrarFeedback) {
      const msg = cpfJaDefinido
        ? `Atualize a data de nascimento e/ou a documentação interna de ${funcionario.nome || 'funcionário'}. Matrícula, nome, cargo e CPF já cadastrado permanecem bloqueados.`
        : `Cadastre o CPF pendente e atualize a data de nascimento e/ou a documentação interna de ${funcionario.nome || 'funcionário'}. Matrícula, nome e cargo não são alterados nesta edição.`;
      window.mostrarFeedback('info', 'Editar Funcionário', msg);
    }
    if (cpfJaDefinido && dataNascCampo) dataNascCampo.focus();
    else if (cpfCampo) cpfCampo.focus();
    return funcionario;
  }

  // O DOM recebe só um índice de apresentação, nunca matrícula em onclick/data-*.
  window.editarFuncionarioPorIndice = function(indice) {
    const funcionario = mergedFuncList[Number(indice)];
    if (funcionario) return iniciarEdicaoFuncionario(funcionario);
    return null;
  };
  // Uso programático (testes/WebMCP): mesma entrada da interface, por matrícula.
  window.editarFuncionarioReal = function(matricula) {
    const funcionario = mergedFuncList.find(f => f.matricula === matricula);
    if (funcionario) return iniciarEdicaoFuncionario(funcionario);
    return null;
  };

  function atualizarFuncionarioLocal(alvo, cpfDigits, dataNasc, docNovo) {
    const docLimpo = String(docNovo || '').trim();
    if (docLimpo) {
      salvarDocLocalFuncionario(alvo.matricula, alvo.id, docLimpo);
    }
    const aplicar = (f) => {
      if (f && (f.matricula === alvo.matricula || (alvo.id && f.id === alvo.id))) {
        if (cpfDigits) f.cpf = cpfDigits;
        if (dataNasc) f.data_nascimento = dataNasc;
        if (docLimpo) {
          f.doc = docLimpo;
          f.documentacao_interna = docLimpo;
        }
        return true;
      }
      return false;
    };
    (mergedFuncList || []).forEach(aplicar);
    try {
      const localList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      localList.forEach(aplicar);
      localStorage.setItem('nexus_func_list', JSON.stringify(localList));
    } catch (e) { /* cache indisponível: a lista em memória já foi atualizada */ }
  }

  async function salvarEdicaoFuncionario(alvo, cpfDigits, dataNasc, docNovo) {
    if (!podeEditarDocumentacaoFuncionario(session)) {
      if (window.mostrarFeedback) {
        window.mostrarFeedback('erro', 'Acesso Restrito', 'A edição das informações e da documentação interna do funcionário é restrita apenas ao Diretor e ao Técnico em Portos.');
      }
      return;
    }
    if (alvo && alvo.cpfOriginalDigits) {
      cpfDigits = alvo.cpfOriginalDigits;
    }
    const docLimpo = String(docNovo || '').trim();
    const docAlterado = Boolean(docLimpo && docLimpo !== String(alvo.docPersonalizadoOriginal || '').trim());

    if (cpfDigits) {
      // Unicidade do CPF no cache local (funcionários e visitantes), ignorando o próprio funcionário.
      const duplicadoLocal = (mergedFuncList || []).find(f =>
        f.matricula !== alvo.matricula && fatiarCpfSomenteDigitos(f.cpf || f.documento || '') === cpfDigits);
      if (duplicadoLocal) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', `BLOQUEIO DE DUPLICIDADE: o CPF ${formatarCpfExibicao(cpfDigits)} já está cadastrado para "${duplicadoLocal.nome}". Cada pessoa pode ter apenas um cadastro no sistema!`);
        return;
      }
      const dupVisLocal = (typeof visList !== 'undefined' && Array.isArray(visList) ? visList : []).find(v =>
        fatiarCpfSomenteDigitos(v.documento || '') === cpfDigits);
      if (dupVisLocal) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', `BLOQUEIO DE DUPLICIDADE: o CPF ${formatarCpfExibicao(cpfDigits)} já está cadastrado para o visitante "${dupVisLocal.nome}". Cada pessoa pode ter apenas um cadastro no sistema!`);
        return;
      }
    }

    let avisoMigracao = '';
    if (window.nexusSupabase) {
      try {
        if (cpfDigits) {
          // Unicidade do CPF no banco, ignorando o próprio funcionário.
          const { data: dupCpf, error: dupErr } = await window.nexusSupabase
            .from('funcionarios').select('nome, matricula').eq('cpf', cpfDigits).maybeSingle();
          if (!dupErr && dupCpf && dupCpf.matricula !== alvo.matricula) {
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', `BLOQUEIO DE DUPLICIDADE (Supabase): o CPF ${formatarCpfExibicao(cpfDigits)} já pertence ao funcionário "${dupCpf.nome}". Não é permitido cadastrar duplicidades!`);
            return;
          }
        }

        const payloadUpdate = {};
        if (cpfDigits) payloadUpdate.cpf = cpfDigits;
        if (dataNasc) payloadUpdate.data_nascimento = dataNasc;
        if (docLimpo) payloadUpdate.documentacao_interna = docLimpo;

        if (Object.keys(payloadUpdate).length > 0) {
          let updateQuery = window.nexusSupabase
            .from('funcionarios')
            .update(payloadUpdate);
          updateQuery = alvo.id ? updateQuery.eq('id', alvo.id) : updateQuery.eq('matricula', alvo.matricula);
          const { error: updErr } = await updateQuery;
          if (updErr) {
            const msgErro = `${updErr.message || ''} ${updErr.code || ''}`;
            if (/column|PGRST204|42703/i.test(msgErro)) {
              // Se apenas a coluna documentacao_interna não existir ainda no Supabase, tenta gravar cpf e data_nascimento.
              if (payloadUpdate.documentacao_interna && (payloadUpdate.cpf || payloadUpdate.data_nascimento) && /documentacao_interna/i.test(msgErro)) {
                const payloadSemDoc = {};
                if (payloadUpdate.cpf) payloadSemDoc.cpf = payloadUpdate.cpf;
                if (payloadUpdate.data_nascimento) payloadSemDoc.data_nascimento = payloadUpdate.data_nascimento;
                let retryQuery = window.nexusSupabase.from('funcionarios').update(payloadSemDoc);
                retryQuery = alvo.id ? retryQuery.eq('id', alvo.id) : retryQuery.eq('matricula', alvo.matricula);
                await retryQuery;
              } else {
                // Banco sem a migração de cpf/data_nascimento: mantém no cache e avisa.
                avisoMigracao = ' Aviso: as colunas cpf/data_nascimento ainda não existem no Supabase — aplique a migração supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql para sincronizá-las.';
              }
            } else {
              if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Edição Não Realizada', `Não foi possível atualizar ${alvo.nome || 'o funcionário'} no banco de dados (${updErr.message || 'erro'}). Nada foi alterado.`);
              return;
            }
          }
        }
      } catch (err) {
        if (window.mostrarFeedback) window.mostrarFeedback('erro', 'Edição Não Realizada', `Não foi possível atualizar ${alvo.nome || 'o funcionário'}: falha de comunicação com o banco de dados. Nada foi alterado.`);
        return;
      }
    }

    atualizarFuncionarioLocal(alvo, cpfDigits, dataNasc, docLimpo);
    if (window.registrarLogAlteracao) {
      const camposAtualizados = [];
      if (cpfDigits) camposAtualizados.push('cpf');
      if (dataNasc) camposAtualizados.push('data_nascimento');
      if (docLimpo || docAlterado) camposAtualizados.push('documentacao_interna');
      // Auditoria sem dados sensíveis: registra QUAIS campos, nunca o CPF.
      await window.registrarLogAlteracao('EDICAO', 'funcionarios', alvo.id || null, {
        matricula: alvo.matricula,
        campos_atualizados: camposAtualizados.length ? camposAtualizados : ['cpf', 'data_nascimento']
      });
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('funcionarios');
    }
    const nome = alvo.nome || 'Funcionário';
    sairModoEdicaoFuncionario({ fechar: true });
    renderFuncTable();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Funcionário Atualizado', `Informações e documentação interna de ${nome} atualizadas com sucesso!${avisoMigracao}`);
    }
  }

  window.excluirFuncionarioReal = async function(matricula, opcoes) {
    const funcionario = mergedFuncList.find(f => f.matricula === matricula);
    const nome = funcionario?.nome || 'selecionado';
    const privacidade = window.NexusSecurity.privacidadeAuditoria([session, ...mergedFuncList]);
    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Excluir Funcionário', `Tem certeza que deseja desativar/excluir o funcionário ${nome}?`) : true;
    if (!confirmou) return;

    const aviso = (tipo, titulo, msg) => { if (window.mostrarFeedback) window.mostrarFeedback(tipo, titulo, msg); };
    if (!window.NexusRepository || typeof window.NexusRepository.deleteFuncionario !== 'function') {
      aviso('erro', 'Exclusão Não Realizada', `Não foi possível excluir o funcionário ${nome}: serviço de dados indisponível.`);
      return;
    }

    // A exclusão só é considerada feita quando o banco confirma.
    const resultado = await window.NexusRepository.deleteFuncionario(matricula);
    if (!resultado || !resultado.ok) {
      const motivo = privacidade.texto((resultado && resultado.erro) || 'falha desconhecida');
      aviso(resultado && resultado.bloqueio ? 'alerta' : 'erro', 'Exclusão Não Realizada',
        `Funcionário ${nome} não foi excluído: ${motivo} Nada foi alterado.`);
      return;
    }

    if (window.registrarLogAlteracao) {
      await window.registrarLogAlteracao('EXCLUSAO', 'funcionarios', null, { matricula, motivo: 'Exclusão pelo Técnico em Portos' });
    }
    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('funcionarios');
    }

    // Remove da tabela sem recarregar a página.
    mergedFuncList = (mergedFuncList || []).filter(f => f.matricula !== matricula);
    renderFuncTable();
    aviso('sucesso', 'Funcionário Excluído', resultado.removido
      ? `Funcionário ${nome} excluído do banco de dados.`
      : `Funcionário ${nome} removido da lista; ele não existia no banco de dados.`);
  };

  carregarFuncionariosCompleto();

  if (toggleFuncBtn && funcForm) {
    toggleFuncBtn.addEventListener('click', () => {
      // Abrir pelo botão "+ Cadastrar Funcionário" é sempre um cadastro novo:
      // nunca herda uma edição que tenha ficado aberta.
      if (funcForm.classList.contains('hidden')) sairModoEdicaoFuncionario();
      funcForm.classList.toggle('hidden');
    });
  }

  const cancelarEdicaoBtn = document.getElementById('cancelarEdicaoFuncionarioBtn');
  if (cancelarEdicaoBtn) {
    cancelarEdicaoBtn.addEventListener('click', () => sairModoEdicaoFuncionario({ fechar: true }));
  }

  // Máscara automática de CPF (000.000.000-00) durante a digitação.
  // O cursor precisa ser preservado: reescrever o valor sem reposicionar a
  // seleção joga o cursor para o fim do campo, e qualquer correção no meio do
  // CPF passa a inserir os dígitos no final — embaralhando um CPF que o
  // operador digitou certo e recusando o cadastro com "CPF Inválido".
  function formatarCpfMascara(digitos) {
    const d = String(digitos || '').slice(0, 11);
    if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;
    return d;
  }

  function aplicarMascaraCpf(input) {
    const anterior = input.value;
    const cursor = (input.selectionStart == null) ? anterior.length : input.selectionStart;
    const digitosAntes = fatiarCpfSomenteDigitos(anterior.slice(0, cursor)).length;
    const mascarado = formatarCpfMascara(fatiarCpfSomenteDigitos(anterior));

    if (mascarado === anterior) return; // nada mudou: não mexe na seleção

    input.value = mascarado;

    // Reposiciona o cursor logo após o mesmo número de dígitos que havia antes.
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

  const funcCpfInput = document.getElementById('funcCpf');
  if (funcCpfInput) {
    funcCpfInput.addEventListener('input', () => aplicarMascaraCpf(funcCpfInput));
  }

  if (funcForm) {
    funcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const matriculaRaw = document.getElementById('funcMatricula').value.trim();
      const nome = document.getElementById('funcNome').value.trim();
      const cargoSelect = document.getElementById('funcCargo');
      const cargoValue = cargoSelect ? cargoSelect.value : 'ESTIVADOR';
      const cargoText = cargoSelect && cargoSelect.options[cargoSelect.selectedIndex] ? cargoSelect.options[cargoSelect.selectedIndex].text : cargoValue;
      const doc = document.getElementById('funcDoc').value.trim();
      const cpfRaw = document.getElementById('funcCpf').value.trim();
      const cpfDigits = fatiarCpfSomenteDigitos(cpfRaw);
      const dataNasc = document.getElementById('funcDataNasc').value;

      // Modo edição (Tarefa 2 e Tarefa 7): permite atualizar CPF, data de
      // nascimento e/ou documentação interna (#funcDoc), restrito ao Diretor e
      // ao Técnico em Portos.
      if (funcionarioEmEdicao) {
        if (ehSessaoSomenteLeitura(session)) {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('atencao', 'Modo Somente Leitura (Espectador)', 'O perfil Espectador possui acesso exclusivo de visualização e não pode editar informações ou documentação de funcionários.');
          }
          return;
        }
        if (!podeEditarDocumentacaoFuncionario(session)) {
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Acesso Restrito', 'A edição das informações e da documentação interna do funcionário é restrita apenas ao Diretor e ao Técnico em Portos.');
          }
          return;
        }

        const apenasDocSemCpfOuData = Boolean(doc) && !cpfRaw && !dataNasc && !funcionarioEmEdicao.cpfOriginalDigits;
        if (!apenasDocSemCpfOuData) {
          if (cpfRaw || funcionarioEmEdicao.cpfOriginalDigits || !doc) {
            if (!validarCpf(cpfRaw)) {
              if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Inválido', 'Informe um CPF com 11 dígitos, não todos iguais. O CPF pode ser fictício, mas não pode se repetir: cada CPF pode estar em apenas um cadastro.');
              return;
            }
          }
          if (dataNasc || !doc) {
            if (!dataNasc) {
              if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data de Nascimento Obrigatória', 'Informe a data de nascimento do funcionário.');
              return;
            }
            const nascDateEd = new Date(`${dataNasc}T12:00:00`);
            const hojeEd = new Date();
            if (Number.isNaN(nascDateEd.getTime()) || nascDateEd > hojeEd) {
              if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data Inválida', 'A data de nascimento não pode ser futura.');
              return;
            }
            let idadeEd = hojeEd.getFullYear() - nascDateEd.getFullYear();
            const fezAnivEd = (hojeEd.getMonth() > nascDateEd.getMonth()) || (hojeEd.getMonth() === nascDateEd.getMonth() && hojeEd.getDate() >= nascDateEd.getDate());
            if (!fezAnivEd) idadeEd--;
            if (idadeEd < 18) {
              if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Menor de Idade', `Funcionários do terminal precisam ter 18 anos ou mais. A data informada corresponde a ${idadeEd} ano(s).`);
              return;
            }
          }
        }

        await salvarEdicaoFuncionario({ ...funcionarioEmEdicao }, cpfDigits, dataNasc, doc);
        return;
      }

      // CPF obrigatório: 11 dígitos, sem todos iguais. CPF fictício é aceito;
      // a unicidade é conferida logo abaixo.
      if (!validarCpf(cpfRaw)) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Inválido', 'Informe um CPF com 11 dígitos, não todos iguais. O CPF pode ser fictício, mas não pode se repetir: cada CPF pode estar em apenas um cadastro.');
        return;
      }

      // Data de nascimento: obrigatória, passada e de pessoa maior de idade
      if (!dataNasc) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data de Nascimento Obrigatória', 'Informe a data de nascimento do funcionário.');
        return;
      }
      const nascDate = new Date(`${dataNasc}T12:00:00`);
      const hoje = new Date();
      if (Number.isNaN(nascDate.getTime()) || nascDate > hoje) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Data Inválida', 'A data de nascimento não pode ser futura.');
        return;
      }
      let idade = hoje.getFullYear() - nascDate.getFullYear();
      const fezAniversario = (hoje.getMonth() > nascDate.getMonth()) || (hoje.getMonth() === nascDate.getMonth() && hoje.getDate() >= nascDate.getDate());
      if (!fezAniversario) idade--;
      if (idade < 18) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Menor de Idade', `Funcionários do terminal precisam ter 18 anos ou mais. A data informada corresponde a ${idade} ano(s).`);
        return;
      }

      const formattedMatricula = matriculaRaw.toUpperCase().startsWith('MAT-') ? matriculaRaw.toUpperCase() : `MAT-${matriculaRaw.toUpperCase()}`;

      // Tarefa 4: Padronizar a matrícula de funcionários no padrão MAT-4 números (ex: MAT-1234)
      const matriculaPattern = /^MAT-\d{4}$/;
      if (!matriculaPattern.test(formattedMatricula)) {
        const msg = 'PADRÃO DE MATRÍCULA INVÁLIDO: A matrícula do funcionário deve seguir obrigatoriamente a estrutura MAT-4 números (Exemplo: MAT-1234 ou MAT-5678)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Inválida', msg);
        return;
      }

      // Validação de Duplicidade Rígida: Bloqueia qualquer cadastro com a mesma matrícula
      const funcionarioExistente = mergedFuncList.find(f => f.matricula.toUpperCase() === formattedMatricula);
      if (funcionarioExistente) {
        const msg = `BLOQUEIO DE DUPLICIDADE: A matrícula "${formattedMatricula}" já está cadastrada no sistema para o funcionário "${funcionarioExistente.nome}". Não é permitido cadastrar mais de uma pessoa com a mesma matrícula!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Duplicada', msg);
        return;
      }

      // Bloqueio de CPF duplicado no cache local (funcionários e visitantes)
      const cpfDuplicadoLocal = mergedFuncList.find(f => fatiarCpfSomenteDigitos(f.cpf || f.documento || '') === cpfDigits);
      if (cpfDuplicadoLocal) {
        const msg = `BLOQUEIO DE DUPLICIDADE: o CPF ${formatarCpfExibicao(cpfDigits)} já está cadastrado para "${cpfDuplicadoLocal.nome}". Cada pessoa pode ter apenas um cadastro no sistema!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', msg);
        return;
      }
      const cpfVisDuplicadoLocal = (typeof visList !== 'undefined' && Array.isArray(visList) ? visList : []).find(v =>
        fatiarCpfSomenteDigitos(v.documento || '') === cpfDigits);
      if (cpfVisDuplicadoLocal) {
        const msg = `BLOQUEIO DE DUPLICIDADE: o CPF ${formatarCpfExibicao(cpfDigits)} já está cadastrado para o visitante "${cpfVisDuplicadoLocal.nome}". Cada pessoa pode ter apenas um cadastro no sistema!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', msg);
        return;
      }

      // Validação assíncrona adicional no Supabase
      if (window.nexusSupabase) {
        try {
          const { data: dupData } = await window.nexusSupabase
            .from('funcionarios')
            .select('nome, matricula')
            .eq('matricula', formattedMatricula)
            .maybeSingle();

          if (dupData) {
            const msg = `BLOQUEIO DE DUPLICIDADE (Supabase): A matrícula "${formattedMatricula}" já pertence ao funcionário "${dupData.nome}". Não é permitido cadastrar duplicidades!`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Duplicada', msg);
            return;
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao verificar duplicidade no Supabase:', err);
        }

        // CPF duplicado no Supabase (coluna nova: ignora se a migração pendente)
        try {
          const { data: dupCpf, error: dupCpfErr } = await window.nexusSupabase
            .from('funcionarios')
            .select('nome, matricula')
            .eq('cpf', cpfDigits)
            .maybeSingle();
          if (!dupCpfErr && dupCpf) {
            const msg = `BLOQUEIO DE DUPLICIDADE (Supabase): o CPF ${formatarCpfExibicao(cpfDigits)} já pertence ao funcionário "${dupCpf.nome}". Não é permitido cadastrar duplicidades!`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado', msg);
            return;
          }
        } catch (err) {
          console.warn('[NexusPort] Verificação de CPF no Supabase indisponível (migração pendente?):', err);
        }
      }

      const suffix = Math.floor(1000 + Math.random() * 9000);
      const codigo = `NX-${formattedMatricula.replace('MAT-', '')}-${suffix}`;

      const novoFuncionario = {
        matricula: formattedMatricula,
        nome: nome,
        cargo: cargoText,
        cargo_enum: cargoValue,
        codigo: codigo,
        cpf: cpfDigits,
        data_nascimento: dataNasc,
        doc: doc || 'Cadastrado no Sistema',
        documentacao_interna: doc || '',
        ativo: true
      };

      if (doc && podeEditarDocumentacaoFuncionario(session)) {
        salvarDocLocalFuncionario(formattedMatricula, null, doc);
      }

      const localList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      localList.unshift(novoFuncionario);
      localStorage.setItem('nexus_func_list', JSON.stringify(localList));

      let insertedFuncId = null;
      let avisoMigracao = '';
      if (window.nexusSupabase) {
        try {
          const payloadBase = {
            matricula: formattedMatricula,
            codigo_individual: codigo,
            nome: nome,
            cargo: cargoValue,
            ativo: true
          };
          const payloadCompleto = { ...payloadBase, cpf: cpfDigits, data_nascimento: dataNasc };
          if (doc && podeEditarDocumentacaoFuncionario(session)) {
            payloadCompleto.documentacao_interna = doc;
          }
          let insData = null;
          const tentativa1 = await window.nexusSupabase.from('funcionarios').insert(payloadCompleto).select('id').single();
          if (tentativa1.error) {
            const msgErro = `${tentativa1.error.message || ''} ${tentativa1.error.code || ''}`;
            if (/column|PGRST204|42703/i.test(msgErro)) {
              if (payloadCompleto.documentacao_interna && /documentacao_interna/i.test(msgErro)) {
                const payloadSemDoc = { ...payloadBase, cpf: cpfDigits, data_nascimento: dataNasc };
                const tentativaSemDoc = await window.nexusSupabase.from('funcionarios').insert(payloadSemDoc).select('id').single();
                insData = tentativaSemDoc.data || null;
              } else {
                // Colunas cpf/data_nascimento ainda não existem no banco: salva o
                // básico e avisa o técnico para aplicar a migração SQL.
                avisoMigracao = ' Aviso: as colunas cpf/data_nascimento ainda não existem no Supabase — aplique a migração supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql para sincronizá-las.';
                const tentativa2 = await window.nexusSupabase.from('funcionarios').insert(payloadBase).select('id').single();
                insData = tentativa2.data || null;
              }
            } else {
              throw tentativa1.error;
            }
          } else {
            insData = tentativa1.data;
          }

          if (insData) {
            insertedFuncId = insData.id;
            if (doc && podeEditarDocumentacaoFuncionario(session)) {
              salvarDocLocalFuncionario(formattedMatricula, insertedFuncId, doc);
            }
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'funcionarios', insertedFuncId, { matricula: formattedMatricula, nome, cargo: cargoValue });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar funcionário com Supabase:', err);
        }
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('funcionarios');
      }

      await carregarFuncionariosCompleto();
      funcForm.reset();
      funcForm.classList.add('hidden');

      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Funcionário Cadastrado', `Funcionário ${nome} cadastrado com sucesso! Código de acesso gerado: ${codigo}${avisoMigracao}`);
      }
    });
  }

  // CRUD Visitantes (T2.2 & Separação em Ativos / Histórico)
  const toggleVisBtn = document.getElementById('toggleVisFormBtn');
  const visForm = document.getElementById('visCrudForm');
  const visTableBody = document.getElementById('visCrudTableBody');
  const visHistoricoTableBody = document.getElementById('visHistoricoTableBody');

  let visList = JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');

  async function carregarVisitantesCompleto() {
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('visitantes')
          .select('*')
          .order('data_hora_entrada', { ascending: false });
        if (!error && Array.isArray(data)) {
          visList = data.map(s => {
            const isConcluido = Boolean(s.data_hora_saida);
            return {
              id: s.id,
              nome: s.nome,
              documento: s.documento,
              motivo: s.motivo,
              // `visitantes` não possui coluna status: a situação vem da saída.
              status: isConcluido ? 'CONCLUIDO' : 'EM_VISITA',
              data: s.data_hora_entrada ? new Date(s.data_hora_entrada).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR'),
              data_saida: s.data_hora_saida ? new Date(s.data_hora_saida).toLocaleString('pt-BR') : null,
              vistoria: isConcluido ? 'Vistoria em Ordem - Concluída' : null,
              por: s.registrado_por || session.matricula
            };
          });
          localStorage.setItem('nexus_vis_list', JSON.stringify(visList));
          renderVisTables();
          return;
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao carregar visitantes do Supabase:', err);
      }
    }

    visList = JSON.parse(localStorage.getItem('nexus_vis_list') || '[]');
    renderVisTables();
  }

  function renderVisTables() {
    const ativos = visList.filter(v => !v.data_saida && v.status !== 'CONCLUIDO');
    const historico = visList.filter(v => v.data_saida || v.status === 'CONCLUIDO');

    // 1. Renderiza Visitantes Ativos
    if (visTableBody) {
      if (ativos.length === 0) {
        visTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="p-4 text-center text-slate-600 italic">Nenhum visitante ativo no porto no momento.</td>
          </tr>
        `;
      } else {
        visTableBody.innerHTML = ativos.map(v => {
          const vKey = v.id || `${v.nome}_${v.documento}`;
          const isAguardando = v.status === 'AGUARDANDO_AUTORIZACAO';
          return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <td class="p-3 font-bold">${esc(v.nome)}</td>
              <td class="p-3 font-mono text-xs">${esc(v.documento)}</td>
              <td class="p-3 text-slate-600">${esc(v.motivo)}</td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                  isAguardando ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                }">
                  ${esc(v.status || 'EM_VISITA')}
                </span>
              </td>
              <td class="p-3 font-mono text-xs text-slate-600">${esc(v.data)}</td>
              <td class="p-3 font-mono text-xs font-bold text-nexus-500">${esc(nomeResponsavelRegistro(v.por || session.matricula))}</td>
              <td class="p-3 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-2">
                  ${isAguardando ? `
                    <button type="button" onclick="window.alterarStatusVisitante(${jsArg(vKey)}, 'EM_VISITA')" class="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors">
                      <span class="material-symbols-outlined text-[16px]">how_to_reg</span>
                      <span>Autorizar (Entrar em Visita)</span>
                    </button>
                  ` : ''}
                  <button type="button" onclick="window.registrarSaidaVisitante(${jsArg(vKey)})" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors">
                    <span class="material-symbols-outlined text-[16px]">logout</span>
                    <span>Registrar Saída & Vistoria</span>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 2. Renderiza Histórico de Visitas Concluídas no Ano
    if (visHistoricoTableBody) {
      if (historico.length === 0) {
        visHistoricoTableBody.innerHTML = `
          <tr>
            <td colspan="7" class="p-4 text-center text-slate-600 italic">Nenhuma visita concluída registrada no histórico do ano.</td>
          </tr>
        `;
      } else {
        visHistoricoTableBody.innerHTML = historico.map(v => `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <td class="p-3 font-bold text-slate-700 dark:text-slate-200">${esc(v.nome)}</td>
            <td class="p-3 font-mono text-xs">${esc(v.documento)}</td>
            <td class="p-3 text-slate-600">${esc(v.motivo)}</td>
            <td class="p-3 font-mono text-xs text-slate-600">${esc(v.data)}</td>
            <td class="p-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">${esc(v.data_saida || 'Concluída')}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ${esc(v.vistoria || 'Vistoria em Ordem - Sem Anormalidades')}
              </span>
            </td>
            <td class="p-3 font-mono text-xs text-slate-600">${esc(nomeResponsavelRegistro(v.por || session.matricula))}</td>
          </tr>
        `).join('');
      }
    }
  }

  // Alterar Status do Visitante (ex: de AGUARDANDO_AUTORIZACAO para EM_VISITA - Item 5)
  window.alterarStatusVisitante = async function(visitorKey, novoStatus) {
    const visitor = visList.find(v => (v.id && v.id === visitorKey) || (`${v.nome}_${v.documento}` === visitorKey));
    if (!visitor) return;

    visitor.status = novoStatus;
    localStorage.setItem('nexus_vis_list', JSON.stringify(visList));

    // A tabela `visitantes` não possui coluna de status: a situação exibida é
    // derivada de `data_hora_saida` (entrada/saída). Gravar `status` causava erro
    // PGRST204 silencioso; a mudança de situação é mantida apenas na interface e
    // fica registrada no log de auditoria.
    if (window.nexusSupabase && window.registrarLogAlteracao) {
      try {
        await window.registrarLogAlteracao('EDICAO', 'visitantes', visitor.id || null, { visitante: visitor.nome, novo_status: novoStatus });
      } catch (err) {
        console.warn('[NexusPort] Erro ao auditar status do visitante no Supabase:', err);
      }
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('visitantes');
    }

    renderVisTables();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Status Atualizado', `Status do visitante ${visitor.nome} alterado para "${novoStatus}" com sucesso!`);
    }
  };

  // Registrar Saída do Visitante (Move do Ativo para o Histórico)
  window.registrarSaidaVisitante = async function(visitorKey, opcoes) {
    const visitor = visList.find(v => (v.id && v.id === visitorKey) || (`${v.nome}_${v.documento}` === visitorKey));
    if (!visitor) return;

    const dataSaidaStr = (opcoes && opcoes.dataSaida) ? opcoes.dataSaida : window.nexusPrompt ? await window.nexusPrompt('Registrar Saída', `Informe a data/hora de saída do visitante ${visitor.nome}:`, new Date().toLocaleString('pt-BR')) : new Date().toLocaleString('pt-BR');
    if (!dataSaidaStr) return;

    const parecerVistoria = (opcoes && opcoes.parecer) ? opcoes.parecer : window.nexusPrompt ? await window.nexusPrompt('Parecer da Vistoria', `Informe o parecer da vistoria para ${visitor.nome}:`, 'Vistoria em Ordem - Sem Anormalidades') : 'Vistoria em Ordem - Sem Anormalidades';

    visitor.status = 'CONCLUIDO';
    visitor.data_saida = dataSaidaStr;
    visitor.vistoria = parecerVistoria || 'Vistoria em Ordem - Sem Anormalidades';

    localStorage.setItem('nexus_vis_list', JSON.stringify(visList));

    if (window.nexusSupabase) {
      try {
        const textoOriginal = visitor.motivo || 'Visita técnica';
        const textoVistoria = visitor.vistoria || 'Vistoria em Ordem';
        let motivoFormatado = `${textoOriginal} | ${textoVistoria}`;
        if (motivoFormatado.length > 200) {
          motivoFormatado = motivoFormatado.substring(0, 197) + '...';
        }

        if (visitor.id) {
          await window.nexusSupabase.from('visitantes')
            .update({
              data_hora_saida: new Date().toISOString(),
              motivo: motivoFormatado
            })
            .eq('id', visitor.id);
        } else {
          await window.nexusSupabase.from('visitantes')
            .update({
              data_hora_saida: new Date().toISOString(),
              motivo: motivoFormatado
            })
            .eq('documento', visitor.documento);
        }

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'visitantes', visitor.id || null, { visitante: visitor.nome, saida: dataSaidaStr, parecer: visitor.vistoria });
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar saída de visitante no Supabase:', err);
      }
    }

    if (window.NexusRepository && window.NexusRepository.notifyChange) {
      window.NexusRepository.notifyChange('visitantes');
    }

    renderVisTables();
    if (window.mostrarFeedback) {
      window.mostrarFeedback('sucesso', 'Saída Registrada', `Saída do visitante ${visitor.nome} registrada com sucesso! Visita concluída e arquivada no histórico.`);
    }
  };

  carregarVisitantesCompleto();

  if (toggleVisBtn && visForm) {
    toggleVisBtn.addEventListener('click', () => visForm.classList.toggle('hidden'));
  }

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

  // Tarefa 6 (Correções): auxiliares de identidade do visitante — o CPF é
  // comparado apenas pelos dígitos (ignora máscara/pontuação) e o nome é
  // comparado ignorando apenas diferenças de caixa e espaços extras, conforme
  // o critério de "mesma pessoa" do cadastro de visitantes.
  function somenteDigitosDoc(doc) {
    return String(doc == null ? '' : doc).replace(/\D/g, '');
  }

  function normalizarNomePessoa(nomePessoa) {
    return String(nomePessoa == null ? '' : nomePessoa).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function aplicarMascaraCPF(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  const visDocInput = document.getElementById('visDocumento');
  if (visDocInput) {
    visDocInput.addEventListener('input', (e) => {
      if (e.target.value.replace(/\D/g, '').length <= 11) {
        e.target.value = aplicarMascaraCPF(e.target.value);
      }
    });
  }

  if (visForm) {
    visForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome = document.getElementById('visNome').value.trim();
      const documento = document.getElementById('visDocumento').value.trim();
      const motivo = document.getElementById('visMotivo').value.trim();
      // Tarefa 13: Status inicial automático em "EM_VISITA"
      const status = 'EM_VISITA';

      // Validação do documento do visitante no padrão do CPF (11 dígitos não todos iguais, permite CPFs fictícios - Tarefa 5 / V-06)
      const docClean = documento.replace(/\D/g, '');
      if (docClean.length !== 11 || !validarCpf(docClean) || !validarCPF(docClean)) {
        const msg = 'DOCUMENTO DO VISITANTE INVÁLIDO: O documento deve seguir o padrão do CPF (XXX.XXX.XXX-XX) com 11 dígitos numéricos não todos iguais (são permitidos CPFs fictícios)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Inválido', msg);
        return;
      }


      const funcComMesmoCpf = (mergedFuncList || []).find(f => fatiarCpfSomenteDigitos(f.cpf || f.documento || '') === docClean);
      if (funcComMesmoCpf) {
        const msg = `BLOQUEIO DE SEGURANÇA: O CPF "${formatarCpfExibicao(docClean)}" já pertence ao funcionário "${funcComMesmoCpf.nome}". Cada pessoa deve possuir CPF único no sistema!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Duplicado', msg);
        return;
      }

      // ── Tarefa 6 (Correções): identidade do visitante por CPF × nome ──────
      // Substitui o bloqueio C14 antigo (que recusava QUALQUER documento
      // repetido) pela regra de identidade:
      //  • CPF igual (só dígitos) + nome idêntico (ignorando caixa e espaços
      //    extras) ⇒ MESMA pessoa: cadastro aceito sem erro de duplicidade e
      //    sem criar registro conflitante (a visita em andamento é
      //    reaproveitada; caso contrário abre-se uma nova visita da pessoa).
      //  • CPF igual + nome diferente (mesmo que minimamente) ⇒ RECUSADO com
      //    mensagem clara: o mesmo CPF não pode pertencer a dois nomes.
      //  • CPF novo ⇒ cadastro normal, sem mudanças.
      const nomeNormalizado = normalizarNomePessoa(nome);
      const mesmoCpfLocal = visList.filter(v => somenteDigitosDoc(v.documento) === docClean);
      const conflitoLocal = mesmoCpfLocal.find(v => normalizarNomePessoa(v.nome) !== nomeNormalizado);
      if (conflitoLocal) {
        const msg = `BLOQUEIO DE SEGURANÇA: O CPF "${documento}" já está cadastrado para outro visitante ("${conflitoLocal.nome}"). O mesmo CPF não pode pertencer a dois nomes diferentes — confira o nome e o CPF informados.`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado com Outro Nome', msg);
        return;
      }

      // Mesmo CPF + mesmo nome ⇒ mesma pessoa; sem correspondência ⇒ CPF novo.
      let visitasMesmoCpfDb = [];

      if (window.nexusSupabase) {
        try {
          // Busca os candidatos e compara localmente pelos dígitos do CPF: o
          // documento pode estar gravado com ou sem máscara (o .eq('documento')
          // exato do bloqueio antigo não cobria variações de formato nem
          // distinguia mesma pessoa de nome diferente).
          const { data: visitasDb } = await window.nexusSupabase
            .from('visitantes')
            .select('id, nome, documento, data_hora_saida');
          const candidatosDb = Array.isArray(visitasDb) ? visitasDb : (visitasDb ? [visitasDb] : []);
          visitasMesmoCpfDb = candidatosDb.filter(v => somenteDigitosDoc(v.documento) === docClean);

          const conflitoDb = visitasMesmoCpfDb.find(v => normalizarNomePessoa(v.nome) !== nomeNormalizado);
          if (conflitoDb) {
            const msg = `BLOQUEIO DE SEGURANÇA: O CPF "${documento}" já está registrado no banco de dados para outro visitante ("${conflitoDb.nome}"). O mesmo CPF não pode pertencer a dois nomes diferentes.`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Já Cadastrado com Outro Nome', msg);
            return;
          }

          const { data: dupFuncCpf, error: dupFuncErr } = await window.nexusSupabase
            .from('funcionarios')
            .select('nome, cpf')
            .eq('cpf', docClean)
            .maybeSingle();

          const funcCpfRegistro = Array.isArray(dupFuncCpf) ? dupFuncCpf[0] : dupFuncCpf;
          if (!dupFuncErr && funcCpfRegistro && (funcCpfRegistro.nome || funcCpfRegistro.cpf)) {
            const msg = `BLOQUEIO DE SEGURANÇA: O CPF "${formatarCpfExibicao(docClean)}" já pertence ao funcionário "${funcCpfRegistro.nome}" no banco de dados. Duplicação bloqueada.`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Duplicado', msg);
            return;
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao validar documento no Supabase:', err);
        }
      }

      // Mesma pessoa com visita EM ANDAMENTO: não cria registro conflitante —
      // reaproveita a visita ativa (atualizando motivo/data-hora/responsável),
      // mantendo uma única identidade no livro de visitas. Visitas já
      // concluídas permanecem no histórico; uma nova visita cria novo registro.
      const ehUuidVis = (valor) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor || ''));
      const visitaAtivaLocal = mesmoCpfLocal.find(v => !v.data_saida && v.status !== 'CONCLUIDO') || null;
      const visitaAtivaDb = !visitaAtivaLocal ? (visitasMesmoCpfDb.find(v => !v.data_hora_saida) || null) : null;
      const visitaAtiva = visitaAtivaLocal || visitaAtivaDb;
      if (visitaAtiva) {
        const agoraVisita = new Date();
        if (visitaAtivaLocal) {
          visitaAtivaLocal.motivo = motivo;
          visitaAtivaLocal.data = agoraVisita.toLocaleString('pt-BR');
          visitaAtivaLocal.por = session.matricula;
          visitaAtivaLocal.status = status;
        } else {
          // Visita ativa vista apenas no banco (espelho local desatualizado,
          // ex.: registro feito em outro dispositivo): traz para a lista como
          // a mesma pessoa, sem duplicar.
          visList.unshift({
            id: visitaAtivaDb.id,
            nome,
            documento,
            motivo,
            status,
            data: agoraVisita.toLocaleString('pt-BR'),
            data_saida: null,
            vistoria: null,
            por: session.matricula
          });
        }
        localStorage.setItem('nexus_vis_list', JSON.stringify(visList));

        if (window.nexusSupabase && ehUuidVis(visitaAtiva.id)) {
          try {
            await window.nexusSupabase.from('visitantes')
              .update({ motivo, data_hora_entrada: agoraVisita.toISOString() })
              .eq('id', visitaAtiva.id);
          } catch (err) {
            console.warn('[NexusPort] Erro ao atualizar visita ativa no Supabase:', err);
          }
        }
        if (window.registrarLogAlteracao) {
          try {
            await window.registrarLogAlteracao('EDICAO', 'visitantes', ehUuidVis(visitaAtiva.id) ? visitaAtiva.id : null, { nome, documento, motivo, mesma_pessoa: true });
          } catch (err) {
            console.warn('[NexusPort] Erro ao auditar reaproveitamento de visita:', err);
          }
        }

        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('visitantes');
        }

        renderVisTables();
        visForm.reset();
        visForm.classList.add('hidden');
        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Visitante Registrado', `Entrada de ${nome} (Status: ${status}) registrada — visitante já cadastrado com o mesmo CPF e o mesmo nome (mesma pessoa), sem duplicidade.`);
        }
        return;
      }

      // CPF novo OU mesma pessoa sem visita em andamento (nova visita): fluxo
      // de criação normal.
      const pessoaJaCadastrada = mesmoCpfLocal.length > 0 || visitasMesmoCpfDb.length > 0;
      const novoVisitante = {
        id: `VIS-${Math.floor(1000 + Math.random() * 9000)}`,
        nome,
        documento,
        motivo,
        status,
        data: new Date().toLocaleString('pt-BR'),
        data_saida: null,
        vistoria: null,
        por: session.matricula
      };

      let insertedVisId = null;
      if (window.nexusSupabase) {
        try {
          const { data: insVis, error: insVisErr } = await window.nexusSupabase.from('visitantes').insert({
            nome: nome,
            documento: documento,
            motivo: motivo,
            data_hora_entrada: new Date().toISOString(),
            // Autoria do registro: FK uuid para funcionarios(id) — nunca a matrícula.
            registrado_por: await resolverFuncionarioId()
          }).select('id').single();

          if (insVisErr) throw insVisErr;

          if (insVis && insVis.id) {
            insertedVisId = insVis.id;
            novoVisitante.id = insVis.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'visitantes', insertedVisId, { nome, documento, motivo });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar visitante com Supabase:', err);
          if (window.mostrarFeedback) {
            window.mostrarFeedback('erro', 'Visitante Não Registrado',
              `Não foi possível gravar o visitante ${nome} no banco de dados. Nenhum registro foi criado; tente novamente.`);
          }
          return;
        }
      } else {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('erro', 'Sem Conexão com o Banco',
            'O registro de visitantes exige conexão com o Supabase. Nenhum registro foi criado.');
        }
        return;
      }

      visList.push(novoVisitante);
      localStorage.setItem('nexus_vis_list', JSON.stringify(visList));

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('visitantes');
      }

      renderVisTables();
      visForm.reset();
      visForm.classList.add('hidden');
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Visitante Registrado', pessoaJaCadastrada
          ? `Entrada do visitante ${nome} (Status: ${status}) registrada com sucesso — pessoa já cadastrada (mesmo CPF e mesmo nome): nova visita aberta.`
          : `Entrada do visitante ${nome} (Status: ${status}) registrada com sucesso.`);
      }
    });
  }

  function aplicarRestricoesTecnicoPortos() {
    // Tarefa 7: Técnico em Portos e Diretor têm acesso à edição da documentação interna
    // do funcionário na seção de Funcionários & Documentação Interna.
    const docCampo = document.getElementById('funcDoc');
    if (docCampo) {
      const podeDoc = podeEditarDocumentacaoFuncionario(session);
      docCampo.disabled = !podeDoc;
      docCampo.readOnly = !podeDoc;
      docCampo.title = podeDoc ? '' : 'Alteração de documentação interna restrita ao Diretor e ao Técnico em Portos';
      docCampo.classList.toggle('bg-slate-100', !podeDoc);
      docCampo.classList.toggle('dark:bg-slate-800/80', !podeDoc);
      docCampo.classList.toggle('cursor-not-allowed', !podeDoc);
      docCampo.classList.toggle('opacity-75', !podeDoc);
    }
  }
  aplicarRestricoesTecnicoPortos();

  // Sincronização viva em tempo real (Item 2 / L-06)
  const ENTIDADES_FUNC_TECNICO = new Set(['funcionarios', 'nexus_func_list']);
  const ENTIDADES_VIS_TECNICO = new Set(['visitantes', 'funcionarios', 'nexus_vis_list', 'nexus_func_list']);
  const ENTIDADES_SYNC_GERAL_TECNICO = new Set([
    'periodic_sync', 'window_focus', 'visibility_sync', 'online_sync', 'realtime_sync'
  ]);
  window.addEventListener('nexus_data_changed', (event) => {
    const entity = event && event.detail ? event.detail.entity : null;
    const geral = !entity || ENTIDADES_SYNC_GERAL_TECNICO.has(entity);
    if (!geral && !ENTIDADES_FUNC_TECNICO.has(entity) && !ENTIDADES_VIS_TECNICO.has(entity)) return;
    if (geral || ENTIDADES_FUNC_TECNICO.has(entity)) {
      carregarFuncionariosCompleto();
    }
    if (geral || ENTIDADES_VIS_TECNICO.has(entity)) {
      carregarVisitantesCompleto();
    }
  });
});
