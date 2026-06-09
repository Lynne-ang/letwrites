/**
 * Confluence Cloud OAuth 2.0 (3LO) — the AUTOMATED export path.
 *
 * Why this exists: with a plain API token (Basic auth), Confluence Cloud returns
 * 401 (www-authenticate: OAuth) on the attachment-download path, so IMAGES can't be
 * auto-pulled. A 3LO access token carrying `read:attachment:confluence` satisfies that
 * challenge — so OAuth is what makes a fully automated, images-included export possible
 * (no manual HTML export). The customer authorizes a Letwrites OAuth app ONCE.
 *
 * Flow:
 *   1. buildAuthorizeUrl()      → customer opens it, approves, Atlassian redirects with ?code=
 *   2. exchangeCodeForToken()   → code → { accessToken, refreshToken, expiresIn }
 *   3. getAccessibleResources() → resolve the cloudId for their site
 *   4. point ConfluenceClient at oauthBaseUrl(cloudId) with the Bearer access token
 *   5. refreshAccessToken()     → when the access token expires (offline_access scope)
 *
 * The ConfluenceClient already speaks Bearer (no email ⇒ `Bearer <token>`); this module
 * just gets the token and the right base URL. Pure functions are unit-tested; the network
 * calls accept an injected fetch for testing and live-verify against a real Atlassian app.
 */

export const DEFAULT_SCOPES = [
  'read:confluence-space.summary',
  'read:confluence-content.all', // includes attachment bytes
  'read:confluence-content.summary',
  'offline_access',              // required to receive a refresh token
];

const AUTH_BASE = 'https://auth.atlassian.com';
const API_BASE = 'https://api.atlassian.com';

/** The OAuth gateway base for a given cloudId. Paths stay `/rest/api/...` under `/wiki`. */
export function oauthBaseUrl(cloudId: string): string {
  return `${API_BASE}/ex/confluence/${cloudId}/wiki`;
}

/** Step 1: the URL the customer opens to grant Letwrites read access (once). */
export function buildAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const scopes = (args.scopes ?? DEFAULT_SCOPES).join(' ');
  const q = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: args.clientId,
    scope: scopes,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: 'code',
    prompt: 'consent',
  });
  return `${AUTH_BASE}/authorize?${q.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // seconds
  scope?: string;
}

type FetchImpl = typeof fetch;

function parseTokenResponse(j: any): TokenSet {
  if (!j || typeof j.access_token !== 'string') {
    throw new Error(`unexpected token response: ${JSON.stringify(j).slice(0, 200)}`);
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in ?? 3600, scope: j.scope };
}

/** Step 2: exchange the ?code= from the redirect for tokens. */
export async function exchangeCodeForToken(args: {
  clientId: string; clientSecret: string; code: string; redirectUri: string;
}, fetchImpl: FetchImpl = fetch): Promise<TokenSet> {
  const res = await fetchImpl(`${AUTH_BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: args.clientId, client_secret: args.clientSecret,
      code: args.code, redirect_uri: args.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseTokenResponse(await res.json());
}

/** Step 5: refresh an expired access token (needs offline_access). */
export async function refreshAccessToken(args: {
  clientId: string; clientSecret: string; refreshToken: string;
}, fetchImpl: FetchImpl = fetch): Promise<TokenSet> {
  const res = await fetchImpl(`${AUTH_BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: args.clientId, client_secret: args.clientSecret, refresh_token: args.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseTokenResponse(await res.json());
}

export interface AccessibleResource { id: string; url: string; name: string; scopes?: string[]; }

/** Step 3: list the Atlassian sites this token can reach; `id` is the cloudId. */
export async function getAccessibleResources(accessToken: string, fetchImpl: FetchImpl = fetch): Promise<AccessibleResource[]> {
  const res = await fetchImpl(`${API_BASE}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`accessible-resources failed ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error('unexpected accessible-resources response');
  return j.map((r: any) => ({ id: String(r.id), url: r.url, name: r.name, scopes: r.scopes }));
}

/** Resolve the cloudId for a given site URL (e.g. https://acme.atlassian.net). */
export function cloudIdForSite(resources: AccessibleResource[], siteUrl: string): string | null {
  const want = siteUrl.replace(/\/+$/, '').toLowerCase();
  const hit = resources.find((r) => r.url.replace(/\/+$/, '').toLowerCase() === want);
  return hit?.id ?? (resources.length === 1 ? resources[0].id : null);
}
