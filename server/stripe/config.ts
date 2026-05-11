import Stripe from "stripe";

// Lazy singleton — only instantiated on first use so a missing key never
// crashes the server at startup.  Every function that needs the client
// should call getStripe() and handle the null case gracefully.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "[Stripe] STRIPE_SECRET_KEY is not set. " +
        "Add it to your Railway environment variables to enable billing features."
    );
  }

  _stripe = new Stripe(key);
  return _stripe;
}

/**
 * Returns the Stripe client if the secret key is configured, otherwise null.
 * Use this in places where Stripe is optional (e.g. health checks, plan listing).
 */
export function getStripeOrNull(): Stripe | null {
  try {
    return getStripe();
  } catch {
    return null;
  }
}

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

export type StripePlanTier = keyof typeof STRIPE_PLANS;

export function getPlanFromPriceId(priceId: string): StripePlanTier | null {
  for (const [plan, config] of Object.entries(STRIPE_PLANS)) {
    if (config.priceId === priceId) return plan as StripePlanTier;
  }
  return null;
}

// Keep backward-compat named export used by router/webhooks
export { getStripe as stripe };
