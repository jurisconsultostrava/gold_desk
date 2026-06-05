// Supabase-backed storage. Replaces the SQLite template storage entirely.
import { supabase } from "./supabase";
import { config } from "./config";
import { shouldExcludeAddress, shouldExcludeSubject } from "./filters";
import type {
  Account,
  Thread,
  Message,
  Attachment,
  Action,
} from "@shared/schema";

const USER = () => config.userId;

const THREAD_CATEGORY_KEYS = [
  "contract",
  "demand",
  "request",
  "invoice",
  "client",
  "internal",
  "other",
] as const;

function filterByAccountRules(threads: Thread[], account: Account | null): Thread[] {
  if (!account) return threads;
  const excludedAddresses = account.excluded_addresses || [];
  const excludedSubjects = account.excluded_subjects || [];
  if (excludedAddresses.length === 0 && excludedSubjects.length === 0) return threads;
  return threads.filter((t) => {
    if (shouldExcludeSubject(t.subject, excludedSubjects)) return false;
    const participants = t.participants || [];
    // Exclude only if EVERY participant matches an excluded address (so we don't drop
    // threads where multiple parties are involved and only one is excluded).
    if (participants.length > 0 && participants.every((p) => shouldExcludeAddress(p, excludedAddresses))) {
      return false;
    }
    // Or, common case: a single sender that matches an excluded address.
    if (participants.length === 1 && shouldExcludeAddress(participants[0], excludedAddresses)) {
      return false;
    }
    return true;
  });
}

