-- Security and conflict checks for public.sync_records. Runs in one transaction and always rolls back.
-- Any failed check raises an exception whose message starts with FAIL.
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'a@example.invalid'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'b@example.invalid');

-- User A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

insert into public.sync_records (store, id, data, client_updated_at)
values ('entries', 'e1', '{"id":"e1","name":"Soup","sodium":900}', '2026-09-30T10:00:00Z');

do $$ begin
  if (select user_id from public.sync_records where id = 'e1') <> '00000000-0000-4000-8000-00000000000a' then
    raise exception 'FAIL user_id did not default to the signed-in user';
  end if;
end $$;

-- A stale write from a device that was behind must not overwrite the newer row.
update public.sync_records set data = '{"id":"e1","name":"Stale"}', client_updated_at = '2026-09-30T09:00:00Z' where id = 'e1';
do $$ begin
  if (select data ->> 'name' from public.sync_records where id = 'e1') <> 'Soup' then
    raise exception 'FAIL a stale write overwrote newer data';
  end if;
end $$;

-- A newer write wins, and fields the server does not know about are kept.
update public.sync_records set data = '{"id":"e1","name":"Soup, edited","sodium":900}', client_updated_at = '2026-09-30T11:00:00Z' where id = 'e1';
do $$ begin
  if (select data ->> 'name' from public.sync_records where id = 'e1') <> 'Soup, edited'
     or (select (data ->> 'sodium')::int from public.sync_records where id = 'e1') <> 900 then
    raise exception 'FAIL a newer write was not stored whole';
  end if;
end $$;

-- Deleting writes a marker and drops the data.
insert into public.sync_records (store, id, data, client_updated_at)
values ('weights', 'w1', '{"id":"w1","weight":180}', '2026-09-30T10:00:00Z');
update public.sync_records set deleted = true, client_updated_at = '2026-09-30T12:00:00Z' where id = 'w1';
do $$ begin
  if not (select deleted and data is null from public.sync_records where id = 'w1') then
    raise exception 'FAIL a delete did not leave an empty marker';
  end if;
end $$;

-- Rows cannot be hard-deleted by a device.
do $$ begin
  begin
    delete from public.sync_records where id = 'e1';
    raise exception 'FAIL a device could hard-delete a row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Unknown stores are rejected.
do $$ begin
  begin
    insert into public.sync_records (store, id, data, client_updated_at) values ('secrets', 'x', '{}', now());
    raise exception 'FAIL an unknown store was accepted';
  exception when check_violation then null;
  end;
end $$;

-- User B
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare
  changed int;
begin
  if (select count(*) from public.sync_records) <> 0 then
    raise exception 'FAIL user B can read user A''s records';
  end if;
  update public.sync_records set data = '{"id":"e1","name":"Hijacked"}', client_updated_at = '2030-01-01T00:00:00Z' where id = 'e1';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL user B changed user A''s record';
  end if;
  begin
    insert into public.sync_records (user_id, store, id, data, client_updated_at)
    values ('00000000-0000-4000-8000-00000000000a', 'entries', 'forged', '{}', now());
    raise exception 'FAIL user B wrote a record into user A''s account';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Anonymous visitors get nothing.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform 1 from public.sync_records;
    raise exception 'FAIL anonymous visitors can read sync_records';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'PASS sync_records_rls' as result;
rollback;
