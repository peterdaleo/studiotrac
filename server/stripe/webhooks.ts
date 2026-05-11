import type { Request, Response } from "express";
import Stripe from "stripe";
import { stripe, getPlanFromPriceId } from "./config";
import * as db from "../db";

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("[Stripe Webhook] Missing signature or webhook secret");
    return res.status(400).json({ error: "Missing signature or webhook secret" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCreatedOrUpdated(subscription);
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCreatedOrUpdated(subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[Stripe Webhook] Error handling ${event.type}:`, err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }

  return res.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;

  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("[Stripe Webhook] No userId in checkout session metadata");
    return;
  }

  // Update user's stripe customer ID
  await db.updateUserStripeCustomerId(parseInt(userId), session.customer as string);
  console.log(`[Stripe Webhook] Checkout completed for user ${userId}`);
}

async function handleSubscriptionCreatedOrUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const user = await db.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.error(`[Stripe Webhook] No user found for customer ${customerId}`);
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const plan = priceId ? getPlanFromPriceId(priceId) : null;

  if (!plan) {
    console.error(`[Stripe Webhook] Unknown price ID: ${priceId}`);
    return;
  }

  const status = mapStripeStatus(subscription.status);

  // In Stripe v22 (dahlia), current_period is on the subscription item
  const currentPeriodStart = item?.current_period_start
    ? new Date(item.current_period_start * 1000)
    : null;
  const currentPeriodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  await db.upsertSubscription({
    userId: user.id,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    stripePriceId: priceId!,
    plan,
    status,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
  });

  console.log(`[Stripe Webhook] Subscription ${subscription.id} ${subscription.status} for user ${user.id} (${plan})`);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const user = await db.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.error(`[Stripe Webhook] No user found for customer ${customerId}`);
    return;
  }

  await db.updateSubscriptionStatus(subscription.id, "canceled");
  console.log(`[Stripe Webhook] Subscription ${subscription.id} canceled for user ${user.id}`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const user = await db.getUserByStripeCustomerId(customerId);
  if (!user) {
    console.error(`[Stripe Webhook] No user found for customer ${customerId}`);
    return;
  }

  // In Stripe v22, subscription is accessed via parent.subscription_details
  const subscriptionId = (invoice.parent?.subscription_details?.subscription as string) ?? null;
  if (subscriptionId) {
    await db.updateSubscriptionStatus(subscriptionId, "past_due");
  }

  console.log(`[Stripe Webhook] Payment failed for user ${user.id}, subscription ${subscriptionId}`);
}

function mapStripeStatus(status: Stripe.Subscription.Status): "active" | "canceled" | "past_due" | "incomplete" | "trialing" | "unpaid" {
  switch (status) {
    case "active": return "active";
    case "canceled": return "canceled";
    case "past_due": return "past_due";
    case "incomplete": return "incomplete";
    case "trialing": return "trialing";
    case "unpaid": return "unpaid";
    case "incomplete_expired": return "canceled";
    case "paused": return "canceled";
    default: return "incomplete";
  }
}
