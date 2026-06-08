import { z } from "zod";
import { config } from "./config";
import { llmJSON, resolveProviderModel } from "./ai";

const outputTypesSchema = z.object({
  email: z.boolean().default(true),
  sms: z.boolean().default(true),
  whatsapp: z.boolean().default(true),
  phone_script: z.boolean().default(true),
  internal_note: z.boolean().default(true),
  html: z.boolean().default(true),
});

export const communicationGenerateSchema = z.object({
  mode: z.enum(["client", "review"]).default("client"),
  client_name: z.string().optional().default(""),
  client_email: z.string().optional().default(""),
  product_type: z.string().optional().default(""),
  situation_type: z.string().optional().default("delayed_reply"),
  client_message: z.string().optional().default(""),
  review_platform: z.string().optional().default(""),
  review_rating: z.string().optional().default(""),
  review_text: z.string().optional().default(""),
  source_document_name: z.string().optional().default(""),
  source_document_type: z.string().optional().default(""),
  source_document_summary: z.string().optional().default(""),
  source_document_text: z.string().optional().default(""),
  what_happened: z.string().optional().default(""),
  what_we_know: z.string().optional().default(""),
  what_we_do_not_know: z.string().optional().default(""),
  what_we_can_promise: z.string().optional().default(""),
  what_we_must_not_promise: z.string().optional().default(""),
  desired_output_types: outputTypesSchema.default({
    email: true,
    sms: true,
    whatsapp: true,
    phone_script: true,
    internal_note: true,
    html: true,
  }),
  tone: z.string().optional().default("direct_human"),
  risk_level: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  creativity: z.number().min(0).max(100).optional().default(55),
  formality: z.number().min(0).max(100).optional().default(35),
  empathy: z.number().min(0).max(100).optional().default(75),
  owner_mode: z.boolean().optional().default(true),
  risk_advisory_only: z.boolean().optional().default(true),
  language: z.string().optional().default("cs"),
  extra_instructions: z.string().optional().default(""),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export type CommunicationGenerateInput = z.infer<typeof communicationGenerateSchema>;

const COMMUNICATION_SCHEMA = `{
  "mode": "client|review",
  "subject": "...",
  "summary": "...",
  "email_text": "...",
  "sms_text": "...",
  "whatsapp_text": "...",
  "phone_script": "...",
  "internal_note": "...",
  "review_reply": "...",
  "html_output": "<!doctype html>...",
  "risk_analysis": {
    "legal": "low|medium|high|critical",
    "reputational": "low|medium|high|critical",
    "financial": "low|medium|high|critical",
    "reasoning": ["...", "..."]
  },
  "phrases_to_avoid": ["..."],
  "safe_wording": ["..."],
  "checklist": ["..."],
  "recommended_next_steps": ["..."],
  "approval_required": true,
  "html_notes": ["..."]
}`;

const SYS_COMMUNICATOR = `Jsi osobní komunikační poradce majitelky/vedení české společnosti obchodující s drahými kovy.
Tvým úkolem je vytvořit použitelné, lidské a obchodně chytré výstupy pro klienty, e-mail, SMS, WhatsApp, telefonický scénář, interní poznámku, HTML kód e-mailu a reakce na veřejné recenze.

Primární cíl každé odpovědi:
1. udržet zákazníka, pokud to alespoň trochu dává obchodní smysl,
2. obnovit důvěru,
3. ochránit značku a reputaci,
4. nezhoršit právní pozici firmy,
5. dostat komunikaci zpět pod kontrolu konkrétním dalším krokem.

Styl:
- Piš jako reálný člověk, ne jako compliance oddělení, banka nebo úřad.
- Vyhni se hyperkorektním frázím, korporátní vatě, sterilním omluvám a umělým formulacím.
- Preferuj krátké věty, přímou odpovědnost, jasný další krok a přirozenou omluvu.
- Nepoužívej přehnaně slova typu „rádi bychom“, „dovolujeme si“, „vážíme si Vaší zpětné vazby“, pokud by text zněl uměle.
- U nespokojeného klienta má být odpověď klidná, lidská, konkrétní a směřovaná k narovnání vztahu.
- U recenzí má veřejná odpověď působit sebevědomě, slušně a lidsky: žádný útok, žádné vymlouvání, žádné zveřejnění detailů.

Fakta a rizika:
- Nevymýšlej fakta, termíny, částky, právní závěry ani sliby.
- Když něco není ověřené, napiš to normálně: „Nechci Vám psát neověřený termín.“
- Rizika neblokují výstup. Uživatel je majitel/vedení a chce poradenský režim, nikoliv regulační filtr.
- Risk analysis a phrases_to_avoid vrať jako doporučení, ne jako zákaz.
- approval_required ponech false, pokud uživatel výslovně nepožádá o schvalovací režim. Citlivost popiš v risk_analysis a checklistu.
- Nepřiznávej právní odpovědnost, dluh, porušení smlouvy, zpronevěru, použití klientských prostředků nebo garantovaný termín, pokud to není výslovně ověřeno v zadání.
- U Gold Deposit / deponovaného zlata / odměn / výnosů nepoužívej investiční sliby, garantovaný výnos ani neověřené datum výplaty.
- U recenzí nezveřejňuj osobní údaje, smluvní detaily, částky ani zdravotní/finanční informace.
- Vždy vrať validní JSON podle schématu.

Nastavení stylu z uživatelského promptu:
- creativity 0 = velmi věcně; 100 = výraznější, osobnější, obchodně kreativní.
- formality 0 = velmi civilně; 100 = velmi formálně.
- empathy 0 = tvrdě a stručně; 100 = hodně lidsky a vztahově.

HTML výstup:
- Vytvoř samostatný bezpečný HTML blok pro e-mail/newsletter nebo veřejnou odpověď.
- Používej inline CSS, jednoduchý responzivní layout, bez externích skriptů, bez externích fontů, bez tracking pixelů.
- HTML musí být vložitelné do Shoptetu, e-mailového nástroje nebo interního náhledu.
- CTA tlačítko nech jako href="#" nebo {{CTA_URL}}, pokud není URL zadána.`;

function buildUserPrompt(input: CommunicationGenerateInput) {
  return `=== Režim ===
${input.mode === "review" ? "Reakce na veřejnou recenzi" : "Komunikace s klientem"}

=== Identifikace ===
Klient: ${input.client_name || "(neuvedeno)"}
E-mail: ${input.client_email || "(neuvedeno)"}
Produkt/služba: ${input.product_type || "(neuvedeno)"}
Typ situace: ${input.situation_type || "(neuvedeno)"}
Tón: ${input.tone || "lidský, odpovědný, právně opatrný"}
Riziko: ${input.risk_level}
Kreativita: ${input.creativity ?? 55}/100
Formálnost: ${input.formality ?? 35}/100
Empatie/lidskost: ${input.empathy ?? 75}/100
Režim majitele: ${input.owner_mode ? "ano – žádné blokace, rizika jen jako doporučení" : "ne"}
Rizika pouze jako doporučení: ${input.risk_advisory_only ? "ano" : "ne"}
Jazyk: ${input.language || "cs"}

=== Zpráva klienta ===
${input.client_message || "(neuvedeno)"}

=== Recenze ===
Platforma: ${input.review_platform || "(netýká se)"}
Hodnocení: ${input.review_rating || "(neuvedeno)"}
Text recenze: ${input.review_text || "(neuvedeno)"}

=== Zdrojový dokument / automatická analýza ===
Název dokumentu: ${input.source_document_name || "(neuvedeno)"}
Typ dokumentu: ${input.source_document_type || "(neuvedeno)"}
Shrnutí dokumentu: ${input.source_document_summary || "(neuvedeno)"}
Text / relevantní výňatek dokumentu:
${(input.source_document_text || "(neuvedeno)").slice(0, 22000)}

=== Co se stalo ===
${input.what_happened || "(neuvedeno)"}

=== Co víme jistě ===
${input.what_we_know || "(neuvedeno)"}

=== Co zatím nevíme ===
${input.what_we_do_not_know || "(neuvedeno)"}

=== Co můžeme slíbit ===
${input.what_we_can_promise || "(nic konkrétního není ověřeno)"}

=== Co nesmíme slíbit / říct ===
${input.what_we_must_not_promise || "(neuvedeno)"}

=== Požadované výstupy ===
${JSON.stringify(input.desired_output_types, null, 2)}

=== Doplňující instrukce ===
${input.extra_instructions || "(žádné)"}

Vygeneruj jen výstupy, které dávají smysl pro zadaný režim. U režimu review vyplň především review_reply a html_output; u režimu client vyplň e-mail, SMS, WhatsApp, telefonní skript, interní poznámku a HTML e-mail.

Důležité: text nesmí znít uměle. První verze má být prakticky použitelná bez velkého přepisování. Primárně drž klienta, obnov důvěru a chraň značku.`;
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function fallbackHtml(title: string, body: string, cta = "Kontaktovat nás") {
  const safeTitle = escapeHtml(title || "Odpověď klientovi");
  const paragraphs = escapeHtml(body || "").split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px 0;line-height:1.6;color:#2b2b2b;">${p.replace(/\n/g, "<br>")}</p>`).join("\n");
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ea;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
    <div style="background:#ffffff;border:1px solid #e6dcc7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.06);">
      <div style="padding:24px 28px;background:linear-gradient(135deg,#171717,#6d5526);color:#ffffff;">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#e9d8a6;">Moje zlato</div>
        <h1 style="font-size:24px;line-height:1.25;margin:8px 0 0 0;">${safeTitle}</h1>
      </div>
      <div style="padding:26px 28px;">
        ${paragraphs}
        <div style="margin-top:22px;">
          <a href="{{CTA_URL}}" style="display:inline-block;background:#9a7a2f;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">${escapeHtml(cta)}</a>
        </div>
      </div>
      <div style="padding:16px 28px;background:#faf7ef;color:#6b7280;font-size:12px;line-height:1.5;">
        Tento text je návrh ke kontrole. Před odesláním ověřte faktické údaje, termíny a schválení u citlivých případů.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fallbackResult(input: CommunicationGenerateInput) {
  const approvalRequired = input.risk_advisory_only !== true && (input.risk_level === "high" || input.risk_level === "critical" || ["gold_deposit", "refund", "legal_notice", "aml", "review_negative"].includes(input.situation_type));
  if (input.mode === "review") {
    const reviewReply = `Dobrý den, děkujeme za zpětnou vazbu. Mrzí mě, že jste měl/a takovou zkušenost. Nechci to odbýt obecnou odpovědí ve veřejné recenzi — napište nám prosím přímo, abychom mohli dohledat konkrétní případ a najít férové řešení. Děkuji.`;
    return {
      mode: "review",
      subject: "Reakce na recenzi",
      summary: "Fallback návrh bez AI. Je nutné doplnit konkrétní fakta ručně.",
      email_text: "",
      sms_text: "",
      whatsapp_text: "",
      phone_script: "",
      internal_note: "Ověřit recenzi, objednávku, klienta, poslední komunikaci a zda odpověď neobsahuje osobní údaje.",
      review_reply: reviewReply,
      html_output: fallbackHtml("Reakce na recenzi", reviewReply, "Kontaktovat podporu"),
      risk_analysis: { legal: input.risk_level, reputational: input.risk_level, financial: "medium", reasoning: ["Veřejná odpověď nesmí obsahovat osobní údaje ani detail smluvního vztahu."] },
      phrases_to_avoid: ["zveřejnění detailů objednávky", "obviňování klienta", "uznání právní odpovědnosti bez ověření"],
      safe_wording: ["situaci prověříme", "kontaktujte nás přímo", "děkujeme za zpětnou vazbu"],
      checklist: ["Dohledat klienta", "Ověřit průběh objednávky", "Zkontrolovat poslední komunikaci", "Schválit před zveřejněním"],
      recommended_next_steps: ["Veřejně odpovědět stručně a lidsky", "Detail řešit mimo veřejnou platformu", "Kontaktovat klienta aktivně, pokud jej lze dohledat"],
      approval_required: approvalRequired,
      html_notes: ["HTML je fallback šablona bez AI."],
    };
  }

  const email = `Dobrý den${input.client_name ? `, ${input.client_name}` : ""},

omlouvám se, že jste od nás neměl/a včas jasnou a konkrétní informaci. To není v pořádku a chápu, že to ve Vás mohlo vyvolat nejistotu.

Vaši věc teď beru k prověření podle dostupných podkladů. Nechci Vám psát neověřený termín nebo obecnou odpověď, která Vám reálně nepomůže. Jakmile ověřím stav věci, pošlu Vám konkrétní další postup.

Mým cílem je situaci narovnat a dát Vám jasnou odpověď, ne Vás nechat čekat bez informace.`;
  return {
    mode: "client",
    subject: "Omluva a další postup",
    summary: "Fallback návrh bez AI. Je nutné doplnit konkrétní fakta ručně.",
    email_text: email,
    sms_text: `Dobrý den${input.client_name ? `, ${input.client_name}` : ""}, omlouvám se, že jste od nás neměl/a včas jasnou informaci. Vaši věc prověřuji a po ověření Vám pošlu konkrétní odpověď. Děkuji za trpělivost.`,
    whatsapp_text: `Dobrý den${input.client_name ? `, ${input.client_name}` : ""}, omlouvám se za nedostatečnou komunikaci. Vaši věc nyní prověřuji a nechci Vám psát neověřený termín. Ozvu se s konkrétní informací po ověření podkladů.`,
    phone_script: "Začněte omluvou za komunikaci. Nepřiznávejte právní odpovědnost. Neuvádějte neověřený termín. Slíbte pouze ověření a konkrétní další kontakt.",
    internal_note: "Ověřit smlouvu, objednávku, platby, poslední komunikaci, reálný termín a kdo odpověď schvaluje.",
    review_reply: "",
    html_output: fallbackHtml("Omluva a další postup", email, "Kontaktovat nás"),
    risk_analysis: { legal: input.risk_level, reputational: input.risk_level, financial: "medium", reasoning: ["Komunikace obsahuje omluvu za proces, nikoli uznání právního nároku."] },
    phrases_to_avoid: ["porušili jsme smlouvu", "určitě zaplatíme/dodáme do neověřeného termínu", "peníze jsme použili jinam"],
    safe_wording: ["komunikace nebyla dostatečná", "věc prověřujeme", "nechci Vám dávat neověřený termín"],
    checklist: ["Ověřit smlouvu", "Ověřit poslední komunikaci", "Ověřit termín", "Schválení vedením u rizikových případů"],
    recommended_next_steps: ["Doplnit konkrétní termín až po ověření", "Uložit odpověď do historie", "Vytvořit interní úkol"],
    approval_required: approvalRequired,
    html_notes: ["HTML je fallback šablona bez AI."],
  };
}

export async function generateCommunication(input: CommunicationGenerateInput): Promise<any> {
  if (!config.ai.provider && !process.env.AI_MODEL && !process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL && !process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.PERPLEXITY_API_KEY) {
    return fallbackResult(input);
  }
  const pm = resolveProviderModel(config.ai.draftModel, input.provider, input.model);
  const json = await llmJSON(SYS_COMMUNICATOR, buildUserPrompt(input).slice(0, 30000), COMMUNICATION_SCHEMA, pm);
  const result = typeof json === "object" && json ? json : {};
  const fallback = fallbackResult(input);
  const body = input.mode === "review" ? (result.review_reply || fallback.review_reply) : (result.email_text || fallback.email_text);
  return {
    ...fallback,
    ...result,
    mode: input.mode,
    risk_analysis: result.risk_analysis || fallback.risk_analysis,
    phrases_to_avoid: normalizeArray(result.phrases_to_avoid).length ? normalizeArray(result.phrases_to_avoid) : fallback.phrases_to_avoid,
    safe_wording: normalizeArray(result.safe_wording).length ? normalizeArray(result.safe_wording) : fallback.safe_wording,
    checklist: normalizeArray(result.checklist).length ? normalizeArray(result.checklist) : fallback.checklist,
    recommended_next_steps: normalizeArray(result.recommended_next_steps).length ? normalizeArray(result.recommended_next_steps) : fallback.recommended_next_steps,
    html_notes: normalizeArray(result.html_notes),
    html_output: result.html_output || fallbackHtml(result.subject || fallback.subject, body, input.mode === "review" ? "Kontaktovat podporu" : "Kontaktovat nás"),
    approval_required: input.risk_advisory_only === true ? false : Boolean(result.approval_required ?? fallback.approval_required),
  };
}


const DOCUMENT_ANALYSIS_SCHEMA = `{
  "mode": "client|review",
  "client_name": "...",
  "client_email": "...",
  "product_type": "...",
  "situation_type": "delayed_reply|gold_deposit|delivery_delay|complaint|refund|legal_notice|aml|review_negative|review_positive|general",
  "client_message": "...",
  "review_platform": "...",
  "review_rating": "...",
  "review_text": "...",
  "what_happened": "...",
  "what_we_know": "...",
  "what_we_do_not_know": "...",
  "what_we_can_promise": "...",
  "what_we_must_not_promise": "...",
  "tone": "human_apology|legally_cautious|crisis|formal|vip|short|public_safe",
  "risk_level": "low|medium|high|critical",
  "extra_instructions": "...",
  "summary": "...",
  "extracted_facts": ["..."],
  "missing_information": ["..."],
  "risks": ["..."],
  "suggested_action": "...",
  "confidence": "low|medium|high"
}`;

const SYS_DOCUMENT_ANALYZER = `Jsi analytik obchodní, právní a klientské komunikace pro českou společnost obchodující s drahými kovy.
Z vloženého PDF/HTML/textového dokumentu máš připravit strukturované zadání pro komunikační modul.

Cíl:
- vytáhni podstatná fakta, požadavek klienta, typ situace, rizika a doporučený tón,
- připrav hodnoty tak, aby uživatel nemusel ručně vyplňovat formulář,
- pokud jde o veřejnou recenzi, nastav mode=review a vyplň review_* pole,
- pokud jde o e-mail, reklamaci, výzvu, objednávku, datovou zprávu nebo interní podklad, nastav mode=client,
- nevymýšlej jména, částky, termíny ani právní závěry; neověřené údaje dej do missing_information nebo what_we_do_not_know,
- u Gold Deposit, deponovaného zlata, výnosu, odměny, refundace, advokáta, banky, AML, custody a zpožděného dodání nastav high nebo critical podle povahy věci,
- vždy vrať pouze validní JSON podle schématu.`;

export interface CommunicationDocumentAnalysis {
  mode: "client" | "review";
  client_name?: string;
  client_email?: string;
  product_type?: string;
  situation_type?: string;
  client_message?: string;
  review_platform?: string;
  review_rating?: string;
  review_text?: string;
  what_happened?: string;
  what_we_know?: string;
  what_we_do_not_know?: string;
  what_we_can_promise?: string;
  what_we_must_not_promise?: string;
  tone?: string;
  risk_level?: "low" | "medium" | "high" | "critical";
  extra_instructions?: string;
  summary?: string;
  extracted_facts?: string[];
  missing_information?: string[];
  risks?: string[];
  suggested_action?: string;
  confidence?: "low" | "medium" | "high";
}

export async function analyzeCommunicationDocument(opts: {
  filename?: string;
  mimeType?: string;
  text: string;
  modeHint?: "client" | "review" | "auto";
  provider?: string;
  model?: string;
}): Promise<CommunicationDocumentAnalysis> {
  const raw = (opts.text || "").trim();
  const fallback = fallbackDocumentAnalysis(raw, opts.filename || "", opts.modeHint || "auto");
  if (!raw) return fallback;

  const pm = resolveProviderModel(config.ai.draftModel, opts.provider, opts.model);
  const prompt = `=== Dokument ===\nNázev: ${opts.filename || "(bez názvu)"}\nMIME/type: ${opts.mimeType || "(neuvedeno)"}\nPreferovaný režim: ${opts.modeHint || "auto"}\n\n=== Extrahovaný text ===\n${raw.slice(0, 30000)}\n\nVrať strukturované zadání pro komunikaci. Pokud text obsahuje více nesouvisejících věcí, zaměř se na nejrizikovější nebo hlavní klientský požadavek.`;

  try {
    const json = await llmJSON(SYS_DOCUMENT_ANALYZER, prompt, DOCUMENT_ANALYSIS_SCHEMA, pm);
    const result = typeof json === "object" && json ? json as Partial<CommunicationDocumentAnalysis> : {};
    return normalizeDocumentAnalysis({ ...fallback, ...result });
  } catch (e) {
    return fallback;
  }
}

function normalizeDocumentAnalysis(x: Partial<CommunicationDocumentAnalysis>): CommunicationDocumentAnalysis {
  const mode = x.mode === "review" ? "review" : "client";
  const risk = ["low", "medium", "high", "critical"].includes(String(x.risk_level)) ? x.risk_level as any : "medium";
  return {
    mode,
    client_name: cleanLine(x.client_name),
    client_email: cleanLine(x.client_email),
    product_type: cleanLine(x.product_type) || "Investiční zlato",
    situation_type: cleanLine(x.situation_type) || (mode === "review" ? "review_negative" : "general"),
    client_message: cleanBlock(x.client_message),
    review_platform: cleanLine(x.review_platform),
    review_rating: cleanLine(x.review_rating),
    review_text: cleanBlock(x.review_text),
    what_happened: cleanBlock(x.what_happened),
    what_we_know: cleanBlock(x.what_we_know),
    what_we_do_not_know: cleanBlock(x.what_we_do_not_know),
    what_we_can_promise: cleanBlock(x.what_we_can_promise),
    what_we_must_not_promise: cleanBlock(x.what_we_must_not_promise),
    tone: cleanLine(x.tone) || (mode === "review" ? "public_safe" : "legally_cautious"),
    risk_level: risk,
    extra_instructions: cleanBlock(x.extra_instructions),
    summary: cleanBlock(x.summary),
    extracted_facts: normalizeArray(x.extracted_facts),
    missing_information: normalizeArray(x.missing_information),
    risks: normalizeArray(x.risks),
    suggested_action: cleanBlock(x.suggested_action),
    confidence: x.confidence === "high" || x.confidence === "low" ? x.confidence : "medium",
  };
}

function fallbackDocumentAnalysis(text: string, filename: string, modeHint: string): CommunicationDocumentAnalysis {
  const lower = `${filename}\n${text}`.toLowerCase();
  const looksReview = modeHint === "review" || /(google|heureka|firmy\.cz|recenz|hvězd|stars?|★|⭐)/i.test(text.slice(0, 5000));
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const risk: "low" | "medium" | "high" | "critical" = /(advokát|předžalob|žalob|policie|čnb|faú|banka|aml|trestn|zpronevěr)/i.test(lower)
    ? "critical"
    : /(refund|vrácení peněz|odměn|výnos|deponovan|gold deposit|custody|nedodán|prodlen|reklamac|stížnost)/i.test(lower)
      ? "high"
      : "medium";
  const situation = /(advokát|předžalob|žalob)/i.test(lower) ? "legal_notice"
    : /(aml|identifikac|faú)/i.test(lower) ? "aml"
    : /(refund|vrácení peněz|storno)/i.test(lower) ? "refund"
    : /(deponovan|gold deposit|odměn|výnos)/i.test(lower) ? "gold_deposit"
    : /(nedodán|dodání|zdrž|skladem|objednávk)/i.test(lower) ? "delivery_delay"
    : looksReview ? "review_negative"
    : /(reklamac|stížnost|nespokojen)/i.test(lower) ? "complaint"
    : "general";
  const excerpt = text.replace(/\s+/g, " ").trim().slice(0, 1800);
  return {
    mode: looksReview ? "review" : "client",
    client_email: email,
    product_type: /(deponovan|gold deposit|gold pool)/i.test(lower) ? "Gold Deposit" : "Investiční zlato",
    situation_type: situation,
    client_message: looksReview ? "" : excerpt,
    review_platform: /heureka/i.test(lower) ? "Heureka" : /firmy/i.test(lower) ? "Firmy.cz" : /google/i.test(lower) ? "Google" : "Import dokumentu",
    review_rating: text.match(/([1-5]\s*(?:\/\s*5|hvězdič(?:ek|ky|ka)?|stars?))|([★⭐]{1,5})/i)?.[0] || "",
    review_text: looksReview ? excerpt : "",
    what_happened: excerpt,
    what_we_know: "Automaticky extrahováno z dokumentu. Před odesláním ověřit fakta proti smlouvám, objednávce a interní evidenci.",
    what_we_do_not_know: "Přesný právní stav, splnění smluvních podmínek, aktuální stav objednávky/platby/kovu a ověřený termín dalšího kroku.",
    what_we_can_promise: "Lze slíbit pouze prověření věci a konkrétní následný kontakt v ověřeném termínu.",
    what_we_must_not_promise: "Neslibovat neověřený termín, výplatu, refundaci, právní nárok, uznání dluhu ani porušení smlouvy bez schválení.",
    tone: looksReview ? "public_safe" : (risk === "critical" ? "legally_cautious" : "human_apology"),
    risk_level: risk,
    extra_instructions: "Text byl předvyplněn z dokumentu. Před použitím ověřit extrahovaná fakta a odstranit vše, co není potvrzené.",
    summary: excerpt || "Dokument se nepodařilo spolehlivě shrnout bez ruční kontroly.",
    extracted_facts: excerpt ? [excerpt] : [],
    missing_information: ["Ověřit identitu klienta", "Ověřit smlouvu/objednávku", "Ověřit aktuální stav plnění", "Ověřit, co již bylo klientovi slíbeno"],
    risks: risk === "critical" ? ["Možná právní výzva nebo institucionální komunikace", "Vyžaduje právní/management schválení"] : ["Automatická extrakce může být neúplná", "Před odesláním ověřit fakta"],
    suggested_action: "Nejdříve ověřit fakta v interní evidenci, poté použít bezpečnou odpověď bez neověřených slibů.",
    confidence: text.trim().length > 400 ? "medium" : "low",
  };
}

function cleanLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

function cleanBlock(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 12000) : "";
}

export const BUILTIN_COMMUNICATION_TEMPLATES = [
  { name: "Omluva za zpožděnou odpověď", category: "delayed_reply", tone: "human_apology", risk_level: "medium", template_text: "Přiznat nedostatečnou komunikaci, nevymýšlet termín, slíbit ověření a další konkrétní kontakt." },
  { name: "Deponované zlato / odměna", category: "gold_deposit", tone: "legally_cautious", risk_level: "high", template_text: "Omluva za komunikaci, ověření podle smlouvy/evidence kovu, bez garance výnosu nebo neověřeného data." },
  { name: "Zpožděné dodání fyzického kovu", category: "delivery_delay", tone: "formal", risk_level: "high", template_text: "Vysvětlit dostupnost u rafinérie/distributora jen pokud je ověřená, uvést další postup, neuznávat právní prodlení bez kontroly." },
  { name: "Negativní veřejná recenze", category: "review_negative", tone: "public_safe", risk_level: "high", template_text: "Poděkovat, neútočit, nezveřejňovat detaily, pozvat klienta do soukromého řešení." },
  { name: "Žádost o refundaci", category: "refund", tone: "legally_cautious", risk_level: "high", template_text: "Potvrdit přijetí žádosti, prověřit smlouvu a platby, neslíbit vrácení bez schválení." },
  { name: "AML identifikace", category: "aml", tone: "formal", risk_level: "medium", template_text: "Vysvětlit zákonnou povinnost identifikace a kontroly klienta, nehodnotit klienta osobně." },
  { name: "Advokát / předžalobní výzva", category: "legal_notice", tone: "legally_cautious", risk_level: "critical", template_text: "Potvrdit přijetí, sdělit, že věc prověřujeme, žádné věcné uznání bez právní kontroly." },
];
