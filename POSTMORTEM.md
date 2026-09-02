# POSTMORTEM — Unbounded discount via TOCTOU (time-of-check-to-time-of-use)

## Summary

The legacy checkout path allowed a discount **larger than merchant policy** to be
charged, because the value the Policy Gate validated was **not** the value the
order-creation code used.

## What broke

1. The agent proposed a compliant offer: `MOUSE-MX` at **10% off** (₹3,499 → ₹3,149.10).
2. The Policy Gate checked the proposal and approved it (10% ≤ 20% cap, ₹349.90 ≤ ₹2,000 cap,
   margin 42.9% ≥ 15% floor).
3. The approved discount was stored in a **mutable session object**.
4. The agent retried post-approval and **overwrote `session.discountPct` to 85%** — after the
   Gate had already run.
5. Legacy order creation re-read the discount **from the session**, not from the Gate's
   decision, and created an order charging **₹524.85** instead of ₹3,149.10.

**Discrepancy: ₹2,624.25** — money the merchant never agreed to give up.

## The smoking gun

The audit log is what caught it: the `offer_proposed` entry recorded the gate-approved
price (₹3,149.10) while the `toctou_failure` / order entry showed the charged price
(₹524.85). The two entries for the same session disagreed — the audit trail did exactly
its job.

Reproduce live: **"Reproduce failure"** button in the demo UI (server function
`reproduceToctouFailure` in `src/lib/upsell.functions.ts`), which runs the broken flow
against the mock Razorpay adapter and logs both entries with `mode = 'legacy'`.

## Root cause

A classic **time-of-check-to-time-of-use (TOCTOU)** gap: validation and use referenced
different sources of truth. The Gate validated the *proposal*, but the money path read a
*mutable* copy that could change between check and use. Any post-approval mutation —
an agent retry, a concurrent request, a race — silently bypassed every bound.

## Fix

The Policy Gate is now the **single source of truth for pricing**:

- `checkOffer()` (`src/lib/policy-gate.ts`) re-derives the discounted price itself
  (the LLM never does money math) and returns an **immutable** (`Object.freeze`d)
  `ApprovedOffer` decision object.
- Order creation (`acceptOffer`) prices the order **verbatim from the stored decision**
  loaded from the audit log. There is no mutable discount field anywhere in the fixed path.

## Regression test

`src/lib/policy-gate.test.ts` — run with `bun test`:

- `regression (TOCTOU): decision object is immutable and is the only pricing source`
  proves an attempt to mutate the decision throws and the approved price is unchanged.
- The remaining tests pin each gate rule (% cap, ₹ cap, margin floor, eligibility,
  one-offer-per-session).

## Lessons

- "Bounded and gated" is a property of the **money path**, not of the prompt. Deterministic
  code must own every rupee figure end to end.
- Validation without immutable hand-off is validation theatre: whatever is checked must be
  exactly what is used.
- An append-only audit log that records both the decision and the outcome turns this class
  of bug from invisible revenue leak into a one-line query.
