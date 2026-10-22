import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createConnection } from "mysql2/promise";
import { createPool } from "mysql2";
import { drizzle } from "drizzle-orm/mysql2";
import { assertDatabaseSchemaReady } from "./databaseSchema";

// This suite is intentionally inert unless explicitly opted into. It only
// accepts the dedicated local fixture user and the three named synthetic DBs.
const enabled = process.env.STARTUP_SCHEMA_INTEGRATION === "1";
const FULL_SCHEMA = "stage1_startup_test";
const MISSING_TABLE_SCHEMA = "stage1_startup_test_missing_table";
const MISSING_COLUMN_SCHEMA = "stage1_startup_test_missing_column";
const LEGACY_PROJECT_ID = 910001;
const LEGACY_PROJECT_NAME = "STARTUP_GUARD_LEGACY_FIXED_ZERO";

type SchemaSnapshot = {
  tables: unknown[];
  columns: unknown[];
  indexes: unknown[];
  rows: Record<string, string[]>;
};

let databaseUrl: URL | undefined;

function fixtureUrl(databaseName: string): string {
  if (!databaseUrl) throw new Error("Startup schema fixture URL was not initialized");
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function validatedFixtureUrl(): URL {
  const value = process.env.STARTUP_SCHEMA_DATABASE_URL;
  if (!value) throw new Error("STARTUP_SCHEMA_DATABASE_URL is required when STARTUP_SCHEMA_INTEGRATION=1");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("STARTUP_SCHEMA_DATABASE_URL must be a valid mysql:// URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    url.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase()) ||
    url.username !== "stage1_startup" ||
    database !== FULL_SCHEMA ||
    !url.password
  ) {
    throw new Error("Refusing startup schema integration tests outside the dedicated localhost stage1_startup_test fixture");
  }
  return url;
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { buffer: value.toString("base64") };
  if (typeof value === "bigint") return value.toString();
  return value;
}

async function readSnapshot(url: string): Promise<SchemaSnapshot> {
  const connection = await createConnection(url);
  try {
    const [tableRows] = await connection.query(
      "SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    );
    const [columnRows] = await connection.query(
      "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
    );
    const [indexRows] = await connection.query(
      "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    );
    const tables = tableRows as Array<{ TABLE_NAME: string }>;
    const rows: Record<string, string[]> = {};
    for (const { TABLE_NAME } of tables) {
      // Names come from information_schema in this exact local synthetic DB.
      const quoted = `\`${TABLE_NAME.replace(/`/g, "``")}\``;
      const [tableData] = await connection.query(`SELECT * FROM ${quoted}`);
      rows[TABLE_NAME] = (tableData as Record<string, unknown>[])
        .map(row => JSON.stringify(row, (_key, value) => stableValue(value)))
        .sort();
    }
    return {
      tables: tableRows as unknown[],
      columns: columnRows as unknown[],
      indexes: indexRows as unknown[],
      rows,
    };
  } finally {
    await connection.end();
  }
}

async function expectSelectOnlyGrant(url: string): Promise<void> {
  const connection = await createConnection(url);
  try {
    const [grantRows] = await connection.query("SHOW GRANTS");
    const grants = (grantRows as Array<Record<string, string>>).map(row => Object.values(row)[0] ?? "");
    expect(grants.some(grant => /GRANT SELECT ON/i.test(grant))).toBe(true);
    expect(grants.some(grant => /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|INDEX|REFERENCES|ALL PRIVILEGES)\b/i.test(grant))).toBe(false);
  } finally {
    await connection.end();
  }
}

