import { vi } from "vitest";

// Existing tests model legacy workspaces unless they explicitly opt into the
// dedicated platform-access integration suite. Never let an unmocked lookup
// make an ordinary unit test connect to a database for a missing control row.
vi.mock("./platformAccessStore", () => ({
  hasAcceptedFirmInvitation: vi.fn(async () => false),
  readOrganizationAccessControl: vi.fn(async () => null),
  listAccessControls: vi.fn(async () => []),
  listFirmInvitations: vi.fn(async () => []),
  listPlatformAccessAudit: vi.fn(async () => []),
  issueFirmOwnerInvitation: vi.fn(async () => ({ invitationId: 1, invitationUrl: "https://example.invalid/signup?firmInvite=synthetic", expiresAt: new Date(0) })),
  previewFirmOwnerInvitation: vi.fn(async () => null),
  acceptFirmOwnerInvitation: vi.fn(async () => { throw new Error("Unexpected platform access mock acceptance"); }),
  revokeFirmOwnerInvitation: vi.fn(async () => ({ success: true })),
  archiveWorkspace: vi.fn(async () => ({ success: true, archived: true })),
  unarchiveWorkspace: vi.fn(async () => ({ success: true, archived: false })),
  setWorkspaceAccess: vi.fn(async () => ({ organizationId: 1, state: "active", complimentaryPlan: null })),
  setComplimentaryPlan: vi.fn(async () => ({ organizationId: 1, state: "active", complimentaryPlan: null })),
}));
