import { beforeEach, describe, expect, it, vi } from "vitest";
import { prospectInteractions, prospects, projectNotes, projects } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { archiveProspect, permanentlyDeleteProspect, restoreProspect } from "./prospects";

function fakeDatabase(row: Record<string, unknown> | null) {
  const selectedRows = row ? [row] : [];
  const updatedValues: unknown[] = [];
  const deletedTables: unknown[] = [];
  const selectBuilder: any = {};
  selectBuilder.from = vi.fn(() => selectBuilder);
  selectBuilder.where = vi.fn(() => selectBuilder);
  selectBuilder.limit = vi.fn(() => selectBuilder);
  selectBuilder.for = vi.fn(async () => selectedRows);

  const tx = {
    select: vi.fn(() => selectBuilder),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updatedValues.push(value);
        return { where: vi.fn(async () => ({ affectedRows: 1 })) };
      }),
    })),
    delete: vi.fn((table: unknown) => {
      deletedTables.push(table);
      return { where: vi.fn(async () => ({ affectedRows: 1 })) };
    }),
  };
  const db = { transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)) };
  return { db, tx, updatedValues, deletedTables };
}

beforeEach(() => vi.clearAllMocks());

describe("prospect archive and permanent deletion", () => {
  it("archives and restores by updating only the prospect archive timestamp", async () => {
    const active = fakeDatabase({ id: 31, archivedAt: null });
    mocks.getDb.mockResolvedValue(active.db);
    await expect(archiveProspect(31, 5)).resolves.toEqual({ success: true, archived: true });
    expect(active.updatedValues).toEqual([{ archivedAt: expect.any(Date) }]);

    const archived = fakeDatabase({ id: 31, archivedAt: new Date("2026-01-01T00:00:00Z") });
    mocks.getDb.mockResolvedValue(archived.db);
    await expect(restoreProspect(31, 5)).resolves.toEqual({ success: true, archived: false });
    expect(archived.updatedValues).toEqual([{ archivedAt: null }]);
    expect(active.tx.select).toHaveBeenCalledTimes(1);
    expect(archived.tx.select).toHaveBeenCalledTimes(1);
  });

  it("removes an interaction history and a converted prospect without deleting its project or copied notes", async () => {
    const fake = fakeDatabase({ id: 44, convertedProjectId: 902, archivedAt: null });
    mocks.getDb.mockResolvedValue(fake.db);

    await expect(permanentlyDeleteProspect(44, 5)).resolves.toEqual({ success: true, convertedProjectId: 902 });

    expect(fake.db.transaction).toHaveBeenCalledTimes(1);
    expect(fake.deletedTables).toEqual([prospectInteractions, prospects]);
    expect(fake.deletedTables).not.toContain(projects);
    expect(fake.deletedTables).not.toContain(projectNotes);
  });

  it("does not delete anything when the prospect is absent from the requested workspace", async () => {
    const fake = fakeDatabase(null);
    mocks.getDb.mockResolvedValue(fake.db);

    await expect(permanentlyDeleteProspect(44, 5)).rejects.toThrow("Prospect not found");
    expect(fake.deletedTables).toEqual([]);
  });

  it("requires a workspace before changing a prospect", async () => {
    await expect(archiveProspect(31, null)).rejects.toThrow();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
