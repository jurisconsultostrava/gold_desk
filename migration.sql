-- Mailroom Supabase migration
-- Spusť v Supabase SQL editor (Dashboard → SQL editor → New query).
-- Vytvoří tabulky pro účty, vlákna, zprávy, přílohy a akce.

create extension if not exists "pgcrypto";

-- účty schránek (IMAP / Outlook / Gmail)
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  provider text not null check (provider in ('imap','outlook','gmail')),
  email text not null,
  imap_host text,
  imap_port int,
  imap_password_enc text,
  imap_use_tls boolean default true,
  smtp_host text,
  smtp_port int,
  smtp_password_enc text,
  oauth_refresh_token_enc text,
  oauth_access_token_enc text,
  oauth_expires_at timestamptz,
  last_sync_at timestamptz,
  sync_status text default 'idle',
  sync_error text,
  sync_since_date date,
  excluded_addresses text[] default '{}',
  excluded_subjects text[] default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_accounts_user on public.accounts(user_id);

-- vlákna
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  user_id text not null,
  thread_key text,
  subject text,
  participants text[] default '{}',
  last_message_at timestamptz,
  message_count int default 0,
  category text,
  category_confidence numeric,
  summary text,
  key_facts text[] default '{}',
  language text,
  priority text,
  has_attachments boolean default false,
  is_read boolean default false,
  is_archived boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_threads_account_last on public.threads(account_id, last_message_at desc);
create index if not exists idx_threads_user on public.threads(user_id);
create index if not exists idx_threads_category on public.threads(category);
create unique index if not exists idx_threads_account_key on public.threads(account_id, thread_key);

-- zprávy
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.threads(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  user_id text not null,
  external_id text,
  message_id_header text,
  in_reply_to text,
  refs text[] default '{}',
  from_address text,
  from_name text,
  to_addresses text[] default '{}',
  cc_addresses text[] default '{}',
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  is_outgoing boolean default false,
  created_at timestamptz default now(),
  unique(account_id, external_id)
);
create index if not exists idx_messages_thread on public.messages(thread_id, sent_at);

-- přílohy
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete cascade,
  user_id text not null,
  filename text not null,
  mime_type text,
  size_bytes int,
  storage_path text,
  extracted_text text,
  extracted_at timestamptz,
  ocr_used boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_attachments_thread on public.attachments(thread_id);

-- akce / draft odpovědí / Q&A
create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references public.threads(id) on delete cascade,
  attachment_id uuid references public.attachments(id) on delete set null,
  user_id text not null,
  type text not null check (type in ('reply_draft','document_qa','summary')),
  prompt text,
  result text,
  language text,
  status text default 'draft',
  created_at timestamptz default now()
);
create index if not exists idx_actions_thread on public.actions(thread_id, created_at desc);

-- Storage bucket pro přílohy (private):
-- V Supabase Dashboard → Storage → New bucket → name: mailroom-attachments, Public: OFF
-- nebo přes API:
-- insert into storage.buckets (id, name, public) values ('mailroom-attachments','mailroom-attachments', false) on conflict do nothing;


-- Bezpečný doplněk pro starší instalace, kde už accounts existuje bez filtračních sloupců.
alter table public.accounts
  add column if not exists sync_since_date date,
  add column if not exists excluded_addresses text[] default '{}',
  add column if not exists excluded_subjects text[] default '{}';

-- ===== Datová schránka / Datovka module =====
-- Schránky evidované v aplikaci.
create table if not exists public.datovka_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  id_ds text,
  ico text,
  notes text,
  created_at timestamptz default now()
);
create index if not exists idx_datovka_mailboxes_user on public.datovka_mailboxes(user_id);

-- Nahrané ZFO/PDF zprávy z datové schránky.
create table if not exists public.datovka_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  mailbox_id uuid references public.datovka_mailboxes(id) on delete set null,
  dm_id text,
  sender_name text,
  sender_id_ds text,
  sender_ico text,
  recipient_name text,
  recipient_id_ds text,
  subject text,
  delivered_at timestamptz,
  accepted_at timestamptz,
  institution_type text,
  submission_type text,
  case_number text,
  priority text,
  language text,
  summary text,
  key_facts text[] default '{}',
  deadline_date date,
  deadline_text text,
  content_preview text,
  full_text text,
  original_filename text,
  storage_path text,
  file_kind text check (file_kind in ('zfo','pdf')),
  is_processed boolean default false,
  is_archived boolean default false,
  processing_error text,
  created_at timestamptz default now()
);
create index if not exists idx_datovka_messages_user_delivered on public.datovka_messages(user_id, delivered_at desc);
create index if not exists idx_datovka_messages_mailbox on public.datovka_messages(mailbox_id, delivered_at desc);
create index if not exists idx_datovka_messages_priority on public.datovka_messages(priority);
create index if not exists idx_datovka_messages_submission on public.datovka_messages(submission_type);

