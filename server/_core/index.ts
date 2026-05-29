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
import cors from "cors";

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

  // Serve uploaded files from /uploads
  const uploadDir = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadDir));

  // Serve coordination sheet images from database (base64 stored in DB)
  app.get("/api/coordination-image/:id", async (req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      const { coordinationAttachments } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [att] = await db.select({
        fileData: coordinationAttachments.fileData,
        mimeType: coordinationAttachments.mimeType,
        fileName: coordinationAttachments.fileName,
      }).from(coordinationAttachments).where(eq(coordinationAttachments.id, parseInt(req.params.id)));
      if (!att || !att.fileData) {
        return res.status(404).send("Image not found");
      }
      const buffer = Buffer.from(att.fileData, "base64");
      res.setHeader("Content-Type", att.mimeType || "image/png");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (att.fileName) res.setHeader("Content-Disposition", `inline; filename="${att.fileName}"`);
      res.send(buffer);
    } catch (e) {
      console.error("Error serving coordination image:", e);
      res.status(500).send("Internal server error");
    }
  });

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
  });
}

startServer().catch(console.error);
