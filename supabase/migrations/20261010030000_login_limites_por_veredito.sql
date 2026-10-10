-- ============================================================
-- Limite de tentativas de login por nível de suspeita do navegador
--
-- login_funcionario(p_codigo, p_veredito) passa a aplicar um limite de falhas por
-- janela de 15 minutos conforme o veredito informado pelo cliente
-- (js/vendor/bot-detector.iife.min.js, via BotDetectorLib.detectInstant()):
--
--   humano      -> bloqueia após 5 falhas (limite padrão, igual à migration anterior)
--   suspeito    -> bloqueia após 3 falhas
--   bot         -> bloqueia após 2 falhas
--   desconhecido (sem veredito, JS bloqueado ou chamada direta) -> bloqueia após 3 falhas
--
-- Regra do servidor: o veredito do cliente é só uma dica. Se o User-Agent declarar
-- automação (HeadlessChrome, puppeteer, playwright, selenium, curl, python-requests...),
-- o nível vira 'bot' independentemente do que o cliente informou.
--
-- Limite: o detector roda no navegador, então um atacante que controla o JavaScript pode
-- informar 'humano'. A proteção que não depende do cliente continua sendo o limite por IP
-- e por código, desta mesma função.
--
-- Substitui a assinatura anterior login_funcionario(text). Idempotente.
-- ============================================================

drop function if exists public.login_funcionario(text);

create or replace function public.login_funcionario(p_codigo text, p_veredito text default 'desconhecido')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_json    json := coalesce(nullif(v_headers, ''), '{}')::json;
  v_ip  text := coalesce(
                  nullif(split_part(coalesce(v_json->>'x-forwarded-for', ''), ',', 1), ''),
                  'desconhecido');
  v_ua  text := lower(coalesce(v_json->>'user-agent', ''));
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_nivel text := case when p_veredito in ('humano', 'suspeito', 'bot') then p_veredito else 'desconhecido' end;
  v_limite int;
  v_f   public.funcionarios%rowtype;
begin
  -- Automação declarada no User-Agent prevalece sobre o veredito do cliente
  if v_ua ~ '(headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|curl/|wget/|node-fetch|go-http-client)' then
    v_nivel := 'bot';
  end if;

  v_limite := case v_nivel
    when 'humano'   then 5
    when 'suspeito' then 3
    when 'bot'      then 2
    else 3
  end;

  if v_cod = '' then
    return json_build_object('ok', false, 'error', 'invalido', 'nivel', v_nivel);
  end if;

  -- Bloqueio: falhas na janela de 15 minutos atingem o limite do nível, por IP ou por código
  if exists (
    select 1 from public.tentativas_login
     where chave in ('ip:' || v_ip, 'cod:' || v_cod)
       and falhas >= v_limite
       and janela_inicio > now() - interval '15 minutes'
  ) then
    return json_build_object('ok', false, 'error', 'bloqueado', 'nivel', v_nivel);
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
      'cargo', v_f.cargo,
      'nivel', v_nivel
    );
  end if;

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

  return json_build_object('ok', false, 'error', 'invalido', 'nivel', v_nivel);
end;
$$;

grant execute on function public.login_funcionario(text, text) to anon, authenticated;
