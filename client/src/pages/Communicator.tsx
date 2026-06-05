import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type CommunicatorInput, type CommunicatorOutput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Copy,
  MessageSquareText,
  Phone,
  Save,
  ShieldAlert,
  Star,
  Wand2,
} from "lucide-react";

type Mode = "client" | "review";

type ExtractedReview = {
  platform: string;
  rating: string;
  text: string;
};

const SITUATIONS = [
  ["delayed_reply", "Zpožděná odpověď"],
  ["gold_deposit", "Deponované zlato / odměna"],
  ["delivery_delay", "Zpožděné dodání kovu"],
  ["complaint", "Reklamace / stížnost"],
  ["refund", "Refundace / vrácení peněz"],
  ["legal_notice", "Advokát / předžalobní výzva"],
  ["aml", "AML / identifikace"],
  ["review_negative", "Negativní recenze"],
  ["review_positive", "Pozitivní recenze"],
  ["general", "Obecná komunikace"],
];

const TONES = [
  ["human_apology", "Lidská omluva"],
  ["legally_cautious", "Právně opatrný"],
  ["crisis", "Krizový"],
  ["formal", "Formální"],
  ["vip", "VIP klient"],
  ["short", "Krátká SMS/WhatsApp"],
  ["public_safe", "Veřejně bezpečná recenze"],
];

const PRODUCT_TYPES = [
  "Investiční zlato",
  "Deponované zlato",
  "Gold Deposit",
  "Gold Pool",
  "Úschova / custody",
  "Výkup zlata",
  "E-shop objednávka",
  "Zlatnictví",
  "AML / identifikace",
  "Jiné",
];

function initialForm(): CommunicatorInput {
  return {
    mode: "client",
    client_name: "",
    client_email: "",
    product_type: "Investiční zlato",
    situation_type: "delayed_reply",
    client_message: "",
    review_platform: "Google",
    review_rating: "",
    review_text: "",
    what_happened: "",
    what_we_know: "",
    what_we_do_not_know: "",
    what_we_can_promise: "",
    what_we_must_not_promise: "",
    desired_output_types: {
      email: true,
      sms: true,
      whatsapp: true,
      phone_script: true,
      internal_note: true,
      html: true,
    },
    tone: "human_apology",
    risk_level: "medium",
    language: "cs",
    extra_instructions: "",
  };
}

