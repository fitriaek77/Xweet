// src/lib/twitter/transaction-id-html.ts
// HTML parsing + SVG animation key extraction (fallback method, ~500ms).
// Fetches x.com HTML, parses verification key and SVG animation data,
// then computes the animation key using cubic Bézier interpolation.

import { buildTransactionId } from "@/lib/twitter/transaction-id-shared";
import { cubicBezier } from "@/lib/twitter/transaction-id-cubic";
import { fetchXcomHtml, clearHtmlCache as clearSharedHtmlCache } from "@/lib/cache/html-cache";

// ─── SVG frame type ───

interface SvgFrame {
  /** Frame index from SVG animation */
  index: number;
  /** Bézier control points for this frame */
  points: number[];
}

// ─── Parsing helpers ───

/**
 * Extract the verification key from x.com's main JS bundle.
 * The key is embedded in a script tag as an assignment like:
 *   ...verification:"<base64>"...
 * or in the main bundle JS content.
 */
function extractVerificationKey(html: string): string | null {
  // Pattern 1: Look for verification key in inline script content
  // X embeds it in their main JS as a property assignment
  const verificationPatterns = [
    // Direct assignment pattern in JS bundles
    /verification\s*[:=]\s*["']([A-Za-z0-9+/=]{20,})["']/,
    // Alternative pattern found in twt implementation
    /"([A-Za-z0-9+/]{40,})"/,
  ];

  for (const pattern of verificationPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Extract the ondemand.s chunk URL which contains dynamic indices.
 * Pattern: ondemand.s.*.js — the * part encodes index data.
 */
function extractOndemandIndices(html: string): number[] | null {
  // Look for ondemand.s.*.js chunk references
  const pattern = /ondemand\.s\.([a-zA-Z0-9_-]+)\.js/g;
  const matches = [...html.matchAll(pattern)];

  if (matches.length === 0) return null;

  // The characters after 'ondemand.s.' encode indices
  // Take the first match and decode character codes
  const encoded = matches[0]?.[1];
  if (!encoded) return null;
  const indices: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    indices.push(encoded.charCodeAt(i));
  }

  return indices.length > 0 ? indices : null;
}

/**
 * Parse SVG animation frames from inline SVG in x.com HTML.
 * Looks for SVG elements with IDs starting with 'loading-x-anim'.
 * Each frame has keyTimes and values that define Bézier control points.
 */
function parseSvgFrames(html: string): SvgFrame[] | null {
  const frames: SvgFrame[] = [];

  // Match SVG animation elements — X uses inline SVG with specific patterns
  // Pattern: <svg id="loading-x-anim-..." ...>
  const svgPattern = /<svg[^>]*id\s*=\s*["']loading-x-anim[^"']*["'][^>]*>([\s\S]*?)<\/svg>/gi;
  const svgMatches = [...html.matchAll(svgPattern)];

  if (svgMatches.length === 0) return null;

  for (const svgMatch of svgMatches) {
    const svgContent = svgMatch[1] ?? "";

    // Look for animate elements with keyTimes and values
    const animatePattern = /<animate[^>]*values\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const animateMatches = [...svgContent.matchAll(animatePattern)];

    for (const animMatch of animateMatches) {
      const valuesStr = animMatch[1] ?? "";
      const values = valuesStr.split(";").map(Number).filter((v) => !isNaN(v));

      if (values.length >= 4) {
        frames.push({
          index: frames.length,
          points: values,
        });
      }
    }
  }

  return frames.length > 0 ? frames : null;
}

/**
 * Compute the animation key from SVG frames and dynamic indices
 * using cubic Bézier interpolation.
 */
function computeAnimationKey(
  frames: SvgFrame[],
  indices: number[] | null,
): string | null {
  if (frames.length === 0) return null;

  try {
    // Use indices to select and order frames if available
    const keyBytes: number[] = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames.at(i);
      if (!frame) continue;
      const pts = frame.points;

      if (pts.length >= 4) {
        // Determine interpolation parameter from indices or use default
        const indexValue = indices?.at(i);
        const t =
          indexValue != null
            ? (indexValue % 256) / 255
            : i / (frames.length - 1 || 1);

        // Evaluate cubic Bézier at parameter t
        const value = cubicBezier(pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0, pts[3] ?? 0, t);
        keyBytes.push(Math.round(value) & 0xff);
      }
    }

    if (keyBytes.length === 0) return null;

    // Convert to hex string (matching pair.json animationKey format)
    return keyBytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// ─── Public ───

/**
 * Generate a TID via live HTML/SVG parsing (fallback method).
 * Fetches x.com HTML (~500ms), parses verification key and animation data.
 * Returns null on any parsing failure — graceful degradation.
 */
export async function generateFromLiveSvg(
  method: string,
  path: string,
): Promise<string | null> {
  const html = await fetchXcomHtml();
  if (!html) return null;

  // Step 1: Extract verification key from script tags
  const verificationB64 = extractVerificationKey(html);
  if (!verificationB64) {
    process.stderr.write("[TID] live-SVG: could not extract verification key\n");
    return null;
  }

  // Step 2: Parse SVG animation frames
  const frames = parseSvgFrames(html);

  // Step 3: Extract dynamic indices from ondemand chunk URL
  const indices = extractOndemandIndices(html);

  // Step 4: Compute animation key from SVG frames + indices
  let animationKey: string;

  if (frames && frames.length > 0) {
    const computed = computeAnimationKey(frames, indices);
    if (!computed) {
    process.stderr.write("[TID] live-SVG: could not compute animation key from SVG\n");
      return null;
    }
    animationKey = computed;
  } else {
    // No SVG frames found — cannot compute animation key
    process.stderr.write("[TID] live-SVG: no SVG animation frames found\n");
    return null;
  }

  // Step 5: Decode verification base64 → keyBytes
  const keyBytes = Array.from(Buffer.from(verificationB64, "base64"));

  // Step 6: Build transaction ID
  return buildTransactionId(method, path, keyBytes, animationKey);
}

/** Clear the HTML cache (delegates to shared cache). */
export { clearSharedHtmlCache as clearHtmlCache };
