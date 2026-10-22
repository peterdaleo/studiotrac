import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as any,
  isStaffPreview: false,
  queryCalls: [] as string[],
  mutationCalls: [] as string[],
  queryResults: {} as Record<string, any>,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user }),
}));

vi.mock("@/contexts/StaffPreviewContext", () => ({
  useStaffPreview: () => ({ isStaffPreview: state.isStaffPreview }),
  useEffectiveRole: (role?: string) => state.isStaffPreview && role === "admin" ? "user" : role,
  useEffectiveAdmin: (role?: string) => !state.isStaffPreview && role === "admin",
}));

vi.mock("@/lib/trpc", () => {
  const query = (name: string) => ({
    useQuery: () => {
      state.queryCalls.push(name);
      return state.queryResults[name];
    },
  });
  const mutation = (name: string) => ({
    useMutation: () => {
      state.mutationCalls.push(name);
      return { mutate: vi.fn(), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({ subscription: { current: { invalidate: vi.fn() } } }),
      subscription: {
        plans: query("plans"),
        current: query("current"),
        createCheckout: mutation("createCheckout"),
        cancel: mutation("cancel"),
        resume: mutation("resume"),
        changePlan: mutation("changePlan"),
        createPortalSession: mutation("createPortalSession"),
      },
    },
  };
});

import Billing from "@/pages/Billing";
import { shouldShowBillingNavigation } from "@/components/DashboardLayout";

const plans = [
  { id: "starter", name: "Starter", amount: 1900, description: "For small teams", features: ["Projects"] },
  { id: "professional", name: "Professional", amount: 4900, description: "For growing teams", features: ["More projects"] },
  { id: "enterprise", name: "Enterprise", amount: null, description: "For large teams", features: ["Custom limits"] },
];

function renderBilling() {
  return renderToStaticMarkup(React.createElement(Billing));
}

function makeOwner() {
  return { id: 11, role: "user", orgRole: "owner", organizationId: 42, isSuperAdmin: false };
}

function setQueryResults(current: any) {
  state.queryResults = {
    plans: { data: plans, isLoading: false },
    current: { data: current, isLoading: false },
  };
}

beforeEach(() => {
  state.user = makeOwner();
  state.isStaffPreview = false;
  state.queryCalls = [];
  state.mutationCalls = [];
  setQueryResults(null);
});

describe("Billing page owner gate", () => {
  it.each([
    ["app admin", { role: "admin", orgRole: "member", isSuperAdmin: false }],
    ["project manager", { role: "pm", orgRole: "pm", isSuperAdmin: false }],
    ["member", { role: "user", orgRole: "member", isSuperAdmin: false }],
    ["superadmin without org ownership", { role: "admin", orgRole: "member", isSuperAdmin: true }],
  ])("blocks %s before issuing billing queries", (_label, details) => {
    state.user = { id: 7, organizationId: 42, ...details };

    const html = renderBilling();

    expect(html).toContain("Access denied");
    expect(html).not.toContain("Billing &amp; Subscription");
    expect(state.queryCalls).toEqual([]);
    expect(state.mutationCalls).toEqual([]);
  });

  it("blocks the organization owner while staff preview is active", () => {
    state.isStaffPreview = true;
    const html = renderBilling();

    expect(html).toContain("Access denied");
    expect(state.queryCalls).toEqual([]);
  });

  it("shows platform-owner access without any subscription or plan controls", () => {
    setQueryResults({
      id: null,
      plan: "enterprise",
      status: "active",
      cancelAtPeriodEnd: false,
      accessSource: "platform_owner",
    });

    const html = renderBilling();

    expect(html).toContain("Platform-owner access—no paid subscription");
    expect(html).not.toContain("Manage Billing");
    expect(html).not.toContain("Cancel Subscription");
    expect(html).not.toContain("Resume Subscription");
    expect(html).not.toContain("Upgrade");
    expect(html).not.toContain("Subscribe");
    expect(html).not.toContain("Enterprise");
  });

  it("retains manage, cancel, and plan-change controls for a paid owner", () => {
    setQueryResults({
      id: 123,
      plan: "starter",
      status: "active",
      cancelAtPeriodEnd: false,
      accessSource: "subscription",
    });

    const html = renderBilling();

    expect(html).toContain("Manage Billing");
    expect(html).toContain("Cancel Subscription");
    expect(html).toContain("Upgrade");
  });

  it("retains the resume control for a paid subscription scheduled to cancel", () => {
    setQueryResults({
      id: 123,
      plan: "professional",
      status: "active",
      cancelAtPeriodEnd: true,
      accessSource: "subscription",
    });

    const html = renderBilling();

    expect(html).toContain("Manage Billing");
    expect(html).toContain("Resume Subscription");
    expect(html).not.toContain("Cancel Subscription");
  });

  it("keeps trial plan choices but hides manage and cancel for a null-id trial", () => {
    setQueryResults({
      id: null,
      plan: null,
      status: "trialing",
      cancelAtPeriodEnd: false,
      accessSource: "trial",
    });

    const html = renderBilling();

    expect(html).toContain("Change Plan");
    expect(html).toContain("Subscribe");
    expect(html).not.toContain("Manage Billing");
    expect(html).not.toContain("Cancel Subscription");
    expect(html).not.toContain("Resume Subscription");
  });
});

describe("Billing sidebar policy", () => {
  it("shows Billing only to an organization owner with a valid organization ID, outside staff preview", () => {
    expect(shouldShowBillingNavigation(makeOwner(), false)).toBe(true);
    expect(shouldShowBillingNavigation(makeOwner(), true)).toBe(false);
    expect(shouldShowBillingNavigation({ role: "admin", orgRole: "member", organizationId: 42 }, false)).toBe(false);
    expect(shouldShowBillingNavigation({ orgRole: "owner", organizationId: 0 }, false)).toBe(false);
    expect(shouldShowBillingNavigation({ orgRole: "owner", organizationId: null }, false)).toBe(false);
  });
});
