# Notion Reskin — Notes

A clean, modern, Notion-style visual reskin of the BookStack UI for Letwrites. Branch: `notion-reskin`.

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
