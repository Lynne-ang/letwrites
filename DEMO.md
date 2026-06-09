# Demo: Confluence → Letwrites (5 minutes, no setup)

The whole point: **show a room that moving off Confluence is real, fast, and honest.**
This runs with zero credentials — a bundled sample Confluence space stands in for a
real one, so nothing can break live.

## The 30-second version

```bash
cd exporter
npm install        # first time only
npm run demo       # convert a sample Confluence space → Letwrites format
open demo-export/preview.html
```

Then show the import plan into Letwrites (BookStack):

```bash
npm run import -- --in ./demo-export --dry-run
```

## What to say while it runs

1. **"Here's a Confluence space."** — the sample is a realistic Engineering space:
   a handbook, nested onboarding + runbooks, an architecture page with a diagram,
   code blocks, tables, cross-page links, Jira and drawio macros.

2. **`npm run demo`** — "One command converts the whole space." Point at the output:
   - hierarchy preserved (folders mirror the page tree)
   - cross-page links re-pointed so they don't 404
   - the diagram image pulled across
   - **`migration-report.md`** — "And here's the honest part: it tells you exactly
     what *couldn't* convert — the Jira and drawio macros — instead of silently
     mangling them. No surprises six months later."

3. **`open demo-export/preview.html`** — "Here's that content, migrated, clickable
   right now — before we've even stood up the server." Click through the page tree.

4. **`npm run import -- --dry-run`** — "And this is how it lands in Letwrites: the
   Confluence tree maps cleanly onto Letwrites's books, chapters, and pages." Show the
   tree. "Drop `--dry-run` with credentials and it's in the live wiki."

## The honest-migration talking point (this is the differentiator)

> "Every migration tool promises one-click and quietly breaks your macros. We convert
> the clean 80% and hand you a precise list of the 20% a human should look at. That
> report isn't an apology — it's why you'll trust the migration."

## Running it against the company's REAL Confluence

Same tool, real source. They create an API token (id.atlassian.net ▸ API tokens):

```bash
cd exporter
CONFLUENCE_BASE_URL="https://THEIR-org.atlassian.net/wiki" \
CONFLUENCE_EMAIL="you@their-org.com" \
CONFLUENCE_API_TOKEN="••••" \
npm run export -- --space THEIR_SPACE --out ./their-export
open their-export/preview.html
```

## Into a live Letwrites (optional, needs Docker)

```bash
cd ../wiki
cp .env.example .env   # set secrets (see README)
docker compose up -d   # BookStack on http://localhost:6875
# create an API token in BookStack ▸ Edit Profile ▸ API Tokens, then:
cd ../exporter
BOOKSTACK_URL=http://localhost:6875 \
BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
npm run import -- --in ./demo-export
```

## What this proves vs. what's still ahead

- ✅ **Proven today:** off Confluence, into Letwrites — pages, structure, and **images** —
  with an integrity report that reconciles the source against what landed, proving nothing was lost. The wedge.
- ✅ **Also built & verified:** the agent-safe layer — an agent reading the wiki is
  *blocked* from what the user can't see (verified live on BookStack v26.05).
- 🔜 **The one remaining build:** the agent-facing MCP/OAuth gateway that proves *which
  human* an agent acts for — the paid add-on, built when a customer needs it.
