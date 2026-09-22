import { describe, expect, it } from "vitest";
import {
  addCostSlice,
  budgetStatusLabel,
  costsFallInPhase,
  emptyCostSlice,
  evaluateBudgetHealth,
  inferBillingType,
} from "../shared/billing";

describe("inferBillingType", () => {
  it("treats a missing contract sum as hourly when no explicit type is given", () => {
    expect(inferBillingType(0)).toBe("hourly");
    expect(inferBillingType(null)).toBe("hourly");
    expect(inferBillingType(undefined)).toBe("hourly");
  });

  it("treats a positive contract sum as fixed fee when no explicit type is given", () => {
    expect(inferBillingType(2000000)).toBe("fixed_fee");
  });

  it("honors an explicit billing type even when the fee is empty or set", () => {
    expect(inferBillingType(0, "fixed_fee")).toBe("fixed_fee");
    expect(inferBillingType(500000, "hourly")).toBe("hourly");
  });
});

describe("evaluateBudgetHealth — fixed fee", () => {
  it("never flags a $0 contract as over budget", () => {
    const health = evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 0,
      laborCost: 12500,
      consultantCost: 0,
    });
    expect(health.isOverBudget).toBe(false);
    expect(health.statusKind).toBe("no_budget");
    expect(health.statusLabel).toBe("No budget set");
  });

  it("reports over budget only when spend exceeds a real contract sum", () => {
    const health = evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 100000,
      laborCost: 80000,
      consultantCost: 30000,
    });
    expect(health.isOverBudget).toBe(true);
    expect(health.statusKind).toBe("over_budget");
    expect(health.consumedPercent).toBe(110);
    expect(health.remainingCents).toBe(-10000);
  });

  it("uses near-limit / watch / on-budget thresholds", () => {
    expect(evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 100000,
      laborCost: 92000,
      consultantCost: 0,
    }).statusKind).toBe("near_limit");

    expect(evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 100000,
      laborCost: 80000,
      consultantCost: 0,
    }).statusKind).toBe("watch_budget");

    expect(evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 100000,
      laborCost: 10000,
      consultantCost: 0,
    }).statusKind).toBe("on_budget");
  });
});

describe("evaluateBudgetHealth — hourly", () => {
  it("never sets isOverBudget when a project has no contract sum and costs exist", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      laborCost: 540000,
      consultantCost: 120000,
      totalMinutes: 600,
      billableMinutes: 480,
      billableLaborCost: 480000,
    });
    expect(health.isOverBudget).toBe(false);
    expect(health.usesFixedBudget).toBe(false);
    expect(health.statusKind).toBe("hourly_no_budget");
    expect(health.statusLabel).toBe("Hourly billing — no fixed budget");
    expect(health.planningAlert).toBe("none");
    expect(health.totalHours).toBe(10);
    expect(health.billableHours).toBe(8);
    expect(health.costCents).toBe(660000);
  });

  it("treats a not-to-exceed cap as a planning alert, not a hard over-budget flag", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      laborCost: 110000,
      consultantCost: 0,
      notToExceedCents: 100000,
    });
    expect(health.isOverBudget).toBe(false);
    expect(health.statusKind).toBe("hourly_above_nte");
    expect(health.statusLabel).toBe("Hourly billing — above NTE");
    expect(health.planningAlert).toBe("above_nte");
    expect(health.consumedPercent).toBe(110);
  });

  it("uses billable labor value from team member rates and ignores a project rate", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      laborCost: 10000,
      billableLaborCost: 8000,
      consultantCost: 0,
      billableMinutes: 60,
      hourlyRateCents: 17500,
    });
    expect(health.billableValueCents).toBe(8000);
    expect(health.marginCents).toBe(-2000);
  });
});

