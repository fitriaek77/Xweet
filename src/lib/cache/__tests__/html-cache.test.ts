// Tests for src/lib/cache/html-cache.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchXcomHtml, clearHtmlCache } from "@/lib/cache/html-cache";

describe("html-cache", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearHtmlCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  // ─── fetchXcomHtml ───

  describe("fetchXcomHtml", () => {
    it("fetches and returns HTML from x.com", async () => {
      const html = "<html><body>X.com homepage</body></html>";
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200, headers: { "Content-Type": "text/html" } })
      );

      const result = await fetchXcomHtml();

      expect(result).toBe(html);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls.at(0);
      if (!callArgs) throw new Error("Expected fetch to have been called");
      const [url, init] = callArgs;
      expect(url).toBe("https://x.com");
      expect(init.headers["User-Agent"]).toBeDefined();
      expect(init.headers["Accept"]).toBe("text/html");
    });

    it("caches HTML and returns cached on subsequent calls", async () => {
      const html = "<html><body>Cached content</body></html>";
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      // First call fetches
      const result1 = await fetchXcomHtml();
      expect(result1).toBe(html);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call returns cached
      const result2 = await fetchXcomHtml();
      expect(result2).toBe(html);
      expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it("returns null when fetch fails and no cache", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await fetchXcomHtml();

      expect(result).toBeNull();
    });

    it("returns null when response is not ok and no cache", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Server Error", { status: 500 })
      );

      const result = await fetchXcomHtml();

      expect(result).toBeNull();
    });

    it("returns stale cache when fetch fails", async () => {
      const html = "<html><body>Stale content</body></html>";

      // First call succeeds → cached
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );
      const result1 = await fetchXcomHtml();
      expect(result1).toBe(html);

      // Advance time past TTL (5 min)
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Second call fails → returns stale cache
      fetchMock.mockRejectedValueOnce(new Error("Network error"));
      const result2 = await fetchXcomHtml();
      expect(result2).toBe(html); // Stale cache returned

      vi.useRealTimers();
    });

    it("returns stale cache when response is not ok", async () => {
      const html = "<html><body>Old content</body></html>";

      // First call succeeds → cached
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );
      await fetchXcomHtml();

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Second call returns 500 → returns stale cache
      fetchMock.mockResolvedValueOnce(
        new Response("Error", { status: 500 })
      );
      const result = await fetchXcomHtml();
      expect(result).toBe(html);

      vi.useRealTimers();
    });

    it("re-fetches after TTL expires", async () => {
      const html1 = "<html><body>First fetch</body></html>";
      const html2 = "<html><body>Second fetch</body></html>";

      fetchMock.mockResolvedValueOnce(
        new Response(html1, { status: 200 })
      );
      const result1 = await fetchXcomHtml();
      expect(result1).toBe(html1);

      // Advance time past TTL
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      fetchMock.mockResolvedValueOnce(
        new Response(html2, { status: 200 })
      );
      const result2 = await fetchXcomHtml();
      expect(result2).toBe(html2);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  // ─── clearHtmlCache ───

  describe("clearHtmlCache", () => {
    it("clears the cache so next call fetches fresh HTML", async () => {
      const html1 = "<html><body>Before clear</body></html>";
      const html2 = "<html><body>After clear</body></html>";

      fetchMock.mockResolvedValueOnce(
        new Response(html1, { status: 200 })
      );
      const result1 = await fetchXcomHtml();
      expect(result1).toBe(html1);

      clearHtmlCache();

      fetchMock.mockResolvedValueOnce(
        new Response(html2, { status: 200 })
      );
      const result2 = await fetchXcomHtml();
      expect(result2).toBe(html2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
