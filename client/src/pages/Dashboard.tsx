import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { ReactNode } from "react";
import { api, type StrategicDashboardItem, type StrategicDashboardResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Inbox,
  MailOpen,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TimerReset,
  TrendingUp,
} from "lucide-react";

export default function Dashboard() {
  const { data, isLoading, isFetching, refetch, error } = useQuery<StrategicDashboardResponse>({
    queryKey: ["/api/dashboard/strategic"],
    queryFn: () => api.strategicDashboard(),
    refetchInterval: 60_000,
  });

  const metrics = data?.metrics || {};

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-card/50 px-6 py-4">
        <div className="flex items-start gap-4">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Target className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Řídicí centrum aktivit</h1>
              <Badge variant="secondary" className="font-normal">Strategický přehled</Badge>
            </div>
            <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
              Prioritizuje nové zprávy, úkoly, termíny a rizikovou komunikaci tak, aby primární cíl zůstal jasný:
              udržet zákazníka, obnovit důvěru a chránit značku.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 size-4 ${isFetching ? "animate-spin" : ""}`} />
            Obnovit
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <DashboardSkeleton />
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Dashboard se nepodařilo načíst. Zkontroluj Railway logy a Supabase konfiguraci.
          </div>
        ) : (
          <div className="space-y-6">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <MetricCard label="Prioritní věci" value={metrics.focus_count || 0} icon={Target} tone="primary" />
              <MetricCard label="Po termínu" value={metrics.overdue || 0} icon={TimerReset} tone={(metrics.overdue || 0) > 0 ? "critical" : "neutral"} />
              <MetricCard label="Dnes / zítra" value={metrics.due_soon || 0} icon={CalendarClock} tone={(metrics.due_soon || 0) > 0 ? "warning" : "neutral"} />
              <MetricCard label="Rizikové" value={metrics.high_risk || 0} icon={ShieldAlert} tone={(metrics.high_risk || 0) > 0 ? "critical" : "neutral"} />
              <MetricCard label="Nepřečtené" value={metrics.unread || 0} icon={Inbox} tone={(metrics.unread || 0) > 0 ? "warning" : "neutral"} />
              <MetricCard label="Čeká rozhodnutí" value={metrics.pending_approvals || 0} icon={MessageSquareText} tone={(metrics.pending_approvals || 0) > 0 ? "warning" : "neutral"} />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
              <Panel
                title="Co řešit jako první"
                description="Seřazeno podle naléhavosti, termínu, reputačního a právního rizika."
                icon={AlertTriangle}
                action={<LinkButton href="/inbox">Otevřít poštu</LinkButton>}
              >
                <ItemList items={data?.focus || []} empty="Aktuálně nejsou vidět kritické položky." />
              </Panel>

              <Panel
                title="Doporučení pro vedení"
                description="Krátký manažerský výklad, kde je riziko a co nepustit ze zřetele."
                icon={Sparkles}
              >
                <div className="space-y-3">
                  {(data?.strategic_notes || []).map((note, index) => (
                    <div key={`${note.title}-${index}`} className={`rounded-lg border p-3 ${noteTone(note.level)}`}>
                      <div className="flex items-start gap-2">
                        {note.level === "critical" ? <ShieldAlert className="mt-0.5 size-4" /> : note.level === "warning" ? <AlertTriangle className="mt-0.5 size-4" /> : <CheckCircle2 className="mt-0.5 size-4" />}
                        <div>
                          <div className="text-sm font-semibold">{note.title}</div>
                          <div className="mt-1 text-xs leading-relaxed opacity-90">{note.body}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <Panel
                title="Novinky"
                description="Nejnovější e-maily, datové zprávy a výstupy komunikátoru."
                icon={TrendingUp}
                action={<LinkButton href="/datovka">Datovka</LinkButton>}
              >
                <ItemList items={data?.latest || []} compact empty="Žádné nové položky." />
              </Panel>

              <Panel
                title="Úkoly a termíny"
                description="Věci s termínem nebo jasným doporučeným dalším krokem."
                icon={Clock3}
                action={<LinkButton href="/communicator">Communicator</LinkButton>}
              >
                <TaskList items={data?.tasks || []} />
              </Panel>
            </section>

            <section className="grid gap-3 md:grid-cols-3">
              <MiniStatus label="E-mailová vlákna" value={metrics.mail_threads || 0} icon={Inbox} />
              <MiniStatus label="Datové zprávy" value={metrics.datovka_messages || 0} icon={MailOpen} />
              <MiniStatus label="Komunikační výstupy" value={metrics.communication_outputs || 0} icon={MessageSquareText} />
            </section>

            {!!data?.warnings?.length && (
              <div className="rounded-xl border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-semibold">Neúplná data</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {data.warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: any; tone: "primary" | "warning" | "critical" | "neutral" }) {
  return (
    <div className={`rounded-xl border bg-card p-4 shadow-sm ${toneBorder(tone)}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className={`size-4 ${toneText(tone)}`} />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Panel({ title, description, icon: Icon, action, children }: { title: string; description: string; icon: any; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-start gap-3 border-b p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ItemList({ items, compact = false, empty }: { items: StrategicDashboardItem[]; compact?: boolean; empty: string }) {
  if (!items.length) return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link key={item.id} href={item.href || "/"} className="block rounded-lg border bg-background p-3 hover:bg-muted/40">
          <div className="flex items-start gap-3">
            <SourceIcon type={item.source_type} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold">{item.title}</span>
                <RiskBadge item={item} />
                {item.deadline_status === "overdue" && <Badge variant="destructive">po termínu</Badge>}
                {item.deadline_status === "soon" && <Badge variant="secondary">termín brzy</Badge>}
              </div>
              {!compact && item.subtitle && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{item.source_label}</span>
                {item.actor && <><span>·</span><span className="truncate">{item.actor}</span></>}
                {item.date && <><span>·</span><span>{formatDateTime(item.date)}</span></>}
                {item.deadline && <><span>·</span><span>termín: {formatDate(item.deadline)}</span></>}
              </div>
              {!compact && item.recommended_action && <div className="mt-2 text-xs font-medium text-foreground/80">Doporučený krok: {item.recommended_action}</div>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function TaskList({ items }: { items: StrategicDashboardItem[] }) {
  if (!items.length) return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Žádné úkoly ani termíny.</div>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Link key={item.id} href={item.href || "/"} className="block rounded-lg border bg-background p-3 hover:bg-muted/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.deadline_status === "overdue" ? "destructive" : item.deadline_status === "soon" ? "secondary" : "outline"}>
                  {item.deadline ? formatDate(item.deadline) : "bez termínu"}
                </Badge>
                <span className="truncate text-sm font-semibold">{item.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.recommended_action || "Prověřit další krok."}</p>
            </div>
            <RiskBadge item={item} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function MiniStatus({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></div>
      <div>
        <div className="text-xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function SourceIcon({ type }: { type: string }) {
  if (type === "datovka") return <MailOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  if (type === "communication") return <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  return <Inbox className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function RiskBadge({ item }: { item: StrategicDashboardItem }) {
  if (item.risk === "critical") return <Badge variant="destructive">kritické</Badge>;
  if (item.risk === "high") return <Badge variant="destructive">vysoké</Badge>;
  if (item.risk === "medium") return <Badge variant="secondary">střední</Badge>;
  return <Badge variant="outline">nízké</Badge>;
}

function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">{children}</Link>;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
        <div className="h-96 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

function toneBorder(tone: string) {
  if (tone === "critical") return "border-destructive/40";
  if (tone === "warning") return "border-amber-300/60 dark:border-amber-900/60";
  if (tone === "primary") return "border-primary/30";
  return "";
}

function toneText(tone: string) {
  if (tone === "critical") return "text-destructive";
  if (tone === "warning") return "text-amber-600 dark:text-amber-300";
  if (tone === "primary") return "text-primary";
  return "text-muted-foreground";
}

function noteTone(level: string) {
  if (level === "critical") return "border-destructive/40 bg-destructive/10 text-destructive";
  if (level === "warning") return "border-amber-300/50 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200";
  return "border-primary/20 bg-primary/5 text-foreground";
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}
