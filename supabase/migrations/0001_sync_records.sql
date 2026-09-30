-- Opt-in cloud backup and sync of a user's local records.
-- The browser (IndexedDB) stays the primary copy; this table is a per-user mirror.
-- Records are stored whole as jsonb so fields added by newer app versions survive (CLAUDE.md invariant 2).

create table public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  store text not null check (store in ('entries', 'foods', 'weights', 'settings')),
  id text not null check (length(id) between 1 and 200),
  -- The record exactly as the app stores it; null once deleted.
  data jsonb check (data is null or pg_column_size(data) <= 65536),
  -- When the change was made on the device. Used for last-write-wins.
  client_updated_at timestamptz not null,
  -- Deleted records stay as markers so other devices learn about the delete.
  deleted boolean not null default false,
  -- When the server accepted the change. Devices pull everything after their last cursor.
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, store, id),
  check (deleted or data is not null)
);

create index sync_records_pull_idx on public.sync_records (user_id, server_updated_at);

-- Last write wins: an older change never overwrites a newer one, and the server clock drives pull cursors.
create function public.sync_records_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id cannot change';
    end if;
    if new.client_updated_at < old.client_updated_at then
      return null; -- stale write from a device that was behind: keep the newer row
    end if;
  end if;
  if new.deleted then
    new.data := null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger sync_records_guard
before insert or update on public.sync_records
for each row execute function public.sync_records_guard();

alter table public.sync_records enable row level security;

revoke all on public.sync_records from anon;
grant select, insert, update on public.sync_records to authenticated;

create policy "Users read their own records"
on public.sync_records for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users add their own records"
on public.sync_records for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users change their own records"
on public.sync_records for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- No delete policy: devices delete by writing a marker. Deleting the account removes every row (on delete cascade).
