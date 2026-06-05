import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { config, supabaseConfigured } from "./config";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: ws as any },
    });
  }
  return client;
}

export function requireSupabase(): SupabaseClient {
  const s = supabase();
  if (!s) {
    const err: any = new Error(
      "Supabase není nakonfigurováno. Nastavte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY v .env."
    );
    err.status = 503;
    throw err;
  }
  return s;
}
