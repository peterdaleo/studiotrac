import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { sql } from "drizzle-orm";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),
  debugTables: publicProcedure.query(async () => {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { error: "no db" };
    try {
      const tables = await db.execute(sql`SHOW TABLES`);
      const projectCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM projects`).catch((e: any) => e?.message);
      const projectCols = await db.execute(sql`SHOW COLUMNS FROM projects`).catch((e: any) => e?.message);
      const projects = await db.execute(sql`SELECT id, name FROM projects ORDER BY id LIMIT 10`).catch((e: any) => e?.message);
      const teamMembersCols = await db.execute(sql`SELECT id, name, isActive FROM team_members ORDER BY id`).catch((e: any) => e?.message);
      return { tables, projectCount, projectCols, projects, teamMembersCols };
    } catch (e: any) {
      return { error: e?.message };
    }
  }),
  runMigration: publicProcedure.mutation(async () => {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { error: "no db" };
    const results: string[] = [];
    try {
      // Create invoices table if it doesn't exist (from migration 0004)
      await db.execute(sql`CREATE TABLE IF NOT EXISTS invoices (
        id int AUTO_INCREMENT NOT NULL,
        projectId int NOT NULL,
        amount int NOT NULL,
        description varchar(500),
        invoiceNumber varchar(100),
        status enum('draft','sent','paid','overdue') NOT NULL DEFAULT 'draft',
        invoiceDate timestamp NOT NULL DEFAULT (now()),
        dueDate timestamp,
        paidDate timestamp,
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT invoices_id PRIMARY KEY(id)
      )`);
      results.push("invoices table created or already exists");

      // Add contractedFee and invoicedAmount columns to projects if missing
      await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS contractedFee int DEFAULT 0 NOT NULL`).catch(() => results.push("contractedFee already exists"));
      results.push("contractedFee column ensured");
      await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoicedAmount int DEFAULT 0 NOT NULL`).catch(() => results.push("invoicedAmount already exists"));
      results.push("invoicedAmount column ensured");
      // Add driveFolderUrl column to projects if missing (migration 0007)
      try {
        await db.execute(sql`ALTER TABLE projects ADD COLUMN driveFolderUrl varchar(2048)`);
        results.push("driveFolderUrl column added");
      } catch (e: any) {
        results.push("driveFolderUrl: " + (e?.message || "already exists"));
      }
      // Verify
      const cols = await db.execute(sql`SHOW COLUMNS FROM projects LIKE 'driveFolderUrl'`);
      results.push("driveFolderUrl verify: " + JSON.stringify(cols?.[0]));
      // Create waitlist_signups table if missing
      await db.execute(sql`CREATE TABLE IF NOT EXISTS waitlist_signups (
        id int AUTO_INCREMENT NOT NULL,
        name varchar(255) NOT NULL,
        email varchar(320) NOT NULL,
        firmName varchar(255) NOT NULL,
        firmSize varchar(64) NOT NULL,
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT waitlist_signups_id PRIMARY KEY(id)
      )`);
      results.push("waitlist_signups table ensured");
      return { success: true, results };
    } catch (e: any) {
      return { error: e?.message, results };
    }
  }),
});
