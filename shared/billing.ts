/**
 * Project billing types and budget-health evaluation.
 *
 * Fixed-fee projects use the contract sum as a hard budget cap.
 * Hourly / time-and-materials projects have no fixed contract-sum budget and
 * must never be flagged "over budget" merely because costs exist.
 * Hybrid projects (a billing-type change over time) keep every historical
 * agreement and evaluate budget health only against the fixed-fee portion.
 */

export const BILLING_TYPES = [
  { value: "fixed_fee", label: "Fixed fee" },
  { value: "hourly", label: "Hourly / time & materials" },
] as const;

export type BillingType = (typeof BILLING_TYPES)[number]["value"];

export type BudgetStatusKind =
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

export type PlanningAlert = "none" | "watch_nte" | "approaching_nte" | "above_nte";

export type CostSlice = {
  laborCost: number;
  billableLaborCost: number;
  consultantCost: number;
  totalMinutes: number;
  billableMinutes: number;
};

export type BillingPhaseInput = {
  billingType: BillingType;
  startedAt: Date;
  endedAt: Date | null;
  contractedFee: number;
  hourlyRateCents: number;
  notToExceedCents: number;
  revenueTargetCents: number;
  costs: CostSlice;
};

export type BudgetHealth = {
  mode: "fixed_fee" | "hourly" | "hybrid";
  currentBillingType: BillingType;
  /** True only when a live fixed-fee cap exists. */
  usesFixedBudget: boolean;
  /**
   * Hard over-budget flag. Always false for pure hourly work and for hourly
   * spend that happens after a project converts away from a fixed fee.
   */
  isOverBudget: boolean;
  statusKind: BudgetStatusKind;
  statusLabel: string;
  consumedPercent: number | null;
  remainingCents: number | null;
  planningAlert: PlanningAlert;
  totalHours: number;
  billableHours: number;
  billableValueCents: number;
  costCents: number;
  marginCents: number;
  fixedFeeHealth: {
    contractedFee: number;
    totalCost: number;
    isOverBudget: boolean;
    consumedPercent: number | null;
    remainingCents: number | null;
    statusLabel: string;
  } | null;
};

const EMPTY_COSTS: CostSlice = {
  laborCost: 0,
  billableLaborCost: 0,
  consultantCost: 0,
  totalMinutes: 0,
  billableMinutes: 0,
};

export function isBillingType(value: unknown): value is BillingType {
  return value === "fixed_fee" || value === "hourly";
}

export function getBillingTypeLabel(type: string | null | undefined): string {
  if (type === "hourly") return "Hourly / time & materials";
  if (type === "fixed_fee") return "Fixed fee";
  return "Fixed fee";
}

export function inferBillingType(
  contractedFee: number | null | undefined,
  explicit?: BillingType | null,
): BillingType {
  if (explicit === "fixed_fee" || explicit === "hourly") return explicit;
  return (contractedFee ?? 0) > 0 ? "fixed_fee" : "hourly";
}

export function hoursFromMinutes(minutes: number): number {
  return Math.round(((minutes || 0) / 60) * 10) / 10;
}

export function costSliceTotal(costs: CostSlice): number {
  return (costs.laborCost || 0) + (costs.consultantCost || 0);
}

function percentOf(amount: number, cap: number): number | null {
  if (cap <= 0) return null;
  return Math.round((amount / cap) * 100);
}

function remainingOf(cap: number, amount: number): number | null {
  if (cap <= 0) return null;
  return cap - amount;
}

function fixedFeeKind(pct: number | null): BudgetStatusKind {
  if (pct === null) return "no_budget";
  if (pct > 100) return "over_budget";
  if (pct >= 90) return "near_limit";
  if (pct >= 75) return "watch_budget";
  return "on_budget";
}

function hourlyKind(pct: number | null): BudgetStatusKind {
  if (pct === null) return "hourly_no_budget";
  if (pct > 100) return "hourly_above_nte";
  if (pct >= 90) return "hourly_approaching_nte";
  if (pct >= 75) return "hourly_watch_nte";
  return "hourly_within_nte";
}

export function budgetStatusLabel(kind: BudgetStatusKind): string {
  switch (kind) {
    case "no_budget":
      return "No budget set";
    case "on_budget":
      return "On budget";
    case "watch_budget":
      return "Watch budget";
    case "near_limit":
      return "Near limit";
    case "over_budget":
      return "Over budget";
    case "hourly_no_budget":
      return "Hourly billing — no fixed budget";
    case "hourly_within_nte":
      return "Hourly billing — within NTE";
    case "hourly_watch_nte":
      return "Hourly billing — watch NTE";
    case "hourly_approaching_nte":
      return "Hourly billing — approaching NTE";
    case "hourly_above_nte":
      return "Hourly billing — above NTE";
  }
}

