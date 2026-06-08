import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  config,
  supabaseConfigured,
  encryptionConfigured,
  outlookConfigured,
  gmailConfigured,
} from "./config";
import { supabase } from "./supabase";
import { encrypt, decrypt } from "./crypto";
import { insertImapAccountSchema, updateAccountFiltersSchema, insertDatovkaMailboxSchema } from "@shared/schema";
import multer from "multer";
import { parseZfo } from "./datovka/zfo-parser";
import { extractAttachmentText } from "./datovka/extract";
import { classifyDatovkaMessage } from "./datovka/ai";
import { testDataboxCredentials, syncDataboxMailbox } from "./datovka/live-client";
import { testImapConnection, syncImapAccount, classifyThreadAsync } from "./connectors/imap";
import {
  buildOutlookAuthUrl,
  exchangeOutlookCode,
  syncOutlookAccount,
  outlookSendMail,
} from "./connectors/outlook";
import {
  buildGmailAuthUrl,
  exchangeGmailCode,
  syncGmailAccount,
  gmailSendMail,
} from "./connectors/gmail";
import { sendViaSmtp } from "./connectors/smtp";
import { aiConfigured, draftReply, documentQA, getAIConfigInfo } from "./ai";
import { BUILTIN_COMMUNICATION_TEMPLATES, analyzeCommunicationDocument, communicationGenerateSchema, generateCommunication } from "./communicator";
import { extractText } from "./extract";
import { anthropicConfigured, openaiConfigured, perplexityConfigured, geminiConfigured } from "./config";
import { appAuthEnabled, appAuthConfigured } from "./auth";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- Health / config status ----------
  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      supabase: supabaseConfigured(),
      encryption: encryptionConfigured(),
      outlook: outlookConfigured(),
      gmail: gmailConfigured(),
      databox_bridge: true,
      auth: { enabled: appAuthEnabled(), configured: appAuthConfigured() },
      ai: aiConfigured(),
      gemini: geminiConfigured(),
      anthropic: anthropicConfigured(),
      openai: openaiConfigured(),
      perplexity: perplexityConfigured(),
      user_id: config.userId,
      bucket: config.supabase.bucket,
    });
  });

  // ---------- AI konfigurace ----------
  app.get("/api/ai/config", (_req, res) => {
    res.json(getAIConfigInfo());
  });

  // ---------- Accounts ----------
  app.get("/api/accounts", asyncH(async (_req, res) => {
    res.json(await storage.listAccounts());
  }));

  app.post("/api/accounts", asyncH(async (req, res) => {
    requireEnc();
    requireSupabase();
    const data = insertImapAccountSchema.parse(req.body);
    // test connection first
    try {
      await testImapConnection({
        host: data.imap_host,
        port: data.imap_port,
        email: data.email,
        password: data.imap_password,
        useTls: data.imap_use_tls,
      });
    } catch (e: any) {
      return res.status(400).json({ message: `IMAP přihlášení selhalo: ${e?.message || e}` });
    }
    const account = await storage.createAccount({
      name: data.name,
      provider: "imap",
      email: data.email,
      imap_host: data.imap_host,
      imap_port: data.imap_port,
      imap_password_enc: encrypt(data.imap_password),
      imap_use_tls: data.imap_use_tls,
      smtp_host: data.smtp_host || null,
      smtp_port: data.smtp_port || null,
      smtp_password_enc: data.smtp_password ? encrypt(data.smtp_password) : null,
      sync_since_date: data.sync_since_date || null,
      excluded_addresses: data.excluded_addresses || [],
      excluded_subjects: data.excluded_subjects || [],
    });
    res.json(account);
  }));

  app.patch("/api/accounts/:id", asyncH(async (req, res) => {
    requireSupabase();
    const id = String(req.params.id);
    const account = await storage.getAccount(id);
    if (!account) return res.status(404).json({ message: "Účet nenalezen" });
    const data = updateAccountFiltersSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.sync_since_date !== undefined) patch.sync_since_date = data.sync_since_date ?? null;
    if (data.excluded_addresses !== undefined) patch.excluded_addresses = data.excluded_addresses;
    if (data.excluded_subjects !== undefined) patch.excluded_subjects = data.excluded_subjects;
    await storage.updateAccount(id, patch);
    const updated = await storage.getAccount(id);
    res.json(updated);
  }));

  app.delete("/api/accounts/:id", asyncH(async (req, res) => {
    await storage.deleteAccount(String(req.params.id));
    res.json({ ok: true });
  }));

  // Počty zpráv podle kategorií pro danou schránku
  app.get("/api/accounts/:id/category-counts", asyncH(async (req, res) => {
    requireSupabase();
    const accountId = String(req.params.id);
    const counts = await storage.categoryCountsForAccount(accountId);
    res.json(counts);
  }));

  // ---------- OAuth: Outlook ----------
  app.get("/api/auth/outlook/start", (req, res) => {
    if (!outlookConfigured()) return res.status(503).send("Outlook OAuth není nakonfigurováno (MS_CLIENT_ID/MS_CLIENT_SECRET).");
    const state = Math.random().toString(36).slice(2);
    res.redirect(buildOutlookAuthUrl(state));
  });

  app.get("/api/auth/outlook/callback", asyncH(async (req, res) => {
    if (!outlookConfigured()) return res.status(503).send("Outlook OAuth není nakonfigurováno.");
    requireSupabase();
    requireEnc();
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Chybí code.");
    const { access_token, refresh_token, expires_in, account } = await exchangeOutlookCode(code);
    await storage.createAccount({
      name: account.name || account.email,
      provider: "outlook",
      email: account.email,
      oauth_access_token_enc: encrypt(access_token),
      oauth_refresh_token_enc: encrypt(refresh_token),
      oauth_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    });
    res.redirect("/#/accounts");
  }));

  // ---------- OAuth: Gmail ----------
  app.get("/api/auth/gmail/start", (req, res) => {
    if (!gmailConfigured()) return res.status(503).send("Gmail OAuth není nakonfigurováno (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET).");
    const state = Math.random().toString(36).slice(2);
    res.redirect(buildGmailAuthUrl(state));
  });

  app.get("/api/auth/gmail/callback", asyncH(async (req, res) => {
    if (!gmailConfigured()) return res.status(503).send("Gmail OAuth není nakonfigurováno.");
    requireSupabase();
    requireEnc();
    const code = String(req.query.code || "");
    if (!code) return res.status(400).send("Chybí code.");
    const { access_token, refresh_token, expires_in, account } = await exchangeGmailCode(code);
    await storage.createAccount({
      name: account.name || account.email,
      provider: "gmail",
      email: account.email,
      oauth_access_token_enc: encrypt(access_token),
      oauth_refresh_token_enc: encrypt(refresh_token),
      oauth_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    });
    res.redirect("/#/accounts");
  }));

  // ---------- Sync ----------
  app.post("/api/accounts/:id/sync", asyncH(async (req, res) => {
    requireSupabase();
    const account = await storage.getAccount(String(req.params.id));
    if (!account) return res.status(404).json({ message: "Účet nenalezen" });
    await storage.updateAccount(account.id, { sync_status: "syncing", sync_error: null });
    res.json({ ok: true, status: "syncing" });
    // run sync in background
    (async () => {
      try {
        let result: { fetched: number } = { fetched: 0 };
        if (account.provider === "imap") result = await syncImapAccount(account);
        else if (account.provider === "outlook") result = await syncOutlookAccount(account);
        else if (account.provider === "gmail") result = await syncGmailAccount(account);
        await storage.updateAccount(account.id, {
          sync_status: "idle",
          sync_error: null,
          last_sync_at: new Date().toISOString(),
        });
        console.log(`sync done for ${account.email}: ${result.fetched} new`);
      } catch (e: any) {
        console.error("sync error", e?.message || e);
        await storage.updateAccount(account.id, {
          sync_status: "error",
          sync_error: String(e?.message || e),
        });
      }
    })();
  }));

  app.get("/api/accounts/:id/sync/status", asyncH(async (req, res) => {
    const account = await storage.getAccount(String(req.params.id));
    if (!account) return res.status(404).json({ message: "Účet nenalezen" });
    res.json({
      status: account.sync_status,
      error: account.sync_error,
      last_sync_at: account.last_sync_at,
    });
  }));

  // ---------- Threads ----------
  app.get("/api/threads", asyncH(async (req, res) => {
    const threads = await storage.listThreads({
      accountId: req.query.account_id as string | undefined,
      category: req.query.category as string | undefined,
      q: req.query.q as string | undefined,
      unread: req.query.unread === "1" || req.query.unread === "true",
      highPriority: req.query.priority === "high",
      withAttachments: req.query.attachments === "1",
      archived: req.query.archived === "1" ? true : req.query.archived === "0" ? false : undefined,
    });
    res.json(threads);
  }));

  app.get("/api/threads/:id", asyncH(async (req, res) => {
    const thread = await storage.getThread(String(req.params.id));
    if (!thread) return res.status(404).json({ message: "Vlákno nenalezeno" });
    const [messages, attachments, account, actions] = await Promise.all([
      storage.getMessagesByThread(thread.id),
      storage.getAttachmentsByThread(thread.id),
      thread.account_id ? storage.getAccount(thread.account_id) : null,
      storage.listActionsByThread(thread.id),
    ]);
    res.json({ ...thread, messages, attachments, account, actions });
  }));

  app.patch("/api/threads/:id", asyncH(async (req, res) => {
    const allowed: any = {};
    if (typeof req.body.is_read === "boolean") allowed.is_read = req.body.is_read;
    if (typeof req.body.is_archived === "boolean") allowed.is_archived = req.body.is_archived;
    await storage.updateThread(String(req.params.id), allowed);
    res.json({ ok: true });
  }));

  app.post("/api/threads/:id/resummarize", asyncH(async (req, res) => {
    classifyThreadAsync(String(req.params.id), req.body?.provider, req.body?.model).catch((e) => console.error(e));
    res.json({ ok: true, status: "queued" });
  }));

  // ---------- Drafts / replies ----------
  app.post("/api/threads/:id/draft-reply", asyncH(async (req, res) => {
    const thread = await storage.getThread(String(req.params.id));
    if (!thread) return res.status(404).json({ message: "Vlákno nenalezeno" });
    const messages = await storage.getMessagesByThread(thread.id);
    const attachments = await storage.getAttachmentsByThread(thread.id);
    const threadText = messages
      .slice(-20)
      .map((m) => `--- ${m.from_address}: ${m.sent_at} ---\n${(m.body_text || "").slice(0, 4000)}`)
      .join("\n\n");
    const attachmentsText = attachments
      .map((a) => `* ${a.filename}\n${(a.extracted_text || "").slice(0, 5000)}`)
      .join("\n\n");
    const result = await draftReply({
      language: thread.language || "cs",
      threadText,
      attachmentsText,
      instructions: req.body?.instructions,
      tone: req.body?.tone,
      provider: req.body?.provider,
      model: req.body?.model,
    });
    const action = await storage.insertAction({
      thread_id: thread.id,
      type: "reply_draft",
      prompt: req.body?.instructions || "",
      result,
      language: thread.language || "cs",
      status: "draft",
    });
    res.json(action);
  }));

  app.post("/api/threads/:id/send", asyncH(async (req, res) => {
    const thread = await storage.getThread(String(req.params.id));
    if (!thread) return res.status(404).json({ message: "Vlákno nenalezeno" });
    const account = await storage.getAccount(thread.account_id);
    if (!account) return res.status(404).json({ message: "Účet nenalezen" });
    const messages = await storage.getMessagesByThread(thread.id);
    const last = messages[messages.length - 1];
    const to: string[] = req.body?.to && Array.isArray(req.body.to)
      ? req.body.to
      : last?.from_address
        ? [last.from_address]
        : [];
    if (!to.length) return res.status(400).json({ message: "Chybí příjemce." });
    const subject = req.body?.subject || (thread.subject?.startsWith("Re:") ? thread.subject : `Re: ${thread.subject || ""}`);
    const body = req.body?.body || "";
    if (!body) return res.status(400).json({ message: "Prázdný text odpovědi." });

    if (account.provider === "imap") await sendViaSmtp(account, to, subject, body);
    else if (account.provider === "outlook") await outlookSendMail(account, to, subject, body);
    else if (account.provider === "gmail") await gmailSendMail(account, to, subject, body);

    // record outgoing message
    await storage.insertMessage({
      thread_id: thread.id,
      account_id: account.id,
      external_id: `out:${Date.now()}`,
      from_address: account.email,
      to_addresses: to,
      subject,
      body_text: body,
      sent_at: new Date().toISOString(),
      is_outgoing: true,
    });
    res.json({ ok: true });
  }));

  // ---------- Attachments ----------
  app.get("/api/attachments/:id/download", asyncH(async (req, res) => {
    const att = await storage.getAttachment(String(req.params.id));
    if (!att || !att.storage_path) return res.status(404).json({ message: "Příloha nenalezena" });
    const s = supabase();
    if (!s) return res.status(503).json({ message: "Supabase neni nakonfigurovano" });
    const { data, error } = await s.storage.from(config.supabase.bucket).createSignedUrl(att.storage_path, 300);
    if (error) return res.status(500).json({ message: error.message });
    res.json({ url: data.signedUrl, filename: att.filename });
  }));

  app.get("/api/attachments/:id/preview", asyncH(async (req, res) => {
    const att = await storage.getAttachment(String(req.params.id));
    if (!att) return res.status(404).json({ message: "Příloha nenalezena" });
    res.json({
      id: att.id,
      filename: att.filename,
      mime_type: att.mime_type,
      size_bytes: att.size_bytes,
      extracted_text: att.extracted_text || "",
      ocr_used: att.ocr_used,
      thread_id: att.thread_id,
    });
  }));

  app.post("/api/attachments/:id/qa", asyncH(async (req, res) => {
    const att = await storage.getAttachment(String(req.params.id));
    if (!att) return res.status(404).json({ message: "Příloha nenalezena" });
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ message: "Chybí otázka." });
    const answer = await documentQA(att.extracted_text || "", question, {
      provider: req.body?.provider,
      model: req.body?.model,
    });
    const action = await storage.insertAction({
      thread_id: att.thread_id,
      attachment_id: att.id,
      type: "document_qa",
      prompt: question,
      result: answer,
      status: "draft",
    });
    res.json(action);
  }));

  // ===== DATOVKA MODULE =====
  const datovkaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  });

  const DATOVKA_BUCKET = "datovka-files";

  function datovkaPublicColumns() {
    return "id,user_id,name,id_ds,ico,notes,live_access_enabled,is_test,sync_days,sync_limit,sync_status,sync_error,last_sync_at,password_expires_at,live_info,created_at";
  }

  function datovkaMailboxPatch(parsed: any, existing?: any): Record<string, any> {
    const patch: Record<string, any> = {};
    for (const k of ["name", "id_ds", "ico", "notes", "live_access_enabled", "is_test", "sync_days", "sync_limit"]) {
      if (parsed[k] !== undefined) patch[k] = parsed[k];
    }
    if (parsed.login !== undefined && String(parsed.login || "").trim()) {
      patch.login_enc = encrypt(String(parsed.login).trim());
      patch.live_access_enabled = parsed.live_access_enabled ?? true;
    }
    if (parsed.password !== undefined && String(parsed.password || "")) {
      patch.password_enc = encrypt(String(parsed.password));
      patch.live_access_enabled = parsed.live_access_enabled ?? true;
    }
    if (!existing && patch.live_access_enabled === undefined) patch.live_access_enabled = false;
    return patch;
  }

  // GET /api/datovka/mailboxes
  app.get("/api/datovka/mailboxes", asyncH(async (_req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { data, error } = await sb
      .from("datovka_mailboxes")
      .select(datovkaPublicColumns())
      .eq("user_id", config.userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  }));

  // POST /api/datovka/mailboxes
  app.post("/api/datovka/mailboxes", asyncH(async (req, res) => {
    requireSupabase();
    requireEnc();
    const parsed = insertDatovkaMailboxSchema.parse(req.body);
    const sb = supabase()!;
    const insert = { ...datovkaMailboxPatch(parsed), user_id: config.userId };
    const { data, error } = await sb
      .from("datovka_mailboxes")
      .insert(insert)
      .select(datovkaPublicColumns())
      .single();
    if (error) throw error;
    res.status(201).json(data);
  }));

  // PATCH /api/datovka/mailboxes/:id
  app.patch("/api/datovka/mailboxes/:id", asyncH(async (req, res) => {
    requireSupabase();
    requireEnc();
    const sb = supabase()!;
    const id = String(req.params.id);
    const parsed = insertDatovkaMailboxSchema.partial().parse(req.body);
    const { data: existing, error: fetchErr } = await sb
      .from("datovka_mailboxes")
      .select("*")
      .eq("id", id)
      .eq("user_id", config.userId)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ message: "Datová schránka nenalezena" });
    const patch = datovkaMailboxPatch(parsed, existing);
    const { data, error } = await sb
      .from("datovka_mailboxes")
      .update(patch)
      .eq("id", id)
      .eq("user_id", config.userId)
      .select(datovkaPublicColumns())
      .single();
    if (error) throw error;
    res.json(data);
  }));

  // POST /api/datovka/mailboxes/:id/test-live
  app.post("/api/datovka/mailboxes/:id/test-live", asyncH(async (req, res) => {
    requireSupabase();
    requireEnc();
    const sb = supabase()!;
    const id = String(req.params.id);
    const { data: mailbox, error } = await sb
      .from("datovka_mailboxes")
      .select("*")
      .eq("id", id)
      .eq("user_id", config.userId)
      .single();
    if (error || !mailbox) return res.status(404).json({ message: "Datová schránka nenalezena" });
    if (!mailbox.login_enc || !mailbox.password_enc) {
      return res.status(400).json({ message: "Nejdřív ulož login a heslo k ISDS." });
    }
    const result = await testDataboxCredentials({
      username: decrypt(mailbox.login_enc),
      password: decrypt(mailbox.password_enc),
      is_test: !!mailbox.is_test,
    });
    await sb.from("datovka_mailboxes").update({
      password_expires_at: result.password_expires_at || null,
      live_info: { owner: result.owner || null, user: result.user || null, tested_at: new Date().toISOString() },
      sync_error: null,
      sync_status: "idle",
    }).eq("id", id);
    res.json({ ok: true, password_expires_at: result.password_expires_at || null, owner: result.owner || null, user: result.user || null });
  }));

  // POST /api/datovka/mailboxes/:id/sync-live
  app.post("/api/datovka/mailboxes/:id/sync-live", asyncH(async (req, res) => {
    requireSupabase();
    requireEnc();
    const id = String(req.params.id);
    const days = req.body?.days ? Number(req.body.days) : undefined;
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    // For small manual syncs we return the result directly. Railway can run this request safely for common 10-100 message windows.
    const result = await syncDataboxMailbox(id, { days, limit, direction: "received" });
    res.json(result);
  }));

  // DELETE /api/datovka/mailboxes/:id
  app.delete("/api/datovka/mailboxes/:id", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { error } = await sb
      .from("datovka_mailboxes")
      .delete()
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId);
    if (error) throw error;
    res.json({ ok: true });
  }));

  // Mapování kategorie (UI slug) -> datovka submission_type hodnoty
  const DATOVKA_CATEGORY_MAP: Record<string, string[]> = {
    contract: [],
    demand: ["demand"],
    request: [],
    invoice: ["invoice"],
    client: [],
    internal: [],
    // "other" pokrývá všechny ostatní submission types + null
    other: ["lawsuit", "ruling", "notice", "decision", "other"],
  };
  const DATOVKA_CATEGORY_KEYS = ["contract", "demand", "request", "invoice", "client", "internal", "other"] as const;

  function datovkaCategoryOfMessage(submissionType: string | null | undefined): string {
    if (!submissionType) return "other";
    for (const k of DATOVKA_CATEGORY_KEYS) {
      if (DATOVKA_CATEGORY_MAP[k].includes(submissionType)) return k;
    }
    return "other";
  }

  // GET /api/datovka/messages
  app.get("/api/datovka/messages", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    let q = sb
      .from("datovka_messages")
      .select("*")
      .eq("user_id", config.userId)
      .eq("is_archived", false)
      .order("delivered_at", { ascending: false });

    if (req.query.mailbox_id) q = q.eq("mailbox_id", String(req.query.mailbox_id));
    if (req.query.institution) q = q.eq("institution_type", String(req.query.institution));
    if (req.query.priority) q = q.eq("priority", String(req.query.priority));
    if (req.query.from) q = q.gte("delivered_at", String(req.query.from));
    if (req.query.to) q = q.lte("delivered_at", String(req.query.to));
    if (req.query.q) {
      const term = `%${req.query.q}%`;
      q = q.or(`subject.ilike.${term},sender_name.ilike.${term},case_number.ilike.${term}`);
    }

    const { data, error } = await q;
    if (error) throw error;
    let rows = (data as any[]) || [];

    // Filtr podle kategorie (UI slug) — mapuje na submission_type hodnoty
    const category = typeof req.query.category === "string" ? req.query.category : "";
    if (category && (DATOVKA_CATEGORY_KEYS as readonly string[]).includes(category)) {
      rows = rows.filter((m) => datovkaCategoryOfMessage(m.submission_type) === category);
    }

    res.json(rows);
  }));

  // GET /api/datovka/mailboxes/:id/category-counts
  // (special-case id="all" — všechny schránky uživatele)
  app.get("/api/datovka/mailboxes/:id/category-counts", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const mailboxId = String(req.params.id);
    let q = sb
      .from("datovka_messages")
      .select("submission_type, is_archived, mailbox_id")
      .eq("user_id", config.userId)
      .eq("is_archived", false);
    if (mailboxId !== "all") q = q.eq("mailbox_id", mailboxId);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data as any[]) || [];
    const counts: Record<string, number> = { all: rows.length };
    for (const k of DATOVKA_CATEGORY_KEYS) counts[k] = 0;
    for (const r of rows) {
      const k = datovkaCategoryOfMessage(r.submission_type);
      counts[k] = (counts[k] || 0) + 1;
    }
    res.json(counts);
  }));

  // GET /api/datovka/messages/:id
  app.get("/api/datovka/messages/:id", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const id = String(req.params.id);
    const [msgRes, attRes] = await Promise.all([
      sb.from("datovka_messages").select("*").eq("id", id).eq("user_id", config.userId).single(),
      sb.from("datovka_attachments").select("*").eq("message_id", id).order("created_at"),
    ]);
    if (msgRes.error) return res.status(404).json({ message: "Zprava nenalezena" });
    res.json({ ...msgRes.data, attachments: attRes.data || [] });
  }));

  // POST /api/datovka/messages/upload
  app.post("/api/datovka/messages/upload", datovkaUpload.array("files", 10), asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Zadny soubor nebyl nahrán." });
    }
    const mailbox_id: string | null = req.body?.mailbox_id || null;
    const processed: string[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of files) {
      const filename = file.originalname;
      const isZfo = filename.toLowerCase().endsWith(".zfo");
      const isPdf = filename.toLowerCase().endsWith(".pdf");
      const fileKind: "zfo" | "pdf" = isZfo ? "zfo" : "pdf";

      try {
        // 1) Upload original to storage
        const storagePath = `${config.userId}/${Date.now()}_${filename}`;
        const { error: uploadErr } = await sb.storage
          .from(DATOVKA_BUCKET)
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype || "application/octet-stream",
            upsert: false,
          });
        if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

        // 2) Parse ZFO or treat as PDF
        let meta: Record<string, string | undefined> = {};
        let attachmentFiles: Array<{ filename: string; data: Buffer; mimeType?: string }> = [];

        if (isZfo) {
          const parsed = await parseZfo(file.buffer);
          meta = parsed.metadata as Record<string, string | undefined>;
          attachmentFiles = parsed.attachments;
        } else {
          // bare PDF
          attachmentFiles = [{ filename, data: file.buffer, mimeType: "application/pdf" }];
        }

        // 3) Extract text from PDF attachments
        let fullText = "";
        const savedAttachments: Array<{ filename: string; storagePath: string; mimeType: string; sizeBytes: number; extractedText: string; ocrUsed: boolean }> = [];

        for (const att of attachmentFiles) {
          const { text, ocrUsed } = await extractAttachmentText(
            att.filename,
            att.mimeType || "application/octet-stream",
            att.data
          );
          fullText += text + "\n";
          const attStoragePath = `${config.userId}/att_${Date.now()}_${att.filename}`;
          await sb.storage.from(DATOVKA_BUCKET).upload(attStoragePath, att.data, {
            contentType: att.mimeType || "application/octet-stream",
            upsert: false,
          });
          savedAttachments.push({
            filename: att.filename,
            storagePath: attStoragePath,
            mimeType: att.mimeType || "application/octet-stream",
            sizeBytes: att.data.length,
            extractedText: text,
            ocrUsed,
          });
        }

        // 4) AI classification
        const classification = await classifyDatovkaMessage({
          subject: meta.subject || filename,
          sender: meta.sender_name || "",
          fullText: fullText.trim(),
          deliveredAt: meta.delivered_at,
        });

        // 5) Insert message row
        const { data: msg, error: msgErr } = await sb
          .from("datovka_messages")
          .insert({
            user_id: config.userId,
            mailbox_id: mailbox_id || null,
            dm_id: meta.dm_id || null,
            sender_name: meta.sender_name || null,
            sender_id_ds: meta.sender_id_ds || null,
            sender_ico: meta.sender_ico || null,
            recipient_name: meta.recipient_name || null,
            recipient_id_ds: meta.recipient_id_ds || null,
            subject: meta.subject || filename,
            delivered_at: meta.delivered_at || null,
            accepted_at: meta.accepted_at || null,
            institution_type: classification.institution_type,
            submission_type: classification.submission_type,
            case_number: classification.case_number,
            priority: classification.priority,
            summary: classification.summary,
            key_facts: classification.key_facts,
            deadline_date: classification.deadline_date,
            deadline_text: classification.deadline_text,
            content_preview: fullText.trim().slice(0, 500),
            full_text: fullText.trim(),
            original_filename: filename,
            storage_path: storagePath,
            file_kind: fileKind,
            is_processed: true,
          })
          .select()
          .single();
        if (msgErr) throw new Error(`DB insert failed: ${msgErr.message}`);

        // 6) Insert attachments
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

        processed.push(filename);
      } catch (e: any) {
        console.error(`[datovka/upload] Error processing ${filename}:`, e?.message);
        errors.push({ file: filename, error: e?.message || String(e) });
        // Still try to save a record with error state
        try {
          const sb2 = supabase()!;
          await sb2.from("datovka_messages").insert({
            user_id: config.userId,
            mailbox_id: mailbox_id || null,
            subject: filename,
            original_filename: filename,
            file_kind: filename.toLowerCase().endsWith(".zfo") ? "zfo" : "pdf",
            is_processed: false,
            processing_error: e?.message || String(e),
          });
        } catch (_) { /* ignore */ }
      }
    }

    res.json({ processed: processed.length, files: processed, errors });
  }));

  // PATCH /api/datovka/messages/:id
  app.patch("/api/datovka/messages/:id", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const allowed = [
      "is_archived", "priority", "institution_type", "submission_type",
      "case_number", "deadline_date", "deadline_text", "summary",
      "mailbox_id", "subject", "sender_name", "delivered_at",
    ];
    const patch: Record<string, any> = {};
    for (const k of allowed) if (req.body[k] !== undefined) patch[k] = req.body[k];
    const { data, error } = await sb
      .from("datovka_messages")
      .update(patch)
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  }));

  // DELETE /api/datovka/messages/:id
  app.delete("/api/datovka/messages/:id", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { error } = await sb
      .from("datovka_messages")
      .delete()
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId);
    if (error) throw error;
    res.json({ ok: true });
  }));

  // POST /api/datovka/messages/:id/reclassify
  app.post("/api/datovka/messages/:id/reclassify", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { data: msg, error: fetchErr } = await sb
      .from("datovka_messages")
      .select("*")
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId)
      .single();
    if (fetchErr || !msg) return res.status(404).json({ message: "Zprava nenalezena" });

    const classification = await classifyDatovkaMessage({
      subject: msg.subject || msg.original_filename || "",
      sender: msg.sender_name || "",
      fullText: msg.full_text || msg.content_preview || "",
      deliveredAt: msg.delivered_at,
    });

    const { data, error } = await sb
      .from("datovka_messages")
      .update({
        institution_type: classification.institution_type,
        submission_type: classification.submission_type,
        case_number: classification.case_number,
        priority: classification.priority,
        summary: classification.summary,
        key_facts: classification.key_facts,
        deadline_date: classification.deadline_date,
        deadline_text: classification.deadline_text,
        processing_error: null,
      })
      .eq("id", msg.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  }));

  // GET /api/datovka/messages/:id/download
  app.get("/api/datovka/messages/:id/download", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { data: msg, error } = await sb
      .from("datovka_messages")
      .select("storage_path, original_filename")
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId)
      .single();
    if (error || !msg?.storage_path) return res.status(404).json({ message: "Soubor nenalezen" });
    const { data: signed, error: signErr } = await sb.storage
      .from(DATOVKA_BUCKET)
      .createSignedUrl(msg.storage_path, 300);
    if (signErr || !signed?.signedUrl) return res.status(500).json({ message: "Nelze vytvorit odkaz" });
    res.json({ url: signed.signedUrl, filename: msg.original_filename });
  }));

  // GET /api/datovka/attachments/:id/download
  app.get("/api/datovka/attachments/:id/download", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const { data: att, error } = await sb
      .from("datovka_attachments")
      .select("storage_path, filename")
      .eq("id", String(req.params.id))
      .eq("user_id", config.userId)
      .single();
    if (error || !att?.storage_path) return res.status(404).json({ message: "Priloha nenalezena" });
    const { data: signed, error: signErr } = await sb.storage
      .from(DATOVKA_BUCKET)
      .createSignedUrl(att.storage_path, 300);
    if (signErr || !signed?.signedUrl) return res.status(500).json({ message: "Nelze vytvorit odkaz" });
    res.json({ url: signed.signedUrl, filename: att.filename });
  }));


  // ===== GOLD DESK COMMUNICATOR MODULE =====
  app.get("/api/communicator/templates", asyncH(async (_req, res) => {
    const sb = supabase();
    if (!sb) return res.json(BUILTIN_COMMUNICATION_TEMPLATES);
    const { data, error } = await sb
      .from("communication_templates")
      .select("*")
      .eq("user_id", config.userId)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      // If the migration was not applied yet, keep the UI usable with built-ins.
      return res.json(BUILTIN_COMMUNICATION_TEMPLATES);
    }
    res.json((data && data.length ? data : BUILTIN_COMMUNICATION_TEMPLATES));
  }));

  app.get("/api/communicator/history", asyncH(async (req, res) => {
    const sb = supabase();
    if (!sb) return res.json([]);
    let q = sb
      .from("communication_cases")
      .select("*, communication_outputs(*)")
      .eq("user_id", config.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (req.query.mode) q = q.eq("mode", String(req.query.mode));
    if (req.query.risk_level) q = q.eq("risk_level", String(req.query.risk_level));
    if (req.query.situation_type) q = q.eq("situation_type", String(req.query.situation_type));
    const { data, error } = await q;
    if (error) return res.json([]);
    res.json(data || []);
  }));

  const communicatorUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Number(process.env.COMMUNICATOR_UPLOAD_MAX_BYTES || 25 * 1024 * 1024),
      fieldSize: Number(process.env.COMMUNICATOR_FIELD_MAX_BYTES || 10 * 1024 * 1024),
      files: 1,
      fields: 20,
    },
  });

  app.post("/api/communicator/analyze-document", communicatorUpload.single("file"), asyncH(async (req, res) => {
    const file = req.file;
    const pasted = typeof req.body?.html_text === "string" ? req.body.html_text : "";
    const modeHintRaw = String(req.body?.mode_hint || "auto");
    const modeHint = modeHintRaw === "client" || modeHintRaw === "review" ? modeHintRaw : "auto";
    const provider = req.body?.provider ? String(req.body.provider) : undefined;
    const model = req.body?.model ? String(req.body.model) : undefined;

    let extractedText = "";
    let ocrUsed = false;
    let filename = "vlozeny-dokument.txt";
    let mimeType = "text/plain";

    if (file) {
      filename = file.originalname || filename;
      mimeType = file.mimetype || guessMime(filename);
      if (isHtml(filename, mimeType)) {
        extractedText = htmlToPlainText(file.buffer.toString("utf8"));
      } else if (isPlainText(filename, mimeType)) {
        extractedText = file.buffer.toString("utf8");
      } else {
        const extracted = await extractText(filename, mimeType, file.buffer);
        extractedText = extracted.text;
        ocrUsed = extracted.ocrUsed;
      }
    } else if (pasted.trim()) {
      filename = "vlozeny-html-nebo-text.html";
      mimeType = "text/html";
      extractedText = looksLikeHtml(pasted) ? htmlToPlainText(pasted) : pasted;
    } else {
      return res.status(400).json({ message: "Nahraj PDF/HTML/TXT soubor nebo vlož HTML/text dokumentu." });
    }

    extractedText = normalizeExtractedText(extractedText);
    if (!extractedText || extractedText.length < 20) {
      return res.status(422).json({ message: "Z dokumentu se nepodařilo získat použitelný text. U skenovaného PDF zkontroluj kvalitu nebo vlož text ručně." });
    }

    const sourceText = extractedText.slice(0, 24000);
    const analysis = await withTimeout(
      analyzeCommunicationDocument({ filename, mimeType, text: sourceText, modeHint, provider, model }),
      Number(process.env.COMMUNICATOR_ANALYSIS_TIMEOUT_MS || 30000),
      () => fallbackAnalyzeDocument(sourceText, filename, mimeType, modeHint),
    );
    const formPatch = {
      mode: analysis.mode,
      client_name: analysis.client_name || "",
      client_email: analysis.client_email || "",
      product_type: analysis.product_type || "Investiční zlato",
      situation_type: analysis.situation_type || (analysis.mode === "review" ? "review_negative" : "general"),
      client_message: analysis.client_message || "",
      review_platform: analysis.review_platform || "",
      review_rating: analysis.review_rating || "",
      review_text: analysis.review_text || "",
      what_happened: analysis.what_happened || "",
      what_we_know: analysis.what_we_know || "",
      what_we_do_not_know: analysis.what_we_do_not_know || "",
      what_we_can_promise: analysis.what_we_can_promise || "",
      what_we_must_not_promise: analysis.what_we_must_not_promise || "",
      tone: analysis.tone || (analysis.mode === "review" ? "public_safe" : "legally_cautious"),
      risk_level: analysis.risk_level || "medium",
      extra_instructions: analysis.extra_instructions || "",
      source_document_name: filename,
      source_document_type: mimeType,
      source_document_summary: analysis.summary || "",
      source_document_text: sourceText,
      desired_output_types: {
        email: analysis.mode === "client",
        sms: analysis.mode === "client",
        whatsapp: analysis.mode === "client",
        phone_script: analysis.mode === "client",
        internal_note: true,
        html: true,
      },
    };

    res.json({
      ok: true,
      filename,
      mime_type: mimeType,
      ocr_used: ocrUsed,
      extracted_text: sourceText,
      text_preview: extractedText.slice(0, 2500),
      form_patch: formPatch,
      analysis: {
        summary: analysis.summary,
        extracted_facts: analysis.extracted_facts || [],
        missing_information: analysis.missing_information || [],
        risks: analysis.risks || [],
        suggested_action: analysis.suggested_action || "",
        confidence: analysis.confidence || "medium",
      },
    });
  }));

  app.post("/api/communicator/generate", asyncH(async (req, res) => {
    const parsed = communicationGenerateSchema.parse(req.body || {});
    const result = await generateCommunication(parsed);
    res.json(result);
  }));

  app.post("/api/communicator/risk-check", asyncH(async (req, res) => {
    const parsed = communicationGenerateSchema.parse({ ...(req.body || {}), desired_output_types: { email: false, sms: false, whatsapp: false, phone_script: false, internal_note: true, html: false } });
    const result = await generateCommunication(parsed);
    res.json({
      summary: result.summary,
      risk_analysis: result.risk_analysis,
      phrases_to_avoid: result.phrases_to_avoid,
      safe_wording: result.safe_wording,
      checklist: result.checklist,
      recommended_next_steps: result.recommended_next_steps,
      approval_required: result.approval_required,
    });
  }));

  app.post("/api/communicator/save", asyncH(async (req, res) => {
    requireSupabase();
    const sb = supabase()!;
    const parsed = communicationGenerateSchema.parse(req.body?.input || req.body || {});
    const output = req.body?.output || null;
    const { data: commCase, error: caseError } = await sb
      .from("communication_cases")
      .insert({
        user_id: config.userId,
        mode: parsed.mode,
        client_name: parsed.client_name || null,
        client_email: parsed.client_email || null,
        product_type: parsed.product_type || null,
        situation_type: parsed.situation_type || null,
        risk_level: parsed.risk_level,
        tone: parsed.tone || null,
        input_data: parsed,
        created_by: config.userId,
      })
      .select("*")
      .single();
    if (caseError) throw caseError;

    const { data: commOutput, error: outputError } = await sb
      .from("communication_outputs")
      .insert({
        user_id: config.userId,
        case_id: commCase.id,
        subject: output?.subject || null,
        summary: output?.summary || null,
        email_text: output?.email_text || null,
        sms_text: output?.sms_text || null,
        whatsapp_text: output?.whatsapp_text || null,
        phone_script: output?.phone_script || null,
        internal_note: output?.internal_note || null,
        review_reply: output?.review_reply || null,
        html_output: output?.html_output || null,
        risk_analysis: output?.risk_analysis || {},
        phrases_to_avoid: output?.phrases_to_avoid || [],
        safe_wording: output?.safe_wording || [],
        checklist: output?.checklist || [],
        recommended_next_steps: output?.recommended_next_steps || [],
        approval_required: !!output?.approval_required,
        approved: false,
      })
      .select("*")
      .single();
    if (outputError) throw outputError;

    await sb.from("communication_audit_log").insert({
      user_id: config.userId,
      case_id: commCase.id,
      action: "communication_saved",
      actor: config.userId,
      payload: { mode: parsed.mode, situation_type: parsed.situation_type, risk_level: parsed.risk_level },
    });

    res.status(201).json({ case: commCase, output: commOutput });
  }));

