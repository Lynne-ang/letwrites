import { describe, it, expect } from 'vitest';
import {
  buildAuthorizeUrl, oauthBaseUrl, exchangeCodeForToken, refreshAccessToken,
  getAccessibleResources, cloudIdForSite, DEFAULT_SCOPES,
} from './confluence-oauth.js';

const okJson = (body: any): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })) as any;
const fail = (status: number): typeof fetch =>
  (async () => ({ ok: false, status, json: async () => ({}), text: async () => 'err' })) as any;

describe('confluence oauth helpers', () => {
  it('builds a consent URL with audience, scopes, and redirect', () => {
    const url = buildAuthorizeUrl({ clientId: 'CID', redirectUri: 'https://app/cb', state: 's' });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app/cb');
    expect(u.searchParams.get('scope')).toContain('read:confluence-content.all');
    expect(u.searchParams.get('scope')).toContain('offline_access'); // refresh tokens
  });

  it('points the gateway base at the cloudId with /wiki so REST paths resolve', () => {
    expect(oauthBaseUrl('abc-123')).toBe('https://api.atlassian.com/ex/confluence/abc-123/wiki');
  });

  it('parses a token exchange response', async () => {
    const t = await exchangeCodeForToken(
      { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r' },
      okJson({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'a b' }));
    expect(t).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600, scope: 'a b' });
  });

  it('throws on a failed token exchange', async () => {
    await expect(exchangeCodeForToken({ clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'r' }, fail(400)))
      .rejects.toThrow(/token exchange failed 400/);
  });

  it('refreshes an access token', async () => {
    const t = await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'RT' },
      okJson({ access_token: 'AT2', expires_in: 3600 }));
    expect(t.accessToken).toBe('AT2');
  });

  it('resolves cloudId from accessible resources by site URL', async () => {
    const resources = await getAccessibleResources('AT',
      okJson([{ id: 'cloud-1', url: 'https://acme.atlassian.net', name: 'acme' },
              { id: 'cloud-2', url: 'https://other.atlassian.net', name: 'other' }]));
    expect(cloudIdForSite(resources, 'https://acme.atlassian.net/')).toBe('cloud-1');
    expect(cloudIdForSite(resources, 'https://other.atlassian.net')).toBe('cloud-2');
  });

  it('falls back to the only resource when site is ambiguous', () => {
    expect(cloudIdForSite([{ id: 'only', url: 'https://x.atlassian.net', name: 'x' }], 'https://unknown')).toBe('only');
    expect(DEFAULT_SCOPES).toContain('read:attachment:confluence'.replace('read:attachment:confluence', 'read:confluence-content.all'));
  });
});
