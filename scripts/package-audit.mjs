import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
export function packPackages(destination) {
  return ["sdk", "mcp", "cli"].map((kind) => {
    const cwd = `packages/factor-${kind}`;
    execFileSync("pnpm", ["pack", "--pack-destination", destination], {
      cwd,
      stdio: "pipe",
    });
    return join(
      destination,
      `firfi-factor-${kind}-${JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")).version}.tgz`,
    );
  });
}
export function auditPackages(archives) {
  for (const archive of archives) {
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n");
    if (
      entries.some(
        (e) =>
          !/^package\/(?:package\.json|README\.md|LICENSE|dist\/[^\s]+\.(?:js|d\.ts)|extension\/(?:[a-z-]+\.js|manifest\.json))$/.test(
            e,
          ),
      )
    )
      throw new Error(`Unexpected package contents: ${archive}`);
    const manifest = JSON.parse(
      execFileSync("tar", ["-xOzf", archive, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    if (
      manifest.private ||
      Object.values(manifest.dependencies ?? {}).some((v) =>
        v.startsWith("workspace:"),
      )
    )
      throw new Error("Unpublishable manifest");
    for (const e of entries)
      if (/\.(js|ts|json|md)$/.test(e)) {
        const content = execFileSync("tar", ["-xOzf", archive, e], {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        });
        if (/\/Users\/[^/\s]+\//.test(content))
          throw new Error(`Private local/account data in ${e}`);
      }
    for (const bin of Object.values(manifest.bin ?? {}))
      if (!entries.includes(`package/${bin.replace(/^\.\//, "")}`))
        throw new Error("Missing package executable");
    console.log(`${manifest.name}: ${entries.length} allowed files`);
  }
}
if (process.argv[1]?.endsWith("/package-audit.mjs")) {
  const dir = mkdtempSync(join(tmpdir(), "factor-pack-"));
  try {
    auditPackages(packPackages(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
