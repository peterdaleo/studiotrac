import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getStripe, STRIPE_PLANS, type StripePlanTier } from "./config";
import * as db from "../db";

// Re-export PlanTier alias for backward compat
export type PlanTier = StripePlanTier;

export const subscriptionRouter = router({
  // Get available plans (public info — no Stripe call needed)
  plans: protectedProcedure.query(() => {
    return Object.entries(STRIPE_PLANS).map(([key, plan]) => ({
      id: key as StripePlanTier,
      name: plan.name,
      amount: plan.amount,
      description: plan.description,
      features: plan.features,
      priceId: plan.priceId,
    }));
  }),

  // Get current organization's subscription (or trial status)
  current: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.organizationId) return null;

    // Super-admins have permanent, unlimited access — skip all trial/subscription logic
    if (ctx.user?.isSuperAdmin) {
      return {
        id: null as null,
        plan: "enterprise" as const,
        status: "active" as const,
        currentPeriodEnd: null as null,
        cancelAtPeriodEnd: false,
        canceledAt: null as null,
        trialStartedAt: null as null,
        trialExpiresAt: null as null,
        trialDaysLeft: null as null,
        isTrialActive: false,
        isTrialExpired: false,
      };
    }

    const org = await db.getOrganization(ctx.organizationId);
    const subscription = await db.getActiveSubscriptionByOrg(ctx.organizationId);

    // Compute trial status
    const TRIAL_DAYS = 14;
    const trialStartedAt = org?.trialStartedAt ?? null;
    const trialExpiresAt = trialStartedAt
      ? new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
      : null;
    const now = new Date();
    const trialDaysLeft = trialExpiresAt
      ? Math.max(0, Math.ceil((trialExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
    const isTrialActive = trialDaysLeft !== null && trialDaysLeft > 0;
    const isTrialExpired = trialExpiresAt !== null && now >= trialExpiresAt;

    if (!subscription) {
      // No paid subscription — return trial info only
      return {
        id: null as null,
        plan: null as null,
        status: isTrialActive ? ("trialing" as const) : ("expired" as const),
        currentPeriodEnd: null as null,
        cancelAtPeriodEnd: false,
        canceledAt: null as null,
        trialStartedAt: trialStartedAt?.toISOString() ?? null,
        trialExpiresAt: trialExpiresAt?.toISOString() ?? null,
        trialDaysLeft,
        isTrialActive,
        isTrialExpired,
      };
    }

    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
      trialStartedAt: trialStartedAt?.toISOString() ?? null,
      trialExpiresAt: trialExpiresAt?.toISOString() ?? null,
      trialDaysLeft,
      isTrialActive: false, // paid subscription supersedes trial
      isTrialExpired: false,
    };
  }),

  // Create a Stripe Checkout session (admin only — billing is org-level)
  createCheckout: adminProcedure
    .input(z.object({ plan: z.enum(["starter", "professional"]) }))
    .mutation(async ({ input, ctx }) => {
      const stripe = getStripe();
      const planConfig = STRIPE_PLANS[input.plan];
      if (!planConfig.priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This plan does not support self-serve checkout" });
      }

      if (!ctx.organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You must belong to an organization to subscribe" });
      }

      // Check if org already has an active subscription
      const existing = await db.getActiveSubscriptionByOrg(ctx.organizationId);
      if (existing && existing.status === "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your organization already has an active subscription. Please manage it from the billing page." });
      }

      // Get or create Stripe customer at the org level
      const org = await db.getOrganization(ctx.organizationId);
      let customerId = org?.stripeCustomerId ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user.email ?? undefined,
          name: org?.name ?? (ctx.user.name as string) ?? undefined,
          metadata: { organizationId: ctx.organizationId.toString() },
        });
        customerId = customer.id;
        await db.updateOrganizationStripeCustomerId(ctx.organizationId, customerId);
      }

      const origin = process.env.APP_URL || "https://studiotrac-production.up.railway.app";

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: planConfig.priceId, quantity: 1 }],
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=canceled`,
        metadata: { organizationId: ctx.organizationId.toString(), plan: input.plan },
        subscription_data: {
          metadata: { organizationId: ctx.organizationId.toString(), plan: input.plan },
        },
      });

      return { url: session.url };
    }),

  // Create a Stripe Customer Portal session (for managing subscription)
  createPortalSession: adminProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!ctx.organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization found" });
    }
    const org = await db.getOrganization(ctx.organizationId);
    const customerId = org?.stripeCustomerId ?? null;
    if (!customerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No billing account found. Please subscribe to a plan first." });
    }

    const origin = process.env.APP_URL || "https://studiotrac-production.up.railway.app";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/billing`,
    });

    return { url: session.url };
  }),

  // Cancel subscription (at period end)
  cancel: adminProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!ctx.organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization found" });
    }
    const subscription = await db.getActiveSubscriptionByOrg(ctx.organizationId);
    if (!subscription) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active subscription found" });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db.updateSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);

    return { success: true };
  }),

  // Resume a canceled subscription (undo cancel_at_period_end)
  resume: adminProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!ctx.organizationId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization found" });
    }
    const subscription = await db.getActiveSubscriptionByOrg(ctx.organizationId);
    if (!subscription) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active subscription found" });
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Subscription is not scheduled for cancellation" });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db.updateSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, false);

    return { success: true };
  }),

  // Change plan (upgrade/downgrade)
  changePlan: adminProcedure
    .input(z.object({ plan: z.enum(["starter", "professional"]) }))
    .mutation(async ({ input, ctx }) => {
      const stripe = getStripe();
      if (!ctx.organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No organization found" });
      }
      const subscription = await db.getActiveSubscriptionByOrg(ctx.organizationId);
      if (!subscription) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active subscription found" });
      }

      if (subscription.plan === input.plan) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You are already on this plan" });
      }

      const newPlanConfig = STRIPE_PLANS[input.plan];
      if (!newPlanConfig.priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This plan does not support self-serve checkout" });
      }

      // Get the subscription from Stripe to find the item ID
      const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      const itemId = stripeSubscription.items.data[0]?.id;

      if (!itemId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not find subscription item" });
      }

      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{ id: itemId, price: newPlanConfig.priceId }],
        proration_behavior: "create_prorations",
        metadata: { plan: input.plan },
      });

      // Update local DB immediately (webhook will also fire)
      await db.updateSubscriptionPlan(subscription.stripeSubscriptionId, input.plan, newPlanConfig.priceId);

      return { success: true };
    }),
});
