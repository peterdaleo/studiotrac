export type FirmInvitationRecord = {
  acceptedAt: Date | string | null;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
};

export type FirmInvitationStatus = "Pending" | "Accepted" | "Revoked" | "Expired";

export function getFirmInvitationStatus(invitation: FirmInvitationRecord, now = Date.now()): FirmInvitationStatus {
  if (invitation.acceptedAt) return "Accepted";
  if (invitation.revokedAt) return "Revoked";
  if (new Date(invitation.expiresAt).getTime() <= now) return "Expired";
  return "Pending";
}

export function partitionFirmInvitations<T extends FirmInvitationRecord>(
  invitations: readonly T[],
  now = Date.now(),
): { current: T[]; history: T[] } {
  const current: T[] = [];
  const history: T[] = [];
  for (const invitation of invitations) {
    (getFirmInvitationStatus(invitation, now) === "Pending" ? current : history).push(invitation);
  }
  return { current, history };
}

export type WorkspaceArchiveEvent = { organizationId: number | null; action: string };

/** Events must be newest first; the latest archive transition is the current reversible state. */
export function getArchivedOrganizationIds(events: readonly WorkspaceArchiveEvent[]): Set<number> {
  const latestAction = new Map<number, string>();
  for (const event of events) {
    if (event.organizationId != null && !latestAction.has(event.organizationId) &&
        (event.action === "workspace_archived" || event.action === "workspace_unarchived")) {
      latestAction.set(event.organizationId, event.action);
    }
  }
  const archivedIds = new Set<number>();
  latestAction.forEach((action, organizationId) => {
    if (action === "workspace_archived") archivedIds.add(organizationId);
  });
  return archivedIds;
}
