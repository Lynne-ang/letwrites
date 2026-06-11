---
name: letwrites-search
description: Search the company's Letwrites knowledge base (a self-hosted wiki) and read its pages, seeing ONLY what the requesting person is allowed to see. Use this whenever answering needs company-specific knowledge you don't already have — internal runbooks, specs, policies, architecture, onboarding, past decisions, "what's our X", "how do we Y here", "check the wiki", "look it up in our docs" — and use it BEFORE answering a company-specific question from memory, since memory may be stale or wrong. Results are permission-scoped to the user: restricted pages are never returned or revealed.
---

# Search Letwrites

Before you answer a question about how *this company* does something, look it up. The company's real
answer lives in its knowledge base, not in your training data, and getting it wrong erodes trust.
This skill searches Letwrites (a self-hosted wiki, BookStack underneath) and reads pages back to you.

The defining property: **you only ever see what the person you're acting for is allowed to see.**
A restricted page they can't open is not in your results and its existence isn't hinted at. That's
what makes it safe to point an agent at the whole company wiki.

## When to use

- The user asks something company-specific: "what's our on-call policy", "how do we deploy",
  "where's the spec for X", "what did we decide about Y".
- You're about to answer from memory but the answer depends on this company's setup — search first.
- You need a document's full text to summarize, quote, or build on it.

Don't use it for general knowledge you already have, or for the public internet.

## Setup

Same as the publish skill — a `.letwrites.json` for the address, and a credential in the
environment. See `../letwrites-publish/references/config.md` for the full reference.

- **Direct / self-host (open source):** set `LETWRITES_TOKEN_ID` + `LETWRITES_TOKEN_SECRET`.
  > IMPORTANT: use the **requesting person's own** API token, not a shared admin token. BookStack
  > scopes search to the token's user, so their token is what keeps results permission-safe. A
  > shared admin token would return pages the person isn't allowed to see — exactly the leak this
  > product exists to prevent.
- **Governed / Enterprise:** set `LETWRITES_GATEWAY_URL`. The query runs through the gateway, which
  resolves the verified SSO user, enforces their permissions, returns an answer drawn only from what
  they can read, and records the search in the audit log. Nothing leaks even with a shared deployment.
  > For local testing you may set `LETWRITES_USER` to stand in for the SSO-provided identity. This is
  > DEV-ONLY. In production the gateway must run in OIDC mode or sit strictly behind your SSO proxy —
  > a directly reachable trusted-header gateway would let anyone set the user header and impersonate.
  > Always use an `https://` URL so the token / identity isn't sent in cleartext.

## How to search

```bash
node scripts/search.mjs --query "what is our on-call policy"
```
Returns the top matches as `title — url` with a short snippet each. Then read a page in full:

```bash
node scripts/search.mjs --open 42        # fetch page id 42's markdown (direct mode)
```
Flags: `--limit N` (default 8), `--book "Name"` to scope to one book (direct mode).

In **governed mode** the script prints a single permission-safe answer plus its sources, because the
gateway already composes the answer from the allowed documents.

**Example**

Input: the user asks "how do we handle on-call escalation?"
```bash
node scripts/search.mjs --query "on-call escalation"
```
Output (use these to answer, and cite the URL):
```
1. On-call Policy — https://docs.yourcompany.com/books/ops/page/on-call-policy
   Escalate to secondary after 15 minutes. Comp time granted for overnight pages.
```

## Why it behaves this way

- **Search, then answer — don't guess.** The whole reason to wire an agent into the company wiki is
  to replace stale memory with the current, real document. Cite the URL so the human can verify.
- **Permission scoping is not optional.** In direct mode the user's token enforces it; in governed
  mode the gateway does. Never work around it by using a broader token to "get more results" — that
  turns a safe agent into a data-leak.
