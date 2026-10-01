import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import "./check-private-files.mjs";
const dir = mkdtempSync(join(tmpdir(), "factor-secrets-"));
function scan(args) {
  const r = spawnSync("gitleaks", args, { encoding: "utf8" });
  if (r.error)
    throw new Error("Install gitleaks before committing or releasing");
  if (r.status !== 0)
    throw new Error("Secret scan failed; inspect locally with redacted output");
}
try {
  // Canary proves the scanner detects a synthetic token before trusting its result.
  const canary = spawnSync("gitleaks", ["stdin", "--redact", "--no-banner"], {
    input:
      "token = " +
      JSON.stringify("ghp_" + randomBytes(50).toString("hex")) +
      "\n",
    encoding: "utf8",
  });
  if (canary.status !== 1) throw new Error("Gitleaks detection canary failed");
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      execFileSync("git", ["show", `:${file}`], {
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
  }
  scan(["dir", dir, "--redact", "--no-banner"]);
  if (
    spawnSync("git", ["rev-parse", "--verify", "HEAD"], { stdio: "ignore" })
      .status === 0
  )
    scan(["git", "--redact", "--no-banner"]);
  console.log("Gitleaks canary, tracked index and Git history passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
