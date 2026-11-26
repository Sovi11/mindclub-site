-- Google sign-ins: start with the name Google gives (full_name / name) instead of the email prefix.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, handle)
  values (new.id,
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                        'Guest'), 40),
          private.make_handle('player' || (1000 + floor(random() * 9000))::int::text));
  return new;
end $$;
