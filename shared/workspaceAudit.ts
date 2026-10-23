export function formatAccessAuditDetails(value: string): string {
  try {
    const change = JSON.parse(value);
    const states = new Set(["legacy", "pending", "active", "suspended", "archived"]);
    const plans = new Set(["starter", "professional", "enterprise"]);
    if (!states.has(change.previousState) || !states.has(change.nextState) ||
        (change.previousPlan != null && !plans.has(change.previousPlan)) ||
        (change.nextPlan != null && !plans.has(change.nextPlan))) return "Policy change recorded";
    return `Workspace: ${change.previousState} → ${change.nextState}; complimentary plan: ${change.previousPlan ?? "none"} → ${change.nextPlan ?? "none"}`;
  } catch { return "Policy change recorded"; }
}
