# Project config: `.letwrites.json`

Drop this file in a project's root so the agent knows where that project's documents belong.
Read it only when you need the full set of fields; the common ones are in SKILL.md.

```json
{
  "baseUrl": "https://docs.yourcompany.com",
  "book": "Project Atlas",
  "chapter": "Engineering"
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `baseUrl` | yes (unless `LETWRITES_GATEWAY_URL` is set) | Your Letwrites address. |
| `book` | yes | The book this project's pages go in. Created if it doesn't exist. |
| `chapter` | no | A chapter within the book. Created if it doesn't exist. Omit to put pages at book level. |

## Credentials (environment, not in the file)

Direct / self-host (open source):
```bash
export LETWRITES_TOKEN_ID=...        # Letwrites → Edit Profile → API Tokens
export LETWRITES_TOKEN_SECRET=...
```

Governed / Enterprise (writes run as the verified SSO user, permission-checked + audited):
```bash
export LETWRITES_GATEWAY_URL=https://docs.yourcompany.com/mcp
```
When the gateway URL is set, the client sends no API token — the gateway resolves the real person
from your SSO and records the write in the audit log and on the governance dashboard.

## Notes

- The script never deletes anything. Re-publishing a title updates that page in place.
- `--book` / `--chapter` / `--base-url` on the command line override the config for a single write.
- Keep secrets out of `.letwrites.json` so the file is safe to commit to the project repo.