describe("evaluateBudgetHealth — hybrid conversion", () => {
  it("does not let later hourly spend exceed the original fixed-fee contract", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 2000000,
      laborCost: 900000,
      consultantCost: 0,
      phases: [
        {
          billingType: "fixed_fee",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: new Date("2026-03-16T00:00:00Z"),
          contractedFee: 2000000,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 1500000,
            billableLaborCost: 1500000,
            consultantCost: 0,
            totalMinutes: 6000,
            billableMinutes: 6000,
          },
        },
        {
          billingType: "hourly",
          startedAt: new Date("2026-03-16T00:00:00Z"),
          endedAt: null,
          contractedFee: 0,
          hourlyRateCents: 17500,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 900000,
            billableLaborCost: 900000,
            consultantCost: 0,
            totalMinutes: 1800,
            billableMinutes: 1800,
          },
        },
      ],
    });

    expect(health.mode).toBe("hybrid");
    expect(health.isOverBudget).toBe(false);
    expect(health.statusKind).toBe("hourly_no_budget");
    expect(health.statusLabel).toBe("Hourly billing — no fixed budget");
    expect(health.fixedFeeHealth).not.toBeNull();
    expect(health.fixedFeeHealth?.contractedFee).toBe(2000000);
    expect(health.fixedFeeHealth?.totalCost).toBe(1500000);
    expect(health.fixedFeeHealth?.isOverBudget).toBe(false);
    expect(health.fixedFeeHealth?.statusLabel).toBe("Watch budget");
  });

  it("still reports over budget on the completed fixed-fee phase if that phase overran", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 100000,
      laborCost: 0,
      consultantCost: 0,
      phases: [
        {
          billingType: "fixed_fee",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: new Date("2026-02-01T00:00:00Z"),
          contractedFee: 100000,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 140000,
            billableLaborCost: 140000,
            consultantCost: 0,
            totalMinutes: 400,
            billableMinutes: 400,
          },
        },
        {
          billingType: "hourly",
          startedAt: new Date("2026-02-01T00:00:00Z"),
          endedAt: null,
          contractedFee: 0,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: emptyCostSlice(),
        },
      ],
    });

    expect(health.isOverBudget).toBe(false);
    expect(health.fixedFeeHealth?.isOverBudget).toBe(true);
    expect(health.fixedFeeHealth?.statusLabel).toBe("Over budget");
  });

  it("evaluates an hourly NTE against later hourly spend only", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 2000000,
      laborCost: 0,
      consultantCost: 0,
      notToExceedCents: 100000,
      phases: [
        {
          billingType: "fixed_fee",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: new Date("2026-03-01T00:00:00Z"),
          contractedFee: 2000000,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 1500000,
            billableLaborCost: 1500000,
            consultantCost: 0,
            totalMinutes: 6000,
            billableMinutes: 6000,
          },
        },
        {
          billingType: "hourly",
          startedAt: new Date("2026-03-01T00:00:00Z"),
          endedAt: null,
          contractedFee: 0,
          hourlyRateCents: 17500,
          notToExceedCents: 100000,
          revenueTargetCents: 0,
          costs: {
            laborCost: 50000,
            billableLaborCost: 50000,
            consultantCost: 0,
            totalMinutes: 120,
            billableMinutes: 120,
          },
        },
      ],
    });

    expect(health.isOverBudget).toBe(false);
    expect(health.statusKind).toBe("hourly_within_nte");
    expect(health.consumedPercent).toBe(50);
    expect(health.costCents).toBe(50000);
    expect(health.fixedFeeHealth?.totalCost).toBe(1500000);
  });
});

describe("phase date assignment", () => {
  it("includes costs on the start date and excludes costs on the end date", () => {
    const phase = {
      startedAt: new Date("2026-03-01T00:00:00Z"),
      endedAt: new Date("2026-03-16T00:00:00Z"),
    };
    expect(costsFallInPhase(new Date("2026-03-01T00:00:00Z"), phase)).toBe(true);
    expect(costsFallInPhase(new Date("2026-03-15T23:59:59Z"), phase)).toBe(true);
    expect(costsFallInPhase(new Date("2026-03-16T00:00:00Z"), phase)).toBe(false);
    expect(costsFallInPhase(new Date("2026-02-28T00:00:00Z"), phase)).toBe(false);
  });
});

describe("cost slice helpers", () => {
  it("adds cost slices without mutating inputs", () => {
    const a = emptyCostSlice();
    const b = { laborCost: 10, billableLaborCost: 8, consultantCost: 5, totalMinutes: 60, billableMinutes: 45 };
    const sum = addCostSlice(a, b);
    expect(sum).toEqual(b);
    expect(a.laborCost).toBe(0);
  });

  it("maps every status kind to a non-empty label", () => {
    expect(budgetStatusLabel("hourly_no_budget")).toContain("Hourly billing");
    expect(budgetStatusLabel("over_budget")).toBe("Over budget");
  });
});
