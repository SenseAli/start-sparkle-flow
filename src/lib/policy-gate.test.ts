import { describe, expect, it } from "bun:test";
import { checkOffer, DEFAULT_POLICY, type CatalogProduct } from "./policy-gate";

const mouse: CatalogProduct = {
  sku: "MOUSE-MX",
  name: "MX Wireless Mouse",
  priceInr: 3499,
  costInr: 1800,
  crossSellEligible: true,
};

const laptop: CatalogProduct = {
  sku: "LAPTOP-PRO-14",
  name: "ProBook 14",
  priceInr: 74999,
  costInr: 58000,
  crossSellEligible: false,
};

describe("Policy Gate", () => {
  it("approves a compliant candidate and re-derives the price itself", () => {
    const d = checkOffer({ sku: "MOUSE-MX", discountPct: 10, rationale: "test" }, mouse, false);
    expect(d.approved).toBe(true);
    expect(d.offer!.finalPriceInr).toBe(3149.1);
    expect(d.offer!.discountAbsInr).toBe(349.9);
    expect(d.offer!.marginPct).toBeGreaterThanOrEqual(DEFAULT_POLICY.marginFloorPct);
  });

  it("rejects discount % above cap", () => {
    const d = checkOffer({ sku: "MOUSE-MX", discountPct: 25, rationale: "" }, mouse, false);
    expect(d.approved).toBe(false);
    expect(d.rejectReasons.some((r) => r.startsWith("discount_pct_cap"))).toBe(true);
  });

  it("rejects discount ₹ above absolute cap", () => {
    const big: CatalogProduct = { ...mouse, sku: "MONITOR-27", priceInr: 24999, costInr: 10000 };
    // 15% of 24999 = 3749.85 > 2000 cap
    const d = checkOffer({ sku: "MONITOR-27", discountPct: 15, rationale: "" }, big, false);
    expect(d.approved).toBe(false);
    expect(d.rejectReasons.some((r) => r.startsWith("discount_abs_cap"))).toBe(true);
  });

  it("rejects when margin would fall below floor", () => {
    const thin: CatalogProduct = { ...mouse, priceInr: 2000, costInr: 1750 }; // 12.5% margin at full price
    const d = checkOffer({ sku: "MOUSE-MX", discountPct: 0, rationale: "" }, thin, false);
    expect(d.approved).toBe(false);
    expect(d.rejectReasons.some((r) => r.startsWith("margin_floor"))).toBe(true);
  });

  it("rejects ineligible SKUs", () => {
    const d = checkOffer({ sku: "LAPTOP-PRO-14", discountPct: 5, rationale: "" }, laptop, false);
    expect(d.approved).toBe(false);
    expect(d.rejectReasons.some((r) => r.startsWith("eligible_sku"))).toBe(true);
  });

  it("rejects a second offer in the same session (no stacking / idempotency)", () => {
    const d = checkOffer({ sku: "MOUSE-MX", discountPct: 10, rationale: "" }, mouse, true);
    expect(d.approved).toBe(false);
    expect(d.rejectReasons.some((r) => r.startsWith("one_offer_per_session"))).toBe(true);
  });

  it("regression (TOCTOU): decision object is immutable and is the only pricing source", () => {
    const d = checkOffer({ sku: "MOUSE-MX", discountPct: 10, rationale: "" }, mouse, false);
    expect(d.approved).toBe(true);
    expect(Object.isFrozen(d.offer)).toBe(true);
    expect(() => {
      const mutable = d.offer as unknown as { discountPct: number };
      mutable.discountPct = 85;
    }).toThrow();
    expect(d.offer!.finalPriceInr).toBe(3149.1); // unchanged after mutation attempt
  });
});
