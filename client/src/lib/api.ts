import { apiRequest } from "./queryClient";
import type {
  Account,
  Thread,
  Message,
  Attachment,
  Action,
} from "@shared/schema";

export interface ThreadDetailResponse extends Thread {
  messages: Message[];
  attachments: Attachment[];
  account: Account | null;
  actions: Action[];
}

export interface AIProviderInfo {
  configured: boolean;
  models: string[];
}

export interface AIConfigResponse {
  providers: {
    gemini: AIProviderInfo;
    anthropic: AIProviderInfo;
    openai: AIProviderInfo;
    perplexity: AIProviderInfo;
  };
  defaults: {
    classify: { provider: string; model: string };
    draft: { provider: string; model: string };
    qa: { provider: string; model: string };
  };
}

export interface ModelOverride {
  provider?: string;
  model?: string;
}


export interface CommunicatorInput {
  mode: "client" | "review";
  client_name?: string;
  client_email?: string;
  product_type?: string;
  situation_type?: string;
  client_message?: string;
  review_platform?: string;
  review_rating?: string;
  review_text?: string;
  source_document_name?: string;
  source_document_type?: string;
  source_document_summary?: string;
  source_document_text?: string;
  what_happened?: string;
  what_we_know?: string;
  what_we_do_not_know?: string;
  what_we_can_promise?: string;
  what_we_must_not_promise?: string;
  desired_output_types?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
    phone_script?: boolean;
    internal_note?: boolean;
    html?: boolean;
  };
  tone?: string;
  risk_level?: "low" | "medium" | "high" | "critical";
  language?: string;
  extra_instructions?: string;
  provider?: string;
  model?: string;
}

export interface CommunicatorOutput {
  mode: "client" | "review";
  subject?: string;
  summary?: string;
  email_text?: string;
  sms_text?: string;
  whatsapp_text?: string;
  phone_script?: string;
  internal_note?: string;
  review_reply?: string;
  html_output?: string;
  risk_analysis?: any;
  phrases_to_avoid?: string[];
  safe_wording?: string[];
  checklist?: string[];
  recommended_next_steps?: string[];
  approval_required?: boolean;
  html_notes?: string[];
}


export interface CommunicatorDocumentAnalysis {
  ok: boolean;
  filename?: string;
  mime_type?: string;
  ocr_used?: boolean;
  extracted_text?: string;
  text_preview?: string;
  form_patch: Partial<CommunicatorInput>;
  analysis: {
    summary?: string;
    extracted_facts?: string[];
    missing_information?: string[];
    risks?: string[];
    suggested_action?: string;
    confidence?: "low" | "medium" | "high";
  };
}

async function apiFormData(url: string, data: FormData): Promise<Response> {
  const apiBase = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
  const res = await fetch(`${apiBase}${url}`, { method: "POST", body: data });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

export const api = {

  async communicatorAnalyzeDocument(data: FormData): Promise<CommunicatorDocumentAnalysis> {
    const r = await apiFormData("/api/communicator/analyze-document", data);
    return r.json();
  },

  async communicatorGenerate(input: CommunicatorInput): Promise<CommunicatorOutput> {
    const r = await apiRequest("POST", "/api/communicator/generate", input);
    return r.json();
  },
  async communicatorRiskCheck(input: CommunicatorInput) {
    const r = await apiRequest("POST", "/api/communicator/risk-check", input);
    return r.json();
  },
  async communicatorSave(input: CommunicatorInput, output: CommunicatorOutput) {
    const r = await apiRequest("POST", "/api/communicator/save", { input, output });
    return r.json();
  },
  async communicatorTemplates() {
    const r = await apiRequest("GET", "/api/communicator/templates");
    return r.json();
  },
  async communicatorHistory(params: Record<string, string | undefined> = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const r = await apiRequest("GET", `/api/communicator/history${qs.toString() ? "?" + qs.toString() : ""}`);
    return r.json();
  },
  async status() {
    const r = await apiRequest("GET", "/api/status");
    return r.json();
  },
  async aiConfig(): Promise<AIConfigResponse> {
    const r = await apiRequest("GET", "/api/ai/config");
    return r.json();
  },
  async listAccounts(): Promise<Account[]> {
    const r = await apiRequest("GET", "/api/accounts");
    return r.json();
  },
  async createImapAccount(data: any): Promise<Account> {
    const r = await apiRequest("POST", "/api/accounts", data);
    return r.json();
  },
  async deleteAccount(id: string) {
    await apiRequest("DELETE", `/api/accounts/${id}`);
  },
  async updateAccountFilters(
    id: string,
    data: {
      name?: string;
      sync_since_date?: string | null;
      excluded_addresses?: string[];
      excluded_subjects?: string[];
    }
  ): Promise<Account> {
    const r = await apiRequest("PATCH", `/api/accounts/${id}`, data);
    return r.json();
  },
  async syncAccount(id: string) {
    const r = await apiRequest("POST", `/api/accounts/${id}/sync`);
    return r.json();
  },
  async categoryCountsForAccount(id: string): Promise<Record<string, number>> {
    const r = await apiRequest("GET", `/api/accounts/${id}/category-counts`);
    return r.json();
  },
  async datovkaCategoryCounts(mailboxId: string | "all"): Promise<Record<string, number>> {
    const r = await apiRequest("GET", `/api/datovka/mailboxes/${mailboxId}/category-counts`);
    return r.json();
  },
  async listThreads(params: Record<string, string | undefined> = {}): Promise<Thread[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    const r = await apiRequest("GET", `/api/threads${qs.toString() ? "?" + qs.toString() : ""}`);
    return r.json();
  },
  async getThread(id: string): Promise<ThreadDetailResponse> {
    const r = await apiRequest("GET", `/api/threads/${id}`);
    return r.json();
  },
  async patchThread(id: string, patch: { is_read?: boolean; is_archived?: boolean }) {
    await apiRequest("PATCH", `/api/threads/${id}`, patch);
  },
  async resummarize(id: string, override?: ModelOverride) {
    await apiRequest("POST", `/api/threads/${id}/resummarize`, override || {});
  },
  async draftReply(id: string, body: { instructions?: string; tone?: string } & ModelOverride) {
    const r = await apiRequest("POST", `/api/threads/${id}/draft-reply`, body);
    return r.json();
  },
  async sendThread(id: string, body: { to?: string[]; subject?: string; body: string }) {
    const r = await apiRequest("POST", `/api/threads/${id}/send`, body);
    return r.json();
  },
  async previewAttachment(id: string) {
    const r = await apiRequest("GET", `/api/attachments/${id}/preview`);
    return r.json();
  },
  async downloadAttachment(id: string) {
    const r = await apiRequest("GET", `/api/attachments/${id}/download`);
    return r.json();
  },
  async askAttachment(id: string, question: string, override?: ModelOverride) {
    const r = await apiRequest("POST", `/api/attachments/${id}/qa`, { question, ...override });
    return r.json();
  },
};
