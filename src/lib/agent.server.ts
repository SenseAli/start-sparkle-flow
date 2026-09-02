/**
 * Agent reasoning layer (server-only).
 *
 * The LLM proposes a candidate {sku, discountPct, rationale}. It NEVER
 * computes final prices — the Policy Gate re-derives all money math.
 * If the LLM is unavailable or unparseable, a deterministic heuristic
 * fallback keeps the demo pipeline working.
 */
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import type { AgentCandidate, CatalogProduct } from "./policy-gate";

export interface CartItem {
  sku: string;
  name: string;
  qty: number;
  priceInr: number;
}

const candidateSchema = z.object({
  sku: z.string(),
  discountPct: z.number(),
  rationale: z.string(),
});

function heuristicFallback(cart: CartItem[], eligible: CatalogProduct[]): AgentCandidate | null {
  const cartSkus = new Set(cart.map((c) => c.sku));
  const candidates = eligible
    .filter((p) => !cartSkus.has(p.sku))
    .sort((a, b) => b.priceInr - b.costInr - (a.priceInr - a.costInr));
  const pick = candidates[0];
  if (!pick) return null;
  const marginRoom = ((pick.priceInr - pick.costInr) / pick.priceInr) * 100;
  // Respect both the % cap and the ₹2,000 absolute cap so the heuristic passes the gate.
  const absCapPct = Math.floor((2000 / pick.priceInr) * 100);
  const discountPct = Math.max(0, Math.min(10, absCapPct, Math.floor(marginRoom - 16)));
  return {
    sku: pick.sku,
    discountPct,
    rationale: `Heuristic fallback: ${pick.name} has the highest absolute margin among eligible cross-sells not already in the cart, leaving room for a ${discountPct}% discount while staying above the margin floor and the ₹2,000 discount cap.`,
  };
}

export async function proposeOffer(
  cart: CartItem[],
  eligible: CatalogProduct[],
): Promise<{ candidate: AgentCandidate | null; source: "llm" | "heuristic" | "none" }> {
  const cartSkus = new Set(cart.map((c) => c.sku));
  const pool = eligible.filter((p) => !cartSkus.has(p.sku));
  if (pool.length === 0) return { candidate: null, source: "none" };

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (apiKey) {
    try {
      const gateway = createLovableAiGatewayProvider(apiKey);
      const cartDesc = cart.map((c) => `${c.name} (${c.sku}) x${c.qty} @ ₹${c.priceInr}`).join(", ");
      const poolDesc = pool
        .map(
          (p) =>
            `${p.sku} "${p.name}" price ₹${p.priceInr}, cost ₹${p.costInr}, margin ${(((p.priceInr - p.costInr) / p.priceInr) * 100).toFixed(1)}%`,
        )
        .join("\n");
      const { output } = await generateText({
        model: gateway("google/gemini-3.6-flash"),
        output: Output.object({ schema: candidateSchema }),
        prompt: `You are an e-commerce upsell/cross-sell agent. A shopper's cart contains: ${cartDesc}.

Eligible cross-sell products (pick exactly ONE that best complements the cart):
${poolDesc}

Propose one offer with a discount percentage between 0 and 15 that keeps the product profitable. Explain your reasoning in 1-2 sentences referencing the cart contents and margin. Return structured fields only; do not compute final prices.`,
      });
      if (output && pool.some((p) => p.sku === output.sku)) {
        const discountPct = Math.max(0, Math.min(15, Math.round(output.discountPct)));
        return {
          candidate: { sku: output.sku, discountPct, rationale: output.rationale },
          source: "llm",
        };
      }
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        console.warn("agent: malformed structured output, falling back", error.text?.slice(0, 200));
      } else {
        console.warn("agent: gateway call failed, falling back", error);
      }
    }
  }

  const candidate = heuristicFallback(cart, eligible);
  return candidate
    ? { candidate, source: "heuristic" }
    : { candidate: null, source: "none" };
}
