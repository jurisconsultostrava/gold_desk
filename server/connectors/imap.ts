// IMAP connector — fetches recent messages, parses, stores threads/messages/attachments.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { storage } from "../storage";
import { decrypt } from "../crypto";
import { extractText } from "../extract";
import { deriveThreadKey, normalizeSubject } from "../threading";
import { supabase } from "../supabase";
import { config } from "../config";
import type { Account } from "@shared/schema";
import { classifyThread } from "../ai";
import { shouldExcludeAddress, shouldExcludeSubject } from "../filters";

const SINCE_DAYS = 90;
const MAX_MESSAGES = 200;

export async function testImapConnection(opts: {
  host: string;
  port: number;
  email: string;
  password: string;
  useTls: boolean;
}): Promise<void> {
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: opts.useTls,
    auth: { user: opts.email, pass: opts.password },
    logger: false,
  });
  await client.connect();
  await client.logout();
}

export async function syncImapAccount(account: Account): Promise<{ fetched: number }> {
  if (!account.imap_host || !account.imap_password_enc) {
    throw new Error("Účet nemá nakonfigurované IMAP přihlášení.");
  }
  const password = decrypt(account.imap_password_enc);
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: account.imap_use_tls !== false,
    auth: { user: account.email, pass: password },
    logger: false,
  });
  await client.connect();
  let fetched = 0;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Use account-level start date if set, otherwise fall back to SINCE_DAYS default
      const since = account.sync_since_date
        ? new Date(account.sync_since_date)
        : new Date(Date.now() - SINCE_DAYS * 86400000);
      // limit to MAX_MESSAGES newest
      const search = await client.search({ since });
      const uids = (search || []).slice(-MAX_MESSAGES);
      let skipped = 0;
      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(uid, { source: true, envelope: true, uid: true } as any);
          if (!msg || !msg.source) continue;
          const result = await ingestRfc822(account, msg.source as Buffer);
          if (result === "skipped") {
            skipped++;
          } else {
            fetched++;
          }
        } catch (e: any) {
          console.error("IMAP fetch error", uid, e?.message || e);
        }
      }
      if (skipped > 0) console.log(`IMAP sync: skipped ${skipped} messages (address/subject filters)`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return { fetched };
}

