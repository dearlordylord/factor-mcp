# Observed Factor Canada web-app contracts

Inspected the first-party app at https://www.factormeals.ca/ on 2026-09-30. Build ID: `7.98.40993`. Source references below are public Next.js bundles fetched from that page's build manifest. They establish request construction. A separately captured existing Chrome session verified authenticated read contracts on the same date, using the apex `factormeals.ca` origin and `/gw` prefix.

- Homepage `__NEXT_DATA__.props.pageProps.ssrPayload`: `systemCountry=CF`, `locale=en-CA`.
- `chunks/pages/_app-377828120c9a5b2a.js`: account subscriptions, per-week delivery details, full menu request. The gateway URL is supplied by `NEXT_PUBLIC_GW_URL`; login capture records the actual same-origin prefix.
- `chunks/56755-365857883a7fe808.js`: `GET /api/customers/me/deliveries`, `rangeStart` / `rangeEnd` week range.
- `chunks/97597-8c5a504be50a5322.js`: `GET /api/customers/me/orders` with `limit`; menu read uses delivery product SKU, product size, subscription preset, postcode, and delivery option. Selected main meals use `selection.quantity`; extra items use `selection.oneOffQuantity`.
- `chunks/pages/deliveries/past-deliveries-3dd5ba05e959a8fe.js`: `GET /my-deliveries/past-deliveries` with `subscription` and `from`.
- `chunks/95792-6d90e5b732225954.js`: `PUT /v1/carts/{week}`. Query includes `subscription`, `customer`, `week`, `product-sku`, `preference`, `update_quantity`, `ignore_addons`, optional `cutoff_time`. Body is `{meals, extras}`. Response may have no payload.
- `chunks/35339-5b2e7e029fb89eea.js`: main-meal-only synchronization invokes that cart mutation with `extras:[]`, `ignoreAddons:true`, preserving add-ons.
- `chunks/77210-03f83559cf0a9416.js`: modern save maps chosen main meals to `{index,quantity}`. An older flow also exists: `PATCH /api/subscriptions/{id}/menus/{week}` with `{menu:{id,week,courses,menuAddOns}}`. **No fallback mutation is attempted**; this implementation uses the observed modern cart path. Authenticated rollout verification is required.
- `chunks/77200-a92674b339a2b192.js`: meal-per-week brands display `productType.specs.meals` as the meal count. The implementation uses the **delivery's** product specs for that week, not a guessed global quota.

Authenticated checks verified subscriptions, delivery lists, per-week delivery details, menus, order history, and paginated past deliveries. History pagination metadata can be null; sensitive payment token IDs and addresses are excluded from parsed orders. Menus expose `mealsPreselected`, allowing automatic Factor selections to be distinguished from user selections. Recipe nutrition is retained. Cutoff timestamps include their own UTC offsets and must not be interpreted using an assumed local timezone.

Preview and unchanged-selection save/readback passed against the live account; the latter sends no mutation. Selection-changing PUT requests have only been verified against public app code and synthetic protocol tests. Unknown/changed response contracts fail closed where required for writes. No private API captures or session data are copied into this document.

## Recipe details

`chunks/24466-43805c6ab52dd2f3.js` module `960475` loads recipe previews with GET `/recipes/recipes/{recipeId}` using the gateway client. `chunks/2533-69974db9ca82956a.js` confirms the same request and country/locale query. `chunks/55390-6ac246548733882f.js` renders `recipe.ingredients[].name`, allergen tags and `descriptionHTML` for ready-to-eat meals. The SDK exposes this read path through `factor_get_recipe_details`; malformed ingredients fail closed and missing lists are explicitly unavailable. Authenticated live verification passed on October 1, 2026 for BBQ Pulled Pork, Lebanese Beef & Rice Bowl, and Japanese Shrimp Donburi. Responses include structured ingredients and nutrition arrays, allergens, and compound ingredient declarations in description/descriptionHTML. A selection-changing cart save for 2026-W42 also passed live readback verification (six main meals, no extras added).
