// Tests for src/lib/twitter/transaction-id-cubic.ts
import { describe, it, expect } from "vitest";
import { cubicBezier } from "@/lib/twitter/transaction-id-cubic";

describe("cubicBezier", () => {
  it("returns p1 when t=0 (start of curve)", () => {
    const result = cubicBezier(10, 20, 30, 40, 0);
    expect(result).toBeCloseTo(10, 10);
  });

  it("returns p4 when t=1 (end of curve)", () => {
    const result = cubicBezier(10, 20, 30, 40, 1);
    expect(result).toBeCloseTo(40, 10);
  });

  it("computes midpoint correctly for symmetric control points", () => {
    // cubicBezier(0, 1, 1, 0, 0.5) = 0.75 (not 0.5 — bezier curves)
    const result = cubicBezier(0, 1, 1, 0, 0.5);
    expect(result).toBeCloseTo(0.75, 10);
  });

  it("computes linear interpolation when all control points are equal", () => {
    const result = cubicBezier(5, 5, 5, 5, 0.3);
    expect(result).toBeCloseTo(5, 10);
  });

  it("computes correct value at t=0.5 for standard control points", () => {
    // Same as the symmetric test — verified value is 0.75
    const result = cubicBezier(0, 1, 1, 0, 0.5);
    expect(result).toBeCloseTo(0.75, 10);
  });

  it("computes correct value at t=0.25", () => {
    const result = cubicBezier(0, 1, 1, 0, 0.25);
    // u = 0.75
    // a = 0.75*0 + 0.25*1 = 0.25
    // b = 0.75*1 + 0.25*1 = 1
    // c = 0.75*1 + 0.25*0 = 0.75
    // d = 0.75*0.25 + 0.25*1 = 0.4375
    // e = 0.75*1 + 0.25*0.75 = 0.9375
    // result = 0.75*0.4375 + 0.25*0.9375 = 0.328125 + 0.234375 = 0.5625
    expect(result).toBeCloseTo(0.5625, 10);
  });

  it("handles negative control points", () => {
    const result = cubicBezier(-10, -5, 5, 10, 0.5);
    expect(result).toBeCloseTo(0, 10);
  });

  it("handles large values", () => {
    const result = cubicBezier(1000, 2000, 3000, 4000, 0.5);
    // Symmetric control points at 0.5
    // a = 0.5*1000 + 0.5*2000 = 1500
    // b = 0.5*2000 + 0.5*3000 = 2500
    // c = 0.5*3000 + 0.5*4000 = 3500
    // d = 0.5*1500 + 0.5*2500 = 2000
    // e = 0.5*2500 + 0.5*3500 = 3000
    // result = 0.5*2000 + 0.5*3000 = 2500
    expect(result).toBeCloseTo(2500, 10);
  });

  it("handles zero control points", () => {
    const result = cubicBezier(0, 0, 0, 0, 0.5);
    expect(result).toBe(0);
  });
});
