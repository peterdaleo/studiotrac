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

export type ProjectSubBudgetSummary = {
  items: SubBudgetItem[];
  originalBudgetCents: number;
  approvedAdditionsCents: number;
  approvedBudgetCents: number;
};

export const SUB_BUDGET_APPROVED_STATUSES: readonly SubBudgetStatus[] = ["approved", "complete"];
