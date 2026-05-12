import { router, superAdminProcedure } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { organizations, users, subscriptions, teamMembers } from "../../drizzle/schema";
import { eq, count, sql, and, isNotNull } from "drizzle-orm";
import { getStripe, STRIPE_PLANS } from "../stripe/config";

export const superAdminRouter = router({
  // ── Platform Metrics ─────────────────────────────────────────────
  metrics: superAdminProcedure.query(async () => {
    const db = getDb();

    const [orgCount] = await db.select({ count: count() }).from(organizations);
    const [userCount] = await db.select({ count: count() }).from(users);
    const [activeSubCount] = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"));

    // Calculate MRR from active subscriptions
    const activeSubs = await db
      .select({
        priceId: subscriptions.stripePriceId,
        status: subscriptions.status,
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"));

    let mrr = 0;
    for (const sub of activeSubs) {
      if (sub.priceId === STRIPE_PLANS.starter.priceId) mrr += 59;
      else if (sub.priceId === STRIPE_PLANS.professional.priceId) mrr += 179;
      // Enterprise is custom, skip
    }

    return {
      totalFirms: orgCount.count,
      totalUsers: userCount.count,
      activeSubscriptions: activeSubCount.count,
      mrr,
    };
  }),

  // ── List All Firms ───────────────────────────────────────────────
  firms: superAdminProcedure.query(async () => {
    const db = getDb();

    const firms = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        createdAt: organizations.createdAt,
        stripeCustomerId: organizations.stripeCustomerId,
        onboardingCompleted: organizations.onboardingCompleted,
      })
      .from(organizations)
      .orderBy(organizations.createdAt);

    // Get user counts per org
    const userCounts = await db
      .select({
        organizationId: users.organizationId,
        count: count(),
      })
      .from(users)
      .where(isNotNull(users.organizationId))
      .groupBy(users.organizationId);

    const userCountMap = new Map(
      userCounts.map((uc) => [uc.organizationId, uc.count])
    );

    // Get subscription info per org
    const allSubs = await db
      .select({
        organizationId: subscriptions.organizationId,
        status: subscriptions.status,
        stripePriceId: subscriptions.stripePriceId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions);

    const subMap = new Map<number, typeof allSubs[0]>();
    for (const sub of allSubs) {
      if (sub.organizationId) {
        // Prefer active subscription
        const existing = subMap.get(sub.organizationId);
        if (!existing || sub.status === "active") {
          subMap.set(sub.organizationId, sub);
        }
      }
    }

    // Get last active date (most recent user login) per org
    const lastActiveData = await db
      .select({
        organizationId: users.organizationId,
        lastActive: sql<Date>`MAX(${users.lastSignedIn})`,
      })
      .from(users)
      .where(isNotNull(users.organizationId))
      .groupBy(users.organizationId);

    const lastActiveMap = new Map(
      lastActiveData.map((la) => [la.organizationId, la.lastActive])
    );

    return firms.map((firm) => {
      const sub = subMap.get(firm.id);
      let planTier: string = "none";
      if (sub?.stripePriceId === STRIPE_PLANS.starter.priceId) planTier = "Starter";
      else if (sub?.stripePriceId === STRIPE_PLANS.professional.priceId) planTier = "Professional";
      else if (sub?.stripePriceId) planTier = "Enterprise";

      return {
        id: firm.id,
        name: firm.name,
        slug: firm.slug,
        createdAt: firm.createdAt,
        userCount: userCountMap.get(firm.id) ?? 0,
        subscriptionStatus: sub?.status ?? "none",
        planTier,
        lastActive: lastActiveMap.get(firm.id) ?? firm.createdAt,
      };
    });
  }),

  // ── Firm Detail ──────────────────────────────────────────────────
  firmDetail: superAdminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();

      const [firm] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, input.id));

      if (!firm) return null;

      const firmUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          orgRole: users.orgRole,
          lastSignedIn: users.lastSignedIn,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.organizationId, input.id));

      const firmMembers = await db
        .select({ count: count() })
        .from(teamMembers)
        .where(eq(teamMembers.organizationId, input.id));

      return {
        ...firm,
        users: firmUsers,
        teamMemberCount: firmMembers[0]?.count ?? 0,
      };
    }),

  // ── Cancel a Firm's Subscription ─────────────────────────────────
  cancelSubscription: superAdminProcedure
    .input(z.object({ organizationId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.organizationId, input.organizationId),
            eq(subscriptions.status, "active")
          )
        );

      if (!sub) {
        return { success: false, message: "No active subscription found" };
      }

      try {
        const stripe = getStripe();
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        return { success: true, message: "Subscription will cancel at period end" };
      } catch (err: any) {
        return { success: false, message: err.message ?? "Failed to cancel" };
      }
    }),
});
