import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Paperclip, Search, RefreshCw, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Thread } from "@shared/schema";
import { categoryLabels, priorityLabels } from "@shared/schema";
import { useEffect, useRef, useState } from "react";
import { CategoryTabs } from "@/components/CategoryTabs";

// Filtry kategorií/účtu čteme z window.location.search — wouter hash routing
// drží nás na path "/" a search params žijí v `window.location.search`.
function parseFilters(_loc: string) {
  if (typeof window === "undefined") return {};
  const sp = new URLSearchParams(window.location.search);
  return {
    category: sp.get("category") || undefined,
    unread: sp.get("unread") === "1" ? "1" : undefined,
    priority: sp.get("priority") || undefined,
    attachments: sp.get("attachments") === "1" ? "1" : undefined,
    account_id: sp.get("account_id") || undefined,
  } as Record<string, string | undefined>;
}

function setSearchParam(key: string, value: string | undefined) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (!value) sp.delete(key);
  else sp.set(key, value);
  const qs = sp.toString();
  const newUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
  window.history.pushState({}, "", newUrl);
  // Notify wouter (and our own listener) that the URL changed.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function Inbox() {
  const [location] = useLocation();

  // Re-render on browser navigation (popstate / hash) to pick up search params.
  const [, force] = useState(0);
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    window.addEventListener("popstate", handler);
    window.addEventListener("hashchange", handler);
    return () => {
      window.removeEventListener("popstate", handler);
      window.removeEventListener("hashchange", handler);
    };
  }, []);

  const f = parseFilters(location);
  const [q, setQ] = useState("");

  // Reset category to "Vše" when switching accounts (unless URL already specifies one).
  const lastAccountRef = useRef<string | undefined>(f.account_id);
  useEffect(() => {
    if (lastAccountRef.current !== f.account_id) {
      lastAccountRef.current = f.account_id;
    }
  }, [f.account_id]);

  const { data: threads, isLoading, refetch, isFetching } = useQuery<Thread[]>({
    queryKey: ["/api/threads", f, q],
    queryFn: async () => api.listThreads({ ...f, q: q || undefined }),
  });
  const { data: status } = useQuery({ queryKey: ["/api/status"] });

  // Counts per category — only meaningful when an account is selected.
  const { data: counts, isLoading: countsLoading } = useQuery<Record<string, number>>({
    queryKey: ["/api/accounts", f.account_id, "category-counts"],
    queryFn: () => api.categoryCountsForAccount(f.account_id!),
    enabled: !!f.account_id,
  });

  function handleCategoryChange(key: string) {
    setSearchParam("category", key || undefined);
  }

  const title = f.category ? categoryLabels[f.category as keyof typeof categoryLabels] || "Pošta" : "Pošta";
  const filterTags = [
    f.unread && "Nepřečtené",
    f.priority === "high" && "Vysoká priorita",
    f.attachments && "S přílohou",
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col h-screen">
      <header className="h-14 px-6 border-b border-border bg-card/40 flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{title}</h1>
        <div className="flex items-center gap-1.5">
          {filterTags.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">{t}</Badge>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-72">
          <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledat předmět…"
            className="pl-8 h-9"
            data-testid="input-search"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-md hover-elevate"
          aria-label="Obnovit"
          data-testid="button-refresh"
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      <SetupBanner status={status as any} />

      <CategoryTabs
        active={f.category || ""}
        counts={counts || null}
        isLoading={!!f.account_id && countsLoading}
        onChange={handleCategoryChange}
      />

      <div className="flex-1 overflow-y-auto" data-testid="list-threads">
        {isLoading ? (
          <Skeletons />
        ) : (threads || []).length === 0 ? (
          <EmptyState configured={!!(status as any)?.supabase} category={f.category} />
        ) : (
          <ul className="divide-y divide-border">
            {threads!.map((t) => (
              <ThreadRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ t }: { t: Thread }) {
  const sender = t.participants?.[0] || "—";
  const date = t.last_message_at ? new Date(t.last_message_at) : null;
  const dateStr = date ? formatRelative(date) : "";
  return (
    <Link
      href={`/thread/${t.id}`}
      className="block px-6 py-3 hover-elevate"
      data-testid={`row-thread-${t.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-start min-w-0 flex-1">
          <div className="flex items-center gap-2 w-full">
            {!t.is_read && <span className="size-1.5 rounded-full bg-primary shrink-0" aria-label="Nepřečtené" />}
            <span className="text-sm font-medium truncate" data-testid={`text-sender-${t.id}`}>{sender}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 w-full">
            <span className="text-sm text-foreground truncate flex-1" data-testid={`text-subject-${t.id}`}>
              {t.subject || "(bez předmětu)"}
            </span>
            {t.has_attachments && <Paperclip className="size-3.5 text-muted-foreground shrink-0" />}
          </div>
          {t.summary && (
            <div className="text-xs text-muted-foreground line-clamp-1 mt-1" data-testid={`text-summary-${t.id}`}>
              {t.summary}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1">
            {t.priority === "high" && (
              <Badge variant="destructive" className="font-normal gap-1">
                <AlertTriangle className="size-3" />
                {priorityLabels.high}
              </Badge>
            )}
            {t.category && (
              <Badge variant="outline" className="font-normal">
                {categoryLabels[t.category as keyof typeof categoryLabels] || t.category}
              </Badge>
            )}
          </div>
          {t.language && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.language}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ configured, category }: { configured: boolean; category?: string }) {
  if (category) {
    return (
      <div className="flex flex-col items-center justify-center text-center h-full py-24 px-6">
        <div className="text-xl font-semibold mb-1">Žádné zprávy v této kategorii.</div>
        <div className="text-sm text-muted-foreground max-w-md">
          Zkuste vybrat jinou kategorii nebo zobrazit všechny zprávy.
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center text-center h-full py-24 px-6">
      <div className="text-xl font-semibold mb-1">Žádná pošta</div>
      <div className="text-sm text-muted-foreground max-w-md">
        {configured
          ? "Připojte schránku v sekci „Nastavení účtů“ a spusťte první synchronizaci."
          : "Aplikace zatím nemá připojené Supabase. Doplňte SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY do .env a spusťte migraci."}
      </div>
      <Link
        href="/accounts"
        className="mt-4 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover-elevate"
        data-testid="link-empty-add-account"
      >
        Připojit účet
      </Link>
    </div>
  );
}

function Skeletons() {
  return (
    <ul className="divide-y divide-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="px-6 py-4">
          <div className="h-3 w-40 bg-muted rounded animate-pulse mb-2" />
          <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function SetupBanner({ status }: { status: any }) {
  if (!status) return null;
  const issues: string[] = [];
  if (!status.supabase) issues.push("Supabase");
  if (!status.encryption) issues.push("Šifrovací klíč");
  if (!status.ai) issues.push("AI (OpenAI/Perplexity)");
  if (!issues.length) return null;
  return (
    <div className="px-6 py-2 text-xs bg-amber-100/60 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border-b border-amber-300/50">
      Chybí konfigurace: <strong>{issues.join(", ")}</strong>. Doplňte proměnné v <code>.env</code> a restartujte server (viz README).
    </div>
  );
}

function formatRelative(d: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  if (diff < 60_000) return "teď";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" });
}
