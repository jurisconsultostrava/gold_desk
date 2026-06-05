// Microsoft Graph OAuth + Mail sync skeleton.
// Note: requires MS_CLIENT_ID/MS_CLIENT_SECRET in env. If not configured, endpoints return 503.

import { config } from "../config";
import { storage } from "../storage";
import { encrypt, decrypt } from "../crypto";
import type { Account } from "@shared/schema";
import { classifyThreadAsync } from "./imap";
import { deriveThreadKey } from "../threading";
import { supabase } from "../supabase";
import { shouldExcludeAddress, shouldExcludeSubject } from "../filters";

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = ["offline_access", "Mail.Read", "Mail.Send", "User.Read"];

export function buildOutlookAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: config.microsoft.redirectUri,
    scope: SCOPES.join(" "),
    state,
    response_mode: "query",
  });
  return `${AUTH}/authorize?${params.toString()}`;
}

export async function exchangeOutlookCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  account: { email: string; name: string };
}> {
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    code,
    redirect_uri: config.microsoft.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Outlook token exchange selhal: ${res.status} ${await res.text()}`);
  const tok: any = await res.json();
  // get user info
  const me = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
  return {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_in: tok.expires_in,
    account: { email: me.mail || me.userPrincipalName, name: me.displayName || me.userPrincipalName },
  };
}

async function refreshOutlookToken(account: Account): Promise<string> {
  const rt = decrypt(account.oauth_refresh_token_enc || "");
  const body = new URLSearchParams({
    client_id: config.microsoft.clientId,
    client_secret: config.microsoft.clientSecret,
    refresh_token: rt,
    grant_type: "refresh_token",
    scope: SCOPES.join(" "),
  });
  const res = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Outlook refresh selhal: ${res.status}`);
  const tok: any = await res.json();
  await storage.updateAccount(account.id, {
    oauth_access_token_enc: encrypt(tok.access_token),
    oauth_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    ...(tok.refresh_token ? { oauth_refresh_token_enc: encrypt(tok.refresh_token) } : {}),
  });
  return tok.access_token;
}

async function getOutlookAccessToken(account: Account): Promise<string> {
  if (account.oauth_access_token_enc && account.oauth_expires_at) {
    if (new Date(account.oauth_expires_at).getTime() - 60_000 > Date.now()) {
      return decrypt(account.oauth_access_token_enc);
    }
  }
  return refreshOutlookToken(account);
}

export async function syncOutlookAccount(account: Account): Promise<{ fetched: number }> {
  const token = await getOutlookAccessToken(account);
  // Build date filter for Graph API if sync_since_date is set
  const sinceDate = account.sync_since_date
    ? new Date(account.sync_since_date).toISOString()
    : new Date(Date.now() - 90 * 86400000).toISOString();
  const dateFilter = encodeURIComponent(`receivedDateTime ge ${sinceDate}`);
  const url = `${GRAPH}/me/mailFolders/Inbox/messages?$top=100&$orderby=receivedDateTime desc&$expand=attachments&$filter=${dateFilter}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph fetch selhal: ${res.status}`);
  const data: any = await res.json();
  const items: any[] = data.value || [];
  let fetched = 0;
  let skipped = 0;
  const s = supabase()!;
  for (const m of items) {
    try {
      // Apply address filter
      const fromAddress = m.from?.emailAddress?.address || null;
      if (shouldExcludeAddress(fromAddress, account.excluded_addresses)) {
        skipped++;
        continue;
      }
      // Apply subject filter
      if (shouldExcludeSubject(m.subject, account.excluded_subjects)) {
        skipped++;
        continue;
      }

      const externalId = m.internetMessageId || m.id;
      const { data: exists } = await s
        .from("messages")
        .select("id")
        .eq("account_id", account.id)
        .eq("external_id", externalId)
        .maybeSingle();
      if (exists) continue;
      const threadKey = m.conversationId || deriveThreadKey({ messageId: m.internetMessageId, subject: m.subject });
      const sentAt = m.receivedDateTime || new Date().toISOString();
      const thread = await storage.upsertThread({
        account_id: account.id,
        thread_key: threadKey,
        subject: m.subject || "(bez předmětu)",
        last_message_at: sentAt,
        has_attachments: !!m.hasAttachments,
      });
      const toAddresses = (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean);
      const ccAddresses = (m.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean);
      const msg = await storage.insertMessage({
        thread_id: thread.id,
        account_id: account.id,
        external_id: externalId,
        message_id_header: m.internetMessageId || null,
        from_address: m.from?.emailAddress?.address || null,
        from_name: m.from?.emailAddress?.name || null,
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        subject: m.subject || null,
        body_text: m.bodyPreview || stripHtml(m.body?.content || ""),
        body_html: m.body?.content || null,
        sent_at: sentAt,
        is_outgoing: false,
      });
      fetched++;
      // attachments
      const atts = (m.attachments || []).filter((a: any) => a["@odata.type"]?.includes("fileAttachment"));
      for (const att of atts) {
        try {
          const buf = Buffer.from(att.contentBytes || "", "base64");
          const filename = att.name || `attachment-${Date.now()}`;
          const storagePath = `${account.id}/${thread.id}/${msg.id}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          await s.storage.from(config.supabase.bucket).upload(storagePath, buf, {
            contentType: att.contentType || "application/octet-stream",
            upsert: true,
          });
          const { extractText } = await import("../extract");
          const { text, ocrUsed } = await extractText(filename, att.contentType || "", buf);
          await storage.insertAttachment({
            message_id: msg.id,
            thread_id: thread.id,
            filename,
            mime_type: att.contentType || null,
            size_bytes: att.size || buf.length,
            storage_path: storagePath,
            extracted_text: text || null,
            extracted_at: text ? new Date().toISOString() : null,
            ocr_used: ocrUsed,
          });
        } catch (e: any) {
          console.error("outlook attachment error", e?.message || e);
        }
      }
      await s
        .from("threads")
        .update({
          participants: Array.from(new Set([m.from?.emailAddress?.address, ...toAddresses, ...ccAddresses].filter(Boolean))),
          message_count: (thread.message_count || 0) + 1,
          last_message_at: sentAt,
        })
        .eq("id", thread.id);
      if (!thread.category) classifyThreadAsync(thread.id).catch(() => {});
    } catch (e: any) {
      console.error("outlook ingest err", e?.message || e);
    }
  }
  if (skipped > 0) console.log(`Outlook sync: skipped ${skipped} messages (address/subject filters)`);
  return { fetched };
}

export async function outlookSendMail(account: Account, to: string[], subject: string, body: string): Promise<void> {
  const token = await getOutlookAccessToken(account);
  const res = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "Text", content: body },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail selhal: ${res.status} ${await res.text()}`);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
