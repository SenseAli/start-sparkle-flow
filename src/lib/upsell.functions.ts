/**
 * Server functions for the upsell/cross-sell agent demo.
 * Flow: cart → agent proposes → Policy Gate validates → (accept) mock Razorpay
 * order → everything written to the audit log.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkOffer, DEFAULT_POLICY, type CatalogProduct } from "./policy-gate";
import { proposeOffer, type CartItem } from "./agent.server";
import { getPaymentsAdapter } from "./razorpay.server";

function db() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function toProduct(row: {
  sku: string;
  name: string;
  price_inr: number;
  cost_inr: number;
  cross_sell_eligible: boolean;
}): CatalogProduct {
  return {
    sku: row.sku,
    name: row.name,
    priceInr: Number(row.price_inr),
    costInr: Number(row.cost_inr),
    crossSellEligible: row.cross_sell_eligible,
  };
}

export const getCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await db().from("catalog").select("*").order("price_inr", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

const submitCartInput = z.object({
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).min(1),
});

export const submitCart = createServerFn({ method: "POST" })
  .inputValidator((input) => submitCartInput.parse(input))
  .handler(async ({ data }) => {
    const supabase = db();
    const { data: catalogRows, error: catErr } = await supabase.from("catalog").select("*");
    if (catErr) throw new Error(catErr.message);
    const catalog = (catalogRows ?? []).map(toProduct);
    const bySku = new Map(catalog.map((p) => [p.sku, p]));

    const cart: CartItem[] = data.items.map((i) => {
      const p = bySku.get(i.sku);
      if (!p) throw new Error(`Unknown SKU ${i.sku}`);
      return { sku: p.sku, name: p.name, qty: i.qty, priceInr: p.priceInr };
    });

    const { data: session, error: sErr } = await supabase
      .from("sessions")
      .insert({ cart, status: "open" })
      .select("id")
      .single();
    if (sErr) throw new Error(sErr.message);
    const sessionId = session.id as string;

    // Idempotency: one offer per session
    const { data: prior } = await supabase
      .from("audit_log")
      .select("id")
      .eq("session_id", sessionId)
      .eq("event", "offer_proposed");
    const alreadyOffered = (prior?.length ?? 0) > 0;

    const eligible = catalog.filter((p) => p.crossSellEligible);
    const { candidate, source } = await proposeOffer(cart, eligible);

    let decision = null;
    let finalAction: Record<string, unknown> = { type: "no_offer", reason: "no candidate" };
    if (candidate) {
      decision = checkOffer(candidate, bySku.get(candidate.sku), alreadyOffered, DEFAULT_POLICY);
      finalAction = decision.approved
        ? { type: "offer", offer: decision.offer }
        : { type: "no_offer", reason: decision.rejectReasons.join("; "), fallback: "rejected candidate never shown to shopper" };
    }

    const { data: auditRow, error: aErr } = await supabase
      .from("audit_log")
      .insert({
        session_id: sessionId,
        event: "offer_proposed",
        cart_snapshot: cart,
        proposed_action: candidate,
        rationale: candidate?.rationale ?? null,
        gate_result: decision,
        final_action: finalAction,
        mode: "fixed",
      })
      .select("id")
      .single();
    if (aErr) throw new Error(aErr.message);

    return {
      sessionId,
      auditId: auditRow.id,
      cart,
      proposalSource: source,
      candidate,
      decision,
      finalAction,
    };
  });

export const acceptOffer = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ sessionId: z.string(), auditId: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const supabase = db();

    // Load the immutable, gate-approved decision — the ONLY pricing source.
    const { data: audit, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("id", data.auditId)
      .eq("session_id", data.sessionId)
      .single();
    if (error || !audit) throw new Error("audit entry not found");
    const offer = (audit.final_action as { type: string; offer?: { finalPriceInr: number; sku: string } })?.offer;
    if ((audit.final_action as { type: string }).type !== "offer" || !offer) {
      throw new Error("no approved offer to accept");
    }

    const cartTotal = (audit.cart_snapshot as CartItem[]).reduce((s, c) => s + c.priceInr * c.qty, 0);
    const orderTotal = Math.round((cartTotal + offer.finalPriceInr) * 100) / 100;

    const order = await getPaymentsAdapter().createOrder(orderTotal, {
      session_id: data.sessionId,
      offer_sku: offer.sku,
      pricing_source: "policy_gate_decision",
    });

    await supabase.from("audit_log").insert({
      session_id: data.sessionId,
      event: "offer_accepted",
      cart_snapshot: audit.cart_snapshot,
      proposed_action: audit.proposed_action,
      rationale: audit.rationale,
      gate_result: audit.gate_result,
      final_action: { type: "order_created", offer, orderTotalInr: orderTotal },
      order_id: order.id,
      mode: "fixed",
    });
    await supabase.from("sessions").update({ status: "ordered" }).eq("id", data.sessionId);

    return { orderId: order.id, orderTotalInr: orderTotal, mode: order.mode };
  });

export const getAuditLog = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ sessionId: z.string().optional() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    let q = db().from("audit_log").select("*").order("created_at", { ascending: false }).limit(50);
    if (data.sessionId) q = q.eq("session_id", data.sessionId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows;
  });

/**
 * Deliberate failure reproduction (legacy TOCTOU mode).
 *
 * Broken flow: the Gate checks the agent's proposed discount ONCE, but the
 * legacy order-creation path re-reads the discount from a MUTABLE session
 * object that the agent's retry overwrote after approval. Result: the
 * charged amount does not match what the Gate approved — audit mismatch.
 *
 * The fixed path (submitCart/acceptOffer) prices orders exclusively from the
 * Gate's immutable decision object, so this class of bug cannot occur there.
 */
