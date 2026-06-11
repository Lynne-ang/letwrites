/**
 * Resolve the BookStack base URL for a request, SSRF-safely.
 *
 * The import/share service runs NEXT TO BookStack, so in production the operator pins the target
 * with BOOKSTACK_URL (e.g. http://bookstack:80). When that's set we use it and IGNORE any
 * client-supplied base — so a signed-in user can't make the server fetch arbitrary internal URLs
 * (cloud metadata, other services). The header fallback exists only for standalone/dev use, and
 * even then we block the cloud metadata + link-local range.
 */
const CONFIGURED = (process.env.BOOKSTACK_URL ?? '').trim().replace(/\/+$/, '');

export function resolveBase(headerBase: string): string {
  if (CONFIGURED) return CONFIGURED; // operator-pinned target: no SSRF surface
  const b = (headerBase || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  let u: URL;
  try { u = new URL(b); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase();
  // Block the cloud metadata endpoint + the whole link-local range.
  if (host === 'metadata.google.internal' || host === '169.254.169.254' || host.startsWith('169.254.')) return '';
  return b;
}
