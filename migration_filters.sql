alter table public.accounts
  add column if not exists sync_since_date date,
  add column if not exists excluded_addresses text[] default '{}',
  add column if not exists excluded_subjects text[] default '{}';
