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
  hasClientPortal: boolean;
  hasTimeTracking: boolean;
}

export const PLAN_LIMITS: Record<NonNullable<PlanTier>, PlanLimits> = {
  starter: {
    maxProjects: 10,
    maxTeamMembers: 5,
    hasFinancials: false,
    hasConsultantManagement: false,
    hasAdvancedReports: false,
    hasClientPortal: true,
    hasTimeTracking: true,
  },
  professional: {
    maxProjects: Infinity,
    maxTeamMembers: Infinity,
    hasFinancials: true,
    hasConsultantManagement: true,
    hasAdvancedReports: true,
    hasClientPortal: true,
    hasTimeTracking: true,
  },
  enterprise: {
    maxProjects: Infinity,
    maxTeamMembers: Infinity,
    hasFinancials: true,
    hasConsultantManagement: true,
    hasAdvancedReports: true,
    hasClientPortal: true,
    hasTimeTracking: true,
  },
};

/** Free tier limits (no subscription) */
export const FREE_LIMITS: PlanLimits = {
  maxProjects: 3,
  maxTeamMembers: 2,
  hasFinancials: false,
  hasConsultantManagement: false,
  hasAdvancedReports: false,
  hasClientPortal: false,
  hasTimeTracking: true,
};

export function getPlanLimits(plan: PlanTier): PlanLimits {
  if (!plan) return FREE_LIMITS;
  return PLAN_LIMITS[plan];
}
