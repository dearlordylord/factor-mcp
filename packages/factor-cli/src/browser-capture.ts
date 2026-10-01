import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, chmod } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { stderr } from "node:process";
import { defaultSessionPath, writePrivateJson } from "@firfi/factor-sdk";
import { createCaptureServer } from "./capture-server.js";

export async function captureExistingBrowser(
  sessionPath = defaultSessionPath(),
): Promise<void> {
  const directory = join(homedir(), ".cache/factor/capture-extension");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, "capture-key");
  let token: string;
  try {
    token = await readFile(keyPath, "utf8");
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid key");
  } catch {
    token = randomBytes(32).toString("hex");
    await writeFile(keyPath, token, { mode: 0o600 });
  }
  for (const file of [
    "manifest.json",
    "background.js",
    "bridge.js",
    "page-observer.js",
  ]) {
    await copyFile(
      new URL("../extension/" + file, import.meta.url),
      join(directory, file),
    );
    await chmod(join(directory, file), 0o600);
  }
  await writeFile(
    join(directory, "config.js"),
    `export const endpoint = "http://127.0.0.1:38471/capture";\nexport const token = ${JSON.stringify(token)};\n`,
    { mode: 0o600 },
  );
  await chmod(join(directory, "config.js"), 0o600);
  let captured = false;
  let finish: () => void = () => {};
  const complete = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const server = createCaptureServer(token, async (session, evidence) => {
    await writePrivateJson(sessionPath, session);
    await writePrivateJson(join(dirname(sessionPath), "capture.private.json"), {
      capturedAt: session.capturedAt,
      records: [evidence],
    });
    captured = true;
    stderr.write(
      `\nFactor session saved to ${sessionPath}. You can remove the capture extension now.\n`,
    );
    // Allow the HTTP success response to flush before shutting down.
    setImmediate(finish);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          "Local capture port 38471 is unavailable. Stop an earlier capture command and retry.",
        ),
      ),
    );
    server.listen(38471, "127.0.0.1", resolve);
  });
  stderr.write(
    `\nUse the browser where Factor already works:\n1. Open chrome://extensions (or your browser’s extensions page).\n2. Enable Developer mode, choose Load unpacked, and select:\n   ${directory}\n3. Refresh your signed-in Factor tab, then open Edit Meals if capture has not finished.\n\nThis extension reads only Factor session cookies and API authentication headers and sends them to this local command. It does not capture passwords, change meals, or upload data. No terminal input is needed.\n`,
  );
  const timeout = setTimeout(finish, 10 * 60_000);
  const stop = () => finish();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await complete;
    if (!captured)
      throw new Error(
        "No Factor session captured. Start the command again and refresh a signed-in Factor tab after loading the extension.",
      );
  } finally {
    clearTimeout(timeout);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
