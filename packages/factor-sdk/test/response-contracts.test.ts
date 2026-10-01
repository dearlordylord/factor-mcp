import { it, expect } from "vitest";
import {
  HistorySchema,
  MenuSchema,
  PastDeliveriesSchema,
} from "../src/schemas.js";
it("accepts nullable Factor history pagination metadata and excludes payment credentials and addresses", () => {
  const data = HistorySchema.parse({
    count: 1,
    total: null,
    take: null,
    skip: null,
    items: [
      {
        id: "order-1",
        grandTotal: 99.5,
        paymentTokenId: "do-not-expose",
        ptsTokenId: "do-not-expose",
        shippingAddress: { postcode: "private" },
        orderLines: [
          {
            name: "Six-meal box",
            paidPrice: 99.5,
            paymentStatus: "paid",
            subscription: { id: 7, customer: { address: "private" } },
          },
        ],
      },
    ],
  });
  expect(data.items[0]?.grandTotal).toBe(99.5);
  expect(data.total).toBeNull();
  expect(JSON.stringify(data)).not.toContain("do-not-expose");
  expect(JSON.stringify(data)).not.toContain("private");
});
it("preserves preselection status and nested recipe nutrition for automated meal choices", () => {
  const data = MenuSchema.parse({
    id: "menu",
    week: "2026-W41",
    mealsPreselected: true,
    mealsReady: true,
    meals: [
      {
        index: 7101,
        selection: { quantity: 1 },
        recipe: {
          id: "recipe",
          name: "BBQ Chicken",
          nutrition: { calories: 660, protein: 47 },
          tags: [{ name: "Protein Plus" }],
        },
      },
    ],
  });
  expect(data.mealsPreselected).toBe(true);
  expect(data.meals[0]?.recipe?.nutrition?.protein).toBe(47);
});
it("parses Factor past-delivery pages and their older-week cursor", () => {
  expect(
    PastDeliveriesSchema.parse({
      weeks: [
        {
          week: "2026-W40",
          menuId: "menu",
          meals: [{ id: "recipe", name: "Chicken" }],
        },
      ],
      nextWeek: "2026-W36",
    }).nextWeek,
  ).toBe("2026-W36");
});
