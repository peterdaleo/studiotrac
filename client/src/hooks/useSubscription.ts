import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getPlanLimits, type PlanTier, type PlanLimits } from "@shared/subscription";

export function useSubscription() {
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  const { data: subscription, isLoading } = trpc.subscription.current.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000, // Cache for 1 minute
  });

  const plan: PlanTier = subscription?.plan ?? null;
  const limits: PlanLimits = getPlanLimits(plan);
  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const hasSubscription = !!subscription && isActive;

  // Super admins bypass all gates
  const bypass = isSuperAdmin;

  return {
    subscription,
    plan,
    limits,
    isActive,
    hasSubscription,
    isLoading,
    isSuperAdmin: bypass,
    // Convenience checks (super admin bypasses all)
    canAccessFinancials: bypass || limits.hasFinancials,
    canAccessConsultants: bypass || limits.hasConsultantManagement,
    canAccessAdvancedReports: bypass || limits.hasAdvancedReports,
    canAccessTeamReport: bypass || limits.hasTeamReport,
    canAccessClientPortalFileSharing: bypass || limits.hasClientPortalFileSharing,
    maxProjects: bypass ? Infinity : limits.maxProjects,
    maxTeamMembers: bypass ? Infinity : limits.maxTeamMembers,
  };
}
