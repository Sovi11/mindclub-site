-- Connecting a second computer no longer disconnects the first. Keep the 5 newest keys per user.
create or replace function public.create_device_token(p_label text default 'Chrome extension')
returns text language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into private.device_tokens (user_id, token_hash, label)
  values (auth.uid(), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), left(p_label, 40));
  delete from private.device_tokens
   where user_id = auth.uid()
     and id not in (select id from private.device_tokens where user_id = auth.uid()
                    order by created_at desc limit 5);
  return tok;
end $$;
revoke execute on function public.create_device_token(text) from public, anon;
grant execute on function public.create_device_token(text) to authenticated;