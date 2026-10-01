import { readFileSync } from "node:fs";
const versions = ["sdk", "mcp", "cli"].map(
  (kind) =>
    JSON.parse(readFileSync(`packages/factor-${kind}/package.json`, "utf8"))
      .version,
);
if (new Set(versions).size !== 1) throw Error("Package versions must match");
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${versions[0]}`
)
  throw Error("Release tag does not match package versions");
if (
  process.env.GITHUB_WORKFLOW === "Publish npm packages" &&
  process.env.GITHUB_REF_TYPE !== "tag"
)
  throw Error("Dispatch npm publishing on a release tag");
console.log(`Release version verified: ${versions[0]}`);
