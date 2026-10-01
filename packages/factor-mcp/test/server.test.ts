import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FactorClient } from "@firfi/factor-sdk";
import { createServer } from "../src/server.js";
it("negotiates real MCP, lists tools, validates inputs, and gives login guidance without credentials", async () => {
  const factor = new FactorClient({
    session: async () => {
      throw new Error("a private credential string");
    },
    fetch: async () => {
      throw new Error("unexpected network");
    },
    now: () => 0,
  });
  const server = createServer(factor);
  const client = new Client({
    name: "factor-integration-test",
    version: "1.0.0",
  });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right);
    await client.connect(left);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("factor_save_selections");
    expect(tools.tools.map((t) => t.name)).toContain(
      "factor_get_recipe_details",
    );
    expect(
      tools.tools.find((t) => t.name === "factor_save_selections")?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    const health = await client.callTool({
      name: "factor_check_session_health",
      arguments: {},
    });
    expect(health.isError).toBe(true);
    expect(JSON.stringify(health)).toContain("authGuidance");
    expect(JSON.stringify(health)).not.toContain("private credential");
    const invalid = await client.callTool({
      name: "factor_save_selections",
      arguments: { subscriptionId: "7", week: "not-a-week", selections: [] },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
it("reads ingredients through MCP and rejects an arbitrary URL without a request", async () => {
  let requests = 0;
  const id = "6aa6761c1bd5df46ee14d290";
  const factor = new FactorClient({
    session: async () => ({
      version: 1,
      capturedAt: "2026-10-01T00:00:00Z",
      basePath: "/gw",
      headers: {},
      cookies: [],
    }),
    fetch: async () => {
      requests++;
      return Response.json({
        id,
        name: "Dish",
        ingredients: [{ name: "Celery root" }],
      });
    },
    now: () => 0,
  });
  const server = createServer(factor);
  const client = new Client({ name: "recipe-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right);
    await client.connect(left);
    const result = await client.callTool({
      name: "factor_get_recipe_details",
      arguments: { recipeId: id },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("Celery root");
    const invalid = await client.callTool({
      name: "factor_get_recipe_details",
      arguments: { recipeId: "https://evil.invalid" },
    });
    expect(invalid.isError).toBe(true);
    expect(requests).toBe(1);
  } finally {
    await client.close();
    await server.close();
  }
});
