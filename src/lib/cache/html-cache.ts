// src/lib/cache/html-cache.ts
// Shared HTML cache for x.com homepage.
// Used by TID generation (SVG animation extraction) and other services.
// 5-minute TTL with stale-on-failure fallback.

let cachedHtml: string | null = null;
let cachedHtmlAt = 0;
const HTML_CACHE_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchXcomHtml(): Promise<string | null> {
  if (cachedHtml && Date.now() - cachedHtmlAt < HTML_CACHE_MS) {
    return cachedHtml;
  }

  try {
    const resp = await fetch("https://x.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      cachedHtml = await resp.text();
      cachedHtmlAt = Date.now();
      return cachedHtml;
    }
  } catch {
    // Fetch failed
  }

  return cachedHtml; // Return stale cache if fetch fails
}

export function clearHtmlCache(): void {
  cachedHtml = null;
  cachedHtmlAt = 0;
}
