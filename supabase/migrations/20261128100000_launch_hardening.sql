-- Launch hardening, from a pre-launch audit.

-- 1. Every result write is checked on the server: a known game, a recent day, a sane score.
--    (The site only offers a 7-day backfill; the extension logs today or yesterday.) Add new games here.
create or replace function private.check_result()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.game = old.game and new.day = old.day and new.score is not distinct from old.score then
    return new;   -- stars, label or puzzle changes on an existing result
  end if;
  if new.game not in ('wordle','connections','strands','mini','queens','tango','zip','pips','pinpoint','crossclimb',
                      'minisudoku','krillion','quordle','octordle','waffle','worldle','globle','framed','nerdle','hollowchess') then
    raise exception 'unknown game';
  end if;
  if new.day not between current_date - 9 and current_date + 1 then raise exception 'day out of range'; end if;
  if new.score is not null and new.score not between -1000000 and 1000000000 then raise exception 'score out of range'; end if;
  return new;
end $$;
drop trigger if exists results_check on public.results;
create trigger results_check before insert or update on public.results
  for each row execute function private.check_result();

-- 2. Friends' board: start from the people you follow instead of scanning everyone's week,
--    and reveal a score when you played the same puzzle number (the same day if a game has no number).
--    Friends in different timezones can be on different puzzles on the same calendar day.
create index if not exists results_user_day_idx on public.results (user_id, day);
drop function if exists public.following_board(date, date);
create function public.following_board(p_from date, p_to date)
returns table (user_id uuid, game text, day date, revealed boolean, label text, score integer, created_at timestamptz, puzzle text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_to - p_from > 62 then raise exception 'range too long'; end if;
  return query
    with ids as (
      select auth.uid() as id
      union select f.followee_id from public.follows f where f.follower_id = auth.uid()
    ), mine as (
      select m.game, m.day, m.puzzle from public.results m
       where m.user_id = auth.uid() and m.day between p_from - 2 and p_to + 2
    )
    select r.user_id, r.game, r.day, v.ok,
           case when v.ok then r.label end,
           case when v.ok then r.score end,
           r.created_at, r.puzzle
      from ids
      join public.results r on r.user_id = ids.id and r.day between p_from and p_to
      cross join lateral (
        select r.user_id = auth.uid() or exists (
          select 1 from mine m
           where m.game = r.game
             and case when m.puzzle is not null and r.puzzle is not null then m.puzzle = r.puzzle else m.day = r.day end
        ) as ok) v;
end $$;
revoke all on function public.following_board(date, date) from public, anon;
grant execute on function public.following_board(date, date) to authenticated;

-- 3. People can leave the global board. Hidden players still count as opponents for everyone else's points.
alter table public.profiles add column if not exists on_global boolean not null default true;

create or replace function public.global_board(p_from date, p_to date)
returns table (rank integer, user_id uuid, display_name text, handle text, points numeric, played integer, i_follow boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range too long'; end if;
  return query
  with res as (
    select r.user_id, r.game, coalesce(r.puzzle, r.day::text) as pz, r.score
      from public.results r
      join auth.users u on u.id = r.user_id and not coalesce(u.is_anonymous, false)
     where r.day between p_from and p_to
  ),
  scored as (
    select s.user_id,
           count(*) over w as n,
           rank() over (partition by s.game, s.pz order by s.score asc)  - 1 as better,
           rank() over (partition by s.game, s.pz order by s.score desc) - 1 as worse
      from res s
     where s.score is not null
    window w as (partition by s.game, s.pz)
  ),
  pts as (
    select s.user_id, sum(10.0 * (s.worse + 0.5 * (s.n - 1 - s.worse - s.better)) / (s.n - 1)) as p
      from scored s where s.n >= 2 group by s.user_id
  ),
  tot as (
    select r.user_id, count(*)::int as played, coalesce(max(pt.p), 0) as p
      from res r left join pts pt on pt.user_id = r.user_id
     group by r.user_id
  ),
  shown as (
    select t.* from tot t join public.profiles pr on pr.id = t.user_id
     where pr.on_global or t.user_id = auth.uid()
  ),
  ranked as (
    select (rank() over (order by round(s.p, 1) desc))::int as rk, s.user_id, round(s.p, 1) as p, s.played
      from shown s
  )
  select k.rk, k.user_id, pr.display_name, pr.handle, k.p, k.played,
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = k.user_id)
    from ranked k
    join public.profiles pr on pr.id = k.user_id
   where k.rk <= 50 or k.user_id = auth.uid()
   order by k.rk, k.played desc, pr.display_name;
end $$;
revoke all on function public.global_board(date, date) from public, anon;
grant execute on function public.global_board(date, date) to authenticated;

-- 4. New Google accounts start with the first name only.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, handle)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                        nullif(split_part(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
                        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                        'Guest'), 40),
          private.make_handle('player' || (1000 + floor(random() * 9000))::int::text));
  return new;
