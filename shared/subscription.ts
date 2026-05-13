/**
 * Subscription plan tier definitions and feature gating logic.
 * Shared between client and server.
 */

export type PlanTier = "starter" | "professional" | "enterprise" | null;

export interface PlanLimits {
  maxProjects: number;
  maxTeamMembers: number;
  hasFinancials: boolean;
  hasConsultantManagement: boolean;
  hasAdvancedReports: boolean;
  hasClientPortalFileSharing: boolean;
  hasTeamReport: boolean;
}

export const PLAN_LIMITS: Record<NonNullable<PlanTier>, PlanLimits> = {
  starter: {
    maxProjects: 10,
    maxTeamMembers: 5,
    hasFinancials: false,
    hasConsultantManagement: false,
    hasAdvancedReports: false,
    hasClientPortalFileSharing: false,
    hasTeamReport: false,
  },
  professional: {
    maxProjects: Infinity,
    maxTeamMembers: 25,
    hasFinancials: true,
    hasConsultantManagement: true,
    hasAdvancedReports: true,
    hasClientPortalFileSharing: true,
    hasTeamReport: true,
  },
  enterprise: {
    maxProjects: Infinity,
    maxTeamMembers: Infinity,
    hasFinancials: true,
    hasConsultantManagement: true,
    hasAdvancedReports: true,
    hasClientPortalFileSharing: true,
    hasTeamReport: true,
  },
};

/**
 * Users without a subscription get Starter-level access.
 * This ensures the app is usable immediately while still enforcing limits.
 */
export const DEFAULT_LIMITS: PlanLimits = PLAN_LIMITS.starter;

export function getPlanLimits(plan: PlanTier): PlanLimits {
  if (!plan) return DEFAULT_LIMITS;
  return PLAN_LIMITS[plan];
}

/** Human-readable plan names for UI display */
export const PLAN_DISPLAY_NAMES: Record<NonNullable<PlanTier>, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

/**
 * Returns the minimum plan required to unlock a given feature.
 * Useful for upgrade prompts.
 */
export function getRequiredPlan(feature: keyof Omit<PlanLimits, "maxProjects" | "maxTeamMembers">): NonNullable<PlanTier> {
  if (PLAN_LIMITS.starter[feature]) return "starter";
  if (PLAN_LIMITS.professional[feature]) return "professional";
  return "enterprise";
}