export const reproduceToctouFailure = createServerFn({ method: "POST" }).handler(async () => {
  const supabase = db();
  const { data: catalogRows } = await supabase.from("catalog").select("*");
  const catalog = (catalogRows ?? []).map(toProduct);
  const laptop = catalog.find((p) => p.sku === "LAPTOP-PRO-14")!;
  const mouse = catalog.find((p) => p.sku === "MOUSE-MX")!;
  const cart: CartItem[] = [{ sku: laptop.sku, name: laptop.name, qty: 1, priceInr: laptop.priceInr }];

  const { data: session } = await supabase
    .from("sessions")
    .insert({ cart, status: "open" })
    .select("id")
    .single();
  const sessionId = session!.id as string;

  // 1. Agent proposes a safe 10% — Gate checks and approves.
  const candidate = { sku: mouse.sku, discountPct: 10, rationale: "legacy run: mouse pairs with laptop" };
  const decision = checkOffer(candidate, mouse, false, DEFAULT_POLICY);
  const approvedFinal = decision.offer!.finalPriceInr; // gate-approved: ₹3149.10

  // 2. Mutable session object holds the discount (the bug).
  const mutableSession = { discountPct: decision.offer!.discountPct };

  // 3. Agent retries post-approval and overwrites the mutable value.
  mutableSession.discountPct = 85; // never re-validated by the Gate

  // 4. Legacy order creation prices from the mutated session, not the decision.
  const legacyCharged = Math.round(mouse.priceInr * (1 - mutableSession.discountPct / 100) * 100) / 100;
  const order = await getPaymentsAdapter().createOrder(laptop.priceInr + legacyCharged, {
    session_id: sessionId,
    pricing_source: "mutable_session_discount_LEGACY_BUG",
  });

  const mismatch = Math.round((approvedFinal - legacyCharged) * 100) / 100;
  await supabase.from("audit_log").insert([
    {
      session_id: sessionId,
      event: "offer_proposed",
      cart_snapshot: cart,
      proposed_action: candidate,
      rationale: candidate.rationale,
      gate_result: decision,
      final_action: { type: "offer", offer: decision.offer },
      mode: "legacy",
    },
    {
      session_id: sessionId,
      event: "toctou_failure",
      cart_snapshot: cart,
      proposed_action: candidate,
      rationale: `Gate approved ₹${approvedFinal} but legacy order creation re-read a mutated session discount (85%) and charged ₹${legacyCharged} — ₹${mismatch} discrepancy. Time-of-check vs time-of-use.`,
      gate_result: decision,
      final_action: {
        type: "order_created",
        approvedFinalPriceInr: approvedFinal,
        chargedPriceInr: legacyCharged,
        mismatchInr: mismatch,
        mutatedDiscountPct: mutableSession.discountPct,
      },
      order_id: order.id,
      mode: "legacy",
    },
  ]);

  return {
    sessionId,
    orderId: order.id,
    approvedFinalPriceInr: approvedFinal,
    chargedPriceInr: legacyCharged,
    mismatchInr: mismatch,
    gateApprovedDiscountPct: 10,
    chargedDiscountPct: 85,
  };
});
