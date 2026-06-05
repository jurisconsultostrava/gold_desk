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
  tone: z.string().optional().default("human_apology"),
  risk_level: z.enum(["low", "medium", "high", "critical"]).default("medium"),
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

const SYS_COMMUNICATOR = `Jsi seniorní klientský, právní a reputační komunikační asistent pro českou společnost obchodující s drahými kovy.
Tvým úkolem je vytvořit bezpečné a použitelné komunikační výstupy pro klienty, e-mail, SMS, WhatsApp, telefonický scénář, interní instrukce, HTML kód e-mailu a reakce na veřejné recenze.

Tvrdá pravidla:
- Piš česky, pokud uživatel výslovně nezadá jiný jazyk.
- Nevymýšlej fakta, termíny, částky, právní závěry ani sliby.
- Jasně odděl ověřené informace od toho, co se musí ověřit.
- Nepřiznávej právní odpovědnost, dluh, porušení smlouvy, zpronevěru, použití klientských prostředků nebo garantovaný termín, pokud to není výslovně ověřeno v zadání.
- U citlivých věcí používej formulace typu „komunikace z naší strany nebyla dostatečná“, nikoliv „porušili jsme smlouvu“.
- U Gold Deposit / deponovaného zlata / odměn / výnosů buď zvlášť opatrný: nepoužívej investiční sliby, garantovaný výnos ani neověřené datum výplaty.
- U recenzí neútoč na klienta, nezveřejňuj osobní údaje, smluvní detaily, částky ani zdravotní/finanční informace. Odpověď musí být veřejně bezpečná.
- Vždy vrať validní JSON podle schématu.

HTML výstup:
- Vytvoř samostatný bezpečný HTML blok pro e-mail/newsletter nebo veřejnou odpověď.
- Používej inline CSS, jednoduchý responzivní layout, bez externích skriptů, bez externích fontů, bez tracking pixelů.
- HTML musí být vložitelné do Shoptetu, e-mailového nástroje nebo interního náhledu.
- CTA tlačítko nech jako href="#" nebo {{CTA_URL}}, pokud není URL zadána.

Schvalování:
- approval_required nastav true pro právní výzvy, advokáty, banky, regulátory, AML, refundace, Gold Deposit, custody, odměny, výnosy, zpožděné dodání kovu, hrozby sporem, negativní recenze s rizikem zveřejnění citlivých údajů a vše s risk_level high/critical.`;

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
Jazyk: ${input.language || "cs"}

=== Zpráva klienta ===
${input.client_message || "(neuvedeno)"}

=== Recenze ===
Platforma: ${input.review_platform || "(netýká se)"}
Hodnocení: ${input.review_rating || "(neuvedeno)"}
Text recenze: ${input.review_text || "(neuvedeno)"}

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

Vygeneruj jen výstupy, které dávají smysl pro zadaný režim. U režimu review vyplň především review_reply a html_output; u režimu client vyplň e-mail, SMS, WhatsApp, telefonní skript, interní poznámku a HTML e-mail.`;
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
  const approvalRequired = input.risk_level === "high" || input.risk_level === "critical" || ["gold_deposit", "refund", "legal_notice", "aml", "review_negative"].includes(input.situation_type);
  if (input.mode === "review") {
    const reviewReply = `Dobrý den, děkujeme za zpětnou vazbu. Mrzí nás, že Vaše zkušenost neodpovídala očekávání. Rádi bychom situaci prověřili konkrétně a férově, proto nás prosím kontaktujte přímo na zákaznické podpoře, abychom mohli dohledat potřebné podklady a navrhnout další postup. Děkujeme.`;
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
      recommended_next_steps: ["Veřejně odpovědět stručně", "Detail řešit mimo veřejnou platformu"],
      approval_required: approvalRequired,
      html_notes: ["HTML je fallback šablona bez AI."],
    };
  }

  const email = `Dobrý den${input.client_name ? `, ${input.client_name}` : ""},

omlouvám se, že jste od nás nedostal/a včas jasnou informaci. Komunikace z naší strany v této věci nebyla dostatečná a chápu, že to mohlo vyvolat nejistotu.

Vaši záležitost nyní prověřujeme podle dostupných podkladů. Nechci Vám dávat neověřený termín ani nepřesnou informaci, proto Vám po ověření zašleme konkrétní stanovisko a další postup.

Děkuji za trpělivost a omlouvám se za komplikace.`;
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
    approval_required: Boolean(result.approval_required ?? fallback.approval_required),
  };
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