function planningAlertFromKind(kind: BudgetStatusKind): PlanningAlert {
  if (kind === "hourly_above_nte") return "above_nte";
  if (kind === "hourly_approaching_nte") return "approaching_nte";
  if (kind === "hourly_watch_nte") return "watch_nte";
  return "none";
}

function evaluateFixedPortion(contractedFee: number, totalCost: number) {
  const consumedPercent = percentOf(totalCost, contractedFee);
  const kind = fixedFeeKind(consumedPercent);
  return {
    contractedFee,
    totalCost,
    isOverBudget: contractedFee > 0 && totalCost > contractedFee,
    consumedPercent,
    remainingCents: remainingOf(contractedFee, totalCost),
    statusLabel: budgetStatusLabel(kind),
    statusKind: kind,
  };
}

/**
 * Hourly value is the sum of billable time at each contributor's saved team
 * billing rate. A project-level rate is intentionally never used here.
 */
function billableValueCents(costs: CostSlice): number {
  return costs.billableLaborCost || 0;
}

export function costsFallInPhase(
  date: Date,
  phase: { startedAt: Date; endedAt: Date | null },
): boolean {
  const t = date.getTime();
  if (Number.isNaN(t)) return false;
  if (t < phase.startedAt.getTime()) return false;
  if (phase.endedAt && t >= phase.endedAt.getTime()) return false;
  return true;
}

export type EvaluateBudgetHealthInput = {
  billingType: BillingType | string | null | undefined;
  contractedFee: number;
  laborCost: number;
  billableLaborCost?: number;
  consultantCost: number;
  totalMinutes?: number;
  billableMinutes?: number;
  hourlyRateCents?: number;
  notToExceedCents?: number;
  revenueTargetCents?: number;
  /** Approved sub-budget additions; hourly work remains uncapped without an existing NTE. */
  approvedAdditionsCents?: number;
  phases?: BillingPhaseInput[];
};

