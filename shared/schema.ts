// TypeScript types matching Supabase tables. No Drizzle SQLite — we use supabase-js.

import { z } from "zod";

// ----- Account
export type Provider = "imap" | "outlook" | "gmail";

export interface Account {
  id: string;
  user_id: string;
  name: string;
  provider: Provider;
  email: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_password_enc: string | null;
  imap_use_tls: boolean | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_password_enc: string | null;
  oauth_refresh_token_enc: string | null;
  oauth_access_token_enc: string | null;
  oauth_expires_at: string | null;
  last_sync_at: string | null;
  sync_status: "idle" | "syncing" | "error" | string | null;
  sync_error: string | null;
  sync_since_date: string | null;
  excluded_addresses: string[];
  excluded_subjects: string[];
  created_at: string;
}

export const insertImapAccountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_password: z.string().min(1),
  imap_use_tls: z.boolean().default(true),
  smtp_host: z.string().optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_password: z.string().optional(),
  sync_since_date: z.string().optional().nullable(),
  excluded_addresses: z.array(z.string()).optional().default([]),
  excluded_subjects: z.array(z.string()).optional().default([]),
});
export type InsertImapAccount = z.infer<typeof insertImapAccountSchema>;

export const updateAccountFiltersSchema = z.object({
  name: z.string().min(1).optional(),
  sync_since_date: z.string().optional().nullable(),
  excluded_addresses: z.array(z.string()).optional(),
  excluded_subjects: z.array(z.string()).optional(),
});
export type UpdateAccountFilters = z.infer<typeof updateAccountFiltersSchema>;

// ----- Thread
export type ThreadCategory =
  | "contract"
  | "demand"
  | "request"
  | "invoice"
  | "client"
  | "internal"
  | "other";
export type ThreadPriority = "high" | "normal" | "low";
export type ThreadLanguage = "cs" | "en" | "de" | "sk";

export interface Thread {
  id: string;
  account_id: string;
  user_id: string;
  thread_key: string | null;
  subject: string | null;
  participants: string[];
  last_message_at: string | null;
  message_count: number;
  category: ThreadCategory | null;
  category_confidence: number | null;
  summary: string | null;
  key_facts: string[];
  language: ThreadLanguage | null;
  priority: ThreadPriority | null;
  has_attachments: boolean;
  is_read: boolean;
  is_archived: boolean;
  created_at: string;
}

// ----- Message
export interface Message {
  id: string;
  thread_id: string;
  account_id: string;
  user_id: string;
  external_id: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  refs: string[];
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  is_outgoing: boolean;
  created_at: string;
}

// ----- Attachment
export interface Attachment {
  id: string;
  message_id: string;
  thread_id: string;
  user_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  extracted_text: string | null;
  extracted_at: string | null;
  ocr_used: boolean;
  created_at: string;
}

// ----- Action
export type ActionType = "reply_draft" | "document_qa" | "summary";

export interface Action {
  id: string;
  thread_id: string;
  attachment_id: string | null;
  user_id: string;
  type: ActionType;
  prompt: string | null;
  result: string | null;
  language: string | null;
  status: "draft" | "sent" | "discarded";
  created_at: string;
}

// ----- Composite
export interface ThreadDetail extends Thread {
  account: Account;
  messages: Message[];
  attachments: Attachment[];
}

export const categoryLabels: Record<ThreadCategory, string> = {
  contract: "Smlouvy",
  demand: "Výzvy",
  request: "Žádosti",
  invoice: "Faktury",
  client: "Klienti",
  internal: "Interní",
  other: "Ostatní",
};

export const priorityLabels: Record<ThreadPriority, string> = {
  high: "Vysoká",
  normal: "Normální",
  low: "Nízká",
};

// ===== DATOVKA MODULE =====

export interface DatovkaMailbox {
  id: string;
  user_id: string;
  name: string;
  id_ds: string | null;
  ico: string | null;
  notes: string | null;
  live_access_enabled?: boolean | null;
  is_test?: boolean | null;
  sync_days?: number | null;
  sync_limit?: number | null;
  sync_status?: string | null;
  sync_error?: string | null;
  last_sync_at?: string | null;
  password_expires_at?: string | null;
  live_info?: any;
  created_at: string;
}

export type DatovkaInstitution = 'court' | 'executor' | 'regulator' | 'authority' | 'tax' | 'ministry' | 'other';
export type DatovkaSubmission = 'lawsuit' | 'ruling' | 'demand' | 'notice' | 'invoice' | 'decision' | 'other';

export interface DatovkaMessage {
  id: string;
  user_id: string;
  mailbox_id: string | null;
  dm_id: string | null;
  sender_name: string | null;
  sender_id_ds: string | null;
  sender_ico: string | null;
  recipient_name: string | null;
  recipient_id_ds: string | null;
  subject: string | null;
  delivered_at: string | null;
  accepted_at: string | null;
  institution_type: DatovkaInstitution | null;
  submission_type: DatovkaSubmission | null;
  case_number: string | null;
  priority: 'high' | 'normal' | 'low' | null;
  language: string | null;
  summary: string | null;
  key_facts: string[];
  deadline_date: string | null;
  deadline_text: string | null;
  content_preview: string | null;
  full_text: string | null;
  original_filename: string | null;
  storage_path: string | null;
  file_kind: 'zfo' | 'pdf' | null;
  is_processed: boolean;
  is_archived: boolean;
  processing_error: string | null;
  created_at: string;
}

export interface DatovkaAttachment {
  id: string;
  message_id: string;
  user_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  extracted_text: string | null;
  ocr_used: boolean;
  created_at: string;
}

export const insertDatovkaMailboxSchema = z.object({
  name: z.string().min(1),
  id_ds: z.string().optional().nullable(),
  ico: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  live_access_enabled: z.boolean().optional().nullable(),
  is_test: z.boolean().optional().nullable(),
  login: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  sync_days: z.coerce.number().int().min(1).max(365).optional().nullable(),
  sync_limit: z.coerce.number().int().min(1).max(1000).optional().nullable(),
});
export type InsertDatovkaMailbox = z.infer<typeof insertDatovkaMailboxSchema>;

export const datovkaInstitutionLabels: Record<DatovkaInstitution, string> = {
  court: 'Soud',
  executor: 'Exekutor',
  regulator: 'Regulátor',
  authority: 'Úřad',
  tax: 'Finanční úřad',
  ministry: 'Ministerstvo',
  other: 'Jiný',
};

export const datovkaSubmissionLabels: Record<DatovkaSubmission, string> = {
  lawsuit: 'Žaloba',
  ruling: 'Usnesení/Rozsudek',
  demand: 'Výzva',
  notice: 'Oznámení',
  invoice: 'Faktura',
  decision: 'Rozhodnutí',
  other: 'Jiný',
};
