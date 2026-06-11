# Backup & recovery

Letwrites is self-hosted, so **you keep your data and you keep the backups** — we never hold a copy.
These tools make a backup smooth to take and fast to restore, and verify integrity so you find out
about a bad backup now, not during an incident.

## What gets backed up

A snapshot is one timestamped folder with everything needed to rebuild the wiki:

| File | Contents |
|------|----------|
| `db.sql` | The database: pages, books, users, **permissions**, revision history |
| `files.tgz` | Uploaded images + app config (the BookStack `/config` volume) |
| `SHA256SUMS` | Checksums, verified before any restore |
| `manifest.json` | When it was taken, db name, versions |

## Take a backup

```bash
cd wiki/deploy
./backup.sh                 # writes to ./backups/letwrites-<timestamp>/
./backup.sh /mnt/nas/lw     # or straight onto a NAS / mounted volume you own
./backup.sh --check         # verify prerequisites without taking a backup
```

## Send it offsite (recommended)

The snapshot is a plain folder. Push it somewhere off the box with one line — to **your** storage:

```bash
aws s3 sync ./backups/letwrites-<ts>/ s3://your-bucket/letwrites/<ts>/   # S3 / MinIO
# or:  rclone copy ./backups/letwrites-<ts> remote:letwrites/<ts>
# or:  just point ./backup.sh at a mounted NAS path
```

## Schedule it

A nightly cron entry (the snapshot is consistent — `--single-transaction`):

```cron
15 2 * * *  cd /opt/letwrites/wiki/deploy && ./backup.sh /mnt/nas/lw >> /var/log/letwrites-backup.log 2>&1
```

## Restore

```bash
cd wiki/deploy
./restore.sh ./backups/letwrites-<timestamp>
# verifies checksums, asks you to confirm, restores files + DB, then:
docker compose restart bookstack
```

A corrupt or tampered snapshot fails the checksum check and is refused before anything is touched.

## Run a restore drill

A backup you have never restored is a hope, not a backup. Once in a while, restore a snapshot onto a
throwaway stack and confirm the wiki comes up with your content and permissions intact:

```bash
./restore.sh ./backups/letwrites-<ts> --force   # on a NON-production deploy
```

## What the Enterprise tier adds

The mechanics above are free and self-hosted. The paid tier ships a **self-hosted backup monitor you
run on your own box** — your backups never leave your servers, so we don't watch them, the tool does,
on your infrastructure, and it alerts *your* channel. We provide the tooling; you run it. Nothing
phones home.

Run it from cron right after the nightly backup (license-gated):

```bash
LETWRITES_LICENSE=<token> node monitor.js --dir ./backups \
  --max-age-hours 26 --keep-daily 7 --keep-weekly 4 [--prune] [--alert-webhook "$YOUR_HOOK"]
```

What it does, all locally:
- **Freshness check** — alerts if last night's snapshot did not run (newest is older than the limit).
- **Checksum verification** — re-verifies the latest snapshot's `SHA256SUMS`; a corrupt or tampered
  file is flagged.
- **Retention** — keeps newest-per-day for N days then newest-per-week for M weeks; `--prune` removes
  the rest (never the newest).
- **Your-channel alerting** — POSTs a compact JSON alert to a webhook *you* set (Slack/PagerDuty/SIEM
  relay) and exits non-zero so your own cron/monitoring treats a bad backup as a failure.

Roadmap (not yet shipped): automated restore drills to a sandbox, and an optional managed offsite
target if you explicitly opt in.
