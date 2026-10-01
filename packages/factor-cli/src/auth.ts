import { chromium, type Response } from "playwright";
import { stderr } from "node:process";
import { dirname, join } from "node:path";
import {
  defaultSessionPath,
  ORIGIN,
  FactorOriginSchema,
  SessionSchema,
  writePrivateJson,
} from "@firfi/factor-sdk";

const relevant = (url: URL) =>
  FactorOriginSchema.safeParse(url.origin).success &&
  /^\/(gw\/)?(?:api\/(?:customers\/me\/(?:subscriptions|deliveries|orders)|subscriptions\/[^/]+(?:\/(?:delivery_dates|menus|deliveries).*)?)|my-deliveries\/(?:menu|past-deliveries)|v1\/carts\/)/.test(
    url.pathname,
  );
export async function login(sessionPath = defaultSessionPath()): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    channel: process.env.FACTOR_BROWSER_CHANNEL || "chrome",
  });
  const context = await browser.newContext();
  const captures: unknown[] = [];
  let headers: Record<string, string> = {};
  let basePath = "/gw";
  let authenticated = false;
  let origin = ORIGIN;
  let markAuthenticated: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markAuthenticated = resolve;
  });
  const pending = new Set<Promise<void>>();
  async function capture(response: Response): Promise<void> {
    const url = new URL(response.url());
    if (!relevant(url)) return;
    const request = response.request();
    if (!response.headers()["content-type"]?.includes("json")) return;
    try {
      const data: unknown = await response.json();
      if (
        response.ok() &&
        /\/api\/customers\/me\/subscriptions$/.test(url.pathname)
      ) {
        // Successful account endpoint, not the login form, is the source of credentials.
        const h = await request.allHeaders();
        headers = Object.fromEntries(
          Object.entries(h).filter(([k]) =>
            /^(authorization|x-csrf-token|x-xsrf-token|x-requested-with|x-hf-[a-z-]+|user-agent)$/i.test(
              k,
            ),
          ),
        );
        basePath = url.pathname.startsWith("/gw/") ? "/gw" : "/";
        authenticated = true;
        origin = url.origin;
        markAuthenticated();
      }
      // No request headers, login bodies, or third-party traffic in diagnostics.
      captures.push({
        method: request.method(),
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        status: response.status(),
        requestBody: request.postDataJSON(),
        response: data,
      });
    } catch {
      /* A response can be canceled during navigation. */
    }
  }
  context.on("response", (response) => {
    const task = capture(response);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  let rejectClosed: () => void = () => {};
  const closed = new Promise<never>((_, reject) => {
    rejectClosed = () =>
      reject(
        new Error("Login browser closed before session capture completed"),
      );
  });
  void closed.catch(() => {});
  browser.once("disconnected", rejectClosed);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await context.newPage();
    await page.goto(ORIGIN + "/login");
    stderr.write(
      "\nLog in to Factor in the browser and open My Deliveries. The command saves the session automatically when authenticated traffic is observed. No terminal input or meal changes are required.\n",
    );
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new Error(
              "No authenticated Factor traffic observed within 10 minutes. If login fails here but works in your main browser, use pnpm auth:capture.",
            ),
          ),
        10 * 60_000,
      );
    });
    await Promise.race([ready, closed, expired]);
    await Promise.all([...pending]);
    if (!authenticated)
      throw new Error(
        "No authenticated subscriptions response captured. Open My Deliveries after logging in, then rerun this command.",
      );
    const state = await context.storageState();
    const session = SessionSchema.parse({
      version: 1,
      origin,
      capturedAt: new Date().toISOString(),
      basePath,
      headers,
      cookies: state.cookies.filter((c) =>
        ["factormeals.ca", "www.factormeals.ca"].includes(
          c.domain.replace(/^\./, ""),
        ),
      ),
    });
    await writePrivateJson(sessionPath, session);
    await writePrivateJson(join(dirname(sessionPath), "capture.private.json"), {
      capturedAt: session.capturedAt,
      records: captures,
    });
    stderr.write(
      `Session saved to ${sessionPath}\nPrivate account API evidence saved alongside it; do not share it publicly.\n`,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    browser.off("disconnected", rejectClosed);
    await browser.close();
  }
}
