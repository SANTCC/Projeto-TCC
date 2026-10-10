-- ============================================================
-- Login de funcionários com limite de tentativas (sem Supabase Auth)
--
-- A função login_funcionario(p_codigo) confere o código individual ou a matrícula
-- e aplica bloqueio de 15 minutos após 5 falhas, por IP e por código.
-- Não depende de conta externa nem de serviço pago: roda só no Postgres do Supabase.
--
-- O IP vem do cabeçalho x-forwarded-for exposto pelo PostgREST. Se o cabeçalho não
-- existir (ex.: teste local), todas as falhas sem IP caem no balde 'desconhecido'.
--
-- A tabela tentativas_login não tem policies: anon/authenticated não leem nem escrevem.
-- Idempotente.
-- ============================================================

create table if not exists public.tentativas_login (
  chave text primary key,              -- 'ip:<endereço>' ou 'cod:<CODIGO>'
  falhas int not null default 0,
  janela_inicio timestamptz not null default now()
);

alter table public.tentativas_login enable row level security;

create or replace function public.login_funcionario(p_codigo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_ip  text := coalesce(
                  nullif(split_part(coalesce(nullif(v_headers, ''), '{}')::json->>'x-forwarded-for', ',', 1), ''),
                  'desconhecido');
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_f   public.funcionarios%rowtype;
begin
  if v_cod = '' then
    return json_build_object('ok', false, 'error', 'invalido');
  end if;

  -- Bloqueio: 5 falhas na janela de 15 minutos, por IP ou por código
  if exists (
    select 1 from public.tentativas_login
     where chave in ('ip:' || v_ip, 'cod:' || v_cod)
       and falhas >= 5
       and janela_inicio > now() - interval '15 minutes'
  ) then
    return json_build_object('ok', false, 'error', 'bloqueado');
  end if;

  select * into v_f
    from public.funcionarios
   where (codigo_individual = v_cod or matricula = v_cod)
     and ativo
   limit 1;

  if found then
    delete from public.tentativas_login where chave in ('ip:' || v_ip, 'cod:' || v_cod);
    return json_build_object(
      'ok', true,
      'id', v_f.id,
      'matricula', v_f.matricula,
      'codigo_individual', v_f.codigo_individual,
      'nome', v_f.nome,
      'cargo', v_f.cargo
    );
  end if;

  -- Falha: registra nos dois baldes. Janela expirada reinicia a contagem.
  insert into public.tentativas_login (chave, falhas, janela_inicio)
  values ('ip:' || v_ip, 1, now()), ('cod:' || v_cod, 1, now())
  on conflict (chave) do update set
    falhas = case
      when public.tentativas_login.janela_inicio > now() - interval '15 minutes'
        then public.tentativas_login.falhas + 1
      else 1 end,
    janela_inicio = case
      when public.tentativas_login.janela_inicio > now() - interval '15 minutes'
        then public.tentativas_login.janela_inicio
      else now() end;

  return json_build_object('ok', false, 'error', 'invalido');
end;
$$;

grant execute on function public.login_funcionario(text) to anon, authenticated;
