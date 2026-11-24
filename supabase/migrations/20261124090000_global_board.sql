-- Global leaderboard. Everyone with a real (email) account who played in the range, ranked by points:
-- on each game and day with at least two scored players, you get 10 x the share of the other players
-- you beat (a tie counts half). Only totals come back, never a score, so the board can't spoil a
-- puzzle. Guests are left out. Returns the top 50 plus your own row.
create or replace function public.global_board(p_from date, p_to date)
returns table (rank integer, user_id uuid, display_name text, handle text, points numeric, played integer, i_follow boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range too long'; end if;
  return query
  with res as (
    select r.user_id, r.game, r.day, r.score
      from public.results r
      join auth.users u on u.id = r.user_id and not coalesce(u.is_anonymous, false)
     where r.day between p_from and p_to
  ),
  scored as (
    select s.user_id,
           count(*) over w as n,
           rank() over (partition by s.game, s.day order by s.score asc)  - 1 as better,
           rank() over (partition by s.game, s.day order by s.score desc) - 1 as worse
      from res s
     where s.score is not null
    window w as (partition by s.game, s.day)
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
  ranked as (
    select (rank() over (order by round(t.p, 1) desc))::int as rk, t.user_id, round(t.p, 1) as p, t.played
      from tot t
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
