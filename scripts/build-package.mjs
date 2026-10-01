import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
// Remove stale generated files before creating the publishable dist directory.
rmSync("dist", { recursive: true, force: true });
execFileSync("tsc", ["-p", "tsconfig.json"], { stdio: "inherit" });
