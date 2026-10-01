import { z } from "zod";
import { ORIGIN, cookieHeader, loadSession, type Session } from "./session.js";
import {
  DeliveriesSchema,
  DeliverySchema,
  HistorySchema,
  PastDeliveriesSchema,
  IdSchema,
  MenuSchema,
  SubscriptionsSchema,
  WeekSchema,
  RecipeIdSchema,
  RecipeDetailsSchema,
  type Delivery,
  type Menu,
  type Subscription,
} from "./schemas.js";
import {
  calendarWeekWindow,
  editability,
  quota,
  revision,
  sameSelection,
  selections,
  validateSelection,
} from "./domain.js";

export interface FactorPorts {
  session: () => Promise<Session>;
  fetch: typeof fetch;
  now: () => number;
  timeZone?: string;
}
export class FactorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly writeMayHaveSucceeded = false,
  ) {
    super(message);
    this.name = "FactorError";
  }
}
export class FactorClient {
  private writeTail: Promise<unknown> = Promise.resolve();
  constructor(private readonly ports: FactorPorts) {}
  static fromSession(path: string) {
    return new FactorClient({
      session: () => loadSession(path),
      fetch: globalThis.fetch,
      now: () => Date.now(),
    });
  }
  private async request<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    query: Record<string, string> = {},
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let session: Session;
    try {
      session = await this.ports.session();
    } catch {
      throw new FactorError(
        "auth_required",
        "Factor session missing or invalid. Run: pnpm auth:login",
      );
    }
    const url = new URL(
      (session.basePath === "/" ? "" : session.basePath) + path,
      session.origin ?? ORIGIN,
    );
    url.searchParams.set("country", "CF");
    url.searchParams.set("locale", "en-CA");
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    const headers: Record<string, string> = {
      ...session.headers,
      accept: "application/json",
      origin: url.origin,
      referer: url.origin + "/my-deliveries",
      cookie: cookieHeader(session, url, this.ports.now()),
    };
    if (path === "/my-deliveries/menu") {
      headers["X-Market-API-Version"] = "3";
      headers["X-Food-Categorization"] = "false";
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await this.ports.fetch(url, {
        method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new FactorError(
        "network_error",
        method === "GET"
          ? "Factor request failed; try again."
          : "Factor save response was lost. Read the week before attempting another save.",
        method !== "GET",
      );
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 302
    )
      throw new FactorError(
        "auth_required",
        "Factor session expired or access denied. Run: pnpm auth:login",
      );
    if (response.status === 429)
      throw new FactorError(
        "rate_limited",
        `Factor rate limited the request. Retry after ${response.headers.get("retry-after") ?? "the server cooldown"} seconds.`,
      );
    if (!response.ok)
      throw new FactorError(
        "api_error",
        `Factor returned HTTP ${response.status}. No automatic mutation retry was attempted.`,
      );
    if (response.status === 204) return schema.parse(null);
    if (!response.headers.get("content-type")?.includes("json"))
      throw new FactorError(
        "unexpected_response",
        "Factor returned a non-JSON response. Refresh the session.",
        method !== "GET",
      );
    let data: unknown;
    try {
      data = await response.json();
      return schema.parse(data);
    } catch {
      throw new FactorError(
        "schema_changed",
        "Factor response did not match the expected API contract. Inspect local capture evidence before continuing.",
        method !== "GET",
      );
    }
  }
  async getSubscriptions() {
    const result = await this.request(
      "/api/customers/me/subscriptions",
      SubscriptionsSchema,
    );
    return result.items;
  }
  async getRecipeDetails(recipeId: string) {
    const id = RecipeIdSchema.parse(recipeId);
    const recipe = await this.request(
      `/recipes/recipes/${id}`,
      RecipeDetailsSchema,
    );
    if (recipe.id !== id)
      throw new FactorError(
        "context_mismatch",
        "Factor returned a different recipe",
      );
    return {
      recipe,
      ingredientsStatus: recipe.ingredients?.length
        ? "provided"
        : "unavailable",
      source: "/recipes/recipes/{recipeId}",
      // A published ingredient list may omit compound ingredient details.
      ingredientScope: "factor_published_list",
    };
  }
  async getDeliveries(rangeStart?: string, rangeEnd?: string) {
    const query: Record<string, string> = {};
    if (rangeStart) query.rangeStart = WeekSchema.parse(rangeStart);
    if (rangeEnd) query.rangeEnd = WeekSchema.parse(rangeEnd);
    return (
      await this.request(
        "/api/customers/me/deliveries",
        DeliveriesSchema,
        query,
      )
    ).items;
  }
  private async subscription(id: string): Promise<Subscription> {
    const subscriptions = await this.getSubscriptions();
    const found = subscriptions.find((s) => s.id === id);
    if (!found)
      throw new FactorError(
        "subscription_not_found",
        "Subscription does not belong to this account",
      );
    return found;
  }
  private async context(
    subscriptionId: string,
    week: string,
  ): Promise<{ subscription: Subscription; delivery: Delivery; menu: Menu }> {
    const id = IdSchema.parse(subscriptionId);
    const w = WeekSchema.parse(week);
    const subscription = await this.subscription(id);
    const delivery = await this.request(
      `/api/subscriptions/${encodeURIComponent(id)}/delivery_dates/${w}`,
      DeliverySchema,
    );
    if (delivery.subscriptionId !== id || delivery.id !== w)
      throw new FactorError(
        "context_mismatch",
        "Factor returned a different week or subscription",
      );
    const sku = delivery.product?.handle ?? delivery.product?.sku;
    if (!sku)
      throw new FactorError(
        "context_missing",
        "Delivery product SKU is missing",
      );
    const query: Record<string, string> = {
      subscription: id,
      week: w,
      "product-sku": sku,
      servings: String(delivery.product?.specs?.size ?? 0),
      "exclude-feedback": "true",
      "include-future-feedback": "false",
    };
    if (subscription.preset) query.preference = subscription.preset;
    if (subscription.shippingAddress?.postcode)
      query.postcode = subscription.shippingAddress.postcode;
    if (delivery.deliveryOption?.handle)
      query["delivery-option"] = delivery.deliveryOption.handle;
    if (subscription.customerPlanId)
      query.customerPlanId = subscription.customerPlanId;
    const menu = await this.request("/my-deliveries/menu", MenuSchema, query);
    if (menu.week && menu.week !== w)
      throw new FactorError(
        "context_mismatch",
        "Factor returned a menu for a different week",
      );
    return { subscription, delivery, menu };
  }
  async getWeek(subscriptionId: string, week: string) {
    const { delivery, menu } = await this.context(subscriptionId, week);
    return {
      week,
      subscriptionId,
      delivery,
      menu,
      selectionOrigin:
        menu.mealsPreselected === true
          ? "factor_preselected"
          : menu.mealsPreselected === false
            ? "user_selected"
            : "unknown",
      selectedMeals: selections(menu),
      quota: quota(delivery, selections(menu)),
      editability: editability(delivery, this.ports.now()),
      revision: revision(delivery, menu),
    };
  }
  async getCurrentWeek(subscriptionId?: string) {
    const deliveries = await this.getDeliveries();
    const window = calendarWeekWindow(this.ports.now(), this.ports.timeZone);
    const matching = deliveries
      .filter(
        (d) =>
          (!subscriptionId || d.subscriptionId === subscriptionId) &&
          d.deliveryDate,
      )
      .sort((a, b) =>
        String(a.deliveryDate).localeCompare(String(b.deliveryDate)),
      );
    const thisWeek = matching.filter(
      (d) =>
        String(d.deliveryDate).slice(0, 10) >= window.start &&
        String(d.deliveryDate).slice(0, 10) <= window.end,
    );
    const candidates = thisWeek.length
      ? thisWeek
      : matching.filter(
          (d) => String(d.deliveryDate).slice(0, 10) >= window.today,
        );
    if (
      !subscriptionId &&
      new Set(candidates.map((d) => d.subscriptionId)).size > 1
    )
      throw new FactorError(
        "subscription_required",
        "More than one subscription has deliveries. Specify a subscription ID.",
      );
    const selected = candidates[0];
    if (!selected)
      throw new FactorError(
        "no_upcoming_delivery",
        "No current or upcoming delivery found. List deliveries and choose an explicit week.",
      );
    return {
      ...(await this.getWeek(selected.subscriptionId, selected.id)),
      currentWeekSource: thisWeek.length
        ? "this_calendar_week"
        : "next_upcoming_delivery",
      calendarWeek: window,
    };
  }
  async getOrderHistory(limit = 50) {
    return this.request("/api/customers/me/orders", HistorySchema, {
      limit: String(z.number().int().min(1).max(500).parse(limit)),
    });
  }
  async getPastDeliveries(subscriptionId: string, from?: string) {
    await this.subscription(IdSchema.parse(subscriptionId));
    return this.request("/my-deliveries/past-deliveries", z.unknown(), {
      subscription: subscriptionId,
      ...(from ? { from: WeekSchema.parse(from) } : {}),
    });
  }
  async previewSelections(
    subscriptionId: string,
    week: string,
    input: unknown,
  ) {
    const current = await this.getWeek(subscriptionId, week);
    const desired = validateSelection(current.menu, input);
    return {
      week,
      subscriptionId,
      desired,
      quota: quota(current.delivery, desired),
      editability: current.editability,
      expectedRevision: current.revision,
      changed: !sameSelection(current.selectedMeals, desired),
      addOnsPreserved: true,
    };
  }
  async saveSelections(
    subscriptionId: string,
    week: string,
    input: unknown,
    options: {
      expectedRevision?: string;
      allowUnderQuota?: boolean;
      allowExtraMeals?: boolean;
    } = {},
  ) {
    // Serialize writes in this server process. An external website edit is checked via revision.
    const run = () => this.save(subscriptionId, week, input, options);
    const task = this.writeTail.then(run, run);
    this.writeTail = task.catch(() => undefined);
    return task;
  }
  private async save(
    subscriptionId: string,
    week: string,
    input: unknown,
    options: {
      expectedRevision?: string;
      allowUnderQuota?: boolean;
      allowExtraMeals?: boolean;
    },
  ) {
    const { subscription, delivery, menu } = await this.context(
      subscriptionId,
      week,
    );
    if (!editability(delivery, this.ports.now()).editable)
      throw new FactorError(
        "week_locked",
        "This week cannot be edited or its deadline/permission is unknown",
      );
    if (
      options.expectedRevision &&
      options.expectedRevision !== revision(delivery, menu)
    )
      throw new FactorError(
        "stale_revision",
        "Selections, plan, add-ons, or edit permissions changed. Read the week again.",
      );
    const desired = validateSelection(menu, input);
    const q = quota(delivery, desired);
    if (q.status === "unknown")
      throw new FactorError(
        "quota_unknown",
        "Cannot save without an authoritative weekly plan size",
      );
    if (q.status === "under" && !options.allowUnderQuota)
      throw new FactorError(
        "under_quota",
        "Selection is below the weekly quota. Set allowUnderQuota only when intentional.",
      );
    if (q.status === "extra" && !options.allowExtraMeals)
      throw new FactorError(
        "extra_meals",
        "Selection exceeds the weekly quota and may increase charges. Set allowExtraMeals only when intentional.",
      );
    if (sameSelection(selections(menu), desired))
      return { saved: true, changed: false, verified: true, week, quota: q };
    const customer = subscription.customer?.id;
    const sku = delivery.product?.handle ?? delivery.product?.sku;
    if (!customer || !sku)
      throw new FactorError(
        "context_missing",
        "Customer ID or product SKU is missing; no save was sent",
      );
    // The web app uses ignore_addons for main-meal-only updates. Existing extras stay on the server.
    const query: Record<string, string> = {
      subscription: subscriptionId,
      customer,
      week,
      "product-sku": sku,
      update_quantity: "true",
      ignore_addons: "true",
    };
    if (subscription.preset) query.preference = subscription.preset;
    if (delivery.cutoffDate) query.cutoff_time = delivery.cutoffDate;
    // Recheck the clock after all local validation, immediately before sending.
    if (!editability(delivery, this.ports.now()).editable)
      throw new FactorError(
        "week_locked",
        "The edit deadline passed before saving",
      );
    await this.request(`/v1/carts/${week}`, z.unknown(), query, "PUT", {
      meals: desired,
      extras: [],
    });
    let after;
    try {
      after = await this.getWeek(subscriptionId, week);
    } catch {
      throw new FactorError(
        "verification_failed",
        "Save was submitted but read-back failed. Read the week before retrying.",
        true,
      );
    }
    if (!sameSelection(after.selectedMeals, desired))
      throw new FactorError(
        "verification_failed",
        "Factor did not return the requested saved quantities. Read the week before retrying.",
        true,
      );
    return {
      saved: true,
      changed: true,
      verified: true,
      week,
      quota: after.quota,
      selectedMeals: after.selectedMeals,
      revision: after.revision,
      editability: after.editability,
    };
  }
}
