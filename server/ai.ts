// AI helpers – multi-provider: Anthropic (Claude), OpenAI, Perplexity (sonar), Google Gemini.
// Pokud není nastaven žádný klíč, fallback na platform proxy (Responses API).

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config";
import { anthropicConfigured, openaiConfigured, perplexityConfigured, geminiConfigured } from "./config";

// ---- Typy ----
export type Provider = "anthropic" | "openai" | "perplexity" | "gemini";

export interface ProviderModel {
  provider: Provider;
  model: string;
}

const PPLX_BASE = "https://api.perplexity.ai";

const MODELS: Record<Provider, string[]> = {
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1"],
  perplexity: ["sonar", "sonar-pro"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
};

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  perplexity: "sonar",
  gemini: "gemini-2.5-flash",
};

export function getAvailableModels(): typeof MODELS {
  return MODELS;
}

// ---- Resolver: který provider+model použít ----
export function resolveProviderModel(
  taskModel?: string, // z env (AI_MODEL_CLASSIFY apod.)
  reqProvider?: string,
  reqModel?: string
): ProviderModel {
  // 1. Explicitní override z requestu
  if (reqProvider && isProvider(reqProvider)) {
    const model = reqModel || DEFAULT_MODELS[reqProvider as Provider];
    return { provider: reqProvider as Provider, model };
  }

  // 2. Per-task default z env (formát "provider:model" nebo jen "model")
  if (taskModel) {
    const parsed = parseProviderModel(taskModel);
    if (parsed) return parsed;
  }

  // 3. Globální AI_PROVIDER + AI_MODEL z env
  if (config.ai.provider && isProvider(config.ai.provider)) {
    const provider = config.ai.provider as Provider;
    const model = config.ai.defaultModel || DEFAULT_MODELS[provider];
    return { provider, model };
  }

  // 4. Fallback dle dostupných klíčů: GEMINI FIRST (nejlevnější), pak anthropic, openai, perplexity
  if (geminiConfigured()) return { provider: "gemini", model: DEFAULT_MODELS.gemini };
  if (anthropicConfigured()) return { provider: "anthropic", model: DEFAULT_MODELS.anthropic };
  if (openaiConfigured()) return { provider: "openai", model: DEFAULT_MODELS.openai };
  if (perplexityConfigured()) return { provider: "perplexity", model: DEFAULT_MODELS.perplexity };

  // 5. Platform proxy (žádný klíč není nastaven) – vrátíme "openai" s platforma modelem
  const platformModel = process.env.AI_MODEL || "gpt_5_1";
  return { provider: "openai", model: platformModel };
}

function isProvider(s: string): s is Provider {
  return s === "anthropic" || s === "openai" || s === "perplexity" || s === "gemini";
}

// Parsuje "anthropic:claude-sonnet-4-5" nebo "claude-sonnet-4-5" (heuristika)
function parseProviderModel(s: string): ProviderModel | null {
  if (s.includes(":")) {
    const [p, m] = s.split(":", 2);
    if (isProvider(p)) return { provider: p as Provider, model: m };
  }
  // heuristika dle prefixu
  if (s.startsWith("claude")) return { provider: "anthropic", model: s };
  if (s.startsWith("gpt") || s.startsWith("o1") || s.startsWith("o3")) return { provider: "openai", model: s };
  if (s === "sonar" || s === "sonar-pro") return { provider: "perplexity", model: s };
  if (s.startsWith("gemini")) return { provider: "gemini", model: s };
  return null;
}

// ---- Platform proxy (žádné vlastní klíče) ----
function isPlatformProxy(): boolean {
  return !anthropicConfigured() && !openaiConfigured() && !perplexityConfigured() && !geminiConfigured();
}

function makePlatformClient(): OpenAI | null {
  if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return new OpenAI();
  return null;
}

// ---- JSON / Text přes Anthropic ----
async function anthropicJSON(system: string, user: string, schemaHint: string | undefined, model: string): Promise<any> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const sys = schemaHint
    ? `${system}\n\nOdpověz POUZE validním JSONem (bez markdown, bez kódu) přesně podle této struktury:\n${schemaHint}`
    : `${system}\n\nOdpověz POUZE validním JSONem (bez markdown, bez kódu).`;
  const msg = await client.messages.create({
    model,
    max_tokens: 8192,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const txt = (msg.content[0] as any)?.text || "{}";
  return safeParseJSON(txt);
}

async function anthropicText(system: string, user: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: user }],
  });
  return (msg.content[0] as any)?.text || "";
}

// ---- JSON / Text přes OpenAI (direktní) ----
async function openaiJSON(system: string, user: string, schemaHint: string | undefined, model: string): Promise<any> {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const sys = schemaHint
    ? `${system}\n\nOdpověz POUZE validním JSON objektem přesně podle této struktury (JSON only, no markdown):\n${schemaHint}`
    : `${system}\n\nOdpověz POUZE validním JSON objektem (JSON only, no markdown).`;
  const res = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const txt = res.choices?.[0]?.message?.content || "{}";
  return safeParseJSON(txt);
}

