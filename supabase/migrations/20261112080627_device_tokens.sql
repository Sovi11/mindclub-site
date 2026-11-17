-- Keys for the browser extension. Only a hash is stored; the key itself is shown once.
create table private.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Chrome extension',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index device_tokens_user_idx on private.device_tokens (user_id);
alter table private.device_tokens enable row level security;
revoke all on private.device_tokens from public, anon, authenticated;

-- Signed-in user creates a key for their extension. Old extension keys are replaced.
create function public.create_device_token(p_label text default 'Chrome extension')
returns text language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from private.device_tokens where user_id = auth.uid() and label = left(p_label, 40);
  insert into private.device_tokens (user_id, token_hash, label)
  values (auth.uid(), encode(sha256(convert_to(tok, 'UTF8')), 'hex'), left(p_label, 40));
  return tok;
end $$;

-- Signed-in user revokes all their extension keys.
create function public.revoke_device_tokens() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from private.device_tokens where user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

-- Called by the extension (no login session). The key only allows logging
-- a result for its owner, for today or yesterday/tomorrow (timezones), never overwriting.
create function public.log_result_via_token(
  p_token text, p_game text, p_day date, p_label text, p_score integer, p_puzzle text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid; n integer;
begin
  update private.device_tokens set last_used_at = now()
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  returning user_id into uid;
  if uid is null then raise exception 'invalid token'; end if;
  if p_day not between current_date - 1 and current_date + 1 then raise exception 'day out of range'; end if;
  insert into public.results (user_id, game, day, label, score, puzzle)
  values (uid, p_game, p_day, p_label, p_score, nullif(p_puzzle, ''))
  on conflict (user_id, game, day) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'saved' else 'exists' end;
end $$;

revoke execute on function public.create_device_token(text), public.revoke_device_tokens(),
  public.log_result_via_token(text, text, date, text, integer, text) from public;
grant execute on function public.create_device_token(text), public.revoke_device_tokens() to authenticated;
grant execute on function public.log_result_via_token(text, text, date, text, integer, text) to anon, authenticated;