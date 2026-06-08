import { Link, useLocation } from "wouter";
import { ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Inbox,
  FileText,
  AlertTriangle,
  HelpCircle,
  Receipt,
  Users,
  Building2,
  Folder,
  Settings,
  CircleAlert,
  Moon,
  Sun,
  MailOpen,
  MessageSquareText,
  LogOut,
} from "lucide-react";
import type { Account } from "@shared/schema";

type IconType = React.ComponentType<{ className?: string }>;

const CATEGORIES: { key: string; label: string; icon: IconType }[] = [
  { key: "", label: "Vše", icon: Inbox },
  { key: "contract", label: "Smlouvy", icon: FileText },
  { key: "demand", label: "Výzvy", icon: AlertTriangle },
  { key: "request", label: "Žádosti", icon: HelpCircle },
  { key: "invoice", label: "Faktury", icon: Receipt },
  { key: "client", label: "Klienti", icon: Users },
  { key: "internal", label: "Interní", icon: Building2 },
  { key: "other", label: "Ostatní", icon: Folder },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-label="Mailroom logo">
      <rect x="2" y="6" width="28" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M2 8 L16 18 L30 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="24" cy="22" r="3" fill="currentColor" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: accounts } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const [dark, setDark] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const parseFilters = () => {
    const url = new URL("http://x" + location);
    const sp = new URLSearchParams(url.search);
    return {
      category: sp.get("category") || "",
      unread: sp.get("unread") === "1",
      priority: sp.get("priority") || "",
      attachments: sp.get("attachments") === "1",
      account_id: sp.get("account_id") || "",
    };
  };
  const filters = parseFilters();

  function catHref(c: string) {
    const sp = new URLSearchParams();
    if (c) sp.set("category", c);
    return "/" + (sp.toString() ? "?" + sp.toString() : "");
  }
  function filterHref(key: string, val: string) {
    const sp = new URLSearchParams();
    if (filters.category) sp.set("category", filters.category);
    sp.set(key, val);
    return "/?" + sp.toString();
  }


  async function logout() {
    await api.authLogout();
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-4 h-14 flex items-center gap-2 border-b border-sidebar-border text-primary">
          <Logo />
          <div className="font-semibold tracking-tight">Mailroom</div>
        </div>

        <div className="px-3 py-3 space-y-0.5 overflow-y-auto flex-1">
          <SectionLabel>Kategorie</SectionLabel>
          {CATEGORIES.map((c) => {
            const active = filters.category === c.key;
            const Icon = c.icon;
            return (
              <Link
                key={c.key || "all"}
                href={catHref(c.key)}
                className={`group flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/85"}`}
                data-testid={`link-category-${c.key || "all"}`}
              >
                <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
                <span className="flex-1">{c.label}</span>
              </Link>
            );
          })}

          <div className="h-3" />
          <SectionLabel>Filtry</SectionLabel>
          <Link
            href={filterHref("unread", "1")}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${filters.unread ? "bg-sidebar-accent" : ""}`}
            data-testid="link-filter-unread"
          >
            <CircleAlert className="size-4 text-muted-foreground" />
            <span>Nepřečtené</span>
          </Link>
          <Link
            href={filterHref("priority", "high")}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${filters.priority === "high" ? "bg-sidebar-accent" : ""}`}
            data-testid="link-filter-priority"
          >
            <AlertTriangle className="size-4 text-muted-foreground" />
            <span>Vysoká priorita</span>
          </Link>
          <Link
            href={filterHref("attachments", "1")}
            className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${filters.attachments ? "bg-sidebar-accent" : ""}`}
            data-testid="link-filter-attachments"
          >
            <FileText className="size-4 text-muted-foreground" />
            <span>S přílohou</span>
          </Link>



          <div className="h-3" />
          <SectionLabel>Komunikace</SectionLabel>
          <Link
            href="/communicator"
            className={`group flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${
              location.startsWith("/communicator") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/85"
            }`}
            data-testid="link-communicator"
          >
            <MessageSquareText className="size-4 text-muted-foreground group-hover:text-foreground" />
            <span className="flex-1">Communicator</span>
          </Link>

          <div className="h-3" />
          <SectionLabel>Datová schránka</SectionLabel>
          <Link
            href="/datovka"
            className={`group flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate ${
              location.startsWith("/datovka") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/85"
            }`}
            data-testid="link-datovka"
          >
            <MailOpen className="size-4 text-muted-foreground group-hover:text-foreground" />
            <span className="flex-1">Datovka</span>
          </Link>

          <div className="h-3" />
          <SectionLabel>Účty</SectionLabel>
          {(accounts || []).map((a) => (
            <Link
              key={a.id}
              href={`/?account_id=${a.id}`}
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover-elevate"
              data-testid={`link-account-${a.id}`}
            >
              <span className={`inline-block size-2 rounded-full ${a.sync_status === "syncing" ? "bg-amber-500 animate-pulse" : a.sync_status === "error" ? "bg-destructive" : "bg-primary"}`} />
              <span className="truncate flex-1">{a.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{a.provider}</span>
            </Link>
          ))}
          {(!accounts || accounts.length === 0) && (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              Žádné účty. <Link href="/accounts" className="text-primary underline">Přidat účet</Link>
            </div>
          )}
        </div>

        <div className="border-t border-sidebar-border p-3 flex items-center justify-between">
          <Link
            href="/accounts"
            className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover-elevate flex-1"
            data-testid="link-nav-accounts"
          >
            <Settings className="size-4 text-muted-foreground" />
            <span>Nastavení účtů</span>
          </Link>
          <button
            onClick={() => setDark((d) => !d)}
            className="p-1.5 rounded-md hover-elevate"
            aria-label="Přepnout režim"
            data-testid="button-toggle-theme"
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <button
            onClick={logout}
            className="p-1.5 rounded-md hover-elevate"
            aria-label="Odhlásit se"
            title="Odhlásit se"
            data-testid="button-logout"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
      {children}
    </div>
  );
}
