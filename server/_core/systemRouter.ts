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
      const invoicesCols = await db.execute(sql`SHOW COLUMNS FROM invoices`).catch(() => "table not found");
      const teamMembersCols = await db.execute(sql`SELECT id, name, isActive FROM team_members ORDER BY id`).catch((e: any) => e?.message);
      return { tables, invoicesCols, teamMembersCols };
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
      await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS driveFolderUrl varchar(2048)`).catch(() => results.push("driveFolderUrl already exists"));
      results.push("driveFolderUrl column ensured");

      return { success: true, results };
    } catch (e: any) {
      return { error: e?.message, results };
    }
  }),
});
