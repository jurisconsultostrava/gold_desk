import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CategoryTabs } from "@/components/CategoryTabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  MoreHorizontal,
  Settings2,
  Loader2,
  AlertTriangle,
  Pencil,
  Trash2,
  RefreshCw,
  Archive,
  Download,
  ChevronDown,
  Inbox,
} from "lucide-react";
import type {
  DatovkaMailbox,
  DatovkaMessage,
  DatovkaAttachment,
  DatovkaInstitution,
  DatovkaSubmission,
} from "@shared/schema";
import { datovkaInstitutionLabels, datovkaSubmissionLabels } from "@shared/schema";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function deadlineColor(date: string | null | undefined): string {
  if (!date) return "";
  const diff = Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (diff < 7) return "text-red-600 font-semibold";
  if (diff < 14) return "text-amber-600 font-semibold";
  return "";
}

const INSTITUTION_BADGE_COLORS: Record<DatovkaInstitution, string> = {
  court: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  executor: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  regulator: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  authority: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  tax: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ministry: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  other: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400",
};

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  normal: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  low: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};
const PRIORITY_LABELS: Record<string, string> = { high: "Vysoká", normal: "Normální", low: "Nízká" };

function truncate(s: string | null | undefined, n = 100): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url: string, opts?: RequestInit) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
}

// ─── MailboxesDialog ──────────────────────────────────────────────────────────

function MailboxesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: mailboxes = [] } = useQuery<DatovkaMailbox[]>({
    queryKey: ["/api/datovka/mailboxes"],
    queryFn: () => apiFetch("/api/datovka/mailboxes"),
  });

  const [form, setForm] = useState({ name: "", id_ds: "", ico: "", notes: "" });
  const [editId, setEditId] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editId) {
        return apiFetch(`/api/datovka/mailboxes/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      } else {
        return apiFetch("/api/datovka/mailboxes", {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/mailboxes"] });
      setForm({ name: "", id_ds: "", ico: "", notes: "" });
      setEditId(null);
      toast({ title: editId ? "Schránka upravena" : "Schránka přidána" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/datovka/mailboxes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/mailboxes"] });
      toast({ title: "Schránka smazána" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  function startEdit(m: DatovkaMailbox) {
    setEditId(m.id);
    setForm({ name: m.name, id_ds: m.id_ds || "", ico: m.ico || "", notes: m.notes || "" });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Správa datových schránek</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {mailboxes.map((m) => (
            <div key={m.id} className="flex items-start gap-2 p-2 border rounded-md">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{m.name}</div>
                <div className="text-xs text-muted-foreground">
                  {m.id_ds && <span>ID DS: {m.id_ds}</span>}
                  {m.ico && <span className="ml-2">IČO: {m.ico}</span>}
                </div>
              </div>
              <button onClick={() => startEdit(m)} className="p-1 hover:text-primary" title="Upravit">
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => deleteMut.mutate(m.id)}
                className="p-1 hover:text-destructive"
                title="Smazat"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {mailboxes.length === 0 && (
            <p className="text-sm text-muted-foreground">Zatím žádné schránky.</p>
          )}

          <div className="border-t pt-3 mt-3 space-y-2">
            <div className="text-sm font-medium">{editId ? "Upravit schránku" : "Přidat novou schránku"}</div>
            <div>
              <Label className="text-xs">Název *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Profigold s.r.o."
                className="h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">ID datové schránky</Label>
                <Input
                  value={form.id_ds}
                  onChange={(e) => setForm((f) => ({ ...f, id_ds: e.target.value }))}
                  placeholder="abc123xy"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">IČO</Label>
                <Input
                  value={form.ico}
                  onChange={(e) => setForm((f) => ({ ...f, ico: e.target.value }))}
                  placeholder="12345678"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Poznámky</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => saveMut.mutate()}
                disabled={!form.name.trim() || saveMut.isPending}
              >
                {saveMut.isPending && <Loader2 className="size-3 mr-1 animate-spin" />}
                {editId ? "Uložit změny" : "Přidat schránku"}
              </Button>
              {editId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setEditId(null); setForm({ name: "", id_ds: "", ico: "", notes: "" }); }}
                >
                  Zrušit
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── UploadDialog ─────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  mailboxes,
}: {
  open: boolean;
  onClose: () => void;
  mailboxes: DatovkaMailbox[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [mailboxId, setMailboxId] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith(".zfo") || f.name.endsWith(".pdf")
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      if (mailboxId) fd.append("mailbox_id", mailboxId);
      const res = await fetch("/api/datovka/messages/upload", { method: "POST", body: fd });
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages"] });
      toast({ title: `Zpracováno ${data.processed} zpráv${data.errors?.length ? `, ${data.errors.length} chyb` : ""}` });
      setFiles([]);
      onClose();
    } catch (e: any) {
      toast({ title: "Chyba nahrávání", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nahrát ZFO / PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
              ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
          >
            <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Přetáhněte ZFO nebo PDF soubory sem, nebo klikněte pro výběr
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".zfo,.pdf"
              className="hidden"
              onChange={(e) => {
                const sel = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...sel]);
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 bg-muted/40 px-2 py-1 rounded">
                  <span className="truncate flex-1">{f.name}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Mailbox select */}
          <div>
            <Label className="text-xs">Cílová schránka (doporučeno)</Label>
            <select
              value={mailboxId}
              onChange={(e) => setMailboxId(e.target.value)}
              className="w-full border rounded-md px-3 py-1.5 text-sm bg-background mt-1"
            >
              <option value="">— bez schránky —</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          <Button
            onClick={handleUpload}
            disabled={!files.length || uploading}
            className="w-full"
          >
            {uploading ? (
              <><Loader2 className="size-4 mr-2 animate-spin" /> Zpracovávám…</>
            ) : (
              <><Upload className="size-4 mr-2" /> Nahrát a analyzovat ({files.length} souborů)</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── MessageDetail Sheet ──────────────────────────────────────────────────────

function MessageDetail({
  msg,
  open,
  onClose,
}: {
  msg: (DatovkaMessage & { attachments?: DatovkaAttachment[] }) | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: detail } = useQuery<DatovkaMessage & { attachments: DatovkaAttachment[] }>({
    queryKey: ["/api/datovka/messages", msg?.id],
    queryFn: () => apiFetch(`/api/datovka/messages/${msg!.id}`),
    enabled: !!msg?.id && open,
  });

  const d = detail || msg;

  const reclassifyMut = useMutation({
    mutationFn: () => apiFetch(`/api/datovka/messages/${msg!.id}/reclassify`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages"] });
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages", msg?.id] });
      toast({ title: "Reklasifikace dokončena" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  async function downloadOriginal() {
    try {
      const { url } = await apiFetch(`/api/datovka/messages/${msg!.id}/download`);
      window.open(url, "_blank");
    } catch (e: any) {
      toast({ title: "Chyba stahování", description: e.message, variant: "destructive" });
    }
  }

  async function downloadAttachment(id: string) {
    try {
      const { url } = await apiFetch(`/api/datovka/attachments/${id}/download`);
      window.open(url, "_blank");
    } catch (e: any) {
      toast({ title: "Chyba stahování", description: e.message, variant: "destructive" });
    }
  }

  if (!d) return null;

  const institution = d.institution_type as DatovkaInstitution | null;
  const submission = d.submission_type as DatovkaSubmission | null;
  const attachments = (detail?.attachments ?? (d as any).attachments) as DatovkaAttachment[] | undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base leading-snug pr-8">{d.subject || d.original_filename || "Datová zpráva"}</SheetTitle>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {institution && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INSTITUTION_BADGE_COLORS[institution]}`}>
                {datovkaInstitutionLabels[institution]}
              </span>
            )}
            {d.priority && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[d.priority]}`}>
                {PRIORITY_LABELS[d.priority]}
              </span>
            )}
            {submission && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {datovkaSubmissionLabels[submission]}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-5 text-sm">
          {/* Shrnutí */}
          {d.summary && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Shrnutí</div>
              <p className="text-sm leading-relaxed">{d.summary}</p>
            </section>
          )}

          {/* Klíčová fakta */}
          {d.key_facts?.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Klíčová fakta</div>
              <ul className="list-disc list-inside space-y-0.5 text-sm">
                {d.key_facts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </section>
          )}

          {/* Lhůta */}
          {(d.deadline_date || d.deadline_text) && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Lhůta</div>
              {d.deadline_date && (
                <div className={`text-base font-semibold ${deadlineColor(d.deadline_date)}`}>
                  {formatDate(d.deadline_date)}
                </div>
              )}
              {d.deadline_text && (
                <div className="text-xs text-muted-foreground mt-0.5">{d.deadline_text}</div>
              )}
            </section>
          )}

          {/* Metadata */}
          <section>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Metadata</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {d.sender_name && <><dt className="text-muted-foreground">Odesílatel</dt><dd>{d.sender_name}</dd></>}
              {d.sender_id_ds && <><dt className="text-muted-foreground">ID DS odesílatele</dt><dd>{d.sender_id_ds}</dd></>}
              {d.recipient_name && <><dt className="text-muted-foreground">Adresát</dt><dd>{d.recipient_name}</dd></>}
              {d.case_number && <><dt className="text-muted-foreground">Č.j. / sp. zn.</dt><dd className="font-medium">{d.case_number}</dd></>}
              {d.dm_id && <><dt className="text-muted-foreground">ID zprávy</dt><dd>{d.dm_id}</dd></>}
              {d.delivered_at && <><dt className="text-muted-foreground">Datum doručení</dt><dd>{formatDate(d.delivered_at)}</dd></>}
              {d.accepted_at && <><dt className="text-muted-foreground">Datum přijetí</dt><dd>{formatDate(d.accepted_at)}</dd></>}
              {d.original_filename && <><dt className="text-muted-foreground">Soubor</dt><dd>{d.original_filename}</dd></>}
            </dl>
          </section>

          {/* Přílohy */}
          {attachments && attachments.length > 0 && (
            <section>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Přílohy ({attachments.length})</div>
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 bg-muted/40 px-2 py-1.5 rounded text-xs">
                    <span className="flex-1 truncate">{a.filename}</span>
                    {a.size_bytes && <span className="text-muted-foreground">{(a.size_bytes / 1024).toFixed(0)} kB</span>}
                    <button
                      onClick={() => downloadAttachment(a.id)}
                      className="text-primary hover:underline"
                    >
                      Stáhnout
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Akce */}
          <div className="flex gap-2 pt-2 border-t">
            <Button size="sm" variant="outline" onClick={downloadOriginal}>
              <Download className="size-3.5 mr-1.5" />
              Originál
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => reclassifyMut.mutate()}
              disabled={reclassifyMut.isPending}
            >
              {reclassifyMut.isPending
                ? <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                : <RefreshCw className="size-3.5 mr-1.5" />
              }
              Reklasifikovat
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Datovka page ────────────────────────────────────────────────────────

// Filtry (category) čteme přímo z window.location.search — wouter hash routing
// drží `location` na "/" a search params žijí v `window.location.search`.
function readCategoryFromWindow(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("category") || "";
}
function writeCategoryToWindow(cat: string) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (cat) sp.set("category", cat);
  else sp.delete("category");
  const qs = sp.toString();
  const newUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
  window.history.pushState({}, "", newUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function Datovka() {
  const qc = useQueryClient();
  const { toast } = useToast();

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

  // Filters
  const [selectedMailbox, setSelectedMailbox] = useState<string>("");
  const [filterInstitution, setFilterInstitution] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [searchQ, setSearchQ] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Category comes from window.location.search (?category=…)
  const category = readCategoryFromWindow();
  function handleCategoryChange(key: string) {
    writeCategoryToWindow(key);
  }

  // When the user switches mailbox, reset category to "Vše" for clearer UX.
  const lastMailboxRef = useRef<string>(selectedMailbox);
  useEffect(() => {
    if (lastMailboxRef.current !== selectedMailbox) {
      lastMailboxRef.current = selectedMailbox;
      if (category) {
        writeCategoryToWindow("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMailbox]);

  // UI state
  const [showUpload, setShowUpload] = useState(false);
  const [showMailboxes, setShowMailboxes] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<DatovkaMessage | null>(null);

  const { data: mailboxes = [] } = useQuery<DatovkaMailbox[]>({
    queryKey: ["/api/datovka/mailboxes"],
    queryFn: () => apiFetch("/api/datovka/mailboxes"),
  });

  const queryParams = new URLSearchParams();
  if (selectedMailbox) queryParams.set("mailbox_id", selectedMailbox);
  if (filterInstitution) queryParams.set("institution", filterInstitution);
  if (filterPriority) queryParams.set("priority", filterPriority);
  if (searchQ) queryParams.set("q", searchQ);
  if (dateFrom) queryParams.set("from", dateFrom);
  if (dateTo) queryParams.set("to", dateTo);
  if (category) queryParams.set("category", category);

  const { data: messages = [], isLoading } = useQuery<DatovkaMessage[]>({
    queryKey: ["/api/datovka/messages", queryParams.toString()],
    queryFn: () => apiFetch(`/api/datovka/messages?${queryParams.toString()}`),
  });

  // Počty zpráv v kategoriích (pro aktuálně vybranou schránku, nebo všechny).
  const mailboxKey = selectedMailbox || "all";
  const { data: catCounts, isLoading: catCountsLoading } = useQuery<Record<string, number>>({
    queryKey: ["/api/datovka/mailboxes", mailboxKey, "category-counts"],
    queryFn: () => apiFetch(`/api/datovka/mailboxes/${mailboxKey}/category-counts`),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/datovka/messages/${id}`, { method: "PATCH", body: JSON.stringify({ is_archived: true }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages"] });
      toast({ title: "Zpráva archivována" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/datovka/messages/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages"] });
      toast({ title: "Zpráva smazána" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  const reclassifyMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/datovka/messages/${id}/reclassify`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/datovka/messages"] });
      toast({ title: "Reklasifikace dokončena" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: e.message, variant: "destructive" }),
  });

  async function downloadOriginal(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const { url } = await apiFetch(`/api/datovka/messages/${id}/download`);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({ title: "Chyba stahování", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="border-b border-border px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 mr-1">
          <Inbox className="size-4 text-primary" />
          <span className="font-semibold">Datovka</span>
        </div>

        {/* Mailbox filter */}
        <select
          value={selectedMailbox}
          onChange={(e) => setSelectedMailbox(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-background h-8"
        >
          <option value="">Všechny schránky</option>
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        {/* Institution filter */}
        <select
          value={filterInstitution}
          onChange={(e) => setFilterInstitution(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-background h-8"
        >
          <option value="">Typ instituce</option>
          {(Object.entries(datovkaInstitutionLabels) as [DatovkaInstitution, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Priority filter */}
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-background h-8"
        >
          <option value="">Priorita</option>
          <option value="high">Vysoká</option>
          <option value="normal">Normální</option>
          <option value="low">Nízká</option>
        </select>

        {/* Date range */}
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Od data"
          className="border rounded-md px-2 py-1 text-sm bg-background h-8 w-36"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Do data"
          className="border rounded-md px-2 py-1 text-sm bg-background h-8 w-36"
        />

        {/* Search */}
        <Input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Hledat předmět, č.j., odesílatele…"
          className="h-8 text-sm flex-1 min-w-[180px] max-w-xs"
        />

        {/* Reset filters */}
        {(selectedMailbox || filterInstitution || filterPriority || searchQ || dateFrom || dateTo || category) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSelectedMailbox("");
              setFilterInstitution("");
              setFilterPriority("");
              setSearchQ("");
              setDateFrom("");
              setDateTo("");
              writeCategoryToWindow("");
            }}
          >
            Zrušit filtry
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => setShowMailboxes(true)}>
            <Settings2 className="size-3.5 mr-1.5" />
            Schránky
          </Button>
          <Button size="sm" className="h-8" onClick={() => setShowUpload(true)}>
            <Upload className="size-3.5 mr-1.5" />
            Nahrát ZFO/PDF
          </Button>
        </div>
      </div>

      {/* Category tabs */}
      <CategoryTabs
        active={category}
        counts={catCounts || null}
        isLoading={catCountsLoading}
        onChange={handleCategoryChange}
      />

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="size-5 animate-spin mr-2" />
            Načítám zprávy…
          </div>
        ) : messages.length === 0 ? (
          category ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <Inbox className="size-12 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">Žádné zprávy v této kategorii.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <Inbox className="size-12 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">
                Žádné datovkové zprávy.
                <br />
                Nahraj svůj první ZFO nebo PDF.
              </p>
              <Button onClick={() => setShowUpload(true)}>
                <Upload className="size-4 mr-2" />
                Nahrát ZFO/PDF
              </Button>
            </div>
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Datum</TableHead>
                <TableHead className="w-64">Odesílatel</TableHead>
                <TableHead>Obsah</TableHead>
                <TableHead className="w-32">Lhůta</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((msg) => {
                const inst = msg.institution_type as DatovkaInstitution | null;
                return (
                  <TableRow
                    key={msg.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedMsg(msg)}
                  >
                    {/* Datum */}
                    <TableCell className="text-sm tabular-nums whitespace-nowrap align-top pt-3">
                      {formatDate(msg.delivered_at)}
                    </TableCell>

                    {/* Odesílatel */}
                    <TableCell className="align-top pt-3">
                      <div className="text-sm font-medium truncate max-w-[240px]">
                        {msg.sender_name || "—"}
                      </div>
                      {inst && (
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium mt-0.5 ${INSTITUTION_BADGE_COLORS[inst]}`}>
                          {datovkaInstitutionLabels[inst]}
                        </span>
                      )}
                    </TableCell>

                    {/* Obsah */}
                    <TableCell className="align-top pt-3">
                      <div className="text-xs text-muted-foreground mb-0.5 font-medium truncate max-w-xs">
                        {msg.subject || msg.original_filename || "—"}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-sm text-muted-foreground line-clamp-2 max-w-lg">
                            {truncate(msg.summary || msg.content_preview, 100)}
                          </p>
                        </TooltipTrigger>
                        {(msg.summary || msg.content_preview) && (
                          <TooltipContent className="max-w-sm text-xs">
                            {msg.summary || msg.content_preview}
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TableCell>

                    {/* Lhůta */}
                    <TableCell className="align-top pt-3 whitespace-nowrap">
                      {msg.deadline_date ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`text-sm ${deadlineColor(msg.deadline_date)}`}>
                              {formatDate(msg.deadline_date)}
                            </span>
                          </TooltipTrigger>
                          {msg.deadline_text && (
                            <TooltipContent className="max-w-xs text-xs">{msg.deadline_text}</TooltipContent>
                          )}
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>

                    {/* Row actions */}
                    <TableCell className="align-top pt-2" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedMsg(msg)}>
                            Otevřít detail
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => downloadOriginal(msg.id, e as any)}>
                            <Download className="size-3.5 mr-2" /> Otevřít originál
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => reclassifyMut.mutate(msg.id)}>
                            <RefreshCw className="size-3.5 mr-2" /> Reklasifikovat
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => archiveMut.mutate(msg.id)}>
                            <Archive className="size-3.5 mr-2" /> Archivovat
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              if (confirm("Opravdu smazat tuto zprávu?")) deleteMut.mutate(msg.id);
                            }}
                          >
                            <Trash2 className="size-3.5 mr-2" /> Smazat
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Dialogs */}
      <UploadDialog open={showUpload} onClose={() => setShowUpload(false)} mailboxes={mailboxes} />
      <MailboxesDialog open={showMailboxes} onClose={() => setShowMailboxes(false)} />
      <MessageDetail msg={selectedMsg} open={!!selectedMsg} onClose={() => setSelectedMsg(null)} />
    </div>
  );
}
