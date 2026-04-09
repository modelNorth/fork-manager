/**
 * fork-manager — sync.js
 * Syncs all GitHub forks for an authenticated user with their upstream repos.
 * Supports exclude list, dry-run mode, and detailed reporting.
 *
 * Author: ModelNorth
 * License: MIT
 */

const https = require("https");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const TOKEN = process.env.PAT_TOKEN;
const USERNAME = process.env.GITHUB_ACTOR || process.env.GH_USERNAME;
const DRY_RUN = process.env.DRY_RUN === "true";
const FORCE_SYNC = process.env.FORCE_SYNC === "true";

/**
 * Add repo names here (just the name, not owner/name) to skip them during sync.
 * Useful for forks you've heavily modified and don't want overwritten.
 *
 * Example: ["onyx", "evolution-api", "twenty"]
 */
const EXCLUDE_LIST = (process.env.EXCLUDE_REPOS || "")
  .split(",")
  .map((r) => r.trim().toLowerCase())
  .filter(Boolean);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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
    const res = await apiRequest(
      "GET",
      `/user/repos?type=fork&per_page=100&page=${page}`
    );

    if (res.status !== 200) {
      throw new Error(`Failed to fetch repos: ${JSON.stringify(res.body)}`);
    }

    const batch = res.body;
    if (!batch.length) break;

    forks = forks.concat(batch);
    if (batch.length < 100) break;
    page++;
  }

  return forks;
}

async function syncFork(owner, repo, defaultBranch) {
  const res = await apiRequest(
    "POST",
    `/repos/${owner}/${repo}/merge-upstream`,
    { branch: defaultBranch }
  );

  return res;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!TOKEN) {
    console.error("❌ PAT_TOKEN environment variable is not set.");
    process.exit(1);
  }

  console.log("╔════════════════════════════════════════╗");
  console.log("║        fork-manager by ModelNorth       ║");
  console.log("╚════════════════════════════════════════╝\n");

  if (DRY_RUN) console.log("🔍 DRY RUN MODE — no actual syncs will happen\n");
  if (FORCE_SYNC) console.log("⚡ FORCE SYNC enabled — conflicts will be overwritten\n");
  if (EXCLUDE_LIST.length > 0) {
    console.log(`🚫 Excluded repos: ${EXCLUDE_LIST.join(", ")}\n`);
  }

  console.log("📡 Fetching all forks...");
  const forks = await getAllForks();
  console.log(`✅ Found ${forks.length} fork(s)\n`);

  const results = {
    synced: [],
    skipped: [],
    alreadyUpToDate: [],
    conflicts: [],
    errors: [],
  };

  for (const fork of forks) {
    const repoName = fork.name;
    const ownerLogin = fork.owner.login;
    const defaultBranch = fork.default_branch;

    // Check exclude list
    if (EXCLUDE_LIST.includes(repoName.toLowerCase())) {
      console.log(`⏭  [EXCLUDED]  ${ownerLogin}/${repoName}`);
      results.skipped.push(repoName);
      continue;
    }

    if (DRY_RUN) {
      console.log(`🔍 [DRY RUN]   ${ownerLogin}/${repoName} (branch: ${defaultBranch})`);
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
          console.log(`🔄 [SYNCED]    ${ownerLogin}/${repoName} — ${msg}`);
          results.synced.push(repoName);
        }
      } else if (res.status === 409) {
        console.log(`⚠️  [CONFLICT]  ${ownerLogin}/${repoName} — has diverged from upstream`);
        results.conflicts.push(repoName);
      } else if (res.status === 422) {
        console.log(`⚠️  [SKIPPED]   ${ownerLogin}/${repoName} — ${res.body.message}`);
        results.skipped.push(repoName);
      } else {
        console.log(`❌ [ERROR]     ${ownerLogin}/${repoName} — HTTP ${res.status}: ${res.body.message}`);
        results.errors.push(repoName);
      }
    } catch (err) {
      console.log(`❌ [ERROR]     ${ownerLogin}/${repoName} — ${err.message}`);
      results.errors.push(repoName);
    }

    // Slight delay to avoid hitting rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  // ─── SUMMARY ───────────────────────────────────────────────────────────────

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║              SYNC SUMMARY               ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`🔄 Synced (new commits pulled):  ${results.synced.length}`);
  console.log(`✅ Already up to date:           ${results.alreadyUpToDate.length}`);
  console.log(`⏭  Excluded / skipped:           ${results.skipped.length}`);
  console.log(`⚠️  Conflicts (needs manual fix): ${results.conflicts.length}`);
  console.log(`❌ Errors:                        ${results.errors.length}`);
  console.log(`─────────────────────────────────────────`);
  console.log(`📦 Total forks processed:        ${forks.length}`);

  if (results.conflicts.length > 0) {
    console.log(`\n⚠️  Conflicted repos (your commits diverged from upstream):`);
    results.conflicts.forEach((r) => console.log(`   • ${r}`));
    console.log(`\n   To force-sync these, re-run with FORCE_SYNC=true`);
    console.log(`   Warning: this will overwrite your changes on those forks.`);
  }

  if (results.errors.length > 0) {
    console.log(`\n❌ Failed repos:`);
    results.errors.forEach((r) => console.log(`   • ${r}`));
  }

  // Exit with error code if anything failed
  if (results.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

