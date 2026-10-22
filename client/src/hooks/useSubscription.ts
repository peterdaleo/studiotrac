import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getPlanLimits, PLAN_LIMITS, type PlanTier, type PlanLimits } from "@shared/subscription";

export function useSubscription() {
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  const { data: subscription, isLoading } = trpc.subscription.current.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000, // Cache for 1 minute
  });

  const workspaceAccess = (subscription as typeof subscription & {
    workspaceAccess?: { managed: boolean; allowed: boolean; plan: PlanTier; complimentaryPlan?: PlanTier };
  } | null | undefined)?.workspaceAccess;
  const isManaged = workspaceAccess?.managed === true;
  // Super admins bypass all gates. Managed limits always use the backend's effective tier,
  // which may be a complimentary tier above (or below) the actual Stripe plan.
  const isEnterprise = isManaged
    ? workspaceAccess?.plan === "enterprise"
    : subscription?.plan === "enterprise" && subscription?.status === "active";
  const bypass = isSuperAdmin || isEnterprise;

  // Trial state from backend
  const isTrialActive = isManaged && subscription?.accessSource !== "subscription"
    ? false
    : subscription?.isTrialActive ?? false;
  const isTrialExpired = isManaged ? false : subscription?.isTrialExpired ?? false;
  const trialDaysLeft = isManaged && subscription?.accessSource !== "subscription"
    ? null
    : subscription?.trialDaysLeft ?? null;
  const trialExpiresAt = subscription?.trialExpiresAt ?? null;

  // Paid subscription state
  const hasPaidSubscription =
    !!subscription?.plan &&
    (subscription?.status === "active" || subscription?.status === "trialing");

  const plan: PlanTier = isManaged ? workspaceAccess?.plan ?? null : subscription?.plan ?? null;

  // During active trial or enterprise: grant full limits
  // After trial expires with no paid sub: use Starter limits (will be locked out anyway)
  const effectiveLimits: PlanLimits =
    bypass || isTrialActive ? PLAN_LIMITS.enterprise : getPlanLimits(plan);

  const isActive = hasPaidSubscription || isTrialActive || (isManaged && workspaceAccess?.allowed === true);

  // Locked out = trial expired AND no paid subscription AND not super admin AND not enterprise
  const isLockedOut = isManaged
    ? workspaceAccess?.allowed === false
    : !bypass && !isActive && isTrialExpired;

  return {
    subscription,
    workspaceAccess,
    plan,
    limits: effectiveLimits,
    isActive,
    hasSubscription: hasPaidSubscription,
    isLoading,
    isSuperAdmin: bypass,
    // Trial info
    isTrialActive,
    isTrialExpired,
    trialDaysLeft,
    trialExpiresAt,
    isLockedOut,
    // Convenience checks (super admin and active trial bypass all)
    canAccessFinancials: bypass || isTrialActive || effectiveLimits.hasFinancials,
    canAccessConsultants: bypass || isTrialActive || effectiveLimits.hasConsultantManagement,
    canAccessAdvancedReports: bypass || isTrialActive || effectiveLimits.hasAdvancedReports,
    canAccessTeamReport: bypass || isTrialActive || effectiveLimits.hasTeamReport,
    canAccessClientPortalFileSharing:
      bypass || isTrialActive || effectiveLimits.hasClientPortalFileSharing,
    maxProjects: bypass || isTrialActive ? Infinity : effectiveLimits.maxProjects,
    maxTeamMembers: bypass || isTrialActive ? Infinity : effectiveLimits.maxTeamMembers,
  };
}
