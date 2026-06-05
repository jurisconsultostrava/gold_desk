// AI klasifikace datovkových zpráv — Czech ISDS document analysis

import { llmJSON } from "../ai";
import type { DatovkaInstitution, DatovkaSubmission } from "@shared/schema";

const SYS_DATOVKA_CLASSIFY = `Jsi asistent advokátní kanceláře Jurisconsult Ostrava. Analyzuj přiloženou datovou zprávu (úřední/soudní dokument z české datové schránky) a vrať JSON.

Klasifikuj:
1. institution_type: court (soud), executor (exekutor), regulator (ČNB, ÚOOÚ, FAÚ apod.), authority (úřad obecně), tax (finanční úřad/celní správa), ministry, other
2. submission_type: lawsuit (žaloba), ruling (usnesení/rozsudek), demand (výzva), notice (oznámení), invoice (faktura/výzva k úhradě), decision (rozhodnutí), other
3. case_number: spisová značka nebo č.j. (formát: '12 C 345/2025', 'sp. zn. ...', 'č.j. ...'), nebo null
4. priority: high (lhůty < 14 dnů, exekuce, žaloba), normal, low
5. summary: 2-4 věty česky, věcně
6. key_facts: 3-6 bullet pointů (částky, čísla, jména, lhůty)
7. deadline_date: pokud dokument obsahuje lhůtu pro odpověď/úkon, vrať datum ve formátu YYYY-MM-DD, jinak null
8. deadline_text: původní text lhůty (např. "ve lhůtě 15 dnů od doručení", "do 30. června 2026"), nebo null`;

const SCHEMA = `{
  "institution_type": "court|executor|regulator|authority|tax|ministry|other",
  "submission_type": "lawsuit|ruling|demand|notice|invoice|decision|other",
  "case_number": "string or null",
  "priority": "high|normal|low",
  "summary": "string",
  "key_facts": ["string"],
  "deadline_date": "YYYY-MM-DD or null",
  "deadline_text": "string or null"
}`;

export interface DatovkaClassification {
  institution_type: DatovkaInstitution;
  submission_type: DatovkaSubmission;
  case_number: string | null;
  priority: 'high' | 'normal' | 'low';
  summary: string;
  key_facts: string[];
  deadline_date: string | null;
  deadline_text: string | null;
}

/**
 * Parse relative deadline text like "za 15 dnů", "ve lhůtě 30 dnů od doručení"
 * Returns ISO date string if parsed, otherwise null.
 */
function parseRelativeDeadline(text: string, deliveredAt?: string): string | null {
  if (!text) return null;
  const base = deliveredAt ? new Date(deliveredAt) : new Date();
  if (isNaN(base.getTime())) return null;

  // Try "do DD. MM. YYYY" or "do DD.MM.YYYY"
  const absMatch = text.match(/do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (absMatch) {
    const d = new Date(
      parseInt(absMatch[3]),
      parseInt(absMatch[2]) - 1,
      parseInt(absMatch[1])
    );
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Try "ve lhůtě N dnů/měsíců" or "za N dnů/měsíců" or "do N dnů/měsíců"
  const relMatch = text.match(
    /(\d+)\s*(pracovních\s+)?dn[ůí]|(\d+)\s*kalendářních\s+dn[ůí]|(\d+)\s*měsíc[ůue]?/i
  );
  if (relMatch) {
    const days = parseInt(relMatch[1] || relMatch[3] || relMatch[4] || "0");
    const months = relMatch[4] ? parseInt(relMatch[4]) : 0;
    const result = new Date(base);
    if (months > 0) {
      result.setMonth(result.getMonth() + months);
    } else {
      result.setDate(result.getDate() + days);
    }
    if (!isNaN(result.getTime())) return result.toISOString().slice(0, 10);
  }

  return null;
}

export async function classifyDatovkaMessage(opts: {
  subject: string;
  sender: string;
  fullText: string;
  deliveredAt?: string;
}): Promise<DatovkaClassification> {
  const userMsg = [
    `Předmět: ${opts.subject || "(neuvedeno)"}`,
    `Odesílatel: ${opts.sender || "(neuvedeno)"}`,
    opts.deliveredAt ? `Datum doručení: ${opts.deliveredAt}` : null,
    `\n--- TEXT DOKUMENTU ---\n${opts.fullText.slice(0, 25000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let result: any;
  try {
    result = await llmJSON(SYS_DATOVKA_CLASSIFY, userMsg, SCHEMA);
  } catch (e: any) {
    console.error("[datovka/ai] Classification failed:", e?.message);
    return {
      institution_type: "other",
      submission_type: "other",
      case_number: null,
      priority: "normal",
      summary: "Klasifikace selhala.",
      key_facts: [],
      deadline_date: null,
      deadline_text: null,
    };
  }

  // Normalize institution_type
  const validInstitutions: DatovkaInstitution[] = ["court", "executor", "regulator", "authority", "tax", "ministry", "other"];
  const institution_type: DatovkaInstitution = validInstitutions.includes(result?.institution_type)
    ? result.institution_type
    : "other";

  const validSubmissions: DatovkaSubmission[] = ["lawsuit", "ruling", "demand", "notice", "invoice", "decision", "other"];
  const submission_type: DatovkaSubmission = validSubmissions.includes(result?.submission_type)
    ? result.submission_type
    : "other";

  const validPriorities = ["high", "normal", "low"];
  const priority: 'high' | 'normal' | 'low' = validPriorities.includes(result?.priority)
    ? result.priority
    : "normal";

  // Resolve deadline_date
  let deadline_date: string | null = null;
  const rawDate = result?.deadline_date as string | null;
  if (rawDate) {
    // If it's already ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      deadline_date = rawDate;
    } else {
      // Try parsing as relative from deliveredAt
      deadline_date = parseRelativeDeadline(rawDate, opts.deliveredAt);
      if (!deadline_date && result?.deadline_text) {
        deadline_date = parseRelativeDeadline(result.deadline_text, opts.deliveredAt);
      }
    }
  } else if (result?.deadline_text) {
    deadline_date = parseRelativeDeadline(result.deadline_text, opts.deliveredAt);
  }

  return {
    institution_type,
    submission_type,
    case_number: result?.case_number || null,
    priority,
    summary: result?.summary || "",
    key_facts: Array.isArray(result?.key_facts) ? result.key_facts : [],
    deadline_date,
    deadline_text: result?.deadline_text || null,
  };
}
