-- ============================================================
-- Auditoria das tentativas de login: log permanente + painel da Direção
--
-- Até a migration anterior, `tentativas_login` guardava só o ESTADO do bloqueio
-- de 15 minutos: a linha de cada chave ('ip:<endereço>' ou 'cod:<CÓDIGO>') era
-- apagada quando o login dava certo e a contagem reiniciava a cada janela. Isso
-- travava a força bruta, mas não guardava evidência — o histórico sumia junto.
--
-- Agora a MESMA tabela (formato mantido) passa a ser o log:
--
--   chave              'ip:<endereço>' | 'cod:<CÓDIGO>'  -- formato original
--   falhas             falhas da janela atual de 15 min  -- decide o bloqueio
--   janela_inicio      início da rajada atual             -- formato original
--   ultima_tentativa   quando foi a última tentativa errada   (novo)
--   total_falhas       tentativas erradas acumuladas no chave (novo)
--   ultimo_sucesso     quando o mesmo IP/código entrou depois de errar (novo)
--
-- A linha 'ip:<endereço>' responde "quantas vezes este IP tentou QUALQUER
-- código errado"; a 'cod:<CÓDIGO>' responde "quantas vezes este código foi
-- tentado". As duas continuam no banco depois do login bem-sucedido: o acerto
-- só zera `falhas` (libera o bloqueio) e marca `ultimo_sucesso` — nunca apaga a
-- evidência. Tentativas já BLOQUEADAS também entram no log (antes contavam só
-- enquanto não batiam no limite).
--
-- LIMPEZA: as linhas gravadas no formato antigo são removidas uma única vez
-- (total_falhas = 0 e ultima_tentativa IS NULL), para o painel começar limpo.
-- Daqui em diante nada é apagado: o histórico é permanente.
--
-- O painel (seguranca.html) lê por `login_tentativas_relatorio(int, int)`,
-- que devolve resumo, top IPs, códigos mais tentados e a série por hora já
-- agregada no servidor. A tabela continua SEM policies: ninguém lê direto pelo
-- PostgREST. O controle de cargo é do app (auth-guard), igual às demais telas.
--
-- Idempotente.
-- ============================================================

-- ----------------------------------------------------------------
-- 1) Colunas de log (mesmo formato das três originais, mais o contador
--    acumulado e os dois carimbos de data que o painel usa)
-- ----------------------------------------------------------------
alter table public.tentativas_login add column if not exists ultima_tentativa timestamptz;
alter table public.tentativas_login add column if not exists total_falhas integer not null default 0;
alter table public.tentativas_login add column if not exists ultimo_sucesso timestamptz;

-- ----------------------------------------------------------------
-- 2) Limpeza ÚNICA do formato antigo (as linhas novas nunca satisfazem
--    esta condição, então reaplicar a migration não apaga o log atual)
-- ----------------------------------------------------------------
delete from public.tentativas_login
 where total_falhas = 0
   and ultima_tentativa is null;

-- Consulta do painel: prefixo da chave ('ip:%' / 'cod:%') e recência.
create index if not exists idx_tentativas_login_chave_prefixo
  on public.tentativas_login (chave text_pattern_ops);

create index if not exists idx_tentativas_login_ultima_tentativa
  on public.tentativas_login (ultima_tentativa desc);

