#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { FactorClient, defaultSessionPath } from "@firfi/factor-sdk";
import { login } from "./auth.js";
import { captureExistingBrowser } from "./browser-capture.js";
const args = process.argv.slice(2);
const client = FactorClient.fromSession(
  process.env.FACTOR_AUTH_SESSION_PATH || defaultSessionPath(),
);
const usage =
  "Usage: factor auth login [session-path] | auth capture [session-path] | auth status | subscriptions | deliveries [from-week to-week] | current [subscription-id] | week <subscription-id> <YYYY-Www> | recipe <recipe-id> | history [limit] | past <subscription-id> [from-week] | selections preview|save <subscription-id> <week> <json-file> [--allow-extra] [--allow-under]";
function required(index: number) {
  const value = args[index];
  if (!value) throw new Error(usage);
  return value;
}
try {
  let result: unknown;
  switch (args[0]) {
    case "auth":
      if (args[1] === "login")
        await login(
          args[2] ||
            process.env.FACTOR_AUTH_SESSION_PATH ||
            defaultSessionPath(),
        );
      else if (args[1] === "capture")
        await captureExistingBrowser(
          args[2] ||
            process.env.FACTOR_AUTH_SESSION_PATH ||
            defaultSessionPath(),
        );
      else if (args[1] === "status")
        result = {
          authenticated: true,
          subscriptionCount: (await client.getSubscriptions()).length,
        };
      else throw new Error(usage);
      break;
    case "subscriptions":
      result = await client.getSubscriptions();
      break;
    case "deliveries":
      result = await client.getDeliveries(args[1], args[2]);
      break;
    case "current":
      result = await client.getCurrentWeek(args[1]);
      break;
    case "week":
      result = await client.getWeek(required(1), required(2));
      break;
    case "history":
      result = await client.getOrderHistory(args[1] ? Number(args[1]) : 50);
      break;
    case "recipe":
      result = await client.getRecipeDetails(required(1));
      break;
    case "past":
      result = await client.getPastDeliveries(required(1), args[2]);
      break;
    case "selections": {
      const input: unknown = JSON.parse(await readFile(required(4), "utf8"));
      if (args[1] === "preview")
        result = await client.previewSelections(
          required(2),
          required(3),
          input,
        );
      else if (args[1] === "save")
        result = await client.saveSelections(required(2), required(3), input, {
          allowExtraMeals: args.includes("--allow-extra"),
          allowUnderQuota: args.includes("--allow-under"),
        });
      else throw new Error(usage);
      break;
    }
    default:
      throw new Error(usage);
  }
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Factor command failed",
  );
  process.exitCode = 1;
}
