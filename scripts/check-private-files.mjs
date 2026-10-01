import { execFileSync } from "node:child_process";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const banned =
  /(^|\/)(PREFERENCES\.md|WEEKLY-PLAN[^/]*\.md|session\.json|capture-key|config\.js|\.npmrc|\.env(?:\..*)?)$|\.(?:private|session)\.json$|(^|\/)(node_modules|local-session-snapshots|\.factor)\//i;
const bad = files.filter((f) => banned.test(f) && f !== ".env.example");
if (bad.length)
  throw new Error(
    `Private/generated files must not be tracked: ${bad.join(", ")}`,
  );
console.log(`Private-file guard passed (${files.length} tracked files)`);
