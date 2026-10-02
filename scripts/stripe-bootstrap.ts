/**
 * scripts/stripe-bootstrap.ts
 *
 * One-shot script to create Stripe products, prices, and the founders coupon
 * for moduo in test mode. Run once; re-run is idempotent (looks up existing by
 * metadata before creating).
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... bun run scripts/stripe-bootstrap.ts
 *
 * After running, copy the printed price IDs into:
 *   - .env.local  (PUBLIC_STRIPE_PRICE_* vars)
 *   - moduo_landing/.env.local  (NEXT_PUBLIC_STRIPE_PRICE_* vars)
 *   - Supabase Edge Function Secrets (STRIPE_PRICE_PRO_MONTHLY etc.)
 */

import Stripe from "stripe";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
if (!SECRET_KEY.startsWith("sk_")) {
  console.error("STRIPE_SECRET_KEY is not set or invalid. Set it and re-run.");
  process.exit(1);
}

const stripe = new Stripe(SECRET_KEY, { apiVersion: "2023-10-16" });

type PriceRow = {
  envKey: string;
  nickname: string;
  productName: string;
  planTier: "pro" | "team";
  billingCycle: "monthly" | "yearly";
  unitAmount: number;
  currency: string;
  interval: "month" | "year";
  intervalCount: number;
};

const PRICES: PriceRow[] = [
  {
    envKey: "PUBLIC_STRIPE_PRICE_PRO_MONTHLY",
    nickname: "Pro Monthly",
    productName: "moduo Pro",
    planTier: "pro",
    billingCycle: "monthly",
    unitAmount: 1000,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
  },
  {
    envKey: "PUBLIC_STRIPE_PRICE_PRO_YEARLY",
    nickname: "Pro Yearly",
    productName: "moduo Pro",
    planTier: "pro",
    billingCycle: "yearly",
    unitAmount: 9600,
    currency: "usd",
    interval: "year",
    intervalCount: 1,
  },
  {
    envKey: "PUBLIC_STRIPE_PRICE_TEAM_MONTHLY",
    nickname: "Team Monthly (per seat)",
    productName: "moduo Team",
    planTier: "team",
    billingCycle: "monthly",
    unitAmount: 900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
  },
  {
    envKey: "PUBLIC_STRIPE_PRICE_TEAM_YEARLY",
    nickname: "Team Yearly (per seat)",
    productName: "moduo Team",
    planTier: "team",
    billingCycle: "yearly",
    unitAmount: 8400,
    currency: "usd",
    interval: "year",
    intervalCount: 1,
  },
];

async function getOrCreateProduct(name: string, planTier: string): Promise<string> {
  const existing = await stripe.products.search({
    query: `metadata["plan_tier"]:"${planTier}" AND active:"true"`,
  });
  if (existing.data.length > 0) {
    const prod = existing.data.find((p) => p.name === name);
    if (prod) {
      console.log(`  Reusing product: ${prod.id} (${prod.name})`);
      return prod.id;
    }
  }
  const product = await stripe.products.create({
    name,
    metadata: { plan_tier: planTier },
  });
  console.log(`  Created product: ${product.id} (${product.name})`);
  return product.id;
}

async function getOrCreatePrice(row: PriceRow, productId: string): Promise<string> {
  const existing = await stripe.prices.search({
    query: `product:"${productId}" AND metadata["billing_cycle"]:"${row.billingCycle}" AND active:"true"`,
  });
  if (existing.data.length > 0) {
    const price = existing.data[0];
    console.log(`  Reusing price: ${price.id} (${row.nickname})`);
    return price.id;
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: row.currency,
    unit_amount: row.unitAmount,
    recurring: {
      interval: row.interval,
      interval_count: row.intervalCount,
    },
    nickname: row.nickname,
    metadata: {
      plan_tier: row.planTier,
      billing_cycle: row.billingCycle,
    },
  });
  console.log(`  Created price: ${price.id} (${row.nickname})`);
  return price.id;
}

async function getOrCreateFoundersCoupon(): Promise<string> {
  const coupons = await stripe.coupons.list({ limit: 100 });
  const existing = coupons.data.find((c) => c.metadata?.purpose === "founders" && c.valid);
  if (existing) {
    console.log(`  Reusing founders coupon: ${existing.id}`);
    return existing.id;
  }
  const coupon = await stripe.coupons.create({
    percent_off: 100,
    duration: "repeating",
    duration_in_months: 3,
    name: "moduo Early Founders — 3 months free",
    max_redemptions: 50,
    metadata: { purpose: "founders", plan_tier: "founder" },
  });
  console.log(`  Created founders coupon: ${coupon.id}`);
  return coupon.id;
}

async function main() {
  console.log("\n=== moduo Stripe Bootstrap ===\n");

  const results: Record<string, string> = {};
  const productCache: Record<string, string> = {};

  for (const row of PRICES) {
    console.log(`Processing: ${row.nickname}`);
    if (!productCache[row.productName]) {
      productCache[row.productName] = await getOrCreateProduct(row.productName, row.planTier);
    }
    const priceId = await getOrCreatePrice(row, productCache[row.productName]);
    results[row.envKey] = priceId;
  }

  console.log("\nProcessing: Founders coupon");
  const foundersCouponId = await getOrCreateFoundersCoupon();

  console.log("\n=== Copy these into your .env files ===\n");
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }
  console.log(`STRIPE_COUPON_FOUNDERS=${foundersCouponId}`);

  console.log("\n=== Supabase Edge Function Secrets ===\n");
  console.log("Run these in your terminal (replace STRIPE_SECRET_KEY with your actual key):");
  console.log(`supabase secrets set STRIPE_SECRET_KEY=sk_test_...`);
  console.log(`supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`);
  for (const [key, value] of Object.entries(results)) {
    const serverKey = key.replace("PUBLIC_", "").replace("STRIPE_PRICE_", "STRIPE_PRICE_");
    console.log(`supabase secrets set ${serverKey}=${value}`);
  }
  console.log(`supabase secrets set STRIPE_PRICE_FOUNDERS=${foundersCouponId}`);
  console.log(`supabase secrets set RESEND_API_KEY=re_...`);
  console.log(`supabase secrets set FOUNDERS_NOTIFY_EMAIL=founders@moduo.app`);

  console.log("\n=== moduo_landing .env.local vars ===\n");
  for (const [key, value] of Object.entries(results)) {
    const landingKey = key.replace("PUBLIC_", "NEXT_PUBLIC_");
    console.log(`${landingKey}=${value}`);
  }
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
