import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../supabase";
import { config } from "../config";
import { decrypt } from "../crypto";
import { parseZfo } from "./zfo-parser";
import { extractAttachmentText } from "./extract";
import { classifyDatovkaMessage } from "./ai";

type BridgePayload = Record<string, any>;

export interface DataboxCredentials {
  username: string;
  password: string;
  is_test?: boolean;
  days?: number;
  limit?: number;
}

function appRoot(): string {
  return process.cwd();
}

function bridgePath(): string {
  return process.env.DATABOX_BRIDGE_PATH || path.join(appRoot(), "scripts", "databox_bridge.php");
}

export function databoxBridgeConfigured(): boolean {
  // Runtime check is intentionally light; PHP/composer errors are reported by the test endpoint.
  return true;
}

async function runBridge(payload: BridgePayload, timeoutMs = 120_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const php = process.env.PHP_BINARY || "php";
    const child = spawn(php, [bridgePath()], {
      cwd: appRoot(),
      env: {
        ...process.env,
        ISDS_CACHE_DIR: process.env.ISDS_CACHE_DIR || path.join(appRoot(), ".isds-cache"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ISDS bridge timeout po ${Math.round(timeoutMs / 1000)} s.`));
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Nelze spustit PHP bridge: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      let parsed: any = null;
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed.split(/\r?\n/).pop() || trimmed);
        } catch (e: any) {
          return reject(new Error(`ISDS bridge nevrátil validní JSON. STDOUT: ${trimmed.slice(0, 1000)} STDERR: ${stderr.slice(0, 1000)}`));
        }
      }
      if (code !== 0 || parsed?.ok === false) {
        return reject(new Error(parsed?.error || stderr || `ISDS bridge skončil s kódem ${code}.`));
      }
      resolve(parsed);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function testDataboxCredentials(input: DataboxCredentials): Promise<any> {
  return runBridge({
    command: "test",
    username: input.username,
    password: input.password,
    is_test: !!input.is_test,
  }, 60_000);
}

async function uploadBuffer(bucket: string, storagePath: string, buffer: Buffer, contentType = "application/octet-stream") {
  const sb = supabase();
  if (!sb) throw new Error("Supabase není nakonfigurovaný.");
  const { error } = await sb.storage.from(bucket).upload(storagePath, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/\0<>:"|?*]+/g, "_").slice(0, 180) || "soubor";
}

function bufferFromBase64(s: string | null | undefined): Buffer | null {
  if (!s) return null;
  try {
    return Buffer.from(s, "base64");
  } catch {
    return null;
  }
}

async function saveLiveMessage(mailbox: any, item: any, direction: "received" | "sent") {
  const sb = supabase();
  if (!sb) throw new Error("Supabase není nakonfigurovaný.");
  const bucket = "datovka-files";
  const dmId = item.dm_id ? String(item.dm_id) : null;
  if (!dmId) return { skipped: true, reason: "missing_dm_id" };

  const exists = await sb
    .from("datovka_messages")
    .select("id")
    .eq("user_id", config.userId)
    .eq("mailbox_id", mailbox.id)
    .eq("dm_id", dmId)
    .maybeSingle();
  if (exists.data?.id) return { skipped: true, reason: "already_exists", id: exists.data.id };

  let originalFilename = `${dmId}_${direction}.zfo`;
  let originalStoragePath: string | null = null;
  let fullText = "";
  let parsedMeta: Record<string, any> = {};
  const signed = item.signed_message;
  const signedBuf = bufferFromBase64(signed?.content_base64);
  if (signedBuf) {
    originalFilename = sanitizeFilename(signed.filename || originalFilename);
    originalStoragePath = `${config.userId}/live/${mailbox.id}/${Date.now()}_${originalFilename}`;
    await uploadBuffer(bucket, originalStoragePath, signedBuf, "application/octet-stream");
    try {
      const parsed = await parseZfo(signedBuf);
      parsedMeta = parsed.metadata as Record<string, any>;
      for (const att of parsed.attachments || []) {
        const extracted = await extractAttachmentText(att.filename, att.mimeType || "application/octet-stream", att.data);
        fullText += extracted.text + "\n";
      }
    } catch (e: any) {
      // Some ISDS signed messages may not parse in our lightweight parser. We still store envelope and attachments.
      console.warn(`[datovka/live] ZFO parse failed for ${dmId}:`, e?.message || e);
    }
  }

  const savedAttachments: Array<{ filename: string; storagePath: string; mimeType: string; sizeBytes: number; extractedText: string; ocrUsed: boolean }> = [];
  for (const att of item.attachments || []) {
    const buf = bufferFromBase64(att.content_base64);
    if (!buf) continue;
    const filename = sanitizeFilename(att.filename || `priloha_${savedAttachments.length + 1}`);
    const mimeType = att.mime_type || "application/octet-stream";
    const extracted = await extractAttachmentText(filename, mimeType, buf);
    fullText += extracted.text + "\n";
    const storagePath = `${config.userId}/live/${mailbox.id}/att_${Date.now()}_${filename}`;
    await uploadBuffer(bucket, storagePath, buf, mimeType);
    savedAttachments.push({ filename, storagePath, mimeType, sizeBytes: buf.length, extractedText: extracted.text, ocrUsed: extracted.ocrUsed });
  }

  const subject = parsedMeta.subject || item.subject || originalFilename;
  const sender = parsedMeta.sender_name || item.sender_name || "";
  const classification = await classifyDatovkaMessage({
    subject,
    sender,
    fullText: fullText.trim(),
    deliveredAt: parsedMeta.delivered_at || item.delivered_at,
  });

  const { data: msg, error: msgErr } = await sb
    .from("datovka_messages")
    .insert({
      user_id: config.userId,
      mailbox_id: mailbox.id,
      dm_id: dmId,
      sender_name: parsedMeta.sender_name || item.sender_name || null,
      sender_id_ds: parsedMeta.sender_id_ds || item.sender_id_ds || null,
      sender_ico: parsedMeta.sender_ico || item.sender_ico || null,
      recipient_name: parsedMeta.recipient_name || item.recipient_name || null,
      recipient_id_ds: parsedMeta.recipient_id_ds || item.recipient_id_ds || null,
      subject,
      delivered_at: parsedMeta.delivered_at || item.delivered_at || null,
      accepted_at: parsedMeta.accepted_at || item.accepted_at || null,
      institution_type: classification.institution_type,
      submission_type: classification.submission_type,
      case_number: classification.case_number,
      priority: classification.priority,
      language: "cs",
      summary: classification.summary,
      key_facts: classification.key_facts,
      deadline_date: classification.deadline_date,
      deadline_text: classification.deadline_text,
      content_preview: fullText.trim().slice(0, 500),
      full_text: fullText.trim(),
      original_filename: originalFilename,
      storage_path: originalStoragePath,
      file_kind: "zfo",
      is_processed: true,
      processing_error: null,
    })
    .select()
    .single();
  if (msgErr) throw new Error(`DB insert failed: ${msgErr.message}`);

  for (const att of savedAttachments) {
    await sb.from("datovka_attachments").insert({
      message_id: msg.id,
      user_id: config.userId,
      filename: att.filename,
      mime_type: att.mimeType,
      size_bytes: att.sizeBytes,
      storage_path: att.storagePath,
      extracted_text: att.extractedText,
      ocr_used: att.ocrUsed,
    });
  }

  return { inserted: true, id: msg.id };
}

export async function syncDataboxMailbox(mailboxId: string, opts: { days?: number; limit?: number; direction?: "received" | "sent" } = {}) {
  const sb = supabase();
  if (!sb) throw new Error("Supabase není nakonfigurovaný.");
  const { data: mailbox, error } = await sb
    .from("datovka_mailboxes")
    .select("*")
    .eq("id", mailboxId)
    .eq("user_id", config.userId)
    .single();
  if (error || !mailbox) throw new Error("Datová schránka nenalezena.");
  if (!mailbox.login_enc || !mailbox.password_enc) {
    throw new Error("Schránka nemá uložené přístupové údaje k ISDS.");
  }

  const username = decrypt(mailbox.login_enc);
  const password = decrypt(mailbox.password_enc);
  const days = Number(opts.days || mailbox.sync_days || 90);
  const limit = Number(opts.limit || mailbox.sync_limit || 100);
  const direction = opts.direction || "received";

  await sb.from("datovka_mailboxes").update({ sync_status: "syncing", sync_error: null }).eq("id", mailboxId);

  try {
    const result = await runBridge({
      command: direction,
      username,
      password,
      is_test: !!mailbox.is_test,
      days,
      limit,
      download: true,
    }, Math.max(120_000, limit * 10_000));

    let inserted = 0;
    let skipped = 0;
    const errors: Array<{ dm_id?: string; error: string }> = [];
    for (const item of result.messages || []) {
      try {
        const saved = await saveLiveMessage(mailbox, item, direction);
        if ((saved as any).inserted) inserted += 1;
        else skipped += 1;
      } catch (e: any) {
        errors.push({ dm_id: item.dm_id, error: e?.message || String(e) });
      }
    }

    await sb.from("datovka_mailboxes").update({
      sync_status: errors.length ? "warning" : "idle",
      sync_error: errors.length ? `${errors.length} zpráv se nepodařilo uložit.` : null,
      last_sync_at: new Date().toISOString(),
    }).eq("id", mailboxId);

    return { ok: true, fetched: result.count || 0, inserted, skipped, errors };
  } catch (e: any) {
    await sb.from("datovka_mailboxes").update({
      sync_status: "error",
      sync_error: e?.message || String(e),
    }).eq("id", mailboxId);
    throw e;
  }
}
