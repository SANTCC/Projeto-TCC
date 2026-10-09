-- =====================================================================
-- SEED DE DEMONSTRAÇÃO — NexusPort (Backlog 3, itens C e D)
-- ---------------------------------------------------------------------
-- ATENÇÃO: dados fictícios para demonstração e desenvolvimento local.
-- NÃO aplicar em produção. Este arquivo só insere: não apaga, não altera e não trunca dados existentes.
--
-- C) Usuários mock: 2 por cargo, com nome [CARGO]_mock123 e [CARGO]_mock321.
--    Código individual de acesso: MOCK-[CARGO]-123 e MOCK-[CARGO]-321.
-- D) Tipos de carga, rotas, navios, contêineres, cargas e histórico de alterações (prefixo DEMO).
--
-- Idempotente: ids determinísticos (md5 de uma descrição) e ON CONFLICT DO NOTHING.
-- Reexecutar não duplica nada e respeita os dados que já existirem.
--
--   Local:  supabase db reset                                   (roda supabase/seed.sql)
--   Remoto: psql "$DATABASE_URL" -f supabase/seed.sql           (somente em projeto de demonstração)
-- =====================================================================

-- ---------------------------------------------------------------------
-- C) Usuários mock: 2 por cargo (o cargo vem do enum cargo_enum)
-- ---------------------------------------------------------------------
insert into funcionarios (id, matricula, codigo_individual, nome, cargo, ativo) values
  (md5('demo-func-ESTIVADOR-123')::uuid, 'MOCK-123-ESTIVADOR', 'MOCK-ESTIVADOR-123', 'ESTIVADOR_mock123', 'ESTIVADOR', true),
  (md5('demo-func-ESTIVADOR-321')::uuid, 'MOCK-321-ESTIVADOR', 'MOCK-ESTIVADOR-321', 'ESTIVADOR_mock321', 'ESTIVADOR', true),
  (md5('demo-func-CONFERENTE_CARGA-123')::uuid, 'MOCK-123-CONFERENTE_CARGA', 'MOCK-CONFERENTE_CARGA-123', 'CONFERENTE_CARGA_mock123', 'CONFERENTE_CARGA', true),
  (md5('demo-func-CONFERENTE_CARGA-321')::uuid, 'MOCK-321-CONFERENTE_CARGA', 'MOCK-CONFERENTE_CARGA-321', 'CONFERENTE_CARGA_mock321', 'CONFERENTE_CARGA', true),
  (md5('demo-func-ARRUMADOR_CONSERTADOR-123')::uuid, 'MOCK-123-ARRUMADOR_CONSERTADOR', 'MOCK-ARRUMADOR_CONSERTADOR-123', 'ARRUMADOR_CONSERTADOR_mock123', 'ARRUMADOR_CONSERTADOR', true),
  (md5('demo-func-ARRUMADOR_CONSERTADOR-321')::uuid, 'MOCK-321-ARRUMADOR_CONSERTADOR', 'MOCK-ARRUMADOR_CONSERTADOR-321', 'ARRUMADOR_CONSERTADOR_mock321', 'ARRUMADOR_CONSERTADOR', true),
  (md5('demo-func-PLANEJADOR_PATIO_NAVIOS-123')::uuid, 'MOCK-123-PLANEJADOR_PATIO_NAVIOS', 'MOCK-PLANEJADOR_PATIO_NAVIOS-123', 'PLANEJADOR_PATIO_NAVIOS_mock123', 'PLANEJADOR_PATIO_NAVIOS', true),
  (md5('demo-func-PLANEJADOR_PATIO_NAVIOS-321')::uuid, 'MOCK-321-PLANEJADOR_PATIO_NAVIOS', 'MOCK-PLANEJADOR_PATIO_NAVIOS-321', 'PLANEJADOR_PATIO_NAVIOS_mock321', 'PLANEJADOR_PATIO_NAVIOS', true),
  (md5('demo-func-TECNICO_PORTOS-123')::uuid, 'MOCK-123-TECNICO_PORTOS', 'MOCK-TECNICO_PORTOS-123', 'TECNICO_PORTOS_mock123', 'TECNICO_PORTOS', true),
  (md5('demo-func-TECNICO_PORTOS-321')::uuid, 'MOCK-321-TECNICO_PORTOS', 'MOCK-TECNICO_PORTOS-321', 'TECNICO_PORTOS_mock321', 'TECNICO_PORTOS', true),
  (md5('demo-func-SUPERVISOR_GERENTE_OPERACOES-123')::uuid, 'MOCK-123-SUPERVISOR_GERENTE_OPERACOES', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-123', 'SUPERVISOR_GERENTE_OPERACOES_mock123', 'SUPERVISOR_GERENTE_OPERACOES', true),
  (md5('demo-func-SUPERVISOR_GERENTE_OPERACOES-321')::uuid, 'MOCK-321-SUPERVISOR_GERENTE_OPERACOES', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-321', 'SUPERVISOR_GERENTE_OPERACOES_mock321', 'SUPERVISOR_GERENTE_OPERACOES', true),
  (md5('demo-func-INSPETOR-123')::uuid, 'MOCK-123-INSPETOR', 'MOCK-INSPETOR-123', 'INSPETOR_mock123', 'INSPETOR', true),
  (md5('demo-func-INSPETOR-321')::uuid, 'MOCK-321-INSPETOR', 'MOCK-INSPETOR-321', 'INSPETOR_mock321', 'INSPETOR', true),
  (md5('demo-func-DIRETOR_OPERACOES_LOGISTICA-123')::uuid, 'MOCK-123-DIRETOR_OPERACOES_LOGISTICA', 'MOCK-DIRETOR_OPERACOES_LOGISTICA-123', 'DIRETOR_OPERACOES_LOGISTICA_mock123', 'DIRETOR_OPERACOES_LOGISTICA', true),
  (md5('demo-func-DIRETOR_OPERACOES_LOGISTICA-321')::uuid, 'MOCK-321-DIRETOR_OPERACOES_LOGISTICA', 'MOCK-DIRETOR_OPERACOES_LOGISTICA-321', 'DIRETOR_OPERACOES_LOGISTICA_mock321', 'DIRETOR_OPERACOES_LOGISTICA', true),
  (md5('demo-func-DIRETOR_PRESIDENTE_SUPERINTENDENTE-123')::uuid, 'MOCK-123-DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'MOCK-DIRETOR_PRESIDENTE_SUPERINTENDENTE-123', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE_mock123', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', true),
  (md5('demo-func-DIRETOR_PRESIDENTE_SUPERINTENDENTE-321')::uuid, 'MOCK-321-DIRETOR_PRESIDENTE_SUPERINTENDENTE', 'MOCK-DIRETOR_PRESIDENTE_SUPERINTENDENTE-321', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE_mock321', 'DIRETOR_PRESIDENTE_SUPERINTENDENTE', true),
  (md5('demo-func-CONSELHO_ADMINISTRACAO-123')::uuid, 'MOCK-123-CONSELHO_ADMINISTRACAO', 'MOCK-CONSELHO_ADMINISTRACAO-123', 'CONSELHO_ADMINISTRACAO_mock123', 'CONSELHO_ADMINISTRACAO', true),
  (md5('demo-func-CONSELHO_ADMINISTRACAO-321')::uuid, 'MOCK-321-CONSELHO_ADMINISTRACAO', 'MOCK-CONSELHO_ADMINISTRACAO-321', 'CONSELHO_ADMINISTRACAO_mock321', 'CONSELHO_ADMINISTRACAO', true)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Tipos de carga (catálogo)
-- ---------------------------------------------------------------------
insert into tipos_carga (id, nome, categoria_risco, requisitos_especiais) values
  (md5('demo-tipo-dry20')::uuid, 'Contêiner 20'' Dry', null, null),
  (md5('demo-tipo-dry40')::uuid, 'Contêiner 40'' Dry', null, null),
  (md5('demo-tipo-reefer')::uuid, 'Reefer (Contêiner Refrigerado)', null, 'Monitorar temperatura durante a armazenagem'),
  (md5('demo-tipo-granel')::uuid, 'Granel sólido', null, null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Rotas marítimas (catálogo do cadastro de navios).
-- Distâncias aproximadas, apenas para demonstração (não são cálculo oficial).
-- ---------------------------------------------------------------------
insert into rotas_maritimas (id, origem, destino, distancia_km) values
  (md5('demo-rota-santos-hamburgo')::uuid, 'Santos (BRSSZ)', 'Hamburgo (DEHAM)', 9600),
  (md5('demo-rota-santos-roterda')::uuid, 'Santos (BRSSZ)', 'Roterdã (NLRTM)', 9400),
  (md5('demo-rota-santos-nova-york')::uuid, 'Santos (BRSSZ)', 'Nova York (USNYC)', 7700),
  (md5('demo-rota-santos-xangai')::uuid, 'Santos (BRSSZ)', 'Xangai (CNSHA)', 19600)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Navios. IMO 9990001–9990004 são números de demonstração, não de embarcações reais.
-- ---------------------------------------------------------------------
insert into navios (id, nome, numero_imo, estado_operacional, localizacao, porto_origem, porto_destino,
                    data_chegada, data_saida, quantidade_cargas_realizadas, qr_code_url) values
  (md5('demo-navio-atlantico')::uuid, 'Navio Atlântico Sul', '9990001', 'OPERANTE', 'DENTRO_DO_PORTO',
    'Santos (BRSSZ)', 'Hamburgo (DEHAM)', now() - interval '2 days', null, 12, 'QR-DEMO-NAV-001'),
  (md5('demo-navio-mar-aberto')::uuid, 'Navio Mar Aberto', '9990002', 'OPERANTE', 'FORA_DO_PORTO',
    'Santos (BRSSZ)', 'Roterdã (NLRTM)', null, now() - interval '1 day', 7, 'QR-DEMO-NAV-002'),
  (md5('demo-navio-costa-leste')::uuid, 'Navio Costa Leste', '9990003', 'OPERANTE', 'NO_PORTO_DE_DESTINO',
    'Santos (BRSSZ)', 'Nova York (USNYC)', now() - interval '5 days', null, 21, 'QR-DEMO-NAV-003'),
  (md5('demo-navio-porto-verde')::uuid, 'Navio Porto Verde', '9990004', 'OPERANTE', 'DENTRO_DO_PORTO',
    'Santos (BRSSZ)', 'Xangai (CNSHA)', now() - interval '6 hours', null, 3, 'QR-DEMO-NAV-004')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Contêineres (ligados aos navios acima)
-- ---------------------------------------------------------------------
insert into containers (id, numero_identificacao, tipo_carga_id, material_carregado, data_fabricacao,
                        data_ultima_manutencao, tempo_uso_referencia, estado, navio_id, qr_code_url) values
  (md5('demo-container-01')::uuid, 'DEMO0000001', md5('demo-tipo-dry40')::uuid, 'Café', '2018-05-10',
    '2025-11-03', 'DATA_FABRICACAO', 'OPERANTE', md5('demo-navio-atlantico')::uuid, 'QR-DEMO-CNT-001'),
  (md5('demo-container-02')::uuid, 'DEMO0000002', md5('demo-tipo-reefer')::uuid, 'Carne congelada', '2020-02-18',
    '2026-02-14', 'DATA_ULTIMA_MANUTENCAO', 'OPERANTE', md5('demo-navio-atlantico')::uuid, 'QR-DEMO-CNT-002'),
  (md5('demo-container-03')::uuid, 'DEMO0000003', md5('demo-tipo-reefer')::uuid, 'Suco concentrado', '2021-07-01',
    null, 'DATA_FABRICACAO', 'OPERANTE', md5('demo-navio-porto-verde')::uuid, 'QR-DEMO-CNT-003'),
  (md5('demo-container-04')::uuid, 'DEMO0000004', md5('demo-tipo-dry20')::uuid, 'Autopeças', '2019-09-22',
    '2026-06-30', 'DATA_ULTIMA_MANUTENCAO', 'OPERANTE', md5('demo-navio-mar-aberto')::uuid, 'QR-DEMO-CNT-004'),
  (md5('demo-container-05')::uuid, 'DEMO0000005', md5('demo-tipo-dry40')::uuid, 'Madeira serrada', '2017-12-05',
    '2025-08-19', 'DATA_FABRICACAO', 'OPERANTE', md5('demo-navio-costa-leste')::uuid, 'QR-DEMO-CNT-005'),
  (md5('demo-container-06')::uuid, 'DEMO0000006', md5('demo-tipo-dry40')::uuid, 'Celulose', '2016-04-27',
    '2026-01-10', 'DATA_ULTIMA_MANUTENCAO', 'OPERANTE', md5('demo-navio-costa-leste')::uuid, 'QR-DEMO-CNT-006')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Cargas: uma por situação do fluxo (status_fluxo) e resultado da inspeção
-- ---------------------------------------------------------------------
insert into cargas (id, tipo_carga_id, quantidade, material, peso, volume, valor_declarado, natureza,
                    data_entrada, data_saida, destino, porto_descarga, status_fluxo, container_id,
                    resultado_inspecao, motivo_recusa, qr_code_url) values
  (md5('demo-carga-01')::uuid, md5('demo-tipo-dry40')::uuid, 1, 'Fardos de algodão', 18000, 30000, 120000.00,
    'Carga geral', null, null, 'Hamburgo', 'Hamburgo (DEHAM)', 'AGENDAMENTO', null, 'PENDENTE', null, 'QR-DEMO-CRG-001'),
  (md5('demo-carga-02')::uuid, md5('demo-tipo-dry20')::uuid, 1, 'Máquinas industriais', 12500, 22000, 250000.00,
    'Carga geral', now() - interval '3 hours', null, 'Roterdã', 'Roterdã (NLRTM)', 'RECEBIMENTO_INSPECAO', null, 'PENDENTE', null, 'QR-DEMO-CRG-002'),
  (md5('demo-carga-03')::uuid, md5('demo-tipo-dry40')::uuid, 1, 'Café em grão', 24800, 38000, 96000.00,
    'Carga geral', now() - interval '40 hours', null, 'Hamburgo', 'Hamburgo (DEHAM)', 'ARMAZENAGEM', md5('demo-container-01')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-003'),
  (md5('demo-carga-04')::uuid, md5('demo-tipo-reefer')::uuid, 1, 'Carne bovina congelada', 21300, 33000, 410000.00,
    'Carga refrigerada', now() - interval '38 hours', null, 'Xangai', 'Xangai (CNSHA)', 'ARMAZENAGEM', md5('demo-container-02')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-004'),
  (md5('demo-carga-05')::uuid, md5('demo-tipo-granel')::uuid, 1, 'Aço em bobinas', 26000, 15000, 87000.00,
    'Carga geral', now() - interval '30 hours', null, 'Nova York', 'Nova York (USNYC)', 'RECUSADA', null, 'RECUSADA',
    'Embalagem avariada na inspeção de recebimento', 'QR-DEMO-CRG-005'),
  (md5('demo-carga-06')::uuid, md5('demo-tipo-reefer')::uuid, 1, 'Suco de laranja concentrado', 19700, 31000, 175000.00,
    'Carga refrigerada', now() - interval '20 hours', null, 'Roterdã', 'Roterdã (NLRTM)', 'PRONTA_PARA_ENTREGA', md5('demo-container-03')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-006'),
  (md5('demo-carga-07')::uuid, md5('demo-tipo-dry20')::uuid, 1, 'Autopeças', 14200, 26000, 320000.00,
    'Carga geral', now() - interval '18 hours', null, 'Hamburgo', 'Hamburgo (DEHAM)', 'EM_TRANSITO', md5('demo-container-04')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-007'),
  (md5('demo-carga-08')::uuid, md5('demo-tipo-dry40')::uuid, 1, 'Madeira serrada', 23100, 36000, 64000.00,
    'Carga geral', now() - interval '60 hours', now() - interval '4 hours', 'Xangai', 'Xangai (CNSHA)', 'ENTREGUE', md5('demo-container-05')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-008'),
  (md5('demo-carga-09')::uuid, md5('demo-tipo-granel')::uuid, 1, 'Fertilizante', 20000, 28000, 54000.00,
    'Carga geral', null, null, 'Nova York', 'Nova York (USNYC)', 'CANCELADA', null, 'PENDENTE', null, 'QR-DEMO-CRG-009'),
  (md5('demo-carga-10')::uuid, md5('demo-tipo-dry40')::uuid, 1, 'Celulose', 25400, 40000, 150000.00,
    'Carga geral', now() - interval '70 hours', null, 'Roterdã', 'Roterdã (NLRTM)', 'SAIDA', md5('demo-container-06')::uuid, 'APROVADA', null, 'QR-DEMO-CRG-010'),
  (md5('demo-carga-11')::uuid, md5('demo-tipo-granel')::uuid, 1, 'Açúcar a granel', 17600, 29000, 42000.00,
    'Carga geral', now() - interval '16 hours', null, 'Hamburgo', 'Hamburgo (DEHAM)', 'ARMAZENAGEM', null, 'APROVADA', null, 'QR-DEMO-CRG-011'),
  (md5('demo-carga-12')::uuid, md5('demo-tipo-dry20')::uuid, 1, 'Cerâmica', 11000, 18000, 36000.00,
    'Carga geral', null, null, 'Xangai', 'Xangai (CNSHA)', 'AGENDAMENTO', null, 'PENDENTE', null, 'QR-DEMO-CRG-012')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- D) Histórico de alterações (logs_alteracoes). Cada linha usa um usuário mock existente;
-- o join com funcionarios garante a chave estrangeira e o cargo do autor.
-- ---------------------------------------------------------------------
insert into logs_alteracoes (id, data_hora, funcionario_id, cargo, codigo_individual,
                             entidade_tipo, entidade_id, tipo_alteracao, detalhes)
select v.id, now() - v.atraso, f.id, f.cargo, f.codigo_individual,
       v.entidade_tipo::tipo_entidade_enum, v.entidade_id, v.tipo_alteracao::tipo_alteracao_enum, v.detalhes::jsonb
from (values
  (md5('demo-log-01')::uuid, interval '72 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-123', 'NAVIO', 'Navio Atlântico Sul', 'CRIACAO', '{"origem":"cadastro de navio"}'),
  (md5('demo-log-02')::uuid, interval '70 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-123', 'NAVIO', 'Navio Mar Aberto', 'CRIACAO', '{"origem":"cadastro de navio"}'),
  (md5('demo-log-03')::uuid, interval '60 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-321', 'NAVIO', 'Navio Costa Leste', 'CRIACAO', '{"origem":"cadastro de navio"}'),
  (md5('demo-log-04')::uuid, interval '8 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-123', 'NAVIO', 'Navio Porto Verde', 'CRIACAO', '{"origem":"cadastro de navio"}'),
  (md5('demo-log-05')::uuid, interval '70 hours', 'MOCK-PLANEJADOR_PATIO_NAVIOS-123', 'CONTAINER', 'DEMO0000001', 'CRIACAO', '{"origem":"cadastro de contêiner"}'),
  (md5('demo-log-06')::uuid, interval '69 hours', 'MOCK-PLANEJADOR_PATIO_NAVIOS-321', 'CONTAINER', 'DEMO0000002', 'CRIACAO', '{"origem":"cadastro de contêiner"}'),
  (md5('demo-log-07')::uuid, interval '7 hours', 'MOCK-PLANEJADOR_PATIO_NAVIOS-123', 'CONTAINER', 'DEMO0000005', 'CRIACAO', '{"origem":"cadastro de contêiner"}'),
  (md5('demo-log-08')::uuid, interval '50 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-001', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-09')::uuid, interval '48 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-002', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-10')::uuid, interval '46 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-003', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-11')::uuid, interval '44 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-004', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-12')::uuid, interval '42 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-005', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-13')::uuid, interval '40 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-006', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-14')::uuid, interval '38 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-007', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-15')::uuid, interval '36 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-008', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-16')::uuid, interval '34 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-009', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-17')::uuid, interval '32 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-010', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-18')::uuid, interval '24 hours', 'MOCK-CONFERENTE_CARGA-123', 'CARGA', 'DEMO-CRG-011', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-19')::uuid, interval '20 hours', 'MOCK-CONFERENTE_CARGA-321', 'CARGA', 'DEMO-CRG-012', 'CRIACAO', '{"origem":"agendamento de carga"}'),
  (md5('demo-log-20')::uuid, interval '40 hours', 'MOCK-INSPETOR-123', 'CARGA', 'DEMO-CRG-003', 'EDICAO', '{"campo":"resultado_inspecao","de":"PENDENTE","para":"APROVADA"}'),
  (md5('demo-log-21')::uuid, interval '38 hours', 'MOCK-INSPETOR-321', 'CARGA', 'DEMO-CRG-004', 'EDICAO', '{"campo":"resultado_inspecao","de":"PENDENTE","para":"APROVADA"}'),
  (md5('demo-log-22')::uuid, interval '30 hours', 'MOCK-INSPETOR-123', 'CARGA', 'DEMO-CRG-005', 'EDICAO', '{"campo":"resultado_inspecao","de":"PENDENTE","para":"RECUSADA","motivo":"Embalagem avariada na inspeção de recebimento"}'),
  (md5('demo-log-23')::uuid, interval '12 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-321', 'CARGA', 'DEMO-CRG-007', 'EDICAO', '{"campo":"status_fluxo","de":"PRONTA_PARA_ENTREGA","para":"EM_TRANSITO"}'),
  (md5('demo-log-24')::uuid, interval '5 hours', 'MOCK-SUPERVISOR_GERENTE_OPERACOES-321', 'CARGA', 'DEMO-CRG-008', 'EDICAO', '{"campo":"status_fluxo","de":"SAIDA","para":"ENTREGUE"}'),
  (md5('demo-log-25')::uuid, interval '3 hours', 'MOCK-DIRETOR_OPERACOES_LOGISTICA-123', 'CARGA', 'DEMO-CRG-010', 'EXPORTACAO', '{"tipo_exportacao":"PDF_A4"}'),
  (md5('demo-log-26')::uuid, interval '2 hours', 'MOCK-DIRETOR_OPERACOES_LOGISTICA-321', 'CARGA', 'DEMO-CRG-003', 'EXPORTACAO', '{"tipo_exportacao":"PDF_A4"}'),
  (md5('demo-log-27')::uuid, interval '1 hour', 'MOCK-ESTIVADOR-123', 'CARGA', 'DEMO-CRG-003', 'REIMPRESSAO_ETIQUETA', '{"motivo":"etiqueta danificada no manuseio"}')
) as v(id, atraso, codigo, entidade_tipo, entidade_id, tipo_alteracao, detalhes)
join funcionarios f on f.codigo_individual = v.codigo
on conflict (id) do nothing;
