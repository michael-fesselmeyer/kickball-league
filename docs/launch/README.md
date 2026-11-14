# Launch kit

Everything needed to take the league's site live, written down before launch day. Nothing in this kit deploys anything or creates an account: automatic deployments stay paused (`vercel.json`) until the maintainer turns them on in [runbook](runbook.md) step 9.

| Document | For | What it answers |
|---|---|---|
| [Hosting decision brief](hosting.md) | Maintainer and owners | Which free host may serve a league site that takes payments, what each would need changed here, and the recommendation |
| [Environment checklist](environment.md) | Maintainer | Every environment variable the app reads, whether it's required, where its value comes from and which free tier provides it. Names only |
| [Launch runbook](runbook.md) | Maintainer | Database, migrations, season data, secrets, email domain (SPF, DKIM, DMARC), push keys, Stripe live, Google sign-in, deployments, domain cut-over with rollback, each step with a smoke test |
| [Backup and restore drill](backup-and-restore.md) | Maintainer | `scripts/backup-drill.sh`: dump, restore to a scratch database, compare; and how to restore for real |
| [Acceptance testing](acceptance-testing.md) | League volunteers | What to try as a player, captain, ref, admin and owner on the demo, and what should happen |
| [Uptime and error alerts](monitoring.md) | Maintainer and owners | Free uptime checks, error alerts and job heartbeats, with each free tier's limits |

Order of use: decide the host, then fill in the environment checklist, run the acceptance tests on the demo while working through the runbook, and do the backup drill and the alerts right after launch.

Provider terms and free limits were read from each provider's own pages on 2026-11-14. Read them again before acting on them, since providers change their plans.
