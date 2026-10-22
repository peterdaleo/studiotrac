export type BillingPrincipal = {
  organizationId?: number | null;
  orgRole?: string | null;
};

/** Billing belongs to the firm's actual owner, never merely an app administrator. */
export function canManageBilling(user: BillingPrincipal | null | undefined): boolean {
  return user?.orgRole === "owner"
    && typeof user.organizationId === "number"
    && Number.isSafeInteger(user.organizationId)
    && user.organizationId > 0;
}
