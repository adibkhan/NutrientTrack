-- A stale write used to be dropped silently. The sending device then acknowledged it and never learned that a
-- newer version won, because pull cursors had already moved past the winning row. Now the row is rewritten
-- unchanged with a fresh server timestamp, so the device that lost pulls the winner on its next sync.
create or replace function public.sync_records_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id cannot change';
    end if;
    if new.client_updated_at < old.client_updated_at then
      -- keep the newer version exactly as it is; only the server stamp moves forward
      new.data := old.data;
      new.deleted := old.deleted;
      new.client_updated_at := old.client_updated_at;
    end if;
  end if;
  if new.deleted then
    new.data := null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;
