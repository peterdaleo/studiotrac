import { describe, expect, it } from "vitest";
import { evaluateBudgetHealth } from "../shared/billing";
import { appRouter } from "./routers";

describe("evaluateBudgetHealth with approved sub-budget additions", () => {
  it("adds approved additions to an existing fixed-fee budget", () => {
    const health = evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 1_000_000,
      approvedAdditionsCents: 200_000,
      laborCost: 1_080_000,
      consultantCost: 0,
    });

    expect(health.usesFixedBudget).toBe(true);
    expect(health.consumedPercent).toBe(90);
    expect(health.remainingCents).toBe(120_000);
    expect(health.statusKind).toBe("near_limit");
  });

  it("uses an approved addition as the cap for an explicitly fixed-fee zero-fee project", () => {
    const health = evaluateBudgetHealth({
      billingType: "fixed_fee",
      contractedFee: 0,
      approvedAdditionsCents: 100_000,
      laborCost: 25_000,
      consultantCost: 0,
    });

    expect(health.usesFixedBudget).toBe(true);
    expect(health.consumedPercent).toBe(25);
    expect(health.remainingCents).toBe(75_000);
    expect(health.statusKind).toBe("on_budget");
  });

  it("increases an hourly NTE by approved additions but leaves uncapped hourly work uncapped", () => {
    const capped = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      notToExceedCents: 100_000,
      approvedAdditionsCents: 50_000,
      laborCost: 120_000,
      consultantCost: 0,
    });
    expect(capped.consumedPercent).toBe(80);
    expect(capped.remainingCents).toBe(30_000);
    expect(capped.statusKind).toBe("hourly_watch_nte");
    expect(capped.isOverBudget).toBe(false);

    const uncapped = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      approvedAdditionsCents: 50_000,
      laborCost: 120_000,
      consultantCost: 0,
    });
    expect(uncapped.consumedPercent).toBeNull();
    expect(uncapped.remainingCents).toBeNull();
    expect(uncapped.statusKind).toBe("hourly_no_budget");
    expect(uncapped.isOverBudget).toBe(false);
  });

  it("keeps the original historical fixed-fee phase budget unchanged after conversion", () => {
    const health = evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 2_000_000,
      approvedAdditionsCents: 300_000,
      laborCost: 200_000,
      consultantCost: 0,
      phases: [
        {
          billingType: "fixed_fee",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          endedAt: new Date("2026-06-01T00:00:00Z"),
          contractedFee: 2_000_000,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 1_500_000,
            billableLaborCost: 1_500_000,
            consultantCost: 0,
            totalMinutes: 6_000,
            billableMinutes: 6_000,
          },
        },
        {
          billingType: "hourly",
          startedAt: new Date("2026-06-01T00:00:00Z"),
          endedAt: null,
          contractedFee: 0,
          hourlyRateCents: 0,
          notToExceedCents: 0,
          revenueTargetCents: 0,
          costs: {
            laborCost: 200_000,
            billableLaborCost: 200_000,
            consultantCost: 0,
            totalMinutes: 600,
            billableMinutes: 600,
          },
        },
      ],
    });

    expect(health.mode).toBe("hybrid");
    expect(health.fixedFeeHealth).toMatchObject({
      contractedFee: 2_000_000,
      totalCost: 1_500_000,
      remainingCents: 500_000,
    });
    expect(health.statusKind).toBe("hourly_no_budget");
    expect(health.isOverBudget).toBe(false);
  });
});

describe("sub-budget financial router access", () => {
  it("rejects staff from listing or mutating financial sub-budgets", async () => {
    const staff = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 11, role: "user", organizationId: 42, isSuperAdmin: false } as any,
      organizationId: 42,
    });

    await expect(staff.subBudgets.list({ projectId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(staff.subBudgets.create({
      projectId: 7,
      name: "Not authorized",
      phase: null,
      budgetCents: 1,
      kind: "within_existing",
      status: "proposed",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(staff.subBudgets.update({ id: 1, status: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(staff.subBudgets.delete({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
