import { endpoint, token } from "./config.js";
let saving = false;
chrome.runtime.onMessage.addListener((message, sender) => {
  if (saving || !sender.url || message?.marker !== "factor-local-capture-v1")
    return;
  let url;
  try {
    url = new URL(sender.url);
  } catch {
    return;
  }
  if (
    !["https://www.factormeals.ca", "https://factormeals.ca"].includes(
      url.origin,
    ) ||
    message.origin !== url.origin ||
    message.status < 200 ||
    message.status >= 300
  )
    return;
  if (
    !/^(?:\/gw)?\/(?:api\/(?:customers\/me\/(?:subscriptions|deliveries|orders)|subscriptions\/[^/]+\/delivery_dates\/[^/]+)|my-deliveries\/menu)$/.test(
      message.path,
    )
  )
    return;
  const headers = Object.fromEntries(
    Object.entries(message.headers ?? {}).filter(
      ([name, value]) =>
        /^(authorization|x-csrf-token|x-xsrf-token|x-requested-with|x-hf-[a-z-]+|user-agent)$/i.test(
          name,
        ) && typeof value === "string",
    ),
  );
  if (
    !headers.authorization &&
    !/\/api\/customers\/me\/subscriptions$/.test(message.path)
  )
    return;
  saving = true;
  void (async () => {
    try {
      const cookies = await chrome.cookies.getAll({
        url: url.origin + message.path,
      });
      const session = {
        version: 1,
        capturedAt: new Date().toISOString(),
        origin: url.origin,
        basePath: message.path.startsWith("/gw/") ? "/gw" : "/",
        headers,
        cookies: cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expirationDate ?? -1,
          secure: c.secure,
        })),
      };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          session,
          evidence: {
            path: message.path,
            status: message.status,
            response: message.response,
          },
        }),
      });
      if (!response.ok) throw new Error("Local capture rejected");
      await chrome.action.setBadgeText({ text: "OK" });
      await chrome.action.setBadgeBackgroundColor({ color: "#257346" });
    } catch {
      await chrome.action.setBadgeText({ text: "!" });
      await chrome.action.setTitle({
        title:
          "Start pnpm auth:capture, then refresh the signed-in Factor tab.",
      });
    } finally {
      saving = false;
    }
  })();
});
