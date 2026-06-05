import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { api, AIConfigResponse, ModelOverride } from "@/lib/api";
import { ArrowLeft, Download, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface QAEntry {
  q: string;
  a: string;
  pending?: boolean;
}

export default function AttachmentViewer() {
  const [, params] = useRoute<{ id: string }>("/attachment/:id");
  const id = params?.id || "";
  const { data, isLoading } = useQuery({
    queryKey: ["/api/attachments", id, "preview"],
    queryFn: () => api.previewAttachment(id),
    enabled: !!id,
  });
  const { data: aiConfig } = useQuery<AIConfigResponse>({
    queryKey: ["/api/ai/config"],
    queryFn: () => api.aiConfig(),
  });
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  function buildOverride(): ModelOverride {
    if (!selectedModel) return {};
    const [provider, model] = selectedModel.split(":", 2);
    return { provider, model };
  }

  function allModelOptions(): Array<{ value: string; label: string }> {
    if (!aiConfig) return [];
    const opts: Array<{ value: string; label: string }> = [];
    const defaultQA = aiConfig.defaults.qa;
    const defaultLabel = `Výchozí (${defaultQA.provider}: ${defaultQA.model})`;
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

  const askMut = useMutation({
    mutationFn: async (q: string) => api.askAttachment(id, q, buildOverride()),
    onSuccess: (res: any, q) => {
      setHistory((h) => h.map((e) => (e.q === q && e.pending ? { q, a: res.result || "" } : e)));
    },
    onError: (e: any, q) => {
      setHistory((h) => h.map((e2) => (e2.q === q && e2.pending ? { q, a: `Chyba: ${e?.message || e}` } : e2)));
      toast({ title: "Chyba dotazu", variant: "destructive", description: String(e?.message || e) });
    },
  });

  function ask() {
    if (!question.trim()) return;
    setHistory((h) => [...h, { q: question, a: "", pending: true }]);
    askMut.mutate(question);
    setQuestion("");
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Načítám…</div>;
  if (!data) return <div className="p-8">Příloha nenalezena.</div>;

  const modelOptions = allModelOptions();

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="h-14 px-6 border-b border-border bg-card/40 flex items-center gap-3">
        <Link href={data.thread_id ? `/thread/${data.thread_id}` : "/"} className="p-1.5 rounded-md hover-elevate" data-testid="link-back">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold truncate flex-1" data-testid="text-attachment-filename">{data.filename}</h1>
        {data.ocr_used && <Badge variant="secondary" className="font-normal text-xs">OCR</Badge>}
        <span className="text-xs text-muted-foreground">{data.mime_type}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const r = await api.downloadAttachment(id);
              window.open(r.url, "_blank");
            } catch (e: any) {
              toast({ title: "Chyba", description: String(e?.message || e), variant: "destructive" });
            }
          }}
          data-testid="button-download"
        >
          <Download className="size-4 mr-1" /> Stáhnout
        </Button>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-border">
        <section className="overflow-y-auto p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Extrahovaný text</div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans" data-testid="text-extracted">
            {data.extracted_text || "(extrakce textu se nezdařila nebo dokument neobsahuje text)"}
          </pre>
        </section>

        <section className="flex flex-col">
          <div className="px-6 pt-6 pb-2 flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground flex-1">
              Otázky nad dokumentem
            </span>
            {/* Model override dropdown */}
            {modelOptions.length > 1 && (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="h-7 text-xs rounded-md border border-input bg-background px-2 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="select-qa-model"
                title="Přepsat AI model pro Q&A"
              >
                {modelOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-6 space-y-3" data-testid="list-qa">
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Položte otázku k tomuto dokumentu. AI odpoví v kontextu extrahovaného textu.
              </div>
            ) : (
              history.map((e, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3 text-primary" />
                    <div className="text-sm font-medium">{e.q}</div>
                  </div>
                  <div className="text-sm whitespace-pre-wrap pl-5 text-foreground/90 border-l-2 border-border ml-1.5 pb-2">
                    {e.pending ? <span className="text-muted-foreground">Přemýšlím…</span> : e.a}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border p-3 flex items-end gap-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={"Např. Jaká je celková částka a do kdy je splatná?"}
              rows={2}
              className="resize-none"
              data-testid="textarea-question"
            />
            <Button size="sm" onClick={ask} disabled={!question.trim() || askMut.isPending} data-testid="button-ask">
              <Send className="size-4" />
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
