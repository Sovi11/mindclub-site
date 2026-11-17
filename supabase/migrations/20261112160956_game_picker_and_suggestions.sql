-- Which games a person shows on Today (null = all).
alter table public.profiles add column if not exists games text[];
alter table public.profiles add constraint profiles_games_check check (games is null or cardinality(games) <= 50);

-- Game suggestions with one vote per person.
create table public.game_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 40),
  url text check (url is null or (char_length(url) <= 200 and url ~* '^https?://')),
  created_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index game_suggestions_name_key on public.game_suggestions (lower(btrim(name)));

create table public.game_suggestion_votes (
  suggestion_id uuid not null references public.game_suggestions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (suggestion_id, user_id)
);
create index game_suggestion_votes_user on public.game_suggestion_votes(user_id);

alter table public.game_suggestions enable row level security;
alter table public.game_suggestion_votes enable row level security;
-- Reads go through list_game_suggestions; writes through suggest_game / vote_game_suggestion.
revoke all on public.game_suggestions, public.game_suggestion_votes from anon, authenticated;

-- Everyone signed in sees the list, most votes first. Who suggested it is not shown.
create or replace function public.list_game_suggestions()
returns table (id uuid, name text, url text, votes bigint, voted boolean, mine boolean)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, s.url,
         (select count(*) from public.game_suggestion_votes v where v.suggestion_id = s.id),
         exists (select 1 from public.game_suggestion_votes v where v.suggestion_id = s.id and v.user_id = auth.uid()),
         s.created_by = auth.uid()
    from public.game_suggestions s
   where auth.uid() is not null
   order by 4 desc, s.created_at
   limit 100;
$$;

-- Suggest a game. If someone already suggested the same name, this adds your vote to it instead.
create or replace function public.suggest_game(p_name text, p_url text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare sid uuid; n text := btrim(coalesce(p_name, '')); u text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
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

-- Add or take back your vote. Taking back your vote on your own suggestion with no other votes removes it.
create or replace function public.vote_game_suggestion(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_on then
    insert into public.game_suggestion_votes (suggestion_id, user_id) values (p_id, auth.uid()) on conflict do nothing;
  else
    delete from public.game_suggestion_votes where suggestion_id = p_id and user_id = auth.uid();
    delete from public.game_suggestions s where s.id = p_id and s.created_by = auth.uid()
      and not exists (select 1 from public.game_suggestion_votes v where v.suggestion_id = s.id);
  end if;
end $$;

revoke all on function public.list_game_suggestions(), public.suggest_game(text, text), public.vote_game_suggestion(uuid, boolean) from public, anon;
grant execute on function public.list_game_suggestions(), public.suggest_game(text, text), public.vote_game_suggestion(uuid, boolean) to authenticated;