import { beforeEach, describe, expect, it, vi } from "vitest";

const storeMocks = vi.hoisted(() => ({
  listAccessControls: vi.fn(), listFirmInvitations: vi.fn(), listPlatformAccessAudit: vi.fn(),
  issueFirmOwnerInvitation: vi.fn(), revokeFirmOwnerInvitation: vi.fn(),
  setComplimentaryPlan: vi.fn(), setWorkspaceAccess: vi.fn(),
}));
const emailMocks = vi.hoisted(() => ({ sendFirmOwnerInviteEmail: vi.fn() }));
vi.mock("./platformAccessStore", () => storeMocks);
vi.mock("./_core/email", () => emailMocks);

import { platformAccessRouter } from "./platformAccessRouter";

function caller(user: Record<string, unknown> | null, organizationId?: number | null) {
  const contextOrganizationId = organizationId === undefined
    ? ((user?.organizationId as number | null | undefined) ?? null)
    : organizationId;
  return platformAccessRouter.createCaller({
    user: user as any,
    organizationId: contextOrganizationId,
    req: {} as any,
    res: {} as any,
  });
}
const calls: Array<() => Promise<unknown>> = [
  () => caller({ id: 1, isSuperAdmin: false, orgRole: "owner", organizationId: 41 }).overview(),
  () => caller({ id: 1, isSuperAdmin: true, orgRole: "admin", organizationId: 41 }).audit(),
  () => caller({ id: 1, isSuperAdmin: true, orgRole: "member", organizationId: 41 }).inviteFirmOwner({ email: "owner@example.test", firmName: "Example" }),
  () => caller({ id: 1, isSuperAdmin: true, orgRole: "owner", organizationId: 41 }, null).revokeFirmInvitation({ invitationId: 1 }),
  () => caller({ id: 1, isSuperAdmin: false, role: "admin", orgRole: "admin", organizationId: 41 }).grantComplimentaryPlan({ organizationId: 2, plan: "starter" }),
  () => caller({ id: 1, isSuperAdmin: false, role: "admin", orgRole: "owner", organizationId: 41 }).revokeComplimentaryPlan({ organizationId: 2 }),
  () => caller({ id: 1, isSuperAdmin: true, role: "admin", orgRole: "admin", organizationId: 41 }).grantWorkspaceAccess({ organizationId: 2 }),
  () => caller({ id: 1, isSuperAdmin: true, role: "admin", orgRole: "member", organizationId: 41 }).suspendWorkspace({ organizationId: 2 }),
  () => caller({ id: 1, isSuperAdmin: true, role: "admin", orgRole: "admin", organizationId: 41 }).reactivateWorkspace({ organizationId: 2 }),
];

describe("platformAccessRouter owner guard", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("rejects firm owners, admins, members, non-super-admin owners and invalid-org super-admin owners before store effects", async () => {
    for (const invoke of calls) {
      await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const mock of Object.values(storeMocks)) expect(mock).not.toHaveBeenCalled();
  });

  it("allows only a super-admin owner with a valid authenticated organization", async () => {
    storeMocks.listAccessControls.mockResolvedValue([]);
    storeMocks.listFirmInvitations.mockResolvedValue([]);
    const result = await caller({ id: 9, isSuperAdmin: true, orgRole: "owner", organizationId: 9 }).overview();
    expect(result).toEqual({ controls: [], invitations: [] });
    expect(storeMocks.listAccessControls).toHaveBeenCalledOnce();
    expect(storeMocks.listFirmInvitations).toHaveBeenCalledOnce();
  });

  it("issues one invitation and returns its link when email delivery fails", async () => {
    const issued = {
      invitationId: 33,
      invitationUrl: "https://app.example.test/invite?firmInvite=synthetic-bearer",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    };
    storeMocks.issueFirmOwnerInvitation.mockResolvedValue(issued);
    emailMocks.sendFirmOwnerInviteEmail.mockResolvedValue({ sent: false, reason: "missing_api_key" });

    const result = await caller({ id: 9, isSuperAdmin: true, orgRole: "owner", organizationId: 9 })
      .inviteFirmOwner({ email: "owner@example.test", firmName: "Example Firm" });

    expect(storeMocks.issueFirmOwnerInvitation).toHaveBeenCalledOnce();
    expect(storeMocks.issueFirmOwnerInvitation).toHaveBeenCalledWith({
      email: "owner@example.test",
      firmName: "Example Firm",
      actorUserId: 9,
      origin: "https://app.studiotrac.app",
    });
    expect(emailMocks.sendFirmOwnerInviteEmail).toHaveBeenCalledOnce();
    expect(emailMocks.sendFirmOwnerInviteEmail).toHaveBeenCalledWith({
      to: "owner@example.test",
      firmName: "Example Firm",
      invitationUrl: issued.invitationUrl,
    });
    expect(result).toEqual({ ...issued, emailSent: false, emailFailureReason: "missing_api_key" });
  });
});
