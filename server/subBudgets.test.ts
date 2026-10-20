import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { evaluateBudgetHealth } from "../shared/billing";
import { getSubBudgetHealth, toSubBudgetStatusItem } from "../shared/subBudgets";
import * as db from "./db";
import { appRouter } from "./routers";

afterEach(() => vi.restoreAllMocks());

describe("sub-budget health and safe status projection", () => {
  const health = (status: "proposed" | "approved" | "complete", budgetCents: number, actualCents: number) =>
    getSubBudgetHealth({ status, budgetCents, actualCents });

  it("uses proposed first, reports zero budgets, and matches rounded fixed-fee thresholds", () => {
    expect(health("proposed", 0, 0)).toBe("proposed");
    expect(health("approved", 0, 900)).toBe("no_budget");
    expect(health("approved", 1000, 744)).toBe("on_budget");
    expect(health("approved", 1000, 745)).toBe("watch_budget");
    expect(health("approved", 1000, 894)).toBe("watch_budget");
    expect(health("approved", 1000, 895)).toBe("near_limit");
    expect(health("approved", 1000, 1000)).toBe("near_limit");
    expect(health("approved", 1000, 1010)).toBe("over_budget");
  });

  it("does not force completed items to 100% and uses allocation consumption, independent of billing type", () => {
    expect(health("complete", 1000, 500)).toBe("on_budget");
    expect(health("complete", 1000, 1200)).toBe("over_budget");
  });

  it("returns only explicitly allowlisted fields, even if the source has financial extras", () => {
    const item = {
      id: 5,
      name: "Design",
      status: "approved" as const,
      phase: "schematic_design" as const,
      projectId: 9,
      description: "private details",
      budgetCents: 100_000,
      kind: "approved_addition" as const,
      actualCents: 95_000,
      remainingCents: 5_000,
      percent: 95,
      projectTotal: 400_000,
    };
    const result = toSubBudgetStatusItem(item);
    expect(result).toEqual({ id: 5, name: "Design", status: "approved", health: "near_limit" });
    expect(Object.keys(result).sort()).toEqual(["health", "id", "name", "status"]);
  });
});

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

  it("allows authenticated staff to read only the status projection and still blocks financial list access", async () => {
    const staff = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 11, role: "user", organizationId: 42, isSuperAdmin: false } as any,
      organizationId: 42,
    });
    const item = {
      id: 5, name: "Design", phase: null, status: "approved" as const,
      projectId: 7, description: "internal", budgetCents: 100_000,
      kind: "within_existing" as const, actualCents: 80_000, remainingCents: 20_000,
    };
    const assertOwnership = vi.spyOn(db, "assertProjectInOrganization").mockResolvedValue({} as any);
    const listBudgets = vi.spyOn(db, "listProjectSubBudgets").mockResolvedValue({
      items: [item], originalBudgetCents: 100_000, approvedAdditionsCents: 0, approvedBudgetCents: 100_000,
    });

    await expect(staff.subBudgets.status({ projectId: 7 })).resolves.toEqual([
      { id: 5, name: "Design", status: "approved", health: "watch_budget" },
    ]);
    expect(assertOwnership).toHaveBeenCalledWith(7, 42);
    expect(listBudgets).toHaveBeenCalledWith(7, 42);
    await expect(staff.subBudgets.list({ projectId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects unauthenticated status queries", async () => {
    const anonymous = appRouter.createCaller({ req: {} as any, res: {} as any, user: null as any, organizationId: null });
    await expect(anonymous.subBudgets.status({ projectId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("stops before listing when the project is outside the authenticated organization", async () => {
    const staff = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 11, role: "user", organizationId: 42, isSuperAdmin: false } as any,
      organizationId: 42,
    });
    const assertOwnership = vi.spyOn(db, "assertProjectInOrganization").mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    const listBudgets = vi.spyOn(db, "listProjectSubBudgets");

    await expect(staff.subBudgets.status({ projectId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assertOwnership).toHaveBeenCalledWith(7, 42);
    expect(listBudgets).not.toHaveBeenCalled();
  });

  it("preserves admin and PM access to the full financial list", async () => {
    const summary = { items: [], originalBudgetCents: 123, approvedAdditionsCents: 4, approvedBudgetCents: 127 };
    const listBudgets = vi.spyOn(db, "listProjectSubBudgets").mockResolvedValue(summary);
    for (const role of ["admin", "pm"] as const) {
      const authorized = appRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: { id: 11, role, organizationId: 42, isSuperAdmin: false } as any,
        organizationId: 42,
      });
      await expect(authorized.subBudgets.list({ projectId: 7 })).resolves.toEqual(summary);
    }
    expect(listBudgets).toHaveBeenCalledTimes(2);
  });
});
