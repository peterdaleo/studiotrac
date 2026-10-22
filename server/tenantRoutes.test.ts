import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { assertTenantEntity, assertTenantReference } from "./tenantAuthorization";
import { consultantContracts, projects, tasks, teamMembers, timeEntries, users } from "../drizzle/schema";

vi.mock("./db", () => ({ getDb: vi.fn() }));

const rows = new Map<any, any[]>();

function fakeDatabase() {
  return {
    select: () => ({
      from: (table: any) => ({
        where: (predicate: any) => ({
          limit: async (count: number) => {
            const idParam = predicate.queryChunks?.find((chunk: any) => chunk?.constructor?.name === "Param");
            return (rows.get(table) ?? []).filter(row => row.id === idParam?.value).slice(0, count);
          },
        }),
      }),
    }),
  };
}

function expectNotFound(promise: Promise<unknown>) {
  return expect(promise).rejects.toMatchObject({ code: "NOT_FOUND" });
}

describe("tenant route ownership assertions", () => {
  beforeEach(() => {
    rows.clear();
    rows.set(projects, [
      { id: 1, organizationId: 11, projectManagerId: null },
      { id: 2, organizationId: 22, projectManagerId: null },
    ]);
    rows.set(teamMembers, [
      { id: 3, organizationId: 11, userId: null },
      { id: 4, organizationId: 22, userId: null },
    ]);
    rows.set(tasks, [
      { id: 5, organizationId: 11, projectId: 1, assigneeId: 3 },
      { id: 6, organizationId: 11, projectId: 2, assigneeId: 3 },
    ]);
    vi.mocked(getDb).mockResolvedValue(fakeDatabase() as any);
  });

  it("allows a direct record and its same-organization parent and assignee", async () => {
    await expect(assertTenantEntity("task", 5, 11)).resolves.toMatchObject({ id: 5 });
  });

  it("returns NOT_FOUND for a foreign direct record", async () => {
    await expectNotFound(assertTenantEntity("project", 2, 11));
  });

  it("returns NOT_FOUND when a same-org child points at a foreign project", async () => {
    await expectNotFound(assertTenantEntity("task", 6, 11));
  });

  it("checks both same-tenant ownership and the exact supplied parent", async () => {
    await expect(assertTenantReference("task", 5, 11, { entity: "project", id: 1 })).resolves.toMatchObject({ id: 5 });
    await expectNotFound(assertTenantReference("task", 5, 11, { entity: "project", id: 2 }));
  });

  it("fails closed when the caller has no organization", async () => {
    await expectNotFound(assertTenantEntity("project", 1, null));
  });

  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid organization ID %s", async organizationId => {
    await expectNotFound(assertTenantEntity("project", 1, organizationId));
  });

  it("keeps firm-owned staff assignments and time history after their account leaves", async () => {
    rows.set(users, [{ id: 8, organizationId: null }]);
    rows.set(teamMembers, [{ id: 3, organizationId: 11, userId: 8 }]);
    rows.set(projects, [{ id: 1, organizationId: 11, projectManagerId: 3 }]);
    rows.set(timeEntries, [{ id: 9, organizationId: 11, projectId: 1, userId: 8, taskId: 5, subBudgetId: null }]);
    await expect(assertTenantEntity("teamMember", 3, 11)).resolves.toMatchObject({ id: 3 });
    await expect(assertTenantEntity("project", 1, 11)).resolves.toMatchObject({ id: 1 });
    await expect(assertTenantEntity("task", 5, 11)).resolves.toMatchObject({ id: 5 });
    await expect(assertTenantEntity("timeEntry", 9, 11)).resolves.toMatchObject({ id: 9 });
    await expectNotFound(assertTenantEntity("user", 8, 11));
  });

  it("inherits a legacy consultant's ownership only from its own project", async () => {
    rows.set(consultantContracts, [
      { id: 10, organizationId: null, projectId: 1, subBudgetId: null },
      { id: 11, organizationId: null, projectId: 2, subBudgetId: null },
      { id: 12, organizationId: 22, projectId: 1, subBudgetId: null },
    ]);
    await expect(assertTenantEntity("consultant", 10, 11)).resolves.toMatchObject({ id: 10 });
    await expectNotFound(assertTenantEntity("consultant", 11, 11));
    await expectNotFound(assertTenantEntity("consultant", 12, 11));
  });
});
