import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    orgHasSuperAdminOwner: vi.fn(),
    getOrganization: vi.fn(),
    getActiveSubscriptionByOrg: vi.fn(),
    updateOrganizationStripeCustomerId: vi.fn(),
    updateSubscriptionCancelAtPeriodEnd: vi.fn(),
    updateSubscriptionPlan: vi.fn(),
  };
  const stripe = {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn(), update: vi.fn() },
  };
  const getStripe = vi.fn(() => stripe);
  return { db, stripe, getStripe };
});

vi.mock("./db", () => mocks.db);
vi.mock("./stripe/config", () => ({
  getStripe: mocks.getStripe,
  STRIPE_PLANS: {
    starter: { name: "Starter", amount: 1000, description: "Starter", features: [], priceId: "price_starter" },
    professional: { name: "Professional", amount: 2000, description: "Professional", features: [], priceId: "price_professional" },
    enterprise: { name: "Enterprise", amount: 0, description: "Enterprise", features: [], priceId: null },
  },
}));

import { subscriptionRouter } from "./stripe/router";

const organizationId = 17;
const paidSubscription = {
  id: 91,
  plan: "starter" as const,
  status: "active" as const,
  stripeSubscriptionId: "sub_test",
  currentPeriodEnd: new Date("2030-02-03T00:00:00.000Z"),
  cancelAtPeriodEnd: true,
  canceledAt: null,
};

function caller(user: Record<string, unknown> | null, contextOrganizationId = organizationId) {
  return subscriptionRouter.createCaller({
    req: {} as any,
    res: {} as any,
    user: user as any,
    organizationId: contextOrganizationId,
  });
}

const calls = (c: ReturnType<typeof caller>) => [
  () => c.createCheckout({ plan: "starter" }),
  () => c.createPortalSession(),
  () => c.cancel(),
  () => c.resume(),
  () => c.changePlan({ plan: "professional" }),
];

function expectNoExternalOrDatabaseCalls() {
  for (const fn of Object.values(mocks.db)) expect(fn).not.toHaveBeenCalled();
  expect(mocks.getStripe).not.toHaveBeenCalled();
  for (const fn of [
    mocks.stripe.customers.create,
    mocks.stripe.checkout.sessions.create,
    mocks.stripe.billingPortal.sessions.create,
    mocks.stripe.subscriptions.retrieve,
    mocks.stripe.subscriptions.update,
  ]) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.orgHasSuperAdminOwner.mockResolvedValue(false);
  mocks.db.getOrganization.mockResolvedValue({ name: "Test firm", stripeCustomerId: "cus_test", trialStartedAt: null });
  mocks.db.getActiveSubscriptionByOrg.mockResolvedValue(paidSubscription);
  mocks.db.updateOrganizationStripeCustomerId.mockResolvedValue(undefined);
  mocks.db.updateSubscriptionCancelAtPeriodEnd.mockResolvedValue(undefined);
  mocks.db.updateSubscriptionPlan.mockResolvedValue(undefined);
  mocks.stripe.customers.create.mockResolvedValue({ id: "cus_test" });
  mocks.stripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.test/session" });
  mocks.stripe.billingPortal.sessions.create.mockResolvedValue({ url: "https://portal.test/session" });
  mocks.stripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [{ id: "si_test" }] } });
  mocks.stripe.subscriptions.update.mockResolvedValue({});
});