async function withFreshDbModule<T>(url: string, run: (module: typeof import("./db")) => Promise<T>): Promise<T> {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const pools: Array<ReturnType<typeof createPool>> = [];
  vi.resetModules();
  vi.doMock("mysql2", async importOriginal => {
    const actual = await importOriginal<typeof import("mysql2")>();
    return {
      ...actual,
      createPool: (...args: Parameters<typeof createPool>) => {
        const pool = actual.createPool(...args);
        pools.push(pool);
        return pool;
      },
    };
  });
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = "production";
  try {
    const dbModule = await import("./db");
    return await run(dbModule);
  } finally {
    for (const pool of pools) {
      await new Promise<void>(resolve => (pool as any).end(() => resolve()));
    }
    vi.doUnmock("mysql2");
    vi.resetModules();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
}

async function expectRejectedReadiness(url: string, expected: { missingTables?: string[]; missingColumns?: Record<string, string[]> }): Promise<void> {
  const before = await readSnapshot(url);
  const pool = createPool({ uri: url, connectionLimit: 2 });
  try {
    await expect(assertDatabaseSchemaReady(drizzle(pool))).rejects.toMatchObject({
      name: "DatabaseSchemaValidationError",
      ...expected,
    });
  } finally {
    await new Promise<void>(resolve => (pool as any).end(() => resolve()));
  }

  await withFreshDbModule(url, async dbModule => {
    // Exercise production getDb with production NODE_ENV and ensure its cached
    // validation failure is stable for concurrent and subsequent callers.
    const concurrent = await Promise.allSettled(Array.from({ length: 4 }, () => dbModule.getDb()));
    expect(concurrent.every(result => result.status === "rejected")).toBe(true);
    for (const result of concurrent) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ name: "DatabaseSchemaValidationError", ...expected });
      }
    }
    const repeated = await Promise.allSettled([dbModule.getDb(), dbModule.getDb()]);
    expect(repeated.every(result => result.status === "rejected")).toBe(true);
    for (const result of repeated) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ name: "DatabaseSchemaValidationError", ...expected });
      }
    }
  });

  // The readonly account and exact metadata/row snapshot prove that repeated
  // startup validation did not repair or otherwise mutate an invalid fixture.
  expect(await readSnapshot(url)).toEqual(before);
}

describe.skipIf(!enabled)("database startup schema readiness — isolated read-only integration", () => {
  beforeAll(() => {
    databaseUrl = validatedFixtureUrl();
  });

  it("accepts the complete synthetic schema in production mode without changing legacy billing or any records", async () => {
    const url = fixtureUrl(FULL_SCHEMA);
    await expectSelectOnlyGrant(url);
    const before = await readSnapshot(url);
    await withFreshDbModule(url, async dbModule => {
      const connections = await Promise.all(Array.from({ length: 6 }, () => dbModule.getDb()));
      expect(connections.every(Boolean)).toBe(true);
      await Promise.all([dbModule.getDb(), dbModule.getDb(), dbModule.getDb()]);
    });
    const after = await readSnapshot(url);
    expect(after).toEqual(before);

    const connection = await createConnection(url);
    try {
      const [legacyRows] = await connection.execute(
        "SELECT id, billingType, contractedFee FROM projects WHERE id = ? AND name = ?",
        [LEGACY_PROJECT_ID, LEGACY_PROJECT_NAME],
      );
      expect(legacyRows).toEqual([{ id: LEGACY_PROJECT_ID, billingType: "fixed_fee", contractedFee: 0 }]);
      const [historyRows] = await connection.execute(
        "SELECT COUNT(*) AS historyCount FROM project_billing_phases WHERE projectId = ?",
        [LEGACY_PROJECT_ID],
      );
      expect((historyRows as Array<{ historyCount: number }>)[0]?.historyCount).toBe(0);
    } finally {
      await connection.end();
    }
  });

  it("rejects a missing required table repeatedly without creating it or changing records", async () => {
    const url = fixtureUrl(MISSING_TABLE_SCHEMA);
    await expectSelectOnlyGrant(url);
    await expectRejectedReadiness(url, { missingTables: ["organizations"] });
  });

  it("rejects a missing required column repeatedly without adding it or changing records", async () => {
    const url = fixtureUrl(MISSING_COLUMN_SCHEMA);
    await expectSelectOnlyGrant(url);
    await expectRejectedReadiness(url, { missingColumns: { projects: ["billingType"] } });
  });
});

afterAll(() => {
  databaseUrl = undefined;
});
