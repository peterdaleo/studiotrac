import { describe, expect, it, vi } from "vitest";
import { requireOrganizationId } from "./organizationScope";
import * as db from "./db";
import { appRouter } from "./routers";

const invalidOrganizations = [undefined, null, 0, -1, NaN, Infinity, 1.5];

describe("mandatory organization scope", () => {
  it.each(invalidOrganizations)("rejects invalid organization %s", (orgId) => {
    expect(() => requireOrganizationId(orgId)).toThrow("An organization workspace is required.");
  });
  it("accepts an explicit positive organization", () => {
    expect(() => requireOrganizationId(42)).not.toThrow();
  });
  it.each([undefined, null, 0])("fails closed in tenant database entry points for %s", async (orgId) => {
    const operations = [
      () => db.listUsers(orgId), () => db.listTeamMembers(orgId),
      () => db.listProjects(undefined, orgId), () => db.listTasks(undefined, orgId),
      () => db.listTeamAbsences(undefined, orgId), () => db.getDashboardStats(orgId),
      () => db.getGanttData(orgId), () => db.listTimeEntries(undefined, orgId),
      () => db.getFinancialOverview(orgId), () => db.getExportProjectsSummary(orgId),
      () => db.getExportTasksList(orgId), () => db.getExportTeamWorkload(orgId),
      () => db.getStudioNetIncome(orgId), () => db.getTrueProfitability(orgId),
      () => db.getFirmUtilization(undefined, undefined, orgId),
      () => db.getTeamTimeReport(undefined, undefined, orgId),
      () => db.listBillingDepartmentEmails(orgId), () => db.getAllProjectsBudgetSummary(orgId),
      () => db.listNotifications(1, 50, orgId),
      () => db.assertProjectInOrganization(1, orgId),
      () => db.createProject({ name: "synthetic" }, orgId),
      () => db.createTask({ title: "synthetic", projectId: 1 }, orgId),
      () => db.createTeamMember({ name: "synthetic" }, orgId),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it.each(["admin", "pm", "user"])("blocks an organization-less %s across read, write and delete APIs", async (role) => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, organizationId: 999,
      user: { id: 1, role, organizationId: null, isSuperAdmin: false } as any });
    for (const operation of [
      () => caller.projects.list(), () => caller.projects.get({ id: 1 }),
      () => caller.tasks.list(), () => caller.tasks.delete({ id: 1 }),
      () => caller.teamMembers.updateRole({ userId: 2, role: "admin" }),
      () => caller.teamMembers.removeUser({ userId: 2 }),
      () => caller.teamMembers.resetPassword({ userId: 2, newPassword: "synthetic-only" }),
    ]) await expect(operation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not trust a forged context organization for anonymous callers", async () => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: null, organizationId: 42 });
    await expect(caller.projects.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.teamMembers.removeUser({ userId: 2 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each([null, { id: 1, role: "admin", organizationId: 42, isSuperAdmin: true }])("never exposes database maintenance through the application API", async (user) => {
    const caller = appRouter.createCaller({ req: {} as any, res: {} as any, user: user as any, organizationId: user?.organizationId ?? null });
    await expect(caller.system.debugTables()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.system.runMigration()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.system.health({ timestamp: 0 })).resolves.toEqual({ ok: true });
  });
});
