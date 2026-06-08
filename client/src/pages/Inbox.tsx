import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ArrowUpDown, CalendarClock, Paperclip, Search, RefreshCw, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Thread } from "@shared/schema";
import { categoryLabels } from "@shared/schema";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryTabs } from "@/components/CategoryTabs";

// Filtry kategorií/účtu čteme z window.location.search — wouter hash routing
// drží nás na path "/" a search params žijí v `window.location.search`.
function parseFilters(loc: string) {
  const query = loc.includes("?") ? loc.slice(loc.indexOf("?") + 1) : (typeof window !== "undefined" ? window.location.search.replace(/^\?/, "") : "");
  const sp = new URLSearchParams(query);
  return {
    category: sp.get("category") || undefined,
    unread: sp.get("unread") === "1" ? "1" : undefined,
    priority: sp.get("priority") || undefined,
    attachments: sp.get("attachments") === "1" ? "1" : undefined,
    account_id: sp.get("account_id") || undefined,
  } as Record<string, string | undefined>;
}

type SortKey = "date" | "urgency" | "deadline";
type SortDir = "asc" | "desc";

function setSearchParam(key: string, value: string | undefined) {
  if (typeof window === "undefined") return;
  const hash = window.location.hash.replace(/^#/, "") || "/inbox";
  const [path, query = ""] = hash.split("?");
  const sp = new URLSearchParams(query);
  if (!value) sp.delete(key);
  else sp.set(key, value);
  const qs = sp.toString();
  window.location.hash = `${path || "/inbox"}${qs ? "?" + qs : ""}`;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
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
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
  const sortedThreads = useMemo(() => sortThreads(threads || [], sortKey, sortDir), [threads, sortKey, sortDir]);

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

  function handleSort(key: SortKey) {
    setSortKey((current) => {
      if (current === key) {
        setSortDir((dir) => dir === "asc" ? "desc" : "asc");
        return current;
      }
      setSortDir(key === "deadline" ? "asc" : "desc");
      return key;
    });
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
        <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <CalendarClock className="size-4" />
          Tabulka pošty: datum / naléhavost / termín
        </div>
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
          <MailTable threads={sortedThreads} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
        )}
      </div>
    </div>
  );
}

