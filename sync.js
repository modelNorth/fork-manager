const https = require("https");

const TOKEN = process.env.PAT_TOKEN;
const DRY_RUN = process.env.DRY_RUN === "true";
const FORCE_SYNC = process.env.FORCE_SYNC === "true";

const EXCLUDE_LIST = (process.env.EXCLUDE_REPOS || "")
  .split(",")
  .map((r) => r.trim().toLowerCase())
  .filter(Boolean);

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "User-Agent": "fork-manager-bot",
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAllForks() {
  let page = 1;
  let forks = [];
  while (true) {
    const res = await apiRequest("GET", `/user/repos?type=fork&per_page=100&page=${page}`);
    if (res.status !== 200) throw new Error(`Failed to fetch repos: ${JSON.stringify(res.body)}`);
    const batch = res.body;
    if (!batch.length) break;
    forks = forks.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return forks;
}

async function syncFork(owner, repo, defaultBranch) {
  return await apiRequest("POST", `/repos/${owner}/${repo}/merge-upstream`, { branch: defaultBranch });
}

async function main() {
  if (!TOKEN) { console.error("❌ PAT_TOKEN not set."); process.exit(1); }

  console.log("╔════════════════════════════════════════╗");
  console.log("║        fork-manager by ModelNorth       ║");
  console.log("╚════════════════════════════════════════╝\n");

  if (DRY_RUN) console.log("🔍 DRY RUN MODE\n");
  if (FORCE_SYNC) console.log("⚡ FORCE SYNC enabled\n");
  if (EXCLUDE_LIST.length > 0) console.log(`🚫 Excluded: ${EXCLUDE_LIST.join(", ")}\n`);

  console.log("📡 Fetching all forks...");
  const forks = await getAllForks();
  console.log(`✅ Found ${forks.length} fork(s)\n`);

  if (forks.length === 0) {
    console.log("ℹ️  No forks found. Nothing to sync.");
    process.exit(0);
  }

  const results = { synced: [], skipped: [], alreadyUpToDate: [], conflicts: [], errors: [] };

  for (const fork of forks) {
    const { name: repoName, owner: { login: ownerLogin }, default_branch: defaultBranch } = fork;

    if (EXCLUDE_LIST.includes(repoName.toLowerCase())) {
      console.log(`⏭  [EXCLUDED]   ${ownerLogin}/${repoName}`);
      results.skipped.push(repoName);
      continue;
    }

    if (DRY_RUN) {
      console.log(`🔍 [DRY RUN]    ${ownerLogin}/${repoName} (branch: ${defaultBranch})`);
      results.synced.push(repoName);
      continue;
    }

    try {
      const res = await syncFork(ownerLogin, repoName, defaultBranch);
      if (res.status === 200) {
        const msg = res.body.message || "";
        if (msg.toLowerCase().includes("already")) {
          console.log(`✅ [UP TO DATE] ${ownerLogin}/${repoName}`);
          results.alreadyUpToDate.push(repoName);
        } else {
          console.log(`🔄 [SYNCED]     ${ownerLogin}/${repoName} — ${msg}`);
          results.synced.push(repoName);
        }
      } else if (res.status === 409) {
        console.log(`⚠️  [CONFLICT]   ${ownerLogin}/${repoName} — diverged from upstream`);
        results.conflicts.push(repoName);
      } else if (res.status === 422) {
        console.log(`⏭  [SKIPPED]    ${ownerLogin}/${repoName} — ${res.body.message}`);
        results.skipped.push(repoName);
      } else {
        console.log(`❌ [ERROR]      ${ownerLogin}/${repoName} — HTTP ${res.status}: ${res.body.message}`);
        results.errors.push(repoName);
      }
    } catch (err) {
      console.log(`❌ [ERROR]      ${ownerLogin}/${repoName} — ${err.message}`);
      results.errors.push(repoName);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║              SYNC SUMMARY               ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`🔄 Synced:             ${results.synced.length}`);
  console.log(`✅ Already up to date: ${results.alreadyUpToDate.length}`);
  console.log(`⏭  Skipped/excluded:   ${results.skipped.length}`);
  console.log(`⚠️  Conflicts:          ${results.conflicts.length}`);
  console.log(`❌ Errors:             ${results.errors.length}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`📦 Total processed:    ${forks.length}`);

  if (results.conflicts.length > 0) {
    console.log(`\n⚠️  Conflicted repos (re-run with force_sync to overwrite):`);
    results.conflicts.forEach((r) => console.log(`   • ${r}`));
  }
  if (results.errors.length > 0) {
    console.log(`\n❌ Failed repos:`);
    results.errors.forEach((r) => console.log(`   • ${r}`));
    process.exit(1);
  }
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
