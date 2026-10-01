import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FactorClient,
  FactorError,
  IdSchema,
  RecipeIdSchema,
  WeekSchema,
  SelectionsSchema,
  editability,
} from "@firfi/factor-sdk";

export function createServer(client: FactorClient) {
  const server = new McpServer({ name: "factor-meals-ca", version: "0.1.0" });
  const readAnnotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  const context = { subscriptionId: IdSchema, week: WeekSchema };
  async function result(run: () => Promise<unknown>) {
    try {
      const data = await run();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
      };
    } catch (error) {
      // Never serialize raw transport errors, headers, or schema inputs.
      const known = error instanceof FactorError;
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              code: known ? error.code : "operation_failed",
              message: known
                ? error.message
                : error instanceof z.ZodError
                  ? "Invalid input or Factor response shape"
                  : error instanceof Error &&
                      /^(Meal index |Selection |Duplicate |Conflicting )/.test(
                        error.message,
                      )
                    ? error.message
                    : "Factor operation failed. Check session and local API evidence.",
              writeMayHaveSucceeded: known && error.writeMayHaveSucceeded,
              ...(known && error.code === "auth_required"
                ? {
                    authGuidance:
                      "Run pnpm auth:login in the Factor workspace; the next call reloads the session.",
                  }
                : {}),
            }),
          },
        ],
      };
    }
  }
  server.registerTool(
    "factor_check_session_health",
    {
      description:
        "Check authenticated Factor Canada access. Credentials never appear in tool output.",
      inputSchema: {},
      annotations: readAnnotations,
    },
    () =>
      result(async () => ({
        authenticated: true,
        subscriptionCount: (await client.getSubscriptions()).length,
      })),
  );
  server.registerTool(
    "factor_get_subscriptions",
    {
      description:
        "List account subscription IDs, plan specs, and dietary preset. Use a subscription ID to choose the correct plan.",
      inputSchema: {},
      annotations: readAnnotations,
    },
    () =>
      result(async () =>
        (await client.getSubscriptions()).map((s) => ({
          id: s.id,
          state: s.state ?? s.status ?? null,
          preset: s.preset ?? null,
          product: s.product ?? s.productType ?? null,
        })),
      ),
  );
  server.registerTool(
    "factor_get_deliveries",
    {
      description:
        "List upcoming deliveries or an explicit week range. Includes authoritative server permissions and edit cutoff timestamps.",
      inputSchema: {
        rangeStart: WeekSchema.optional(),
        rangeEnd: WeekSchema.optional(),
      },
      annotations: readAnnotations,
    },
    (args) =>
      result(async () =>
        (await client.getDeliveries(args.rangeStart, args.rangeEnd)).map(
          (d) => ({ ...d, editability: editability(d, Date.now()) }),
        ),
      ),
  );
  server.registerTool(
    "factor_get_current_week",
    {
      description:
        "Get this calendar week’s delivery, including already delivered meals; fall back to the next upcoming delivery when none exists this week. Returns saved quantities, full menu, quota, deadline, revision, and which week rule was used.",
      inputSchema: { subscriptionId: IdSchema.optional() },
      annotations: readAnnotations,
    },
    (args) => result(() => client.getCurrentWeek(args.subscriptionId)),
  );
  server.registerTool(
    "factor_get_week",
    {
      description:
        "Read a specific delivery week, its available meals and quantities, saved selections, quota, and whether editing remains available until the server cutoff.",
      inputSchema: context,
      annotations: readAnnotations,
    },
    (args) => result(() => client.getWeek(args.subscriptionId, args.week)),
  );
  server.registerTool(
    "factor_get_order_history",
    {
      description:
        "Read older orders, order lines, and payment/delivery history. The response limit is explicit; results are not claimed to be complete beyond it.",
      inputSchema: { limit: z.number().int().min(1).max(500).default(50) },
      annotations: readAnnotations,
    },
    (args) => result(() => client.getOrderHistory(args.limit)),
  );
  server.registerTool(
    "factor_get_recipe_details",
    {
      description:
        "Read a recipe’s published ingredient list, allergens, description and nutrition directly from Factor. Use recipe.id from the weekly menu. ingredientsStatus=unavailable means ingredients are missing or empty, never that exclusions are absent. Published lists may omit compound ingredient details; do not claim allergy safety or absence of an ingredient from incomplete data.",
      inputSchema: { recipeId: RecipeIdSchema },
      annotations: readAnnotations,
    },
    (args) => result(() => client.getRecipeDetails(args.recipeId)),
  );
  server.registerTool(
    "factor_get_past_deliveries",
    {
      description:
        "Read past delivered meals and feedback using Factor’s past-deliveries endpoint. Pass its returned older-week cursor as from where available.",
      inputSchema: { subscriptionId: IdSchema, from: WeekSchema.optional() },
      annotations: readAnnotations,
    },
    (args) =>
      result(() => client.getPastDeliveries(args.subscriptionId, args.from)),
  );
  server.registerTool(
    "factor_preview_selections",
    {
      description:
        "Preview an absolute replacement of this week’s main-meal quantities. Returns quota impact and a revision for optional conflict protection. Does not save.",
      inputSchema: { ...context, selections: SelectionsSchema },
      annotations: readAnnotations,
    },
    (args) =>
      result(() =>
        client.previewSelections(
          args.subscriptionId,
          args.week,
          args.selections,
        ),
      ),
  );
  server.registerTool(
    "factor_save_selections",
    {
      description:
        "Automatically replace and SAVE weekly main-meal quantities, preserving add-ons. Checks current deadline, permissions, valid meal indices, and plan quota; verifies by reading saved selections back. Unlisted main meals are removed. Extra or under-quota selections require explicit intent via their flags. Optional expectedRevision prevents overwriting a changed snapshot. Do not blindly retry if writeMayHaveSucceeded is true.",
      inputSchema: {
        ...context,
        selections: SelectionsSchema,
        expectedRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        allowUnderQuota: z.boolean().default(false),
        allowExtraMeals: z.boolean().default(false),
      },
      annotations: writeAnnotations,
    },
    (args) =>
      result(() =>
        client.saveSelections(args.subscriptionId, args.week, args.selections, {
          ...(args.expectedRevision
            ? { expectedRevision: args.expectedRevision }
            : {}),
          allowUnderQuota: args.allowUnderQuota,
          allowExtraMeals: args.allowExtraMeals,
        }),
      ),
  );
  return server;
}