export default function Communicator() {
  const { toast } = useToast();
  const [form, setForm] = useState<CommunicatorInput>(initialForm());
  const [result, setResult] = useState<CommunicatorOutput | null>(null);
  const [htmlImport, setHtmlImport] = useState("");
  const [selectedReview, setSelectedReview] = useState<number | null>(null);

  const templates = useQuery({
    queryKey: ["/api/communicator/templates"],
    queryFn: () => api.communicatorTemplates(),
  });

  const history = useQuery({
    queryKey: ["/api/communicator/history"],
    queryFn: () => api.communicatorHistory(),
  });

  const generate = useMutation({
    mutationFn: (input: CommunicatorInput) => api.communicatorGenerate(input),
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Výstup vygenerován", description: data.approval_required ? "Pozor: vyžaduje schválení." : "Text je připraven ke kontrole." });
    },
    onError: (e: any) => toast({ title: "Generování selhalo", description: e?.message || String(e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: () => api.communicatorSave(form, result || {}),
    onSuccess: () => {
      history.refetch();
      toast({ title: "Uloženo do historie" });
    },
    onError: (e: any) => toast({ title: "Uložení selhalo", description: e?.message || String(e), variant: "destructive" }),
  });

  const extractedReviews = useMemo(() => extractReviewsFromHtml(htmlImport), [htmlImport]);

  function update<K extends keyof CommunicatorInput>(key: K, value: CommunicatorInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setMode(mode: Mode) {
    setForm((f) => ({
      ...f,
      mode,
      situation_type: mode === "review" ? "review_negative" : "delayed_reply",
      tone: mode === "review" ? "public_safe" : "human_apology",
      risk_level: mode === "review" ? "high" : "medium",
    }));
    setResult(null);
  }

  async function copyText(text?: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast({ title: "Zkopírováno" });
  }

  function useExtractedReview(r: ExtractedReview, idx: number) {
    setSelectedReview(idx);
    setForm((f) => ({
      ...f,
      mode: "review",
      situation_type: "review_negative",
      tone: "public_safe",
      risk_level: "high",
      review_platform: r.platform || f.review_platform,
      review_rating: r.rating,
      review_text: r.text,
    }));
  }

  const approvalRequired = !!result?.approval_required;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GoldDesk Communicator</h1>
            <p className="text-sm text-muted-foreground">Bezpečné odpovědi klientům, HTML e-maily a reakce na recenze.</p>
          </div>
          <div className="flex gap-2">
            <Button variant={form.mode === "client" ? "default" : "outline"} onClick={() => setMode("client")}>
              <MessageSquareText className="mr-2 size-4" /> Klientská komunikace
            </Button>
            <Button variant={form.mode === "review" ? "default" : "outline"} onClick={() => setMode("review")}>
              <Star className="mr-2 size-4" /> Recenze
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-4 p-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Zadání</CardTitle>
              <CardDescription>Čím konkrétnější fakta, tím bezpečnější odpověď. Neověřená data raději napiš do pole „co nevíme“.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Klient">
                  <Input value={form.client_name || ""} onChange={(e) => update("client_name", e.target.value)} placeholder="pan Novák" />
                </Field>
                <Field label="E-mail">
                  <Input value={form.client_email || ""} onChange={(e) => update("client_email", e.target.value)} placeholder="volitelné" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Produkt">
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.product_type || ""} onChange={(e) => update("product_type", e.target.value)}>
                    {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Situace">
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.situation_type || ""} onChange={(e) => update("situation_type", e.target.value)}>
                    {SITUATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Tón">
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.tone || ""} onChange={(e) => update("tone", e.target.value)}>
                    {TONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Riziko">
                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.risk_level || "medium"} onChange={(e) => update("risk_level", e.target.value as any)}>
                    <option value="low">Nízké</option>
                    <option value="medium">Střední</option>
                    <option value="high">Vysoké</option>
                    <option value="critical">Kritické</option>
                  </select>
                </Field>
              </div>

              {form.mode === "review" ? (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Platforma">
                      <Input value={form.review_platform || ""} onChange={(e) => update("review_platform", e.target.value)} placeholder="Google / Heureka / Firmy.cz" />
                    </Field>
                    <Field label="Hodnocení">
                      <Input value={form.review_rating || ""} onChange={(e) => update("review_rating", e.target.value)} placeholder="např. 1/5" />
                    </Field>
                  </div>
                  <Field label="Text recenze">
                    <Textarea value={form.review_text || ""} onChange={(e) => update("review_text", e.target.value)} rows={5} placeholder="Vlož sem recenzi klienta..." />
                  </Field>
                </div>
              ) : (
                <Field label="Zpráva klienta">
                  <Textarea value={form.client_message || ""} onChange={(e) => update("client_message", e.target.value)} rows={5} placeholder="Vlož sem e-mail, SMS nebo stručný popis toho, co klient píše..." />
                </Field>
              )}

              <Field label="Co se stalo">
                <Textarea value={form.what_happened || ""} onChange={(e) => update("what_happened", e.target.value)} rows={3} placeholder="Např. neodpověděli jsme 14 dní, čeká na odměnu, dodávka se zdržela..." />
              </Field>
              <Field label="Co víme jistě">
                <Textarea value={form.what_we_know || ""} onChange={(e) => update("what_we_know", e.target.value)} rows={3} placeholder="Ověřená fakta: objednávka, datum, platba, stav kovu..." />
              </Field>
              <Field label="Co zatím nevíme">
                <Textarea value={form.what_we_do_not_know || ""} onChange={(e) => update("what_we_do_not_know", e.target.value)} rows={2} placeholder="Neověřený termín, čekáme na dodavatele, nutno ověřit smlouvu..." />
              </Field>
              <Field label="Co můžeme slíbit">
                <Textarea value={form.what_we_can_promise || ""} onChange={(e) => update("what_we_can_promise", e.target.value)} rows={2} placeholder="Jen to, co je reálně ověřené." />
              </Field>
              <Field label="Co nesmíme slíbit / říct">
                <Textarea value={form.what_we_must_not_promise || ""} onChange={(e) => update("what_we_must_not_promise", e.target.value)} rows={2} placeholder="Např. neověřený termín, uznání dluhu, právní závěr..." />
              </Field>
              <Field label="Doplňující instrukce">
                <Textarea value={form.extra_instructions || ""} onChange={(e) => update("extra_instructions", e.target.value)} rows={2} placeholder="Např. více lidsky, méně formálně, bez konkrétního data..." />
              </Field>

              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm">
                <Toggle label="E-mail" checked={!!form.desired_output_types?.email} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, email: v })} />
                <Toggle label="SMS" checked={!!form.desired_output_types?.sms} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, sms: v })} />
                <Toggle label="WhatsApp" checked={!!form.desired_output_types?.whatsapp} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, whatsapp: v })} />
                <Toggle label="Telefonní skript" checked={!!form.desired_output_types?.phone_script} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, phone_script: v })} />
                <Toggle label="Interní poznámka" checked={!!form.desired_output_types?.internal_note} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, internal_note: v })} />
                <Toggle label="HTML kód" checked={!!form.desired_output_types?.html} onChange={(v) => update("desired_output_types", { ...form.desired_output_types, html: v })} />
              </div>

              <Button className="w-full" size="lg" onClick={() => generate.mutate(form)} disabled={generate.isPending}>
                <Wand2 className="mr-2 size-4" /> {generate.isPending ? "Generuji..." : "Vygenerovat komunikaci"}
              </Button>
            </CardContent>
          </Card>

          {form.mode === "review" && (
            <Card>
              <CardHeader>
                <CardTitle>Import recenzí z HTML</CardTitle>
                <CardDescription>Vlož HTML export/část stránky. Nástroj zkusí vytáhnout texty recenzí pro rychlé zpracování.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea value={htmlImport} onChange={(e) => setHtmlImport(e.target.value)} rows={6} placeholder="Vlož sem HTML stránky s recenzemi..." />
                <div className="space-y-2">
                  {extractedReviews.length === 0 && htmlImport && <p className="text-sm text-muted-foreground">Nenašla jsem jednoznačné recenze. Zkus vložit větší část HTML nebo text recenze ručně.</p>}
                  {extractedReviews.slice(0, 5).map((r, idx) => (
                    <button key={`${r.text}-${idx}`} onClick={() => useExtractedReview(r, idx)} className={`w-full rounded-lg border p-3 text-left text-sm hover:bg-muted ${selectedReview === idx ? "border-primary bg-primary/5" : ""}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <Badge variant="outline">{r.platform}</Badge>
                        <span className="text-xs text-muted-foreground">{r.rating || "bez ratingu"}</span>
                      </div>
                      <p className="line-clamp-3">{r.text}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <InfoCard title="Šablony" value={String(templates.data?.length || 0)} description="přednastavené situace" />
            <InfoCard title="Historie" value={String(history.data?.length || 0)} description="uložené výstupy" />
            <InfoCard title="Režim" value={form.mode === "review" ? "Recenze" : "Klient"} description="aktuální workflow" />
          </div>

          {approvalRequired && (
            <Alert variant="destructive">
              <ShieldAlert className="size-4" />
              <AlertTitle>Vyžaduje schválení</AlertTitle>
              <AlertDescription>Tento výstup je rizikový. Před odesláním nebo zveřejněním jej musí schválit vedení / právník.</AlertDescription>
            </Alert>
          )}

          {!result ? (
            <Card className="min-h-[360px]">
              <CardHeader>
                <CardTitle>Výstup</CardTitle>
                <CardDescription>Po vygenerování se zde zobrazí e-mail, SMS, WhatsApp, telefonní skript, interní kontrola, HTML kód a reakce na recenzi.</CardDescription>
              </CardHeader>
              <CardContent className="grid min-h-[240px] place-items-center text-center text-muted-foreground">
                <div>
                  <Wand2 className="mx-auto mb-3 size-10" />
                  <p>Zadej situaci vlevo a spusť generování.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>{result.subject || "Vygenerovaný výstup"}</CardTitle>
                  <CardDescription>{result.summary}</CardDescription>
                </div>
                <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
                  <Save className="mr-2 size-4" /> Uložit
                </Button>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={form.mode === "review" ? "review" : "email"}>
                  <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
                    {form.mode === "client" && <TabsTrigger value="email">E-mail</TabsTrigger>}
                    {form.mode === "client" && <TabsTrigger value="sms">SMS</TabsTrigger>}
                    {form.mode === "client" && <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>}
                    {form.mode === "client" && <TabsTrigger value="phone">Telefon</TabsTrigger>}
                    {form.mode === "review" && <TabsTrigger value="review">Recenze</TabsTrigger>}
                    <TabsTrigger value="html"><Code2 className="mr-1 size-4" /> HTML</TabsTrigger>
                    <TabsTrigger value="risk"><AlertTriangle className="mr-1 size-4" /> Rizika</TabsTrigger>
                    <TabsTrigger value="internal"><CheckCircle2 className="mr-1 size-4" /> Checklist</TabsTrigger>
                  </TabsList>

                  <OutputTab value="email" title="E-mail klientovi" text={result.email_text} onCopy={copyText} />
                  <OutputTab value="sms" title="SMS" text={result.sms_text} onCopy={copyText} />
                  <OutputTab value="whatsapp" title="WhatsApp" text={result.whatsapp_text} onCopy={copyText} />
                  <OutputTab value="phone" title="Telefonní skript" text={result.phone_script} onCopy={copyText} icon={<Phone className="size-4" />} />
                  <OutputTab value="review" title="Veřejná odpověď na recenzi" text={result.review_reply} onCopy={copyText} />

                  <TabsContent value="html">
                    <OutputPanel title="HTML kód" text={result.html_output} onCopy={copyText} mono />
                    <div className="mt-4 rounded-lg border bg-background p-4">
                      <div className="mb-2 text-sm font-medium">Náhled HTML</div>
                      <iframe title="html-preview" className="h-[360px] w-full rounded-md border bg-white" srcDoc={result.html_output || ""} />
                    </div>
                  </TabsContent>

                  <TabsContent value="risk">
                    <div className="grid gap-4 md:grid-cols-2">
                      <RiskBox title="Právní / reputační / finanční riziko" data={result.risk_analysis} />
                      <ListBox title="Formulace, kterým se vyhnout" items={result.phrases_to_avoid} danger />
                      <ListBox title="Bezpečnější formulace" items={result.safe_wording} />
                      <ListBox title="Doporučený další postup" items={result.recommended_next_steps} />
                    </div>
                  </TabsContent>

                  <TabsContent value="internal">
                    <div className="grid gap-4 md:grid-cols-2">
                      <OutputPanel title="Interní poznámka" text={result.internal_note} onCopy={copyText} />
                      <ListBox title="Ověřit před použitím" items={result.checklist} />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Knihovna šablon</CardTitle>
              <CardDescription>Pevné režimy, které pomáhají zaměstnancům držet bezpečnou komunikační linku.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {(templates.data || []).slice(0, 8).map((t: any) => (
                <button key={t.id || `${t.category}-${t.name}`} className="rounded-lg border p-3 text-left hover:bg-muted" onClick={() => setForm((f) => ({ ...f, situation_type: t.category, tone: t.tone, risk_level: t.risk_level || f.risk_level, extra_instructions: t.template_text || f.extra_instructions }))}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant={t.risk_level === "high" || t.risk_level === "critical" ? "destructive" : "secondary"}>{t.risk_level}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.template_text}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border" />
      <span>{label}</span>
    </label>
  );
}

function InfoCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function OutputTab({ value, title, text, onCopy, icon }: { value: string; title: string; text?: string; onCopy: (text?: string) => void; icon?: ReactNode }) {
  return (
    <TabsContent value={value}>
      <OutputPanel title={title} text={text} onCopy={onCopy} icon={icon} />
    </TabsContent>
  );
}

function OutputPanel({ title, text, onCopy, mono, icon }: { title: string; text?: string; onCopy: (text?: string) => void; mono?: boolean; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 font-medium">{icon}{title}</div>
        <Button size="sm" variant="outline" onClick={() => onCopy(text)} disabled={!text}>
          <Copy className="mr-2 size-4" /> Kopírovat
        </Button>
      </div>
      <pre className={`max-h-[520px] overflow-auto whitespace-pre-wrap p-4 text-sm ${mono ? "font-mono" : "font-sans"}`}>{text || "—"}</pre>
    </div>
  );
}

function RiskBox({ title, data }: { title: string; data: any }) {
  const reasoning = Array.isArray(data?.reasoning) ? data.reasoning : [];
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3 font-medium">{title}</div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge variant="outline">Právní: {data?.legal || "—"}</Badge>
        <Badge variant="outline">Reputace: {data?.reputational || "—"}</Badge>
        <Badge variant="outline">Finance: {data?.financial || "—"}</Badge>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {reasoning.map((r: string, i: number) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  );
}

function ListBox({ title, items, danger }: { title: string; items?: string[]; danger?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3 flex items-center gap-2 font-medium">
        {danger ? <AlertTriangle className="size-4 text-destructive" /> : <CheckCircle2 className="size-4 text-primary" />}
        {title}
      </div>
      {items && items.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((x, i) => <li key={`${x}-${i}`}>{x}</li>)}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

function extractReviewsFromHtml(html: string): ExtractedReview[] {
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  if (!cleaned.trim()) return [];
  const text = cleaned
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const chunks = text.split(/\n{2,}|(?=\b(?:Hodnocení|Recenze|Google|Heureka|Firmy\.cz)\b)/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 45 && x.length < 1200);

  const ratingRegex = /(\b[1-5]\s*(?:\/\s*5|hvězdič(?:ek|ky|ka)?|stars?)\b)|([★⭐]{1,5})/i;
  const results: ExtractedReview[] = [];
  for (const c of chunks) {
    if (!/(recenz|hvězd|star|google|heureka|firmy|doporučuji|nedoporučuji|objedn|komunikac|zboží|zlato|klient|spokojen|nespokojen)/i.test(c)) continue;
    const rating = c.match(ratingRegex)?.[0] || "";
    const platform = /heureka/i.test(c) ? "Heureka" : /firmy/i.test(c) ? "Firmy.cz" : /google/i.test(c) ? "Google" : "Import HTML";
    const reviewText = c.replace(/^(Recenze|Hodnocení)\s*[:\-]?\s*/i, "").trim();
    if (!results.some((r) => r.text === reviewText)) results.push({ platform, rating, text: reviewText });
  }
  return results.slice(0, 12);
}
