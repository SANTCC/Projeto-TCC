/**
 * Lógica do Módulo do Técnico em Portos (tecnico_portos.html) - NexusPort
 * Gerencia invalidação/reemissão de códigos (RN 15 / T1.8), CRUD de funcionários (T2.1)
 * e livro de visitantes (T2.2).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

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

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', async () => {
      const q = searchInput.value.trim().toUpperCase();
      if (!q) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Matrícula Obrigatória', 'Informe a matrícula para buscar.');
        return;
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

      // 2. Consulta no cache local de funcionários reais se Supabase indisponível
      if (!found) {
        const dynamicFuncs = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
        const dyn = dynamicFuncs.find(f => f.matricula && (f.matricula.toUpperCase() === q || f.matricula.toUpperCase() === formattedMatricula));
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
    });
  }

  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      if (!selectedEmp) return;

      const confirmou = window.nexusConfirm ? await window.nexusConfirm('Invalidar Código', `Confirma a INVALIDAÇÃO do código atual (${resCodigo.textContent}) para ${selectedEmp.nome}?`) : true;

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
    });
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
            codigo: s.codigo_individual || `NX-${s.matricula.replace('MAT-', '')}-SP`,
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
        <td class="p-3 font-mono font-bold text-nexus-500">${f.matricula}</td>
        <td class="p-3 font-bold">${f.nome}</td>
        <td class="p-3 text-slate-500 font-semibold">${f.cargo}</td>
        <td class="p-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">${f.codigo}</td>
        <td class="p-3 text-slate-400 font-mono text-xs flex items-center justify-between">
          <span class="${f.ativo ? 'text-emerald-600 font-bold' : 'text-slate-400'}">${f.doc || 'Cadastrado'}</span>
          <button type="button" onclick="window.excluirFuncionarioReal('${f.matricula}')" class="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-xs">Excluir</button>
        </td>
      </tr>
    `).join('');
  }

  window.excluirFuncionarioReal = async function(matricula) {
    const confirmou = window.nexusConfirm ? await window.nexusConfirm('Excluir Funcionário', `Tem certeza que deseja desativar/excluir o funcionário de matrícula ${matricula}?`) : true;
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

  if (funcForm) {
    funcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const matriculaRaw = document.getElementById('funcMatricula').value.trim();
      const nome = document.getElementById('funcNome').value.trim();
      const cargoSelect = document.getElementById('funcCargo');
      const cargoValue = cargoSelect ? cargoSelect.value : 'ESTIVADOR';
      const cargoText = cargoSelect && cargoSelect.options[cargoSelect.selectedIndex] ? cargoSelect.options[cargoSelect.selectedIndex].text : cargoValue;
      const doc = document.getElementById('funcDoc').value.trim();

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
      }

      const suffix = Math.floor(1000 + Math.random() * 9000);
      const codigo = `NX-${formattedMatricula.replace('MAT-', '')}-${suffix}`;

      const novoFuncionario = {
        matricula: formattedMatricula,
        nome: nome,
        cargo: cargoText,
        cargo_enum: cargoValue,
        codigo: codigo,
        doc: doc || 'Cadastrado no Sistema',
        ativo: true
      };

      const localList = JSON.parse(localStorage.getItem('nexus_func_list') || '[]');
      localList.unshift(novoFuncionario);
      localStorage.setItem('nexus_func_list', JSON.stringify(localList));

      let insertedFuncId = null;
      if (window.nexusSupabase) {
        try {
          const { data: insData, error: insErr } = await window.nexusSupabase.from('funcionarios').insert({
            matricula: formattedMatricula,
            codigo_individual: codigo,
            nome: nome,
            cargo: cargoValue,
            ativo: true
          }).select('id').single();

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
        window.mostrarFeedback('sucesso', 'Funcionário Cadastrado', `Funcionário ${nome} cadastrado com sucesso! Código de acesso gerado: ${codigo}`);
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
              <td class="p-3 font-bold">${v.nome}</td>
              <td class="p-3 font-mono text-xs">${v.documento}</td>
              <td class="p-3 text-slate-500">${v.motivo}</td>
              <td class="p-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                  isAguardando ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                }">
                  ${v.status || 'EM_VISITA'}
                </span>
              </td>
              <td class="p-3 font-mono text-xs text-slate-400">${v.data}</td>
              <td class="p-3 font-mono text-xs font-bold text-nexus-500">${v.por || session.matricula}</td>
              <td class="p-3 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-2">
                  ${isAguardando ? `
                    <button type="button" onclick="window.alterarStatusVisitante('${vKey}', 'EM_VISITA')" class="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors">
                      <span class="material-symbols-outlined text-[16px]">how_to_reg</span>
                      <span>Autorizar (Entrar em Visita)</span>
                    </button>
                  ` : ''}
                  <button type="button" onclick="window.registrarSaidaVisitante('${vKey}')" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition-colors">
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
            <td class="p-3 font-bold text-slate-700 dark:text-slate-200">${v.nome}</td>
            <td class="p-3 font-mono text-xs">${v.documento}</td>
            <td class="p-3 text-slate-500">${v.motivo}</td>
            <td class="p-3 font-mono text-xs text-slate-400">${v.data}</td>
            <td class="p-3 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">${v.data_saida || 'Concluída'}</td>
            <td class="p-3">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                ${v.vistoria || 'Vistoria em Ordem - Sem Anormalidades'}
              </span>
            </td>
            <td class="p-3 font-mono text-xs text-slate-400">${v.por || session.matricula}</td>
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
  window.registrarSaidaVisitante = async function(visitorKey) {
    const visitor = visList.find(v => (v.id && v.id === visitorKey) || (`${v.nome}_${v.documento}` === visitorKey));
    if (!visitor) return;

    const dataSaidaStr = window.nexusPrompt ? await window.nexusPrompt('Registrar Saída', `Informe a data/hora de saída do visitante ${visitor.nome}:`, new Date().toLocaleString('pt-BR')) : new Date().toLocaleString('pt-BR');
    if (!dataSaidaStr) return;

    const parecerVistoria = window.nexusPrompt ? await window.nexusPrompt('Parecer da Vistoria', `Informe o parecer da vistoria para ${visitor.nome}:`, 'Vistoria em Ordem - Sem Anormalidades') : 'Vistoria em Ordem - Sem Anormalidades';

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
