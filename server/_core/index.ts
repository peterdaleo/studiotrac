import { isOrganizationWorkspaceAccessible } from "../workspaceAccess";
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../stripe/webhooks";
import { startCoordinationCron } from "../coordinationCron";
import cors from "cors";
import { sdk } from "./sdk";
import { createCoordinationImageHandler } from "./coordinationImageRoute";
import { createProtectedUploadHandler, createUploadAuthorizer, getLocalUploadUrl } from "./protectedUploadRoute";
import { getDb } from "../db";
import { DatabaseSchemaValidationError } from "../databaseSchema";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // No listener, background job, schema repair, or billing backfill before readiness.
  if (!(await getDb())) throw new Error("Database connection is not configured.");

  const app = express();
  const server = createServer(app);

  // Stripe webhook needs raw body for signature verification — must be before json parser
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Enable CORS for the marketing site
  app.use(cors({
    origin: ["https://studiotrac.app", "http://localhost:5173"],
    credentials: true,
  }));

  // Private project files require their tenant session or an existing portal capability.
  const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
  app.get("/uploads/*", createProtectedUploadHandler({ authorizeFile: createUploadAuthorizer({
    uploadDir,
    isWorkspaceAccessible: isOrganizationWorkspaceAccessible,
    getAuthenticatedOrganizationId: async req => (await sdk.authenticateRequest(req)).organizationId,
    loadShare: async token => (await import("../db")).getShareToken(token).then(value => value ?? null),
    loadFile: async key => {
      const { getDb } = await import("../db");
      const database = await getDb();
      if (!database) return null;
      const localUrl = getLocalUploadUrl(key);
      if (!localUrl) return null;
      const { projectFiles, projects } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [file] = await database.select({ fileName: projectFiles.fileName, projectId: projectFiles.projectId,
        organizationId: projects.organizationId, fileOrganizationId: projectFiles.organizationId,
        isClientVisible: projectFiles.isClientVisible, clientName: projects.clientName })
        .from(projectFiles).innerJoin(projects, eq(projectFiles.projectId, projects.id))
        .where(eq(projectFiles.url, localUrl)).limit(1);
      return file ?? null;
    },
  }) }));

  // Serve coordination sheet images only through same-org sessions or scoped share capabilities.
  app.get("/api/coordination-image/:id", createCoordinationImageHandler({
    isWorkspaceAccessible: isOrganizationWorkspaceAccessible,
    getAuthenticatedOrganizationId: async req => {
      const user = await sdk.authenticateRequest(req);
      return user.organizationId ?? null;
    },
    loadImage: async attachmentId => {
      const { getDb } = await import("../db");
      const db = await getDb();
      const { coordinationAttachments, coordinationItems, coordinationSheets, projects } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      if (!db) throw new Error("Database not available");
      const [att] = await db.select({
        id: coordinationAttachments.id,
        fileData: coordinationAttachments.fileData,
        mimeType: coordinationAttachments.mimeType,
        fileName: coordinationAttachments.fileName,
        attachmentType: coordinationAttachments.type,
        itemVisibility: coordinationItems.visibility,
        sheetIsActive: coordinationSheets.isActive,
        sheetOrganizationId: coordinationSheets.organizationId,
        projectOrganizationId: projects.organizationId,
        mainToken: coordinationSheets.token,
        clientToken: coordinationSheets.clientToken,
      }).from(coordinationAttachments)
        .innerJoin(coordinationItems, eq(coordinationAttachments.itemId, coordinationItems.id))
        .innerJoin(coordinationSheets, eq(coordinationItems.sheetId, coordinationSheets.id))
        .innerJoin(projects, eq(coordinationSheets.projectId, projects.id))
        .where(eq(coordinationAttachments.id, attachmentId)).limit(1);
      return att ?? null;
    }
  }));

  // Auth routes (signup/login)
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    startCoordinationCron();
  });
}

startServer().catch(error => {
  // Only the validation error contains intentionally sanitized metadata diagnostics.
  console.error("[Startup] Server did not start:", error instanceof DatabaseSchemaValidationError
    ? error.message
    : "Database readiness or server startup failed. Automatic database changes are disabled.");
  process.exit(1);
});
