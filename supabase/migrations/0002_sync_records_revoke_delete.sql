-- Supabase grants every privilege on new public tables to authenticated by default, so 0001's
-- grant did not remove DELETE. Devices must only mark records deleted; account deletion cascades.
revoke delete, truncate, references, trigger on public.sync_records from authenticated;
