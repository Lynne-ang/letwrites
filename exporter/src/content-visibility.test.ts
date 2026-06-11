import { describe, it, expect } from 'vitest';
import { buildVisibilityPayload, visibilityNeedsApply, effectiveNewBookVisibility } from './content-visibility.js';

describe('content visibility payloads (no silent public on import)', () => {
  const current = { owner_id: 7, role_permissions: [{ role_id: 9, view: true, create: false, update: false, delete: false }], fallback_permissions: { inheriting: true } };

  it('only-me denies everyone but preserves the owner (importer + admins keep access)', () => {
    const p = buildVisibilityPayload(current, { mode: 'only-me' });
    expect(p.owner_id).toBe(7);
    expect(p.role_permissions).toEqual([]);
    expect(p.fallback_permissions).toEqual({ inheriting: false, view: false, create: false, update: false, delete: false });
  });

  it('groups grants view to the chosen roles and denies everyone else', () => {
    const p = buildVisibilityPayload(current, { mode: 'groups', roleIds: [2, 5, 2] }); // dedupes
    expect(p.fallback_permissions!.view).toBe(false); // everyone-else denied
    expect(p.role_permissions).toEqual([
      { role_id: 2, view: true, create: false, update: false, delete: false },
      { role_id: 5, view: true, create: false, update: false, delete: false },
    ]);
    expect(p.owner_id).toBe(7); // preserved
  });

  it('everyone clears the restriction (inherit) — explicit opt-in to public', () => {
    const p = buildVisibilityPayload(current, { mode: 'everyone' });
    expect(p.fallback_permissions).toEqual({ inheriting: true });
    expect(p.role_permissions).toEqual([]);
  });

  it('needs-apply only for only-me / non-empty groups (everyone is a no-op)', () => {
    expect(visibilityNeedsApply({ mode: 'everyone' })).toBe(false);
    expect(visibilityNeedsApply({ mode: 'only-me' })).toBe(true);
    expect(visibilityNeedsApply({ mode: 'groups', roleIds: [] })).toBe(false);
    expect(visibilityNeedsApply({ mode: 'groups', roleIds: [2] })).toBe(true);
  });

  it('FAIL-CLOSED: a new book only goes public on an EXPLICIT everyone; null/empty → only-me (private)', () => {
    expect(effectiveNewBookVisibility(null)).toEqual({ mode: 'only-me' });                          // no choice (direct API / bypassed UI)
    expect(effectiveNewBookVisibility({ mode: 'groups', roleIds: [] })).toEqual({ mode: 'only-me' }); // groups but no valid role
    expect(effectiveNewBookVisibility({ mode: 'only-me' })).toEqual({ mode: 'only-me' });
    expect(effectiveNewBookVisibility({ mode: 'groups', roleIds: [2, 5] })).toEqual({ mode: 'groups', roleIds: [2, 5] });
    expect(effectiveNewBookVisibility({ mode: 'everyone' })).toEqual({ mode: 'everyone' });          // ONLY explicit path to public
  });

  it('only-me with no owner_id in current perms still fails closed (deny-all, no leak)', () => {
    const p = buildVisibilityPayload({}, { mode: 'only-me' }); // GET returned no owner_id
    expect(p.fallback_permissions).toEqual({ inheriting: false, view: false, create: false, update: false, delete: false });
    expect(p.role_permissions).toEqual([]);
    expect('owner_id' in p).toBe(false); // omitted, not nulled — BookStack keeps the real owner + admins
  });
});
