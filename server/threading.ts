// Thread grouping helpers.

export function normalizeSubject(subj: string | null | undefined): string {
  if (!subj) return "";
  return subj
    .replace(/^\s*((re|fwd|fw|odp|aw|sv|tr|wg)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/**
 * For IMAP messages, derive a stable thread key from headers.
 * Priority:
 *  1. References[0] (root of the thread)
 *  2. In-Reply-To
 *  3. Message-ID itself (singleton)
 *  4. fallback: normalized subject
 */
export function deriveThreadKey(opts: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  subject?: string | null;
}): string {
  const refs = (opts.references || []).filter(Boolean);
  if (refs.length) return refs[0];
  if (opts.inReplyTo) return opts.inReplyTo;
  if (opts.messageId) return opts.messageId;
  return `subj:${normalizeSubject(opts.subject)}`;
}
