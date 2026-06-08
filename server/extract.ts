// Attachment text extraction. PDF / DOCX / OCR fallback.
// pdf-parse is loaded lazily because it ships a test-fixture import side-effect.

const OCR_THRESHOLD = 100; // <100 chars from pdf-parse → likely scanned

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
      const text = await extractPdf(buf);
      if (text.trim().length < OCR_THRESHOLD && ocrEnabled()) {
        // probably a scanned PDF — try OCR only when explicitly enabled.
        // OCR is CPU/RAM heavy and can cause Railway 502/timeouts on small instances.
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

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    // pdf-parse default export has a debug guard that triggers on no-args call.
    const mod: any = await import("pdf-parse/lib/pdf-parse.js" as any).catch(
      () => import("pdf-parse")
    );
    const fn = (mod && (mod.default || mod)) as any;
    const res = await fn(buf);
    return (res && res.text) || "";
  } catch (e: any) {
    console.error("pdf-parse error:", e?.message || e);
    return "";
  }
}

async function runOcr(buf: Buffer, mime: string): Promise<string> {
  // tesseract.js is heavy; only spin it up when needed.
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
