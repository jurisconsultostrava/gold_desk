import { useQuery, useMutation } from "@tanstack/react-query";
import { api, AIConfigResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Account } from "@shared/schema";
import { Trash2, RefreshCw, SlidersHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  perplexity: "Perplexity (Sonar)",
};

const TASK_LABELS: Record<string, string> = {
  classify: "Klasifikace vláken",
  draft: "Návrh odpovědi",
  qa: "Q&A nad přílohou",
};

/** Parse a comma- or newline-separated list into trimmed, non-empty strings */
function parseList(val: string): string[] {
  return val
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize a string array back to comma-separated text for textarea */
function serializeList(arr: string[]): string {
  return arr.join(", ");
}

// ---------- Edit Filters Dialog ----------

interface EditFiltersDialogProps {
  account: Account;
  open: boolean;
  onClose: () => void;
}

function EditFiltersDialog({ account, open, onClose }: EditFiltersDialogProps) {
  const { toast } = useToast();
  const [syncSinceDate, setSyncSinceDate] = useState(account.sync_since_date || "");
  const [excludedAddresses, setExcludedAddresses] = useState(
    serializeList(account.excluded_addresses || [])
  );
  const [excludedSubjects, setExcludedSubjects] = useState(
    serializeList(account.excluded_subjects || [])
  );

  const updateMut = useMutation({
    mutationFn: () =>
      api.updateAccountFilters(account.id, {
        sync_since_date: syncSinceDate || null,
        excluded_addresses: parseList(excludedAddresses),
        excluded_subjects: parseList(excludedSubjects),
      }),
    onSuccess: () => {
      toast({ title: "Filtry uloženy" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      onClose();
    },
    onError: (e: any) =>
      toast({ title: "Chyba", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upravit filtry synchronizace — {account.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Stahovat od data" id="edit-sync-since-date">
            <Input
              type="date"
              value={syncSinceDate}
              onChange={(e) => setSyncSinceDate(e.target.value)}
              id="edit-sync-since-date"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pokud nevyplníš, stáhne se posledních 90 dní.
            </p>
          </Field>

          <Field label="Vyloučit adresy nebo domény" id="edit-excluded-addresses">
            <Textarea
              value={excludedAddresses}
              onChange={(e) => setExcludedAddresses(e.target.value)}
              placeholder="noreply@foo.com, newsletter.com"
              rows={3}
              id="edit-excluded-addresses"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Celá adresa (noreply@foo.com) nebo doména (newsletter.com). Oddělené čárkou nebo Enterem.
            </p>
          </Field>

          <Field label="Vyloučit emaily s těmito slovy v předmětu" id="edit-excluded-subjects">
            <Textarea
              value={excludedSubjects}
              onChange={(e) => setExcludedSubjects(e.target.value)}
              placeholder="newsletter, unsubscribe, auto-reply"
              rows={3}
              id="edit-excluded-subjects"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Substring match, case-insensitive. Cokoliv s tímto slovem v předmětu se přeskočí.
            </p>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
            {updateMut.isPending ? "Ukládám…" : "Uložit filtry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Main Page ----------

export default function Accounts() {
  const { data: status } = useQuery({ queryKey: ["/api/status"] });
  const { data: accounts } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const { data: aiConfig } = useQuery<AIConfigResponse>({
    queryKey: ["/api/ai/config"],
    queryFn: () => api.aiConfig(),
  });
  const { toast } = useToast();

  const [form, setForm] = useState({
    name: "",
    email: "",
    imap_host: "",
    imap_port: 993,
    imap_password: "",
    imap_use_tls: true,
    smtp_host: "",
    smtp_port: 587,
    smtp_password: "",
    sync_since_date: "",
    excluded_addresses: "",
    excluded_subjects: "",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // State for edit-filters dialog
  const [editFilterAccount, setEditFilterAccount] = useState<Account | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      api.createImapAccount({
        name: form.name,
        email: form.email,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_password: form.imap_password,
        imap_use_tls: form.imap_use_tls,
        smtp_host: form.smtp_host || undefined,
        smtp_port: form.smtp_port || undefined,
        smtp_password: form.smtp_password || undefined,
        sync_since_date: form.sync_since_date || null,
        excluded_addresses: parseList(form.excluded_addresses),
        excluded_subjects: parseList(form.excluded_subjects),
      }),
    onSuccess: () => {
      toast({ title: "Účet přidán" });
      setForm({
        name: "",
        email: "",
        imap_host: "",
        imap_port: 993,
        imap_password: "",
        imap_use_tls: true,
        smtp_host: "",
        smtp_port: 587,
        smtp_password: "",
        sync_since_date: "",
        excluded_addresses: "",
        excluded_subjects: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (e: any) => toast({ title: "Chyba", description: String(e?.message || e), variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteAccount(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }),
  });
  const syncMut = useMutation({
    mutationFn: (id: string) => api.syncAccount(id),
    onSuccess: () => {
      toast({ title: "Synchronizace spuštěna" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/accounts"] }), 2000);
    },
  });

  const s = status as any;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-14 px-6 border-b border-border bg-card/40 flex items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Účty schránek</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl w-full mx-auto space-y-8">
        {/* OAuth buttons */}
        <section className="space-y-3">
          <div className="text-sm font-semibold">Připojit přes OAuth</div>
          <div className="flex gap-2">
            <a
              href="/api/auth/outlook/start"
              className={`px-3 py-2 text-sm rounded-md border border-border hover-elevate ${s && !s.outlook ? "opacity-60" : ""}`}
              data-testid="link-connect-outlook"
            >
              Připojit Outlook / Microsoft 365
            </a>
            <a
              href="/api/auth/gmail/start"
              className={`px-3 py-2 text-sm rounded-md border border-border hover-elevate ${s && !s.gmail ? "opacity-60" : ""}`}
              data-testid="link-connect-gmail"
            >
              Připojit Gmail
            </a>
          </div>
          {s && (!s.outlook || !s.gmail) && (
            <div className="text-xs text-muted-foreground">
              {!s.outlook && "Outlook OAuth není nakonfigurován (MS_CLIENT_ID/MS_CLIENT_SECRET). "}
              {!s.gmail && "Gmail OAuth není nakonfigurován (GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET). "}
              Detaily v README.
            </div>
          )}
        </section>

        {/* IMAP form */}
        <section className="space-y-3 border border-border rounded-lg p-4 bg-card">
          <div className="text-sm font-semibold">Přidat IMAP účet</div>
          <div className="text-xs text-muted-foreground -mt-1">
            Pro Gmail/Outlook bez OAuth použijte tzv. app password (viz README).
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Název" id="name">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Profigold Outlook" data-testid="input-name" />
            </Field>
            <Field label="Email" id="email">
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="info@firma.cz" data-testid="input-email" />
            </Field>
            <Field label="IMAP host" id="imap_host">
              <Input value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} placeholder="imap.gmail.com" data-testid="input-imap-host" />
            </Field>
            <Field label="IMAP port" id="imap_port">
              <Input type="number" value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })} data-testid="input-imap-port" />
            </Field>
            <Field label="IMAP heslo (app password)" id="imap_password">
              <Input type="password" value={form.imap_password} onChange={(e) => setForm({ ...form, imap_password: e.target.value })} data-testid="input-imap-password" />
            </Field>
            <Field label="SMTP host (volitelné)" id="smtp_host">
              <Input value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.gmail.com" data-testid="input-smtp-host" />
            </Field>
            <Field label="SMTP port" id="smtp_port">
              <Input type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: Number(e.target.value) })} data-testid="input-smtp-port" />
            </Field>
            <Field label="SMTP heslo" id="smtp_password">
              <Input type="password" value={form.smtp_password} onChange={(e) => setForm({ ...form, smtp_password: e.target.value })} data-testid="input-smtp-password" />
            </Field>
          </div>

          {/* Sync filters collapsible */}
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mt-2"
              >
                {filtersOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                Filtry synchronizace (volitelné)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3 border-t border-border pt-3">
              <Field label="Stahovat od data" id="sync_since_date">
                <Input
                  type="date"
                  value={form.sync_since_date}
                  onChange={(e) => setForm({ ...form, sync_since_date: e.target.value })}
                  id="sync_since_date"
                  data-testid="input-sync-since-date"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Pokud nevyplníš, stáhne se posledních 90 dní.
                </p>
              </Field>

              <Field label="Vyloučit adresy nebo domény" id="excluded_addresses">
                <Textarea
                  value={form.excluded_addresses}
                  onChange={(e) => setForm({ ...form, excluded_addresses: e.target.value })}
                  placeholder="noreply@foo.com, newsletter.com"
                  rows={2}
                  id="excluded_addresses"
                  data-testid="input-excluded-addresses"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Můžeš zadat celou adresu (noreply@foo.com) nebo doménu (newsletter.com). Oddělené čárkou nebo Enterem.
                </p>
              </Field>

              <Field label="Vyloučit emaily s těmito slovy v předmětu" id="excluded_subjects">
                <Textarea
                  value={form.excluded_subjects}
                  onChange={(e) => setForm({ ...form, excluded_subjects: e.target.value })}
                  placeholder="newsletter, unsubscribe, auto-reply"
                  rows={2}
                  id="excluded_subjects"
                  data-testid="input-excluded-subjects"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Substring match, case-insensitive. Cokoliv s tímto slovem v předmětu se přeskočí.
                </p>
              </Field>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center gap-2 pt-1">
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} data-testid="button-create-account">
              {createMut.isPending ? "Ověřuji…" : "Přidat účet"}
            </Button>
            <span className="text-xs text-muted-foreground">Před uložením proběhne test IMAP přihlášení.</span>
          </div>
        </section>

        {/* List */}
        <section className="space-y-2">
          <div className="text-sm font-semibold">Připojené účty</div>
          {(accounts || []).length === 0 ? (
            <div className="text-sm text-muted-foreground">Zatím žádné účty.</div>
          ) : (
            <ul className="divide-y divide-border border border-border rounded-md bg-card">
              {accounts!.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-center gap-3" data-testid={`row-account-${a.id}`}>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate" data-testid={`text-account-name-${a.id}`}>{a.name}</span>
                      <Badge variant="outline" className="font-normal uppercase text-[10px]">{a.provider}</Badge>
                      {a.sync_status === "syncing" && <Badge variant="secondary" className="font-normal">Sync…</Badge>}
                      {a.sync_status === "error" && <Badge variant="destructive" className="font-normal">Chyba</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {a.email} {a.last_sync_at ? `• poslední sync: ${new Date(a.last_sync_at).toLocaleString("cs-CZ")}` : ""}
                    </div>
                    {a.sync_error && <div className="text-xs text-destructive truncate">{a.sync_error}</div>}
                    {/* Show active filters summary */}
                    {(a.sync_since_date || (a.excluded_addresses?.length > 0) || (a.excluded_subjects?.length > 0)) && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-1">
                        {a.sync_since_date && (
                          <span className="bg-muted px-1.5 py-0.5 rounded">Od: {a.sync_since_date}</span>
                        )}
                        {a.excluded_addresses?.length > 0 && (
                          <span className="bg-muted px-1.5 py-0.5 rounded">
                            Vyloučeno adres: {a.excluded_addresses.length}
                          </span>
                        )}
                        {a.excluded_subjects?.length > 0 && (
                          <span className="bg-muted px-1.5 py-0.5 rounded">
                            Vyloučeno slov: {a.excluded_subjects.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditFilterAccount(a)}
                    data-testid={`button-filters-${a.id}`}
                    title="Upravit filtry synchronizace"
                  >
                    <SlidersHorizontal className="size-4 mr-1" /> Filtry
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => syncMut.mutate(a.id)} data-testid={`button-sync-${a.id}`}>
                    <RefreshCw className="size-4 mr-1" /> Sync teď
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Smazat účet ${a.name}?`)) deleteMut.mutate(a.id); }} data-testid={`button-delete-${a.id}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* AI Konfigurace */}
        <section className="space-y-3 border border-border rounded-lg p-4 bg-card" data-testid="section-ai-config">
          <div className="text-sm font-semibold">AI Konfigurace</div>
          <div className="text-xs text-muted-foreground">
            Přehled dostupných AI providerů a výchozích modelů. Změnu provedete úpravou proměnných prostředí a restartem serveru.
          </div>

          {/* Providers */}
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Provideři</div>
            {aiConfig ? (
              <ul className="divide-y divide-border border border-border rounded-md">
                {(["gemini", "anthropic", "openai", "perplexity"] as const).map((key) => {
                  const p = aiConfig.providers[key];
                  return (
                    <li key={key} className="px-4 py-3 flex items-start gap-3" data-testid={`ai-provider-${key}`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{PROVIDER_LABELS[key]}</span>
                          <Badge
                            variant={p.configured ? "default" : "secondary"}
                            className="text-[10px] font-normal"
                          >
                            {p.configured ? "Připojeno" : "Nepřipojeno"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {p.models.map((m) => (
                            <Badge key={m} variant="outline" className="text-[10px] font-normal">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground">Načítám…</div>
            )}
          </div>

          {/* Per-task defaults */}
          {aiConfig && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Výchozí modely</div>
              <ul className="divide-y divide-border border border-border rounded-md">
                {(["classify", "draft", "qa"] as const).map((task) => {
                  const d = aiConfig.defaults[task];
                  return (
                    <li key={task} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground w-40">{TASK_LABELS[task]}</span>
                      <Badge variant="outline" className="font-normal text-xs">{PROVIDER_LABELS[d.provider] || d.provider}</Badge>
                      <Badge variant="secondary" className="font-normal text-xs">{d.model}</Badge>
                    </li>
                  );
                })}
              </ul>
              <div className="text-xs text-muted-foreground">
                Výchozí model lze přepsat proměnnými AI_MODEL_CLASSIFY, AI_MODEL_DRAFT, AI_MODEL_QA.
                Jednotlivé požadavky lze přepsat výběrem modelu přímo v zobrazení vlákna nebo přílohy.
              </div>
            </div>
          )}
        </section>

        {/* Status */}
        {s && (
          <section className="text-xs text-muted-foreground space-y-1">
            <div>Stav konfigurace:</div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              <li>Supabase: {s.supabase ? "✓ připojeno" : "✗ chybí"}</li>
              <li>Šifrování: {s.encryption ? "✓ ok" : "✗ chybí klíč"}</li>
              <li>Outlook OAuth: {s.outlook ? "✓ ok" : "○ nenakonfigurováno"}</li>
              <li>Gmail OAuth: {s.gmail ? "✓ ok" : "○ nenakonfigurováno"}</li>
              <li>AI (Gemini): {s.gemini ? "✓ ok" : "○ klíč chybí"}</li>
              <li>AI (Anthropic): {s.anthropic ? "✓ ok" : "○ klíč chybí"}</li>
              <li>AI (OpenAI): {s.openai ? "✓ ok" : "○ klíč chybí"}</li>
              <li>AI (Perplexity): {s.perplexity ? "✓ ok" : "○ klíč chybí"}</li>
              <li>Storage bucket: {s.bucket}</li>
            </ul>
          </section>
        )}
      </div>

      {/* Edit filters dialog */}
      {editFilterAccount && (
        <EditFiltersDialog
          account={editFilterAccount}
          open={true}
          onClose={() => setEditFilterAccount(null)}
        />
      )}
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
