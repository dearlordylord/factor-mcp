import { z } from "zod";
import { readFile, mkdir, writeFile, rename, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export const ORIGIN = "https://www.factormeals.ca";
export const FactorOriginSchema = z.enum([ORIGIN, "https://factormeals.ca"]);
export const SessionSchema = z.object({
  origin: FactorOriginSchema.optional(),
  version: z.literal(1),
  capturedAt: z.string().datetime(),
  basePath: z.string().regex(/^\/(?:gw)?$/),
  headers: z
    .record(z.string())
    .refine(
      (h) =>
        Object.keys(h).every((k) =>
          /^(authorization|x-csrf-token|x-xsrf-token|x-requested-with|x-hf-[a-z-]+|user-agent)$/i.test(
            k,
          ),
        ),
      "Unsupported session header",
    ),
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.number(),
      secure: z.boolean(),
    }),
  ),
});
export type Session = z.infer<typeof SessionSchema>;
export const defaultSessionPath = () =>
  join(homedir(), ".config/factor/session.json");
export async function loadSession(path: string): Promise<Session> {
  try {
    return SessionSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new Error("Factor session missing or invalid. Run: pnpm auth:login");
  }
}
export async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(tmp, path);
  await chmod(path, 0o600);
}
export function cookieHeader(session: Session, url: URL, now: number): string {
  return session.cookies
    .filter((c) => {
      const domain = c.domain.replace(/^\./, "");
      return (
        (c.domain.startsWith(".")
          ? url.hostname === domain || url.hostname.endsWith("." + domain)
          : url.hostname === domain) &&
        (url.pathname === c.path ||
          url.pathname.startsWith(
            c.path.endsWith("/") ? c.path : c.path + "/",
          )) &&
        (!c.secure || url.protocol === "https:") &&
        (c.expires === -1 || c.expires * 1000 > now)
      );
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
