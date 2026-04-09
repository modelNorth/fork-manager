# 🔄 fork-manager

> One-tap sync for all your GitHub forks. Built by [ModelNorth](https://modelnorth.ai).

Keep every fork in your GitHub account up to date with its upstream — automatically on a schedule, or manually with a single button click.

---

## How It Works

1. GitHub Actions fetches a list of **all your forked repos**
2. For each fork, it calls the GitHub `merge-upstream` API
3. Forks that are already up to date are skipped cleanly
4. Forks with conflicts (where you have custom commits) are flagged — not force-overwritten by default
5. A full summary is printed at the end

Everything runs server-side on GitHub — no local cloning, no git commands on your machine.

---

## Setup

### 1. Fork or clone this repo

### 2. Create a Personal Access Token (PAT)

Go to **GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens**

- Name: `fork-manager-token`
- Repository access: **All repositories**
- Permissions:
  - `Contents` → Read and Write
  - `Actions` → Read and Write
  - `Metadata` → Read only

### 3. Add the token as a secret

Go to this repo → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `PAT_TOKEN`
- Value: your token from step 2

### 4. You're done

The workflow runs **every Monday at 09:00 UTC** automatically.

---

## Manual Trigger

Go to **Actions → 🔄 Sync All Forks → Run workflow**

You'll get three options:

| Option | Description |
|--------|-------------|
| `dry_run` | Lists all forks and what would happen — no actual syncing |
| `force_sync` | Force-overwrites forks that have diverged from upstream |
| `exclude_repos` | Comma-separated list of repo names to skip this run |

---

## Excluding Repos Permanently

Some forks you've heavily modified (e.g. a white-labeled product) should never be auto-synced.

Edit the `PERMANENT_EXCLUDES` line in `.github/workflows/sync-forks.yml`:

```yaml
PERMANENT_EXCLUDES: "onyx,evolution-api,twenty"
```

These will be skipped on every run, both scheduled and manual.

---

## Output Example

```
╔════════════════════════════════════════╗
║        fork-manager by ModelNorth       ║
╚════════════════════════════════════════╝

📡 Fetching all forks...
✅ Found 47 fork(s)

🔄 [SYNCED]     yourname/langchain — Successfully merged 3 commits
✅ [UP TO DATE] yourname/fastapi
✅ [UP TO DATE] yourname/shadcn-ui
⏭  [EXCLUDED]   yourname/onyx
⚠️  [CONFLICT]   yourname/supabase — has diverged from upstream

╔════════════════════════════════════════╗
║              SYNC SUMMARY               ║
╚════════════════════════════════════════╝
🔄 Synced (new commits pulled):  12
✅ Already up to date:           32
⏭  Excluded / skipped:            1
⚠️  Conflicts (needs manual fix):  2
❌ Errors:                         0
─────────────────────────────────────────
📦 Total forks processed:        47
```

---

## License

MIT — use freely, contributions welcome.