export function evaluateBudgetHealth(input: EvaluateBudgetHealthInput): BudgetHealth {
  const currentBillingType: BillingType = isBillingType(input.billingType)
    ? input.billingType
    : inferBillingType(input.contractedFee);

  const currentCosts: CostSlice = {
    laborCost: input.laborCost || 0,
    billableLaborCost: input.billableLaborCost || 0,
    consultantCost: input.consultantCost || 0,
    totalMinutes: input.totalMinutes || 0,
    billableMinutes: input.billableMinutes || 0,
  };
  const currentTotalCost = costSliceTotal(currentCosts);
  const approvedAdditionsCents = Math.max(0, input.approvedAdditionsCents ?? 0);
  const currentBillableValue = billableValueCents(currentCosts);
  const currentHours = hoursFromMinutes(currentCosts.totalMinutes);
  const currentBillableHours = hoursFromMinutes(currentCosts.billableMinutes);

  const phases = input.phases ?? [];
  const hasFixedPhase = phases.some((phase) => phase.billingType === "fixed_fee");
  const hasHourlyPhase = phases.some((phase) => phase.billingType === "hourly");
  const isHybrid = hasFixedPhase && hasHourlyPhase;

  if (isHybrid) {
    const fixedPhases = phases.filter((phase) => phase.billingType === "fixed_fee");
    const fixedCap = fixedPhases.reduce((sum, phase) => sum + (phase.contractedFee || 0), 0)
      + (currentBillingType === "fixed_fee" ? approvedAdditionsCents : 0);
    const fixedCost = fixedPhases.reduce((sum, phase) => sum + costSliceTotal(phase.costs || EMPTY_COSTS), 0);
    const fixedPortion = evaluateFixedPortion(fixedCap, fixedCost);

    const hourlyPhases = phases.filter((phase) => phase.billingType === "hourly");
    const hourlyCosts = hourlyPhases.reduce(
      (sum, phase) => addCostSlice(sum, phase.costs || EMPTY_COSTS),
      emptyCostSlice(),
    );
    const hourlyTotal = costSliceTotal(hourlyCosts);
    const nte = input.notToExceedCents
      ? input.notToExceedCents + (currentBillingType === "hourly" ? approvedAdditionsCents : 0)
      : hourlyPhases.reduce((sum, phase) => sum + (phase.notToExceedCents || 0), 0);
    const liveCosts = currentBillingType === "hourly" ? hourlyCosts : currentCosts;
    const liveTotal = currentBillingType === "hourly" ? hourlyTotal : currentTotalCost;
    const liveHours = hoursFromMinutes(liveCosts.totalMinutes);
    const liveBillableHours = hoursFromMinutes(liveCosts.billableMinutes);
    const liveBillableValue = billableValueCents(liveCosts);
    const hourlyKindNow = hourlyKind(percentOf(hourlyTotal, nte));
    const liveFixedCap = (input.contractedFee || 0) + (currentBillingType === "fixed_fee" ? approvedAdditionsCents : 0);

    const statusKind: BudgetStatusKind = currentBillingType === "hourly"
      ? hourlyKindNow
      : fixedPortion.statusKind;

    return {
      mode: "hybrid",
      currentBillingType,
      usesFixedBudget: currentBillingType === "fixed_fee" && liveFixedCap > 0,
      isOverBudget: currentBillingType === "fixed_fee" ? fixedPortion.isOverBudget : false,
      statusKind,
      statusLabel: currentBillingType === "hourly"
        ? budgetStatusLabel(hourlyKindNow)
        : fixedPortion.statusLabel,
      consumedPercent: currentBillingType === "hourly"
        ? percentOf(hourlyTotal, nte)
        : percentOf(currentTotalCost, liveFixedCap),
      remainingCents: currentBillingType === "hourly"
        ? remainingOf(nte, hourlyTotal)
        : remainingOf(liveFixedCap, currentTotalCost),
      planningAlert: currentBillingType === "hourly" ? planningAlertFromKind(hourlyKindNow) : "none",
      totalHours: liveHours,
      billableHours: liveBillableHours,
      billableValueCents: liveBillableValue,
      costCents: liveTotal,
      marginCents: liveBillableValue - liveTotal,
      fixedFeeHealth: {
        contractedFee: fixedPortion.contractedFee,
        totalCost: fixedPortion.totalCost,
        isOverBudget: fixedPortion.isOverBudget,
        consumedPercent: fixedPortion.consumedPercent,
        remainingCents: fixedPortion.remainingCents,
        statusLabel: fixedPortion.statusLabel,
      },
    };
  }

  if (currentBillingType === "hourly") {
    const nte = input.notToExceedCents
      ? input.notToExceedCents + approvedAdditionsCents
      : 0;
    const consumedPercent = percentOf(currentTotalCost, nte);
    const kind = hourlyKind(consumedPercent);
    return {
      mode: "hourly",
      currentBillingType,
      usesFixedBudget: false,
      isOverBudget: false,
      statusKind: kind,
      statusLabel: budgetStatusLabel(kind),
      consumedPercent,
      remainingCents: remainingOf(nte, currentTotalCost),
      planningAlert: planningAlertFromKind(kind),
      totalHours: currentHours,
      billableHours: currentBillableHours,
      billableValueCents: currentBillableValue,
      costCents: currentTotalCost,
      marginCents: currentBillableValue - currentTotalCost,
      fixedFeeHealth: null,
    };
  }

  const fixedCap = (input.contractedFee || 0) + approvedAdditionsCents;
  const fixedPortion = evaluateFixedPortion(fixedCap, currentTotalCost);
  return {
    mode: "fixed_fee",
    currentBillingType: "fixed_fee",
    usesFixedBudget: fixedCap > 0,
    isOverBudget: fixedPortion.isOverBudget,
    statusKind: fixedPortion.statusKind,
    statusLabel: fixedPortion.statusLabel,
    consumedPercent: fixedPortion.consumedPercent,
    remainingCents: fixedPortion.remainingCents,
    planningAlert: "none",
    totalHours: currentHours,
    billableHours: currentBillableHours,
    billableValueCents: currentBillableValue,
    costCents: currentTotalCost,
    marginCents: currentBillableValue - currentTotalCost,
    fixedFeeHealth: fixedPortion.contractedFee > 0 ? {
      contractedFee: fixedPortion.contractedFee,
      totalCost: fixedPortion.totalCost,
      isOverBudget: fixedPortion.isOverBudget,
      consumedPercent: fixedPortion.consumedPercent,
      remainingCents: fixedPortion.remainingCents,
      statusLabel: fixedPortion.statusLabel,
    } : null,
  };
}

export function emptyCostSlice(): CostSlice {
  return { ...EMPTY_COSTS };
}

export function addCostSlice(a: CostSlice, b: CostSlice): CostSlice {
  return {
    laborCost: (a.laborCost || 0) + (b.laborCost || 0),
    billableLaborCost: (a.billableLaborCost || 0) + (b.billableLaborCost || 0),
    consultantCost: (a.consultantCost || 0) + (b.consultantCost || 0),
    totalMinutes: (a.totalMinutes || 0) + (b.totalMinutes || 0),
    billableMinutes: (a.billableMinutes || 0) + (b.billableMinutes || 0),
  };
}
