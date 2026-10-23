import { TRPCError } from "@trpc/server";
import type { Subscription } from "../drizzle/schema";
import type { StripePlanTier } from "./stripe/config";
import { hasAcceptedFirmInvitation, readOrganizationAccessControl } from "./platformAccessStore";
import { getActiveSubscriptionByOrg, orgHasSuperAdminOwner } from "./db";

export type WorkspaceAccess = {
  managed: boolean;
  state: "legacy" | "pending" | "active" | "suspended";
  allowed: boolean;
  reason: "awaiting_approval" | "suspended" | "no_entitlement" | null;
  plan: StripePlanTier | null;
  complimentaryPlan: StripePlanTier | null;
};
type Control = { state: "pending" | "active" | "suspended"; complimentaryPlan: StripePlanTier | null; archived?: boolean };
const tiers: StripePlanTier[] = ["starter", "professional", "enterprise"];
export function computeManagedWorkspaceAccess(control: Control, paid: Pick<Subscription, "plan" | "status"> | null): WorkspaceAccess {
  const paidPlan = paid && (paid.status === "active" || paid.status === "trialing") ? paid.plan : null;
  const plan = [control.complimentaryPlan, paidPlan].reduce<StripePlanTier | null>((best, candidate) =>
    candidate && (best == null || tiers.indexOf(candidate) > tiers.indexOf(best)) ? candidate : best, null);
  const state = control.archived ? "suspended" : control.state;
  const reason = state === "suspended" ? "suspended" : state === "pending" ? "awaiting_approval" : plan == null ? "no_entitlement" : null;
  return { managed: true, state, allowed: reason == null, reason, plan, complimentaryPlan: control.complimentaryPlan };
}
export function platformOwnerWorkspaceAccess(): WorkspaceAccess {
  return { managed: false, state: "legacy", allowed: true, reason: null, plan: "enterprise", complimentaryPlan: null };
}
export async function resolveOrganizationWorkspaceAccess(organizationId: number | null | undefined, isSuperAdmin = false): Promise<WorkspaceAccess> {
  if (!Number.isSafeInteger(organizationId) || organizationId == null || organizationId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A valid organization workspace is required." });
  }
  if (isSuperAdmin) return platformOwnerWorkspaceAccess();
  const control = await readOrganizationAccessControl(organizationId);
  // Absence is an explicit legacy compatibility rule, not an error fallback.
  // Only the invitation transaction creates new firms, with a mandatory pending row.
  // Store errors propagate; missing/unavailable schema must never imply access.
  if (!control) {
    if (await hasAcceptedFirmInvitation(organizationId)) throw new TRPCError({ code: "FORBIDDEN", message: "Workspace approval record is unavailable. Contact the platform owner." });
    return { managed: false, state: "legacy", allowed: true, reason: null, plan: null, complimentaryPlan: null };
  }
  if (await orgHasSuperAdminOwner(organizationId)) return platformOwnerWorkspaceAccess();
  if (control.state !== "active") return computeManagedWorkspaceAccess(control, null);
  return computeManagedWorkspaceAccess(control, await getActiveSubscriptionByOrg(organizationId) ?? null);
}
export async function assertOrganizationWorkspaceAccess(organizationId: number | null | undefined, isSuperAdmin = false): Promise<WorkspaceAccess> {
  const access = await resolveOrganizationWorkspaceAccess(organizationId, isSuperAdmin);
  if (!access.allowed) throw new TRPCError({ code: "FORBIDDEN", message: access.reason === "suspended" ? "Workspace access is suspended. Contact the platform owner." : "Workspace access requires a platform-owner grant." });
  return access;
}
/** Buying a paid plan requires workspace approval, not a pre-existing free grant. */
export async function assertOrganizationBillingApproval(organizationId: number | null | undefined, isSuperAdmin = false): Promise<void> {
  const access = await resolveOrganizationWorkspaceAccess(organizationId, isSuperAdmin);
  if (access.managed && access.state !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Workspace approval is required before starting or changing a paid subscription." });
}
/** Public sharing and background jobs fail closed, including on store outages. */
export async function isOrganizationWorkspaceAccessible(organizationId: number | null | undefined): Promise<boolean> {
  try { return (await resolveOrganizationWorkspaceAccess(organizationId)).allowed; } catch { return false; }
}