function fallbackAnalyzeDocument(text: string, filename: string, mimeType: string, modeHint: "client" | "review" | "auto") {
  const lower = `${filename}\n${text}`.toLowerCase();
  const looksReview = modeHint === "review" || /(google|heureka|firmy\.cz|recenz|hvězd|stars?|★|⭐)/i.test(text.slice(0, 5000));
  const critical = /(advokát|předžalob|žalob|policie|čnb|faú|banka|aml|trestn|zpronevěr)/i.test(lower);
  const high = /(refund|vrácení peněz|odměn|výnos|deponovan|gold deposit|custody|nedodán|prodlen|reklamac|stížnost)/i.test(lower);
  const situation = /(advokát|předžalob|žalob)/i.test(lower) ? "legal_notice"
    : /(aml|identifikac|faú)/i.test(lower) ? "aml"
    : /(refund|vrácení peněz|storno)/i.test(lower) ? "refund"
    : /(deponovan|gold deposit|odměn|výnos)/i.test(lower) ? "gold_deposit"
    : /(nedodán|dodání|zdrž|skladem|objednávk)/i.test(lower) ? "delivery_delay"
    : looksReview ? "review_negative"
    : /(reklamac|stížnost|nespokojen)/i.test(lower) ? "complaint"
    : "general";
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 1800);
  return {
    mode: looksReview ? "review" : "client",
    client_name: "",
    client_email: email,
    product_type: /(deponovan|gold deposit|gold pool)/i.test(lower) ? "Gold Deposit" : "Investiční zlato",
    situation_type: situation,
    client_message: looksReview ? "" : excerpt,
    review_platform: /heureka/i.test(lower) ? "Heureka" : /firmy/i.test(lower) ? "Firmy.cz" : /google/i.test(lower) ? "Google" : "Import dokumentu",
    review_rating: text.match(/([1-5]\s*(?:\/\s*5|hvězdič(?:ek|ky|ka)?|stars?))|([★⭐]{1,5})/i)?.[0] || "",
    review_text: looksReview ? excerpt : "",
    what_happened: excerpt,
    what_we_know: "Automaticky extrahováno z dokumentu. Před odesláním ověřit fakta proti smlouvám, objednávce a interní evidenci.",
    what_we_do_not_know: "Přesný právní stav, aktuální stav plnění, stav platby/kovu a ověřený termín dalšího kroku.",
    what_we_can_promise: "Lze slíbit pouze prověření věci a konkrétní následný kontakt v ověřeném termínu.",
    what_we_must_not_promise: "Neslibovat neověřený termín, výplatu, refundaci, právní nárok, uznání dluhu ani porušení smlouvy bez schválení.",
    tone: looksReview ? "public_safe" : (critical ? "legally_cautious" : "human_apology"),
    risk_level: critical ? "critical" : high ? "high" : "medium",
    extra_instructions: "AI analýza vypršela nebo selhala; formulář byl předvyplněn nouzovou lokální analýzou.",
    summary: excerpt || `Dokument ${filename} (${mimeType}) byl načten, ale bez spolehlivého shrnutí.`,
    extracted_facts: excerpt ? [excerpt] : [],
    missing_information: ["Ověřit identitu klienta", "Ověřit smlouvu/objednávku", "Ověřit aktuální stav plnění", "Ověřit, co již bylo klientovi slíbeno"],
    risks: critical ? ["Možná právní nebo institucionální komunikace", "Vyžaduje právní/management schválení"] : ["Automatická extrakce může být neúplná", "Před odesláním ověřit fakta"],
    suggested_action: "Nejdříve ověřit fakta v interní evidenci, poté použít bezpečnou odpověď bez neověřených slibů.",
    confidence: text.trim().length > 400 ? "medium" : "low",
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallbackFactory: () => any): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallbackFactory() as T), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

  return httpServer;
}

// ----- helpers -----
function asyncH(fn: (req: Request, res: Response) => Promise<any>) {
  return (req: Request, res: Response, next: any) => {
    fn(req, res).catch(next);
  };
}

function requireSupabase() {
  if (!supabaseConfigured()) {
    const err: any = new Error("Supabase není nakonfigurováno. Doplňte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY.");
    err.status = 503;
    throw err;
  }
}

function requireEnc() {
  if (!encryptionConfigured()) {
    const err: any = new Error("MAILROOM_ENCRYPTION_KEY není nastaven (64 hex znaků).");
    err.status = 503;
    throw err;
  }
}

function guessMime(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}

function isHtml(filename: string, mime: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm") || mime.includes("html");
}

function isPlainText(filename: string, mime: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".txt") || lower.endsWith(".md") || mime.startsWith("text/plain");
}

function looksLikeHtml(value: string): boolean {
  return /<\s*(html|body|div|p|table|section|article|span|br|h[1-6])\b/i.test(value);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "\n");
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