describe("subscription billing authorization", () => {
  const nonOwners = [
    ["application admin", { id: 1, role: "admin", orgRole: "member", organizationId }],
    ["organization admin", { id: 2, role: "user", orgRole: "admin", organizationId }],
    ["member", { id: 3, role: "user", orgRole: "member", organizationId }],
    ["project manager", { id: 4, role: "pm", orgRole: "member", organizationId }],
    ["ordinary user", { id: 5, role: "user", orgRole: "member", organizationId }],
    ["missing orgRole", { id: 6, role: "admin", organizationId }],
    ["super-admin who is not organization owner", { id: 7, role: "admin", orgRole: "admin", isSuperAdmin: true, organizationId }],
  ] as const;

  it.each(nonOwners)("rejects every mutation for a non-owner (%s) before DB or Stripe calls", async (_label, user) => {
    const c = caller(user as unknown as Record<string, unknown>);
    for (const invoke of calls(c)) {
      await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expectNoExternalOrDatabaseCalls();
  });

  it("rejects anonymous callers and organization-less users", async () => {
    for (const invoke of calls(caller(null))) {
      await expect(invoke()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    for (const invoke of calls(caller({ id: 8, role: "admin", orgRole: "owner", organizationId: null }, null))) {
      await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expectNoExternalOrDatabaseCalls();
  });

  it.each([
    ["createCheckout", (c: ReturnType<typeof caller>) => c.createCheckout({ plan: "starter" }), "checkout"],
    ["createPortalSession", (c: ReturnType<typeof caller>) => c.createPortalSession(), "portal"],
    ["cancel", (c: ReturnType<typeof caller>) => c.cancel(), "cancel"],
    ["resume", (c: ReturnType<typeof caller>) => c.resume(), "resume"],
    ["changePlan", (c: ReturnType<typeof caller>) => c.changePlan({ plan: "professional" }), "change"],
  ])("allows the organization owner to perform %s", async (_name, invoke, scenario) => {
    const c = caller({ id: 9, role: "user", orgRole: "owner", organizationId });
    if (scenario === "checkout") mocks.db.getActiveSubscriptionByOrg.mockResolvedValueOnce(null);
    if (scenario === "cancel") mocks.db.getActiveSubscriptionByOrg.mockResolvedValueOnce({ ...paidSubscription, cancelAtPeriodEnd: false });
    await expect(invoke(c)).resolves.toBeDefined();
    expect(mocks.getStripe).toHaveBeenCalledOnce();
    if (scenario === "checkout") {
      expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledOnce();
    } else if (scenario === "portal") {
      expect(mocks.stripe.billingPortal.sessions.create).toHaveBeenCalledOnce();
    } else if (scenario === "cancel" || scenario === "resume") {
      expect(mocks.stripe.subscriptions.update).toHaveBeenCalledOnce();
      expect(mocks.db.updateSubscriptionCancelAtPeriodEnd).toHaveBeenCalledOnce();
    } else {
      expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledOnce();
      expect(mocks.stripe.subscriptions.update).toHaveBeenCalledOnce();
      expect(mocks.db.updateSubscriptionPlan).toHaveBeenCalledOnce();
    }
  });

  it("keeps plans readable to authenticated members", async () => {
    const plans = await caller({ id: 10, role: "user", orgRole: "member", organizationId }).plans();
    expect(plans.map(({ id }) => id)).toEqual(["starter", "professional", "enterprise"]);
    expectNoExternalOrDatabaseCalls();
  });

  it.each(["owner", "member"] as const)("labels super-admin-owned organization access for %s as platform_owner", async (orgRole) => {
    mocks.db.orgHasSuperAdminOwner.mockResolvedValue(true);
    const current = await caller({ id: 11, role: "user", orgRole, organizationId }).current();
    expect(current).toMatchObject({ plan: "enterprise", status: "active", accessSource: "platform_owner" });
    expect(mocks.db.orgHasSuperAdminOwner).toHaveBeenCalledWith(organizationId);
    expect(mocks.db.getOrganization).not.toHaveBeenCalled();
    expect(mocks.db.getActiveSubscriptionByOrg).not.toHaveBeenCalled();
  });

  it("labels direct super-admin override as platform_owner", async () => {
    const current = await caller({ id: 12, role: "admin", orgRole: "member", isSuperAdmin: true, organizationId }).current();
    expect(current).toMatchObject({ plan: "enterprise", status: "active", accessSource: "platform_owner" });
    expectNoExternalOrDatabaseCalls();
  });

  it("preserves paid subscription details and labels subscription access", async () => {
    const current = await caller({ id: 13, role: "user", orgRole: "member", organizationId }).current();
    expect(current).toMatchObject({
      id: paidSubscription.id,
      plan: "starter",
      status: "active",
      currentPeriodEnd: paidSubscription.currentPeriodEnd,
      cancelAtPeriodEnd: true,
      canceledAt: null,
      isTrialActive: false,
      isTrialExpired: false,
      accessSource: "subscription",
    });
  });

  it("labels a no-subscription trial as trial", async () => {
    mocks.db.getActiveSubscriptionByOrg.mockResolvedValue(null);
    mocks.db.getOrganization.mockResolvedValue({ trialStartedAt: new Date() });
    const current = await caller({ id: 14, role: "user", orgRole: "member", organizationId }).current();
    expect(current).toMatchObject({ status: "trialing", isTrialActive: true, accessSource: "trial" });
  });
});
