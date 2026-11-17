-- Profiles: one per signed-in user, created automatically on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user_idx on public.club_members (user_id);

-- One result per user, game and local calendar day.
create table public.results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  game text not null check (game ~ '^[a-z]{2,20}$'),
  day date not null check (day >= date '2024-01-01'),
  label text not null check (char_length(label) between 1 and 40),
  score integer,               -- lower is better; null = played, no score
  puzzle text check (char_length(puzzle) <= 20),
  stars smallint check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, game, day)
);
create index results_day_game_idx on public.results (day, game);

-- Auto-create a profile for every new user.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                                 split_part(coalesce(new.email, 'player'), '@', 1)), 40));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Membership helpers (security definer avoids recursive RLS lookups).
create function public.is_club_member(p_club uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.club_members
                 where club_id = p_club and user_id = (select auth.uid()));
$$;

create function public.shares_club(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.club_members a
                 join public.club_members b on a.club_id = b.club_id
                 where a.user_id = (select auth.uid()) and b.user_id = p_user);
$$;

-- Row level security
alter table public.profiles enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.results enable row level security;

create policy "see self and clubmates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_club(id));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see club" on public.clubs for select to authenticated
  using (public.is_club_member(id));

create policy "members see members" on public.club_members for select to authenticated
  using (public.is_club_member(club_id));
create policy "leave club" on public.club_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- Direct access to results is own-rows only. Friends' results come through club_board().
create policy "own results read" on public.results for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own results insert" on public.results for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own results update" on public.results for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own results delete" on public.results for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.profiles, public.clubs, public.club_members, public.results from anon;

-- Create a club and join it.
create function public.create_club(p_name text) returns public.clubs
language plpgsql security definer set search_path = '' as $$
declare c public.clubs;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.clubs (name, created_by) values (trim(p_name), auth.uid()) returning * into c;
  insert into public.club_members (club_id, user_id) values (c.id, auth.uid());
  return c;
end $$;

-- Join a club with its invite code.
create function public.join_club(p_code text) returns public.clubs
language plpgsql security definer set search_path = '' as $$
declare c public.clubs;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into c from public.clubs where invite_code = upper(trim(p_code));
  if c.id is null then raise exception 'invite code not found'; end if;
  if (select count(*) from public.club_members where club_id = c.id) >= 50 then
    raise exception 'club is full';
  end if;
  insert into public.club_members (club_id, user_id) values (c.id, auth.uid())
    on conflict do nothing;
  return c;
end $$;

-- Club results for a date range. A friend's score is only revealed
-- once the caller has logged the same game on the same day (no spoilers).
create function public.club_board(p_club uuid, p_from date, p_to date)
returns table (user_id uuid, game text, day date, revealed boolean,
               label text, score integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_club_member(p_club) then raise exception 'not a member'; end if;
  if p_to - p_from > 62 then raise exception 'range too long'; end if;
  return query
    select r.user_id, r.game, r.day, v.ok,
           case when v.ok then r.label end,
           case when v.ok then r.score end,
           r.created_at
    from public.results r
    join public.club_members cm on cm.user_id = r.user_id and cm.club_id = p_club
    cross join lateral (
      select r.user_id = auth.uid() or exists (
        select 1 from public.results m
        where m.user_id = auth.uid() and m.game = r.game and m.day = r.day) as ok
    ) v
    where r.day between p_from and p_to;
end $$;

revoke execute on function public.create_club(text), public.join_club(text),
  public.club_board(uuid, date, date), public.is_club_member(uuid),
  public.shares_club(uuid), public.handle_new_user() from public, anon;
grant execute on function public.create_club(text), public.join_club(text),
  public.club_board(uuid, date, date), public.is_club_member(uuid),
  public.shares_club(uuid) to authenticated;
