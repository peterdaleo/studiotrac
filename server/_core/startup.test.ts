import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const app = {
    post: vi.fn(),
    use: vi.fn(),
    get: vi.fn(),
  };
  const server = {
    listen: vi.fn(),
  };
  return {
    app,
    server,
    getDb: vi.fn(),
    express: vi.fn(() => app),
    httpCreateServer: vi.fn(() => server),
    netCreateServer: vi.fn(),
    startCoordinationCron: vi.fn(),
    serveStatic: vi.fn(),
    setupVite: vi.fn(),
    registerOAuthRoutes: vi.fn(),
    createExpressMiddleware: vi.fn(() => vi.fn()),
    handleStripeWebhook: vi.fn(),
    createCoordinationImageHandler: vi.fn(() => vi.fn()),
    createProtectedUploadHandler: vi.fn(() => vi.fn()),
    createUploadAuthorizer: vi.fn(() => vi.fn()),
    consoleError: vi.fn(),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("express", () => ({
  default: Object.assign(mocks.express, {
    raw: vi.fn(() => vi.fn()),
    json: vi.fn(() => vi.fn()),
    urlencoded: vi.fn(() => vi.fn()),
  }),
}));
vi.mock("http", () => ({ createServer: mocks.httpCreateServer }));
vi.mock("net", () => ({ default: { createServer: mocks.netCreateServer } }));
vi.mock("@trpc/server/adapters/express", () => ({ createExpressMiddleware: mocks.createExpressMiddleware }));
vi.mock("./oauth", () => ({ registerOAuthRoutes: mocks.registerOAuthRoutes }));
vi.mock("../routers", () => ({ appRouter: {} }));
vi.mock("./context", () => ({ createContext: vi.fn() }));
vi.mock("./vite", () => ({ serveStatic: mocks.serveStatic, setupVite: mocks.setupVite }));
vi.mock("../stripe/webhooks", () => ({ handleStripeWebhook: mocks.handleStripeWebhook }));
vi.mock("../coordinationCron", () => ({ startCoordinationCron: mocks.startCoordinationCron }));
vi.mock("cors", () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock("./sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("./coordinationImageRoute", () => ({ createCoordinationImageHandler: mocks.createCoordinationImageHandler }));
vi.mock("./protectedUploadRoute", () => ({
  createProtectedUploadHandler: mocks.createProtectedUploadHandler,
  createUploadAuthorizer: mocks.createUploadAuthorizer,
}));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

function makeAvailablePortProbe() {
  const probe = {
    listen: vi.fn((_port: number, callback: () => void) => callback()),
    close: vi.fn((callback: () => void) => callback()),
    on: vi.fn(),
  };
  mocks.netCreateServer.mockReturnValue(probe);
  return probe;
}

function expectNoServerStartup() {
  expect(mocks.express).not.toHaveBeenCalled();
  expect(mocks.httpCreateServer).not.toHaveBeenCalled();
  expect(mocks.server.listen).not.toHaveBeenCalled();
  expect(mocks.startCoordinationCron).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PORT", "4311");
  makeAvailablePortProbe();
  mocks.setupVite.mockResolvedValue(undefined);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("server startup entrypoint", () => {
  it("waits for a delayed database readiness result before constructing or starting the server", async () => {
    mocks.getDb.mockReturnValue(new Promise<object>(() => {}));

    await import("./index");
    await vi.waitFor(() => expect(mocks.getDb).toHaveBeenCalledTimes(1));

    expectNoServerStartup();
    expect(mocks.netCreateServer).not.toHaveBeenCalled();
  });

  it("listens only after readiness, then schedules cron from the listen callback", async () => {
    const order: string[] = [];
    let onListening!: () => void;
    mocks.getDb.mockResolvedValue({ ready: true });
    mocks.server.listen.mockImplementation((_port: number, callback: () => void) => {
      order.push("listen");
      onListening = callback;
    });

    await import("./index");
    await vi.waitFor(() => expect(mocks.server.listen).toHaveBeenCalledTimes(1));

    expect(mocks.express).toHaveBeenCalledTimes(1);
    expect(mocks.httpCreateServer).toHaveBeenCalledTimes(1);
    expect(mocks.server.listen).toHaveBeenCalledWith(4311, expect.any(Function));
    expect(mocks.startCoordinationCron).not.toHaveBeenCalled();

    mocks.startCoordinationCron.mockImplementation(() => { order.push("cron"); });
    onListening();

    expect(order).toEqual(["listen", "cron"]);
    expect(mocks.startCoordinationCron).toHaveBeenCalledTimes(1);
  });

  it("exits with status 1 on schema validation failure without creating a server", async () => {
    const { DatabaseSchemaValidationError } = await import("../databaseSchema");
    mocks.getDb.mockRejectedValue(new DatabaseSchemaValidationError("Schema is missing required tables."));

    await import("./index");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expectNoServerStartup();
    expect(mocks.netCreateServer).not.toHaveBeenCalled();
  });

  it("exits with status 1 when no database is configured without creating a server", async () => {
    mocks.getDb.mockResolvedValue(null);

    await import("./index");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expectNoServerStartup();
    expect(mocks.netCreateServer).not.toHaveBeenCalled();
  });

  it("logs a sanitized message for unknown database failures", async () => {
    mocks.getDb.mockRejectedValue(new Error("SyntheticSecret mysql://synthetic:password@db.example/private"));

    await import("./index");
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expectNoServerStartup();
    expect(mocks.netCreateServer).not.toHaveBeenCalled();
    expect(mocks.consoleError).toHaveBeenCalledWith(
      "[Startup] Server did not start:",
      "Database readiness or server startup failed. Automatic database changes are disabled.",
    );
    expect(JSON.stringify(mocks.consoleError.mock.calls)).not.toContain("SyntheticSecret");
    expect(JSON.stringify(mocks.consoleError.mock.calls)).not.toContain("password");
  });
});
