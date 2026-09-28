/**
 * Lógica do Módulo Delegação de Supervisor (delegacao.html) - NexusPort
 * Gerencia a substituição temporária do Supervisor Titular garantindo o limite
 * rígido de apenas 1 substituto ativo por vez e suporte a revogação (RF 14 / T7.6 - T7.9).
 */

document.addEventListener('DOMContentLoaded', () => {
  const session = window.currentUserSession || NexusAuth.getSession();
  if (!session) return;

  const substitutoNome = document.getElementById('substitutoNome');
  const substitutoVigencia = document.getElementById('substitutoVigencia');
  const revogarBtn = document.getElementById('revogarDelegacaoBtn');
  const delegForm = document.getElementById('delegacaoForm');

  async function carregarDelegacaoAtiva() {
    let activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');

    // Valida expiração de tempo da delegação ativa salva
    if (activeDeleg && activeDeleg.fim) {
      const now = new Date();
      if (now > new Date(activeDeleg.fim)) {
        localStorage.removeItem('nexus_active_delegation');
        activeDeleg = null;
      }
    }

    if (window.nexusSupabase) {
      try {
        const { data, error } = await window.nexusSupabase
          .from('delegacoes_supervisor')
          .select('*, supervisor:supervisor_titular_id(nome, matricula), substituto:substituto_id(nome, matricula)')
          .eq('ativo', true)
          .order('data_inicio', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          const now = new Date();
          const fimDate = new Date(data.data_fim_previsto || data.data_fim);
          if (now <= fimDate) {
            activeDeleg = {
              id: data.id,
              supervisor: data.supervisor?.nome || session.nome,
              substituidoMatricula: data.supervisor?.matricula || session.matricula,
              substitutoMatricula: data.substituto?.matricula || 'MAT-SUB',
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
          }
        }
      } catch (e) {
        console.warn('Erro ao buscar delegação ativa no Supabase:', e);
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

    updateDelegacaoUI(activeDeleg);
  }

  function updateDelegacaoUI(activeDeleg) {
    if (activeDeleg) {
      const substituidoTxt = activeDeleg.substituidoNome || activeDeleg.supervisor || activeDeleg.substituidoMatricula || 'Funcionário Substituído';
      const substitutoTxt = activeDeleg.substitutoNome || activeDeleg.substitutoMatricula || 'Funcionário Substituto';
      const cpfTxt = activeDeleg.substitutoCpf ? ` | CPF: ${activeDeleg.substitutoCpf}` : '';

      if (substitutoNome) {
        substitutoNome.textContent = `Substituído: ${substituidoTxt} ➔ Substituto: ${substitutoTxt}${cpfTxt}`;
      }
      if (substitutoVigencia) {
        substitutoVigencia.textContent = `Vigência: de ${new Date(activeDeleg.inicio).toLocaleString('pt-BR')} até ${new Date(activeDeleg.fim).toLocaleString('pt-BR')} (Matrícula do Substituído: ${activeDeleg.substituidoMatricula || activeDeleg.substitutoMatricula || '--'})`;
      }
      if (revogarBtn) revogarBtn.classList.remove('hidden');
    } else {
      if (substitutoNome) substitutoNome.textContent = 'Nenhum Substituto Ativo';
      if (substitutoVigencia) substitutoVigencia.textContent = 'Cada Supervisor Titular pode ter no máximo 1 substituto ativo por vez (RF 14).';
      if (revogarBtn) revogarBtn.classList.add('hidden');
    }
  }

  carregarDelegacaoAtiva();

  if (delegForm) {
    delegForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || 'null');
      if (activeDeleg) {
        const msg = 'REGRA DE NEGÓCIO (RF 14): Apenas 1 substituto ativo por Supervisor é permitido! Revogue a delegação atual antes de designar um novo.';
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Limite de Substitutos', msg);
        return;
      }

      const substituidoMatricula = document.getElementById('delegSubstituidoMatricula').value.trim().toUpperCase();
      const substitutoNomeInput = document.getElementById('delegSubstitutoNome').value.trim();
      const substitutoCpf = document.getElementById('delegSubstitutoCpf').value.trim();
      const substitutoDataNasc = document.getElementById('delegSubstitutoDataNasc').value;
      const inicio = document.getElementById('delegDataInicio').value;
      const fim = document.getElementById('delegDataFim').value;

      if (!substituidoMatricula || !substitutoNomeInput || !substitutoCpf || !inicio || !fim) {
        if (window.mostrarFeedback) window.mostrarFeedback('atencao', 'Campos Obrigatórios', 'Preencha a matrícula do funcionário substituído, os dados do substituto e a vigência.');
        return;
      }

      let supervisorId = null;
      let substitutoId = null;
      let substituidoNomeStr = session.nome || 'Supervisor Original';

      if (window.nexusSupabase) {
        try {
          const formattedMat = substituidoMatricula.startsWith('MAT-') ? substituidoMatricula : `MAT-${substituidoMatricula}`;
          const { data: supData } = await window.nexusSupabase.from('funcionarios').select('id, nome').or(`matricula.eq.${substituidoMatricula},matricula.eq.${formattedMat}`).maybeSingle();
          if (supData) {
            supervisorId = supData.id;
            substituidoNomeStr = supData.nome;
          }
        } catch (e) {
          console.warn('Erro ao resolver IDs de funcionários para delegação:', e);
        }
      }

      const newDeleg = {
        substituidoMatricula,
        substituidoNome: substituidoNomeStr,
        substitutoNome: substitutoNomeInput,
        substitutoCpf,
        substitutoDataNasc,
        substitutoMatricula: substituidoMatricula,
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
          if (!insErr && insData) {
            insertedDelegId = insData.id;
            newDeleg.rawDbId = insData.id;
          }

          if (window.registrarLogAlteracao) {
            await window.registrarLogAlteracao('CRIACAO', 'delegacoes_supervisor', insertedDelegId, { substituto: substitutoNomeInput, cpf: substitutoCpf, inicio, fim });
          }
        } catch (err) {
          console.warn('[NexusPort] Erro ao sincronizar delegação com Supabase:', err);
        }
      }

      localStorage.setItem('nexus_active_delegation', JSON.stringify(newDeleg));
      updateDelegacaoUI(newDeleg);

      if (window.registrarTrailDecisao) {
        await window.registrarTrailDecisao('DESIGNOU_SUBSTITUTO', 'delegacoes_supervisor', insertedDelegId, `Designou Substituto ${substitutoNomeStr} (${substitutoMatricula}) para o período de ${inicio} até ${fim}`);
      }

      if (window.NexusRepository && window.NexusRepository.notifyChange) {
        window.NexusRepository.notifyChange('delegacoes_supervisor');
      }

      delegForm.reset();
      if (window.mostrarFeedback) {
        window.mostrarFeedback('sucesso', 'Substituto Designado', `Funcionário ${substitutoNomeStr} (${substitutoMatricula}) designado temporariamente como substituto do Supervisor com poderes operacionais.`);
      }
    });
  }

  if (revogarBtn) {
    revogarBtn.addEventListener('click', async () => {
      const confirmou = window.nexusConfirm ? await window.nexusConfirm('Revogar Delegação', 'ATENÇÃO: Deseja REVOGAR IMEDIATAMENTE os poderes do substituto temporário?') : true;
      if (confirmou) {
        const activeDeleg = JSON.parse(localStorage.getItem('nexus_active_delegation') || '{}');
        localStorage.removeItem('nexus_active_delegation');

        if (window.nexusSupabase) {
          try {
            await window.nexusSupabase.from('delegacoes_supervisor')
              .update({ ativo: false, data_revogacao: new Date().toISOString() })
              .eq('ativo', true);

            if (window.registrarLogAlteracao) {
              await window.registrarLogAlteracao('EDICAO', 'delegacoes_supervisor', activeDeleg.rawDbId || null, { ativo: false, data_revogacao: new Date().toISOString() });
            }
          } catch (err) {
            console.warn('[NexusPort] Erro ao revogar delegação no Supabase:', err);
          }
        }

        updateDelegacaoUI(null);

        if (window.registrarTrailDecisao) {
          await window.registrarTrailDecisao('DESIGNOU_SUBSTITUTO', 'delegacoes_supervisor', activeDeleg.rawDbId || null, `Revogou antecipadamente a delegação de ${activeDeleg.substitutoNome || activeDeleg.substitutoMatricula || ''}`);
        }

        if (window.NexusRepository && window.NexusRepository.notifyChange) {
          window.NexusRepository.notifyChange('delegacoes_supervisor');
        }

        if (window.mostrarFeedback) {
          window.mostrarFeedback('sucesso', 'Delegação Revogada', 'Delegação revogada com sucesso! Poderes operacionais do substituto encerrados imediatamente.');
        }
      }
    });
  }
});
