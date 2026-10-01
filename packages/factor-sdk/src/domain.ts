import { createHash } from "node:crypto";
import {
  type Delivery,
  type Menu,
  type Selection,
  SelectionsSchema,
} from "./schemas.js";

export function editability(delivery: Delivery, now: number) {
  // Offset-free timestamps cannot prove a deadline across timezones/DST.
  const cutoff = delivery.cutoffDate;
  const time =
    cutoff && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(cutoff)
      ? Date.parse(cutoff)
      : NaN;
  const known = Number.isFinite(time);
  const beforeCutoff = known && now < time;
  const editable = delivery.allowedActions?.mealSwap === true && beforeCutoff;
  return {
    editable,
    allowedByServer: delivery.allowedActions?.mealSwap ?? null,
    cutoffAt: cutoff ?? null,
    deadlineKnown: known,
    secondsUntilCutoff: known
      ? Math.max(0, Math.floor((time - now) / 1000))
      : null,
    reason: editable
      ? "editable"
      : !known
        ? "deadline_unknown"
        : !beforeCutoff
          ? "cutoff_passed"
          : delivery.allowedActions?.mealSwap === false
            ? "server_locked"
            : "permission_unknown",
  };
}
export function uniqueMeals(menu: Menu) {
  const meals = new Map<number, Menu["meals"][number]>();
  for (const meal of menu.meals) {
    const old = meals.get(meal.index);
    if (
      old &&
      (old.selection?.quantity ?? 0) !== (meal.selection?.quantity ?? 0)
    )
      throw new Error(
        "Conflicting duplicate meal selections in Factor response",
      );
    if (!old) meals.set(meal.index, meal);
  }
  return [...meals.values()];
}
export function selections(menu: Menu): Selection[] {
  return uniqueMeals(menu)
    .filter((m) => (m.selection?.quantity ?? 0) > 0)
    .map((m) => ({ index: m.index, quantity: m.selection?.quantity ?? 0 }))
    .sort((a, b) => a.index - b.index);
}
export function quota(delivery: Delivery, chosen: readonly Selection[]) {
  const planned = delivery.product?.specs?.meals;
  const selected = chosen.reduce((n, x) => n + x.quantity, 0);
  if (planned === undefined || planned <= 0)
    return {
      planned: null,
      selected,
      remaining: null,
      extra: null,
      status: "unknown",
    };
  return {
    planned,
    selected,
    remaining: Math.max(0, planned - selected),
    extra: Math.max(0, selected - planned),
    status:
      selected < planned ? "under" : selected > planned ? "extra" : "filled",
  };
}
export function revision(delivery: Delivery, menu: Menu): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        week: delivery.id,
        subscription: delivery.subscriptionId,
        product: delivery.product,
        cutoff: delivery.cutoffDate,
        actions: delivery.allowedActions,
        selection: selections(menu),
        addOns: menu.addOns,
      }),
    )
    .digest("hex");
}
export function validateSelection(menu: Menu, input: unknown): Selection[] {
  const desired = SelectionsSchema.parse(input).sort(
    (a, b) => a.index - b.index,
  );
  const available = uniqueMeals(menu);
  for (const choice of desired) {
    const meal = available.find((m) => m.index === choice.index);
    if (!meal)
      throw new Error(`Meal index ${choice.index} is not in this week’s menu`);
    if (meal.isSoldOut || meal.isAvailable === false)
      throw new Error(`Meal index ${choice.index} is unavailable`);
  }
  return desired;
}
export function sameSelection(
  a: readonly Selection[],
  b: readonly Selection[],
) {
  return (
    JSON.stringify([...a].sort((x, y) => x.index - y.index)) ===
    JSON.stringify([...b].sort((x, y) => x.index - y.index))
  );
}

export function calendarWeekWindow(now: number, timeZone = "America/Toronto") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const date = new Date(today + "T00:00:00Z");
  const weekday = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - weekday * 86_400_000);
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return {
    today,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}
