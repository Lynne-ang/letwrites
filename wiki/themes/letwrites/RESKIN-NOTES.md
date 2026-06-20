# Notion Reskin — Notes

A clean, modern, Notion-style visual reskin of the BookStack UI for Letwrites. Branch: `notion-reskin`.

## ⚠️ Validated on REAL BookStack (not just the reconstructed preview)

A client hit three bugs the static preview could not show, because the preview reconstructs BookStack's
markup rather than running it. ALL now reproduced + fixed + re-validated against a real BookStack
(linuxserver/bookstack + MariaDB 11.4, theme applied via `app-custom-head`). Evidence in
`preview/live-validation/` (stock vs BROKEN vs FIXED).

Root causes (the reskin is VISUAL ONLY — these were layout/branding overreaches):
1. **Side rails collapsed to ~90px** (text wrapped one word per line on the books list + page nav).
   Cause: the reskin added `max-width`/`margin:auto` overrides on `#content`/`.tri-layout-container`/
   `.tri-layout-middle-contents` to "fix" a dead right margin that ONLY existed in the reconstructed
   preview. On real BookStack those fight its native responsive tri-layout grid and squeeze the rails.
   Fix: removed all layout-width overrides. BookStack's layout is already centered/responsive; the
   reskin must never set layout geometry (readable measure stays on `.page-content` only).
2. **Two-tone white/grey split** — the grey was BookStack's default page background showing through
   where the collapsed layout left content uncovered. Resolved once the layout (and body=white) was fixed.
3. **Doubled logo** — a customer-deployed instance sets its OWN `app-logo`, and the reskin's injected
   `header a.logo::before` "L" tile rendered a SECOND mark beside it. Fix: `::before{display:none}`.

## Second client report — three issues, fully investigated on real BookStack

1. **Two-tone white/grey background (grey shows on scroll).** Could NOT reproduce in
   linuxserver/bookstack:latest (v26.05) with either the old or current CSS, at 1280–2000px —
   our pages render all-white. The client's trigger is environment-specific (likely a different
   BookStack build or browser zoom; "grey on scroll" points to a scroll-root background element).
   Applied a DEFENSIVE fix regardless: force every background layer to the page color so a two-tone
   is structurally impossible in light mode:
   `html, body, #content, .tri-layout, .tri-layout-container, .tri-layout-mobile-tabs, #main-content,
   .mainpage-contents { background: var(--lw-bg) !important; }` (token keeps dark mode correct).

2. **Ordered list shows "1." for every item instead of 1/2/3.** NOT the reskin (it has no list
   rules; clean markdown renders one `<ol>` numbered 1/2/3 correctly — verified). It's the MIGRATED
   CONTENT: when numbered steps have a root-level paragraph/image BETWEEN them (not indented under the
   item), CommonMark splits them into separate `<ol>`s, each restarting at 1 — reproduced (3 `<ol>`
   for 3 steps). Fix is content/migration, NOT theme CSS: re-import with an improved converter that
   keeps list continuity, or edit the pages (indent the between-content). Do NOT "fix" with a global
   CSS counter — it would wrongly merge legitimately-separate lists on the same page.

