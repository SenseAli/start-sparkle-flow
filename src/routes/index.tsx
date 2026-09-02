import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  acceptOffer,
  getAuditLog,
  getCatalog,
  reproduceToctouFailure,
  submitCart,
} from "../lib/upsell.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Upsell Agent — Explainable, Bounded, Gated" },
      {
        name: "description",
        content:
          "An agentic upsell/cross-sell demo: an LLM proposes offers, a deterministic policy gate bounds them, and every decision lands in a queryable audit trail.",
      },
      { property: "og:title", content: "Upsell Agent — Explainable, Bounded, Gated" },
      {
        property: "og:description",
        content:
          "LLM-proposed offers validated by a deterministic policy gate, with a full audit trail and a reproducible TOCTOU failure + fix.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Demo,
});

type SubmitResult = Awaited<ReturnType<typeof submitCart>>;
type ToctouResult = Awaited<ReturnType<typeof reproduceToctouFailure>>;

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Demo() {
  const catalogFn = useServerFn(getCatalog);
  const submitFn = useServerFn(submitCart);
  const acceptFn = useServerFn(acceptOffer);
  const auditFn = useServerFn(getAuditLog);
  const toctouFn = useServerFn(reproduceToctouFailure);

  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: () => catalogFn() });
  const { data: audit, refetch: refetchAudit } = useQuery({
    queryKey: ["audit"],
    queryFn: () => auditFn({ data: {} }),
  });

  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [order, setOrder] = useState<{ orderId: string; orderTotalInr: number } | null>(null);
  const [toctou, setToctou] = useState<ToctouResult | null>(null);

  const cartItems = Object.entries(cart).map(([sku, qty]) => ({ sku, qty }));
  const cartTotal =
    catalog?.reduce((s, p) => s + (cart[p.sku] ?? 0) * Number(p.price_inr), 0) ?? 0;

  const addToCart = (sku: string) => setCart((c) => ({ ...c, [sku]: (c[sku] ?? 0) + 1 }));
  const removeFromCart = (sku: string) =>
    setCart((c) => {
      const next = { ...c };
      if ((next[sku] ?? 0) <= 1) delete next[sku];
      else next[sku] = next[sku]! - 1;
      return next;
    });

  const onSubmit = async () => {
    setBusy(true);
    setOrder(null);
    setResult(null);
    try {
      const r = await submitFn({ data: { items: cartItems } });
      setResult(r);
      setCart({});
      await refetchAudit();
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const o = await acceptFn({ data: { sessionId: result.sessionId, auditId: result.auditId } });
      setOrder(o);
      await refetchAudit();
    } finally {
      setBusy(false);
    }
  };

  const onToctou = async () => {
    setBusy(true);
    setToctou(null);
    try {
      setToctou(await toctouFn());
      await refetchAudit();
    } finally {
      setBusy(false);
    }
  };

  const offer = result?.finalAction.type === "offer" ? result.finalAction.offer : null;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <div className="mx-auto flex max-w-7xl items-baseline justify-between">
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight">
              upsell-agent<span className="text-chart-2">.ops</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Explainable · Bounded · Gated — agent proposes, the Policy Gate decides, everything is audited
            </p>
          </div>
          <span className="rounded border border-chart-4/40 bg-chart-4/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-chart-4">
            Razorpay MOCK test mode — no real money
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-3">
        {/* Catalog + cart */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            1 · Catalog → Cart
          </h2>
          <ul className="mt-3 space-y-2">
            {catalog?.map((p) => (
              <li
                key={p.sku}
                className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/40 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {p.sku} · {inr(Number(p.price_inr))}
                    {p.cross_sell_eligible && (
                      <span className="ml-2 text-chart-2">cross-sell ✓</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(cart[p.sku] ?? 0) > 0 && (
                    <>
                      <button
                        onClick={() => removeFromCart(p.sku)}
                        className="h-6 w-6 rounded border border-border font-mono text-xs hover:bg-accent"
                      >
                        −
                      </button>
                      <span className="w-4 text-center font-mono text-xs">{cart[p.sku]}</span>
                    </>
                  )}
                  <button
                    onClick={() => addToCart(p.sku)}
                    className="h-6 w-6 rounded border border-border font-mono text-xs hover:bg-accent"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <p className="font-mono text-sm">
              cart: <span className="font-bold">{inr(cartTotal)}</span>
            </p>
            <button
              disabled={cartItems.length === 0 || busy}
              onClick={onSubmit}
              className="rounded-md bg-primary px-4 py-2 font-mono text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              {busy ? "working…" : "Submit cart → agent"}
            </button>
          </div>
        </section>

        {/* Agent + gate */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            2 · Agent proposal → Policy Gate
          </h2>
          {!result && !toctou && (
            <p className="mt-6 text-sm text-muted-foreground">
              Submit a cart to see the agent's candidate offer and the gate's per-rule verdict.
            </p>
          )}

          {result && (
            <div className="mt-3 space-y-3">
              <p className="font-mono text-[11px] text-muted-foreground">
                session {result.sessionId.slice(0, 8)}… · source: {result.proposalSource}
              </p>
              {result.candidate && (
                <div className="rounded-md border border-border/60 bg-secondary/40 p-3">
                  <p className="text-sm font-medium">
                    Proposed: <span className="font-mono">{result.candidate.sku}</span> @{" "}
                    {result.candidate.discountPct}% off
                  </p>
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    “{result.candidate.rationale}”
                  </p>
                </div>
              )}
              {result.decision && (
                <ul className="space-y-1 font-mono text-[11px]">
                  {result.decision.checks.map((c) => (
                    <li key={c.rule} className="flex gap-2">
                      <span className={c.passed ? "text-chart-2" : "text-destructive"}>
                        {c.passed ? "PASS" : "FAIL"}
                      </span>
                      <span className="text-muted-foreground">
                        {c.rule} — {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {offer ? (
                <div className="rounded-md border border-chart-2/40 bg-chart-2/10 p-3">
                  <p className="text-sm font-semibold">
                    {offer.productName} — {inr(offer.listPriceInr)} → {inr(offer.finalPriceInr)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    −{offer.discountPct}% (−{inr(offer.discountAbsInr)}) · margin {offer.marginPct}% ·
                    priced by the gate, not the LLM
                  </p>
                  {!order ? (
                    <button
                      disabled={busy}
                      onClick={onAccept}
                      className="mt-3 rounded-md bg-chart-2 px-4 py-2 font-mono text-xs font-semibold text-background disabled:opacity-40"
                    >
                      Accept offer → create test order
                    </button>
                  ) : (
                    <p className="mt-3 font-mono text-xs text-chart-2">
                      ✓ order {order.orderId} · total {inr(order.orderTotalInr)} (MOCK test)
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  Gate rejected — shopper safely sees <span className="font-mono">no offer</span>.
                  The rejected candidate is never applied.
                </div>
              )}
            </div>
          )}

          {/* Failure lab */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-chart-4">
              Failure lab — TOCTOU bug
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Legacy mode: the gate approved 10%, but order creation re-read a session discount the
              agent mutated to 85% post-approval. Watch the audit trail catch the mismatch.
            </p>
            <button
              disabled={busy}
              onClick={onToctou}
              className="mt-2 rounded-md border border-chart-4/50 px-3 py-1.5 font-mono text-xs text-chart-4 hover:bg-chart-4/10 disabled:opacity-40"
            >
              Reproduce failure
            </button>
            {toctou && (
              <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 font-mono text-[11px]">
                <p>gate approved: {inr(toctou.approvedFinalPriceInr)} (10% off)</p>
                <p className="text-destructive">
                  actually charged: {inr(toctou.chargedPriceInr)} (85% off, mutated post-check)
                </p>
                <p className="mt-1 font-bold text-destructive">
                  mismatch: {inr(toctou.mismatchInr)} — caught in audit log (mode=legacy)
                </p>
                <p className="mt-1 text-muted-foreground">
                  Fixed path prices only from the gate's frozen decision object. See POSTMORTEM.md.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Audit trail */}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            3 · Audit trail
          </h2>
          <ul className="mt-3 space-y-2 overflow-y-auto">
            {audit?.map((row) => (
              <li key={row.id} className="rounded-md border border-border/60 bg-secondary/40 p-2.5">
                <div className="flex items-center justify-between">
                  <span
                    className={`font-mono text-[11px] font-semibold ${
                      row.event === "toctou_failure"
                        ? "text-destructive"
                        : row.event === "offer_accepted"
                          ? "text-chart-2"
                          : "text-foreground"
                    }`}
                  >
                    {row.event}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {row.mode} · {new Date(row.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {row.rationale ?? "—"}
                </p>
                {row.order_id && (
                  <p className="mt-1 font-mono text-[10px] text-chart-4">order: {row.order_id}</p>
                )}
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  session {row.session_id.slice(0, 8)}…
                </p>
              </li>
            ))}
            {audit?.length === 0 && (
              <p className="text-sm text-muted-foreground">No audit entries yet.</p>
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
