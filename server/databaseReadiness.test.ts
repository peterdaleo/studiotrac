import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  createPool: vi.fn(),
  drizzle: vi.fn(),
  connection: { synthetic: true, select: vi.fn() },
  pool: { syntheticPool: true },
}));
vi.mock("./databaseSchema", () => ({ assertDatabaseSchemaReady: mocks.validate }));
vi.mock("mysql2", () => ({ createPool: mocks.createPool }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: mocks.drizzle }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "mysql://synthetic:local-only@127.0.0.1:3306/stage1_test");
  mocks.createPool.mockReturnValue(mocks.pool);
  mocks.drizzle.mockReturnValue(mocks.connection);
  mocks.validate.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("database connection readiness — no network", () => {
  it("validates once before returning an existing-schema connection", async () => {
    const db = await import("./db");
    expect(await db.getDb()).toBe(mocks.connection);
    expect(await db.getDb()).toBe(mocks.connection);
    expect(mocks.createPool).toHaveBeenCalledTimes(1);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.validate).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.connection.select).not.toHaveBeenCalled();
  });

  it("holds every concurrent caller until the shared validation completes", async () => {
    let release!: () => void;
    mocks.validate.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve; }));
    const db = await import("./db");
    let returned = false;
    const first = db.getDb().then(value => { returned = true; return value; });
    const second = db.getDb();
    const third = db.getDb();
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    release();
    expect(await Promise.all([first, second, third])).toEqual([
      mocks.connection, mocks.connection, mocks.connection,
    ]);
  });

  it("caches a failed readiness check and never returns an unvalidated connection", async () => {
    const failure = new Error("Required synthetic schema is missing; no repair attempted");
    mocks.validate.mockRejectedValueOnce(failure);
    const db = await import("./db");
    await expect(db.getDb()).rejects.toBe(failure);
    await expect(db.getDb()).rejects.toBe(failure);
    await expect(db.listProjects(undefined, 42)).rejects.toBe(failure);
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.connection.select).not.toHaveBeenCalled();
  });

  it("returns no connection when no database is configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const db = await import("./db");
    expect(await db.getDb()).toBeNull();
    expect(mocks.createPool).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("does not expose driver errors or a connection URL when initialization fails", async () => {
    mocks.createPool.mockImplementationOnce(() => {
      throw new Error("Synthetic private driver detail mysql://synthetic:withheld@127.0.0.1/test");
    });
    const db = await import("./db");
    await expect(db.getDb()).rejects.toThrow("Database connection configuration is invalid.");
    expect(mocks.validate).not.toHaveBeenCalled();
  });
});
