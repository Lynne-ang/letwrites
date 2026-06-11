/**
 * Build a BookStack content-permissions payload for a chosen visibility. Used by the import to set
 * who-can-see on the books it creates, so a migrated (often team-restricted) space never silently
 * lands public. GET-merge-PUT: callers GET the current permissions first and pass them in so we
 * preserve owner_id (the owner + admins always keep access — that's BookStack's rule).
 *
 *   everyone  → inherit the space/role defaults (explicit opt-in to "anyone who can reach it")
 *   only-me   → deny everyone; only the owner (importer) + admins can see it
 *   groups    → deny everyone; grant VIEW to the chosen role(s)
 */
export interface ContentPermissions {
  owner_id?: number;
  role_permissions?: Array<{ role_id: number; view: boolean; create: boolean; update: boolean; delete: boolean }>;
  fallback_permissions?: { inheriting: boolean; view?: boolean; create?: boolean; update?: boolean; delete?: boolean };
}

export type VisibilityMode = 'everyone' | 'only-me' | 'groups';
export interface Visibility { mode: VisibilityMode; roleIds?: number[] }

/** True when the choice actually changes permissions (everyone = leave as-is, no PUT, no perms needed). */
export function visibilityNeedsApply(vis: Visibility): boolean {
  return vis.mode === 'only-me' || (vis.mode === 'groups' && (vis.roleIds?.length ?? 0) > 0);
}

/**
 * Resolve what to actually apply to a NEW top-level book. FAIL-CLOSED: the only path to public is an
 * explicit "everyone". A missing choice (null), or "groups" with no valid role (a bypassed UI or a
 * direct/forged API call), becomes "only-me" (private) — never silently public.
 */
export function effectiveNewBookVisibility(vis: Visibility | null): Visibility {
  if (vis && vis.mode === 'everyone') return { mode: 'everyone' };
  if (vis && vis.mode === 'groups' && (vis.roleIds?.length ?? 0) > 0) return { mode: 'groups', roleIds: vis.roleIds };
  return { mode: 'only-me' };
}

export function buildVisibilityPayload(current: ContentPermissions, vis: Visibility): ContentPermissions {
  const ownerPart = current.owner_id != null ? { owner_id: current.owner_id } : {};
  if (vis.mode === 'everyone') {
    // Clear any restriction → inherit role/space defaults.
    return { ...ownerPart, role_permissions: [], fallback_permissions: { inheriting: true } };
  }
  // Restricted: deny everyone via fallback; owner + admins still see it (BookStack bypasses for them).
  const denyAll = { inheriting: false, view: false, create: false, update: false, delete: false };
  if (vis.mode === 'only-me') {
    return { ...ownerPart, role_permissions: [], fallback_permissions: denyAll };
  }
  // groups: grant view to each chosen role; everyone else denied.
  const role_permissions = Array.from(new Set(vis.roleIds ?? []))
    .filter((id) => Number.isInteger(id) && id > 0)
    .map((role_id) => ({ role_id, view: true, create: false, update: false, delete: false }));
  return { ...ownerPart, role_permissions, fallback_permissions: denyAll };
}