async function openaiText(system: string, user: string, model: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices?.[0]?.message?.content || "";
}

// ---- JSON / Text přes Gemini ----
async function geminiJSON(system: string, user: string, schemaHint: string | undefined, model: string): Promise<any> {
  const client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const sys = schemaHint
    ? `${system}\n\nOdpověz POUZE validním JSONem (bez markdown, bez kódu) přesně podle této struktury:\n${schemaHint}`
    : `${system}\n\nOdpověz POUZE validním JSONem (bez markdown, bez kódu).`;
  const res = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: {
      systemInstruction: sys,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });
  const txt = res.text || "{}";
  return safeParseJSON(txt);
}

async function geminiText(system: string, user: string, model: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const res = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: {
      systemInstruction: system,
      maxOutputTokens: 4096,
    },
  });
  return res.text || "";
}

// ---- JSON / Text přes Perplexity (chat completions) ----
async function perplexityJSON(system: string, user: string, schemaHint: string | undefined, model: string): Promise<any> {
  const client = new OpenAI({ apiKey: config.perplexity.apiKey, baseURL: PPLX_BASE });
  const sys = schemaHint
    ? `${system}\n\nOdpověz POUZE validním JSONem podle této struktury:\n${schemaHint}`
    : `${system}\n\nOdpověz POUZE validním JSONem.`;
  const res = await (client.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const txt = res.choices?.[0]?.message?.content || "{}";
  return safeParseJSON(txt);
}

async function perplexityText(system: string, user: string, model: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.perplexity.apiKey, baseURL: PPLX_BASE });
  const res = await (client.chat.completions.create as any)({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices?.[0]?.message?.content || "";
}

// ---- Platform proxy (Responses API) ----
async function platformJSON(system: string, user: string, schemaHint: string | undefined, model: string): Promise<any> {
  const client = makePlatformClient();
  if (!client) throw new Error("AI není nakonfigurováno (chybí API klíče nebo platform proxy).");
  const sys = schemaHint
    ? `${system}\n\nOdpověz POUZE validním JSONem podle této struktury:\n${schemaHint}`
    : `${system}\n\nOdpověz POUZE validním JSONem.`;
  const res = await (client as any).responses.create({
    model,
    input: `${sys}\n\n---\n\n${user}`,
  });
  const txt = (res as any).output_text || "";
  return safeParseJSON(txt);
}

async function platformText(system: string, user: string, model: string): Promise<string> {
  const client = makePlatformClient();
  if (!client) throw new Error("AI není nakonfigurováno.");
  const res = await (client as any).responses.create({
    model,
    input: `${system}\n\n---\n\n${user}`,
  });
  return (res as any).output_text || "";
}

// ---- Veřejné nízkoúrovňové funkce ----
export async function llmJSON(
  system: string,
  user: string,
  schemaHint?: string,
  pm?: ProviderModel
): Promise<any> {
  if (!pm) {
    // Použij platform proxy nebo perplexity dle starého chování
    if (perplexityConfigured()) {
      return perplexityJSON(system, user, schemaHint, DEFAULT_MODELS.perplexity);
    }
    const m = process.env.AI_MODEL || "gpt_5_1";
    return platformJSON(system, user, schemaHint, m);
  }
  switch (pm.provider) {
    case "anthropic": return anthropicJSON(system, user, schemaHint, pm.model);
    case "openai": return openaiJSON(system, user, schemaHint, pm.model);
    case "perplexity": return perplexityJSON(system, user, schemaHint, pm.model);
    case "gemini": return geminiJSON(system, user, schemaHint, pm.model);
  }
}

export async function llmText(
  system: string,
  user: string,
  pm?: ProviderModel
): Promise<string> {
  if (!pm) {
    if (perplexityConfigured()) {
      return perplexityText(system, user, DEFAULT_MODELS.perplexity);
    }
    const m = process.env.AI_MODEL || "gpt_5_1";
    return platformText(system, user, m);
  }
  switch (pm.provider) {
    case "anthropic": return anthropicText(system, user, pm.model);
    case "openai": return openaiText(system, user, pm.model);
    case "perplexity": return perplexityText(system, user, pm.model);
    case "gemini": return geminiText(system, user, pm.model);
  }
}

export function aiConfigured(): boolean {
  return anthropicConfigured() || openaiConfigured() || perplexityConfigured() || geminiConfigured() || !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
}

function safeParseJSON(s: string): any {
  if (!s) return {};
  const cleaned = s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return {};
  }
}

// ----- Prompty (česky) -----
const SYS_CLASSIFY = `Jsi asistent právní/obchodní kanceláře Jurisconsult Ostrava (precious metals, fintech, Czech/Swiss law).
Pro dané vlákno emailu určíš:
1. category: contract|demand|request|invoice|client|internal|other
2. language: cs|en|de|sk
3. priority: high|normal|low (high = lhůty, soudní, regulátor, klíčový klient)
4. summary: 2-4 věty česky, věcně, co se po nás chce a do kdy
5. key_facts: pole 3-6 bullet pointů (částky, čísla, lhůty, jména)
6. category_confidence: 0..1`;

