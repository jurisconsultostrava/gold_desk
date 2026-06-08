// Attachment text extraction. PDF / DOCX / OCR fallback.
// Important: PDF parsing is intentionally executed in a child process.
// On small Railway instances, pdfjs/pdf-parse can crash or exhaust memory.
// If that happens in-process, the whole API returns 502. A child process isolates it.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OCR_THRESHOLD = 100; // <100 chars from pdf parsing → likely scanned

function ocrEnabled(): boolean {
  const raw = String(process.env.ENABLE_OCR || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "on";
}

export async function extractText(
  filename: string,
  mime: string,
  buf: Buffer
): Promise<{ text: string; ocrUsed: boolean }> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith(".pdf") || (mime || "").includes("pdf")) {
      const text = await extractPdfIsolated(buf);
      if (text.trim().length < OCR_THRESHOLD && ocrEnabled()) {
        // OCR is CPU/RAM heavy and can cause Railway 502/timeouts on small instances.
        // It is disabled by default and also isolated behind explicit ENABLE_OCR=true.
        const ocr = await runOcr(buf, mime || "application/pdf").catch(() => "");
        if (ocr.length > text.length) return { text: ocr, ocrUsed: true };
      }
      return { text, ocrUsed: false };
    }
    if (
      lower.endsWith(".docx") ||
      (mime || "").includes("officedocument.wordprocessingml")
    ) {
      const mammoth: any = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: buf });
      return { text: res.value || "", ocrUsed: false };
    }
    if (lower.endsWith(".txt") || (mime || "").startsWith("text/")) {
      return { text: buf.toString("utf8"), ocrUsed: false };
    }
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      (mime || "").startsWith("image/")
    ) {
      if (!ocrEnabled()) return { text: "", ocrUsed: false };
      const ocr = await runOcr(buf, mime || "image/png").catch(() => "");
      return { text: ocr, ocrUsed: !!ocr };
    }
  } catch (e: any) {
    console.error("extractText error:", e?.message || e);
  }
  return { text: "", ocrUsed: false };
}

async function extractPdfIsolated(buf: Buffer): Promise<string> {
  const timeoutMs = Number(process.env.PDF_PARSE_TIMEOUT_MS || 15000);
  const maxBytes = Number(process.env.PDF_PARSE_MAX_BYTES || 12 * 1024 * 1024);

  if (buf.length > maxBytes) {
    console.warn(`PDF too large for isolated parser: ${buf.length} bytes > ${maxBytes}`);
    return extractReadablePdfStrings(buf);
  }

  const dir = await mkdtemp(join(tmpdir(), "golddesk-pdf-"));
  const file = join(dir, "input.pdf");
  await writeFile(file, buf);

  try {
    const scriptPath = resolve(process.cwd(), "scripts", "pdf_extract_child.mjs");
    const text = await runNodeChild(scriptPath, [file], timeoutMs);
    const clean = normalizeText(text);
    if (clean.trim().length) return clean;
    return extractReadablePdfStrings(buf);
  } catch (e: any) {
    console.error("isolated pdf parse failed:", e?.message || e);
    return extractReadablePdfStrings(buf);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runNodeChild(scriptPath: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.PDF_CHILD_NODE_OPTIONS || "--max-old-space-size=256",
      },
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(`PDF parser timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) return resolvePromise(stdout);
      rejectPromise(new Error(stderr || `PDF parser exited with code ${code}`));
    });
  });
}

function extractReadablePdfStrings(buf: Buffer): string {
  // Emergency fallback. It will not parse every PDF, but it often recovers enough text
  // from simple text-layer PDFs and never crashes the main process.
  const latin = buf.toString("latin1");
  const chunks = new Set<string>();

  const paren = latin.match(/\((?:\\.|[^\\)]){4,}\)/g) || [];
  for (const m of paren.slice(0, 5000)) {
    const s = m.slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, " ")
      .replace(/\\([()\\])/g, "$1");
    if (/[A-Za-zÁ-ž0-9]{3,}/.test(s)) chunks.add(s);
  }

  const plain = latin.match(/[A-Za-zÁ-ž0-9][A-Za-zÁ-ž0-9.,;:!?@€$%+\-/() \n\r\t]{8,}/g) || [];
  for (const m of plain.slice(0, 3000)) {
    if (/[A-Za-zÁ-ž]{3,}/.test(m)) chunks.add(m);
  }

  return normalizeText(Array.from(chunks).join("\n"));
}

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function runOcr(buf: Buffer, mime: string): Promise<string> {
  try {
    const tess: any = await import("tesseract.js");
    const worker = await tess.createWorker(["ces", "eng"]);
    const { data } = await worker.recognize(buf);
    await worker.terminate();
    return data?.text || "";
  } catch (e: any) {
    console.error("OCR error:", e?.message || e);
    return "";
  }
}
