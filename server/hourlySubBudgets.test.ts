import { describe, expect, it } from "vitest";
import { getSubBudgetHealth, type SubBudgetItem } from "../shared/subBudgets";

describe("hourly sub-budget health", () => {
  const withinExisting = (actualCents: number): SubBudgetItem => ({
    id: 1,
    projectId: 10,
    name: "Within-existing hourly scope",
    phase: null,
    description: null,
    status: "approved",
    kind: "within_existing",
    trackingMode: "hourly",
    budgetCents: 20_000,
    baseBudgetCents: 100_000,
    notToExceedCents: null,
    actualCents,
    remainingCents: 100_000 - actualCents,
    totalMinutes: 0,
    billableMinutes: 0,
    laborCostCents: actualCents,
    billableValueCents: actualCents,
    consultantCostCents: 0,
  });

  const hourlyAddition = (actualCents: number, billableValueCents: number): SubBudgetItem => ({
    id: 2,
    projectId: 10,
    name: "Capped hourly addition",
    phase: null,
    description: null,
    status: "approved",
    kind: "approved_addition",
    trackingMode: "hourly",
    budgetCents: 0,
    baseBudgetCents: 100_000,
    notToExceedCents: 100_000,
    actualCents,
    remainingCents: 100_000 - billableValueCents,
    totalMinutes: 0,
    billableMinutes: 0,
    laborCostCents: actualCents - 25_000,
    billableValueCents,
    consultantCostCents: 25_000,
  });

  it("evaluates within-existing hourly work against its parent project's original budget, not its child allocation", () => {
    expect(getSubBudgetHealth(withinExisting(74_000))).toBe("on_budget");
    expect(getSubBudgetHealth(withinExisting(75_000))).toBe("watch_budget");
    expect(getSubBudgetHealth(withinExisting(90_000))).toBe("near_limit");
    expect(getSubBudgetHealth(withinExisting(100_000))).toBe("near_limit");
    expect(getSubBudgetHealth(withinExisting(101_000))).toBe("over_budget");
  });

  it("evaluates an hourly addition's NTE from billable value rather than total labor or consultant cost", () => {
    // Internal labor plus consultant expense exceeds NTE, but only 20% is billable value.
    expect(getSubBudgetHealth(hourlyAddition(150_000, 20_000))).toBe("hourly_within_nte");
    expect(getSubBudgetHealth(hourlyAddition(150_000, 75_000))).toBe("hourly_watch_nte");
    expect(getSubBudgetHealth(hourlyAddition(150_000, 90_000))).toBe("hourly_approaching_nte");
    expect(getSubBudgetHealth(hourlyAddition(150_000, 100_000))).toBe("hourly_approaching_nte");
    expect(getSubBudgetHealth(hourlyAddition(150_000, 101_000))).toBe("hourly_above_nte");
  });
});
