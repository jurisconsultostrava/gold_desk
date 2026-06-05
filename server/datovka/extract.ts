// Wrapper around existing server/extract.ts for Datovka attachments

import { extractText } from "../extract";

export interface ExtractResult {
  text: string;
  ocrUsed: boolean;
}

export async function extractAttachmentText(
  filename: string,
  mimeType: string,
  data: Buffer
): Promise<ExtractResult> {
  try {
    return await extractText(filename, mimeType, data);
  } catch (e: any) {
    console.error(`[datovka/extract] Failed to extract text from ${filename}:`, e?.message);
    return { text: "", ocrUsed: false };
  }
}
