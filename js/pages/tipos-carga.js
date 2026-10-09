/**
 * Módulo de Tipos de Carga e Checklists Compartilhados - NexusPort
 * Define a constante global NEXUS_TIPOS_CARGA e seus checklists técnicos abrangentes.
 */

(function (window) {
  'use strict';

  const TIPOS_CARGA = [
    {
      id: 'CONT_20',
      nome: "Contêiner 20' Dry",
      descricao: "Contêiner padrão de 20 pés para carga geral seca",
      checklist: [
        { id: 'doc_1', desc: 'Nota Fiscal, Conhecimento de Embarque (BL) e Manifesto de Carga conferidos', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Lacre de Segurança e Numeração do Contêiner verificados', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Estrutura externa e portas sem avarias estruturais, deformações ou furos', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Ausência de umidade, infiltrações ou odores atípicos no interior', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Uso obrigatório de EPIs pela equipe e sinalização da área de movimentação', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Equipamentos de movimentação (Reach Stacker / Empilhadeira) em conformidade', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Conferência do peso bruto verificado (VGM) com a declaração do cliente', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CONT_40',
      nome: "Contêiner 40' Dry / High Cube",
      descricao: "Contêiner de 40 pés de volume ampliado para mercadorias secas",
      checklist: [
        { id: 'doc_1', desc: 'Documentação Fiscal, BL e Declaração de Importação/Exportação validadas', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Número do Contêiner, Placa do Veículo Transportador e Lacre verificados', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Piso interno de madeira em bom estado, sem avarias ou contaminação', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Vedação das portas de borracha íntegra sem vazamento de luz ou água', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Calços nas rodas do caminhão e isolamento de pátio aplicados', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Spreader de guindaste/portêiner ajustado e verificado', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Peso e tara conferidos e compatíveis com a capacidade nominal', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'REEFER',
      nome: 'Reefer (Contêiner Refrigerado)',
      descricao: 'Contêiner com controle de temperatura para cargas perecíveis ou farmacêuticas',
      checklist: [
        { id: 'doc_1', desc: 'Instruções de Temperatura de Setpoint e Manifesto Frigorífico validados', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Lacre de Lote Frigorífico e Etiquetas de Alerta de Temperatura conferidos', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Painel e cabos elétricos do gerador de refrigeração íntegros', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Embalagem e paletes íntegros sem sinais de descongelamento ou avaria', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Proteção contra choque elétrico e conexão à tomada de pátio aprovada', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Unidade de refrigeração operando em teste preliminar sem alarmes', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Temperatura interna atual conferida e alinhada ao Setpoint exigido', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CARGA_SOLTA',
      nome: 'Carga Solta (Breakbulk)',
      descricao: 'Mercadorias não conteinerizadas movimentadas em unidades ou lotes individuais',
      checklist: [
        { id: 'doc_1', desc: 'Manifesto de Carga Solta, BL e Nota Fiscal conferidos', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Etiquetas de marcação de lote, número de série e destinação visíveis', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Embalagem (caixas de madeira, tambores ou fardos) sem rasgos ou quebras', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Ausência de vazamentos, manchas de óleo ou danos por umidade', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Cintas de amarração e escoramento no veículo/prancha verificados', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Estropos, cabos de aço e ganchos de içamento com laudo válido', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Quantidade de volumes e peso aferidos em balança rodoviária/portuária', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CARGA_FRACIONADA',
      nome: 'Carga Fracionada',
      descricao: 'Lotes de pequenos volumes consolidados para diferentes destinatários',
      checklist: [
        { id: 'doc_1', desc: 'Notas Fiscais de cada fração e Conhecimento de Transporte Eletrônico (CT-e)', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Código QR/Barra individual por volume e marcação de destinatário visíveis', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Caixas e embalagens externas íntegras sem amassados ou violação', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Paletização com filme stretch bem fixada e sinalização de "Frágil"', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Transpalete ou empilhadeira conferidos e operando com segurança', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Cubagem e contagem exata dos volumes conferidos na recepção', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'GRANEL_SOLIDO',
      nome: 'Granel Sólido',
      descricao: 'Grãos, minérios, fertilizantes e insumos sólidos sem embalagem',
      checklist: [
        { id: 'doc_1', desc: 'Laudo de Análise Química/Física, Ticket de Balança e Manifesto', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Placa do Caminhão/Silo de Origem e Lacre da Moega/Caçamba verificados', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Lote isento de umidade excessiva, mofo, bolor ou contaminação visível', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Caçamba ou porão do navio limpo, seco e higienizado antes do carregamento', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Uso de máscara de proteção respiratória e lonamento da caçamba em dia', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Esteiras rolantes, grab/guindaste e moegas inspecionados', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Peso líquido conferido na balança do terminal', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'GRANEL_LIQUIDO',
      nome: 'Granel Líquido',
      descricao: 'Líquidos e combustíveis armazenados em tanques ou porões',
      checklist: [
        { id: 'doc_1', desc: 'Certificado de Análise do Produto, FISPQ e Conhecimento Marítimo', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Lacre das válvulas do tanque, mangotes e acoplamentos auditados', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Tubulações, mangotes e juntas sem nenhum vazamento ou gotejamento', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Sistemas de contenção de spillage, aterramento elétrico e extintores de incêndio a postos', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Bombas de transferência e manômetros de pressão calibrados', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Volume em metros cúbicos/litros e densidade do produto validados', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CARGA_IMO',
      nome: 'Carga Perigosa (IMO / Hazmat)',
      descricao: 'Produtos químicos perigosos, inflamáveis, corrosivos ou tóxicos',
      checklist: [
        { id: 'doc_1', desc: 'Declaração de Mercadorias Perigosas (IMO), FISPQ em português e Ficha de Emergência', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Rótulos de Risco IMO (Diamante de Hommel/Placards) fixados nos 4 lados do lote/contêiner', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Ausência total de rachaduras, vazamentos, odores fortes ou vapores', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'EPIs específicos (óculos, luvas nitrílicas, respirador), kit de mitigações de derramamento e afastamento de fontes de calor', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Chuveiro de emergência e lava-olhos da área operantes', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Segregação de pátio conforme tabela de incompatibilidade química da ANTAQ/IMO', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CARGA_VIVA',
      nome: 'Carga Viva',
      descricao: 'Transporte de animais vivos com requisitos sanitários rigorosos',
      checklist: [
        { id: 'doc_1', desc: 'GTA (Guia de Trânsito Animal), Certificado Zoossanitário Internacional e Licença do MAPA', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Brincos de identificação e registro do lote validados', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Estrutura das gaiolas/currais íntegra, ventilada e limpa', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Provisão de água potável, ração e espaço mínimo de bem-estar animal', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Rampas de embarque antiderrapantes e sistemas de ventilação testados', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Inspeção pelo Médico Veterinário responsável aprovada', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'CARGA_PROJETO',
      nome: 'Carga de Projeto (Overdimensional)',
      descricao: 'Equipamentos de grande porte com dimensões e pesos excedentes',
      checklist: [
        { id: 'doc_1', desc: 'AET (Autorização Especial de Trânsito), Estudo de Rigging e Licença Ambiental', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Marcação dos pontos de içamento (Lifting Points) e centro de gravidade (CG) visíveis', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Peça sem avarias na pintura especial ou deformações aparentes', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Plano de Rigging aprovado pelo engenheiro, batedores e isolamento total da área', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Guindastes de alta capacidade e balancins testados e certificados', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Dimensões (A x L x C) e peso por eixo dentro do limite autorizado', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'GRAOS_SOLTOS',
      nome: 'Grãos Soltos',
      descricao: 'Carga agrícola a granel (Soja, Milho, Trigo)',
      checklist: [
        { id: 'doc_1', desc: 'Laudo de Classificação Vegetal e Nota Fiscal de Produtor', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Identificação do Lote de Silo / Fazenda de Origem', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Teor de Umidade e Temperatura da Massa de Grãos em conformidade', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Ausência de Pragas, Insetos, Mofo ou Fumaça', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Proteção coletiva na moega contra riscos de soterramento', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Coletor pneumático de amostras inspecionado', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Peso de balança rodoviária aferido', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'ELETRONICOS',
      nome: 'Eletrônicos',
      descricao: 'Equipamentos eletrônicos, componentes e eletrodomésticos',
      checklist: [
        { id: 'doc_1', desc: 'Nota Fiscal Eletrônica, Packing List e Guia Alfandegária', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Integridade do Lacre de Segurança e Embalagem Antiestática', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Ausência de Umidade, Molhadura ou Sinais de Impacto Físico', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Armazenamento em gaiola/área de alto valor com monitoramento de CFTV', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Empilhadeira com garfos emborrachados', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Conferência de Número de Série e contagem de caixas master', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'PRODUTOS_QUIMICOS',
      nome: 'Produtos Químicos',
      descricao: 'Insumos industriais e reagentes químicos em tambores ou containers',
      checklist: [
        { id: 'doc_1', desc: 'Validação da Ficha de FISPQ e Rotulagem de Risco IMO/ANVISA', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Etiquetas GHS com indicação de perigo e manuseio visíveis', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Ausência Total de Vazamentos, Estufamento de Embalagem ou Contaminação Externa', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Kit Ambiantal de Mitigação de Emergências Química posicionado', critico: true, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Bacia de contenção de vazamentos posicionada sob a carga', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Temperatura Controlada do Recipiente verificada', critico: true, categoria: 'Conformidade' }
      ]
    },
    {
      id: 'MAQUINARIO_PESADO',
      nome: 'Maquinário Pesado',
      descricao: 'Tratores, escavadeiras, geradores e estruturas industriais',
      checklist: [
        { id: 'doc_1', desc: 'Manual do Operador, Documento de Início de Operação e NF de Origem', critico: true, categoria: 'Documentação' },
        { id: 'ident_1', desc: 'Número de Chassi / NDI gravado na estrutura verificado', critico: true, categoria: 'Identificação' },
        { id: 'fis_1', desc: 'Fixação e Ancoragem (Lashing) para Transporte Marítimo/Terrestre', critico: true, categoria: 'Condições Físicas' },
        { id: 'fis_2', desc: 'Verificação de Calibragem de Pneus/Esteiras e Ausência de Vazamento de Óleo/Combustível', critico: true, categoria: 'Condições Físicas' },
        { id: 'seg_1', desc: 'Trava de articulação e freio de estacionamento acionados', critico: false, categoria: 'Segurança' },
        { id: 'equip_1', desc: 'Calços de rodas e correntes de amarração em perfeito estado', critico: false, categoria: 'Equipamentos' },
        { id: 'conf_1', desc: 'Inspeção Visual da Pintura, Lataria e Fluídos concluída', critico: true, categoria: 'Conformidade' }
      ]
    }
  ];

  window.NEXUS_TIPOS_CARGA = TIPOS_CARGA;

  window.carregarTiposCargaSupabase = async function() {
    if (!window.nexusSupabase) return window.NEXUS_TIPOS_CARGA;

    try {
      // 1. Busca tipos de carga
      const { data: dbTipos, error: errTipos } = await window.nexusSupabase
        .from('tipos_carga')
        .select('*');

      if (errTipos) {
        console.warn("[NexusPort] Erro ao carregar tipos_carga do Supabase:", errTipos);
        return window.NEXUS_TIPOS_CARGA;
      }

      // Se a tabela tipos_carga estiver vazia, popula os tipos padrão e checklists no Supabase
      if (!dbTipos || dbTipos.length === 0) {
        console.log("[NexusPort] Sincronizando tipos de carga iniciais para o Supabase...");
        for (const tc of TIPOS_CARGA) {
          const { data: insertedTipo } = await window.nexusSupabase
            .from('tipos_carga')
            .insert({
              nome: tc.nome,
              requisitos_especiais: tc.descricao
            })
            .select()
            .single();

          if (insertedTipo) {
            const { data: insertedModelo } = await window.nexusSupabase
              .from('checklist_modelos')
              .insert({
                tipo_carga_id: insertedTipo.id,
                nome: `Checklist ${tc.nome}`,
                descricao: tc.descricao
              })
              .select()
              .single();

            if (insertedModelo && tc.checklist) {
              const itensToInsert = tc.checklist.map((item, index) => ({
                checklist_modelo_id: insertedModelo.id,
                descricao: item.desc,
                critico: item.critico,
                ordem: index + 1
              }));
              await window.nexusSupabase.from('checklist_itens').insert(itensToInsert);
            }
          }
        }
        return window.NEXUS_TIPOS_CARGA;
      }

      // 2. Carrega checklists e modelos do Supabase
      const { data: dbModelos } = await window.nexusSupabase.from('checklist_modelos').select('*');
      const { data: dbItens } = await window.nexusSupabase.from('checklist_itens').select('*');

      const loadedTipos = dbTipos.map(t => {
        const modelo = (dbModelos || []).find(m => m.tipo_carga_id === t.id);
        const itens = modelo ? (dbItens || []).filter(i => i.checklist_modelo_id === modelo.id) : [];

        return {
          id: t.id,
          nome: t.nome,
          descricao: t.requisitos_especiais || t.nome,
          checklist: itens.map(i => ({
            id: i.id,
            desc: i.descricao,
            critico: i.critico,
            categoria: i.critico ? 'Crítico' : 'Geral'
          }))
        };
      });

      if (loadedTipos.length > 0) {
        window.NEXUS_TIPOS_CARGA = loadedTipos;
      }
    } catch (e) {
      console.warn("[NexusPort] Exceção ao carregar tipos de carga do Supabase:", e);
    }

    return window.NEXUS_TIPOS_CARGA;
  };

  window.getNexusTipoCarga = function(nomeOuId) {
    if (!nomeOuId) return null;
    const busca = String(nomeOuId).toLowerCase().trim();
    const list = (window.NEXUS_TIPOS_CARGA && window.NEXUS_TIPOS_CARGA.length > 0) ? window.NEXUS_TIPOS_CARGA : TIPOS_CARGA;
    return list.find(t =>
      (t.id && String(t.id).toLowerCase() === busca) ||
      (t.nome && String(t.nome).toLowerCase() === busca)
    ) || null;
  };

  // Dispara carregamento inicial
  document.addEventListener('DOMContentLoaded', () => {
    window.carregarTiposCargaSupabase();
  });

})(window);
