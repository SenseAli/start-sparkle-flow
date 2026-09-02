# Plan — Upsell & Cross-sell Agent (adapted to Lovable stack)

The PRD's FastAPI/SQLite stack is replaced with Lovable-native equivalents; the architecture (Agent → Policy Gate → Payments → Audit Log) stays exactly as specified.

## Stack mapping

| PRD says | We use |
|---|---|
| FastAPI | TanStack Start server functions + `/api/*` server routes |
| SQLite | Lovable Cloud database (Postgres) — requires enabling Lovable Cloud |
| Anthropic API | Lovable AI Gateway (built-in, no key needed) |
| Razorpay test mode | Mock Razorpay adapter behind an interface; swap in `rzp_test_` keys later to go live |
| Minimal UI | Interactive demo UI (cart picker, offer panel, audit trail viewer) |

## Build steps

1. **Enable Lovable Cloud** (database + secrets).

2. **Database schema + seed migration**
   - `catalog` (sku, name, price_inr, cost_inr, margin, cross-sell-eligible flag) — seeded with ~10 SKUs
   - `sessions` (id, cart items JSON, status)
   - `offers` / `audit_log` (session_id, proposed action, rationale, gate result + per-check breakdown, final action, order_id, timestamp) — append-only

3. **Policy Gate — deterministic TypeScript, no LLM in the money path**
   - `src/lib/policy-gate.ts`: checks discount % ≤ cap, discount ₹ ≤ cap, margin after discount ≥ floor, SKU eligible, one-offer-per-session (dedupe/idempotency)
   - Gate recomputes the final price itself and returns an **immutable decision object** that order creation must use verbatim (this is the TOCTOU-safe design; see step 7)
   - Unit-style regression tests for the gate

4. **Agent**
   - Server function: cart + eligible catalog + margins → Lovable AI Gateway call with structured JSON output `{sku, discount_pct, rationale}`
   - Fallback: if the gate rejects, return a pre-approved no-discount bundle or "no offer" — never the rejected offer
   - Money math is always re-derived by the gate, never taken from the LLM

5. **Mock Razorpay adapter**
   - `src/lib/razorpay.server.ts` interface with `createOrder(amountInr, notes)` returning test-shaped `order_xxx` IDs, clearly labeled MOCK/TEST MODE
   - Structured so real `rzp_test_` keys drop in later with one env change

6. **Interactive demo UI (route `/`)**
   - Catalog browser → build a cart → submit
   - Offer panel: agent's proposal with rationale, gate check breakdown (pass/fail per rule), final bounded offer, accept/decline
   - Accept → mock test-mode order created → confirmation with order ID
   - Audit trail viewer: full log per session (proposed, checked, accepted/rejected, reason, order id)
   - Head metadata (title/description/og) on the route

7. **Deliberate failure + postmortem (G4/FR8)**
   - A toggleable "legacy mode" flag reproducing the TOCTOU bug: gate checks `discount_pct` but order creation re-reads a mutable session discount the agent overwrote → over-discount applied, audit log mismatches the charge
   - A "Reproduce failure" button in the demo UI runs the scenario and shows the smoking-gun mismatch
   - Fix (default path): gate is single source of truth, returns signed decision object; regression test proves the replay now fails safely
   - `POSTMORTEM.md` in repo: what broke, logs, root cause, fix, regression test
   - Note: Lovable manages git internally, so the broken→fixed commit pair from the PRD is replaced by the live toggle + postmortem doc

8. **Docs**
   - `README.md`: problem, architecture (Mermaid from PRD), how to run the demo, where the audit trail lives, link to postmortem, how to swap in real Razorpay test keys

## Technical notes
- All Razorpay/AI calls in server handlers only; secrets via Lovable Cloud, read inside handlers
- Idempotency: one accepted offer per session enforced in the gate + a unique constraint
- Verification: run the gate regression test, exercise the full flow in the preview (cart → offer → gate → order → audit log, plus failure replay)
