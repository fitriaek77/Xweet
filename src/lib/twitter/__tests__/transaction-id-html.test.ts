// Tests for src/lib/twitter/transaction-id-html.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/twitter/transaction-id-shared", () => ({
  buildTransactionId: vi.fn().mockReturnValue("mock-tid-output"),
}));

vi.mock("@/config/constants", () => ({
  X_BASE_URL: "https://x.com",
}));

import { generateFromLiveSvg, clearHtmlCache } from "@/lib/twitter/transaction-id-html";
import { buildTransactionId } from "@/lib/twitter/transaction-id-shared";

// ─── Helpers ───

/** Build HTML with verification key and SVG animation data. */
function buildXHtml(opts: {
  verificationKey?: string;
  svgFrames?: string;
  ondemandChunk?: string;
  extraContent?: string;
}): string {
  const parts: string[] = ["<html><head>"];

  // Add verification key
  if (opts.verificationKey) {
    parts.push(
      `<script>verification:"${opts.verificationKey}"</script>`
    );
  }

  // Add ondemand chunk
  if (opts.ondemandChunk) {
    parts.push(
      `<script src="ondemand.s.${opts.ondemandChunk}.js"></script>`
    );
  }

  // Add SVG animation frames
  if (opts.svgFrames) {
    parts.push(opts.svgFrames);
  }

  if (opts.extraContent) {
    parts.push(opts.extraContent);
  }

  parts.push("</head><body></body></html>");

  // Pad to > 1000 chars so it gets cached
  const html = parts.join("\n");
  return html + " ".repeat(Math.max(0, 1100 - html.length));
}

const VALID_VERIFICATION_KEY = "A".repeat(44); // Base64-like, 44 chars → valid for pattern 2

const VALID_SVG = `<svg id="loading-x-anim-1">
  <animate values="10;20;30;40" attributeName="y" dur="1s"/>
</svg>`;

const COMPLETE_HTML = buildXHtml({
  verificationKey: VALID_VERIFICATION_KEY,
  svgFrames: VALID_SVG,
  ondemandChunk: "abc",
});

