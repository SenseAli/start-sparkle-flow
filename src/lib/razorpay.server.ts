/**
 * Mock Razorpay adapter (TEST MODE only).
 *
 * Mirrors the Razorpay Orders API surface so real `rzp_test_` keys can be
 * dropped in later by implementing the same interface against
 * https://api.razorpay.com/v1/orders — no call-site changes required.
 *
 * All amounts are in INR (rupees) here; a real adapter converts to paise.
 */

export interface RazorpayOrder {
  id: string; // order_xxx
  entity: "order";
  amount: number; // paise in real Razorpay; kept as rupees*100 for realism
  currency: "INR";
  status: "created";
  notes: Record<string, string>;
  mode: "MOCK_TEST";
}

export interface PaymentsAdapter {
  createOrder(amountInr: number, notes: Record<string, string>): Promise<RazorpayOrder>;
}

let counter = 0;

export const mockRazorpay: PaymentsAdapter = {
  async createOrder(amountInr, notes) {
    counter += 1;
    const suffix = `${Date.now().toString(36)}${counter}`.slice(-12);
    return {
      id: `order_MOCK${suffix}`,
      entity: "order",
      amount: Math.round(amountInr * 100),
      currency: "INR",
      status: "created",
      notes: { ...notes, mode: "MOCK_TEST_MODE_no_real_money" },
      mode: "MOCK_TEST",
    };
  },
};

/** Swap point: when rzp_test_ keys are available, implement PaymentsAdapter
 *  with fetch("https://api.razorpay.com/v1/orders", { auth: key_id:key_secret })
 *  and select it here based on process.env. */
export function getPaymentsAdapter(): PaymentsAdapter {
  return mockRazorpay;
}
