# @letwrites/confluence-export

Export content **out** of Confluence into portable Markdown + attachments — with an
honest report of exactly what couldn't be auto-converted. This is Letwrites's migration
wedge: getting companies off Confluence cleanly is the thing that gets us in the door.

## What it does

```
Confluence  ──▶  one of three sources  ──▶  import into your wiki  ──▶  integrity report (source vs moved)
   • REST API (Basic token)                  pages, hierarchy,         pages & images
   • OAuth Bearer (automated, images)         attachments uploaded,     expected vs moved,
   • HTML-export ZIP (manual, images)         links re-pointed          missing named, COMPLETE/INCOMPLETE
```

- **Three ways in:** the REST API (text/structure), an **automated OAuth pull** that also
  brings images (Confluence Cloud OAuth-gates attachment bytes from a plain token), or a
  **Confluence HTML-export ZIP** (`--from-confluence-export`) that bundles every image.
- **Pages & hierarchy** → Book/Chapter/Page in BookStack, nesting preserved (deep nesting flattened + reported).
- **Internal links** → re-pointed so they don't 404.
- **Attachments/images** → uploaded into BookStack's gallery, refs rewritten to the new URLs.
- **Macros** → common ones (code, info/note/warning/tip panels, status) converted; everything else (Jira, drawio, include, expand, …) left as a clearly-flagged note **and** listed in the report. No silent loss.
- **Integrity report** → every import is reconciled against the **source** export: pages/images expected (counted from the source, not the output) vs. moved, any gaps named, verdict COMPLETE/INCOMPLETE. A sha256 checksum catches accidental edits/corruption — it is not a cryptographic signature.

## Why "honest" matters

Every other migration tool promises one-click and quietly mangles Confluence-specific
macros. We convert the clean 80% and hand you a precise list of the 20% that needs a
human. That report is a selling point, not an apology.

## Install

```bash
npm install
```

## Use

Credentials via env (recommended) or flags. For Confluence **Cloud**, create an API
token at id.atlassian.net → Security → API tokens.

```bash
export CONFLUENCE_BASE_URL="https://your-org.atlassian.net/wiki"
export CONFLUENCE_EMAIL="you@your-org.com"
export CONFLUENCE_API_TOKEN="••••"

# run directly (no build step)
npm run export -- --space ENG --out ./export

# or build a binary entrypoint
npm run build && node dist/cli.js --space ENG --out ./export
```

See `--help` for all flags. For Confluence **Server/DC** with a personal access token,
omit `--email` (the client switches to Bearer auth).

## Output layout

```
export/
  engineering/
    onboarding.md
    onboarding.attachments/
      welcome.png
    runbooks/
      api.md
  manifest.json          # id → path, parent, version  (for re-runs / bridge mode)
  migration-report.md    # grouped by page + a "most common issues" table
```

## Test

The converter is covered by unit tests against storage-format fixtures (the part that
doesn't need a live Confluence instance):

```bash
npm test
```

## Status

Working. Converter, link re-pointing, attachment upload + ref rewrite, HTML-export-ZIP
ingest, automated OAuth pull, importer, and the integrity report are implemented
and covered by **47 tests**; the import is verified end-to-end against live BookStack v26.05
(images included). Not yet covered (roadmap): comments, version history, page restrictions →
target permission model, and incremental re-sync ("bridge mode").

## Architecture

| File | Responsibility |
|------|----------------|
| `src/confluence-client.ts` | Confluence REST client (Basic or Bearer/OAuth); pagination + attachment download |
| `src/confluence-oauth.ts` | OAuth 2.0 (3LO): authorize URL, token exchange/refresh, cloudId — the automated path |
| `src/confluence-html-export.ts` | Ingest a Confluence "Export space → HTML" ZIP → standard import tree (images included) |
| `src/converter.ts` | Storage-format (XHTML) → Markdown; macro detection + flagging |
| `src/import-planner.ts` | Map Confluence nesting → BookStack Book/Chapter/Page; flatten + report |
| `src/import-images.ts` | Upload local images to BookStack's gallery; rewrite refs |
| `src/importer.ts` | Run the import; collect the per-image manifest |
| `src/integrity.ts` | Migration-integrity report: source-vs-moved reconciliation, gaps named, sha256 checksum |
| `src/manifest.ts` | Hierarchy → slugified paths; link resolution; report rendering |
| `src/exporter.ts` | REST-export orchestration; file writing; attachment download |
| `src/cli.ts` / `import-cli.ts` / `migrate.ts` / `confluence-oauth-cli.ts` | Entry points |
