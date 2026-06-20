---
name: letwrites-publish
description: Publish or update a document in the company's Letwrites knowledge base (a self-hosted, permission-governed wiki). Use this whenever you have produced something worth keeping — notes, a spec, a research write-up, a decision record, meeting minutes, a runbook, a project summary — and it is time to save it where teammates can find it. Trigger on phrases like "save this to the wiki", "publish to Letwrites", "write this back to our knowledge base", "document this", "put this in our docs", or at the natural end of a piece of work when the result should be captured. Every write is bound to the person the agent is acting for and is auditable.
---

# Publish to Letwrites

You did the work. This skill is how you, the agent, put the result back into the company's
knowledge base by yourself — the agent-native loop closes here. The human shouldn't have to
copy-paste your output into a wiki; you publish it, governed and audited, and hand back a link.

Letwrites is a self-hosted wiki (BookStack underneath) that the company owns. This skill writes a
page into it: into the right book and chapter for the current project, creating the page or
updating the existing one with the same title (so you never leave duplicates behind).

## When to use this

Use it the moment a document is "done enough to be useful to someone else":
- You wrote a spec, design doc, runbook, research summary, postmortem, or decision record.
- You took meeting notes the team will want later.
- A project wrapped and the findings should live somewhere durable, not in a chat log.
- The user says any of: publish, save to the wiki/docs, write back, document this, capture this.

Do NOT use it for throwaway scratch work, secrets, or anything the user hasn't seen yet. When a
document is consequential or its destination is unclear, show the user the title and target
location first, or run a dry run (below) and confirm before writing.

## Setup (one time per project)

The skill needs two things: where your Letwrites lives, and a credential to write.

1. **Project config** — a `.letwrites.json` in the project root tells the skill where this
   project's docs belong, so you don't have to guess every time:

   ```json
   {
     "baseUrl": "https://docs.yourcompany.com",
     "book": "Project Atlas",
     "chapter": "Engineering"
   }
   ```
   `book` is required (the skill creates it if it doesn't exist); `chapter` is optional. See
   `references/config.md` for all fields. If there's no config file, pass `--base-url` and
   `--book` on the command line instead.

2. **Credential** — set these in the environment (never hard-code them in a file):
   - Direct / self-host (open source): a BookStack API token —
     `LETWRITES_TOKEN_ID` and `LETWRITES_TOKEN_SECRET` (create one in Letwrites under
     *Edit Profile → API Tokens*).
   - Governed / Enterprise: point `LETWRITES_GATEWAY_URL` at your Letwrites gateway instead.
     The write then runs as the verified SSO user, is permission-checked (can this person write
     here?), and is recorded in the tamper-evident audit + shows up on the governance dashboard
     under "who wrote what". Same command, stronger guarantees. Identity comes from your gateway's
     auth: for an OIDC gateway set `LETWRITES_GATEWAY_TOKEN` (sent as a Bearer); behind a trusted-header
     SSO proxy the proxy supplies it. Note: in governed mode the target **book must already exist**
     (the gateway does not create books); pre-create it once in Letwrites.

## How to publish

Write the document to a markdown file, then run the bundled script. It finds-or-creates the
book/chapter, then creates the page or updates the existing one with the same title.

```bash
node scripts/publish.mjs --title "API Rate Limits — Design" --file ./notes/rate-limits.md
```

Useful flags:
- `--book "Other Book"` / `--chapter "Other Chapter"` — override the project config for one write.
- `--base-url https://docs.yourcompany.com` — override / supply the Letwrites URL.
- `--dry-run` — show exactly what it would do (create vs update, where, the page URL) and write
  nothing. Use this first whenever you're not sure where a document should land.
- `--md "inline text"` — publish a short note without writing a file first.

The script prints a small JSON result with `action` (created or updated) and the page `url`.
Always give that URL back to the user — it's the proof the work is captured and where to find it.

**Example**

Input: you've just finished a migration runbook in `runbook.md` for the "Project Atlas" project.
Command:
```bash
node scripts/publish.mjs --title "Atlas DB Migration Runbook" --file runbook.md
```
Output (share the url with the user):
```json
{ "action": "created", "title": "Atlas DB Migration Runbook",
  "url": "https://docs.yourcompany.com/books/project-atlas/page/atlas-db-migration-runbook" }
```

## Why it behaves the way it does

- **Update-by-title, not append.** Re-publishing the same title updates that page in place. This
  keeps the wiki clean when you revise a document across a session, instead of scattering "v2",
  "v3 final" copies — the thing every wiki accumulates and nobody trusts.
- **Identity and audit matter.** In governed mode the write is tied to a real person and logged.
  That's what lets a company let agents write to shared knowledge at all: there's always a record
  of who wrote what, through which agent. Don't try to bypass it.
- **You hand back a link, not a wall of text.** The value is that the document now lives somewhere
  findable. The URL is the deliverable.

## If something goes wrong

The script prints a clear error and exits non-zero. Common cases: missing credential (set the env
vars), wrong base URL (check `.letwrites.json`), or no write permission for the page's location
(in governed mode this is the permission check doing its job — tell the user they aren't authorized
to write there rather than trying to force it).
