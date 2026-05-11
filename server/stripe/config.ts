import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("[Stripe] STRIPE_SECRET_KEY not set — Stripe features will be unavailable");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

export const STRIPE_PLANS = {
  starter: {
    productId: "prod_UV1zrUqANL4aa0",
    priceId: "price_1TW1vg3NHNDtNb2AwOGH7cUT",
    name: "Starter",
    amount: 5900,
    description: "Perfect for small architecture studios getting started with project management.",
    features: [
      "Up to 10 active projects",
      "Up to 5 team members",
      "Basic time tracking",
      "Client portal",
      "Email notifications",
    ],
  },
  professional: {
    productId: "prod_UV1zZe5sMQGnfZ",
    priceId: "price_1TW1vh3NHNDtNb2A4P2mNPDg",
    name: "Professional",
    amount: 17900,
    description: "For growing firms that need advanced features and team collaboration.",
    features: [
      "Unlimited active projects",
      "Unlimited team members",
      "Advanced time tracking & reports",
      "Client portal with file sharing",
      "Financial dashboards",
      "Consultant management",
      "Priority support",
    ],
  },
  enterprise: {
    productId: "prod_UV1zSHVJXZnuNE",
    priceId: null,
    name: "Enterprise",
    amount: null,
    description: "Custom solutions for large architecture firms with dedicated support.",
    features: [
      "Everything in Professional",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantees",
      "On-premise deployment option",
      "Custom training & onboarding",
    ],
  },
} as const;

export type PlanTier = keyof typeof STRIPE_PLANS;

export function getPlanFromPriceId(priceId: string): PlanTier | null {
  for (const [plan, config] of Object.entries(STRIPE_PLANS)) {
    if (config.priceId === priceId) return plan as PlanTier;
  }
  return null;
}