async function ingestRfc822(account: Account, source: Buffer): Promise<"ok" | "skipped"> {
  const parsed = await simpleParser(source);

  // Apply address filter
  const fromAddr0 = parsed.from?.value?.[0]?.address || null;
  if (shouldExcludeAddress(fromAddr0, account.excluded_addresses)) {
    return "skipped";
  }

  // Apply subject filter
  if (shouldExcludeSubject(parsed.subject, account.excluded_subjects)) {
    return "skipped";
  }

  const externalId = parsed.messageId || `${account.email}:${parsed.date?.toISOString()}:${parsed.subject}`;

  // Check if already exists
  const s = supabase();
  if (!s) throw new Error("Supabase missing");
  const { data: existing } = await s
    .from("messages")
    .select("id")
    .eq("account_id", account.id)
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing) return "skipped";

  const refsHeader = parsed.references;
  const refsArr: string[] = Array.isArray(refsHeader)
    ? refsHeader
    : refsHeader
      ? String(refsHeader).split(/\s+/).filter(Boolean)
      : [];
  const threadKey = deriveThreadKey({
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,
    references: refsArr,
    subject: parsed.subject,
  });

  const toAddresses = collectAddresses(parsed.to);
  const ccAddresses = collectAddresses(parsed.cc);
  const fromAddr = parsed.from?.value?.[0];

  // Upsert thread
  const sentAt = parsed.date?.toISOString() || new Date().toISOString();
  const thread = await storage.upsertThread({
    account_id: account.id,
    thread_key: threadKey,
    subject: parsed.subject || "(bez předmětu)",
    last_message_at: sentAt,
    has_attachments: (parsed.attachments || []).length > 0,
  });

  // Insert message
  const msgRow = await storage.insertMessage({
    thread_id: thread.id,
    account_id: account.id,
    external_id: externalId,
    message_id_header: parsed.messageId || null,
    in_reply_to: parsed.inReplyTo || null,
    refs: refsArr,
    from_address: fromAddr?.address || null,
    from_name: fromAddr?.name || null,
    to_addresses: toAddresses,
    cc_addresses: ccAddresses,
    subject: parsed.subject || null,
    body_text: parsed.text || null,
    body_html: typeof parsed.html === "string" ? parsed.html : null,
    sent_at: sentAt,
    is_outgoing: false,
  });

  // Attachments
  for (const att of parsed.attachments || []) {
    if (!att.content) continue;
    const filename = att.filename || `attachment-${Date.now()}`;
    const storagePath = `${account.id}/${thread.id}/${msgRow.id}/${sanitize(filename)}`;
    const { error: upErr } = await s.storage
      .from(config.supabase.bucket)
      .upload(storagePath, att.content as Buffer, {
        contentType: att.contentType || "application/octet-stream",
        upsert: true,
      });
    if (upErr) console.error("storage upload error", upErr.message);
    const { text, ocrUsed } = await extractText(filename, att.contentType || "", att.content as Buffer);
    await storage.insertAttachment({
      message_id: msgRow.id,
      thread_id: thread.id,
      filename,
      mime_type: att.contentType || null,
      size_bytes: att.size || (att.content as Buffer).length,
      storage_path: upErr ? null : storagePath,
      extracted_text: text || null,
      extracted_at: text ? new Date().toISOString() : null,
      ocr_used: ocrUsed,
    });
  }

  // Update thread aggregate fields
  const participants = Array.from(
    new Set(
      [fromAddr?.address, ...toAddresses, ...ccAddresses].filter(Boolean) as string[]
    )
  );
  await s
    .from("threads")
    .update({
      participants,
      message_count: (thread.message_count || 0) + 1,
      last_message_at: sentAt,
    })
    .eq("id", thread.id);

  // Trigger AI classification if not yet classified (fire-and-forget)
  if (!thread.category) {
    classifyThreadAsync(thread.id).catch((e) => console.error("classify failed", e));
  }
  return "ok" as const;
}

function collectAddresses(field: any): string[] {
  if (!field) return [];
  const arr = Array.isArray(field) ? field : [field];
  const out: string[] = [];
  for (const f of arr) {
    if (f?.value) for (const v of f.value) if (v?.address) out.push(v.address);
  }
  return out;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

async function classifyThreadAsync(threadId: string, provider?: string, model?: string) {
  const thread = await storage.getThread(threadId);
  if (!thread) return;
  const messages = await storage.getMessagesByThread(threadId);
  const attachments = await storage.getAttachmentsByThread(threadId);
  const text =
    `Předmět: ${thread.subject || ""}\n\n` +
    messages
      .slice(-20)
      .map(
        (m) =>
          `--- ${m.from_address || ""} → ${(m.to_addresses || []).join(", ")} (${m.sent_at || ""}) ---\n${(m.body_text || "").slice(0, 4000)}`
      )
      .join("\n\n") +
    "\n\n=== PŘÍLOHY ===\n" +
    attachments
      .map((a) => `* ${a.filename}: ${(a.extracted_text || "").slice(0, 2000)}`)
      .join("\n");
  try {
    const result = await classifyThread(text, { provider, model });
    await storage.updateThread(threadId, {
      category: result.category || null,
      category_confidence: typeof result.category_confidence === "number" ? result.category_confidence : null,
      summary: result.summary || null,
      key_facts: Array.isArray(result.key_facts) ? result.key_facts : [],
      language: result.language || null,
      priority: result.priority || "normal",
    } as any);
  } catch (e: any) {
    console.error("classify error", e?.message || e);
  }
}

export { classifyThreadAsync };