-- ----------------------------------------------------------------
-- 3) login_funcionario: mesmas travas da migration anterior, sem apagar o log
-- ----------------------------------------------------------------
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
    -- Já bloqueado: a tentativa também é registrada no log (antes parava de contar).
    -- A janela do bloqueio não muda — só o histórico do IP avança.
    insert into public.tentativas_login as t (chave, falhas, janela_inicio, total_falhas, ultima_tentativa)
    values ('ip:' || v_ip, 1, now(), 1, now())
    on conflict (chave) do update set
      total_falhas = t.total_falhas + 1,
      ultima_tentativa = now();

    return json_build_object('ok', false, 'error', 'bloqueado', 'nivel', v_nivel);
  end if;

  select * into v_f
    from public.funcionarios
   where (codigo_individual = v_cod or matricula = v_cod)
     and ativo
   limit 1;

  if found then
    -- Acerto: zera a janela (libera o bloqueio) e carimba o sucesso.
    -- A LINHA NÃO É APAGADA — é o log do que aquele IP/código vinha tentando.
    update public.tentativas_login
       set falhas = 0,
           ultimo_sucesso = now()
     where chave in ('ip:' || v_ip, 'cod:' || v_cod);

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

  -- Falha: registra nos dois baldes e no log. Janela expirada reinicia a contagem.
  insert into public.tentativas_login as t (chave, falhas, janela_inicio, total_falhas, ultima_tentativa)
  values ('ip:' || v_ip, 1, now(), 1, now()), ('cod:' || v_cod, 1, now(), 1, now())
  on conflict (chave) do update set
    falhas = case
      when t.janela_inicio > now() - interval '15 minutes'
        then t.falhas + 1
      else 1 end,
    janela_inicio = case
      when t.janela_inicio > now() - interval '15 minutes'
        then t.janela_inicio
      else now() end,
    total_falhas = t.total_falhas + 1,
    ultima_tentativa = now();

  return json_build_object('ok', false, 'error', 'invalido', 'nivel', v_nivel);
end;
$$;

grant execute on function public.login_funcionario(text, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 4) Relatório agregado do log (usado por seguranca.html)
--
-- Devolve, em uma chamada só e já agregado no servidor:
--   resumo  → totais do log, IPs ativos no período, IPs em alerta/bloqueados
--   ips     → top IPs por tentativas erradas ("tentou qualquer código errado")
--   codigos → códigos mais tentados
--   serie   → IPs com tentativa errada por hora, no período escolhido
--
-- `p_horas` define o período da série e do KPI de atividade (1 a 720 h).
-- `p_limite` quantas linhas cada lista traz (1 a 100).
--
-- RESSALVA (mesma do restante do app): o NexusPort não usa Supabase Auth, então
-- o PostgREST entrega toda requisição como role `anon` e o banco não consegue
-- validar o cargo de quem chamou. Quem restringe o acesso ao painel é o app
-- (auth-guard). As policies de leitura direta continuam ausentes de propósito:
-- a função é a única porta de entrada.
-- ----------------------------------------------------------------
create or replace function public.login_tentativas_relatorio(p_limite int default 15, p_horas int default 24)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite int := greatest(1, least(coalesce(p_limite, 15), 100));
  v_horas  int := greatest(1, least(coalesce(p_horas, 24), 720));
