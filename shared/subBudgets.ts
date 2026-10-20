export const PROJECT_PHASES = [
  "pre_design",
  "schematic_design",
  "design_development",
  "construction_documents",
  "bidding_negotiation",
  "construction_administration",
  "post_occupancy",
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];
export type SubBudgetKind = "within_existing" | "approved_addition";
export type SubBudgetStatus = "proposed" | "approved" | "complete";
export type SubBudgetTrackingMode = "fixed_amount" | "hourly";

export type SubBudgetOption = {
  id: number;
  name: string;
  phase: ProjectPhase | null;
  status: SubBudgetStatus;
};

export type SubBudgetItem = SubBudgetOption & {
  projectId: number;
  description: string | null;
  budgetCents: number;
  kind: SubBudgetKind;
  trackingMode: SubBudgetTrackingMode;
  notToExceedCents: number | null;
  /** Original project allowance for hourly work within the existing agreement. */
  baseBudgetCents?: number;
  /** Labor plus consultant costs, kept for existing consumers. */
  actualCents: number;
  remainingCents: number;
  totalMinutes: number;
  billableMinutes: number;
  laborCostCents: number;
  billableValueCents: number;
  consultantCostCents: number;
};

export type SubBudgetHealth =
  | "proposed"
  | "no_budget"
  | "on_budget"
  | "watch_budget"
  | "near_limit"
  | "over_budget"
  | "hourly_no_budget"
  | "hourly_within_nte"
  | "hourly_watch_nte"
  | "hourly_approaching_nte"
  | "hourly_above_nte";

export type SubBudgetStatusItem = {
  id: number;
  name: string;
  status: SubBudgetStatus;
  health: SubBudgetHealth;
};

export type ProjectSubBudgetSummary = {
  items: SubBudgetItem[];
  originalBudgetCents: number;
  /** Fixed additions plus explicitly capped hourly approved additions; uncapped accruals are excluded. */
  approvedAdditionsCents: number;
  approvedBudgetCents: number;
};

export const SUB_BUDGET_APPROVED_STATUSES: readonly SubBudgetStatus[] = ["approved", "complete"];

export function isSubBudgetTrackingMode(value: unknown): value is SubBudgetTrackingMode {
  return value === "fixed_amount" || value === "hourly";
}

export function getSubBudgetCapContribution(item: Pick<SubBudgetItem, "kind" | "status" | "trackingMode" | "budgetCents" | "notToExceedCents">): number {
  if (item.kind !== "approved_addition" || !SUB_BUDGET_APPROVED_STATUSES.includes(item.status)) return 0;
  if (item.trackingMode === "hourly") return Math.max(0, item.notToExceedCents ?? 0);
  return Math.max(0, item.budgetCents ?? 0);
}

export function isSubBudgetCostExcludedFromProjectCap(item: Pick<SubBudgetItem, "kind" | "status" | "trackingMode" | "notToExceedCents">): boolean {
  // Keep legacy fixed-amount cost attribution unchanged. Only hourly extra work
  // without an approved cap sits outside the project's capped-cost numerator.
  return item.kind === "approved_addition" && item.trackingMode === "hourly"
    && (item.status === "proposed" || (item.notToExceedCents ?? 0) <= 0);
}

function fixedHealth(budgetCents: number, actualCents: number): Exclude<SubBudgetHealth, "proposed" | "hourly_no_budget" | "hourly_within_nte" | "hourly_watch_nte" | "hourly_approaching_nte" | "hourly_above_nte"> {
  if (budgetCents <= 0) return "no_budget";
  const consumedPercent = Math.round((actualCents / budgetCents) * 100);
  if (consumedPercent > 100) return "over_budget";
  if (consumedPercent >= 90) return "near_limit";
  if (consumedPercent >= 75) return "watch_budget";
  return "on_budget";
}

export function getSubBudgetHealth(item: Pick<SubBudgetItem, "status" | "budgetCents" | "actualCents"> & Partial<Pick<SubBudgetItem, "trackingMode" | "notToExceedCents" | "kind" | "baseBudgetCents" | "billableValueCents">>): SubBudgetHealth {
  if (item.status === "proposed") return "proposed";
  if (item.trackingMode === "hourly" && item.kind === "within_existing") {
    return fixedHealth(item.baseBudgetCents ?? item.budgetCents, item.actualCents);
  }
  if (item.trackingMode !== "hourly") {
    return fixedHealth(item.budgetCents, item.actualCents);
  }
  const cap = item.notToExceedCents ?? 0;
  if (cap <= 0) return "hourly_no_budget";
  const pct = Math.round(((item.billableValueCents ?? item.actualCents) / cap) * 100);
  if (pct > 100) return "hourly_above_nte";
  if (pct >= 90) return "hourly_approaching_nte";
  if (pct >= 75) return "hourly_watch_nte";
  return "hourly_within_nte";
}

export function toSubBudgetStatusItem(item: SubBudgetItem): SubBudgetStatusItem {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    health: getSubBudgetHealth(item),
  };
}
