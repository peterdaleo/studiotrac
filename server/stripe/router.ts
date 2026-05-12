import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
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

  // Get current user's subscription
  current: protectedProcedure.query(async ({ ctx }) => {
    const subscription = await db.getActiveSubscription(ctx.user.id);
    if (!subscription) return null;
    return {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
    };
  }),

  // Create a Stripe Checkout session
  createCheckout: protectedProcedure
    .input(z.object({ plan: z.enum(["starter", "professional"]) }))
    .mutation(async ({ input, ctx }) => {
      const stripe = getStripe();
      const planConfig = STRIPE_PLANS[input.plan];
      if (!planConfig.priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This plan does not support self-serve checkout" });
      }

      // Check if user already has an active subscription
      const existing = await db.getActiveSubscription(ctx.user.id);
      if (existing && existing.status === "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have an active subscription. Please manage it from the billing page." });
      }

      // Get or create Stripe customer — fetch stripeCustomerId via raw SQL
      let customerId = await db.getUserStripeCustomerId(ctx.user.id);
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user.email ?? undefined,
          name: (ctx.user.name as string) ?? undefined,
          metadata: { userId: ctx.user.id.toString() },
        });
        customerId = customer.id;
        await db.updateUserStripeCustomerId(ctx.user.id, customerId);
      }

      const origin = process.env.APP_URL || "https://studiotrac-production.up.railway.app";

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: planConfig.priceId, quantity: 1 }],
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=canceled`,
        metadata: { userId: ctx.user.id.toString(), plan: input.plan },
        subscription_data: {
          metadata: { userId: ctx.user.id.toString(), plan: input.plan },
        },
      });

      return { url: session.url };
    }),

  // Create a Stripe Customer Portal session (for managing subscription)
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const customerId = await db.getUserStripeCustomerId(ctx.user.id);
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
  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const subscription = await db.getActiveSubscription(ctx.user.id);
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
  resume: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    const subscription = await db.getActiveSubscription(ctx.user.id);
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
  changePlan: protectedProcedure
    .input(z.object({ plan: z.enum(["starter", "professional"]) }))
    .mutation(async ({ input, ctx }) => {
      const stripe = getStripe();
      const subscription = await db.getActiveSubscription(ctx.user.id);
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
