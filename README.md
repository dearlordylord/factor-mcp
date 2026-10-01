# Factor Meals Canada MCP

A local TypeScript SDK, stdio MCP server, and CLI for your existing [Factor Canada](https://www.factormeals.ca/) subscription. Modeled on the sibling Voila project's SDK/MCP/CLI separation and interactive session capture.

Read weekly meals and selections, edit permissions and the exact cutoff, plan quota, extra or missing quantities, past deliveries, and order history. Replace **and save** weekly main-meal selections automatically through the MCP. Add-ons are preserved.

**Integration status:** authenticated subscriptions, deliveries, weekly menus, order history, and past deliveries were verified against the local account on September 30, 2026. Preview and an unchanged-selection save were also verified. Published recipe ingredients and a selection-changing save for 2026-W42 were live-verified on October 1, 2026; the save passed readback verification. This is an unofficial integration with private web-app endpoints. The code is MIT licensed.

## Install

Requires Node.js 22.22.2+ or 24.15.0+ within those major versions. Factor Canada subscriptions only.

Install the v0.1.1 packages from the public GitHub Release:

```bash
npm install -g \
  https://github.com/dearlordylord/factor-mcp/releases/download/v0.1.1/firfi-factor-sdk-0.1.1.tgz \
  https://github.com/dearlordylord/factor-mcp/releases/download/v0.1.1/firfi-factor-mcp-0.1.1.tgz \
  https://github.com/dearlordylord/factor-mcp/releases/download/v0.1.1/firfi-factor-cli-0.1.1.tgz
factor auth capture
```

Configure your MCP client with `command: "factor-mcp"` and `args: []`. Each user captures their own Factor session locally; no maintainer account or credentials are distributed. The temporary capture extension can be removed afterward; renewal is necessary when Factor expires the session.

npm registry publication is separate from the GitHub Release. Do not use `npx @firfi/factor-mcp` until that package has been published to npm.

## Setup from source

```bash
git clone https://github.com/dearlordylord/factor-mcp.git
cd factor-mcp
```

```bash
pnpm install
pnpm build
pnpm auth:login
```

The login command opens installed Google Chrome with an isolated browser context. Log in yourself and open My Deliveries. It automatically saves the session when authenticated API traffic is observed; terminal stdin is not required. It does not make meal changes or capture passwords/login requests.

It saves `~/.config/factor/session.json` and `~/.config/factor/capture.private.json` with file permissions `0600`. The second file contains private account API responses for local contract verification. Neither should be committed or shared. To choose another Chrome-compatible browser channel, set `FACTOR_BROWSER_CHANNEL`. If Chrome isn't installed, install it or select an installed supported channel.

Set `FACTOR_AUTH_SESSION_PATH` for a custom session path. The next MCP request reloads the file, so renewing a session does not require a server restart. Login expiry requires another interactive capture; password-based or unattended login is not implemented.

## Capture from your already signed-in browser

If Factor shows “Something went wrong” in the isolated browser while your main browser works, use:

```bash
pnpm auth:capture
```

This starts a token-protected listener bound to `127.0.0.1:38471` and prepares a local Chrome-compatible extension at `~/.cache/factor/capture-extension`.

1. In the browser where Factor already works, open `chrome://extensions`.
2. Enable Developer mode, select **Load unpacked**, and select that extension folder.
3. Refresh the signed-in Factor tab. If capture has not completed, open **Edit Meals**; no changes or saves are needed.
4. The command saves the session and exits automatically. Remove the capture extension afterward.

The extension’s host access covers only the two Factor Canada hostnames and the loopback listener. It observes main-meal/account API calls and reads Factor cookies, including HttpOnly cookies through Chrome’s [cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies). Authentication headers are observed inside Factor’s existing page requests; Chrome’s [webRequest API does not expose Authorization headers](https://developer.chrome.com/docs/extensions/reference/api/webRequest), so the extension does not rely on it or request its permission. Login/password requests are excluded. One private API response is saved locally for contract verification. No HAR export is needed, and no credentials go to an external server.

The SDK preserves the captured origin (`factormeals.ca` or `www.factormeals.ca`) to avoid losing host-scoped session cookies across hostnames. Generating the extension does not install it; loading it is the step that grants it Factor session access.

## MCP configuration

For the GitHub Release installation:

```json
{
  "mcpServers": {
    "factor": {
      "command": "factor-mcp",
      "args": []
    }
  }
}
```

For a source checkout, use `node` as the command and the absolute path to `packages/factor-mcp/dist/bin.js` as its argument. The default session path is resolved from your home directory. Set `FACTOR_AUTH_SESSION_PATH` only to override it.

The server uses stdio; it starts without credentials and returns login guidance when an account tool is called. It does not open a browser inside MCP or expose an HTTP listener.

## Tools

`factor_get_recipe_details({recipeId})` reads the published ingredient list, allergens, description, and nutrition using a recipe ID from `factor_get_week`. It returns `ingredientsStatus: unavailable` for missing/null/empty lists. The list is Factor’s published declaration and may omit compound ingredient details; never infer exclusion or allergy safety from missing information. The CLI equivalent is `pnpm factor recipe <recipe-id>`. Restart the MCP process after rebuilding to load new tools.

| Tool                          | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `factor_check_session_health` | Check authenticated access without exposing credentials               |
| `factor_get_subscriptions`    | Subscription IDs, dietary preset, and plan specs                      |
| `factor_get_deliveries`       | Upcoming deliveries or a week range, deadlines, and permissions       |
| `factor_get_current_week`     | This week’s delivery (or next upcoming), saved meals, quota, deadline |
| `factor_get_week`             | Specific subscription and `YYYY-Www` delivery week                    |
| `factor_get_recipe_details`   | Published ingredients, compound declarations, allergens and nutrition |
| `factor_get_order_history`    | Older orders and order lines, explicit result limit                   |
| `factor_get_past_deliveries`  | Older meals, feedback, and available history cursors                  |
| `factor_preview_selections`   | Check absolute desired quantities and quota without saving            |
| `factor_save_selections`      | Replace and save main-meal quantities, then verify read-back          |

“Current week” includes already delivered meals from the current Monday–Sunday calendar week in America/Toronto. When none exists, it falls back to the next upcoming delivery and reports that choice. Multiple subscriptions require an explicit subscription ID. For precise control, use a subscription ID and explicit Factor week.

## Automatic weekly saves

1. Read `factor_get_current_week` or `factor_get_week`.
2. Choose main-meal **indices from that week's menu**, with absolute quantities. Recipe IDs are not write IDs; indices are week-specific.
3. Call `factor_save_selections`. A separate manual confirmation or preview is not required. Pass `expectedRevision` from the read for conflict detection.

Example tool input:

```json
{
  "subscriptionId": "your-subscription-id",
  "week": "2026-W40",
  "selections": [
    { "index": 1, "quantity": 3 },
    { "index": 7, "quantity": 5 }
  ]
}
```

This replaces all main-meal quantities: unlisted main meals are removed. It preserves existing add-ons through the web app's `ignore_addons=true` flow. Quantity totals determine quota, so two recipes with quantities 3 and 5 fill an eight-meal plan.

Saving below quota requires `allowUnderQuota=true`; extra meals require `allowExtraMeals=true` and can add charges. These flags represent intentional choices, not a required human approval flow. Premium meal surcharges may still apply within the plan quota: inspect menu pricing when selecting meals. A plan quota is a meal count, not a spending budget.

Unknown plan size, missing edit permission, ambiguous deadline, sold-out selections, and stale revisions stop the write. Factor's timestamp offset controls the deadline. There is no hard-coded weekday or timezone cutoff.

The server serializes its own writes, but the private API does not expose proven compare-and-swap semantics. Revision checking reduces accidental overwrites; it cannot guarantee exclusion of a simultaneous edit from another browser or MCP process.

No write is retried automatically. If `writeMayHaveSucceeded=true`, read the week to reconcile before retrying. A successful tool result only reports `verified=true` after Factor returns the requested saved quantities, or when those quantities were already saved.

## CLI

```bash
pnpm factor auth status
pnpm factor subscriptions
pnpm factor deliveries
pnpm factor current
pnpm factor week <subscription-id> 2026-W40
pnpm factor history 50
pnpm factor past <subscription-id>
pnpm factor selections preview <subscription-id> 2026-W40 selections.json
pnpm factor selections save <subscription-id> 2026-W40 selections.json
```

`selections.json` is an array such as `[{"index":1,"quantity":8}]`. Append `--allow-extra` or `--allow-under` only when intentional.

## Development

```bash
pnpm check-all
```

The SDK parses session files and key account responses with Zod and keeps HTTP/session/clock dependencies behind injected ports. Tests cover cutoff offsets, exact-deadline locking, quota quantities, duplicate indices, stale revisions, add-on preservation, uncertain writes, read-back mismatches, private session storage, and real MCP transport negotiation. Fixtures are synthetic; no account data belongs in tests.

Not implemented: changing add-ons, skipping/unskipping deliveries, changing a subscription's dietary preset or plan size, canceling subscriptions, payment/address changes, or a scheduled background meal picker. Main-meal selection automation is available to the calling MCP agent.

## Contributing and releases

Run `pnpm release:check` before publishing. It checks types, formatting, tests, secrets, package allowlists, and installation in a clean consumer. Install gitleaks (for example `brew install gitleaks` on macOS) before committing; Git hooks fail closed when it is missing. CI scans Git history, tests the scanner with a synthetic canary, runs Node 22/24 tests, and installs packed packages using npm and pnpm. Never commit real account responses or personal meal preferences.

The release workflow publishes GitHub Release tarballs after the same checks. The manually dispatched npm workflow requires a repository `NPM_TOKEN` with permission to publish the three `@firfi/factor-*` packages. All versions must match the release tag. See [SECURITY.md](SECURITY.md) for reporting security issues.