export const storage = {
  async listAccounts(): Promise<Account[]> {
    const s = supabase();
    if (!s) return [];
    const { data, error } = await s
      .from("accounts")
      .select("*")
      .eq("user_id", USER())
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as Account[]) || [];
  },

  async getAccount(id: string): Promise<Account | null> {
    const s = supabase();
    if (!s) return null;
    const { data, error } = await s
      .from("accounts")
      .select("*")
      .eq("user_id", USER())
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Account) || null;
  },

  async createAccount(row: Partial<Account>): Promise<Account> {
    const s = supabase();
    if (!s) throw new Error("Supabase není nakonfigurováno");
    const { data, error } = await s
      .from("accounts")
      .insert([{ ...row, user_id: USER() }])
      .select("*")
      .single();
    if (error) throw error;
    return data as Account;
  },

  async updateAccount(id: string, patch: Partial<Account>): Promise<void> {
    const s = supabase();
    if (!s) return;
    const { error } = await s
      .from("accounts")
      .update(patch)
      .eq("user_id", USER())
      .eq("id", id);
    if (error) throw error;
  },

  async deleteAccount(id: string): Promise<void> {
    const s = supabase();
    if (!s) return;
    const { error } = await s
      .from("accounts")
      .delete()
      .eq("user_id", USER())
      .eq("id", id);
    if (error) throw error;
  },

  async listThreads(opts: {
    accountId?: string;
    category?: string;
    q?: string;
    unread?: boolean;
    highPriority?: boolean;
    withAttachments?: boolean;
    archived?: boolean;
  }): Promise<Thread[]> {
    const s = supabase();
    if (!s) return [];
    let q = s
      .from("threads")
      .select("*")
      .eq("user_id", USER())
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (opts.accountId) q = q.eq("account_id", opts.accountId);
    if (opts.category) q = q.eq("category", opts.category);
    if (opts.unread) q = q.eq("is_read", false);
    if (opts.highPriority) q = q.eq("priority", "high");
    if (opts.withAttachments) q = q.eq("has_attachments", true);
    if (typeof opts.archived === "boolean") q = q.eq("is_archived", opts.archived);
    if (opts.q) q = q.ilike("subject", `%${opts.q}%`);
    const { data, error } = await q;
    if (error) throw error;
    let threads = (data as Thread[]) || [];

    // Apply per-account exclusion rules on the server.
    if (opts.accountId) {
      const account = await this.getAccount(opts.accountId);
      threads = filterByAccountRules(threads, account);
    } else {
      // No account filter — group by account_id, apply each account's rules.
      const accountIds = Array.from(new Set(threads.map((t) => t.account_id).filter(Boolean)));
      if (accountIds.length > 0) {
        const accounts = await Promise.all(accountIds.map((id) => this.getAccount(id)));
        const byId = new Map(accounts.filter(Boolean).map((a) => [a!.id, a!]));
        threads = threads.filter((t) => {
          const acc = byId.get(t.account_id);
          return filterByAccountRules([t], acc || null).length === 1;
        });
      }
    }
    return threads;
  },

  /**
   * Returns counts of (non-archived) threads per category for a given account,
   * with per-account exclusion rules applied.
   */
  async categoryCountsForAccount(accountId: string): Promise<Record<string, number>> {
    const s = supabase();
    const empty: Record<string, number> = { all: 0 };
    for (const k of THREAD_CATEGORY_KEYS) empty[k] = 0;
    if (!s) return empty;
    const account = await this.getAccount(accountId);
    if (!account) return empty;
    const { data, error } = await s
      .from("threads")
      .select("id, category, subject, participants, account_id, is_archived")
      .eq("user_id", USER())
      .eq("account_id", accountId)
      .eq("is_archived", false)
      .limit(5000);
    if (error) throw error;
    const filtered = filterByAccountRules((data as Thread[]) || [], account);
    const counts: Record<string, number> = { all: filtered.length };
    for (const k of THREAD_CATEGORY_KEYS) counts[k] = 0;
    for (const t of filtered) {
      const cat = (t.category && THREAD_CATEGORY_KEYS.includes(t.category as any)) ? t.category : "other";
      counts[cat as string] = (counts[cat as string] || 0) + 1;
    }
    return counts;
  },

  async getThread(id: string): Promise<Thread | null> {
    const s = supabase();
    if (!s) return null;
    const { data, error } = await s
      .from("threads")
      .select("*")
      .eq("user_id", USER())
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Thread) || null;
  },

  async getMessagesByThread(threadId: string): Promise<Message[]> {
    const s = supabase();
    if (!s) return [];
    const { data, error } = await s
      .from("messages")
      .select("*")
      .eq("user_id", USER())
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true });
    if (error) throw error;
    return (data as Message[]) || [];
  },

  async getAttachmentsByThread(threadId: string): Promise<Attachment[]> {
    const s = supabase();
    if (!s) return [];
    const { data, error } = await s
      .from("attachments")
      .select("*")
      .eq("user_id", USER())
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Attachment[]) || [];
  },

  async getAttachment(id: string): Promise<Attachment | null> {
    const s = supabase();
    if (!s) return null;
    const { data, error } = await s
      .from("attachments")
      .select("*")
      .eq("user_id", USER())
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data as Attachment) || null;
  },

  async upsertThread(row: Partial<Thread>): Promise<Thread> {
    const s = supabase();
    if (!s) throw new Error("Supabase není nakonfigurováno");
    const { data, error } = await s
      .from("threads")
      .upsert([{ ...row, user_id: USER() }], { onConflict: "account_id,thread_key" })
      .select("*")
      .single();
    if (error) throw error;
    return data as Thread;
  },

  async updateThread(id: string, patch: Partial<Thread>): Promise<void> {
    const s = supabase();
    if (!s) return;
    const { error } = await s
      .from("threads")
      .update(patch)
      .eq("user_id", USER())
      .eq("id", id);
    if (error) throw error;
  },

  async insertMessage(row: Partial<Message>): Promise<Message> {
    const s = supabase();
    if (!s) throw new Error("Supabase není nakonfigurováno");
    const { data, error } = await s
      .from("messages")
      .upsert([{ ...row, user_id: USER() }], { onConflict: "account_id,external_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data as Message;
  },

  async insertAttachment(row: Partial<Attachment>): Promise<Attachment> {
    const s = supabase();
    if (!s) throw new Error("Supabase není nakonfigurováno");
    const { data, error } = await s
      .from("attachments")
      .insert([{ ...row, user_id: USER() }])
      .select("*")
      .single();
    if (error) throw error;
    return data as Attachment;
  },

  async insertAction(row: Partial<Action>): Promise<Action> {
    const s = supabase();
    if (!s) throw new Error("Supabase není nakonfigurováno");
    const { data, error } = await s
      .from("actions")
      .insert([{ ...row, user_id: USER() }])
      .select("*")
      .single();
    if (error) throw error;
    return data as Action;
  },

  async listActionsByThread(threadId: string): Promise<Action[]> {
    const s = supabase();
    if (!s) return [];
    const { data, error } = await s
      .from("actions")
      .select("*")
      .eq("user_id", USER())
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as Action[]) || [];
  },
};
