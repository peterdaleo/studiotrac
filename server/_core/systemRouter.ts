import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { getDb } from "../db";
import { users, teamMembers, timeEntries } from "../../drizzle/schema";
import { desc } from "drizzle-orm";

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
  debug: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { error: "no db" };
    const allUsers = await db.select({ id: users.id, email: users.email, name: users.name }).from(users);
    const allMembers = await db.select({ id: teamMembers.id, userId: teamMembers.userId, email: teamMembers.email, name: teamMembers.name }).from(teamMembers);
    const recentEntries = await db.select({ id: timeEntries.id, userId: timeEntries.userId, projectId: timeEntries.projectId, durationMinutes: timeEntries.durationMinutes, startTime: timeEntries.startTime, endTime: timeEntries.endTime }).from(timeEntries).orderBy(desc(timeEntries.id)).limit(20);
    return { users: allUsers, teamMembers: allMembers, recentEntries };
  }),
});
