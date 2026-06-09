import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { sql } from "drizzle-orm";
// Resend lazy-loaded on first use to avoid OOM on Railway startup

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
      const cols = await db.execute(sql`SHOW COLUMNS FROM projects LIKE 'driveFolderUrl'`).catch(() => null);
      results.push("driveFolderUrl verify: " + (cols ? "found" : "not found"));
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

      // Coordination sheets tables (migration 0010)
      await db.execute(sql`CREATE TABLE IF NOT EXISTS coordination_sheets (
        id int AUTO_INCREMENT NOT NULL,
        organizationId int,
        projectId int NOT NULL,
        token varchar(128) NOT NULL,
        projectName varchar(500) NOT NULL,
        isActive boolean NOT NULL DEFAULT true,
        createdById int,
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT coordination_sheets_id PRIMARY KEY(id),
        CONSTRAINT coordination_sheets_token_unique UNIQUE(token)
      )`);
      results.push("coordination_sheets table ensured");

      await db.execute(sql`CREATE TABLE IF NOT EXISTS coordination_items (
        id int AUTO_INCREMENT NOT NULL,
        sheetId int NOT NULL,
        parentId int,
        authorName varchar(255) NOT NULL,
        authorType enum('project_lead','architectural','structural','civil','mechanical','plumbing','landscaping','other') NOT NULL DEFAULT 'other',
        content text NOT NULL,
        isUrgent boolean NOT NULL DEFAULT false,
        isAddressed boolean NOT NULL DEFAULT false,
        isNotified boolean NOT NULL DEFAULT false,
        createdAt timestamp NOT NULL DEFAULT (now()),
        editedAt timestamp NULL,
        CONSTRAINT coordination_items_id PRIMARY KEY(id)
      )`);
      results.push("coordination_items table ensured");
      await db.execute(sql`ALTER TABLE coordination_items ADD COLUMN IF NOT EXISTS isNotified boolean NOT NULL DEFAULT false`).catch(() => {});

      await db.execute(sql`CREATE TABLE IF NOT EXISTS coordination_attachments (
        id int AUTO_INCREMENT NOT NULL,
        itemId int NOT NULL,
        type enum('image','link') NOT NULL DEFAULT 'link',
        url varchar(2048) NOT NULL,
        fileName varchar(500),
        fileKey varchar(500),
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT coordination_attachments_id PRIMARY KEY(id)
      )`);
      results.push("coordination_attachments table ensured");
      // Add fileData (MEDIUMTEXT) and mimeType columns for persistent base64 image storage
      await db.execute(sql`ALTER TABLE coordination_attachments ADD COLUMN fileData MEDIUMTEXT`).catch(() => {});
      await db.execute(sql`ALTER TABLE coordination_attachments ADD COLUMN mimeType varchar(100)`).catch(() => {});
      results.push("coordination_attachments fileData+mimeType columns ensured");

      await db.execute(sql`CREATE TABLE IF NOT EXISTS coordination_subscribers (
        id int AUTO_INCREMENT NOT NULL,
        sheetId int NOT NULL,
        email varchar(255),
        phone varchar(32),
        name varchar(255),
        lastNotifiedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT coordination_subscribers_id PRIMARY KEY(id)
      )`);
      results.push("coordination_subscribers table ensured");
      await db.execute(sql`ALTER TABLE coordination_subscribers ADD COLUMN IF NOT EXISTS lastNotifiedAt timestamp NULL`).catch(() => {});
      // Add phone column for SMS notifications
      await db.execute(sql`ALTER TABLE coordination_subscribers ADD COLUMN IF NOT EXISTS phone varchar(32) NULL`).catch(() => {});
      // Make email nullable (subscribers can use phone-only)
      await db.execute(sql`ALTER TABLE coordination_subscribers MODIFY COLUMN email varchar(255) NULL`).catch(() => {});
      results.push("coordination_subscribers phone column ensured");

      // Add clientToken to coordination_sheets for client-only view links
      await db.execute(sql`ALTER TABLE coordination_sheets ADD COLUMN clientToken varchar(128)`).catch(() => {});
      results.push("coordination_sheets clientToken column ensured");

      // Add visibility to coordination_items for internal/client filtering
      await db.execute(sql`ALTER TABLE coordination_items ADD COLUMN visibility enum('internal','client') NOT NULL DEFAULT 'internal'`).catch(() => {});
      results.push("coordination_items visibility column ensured");

      // Performance indexes for time_entries (fix slow stopTimer/activeTimer queries)
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_time_entries_user_end ON time_entries (userId, endTime)`).catch(() => {});
      results.push("idx_time_entries_user_end index ensured");
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_time_entries_org ON time_entries (organizationId)`).catch(() => {});
      results.push("idx_time_entries_org index ensured");
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries (projectId)`).catch(() => {});
      results.push("idx_time_entries_project index ensured");

      // Add isInternal column to projects for overhead/internal time tracking
      await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS isInternal boolean NOT NULL DEFAULT false`).catch(() => {});
      results.push("projects.isInternal column ensured");

      // Coordination sheet views table for unread badge tracking
      await db.execute(sql`CREATE TABLE IF NOT EXISTS coordination_sheet_views (
        id int AUTO_INCREMENT NOT NULL,
        sheetId int NOT NULL,
        userId int NOT NULL,
        lastViewedAt timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT coordination_sheet_views_id PRIMARY KEY(id),
        CONSTRAINT coordination_sheet_views_unique UNIQUE(sheetId, userId)
      )`);
      results.push("coordination_sheet_views table ensured");

      return { success: true, results };
    } catch (e: any) {
      return { error: e?.message, results };
    }
  }),
});
