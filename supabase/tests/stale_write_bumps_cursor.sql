-- A losing (stale) write must leave the newer data untouched but move server_updated_at forward,
-- so the device that lost pulls the winner. Runs in one transaction and always rolls back.
begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'd1@example.invalid');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);

insert into public.sync_records (store, id, data, client_updated_at)
values ('entries', 'e1', '{"id":"e1","name":"Winner"}', '2026-09-30T12:00:00Z');

create temp table before_stale on commit drop as
select server_updated_at, client_updated_at, data from public.sync_records where id = 'e1';
grant select on before_stale to authenticated;

update public.sync_records set data = '{"id":"e1","name":"Loser"}', deleted = true, client_updated_at = '2026-09-30T08:00:00Z' where id = 'e1';

do $$
declare
  row_now public.sync_records;
  row_before record;
begin
  select * into row_now from public.sync_records where id = 'e1';
  select * into row_before from before_stale;
  if row_now.data ->> 'name' <> 'Winner' or row_now.deleted or row_now.client_updated_at <> row_before.client_updated_at then
    raise exception 'FAIL a stale write changed the newer row';
  end if;
  if row_now.server_updated_at <= row_before.server_updated_at then
    raise exception 'FAIL a stale write did not move server_updated_at forward';
  end if;
end $$;

-- A write that is newer still wins and is stored whole.
update public.sync_records set data = '{"id":"e1","name":"Newer"}', client_updated_at = '2026-09-30T13:00:00Z' where id = 'e1';
do $$ begin
  if (select data ->> 'name' from public.sync_records where id = 'e1') <> 'Newer' then
    raise exception 'FAIL a newer write did not win';
  end if;
end $$;

reset role;
select 'PASS stale_write_bumps_cursor' as result;
rollback;
