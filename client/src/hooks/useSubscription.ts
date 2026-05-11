import { trpc } from "@/lib/trpc";
import { getPlanLimits, type PlanTier, type PlanLimits } from "@shared/subscription";

export function useSubscription() {
  const { data: subscription, isLoading } = trpc.subscription.current.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000, // Cache for 1 minute
  });

  const plan: PlanTier = subscription?.plan ?? null;
  const limits: PlanLimits = getPlanLimits(plan);
  const isActive = subscription?.status === "active";
  const hasSubscription = !!subscription && isActive;

  return {
    subscription,
    plan,
    limits,
    isActive,
    hasSubscription,
    isLoading,
    // Convenience checks
    canAccessFinancials: limits.hasFinancials,
    canAccessConsultants: limits.hasConsultantManagement,
    canAccessAdvancedReports: limits.hasAdvancedReports,
    canAccessClientPortal: limits.hasClientPortal,
  };
}
