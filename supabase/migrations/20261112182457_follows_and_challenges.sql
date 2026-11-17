
-- Clubs are replaced by follows. There are no clubs yet, so nothing is lost.
drop policy if exists "see self and clubmates" on public.profiles;
drop function if exists public.club_board(uuid, date, date);
drop function if exists public.create_club(text);
drop function if exists public.join_club(text);
drop table if exists public.club_members;
drop table if exists public.clubs;
drop function if exists private.is_club_member(uuid);
drop function if exists private.shares_club(uuid);

-- Handles: how people find and link to each other.
create or replace function private.make_handle(p_base text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare b text := left(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_]', '', 'g'), 15);
        h text; tries int := 0;
begin
  if char_length(b) < 3 then b := 'player'; end if;
  h := b;
  while exists (select 1 from public.profiles where handle = h) loop
    tries := tries + 1;
    h := b || (1000 + floor(random() * 9000))::int::text;
    if tries > 40 then h := left(b || replace(gen_random_uuid()::text, '-', ''), 20); end if;
  end loop;
  return h;
end $$;
revoke all on function private.make_handle(text) from public, anon, authenticated;

alter table public.profiles add column if not exists handle text;
update public.profiles set handle = private.make_handle(display_name) where handle is null;
alter table public.profiles alter column handle set not null;
alter table public.profiles add constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,20}$');
create unique index if not exists profiles_handle_key on public.profiles (handle);

-- New accounts get a neutral handle (not the email) until they pick one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, handle)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                        split_part(coalesce(new.email, 'player'), '@', 1)), 40),
          private.make_handle('player'));
  return new;
end $$;

-- Follows
create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;

-- Challenges: you challenge someone who follows you, on one game for one day.
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9]{2,20}$'),
  day date not null,
  note text check (char_length(note) <= 80),
  status text not null default 'open' check (status in ('open', 'declined')),
  created_at timestamptz not null default now(),
  unique (from_user, to_user, game, day),
  check (from_user <> to_user)
);
create index challenges_to_idx on public.challenges (to_user, day);
alter table public.challenges enable row level security;
revoke all on public.challenges from anon, authenticated;

