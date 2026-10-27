import { describe, expect, it, vi } from "vitest";
import {
  assertDatabaseSchemaReady,
  DatabaseSchemaValidationError,
  REQUIRED_DATABASE_SCHEMA,
} from "./databaseSchema";

type MetadataRow = { tableName: string; columnName: string };

function completeMetadata(): MetadataRow[] {
  return Object.entries(REQUIRED_DATABASE_SCHEMA).flatMap(([tableName, columns]) =>
    columns.map((columnName) => ({ tableName, columnName })),
  );
}

function fakeDatabase(result: unknown) {
  return { execute: vi.fn(async (_query: unknown) => result) };
}

describe("assertDatabaseSchemaReady", () => {
  it("requires prospects.closedAt for prospect decision metrics", async () => {
    expect(REQUIRED_DATABASE_SCHEMA.prospects).toContain("closedAt");
    const rows = completeMetadata().filter(row => !(row.tableName === "prospects" && row.columnName === "closedAt"));
    await expect(assertDatabaseSchemaReady(fakeDatabase(rows) as never)).rejects.toMatchObject({
      name: "DatabaseSchemaValidationError",
      missingColumns: { prospects: ["closedAt"] },
    });
  });

  it("requires the verified legacy file and preference columns, not API aliases or invented storage", () => {
    expect([...REQUIRED_DATABASE_SCHEMA.project_files].sort()).toEqual([
      "id", "organizationId", "projectId", "uploadedById", "fileName", "fileUrl",
      "fileSize", "mimeType", "category", "isClientVisible", "createdAt",
    ].sort());
    expect([...REQUIRED_DATABASE_SCHEMA.email_preferences].sort()).toEqual([
      "id", "userId", "deadlineAlerts", "taskOverdueAlerts", "statusChangeAlerts",
      "weeklyDigest", "alertDaysBefore", "createdAt", "updatedAt",
    ].sort());
    expect(REQUIRED_DATABASE_SCHEMA.project_files).not.toContain("fileKey");
    expect(REQUIRED_DATABASE_SCHEMA.project_files).not.toContain("url");
    expect(REQUIRED_DATABASE_SCHEMA.email_preferences).not.toContain("emailAddress");
    expect(REQUIRED_DATABASE_SCHEMA.email_preferences).not.toContain("overdueAlerts");
  });

  it("derives a non-empty required inventory from the runtime schema and accepts complete metadata", async () => {
    expect(Object.keys(REQUIRED_DATABASE_SCHEMA).length).toBeGreaterThan(0);
    expect(Object.values(REQUIRED_DATABASE_SCHEMA).every((columns) => columns.length > 0)).toBe(true);

    const db = fakeDatabase(completeMetadata());
    await expect(assertDatabaseSchemaReady(db as never)).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("allows unrelated extra tables and columns", async () => {
    const rows = completeMetadata();
    rows.push(
      { tableName: "unrelated_legacy_table", columnName: "id" },
      { tableName: Object.keys(REQUIRED_DATABASE_SCHEMA)[0], columnName: "legacyExtra" },
    );
    await expect(assertDatabaseSchemaReady(fakeDatabase(rows) as never)).resolves.toBeUndefined();
  });

  it("rejects a missing required table with a clear validation error", async () => {
    const rows = completeMetadata();
    const missingTable = Object.keys(REQUIRED_DATABASE_SCHEMA)[0];
    const db = fakeDatabase(rows.filter((row) => row.tableName !== missingTable));

    await expect(assertDatabaseSchemaReady(db as never)).rejects.toMatchObject({
      name: "DatabaseSchemaValidationError",
      missingTables: [missingTable],
    });
  });

  it("rejects a missing required column without enforcing exact schema types", async () => {
    const rows = completeMetadata();
    const [tableName, columns] = Object.entries(REQUIRED_DATABASE_SCHEMA)[0];
    const missingColumn = columns[0];
    const db = fakeDatabase(rows.filter(
      (row) => !(row.tableName === tableName && row.columnName === missingColumn),
    ));

    await expect(assertDatabaseSchemaReady(db as never)).rejects.toMatchObject({
      name: "DatabaseSchemaValidationError",
      missingColumns: { [tableName]: [missingColumn] },
    });
  });

  it.each([
    ["project_files", "fileUrl"],
    ["project_files", "isClientVisible"],
    ["email_preferences", "taskOverdueAlerts"],
  ])("does not waive required legacy %s.%s metadata", async (tableName, columnName) => {
    const rows = completeMetadata().filter(row => row.tableName !== tableName || row.columnName !== columnName);
    await expect(assertDatabaseSchemaReady(fakeDatabase(rows) as never)).rejects.toMatchObject({
      name: "DatabaseSchemaValidationError",
      missingColumns: { [tableName]: [columnName] },
    });
  });

  it("rejects empty metadata as an unready schema", async () => {
    await expect(assertDatabaseSchemaReady(fakeDatabase([]) as never)).rejects.toBeInstanceOf(
      DatabaseSchemaValidationError,
    );
  });

  it("sanitizes metadata-query failures instead of leaking raw database errors", async () => {
    const db = { execute: vi.fn(async () => { throw new Error("mysql://user:secret@db/prod"); }) };
    let caught: unknown;
    try {
      await assertDatabaseSchemaReady(db as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DatabaseSchemaValidationError);
    expect((caught as Error).message).toContain("Unable to verify");
    expect((caught as Error).message).not.toContain("mysql://");
    expect((caught as Error).message).not.toContain("secret");
  });

  it("issues exactly one SELECT over metadata and never queries application data or writes", async () => {
    const db = fakeDatabase(completeMetadata());
    await assertDatabaseSchemaReady(db as never);
    const [query] = db.execute.mock.calls[0];
    expect(typeof query).toBe("string");
    const normalized = String(query).replace(/\s+/g, " ").trim();
    expect(normalized).toMatch(/^SELECT\b/i);
    expect(normalized).toMatch(/information_schema\.COLUMNS/i);
    expect(normalized).toMatch(/information_schema\.TABLES/i);
    expect(normalized).toMatch(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/i);
    expect(normalized).toMatch(/TABLE_TYPE\s*=\s*'BASE TABLE'/i);
    expect(normalized).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|LOCK|CALL)\b/i);
    expect(normalized).not.toMatch(/\b(?:organizations|users|projects|time_entries)\b/i);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
