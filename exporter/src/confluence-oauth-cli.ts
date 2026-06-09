#!/usr/bin/env node
import { buildAuthorizeUrl, exchangeCodeForToken, getAccessibleResources, cloudIdForSite, DEFAULT_SCOPES } from './confluence-oauth.js';

/**
 * One-time OAuth setup for the AUTOMATED Confluence export.
 *
 * Prereq (once): create an OAuth 2.0 (3LO) app at https://developer.atlassian.com/console/myapps/
 * with the Confluence scopes, and set:
 *   CONFLUENCE_OAUTH_CLIENT_ID, CONFLUENCE_OAUTH_CLIENT_SECRET, CONFLUENCE_OAUTH_REDIRECT
 *
 * Step 1 — get the consent URL:
 *   npm run oauth -- --authorize
 *   (open it, approve; Atlassian redirects to your redirect URI with ?code=...)
 *
 * Step 2 — exchange the code for a token + cloudId:
 *   npm run oauth -- --exchange <code> [--site https://acme.atlassian.net]
 *   → prints the CONFLUENCE_OAUTH_TOKEN + CONFLUENCE_CLOUD_ID to use with `npm run migrate`.
 */
function arg(n: string): string | undefined { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const clientId = process.env.CONFLUENCE_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.CONFLUENCE_OAUTH_CLIENT_SECRET ?? '';
  const redirectUri = process.env.CONFLUENCE_OAUTH_REDIRECT ?? '';

  if (process.argv.includes('--authorize')) {
    if (!clientId || !redirectUri) { console.error('Set CONFLUENCE_OAUTH_CLIENT_ID and CONFLUENCE_OAUTH_REDIRECT first.'); process.exit(1); }
    const url = buildAuthorizeUrl({ clientId, redirectUri, state: 'letwrites', scopes: DEFAULT_SCOPES });
    console.log('\nOpen this URL, approve access, then copy the ?code= from the redirect:\n\n' + url + '\n');
    return;
  }

  const code = arg('exchange');
  if (code) {
    if (!clientId || !clientSecret || !redirectUri) { console.error('Set CONFLUENCE_OAUTH_CLIENT_ID, _SECRET and _REDIRECT.'); process.exit(1); }
    const tok = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri });
    const resources = await getAccessibleResources(tok.accessToken);
    const cloudId = cloudIdForSite(resources, arg('site') ?? (resources[0]?.url ?? ''));
    console.log('\n✅ Authorized. Use these for an automated, images-included migration:\n');
    console.log(`  export CONFLUENCE_OAUTH_TOKEN='${tok.accessToken}'`);
    console.log(`  export CONFLUENCE_CLOUD_ID='${cloudId}'`);
    if (tok.refreshToken) console.log(`  # refresh token (store securely): ${tok.refreshToken}`);
    console.log('\nThen: npm run migrate -- --space <KEY>   (no manual export, images come across)\n');
    if (resources.length > 1) {
      console.log('Sites this token can reach (pass --site to pick one):');
      for (const r of resources) console.log(`  ${r.url}  → cloudId ${r.id}`);
    }
    return;
  }

  console.log('Usage:\n  npm run oauth -- --authorize\n  npm run oauth -- --exchange <code> [--site https://acme.atlassian.net]');
}

main().catch((e) => { console.error(`oauth: ${e.message}`); process.exit(1); });