-- Who you can see a profile of: yourself, anyone you follow or who follows you, and challenge opponents.
create or replace function private.connected(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = (select auth.uid())
      or exists (select 1 from public.follows f
                 where (f.follower_id = (select auth.uid()) and f.followee_id = p_user)
                    or (f.followee_id = (select auth.uid()) and f.follower_id = p_user))
      or exists (select 1 from public.challenges c
                 where (c.from_user = (select auth.uid()) and c.to_user = p_user)
                    or (c.to_user = (select auth.uid()) and c.from_user = p_user));
$$;
revoke all on function private.connected(uuid) from public, anon;
grant execute on function private.connected(uuid) to authenticated;
create policy "see self and connections" on public.profiles for select to authenticated
  using (private.connected(id));

-- Changing your own handle: lowercase letters, numbers, underscore, 3 to 20.
create or replace function public.set_handle(p_handle text)
returns text language plpgsql security definer set search_path = '' as $$
declare h text := lower(btrim(coalesce(p_handle, '')));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  h := regexp_replace(h, '^@', '');
  if h !~ '^[a-z0-9_]{3,20}$' then raise exception 'handle must be 3 to 20 letters, numbers or _'; end if;
  if exists (select 1 from public.profiles where handle = h and id <> auth.uid()) then
    raise exception 'handle is taken';
  end if;
  update public.profiles set handle = h where id = auth.uid();
  return h;
end $$;

-- Find people by handle (prefix) to follow.
create or replace function public.find_people(p_q text)
returns table (user_id uuid, display_name text, handle text, i_follow boolean, follows_me boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.handle,
         exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = p.id),
         exists (select 1 from public.follows f where f.followee_id = auth.uid() and f.follower_id = p.id)
    from public.profiles p
   where auth.uid() is not null
     and char_length(regexp_replace(lower(btrim(coalesce(p_q, ''))), '^@', '')) >= 2
     and p.handle like replace(replace(regexp_replace(lower(btrim(p_q)), '^@', ''), '_', '\_'), '%', '\%') || '%'
   order by p.handle = regexp_replace(lower(btrim(p_q)), '^@', '') desc, p.handle
   limit 10;
$$;

-- Everyone you follow and everyone who follows you.
create or replace function public.my_people()
returns table (user_id uuid, display_name text, handle text, i_follow boolean, follows_me boolean, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name, p.handle,
         o.followee_id is not null, i.follower_id is not null,
         greatest(o.created_at, i.created_at)
    from public.profiles p
    left join public.follows o on o.follower_id = auth.uid() and o.followee_id = p.id
    left join public.follows i on i.followee_id = auth.uid() and i.follower_id = p.id
   where auth.uid() is not null and (o.followee_id is not null or i.follower_id is not null)
   order by p.display_name;
$$;

create or replace function public.follow(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_user = auth.uid() then raise exception 'you can''t follow yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'person not found'; end if;
  if (select count(*) from public.follows where follower_id = auth.uid()) >= 500 then
    raise exception 'you follow the most people allowed (500)';
  end if;
  insert into public.follows (follower_id, followee_id) values (auth.uid(), p_user) on conflict do nothing;
end $$;

create or replace function public.unfollow(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.follows where follower_id = auth.uid() and followee_id = p_user;
$$;

-- Stop someone following you. This also ends challenges you sent them.
create or replace function public.remove_follower(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.follows where followee_id = auth.uid() and follower_id = p_user;
$$;

-- Results of you and the people you follow. A score is hidden until you've logged the same game that day.
create or replace function public.following_board(p_from date, p_to date)
returns table (user_id uuid, game text, day date, revealed boolean, label text, score integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_to - p_from > 62 then raise exception 'range too long'; end if;
  return query
    select r.user_id, r.game, r.day, v.ok,
           case when v.ok then r.label end,
           case when v.ok then r.score end,
           r.created_at
      from public.results r
      cross join lateral (
        select r.user_id = auth.uid() or exists (
          select 1 from public.results m
           where m.user_id = auth.uid() and m.game = r.game and m.day = r.day) as ok) v
     where r.day between p_from and p_to
       and (r.user_id = auth.uid()
            or exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = r.user_id));
end $$;

-- Challenge some of your followers on one game. Returns how many were sent.
create or replace function public.send_challenge(p_to uuid[], p_game text, p_day date, p_note text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_day not between current_date - 1 and current_date + 1 then raise exception 'you can only challenge on today''s puzzle'; end if;
  if coalesce(array_length(p_to, 1), 0) = 0 then raise exception 'pick someone to challenge'; end if;
  if exists (select 1 from unnest(p_to) t(uid)
             where not exists (select 1 from public.follows f where f.follower_id = t.uid and f.followee_id = auth.uid())) then
    raise exception 'you can only challenge people who follow you';
  end if;
  if (select count(*) from public.challenges where from_user = auth.uid() and created_at > now() - interval '1 day')
     + array_length(p_to, 1) > 100 then
    raise exception 'too many challenges today';
  end if;
  insert into public.challenges (from_user, to_user, game, day, note)
  select auth.uid(), t.uid, p_game, p_day, nullif(left(btrim(coalesce(p_note, '')), 80), '')
    from (select distinct unnest(p_to) as uid) t
  on conflict (from_user, to_user, game, day) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.decline_challenge(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.challenges set status = 'declined' where id = p_id and to_user = auth.uid();
$$;

create or replace function public.cancel_challenge(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.challenges where id = p_id and from_user = auth.uid();
$$;

-- Your challenges from the last two weeks, sent and received.
-- The other person's score shows only once you've logged that game for that day.
create or replace function public.my_challenges()
returns table (id uuid, outgoing boolean, other_id uuid, other_name text, other_handle text,
               game text, day date, note text, status text, created_at timestamptz,
               my_label text, my_score integer, their_played boolean, their_label text, their_score integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.from_user = auth.uid(), o.id, o.display_name, o.handle,
         c.game, c.day, c.note, c.status, c.created_at,
         m.label, m.score, t.user_id is not null,
         case when m.user_id is not null then t.label end,
         case when m.user_id is not null then t.score end
    from public.challenges c
    join public.profiles o on o.id = case when c.from_user = auth.uid() then c.to_user else c.from_user end
    left join public.results m on m.user_id = auth.uid() and m.game = c.game and m.day = c.day
    left join public.results t on t.user_id = o.id and t.game = c.game and t.day = c.day
   where auth.uid() is not null
     and (c.from_user = auth.uid() or c.to_user = auth.uid())
     and c.day >= current_date - 14
   order by c.day desc, c.created_at desc
   limit 200;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_handle(text)', 'find_people(text)', 'my_people()', 'follow(uuid)', 'unfollow(uuid)',
    'remove_follower(uuid)', 'following_board(date, date)', 'send_challenge(uuid[], text, date, text)',
    'decline_challenge(uuid)', 'cancel_challenge(uuid)', 'my_challenges()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
