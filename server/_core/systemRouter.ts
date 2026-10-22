import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "./trpc";

function maintenanceUnavailable(): never {
  // Never execute schema changes or disclose tenant records through a web API.
  throw new TRPCError({ code: "FORBIDDEN", message: "Database maintenance is not available through the application API." });
}

export const systemRouter = router({
  health: publicProcedure
    .input(z.object({ timestamp: z.number().min(0, "timestamp cannot be negative") }))
    .query(() => ({ ok: true })),
  debugTables: publicProcedure.query(maintenanceUnavailable),
  runMigration: publicProcedure.mutation(maintenanceUnavailable),
});
