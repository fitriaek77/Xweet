// src/lib/twitter/transaction-id-cubic.ts
// Pure math for cubic Bézier interpolation.
// Used by SVG animation key computation in the HTML/SVG TID fallback.

/**
 * Evaluate a cubic Bézier curve at parameter `t ∈ [0, 1]`.
 *
 * Control points are implicitly at x-coordinates 0, 1/3, 2/3, 1:
 *   P0 = (0,   p1)
 *   P1 = (1/3, p2)
 *   P2 = (2/3, p3)
 *   P3 = (1,   p4)
 *
 * Uses the standard De Casteljau algorithm for numerical stability.
 */
export function cubicBezier(
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  t: number,
): number {
  const u = 1 - t;

  // First level of interpolation
  const a = u * p1 + t * p2; // between P0 and P1
  const b = u * p2 + t * p3; // between P1 and P2
  const c = u * p3 + t * p4; // between P2 and P3

  // Second level
  const d = u * a + t * b; // between (a) and (b)
  const e = u * b + t * c; // between (b) and (c)

  // Final level
  return u * d + t * e;
}