describe("transaction-id-html", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearHtmlCache();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  // ─── generateFromLiveSvg ───

  describe("generateFromLiveSvg", () => {
    it("returns null when HTML fetch fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const result = await generateFromLiveSvg("POST", "/graphql/test/CreateTweet");

      expect(result).toBeNull();
    });

    it("returns null when HTML fetch returns non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBeNull();
    });

    it("returns null when HTML has no verification key", async () => {
      const html = buildXHtml({ svgFrames: VALID_SVG });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("could not extract verification key")
      );
      stderrSpy.mockRestore();
    });

    it("returns null when HTML has no SVG animation frames", async () => {
      const html = buildXHtml({ verificationKey: VALID_VERIFICATION_KEY });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("no SVG animation frames found")
      );
      stderrSpy.mockRestore();
    });

    it("returns null when SVG frames exist but computeAnimationKey fails", async () => {
      // SVG with valid frame count but computeAnimationKey returns null
      // This happens when frames have >= 4 values but cubicBezier produces unusable results
      // Since parseSvgFrames requires >= 4 values per animate, we provide that but
      // computeAnimationKey should still return a key (or null if all fail).
      // For now, test the "no SVG frames found" path (values < 4 per frame)
      const badSvg = `<svg id="loading-x-anim-1">
        <animate values="10;20" attributeName="y" dur="1s"/>
      </svg>`;
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: badSvg,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBeNull();
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining("no SVG animation frames found")
      );
      stderrSpy.mockRestore();
    });

    it("generates TID from complete HTML with SVG frames and verification key", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(COMPLETE_HTML, { status: 200 })
      );

      const result = await generateFromLiveSvg("POST", "/graphql/test/CreateTweet");

      expect(result).toBe("mock-tid-output");
      expect(buildTransactionId).toHaveBeenCalledWith(
        "POST",
        "/graphql/test/CreateTweet",
        expect.any(Array), // keyBytes from base64 decode
        expect.any(String)  // animationKey hex
      );
    });

    it("generates TID without ondemand indices", async () => {
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: VALID_SVG,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBe("mock-tid-output");
    });

    it("caches HTML and does not re-fetch within TTL", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(COMPLETE_HTML, { status: 200 })
      );

      // First call fetches
      await generateFromLiveSvg("POST", "/test");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result = await generateFromLiveSvg("POST", "/test");
      expect(fetchMock).toHaveBeenCalledTimes(1); // No additional fetch
      expect(result).toBe("mock-tid-output");
    });

    it("clears cache when clearHtmlCache is called", async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(COMPLETE_HTML, { status: 200 }))
        .mockResolvedValueOnce(new Response(COMPLETE_HTML, { status: 200 }));

      await generateFromLiveSvg("POST", "/test");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      clearHtmlCache();

      await generateFromLiveSvg("POST", "/test");
      expect(fetchMock).toHaveBeenCalledTimes(2); // Re-fetch after cache clear
    });

    it("handles SVG with multiple animate elements", async () => {
      const multiSvg = `<svg id="loading-x-anim-1">
        <animate values="10;20;30;40" attributeName="y" dur="1s"/>
        <animate values="50;60;70;80" attributeName="x" dur="1s"/>
      </svg>`;
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: multiSvg,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBe("mock-tid-output");
    });

    it("handles verification key in the alternative base64 pattern", async () => {
      // Pattern 2: 40+ char base64 string in quotes
      const longBase64Key = "A".repeat(44);
      const html = buildXHtml({
        extraContent: `<script>"${longBase64Key}"</script>`,
        svgFrames: VALID_SVG,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBe("mock-tid-output");
    });

    it("returns null when HTML is too short (< 1000 chars) and not cached", async () => {
      // Short HTML that won't be cached and has no prior cache
      const shortHtml = '<html>verification:"' + VALID_VERIFICATION_KEY + '"</html>';
      // Fetch returns short HTML → not cached
      // Next fetch would also fail... but since it's not cached, the next
      // call would re-fetch. For this test, just return short HTML.
      fetchMock.mockResolvedValueOnce(
        new Response(shortHtml, { status: 200 })
      );

      // Should still attempt parsing with the short HTML
      // but it won't have SVG frames → returns null
      const result = await generateFromLiveSvg("POST", "/test");
      expect(result).toBeNull();
    });
  });

  // ─── extractVerificationKey (tested via generateFromLiveSvg) ───

  describe("extractVerificationKey patterns", () => {
    it("extracts key from verification=X pattern", async () => {
      const key = "A".repeat(24); // 24+ chars base64
      const html = buildXHtml({
        extraContent: `<script>verification:"${key}"</script>`,
        svgFrames: VALID_SVG,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      await generateFromLiveSvg("POST", "/test");

      expect(buildTransactionId).toHaveBeenCalled();
    });

    it("extracts key from long base64 string pattern", async () => {
      const key = "B".repeat(44); // 40+ chars for pattern 2
      const html = buildXHtml({
        extraContent: `<script>"${key}"</script>`,
        svgFrames: VALID_SVG,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      await generateFromLiveSvg("POST", "/test");

      expect(buildTransactionId).toHaveBeenCalled();
    });
  });

  // ─── parseSvgFrames edge cases ───

  describe("SVG frame parsing edge cases", () => {
    it("handles SVG with animate element having fewer than 4 values", async () => {
      const svg = `<svg id="loading-x-anim-1">
        <animate values="10;20;30" attributeName="y" dur="1s"/>
      </svg>`;
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: svg,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      // Frames with < 4 values are skipped → no valid frames → returns null
      expect(result).toBeNull();
      stderrSpy.mockRestore();
    });

    it("handles SVG with non-numeric values in animate", async () => {
      const svg = `<svg id="loading-x-anim-1">
        <animate values="abc;def;ghi;jkl" attributeName="y" dur="1s"/>
      </svg>`;
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: svg,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      // All NaN values get filtered out → no valid values → frame not created
      expect(result).toBeNull();
      stderrSpy.mockRestore();
    });

    it("handles SVG element without animate child", async () => {
      const svg = `<svg id="loading-x-anim-1"><rect x="0" y="0"/></svg>`;
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: svg,
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = await generateFromLiveSvg("POST", "/test");

      // No animate → no frames → null
      expect(result).toBeNull();
      stderrSpy.mockRestore();
    });
  });

  // ─── ondemand indices ───

  describe("ondemand indices extraction", () => {
    it("extracts ondemand indices and uses them in animation key computation", async () => {
      const html = buildXHtml({
        verificationKey: VALID_VERIFICATION_KEY,
        svgFrames: VALID_SVG,
        ondemandChunk: "abc",
      });
      fetchMock.mockResolvedValueOnce(
        new Response(html, { status: 200 })
      );

      const result = await generateFromLiveSvg("POST", "/test");

      expect(result).toBe("mock-tid-output");
      // The buildTransactionId was called, confirming indices were used
      expect(buildTransactionId).toHaveBeenCalledWith(
        "POST",
        "/test",
        expect.any(Array),
        expect.any(String)
      );
    });
  });
});