3. **/settings/* still stock (not reskinned).** BookStack DELIBERATELY excludes custom-head CSS on
   settings routes — `layouts/parts/custom-head.blade.php`:
   `@if(!request()->routeIs('settings.category')) {!! $headContent->forWeb() !!} @endif`.
   So a custom-head reskin can NEVER reach the admin settings UI (BookStack protects it on purpose).
   Recommend leaving settings stock (admin-only, low-impact, safe). Reskinning it would require
   overriding a core Blade view via the theme — fragile and breaks on upgrade; not worth it.

Reviewed on real BookStack across home / books / book / page (short+long, 1280–2000px) / login /
settings / page-editor / search — all end-user pages clean; only admin settings stays stock (by design).

LESSON (now load-bearing): validate theme changes on a REAL BookStack, not the preview. To stand one up
locally on Apple Silicon: MariaDB 11.4 container (arm64-native, no emulation) + linuxserver/bookstack
container on a shared docker network; the image reads DB creds from `/config/www/.env` (NOT `DB_*` env
vars — only DB_HOST/DB_PORT are used for the connect-wait); apply the reskin by writing branding.css into
the `app-custom-head` setting; screenshot with headless Chrome.

## What this is (and is NOT)

- **IS:** a global CSS reskin layered into the existing theme's custom-head fragment
  (`branding.css`). It restyles every user- and admin-facing BookStack page at once —
  typography, header, sidebar, content, cards, buttons, forms, tables, search, breadcrumbs,
  login, and admin/settings — to a calm Notion aesthetic.
- **IS NOT:** a fork, a template change, or any change to BookStack's hierarchy, data,
  routes, permissions, or functionality. It is purely visual and upgrade-safe (same mechanism
  as the prior branding: stored in the `app-custom-head` setting by `seed-branding.sh`).
- **NOT a Notion *editor*.** Block/slash-command editing, drag-drop, and database views are
  BookStack-engine features, not CSS — out of scope by design (would require a fork).

## How it's delivered

`branding.css` is an HTML head fragment (favicon links + one `<style>` block + the existing
share/import/teams `<script>` blocks). The reskin is appended at the END of the `<style>` block
so it wins the cascade over the prior minimal rules without touching the favicon data-URIs or the
functional scripts. Applied to BookStack via `wiki/deploy/seed-branding.sh` (writes the
`app-custom-head` DB setting) — no fork, no core edits.

Hard constraint honored: **no backslashes** anywhere in the fragment (the seeder stores it via a
SQL literal that only escapes single quotes; a stray backslash would be mangled). Verified: 0
backslashes, balanced braces, 1 `<style>` + 3 `<script>` blocks intact.

## Design choices (Notion aesthetic, WCAG AA)

Derived from the `ui-ux-pro-max` design system (Inter + neutral-grey/link-blue, WCAG AA), applied
in Notion's *quiet* minimalism rather than the "oversized type" variant.

- **Color:** warm near-black text `#37352f` on white (Notion's signature; AAA contrast). Muted
  text `#787774` (AA). Hairline borders `rgba(55,53,47,.09)`. Sidebar grey `#f7f7f5`.
- **Accent:** Notion blue `#2383e2` for links + the primary button; soft tint for active rows.
- **Type:** Inter, 15px base, line-height 1.5 (1.7 in page content), tightened bold headings.
- **Shape:** small radii (6px / 10px), no heavy shadows — flat surfaces with hairline borders.
- **Motion:** 150ms hover transitions; `prefers-reduced-motion` disables them.
- **Dark mode:** BookStack's dark mode is preserved with a Notion-dark token set (bg `#191919`,
  surface `#202020`, text `#e9e9e7`) so we don't force white surfaces in dark mode.

## Verified

- Rendered the real `branding.css` against BookStack-representative markup via headless Chrome —
  see `preview/screenshot-after.png` (and `screenshot-before.png` for the stock comparison). The
  reskin reads as clean and modern across page view, shelf grid, settings, and login.
- Open `preview/index.html` for an interactive before/after (Split / Before / After toggle).
  Regenerate after editing `branding.css`: `node preview/build-preview.mjs`.

## Confidence / needs-live-confirm

These target documented, long-stable BookStack v26.05 selectors + its configurable CSS variables,
but were authored without a live BookStack running here (the project's BookStack needs a native DB;
it crashes under Apple-Silicon Docker emulation). Confirm on a live instance before going live:

- **High confidence (stable for years):** `body`, `.page-content`, `.card`, `.content-wrap`,
  `.grid-card`, `.entity-list-item`, `.button` / `button.button`, `input`/`select`/`textarea`,
  `table`, `.breadcrumbs`, `.tri-layout-left/middle/right`, `.book-tree`, `#header-search`.
- **Confirm visually (header recolor is the riskiest):** the header is changed from BookStack's
  solid color bar to white-with-hairline + dark text. The prior branding deliberately avoided this
  because it couldn't be checked blind. The screenshot looks correct, but verify on live that the
  logo tile, header links, dropdowns, and search all read well (light + dark mode).
- **BookStack CSS variables:** we set `--color-primary`, `--color-primary-light`, `--color-link`.
  If a future BookStack renames these, native components fall back to BookStack defaults (our
  structural rules still apply) — not a breakage, just less complete recoloring.

## Open questions for Andy

1. **Primary button color:** currently Notion blue (`#2383e2`). Notion's own primary buttons are
   often dark near-black. Blue is more inviting + matches the link accent; say the word to switch
   to dark.
2. **Header:** OK to ship the white header (vs. keeping a subtle colored bar)? It's the biggest
   visual change and the one most worth a live look.
3. **Dark mode:** want me to refine the dark palette further, or is "keep it working, Notion-dark
   tokens" enough for now?

## How to apply to a live BookStack

1. On the deployment, re-seed the custom head with the updated branding:
   `cd wiki/deploy && ./seed-branding.sh --force`  (re-applies `app-custom-head`; non-destructive
   to app-name/app-logo).
2. Hard-refresh the browser. To revert: Settings ▸ Customization ▸ clear "Custom HTML Head Content"
   (or restore the previous `branding.css` and re-run with `--force`).

Nothing here is deployed automatically. This branch is not merged to `main`.
