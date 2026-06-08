-- Fix for /api/datovka/mailboxes 500 after adding live ISDS access.
-- Run in Supabase SQL Editor if the Datovka page returns HTTP 500.

alter table public.datovka_mailboxes
  add column if not exists login_enc text,
  add column if not exists password_enc text,
  add column if not exists live_access_enabled boolean default false,
  add column if not exists is_test boolean default false,
  add column if not exists sync_days int default 90,
  add column if not exists sync_limit int default 100,
  add column if not exists sync_status text default 'idle',
  add column if not exists sync_error text,
  add column if not exists last_sync_at timestamptz,
  add column if not exists password_expires_at timestamptz,
  add column if not exists live_info jsonb default '{}'::jsonb;

create index if not exists idx_datovka_mailboxes_live
  on public.datovka_mailboxes(user_id, live_access_enabled);

create unique index if not exists idx_datovka_messages_user_mailbox_dm
  on public.datovka_messages(user_id, mailbox_id, dm_id)
  where dm_id is not null;

-- Quick verification: should return the newly added columns.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'datovka_mailboxes'
  and column_name in (
    'login_enc', 'password_enc', 'live_access_enabled', 'is_test',
    'sync_days', 'sync_limit', 'sync_status', 'sync_error',
    'last_sync_at', 'password_expires_at', 'live_info'
  )
order by column_name;
