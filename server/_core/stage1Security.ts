export type InviteSignupPolicyInput = {
  normalizedRequestEmail: string;
  inviteEmail: string;
  existingUserId: number | null;
  inviteOrganizationId: number;
  teamMemberOrganizationId: number | null;
  teamMemberActive: boolean;
};

/** Invitations may create a new account only for their own active org placeholder. */
export function canCreateInvitedAccount(input: InviteSignupPolicyInput): boolean {
  return (
    input.existingUserId === null &&
    input.normalizedRequestEmail.trim().toLowerCase() === input.inviteEmail.trim().toLowerCase() &&
    Number.isInteger(input.inviteOrganizationId) &&
    input.inviteOrganizationId > 0 &&
    input.teamMemberOrganizationId === input.inviteOrganizationId &&
    input.teamMemberActive
  );
}

export type CoordinationImageAccessInput = {
  sheetIsActive: boolean;
  sheetOrganizationId: number | null;
  projectOrganizationId: number | null;
  authenticatedOrganizationId: number | null;
  tokenKind: "main" | "client" | null;
  itemVisibility: "internal" | "client";
};

/**
 * Authenticated access is restricted to the same positive organization ID.
 * Public sheet links are explicit bearer capabilities; client links never expose
 * internal items. Missing org IDs and missing credentials fail closed.
 */
export function canAccessCoordinationImage(input: CoordinationImageAccessInput): boolean {
  if (!input.sheetIsActive) return false;
  if (!Number.isSafeInteger(input.sheetOrganizationId) || input.sheetOrganizationId == null || input.sheetOrganizationId <= 0) return false;
  if (input.sheetOrganizationId !== input.projectOrganizationId) return false;
  if (
    input.authenticatedOrganizationId !== null &&
    Number.isInteger(input.authenticatedOrganizationId) &&
    input.authenticatedOrganizationId > 0 &&
    input.sheetOrganizationId === input.authenticatedOrganizationId
  ) {
    return true;
  }
  if (input.tokenKind === "main") return true;
  if (input.tokenKind === "client") return input.itemVisibility === "client";
  return false;
}

/** Accept a sheet token passed directly or from the existing public sheet URL referrer. */
export function getCoordinationTokenFromRequest(queryToken: unknown, referer: string | undefined): string | null {
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  if (!referer) return null;
  try {
    const path = new URL(referer).pathname;
    const match = path.match(/^\/coordination\/(?:client\/)?([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Existing portal pages already carry the public share capability in their URL. */
export function getClientPortalTokenFromRequest(queryToken: unknown, referer: string | undefined): string | null {
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  if (!referer) return null;
  try {
    const match = new URL(referer).pathname.match(/^\/portal\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}
