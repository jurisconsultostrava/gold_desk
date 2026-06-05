import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { api, ThreadDetailResponse, AIConfigResponse, ModelOverride } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { categoryLabels, priorityLabels } from "@shared/schema";
import {
  ArrowLeft,
  Archive,
  Check,
  RefreshCw,
  Paperclip,
  Download,
  MessageSquare,
  Send,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ThreadDetail() {
  const [, params] = useRoute<{ id: string }>("/thread/:id");
  const id = params?.id || "";
  const { data, isLoading } = useQuery<ThreadDetailResponse>({
    queryKey: ["/api/threads", id],
    queryFn: () => api.getThread(id),
    enabled: !!id,
  });
  const { data: aiConfig } = useQuery<AIConfigResponse>({
    queryKey: ["/api/ai/config"],
    queryFn: () => api.aiConfig(),
  });
  const { toast } = useToast();

  const [draft, setDraft] = useState("");
  const [instructions, setInstructions] = useState("");
  const [recipients, setRecipients] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Sestaví override z vybraného modelu (formát "provider:model")
  function buildOverride(): ModelOverride {
    if (!selectedModel) return {};
    const [provider, model] = selectedModel.split(":", 2);
    return { provider, model };
  }

  // Všechny dostupné možnosti pro dropdown
  function allModelOptions(): Array<{ value: string; label: string }> {
    if (!aiConfig) return [];
    const opts: Array<{ value: string; label: string }> = [];
    const defaultDraft = aiConfig.defaults.draft;
    const defaultLabel = `Výchozí (${defaultDraft.provider}: ${defaultDraft.model})`;
    opts.push({ value: "", label: defaultLabel });
    for (const [provider, info] of Object.entries(aiConfig.providers) as [string, { configured: boolean; models: string[] }][]) {
      if (info.configured) {
        for (const m of info.models) {
          opts.push({ value: `${provider}:${m}`, label: `${provider} / ${m}` });
        }
      }
    }
    return opts;
  }

  const draftMut = useMutation({
    mutationFn: () => api.draftReply(id, { instructions, ...buildOverride() }),
    onSuccess: (a: any) => {
      setDraft(a.result || "");
      toast({ title: "Návrh odpovědi vygenerován" });
    },
    onError: (e: any) => toast({ title: "Chyba", description: String(e?.message || e), variant: "destructive" }),
  });
  const sendMut = useMutation({
    mutationFn: () =>
      api.sendThread(id, {
        body: draft,
        to: recipients ? recipients.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: () => {
      toast({ title: "Odpověď odeslána" });
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["/api/threads", id] });
    },
    onError: (e: any) => toast({ title: "Chyba odeslání", description: String(e?.message || e), variant: "destructive" }),
  });
  const archiveMut = useMutation({
    mutationFn: (val: boolean) => api.patchThread(id, { is_archived: val }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/threads"] }),
  });
  const readMut = useMutation({
    mutationFn: (val: boolean) => api.patchThread(id, { is_read: val }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/threads"] }),
  });
  const resummarizeMut = useMutation({
    mutationFn: () => api.resummarize(id),
    onSuccess: () => {
      toast({ title: "Přeshrnutí spuštěno" });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/threads", id] }), 4000);
    },
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Načítám…</div>;
  if (!data) return <div className="p-8">Vlákno nenalezeno.</div>;

  const modelOptions = allModelOptions();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-14 px-6 border-b border-border flex items-center gap-3 bg-card/40">
        <Link href="/" className="p-1.5 rounded-md hover-elevate" data-testid="link-back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold truncate flex-1" data-testid="text-thread-subject">
          {data.subject || "(bez předmětu)"}
        </h1>
        <Button variant="ghost" size="sm" onClick={() => readMut.mutate(!data.is_read)} data-testid="button-toggle-read">
          <Check className="size-4 mr-1" /> {data.is_read ? "Označit nepřečtené" : "Přečteno"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => archiveMut.mutate(!data.is_archived)} data-testid="button-archive">
          <Archive className="size-4 mr-1" /> {data.is_archived ? "Obnovit" : "Archivovat"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => resummarizeMut.mutate()} data-testid="button-resummarize">
          <RefreshCw className="size-4 mr-1" /> Přeshrnout
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {/* Meta */}
          <section className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Účastníci:</span>
            {(data.participants || []).slice(0, 5).map((p) => (
              <Badge key={p} variant="secondary" className="font-normal">{p}</Badge>
            ))}
            <div className="flex-1" />
            {data.category && (
              <Badge variant="outline" className="font-normal">
                {categoryLabels[data.category as keyof typeof categoryLabels] || data.category}
              </Badge>
            )}
            {data.priority === "high" && <Badge variant="destructive">{priorityLabels.high}</Badge>}
            {data.language && <Badge variant="secondary" className="font-normal uppercase">{data.language}</Badge>}
          </section>

          {/* Summary */}
          {(data.summary || (data.key_facts && data.key_facts.length > 0)) && (
            <section className="border border-border rounded-lg p-4 bg-card">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Shrnutí</div>
              {data.summary && <p className="text-sm leading-relaxed mb-3" data-testid="text-summary">{data.summary}</p>}
              {data.key_facts && data.key_facts.length > 0 && (
                <ul className="text-sm space-y-1">
                  {data.key_facts.map((k, i) => (
                    <li key={i} className="flex gap-2"><span className="text-primary">•</span><span>{k}</span></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Messages */}
          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Zprávy ({data.messages.length})</div>
            {data.messages.map((m) => (
              <MessageCard key={m.id} m={m} />
            ))}
          </section>

          {/* Attachments */}
          {data.attachments.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Přílohy ({data.attachments.length})</div>
              <ul className="space-y-2">
                {data.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card" data-testid={`row-attachment-${a.id}`}>
                    <Paperclip className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium flex-1 truncate">{a.filename}</span>
                    <span className="text-xs text-muted-foreground">{a.size_bytes ? formatBytes(a.size_bytes) : ""}</span>
                    {a.ocr_used && <Badge variant="secondary" className="font-normal text-xs">OCR</Badge>}
                    <Link href={`/attachment/${a.id}`} className="text-sm text-primary hover:underline" data-testid={`link-attachment-${a.id}`}>
                      Otevřít
                    </Link>
                    <button
                      onClick={async () => {
                        try {
                          const r = await api.downloadAttachment(a.id);
                          window.open(r.url, "_blank");
                        } catch (e: any) {
                          toast({ title: "Chyba", description: String(e?.message || e), variant: "destructive" });
                        }
                      }}
                      className="p-1 rounded hover-elevate"
                      aria-label="Stáhnout"
                      data-testid={`button-download-${a.id}`}
                    >
                      <Download className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Reply draft */}
          <section className="space-y-2 border border-border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-primary" />
              <div className="text-sm font-semibold">Návrh odpovědi</div>
              <div className="flex-1" />
              {/* Model override dropdown */}
              {modelOptions.length > 1 && (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="h-8 text-xs rounded-md border border-input bg-background px-2 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="select-draft-model"
                  title="Přepsat AI model pro tento návrh"
                >
                  {modelOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              )}
              <Button size="sm" variant="outline" onClick={() => draftMut.mutate()} disabled={draftMut.isPending} data-testid="button-generate-draft">
                <Sparkles className="size-4 mr-1" />
                {draftMut.isPending ? "Generuji…" : "Generovat AI"}
              </Button>
            </div>
            <Input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={"Doplňující instrukce (např. odmítni nárok, požaduj dokumenty)"}
              className="h-9"
              data-testid="input-instructions"
            />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Návrh emailu se zobrazí zde…"
              rows={10}
              data-testid="textarea-draft"
            />
            <div className="flex items-center gap-2">
              <Input
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="Příjemce (čárkou oddělené, prázdné = původní odesílatel)"
                className="h-9 flex-1"
                data-testid="input-recipients"
              />
              <Button size="sm" onClick={() => sendMut.mutate()} disabled={!draft || sendMut.isPending} data-testid="button-send">
                <Send className="size-4 mr-1" />
                {sendMut.isPending ? "Odesílám…" : "Odeslat"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Odpověď se odešle přes účet, ke kterému vlákno patří{data.account ? ` (${data.account.email})` : ""}.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MessageCard({ m }: { m: any }) {
  const [open, setOpen] = useState(false);
  const preview = (m.body_text || "").trim().slice(0, 200);
  const date = m.sent_at ? new Date(m.sent_at).toLocaleString("cs-CZ") : "";
  return (
    <div className="border border-border rounded-md bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 text-left hover-elevate flex items-baseline gap-3"
        data-testid={`button-toggle-message-${m.id}`}
      >
        <span className="text-sm font-medium">{m.from_name || m.from_address || "—"}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">{preview}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{date}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 text-sm whitespace-pre-wrap leading-relaxed border-t border-border">
          {m.body_text || "(bez obsahu)"}
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
