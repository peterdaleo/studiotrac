import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./platformAccessStore", () => ({ readOrganizationAccessControl: vi.fn(), hasAcceptedFirmInvitation: vi.fn() }));
vi.mock("./db", () => ({ orgHasSuperAdminOwner: vi.fn(), getActiveSubscriptionByOrg: vi.fn() }));
import { hasAcceptedFirmInvitation, readOrganizationAccessControl } from "./platformAccessStore";
import { getActiveSubscriptionByOrg, orgHasSuperAdminOwner } from "./db";
import { accountProcedure, protectedProcedure, router } from "./_core/trpc";
import { assertOrganizationBillingApproval, assertOrganizationWorkspaceAccess, computeManagedWorkspaceAccess, isOrganizationWorkspaceAccessible, resolveOrganizationWorkspaceAccess } from "./workspaceAccess";
const read = vi.mocked(readOrganizationAccessControl);
const paid = vi.mocked(getActiveSubscriptionByOrg);
const owner = vi.mocked(orgHasSuperAdminOwner);
const control = (state: "pending" | "active" | "suspended", complimentaryPlan: "starter" | "professional" | "enterprise" | null = null) => ({ organizationId: 42, state, complimentaryPlan, createdAt: new Date(), updatedAt: new Date() });
beforeEach(() => { vi.resetAllMocks(); read.mockResolvedValue(null); vi.mocked(hasAcceptedFirmInvitation).mockResolvedValue(false); owner.mockResolvedValue(false); paid.mockResolvedValue(undefined); });
describe("managed workspace access and legacy compatibility", () => {
  it.each([null, undefined, 0, -1, NaN, 1.5])("rejects invalid organization %s before storage or owner override", async id => {
    await expect(resolveOrganizationWorkspaceAccess(id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  });
  it("leaves a legacy workspace unchanged without granting a new trial or rewriting anything", async () => {
    expect(await resolveOrganizationWorkspaceAccess(42)).toMatchObject({ managed: false, allowed: true, state: "legacy", plan: null });
    expect(paid).not.toHaveBeenCalled();
  });
  it("never treats an invite-created firm with a missing approval row as legacy access", async () => {
    vi.mocked(hasAcceptedFirmInvitation).mockResolvedValue(true);
    await expect(resolveOrganizationWorkspaceAccess(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await isOrganizationWorkspaceAccessible(42)).toBe(false);
  });
  it("retains platform-owner and platform-owner firm access even with a contradictory managed row", async () => {
    expect(await resolveOrganizationWorkspaceAccess(42, true)).toMatchObject({ allowed: true, plan: "enterprise" });
    expect(read).not.toHaveBeenCalled();
    read.mockResolvedValue(control("suspended") as any); owner.mockResolvedValue(true);
    expect(await resolveOrganizationWorkspaceAccess(42)).toMatchObject({ allowed: true, plan: "enterprise", managed: false });
  });
  it("requires both approval and an entitlement, never substitutes a trial", async () => {
    for (const state of ["pending", "suspended"] as const) {
      read.mockResolvedValue(control(state, "enterprise") as any);
      await expect(assertOrganizationWorkspaceAccess(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    read.mockResolvedValue(control("active") as any);
    expect(await resolveOrganizationWorkspaceAccess(42)).toMatchObject({ allowed: false, reason: "no_entitlement" });
    read.mockResolvedValue(control("active", "professional") as any);
    expect(await resolveOrganizationWorkspaceAccess(42)).toMatchObject({ allowed: true, plan: "professional" });
  });
  it("keeps archived workspaces fail-closed and restores only to suspended access", async () => {
    read.mockResolvedValue({ ...control("active", "enterprise"), archived: true } as any);
    expect(await resolveOrganizationWorkspaceAccess(42)).toMatchObject({ managed: true, state: "suspended", allowed: false, reason: "suspended" });
    await expect(assertOrganizationWorkspaceAccess(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertOrganizationBillingApproval(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows approved owners to buy a real plan without a complimentary entitlement, but never bypass approval or suspension", async () => {
    read.mockResolvedValue(control("active") as any);
    await expect(assertOrganizationBillingApproval(42)).resolves.toBeUndefined();
    await expect(assertOrganizationWorkspaceAccess(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const state of ["pending", "suspended"] as const) {
      read.mockResolvedValue(control(state, "enterprise") as any);
      await expect(assertOrganizationBillingApproval(42)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("fails closed on storage outages, never converts an error to legacy access", async () => {
    read.mockRejectedValue(new Error("synthetic store unavailable"));
    await expect(resolveOrganizationWorkspaceAccess(42)).rejects.toThrow("synthetic store unavailable");
    expect(await isOrganizationWorkspaceAccessible(42)).toBe(false);
  });
  it("uses the higher valid paid/manual plan and preserves paid access after manual revocation", () => {
    expect(computeManagedWorkspaceAccess(control("active", "starter"), { plan: "professional", status: "active" })).toMatchObject({ allowed: true, plan: "professional" });
    expect(computeManagedWorkspaceAccess(control("active", "enterprise"), { plan: "professional", status: "active" }).plan).toBe("enterprise");
    expect(computeManagedWorkspaceAccess(control("active"), { plan: "professional", status: "active" })).toMatchObject({ allowed: true, plan: "professional" });
    expect(computeManagedWorkspaceAccess(control("suspended"), { plan: "professional", status: "active" }).allowed).toBe(false);
    expect(computeManagedWorkspaceAccess(control("active"), { plan: "professional", status: "unpaid" }).allowed).toBe(false);
  });
  it.each(["admin", "pm", "staff"])("rechecks the same authenticated %s session after suspension while keeping account recovery available", async role => {
    const endpoint = router({ business: protectedProcedure.query(() => "synthetic record"), recovery: accountProcedure.query(() => "account status") });
    const caller = endpoint.createCaller({ user: { id: 7, organizationId: 42, orgRole: "member", role, isSuperAdmin: false }, organizationId: 42 } as any);
    read.mockResolvedValue(control("active", "starter") as any);
    expect(await caller.business()).toBe("synthetic record");
    read.mockResolvedValue(control("suspended", "starter") as any);
    await expect(caller.business()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await caller.recovery()).toBe("account status");
    read.mockResolvedValue(control("active", "starter") as any);
    expect(await caller.business()).toBe("synthetic record");
  });
});
