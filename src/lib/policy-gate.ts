/**
 * Policy Gate — the deterministic, auditable core of the upsell agent.
 *
 * Rules (see PRD §6 FR3):
 *  - discount %  <= MAX_DISCOUNT_PCT
 *  - discount ₹  <= MAX_DISCOUNT_ABS_INR
 *  - margin after discount >= MARGIN_FLOOR_PCT
 *  - SKU must be in the eligible list
 *  - one offer per session (no stacking / idempotency)
 *
 * The gate NEVER trusts agent-provided money math. It re-derives the
 * discounted price itself and returns an immutable ApprovedOffer decision
 * object. Order creation MUST use this object verbatim (TOCTOU fix).
 */

export interface CatalogProduct {
  sku: string;
  name: string;
  priceInr: number;
  costInr: number;
  crossSellEligible: boolean;
}

export interface PolicyConfig {
  maxDiscountPct: number;
  maxDiscountAbsInr: number;
  marginFloorPct: number; // (finalPrice - cost) / finalPrice * 100
}

export const DEFAULT_POLICY: PolicyConfig = {
  maxDiscountPct: 20,
  maxDiscountAbsInr: 2000,
  marginFloorPct: 15,
};

export interface AgentCandidate {
  sku: string;
  discountPct: number;
  rationale: string;
}

export interface GateCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

/** Immutable decision: the ONLY object order creation is allowed to price from. */
export interface ApprovedOffer {
  sku: string;
  productName: string;
  listPriceInr: number;
  discountPct: number;
  discountAbsInr: number;
  finalPriceInr: number;
  marginPct: number;
}

export interface GateDecision {
  approved: boolean;
  checks: GateCheck[];
  rejectReasons: string[];
  offer: ApprovedOffer | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkOffer(
  candidate: AgentCandidate,
  product: CatalogProduct | undefined,
  alreadyOfferedThisSession: boolean,
  policy: PolicyConfig = DEFAULT_POLICY,
): GateDecision {
  const checks: GateCheck[] = [];

  // 1. Eligibility
  const eligible = !!product && product.crossSellEligible;
  checks.push({
    rule: "eligible_sku",
    passed: eligible,
    detail: product
      ? product.crossSellEligible
        ? `${candidate.sku} is in the merchant's cross-sell eligible list`
        : `${candidate.sku} is NOT in the cross-sell eligible list`
      : `${candidate.sku} not found in catalog`,
  });

  // 2. Discount % cap
  const pctOk =
    Number.isFinite(candidate.discountPct) &&
    candidate.discountPct >= 0 &&
    candidate.discountPct <= policy.maxDiscountPct;
  checks.push({
    rule: "discount_pct_cap",
    passed: pctOk,
    detail: `proposed ${candidate.discountPct}% vs cap ${policy.maxDiscountPct}%`,
  });

  // 3. Discount absolute cap (gate re-derives ₹ from the verified %)
  const listPrice = product?.priceInr ?? 0;
  const discountAbs = r2(listPrice * (Math.max(0, candidate.discountPct) / 100));
  const absOk = !product || discountAbs <= policy.maxDiscountAbsInr;
  checks.push({
    rule: "discount_abs_cap",
    passed: absOk,
    detail: `derived ₹${discountAbs} vs cap ₹${policy.maxDiscountAbsInr}`,
  });

  // 4. Margin floor
  const finalPrice = r2(listPrice - discountAbs);
  const marginPct = product && finalPrice > 0 ? r2(((finalPrice - product.costInr) / finalPrice) * 100) : 0;
  const marginOk = !!product && marginPct >= policy.marginFloorPct;
  checks.push({
    rule: "margin_floor",
    passed: marginOk,
    detail: product
      ? `margin after discount ${marginPct}% vs floor ${policy.marginFloorPct}%`
      : "no product",
  });

  // 5. One offer per session
  checks.push({
    rule: "one_offer_per_session",
    passed: !alreadyOfferedThisSession,
    detail: alreadyOfferedThisSession
      ? "an offer was already made for this session (no stacking)"
      : "first offer for this session",
  });

  const approved = checks.every((c) => c.passed);
  const rejectReasons = checks.filter((c) => !c.passed).map((c) => `${c.rule}: ${c.detail}`);

  const offer: ApprovedOffer | null =
    approved && product
      ? Object.freeze({
          sku: product.sku,
          productName: product.name,
          listPriceInr: product.priceInr,
          discountPct: candidate.discountPct,
          discountAbsInr: discountAbs,
          finalPriceInr: finalPrice,
          marginPct,
        })
      : null;

  return { approved, checks, rejectReasons, offer };
}
