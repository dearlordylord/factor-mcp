import { it, expect } from "vitest";
import { mkdtemp, stat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cookieHeader,
  SessionSchema,
  writePrivateJson,
  loadSession,
  type Session,
} from "../src/session.js";
it("only sends unexpired domain/path-matching cookies", () => {
  const session: Session = {
    version: 1,
    capturedAt: "2026-09-30T12:00:00Z",
    basePath: "/gw",
    headers: {},
    cookies: [
      {
        name: "good",
        value: "1",
        domain: ".factormeals.ca",
        path: "/",
        expires: -1,
        secure: true,
      },
      {
        name: "expired",
        value: "2",
        domain: ".factormeals.ca",
        path: "/",
        expires: 1,
        secure: true,
      },
      {
        name: "foreign",
        value: "3",
        domain: ".example.com",
        path: "/",
        expires: -1,
        secure: true,
      },
      {
        name: "wrongPath",
        value: "4",
        domain: ".factormeals.ca",
        path: "/login",
        expires: -1,
        secure: true,
      },
    ],
  };
  expect(
    cookieHeader(session, new URL("https://www.factormeals.ca/gw/api"), 2000),
  ).toBe("good=1");
  expect(
    cookieHeader(session, new URL("https://evifactormeals.ca/gw/api"), 2000),
  ).toBe("");
});
it("rejects arbitrary header injection and gateway destinations", () => {
  expect(
    SessionSchema.safeParse({
      version: 1,
      capturedAt: "2026-09-30T12:00:00Z",
      basePath: "https://example.com",
      headers: {},
      cookies: [],
    }).success,
  ).toBe(false);
  expect(
    SessionSchema.safeParse({
      version: 1,
      capturedAt: "2026-09-30T12:00:00Z",
      basePath: "/gw",
      headers: { host: "example.com" },
      cookies: [],
    }).success,
  ).toBe(false);
});
it("stores snapshots atomically with private file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "factor-session-"));
  const path = join(dir, "session.json");
  try {
    const value = {
      version: 1,
      capturedAt: "2026-09-30T12:00:00Z",
      basePath: "/gw",
      headers: {},
      cookies: [],
    };
    await writePrivateJson(path, value);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadSession(path)).toEqual(value);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value);
  } finally {
    await rm(dir, { recursive: true });
  }
});
