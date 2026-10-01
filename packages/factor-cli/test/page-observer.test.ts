import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { z } from "zod";
it("observes authenticated fetch and XHR without recording login calls or changing request results", async () => {
  const messages: unknown[] = [];
  class StubXHR extends EventTarget {
    status = 200;
    responseType = "";
    responseText = '{"items":[{"id":7}]}';
    open(_method: string, _url: string) {}
    setRequestHeader(_name: string, _value: string) {}
    send() {
      this.dispatchEvent(new Event("loadend"));
    }
    getResponseHeader(_name: string) {
      return "application/json";
    }
  }
  const promised = Promise.resolve(Response.json({ items: [{ id: 7 }] }));
  const win = {
    fetch: (_input: RequestInfo | URL, _init?: RequestInit) => promised,
    postMessage: (data: unknown, _origin: string) => messages.push(data),
  };
  const source = await readFile(
    new URL("../extension/page-observer.js", import.meta.url),
    "utf8",
  );
  runInNewContext(source, {
    window: win,
    location: {
      origin: "https://factormeals.ca",
      href: "https://factormeals.ca/my-deliveries",
    },
    XMLHttpRequest: StubXHR,
    URL,
    Headers,
    Request,
  });
  expect(
    win.fetch("/gw/my-deliveries/menu", {
      headers: {
        authorization: "Bearer test-token",
        "x-other-secret": "not-captured",
      },
    }),
  ).toBe(promised);
  await win.fetch("/login", {
    headers: { authorization: "Bearer login-secret" },
  });
  const xhr = new StubXHR();
  xhr.open("GET", "/gw/api/customers/me/subscriptions");
  xhr.setRequestHeader("Authorization", "Bearer xhr-test");
  xhr.send();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const records = z
    .array(z.object({ path: z.string(), headers: z.record(z.string()) }))
    .parse(messages);
  expect(records).toHaveLength(2);
  expect(records.some((r) => r.path === "/login")).toBe(false);
  expect(
    records.some((r) => r.headers.authorization === "Bearer xhr-test"),
  ).toBe(true);
  expect(JSON.stringify(records)).not.toContain("not-captured");
  expect(JSON.stringify(records)).not.toContain("login-secret");
});
