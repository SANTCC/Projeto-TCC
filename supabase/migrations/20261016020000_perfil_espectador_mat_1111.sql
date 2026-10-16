-- ============================================================
-- MIGRAÇÃO: Perfil Somente-Leitura para Apresentação (Tarefa 15)
-- Funcionário: Espectador | Matrícula / Código Individual: MAT-1111
-- Camada de Visão: Estratégica (leitura integral de todas as telas e painéis)
-- ============================================================

-- Remove eventual colisão de codigo_individual='MAT-1111' em outra matrícula
DELETE FROM public.funcionarios
WHERE codigo_individual = 'MAT-1111'
  AND matricula <> 'MAT-1111';

-- Insere ou atualiza o perfil de apresentação Espectador (MAT-1111)
INSERT INTO public.funcionarios (
  id,
  matricula,
  codigo_individual,
  nome,
  cargo,
  ativo
)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'MAT-1111',
  'MAT-1111',
  'Espectador',
  'CONSELHO_ADMINISTRACAO',
  true
)
ON CONFLICT (matricula) DO UPDATE SET
  codigo_individual = EXCLUDED.codigo_individual,
  nome = EXCLUDED.nome,
  cargo = EXCLUDED.cargo,
  ativo = true,
  updated_at = now();
