// Centralized env config with sane defaults and presence checks.

export const config = {
  userId: process.env.MAILROOM_USER_ID || "default-user",
  encryptionKey: process.env.MAILROOM_ENCRYPTION_KEY || "",
  supabase: {
    url: process.env.SUPABASE_URL || "",
    // accept either service role key (preferred for backend) or anon key
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "",
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "mailroom-attachments",
  },
  microsoft: {
    clientId: process.env.MS_CLIENT_ID || "",
    clientSecret: process.env.MS_CLIENT_SECRET || "",
    redirectUri:
      process.env.MS_REDIRECT_URI ||
      "http://localhost:5000/api/auth/outlook/callback",
  },
  google: {
    clientId: process.env.GMAIL_CLIENT_ID || "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
    redirectUri:
      process.env.GMAIL_REDIRECT_URI ||
      "http://localhost:5000/api/auth/gmail/callback",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
  },
  perplexity: {
    apiKey: process.env.PERPLEXITY_API_KEY || "",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  },
  ai: {
    // Globální výchozí provider (anthropic | openai | perplexity)
    provider: process.env.AI_PROVIDER || "",
    // Globální výchozí model (volitelně ve formátu "provider:model" nebo jen "model")
    defaultModel: process.env.AI_MODEL || "",
    // Výchozí model pro konkrétní úlohy (přepíší globální default)
    classifyModel: process.env.AI_MODEL_CLASSIFY || "",
    draftModel: process.env.AI_MODEL_DRAFT || "",
    qaModel: process.env.AI_MODEL_QA || "",
  },
} as const;

export function supabaseConfigured(): boolean {
  return !!(config.supabase.url && config.supabase.key);
}

export function encryptionConfigured(): boolean {
  // 32 bytes = 64 hex chars
  return /^[0-9a-f]{64}$/i.test(config.encryptionKey);
}

export function outlookConfigured(): boolean {
  return !!(config.microsoft.clientId && config.microsoft.clientSecret);
}

export function gmailConfigured(): boolean {
  return !!(config.google.clientId && config.google.clientSecret);
}

export function anthropicConfigured(): boolean {
  return !!config.anthropic.apiKey;
}

export function openaiConfigured(): boolean {
  return !!config.openai.apiKey;
}

export function perplexityConfigured(): boolean {
  return !!config.perplexity.apiKey;
}

export function geminiConfigured(): boolean {
  return !!config.gemini.apiKey;
}
