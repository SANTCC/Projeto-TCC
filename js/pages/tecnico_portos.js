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

  // Validação de CPF: 11 dígitos + dígitos verificadores (módulo 11).
  // Os dois últimos dígitos são calculados a partir dos 9 primeiros, por isso
  // sequências genéricas de documentação não passam na checagem e não podem ser
  // sugeridas como placeholder: a interface orienta apenas sobre a regra.
  function validarCpf(cpf) {
    const d = fatiarCpfSomenteDigitos(cpf);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(d[i], 10) * (10 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(d[9], 10)) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(d[i], 10) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    return resto === parseInt(d[10], 10);
  }

  // Busca por matrícula (usada pela interface e pelas ferramentas WebMCP).
  async function buscarFuncionarioPorMatricula(q) {
      if (!q) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Obrigatória', 'Informe a matrícula para buscar.');
        return null;
      }

      const formattedMatricula = q.startsWith('MAT-') ? q : `MAT-${q}`;
      const storedOverrides = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');
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
        if (resCargo) resCargo.textContent = `${selectedEmp.cargo_nome || selectedEmp.cargo} (${selectedEmp.matricula})`;

        const currentCode = storedOverrides[selectedEmp.matricula]?.codigo || selectedEmp.codigo;
        if (resCodigo) resCodigo.textContent = currentCode;

        if (regenBtn) regenBtn.disabled = false;
        if (regenNotice) regenNotice.classList.add('hidden');
      } else {
        if (window.mostrarFeedback) {
          window.mostrarFeedback('atencao', 'Não Encontrado', `Funcionário com matrícula "${q}" não localizado no banco de dados.`);
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
      suggestBox.innerHTML = top.map(({ f }) => {
        const mat = String(f.matricula || '');
        const nome = String(f.nome || 'Sem nome');
        const cargo = String(f.cargo_nome || f.cargo || '');
        return `<button type="button" data-matricula="${esc(mat)}" class="w-full text-left px-3 py-2 hover:bg-nexus-bg dark:hover:bg-slate-800 flex flex-col gap-0.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
          <span class="font-mono font-bold text-nexus-900 dark:text-white">${esc(nome)}</span>
          <span class="font-mono text-slate-500 dark:text-slate-400">${esc(mat)} • ${esc(cargo)}</span>
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
        const btn = e.target.closest('[data-matricula]');
        if (!btn) return;
        searchInput.value = btn.getAttribute('data-matricula');
        esconderSugestoes();
        buscarFuncionarioPorMatricula(searchInput.value.trim().toUpperCase());
      });
    }
  }

  // Reemissão de código (RN 15). Só a interface do Técnico exibe o novo código; ele nunca volta para o agente.
  async function reemitirCodigoSelecionado(opcoes) {
      if (!selectedEmp) return false;

      const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Invalidar Código', `Confirma a INVALIDAÇÃO do código atual (${resCodigo.textContent}) para ${selectedEmp.nome}?`) : true;

      if (confirmou) {
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const newCode = `NX-${selectedEmp.matricula.replace('MAT-', '')}-${suffix}`;

        const storedOverrides = JSON.parse(localStorage.getItem('nexus_code_overrides') || '{}');
        storedOverrides[selectedEmp.matricula] = {
          old_codigo: resCodigo.textContent,
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

  // CRUD Funcionários (T2.1 & Conexão Supabase)
  const toggleFuncBtn = document.getElementById('toggleFuncFormBtn');
  const funcForm = document.getElementById('funcCrudForm');
  const funcTableBody = document.getElementById('funcCrudTableBody');

  let mergedFuncList = [];

  async function carregarFuncionariosCompleto() {
    let funcs = [];
    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('funcionarios')
          .select('*')
          .order('nome', { ascending: true });
        if (!error && Array.isArray(data)) {
          funcs = data.map(s => ({
            matricula: s.matricula,
            nome: s.nome,
            cargo: s.cargo_nome || s.cargo,
            codigo: s.codigo_individual || `NX-${String(s.matricula || '').replace('MAT-', '')}-SP`,
            cpf: s.cpf || '',
            data_nascimento: s.data_nascimento || '',
            doc: s.ativo ? 'Ativo no Supabase' : 'Inativo no Supabase',
            ativo: s.ativo,
            id: s.id
          }));
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
    mergedFuncList = localList;
    renderFuncTable();
  }

  function renderFuncTable() {
    if (!funcTableBody) return;
    funcTableBody.innerHTML = mergedFuncList.map(f => `
      <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td class="p-3 font-mono font-bold text-nexus-500">${esc(f.matricula)}</td>
        <td class="p-3 font-bold">${esc(f.nome)}</td>
        <td class="p-3 text-slate-500 font-semibold">${esc(f.cargo)}</td>
        <td class="p-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">${esc(f.codigo)}</td>
        <td class="p-3 font-mono text-slate-600 dark:text-slate-300">${esc(formatarCpfExibicao(f.cpf))}</td>
        <td class="p-3 font-mono text-slate-500">${esc(formatarDataNascExibicao(f.data_nascimento))}</td>
        <td class="p-3 text-slate-400 font-mono text-xs flex items-center justify-between">
          <span class="${f.ativo ? 'text-emerald-600 font-bold' : 'text-slate-400'}">${esc(f.doc || 'Cadastrado')}</span>
          <button type="button" onclick="window.excluirFuncionarioReal(${jsArg(f.matricula)})" class="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-xs">Excluir</button>
        </td>
      </tr>
    `).join('');
  }

  window.excluirFuncionarioReal = async function(matricula, opcoes) {
    const confirmou = (opcoes && opcoes.confirmado === true) ? true : window.nexusConfirm ? await window.nexusConfirm('Excluir Funcionário', `Tem certeza que deseja desativar/excluir o funcionário de matrícula ${matricula}?`) : true;
    if (confirmou) {
      if (window.NexusRepository && window.NexusRepository.deleteFuncionario) {
        await window.NexusRepository.deleteFuncionario(matricula);
      } else if (window.nexusSupabase) {
        await window.nexusSupabase.from('funcionarios').update({ ativo: false }).eq('matricula', matricula);
      }

      if (window.registrarLogAlteracao) {
        await window.registrarLogAlteracao('EXCLUSAO', 'funcionarios', null, { matricula, motivo: 'Desativação pelo Técnico em Portos' });
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('funcionarios');
      }

      await carregarFuncionariosCompleto();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Funcionário Desativado', `Funcionário de matrícula ${matricula} desativado com sucesso.`);
      }
    }
  };

  carregarFuncionariosCompleto();

  if (toggleFuncBtn && funcForm) {
    toggleFuncBtn.addEventListener('click', () => funcForm.classList.toggle('hidden'));
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

      // CPF obrigatório e válido (11 dígitos + dígitos verificadores)
      if (!validarCpf(cpfRaw)) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'CPF Inválido', 'Informe um CPF válido com 11 dígitos. Os dois últimos números são os dígitos verificadores, calculados a partir dos 9 primeiros, e precisam conferir: o cadastro é recusado quando eles são inventados.');
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
        const msg = 'PADRÃO DE MATRÍCULA INVÁLIDO (Tarefa 4): A matrícula do funcionário deve seguir obrigatoriamente a estrutura MAT-4 números (Exemplo: MAT-1234 ou MAT-5678)!';
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

      // Bloqueio de CPF duplicado no cache local
      const cpfDuplicadoLocal = mergedFuncList.find(f => fatiarCpfSomenteDigitos(f.cpf || f.documento || '') === cpfDigits);
      if (cpfDuplicadoLocal) {
        const msg = `BLOQUEIO DE DUPLICIDADE: o CPF ${formatarCpfExibicao(cpfDigits)} já está cadastrado para "${cpfDuplicadoLocal.nome}" (${cpfDuplicadoLocal.matricula}). Cada pessoa pode ter apenas um cadastro no sistema!`;
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
            const msg = `BLOQUEIO DE DUPLICIDADE (Supabase): o CPF ${formatarCpfExibicao(cpfDigits)} já pertence ao funcionário "${dupCpf.nome}" (${dupCpf.matricula}). Não é permitido cadastrar duplicidades!`;
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
        ativo: true
      };

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
          let insData = null;
          const tentativa1 = await window.nexusSupabase.from('funcionarios').insert(payloadCompleto).select('id').single();
          if (tentativa1.error) {
            const msgErro = `${tentativa1.error.message || ''} ${tentativa1.error.code || ''}`;
            if (/column|PGRST204|42703/i.test(msgErro)) {
              // Colunas cpf/data_nascimento ainda não existem no banco: salva o
              // básico e avisa o técnico para aplicar a migração SQL.
              avisoMigracao = ' Aviso: as colunas cpf/data_nascimento ainda não existem no Supabase — aplique a migração supabase/migrations/20261010000000_funcionarios_cpf_nascimento.sql para sincronizá-las.';
              const tentativa2 = await window.nexusSupabase.from('funcionarios').insert(payloadBase).select('id').single();
              insData = tentativa2.data || null;
            } else {
              throw tentativa1.error;
            }
          } else {
            insData = tentativa1.data;
          }

          if (insData) insertedFuncId = insData.id;

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
              status: isConcluido ? 'CONCLUIDO' : (s.status || 'EM_VISITA'),
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
            <td colspan="7" class="p-4 text-center text-slate-400 italic">Nenhum visitante ativo no porto no momento.</td>
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
              <td class="p-3 text-slate-500">${esc(v.motivo)}</td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                  isAguardando ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                }">
                  ${esc(v.status || 'EM_VISITA')}
                </span>
              </td>
              <td class="p-3 font-mono text-xs text-slate-400">${esc(v.data)}</td>
              <td class="p-3 font-mono text-xs font-bold text-nexus-500">${esc(v.por || session.matricula)}</td>
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
            <td colspan="7" class="p-4 text-center text-slate-400 italic">Nenhuma visita concluída registrada no histórico do ano.</td>
          </tr>
        `;
      } else {
        visHistoricoTableBody.innerHTML = historico.map(v => `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <td class="p-3 font-bold text-slate-700 dark:text-slate-200">${esc(v.nome)}</td>
            <td class="p-3 font-mono text-xs">${esc(v.documento)}</td>
            <td class="p-3 text-slate-500">${esc(v.motivo)}</td>
            <td class="p-3 font-mono text-xs text-slate-400">${esc(v.data)}</td>
            <td class="p-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">${esc(v.data_saida || 'Concluída')}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ${esc(v.vistoria || 'Vistoria em Ordem - Sem Anormalidades')}
              </span>
            </td>
            <td class="p-3 font-mono text-xs text-slate-400">${esc(v.por || session.matricula)}</td>
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

    if (window.nexusSupabase) {
      try {
        if (visitor.id) {
          await window.nexusSupabase.from('visitantes').update({ status: novoStatus }).eq('id', visitor.id);
        } else {
          await window.nexusSupabase.from('visitantes').update({ status: novoStatus }).eq('documento', visitor.documento);
        }

        if (window.registrarLogAlteracao) {
          await window.registrarLogAlteracao('EDICAO', 'visitantes', visitor.id || null, { visitante: visitor.nome, novo_status: novoStatus });
        }
      } catch (err) {
        console.warn('[NexusPort] Erro ao atualizar status do visitante no Supabase:', err);
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

      // Validação do documento do visitante no padrão do CPF (11 dígitos, permite CPFs fictícios - Tarefa 5)
      const docClean = documento.replace(/\D/g, '');
      if (docClean.length !== 11 || !validarCPF(docClean)) {
        const msg = 'DOCUMENTO DO VISITANTE INVÁLIDO: O documento deve seguir o padrão do CPF (XXX.XXX.XXX-XX) com 11 dígitos numéricos (são permitidos CPFs fictícios)!';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Inválido', msg);
        return;
      }

      // C14: Impedir cadastro de visitantes com documento duplicado
      const docNormalizado = documento.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const visitanteExistente = visList.find(v => v.documento.toUpperCase().replace(/[^A-Z0-9]/g, '') === docNormalizado);
      if (visitanteExistente) {
        const msg = `BLOQUEIO DE SEGURANÇA (C14): O documento "${documento}" já está cadastrado para o visitante "${visitanteExistente.nome}". Cada visitante deve possuir documento único!`;
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Duplicado', msg);
        return;
      }

      if (window.nexusSupabase) {
        try {
          const { data: dupVis } = await window.nexusSupabase
            .from('visitantes')
            .select('nome, documento')
            .eq('documento', documento)
            .maybeSingle();

          if (dupVis) {
            const msg = `BLOQUEIO DE SEGURANÇA (C14): Documento "${documento}" já registrado no banco de dados para "${dupVis.nome}". Duplicação bloqueada.`;
            if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Documento Duplicado', msg);
            return;
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao validar documento no Supabase:', err);
        }
      }

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
          const { data: insVis } = await window.nexusSupabase.from('visitantes').insert({
            nome: nome,
            documento: documento,
            motivo: motivo,
            data_hora_entrada: new Date().toISOString()
          }).select('id').single();

          if (insVis) {
            insertedVisId = insVis.id;
            novoVisitante.id = insVis.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'visitantes', insertedVisId, { nome, documento, motivo });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar visitante com Supabase:', err);
        }
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
        window.mostrarFeedback('sucesso', 'Visitante Registrado', `Entrada do visitante ${nome} (Status: ${status}) registrada com sucesso.`);
      }
    });
  }

  // Sincronização viva em tempo real (Item 2)
  window.addEventListener('nexus_data_changed', () => {
    carregarFuncionariosCompleto();
    carregarVisitantesCompleto();
  });
});
