// ZFO parser — ZFO = ZIP archive containing ISDS XML envelope + attachments
// Defensive: on any parse failure, returns all files as raw attachments.

import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";

type ZipFile = any;
type ZipEntry = { fileName: string; uncompressedSize: number };

export interface ParsedZfo {
  metadata: {
    dm_id?: string;
    sender_name?: string;
    sender_id_ds?: string;
    sender_ico?: string;
    recipient_name?: string;
    recipient_id_ds?: string;
    subject?: string;
    delivered_at?: string;
    accepted_at?: string;
  };
  attachments: Array<{ filename: string; data: Buffer; mimeType?: string }>;
}

function readEntry(zipfile: ZipFile, entry: ZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err || !stream) return reject(err || new Error("no stream"));
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

function openZip(buf: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err: Error | null, zf: ZipFile | undefined) => {
      if (err || !zf) return reject(err || new Error("yauzl failed"));
      resolve(zf);
    });
  });
}

/** Extract string value from parsed XML object by a list of possible key paths */
function pick(obj: any, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const parts = key.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) break;
      // traverse all object keys case-insensitively
      const found = Object.keys(cur).find(
        (k) => k.toLowerCase() === p.toLowerCase() || k.endsWith(`:${p}`)
      );
      cur = found != null ? cur[found] : undefined;
    }
    if (cur != null && typeof cur !== "object") return String(cur);
    if (typeof cur === "object" && cur["#text"]) return String(cur["#text"]);
  }
  return undefined;
}

function extractMetadata(xmlBuf: Buffer): ParsedZfo["metadata"] {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
      parseTagValue: true,
      trimValues: true,
    });
    const doc = parser.parse(xmlBuf.toString("utf8"));

    // flatten the tree — ISDS XML has various envelope layers
    // Common structure: isds:GetSignedDeliveryInfoResponse / isds:dmSignature / ... / isds:dmDm / isds:dmBaseInfo
    // or simpler: isds:MessageDownloadResponse > isds:dmReturnedMessage > isds:dmDm

    const flat = JSON.stringify(doc);
    const reparsed = JSON.parse(flat);

    // Helper to search nested
    function deepGet(obj: any, key: string): any {
      if (!obj || typeof obj !== "object") return undefined;
      const lcKey = key.toLowerCase();
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase() === lcKey || k.toLowerCase().endsWith(`:${lcKey}`)) return v;
        const deeper = deepGet(v, key);
        if (deeper !== undefined) return deeper;
      }
      return undefined;
    }

    function str(key: string): string | undefined {
      const v = deepGet(reparsed, key);
      if (v == null) return undefined;
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (typeof v === "object" && v["#text"]) return String(v["#text"]);
      return undefined;
    }

    return {
      dm_id: str("dmID"),
      sender_name: str("dmSenderOrgName") ?? str("dmSender"),
      sender_id_ds: str("dbIDSender") ?? str("dmSenderIdDS"),
      sender_ico: str("dmSenderIco") ?? str("senderIco"),
      recipient_name: str("dmRecipientOrgName") ?? str("dmRecipient"),
      recipient_id_ds: str("dbIDRecipient") ?? str("dmRecipientIdDS"),
      subject: str("dmAnnotation") ?? str("dmSubject"),
      delivered_at: str("dmDeliveryTime") ?? str("dmDeliveredAt"),
      accepted_at: str("dmAcceptanceTime") ?? str("dmAcceptedAt"),
    };
  } catch (e) {
    console.warn("[zfo-parser] XML metadata extraction failed:", (e as Error).message);
    return {};
  }
}

export async function parseZfo(buf: Buffer): Promise<ParsedZfo> {
  const attachments: ParsedZfo["attachments"] = [];
  let metadata: ParsedZfo["metadata"] = {};

  try {
    const zipfile = await openZip(buf);

    await new Promise<void>((resolve, reject) => {
      const entries: Array<{ entry: ZipEntry; data?: Buffer }> = [];

      zipfile.readEntry();
      zipfile.on("entry", (entry: ZipEntry) => {
        entries.push({ entry });
        zipfile.readEntry();
      });
      zipfile.on("end", async () => {
        try {
          for (const { entry } of entries) {
            const name = entry.fileName;
            if (entry.uncompressedSize === 0 || name.endsWith("/")) continue;
            try {
              const data = await readEntry(zipfile, entry);
              const lname = name.toLowerCase();

              if (lname.endsWith(".xml") || lname.includes("envelope") || lname.includes("message")) {
                // Try to extract metadata from XML; keep as attachment too if it looks like content
                const meta = extractMetadata(data);
                if (Object.values(meta).some(Boolean)) {
                  Object.assign(metadata, meta);
                }
                // Don't include XML envelope as user-visible attachment
              } else {
                // Determine MIME type
                let mimeType = "application/octet-stream";
                if (lname.endsWith(".pdf")) mimeType = "application/pdf";
                else if (lname.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                else if (lname.endsWith(".txt")) mimeType = "text/plain";
                else if (lname.endsWith(".png")) mimeType = "image/png";
                else if (lname.endsWith(".jpg") || lname.endsWith(".jpeg")) mimeType = "image/jpeg";

                attachments.push({
                  filename: name.includes("/") ? name.split("/").pop()! : name,
                  data,
                  mimeType,
                });
              }
            } catch (entryErr) {
              console.warn(`[zfo-parser] Failed to read entry ${name}:`, (entryErr as Error).message);
            }
          }
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      zipfile.on("error", reject);
    });
  } catch (e) {
    console.error("[zfo-parser] ZIP parse failed:", (e as Error).message);
    // Fall back: treat the whole buffer as a single attachment
    attachments.push({ filename: "message.bin", data: buf, mimeType: "application/octet-stream" });
  }

  return { metadata, attachments };
}
