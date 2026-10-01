import { it, expect } from "vitest";
import { createCaptureServer } from "../src/capture-server.js";
import { type Session } from "@firfi/factor-sdk";
const session = {
  version: 1,
  capturedAt: "2026-09-30T12:00:00Z",
  origin: "https://factormeals.ca",
  basePath: "/gw",
  headers: { authorization: "Bearer private-session-token" },
  cookies: [],
};
it("requires the local capture key, validates origins, and persists only one session without returning credentials", async () => {
  const captured: Session[] = [];
  const server = createCaptureServer("local-key", async (s) => {
    captured.push(s);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const url = `http://127.0.0.1:${address.port}/capture`;
    const send = (data: unknown, key = "local-key") =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ session: data }),
      });
    expect((await send(session, "wrong-key")).status).toBe(403);
    expect(
      (await send({ ...session, origin: "https://attacker.example" })).status,
    ).toBe(400);
    const success = await send(session);
    expect(success.status).toBe(200);
    expect(await success.text()).toBe('{"saved":true}');
    expect(captured).toEqual([session]);
    expect((await send(session)).status).toBe(409);
    expect(captured).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
