import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import * as db from "./db";
import { getSubBudgetHealth } from "../shared/subBudgets";
import {
  organizations,
  users,
  teamMembers,
  projects,
  projectSubBudgets,
  projectBillingPhases,
  timeEntries,
  consultantContracts,
} from "../drizzle/schema";

// Explicit opt-in; never point this suite at a shared or production database.
const enabled = process.env.SUB_BUDGET_INTEGRATION === "1";
describe.skipIf(!enabled)("sub-budgets — isolated database integration", () => {
  let conn: NonNullable<Awaited<ReturnType<typeof db.getDb>>>;
  let orgId: number;
  let userId: number;
  let secondUserId: number;
  let projectId: number;
  let otherProjectId: number;
  let admin: ReturnType<typeof appRouter.createCaller>;
  const createdProjects: number[] = [];
  const createdUserIds: number[] = [];
  const caller = (role: "admin" | "pm" | "user", organizationId = orgId) => appRouter.createCaller({
    req: {} as any,
    res: {} as any,
    user: { id: userId, role, organizationId, isSuperAdmin: true } as any,
    organizationId,
  });
  const add = (patch: Record<string, unknown> = {}) => admin.subBudgets.create({
    projectId,
    name: "ASR — lobby",
    phase: "construction_documents",
    description: "Additional scope",
    budgetCents: 100_000,
    kind: "approved_addition",
    ...patch,
  } as any);
  const makeProject = async (name: string, patch: Record<string, unknown> = {}) => {
    const project = await db.createProject({ name, ...patch } as any, orgId);
    createdProjects.push(project.id);
    return project.id;
  };
  const insertLegacyBudget = async (patch: Partial<typeof projectSubBudgets.$inferInsert> & Pick<typeof projectSubBudgets.$inferInsert, "projectId" | "name" | "kind" | "status">) => {
    const result = await conn.insert(projectSubBudgets).values({
      organizationId: orgId,
      phase: "construction_documents",
      description: "Legacy DB state",
      budgetCents: 100_000,
      trackingMode: "fixed_amount",
      notToExceedCents: null,
      ...patch,
    });
    return Number(result[0].insertId);
  };
  const insertLabor = async (project: number, memberUserId: number, minutes: number, options: {
    subBudgetId?: number | null;
    billable?: boolean;
  } = {}) => {
    const startTime = new Date(Date.now() + 60_000);
    const endTime = new Date(startTime.getTime() + minutes * 60_000);
    const result = await conn.insert(timeEntries).values({
      organizationId: orgId,
      userId: memberUserId,
      projectId: project,
      subBudgetId: options.subBudgetId ?? null,
      description: "Integration test labor",
      startTime,
      endTime,
      durationMinutes: minutes,
      billable: options.billable ?? true,
    });
    return Number(result[0].insertId);
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || "mysql://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("test")) {
      throw new Error("Integration suite requires a localhost database with 'test' in its name");
    }
    conn = (await db.getDb())!;
    const unique = `subbudget-test-${Date.now()}`;
    orgId = Number((await conn.insert(organizations).values({ name: unique, slug: unique }))[0].insertId);
    userId = Number((await conn.insert(users).values({ openId: `${unique}-admin`, name: `${unique}-admin`, organizationId: orgId, role: "admin" }))[0].insertId);
    secondUserId = Number((await conn.insert(users).values({ openId: `${unique}-worker2`, name: `${unique}-worker2`, organizationId: orgId, role: "user" }))[0].insertId);
    createdUserIds.push(userId, secondUserId);
    await conn.insert(teamMembers).values([
      { organizationId: orgId, userId, name: `${unique}-worker1`, billingRate: 10_000 },
      { organizationId: orgId, userId: secondUserId, name: `${unique}-worker2`, billingRate: 20_000 },
    ]);
    admin = caller("admin");
    projectId = await makeProject(unique, {
      contractedFee: 1_000_000,
      billingType: "fixed_fee",
      status: "completed",
      startDate: new Date("2026-01-01"),
    });
    otherProjectId = await makeProject(`${unique}-other`, { contractedFee: 500_000, billingType: "fixed_fee" });
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
    for (const id of createdUserIds) await conn.delete(users).where(eq(users.id, id));
    await conn.delete(organizations).where(eq(organizations.id, orgId));
  });

  it("keeps fixed-fee additions, legacy proposal states, cost attribution and history intact", async () => {
    const originalProject = await db.getProject(projectId);
    const history = await db.listProjectBillingPhases(projectId);
    const allocation = await add({ name: "CD original allocation", kind: "within_existing", budgetCents: 200_000 });
    // The API no longer accepts a lifecycle status: new records are approved even if a caller supplies the old field.
    const first = await add({ name: "CD ASR 1", status: "proposed" });
    const second = await add({ name: "CD ASR 2", budgetCents: 300_000 });
    const legacyProposalId = await insertLegacyBudget({
      projectId,
      name: "Legacy proposal",
      kind: "approved_addition",
      status: "proposed",
      budgetCents: 900_000,
    });
    const legacyCompleteId = await insertLegacyBudget({
      projectId,
      name: "Legacy completed allocation",
      kind: "within_existing",
      status: "complete",
      budgetCents: 25_000,
    });
    expect((await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, first.id)))[0].status).toBe("approved");
    expect((await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, second.id)))[0].status).toBe("approved");
    expect((await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, legacyCompleteId)))[0].status).toBe("complete");

    // Status is not an API control. A status-like extra field must not approve an existing legacy proposal.
    await admin.subBudgets.update({ id: legacyProposalId, name: "Legacy proposal retained", status: "approved" } as any);
    expect((await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, legacyProposalId)))[0].status).toBe("proposed");
    await admin.subBudgets.update({ id: first.id, description: "ordinary edit", status: "complete" } as any);
    expect((await conn.select().from(projectSubBudgets).where(eq(projectSubBudgets.id, first.id)))[0].status).toBe("approved");

    let summary = await admin.subBudgets.list({ projectId });
    expect(summary.items).toHaveLength(5);
    expect(summary.originalBudgetCents).toBe(1_000_000);
    expect(summary.approvedAdditionsCents).toBe(400_000);
    expect(summary.approvedBudgetCents).toBe(1_400_000);
    expect(summary.items.find((item) => item.id === legacyProposalId)?.status).toBe("proposed");

    const entry = await admin.timeEntries.create({ projectId, subBudgetId: first.id, startTime: new Date("2026-10-01T09:00:00Z"), endTime: new Date("2026-10-01T10:00:00Z"), durationMinutes: 60, billable: true });
    await admin.timeEntries.create({ projectId, startTime: new Date("2026-10-01T10:00:00Z"), endTime: new Date("2026-10-01T10:30:00Z"), durationMinutes: 30, billable: true });
    const consultant = await admin.consultants.create({ projectId, subBudgetId: first.id, name: "ASR consultant", discipline: "Structure", contractAmount: 25_000 });
    summary = await admin.subBudgets.list({ projectId });
    expect(summary.items.find((item) => item.id === first.id)).toMatchObject({ actualCents: 35_000, remainingCents: 65_000 });
    const burn = await admin.timeAnalytics.projectBurnRate({ projectId });
    expect(burn.laborCost + burn.consultantCost).toBe(40_000);
    expect(burn.contractedFee).toBe(1_400_000);
    expect(burn.budgetHealth?.remainingCents).toBe(1_360_000);
    const batch = await admin.timeAnalytics.allProjectsBudgetSummary();
    const batchRow = batch.find((row) => row.projectId === projectId)!;
    expect(batchRow).toMatchObject({ contractedFee: 1_400_000, totalCost: 40_000 });
    expect(batchRow.budgetHealth).toMatchObject({ costCents: burn.budgetHealth?.costCents, budgetCostCents: burn.budgetHealth?.budgetCostCents });
    await expect(admin.subBudgets.delete({ id: first.id })).rejects.toThrow();
    await expect(admin.timeEntries.update({ id: entry.id, projectId: otherProjectId })).rejects.toThrow();
    await expect(admin.timeEntries.update({ id: entry.id, subBudgetId: second.id + 999_999 })).rejects.toThrow();

    await admin.timeEntries.update({ id: entry.id, subBudgetId: allocation.id });
    await admin.consultants.update({ id: consultant.id, subBudgetId: allocation.id });
    summary = await admin.subBudgets.list({ projectId });
    expect(summary.items.find((item) => item.id === first.id)?.actualCents).toBe(0);
    expect(summary.items.find((item) => item.id === allocation.id)?.actualCents).toBe(35_000);
    const afterReassign = await admin.timeAnalytics.projectBurnRate({ projectId });
    expect(afterReassign.laborCost + afterReassign.consultantCost).toBe(40_000);
    expect(await db.getProject(projectId)).toMatchObject({ status: "completed", contractedFee: originalProject!.contractedFee, billingType: originalProject!.billingType });
    expect(await db.listProjectBillingPhases(projectId)).toEqual(history);
  });

  it("keeps within-existing fixed work on the original fixed-fee project cap near and over the base", async () => {
    const nearProjectId = await makeProject("Fixed near-base regression", { billingType: "fixed_fee", contractedFee: 100_000 });
    const overProjectId = await makeProject("Fixed over-base regression", { billingType: "fixed_fee", contractedFee: 100_000 });
    const nearBudget = await admin.subBudgets.create({ projectId: nearProjectId, name: "Small allocation", phase: null, budgetCents: 10_000, kind: "within_existing", trackingMode: "fixed_amount" });
    const overBudget = await admin.subBudgets.create({ projectId: overProjectId, name: "Small allocation", phase: null, budgetCents: 10_000, kind: "within_existing", trackingMode: "fixed_amount" });
    await insertLabor(nearProjectId, userId, 540, { subBudgetId: nearBudget.id }); // 90,000 cents at this worker's rate.
    await insertLabor(overProjectId, userId, 606, { subBudgetId: overBudget.id }); // 101,000 cents.

    const nearBurn = await admin.timeAnalytics.projectBurnRate({ projectId: nearProjectId });
    expect(nearBurn.budgetHealth).toMatchObject({ consumedPercent: 90, statusKind: "near_limit", isOverBudget: false, remainingCents: 10_000 });
    expect(nearBurn.budgetHealth?.budgetCostCents).toBe(90_000);
    const overBurn = await admin.timeAnalytics.projectBurnRate({ projectId: overProjectId });
    expect(overBurn.budgetHealth).toMatchObject({ consumedPercent: 101, statusKind: "over_budget", isOverBudget: true, remainingCents: -1_000 });
  });

  it("applies hourly NTE growth only to capped additions and separates total cost from capped spend", async () => {
    const cappedId = await makeProject("Hourly capped sub-budget", { billingType: "hourly", contractedFee: 0, notToExceedCents: 100_000 });
    const withinId = await admin.subBudgets.create({ projectId: cappedId, name: "Within-existing hourly work", phase: null, budgetCents: 25_000, kind: "within_existing", trackingMode: "hourly" });
    const capped = await admin.subBudgets.create({ projectId: cappedId, name: "Capped hourly addition", phase: null, budgetCents: 0, kind: "approved_addition", trackingMode: "hourly", notToExceedCents: 50_000 });
    const uncapped = await admin.subBudgets.create({ projectId: cappedId, name: "Uncapped hourly addition", phase: null, budgetCents: 0, kind: "approved_addition", trackingMode: "hourly", notToExceedCents: null });

    // Base work and the within-existing allocation consume the original NTE; only the capped addition adds to it.
    await insertLabor(cappedId, userId, 30);
    await insertLabor(cappedId, userId, 30, { subBudgetId: withinId.id });
    await insertLabor(cappedId, userId, 60, { subBudgetId: capped.id });
    await insertLabor(cappedId, secondUserId, 30, { subBudgetId: uncapped.id, billable: false });
    await admin.consultants.create({ projectId: cappedId, subBudgetId: uncapped.id, name: "Uncapped consultant", discipline: "Structure", contractAmount: 7_000 });

    const summary = await admin.subBudgets.list({ projectId: cappedId });
    expect(summary.originalBudgetCents).toBe(100_000);
    expect(summary.approvedAdditionsCents).toBe(50_000);
    expect(summary.approvedBudgetCents).toBe(150_000);
    const withinItem = summary.items.find((item) => item.id === withinId.id)!;
    expect(withinItem).toMatchObject({ actualCents: 5_000, baseBudgetCents: 100_000, budgetCents: 25_000, remainingCents: 95_000 });
    expect(getSubBudgetHealth(withinItem)).toBe("on_budget");
    const cappedItem = summary.items.find((item) => item.id === capped.id)!;
    expect(cappedItem).toMatchObject({ notToExceedCents: 50_000, actualCents: 10_000, billableValueCents: 10_000 });
    expect(getSubBudgetHealth(cappedItem)).toBe("hourly_within_nte");
    const uncappedItem = summary.items.find((item) => item.id === uncapped.id)!;
    expect(uncappedItem).toMatchObject({ actualCents: 17_000, laborCostCents: 10_000, consultantCostCents: 7_000, billableValueCents: 0 });
    expect(getSubBudgetHealth(uncappedItem)).toBe("hourly_no_budget");

    const burn = await admin.timeAnalytics.projectBurnRate({ projectId: cappedId });
    expect(burn.notToExceedCents).toBe(150_000);
    expect(burn.laborCost).toBe(30_000);
    expect(burn.billableLaborCost).toBe(20_000);
    expect(burn.consultantCost).toBe(7_000);
    expect(burn.budgetHealth).toMatchObject({
      costCents: 37_000,
      budgetCostCents: 20_000,
      consumedPercent: 13,
      remainingCents: 130_000,
      isOverBudget: false,
    });
    expect(burn.budgetHealth?.costCents).toBe(burn.laborCost + burn.consultantCost);
    const row = (await admin.timeAnalytics.allProjectsBudgetSummary()).find((item) => item.projectId === cappedId)!;
    expect(row).toMatchObject({ notToExceedCents: 150_000, totalCost: 37_000 });
    expect(row.budgetHealth).toMatchObject({ costCents: burn.budgetHealth?.costCents, budgetCostCents: burn.budgetHealth?.budgetCostCents, consumedPercent: burn.budgetHealth?.consumedPercent });
  });

  it("keeps hourly projects without an original NTE uncapped despite fixed additions", async () => {
    const id = await makeProject("No-original-NTE hourly project", { billingType: "hourly", contractedFee: 0, notToExceedCents: 0 });
    const fixedAddition = await admin.subBudgets.create({ projectId: id, name: "Fixed addition", phase: null, budgetCents: 80_000, kind: "approved_addition", trackingMode: "fixed_amount" });
    const hourlyAddition = await admin.subBudgets.create({ projectId: id, name: "Capped hourly addition", phase: null, budgetCents: 0, kind: "approved_addition", trackingMode: "hourly", notToExceedCents: 40_000 });
    await insertLabor(id, userId, 60, { subBudgetId: fixedAddition.id });
    await insertLabor(id, userId, 30, { subBudgetId: hourlyAddition.id });

    const summary = await admin.subBudgets.list({ projectId: id });
    expect(summary.originalBudgetCents).toBe(0);
    expect(summary.approvedBudgetCents).toBe(0);
    const burn = await admin.timeAnalytics.projectBurnRate({ projectId: id });
    expect(burn.notToExceedCents).toBe(0);
    expect(burn.approvedBudgetCents).toBe(0);
    expect(burn.budgetHealth).toMatchObject({ statusKind: "hourly_no_budget", consumedPercent: null, remainingCents: null, isOverBudget: false, costCents: 15_000 });
  });

  it("excludes an active timer, keeps proposed hourly costs outside the cap, and preserves fixed legacy cost treatment", async () => {
    const id = await makeProject("Legacy proposal and active timer", { billingType: "fixed_fee", contractedFee: 100_000 });
    const fixedProposalId = await insertLegacyBudget({ projectId: id, name: "Legacy fixed proposal", kind: "approved_addition", status: "proposed", budgetCents: 50_000, trackingMode: "fixed_amount" });
    const hourlyProposalId = await insertLegacyBudget({ projectId: id, name: "Legacy hourly proposal", kind: "approved_addition", status: "proposed", budgetCents: 0, trackingMode: "hourly", notToExceedCents: 80_000 });
    await insertLabor(id, userId, 60, { subBudgetId: fixedProposalId });
    await insertLabor(id, userId, 60, { subBudgetId: hourlyProposalId });

    const beforeTimer = await admin.timeAnalytics.projectBurnRate({ projectId: id });
    expect(beforeTimer.budgetHealth).toMatchObject({ costCents: 20_000, budgetCostCents: 10_000 });
    await admin.timeEntries.startTimer({ projectId: id, subBudgetId: fixedProposalId, description: "Unfinished timer" });
    const whileRunning = await admin.timeAnalytics.projectBurnRate({ projectId: id });
    expect(whileRunning.budgetHealth?.costCents).toBe(beforeTimer.budgetHealth?.costCents);
    expect(whileRunning.budgetHealth?.budgetCostCents).toBe(beforeTimer.budgetHealth?.budgetCostCents);
    const active = await admin.timeEntries.activeTimer();
    expect(active).toMatchObject({ projectId: id, subBudgetId: fixedProposalId });
    await admin.timeEntries.stopTimer({ id: active!.id });
  });

  it("preserves fixed billing history and completed status when converting to hourly", async () => {
    const id = await makeProject("Converted completed project", { billingType: "fixed_fee", contractedFee: 250_000, status: "completed", startDate: new Date("2026-01-01") });
    const fixedAddition = await admin.subBudgets.create({ projectId: id, name: "Prior fixed addition", phase: null, budgetCents: 20_000, kind: "approved_addition" });
    const before = await db.listProjectBillingPhases(id);
    await admin.projects.update({ id, billingType: "hourly", contractedFee: 250_000, notToExceedCents: 0, billingChangeDate: new Date("2026-07-01T00:00:00Z"), billingChangeNotes: "Historical conversion test" });
    const after = await db.listProjectBillingPhases(id);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ billingType: "fixed_fee", contractedFee: 250_000 });
    expect(after[0].startedAt).toEqual(before[0].startedAt);
    expect(after[0].endedAt).not.toBeNull();
    expect(after[1]).toMatchObject({ billingType: "hourly", contractedFee: 0, notToExceedCents: 0 });
    expect((await db.getProject(id))?.status).toBe("completed");
    expect((await db.getProject(id))?.contractedFee).toBe(250_000);
    // A historical fixed amount addition cannot create an hourly cap when the project had no original NTE.
    expect((await admin.subBudgets.list({ projectId: id })).approvedBudgetCents).toBe(0);
    expect((await admin.timeAnalytics.projectBurnRate({ projectId: id })).budgetHealth).toMatchObject({ statusKind: "hourly_no_budget", consumedPercent: null, isOverBudget: false });
    expect(fixedAddition.id).toBeGreaterThan(0);
  });

  it("allows PM financial access but gives staff label metadata only and rejects cross-workspace access", async () => {
    expect((await caller("pm").subBudgets.list({ projectId })).items.length).toBeGreaterThan(0);
    await expect(caller("user").subBudgets.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("user").subBudgets.create({ projectId, name: "No", phase: null, budgetCents: 1, kind: "within_existing" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const options = await caller("user").subBudgets.options({ projectId });
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(Object.keys(option).sort()).toEqual(["id", "name", "phase", "status"]);
    await expect(caller("admin", orgId + 999_999).subBudgets.list({ projectId })).rejects.toThrow();
    await expect(caller("user", orgId + 999_999).subBudgets.options({ projectId })).rejects.toThrow();
    await expect(caller("admin", orgId + 999_999).timeEntries.create({ projectId, durationMinutes: 5, startTime: new Date(), endTime: new Date() })).rejects.toThrow();
  });

  it("preserves hourly no-cap behavior and adds a capped approved hourly addition to an existing NTE", async () => {
    const hourlyId = await makeProject("Hourly integration", { billingType: "hourly", contractedFee: 0, notToExceedCents: 0 });
    const nteId = await makeProject("Hourly NTE integration", { billingType: "hourly", contractedFee: 0, notToExceedCents: 500_000 });
    await admin.subBudgets.create({ projectId: hourlyId, name: "Uncapped ASR", phase: null, description: "Custom", budgetCents: 50_000, kind: "approved_addition", trackingMode: "fixed_amount" });
    await admin.subBudgets.create({ projectId: nteId, name: "Capped hourly ASR", phase: null, description: "Custom", budgetCents: 0, kind: "approved_addition", trackingMode: "hourly", notToExceedCents: 100_000 });
    const unlimited = await admin.timeAnalytics.projectBurnRate({ projectId: hourlyId });
    expect(unlimited.billingType).toBe("hourly");
    expect(unlimited.notToExceedCents).toBe(0);
    expect(unlimited.budgetHealth?.consumedPercent).toBeNull();
    expect(unlimited.budgetHealth?.isOverBudget).toBe(false);
    const limited = await admin.timeAnalytics.projectBurnRate({ projectId: nteId });
    expect(limited.notToExceedCents).toBe(600_000);
    expect(limited.approvedBudgetCents).toBe(600_000);
    expect((await db.getProject(nteId))?.notToExceedCents).toBe(500_000);
  });

  it("uses an approved addition as the cap on an explicitly fixed-fee zero-fee project", async () => {
    const id = await makeProject("Fixed zero integration", { billingType: "fixed_fee", contractedFee: 0 });
    await admin.subBudgets.create({ projectId: id, name: "First ASR", phase: null, budgetCents: 100_000, kind: "approved_addition" });
    const burn = await admin.timeAnalytics.projectBurnRate({ projectId: id });
    expect(burn.contractedFee).toBe(100_000);
    expect(burn.budgetHealth?.usesFixedBudget).toBe(true);
    expect(burn.budgetHealth?.remainingCents).toBe(100_000);
    expect((await db.getProject(id))?.contractedFee).toBe(0);
  });

  it("attributes timers and supports existing consultant rows without an organization stamp", async () => {
    const option = (await admin.subBudgets.options({ projectId }))[0];
    const legacyId = Number((await conn.insert(consultantContracts).values({ projectId, organizationId: null, name: "Legacy consultant", discipline: "Existing", contractAmount: 1_000 }))[0].insertId);
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
