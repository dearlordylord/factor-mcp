import { z } from "zod";
export const IdSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String);
export const WeekSchema = z
  .string()
  .regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/);
export const RecipeIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
export const IngredientSchema = z
  .object({
    id: z.string().nullable().optional(),
    name: z.string().min(1),
    slug: z.string().optional(),
  })
  .passthrough();
const NumericCount = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative());
export const ProductSchema = z.object({
  handle: z.string().optional(),
  sku: z.string().optional(),
  specs: z
    .object({ meals: NumericCount.optional(), size: NumericCount.optional() })
    .optional(),
});
export const SubscriptionSchema = z.object({
  id: IdSchema,
  state: z.string().optional(),
  status: z.string().optional(),
  preset: z.string().optional(),
  customer: z.object({ id: IdSchema }).optional(),
  product: ProductSchema.optional(),
  productType: ProductSchema.optional(),
  shippingAddress: z.object({ postcode: z.string().optional() }).optional(),
  customerPlanId: IdSchema.optional(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;
export const SubscriptionsSchema = z.object({
  items: z.array(SubscriptionSchema),
});
export const DeliverySchema = z.object({
  id: WeekSchema,
  subscriptionId: IdSchema,
  cutoffDate: z.string().nullable().optional(),
  deliveryDate: z.string().optional(),
  state: z.string().optional(),
  status: z.string().optional(),
  orderId: IdSchema.nullable().optional(),
  allowedActions: z
    .object({ mealSwap: z.boolean().optional(), skip: z.boolean().optional() })
    .optional(),
  product: ProductSchema.optional(),
  deliveryOption: z.object({ handle: z.string().optional() }).optional(),
});
export type Delivery = z.infer<typeof DeliverySchema>;
export const DeliveriesSchema = z.object({ items: z.array(DeliverySchema) });
export const RecipeSchema = z.object({
  id: IdSchema.optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  prepTime: z.string().optional(),
  totalTime: z.string().optional(),
  image: z.string().optional(),
  websiteURL: z.string().optional(),
  tags: z.array(z.unknown()).optional(),
  cuisines: z.array(z.unknown()).optional(),
  category: z.string().optional(),
  nutrition: z
    .object({
      calories: z.number().optional(),
      protein: z.number().optional(),
      fat: z.number().optional(),
      carbohydrate: z.number().optional(),
    })
    .passthrough()
    .optional(),
  shoppableProductId: IdSchema.optional(),
  rating: z.unknown().optional(),
  ingredients: z.array(IngredientSchema).nullable().optional(),
  allergens: z.array(z.unknown()).nullable().optional(),
  description: z.string().nullable().optional(),
  descriptionHTML: z.string().nullable().optional(),
});
export const RecipeDetailsSchema = z.object({
  id: RecipeIdSchema,
  name: z.string().min(1),
  headline: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
  websiteURL: z.string().nullable().optional(),
  ingredients: z.array(IngredientSchema).nullable().optional(),
  allergens: z.array(z.unknown()).nullable().optional(),
  tags: z.array(z.unknown()).nullable().optional(),
  nutrition: z
    .union([z.array(z.unknown()), z.record(z.unknown())])
    .nullable()
    .optional(),
  description: z.string().nullable().optional(),
  descriptionHTML: z.string().nullable().optional(),
});
export const MealSchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: IdSchema.optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    recipe: RecipeSchema.optional(),
    selection: z
      .object({ quantity: z.number().int().nonnegative() })
      .nullable()
      .optional(),
    isSoldOut: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    tags: z.array(z.unknown()).optional(),
    nutrition: z.unknown().optional(),
    surcharge: z.unknown().optional(),
  })
  .passthrough();
export type Meal = z.infer<typeof MealSchema>;
export const MenuSchema = z.object({
  id: IdSchema.optional(),
  week: WeekSchema.optional(),
  meals: z.array(MealSchema),
  mealsPreselected: z.boolean().optional(),
  mealsReady: z.boolean().optional(),
  addOns: z.unknown().optional(),
});
export type Menu = z.infer<typeof MenuSchema>;
export const SelectionSchema = z
  .object({
    index: z.number().int().nonnegative(),
    quantity: z.number().int().min(1).max(100),
  })
  .strict();
export const SelectionsSchema = z
  .array(SelectionSchema)
  .min(1)
  .max(100)
  .superRefine((xs, ctx) => {
    if (new Set(xs.map((x) => x.index)).size !== xs.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate meal indices",
      });
  });
export type Selection = z.infer<typeof SelectionSchema>;
const Amount = z.number().nullable().optional();
export const OrderLineSchema = z.object({
  id: IdSchema.optional(),
  name: z.string().optional(),
  sku: z.string().optional(),
  unitPrice: Amount,
  paidPrice: Amount,
  couponMoneyValue: Amount,
  couponPercent: Amount,
  deliveryDate: z.string().optional(),
  deliveryTime: z.string().optional(),
  shipped: z.boolean().optional(),
  paymentStatus: z.string().optional(),
  productOrdered: z.unknown().optional(),
  subscription: z.object({ id: IdSchema.optional() }).optional(),
});
export const OrderSchema = z.object({
  id: IdSchema.optional(),
  orderNr: z.string().optional(),
  state: z.string().optional(),
  grandTotal: Amount,
  taxAmount: Amount,
  shippingAmount: Amount,
  shippingDiscountAmount: Amount,
  couponCode: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  paymentMethod: z.string().optional(),
  orderLines: z.array(OrderLineSchema).optional(),
});
export const HistorySchema = z.object({
  items: z.array(OrderSchema),
  count: z.number().optional(),
  total: z.number().nullable().optional(),
  take: z.number().nullable().optional(),
  skip: z.number().nullable().optional(),
});
export const PastDeliveriesSchema = z.object({
  weeks: z.array(
    z.object({
      week: WeekSchema,
      menuId: IdSchema,
      meals: z.array(RecipeSchema),
    }),
  ),
  nextWeek: WeekSchema.nullable().optional(),
});
