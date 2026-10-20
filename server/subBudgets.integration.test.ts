import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import * as db from "./db";
import { organizations, users, teamMembers, projects, projectSubBudgets, projectBillingPhases, timeEntries, consultantContracts } from "../drizzle/schema";

// Explicit opt-in; never point this suite at a shared or production database.
const enabled = process.env.SUB_BUDGET_INTEGRATION === "1";
describe.skipIf(!enabled)("sub-budgets — isolated database integration", () => {
  let conn: NonNullable<Awaited<ReturnType<typeof db.getDb>>>;
  let orgId: number;
  let userId: number;
  let projectId: number;
  let otherProjectId: number;
  let admin: ReturnType<typeof appRouter.createCaller>;
  const createdProjects: number[] = [];
  const caller = (role: "admin" | "pm" | "user", organizationId = orgId) => appRouter.createCaller({
    req: {} as any, res: {} as any,
    user: { id: userId, role, organizationId, isSuperAdmin: true } as any,
    organizationId,
  });
  const add = (patch: Record<string, unknown> = {}) => admin.subBudgets.create({
    projectId, name: "ASR — lobby", phase: "construction_documents", description: "Additional scope",
    budgetCents: 100_000, kind: "approved_addition", status: "proposed", ...patch,
  } as any);

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "mysql://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) {
      throw new Error("Integration suite requires a localhost database with 'test' in its name");
    }
    conn = (await db.getDb())!;
    const unique = `subbudget-test-${Date.now()}`;
    orgId = (await conn.insert(organizations).values({ name: unique, slug: unique }))[0].insertId;
    userId = (await conn.insert(users).values({ openId: unique, name: unique, organizationId: orgId, role: "admin" }))[0].insertId;
    await conn.insert(teamMembers).values({ organizationId: orgId, userId, name: unique, billingRate: 10_000 });
    admin = caller("admin");
    projectId = (await db.createProject({ name: unique, contractedFee: 1_000_000, billingType: "fixed_fee", status: "completed", startDate: new Date("2026-01-01") }, orgId)).id;
    otherProjectId = (await db.createProject({ name: `${unique}-other`, contractedFee: 500_000, billingType: "fixed_fee" }, orgId)).id;
    createdProjects.push(projectId, otherProjectId);
  }, 30_000);

  afterAll(async () => {
    if (!conn || !orgId) return;
    for (const id of createdProjects) {
      await conn.delete(timeEntries).where(eq(timeEntries.projectId, id));
      await conn.delete(consultantContracts).where(eq(consultantContracts.projectId, id));
      await conn.delete(projectSubBudgets).where(eq(projectSubBudgets.projectId, id));
      await conn.delete(projectBillingPhases).where(eq(projectBillingPhases.projectId, id));
      await conn.delete(projects).where(eq(projects.id, id));
    }
    await conn.delete(teamMembers).where(eq(teamMembers.organizationId, orgId));
    await conn.delete(users).where(eq(users.id, userId));
    await conn.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("tracks completed-project ASRs, excludes proposals, counts each cost once, and preserves history", async () => {
    const originalProject = await db.getProject(projectId);
    const history = await db.listProjectBillingPhases(projectId);
    const allocation = await add({ name: "CD original allocation", kind: "within_existing", status: "approved", budgetCents: 200_000 });
    const first = await add({ name: "CD ASR 1", status: "approved" });
    const second = await add({ name: "CD ASR 2", budgetCents: 300_000 });
    let summary = await admin.subBudgets.list({ projectId });
    expect(summary.items).toHaveLength(3);
    expect(summary.originalBudgetCents).toBe(1_000_000);
    expect(summary.approvedAdditionsCents).toBe(100_000);
    expect(summary.approvedBudgetCents).toBe(1_100_000);
    await expect(add({ name: "Unapproved completed ASR", status: "complete" })).rejects.toThrow("Approve an addition");
    await expect(admin.subBudgets.update({ id: second.id, status: "complete" })).rejects.toThrow("Approve an addition");
    expect((await admin.subBudgets.list({ projectId })).approvedBudgetCents).toBe(1_100_000);

    const entry = await admin.timeEntries.create({ projectId, subBudgetId: first.id, startTime: new Date("2026-10-01T09:00:00Z"), endTime: new Date("2026-10-01T10:00:00Z"), durationMinutes: 60, billable: true });
    await admin.timeEntries.create({ projectId, startTime: new Date("2026-10-01T10:00:00Z"), endTime: new Date("2026-10-01T10:30:00Z"), durationMinutes: 30, billable: true });
    const consultant = await admin.consultants.create({ projectId, subBudgetId: first.id, name: "ASR consultant", discipline: "Structure", contractAmount: 25_000 });
    summary = await admin.subBudgets.list({ projectId });
    expect(summary.items.find(item => item.id === first.id)).toMatchObject({ actualCents: 35_000, remainingCents: 65_000 });
    const burn = await admin.timeAnalytics.projectBurnRate({ projectId });
    expect(burn.laborCost + burn.consultantCost).toBe(40_000);
    expect(burn.contractedFee).toBe(1_100_000);
    expect(burn.budgetHealth?.remainingCents).toBe(1_060_000);
    const batch = await admin.timeAnalytics.allProjectsBudgetSummary();
    expect(batch.find(row => row.projectId === projectId)).toMatchObject({ contractedFee: 1_100_000, totalCost: 40_000 });
    await expect(admin.subBudgets.delete({ id: first.id })).rejects.toThrow();
    await expect(admin.timeEntries.update({ id: entry.id, projectId: otherProjectId })).rejects.toThrow();
    await expect(admin.timeEntries.update({ id: entry.id, subBudgetId: second.id + 999_999 })).rejects.toThrow();

    await admin.timeEntries.update({ id: entry.id, subBudgetId: allocation.id });
    await admin.consultants.update({ id: consultant.id, subBudgetId: allocation.id });
    summary = await admin.subBudgets.list({ projectId });
    expect(summary.items.find(item => item.id === first.id)?.actualCents).toBe(0);
    expect(summary.items.find(item => item.id === allocation.id)?.actualCents).toBe(35_000);
    const afterReassign = await admin.timeAnalytics.projectBurnRate({ projectId });
    expect(afterReassign.laborCost + afterReassign.consultantCost).toBe(40_000);
    await admin.subBudgets.update({ id: first.id, status: "complete", description: "" });
    expect((await admin.subBudgets.list({ projectId })).approvedBudgetCents).toBe(1_100_000);
    await admin.subBudgets.update({ id: second.id, status: "approved" });
    expect((await admin.subBudgets.list({ projectId })).approvedBudgetCents).toBe(1_400_000);
    expect(await db.getProject(projectId)).toMatchObject({ status: "completed", contractedFee: originalProject!.contractedFee, billingType: originalProject!.billingType });
    expect(await db.listProjectBillingPhases(projectId)).toEqual(history);
  });

  it("allows PM financial access but gives staff label metadata only and rejects cross-workspace access", async () => {
    expect((await caller("pm").subBudgets.list({ projectId })).items.length).toBeGreaterThan(0);
    await expect(caller("user").subBudgets.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").subBudgets.create({ projectId, name: "No", phase: null, budgetCents: 1, kind: "within_existing", status: "proposed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const options = await caller("user").subBudgets.options({ projectId });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(Object.keys(option).sort()).toEqual(["id", "name", "phase", "status"]);
    await expect(caller("admin", orgId + 999_999).subBudgets.list({ projectId })).rejects.toThrow();
    await expect(caller("user", orgId + 999_999).subBudgets.options({ projectId })).rejects.toThrow();
    await expect(caller("admin", orgId + 999_999).timeEntries.create({ projectId, durationMinutes: 5, startTime: new Date(), endTime: new Date() })).rejects.toThrow();
  });

  it("preserves hourly no-cap behavior and applies additions to an existing hourly NTE", async () => {
    const hourlyId = (await db.createProject({ name: "Hourly integration", billingType: "hourly", contractedFee: 0 }, orgId)).id;
    const nteId = (await db.createProject({ name: "Hourly NTE integration", billingType: "hourly", contractedFee: 0, notToExceedCents: 500_000 }, orgId)).id;
    createdProjects.push(hourlyId, nteId);
    for (const id of [hourlyId, nteId]) await admin.subBudgets.create({ projectId: id, name: "ASR", phase: null, description: "Custom", budgetCents: 100_000, kind: "approved_addition", status: "approved" });
    const unlimited = await admin.timeAnalytics.projectBurnRate({ projectId: hourlyId });
    expect(unlimited.billingType).toBe("hourly");
    expect(unlimited.notToExceedCents).toBe(0);
    expect(unlimited.budgetHealth?.consumedPercent).toBeNull();
    expect(unlimited.budgetHealth?.isOverBudget).toBe(false);
    const limited = await admin.timeAnalytics.projectBurnRate({ projectId: nteId });
    expect(limited.notToExceedCents).toBe(600_000);
    expect((await db.getProject(nteId))?.notToExceedCents).toBe(500_000);
  });

  it("uses an approved addition as the cap on an explicitly fixed-fee zero-fee project", async () => {
    const id = (await db.createProject({ name: "Fixed zero integration", billingType: "fixed_fee", contractedFee: 0 }, orgId)).id;
    createdProjects.push(id);
    await admin.subBudgets.create({ projectId: id, name: "First ASR", phase: null, budgetCents: 100_000, kind: "approved_addition", status: "approved" });
    const burn = await admin.timeAnalytics.projectBurnRate({ projectId: id });
    expect(burn.contractedFee).toBe(100_000);
    expect(burn.budgetHealth?.usesFixedBudget).toBe(true);
    expect(burn.budgetHealth?.remainingCents).toBe(100_000);
    expect((await db.getProject(id))?.contractedFee).toBe(0);
  });

  it("attributes timers and supports existing consultant rows without an organization stamp", async () => {
    const option = (await admin.subBudgets.options({ projectId }))[0];
    const legacyId = (await conn.insert(consultantContracts).values({ projectId, organizationId: null, name: "Legacy consultant", discipline: "Existing", contractAmount: 1_000 }))[0].insertId;
    await admin.consultants.update({ id: legacyId, subBudgetId: option.id });
    const [legacy] = await conn.select().from(consultantContracts).where(eq(consultantContracts.id, legacyId));
    expect(legacy.subBudgetId).toBe(option.id);
    expect(legacy.organizationId).toBeNull();
    await admin.timeEntries.startTimer({ projectId, subBudgetId: option.id, description: "ASR timer" });
    const timer = await admin.timeEntries.activeTimer();
    expect(timer).toMatchObject({ projectId, subBudgetId: option.id });
    await admin.timeEntries.stopTimer({ id: timer!.id });
    expect(await admin.timeEntries.activeTimer()).toBeUndefined();
    expect((await db.getProject(projectId))?.status).toBe("completed");
  });

  it("never leaves dangling attribution when deletion races a new cost assignment", async () => {
    for (let i = 0; i < 3; i++) {
      const budget = await add({ name: `Race ${i}` });
      const [assigned, deleted] = await Promise.allSettled([
        admin.timeEntries.create({ projectId, subBudgetId: budget.id, startTime: new Date(), endTime: new Date(), durationMinutes: 1 }),
        admin.subBudgets.delete({ id: budget.id }),
      ]);
      expect(assigned.status === "fulfilled" && deleted.status === "fulfilled").toBe(false);
      const budgets = await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, budget.id));
      const entries = await conn.select().from(timeEntries).where(eq(timeEntries.subBudgetId, budget.id));
      expect(entries.length === 0 || budgets.length === 1).toBe(true);
    }
  });
});