end $$;

-- 5. Game suggestions and votes need an email or Google account, so throwaway guests can't spam them.
create or replace function private.require_full_account()
returns void language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'add your email or Google to your account first';
  end if;
end $$;
grant execute on function private.require_full_account() to authenticated;

create or replace function public.suggest_game(p_name text, p_url text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare sid uuid; n text := btrim(coalesce(p_name, '')); u text := nullif(btrim(coalesce(p_url, '')), '');
begin
  perform private.require_full_account();
  if char_length(n) not between 2 and 40 then raise exception 'name must be 2 to 40 characters'; end if;
  if u is not null and u !~* '^https?://' then u := 'https://' || u; end if;
  if (select count(*) from public.game_suggestions where created_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many suggestions today';
  end if;
  select id into sid from public.game_suggestions where lower(btrim(name)) = lower(n);
  if sid is null then
    insert into public.game_suggestions (name, url, created_by) values (n, u, auth.uid()) returning id into sid;
  elsif u is not null then
    update public.game_suggestions set url = u where id = sid and url is null;
  end if;
  insert into public.game_suggestion_votes (suggestion_id, user_id) values (sid, auth.uid()) on conflict do nothing;
  return sid;
end $$;

create or replace function public.vote_game_suggestion(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_full_account();
  if p_on then
    insert into public.game_suggestion_votes (suggestion_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  else
    delete from public.game_suggestion_votes where suggestion_id = p_id and user_id = auth.uid();
    delete from public.game_suggestions s where s.id = p_id and s.created_by = auth.uid()
      and not exists (select 1 from public.game_suggestion_votes v where v.suggestion_id = s.id);
  end if;
end $$;

-- 6. The extension may log a puzzle up to 2 days old (local dates west of UTC run behind the server's).
create or replace function public.log_result_via_token(p_token text, p_game text, p_day date, p_label text, p_score integer, p_puzzle text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid; n integer;
begin
  update private.device_tokens set last_used_at = now()
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  returning user_id into uid;
  if uid is null then raise exception 'invalid token'; end if;
  if p_day not between current_date - 2 and current_date + 1 then raise exception 'day out of range'; end if;
  insert into public.results (user_id, game, day, label, score, puzzle)
  values (uid, p_game, p_day, p_label, p_score, nullif(p_puzzle, ''))
  on conflict (user_id, game, day) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'saved' else 'exists' end;
end $$;

-- 7. Removing a follower also ends the challenges between you, as the site says.
create or replace function public.remove_follower(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.follows where followee_id = auth.uid() and follower_id = p_user;
  delete from public.challenges
   where (from_user = auth.uid() and to_user = p_user) or (from_user = p_user and to_user = auth.uid());
$$;

-- 8. Handles: reserve a few names and give a clear message when two people race for the same one.
create or replace function public.set_handle(p_handle text)
returns text language plpgsql security definer set search_path = '' as $$
declare h text := lower(btrim(coalesce(p_handle, '')));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  h := regexp_replace(h, '^@', '');
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle must be 3 to 20 letters, numbers or _'; end if;
  if h in ('admin','administrator','mindclub','support','help','official','staff','moderator','mod','root','system','null','undefined') then
    raise exception 'handle is taken';
  end if;
  if exists (select 1 from public.profiles where handle = h and id <> auth.uid()) then
    raise exception 'handle is taken';
  end if;
  begin
    update public.profiles set handle = h where id = auth.uid();
  exception when unique_violation then
    raise exception 'handle is taken';
  end;
  return h;
end $$;
