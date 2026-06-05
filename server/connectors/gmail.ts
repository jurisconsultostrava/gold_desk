// Gmail OAuth + sync skeleton using googleapis.
import { google } from "googleapis";
import { config } from "../config";
import { storage } from "../storage";
import { encrypt, decrypt } from "../crypto";
import type { Account } from "@shared/schema";
import { classifyThreadAsync } from "./imap";
import { deriveThreadKey } from "../threading";
import { supabase } from "../supabase";
import { extractText } from "../extract";
import { shouldExcludeAddress, shouldExcludeSubject } from "../filters";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

function oauthClient() {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

export function buildGmailAuthUrl(state: string): string {
  const oauth2 = oauthClient();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeGmailCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  account: { email: string; name: string };
}> {
  const oauth2 = oauthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  const oauth2v2 = google.oauth2({ version: "v2", auth: oauth2 });
  const me = await oauth2v2.userinfo.get();
  return {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token!,
    expires_in: tokens.expiry_date ? Math.max(60, Math.round((tokens.expiry_date - Date.now()) / 1000)) : 3600,
    account: { email: me.data.email!, name: me.data.name || me.data.email! },
  };
}

async function getGmailClient(account: Account) {
  const oauth2 = oauthClient();
  oauth2.setCredentials({
    refresh_token: decrypt(account.oauth_refresh_token_enc || ""),
    access_token: account.oauth_access_token_enc ? decrypt(account.oauth_access_token_enc) : undefined,
    expiry_date: account.oauth_expires_at ? new Date(account.oauth_expires_at).getTime() : undefined,
  });
  oauth2.on("tokens", async (t) => {
    if (t.refresh_token) {
      await storage.updateAccount(account.id, { oauth_refresh_token_enc: encrypt(t.refresh_token) });
    }
    if (t.access_token) {
      await storage.updateAccount(account.id, {
        oauth_access_token_enc: encrypt(t.access_token),
        oauth_expires_at: t.expiry_date ? new Date(t.expiry_date).toISOString() : null,
      });
    }
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

export async function syncGmailAccount(account: Account): Promise<{ fetched: number }> {
  const gmail = await getGmailClient(account);
  // Build date query: use sync_since_date if set, else default 90d
  let dateQuery: string;
  if (account.sync_since_date) {
    // Gmail search format: after:YYYY/MM/DD
    const d = new Date(account.sync_since_date);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    dateQuery = `after:${y}/${mo}/${da}`;
  } else {
    dateQuery = "newer_than:90d";
  }
  const list = await gmail.users.messages.list({ userId: "me", maxResults: 100, q: dateQuery });
  const ids = (list.data.messages || []).map((m) => m.id!).filter(Boolean);
  let fetched = 0;
  let skipped = 0;
  const s = supabase()!;
  for (const id of ids) {
    try {
      const { data: exists } = await s
        .from("messages")
        .select("id")
        .eq("account_id", account.id)
        .eq("external_id", id)
        .maybeSingle();
      if (exists) continue;
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const m = full.data;
      const headers = (m.payload?.headers || []).reduce<Record<string, string>>((acc, h) => {
        if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
        return acc;
      }, {});
      const subject = headers["subject"] || "(bez předmětu)";
      const fromHeader = headers["from"] || "";
      const fromMatch = fromHeader.match(/(.*?)\s*<(.+?)>/);
      const fromName = fromMatch ? fromMatch[1].trim().replace(/^"|"$/g, "") : "";
      const fromAddr = fromMatch ? fromMatch[2] : fromHeader.trim();

      // Apply address filter
      if (shouldExcludeAddress(fromAddr, account.excluded_addresses)) {
        skipped++;
        continue;
      }
      // Apply subject filter
      if (shouldExcludeSubject(subject, account.excluded_subjects)) {
        skipped++;
        continue;
      }
      const toAddresses = (headers["to"] || "").split(",").map((x) => extractEmail(x)).filter(Boolean) as string[];
      const ccAddresses = (headers["cc"] || "").split(",").map((x) => extractEmail(x)).filter(Boolean) as string[];
      const sentAt = m.internalDate ? new Date(parseInt(m.internalDate)).toISOString() : new Date().toISOString();
      const threadKey = m.threadId || deriveThreadKey({ messageId: headers["message-id"], subject });
      const thread = await storage.upsertThread({
        account_id: account.id,
        thread_key: threadKey,
        subject,
        last_message_at: sentAt,
        has_attachments: hasAttachments(m.payload),
      });
      const { text, html, attachments } = extractGmailParts(m.payload);
      const msg = await storage.insertMessage({
        thread_id: thread.id,
        account_id: account.id,
        external_id: id,
        message_id_header: headers["message-id"] || null,
        in_reply_to: headers["in-reply-to"] || null,
        from_address: fromAddr,
        from_name: fromName,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        subject,
        body_text: text || null,
        body_html: html || null,
        sent_at: sentAt,
        is_outgoing: false,
      });
      fetched++;
      for (const att of attachments) {
        try {
          const data = await gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: att.attachmentId });
          const buf = Buffer.from((data.data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
          const filename = att.filename || `attachment-${Date.now()}`;
          const storagePath = `${account.id}/${thread.id}/${msg.id}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          await s.storage.from(config.supabase.bucket).upload(storagePath, buf, { contentType: att.mimeType, upsert: true });
          const { text: extracted, ocrUsed } = await extractText(filename, att.mimeType, buf);
          await storage.insertAttachment({
            message_id: msg.id,
            thread_id: thread.id,
            filename,
            mime_type: att.mimeType,
            size_bytes: buf.length,
            storage_path: storagePath,
            extracted_text: extracted || null,
            extracted_at: extracted ? new Date().toISOString() : null,
            ocr_used: ocrUsed,
          });
        } catch (e: any) {
          console.error("gmail att err", e?.message || e);
        }
      }
      await s
        .from("threads")
        .update({
          participants: Array.from(new Set([fromAddr, ...toAddresses, ...ccAddresses].filter(Boolean))),
          message_count: (thread.message_count || 0) + 1,
          last_message_at: sentAt,
        })
        .eq("id", thread.id);
      if (!thread.category) classifyThreadAsync(thread.id).catch(() => {});
    } catch (e: any) {
      console.error("gmail ingest err", e?.message || e);
    }
  }
  if (skipped > 0) console.log(`Gmail sync: skipped ${skipped} messages (address/subject filters)`);
  return { fetched };
}

export async function gmailSendMail(account: Account, to: string[], subject: string, body: string): Promise<void> {
  const gmail = await getGmailClient(account);
  const raw = Buffer.from(
    `To: ${to.join(", ")}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`,
    "utf8"
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

function hasAttachments(p: any): boolean {
  if (!p) return false;
  if (p.filename && p.body?.attachmentId) return true;
  return (p.parts || []).some(hasAttachments);
}

function extractGmailParts(p: any): { text: string; html: string; attachments: any[] } {
  let text = "";
  let html = "";
  const attachments: any[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.mimeType === "text/plain" && part.body?.data) {
      text += Buffer.from(part.body.data, "base64").toString("utf8");
    }
    if (part.mimeType === "text/html" && part.body?.data) {
      html += Buffer.from(part.body.data, "base64").toString("utf8");
    }
    (part.parts || []).forEach(walk);
  };
  walk(p);
  return { text, html, attachments };
}

function extractEmail(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}
