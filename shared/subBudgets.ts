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
  actualCents: number;
  remainingCents: number;
};

export type SubBudgetHealth = "proposed" | "no_budget" | "on_budget" | "watch_budget" | "near_limit" | "over_budget";
export type SubBudgetStatusItem = {
  id: number;
  name: string;
  status: SubBudgetStatus;
  health: SubBudgetHealth;
};

export type ProjectSubBudgetSummary = {
  items: SubBudgetItem[];
  originalBudgetCents: number;
  approvedAdditionsCents: number;
  approvedBudgetCents: number;
};

export const SUB_BUDGET_APPROVED_STATUSES: readonly SubBudgetStatus[] = ["approved", "complete"];

export function getSubBudgetHealth(item: Pick<SubBudgetItem, "status" | "budgetCents" | "actualCents">): SubBudgetHealth {
  if (item.status === "proposed") return "proposed";
  if (item.budgetCents === 0) return "no_budget";

  const consumedPercent = Math.round((item.actualCents / item.budgetCents) * 100);
  if (consumedPercent > 100) return "over_budget";
  if (consumedPercent >= 90) return "near_limit";
  if (consumedPercent >= 75) return "watch_budget";
  return "on_budget";
}

export function toSubBudgetStatusItem(item: SubBudgetItem): SubBudgetStatusItem {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    health: getSubBudgetHealth(item),
  };
}
