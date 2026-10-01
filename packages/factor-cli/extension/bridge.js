window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.marker !== "factor-local-capture-v1"
  )
    return;
  void chrome.runtime.sendMessage(event.data).catch(() => {});
});
