
CREATE TABLE public.catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  price_inr numeric(10,2) NOT NULL,
  cost_inr numeric(10,2) NOT NULL,
  cross_sell_eligible boolean NOT NULL DEFAULT false,
  upsell_eligible boolean NOT NULL DEFAULT false,
  pairs_with text[] DEFAULT '{}'
);
GRANT SELECT ON public.catalog TO anon;
GRANT ALL ON public.catalog TO service_role;
ALTER TABLE public.catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog public read" ON public.catalog FOR SELECT TO anon USING (true);

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.sessions TO anon;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sessions anon all" ON public.sessions FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.sessions(id) NOT NULL,
  event text NOT NULL,
  cart_snapshot jsonb NOT NULL,
  proposed_action jsonb,
  rationale text,
  gate_result jsonb,
  final_action jsonb,
  order_id text,
  mode text NOT NULL DEFAULT 'fixed',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO anon;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit anon read insert" ON public.audit_log FOR SELECT TO anon USING (true);
CREATE POLICY "audit anon insert" ON public.audit_log FOR INSERT TO anon WITH CHECK (true);

INSERT INTO public.catalog (sku, name, category, price_inr, cost_inr, cross_sell_eligible, upsell_eligible, pairs_with) VALUES
('LAPTOP-PRO-14', 'ProBook 14 Laptop', 'Computers', 74999, 58000, false, true, '{}'),
('LAPTOP-AIR-13', 'AirBook 13 Laptop', 'Computers', 54999, 43000, false, true, '{}'),
('MOUSE-MX', 'MX Wireless Mouse', 'Accessories', 3499, 1800, true, false, '{LAPTOP-PRO-14,LAPTOP-AIR-13}'),
('KB-MECH-K8', 'K8 Mechanical Keyboard', 'Accessories', 6999, 3600, true, false, '{LAPTOP-PRO-14}'),
('SLEEVE-14', 'Premium Laptop Sleeve 14"', 'Accessories', 1499, 500, true, false, '{LAPTOP-PRO-14,LAPTOP-AIR-13}'),
('USB-C-HUB', '7-in-1 USB-C Hub', 'Accessories', 2999, 1300, true, false, '{LAPTOP-PRO-14,LAPTOP-AIR-13}'),
('MONITOR-27', '27" 4K Monitor', 'Displays', 24999, 17500, true, true, '{LAPTOP-PRO-14}'),
('HEADSET-ANC', 'ANC Wireless Headset', 'Audio', 8999, 4200, true, false, '{LAPTOP-PRO-14,LAPTOP-AIR-13}'),
('WEBCAM-1080', '1080p HD Webcam', 'Accessories', 4299, 2100, true, false, '{MONITOR-27}'),
('CABLE-USBC-2M', 'Braided USB-C Cable 2m', 'Accessories', 799, 220, true, false, '{USB-C-HUB,MOUSE-MX,KB-MECH-K8}');
