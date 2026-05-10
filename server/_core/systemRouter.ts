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
});
