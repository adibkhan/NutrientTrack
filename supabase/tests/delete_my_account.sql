-- delete_my_account removes only the caller's account and rows, and refuses anonymous callers.
-- Runs in one transaction and always rolls back. A failed check raises an exception starting with FAIL.
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'c1@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c2', 'authenticated', 'authenticated', 'c2@example.invalid');
insert into public.sync_records (user_id, store, id, data, client_updated_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'entries', 'mine', '{"id":"mine"}', now()),
  ('00000000-0000-4000-8000-0000000000c2', 'entries', 'theirs', '{"id":"theirs"}', now());

-- Anonymous callers cannot run it.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.delete_my_account();
    raise exception 'FAIL an anonymous caller could run delete_my_account';
  exception when insufficient_privilege then null;
  end;
end $$;

-- User c1 deletes their own account.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select public.delete_my_account();

reset role;
do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000c1') then
    raise exception 'FAIL the account was not deleted';
  end if;
  if exists (select 1 from public.sync_records where user_id = '00000000-0000-4000-8000-0000000000c1') then
    raise exception 'FAIL synced rows outlived the account';
  end if;
  if not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000c2')
     or not exists (select 1 from public.sync_records where id = 'theirs') then
    raise exception 'FAIL another user''s account or rows were deleted';
  end if;
end $$;

select 'PASS delete_my_account' as result;
rollback;
