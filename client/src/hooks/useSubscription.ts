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

  // Super admins bypass all gates
  const bypass = isSuperAdmin;

  // Trial state from backend
  const isTrialActive = subscription?.isTrialActive ?? false;
  const isTrialExpired = subscription?.isTrialExpired ?? false;
  const trialDaysLeft = subscription?.trialDaysLeft ?? null;
  const trialExpiresAt = subscription?.trialExpiresAt ?? null;

  // Paid subscription state
  const hasPaidSubscription =
    !!subscription?.plan &&
    (subscription?.status === "active" || subscription?.status === "trialing");

  const plan: PlanTier = subscription?.plan ?? null;

  // During active trial: grant full Professional limits
  // After trial expires with no paid sub: use Starter limits (will be locked out anyway)
  const effectiveLimits: PlanLimits =
    bypass || isTrialActive ? PLAN_LIMITS.professional : getPlanLimits(plan);

  const isActive = hasPaidSubscription || isTrialActive;

  // Locked out = trial expired AND no paid subscription AND not super admin
  const isLockedOut = !bypass && !isActive && isTrialExpired;

  return {
    subscription,
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
