(() => {
  const origins = ["https://factormeals.ca", "https://www.factormeals.ca"];
  const relevant = (url) =>
    origins.includes(url.origin) &&
    /^(?:\/gw)?\/(?:api\/(?:customers\/me\/(?:subscriptions|deliveries|orders)|subscriptions\/[^/]+\/delivery_dates\/[^/]+)|my-deliveries\/menu)$/.test(
      url.pathname,
    );
  const accepted = (name) =>
    /^(authorization|x-csrf-token|x-xsrf-token|x-requested-with|x-hf-[a-z-]+|user-agent)$/i.test(
      name,
    );
  function report(url, headers, status, data) {
    if (status < 200 || status >= 300 || !relevant(url)) return;
    if (
      !headers.authorization &&
      !/\/api\/customers\/me\/subscriptions$/.test(url.pathname)
    )
      return;
    window.postMessage(
      {
        marker: "factor-local-capture-v1",
        origin: url.origin,
        path: url.pathname,
        headers,
        status,
        response: data,
      },
      location.origin,
    );
  }
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const result = Reflect.apply(originalFetch, this, arguments);
    try {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (!relevant(url)) return result;
      const headers = Object.fromEntries(
        [
          ...new Headers(
            init?.headers ??
              (input instanceof Request ? input.headers : undefined),
          ),
        ].filter(([name]) => accepted(name)),
      );
      void result
        .then(async (response) => {
          if (
            response.ok &&
            response.headers.get("content-type")?.includes("json")
          )
            report(
              url,
              headers,
              response.status,
              await response.clone().json(),
            );
        })
        .catch(() => {});
    } catch {
      /* Observation must not change the app request's result. */
    }
    return result;
  };
  const states = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      states.set(this, {
        url: new URL(String(url), location.href),
        headers: {},
      });
    } catch {
      states.delete(this);
    }
    return Reflect.apply(originalOpen, this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const state = states.get(this);
    if (state && accepted(name))
      state.headers[String(name).toLowerCase()] = String(value);
    return Reflect.apply(originalHeader, this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const state = states.get(this);
    if (state && relevant(state.url))
      this.addEventListener(
        "loadend",
        () => {
          try {
            if (this.getResponseHeader("content-type")?.includes("json"))
              report(
                state.url,
                state.headers,
                this.status,
                this.responseType === "json"
                  ? this.response
                  : JSON.parse(this.responseText),
              );
          } catch {
            /* Canceled or non-JSON requests do not establish authentication. */
          }
        },
        { once: true },
      );
    return Reflect.apply(originalSend, this, arguments);
  };
})();
