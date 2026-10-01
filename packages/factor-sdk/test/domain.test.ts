import { describe, it, expect } from "vitest";
import {
  editability,
  quota,
  revision,
  selections,
  validateSelection,
} from "../src/domain.js";
import { type Delivery, type Menu } from "../src/schemas.js";
const delivery: Delivery = {
  id: "2026-W40",
  subscriptionId: "7",
  cutoffDate: "2026-10-01T23:59:00-04:00",
  allowedActions: { mealSwap: true },
  product: { handle: "CF-8", specs: { meals: 8, size: 1 } },
};
const menu: Menu = {
  meals: [
    { index: 1, selection: { quantity: 2 } },
    { index: 2, selection: { quantity: 6 } },
    { index: 3, isSoldOut: true },
  ],
};
describe("deadline and quota", () => {
  it("uses the account cutoff offset and locks at the exact cutoff", () => {
    const deadline = Date.parse("2026-10-02T03:59:00Z");
    expect(editability(delivery, deadline - 1000)).toMatchObject({
      editable: true,
      secondsUntilCutoff: 1,
    });
    expect(editability(delivery, deadline)).toMatchObject({
      editable: false,
      reason: "cutoff_passed",
    });
  });
  it("fails closed for missing permissions, missing or offset-free deadlines", () => {
    expect(editability({ ...delivery, allowedActions: {} }, 0).editable).toBe(
      false,
    );
    for (const cutoffDate of [null, "2026-10-01T23:59:00", "bad"])
      expect(editability({ ...delivery, cutoffDate }, 0)).toMatchObject({
        editable: false,
        deadlineKnown: false,
      });
  });
  it("counts quantities, not distinct meal recipes or add-ons", () => {
    expect(quota(delivery, selections(menu))).toEqual({
      planned: 8,
      selected: 8,
      remaining: 0,
      extra: 0,
      status: "filled",
    });
    expect(quota(delivery, [{ index: 1, quantity: 10 }])).toMatchObject({
      extra: 2,
      status: "extra",
    });
    expect(quota(delivery, [{ index: 1, quantity: 5 }])).toMatchObject({
      remaining: 3,
      status: "under",
    });
    expect(quota({ ...delivery, product: {} }, []).status).toBe("unknown");
  });
});
describe("absolute selections and conflict detection", () => {
  it("rejects duplicate, nonexistent, sold-out, and zero quantity picks", () => {
    for (const input of [
      [
        { index: 1, quantity: 1 },
        { index: 1, quantity: 2 },
      ],
      [{ index: 99, quantity: 8 }],
      [{ index: 3, quantity: 8 }],
      [{ index: 1, quantity: 0 }],
    ])
      expect(() => validateSelection(menu, input)).toThrow();
  });
  it("deduplicates identical catalog entries and rejects conflicting quantities", () => {
    expect(selections({ meals: [menu.meals[0]!, menu.meals[0]!] })).toEqual([
      { index: 1, quantity: 2 },
    ]);
    expect(() =>
      selections({
        meals: [
          { index: 1, selection: { quantity: 1 } },
          { index: 1, selection: { quantity: 2 } },
        ],
      }),
    ).toThrow(/Conflicting/);
  });
  it("revision covers selection, plan size, add-ons, deadline, and permissions", () => {
    const baseline = revision(delivery, menu);
    expect(revision(delivery, { ...menu, addOns: { selected: 1 } })).not.toBe(
      baseline,
    );
    expect(
      revision({ ...delivery, allowedActions: { mealSwap: false } }, menu),
    ).not.toBe(baseline);
    expect(
      revision({ ...delivery, product: { specs: { meals: 10 } } }, menu),
    ).not.toBe(baseline);
  });
});

it("keeps the current local calendar week after UTC rolls into next Monday", async () => {
  const { calendarWeekWindow } = await import("../src/domain.js");
  expect(calendarWeekWindow(Date.parse("2026-10-05T02:00:00Z"))).toEqual({
    today: "2026-10-04",
    start: "2026-09-28",
    end: "2026-10-04",
  });
});
