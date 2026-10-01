import { describe, it, expect } from "vitest";
import { FactorClient } from "../src/client.js";

const id = "6aa6761c1bd5df46ee14d290";
function harness(data: unknown) {
  const requests: URL[] = [];
  const client = new FactorClient({
    session: async () => ({
      version: 1,
      capturedAt: "2026-10-01T00:00:00Z",
      origin: "https://factormeals.ca",
      basePath: "/gw",
      headers: {},
      cookies: [],
    }),
    now: () => 0,
    fetch: async (input, init) => {
      requests.push(new URL(String(input)));
      expect(init?.method).toBe("GET");
      return Response.json(data);
    },
  });
  return { client, requests };
}
describe("recipe details", () => {
  it("uses the observed same-origin API and preserves compound declarations and allergens", async () => {
    const ingredients = [
      { name: "Seasoning", ingredients: "Salt, celery", id: null },
    ];
    const { client, requests } = harness({
      id,
      name: "Test dish",
      ingredients,
      allergens: [{ name: "Milk" }],
      nutrition: [{ name: "Energy", amount: 500 }],
      descriptionHTML: "Published declaration",
    });
    const result = await client.getRecipeDetails(id);
    expect(result.ingredientsStatus).toBe("provided");
    expect(result.recipe.ingredients).toEqual(ingredients);
    expect(result.recipe.allergens).toEqual([{ name: "Milk" }]);
    expect(requests[0]?.origin).toBe("https://factormeals.ca");
    expect(requests[0]?.pathname).toBe(`/gw/recipes/recipes/${id}`);
    expect(requests[0]?.searchParams.get("country")).toBe("CF");
    expect(requests[0]?.searchParams.get("locale")).toBe("en-CA");
  });
  it("does not interpret missing, null, or empty ingredients as exclusion-free", async () => {
    for (const fields of [{}, { ingredients: null }, { ingredients: [] }]) {
      const { client } = harness({ id, name: "Dish", ...fields });
      expect((await client.getRecipeDetails(id)).ingredientsStatus).toBe(
        "unavailable",
      );
    }
  });
  it("rejects URLs/path injection before sending credentials, and mismatched recipe identity", async () => {
    const { client, requests } = harness({
      id: "6aa6761c1bd5df46ee14d291",
      name: "Other dish",
    });
    await expect(
      client.getRecipeDetails("https://evil.invalid/recipe"),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
    await expect(client.getRecipeDetails(id)).rejects.toMatchObject({
      code: "context_mismatch",
    });
  });
  it("fails closed on malformed ingredient records", async () => {
    const { client } = harness({
      id,
      name: "Dish",
      ingredients: [{ name: 12 }],
    });
    await expect(client.getRecipeDetails(id)).rejects.toMatchObject({
      code: "schema_changed",
    });
  });
});
