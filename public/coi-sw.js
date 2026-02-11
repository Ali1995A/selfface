// Service worker to enable Cross-Origin Isolation (SharedArrayBuffer) without server headers.
// Based on the MIT-licensed coi-serviceworker approach, but without any auto-reload logic.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  // Workaround for Chromium bug when using cache: only-if-cached with cross-origin requests.
  if (e.request.cache === "only-if-cached" && e.request.mode !== "same-origin") return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (!res || res.status === 0) return res;
        const headers = new Headers(res.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      })
      .catch(() => fetch(e.request)),
  );
});