-- Extrahované přílohy zpráv z datové schránky.
create table if not exists public.datovka_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.datovka_messages(id) on delete cascade,
  user_id text not null,
  filename text not null,
  mime_type text,
  size_bytes int,
  storage_path text,
  extracted_text text,
  ocr_used boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_datovka_attachments_message on public.datovka_attachments(message_id);
create index if not exists idx_datovka_attachments_user on public.datovka_attachments(user_id);

-- Storage buckets používané backendem. Nevadí, pokud už existují.
insert into storage.buckets (id, name, public)
values
  ('mailroom-attachments', 'mailroom-attachments', false),
  ('datovka-files', 'datovka-files', false)
on conflict (id) do nothing;

-- ===== GoldDesk Communicator module =====
-- Modul pro bezpečné generování odpovědí klientům, HTML e-mailů a reakcí na recenze.
create table if not exists public.communication_cases (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  mode text not null default 'client' check (mode in ('client','review')),
  client_name text,
  client_email text,
  product_type text,
  situation_type text,
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  tone text,
  input_data jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz default now()
);
create index if not exists idx_communication_cases_user_created on public.communication_cases(user_id, created_at desc);
create index if not exists idx_communication_cases_mode on public.communication_cases(mode);
create index if not exists idx_communication_cases_risk on public.communication_cases(risk_level);
create index if not exists idx_communication_cases_situation on public.communication_cases(situation_type);

create table if not exists public.communication_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid references public.communication_cases(id) on delete cascade,
  subject text,
  summary text,
  email_text text,
  sms_text text,
  whatsapp_text text,
  phone_script text,
  internal_note text,
  review_reply text,
  html_output text,
  risk_analysis jsonb default '{}'::jsonb,
  phrases_to_avoid jsonb default '[]'::jsonb,
  safe_wording jsonb default '[]'::jsonb,
  checklist jsonb default '[]'::jsonb,
  recommended_next_steps jsonb default '[]'::jsonb,
  approval_required boolean default false,
  approved boolean default false,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_communication_outputs_case on public.communication_outputs(case_id);
create index if not exists idx_communication_outputs_user_created on public.communication_outputs(user_id, created_at desc);
create index if not exists idx_communication_outputs_approval on public.communication_outputs(user_id, approval_required, approved);

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default-user',
  name text not null,
  category text not null,
  tone text,
  template_text text not null,
  risk_level text default 'medium',
  active boolean default true,
  created_at timestamptz default now(),
  unique(user_id, category, name)
);
create index if not exists idx_communication_templates_user_active on public.communication_templates(user_id, active, category);

create table if not exists public.communication_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  case_id uuid references public.communication_cases(id) on delete set null,
  action text not null,
  actor text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_communication_audit_user_created on public.communication_audit_log(user_id, created_at desc);
create index if not exists idx_communication_audit_case on public.communication_audit_log(case_id);

insert into public.communication_templates (user_id, name, category, tone, template_text, risk_level)
values
  ('default-user', 'Omluva za zpožděnou odpověď', 'delayed_reply', 'human_apology', 'Přiznat nedostatečnou komunikaci, nevymýšlet termín, slíbit ověření a další konkrétní kontakt.', 'medium'),
  ('default-user', 'Deponované zlato / odměna', 'gold_deposit', 'legally_cautious', 'Omluva za komunikaci, ověření podle smlouvy/evidence kovu, bez garance výnosu nebo neověřeného data.', 'high'),
  ('default-user', 'Zpožděné dodání fyzického kovu', 'delivery_delay', 'formal', 'Vysvětlit dostupnost u rafinérie/distributora jen pokud je ověřená, uvést další postup, neuznávat právní prodlení bez kontroly.', 'high'),
  ('default-user', 'Negativní veřejná recenze', 'review_negative', 'public_safe', 'Poděkovat, neútočit, nezveřejňovat detaily, pozvat klienta do soukromého řešení.', 'high'),
  ('default-user', 'Žádost o refundaci', 'refund', 'legally_cautious', 'Potvrdit přijetí žádosti, prověřit smlouvu a platby, neslíbit vrácení bez schválení.', 'high'),
  ('default-user', 'AML identifikace', 'aml', 'formal', 'Vysvětlit zákonnou povinnost identifikace a kontroly klienta, nehodnotit klienta osobně.', 'medium'),
  ('default-user', 'Advokát / předžalobní výzva', 'legal_notice', 'legally_cautious', 'Potvrdit přijetí, sdělit, že věc prověřujeme, žádné věcné uznání bez právní kontroly.', 'critical')
on conflict (user_id, category, name) do update set
  tone = excluded.tone,
  template_text = excluded.template_text,
  risk_level = excluded.risk_level,
  active = true;
