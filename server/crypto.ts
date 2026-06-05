// AES-256-GCM helper. Stores: base64(iv || authTag || ciphertext)
import crypto from "node:crypto";
import { config, encryptionConfigured } from "./config";

function getKey(): Buffer {
  if (!encryptionConfigured()) {
    throw new Error(
      "MAILROOM_ENCRYPTION_KEY musí být 64 hex znaků (32 bajtů). Vygenerujte přes `openssl rand -hex 32`."
    );
  }
  return Buffer.from(config.encryptionKey, "hex");
}

export function encrypt(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string | null | undefined): string {
  if (!payload) return "";
  const key = getKey();
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
