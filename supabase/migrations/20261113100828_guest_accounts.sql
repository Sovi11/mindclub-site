-- Guests (anonymous sign-ins) start as "Guest" instead of an empty name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, handle)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                        'Guest'), 40),
          private.make_handle('player' || (1000 + floor(random() * 9000))::int::text));
  return new;
end $$;

-- Remove guest accounts nobody has used for 30 days. Everything they own goes with them (cascades).
create or replace function private.delete_stale_guests()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '30 days'
     and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'
     and not exists (select 1 from public.results r where r.user_id = u.id and r.created_at > now() - interval '30 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.delete_stale_guests() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('delete-stale-guests', '17 3 * * *', 'select private.delete_stale_guests()');