const CLASSIFY_SCHEMA = `{
  "category": "contract|demand|request|invoice|client|internal|other",
  "language": "cs|en|de|sk",
  "priority": "high|normal|low",
  "summary": "...",
  "key_facts": ["...", "..."],
  "category_confidence": 0.85
}`;

// ---- Veřejné high-level funkce ----

export async function classifyThread(
  threadText: string,
  opts?: { provider?: string; model?: string }
): Promise<any> {
  const pm = resolveProviderModel(config.ai.classifyModel, opts?.provider, opts?.model);
  return llmJSON(SYS_CLASSIFY, threadText.slice(0, 30000), CLASSIFY_SCHEMA, pm);
}

export async function draftReply(opts: {
  language: string;
  threadText: string;
  attachmentsText: string;
  instructions?: string;
  tone?: string;
  provider?: string;
  model?: string;
}): Promise<string> {
  const pm = resolveProviderModel(config.ai.draftModel, opts.provider, opts.model);
  const system = `Jsi právní/obchodní asistent advokáta Jurisconsult Ostrava (precious metals, fintech, Czech/Swiss law).
Napiš návrh odpovědi v jazyce: ${opts.language || "cs"}.
Tón: ${opts.tone || "věcný, profesionální, právnicky korektní"}.
Napiš POUZE tělo emailu (bez předmětu, bez podpisu, bez pozdravu typu "S pozdravem,").`;
  const user = `=== Vlákno ===
${opts.threadText.slice(0, 30000)}

=== Přílohy (extracted) ===
${(opts.attachmentsText || "").slice(0, 20000)}

=== Doplňující instrukce ===
${opts.instructions || "(žádné)"}`;
  return llmText(system, user, pm);
}

export async function documentQA(
  text: string,
  question: string,
  opts?: { provider?: string; model?: string }
): Promise<string> {
  const pm = resolveProviderModel(config.ai.qaModel, opts?.provider, opts?.model);
  const system = `Jsi asistent právní/obchodní kanceláře. Odpověz česky (nebo v jazyce otázky pokud není česky).
Vždy cituj relevantní pasáže z dokumentu (uveď je v uvozovkách). Pokud informace v dokumentu není, řekni to.`;
  const user = `=== Dokument ===
${text.slice(0, 20000)}

=== Otázka ===
${question}`;
  return llmText(system, user, pm);
}

// Výchozí modely pro zobrazení v UI (bez ohledu na platform proxy)
const HARDCODED_DEFAULTS: Record<string, ProviderModel> = {
  classify: { provider: "gemini", model: "gemini-2.5-flash" },
  draft:    { provider: "gemini", model: "gemini-2.5-flash" },
  qa:       { provider: "gemini", model: "gemini-2.5-flash" },
};

function resolveDefaultForUI(taskModel: string, hardcoded: ProviderModel): ProviderModel {
  if (taskModel) {
    const parsed = parseProviderModel(taskModel);
    if (parsed) return parsed;
  }
  if (config.ai.provider && isProvider(config.ai.provider)) {
    const provider = config.ai.provider as Provider;
    const model = config.ai.defaultModel || DEFAULT_MODELS[provider];
    return { provider, model };
  }
  if (geminiConfigured()) return { provider: "gemini", model: DEFAULT_MODELS.gemini };
  if (anthropicConfigured()) return { provider: "anthropic", model: DEFAULT_MODELS.anthropic };
  if (openaiConfigured()) return { provider: "openai", model: DEFAULT_MODELS.openai };
  if (perplexityConfigured()) return { provider: "perplexity", model: DEFAULT_MODELS.perplexity };
  // Fallback: pokaž zamýšlené výchozí hodnoty i bez nastaveného klíče
  return hardcoded;
}

// ---- Konfigurace pro UI ----
export function getAIConfigInfo() {
  const platformAvailable = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
  return {
    providers: {
      gemini: {
        configured: geminiConfigured(),
        models: MODELS.gemini,
      },
      anthropic: {
        configured: anthropicConfigured(),
        models: MODELS.anthropic,
      },
      openai: {
        configured: openaiConfigured() || (platformAvailable && !anthropicConfigured() && !perplexityConfigured() && !geminiConfigured()),
        models: MODELS.openai,
      },
      perplexity: {
        configured: perplexityConfigured(),
        models: MODELS.perplexity,
      },
    },
    defaults: {
      classify: resolveDefaultForUI(config.ai.classifyModel, HARDCODED_DEFAULTS.classify),
      draft:    resolveDefaultForUI(config.ai.draftModel, HARDCODED_DEFAULTS.draft),
      qa:       resolveDefaultForUI(config.ai.qaModel, HARDCODED_DEFAULTS.qa),
    },
  };
}
