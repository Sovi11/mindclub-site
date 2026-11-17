revoke execute on function public.handle_new_user() from authenticated;

create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_club_member(uuid) set schema private;
alter function public.shares_club(uuid) set schema private;

-- Recreate functions/policies that referenced the helpers by name.
drop policy "see self and clubmates" on public.profiles;
create policy "see self and clubmates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_club(id));
drop policy "members see club" on public.clubs;
create policy "members see club" on public.clubs for select to authenticated
  using (private.is_club_member(id));
drop policy "members see members" on public.club_members;
create policy "members see members" on public.club_members for select to authenticated
  using (private.is_club_member(club_id));

create or replace function public.club_board(p_club uuid, p_from date, p_to date)
returns table (user_id uuid, game text, day date, revealed boolean,
               label text, score integer, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_club_member(p_club) then raise exception 'not a member'; end if;
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