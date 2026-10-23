import { formatAccessAuditDetails } from "@shared/workspaceAudit";
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
      return state.queryResults[name] ?? { data: undefined, isLoading: false };
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
      useUtils: () => ({
        subscription: { current: { invalidate: vi.fn() } },
        superAdmin: { firms: { invalidate: vi.fn() }, metrics: { invalidate: vi.fn() } },
        platformAccess: { overview: { invalidate: vi.fn() }, audit: { invalidate: vi.fn() } },
      }),
      subscription: {
        plans: query("plans"),
        current: query("current"),
        createCheckout: mutation("createCheckout"),
        cancel: mutation("cancel"),
        resume: mutation("resume"),
        changePlan: mutation("changePlan"),
        createPortalSession: mutation("createPortalSession"),
      },
      superAdmin: {
        metrics: query("superAdmin.metrics"),
        firms: query("superAdmin.firms"),
        firmDetail: query("superAdmin.firmDetail"),
        cancelSubscription: mutation("superAdmin.cancelSubscription"),
      },
      platformAccess: {
        overview: query("platformAccess.overview"),
        audit: query("platformAccess.audit"),
        inviteFirmOwner: mutation("platformAccess.inviteFirmOwner"),
        grantWorkspaceAccess: mutation("platformAccess.grantWorkspaceAccess"),
        suspendWorkspace: mutation("platformAccess.suspendWorkspace"),
        reactivateWorkspace: mutation("platformAccess.reactivateWorkspace"),
        grantComplimentaryPlan: mutation("platformAccess.grantComplimentaryPlan"),
        revokeComplimentaryPlan: mutation("platformAccess.revokeComplimentaryPlan"),
        revokeFirmInvitation: mutation("platformAccess.revokeFirmInvitation"),
      },
    },
  };
});

import Billing from "@/pages/Billing";
import SuperAdmin from "@/pages/SuperAdmin";
import { FirmInviteAccessNotice } from "@/pages/Signup";
import { shouldShowBillingNavigation } from "@/components/DashboardLayout";
import { shouldRenderManagedWorkspace } from "@/components/WorkspaceAccessGate";

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

  it("shows complimentary access without Stripe purchase or cancellation controls", () => {
    setQueryResults({
      id: null,
      plan: null,
      status: "none",
      cancelAtPeriodEnd: false,
      accessSource: "complimentary",
      workspaceAccess: {
        managed: true,
        state: "active",
        allowed: true,
        reason: null,
        plan: "professional",
        complimentaryPlan: "professional",
      },
    });

    const html = renderBilling();

    expect(html).toContain("Complimentary access");
    expect(html).toContain("professional");
    expect(html).toContain("not a paid subscription");
    expect(html).not.toContain("Manage Billing");
    expect(html).not.toContain("Cancel Subscription");
    expect(html).not.toContain("Resume Subscription");
    expect(html).not.toContain("Subscribe");
    expect(html).not.toContain("Upgrade");
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

describe("managed workspace route gate policy", () => {
  const denied = { managed: true, state: "suspended" as const, allowed: false, reason: "suspended" as const };

  it("preserves behavior for legacy accounts and unmanaged workspaces", () => {
    expect(shouldRenderManagedWorkspace(undefined, "/projects", makeOwner())).toBe(true);
    expect(shouldRenderManagedWorkspace({ managed: false, allowed: false }, "/projects", makeOwner())).toBe(true);
  });

  it("blocks denied business pages but permits valid owner Billing recovery", () => {
    expect(shouldRenderManagedWorkspace(denied, "/projects", makeOwner())).toBe(false);
    expect(shouldRenderManagedWorkspace(denied, "/billing", makeOwner())).toBe(true);
    expect(shouldRenderManagedWorkspace(denied, "/billing", { orgRole: "owner", organizationId: null })).toBe(false);
    expect(shouldRenderManagedWorkspace(denied, "/billing", { orgRole: "member", organizationId: 42 })).toBe(false);
  });

  it("fails closed when a managed workspace has no explicit allowed decision", () => {
    expect(shouldRenderManagedWorkspace({ managed: true, state: "active" }, "/projects", makeOwner())).toBe(false);
  });

  it("allows the existing super-admin page but does not treat super-admin status as Billing ownership", () => {
    const nonOwnerSuperAdmin = { isSuperAdmin: true, orgRole: "member", organizationId: 42 };
    expect(shouldRenderManagedWorkspace(denied, "/admin/platform", nonOwnerSuperAdmin)).toBe(true);
    expect(shouldRenderManagedWorkspace(denied, "/billing", nonOwnerSuperAdmin)).toBe(false);
  });
});

describe("complimentary firm invitation presentation", () => {
  it("renders Starter as the default invite tier with all alternatives and explicit activation terms", () => {
    state.user = { ...makeOwner(), isSuperAdmin: true };

    const html = renderToStaticMarkup(React.createElement(SuperAdmin));

    expect(html).toContain('id="invite-complimentary-plan"');
    expect(html).toMatch(/<option value="starter" selected(?:="")?>Starter<\/option>/);
    expect(html).toContain('<option value="professional">Professional</option>');
    expect(html).toContain('<option value="enterprise">Enterprise</option>');
    expect(html).toContain("Invite with complimentary Starter access");
    expect(html).toContain("activates when the owner accepts");
    expect(html).toContain("no second access grant is needed");
    expect(html).toContain("not a trial");
    expect(html).toContain("will not trigger an automatic charge");
  });

  it("renders complimentary activation and no-charge copy for a selected signup tier", () => {
    const html = renderToStaticMarkup(React.createElement(FirmInviteAccessNotice, {
      firmName: "Example Studio",
      complimentaryPlan: "enterprise",
    }));

    expect(html).toContain("Complimentary Enterprise access");
    expect(html).toContain("activates when you accept this invitation");
    expect(html).toContain("no trial");
    expect(html).toContain("no automatic charge");
  });

  it("keeps legacy invitation signup copy pending approval without promising complimentary access", () => {
    const html = renderToStaticMarkup(React.createElement(FirmInviteAccessNotice, {
      firmName: "Legacy Studio",
      complimentaryPlan: null,
    }));

    expect(html).toContain("Workspace access is pending approval");
    expect(html).toContain("no complimentary plan is confirmed yet");
    expect(html).not.toContain("Complimentary");
  });
});

describe("non-secret access audit presentation", () => {
  it("renders policy changes without displaying malformed or unknown raw details", () => {
    expect(formatAccessAuditDetails(JSON.stringify({ previousState: "pending", nextState: "active", previousPlan: null, nextPlan: "professional" }))).toBe("Workspace: pending → active; complimentary plan: none → professional");
    expect(formatAccessAuditDetails("not JSON")).toBe("Policy change recorded");
    expect(formatAccessAuditDetails(JSON.stringify({ previousState: "unknown-raw-content", nextState: "active" }))).toBe("Policy change recorded");
  });
});