begin
  return json_build_object(
    'gerado_em', now(),
    'horas', v_horas,
    'resumo', json_build_object(
      'tentativas', (
        select coalesce(sum(total_falhas), 0)::int
          from public.tentativas_login
         where chave like 'ip:%'
      ),
      'ips', (
        select count(*)::int
          from public.tentativas_login
         where chave like 'ip:%'
      ),
      'ips_periodo', (
        select count(*)::int
          from public.tentativas_login
         where chave like 'ip:%'
           and ultima_tentativa >= now() - make_interval(hours => v_horas)
      ),
      'em_alerta', (
        select count(*)::int
          from public.tentativas_login
         where chave like 'ip:%'
           and falhas >= 2
           and janela_inicio > now() - interval '15 minutes'
      ),
      'bloqueados', (
        select count(*)::int
          from public.tentativas_login
         where chave like 'ip:%'
           and falhas >= 5
           and janela_inicio > now() - interval '15 minutes'
      ),
      'codigos', (
        select count(*)::int
          from public.tentativas_login
         where chave like 'cod:%'
      ),
      'ultima_tentativa', (
        select max(ultima_tentativa)
          from public.tentativas_login
      )
    ),
    'ips', (
      select coalesce(json_agg(row_to_json(x) order by x.total desc, x.ultima desc nulls last), '[]'::json)
        from (
          select substring(t.chave from 4)          as ip,
                 t.total_falhas                     as total,
                 t.falhas                           as falhas_janela,
                 t.janela_inicio                    as inicio,
                 t.ultima_tentativa                 as ultima,
                 t.ultimo_sucesso                   as sucesso,
                 case
                   when t.falhas >= 5 then 'critico'
                   when t.falhas >= 3 then 'alto'
                   when t.falhas >= 2 then 'moderado'
                   when t.falhas >= 1 then 'baixo'
                   else 'limpo'
                 end                                as nivel,
                 (t.falhas >= 2 and t.janela_inicio > now() - interval '15 minutes') as em_janela
            from public.tentativas_login t
           where t.chave like 'ip:%'
           order by t.total_falhas desc, t.ultima_tentativa desc nulls last
           limit v_limite
        ) x
    ),
    'codigos', (
      select coalesce(json_agg(row_to_json(x) order by x.total desc, x.ultima desc nulls last), '[]'::json)
        from (
          select substring(t.chave from 5) as codigo,
                 t.total_falhas            as total,
                 t.ultima_tentativa        as ultima
            from public.tentativas_login t
           where t.chave like 'cod:%'
           order by t.total_falhas desc, t.ultima_tentativa desc nulls last
           limit v_limite
        ) x
    ),
    'serie', (
      select coalesce(
               json_agg(json_build_object('hora', h.hora, 'ips', coalesce(c.n, 0)::int) order by h.hora),
               '[]'::json
             )
        from generate_series(
               date_trunc('hour', now()) - make_interval(hours => greatest(v_horas - 1, 1)),
               date_trunc('hour', now()),
               interval '1 hour'
             ) as h(hora)
        left join lateral (
          select count(*) as n
            from public.tentativas_login t
           where t.chave like 'ip:%'
             and t.ultima_tentativa >= h.hora
             and t.ultima_tentativa <  h.hora + interval '1 hour'
        ) c on true
    )
  );
end;
$$;

grant execute on function public.login_tentativas_relatorio(int, int) to anon, authenticated;

comment on table public.tentativas_login is
  'Log das tentativas de login. chave = ''ip:<endereço>'' (quantas vezes o IP tentou QUALQUER código errado) ou ''cod:<CÓDIGO>'' (quantas vezes o código foi tentado); falhas = falhas da janela de 15 min (decide o bloqueio); janela_inicio = início da rajada; total_falhas = histórico acumulado; ultima_tentativa/ultimo_sucesso = carimbos de data. Escrita apenas por login_funcionario(text, text); leitura somente por login_tentativas_relatorio(int, int) — a tabela não tem policies.';

comment on column public.tentativas_login.total_falhas is
  'Total de tentativas erradas do chave desde a limpeza da migration 20261011000000. Nunca é zerado: é o número mostrado no painel de segurança.';

comment on column public.tentativas_login.ultima_tentativa is
  'Horário da última tentativa errada do chave (inclusive as que já estavam bloqueadas).';

-- ----------------------------------------------------------------
-- 5) PostgREST: a função nova precisa entrar no schema cache, senão a
--    tela responde PGRST202 ("function not found") mesmo com a migration
--    aplicada. Mesmo padrão das migrations anteriores; se ainda assim
--    reclamar, Settings → API → Restart server.
-- ----------------------------------------------------------------
notify pgrst, 'reload schema';

-- Verificação: o que a migração deixou pronto (ler no SQL Editor).
select 'public.tentativas_login' as objeto,
       to_regclass('public.tentativas_login') is not null as existe,
       (select count(*) from public.tentativas_login) as linhas,
       (select count(*) from public.tentativas_login where chave like 'ip:%') as linhas_ip,
       (select count(*) from public.tentativas_login where chave like 'cod:%') as linhas_codigo,
       (
         select count(*)
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('login_funcionario', 'login_tentativas_relatorio')
       ) as funcoes;