function MailTable({ threads, sortKey, sortDir, onSort }: { threads: Thread[]; sortKey: SortKey; sortDir: SortDir; onSort: (key: SortKey) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <SortableTh active={sortKey === "date"} dir={sortDir} onClick={() => onSort("date")}>Datum</SortableTh>
            <SortableTh active={sortKey === "urgency"} dir={sortDir} onClick={() => onSort("urgency")}>Naléhavost</SortableTh>
            <SortableTh active={sortKey === "deadline"} dir={sortDir} onClick={() => onSort("deadline")}>Termín</SortableTh>
            <th className="px-4 py-3 font-medium">Odesílatel / klient</th>
            <th className="px-4 py-3 font-medium">Předmět a shrnutí</th>
            <th className="px-4 py-3 font-medium">Kategorie</th>
            <th className="px-4 py-3 font-medium">Stav</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {threads.map((t) => {
            const sender = t.participants?.[0] || "—";
            const date = t.last_message_at ? new Date(t.last_message_at) : null;
            const deadline = getThreadDeadline(t);
            const urgency = getUrgency(t);
            return (
              <tr key={t.id} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3 align-top text-muted-foreground">
                  {date ? formatDateTime(date) : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <Badge variant={urgency.level === "critical" || urgency.level === "high" ? "destructive" : urgency.level === "medium" ? "secondary" : "outline"} className="gap-1">
                    {(urgency.level === "critical" || urgency.level === "high") && <AlertTriangle className="size-3" />}
                    {urgency.label}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  {deadline ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={deadline.isOverdue ? "font-semibold text-destructive" : deadline.isSoon ? "font-semibold text-amber-700 dark:text-amber-300" : "text-foreground"}>
                        {formatDeadline(deadline.date)}
                      </span>
                      <span className="text-xs text-muted-foreground">{deadline.source}</span>
                    </div>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="max-w-[220px] px-4 py-3 align-top">
                  <div className="truncate font-medium">{sender}</div>
                  {t.language && <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.language}</div>}
                </td>
                <td className="min-w-[320px] px-4 py-3 align-top">
                  <Link href={`/thread/${t.id}`} className="block group" data-testid={`row-thread-${t.id}`}>
                    <div className="flex items-center gap-2">
                      {!t.is_read && <span className="size-1.5 rounded-full bg-primary shrink-0" aria-label="Nepřečtené" />}
                      <span className="font-medium group-hover:underline">{t.subject || "(bez předmětu)"}</span>
                      {t.has_attachments && <Paperclip className="size-3.5 text-muted-foreground shrink-0" />}
                    </div>
                    {t.summary && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.summary}</div>}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  {t.category ? <Badge variant="outline" className="font-normal">{categoryLabels[t.category as keyof typeof categoryLabels] || t.category}</Badge> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {!t.is_read ? <Badge variant="secondary">nepřečtené</Badge> : <Badge variant="outline">přečtené</Badge>}
                    {t.is_archived && <Badge variant="outline">archiv</Badge>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({ active, dir, onClick, children }: { active: boolean; dir: SortDir; onClick: () => void; children: ReactNode }) {
  return (
    <th className="px-4 py-3 font-medium">
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground ${active ? "text-foreground" : ""}`}>
        {children}
        <ArrowUpDown className="size-3" />
        {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
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

function sortThreads(threads: Thread[], key: SortKey, dir: SortDir): Thread[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...threads].sort((a, b) => {
    let av = 0;
    let bv = 0;
    if (key === "date") {
      av = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      bv = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    } else if (key === "urgency") {
      av = getUrgency(a).score;
      bv = getUrgency(b).score;
    } else {
      const ad = getThreadDeadline(a)?.date.getTime();
      const bd = getThreadDeadline(b)?.date.getTime();
      av = ad ?? Number.POSITIVE_INFINITY;
      bv = bd ?? Number.POSITIVE_INFINITY;
    }
    if (av === bv) {
      const ad = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bd = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bd - ad;
    }
    return (av - bv) * factor;
  });
}

function getUrgency(t: Thread): { score: number; label: string; level: "low" | "medium" | "high" | "critical" } {
  const text = `${t.subject || ""}\n${t.summary || ""}\n${(t.key_facts || []).join("\n")}`.toLowerCase();
  let score = 0;
  if (t.priority === "high") score += 60;
  if (t.priority === "normal") score += 25;
  if (t.category === "demand" || t.category === "contract") score += 20;
  if (/(urgent|naléhav|ihned|okamžitě|do dneš|dnes|zítra|termín|lhůta|deadline)/i.test(text)) score += 25;
  if (/(advokát|předžalob|žalob|soud|policie|čnb|faú|banka|aml|reklamac|stížnost|refund|vrácení peněz|gold deposit|deponovan|odměn|výnos)/i.test(text)) score += 35;
  const deadline = getThreadDeadline(t);
  if (deadline?.isOverdue) score += 45;
  else if (deadline?.isSoon) score += 30;
  if (!t.is_read) score += 10;
  if (score >= 90) return { score, label: "kritická", level: "critical" };
  if (score >= 60) return { score, label: "vysoká", level: "high" };
  if (score >= 30) return { score, label: "střední", level: "medium" };
  return { score, label: "nízká", level: "low" };
}

type DeadlineInfo = { date: Date; source: string; isOverdue: boolean; isSoon: boolean };

function getThreadDeadline(t: Thread): DeadlineInfo | null {
  const sourceText = `${t.subject || ""}\n${t.summary || ""}\n${(t.key_facts || []).join("\n")}`;
  const found = extractDeadlineDate(sourceText);
  if (!found) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = found.date.getTime();
  const days = Math.ceil((time - startToday) / 86_400_000);
  return {
    date: found.date,
    source: found.source,
    isOverdue: days < 0,
    isSoon: days >= 0 && days <= 2,
  };
}

function extractDeadlineDate(text: string): { date: Date; source: string } | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lower = normalized.toLowerCase();
  if (/\b(dnes|dneška)\b/i.test(lower)) return { date: today, source: "dnes" };
  if (/\b(zítra|zitra)\b/i.test(lower)) return { date: addDays(today, 1), source: "zítra" };
  if (/\b(pozítří|pozitri)\b/i.test(lower)) return { date: addDays(today, 2), source: "pozítří" };

  const iso = normalized.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return { date: new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), source: iso[0] };

  const cz = normalized.match(/\b(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(20\d{2}))?\b/);
  if (cz) {
    const year = cz[3] ? Number(cz[3]) : now.getFullYear();
    let date = new Date(year, Number(cz[2]) - 1, Number(cz[1]));
    if (!cz[3] && date.getTime() < today.getTime() - 14 * 86_400_000) date = new Date(year + 1, Number(cz[2]) - 1, Number(cz[1]));
    return { date, source: cz[0] };
  }

  const rel = normalized.match(/\bdo\s+(\d{1,2})\s+(dnů|dnu|dní|dni)\b/i);
  if (rel) return { date: addDays(today, Number(rel[1])), source: rel[0] };

  return null;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDeadline(d: Date): string {
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
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
