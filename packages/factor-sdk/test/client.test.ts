import { describe, it, expect } from "vitest";
import { FactorClient, FactorError } from "../src/client.js";
import { type Session } from "../src/session.js";
const session: Session = {
  version: 1,
  capturedAt: "2026-09-30T12:00:00Z",
  basePath: "/gw",
  headers: { authorization: "Bearer private-test-secret" },
  cookies: [],
};
function harness(
  options: {
    locked?: boolean;
    quota?: number;
    unchanged?: boolean;
    writeFailure?: boolean;
    readFailure?: boolean;
    status?: number;
  } = {},
) {
  let saved = false;
  let choices = [
    { index: 1, quantity: 4 },
    { index: 2, quantity: 4 },
  ];
  const requests: { url: URL; method: string; body: unknown }[] = [];
  const client = new FactorClient({
    session: async () => session,
    now: () => Date.parse("2026-09-30T12:00:00Z"),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, method, body });
      if (options.status)
        return new Response("private error text", { status: options.status });
      if (saved && options.readFailure)
        throw new Error("private network diagnostic");
      let data: unknown;
      if (url.pathname.endsWith("/customers/me/subscriptions"))
        data = {
          items: [{ id: 7, preset: "protein-plus", customer: { id: 9 } }],
        };
      else if (url.pathname.includes("/delivery_dates/"))
        data = {
          id: "2026-W40",
          subscriptionId: 7,
          deliveryDate: "2026-10-05",
          cutoffDate: "2026-10-01T23:59:00-04:00",
          allowedActions: { mealSwap: !options.locked },
          product: {
            handle: "CF-8",
            specs: { meals: options.quota ?? 8, size: 1 },
          },
        };
      else if (url.pathname.endsWith("/my-deliveries/menu"))
        data = {
          week: "2026-W40",
          meals: [1, 2, 3].map((index) => ({
            index,
            selection: {
              quantity: choices.find((c) => c.index === index)?.quantity ?? 0,
            },
          })),
          addOns: { groups: [{ selected: true }] },
        };
      else if (method === "PUT") {
        if (options.writeFailure) throw new Error("private network diagnostic");
        if (!options.unchanged) choices = body.meals;
        saved = true;
        return new Response(null, { status: 204 });
      } else throw new Error("Unexpected test request");
      return Response.json(data);
    },
  });
  return { client, requests };
}
describe("Factor save protocol", () => {
  it("checks fresh server state, preserves add-ons, and verifies actual saved quantities", async () => {
    const { client, requests } = harness();
    const result = await client.saveSelections("7", "2026-W40", [
      { index: 3, quantity: 8 },
    ]);
    expect(result).toMatchObject({
      saved: true,
      verified: true,
      selectedMeals: [{ index: 3, quantity: 8 }],
    });
    const writes = requests.filter((r) => r.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url.pathname).toBe("/gw/v1/carts/2026-W40");
    expect(writes[0]?.url.searchParams.get("country")).toBe("CF");
    expect(writes[0]?.url.searchParams.get("ignore_addons")).toBe("true");
    expect(writes[0]?.body).toEqual({
      meals: [{ index: 3, quantity: 8 }],
      extras: [],
    });
  });
  it("does not write a locked week, unknown quota, under/extra selections, or stale revision", async () => {
    for (const scenario of [{ locked: true }, { quota: 0 }]) {
      const { client, requests } = harness(scenario);
      await expect(
        client.saveSelections("7", "2026-W40", [{ index: 3, quantity: 8 }]),
      ).rejects.toMatchObject({
        code: scenario.locked ? "week_locked" : "quota_unknown",
      });
      expect(requests.some((r) => r.method === "PUT")).toBe(false);
    }
    const stale = harness();
    await expect(
      stale.client.saveSelections(
        "7",
        "2026-W40",
        [{ index: 3, quantity: 8 }],
        { expectedRevision: "0".repeat(64) },
      ),
    ).rejects.toMatchObject({ code: "stale_revision" });
    expect(stale.requests.some((r) => r.method === "PUT")).toBe(false);
    for (const count of [7, 9]) {
      const { client, requests } = harness();
      await expect(
        client.saveSelections("7", "2026-W40", [{ index: 3, quantity: count }]),
      ).rejects.toMatchObject({
        code: count < 8 ? "under_quota" : "extra_meals",
      });
      expect(requests.some((r) => r.method === "PUT")).toBe(false);
    }
  });
  it("allows explicitly intentional quota differences", async () => {
    const { client } = harness();
    expect(
      await client.saveSelections(
        "7",
        "2026-W40",
        [{ index: 3, quantity: 9 }],
        { allowExtraMeals: true },
      ),
    ).toMatchObject({ saved: true, quota: { extra: 1 } });
  });
  it("no-ops identical absolute selections", async () => {
    const { client, requests } = harness();
    expect(
      await client.saveSelections("7", "2026-W40", [
        { index: 2, quantity: 4 },
        { index: 1, quantity: 4 },
      ]),
    ).toMatchObject({ changed: false, verified: true });
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
  it("never retries an uncertain write or falsely claims it saved", async () => {
    for (const options of [
      { writeFailure: true },
      { unchanged: true },
      { readFailure: true },
    ]) {
      const { client, requests } = harness(options);
      await expect(
        client.saveSelections("7", "2026-W40", [{ index: 3, quantity: 8 }]),
      ).rejects.toMatchObject({ writeMayHaveSucceeded: true });
      expect(requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    }
  });
  it("returns session guidance without returning server response bodies", async () => {
    const { client } = harness({ status: 403 });
    await expect(client.getSubscriptions()).rejects.toMatchObject({
      code: "auth_required",
    });
    try {
      await client.getSubscriptions();
    } catch (e) {
      expect(String(e)).not.toContain("private error text");
    }
  });
});

it("uses the captured Factor origin instead of sending apex cookies or tokens to www", async () => {
  const seen: string[] = [];
  const client = new FactorClient({
    session: async () => ({ ...session, origin: "https://factormeals.ca" }),
    now: () => 0,
    fetch: async (input, init) => {
      seen.push(String(input));
      expect(new Headers(init?.headers).get("origin")).toBe(
        "https://factormeals.ca",
      );
      return Response.json({ items: [] });
    },
  });
  await client.getSubscriptions();
  expect(seen[0]).toContain("https://factormeals.ca/gw/api/");
});
