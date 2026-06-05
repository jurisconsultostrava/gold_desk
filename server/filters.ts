/**
 * Sync filter helpers — used by all connectors (IMAP, Outlook, Gmail).
 */

/**
 * Returns true if the given email address matches any entry in the exclusion list.
 * Supports:
 *   - Exact email match: "spam@foo.com"
 *   - Domain match: "foo.com" or "*@foo.com" (both match any address ending in @foo.com)
 */
export function shouldExcludeAddress(
  address: string | null | undefined,
  list: string[] | null | undefined
): boolean {
  if (!address || !list || list.length === 0) return false;
  const a = address.toLowerCase().trim();
  for (const raw of list) {
    if (!raw) continue;
    // Strip leading "*@" so "*.foo.com" becomes "foo.com"
    const pattern = raw.toLowerCase().trim().replace(/^\*@/, "");
    if (!pattern) continue;
    // Exact match (works for both plain email and domain after stripping *@)
    if (a === pattern) return true;
    // Domain match: pattern has no "@" → treat as domain
    if (!pattern.includes("@") && a.endsWith("@" + pattern)) return true;
  }
  return false;
}

/**
 * Returns true if the given subject contains any of the exclusion patterns
 * (case-insensitive substring match).
 */
export function shouldExcludeSubject(
  subject: string | null | undefined,
  list: string[] | null | undefined
): boolean {
  if (!subject || !list || list.length === 0) return false;
  const s = subject.toLowerCase();
  return list.some((p) => p && s.includes(p.toLowerCase().trim()));
}
